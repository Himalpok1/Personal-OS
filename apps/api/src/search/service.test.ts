import { events, notes, tasks } from "@personal-os/db";
import {
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_RESULT_TYPE_ORDER,
  SearchResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_CANDIDATE_CAP } from "../read-models/search.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { getItemContext, searchPersonalItems } from "./service.js";

const TZ = "America/Chicago";

// The service seams the route cannot reach: the injected clock (recency and
// "today" for relative date words), `includeBody: false`, and the ladder's
// determinism as a function rather than as HTTP. Everything the wire contract
// promises is tested through the route in ../routes/search.test.ts.
describe("searchPersonalItems", () => {
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

  const base = { limit: 20, includeArchived: false, order: "score" as const };

  it("scores recency against the INJECTED clock, not the wall clock", async () => {
    const [row] = await app.db
      .insert(notes)
      .values({ title: "Widget", body: "x", updatedAt: new Date("2026-01-01T00:00:00Z") })
      .returning({ id: notes.id });

    const sameDay = await searchPersonalItems(app.db, {
      ...base,
      q: "widget",
      tz: null,
      now: new Date("2026-01-01T12:00:00Z"),
    });
    const aYearOn = await searchPersonalItems(app.db, {
      ...base,
      q: "widget",
      tz: null,
      now: new Date("2027-06-01T12:00:00Z"),
    });

    expect(sameDay.results[0]!.id).toBe(row!.id);
    const recency = (response: typeof sameDay) =>
      response.results[0]!.match.reasons.find((r) => r.code === "recency")!.points;
    expect(recency(sameDay)).toBe(20);
    expect(recency(aYearOn)).toBe(0);
    expect(sameDay.results[0]!.score - aYearOn.results[0]!.score).toBe(20);
  });

  it("resolves 'today' and 'tomorrow' from the injected clock in the caller's zone", async () => {
    // 03:00Z on the 15th is 22:00 on the 14th in Chicago: "today" from that
    // instant is the 14th, and a UTC slice would have said the 15th.
    const now = new Date("2026-09-15T03:00:00Z");
    const [today] = await app.db
      .insert(tasks)
      .values({ title: "Dentist", timezone: TZ, dueAt: new Date("2026-09-14T20:00:00Z") })
      .returning({ id: tasks.id });
    const [tomorrow] = await app.db
      .insert(tasks)
      .values({ title: "Dentist", timezone: TZ, dueAt: new Date("2026-09-15T20:00:00Z") })
      .returning({ id: tasks.id });

    const todayResponse = await searchPersonalItems(app.db, {
      ...base,
      q: "dentist today",
      tz: TZ,
      now,
    });
    expect(todayResponse.date_filter).toMatchObject({
      token: "today",
      kind: "day",
      from: "2026-09-14",
      to: "2026-09-14",
      tz: TZ,
      dropped: false,
    });
    expect(todayResponse.results.map((r) => r.id)).toEqual([today!.id]);

    const tomorrowResponse = await searchPersonalItems(app.db, {
      ...base,
      q: "dentist tomorrow",
      tz: TZ,
      now,
    });
    expect(tomorrowResponse.results.map((r) => r.id)).toEqual([tomorrow!.id]);
  });

  // Checkpoint 9.6 review: the service guards its own bounds so no caller can
  // reach the read model past what SearchQuerySchema would have refused.
  describe("input guards", () => {
    const now = new Date("2026-09-14T00:00:00Z");

    it("throws a RangeError for a query over SEARCH_QUERY_MAX_CHARS", async () => {
      await expect(
        searchPersonalItems(app.db, {
          ...base,
          q: "w".repeat(SEARCH_QUERY_MAX_CHARS + 1),
          tz: null,
          now,
        }),
      ).rejects.toThrow(RangeError);
    });

    it("throws a RangeError for a limit below 1, above SEARCH_LIMIT_MAX, or fractional", async () => {
      for (const limit of [0, -1, SEARCH_LIMIT_MAX + 1, 2.5]) {
        await expect(
          searchPersonalItems(app.db, { ...base, limit, q: "widget", tz: null, now }),
        ).rejects.toThrow(RangeError);
      }
      // The bounds themselves are legal.
      await expect(
        searchPersonalItems(app.db, { ...base, limit: 1, q: "widget", tz: null, now }),
      ).resolves.toBeDefined();
      await expect(
        searchPersonalItems(app.db, {
          ...base,
          limit: SEARCH_LIMIT_MAX,
          q: "widget",
          tz: null,
          now,
        }),
      ).resolves.toBeDefined();
    });

    it("treats an empty `types` as every type, not as none", async () => {
      await app.db.insert(tasks).values({ title: "Widget", timezone: TZ });
      await app.db.insert(notes).values({ title: "Widget", body: "x" });
      const response = await searchPersonalItems(app.db, {
        ...base,
        q: "widget",
        tz: null,
        types: [],
        now,
      });
      expect(response.results.map((r) => r.type).sort()).toEqual(["note", "task"]);
    });
  });

  it("a partial TITLE hit survives the candidate cap ahead of newer body-only rows", async () => {
    // Rung 1 needs both tokens somewhere in the row. SEARCH_CANDIDATE_CAP + 1
    // newer rows carry both in the BODY; one older row carries one in its
    // title. `title_all` is false for every row, so before the `title_any`
    // ORDER BY key recency alone filled the cap and the title hit -- which
    // the scorer ranks first (title_token 10 + boundary 4 against
    // body_token 3) -- was never scored at all.
    const now = new Date("2026-09-14T00:00:00Z");
    await app.db.insert(notes).values(
      Array.from({ length: SEARCH_CANDIDATE_CAP + 1 }, (_, index) => ({
        title: `filler ${index}`,
        body: "overflow widget",
        updatedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
      })),
    );
    const [partial] = await app.db
      .insert(notes)
      .values({
        title: "overflow report",
        body: "about the widget",
        updatedAt: new Date("2026-08-31T00:00:00Z"),
      })
      .returning({ id: notes.id });

    const response = await searchPersonalItems(app.db, {
      ...base,
      q: "overflow widget",
      tz: null,
      now,
    });
    expect(response.match_mode).toBe("all");
    expect(response.counts.note.total).toBe(SEARCH_CANDIDATE_CAP + 2);
    expect(response.results[0]!.id).toBe(partial!.id);
    expect(response.results[0]!.match.fields).toEqual(["title", "body"]);
  });

  it("a dropped date token earns no date_text on rung 3", async () => {
    // Rung 1 needs "dentist" AND "zzz" AND the date; rung 2 "dentist" AND
    // "zzz"; neither matches, so rung 3 ORs the text tokens and finds the
    // task. Its body contains the date WORD, but the date token was dropped
    // two rungs ago: a token the query no longer carries cannot score.
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: "Dentist",
        body: "reschedule in september",
        timezone: TZ,
        dueAt: new Date("2026-03-03T14:00:00Z"),
      })
      .returning({ id: tasks.id });

    const response = await searchPersonalItems(app.db, {
      ...base,
      q: "dentist zzz september 2026",
      tz: TZ,
      now: new Date("2026-09-14T00:00:00Z"),
    });
    expect(response.match_mode).toBe("any");
    expect(response.date_filter?.dropped).toBe(true);
    expect(response.results.map((r) => r.id)).toEqual([task!.id]);
    const codes = response.results[0]!.match.reasons.map((r) => r.code);
    expect(codes).not.toContain("date_text");
    expect(codes).not.toContain("date_window");
    expect(response.results[0]!.match.fields).toEqual(["title"]);
  });

  it("is deterministic across calls and parses through the frozen schema", async () => {
    await app.db.insert(notes).values([
      { title: "Widget a", body: "x" },
      { title: "Widget b", body: "x" },
    ]);
    const now = new Date("2026-09-14T00:00:00Z");
    const first = await searchPersonalItems(app.db, { ...base, q: "widget", tz: TZ, now });
    const second = await searchPersonalItems(app.db, { ...base, q: "widget", tz: TZ, now });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(SearchResponseSchema.parse(first)).toEqual(first);
  });

  it("types restricts the queries that run, and order=type groups in the frozen order", async () => {
    await app.db.insert(tasks).values({ title: "Widget", timezone: TZ });
    await app.db.insert(notes).values({ title: "Widget", body: "x" });
    await app.db.insert(events).values({ title: "Widget", origin: "local", timezone: TZ });

    const subset = await searchPersonalItems(app.db, {
      ...base,
      q: "widget",
      tz: null,
      types: ["event", "task"],
      order: "type",
    });
    expect(subset.results.map((r) => r.type)).toEqual(["task", "event"]);
    expect(subset.counts.note).toEqual({ returned: 0, total: 0 });

    const all = await searchPersonalItems(app.db, {
      ...base,
      q: "widget",
      tz: null,
      order: "type",
    });
    const positions = all.results.map((r) => SEARCH_RESULT_TYPE_ORDER.indexOf(r.type));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("getItemContext", () => {
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

  it("includeBody: false returns the item with a null, untruncated body", async () => {
    const [row] = await app.db
      .insert(notes)
      .values({ title: "Roof", body: "long body ".repeat(300) })
      .returning({ id: notes.id });
    const context = await getItemContext(
      app.db,
      { type: "note", id: row!.id },
      { includeBody: false },
    );
    expect(context).toMatchObject({
      type: "note",
      id: row!.id,
      title: "Roof",
      body: null,
      body_truncated: false,
      citations: [{ type: "note", id: row!.id }],
    });
  });

  it("returns null for an unknown id", async () => {
    expect(
      await getItemContext(
        app.db,
        { type: "task", id: "00000000-0000-4000-8000-000000000000" },
        { includeBody: true },
      ),
    ).toBeNull();
  });

  it("falls back to a readable title for a row whose title strips to nothing", async () => {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "\u202E\u200B", body: "x", timezone: TZ })
      .returning({ id: tasks.id });
    const context = await getItemContext(
      app.db,
      { type: "task", id: row!.id },
      { includeBody: true },
    );
    expect(context?.title).toBe("(untitled task)");
  });
});
