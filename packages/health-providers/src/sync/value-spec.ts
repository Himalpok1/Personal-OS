import {
  HEALTH_METRIC_CATALOG,
  HEALTH_METRICS,
  type HealthMetricDefinition,
} from "../google-health-catalog.js";

// ============================================================================
// HONEST PROVENANCE -- READ THIS BEFORE TRUSTING A NUMBER OUT OF THIS MODULE.
// ============================================================================
//
// This file says, for each metric, EXACTLY which field of the response carries
// the value and exactly what JSON type that field has. It is a declaration, not
// a discovery: nothing here inspects a payload looking for "the numeric leaf".
//
// Of the 18 in-scope metrics, only FOUR have ever been observed carrying real
// data on the development account -- `steps`, `distance`, `total-calories` and
// `floors` (6.2P, 7-day window, 2026-08-18..24). The account has no wearable
// paired, so the remaining fourteen returned supported-but-empty.
//
// The other fourteen specs below are therefore transcribed from Google's
// documented data-type table and are UNVERIFIED AT MERGE. That is stated
// plainly rather than papered over, because the failure mode matters:
//
//   * Where a declaration is WRONG, extractValue rejects loudly and the run
//     fails. It cannot store a wrong number, because it never searches for a
//     substitute field and never coerces a type it did not expect. A wrong spec
//     costs a failed sync and a clear rejection code -- not silent corruption.
//
//   * A green test suite proves the fixtures and the specs agree with each
//     other. It does NOT prove either agrees with Google. The fixtures are
//     written from the same documentation as the specs, so they share its
//     blind spots by construction. Only a live call against an account that
//     actually has the data can close that gap, and none exists yet.
//
// The two judgement calls worth naming individually:
//
//   * `weight` is declared int64 on `weightGrams`. Grams is a fine-grained
//     integer metric unit in the same family as `millimeters`, and the API
//     bakes the unit into the field name precisely so no conversion is implied
//     (ADR-047). If Google in fact returns a fractional gram, this rejects
//     rather than truncates -- which is the correct way to be wrong.
//   * `active-zone-minutes` is the only metric declaring breakdown leaves.
//     Those three field names come from the documented zone split and are the
//     least certain thing in this file. Their failure mode is benign: an absent
//     breakdown leaf is simply omitted, never a rejection, so a wrong name
//     costs a missing detail rather than a failed sync.
//
// `heart-rate-intraday` is deliberately ABSENT. It is the one
// `sample_reconcile` metric, its identity strategy is unproven (F5 is deferred
// acceptance debt), and Checkpoint 6.3 excludes raw intraday ingestion
// entirely. Its absence here is load-bearing: getValueSpec throws for it, so no
// code path can accidentally grow support by reaching for a spec.

/** The JSON encoding a value leaf uses on the wire. */
export type LeafType = "int64" | "double";

export interface HealthValueSpec {
  /** Field on the bucket/record holding the value container. */
  readonly container: string;
  /** Field within the container holding the scalar; null when the container IS the scalar. */
  readonly leaf: string | null;
  readonly leafType: LeafType;
  /** Extra scalar leaves permitted into `breakdown`. Nothing else is ever stored. */
  readonly breakdownLeaves: readonly { readonly name: string; readonly type: LeafType }[];
}

/**
 * kebab-case Google dataType -> lowerCamelCase JSON field name.
 *
 * The API's JSON encoding is lowerCamelCase throughout, so the container field
 * for dataType `active-zone-minutes` is `activeZoneMinutes` and for
 * `daily-vo2-max` is `dailyVo2Max`. Derived rather than listed so a catalog
 * rename cannot leave a stale literal behind.
 */
export function camelCase(kebab: string): string {
  return kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The declared JSON type of each metric's value leaf.
 *
 * Hand-maintained ON PURPOSE, and the reason adding a metric cannot silently
 * ship: HEALTH_VALUE_SPECS is built from THIS record's keys, and a test asserts
 * those keys equal the in-scope catalog metrics exactly. Add a metric to the
 * catalog without deciding its leaf type here and the suite fails.
 *
 * int64 for counts, whole durations and integer metric units; double for
 * anything the documentation expresses as a real number (kcal, percentages,
 * rates per minute, milliseconds, VO2 max, temperature deltas).
 */
const LEAF_TYPES: Readonly<Record<string, LeafType>> = {
  // --- Activity, dailyRollUp ------------------------------------------------
  steps: "int64",
  distance: "int64", // millimeters
  "active-zone-minutes": "int64",
  "active-energy-burned": "double", // caloriesKcal
  "total-calories": "double", // caloriesKcal
  "sedentary-period": "int64", // seconds
  floors: "int64",
  "heart-rate": "double", // beatsPerMinute (daily rollup of an average)

  // --- Precomputed daily vitals, list --------------------------------------
  "daily-resting-heart-rate": "double",
  "daily-heart-rate-variability": "double", // RMSSD milliseconds
  "daily-oxygen-saturation": "double", // percentage
  "daily-respiratory-rate": "double", // breathsPerMinute
  "daily-sleep-temperature-derivations": "double", // celsiusDelta, signed
  "daily-vo2-max": "double",

  // --- Body samples, list ---------------------------------------------------
  weight: "int64", // weightGrams -- see the provenance note above
  "body-fat": "double", // percentage

  // --- Sessions, list -------------------------------------------------------
  // Sessions do not go through extractValue at all: their value is a duration
  // derived from the physical interval, not a numeric leaf. A spec exists so
  // the coverage test is a genuine 1:1 with the in-scope catalog rather than a
  // list with two documented holes in it, and so a session's own `seconds` leaf
  // has a declared type if a caller ever wants it.
  sleep: "int64", // seconds
  exercise: "int64", // seconds
};

/**
 * Extra leaves permitted into a row's `breakdown`.
 *
 * Strictly an allowlist. `breakdown` is never the raw payload, never a
 * pass-through, and never a place an unexpected provider field can arrive --
 * which is what stops a future response gaining a credential-shaped field and
 * having it land in jsonb.
 */
const BREAKDOWN_LEAVES: Readonly<
  Record<string, readonly { readonly name: string; readonly type: LeafType }[]>
> = {
  "active-zone-minutes": [
    { name: "fatBurnMinutes", type: "int64" },
    { name: "cardioMinutes", type: "int64" },
    { name: "peakMinutes", type: "int64" },
  ],
};

/**
 * Metrics this module covers: every catalog entry EXCEPT the one
 * `sample_reconcile` stream.
 *
 * Derived from the acquisition mode rather than by naming heart-rate-intraday,
 * so a second reconcile-mode metric would also be excluded automatically rather
 * than quietly acquiring an unverified spec.
 */
export const IN_SCOPE_METRICS: readonly string[] = HEALTH_METRICS.filter(
  (m) => HEALTH_METRIC_CATALOG[m]!.mode !== "sample_reconcile",
);

function buildSpec(def: HealthMetricDefinition, leafType: LeafType): HealthValueSpec {
  return {
    container: camelCase(def.googleDataType),
    // ADR-047: the API bakes the unit into the field name, which is exactly why
    // no unit column exists anywhere in the schema. Every catalog `unit` is
    // already a valid lowerCamelCase protobuf field name, so the leaf IS the
    // unit -- deriving it keeps the two from ever drifting apart.
    leaf: def.unit,
    leafType,
    breakdownLeaves: BREAKDOWN_LEAVES[def.metric] ?? [],
  };
}

export const HEALTH_VALUE_SPECS: Readonly<Record<string, HealthValueSpec>> = Object.freeze(
  Object.fromEntries(
    Object.entries(LEAF_TYPES).map(([metric, leafType]) => {
      const def = HEALTH_METRIC_CATALOG[metric];
      if (!def) throw new Error(`value spec declared for unknown metric "${metric}"`);
      return [metric, Object.freeze(buildSpec(def, leafType))];
    }),
  ),
);

export function getValueSpec(metric: string): HealthValueSpec {
  const spec = HEALTH_VALUE_SPECS[metric];
  if (!spec) {
    throw new Error(
      `no value spec for metric "${metric}" -- it is either unknown or deliberately ` +
        `out of scope (heart-rate-intraday has no spec by design)`,
    );
  }
  return spec;
}
