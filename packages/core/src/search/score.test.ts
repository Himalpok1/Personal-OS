import { describe, expect, it } from "vitest";
import {
  RECENCY_POINTS_BY_AGE,
  SEARCH_MATCH_FIELDS,
  SEARCH_SCORE_CODES,
  SEARCH_SCORE_TYPE_ORDER,
  SEARCH_SCORE_WEIGHTS,
  TITLE_TOKEN_BOUNDARY_BONUS,
  TITLE_TOKEN_TOTAL_CAP,
  TYPE_PRIOR_POINTS,
  compareScored,
  matchesAtWordBoundary,
  normalizeForMatch,
  recencyPoints,
  scoreCandidate,
} from "./score.js";
import type { ScoreInput, ScoredRef, SearchScoreCode } from "./score.js";
import { tokenizeSearchQuery } from "./tokenize.js";
import type { TokenizeOptions, TokenizedQuery } from "./tokenize.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const TZ: TokenizeOptions = { tz: "America/Chicago", today: "2026-09-14" };
const NO_TZ: TokenizeOptions = { tz: null, today: null };

function query(text: string, options: TokenizeOptions = NO_TZ): TokenizedQuery {
  return tokenizeSearchQuery(text, options);
}

function candidate(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    type: "task",
    id: "11111111-1111-4111-8111-111111111111",
    title: "Pay rent",
    secondary: [],
    body: null,
    // Two hours old: the top recency rung, so recency is a known +20.
    timestamp: new Date("2026-09-14T10:00:00.000Z"),
    fieldNames: { title: "title", body: "body" },
    flags: { archived: false, done: false, completedProject: false, externalEvent: false },
    dateWindowHit: null,
    dateTextHit: false,
    ...overrides,
  };
}

function points(reasons: { code: SearchScoreCode; points: number }[], code: SearchScoreCode) {
  return reasons.filter((r) => r.code === code).map((r) => r.points);
}

function scoreOf(input: ScoreInput, q: TokenizedQuery): number {
  return scoreCandidate(input, q, NOW).score;
}

describe("the weight table", () => {
  it("carries the contract's exact points", () => {
    expect(SEARCH_SCORE_WEIGHTS).toEqual({
      title_exact: 100,
      title_prefix: 60,
      title_phrase: 40,
      title_all_tokens: 30,
      title_token: 10,
      secondary_token: 6,
      body_token: 3,
      date_window: 25,
      date_text: 5,
      recency: 20,
      type_prior: 0,
      penalty_done: -15,
      penalty_archived: -25,
      penalty_completed_project: -10,
      penalty_external_event: -5,
    });
    expect(TITLE_TOKEN_BOUNDARY_BONUS).toBe(4);
    expect(TITLE_TOKEN_TOTAL_CAP).toBe(80);
    expect(RECENCY_POINTS_BY_AGE.map((r) => r.points)).toEqual([20, 16, 12, 8, 4, 0]);
    expect(TYPE_PRIOR_POINTS).toEqual({
      task: 0,
      note: 0,
      event: 0,
      project: 0,
      inbox_item: -2,
      mail_message: -10,
    });
  });

  it("is frozen and keyed by every code exactly once", () => {
    expect(Object.isFrozen(SEARCH_SCORE_WEIGHTS)).toBe(true);
    expect(Object.keys(SEARCH_SCORE_WEIGHTS).sort()).toEqual([...SEARCH_SCORE_CODES].sort());
    expect(new Set(SEARCH_SCORE_CODES).size).toBe(SEARCH_SCORE_CODES.length);
  });

  it("every weight is an integer", () => {
    for (const value of Object.values(SEARCH_SCORE_WEIGHTS))
      expect(Number.isInteger(value)).toBe(true);
  });

  it("the vocabularies are the six types and nine fields the wire contract names", () => {
    expect(SEARCH_SCORE_TYPE_ORDER).toEqual([
      "task",
      "note",
      "event",
      "project",
      "inbox_item",
      "mail_message",
    ]);
    expect([...SEARCH_MATCH_FIELDS]).toEqual([
      "title",
      "body",
      "location",
      "description",
      "raw_text",
      "subject",
      "sender",
      "goal",
      "date",
    ]);
  });
});

describe("normalizeForMatch / matchesAtWordBoundary", () => {
  it("applies NFKC and lowercases, keeping diacritics", () => {
    expect(normalizeForMatch("Ｒｅｎｔ Café")).toBe("rent café");
  });

  it("folds U+0130 to a plain 'i', matching what Postgres ILIKE already matched", () => {
    // JS's own toLowerCase gives "i" + U+0307 here, which `includes("istanbul")`
    // rejects -- so a row ILIKE '%istanbul%' found would have scored nothing.
    expect(normalizeForMatch("\u0130stanbul")).toBe("istanbul");
    expect(normalizeForMatch("I\u0307stanbul")).toBe("istanbul");
  });

  it("finds a token at the start, after a space and after punctuation, but not inside a word", () => {
    expect(matchesAtWordBoundary("rent due", "rent")).toBe(true);
    expect(matchesAtWordBoundary("pay rent", "rent")).toBe(true);
    expect(matchesAtWordBoundary("pay (rent)", "rent")).toBe(true);
    expect(matchesAtWordBoundary("pay-rent", "rent")).toBe(true);
    expect(matchesAtWordBoundary("parent", "rent")).toBe(false);
    expect(matchesAtWordBoundary("x1rent", "rent")).toBe(false);
    expect(matchesAtWordBoundary("érent", "rent")).toBe(false);
  });

  it("escapes regex metacharacters in the token", () => {
    expect(matchesAtWordBoundary("cost 50", "50")).toBe(true);
    // Unescaped, "a+b" would be the pattern /a+b/ and match "ab" but not "a+b".
    expect(matchesAtWordBoundary("use a+b", "a+b")).toBe(true);
    expect(matchesAtWordBoundary("use ab", "a+b")).toBe(false);
  });
});

describe("recencyPoints", () => {
  it("steps down the ladder at the exact boundaries", () => {
    const day = 86_400_000;
    const at = (ms: number) => recencyPoints(new Date(NOW.getTime() - ms), NOW);
    expect(at(0)).toBe(20);
    expect(at(day - 1)).toBe(20);
    expect(at(day)).toBe(16);
    expect(at(7 * day - 1)).toBe(16);
    expect(at(7 * day)).toBe(12);
    expect(at(30 * day - 1)).toBe(12);
    expect(at(30 * day)).toBe(8);
    expect(at(90 * day - 1)).toBe(8);
    expect(at(90 * day)).toBe(4);
    expect(at(365 * day - 1)).toBe(4);
    expect(at(365 * day)).toBe(0);
    expect(at(10_000 * day)).toBe(0);
  });

  it("treats a future timestamp as under a day old", () => {
    expect(recencyPoints(new Date("2030-01-01T00:00:00Z"), NOW)).toBe(20);
  });
});

describe("scoreCandidate -- each code fires with its exact points", () => {
  it("title_exact", () => {
    const result = scoreCandidate(candidate({ title: "Pay Rent" }), query("pay rent"), NOW);
    expect(points(result.reasons, "title_exact")).toEqual([100]);
    expect(points(result.reasons, "title_prefix")).toEqual([]);
    expect(points(result.reasons, "title_phrase")).toEqual([]);
  });

  it("title_prefix, exclusive of exact and phrase", () => {
    const result = scoreCandidate(
      candidate({ title: "Pay rent by Friday" }),
      query("pay rent"),
      NOW,
    );
    expect(points(result.reasons, "title_prefix")).toEqual([60]);
    expect(points(result.reasons, "title_exact")).toEqual([]);
    expect(points(result.reasons, "title_phrase")).toEqual([]);
  });

  it("title_phrase, exclusive of prefix", () => {
    const result = scoreCandidate(
      candidate({ title: "Remember to pay rent" }),
      query("pay rent"),
      NOW,
    );
    expect(points(result.reasons, "title_phrase")).toEqual([40]);
    expect(points(result.reasons, "title_prefix")).toEqual([]);
  });

  it("title_all_tokens, without a phrase hit when the tokens are out of order", () => {
    const result = scoreCandidate(candidate({ title: "Rent: pay it" }), query("pay rent"), NOW);
    expect(points(result.reasons, "title_all_tokens")).toEqual([30]);
    expect(points(result.reasons, "title_phrase")).toEqual([]);
    expect(points(result.reasons, "title_token")).toEqual([14, 14]);
  });

  it("title_token: 10 inside a word, 14 at a word boundary, carrying the token", () => {
    const result = scoreCandidate(
      candidate({ title: "Parent meeting" }),
      query("rent meeting"),
      NOW,
    );
    expect(result.reasons.filter((r) => r.code === "title_token")).toEqual([
      { code: "title_token", points: 10, token: "rent" },
      { code: "title_token", points: 14, token: "meeting" },
    ]);
  });

  it("title_token: the sum is capped at 80 and the crossing reason is clamped", () => {
    const words = ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh"];
    const q = query(words.join(" "));
    expect(q.tokens).toHaveLength(8);
    const result = scoreCandidate(candidate({ title: words.join(" ") }), q, NOW);
    const titleTokens = points(result.reasons, "title_token");
    // 5 x 14 = 70, the sixth is clamped to 10, the last two earn nothing.
    expect(titleTokens).toEqual([14, 14, 14, 14, 14, 10]);
    expect(titleTokens.reduce((a, b) => a + b, 0)).toBe(TITLE_TOKEN_TOTAL_CAP);
  });

  it("secondary_token: 6 per token, once even when two secondary strings match", () => {
    const result = scoreCandidate(
      candidate({
        type: "event",
        title: "Dentist",
        secondary: ["Main Street clinic", "street"],
        fieldNames: { title: "title", secondary: "location", body: "description" },
      }),
      query("street"),
      NOW,
    );
    expect(result.reasons.filter((r) => r.code === "secondary_token")).toEqual([
      { code: "secondary_token", points: 6, token: "street" },
    ]);
    expect(result.fields).toEqual(["location"]);
  });

  it("body_token: 3 per token", () => {
    const result = scoreCandidate(
      candidate({ title: "Chores", body: "water the plants and pay rent" }),
      query("plants rent"),
      NOW,
    );
    expect(result.reasons.filter((r) => r.code === "body_token")).toEqual([
      { code: "body_token", points: 3, token: "plants" },
      { code: "body_token", points: 3, token: "rent" },
    ]);
    expect(result.fields).toEqual(["body"]);
  });

  it("a token can hit title, secondary and body at once and earn all three", () => {
    const result = scoreCandidate(
      candidate({
        type: "event",
        title: "Rent review",
        secondary: ["Rent office"],
        body: "about the rent",
        fieldNames: { title: "title", secondary: "location", body: "description" },
      }),
      query("rent"),
      NOW,
    );
    expect(points(result.reasons, "title_token")).toEqual([14]);
    expect(points(result.reasons, "secondary_token")).toEqual([6]);
    expect(points(result.reasons, "body_token")).toEqual([3]);
    expect(result.fields).toEqual(["title", "location", "description"]);
  });

  it("date_window: +25 with field 'date' when SQL reported a window hit", () => {
    const q = query("rent october", TZ);
    const result = scoreCandidate(candidate({ dateWindowHit: true }), q, NOW);
    expect(result.reasons.filter((r) => r.code === "date_window")).toEqual([
      { code: "date_window", points: 25, token: "october" },
    ]);
    expect(result.fields).toContain("date");
  });

  it("date_window does not fire on false or null", () => {
    const q = query("rent october", TZ);
    expect(
      points(scoreCandidate(candidate({ dateWindowHit: false }), q, NOW).reasons, "date_window"),
    ).toEqual([]);
    expect(
      points(scoreCandidate(candidate({ dateWindowHit: null }), q, NOW).reasons, "date_window"),
    ).toEqual([]);
  });

  it("date_text: +5, labelling the field the date word was found in", () => {
    const q = query("october", TZ);
    const result = scoreCandidate(
      candidate({ title: "October plans", dateTextHit: true, dateWindowHit: false }),
      q,
      NOW,
    );
    expect(result.reasons.filter((r) => r.code === "date_text")).toEqual([
      { code: "date_text", points: 5, token: "october" },
    ]);
    expect(result.fields).toEqual(["title"]);
  });

  it("date_text with the hit in a column the scorer was not given labels no field", () => {
    const q = query("october", TZ);
    const result = scoreCandidate(candidate({ title: "Plans", dateTextHit: true }), q, NOW);
    expect(points(result.reasons, "date_text")).toEqual([5]);
    expect(result.fields).toEqual([]);
  });

  it("date codes never fire without a date token, whatever the flags say", () => {
    const result = scoreCandidate(
      candidate({ dateWindowHit: true, dateTextHit: true }),
      query("rent"),
      NOW,
    );
    expect(points(result.reasons, "date_window")).toEqual([]);
    expect(points(result.reasons, "date_text")).toEqual([]);
  });

  it("recency and type_prior are always emitted, even at zero points", () => {
    const result = scoreCandidate(
      candidate({ title: "zzz", timestamp: new Date("2020-01-01T00:00:00Z") }),
      query("rent"),
      NOW,
    );
    expect(result.reasons).toEqual([
      { code: "recency", points: 0 },
      { code: "type_prior", points: 0 },
    ]);
    expect(result.score).toBe(0);
    expect(result.fields).toEqual([]);
  });

  it("type_prior per type", () => {
    for (const type of SEARCH_SCORE_TYPE_ORDER) {
      const result = scoreCandidate(candidate({ type, title: "zzz" }), query("rent"), NOW);
      expect(points(result.reasons, "type_prior"), type).toEqual([TYPE_PRIOR_POINTS[type]]);
    }
  });

  it("penalties fire individually with exact points", () => {
    const q = query("rent");
    const done = scoreCandidate(candidate({ flags: { ...candidate().flags, done: true } }), q, NOW);
    expect(points(done.reasons, "penalty_done")).toEqual([-15]);
    const archived = scoreCandidate(
      candidate({ flags: { ...candidate().flags, archived: true } }),
      q,
      NOW,
    );
    expect(points(archived.reasons, "penalty_archived")).toEqual([-25]);
    const completed = scoreCandidate(
      candidate({ type: "project", flags: { ...candidate().flags, completedProject: true } }),
      q,
      NOW,
    );
    expect(points(completed.reasons, "penalty_completed_project")).toEqual([-10]);
    const external = scoreCandidate(
      candidate({ type: "event", flags: { ...candidate().flags, externalEvent: true } }),
      q,
      NOW,
    );
    expect(points(external.reasons, "penalty_external_event")).toEqual([-5]);
  });

  it("penalties stack", () => {
    const result = scoreCandidate(
      candidate({
        title: "zzz",
        timestamp: new Date("2020-01-01T00:00:00Z"),
        flags: { archived: true, done: true, completedProject: true, externalEvent: true },
      }),
      query("rent"),
      NOW,
    );
    expect(result.score).toBe(-15 - 25 - 10 - 5);
  });
});

describe("scoreCandidate -- invariants", () => {
  const FIXTURES: ScoreInput[] = [
    candidate(),
    candidate({ title: "Pay rent by Friday", body: "rent is due" }),
    candidate({
      type: "mail_message",
      title: "Rent receipt",
      secondary: ["Landlord Co"],
      fieldNames: { title: "subject", secondary: "sender" },
      timestamp: new Date("2026-01-01T00:00:00Z"),
    }),
    candidate({
      type: "inbox_item",
      title: "pay rent tomorrow",
      fieldNames: { title: "raw_text" },
      dateWindowHit: true,
      dateTextHit: true,
    }),
    candidate({
      type: "event",
      title: "Rent review",
      secondary: ["Office"],
      body: "the rent",
      fieldNames: { title: "title", secondary: "location", body: "description" },
      flags: { archived: true, done: false, completedProject: false, externalEvent: true },
      dateWindowHit: false,
    }),
  ];
  const QUERIES = [query("rent"), query("pay rent"), query("rent tomorrow", TZ), query("zzz")];

  it("score is an integer equal to the sum of the reason points", () => {
    for (const input of FIXTURES) {
      for (const q of QUERIES) {
        const result = scoreCandidate(input, q, NOW);
        expect(Number.isInteger(result.score)).toBe(true);
        expect(result.score).toBe(result.reasons.reduce((sum, r) => sum + r.points, 0));
      }
    }
  });

  it("every reason code is in the closed vocabulary and only per-token codes carry a token", () => {
    const perToken = new Set([
      "title_token",
      "secondary_token",
      "body_token",
      "date_window",
      "date_text",
    ]);
    for (const input of FIXTURES) {
      for (const q of QUERIES) {
        for (const reason of scoreCandidate(input, q, NOW).reasons) {
          expect(SEARCH_SCORE_CODES).toContain(reason.code);
          expect("token" in reason).toBe(perToken.has(reason.code));
        }
      }
    }
  });

  it("fields are drawn from the closed vocabulary, unique, in canonical order", () => {
    for (const input of FIXTURES) {
      for (const q of QUERIES) {
        const { fields } = scoreCandidate(input, q, NOW);
        expect(new Set(fields).size).toBe(fields.length);
        const indices = fields.map((f) => SEARCH_MATCH_FIELDS.indexOf(f));
        expect(indices.every((i) => i >= 0)).toBe(true);
        expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      }
    }
  });

  it("uses the api's field names, so a mail subject hit is labelled 'subject' and a capture 'raw_text'", () => {
    const mail = scoreCandidate(FIXTURES[2] as ScoreInput, query("rent landlord"), NOW);
    expect(mail.fields).toEqual(["subject", "sender"]);
    const inbox = scoreCandidate(FIXTURES[3] as ScoreInput, query("rent"), NOW);
    expect(inbox.fields).toEqual(["raw_text"]);
  });

  it("matches stored text after NFKC + lowercase, keeping diacritics", () => {
    const q = query("café");
    expect(
      points(scoreCandidate(candidate({ title: "CAFÉ" }), q, NOW).reasons, "title_exact"),
    ).toEqual([100]);
    expect(
      points(scoreCandidate(candidate({ title: "Ｃａｆé" }), q, NOW).reasons, "title_exact"),
    ).toEqual([100]);
    expect(
      points(scoreCandidate(candidate({ title: "cafe" }), q, NOW).reasons, "title_exact"),
    ).toEqual([]);
  });

  it("scores a title_token for 'İstanbul' against the query 'istanbul'", () => {
    const q = query("\u0130stanbul");
    expect(q.tokens).toEqual([{ kind: "text", value: "istanbul" }]);
    const result = scoreCandidate(candidate({ title: "\u0130stanbul trip" }), q, NOW);
    expect(result.reasons).toContainEqual({ code: "title_token", points: 14, token: "istanbul" });
    expect(points(result.reasons, "title_prefix")).toEqual([60]);
    expect(result.fields).toEqual(["title"]);
  });

  it("does not depend on the wall clock -- `now` is injected", () => {
    const input = candidate({ timestamp: new Date("2026-09-10T12:00:00Z") });
    expect(points(scoreCandidate(input, query("rent"), NOW).reasons, "recency")).toEqual([16]);
    const later = new Date("2026-12-01T00:00:00Z");
    expect(points(scoreCandidate(input, query("rent"), later).reasons, "recency")).toEqual([8]);
  });

  it("emits no title, secondary or body code for a date-only query", () => {
    const q = query("october", TZ);
    expect(q.phrase).toBe("");
    const result = scoreCandidate(candidate({ title: "October" }), q, NOW);
    expect(result.reasons.map((r) => r.code)).toEqual(["recency", "type_prior"]);
  });

  it("emits no title ladder code when the phrase is absent but tokens are", () => {
    const result = scoreCandidate(candidate({ title: "" }), query("rent"), NOW);
    expect(result.reasons.map((r) => r.code)).toEqual(["recency", "type_prior"]);
  });
});

describe("scoreCandidate -- the title ladder against fullPhrase", () => {
  // With a timezone, "may" is a month, so `phrase` is just "report". Before
  // the fix a task titled "May report" could never reach the top rung and a
  // task titled "Report" -- exact on the text phrase -- outranked it.
  const q = query("may report", TZ);

  it("a title equal to the WHOLE query is exact, even though one word is the date token", () => {
    expect(q.phrase).toBe("report");
    expect(q.fullPhrase).toBe("may report");
    const result = scoreCandidate(candidate({ title: "May report" }), q, NOW);
    expect(points(result.reasons, "title_exact")).toEqual([100]);
    expect(points(result.reasons, "title_prefix")).toEqual([]);
    expect(points(result.reasons, "title_phrase")).toEqual([]);
  });

  it("a title equal to the text words alone is NOT exact -- it sits one rung down", () => {
    const result = scoreCandidate(candidate({ title: "Report" }), q, NOW);
    expect(points(result.reasons, "title_exact")).toEqual([]);
    expect(points(result.reasons, "title_prefix")).toEqual([60]);
    expect(points(result.reasons, "title_phrase")).toEqual([]);
  });

  it("so the title that matched everything the user typed outranks the one that skipped a word", () => {
    const whole = scoreOf(candidate({ title: "May report" }), q);
    const textOnly = scoreOf(candidate({ title: "Report" }), q);
    expect(whole).toBeGreaterThan(textOnly);
  });

  it("prefix and phrase on the full query win over the demoted text-only rung", () => {
    const prefix = scoreCandidate(candidate({ title: "May report draft" }), q, NOW);
    expect(points(prefix.reasons, "title_prefix")).toEqual([60]);
    const phrase = scoreCandidate(candidate({ title: "Send the May report" }), q, NOW);
    expect(points(phrase.reasons, "title_phrase")).toEqual([40]);
    // "Report draft": text-only prefix, demoted to phrase.
    const demoted = scoreCandidate(candidate({ title: "Report draft" }), q, NOW);
    expect(points(demoted.reasons, "title_prefix")).toEqual([]);
    expect(points(demoted.reasons, "title_phrase")).toEqual([40]);
  });

  it("the bottom rung is never demoted away: a text-only phrase hit still earns title_phrase", () => {
    const result = scoreCandidate(candidate({ title: "Quarterly report review" }), q, NOW);
    expect(points(result.reasons, "title_phrase")).toEqual([40]);
  });

  it("stays exclusive: exactly one ladder code, and the ladder is unchanged without a date token", () => {
    const ladder = (title: string, tq: TokenizedQuery) =>
      scoreCandidate(candidate({ title }), tq, NOW).reasons.filter((r) =>
        ["title_exact", "title_prefix", "title_phrase"].includes(r.code),
      );
    expect(ladder("May report", q)).toHaveLength(1);
    expect(ladder("Report", q)).toHaveLength(1);
    // No timezone: "may" is text, phrase === fullPhrase, and "Report" is a phrase hit only.
    const noTz = query("may report", NO_TZ);
    expect(noTz.fullPhrase).toBe(noTz.phrase);
    expect(points(ladder("May report", noTz), "title_exact")).toEqual([100]);
    expect(ladder("Report", noTz)).toEqual([]);
  });

  it("a date-only query still climbs no ladder, whatever the title reads", () => {
    const dateOnly = query("october", TZ);
    const result = scoreCandidate(candidate({ title: "October" }), dateOnly, NOW);
    expect(result.reasons.map((r) => r.code)).toEqual(["recency", "type_prior"]);
  });
});

describe("scoreCandidate -- ordering the contract requires", () => {
  const q = query("pay rent");

  it("exact > prefix > phrase > all tokens > one token > no title hit", () => {
    const exact = scoreOf(candidate({ title: "Pay rent" }), q);
    const prefix = scoreOf(candidate({ title: "Pay rent by Friday" }), q);
    const phrase = scoreOf(candidate({ title: "Remember to pay rent" }), q);
    const allTokens = scoreOf(candidate({ title: "Rent: pay it" }), q);
    const oneToken = scoreOf(candidate({ title: "Rent" }), q);
    const none = scoreOf(candidate({ title: "Groceries" }), q);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(phrase);
    expect(phrase).toBeGreaterThan(allTokens);
    expect(allTokens).toBeGreaterThan(oneToken);
    expect(oneToken).toBeGreaterThan(none);
    // The exact numbers, so a weight change is a deliberate diff here too.
    expect([exact, prefix, phrase, allTokens, oneToken, none]).toEqual([
      100 + 30 + 14 + 14 + 20,
      60 + 30 + 14 + 14 + 20,
      40 + 30 + 14 + 14 + 20,
      30 + 14 + 14 + 20,
      14 + 20,
      20,
    ]);
  });

  it("a live exact title outranks a done exact title, which still outranks a live prefix title", () => {
    const live = scoreOf(candidate({ title: "Pay rent" }), q);
    const done = scoreOf(
      candidate({ title: "Pay rent", flags: { ...candidate().flags, done: true } }),
      q,
    );
    const livePrefix = scoreOf(candidate({ title: "Pay rent by Friday" }), q);
    expect(live).toBe(done + 15);
    expect(done).toBeGreaterThan(livePrefix);
  });

  it("an old exact title still outranks a fresh prefix title", () => {
    const old = scoreOf(
      candidate({ title: "Pay rent", timestamp: new Date("2019-01-01T00:00:00Z") }),
      q,
    );
    const fresh = scoreOf(candidate({ title: "Pay rent by Friday" }), q);
    expect(old).toBeGreaterThan(fresh);
  });

  it("a mail message with the same title scores 10 below a task", () => {
    const task = scoreOf(candidate({ title: "Rent receipt" }), q);
    const mail = scoreOf(
      candidate({ type: "mail_message", title: "Rent receipt", fieldNames: { title: "subject" } }),
      q,
    );
    expect(task - mail).toBe(10);
  });
});

describe("compareScored", () => {
  const T1 = new Date("2026-09-14T10:00:00Z");
  const T0 = new Date("2026-09-14T09:00:00Z");
  const A = "aaaaaaaa-0000-4000-8000-000000000000";
  const B = "bbbbbbbb-0000-4000-8000-000000000000";
  const FIXTURE: ScoredRef[] = [
    { score: 10, timestamp: T1, type: "task", id: A },
    { score: 10, timestamp: T1, type: "task", id: B },
    { score: 10, timestamp: T1, type: "note", id: A },
    { score: 10, timestamp: T1, type: "mail_message", id: A },
    { score: 10, timestamp: T0, type: "task", id: A },
    { score: 50, timestamp: T0, type: "mail_message", id: B },
    { score: -5, timestamp: T1, type: "task", id: A },
    { score: 10, timestamp: new Date(T1.getTime()), type: "task", id: A }, // equal to [0]
  ];

  it("orders score desc, then timestamp desc, then type order, then id asc", () => {
    const sorted = [...FIXTURE].sort(compareScored);
    expect(sorted.map((r) => [r.score, r.timestamp.toISOString(), r.type, r.id[0]])).toEqual([
      [50, T0.toISOString(), "mail_message", "b"],
      [10, T1.toISOString(), "task", "a"],
      [10, T1.toISOString(), "task", "a"],
      [10, T1.toISOString(), "task", "b"],
      [10, T1.toISOString(), "note", "a"],
      [10, T1.toISOString(), "mail_message", "a"],
      [10, T0.toISOString(), "task", "a"],
      [-5, T1.toISOString(), "task", "a"],
    ]);
  });

  it("is antisymmetric and reflexive on the fixture", () => {
    for (const a of FIXTURE) {
      for (const b of FIXTURE) {
        expect(Math.sign(compareScored(a, b)) + Math.sign(compareScored(b, a))).toBe(0);
      }
      expect(compareScored(a, a)).toBe(0);
    }
  });

  it("is transitive on the fixture", () => {
    for (const a of FIXTURE) {
      for (const b of FIXTURE) {
        for (const c of FIXTURE) {
          if (compareScored(a, b) <= 0 && compareScored(b, c) <= 0) {
            expect(compareScored(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it("returns 0 only for identical keys", () => {
    expect(compareScored(FIXTURE[0] as ScoredRef, FIXTURE[7] as ScoredRef)).toBe(0);
    expect(compareScored(FIXTURE[0] as ScoredRef, FIXTURE[1] as ScoredRef)).toBeLessThan(0);
  });
});
