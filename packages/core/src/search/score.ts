// Ranking search candidates with an EXPLAINABLE INTEGER SCORE (Checkpoint
// 9.6, ADR-065).
//
// Every result carries `score` and the list of `reasons` that produced it,
// and `score` is exactly `sum(reasons[].points)`. That equality is the whole
// design: the ranking is auditable from the response alone, a reviewer can
// recompute it by hand, and a future weight change is a diff to ONE frozen
// table rather than to a formula. No floats, no tf-idf, no learned model --
// at this corpus (ADR-056/059) the question is "which of a few dozen rows
// did the user mean", and a handful of fixed points answers it.
//
// Pure, like its siblings under ./search: `now` is injected, the stored text
// arrives as strings, and nothing here knows a column from a row. The api
// (apps/api/src/search/service.ts) runs the SQL, feeds each candidate through
// `scoreCandidate`, sorts with `compareScored`, and ships the best `limit`
// per type.
//
// ===========================================================================
// THE VOCABULARIES ARE DEFINED HERE, NOT IMPORTED
// ===========================================================================
//
// `@personal-os/schema` depends on core, not the other way round, so the
// score codes, match fields and type order are `as const` arrays here and
// the schema's Zod enums are asserted EQUAL to them by
// packages/schema/src/search.test.ts. A code added on one side without the
// other is a failing test, not a silent wire drift.
//
// ===========================================================================
// TITLE CODES ARE A LADDER, NOT A PILE
// ===========================================================================
//
// `title_exact`, `title_prefix` and `title_phrase` are MUTUALLY EXCLUSIVE:
// only the strongest fires. An exact title is also a prefix and also
// contains the phrase, so stacking all three would triple-count one fact and
// make the reasons list read as three findings where there is one.
// `title_all_tokens` and the per-token `title_token` codes are independent
// of that ladder and stack with it, which is what keeps the required order
// strict: exact (100) > prefix (60) > phrase (40) > all tokens (30) > one
// token (10-14), with every rung also earning whatever the rungs below it
// earn.
//
// The ladder is climbed against TWO phrases (Checkpoint 9.6 review). With a
// timezone set, "may report" tokenizes to the date "may" plus the text
// "report", so `query.phrase` is just "report" -- and a task titled "May
// report" could never be exact while a task titled "Report" was, an
// inversion of what the user typed. `query.fullPhrase` ("may report") is
// tried as well and the higher rung wins. The text-only phrase is demoted
// one rung when it differs from the full phrase: a title equal to the text
// words alone matched everything the user typed EXCEPT the date word, so it
// sits one rung under a title that matched the whole query ("Report" is a
// prefix-grade hit for "may report"; "May report" is exact). A date-only
// query has no text phrase and climbs no ladder at all, as before -- the
// date codes are its whole vocabulary.

import type { TokenizedQuery } from "./tokenize.js";
import { foldSearchCase } from "./tokenize.js";

export const SEARCH_SCORE_CODES = [
  "title_exact",
  "title_prefix",
  "title_phrase",
  "title_all_tokens",
  "title_token",
  "secondary_token",
  "body_token",
  "date_window",
  "date_text",
  "recency",
  "type_prior",
  "penalty_done",
  "penalty_archived",
  "penalty_completed_project",
  "penalty_external_event",
] as const;
export type SearchScoreCode = (typeof SEARCH_SCORE_CODES)[number];

export const SEARCH_MATCH_FIELDS = [
  "title",
  "body",
  "location",
  "description",
  "raw_text",
  "subject",
  "sender",
  "goal",
  "date",
] as const;
export type SearchMatchField = (typeof SEARCH_MATCH_FIELDS)[number];

/** Tie-break order between types; mirrors SEARCH_RESULT_TYPE_ORDER in the schema. */
export const SEARCH_SCORE_TYPE_ORDER = [
  "task",
  "note",
  "event",
  "project",
  "inbox_item",
  "mail_message",
] as const;
export type SearchScoreType = (typeof SEARCH_SCORE_TYPE_ORDER)[number];

/**
 * Points per code. For the two variable codes the entry is the TOP of the
 * ladder: `recency` is 20 for a row under a day old and steps down through
 * RECENCY_POINTS_BY_AGE; `type_prior` is 0 for the user-authored types and
 * negative for captures and mail through TYPE_PRIOR_POINTS. `title_token`
 * earns +TITLE_TOKEN_BOUNDARY_BONUS more at a word boundary and is capped in
 * total at TITLE_TOKEN_TOTAL_CAP.
 */
export const SEARCH_SCORE_WEIGHTS: Readonly<Record<SearchScoreCode, number>> = Object.freeze({
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

/** Extra points for a title token hit that starts at a word boundary. */
export const TITLE_TOKEN_BOUNDARY_BONUS = 4;

/** Ceiling on the summed `title_token` points for one candidate. */
export const TITLE_TOKEN_TOTAL_CAP = 80;

/**
 * Recency ladder: the first rung whose `maxAgeDays` exceeds the age wins.
 * A future timestamp (a task due next week, edited just now) is "under a
 * day" -- age is never clamped to something older than it is.
 */
export const RECENCY_POINTS_BY_AGE: readonly { maxAgeDays: number; points: number }[] =
  Object.freeze([
    { maxAgeDays: 1, points: 20 },
    { maxAgeDays: 7, points: 16 },
    { maxAgeDays: 30, points: 12 },
    { maxAgeDays: 90, points: 8 },
    { maxAgeDays: 365, points: 4 },
    { maxAgeDays: Number.POSITIVE_INFINITY, points: 0 },
  ]);

/** "Your own content first" (ADR-059 §2), made numeric. */
export const TYPE_PRIOR_POINTS: Readonly<Record<SearchScoreType, number>> = Object.freeze({
  task: 0,
  note: 0,
  event: 0,
  project: 0,
  inbox_item: -2,
  mail_message: -10,
});

export interface SearchScoreReason {
  code: SearchScoreCode;
  points: number;
  /** The matched QUERY token, for the per-token codes. Never a stored string. */
  token?: string;
}

/**
 * How the api labels each text slot on the wire. A task's body is "body",
 * an event's is "description", an inbox item's is "raw_text", a project's
 * goal is "goal"; a mail subject is the title slot under the name "subject".
 */
export interface ScoreFieldNames {
  title: Extract<SearchMatchField, "title" | "subject" | "raw_text">;
  secondary?: Extract<SearchMatchField, "location" | "sender">;
  body?: Extract<SearchMatchField, "body" | "description" | "raw_text" | "goal">;
}

export interface ScoreFlags {
  archived: boolean;
  /** Task `done` or `dropped`. */
  done: boolean;
  completedProject: boolean;
  externalEvent: boolean;
}

export interface ScoreInput {
  type: SearchScoreType;
  id: string;
  title: string;
  /** Location, sender: the columns worth 6 a token. Empty when the type has none. */
  secondary: readonly string[];
  /** The column worth 3 a token, or null. May be text the api never emits (an external event's description). */
  body: string | null;
  timestamp: Date;
  fieldNames: ScoreFieldNames;
  flags: ScoreFlags;
  /** SQL's `date_hit`: true/false when a date token was applied, null when there was none. */
  dateWindowHit: boolean | null;
  /** True when the date token's TEXT matched one of the entity's columns in SQL. */
  dateTextHit: boolean;
}

export interface ScoredCandidate {
  score: number;
  reasons: SearchScoreReason[];
  fields: SearchMatchField[];
}

/** What `compareScored` needs; a result member satisfies it once `timestamp` is a Date. */
export interface ScoredRef {
  score: number;
  timestamp: Date;
  type: SearchScoreType;
  id: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * The one normalization the matcher applies to stored text: NFKC + U+0130
 * fold + lowercase, diacritics kept -- the SAME function the tokenizer folds
 * the query through, so "İstanbul" (which ILIKE already matched for
 * "istanbul") compares equal here too.
 */
export function normalizeForMatch(text: string): string {
  return foldSearchCase(text);
}

/** Rungs of the exclusive title ladder, highest first; 0 is "no rung". */
const LADDER_RUNG_CODES = ["title_exact", "title_prefix", "title_phrase"] as const;
type LadderRung = 0 | 1 | 2 | 3;

function titleLadderRung(title: string, phrase: string): LadderRung {
  if (phrase === "") return 0;
  if (title === phrase) return 3;
  if (title.startsWith(phrase)) return 2;
  if (title.includes(phrase)) return 1;
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `token` occurs in `text` starting at a word boundary. */
export function matchesAtWordBoundary(text: string, token: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(token)}`, "u").test(text);
}

export function recencyPoints(timestamp: Date, now: Date): number {
  const ageDays = (now.getTime() - timestamp.getTime()) / MS_PER_DAY;
  for (const rung of RECENCY_POINTS_BY_AGE) {
    if (ageDays < rung.maxAgeDays) return rung.points;
  }
  return 0;
}

export function scoreCandidate(
  input: ScoreInput,
  query: TokenizedQuery,
  now: Date,
): ScoredCandidate {
  const reasons: SearchScoreReason[] = [];
  const fields = new Set<SearchMatchField>();
  const push = (code: SearchScoreCode, points: number, token?: string): void => {
    reasons.push(token === undefined ? { code, points } : { code, points, token });
  };

  const textTokens: string[] = [];
  for (const token of query.tokens) {
    if (token.kind === "text") textTokens.push(token.value);
  }

  const title = normalizeForMatch(input.title);
  const secondary = input.secondary.map(normalizeForMatch);
  const body = input.body === null ? null : normalizeForMatch(input.body);
  const phrase = query.phrase;

  // --- title ladder (exclusive) -------------------------------------------
  // Climbed only when there is a text phrase: a date-only query earns date
  // codes alone. See the module comment for why two phrases are tried.
  if (phrase !== "") {
    const textRung = titleLadderRung(title, phrase);
    const rung =
      query.fullPhrase === phrase
        ? textRung
        : Math.max(
            titleLadderRung(title, query.fullPhrase),
            // Demote one rung, never below the bottom rung it reached.
            textRung === 0 ? 0 : Math.max(1, textRung - 1),
          );
    if (rung > 0) {
      const code = LADDER_RUNG_CODES[3 - rung] as (typeof LADDER_RUNG_CODES)[number];
      push(code, SEARCH_SCORE_WEIGHTS[code]);
    }
  }

  // --- per-token codes -----------------------------------------------------
  let titleHits = 0;
  let titleTokenTotal = 0;
  for (const token of textTokens) {
    if (title.includes(token)) {
      titleHits += 1;
      fields.add(input.fieldNames.title);
      const earned =
        SEARCH_SCORE_WEIGHTS.title_token +
        (matchesAtWordBoundary(title, token) ? TITLE_TOKEN_BOUNDARY_BONUS : 0);
      // The cap is on the SUM: the reason that crosses it is clamped so the
      // list still adds up to the score, and later hits earn nothing.
      const points = Math.min(earned, TITLE_TOKEN_TOTAL_CAP - titleTokenTotal);
      if (points > 0) {
        titleTokenTotal += points;
        push("title_token", points, token);
      }
    }
    if (secondary.some((value) => value.includes(token))) {
      if (input.fieldNames.secondary !== undefined) fields.add(input.fieldNames.secondary);
      push("secondary_token", SEARCH_SCORE_WEIGHTS.secondary_token, token);
    }
    if (body !== null && body.includes(token)) {
      if (input.fieldNames.body !== undefined) fields.add(input.fieldNames.body);
      push("body_token", SEARCH_SCORE_WEIGHTS.body_token, token);
    }
  }
  if (textTokens.length > 0 && titleHits === textTokens.length) {
    // Inserted after the ladder and before the token codes, so the reasons
    // read strongest-first regardless of how many tokens there were.
    const ladderLength = reasons.findIndex((reason) => reason.code === "title_token");
    const at = ladderLength === -1 ? reasons.length : ladderLength;
    reasons.splice(at, 0, {
      code: "title_all_tokens",
      points: SEARCH_SCORE_WEIGHTS.title_all_tokens,
    });
  }

  // --- date ------------------------------------------------------------------
  if (query.dateToken !== null) {
    const dateValue = query.dateToken.value;
    if (input.dateWindowHit === true) {
      fields.add("date");
      push("date_window", SEARCH_SCORE_WEIGHTS.date_window, dateValue);
    }
    if (input.dateTextHit) {
      // The api knows the text matched SOME column; which one is recoverable
      // here only for the columns the scorer was handed.
      if (title.includes(dateValue)) fields.add(input.fieldNames.title);
      if (
        input.fieldNames.secondary !== undefined &&
        secondary.some((v) => v.includes(dateValue))
      ) {
        fields.add(input.fieldNames.secondary);
      }
      if (input.fieldNames.body !== undefined && body !== null && body.includes(dateValue)) {
        fields.add(input.fieldNames.body);
      }
      push("date_text", SEARCH_SCORE_WEIGHTS.date_text, dateValue);
    }
  }

  // --- always-emitted context codes -------------------------------------------
  push("recency", recencyPoints(input.timestamp, now));
  push("type_prior", TYPE_PRIOR_POINTS[input.type]);

  // --- penalties ----------------------------------------------------------------
  if (input.flags.done) push("penalty_done", SEARCH_SCORE_WEIGHTS.penalty_done);
  if (input.flags.archived) push("penalty_archived", SEARCH_SCORE_WEIGHTS.penalty_archived);
  if (input.flags.completedProject) {
    push("penalty_completed_project", SEARCH_SCORE_WEIGHTS.penalty_completed_project);
  }
  if (input.flags.externalEvent) {
    push("penalty_external_event", SEARCH_SCORE_WEIGHTS.penalty_external_event);
  }

  const score = reasons.reduce((sum, reason) => sum + reason.points, 0);
  return { score, reasons, fields: SEARCH_MATCH_FIELDS.filter((field) => fields.has(field)) };
}

/**
 * The total order results are shipped in: score desc, timestamp desc, type
 * order asc, id asc. Total because ids are unique; the timestamp rung exists
 * because equal timestamps to the microsecond are an observed property of
 * this database (ADR-059 §2), not a hypothetical.
 */
export function compareScored(a: ScoredRef, b: ScoredRef): number {
  if (a.score !== b.score) return b.score - a.score;
  const at = a.timestamp.getTime();
  const bt = b.timestamp.getTime();
  if (at !== bt) return bt - at;
  const ai = SEARCH_SCORE_TYPE_ORDER.indexOf(a.type);
  const bi = SEARCH_SCORE_TYPE_ORDER.indexOf(b.type);
  if (ai !== bi) return ai - bi;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
