import { createHash } from "node:crypto";

// Deterministic identity for Google Health records (plan Appendix A1).
//
// THE PROBLEM: Google documents NO guaranteed stable identifier for a data
// point. `DataPoint.name` is "only supported for the subset of identifiable
// data types" and may be empty; `DataSource` carries only recordingMethod,
// device.formFactor and application.platform -- coarse descriptors, not an id,
// so two wrist devices of the same form factor are indistinguishable; and
// `ReconciledDataPoint` carries no dataSource at all.
//
// So we derive a key from every identity-bearing field the response actually
// returns, version it, and record WHICH strategy produced it per row -- letting
// the 6.2P probe change the strategy with no schema migration.

export type ExternalKeySource = "data_point_name" | "reconcile_derived" | "list_derived";

export interface ExternalKey {
  key: string;
  source: ExternalKeySource;
}

const VERSION = "hr:v1";

/**
 * Serializes one component.
 *
 * Each part is JSON-encoded before joining, so no component value can ever
 * impersonate the delimiter -- "a:b" and ["a","b"] hash differently. Absent
 * fields become null rather than being omitted, so field POSITION is stable and
 * a missing field cannot shift every later component by one.
 */
function digest(parts: readonly (string | number | null | undefined)[]): string {
  const canonical = parts.map((p) => JSON.stringify(p ?? null)).join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface HeartRateIdentityInput {
  /** Full resource name when the API supplied one; empty/absent otherwise. */
  dataPointName?: string | null;
  /** RFC-3339, Z-normalized, exactly as returned. */
  physicalTime: string;
  /** Whole seconds, already parsed from the protobuf Duration. */
  utcOffsetSeconds: number;
  beatsPerMinute: number;
  motionContext?: string | null;
  sensorLocation?: string | null;
  /** list-only provenance; absent on reconcile, which does not return it. */
  recordingMethod?: string | null;
  deviceFormFactor?: string | null;
  applicationPlatform?: string | null;
}

/**
 * Identity for an intraday heart-rate sample from `reconcile`.
 *
 * NOTE what is deliberately absent: `dataSource`. ReconciledDataPoint does not
 * document one, because reconciliation is precisely the act of dissolving
 * "which source" into a single stream.
 *
 * NOTE what is deliberately PRESENT: beatsPerMinute. Including the value means
 * an upstream correction produces a NEW row rather than an in-place update --
 * accepted, because with no stable identity we cannot distinguish a correction
 * from a genuinely distinct sample, and since these rows are never tombstoned
 * (until the 6.2P stability gate passes) keeping both is the only
 * non-destructive choice. Read models de-duplicate by instant at query time.
 */
export function reconciledHeartRateKey(input: HeartRateIdentityInput): ExternalKey {
  const name = input.dataPointName ?? "";
  return {
    key: digest([
      VERSION,
      name,
      input.physicalTime,
      input.utcOffsetSeconds,
      input.beatsPerMinute,
      input.motionContext,
      input.sensorLocation,
    ]),
    source: name.length > 0 ? "data_point_name" : "reconcile_derived",
  };
}

/**
 * Identity for an intraday heart-rate sample from `list` -- the documented
 * fallback if the 6.2P probe shows reconcile identities are unstable across
 * calls (it recomputes off-wrist filtering server-side per request).
 *
 * `list` DOES return DataPoint.dataSource, so its three descriptive fields are
 * folded in. They are not an identifier and are not treated as one; they merely
 * separate samples that genuinely came from different kinds of source.
 */
export function listedHeartRateKey(input: HeartRateIdentityInput): ExternalKey {
  const name = input.dataPointName ?? "";
  return {
    key: digest([
      VERSION + ":list",
      name,
      input.physicalTime,
      input.utcOffsetSeconds,
      input.beatsPerMinute,
      input.motionContext,
      input.sensorLocation,
      input.recordingMethod,
      input.deviceFormFactor,
      input.applicationPlatform,
    ]),
    source: name.length > 0 ? "data_point_name" : "list_derived",
  };
}

/**
 * The three descriptive provenance fields `DataPoint.dataSource` actually
 * carries. Not an identifier -- Google documents none -- but genuinely
 * discriminating between records that came from different KINDS of source.
 *
 * Folded into every derived key below. The reason is concrete: a derived key
 * built from interval (or timestamp) plus value alone MERGES two legitimate
 * readings that happen to coincide -- a watch and a scale both recording 70.5kg
 * at the same minute, or a phone and a watch both logging the same walk. That
 * is silent data loss dressed up as de-duplication, and it is unrecoverable
 * because the losing record is never stored at all. Over-splitting is the
 * survivable direction: a duplicate row is visible, countable and fixable.
 */
export interface SourceIdentityInput {
  recordingMethod?: string | null;
  deviceFormFactor?: string | null;
  applicationPlatform?: string | null;
}

/** Source components in a FIXED order, so field position can never shift. */
function sourceParts(input: SourceIdentityInput): (string | null | undefined)[] {
  return [input.recordingMethod, input.deviceFormFactor, input.applicationPlatform];
}

export interface SessionIdentityInput extends SourceIdentityInput {
  dataPointName?: string | null;
  metric: string;
  startTime: string;
  endTime: string;
  /** e.g. an exercise activity type, where the record carries one. */
  sessionType?: string | null;
  /** A finer classification under sessionType, where one exists. */
  sessionSubtype?: string | null;
}

/**
 * Identity for a sleep or exercise session.
 *
 * A real resource name is used VERBATIM whenever the API supplies one -- that
 * is a provider identity and always beats anything we could derive.
 *
 * The derived branch covers every identity-bearing field the response actually
 * returns: the physical interval, the session's own type/subtype, and the
 * canonical source identity. type+start+end alone was too weak. Two devices
 * recording the same walk produce two legitimate sessions over one interval,
 * and merging them would silently drop one; two different exercise types
 * logged back-to-back over an identical interval are likewise distinct facts.
 *
 * Note what is still deliberately EXCLUDED: the measured value (duration is
 * implied by the interval, but no metric leaf is folded in). An upstream
 * CORRECTION to a session therefore updates the same row in place rather than
 * spawning a duplicate -- which is exactly what rows_updated is counting.
 *
 * Namespace bumped v1 -> v2 with the added components. Any key derived under v1
 * is now unreachable, which is correct: a stale key silently colliding with a
 * differently-composed new one would be far worse than re-deriving.
 */
export function sessionKey(input: SessionIdentityInput): ExternalKey {
  const name = input.dataPointName ?? "";
  if (name.length > 0) return { key: name, source: "data_point_name" };
  return {
    key: digest([
      "session:v2",
      input.metric,
      input.startTime,
      input.endTime,
      input.sessionType,
      input.sessionSubtype,
      ...sourceParts(input),
    ]),
    source: "list_derived",
  };
}

export interface BodySampleIdentityInput extends SourceIdentityInput {
  dataPointName?: string | null;
  /** "weight" or "body-fat" -- keeps the two streams from ever colliding. */
  metric: string;
  /** RFC-3339, exactly as returned. */
  physicalTime: string;
  /** Whole seconds, already parsed from the protobuf Duration. */
  utcOffsetSeconds: number;
  /** The CANONICAL decimal string from canonicalNumeric, never a raw JS number. */
  value: string;
}

/**
 * Identity for an episodic body sample (weight, body fat).
 *
 * Same shape of problem as sessions, one degree harder: a body sample is a
 * single instant with no interval to lean on, so timestamp+value is all that a
 * naive key would have -- and that is precisely the combination two legitimate
 * sources can share. A smart scale and a manually-entered reading of the same
 * weight at the same minute are two facts, not one, and only the source
 * identity separates them.
 *
 * `value` is required to be the CANONICAL string rather than a number so that
 * "70500" and 70500 cannot produce two keys for one reading, and so that an
 * int64 above 2^53 is not silently mangled on its way into the digest.
 */
export function bodySampleKey(input: BodySampleIdentityInput): ExternalKey {
  const name = input.dataPointName ?? "";
  if (name.length > 0) return { key: name, source: "data_point_name" };
  return {
    key: digest([
      "body:v1",
      input.metric,
      input.physicalTime,
      input.utcOffsetSeconds,
      input.value,
      ...sourceParts(input),
    ]),
    source: "list_derived",
  };
}

/** JSON with object keys sorted, so key order cannot change a hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",");
  return "{" + body + "}";
}

/**
 * Content hash, used to make an unchanged re-fetch a genuine no-op.
 *
 * Deliberately covers ONLY provider-supplied values -- nothing clock-derived --
 * so a server clock jump can never invalidate a stored hash and force a rewrite.
 */
export function contentHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
