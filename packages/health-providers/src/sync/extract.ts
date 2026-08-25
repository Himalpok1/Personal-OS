import type { HealthValueSpec, LeafType } from "./value-spec.js";

// Validated numeric extraction. The single rule this module exists to enforce:
// NEVER GUESS. Every field is named in advance by a HealthValueSpec; nothing
// here searches a payload for "the number", nothing coerces a type it did not
// expect, and nothing invents a value when the declared one is missing.
//
// The alternative -- walking the object looking for the first numeric leaf --
// is superficially robust and actually catastrophic: it would happily pick up a
// count when it wanted a duration, or a zone total when it wanted a whole-day
// total, and store the wrong number as if it were right. A rejection is
// recoverable; a plausible wrong number in a health series is not.

/**
 * A structural description of why a record could not be trusted.
 *
 * Carries the key path and the JSON kind we saw, and DELIBERATELY NEVER A
 * VALUE. Rejections are counted into health_sync_runs.rows_rejected and land in
 * logs; a health measurement -- or anything else that happened to be in the
 * payload -- must not travel there.
 */
export interface Rejection {
  readonly code: string;
  readonly keyPath: string;
  readonly sawType: string;
}

export type Extracted =
  | { readonly ok: true; readonly value: string; readonly breakdown: unknown }
  | { readonly ok: false; readonly rejection: Rejection };

/** JSON kind of a value, for a rejection. Never the value itself. */
export function jsonKindOf(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function reject(code: string, keyPath: string, saw: unknown): Extracted {
  return { ok: false, rejection: { code, keyPath, sawType: jsonKindOf(saw) } };
}

// A decimal literal, optionally signed, optionally fractional, optionally
// exponential. Deliberately strict: no whitespace inside, no hex, no "Infinity",
// no bare "." and no thousands separators.
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

// Bound on how far a decimal point may be shifted by an exponent. A hostile or
// corrupt payload carrying "1e999999999" must not make this allocate a gigabyte
// of zeroes; such a value is not a plausible health measurement in any unit, so
// refusing it is both safe and correct.
const MAX_POINT_SHIFT = 1000;

/**
 * Canonicalizes a numeric REPRESENTATION. It must never round, truncate, or
 * otherwise reduce the precision the provider sent.
 *
 * The distinction that governs every rule below: two inputs normalize to the
 * same string only when they are NUMERICALLY EQUAL. So:
 *
 *   "1.5", "1.50", "+1.5", "1.5e0"  -> "1.5"      (equal, so identical)
 *   1.5 and 1.5000000000000001      -> distinct   (not equal, so never merged)
 *   "-0", -0                        -> "0"        (numerically zero)
 *
 * Everything is done in STRING space. Round-tripping an int64 through a JS
 * number would silently destroy any value above 2^53, and protobuf JSON encodes
 * int64 as a string precisely because that range is real -- so the one thing
 * this function must never do is `Number(...)` a string it was handed. A number
 * INPUT is converted with String() first, which yields the shortest round-trip
 * decimal (possibly in exponent form) and is then normalized by the same string
 * path -- one code path, no second set of rules to keep in sync.
 *
 * Output feeds a Postgres `numeric` column, which is arbitrary-precision and
 * exact, so a long decimal is stored as written rather than as the nearest
 * double.
 */
export function canonicalNumeric(value: unknown): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  if (text.length === 0) return null;

  const m = DECIMAL.exec(text);
  if (!m) return null;
  const sign = m[1] === "-" ? "-" : "";
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  const exp = m[4] === undefined ? 0 : Number(m[4]);

  // At least one digit somewhere, so "." / "+" / "e5" are all rejected.
  if (intPart.length === 0 && fracPart.length === 0) return null;

  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  if (!Number.isFinite(pointPos) || Math.abs(pointPos) > MAX_POINT_SHIFT) return null;

  let whole: string;
  let frac: string;
  if (pointPos <= 0) {
    whole = "0";
    frac = "0".repeat(-pointPos) + digits;
  } else if (pointPos >= digits.length) {
    whole = digits + "0".repeat(pointPos - digits.length);
    frac = "";
  } else {
    whole = digits.slice(0, pointPos);
    frac = digits.slice(pointPos);
  }

  // Strip leading zeros (keeping one) and INSIGNIFICANT trailing fractional
  // zeros. "1.50" and "1.5" are the same number; "1.05" and "1.5" are not, so
  // only trailing zeros after the point are ever removed.
  whole = whole.replace(/^0+(?=\d)/, "");
  frac = frac.replace(/0+$/, "");

  const magnitude = frac.length > 0 ? `${whole}.${frac}` : whole;
  // -0 is numerically 0. A stored "-0" would compare unequal to "0" as text and
  // would make an unchanged re-fetch look like a change.
  if (/^0(\.0*)?$/.test(magnitude)) return "0";
  return sign + magnitude;
}

/**
 * Whether a raw JSON value is acceptable for a declared leaf type.
 *
 * int64 accepts a whole JS number OR a numeric string with no fractional part.
 * The string half is not defensive slack -- protobuf's JSON mapping encodes
 * int64 as a STRING, so rejecting strings would break `steps` on the first real
 * response. The "no fractional part" half is the real check: a fractional value
 * arriving on a field documented as an integer means our reading of the type is
 * wrong, and that must surface rather than be truncated away.
 *
 * double accepts a number or a numeric string, with no integrality constraint.
 */
function leafTypeAccepts(raw: unknown, leafType: LeafType): boolean {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return false;
    return leafType === "double" || Number.isInteger(raw);
  }
  if (typeof raw !== "string") return false;
  const canonical = canonicalNumeric(raw);
  if (canonical === null) return false;
  return leafType === "double" || !canonical.includes(".");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Assembles `breakdown` from the spec's allowlist and nothing else.
 *
 * An ABSENT allowlisted leaf is omitted silently: a breakdown is optional
 * detail, and a missing zone split is not a reason to discard a whole day's
 * step count. A PRESENT leaf of the wrong type is a rejection: it means the
 * payload disagrees with our model, and storing half of a value we do not
 * understand is worse than storing none of it.
 *
 * Returns null rather than {} when nothing qualifies, because
 * health_daily_metrics' has_data CHECK treats a non-null breakdown as evidence
 * of data -- an empty object would be a claim we did not mean to make.
 */
function buildBreakdown(
  container: Record<string, unknown>,
  spec: HealthValueSpec,
): { ok: true; breakdown: unknown } | { ok: false; rejection: Rejection } {
  if (spec.breakdownLeaves.length === 0) return { ok: true, breakdown: null };

  const out: Record<string, string> = {};
  for (const leaf of spec.breakdownLeaves) {
    const raw = container[leaf.name];
    if (raw === undefined || raw === null) continue;
    if (!leafTypeAccepts(raw, leaf.type)) {
      return {
        ok: false,
        rejection: {
          code: "breakdown_leaf_type_mismatch",
          keyPath: `${spec.container}.${leaf.name}`,
          sawType: jsonKindOf(raw),
        },
      };
    }
    const canonical = canonicalNumeric(raw);
    if (canonical === null) {
      return {
        ok: false,
        rejection: {
          code: "breakdown_leaf_not_numeric",
          keyPath: `${spec.container}.${leaf.name}`,
          sawType: jsonKindOf(raw),
        },
      };
    }
    out[leaf.name] = canonical;
  }
  return { ok: true, breakdown: Object.keys(out).length > 0 ? out : null };
}

/**
 * Extracts one metric's value from a bucket or record, validating in a fixed
 * order and rejecting on the first disagreement.
 *
 * Order matters for the quality of the rejection code, which is the only signal
 * a human gets when a spec turns out to be wrong: container -> leaf presence ->
 * leaf type -> numeric form -> breakdown.
 */
export function extractValue(record: Record<string, unknown>, spec: HealthValueSpec): Extracted {
  const container = record[spec.container];
  if (container === undefined || container === null) {
    return reject("container_missing", spec.container, container);
  }

  // The container may itself be the scalar for a type that carries no named
  // unit leaf. No in-scope metric is shaped that way today, but the spec can
  // express it (leaf: null), so the path is implemented rather than left as a
  // silent hole for the first metric that needs it.
  if (spec.leaf === null) {
    if (!leafTypeAccepts(container, spec.leafType)) {
      return reject("container_type_mismatch", spec.container, container);
    }
    const value = canonicalNumeric(container);
    if (value === null) return reject("value_not_numeric", spec.container, container);
    return { ok: true, value, breakdown: null };
  }

  if (!isPlainObject(container)) {
    return reject("container_not_object", spec.container, container);
  }

  const keyPath = `${spec.container}.${spec.leaf}`;
  const raw = container[spec.leaf];
  if (raw === undefined || raw === null) {
    return reject("leaf_missing", keyPath, raw);
  }
  if (!leafTypeAccepts(raw, spec.leafType)) {
    return reject("leaf_type_mismatch", keyPath, raw);
  }
  const value = canonicalNumeric(raw);
  if (value === null) {
    return reject("value_not_numeric", keyPath, raw);
  }

  const breakdown = buildBreakdown(container, spec);
  if (!breakdown.ok) return { ok: false, rejection: breakdown.rejection };

  return { ok: true, value, breakdown: breakdown.breakdown };
}
