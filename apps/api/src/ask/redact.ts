// Cloud Ask -- redaction, truncation and the context drop ladder (design §7-8).
//
// Turns the ranked candidate rows from select-context.ts into exactly the
// bounded, id-free JSON that gets embedded in the prompt -- and returns THAT
// SAME STRING back to the caller, so the character budget in contracts.ts is
// always measured on the exact string sent, never a structural approximation
// of it. (The 8.6B design review found the Daily Brief measures a compact
// JSON.stringify but sends a pretty one two lines later -- an unrecorded
// defect. This module cannot repeat it, because there is only one
// `JSON.stringify` call in it and its result is what both the length check and
// the prompt use.)
//
// ORDER, PER RECORD: redact secrets, THEN truncate. A secret split by a
// truncation cut would leave a prefix too short for redactSecrets' patterns to
// match and ship it anyway -- the same "redact before truncate" rule the
// design states explicitly. redactSecrets already control-strips internally
// (see packages/core/src/ask/redact-secrets.ts), so no separate stripping step
// is needed here.
import { truncateAtWordBoundary } from "@personal-os/core/mail/provider-strings";
import { redactSecrets } from "@personal-os/core/ask/redact-secrets";
import { ASK_BODY_MAX_CHARS, ASK_MAX_CONTEXT_CHARS, ASK_TITLE_MAX_CHARS } from "./contracts.js";
import type { AskCandidateRecord } from "./select-context.js";

export interface AskContextRecord {
  /** A per-request ordinal, 1..K over the FINAL surviving set -- never a uuid. */
  ref: number;
  type: "task" | "note";
  title: string;
  /** Date only (YYYY-MM-DD) -- never a full timestamp, per ADR-043's rule. */
  updated: string;
  project: string | null;
  body: string;
}

export interface AskContext {
  /** Final records, in the order embedded in the prompt. */
  records: AskContextRecord[];
  /**
   * The ORIGINAL candidate for each surviving record, same order and length as
   * `records` -- so a caller can attach the entity's own uuid to a response
   * source without that uuid ever having been part of what was embedded in
   * the prompt (see `records[].ref`, which carries no id at all).
   */
  survivingCandidates: AskCandidateRecord[];
  /** The EXACT JSON string embedded in the prompt -- what contextChars measures. */
  serializedRecords: string;
  /** Count of secret-shaped strings removed, across only the records that survived. */
  redactions: number;
  contextChars: number;
}

interface ProcessedCandidate {
  source: AskCandidateRecord;
  title: string;
  project: string | null;
  body: string;
  redactions: number;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function redactAndBound(raw: string, maxChars: number): { text: string; redactions: number } {
  const redacted = redactSecrets(raw);
  const truncated = truncateAtWordBoundary(redacted.text, maxChars) ?? "";
  return { text: truncated, redactions: redacted.redactions };
}

function processCandidate(candidate: AskCandidateRecord): ProcessedCandidate {
  const title = redactAndBound(candidate.title, ASK_TITLE_MAX_CHARS);
  const body = redactAndBound(candidate.body ?? "", ASK_BODY_MAX_CHARS);

  let project: string | null = null;
  let projectRedactions = 0;
  if (candidate.projectName !== null) {
    const redactedProject = redactAndBound(candidate.projectName, ASK_TITLE_MAX_CHARS);
    project = redactedProject.text;
    projectRedactions = redactedProject.redactions;
  }

  return {
    source: candidate,
    title: title.text,
    project,
    body: body.text,
    redactions: title.redactions + body.redactions + projectRedactions,
  };
}

function toWireRecord(processed: ProcessedCandidate, ref: number): AskContextRecord {
  return {
    ref,
    type: processed.source.type,
    title: processed.title,
    updated: toDateOnly(processed.source.updatedAt),
    project: processed.project,
    body: processed.body,
  };
}

export interface BuildAskContextOptions {
  /**
   * Checkpoint 9.7: refs are assigned `refOffset + 1 ..` so the `<records>`
   * ordinals continue after the `<today>` block's own citations rather than
   * colliding with them. Default 0 -- the 8.6B numbering, refs from 1.
   */
  refOffset?: number;
  /** Ceiling on the exact serialized string. Default `ASK_MAX_CONTEXT_CHARS`. */
  maxChars?: number;
  /** Cap on records BEFORE the drop ladder runs (the rank order is kept). Default: no cap. */
  maxRecords?: number;
}

/**
 * Redacts, bounds and serializes `candidates` (already ranked and capped by
 * `selectAskContext`) into the final context. Drops lowest-ranked records
 * WHOLE -- never slicing a body mid-record -- until the serialized array fits
 * the ceiling (`ASK_MAX_CONTEXT_CHARS` unless `options.maxChars` narrows it).
 * `candidates` must already be in rank order (best first); this function only
 * ever drops from the end. With no `options` the behaviour is byte-identical
 * to Checkpoint 8.6B (redact.test.ts pins this).
 */
export function buildAskContext(
  candidates: readonly AskCandidateRecord[],
  options: BuildAskContextOptions = {},
): AskContext {
  const refOffset = options.refOffset ?? 0;
  const maxChars = options.maxChars ?? ASK_MAX_CONTEXT_CHARS;
  const capped =
    options.maxRecords === undefined ? candidates : candidates.slice(0, options.maxRecords);
  const processed = capped.map(processCandidate);

  for (let n = processed.length; n > 0; n--) {
    const survivors = processed.slice(0, n);
    const records = survivors.map((p, index) => toWireRecord(p, refOffset + index + 1));
    const serializedRecords = JSON.stringify(records);
    if (serializedRecords.length <= maxChars) {
      return {
        records,
        survivingCandidates: survivors.map((p) => p.source),
        serializedRecords,
        redactions: survivors.reduce((sum, p) => sum + p.redactions, 0),
        contextChars: serializedRecords.length,
      };
    }
  }

  return {
    records: [],
    survivingCandidates: [],
    serializedRecords: "[]",
    redactions: 0,
    contextChars: 2,
  };
}
