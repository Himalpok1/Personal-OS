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
// Of the 18 in-scope metrics, only FOUR had been observed carrying real data
// on the development account at merge -- `steps`, `distance`, `total-calories`
// and `floors` (6.2P, 7-day window, 2026-08-18..24). `heart-rate` followed at
// 6.3L, and `daily-heart-rate-variability` at Checkpoint 9.0 -- the first
// `list`-type daily vital this account ever returned, and the first time an
// UNVERIFIED declaration met real data. It was wrong, and it failed exactly as
// designed: five identical `value_shape_violation` runs, zero rows stored, the
// breaker tripped, one alert raised. See the LEAF_DECLS entry for what was
// actually observed.
//
// The remaining twelve specs below are transcribed from Google's documented
// data-type table and are UNVERIFIED. That is stated plainly rather than
// papered over, because the failure mode matters. The 9.0 review re-read that
// table (developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints,
// 2026-09-12) against every unobserved entry and corrected the ones that
// matched nothing -- a documented name is strictly better evidence than a
// guess the HRV incident just proved can be wrong -- while leaving `observed:
// false` on each, because the documentation was ALSO the source of the HRV
// guess and only a live record settles it:
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
//   * `weight` was declared int64 on `weightGrams` at merge, reasoning that
//     grams is a fine-grained integer unit like `millimeters`. The reference
//     types `Weight.weightGrams` as `number`, so it is now declared double:
//     double accepts every int64 encoding as well, and a fractional gram is a
//     correct value stored at full precision (canonicalNumeric never rounds),
//     not a corrupted one. The two documented-int64 daily leaves
//     (`daily-resting-heart-rate.beatsPerMinute`,
//     `daily-respiratory-rate.averageBreathsPerMinute`) stay double for the
//     same reason in the other direction: int64 would buy only the ability to
//     REJECT a fractional average, which would be a plausible value rather
//     than a shape defect, and this file's job is to never store a wrong
//     number -- not to fail a run over a type annotation.
//   * `active-zone-minutes` is the only UNOBSERVED metric declaring breakdown
//     leaves (heart-rate's Min/Max and HRV's deep-sleep RMSSD were seen live).
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
  // These are `list` records, not rollups, so no aggregation suffix applies.
  // But the 9.0 HRV observation below disproved the other half of the old
  // assumption here -- that the leaf is "the bare unit field". The leaf is the
  // DOCUMENTED MESSAGE FIELD NAME of the Daily* type, which is neither the
  // catalog `unit` string (a display key) nor derivable from it. Every
  // `observed: false` entry in this group was therefore re-checked against the
  // reference at the 9.0 review; the leaf names below are the DOCUMENTED ones,
  // which is the best evidence short of a record, and each stays `observed:
  // false` because a wrong documented name fails loudly rather than storing a
  // wrong number -- exactly as the guessed one did.
  //
  // Documented `beatsPerMinute` (int64). Declared double; see the header for
  // why the two documented-int64 daily averages are not narrowed.
  "daily-resting-heart-rate": { leaf: "beatsPerMinute", leafType: "double", observed: false },

  // OBSERVED 2026-09-12 (Checkpoint 9.0), from a live read-only shape probe
  // over the exact window the five failed hot runs used (2026-09-09..14): the
  // one record carries `dailyHeartRateVariability.{date,
  // averageHeartRateVariabilityMilliseconds, deepSleepRootMeanSquareOf
  // SuccessiveDifferencesMilliseconds}`, both leaves JSON numbers. Google's
  // reference for the DailyHeartRateVariability message agrees, and lists two
  // further OPTIONAL siblings this record did not carry: `entropy` (number)
  // and `nonRemHeartRateBeatsPerMinute` (int64 string). They are deliberately
  // NOT allowlisted: the extractor ignores undeclared fields, so omitting them
  // costs nothing, whereas declaring an unobserved type would reintroduce the
  // exact rejection risk this entry just paid for. Add them when observed.
  //
  // The previous declaration, `rootMeanSquareOfSuccessiveDifferencesMilliseconds`,
  // was the catalog unit string mistaken for a field name. It matched nothing,
  // extractValue returned `leaf_missing`, and the run was classified
  // `value_shape_violation` -- five times, identically, until the breaker
  // disabled the stream. No row was ever written.
  //
  // The daily average is the primary value, in the `heart-rate` precedent
  // (Avg primary, Min/Max in the breakdown): the deep-sleep RMSSD is a
  // sibling detail of the same day, not a second stream. Documentation states
  // "at least one of" the four value fields must be set, so a record carrying
  // only a deep-sleep or entropy value is expressible upstream and would be
  // rejected here as `leaf_missing`. That is a known, loud gap rather than a
  // silent one, and it is not widened speculatively.
  "daily-heart-rate-variability": {
    leaf: "averageHeartRateVariabilityMilliseconds",
    leafType: "double",
    breakdown: [
      { name: "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds", type: "double" },
    ],
    observed: true,
  },
  // CORRECTED at the 9.0 review, UNOBSERVED. The merge-time leaf was
  // `percentage` -- the catalog unit string again, the same mistake as HRV.
  // The DailyOxygenSaturation message documents `averagePercentage` (number)
  // as the value, alongside `lowerBoundPercentage` / `upperBoundPercentage`
  // (required) and `standardDeviationPercentage` (optional). The bounds are
  // NOT allowlisted into the breakdown for the reason given on the HRV entry:
  // an undeclared field costs nothing, an unobserved declaration can reject.
  "daily-oxygen-saturation": {
    leaf: "averagePercentage",
    leafType: "double",
    observed: false,
  },
  // CORRECTED at the 9.0 review, UNOBSERVED. Merge-time leaf `breathsPerMinute`
  // is the catalog unit; the DailyRespiratoryRate message documents
  // `averageBreathsPerMinute` (int64, declared double per the header) with
  // `standardDeviationBreathsPerMinute` optional and not allowlisted.
  "daily-respiratory-rate": {
    leaf: "averageBreathsPerMinute",
    leafType: "double",
    observed: false,
  },
  // KNOWN NOT TO MATCH, and left that way DELIBERATELY. The
  // DailySleepTemperatureDerivations message documents no `celsiusDelta`; it
  // carries `nightlyTemperatureCelsius` -- "the mean of skin temperature
  // samples taken from the user's sleep", an ABSOLUTE temperature -- plus an
  // optional `baselineTemperatureCelsius` (30-day median) and
  // `relativeNightlyStddev30dCelsius`. The catalog unit `celsiusDelta` is the
  // display key the mobile formatter renders as a SIGNED DELTA ("+0.3 °C"),
  // so re-pointing this leaf at the documented field would store ~33 °C and
  // render it as "+33.4 °C": a wrong-looking number, which is the one outcome
  // this module exists to prevent. The honest value under the product's delta
  // semantic is nightly MINUS baseline, a derivation the single-leaf spec
  // model cannot express. Until that is decided (derive, or store the absolute
  // and change the display key -- a mobile change), this entry matches
  // nothing on purpose and the first real record fails loudly, as HRV did.
  "daily-sleep-temperature-derivations": {
    leaf: "celsiusDelta",
    leafType: "double",
    observed: false,
  },
  // Documented `vo2Max` (number); agrees with the declaration.
  "daily-vo2-max": { leaf: "vo2Max", leafType: "double", observed: false },

  // --- Body samples, list ---------------------------------------------------
  // UNVERIFIED. Both leaf names agree with the reference. `weightGrams` is
  // documented as `number`, so the merge-time int64 declaration was corrected
  // to double at the 9.0 review (see the header).
  weight: { leaf: "weightGrams", leafType: "double", observed: false },
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
