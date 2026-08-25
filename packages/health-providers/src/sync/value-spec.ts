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
 * Per-metric leaf declaration.
 *
 * THE LEAF IS DECLARED, NOT DERIVED -- and Checkpoint 6.3L is why.
 *
 * An earlier draft derived the leaf from the catalog `unit`, reasoning from
 * ADR-047 that "the API bakes the unit into the field name". The live proof
 * rejected every record of all four metrics that actually have data. The real
 * shapes, observed against the development account:
 *
 *     steps          -> steps.countSum                (string / int64)
 *     distance       -> distance.millimetersSum       (string / int64)
 *     floors         -> floors.countSum               (string / int64)
 *     total-calories -> totalCalories.kcalSum         (number / double)
 *     heart-rate     -> heartRate.beatsPerMinuteAvg   (number, + Min and Max)
 *
 * Two things the unit-derivation could never have produced. `dailyRollUp`
 * appends an AGGREGATION SUFFIX (`Sum`, `Avg`, `Min`, `Max`) -- it returns a
 * rollup, not a raw reading -- and the prefix is the bare unit noun, not the
 * catalog's unit string: `total-calories` has unit `caloriesKcal` but its leaf
 * is `kcalSum`. The container derivation (camelCase of the dataType) WAS right
 * and is unchanged.
 *
 * `observed` records epistemic status honestly, because it is the difference
 * between a fact and a guess. A `false` entry is a documentation-derived
 * DECLARATION for a stream this account has never returned data for; the
 * validator still rejects loudly if it is wrong, so a bad declaration fails a
 * run rather than storing a wrong number. No fixture is fabricated for one.
 */
interface LeafDecl {
  readonly leaf: string;
  readonly leafType: LeafType;
  readonly breakdown?: readonly { readonly name: string; readonly type: LeafType }[];
  /** True only where the shape was seen on a live response. */
  readonly observed: boolean;
}

const LEAF_DECLS: Readonly<Record<string, LeafDecl>> = {
  // --- Activity, dailyRollUp ------------------------------------------------
  // OBSERVED 2026-08-25 (Checkpoint 6.3L).
  steps: { leaf: "countSum", leafType: "int64", observed: true },
  distance: { leaf: "millimetersSum", leafType: "int64", observed: true },
  floors: { leaf: "countSum", leafType: "int64", observed: true },
  "total-calories": { leaf: "kcalSum", leafType: "double", observed: true },

  // UNVERIFIED -- this account has produced no data for these, so the leaf
  // follows the observed `<unit noun><Aggregation>` pattern but has never been
  // seen. A wrong guess fails the run; it cannot store a wrong number.
  "active-zone-minutes": {
    leaf: "minutesSum",
    leafType: "int64",
    breakdown: [
      { name: "fatBurnMinutesSum", type: "int64" },
      { name: "cardioMinutesSum", type: "int64" },
      { name: "peakMinutesSum", type: "int64" },
    ],
    observed: false,
  },
  "active-energy-burned": { leaf: "kcalSum", leafType: "double", observed: false },
  "sedentary-period": { leaf: "secondsSum", leafType: "int64", observed: false },

  // OBSERVED 2026-08-25 against the historical window (F5 recorded 2026-04-29
  // as the day with the most heart rate). A rollup of heart rate is an
  // AVERAGE, not a sum -- summing BPM would be meaningless -- and Min/Max ride
  // along, so they go to the allowlisted breakdown rather than being dropped.
  "heart-rate": {
    leaf: "beatsPerMinuteAvg",
    leafType: "double",
    breakdown: [
      { name: "beatsPerMinuteMin", type: "double" },
      { name: "beatsPerMinuteMax", type: "double" },
    ],
    observed: true,
  },

  // --- Precomputed daily vitals, list --------------------------------------
  // UNVERIFIED. These are `list` records, not rollups, so they should carry the
  // bare unit field with NO aggregation suffix -- but none has ever been seen.
  "daily-resting-heart-rate": { leaf: "beatsPerMinute", leafType: "double", observed: false },
  "daily-heart-rate-variability": {
    leaf: "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
    leafType: "double",
    observed: false,
  },
  "daily-oxygen-saturation": { leaf: "percentage", leafType: "double", observed: false },
  "daily-respiratory-rate": { leaf: "breathsPerMinute", leafType: "double", observed: false },
  "daily-sleep-temperature-derivations": {
    leaf: "celsiusDelta",
    leafType: "double",
    observed: false,
  },
  "daily-vo2-max": { leaf: "vo2Max", leafType: "double", observed: false },

  // --- Body samples, list ---------------------------------------------------
  // UNVERIFIED.
  weight: { leaf: "weightGrams", leafType: "int64", observed: false },
  "body-fat": { leaf: "percentage", leafType: "double", observed: false },

  // --- Sessions, list -------------------------------------------------------
  // Sessions do not go through extractValue at all: their value is a duration
  // derived from the physical interval, not a numeric leaf. A spec exists so
  // the coverage test is a genuine 1:1 with the in-scope catalog rather than a
  // list with two documented holes in it.
  sleep: { leaf: "seconds", leafType: "int64", observed: false },
  exercise: { leaf: "seconds", leafType: "int64", observed: false },
};

/** Metrics whose leaf shape has actually been seen on a live response. */
export const OBSERVED_LEAF_METRICS: readonly string[] = Object.entries(LEAF_DECLS)
  .filter(([, d]) => d.observed)
  .map(([m]) => m);

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

function buildSpec(def: HealthMetricDefinition, decl: LeafDecl): HealthValueSpec {
  return {
    // The container derivation was correct and is unchanged: camelCase of the
    // kebab-case dataType (`total-calories` -> `totalCalories`).
    container: camelCase(def.googleDataType),
    leaf: decl.leaf,
    leafType: decl.leafType,
    breakdownLeaves: decl.breakdown ?? [],
  };
}

export const HEALTH_VALUE_SPECS: Readonly<Record<string, HealthValueSpec>> = Object.freeze(
  Object.fromEntries(
    Object.entries(LEAF_DECLS).map(([metric, decl]) => {
      const def = HEALTH_METRIC_CATALOG[metric];
      if (!def) throw new Error(`value spec declared for unknown metric "${metric}"`);
      return [metric, Object.freeze(buildSpec(def, decl))];
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
