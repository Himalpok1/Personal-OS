import { setLogSink } from "@personal-os/core/logging/logger";
import { buildContainsPattern } from "@personal-os/core/search/query";
import {
  events,
  inboxItems,
  mailConnections,
  mailMessages,
  notes,
  occurrences,
  projects,
  tasks,
} from "@personal-os/db";
import {
  ITEM_CONTEXT_BODY_MAX_CHARS,
  ItemContextSchema,
  SEARCH_LIMIT_MAX,
  SearchResponseSchema,
  type SearchResponse,
  type SearchResult,
} from "@personal-os/schema";
import { count, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_CANDIDATE_CAP, searchTaskCandidates } from "../read-models/search.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

const TZ = "America/Chicago";

// Every date-token test names its YEAR explicitly ("september 2026", "2026-09")
// rather than relying on the bare-month form, which resolves to the CURRENT
// year in the caller's zone and would make the suite's fixtures drift with the
// wall clock.

describe("GET /search", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  // ---- helpers -----------------------------------------------------

  function get(params: Record<string, string>) {
    const query = new URLSearchParams(params);
    return app.inject({ method: "GET", url: `/search?${query.toString()}` });
  }

  /** Asserts 200 and parses through the frozen schema, so every happy path is a contract test. */
  async function search(params: Record<string, string>): Promise<SearchResponse> {
    const response = await get(params);
    expect(response.statusCode).toBe(200);
    return SearchResponseSchema.parse(response.json());
  }

  function ofType<T extends SearchResult["type"]>(
    body: SearchResponse,
    type: T,
  ): Extract<SearchResult, { type: T }>[] {
    return body.results.filter(
      (result): result is Extract<SearchResult, { type: T }> => result.type === type,
    );
  }

  function idsOfType(body: SearchResponse, type: SearchResult["type"]): string[] {
    return ofType(body, type).map((result) => result.id);
  }

  async function seedTask(values: {
    title: string;
    body?: string | null;
    status?: string;
    dueAt?: Date | null;
    archivedAt?: Date | null;
    updatedAt?: Date;
    rrule?: string | null;
  }): Promise<string> {
    const [row] = await app.db
      .insert(tasks)
      .values({
        title: values.title,
        body: values.body ?? null,
        status: values.status ?? "active",
        dueAt: values.dueAt ?? null,
        timezone: TZ,
        archivedAt: values.archivedAt ?? null,
        ...(values.updatedAt === undefined ? {} : { updatedAt: values.updatedAt }),
        ...(values.rrule === undefined
          ? {}
          : { rrule: values.rrule, recurrenceAnchor: "due_date", recurrenceTimezone: TZ }),
      })
      .returning({ id: tasks.id });
    return row!.id;
  }

  async function seedEvent(values: {
    title: string;
    origin: "local" | "external";
    location?: string | null;
    description?: string | null;
    startsAt?: Date | null;
    allDay?: boolean;
    startDate?: string | null;
    endDate?: string | null;
    rrule?: string | null;
    parentEventId?: string | null;
    archivedAt?: Date | null;
    externalId?: string | null;
  }): Promise<string> {
    const startsAt = values.startsAt === undefined ? null : values.startsAt;
    const [row] = await app.db
      .insert(events)
      .values({
        title: values.title,
        origin: values.origin,
        location: values.location ?? null,
        description: values.description ?? null,
        startsAt,
        endsAt: startsAt === null ? null : new Date(startsAt.getTime() + 3_600_000),
        allDay: values.allDay ?? false,
        startDate: values.startDate ?? null,
        endDate: values.endDate ?? values.startDate ?? null,
        timezone: TZ,
        rrule: values.rrule ?? null,
        recurrenceTimezone: values.rrule ? TZ : null,
        parentEventId: values.parentEventId ?? null,
        archivedAt: values.archivedAt ?? null,
        externalId: values.externalId ?? null,
        externalSource: values.origin === "external" ? "google" : null,
        externalEtag: values.origin === "external" ? "etag-sentinel-9f2c" : null,
        clientUuid: values.origin === "local" ? `client-uuid-sentinel-${Math.random()}` : null,
      })
      .returning({ id: events.id });
    return row!.id;
  }

  async function seedProject(values: {
    name: string;
    goal?: string | null;
    status?: string;
    targetDate?: string | null;
    archivedAt?: Date | null;
  }): Promise<string> {
    const [row] = await app.db
      .insert(projects)
      .values({
        name: values.name,
        goal: values.goal ?? null,
        status: values.status ?? "active",
        targetDate: values.targetDate ?? null,
        archivedAt: values.archivedAt ?? null,
      })
      .returning({ id: projects.id });
    return row!.id;
  }

  async function seedInbox(values: {
    rawText: string | null;
    capturedAt?: Date;
    archivedAt?: Date | null;
    status?: string;
    entityType?: string | null;
    entityId?: string | null;
  }): Promise<string> {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        rawText: values.rawText,
        source: "web",
        capturedAt: values.capturedAt ?? new Date("2026-08-01T10:00:00Z"),
        timezone: TZ,
        status: values.status ?? "parsed",
        entityType: values.entityType ?? null,
        entityId: values.entityId ?? null,
        archivedAt: values.archivedAt ?? null,
      })
      .returning({ id: inboxItems.id });
    return row!.id;
  }

  async function seedMailConnection(): Promise<string> {
    const [row] = await app.db
      .insert(mailConnections)
      .values({
        provider: "gmail",
        externalAccountId: `person+${Math.random().toString(36).slice(2)}@example.com`,
        status: "active",
      })
      .returning({ id: mailConnections.id });
    return row!.id;
  }

  let mailSequence = 0;
  async function seedMail(values: {
    connectionId: string;
    subject?: string | null;
    fromDisplayName?: string | null;
    fromAddress?: string | null;
    fromDomain?: string | null;
    internalDate?: Date;
    deletedAt?: Date | null;
    hasAttachment?: boolean;
  }): Promise<string> {
    mailSequence += 1;
    const [row] = await app.db
      .insert(mailMessages)
      .values({
        connectionId: values.connectionId,
        externalId: `msg-${mailSequence}-${Math.random().toString(36).slice(2)}`,
        threadId: `thread-${mailSequence}`,
        internalDate: values.internalDate ?? new Date("2026-08-01T12:00:00Z"),
        subject: values.subject ?? null,
        fromDisplayName: values.fromDisplayName ?? null,
        fromAddress: values.fromAddress ?? null,
        fromDomain: values.fromDomain ?? null,
        hasAttachment: values.hasAttachment ?? false,
        contentHash: `hash-${mailSequence}`,
        deletedAt: values.deletedAt ?? null,
      })
      .returning({ id: mailMessages.id });
    return row!.id;
  }

  // ---- validation --------------------------------------------------

  it("rejects a missing q with 400 validation_failed", async () => {
    const response = await app.inject({ method: "GET", url: "/search" });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("rejects a whitespace-only query with 400 -- it can never reach SQL", async () => {
    for (const q of [" ", "   ", "\t\n"]) {
      const response = await get({ q });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    }
  });

  it("rejects a query that is too short AFTER trimming", async () => {
    const response = await get({ q: "  a  " });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("accepts the shortest legal query and rejects one character less", async () => {
    expect((await get({ q: "ab" })).statusCode).toBe(200);
    expect((await get({ q: "a" })).statusCode).toBe(400);
  });

  it("rejects a query that is too long", async () => {
    expect((await get({ q: "a".repeat(128) })).statusCode).toBe(200);
    expect((await get({ q: "a".repeat(129) })).statusCode).toBe(400);
    expect((await get({ q: "a".repeat(5000) })).statusCode).toBe(400);
  });

  it("rejects a limit above the maximum rather than silently clamping", async () => {
    expect((await get({ q: "rent", limit: String(SEARCH_LIMIT_MAX) })).statusCode).toBe(200);
    expect((await get({ q: "rent", limit: String(SEARCH_LIMIT_MAX + 1) })).statusCode).toBe(400);
    expect((await get({ q: "rent", limit: "0" })).statusCode).toBe(400);
  });

  it("rejects an unknown query parameter -- the schema is strict", async () => {
    const response = await get({ q: "rent", table: "mail_connections" });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("rejects an invalid include_archived value", async () => {
    expect((await get({ q: "rent", include_archived: "no" })).statusCode).toBe(400);
    expect((await get({ q: "rent", include_archived: "false" })).statusCode).toBe(200);
    expect((await get({ q: "rent", include_archived: "true" })).statusCode).toBe(200);
  });

  it("rejects an unknown type in types=, an unknown tz and an unknown order", async () => {
    expect((await get({ q: "rent", types: "task,mail_connection" })).statusCode).toBe(400);
    expect((await get({ q: "rent", types: "" })).statusCode).toBe(400);
    expect((await get({ q: "rent", tz: "Mars/Olympus" })).statusCode).toBe(400);
    expect((await get({ q: "rent", order: "relevance" })).statusCode).toBe(400);
    expect((await get({ q: "rent", types: "task, event", tz: TZ, order: "type" })).statusCode).toBe(
      200,
    );
  });

  it("returns an honest empty response for an empty database", async () => {
    const body = await search({ q: "anything" });
    expect(body.results).toEqual([]);
    expect(body.truncated).toBe(false);
    expect(body.query).toBe("anything");
    expect(body.match_mode).toBe("all");
    expect(body.tokens).toEqual(["anything"]);
    expect(body.date_filter).toBeNull();
    expect(body.order).toBe("score");
    for (const counts of Object.values(body.counts)) {
      expect(counts).toEqual({ returned: 0, total: 0 });
    }
  });

  it("echoes the NORMALIZED query, not the raw one, and the lowercased tokens", async () => {
    const body = await search({ q: "  Rent   DUE  " });
    expect(body.query).toBe("Rent DUE");
    expect(body.tokens).toEqual(["rent", "due"]);
  });

  // ---- matching, per type ------------------------------------------

  it("matches a task title and a task body", async () => {
    await seedTask({ title: "Renew the insurance" });
    await seedTask({ title: "Errand", body: "pick up the parcel" });
    const byTitle = await search({ q: "insurance" });
    expect(byTitle.counts.task).toEqual({ returned: 1, total: 1 });
    expect(byTitle.results[0]!.title).toBe("Renew the insurance");
    expect(byTitle.results[0]!.match.fields).toEqual(["title"]);

    const byBody = await search({ q: "parcel" });
    expect(byBody.counts.task.total).toBe(1);
    expect(byBody.results[0]!.preview).toBe("pick up the parcel");
    expect(byBody.results[0]!.match.fields).toEqual(["body"]);
  });

  it("matches a note title and a note body", async () => {
    await app.db.insert(notes).values({ title: "Roof quote", body: "unrelated" });
    await app.db.insert(notes).values({ title: "unrelated", body: "the roof needs work" });
    const body = await search({ q: "roof" });
    expect(body.counts.note).toEqual({ returned: 2, total: 2 });
  });

  it("matches an event by title, location and description -- for LOCAL and EXTERNAL events alike", async () => {
    const byTitle = await seedEvent({ title: "Dentist appointment", origin: "local" });
    const byLocation = await seedEvent({
      title: "Checkup",
      origin: "external",
      location: "Dentist on Main",
    });
    const byDescription = await seedEvent({
      title: "Afternoon",
      origin: "external",
      description: "see the dentist about the crown",
    });
    const byLocalDescription = await seedEvent({
      title: "Morning",
      origin: "local",
      description: "dentist follow-up",
    });

    const body = await search({ q: "dentist" });
    expect(body.counts.event).toEqual({ returned: 4, total: 4 });
    expect(new Set(idsOfType(body, "event"))).toEqual(
      new Set([byTitle, byLocation, byDescription, byLocalDescription]),
    );
    const fields = new Map(ofType(body, "event").map((e) => [e.id, e.match.fields]));
    expect(fields.get(byTitle)).toEqual(["title"]);
    expect(fields.get(byLocation)).toEqual(["location"]);
    expect(fields.get(byDescription)).toEqual(["description"]);
  });

  it("matches a project by name and by goal", async () => {
    const byName = await seedProject({ name: "Kitchen remodel" });
    const byGoal = await seedProject({ name: "House", goal: "finish the kitchen by spring" });
    const body = await search({ q: "kitchen" });
    expect(body.counts.project).toEqual({ returned: 2, total: 2 });
    const byId = new Map(ofType(body, "project").map((p) => [p.id, p]));
    expect(byId.get(byName)!.match.fields).toEqual(["title"]);
    expect(byId.get(byGoal)!.match.fields).toEqual(["goal"]);
    expect(byId.get(byGoal)!.preview).toBe("finish the kitchen by spring");
  });

  it("matches inbox raw_text, and never a capture whose transcript does not exist yet", async () => {
    await seedInbox({ rawText: "remind me to call the plumber" });
    // raw_text is nullable because a push-to-talk capture is written before its
    // transcript. NULL ILIKE x is NULL, so it cannot match -- and nothing
    // coalesces it into an empty string that a "%%" pattern would hit.
    await seedInbox({ rawText: null });
    const body = await search({ q: "plumber" });
    expect(body.counts.inbox_item.total).toBe(1);
    expect(body.results[0]!.type).toBe("inbox_item");
    expect(body.results[0]!.match.fields).toEqual(["raw_text"]);
    expect((await search({ q: "anything" })).counts.inbox_item.total).toBe(0);
  });

  it("matches a mail subject and a mail display name", async () => {
    const connectionId = await seedMailConnection();
    await seedMail({ connectionId, subject: "Your flight to Denver" });
    await seedMail({ connectionId, subject: "unrelated", fromDisplayName: "Denver Water" });
    const body = await search({ q: "denver" });
    expect(body.counts.mail_message).toEqual({ returned: 2, total: 2 });
    expect(new Set(ofType(body, "mail_message").flatMap((m) => m.match.fields))).toEqual(
      new Set(["subject", "sender"]),
    );
  });

  it("is case-insensitive across every entity", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "INSURANCE renewal" });
    await app.db.insert(notes).values({ title: "Insurance", body: "x" });
    await seedEvent({ title: "insurance CALL", origin: "local" });
    await seedProject({ name: "InSuRaNcE" });
    await seedInbox({ rawText: "insurance" });
    await seedMail({ connectionId, subject: "InSuRaNcE" });

    const body = await search({ q: "iNsUrAnCe" });
    expect(body.results).toHaveLength(6);
  });

  it("returns results from all six entities in one response", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "zebra task" });
    await app.db.insert(notes).values({ title: "zebra note", body: "x" });
    await seedEvent({ title: "zebra event", origin: "local" });
    await seedProject({ name: "zebra project" });
    await seedInbox({ rawText: "zebra capture" });
    await seedMail({ connectionId, subject: "zebra mail" });

    const body = await search({ q: "zebra", order: "type" });
    expect(body.results.map((result) => result.type)).toEqual([
      "task",
      "note",
      "event",
      "project",
      "inbox_item",
      "mail_message",
    ]);
  });

  // ---- tokens and the ladder ----------------------------------------

  it("rung 1 ANDs the tokens: both must match, in any order and in any column", async () => {
    const both = await seedTask({ title: "Pay rent", body: "due in october" });
    await seedTask({ title: "Pay rent" });
    await seedTask({ title: "October plans" });

    const body = await search({ q: "october rent" });
    expect(body.match_mode).toBe("all");
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
    expect(body.results[0]!.id).toBe(both);
    expect(body.results[0]!.match.fields).toEqual(["title", "body"]);
  });

  it("rung 3 ORs the tokens ONLY when nothing matched them all, and says so", async () => {
    const alpha = await seedTask({ title: "alpha only" });
    const beta = await app.db
      .insert(notes)
      .values({ title: "beta only", body: "x" })
      .returning({ id: notes.id });

    const body = await search({ q: "alpha beta" });
    expect(body.match_mode).toBe("any");
    expect(new Set(body.results.map((r) => r.id))).toEqual(new Set([alpha, beta[0]!.id]));
  });

  it("does NOT fall to rung 3 for a single token -- one token has nothing to relax", async () => {
    await seedTask({ title: "alpha only" });
    const body = await search({ q: "gamma" });
    expect(body.match_mode).toBe("all");
    expect(body.results).toEqual([]);
  });

  it("match_mode none for a query with no surviving token: nothing is queried, every count is zero", async () => {
    await seedTask({ title: "!! important" });
    for (const q of ["!!", "🎉🎉", "--", "..."]) {
      const body = await search({ q });
      expect(body.match_mode).toBe("none");
      expect(body.tokens).toEqual([]);
      expect(body.results).toEqual([]);
      for (const counts of Object.values(body.counts)) expect(counts.total).toBe(0);
    }
  });

  it("echoes the words the token cap dropped, and never a stored string", async () => {
    await app.db
      .insert(notes)
      .values({ title: "alpha beta", body: "gamma delta epsilon zeta eta theta iota" });
    const body = await search({ q: "alpha beta gamma delta epsilon zeta eta theta iota" });
    expect(body.tokens).toHaveLength(8);
    expect(body.dropped).toEqual(["iota"]);
    expect(body.results).toHaveLength(1);
  });

  it("caps the tokens at eight and matches the first eight", async () => {
    await seedTask({ title: "one two three four five six seven eight", body: "nine" });
    const body = await search({ q: "one two three four five six seven eight nine ten" });
    expect(body.tokens).toHaveLength(8);
    expect(body.counts.task.total).toBe(1);
  });

  // ---- date tokens ---------------------------------------------------

  it("finds an event whose starts_at falls in the month named", async () => {
    const hit = await seedEvent({
      title: "Dentist",
      origin: "local",
      startsAt: new Date("2026-09-22T15:00:00Z"),
    });
    await seedEvent({
      title: "Dentist",
      origin: "local",
      startsAt: new Date("2026-10-02T15:00:00Z"),
    });

    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(body.match_mode).toBe("all");
    expect(body.tokens).toEqual(["dentist"]);
    expect(body.date_filter).toEqual({
      token: "september 2026",
      kind: "month",
      from: "2026-09-01",
      to: "2026-09-30",
      tz: TZ,
      dropped: false,
    });
    expect(idsOfType(body, "event")).toEqual([hit]);
    const result = body.results[0]!;
    expect(result.match.fields).toEqual(["title", "date"]);
    expect(result.match.reasons.some((r) => r.code === "date_window" && r.points === 25)).toBe(
      true,
    );
  });

  it("finds an all-day event by start_date -- a pure date, never a midnight instant", async () => {
    const hit = await seedEvent({
      title: "Dentist",
      origin: "local",
      allDay: true,
      startDate: "2026-09-30",
      endDate: "2026-09-30",
    });
    await seedEvent({
      title: "Dentist",
      origin: "local",
      allDay: true,
      startDate: "2026-10-01",
      endDate: "2026-10-01",
    });
    const body = await search({ q: "dentist 2026-09", tz: TZ });
    expect(body.date_filter?.kind).toBe("iso_month");
    expect(idsOfType(body, "event")).toEqual([hit]);
    expect(ofType(body, "event")[0]!.start_date).toBe("2026-09-30");
    expect(ofType(body, "event")[0]!.starts_at).toBeNull();
  });

  it("finds a recurring series through a materialized occurrence in the window", async () => {
    // The parent row's anchor is in August; only the occurrences table knows
    // the series lands in September.
    const series = await seedEvent({
      title: "Dentist cleaning",
      origin: "local",
      startsAt: new Date("2026-08-10T15:00:00Z"),
      rrule: "FREQ=MONTHLY",
    });
    await app.db.insert(occurrences).values({
      parentType: "event",
      parentId: series,
      occursAt: new Date("2026-09-10T15:00:00Z"),
      occursLocal: new Date("2026-09-10T10:00:00Z"),
    });
    const other = await seedEvent({
      title: "Dentist cleaning",
      origin: "local",
      startsAt: new Date("2026-08-11T15:00:00Z"),
      rrule: "FREQ=MONTHLY",
    });
    await app.db.insert(occurrences).values({
      parentType: "event",
      parentId: other,
      occursAt: new Date("2026-11-11T15:00:00Z"),
      occursLocal: new Date("2026-11-11T10:00:00Z"),
    });

    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(idsOfType(body, "event")).toEqual([series]);
    expect(ofType(body, "event")[0]!.is_recurring).toBe(true);
  });

  it("an all-day series is matched on its occurrences' LOCAL DATE, never on the local-noon anchor (ADR-045)", async () => {
    // The series lives in Chicago; its Sep-14 occurrence is anchored at local
    // noon, 17:00Z (ADR-042). Viewed from Auckland (UTC+12 in September) that
    // instant is 05:00 on Sep 15 -- so an instant comparison would file the
    // occurrence under the wrong day for a caller in that zone, and the ADR
    // says the anchor is never a time. The parent's own start_date is a week
    // earlier so only the occurrence can carry the match.
    const series = await seedEvent({
      title: "Dentist",
      origin: "local",
      allDay: true,
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    await app.db.insert(occurrences).values({
      parentType: "event",
      parentId: series,
      occursAt: new Date("2026-09-14T17:00:00Z"),
      occursLocal: new Date("2026-09-14T12:00:00Z"),
    });

    const onTheDay = await search({ q: "dentist 2026-09-14", tz: "Pacific/Auckland" });
    expect(onTheDay.match_mode).toBe("all");
    expect(onTheDay.date_filter?.dropped).toBe(false);
    expect(idsOfType(onTheDay, "event")).toEqual([series]);
    expect(ofType(onTheDay, "event")[0]!.match.reasons.map((r) => r.code)).toContain("date_window");

    // The next day must NOT find it by window: the only way that query can
    // still return the row is by dropping the date (rung 2).
    const nextDay = await search({ q: "dentist 2026-09-15", tz: "Pacific/Auckland" });
    expect(nextDay.match_mode).toBe("all_without_date");
  });

  it("finds a task by due_at and a recurring task by an occurrence in the window", async () => {
    const byDue = await seedTask({ title: "Dentist", dueAt: new Date("2026-09-03T14:00:00Z") });
    const byOccurrence = await seedTask({
      title: "Dentist",
      dueAt: new Date("2026-07-03T14:00:00Z"),
      rrule: "FREQ=MONTHLY",
    });
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: byOccurrence,
      occursAt: new Date("2026-09-03T14:00:00Z"),
      occursLocal: new Date("2026-09-03T09:00:00Z"),
    });
    await seedTask({ title: "Dentist", dueAt: new Date("2026-10-03T14:00:00Z") });
    await seedTask({ title: "Dentist" });

    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(new Set(idsOfType(body, "task"))).toEqual(new Set([byDue, byOccurrence]));
  });

  it("a day window respects the caller's zone at the boundary", async () => {
    // 04:30Z on the 15th is still the 14th in Chicago (UTC-5 in September).
    const chicago14 = await seedTask({
      title: "Dentist",
      dueAt: new Date("2026-09-15T04:30:00Z"),
    });
    await seedTask({ title: "Dentist", dueAt: new Date("2026-09-15T14:00:00Z") });

    const body = await search({ q: "dentist 2026-09-14", tz: TZ });
    expect(body.date_filter?.kind).toBe("iso_date");
    expect(idsOfType(body, "task")).toEqual([chicago14]);
  });

  it("finds a project by target_date, an inbox item by captured_at and mail by internal_date", async () => {
    const connectionId = await seedMailConnection();
    const project = await seedProject({ name: "Dentist plan", targetDate: "2026-09-20" });
    await seedProject({ name: "Dentist plan", targetDate: "2026-10-20" });
    const capture = await seedInbox({
      rawText: "book dentist",
      capturedAt: new Date("2026-09-05T10:00:00Z"),
    });
    await seedInbox({ rawText: "book dentist", capturedAt: new Date("2026-08-05T10:00:00Z") });
    const mail = await seedMail({
      connectionId,
      subject: "Dentist reminder",
      internalDate: new Date("2026-09-18T10:00:00Z"),
    });
    await seedMail({
      connectionId,
      subject: "Dentist reminder",
      internalDate: new Date("2026-07-18T10:00:00Z"),
    });

    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(idsOfType(body, "project")).toEqual([project]);
    expect(idsOfType(body, "inbox_item")).toEqual([capture]);
    expect(idsOfType(body, "mail_message")).toEqual([mail]);
  });

  it("a note has no date axis: the date token matches by TEXT and earns date_text, never date_window", async () => {
    const [hit] = await app.db
      .insert(notes)
      .values({ title: "Dentist", body: "call back in september 2026" })
      .returning({ id: notes.id });
    await app.db.insert(notes).values({ title: "Dentist", body: "no month here" });

    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(idsOfType(body, "note")).toEqual([hit!.id]);
    const note = ofType(body, "note")[0]!;
    expect(note.match.reasons.some((r) => r.code === "date_text" && r.points === 5)).toBe(true);
    expect(note.match.reasons.some((r) => r.code === "date_window")).toBe(false);
    expect(note.match.fields).toEqual(["title", "body"]);
  });

  it("rung 2 drops the date token when the window (and its text) matched nothing anywhere", async () => {
    const task = await seedTask({ title: "Dentist", dueAt: new Date("2026-03-03T14:00:00Z") });
    const body = await search({ q: "dentist september 2026", tz: TZ });
    expect(body.match_mode).toBe("all_without_date");
    expect(body.date_filter).toMatchObject({ token: "september 2026", dropped: true });
    expect(body.results.map((r) => r.id)).toEqual([task]);
    expect(body.results[0]!.match.fields).toEqual(["title"]);
  });

  it("a query that is ONLY a date token finds every row in the window, and drops to nothing on rung 2", async () => {
    const inWindow = await seedTask({ title: "Anything", dueAt: new Date("2026-09-03T14:00:00Z") });
    await seedTask({ title: "Anything", dueAt: new Date("2026-10-03T14:00:00Z") });
    const hit = await search({ q: "september 2026", tz: TZ });
    expect(hit.match_mode).toBe("all");
    expect(hit.tokens).toEqual([]);
    expect(idsOfType(hit, "task")).toEqual([inWindow]);

    const miss = await search({ q: "2026-02", tz: TZ });
    expect(miss.match_mode).toBe("all_without_date");
    expect(miss.results).toEqual([]);
  });

  it("without tz no word is a date: 'september 2026' is two text tokens", async () => {
    await seedTask({ title: "Dentist", dueAt: new Date("2026-09-03T14:00:00Z") });
    const [textual] = await app.db
      .insert(notes)
      .values({ title: "Dentist", body: "september 2026" })
      .returning({ id: notes.id });

    const body = await search({ q: "dentist september 2026" });
    expect(body.date_filter).toBeNull();
    expect(body.tokens).toEqual(["dentist", "september", "2026"]);
    expect(body.results.map((r) => r.id)).toEqual([textual!.id]);
  });

  // ---- ranking ------------------------------------------------------

  it("is byte-identical across two identical requests", async () => {
    const connectionId = await seedMailConnection();
    const updatedAt = new Date("2026-08-03T00:00:00Z");
    // Two rows CAN share a timestamp: Checkpoint 8.2 ingested 98 calendar
    // events sharing one created_at to the microsecond.
    await app.db.insert(notes).values([
      { title: "tie widget a", body: "x", updatedAt },
      { title: "tie widget b", body: "x", updatedAt },
      { title: "tie widget c", body: "x", updatedAt },
    ]);
    await seedTask({ title: "tie widget", updatedAt });
    await seedMail({ connectionId, subject: "tie widget", internalDate: updatedAt });

    const first = await get({ q: "tie widget" });
    const second = await get({ q: "tie widget" });
    expect(first.body).toBe(second.body);

    const parsed = SearchResponseSchema.parse(first.json());
    const noteIds = idsOfType(parsed, "note");
    expect(noteIds).toEqual([...noteIds].sort());
  });

  it("every score is exactly the sum of its reasons, and the list is in comparator order", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "Dentist", body: "dentist dentist" });
    await app.db.insert(notes).values({ title: "Notes", body: "the dentist said" });
    await seedEvent({ title: "Dentist visit", origin: "external", location: "dentist" });
    await seedMail({ connectionId, subject: "dentist" });

    const body = await search({ q: "dentist" });
    for (const result of body.results) {
      expect(result.score).toBe(result.match.reasons.reduce((sum, r) => sum + r.points, 0));
    }
    const keys = body.results.map((r) => [r.score, r.timestamp, r.type, r.id] as const);
    const sorted = [...keys].sort((a, b) => {
      if (a[0] !== b[0]) return b[0] - a[0];
      if (a[1] !== b[1]) return a[1] < b[1] ? 1 : -1;
      const order = ["task", "note", "event", "project", "inbox_item", "mail_message"];
      if (a[2] !== b[2]) return order.indexOf(a[2]) - order.indexOf(b[2]);
      return a[3] < b[3] ? -1 : 1;
    });
    expect(keys).toEqual(sorted);
  });

  it("ranks an exact title above a prefix, a phrase, a title token and a body-only hit", async () => {
    const exact = await seedTask({ title: "Dentist" });
    const prefix = await seedTask({ title: "Dentist appointment" });
    const phrase = await seedTask({ title: "The dentist" });
    const bodyOnly = await seedTask({ title: "Errand", body: "dentist" });

    const body = await search({ q: "dentist" });
    expect(idsOfType(body, "task")).toEqual([exact, prefix, phrase, bodyOnly]);
    const codes = ofType(body, "task").map((t) => t.match.reasons.map((r) => r.code));
    expect(codes[0]).toContain("title_exact");
    expect(codes[1]).toContain("title_prefix");
    expect(codes[2]).toContain("title_phrase");
    expect(codes[3]).toEqual(["body_token", "recency", "type_prior"]);
  });

  it("penalises a done or dropped task, an archived row, a completed project and an external event", async () => {
    const updatedAt = new Date("2026-09-01T00:00:00Z");
    const active = await seedTask({ title: "Widget", updatedAt });
    const done = await seedTask({ title: "Widget", status: "done", updatedAt });
    const dropped = await seedTask({ title: "Widget", status: "dropped", updatedAt });
    const archived = await seedTask({ title: "Widget", archivedAt: updatedAt, updatedAt });

    const body = await search({ q: "widget", include_archived: "true", types: "task" });
    const scores = new Map(ofType(body, "task").map((t) => [t.id, t.score]));
    expect(scores.get(done)).toBe(scores.get(active)! - 15);
    expect(scores.get(dropped)).toBe(scores.get(active)! - 15);
    expect(scores.get(archived)).toBe(scores.get(active)! - 25);
    expect(idsOfType(body, "task")[0]).toBe(active);

    const openProject = await seedProject({ name: "Widget" });
    const completedProject = await seedProject({ name: "Widget", status: "completed" });
    const local = await seedEvent({ title: "Widget", origin: "local" });
    const external = await seedEvent({ title: "Widget", origin: "external" });

    const rest = await search({ q: "widget", types: "project,event" });
    const projectScores = new Map(ofType(rest, "project").map((p) => [p.id, p.score]));
    expect(projectScores.get(completedProject)).toBe(projectScores.get(openProject)! - 10);
    const eventScores = new Map(ofType(rest, "event").map((e) => [e.id, e.score]));
    expect(eventScores.get(external)).toBe(eventScores.get(local)! - 5);
  });

  it("mail sits below the user's own content at equal text match (type_prior -10)", async () => {
    const connectionId = await seedMailConnection();
    const now = new Date();
    await seedTask({ title: "Widget", updatedAt: now });
    await seedMail({ connectionId, subject: "Widget", internalDate: now });
    const body = await search({ q: "widget" });
    expect(body.results.map((r) => r.type)).toEqual(["task", "mail_message"]);
    expect(body.results[1]!.match.reasons).toContainEqual({ code: "type_prior", points: -10 });
  });

  it("order=type groups in SEARCH_RESULT_TYPE_ORDER with the score order kept inside each group", async () => {
    const connectionId = await seedMailConnection();
    const noteExact = await app.db
      .insert(notes)
      .values({ title: "Widget", body: "x" })
      .returning({ id: notes.id });
    const noteBody = await app.db
      .insert(notes)
      .values({ title: "Other", body: "widget" })
      .returning({ id: notes.id });
    const taskBody = await seedTask({ title: "Other", body: "widget" });
    await seedMail({ connectionId, subject: "Widget" });

    const byScore = await search({ q: "widget" });
    // The note with the exact title outranks the body-only task under score
    // order...
    expect(byScore.results[0]!.id).toBe(noteExact[0]!.id);

    const byType = await search({ q: "widget", order: "type" });
    // ...and under type order the task group comes first regardless, with the
    // note group still internally sorted exact-before-body.
    expect(byType.results.map((r) => r.id)).toEqual([
      taskBody,
      noteExact[0]!.id,
      noteBody[0]!.id,
      byType.results[3]!.id,
    ]);
    expect(byType.results[3]!.type).toBe("mail_message");
  });

  // ---- types filter -------------------------------------------------

  it("types= searches only the named types and reports zero for the rest", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "widget task" });
    await app.db.insert(notes).values({ title: "widget note", body: "x" });
    await seedEvent({ title: "widget event", origin: "local" });
    await seedMail({ connectionId, subject: "widget mail" });

    const body = await search({ q: "widget", types: "task,event" });
    expect(body.results.map((r) => r.type).sort()).toEqual(["event", "task"]);
    expect(body.counts.note).toEqual({ returned: 0, total: 0 });
    expect(body.counts.mail_message).toEqual({ returned: 0, total: 0 });
  });

  // ---- wildcard and injection safety -------------------------------

  it("the read model escapes % _ and \\ inside a pattern -- the ESCAPE clause is real", async () => {
    // The tokeniser never emits these characters (they split as punctuation),
    // so the route cannot reach this path; the read model still escapes, and
    // this test proves the clause it emits is honoured by PostgreSQL. The
    // DECOY rows are what give it teeth: each contains the text minus the
    // metacharacter, which an unescaped pattern would match.
    await seedTask({ title: "50% off coupon" });
    await seedTask({ title: "50 percent off, spelled out" });
    await seedTask({ title: "file_name convention" });
    await seedTask({ title: "fileXname convention" });
    await seedTask({ title: "path C:\\temp\\notes" });
    await seedTask({ title: "path C:temp" });

    for (const [needle, expected] of [
      ["50%", "50% off coupon"],
      ["file_name", "file_name convention"],
      ["C:\\temp", "path C:\\temp\\notes"],
    ] as const) {
      const rows = await searchTaskCandidates(app.db, {
        predicate: { textPatterns: [buildContainsPattern(needle)], mode: "all", date: null },
        includeArchived: false,
      });
      expect(rows.map((row) => row.title)).toEqual([expected]);
    }
  });

  it("a bare % or _ query never reaches SQL: it tokenises to nothing", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "no percent sign" });
    await app.db.insert(notes).values({ title: "none here", body: "nor here" });
    await seedMail({ connectionId, subject: "clean subject" });

    for (const q of ["%%", "__", "%_", "\\\\"]) {
      const body = await search({ q });
      expect(body.match_mode).toBe("none");
      expect(body.results).toEqual([]);
    }
  });

  it("a metacharacter inside a word is a word boundary, not a wildcard", async () => {
    await seedTask({ title: "50% off coupon" });
    await seedTask({ title: "50 percent off" });
    await seedTask({ title: "nothing relevant here" });
    const body = await search({ q: "50%" });
    expect(body.tokens).toEqual(["50"]);
    expect(body.counts.task.total).toBe(2);
  });

  it("SQL-shaped input is matched as text and changes nothing", async () => {
    await seedTask({ title: "keep me" });
    await app.db.insert(notes).values({ title: "keep me too", body: "x" });

    for (const q of [
      "'; drop table tasks; --",
      "' or '1'='1",
      "1; delete from notes where 1=1; --",
      "*/ union select null,null --",
      "'; drop table tasks; -- september 2026",
    ]) {
      const response = await get({ q, tz: TZ });
      expect(response.statusCode).toBe(200);
      expect(SearchResponseSchema.parse(response.json()).results).toEqual([]);
    }

    expect(await app.db.select().from(tasks)).toHaveLength(1);
    expect(await app.db.select().from(notes)).toHaveLength(1);
  });

  // ---- unicode -------------------------------------------------------

  it("matches CJK text and keeps diacritics", async () => {
    const [cjk] = await app.db
      .insert(notes)
      .values({ title: "日本語のメモ", body: "x" })
      .returning({ id: notes.id });
    const [cafe] = await app.db
      .insert(notes)
      .values({ title: "Café list", body: "x" })
      .returning({ id: notes.id });
    await app.db.insert(notes).values({ title: "Cafe list", body: "x" });

    expect(idsOfType(await search({ q: "日本" }), "note")).toEqual([cjk!.id]);
    expect(idsOfType(await search({ q: "café" }), "note")).toEqual([cafe!.id]);
  });

  it("folds full-width digits and ignores emoji around a word", async () => {
    const task = await seedTask({ title: "Room 2026" });
    const body = await search({ q: "🎉 ２０２６ 🎉" });
    expect(body.tokens).toEqual(["2026"]);
    expect(idsOfType(body, "task")).toEqual([task]);
  });

  // ---- archive / lifecycle policy ----------------------------------

  it("include_archived reaches task, note, event and project -- and NOT inbox or mail", async () => {
    const connectionId = await seedMailConnection();
    const archivedAt = new Date("2026-08-01T00:00:00Z");
    await seedTask({ title: "archived widget", archivedAt });
    await app.db.insert(notes).values({ title: "archived widget", body: "x", archivedAt });
    await seedEvent({ title: "archived widget", origin: "local", archivedAt });
    await seedProject({ name: "archived widget", archivedAt });
    await seedInbox({ rawText: "archived widget", archivedAt });
    await seedMail({ connectionId, subject: "archived widget", deletedAt: archivedAt });

    const hidden = await search({ q: "archived widget" });
    expect(hidden.results).toEqual([]);

    const shown = await search({ q: "archived widget", include_archived: "true" });
    expect(shown.results.map((r) => r.type).sort()).toEqual(["event", "note", "project", "task"]);
    expect(shown.results.every((r) => "archived" in r && r.archived)).toBe(true);
    expect(shown.counts.inbox_item).toEqual({ returned: 0, total: 0 });
    expect(shown.counts.mail_message).toEqual({ returned: 0, total: 0 });
  });

  it("includes done and dropped tasks -- a finished task is still stored content", async () => {
    await seedTask({ title: "finished widget", status: "done" });
    await seedTask({ title: "abandoned widget", status: "dropped" });
    const body = await search({ q: "widget" });
    expect(body.counts.task.total).toBe(2);
    expect(
      ofType(body, "task")
        .map((t) => t.status)
        .sort(),
    ).toEqual(["done", "dropped"]);
  });

  it("a detached event instance is its own result, a series parent is one result", async () => {
    const parent = await seedEvent({
      title: "Weekly widget sync",
      origin: "local",
      startsAt: new Date("2026-09-01T15:00:00Z"),
      rrule: "FREQ=WEEKLY",
    });
    const detached = await seedEvent({
      title: "Weekly widget sync (moved)",
      origin: "local",
      startsAt: new Date("2026-09-09T16:00:00Z"),
      parentEventId: parent,
    });
    const body = await search({ q: "widget sync" });
    const byId = new Map(ofType(body, "event").map((e) => [e.id, e]));
    expect(byId.size).toBe(2);
    expect(byId.get(parent)).toMatchObject({ is_recurring: true, is_detached: false });
    expect(byId.get(detached)).toMatchObject({ is_recurring: false, is_detached: true });
  });

  // ---- caps and honest totals ---------------------------------------

  it("caps each type INDEPENDENTLY, reports the total the predicate matched, and flags truncation", async () => {
    await app.db.insert(notes).values(
      Array.from({ length: 7 }, (_, index) => ({
        title: `capped widget ${index}`,
        body: "x",
        updatedAt: new Date(Date.UTC(2026, 7, index + 1)),
      })),
    );

    const body = await search({ q: "capped widget", limit: "3" });
    const [counted] = await app.db
      .select({ total: count() })
      .from(notes)
      .where(sql`${notes.title} ilike '%capped%' and ${notes.title} ilike '%widget%'`);
    const total = counted!.total;
    expect(body.counts.note).toEqual({ returned: 3, total });
    expect(total).toBe(7);
    expect(body.results).toHaveLength(3);
    expect(body.truncated).toBe(true);
    expect(body.limit).toBe(3);
  });

  it("the candidate cap does not lie about the total, and title-complete rows survive it", async () => {
    // More matching rows than SEARCH_CANDIDATE_CAP: the total is the SQL
    // count over the whole predicate, not the size of the candidate set, and
    // the one row whose TITLE carries every token is ranked into the response
    // even though recency alone would have left it outside the cap.
    const old = new Date("2025-01-01T00:00:00Z");
    await app.db.insert(notes).values(
      Array.from({ length: SEARCH_CANDIDATE_CAP + 5 }, (_, index) => ({
        title: `filler ${index}`,
        body: "overflow widget",
        updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)),
      })),
    );
    const [titled] = await app.db
      .insert(notes)
      .values({ title: "overflow widget", body: "x", updatedAt: old })
      .returning({ id: notes.id });

    const body = await search({ q: "overflow widget", limit: String(SEARCH_LIMIT_MAX) });
    expect(body.counts.note).toEqual({
      returned: SEARCH_LIMIT_MAX,
      total: SEARCH_CANDIDATE_CAP + 6,
    });
    expect(body.results[0]!.id).toBe(titled!.id);
  });

  it("truncated is false when nothing was cut", async () => {
    await app.db.insert(notes).values({ title: "single widget", body: "x" });
    const body = await search({ q: "widget", limit: "3" });
    expect(body.truncated).toBe(false);
  });

  it("VOLUME OF MAIL CANNOT EVICT A MATCHING NOTE (ADR-054's cap-mail-hardest rule)", async () => {
    const connectionId = await seedMailConnection();
    for (let index = 0; index < 12; index += 1) {
      await seedMail({
        connectionId,
        subject: `eviction widget ${index}`,
        internalDate: new Date(Date.UTC(2026, 7, index + 1)),
      });
    }
    await app.db.insert(notes).values({ title: "my own widget note", body: "x" });

    const body = await search({ q: "widget", limit: "2" });
    expect(body.counts.note).toEqual({ returned: 1, total: 1 });
    expect(body.counts.mail_message).toEqual({ returned: 2, total: 12 });
    expect(body.results[0]!.type).toBe("note");
  });

  // ---- output safety ------------------------------------------------

  it("an EXTERNAL event previews its location only; its description is matched and NEVER emitted", async () => {
    const passcode = "passcode-7Q9ZK-sentinel";
    const byDescription = await seedEvent({
      title: "Quarterly review",
      origin: "external",
      location: "Room 4",
      description: `Join with ${passcode}`,
    });
    const local = await seedEvent({
      title: "Quarterly planning",
      origin: "local",
      description: "bring the widget numbers",
    });

    const response = await get({ q: "quarterly" });
    expect(response.statusCode).toBe(200);
    const body = SearchResponseSchema.parse(response.json());
    const byId = new Map(ofType(body, "event").map((e) => [e.id, e]));
    expect(byId.get(byDescription)!.preview).toBe("Room 4");
    expect(byId.get(local)!.preview).toBe("bring the widget numbers");
    expect(response.body).not.toContain(passcode);

    // Matched through the description alone, so the row is found (the query
    // is a fragment of the sentinel, so its own echo cannot satisfy the
    // assertion below)...
    const found = await get({ q: "7Q9ZK" });
    const foundBody = SearchResponseSchema.parse(found.json());
    expect(idsOfType(foundBody, "event")).toEqual([byDescription]);
    expect(foundBody.results[0]!.match.fields).toEqual(["description"]);
    // ...and the sentinel still appears nowhere in the response.
    expect(found.body).not.toContain(passcode);
    expect(JSON.stringify(found.json())).not.toContain(passcode);
  });

  it("an external event with no location has a null preview, not its description", async () => {
    await seedEvent({ title: "Standup", origin: "external", description: "secret agenda" });
    const response = await get({ q: "standup" });
    expect(SearchResponseSchema.parse(response.json()).results[0]!.preview).toBeNull();
    expect(response.body).not.toContain("secret agenda");
  });

  it("returns mail METADATA ONLY -- no address, no domain, no body-shaped field", async () => {
    const connectionId = await seedMailConnection();
    await seedMail({
      connectionId,
      subject: "widget receipt",
      fromDisplayName: "Widget Co",
      fromAddress: "billing@widgetco.example",
      fromDomain: "widgetco.example",
      hasAttachment: true,
    });

    const response = await get({ q: "widget" });
    const result = SearchResponseSchema.parse(response.json()).results[0]!;
    expect(result.type).toBe("mail_message");
    expect(Object.keys(result).sort()).toEqual([
      "has_attachment",
      "id",
      "match",
      "preview",
      "score",
      "sender",
      "timestamp",
      "title",
      "type",
    ]);
    expect(response.body).not.toContain("billing@widgetco.example");
    expect(response.body).not.toContain("widgetco.example");
    expect(response.body).not.toContain("from_address");
    expect(response.body).not.toContain("from_domain");
    expect(response.body).not.toContain("snippet");
  });

  it("emits no internal identifier or operational column for any entity", async () => {
    const connectionId = await seedMailConnection();
    await seedTask({ title: "audit widget", body: "x", rrule: "FREQ=DAILY" });
    await app.db.insert(notes).values({ title: "audit widget", body: "x" });
    await seedEvent({
      title: "audit widget",
      origin: "external",
      externalId: "google-event-id-sentinel",
    });
    await seedProject({ name: "audit widget" });
    await app.db.insert(inboxItems).values({
      rawText: "audit widget",
      source: "web",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
      parseResult: { tool: "create_note" },
      confidence: 0.5,
      audioPath: "/tmp/personal-os-audio/secret.m4a",
    });
    await seedMail({ connectionId, subject: "audit widget" });

    const response = await get({ q: "audit widget" });
    expect(response.statusCode).toBe(200);
    for (const forbidden of [
      "connection_id",
      connectionId,
      "external_id",
      "external_etag",
      "external_source",
      "google-event-id-sentinel",
      "etag-sentinel",
      "client_uuid",
      "client-uuid-sentinel",
      "thread_id",
      "content_hash",
      "audio_path",
      "/tmp/personal-os-audio",
      "parse_result",
      "confidence",
      "provider_labels",
      "size_estimate",
      "push_token",
      "token_hash",
      "access_token",
      "ciphertext",
      "auth_tag",
      "secret",
      "password",
      "deleted_at",
      "rrule",
      "FREQ=DAILY",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("bounds an adversarially long mail subject rather than echoing it whole", async () => {
    const connectionId = await seedMailConnection();
    await seedMail({ connectionId, subject: `widget ${"x".repeat(5000)}` });
    const result = (await search({ q: "widget" })).results[0]!;
    expect(result.title.length).toBeLessThanOrEqual(160);
  });

  it("falls back to a readable label when a matched mail row has no subject", async () => {
    const connectionId = await seedMailConnection();
    await seedMail({ connectionId, subject: null, fromDisplayName: "Widget Co" });
    const result = (await search({ q: "widget" })).results[0]!;
    expect(result.title).toBe("(no subject)");
    expect(result.type === "mail_message" && result.sender).toBe("Widget Co");
  });

  it("exposes entity_type and entity_id so a committed capture can be navigated to", async () => {
    const task = await seedTask({ title: "committed widget" });
    await seedInbox({
      rawText: "committed widget capture",
      status: "confirmed",
      entityType: "task",
      entityId: task,
    });
    const body = await search({ q: "committed widget capture" });
    const result = ofType(body, "inbox_item")[0]!;
    expect(result.entity_type).toBe("task");
    expect(result.entity_id).toBe(task);
  });

  // ---- logging ------------------------------------------------------

  it("emits exactly one counts-only search.completed line, never the query or a title", async () => {
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink({
      write: (_level, record) => {
        records.push(record);
      },
    });
    try {
      await seedTask({ title: "Zanzibar widget" });
      await search({ q: "zanzibar widget september 2026", tz: TZ });
    } finally {
      restore();
    }
    const lines = records.filter((record) => record["event"] === "search.completed");
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toMatchObject({
      matchMode: "all_without_date",
      termCount: 3,
      dateFilter: true,
      dateDropped: true,
      countTask: 1,
      countNote: 0,
      countMailMessage: 0,
    });
    expect(typeof line["durationMs"]).toBe("number");
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("zanzibar");
    expect(serialized).not.toContain("Zanzibar");
    expect(serialized).not.toContain("september");
    expect(serialized).not.toContain("[redacted]");
    expect(serialized).not.toContain("[forbidden-field]");
  });
});

describe("GET /search/item", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  function get(params: Record<string, string>) {
    const query = new URLSearchParams(params);
    return app.inject({ method: "GET", url: `/search/item?${query.toString()}` });
  }

  it("returns a task's bounded context with itself as the only citation", async () => {
    const [project] = await app.db
      .insert(projects)
      .values({ name: "House" })
      .returning({ id: projects.id });
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: "Renew insurance",
        body: "call the broker",
        timezone: TZ,
        projectId: project!.id,
      })
      .returning({ id: tasks.id });

    const response = await get({ type: "task", id: task!.id });
    expect(response.statusCode).toBe(200);
    const context = ItemContextSchema.parse(response.json());
    expect(context).toMatchObject({
      type: "task",
      id: task!.id,
      title: "Renew insurance",
      body: "call the broker",
      body_truncated: false,
      status: "inbox",
      archived: false,
      origin: null,
      project_id: project!.id,
      citations: [{ type: "task", id: task!.id }],
    });
  });

  it("404s for an unknown id, for a known id under the wrong type, and 400s for a bad ref", async () => {
    const [note] = await app.db
      .insert(notes)
      .values({ title: "n", body: "b" })
      .returning({ id: notes.id });
    expect(
      (await get({ type: "note", id: "00000000-0000-4000-8000-000000000000" })).statusCode,
    ).toBe(404);
    const wrongType = await get({ type: "task", id: note!.id });
    expect(wrongType.statusCode).toBe(404);
    expect(wrongType.json<ErrorBody>().error).toBe("not_found");
    expect((await get({ type: "note", id: "not-a-uuid" })).statusCode).toBe(400);
    expect((await get({ type: "widget", id: note!.id })).statusCode).toBe(400);
    expect((await get({ type: "note", id: note!.id, extra: "1" })).statusCode).toBe(400);
  });

  it("bounds the body at ITEM_CONTEXT_BODY_MAX_CHARS after stripping control characters", async () => {
    const [note] = await app.db
      .insert(notes)
      .values({
        title: "Long",
        body: `\u202E${"a".repeat(ITEM_CONTEXT_BODY_MAX_CHARS)}\u200Btail`,
      })
      .returning({ id: notes.id });
    const context = ItemContextSchema.parse((await get({ type: "note", id: note!.id })).json());
    expect(context.body).toBe("a".repeat(ITEM_CONTEXT_BODY_MAX_CHARS));
    expect(context.body_truncated).toBe(true);
    expect(context.body).not.toContain("\u202E");
    expect(context.body).not.toContain("\u200B");
  });

  it("withholds an external event's description, returns a local one's, and carries origin", async () => {
    const [external] = await app.db
      .insert(events)
      .values({
        title: "Ext",
        origin: "external",
        description: "passcode-sentinel-1234",
        timezone: TZ,
        externalId: "ext-id-sentinel",
      })
      .returning({ id: events.id });
    const [local] = await app.db
      .insert(events)
      .values({ title: "Loc", origin: "local", description: "my agenda", timezone: TZ })
      .returning({ id: events.id });

    const ext = await get({ type: "event", id: external!.id });
    const extContext = ItemContextSchema.parse(ext.json());
    expect(extContext).toMatchObject({ body: null, body_truncated: false, origin: "external" });
    expect(ext.body).not.toContain("passcode-sentinel");
    expect(ext.body).not.toContain("ext-id-sentinel");
    expect(ext.body).not.toContain("external_id");

    const loc = ItemContextSchema.parse((await get({ type: "event", id: local!.id })).json());
    expect(loc).toMatchObject({ body: "my agenda", origin: "local" });
  });

  it("a mail message has no body, a project's body is its goal, an inbox item's is its capture", async () => {
    const [connection] = await app.db
      .insert(mailConnections)
      .values({ provider: "gmail", externalAccountId: "ctx@example.com", status: "active" })
      .returning({ id: mailConnections.id });
    const [mail] = await app.db
      .insert(mailMessages)
      .values({
        connectionId: connection!.id,
        externalId: "ctx-msg",
        threadId: "ctx-thread",
        internalDate: new Date("2026-08-01T12:00:00Z"),
        subject: "Receipt",
        fromAddress: "billing@widgetco.example",
        fromDomain: "widgetco.example",
        contentHash: "ctx-hash",
      })
      .returning({ id: mailMessages.id });
    const [project] = await app.db
      .insert(projects)
      .values({ name: "Garden", goal: "grow tomatoes" })
      .returning({ id: projects.id });
    const [capture] = await app.db
      .insert(inboxItems)
      .values({
        rawText: "buy seeds",
        source: "web",
        capturedAt: new Date("2026-08-01T10:00:00Z"),
        timezone: TZ,
        audioPath: "/tmp/personal-os-audio/secret.m4a",
      })
      .returning({ id: inboxItems.id });

    const mailResponse = await get({ type: "mail_message", id: mail!.id });
    expect(ItemContextSchema.parse(mailResponse.json())).toMatchObject({
      title: "Receipt",
      body: null,
    });
    expect(mailResponse.body).not.toContain("widgetco.example");
    expect(
      ItemContextSchema.parse((await get({ type: "project", id: project!.id })).json()),
    ).toMatchObject({ title: "Garden", body: "grow tomatoes", status: "active" });
    const captureResponse = await get({ type: "inbox_item", id: capture!.id });
    expect(ItemContextSchema.parse(captureResponse.json())).toMatchObject({
      title: "buy seeds",
      body: "buy seeds",
      status: "pending",
    });
    expect(captureResponse.body).not.toContain("audio_path");
    expect(captureResponse.body).not.toContain("/tmp/personal-os-audio");
  });
});
