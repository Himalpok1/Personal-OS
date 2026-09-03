import { inboxItems, mailConnections, mailMessages, notes, tasks } from "@personal-os/db";
import {
  SEARCH_LIMIT_MAX,
  SearchResponseSchema,
  type SearchResponse,
  type SearchResult,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

const TZ = "America/Chicago";

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

  function idsOfType(body: SearchResponse, type: SearchResult["type"]): string[] {
    return body.results.filter((result) => result.type === type).map((result) => result.id);
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
    // "  a  " is 5 raw characters and 1 normalized one. Checking the raw length
    // would let it through; the schema normalizes first, on purpose.
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
    // And an absurd one is refused by the raw bound before normalization runs.
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
    // booleanQueryParam, not z.coerce.boolean() -- "no" is neither of the two
    // accepted representations.
    expect((await get({ q: "rent", include_archived: "no" })).statusCode).toBe(400);
    expect((await get({ q: "rent", include_archived: "false" })).statusCode).toBe(200);
    expect((await get({ q: "rent", include_archived: "true" })).statusCode).toBe(200);
  });

  it("returns an honest empty response for an empty database", async () => {
    const body = await search({ q: "anything" });
    expect(body.results).toEqual([]);
    expect(body.truncated).toBe(false);
    expect(body.query).toBe("anything");
    for (const counts of Object.values(body.counts)) {
      expect(counts).toEqual({ returned: 0, total: 0 });
    }
  });

  it("echoes the NORMALIZED query, not the raw one", async () => {
    const body = await search({ q: "  rent   due  " });
    expect(body.query).toBe("rent due");
  });

  // ---- matching ----------------------------------------------------

  it("matches a task title", async () => {
    await app.db.insert(tasks).values({ title: "Renew the insurance", timezone: TZ });
    const body = await search({ q: "insurance" });
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
    expect(body.results[0]!.title).toBe("Renew the insurance");
  });

  it("matches a task body", async () => {
    await app.db
      .insert(tasks)
      .values({ title: "Errand", body: "pick up the parcel", timezone: TZ });
    const body = await search({ q: "parcel" });
    expect(body.counts.task.total).toBe(1);
    expect(body.results[0]!.preview).toBe("pick up the parcel");
  });

  it("matches a note title and a note body", async () => {
    await app.db.insert(notes).values({ title: "Roof quote", body: "unrelated" });
    await app.db.insert(notes).values({ title: "unrelated", body: "the roof needs work" });
    const body = await search({ q: "roof" });
    expect(body.counts.note).toEqual({ returned: 2, total: 2 });
  });

  it("matches inbox raw_text", async () => {
    await app.db.insert(inboxItems).values({
      rawText: "remind me to call the plumber",
      source: "siri",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
    });
    const body = await search({ q: "plumber" });
    expect(body.counts.inbox_item.total).toBe(1);
    expect(body.results[0]!.type).toBe("inbox_item");
  });

  it("never matches an inbox row whose transcript does not exist yet", async () => {
    // raw_text is nullable because a push-to-talk capture is written before its
    // transcript. NULL ILIKE x is NULL, so it cannot match -- and nothing
    // coalesces it into an empty string that a "%%" pattern would hit.
    await app.db.insert(inboxItems).values({
      rawText: null,
      source: "ptt",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
    });
    const body = await search({ q: "anything" });
    expect(body.counts.inbox_item.total).toBe(0);
  });

  it("matches a mail subject and a mail display name", async () => {
    const connectionId = await seedMailConnection();
    await seedMail({ connectionId, subject: "Your flight to Denver" });
    await seedMail({ connectionId, subject: "unrelated", fromDisplayName: "Denver Water" });
    const body = await search({ q: "denver" });
    expect(body.counts.mail_message).toEqual({ returned: 2, total: 2 });
  });

  it("is case-insensitive across every entity", async () => {
    const connectionId = await seedMailConnection();
    await app.db.insert(tasks).values({ title: "INSURANCE renewal", timezone: TZ });
    await app.db.insert(notes).values({ title: "Insurance", body: "x" });
    await app.db.insert(inboxItems).values({
      rawText: "insurance",
      source: "web",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
    });
    await seedMail({ connectionId, subject: "InSuRaNcE" });

    const body = await search({ q: "iNsUrAnCe" });
    expect(body.results).toHaveLength(4);
  });

  it("returns results from every entity in one response", async () => {
    const connectionId = await seedMailConnection();
    await app.db.insert(tasks).values({ title: "zebra task", timezone: TZ });
    await app.db.insert(notes).values({ title: "zebra note", body: "x" });
    await app.db.insert(inboxItems).values({
      rawText: "zebra capture",
      source: "web",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
    });
    await seedMail({ connectionId, subject: "zebra mail" });

    const body = await search({ q: "zebra" });
    expect(body.results.map((result) => result.type)).toEqual([
      "task",
      "note",
      "inbox_item",
      "mail_message",
    ]);
  });

  // ---- wildcard and injection safety -------------------------------

  it("treats a literal % as text, not as a match-everything wildcard", async () => {
    await app.db.insert(tasks).values({ title: "50% off coupon", timezone: TZ });
    // The DECOY is what gives this test teeth, and mutation testing is what
    // proved it was needed: with only an unrelated second row, the unescaped
    // pattern "%50%%" still matched exactly one row and the test passed while
    // escaping was disabled. This row contains "50" but no percent sign, so it
    // matches the unescaped pattern and not the escaped one.
    await app.db.insert(tasks).values({ title: "50 percent off, spelled out", timezone: TZ });
    await app.db.insert(tasks).values({ title: "nothing relevant here", timezone: TZ });

    const body = await search({ q: "50%" });
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
    expect(body.results[0]!.title).toBe("50% off coupon");
  });

  it("a bare % query does not dump every row in every table", async () => {
    const connectionId = await seedMailConnection();
    await app.db.insert(tasks).values({ title: "no percent sign", timezone: TZ });
    await app.db.insert(notes).values({ title: "none here", body: "nor here" });
    await seedMail({ connectionId, subject: "clean subject" });

    const body = await search({ q: "%%" });
    expect(body.results).toEqual([]);
    expect(body.counts.task.total).toBe(0);
    expect(body.counts.note.total).toBe(0);
    expect(body.counts.mail_message.total).toBe(0);
  });

  it("treats a literal _ as text, not as a single-character wildcard", async () => {
    await app.db.insert(tasks).values({ title: "file_name convention", timezone: TZ });
    await app.db.insert(tasks).values({ title: "fileXname convention", timezone: TZ });

    const body = await search({ q: "file_name" });
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
    expect(body.results[0]!.title).toBe("file_name convention");
  });

  it("treats a literal backslash as text", async () => {
    await app.db.insert(tasks).values({ title: "path C:\\temp\\notes", timezone: TZ });
    await app.db.insert(tasks).values({ title: "path C:temp", timezone: TZ });

    const body = await search({ q: "C:\\temp" });
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
  });

  it("a backslash-percent query does not escape into a wildcard", async () => {
    await app.db
      .insert(tasks)
      .values({ title: "literal backslash-percent \\% here", timezone: TZ });
    await app.db.insert(tasks).values({ title: "unrelated row", timezone: TZ });

    const body = await search({ q: "\\%" });
    expect(body.counts.task).toEqual({ returned: 1, total: 1 });
  });

  it("SQL-shaped input is matched as text and changes nothing", async () => {
    await app.db.insert(tasks).values({ title: "keep me", timezone: TZ });
    await app.db.insert(notes).values({ title: "keep me too", body: "x" });

    for (const q of [
      "'; drop table tasks; --",
      "' or '1'='1",
      "1; delete from notes where 1=1; --",
      "*/ union select null,null --",
    ]) {
      const response = await get({ q });
      expect(response.statusCode).toBe(200);
      expect(SearchResponseSchema.parse(response.json()).results).toEqual([]);
    }

    // The tables are still there with their rows -- the strongest available
    // assertion that nothing was executed.
    expect(await app.db.select().from(tasks)).toHaveLength(1);
    expect(await app.db.select().from(notes)).toHaveLength(1);
  });

  // ---- archive / lifecycle policy ----------------------------------

  it("excludes archived tasks and notes by default, and includes them on request", async () => {
    const archivedAt = new Date("2026-08-01T00:00:00Z");
    await app.db.insert(tasks).values({ title: "archived widget", timezone: TZ, archivedAt });
    await app.db.insert(notes).values({ title: "archived widget", body: "x", archivedAt });

    const hidden = await search({ q: "widget" });
    expect(hidden.results).toEqual([]);

    const shown = await search({ q: "widget", include_archived: "true" });
    expect(shown.results).toHaveLength(2);
    expect(shown.results.every((result) => "archived" in result && result.archived)).toBe(true);
  });

  it("includes done and dropped tasks -- a finished task is still stored content", async () => {
    await app.db.insert(tasks).values({ title: "finished widget", timezone: TZ, status: "done" });
    await app.db
      .insert(tasks)
      .values({ title: "abandoned widget", timezone: TZ, status: "dropped" });

    const body = await search({ q: "widget" });
    expect(body.counts.task.total).toBe(2);
    expect(body.results.map((result) => "status" in result && result.status).sort()).toEqual([
      "done",
      "dropped",
    ]);
  });

  it("excludes provider-tombstoned mail, and include_archived does NOT resurrect it", async () => {
    // deleted_at is upstream reconciliation, not a user archive, so the user's
    // archive flag has no business toggling it.
    const connectionId = await seedMailConnection();
    await seedMail({
      connectionId,
      subject: "tombstoned widget",
      deletedAt: new Date("2026-08-02T00:00:00Z"),
    });

    expect((await search({ q: "widget" })).counts.mail_message.total).toBe(0);
    expect(
      (await search({ q: "widget", include_archived: "true" })).counts.mail_message.total,
    ).toBe(0);
  });

  // ---- ordering, caps and honest totals ----------------------------

  it("orders within a type by recency descending", async () => {
    await app.db.insert(notes).values({
      title: "older widget",
      body: "x",
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    });
    await app.db.insert(notes).values({
      title: "newer widget",
      body: "x",
      updatedAt: new Date("2026-08-05T00:00:00Z"),
    });

    const body = await search({ q: "widget" });
    expect(body.results.map((result) => result.title)).toEqual(["newer widget", "older widget"]);
  });

  it("breaks a timestamp tie by id ascending, deterministically across requests", async () => {
    // Two rows CAN share a timestamp: Checkpoint 8.2 ingested 98 calendar
    // events sharing one created_at to the microsecond.
    const updatedAt = new Date("2026-08-03T00:00:00Z");
    await app.db.insert(notes).values([
      { title: "tie widget a", body: "x", updatedAt },
      { title: "tie widget b", body: "x", updatedAt },
      { title: "tie widget c", body: "x", updatedAt },
    ]);

    const first = await search({ q: "tie widget" });
    const second = await search({ q: "tie widget" });
    const ids = idsOfType(first, "note");

    expect(ids).toEqual([...ids].sort());
    expect(idsOfType(second, "note")).toEqual(ids);
  });

  it("caps each type INDEPENDENTLY and reports honest totals", async () => {
    await app.db.insert(notes).values(
      Array.from({ length: 7 }, (_, index) => ({
        title: `capped widget ${index}`,
        body: "x",
        updatedAt: new Date(Date.UTC(2026, 7, index + 1)),
      })),
    );

    const body = await search({ q: "capped widget", limit: "3" });
    expect(body.counts.note).toEqual({ returned: 3, total: 7 });
    expect(body.results).toHaveLength(3);
    expect(body.truncated).toBe(true);
    expect(body.limit).toBe(3);
  });

  it("truncated is false when nothing was cut", async () => {
    await app.db.insert(notes).values({ title: "single widget", body: "x" });
    const body = await search({ q: "widget", limit: "3" });
    expect(body.truncated).toBe(false);
  });

  it("VOLUME OF MAIL CANNOT EVICT A MATCHING NOTE (ADR-054's cap-mail-hardest rule)", async () => {
    // The failure this prevents: with one shared budget, a third party who
    // sends enough mail decides how much of the user's own content they get
    // back from their own search.
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
    // The note is present AND ahead of the mail, both by contract.
    expect(body.results[0]!.type).toBe("note");
  });

  // ---- output safety ------------------------------------------------

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
      "preview",
      "sender",
      "timestamp",
      "title",
      "type",
    ]);
    // Stored, deliberately never emitted.
    expect(response.body).not.toContain("billing@widgetco.example");
    expect(response.body).not.toContain("widgetco.example");
    expect(response.body).not.toContain("from_address");
    expect(response.body).not.toContain("from_domain");
    expect(response.body).not.toContain("body");
    expect(response.body).not.toContain("snippet");
  });

  it("emits no internal identifier or operational column for any entity", async () => {
    const connectionId = await seedMailConnection();
    await app.db.insert(tasks).values({
      title: "audit widget",
      body: "x",
      timezone: TZ,
      rrule: "FREQ=DAILY",
      recurrenceAnchor: "due_date",
    });
    await app.db.insert(notes).values({ title: "audit widget", body: "x" });
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
    for (const forbidden of [
      "connection_id",
      connectionId,
      "external_id",
      "thread_id",
      "content_hash",
      "client_uuid",
      "audio_path",
      "/tmp/personal-os-audio",
      "parse_result",
      "confidence",
      "provider_labels",
      "size_estimate",
      "token",
      "ciphertext",
      "auth_tag",
      "secret",
      "password",
      "deleted_at",
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
    const [task] = await app.db
      .insert(tasks)
      .values({ title: "committed widget", timezone: TZ })
      .returning({ id: tasks.id });
    await app.db.insert(inboxItems).values({
      rawText: "committed widget capture",
      source: "web",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
      status: "confirmed",
      entityType: "task",
      entityId: task!.id,
    });

    const body = await search({ q: "committed widget capture" });
    const result = body.results.find((item) => item.type === "inbox_item")!;
    expect(result.type === "inbox_item" && result.entity_type).toBe("task");
    expect(result.type === "inbox_item" && result.entity_id).toBe(task!.id);
  });
});
