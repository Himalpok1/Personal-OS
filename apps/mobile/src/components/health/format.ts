// Pure, React-free presentation formatting for Health values and labels --
// same split as brief/brief-card-state.ts: formatting decisions get real
// vitest coverage here, the .tsx files stay thin.
//
// UNITS ARE METRIC BY CONSTRUCTION, and this module deliberately contains no
// conversion table beyond scaling within the metric system. ADR-047 records
// that the Google Health API bakes the unit into the field name itself
// (`distance.millimetersSum`, `totalCalories.kcalSum`), which is why there is
// no unit column anywhere in the schema. Introducing an imperial conversion
// here would be inventing a number the provider never sent; a future
// imperial-display preference belongs in one explicit, tested conversion layer
// with its own decision record, not smuggled into a formatter.

/**
 * Every `unit` string the catalog can emit
 * (packages/health-providers/src/google-health-catalog.ts). Listed as a type
 * so a catalog addition surfaces here as a compile-time gap rather than as a
 * silent fallthrough to the raw string.
 */
export type HealthUnit =
  | "count"
  | "millimeters"
  | "minutes"
  | "caloriesKcal"
  | "seconds"
  | "beatsPerMinute"
  | "rootMeanSquareOfSuccessiveDifferencesMilliseconds"
  | "percentage"
  | "breathsPerMinute"
  | "celsiusDelta"
  | "vo2Max"
  | "weightGrams";

export interface FormattedHealthValue {
  /** The number as it should be printed. Never "NaN", never a fabricated "0". */
  text: string;
  /** The unit word, or "" where the number carries its own unit (durations). */
  unitLabel: string;
}

/**
 * Strict decimal test rather than `Number(value)`.
 *
 * `Number("")` and `Number(" ")` are both 0, and `Number("0x10")` is 16 --
 * every one of which would turn unreadable input into a confident wrong
 * number, which is the single failure this whole surface exists to avoid.
 * Postgres numeric only ever emits plain decimal (optionally exponential), so
 * nothing legitimate is rejected.
 */
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function parseExact(value: string): number | null {
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Explicit thousands grouping rather than `toLocaleString`.
 *
 * A locale-derived separator would make the same value render differently
 * depending on the device's ICU data, which makes the output untestable
 * without pinning a locale in the test process -- and this app renders numbers
 * nowhere else, so there is no existing convention to match. Grouping is
 * therefore stated here, deterministically, and a locale-aware variant can
 * replace it wholesale if a second user ever needs one.
 */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fixed(n: number, decimals: number): string {
  const rendered = n.toFixed(decimals);
  const negative = rendered.startsWith("-");
  const magnitude = negative ? rendered.slice(1) : rendered;
  const dot = magnitude.indexOf(".");
  const whole = dot === -1 ? magnitude : magnitude.slice(0, dot);
  const fraction = dot === -1 ? "" : magnitude.slice(dot);
  return `${negative ? "-" : ""}${group(whole)}${fraction}`;
}

/**
 * Whole hours and minutes, e.g. "7h 42m", "48m", "0m".
 *
 * `0m` is a real answer -- a session of zero length, or a summed sedentary
 * total that genuinely is zero. It is never used to stand in for an absent
 * value; that case never reaches a formatter at all (see metric-state.ts).
 *
 * Minutes are always printed alongside a non-zero hour ("7h 0m" rather than
 * "7h") so a column of durations keeps a constant shape.
 */
export function formatDuration(seconds: number): string {
  // The schema pins duration_seconds at >= 0, so a negative here is corrupt
  // input rather than a real short session; clamping is safer than printing a
  // negative duration.
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // Round to whole minutes FIRST, then split -- rounding after the split turns
  // 3599s into "0h 60m".
  const totalMinutes = Math.round(safe / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Format one exact numeric string for display.
 *
 * The input is a string because the column is Postgres numeric -- exact for
 * both int64 counts and decimal kcal -- and coercing at the API boundary would
 * reintroduce the float imprecision numeric exists to avoid
 * (HealthMetricPointSchema's own comment says so).
 *
 * Unreadable input returns the raw string verbatim. It must never become "0",
 * and it must never become "NaN": both read as data, and one of them reads as
 * the specific wrong data this surface is most careful about.
 */
export function formatHealthValue(value: string, unit: string): FormattedHealthValue {
  const n = parseExact(value);
  if (n === null) return { text: value.trim(), unitLabel: "" };

  switch (unit as HealthUnit) {
    case "count":
      // Steps and floors are whole things; the API returns int64 strings.
      return { text: fixed(n, 0), unitLabel: "" };
    case "millimeters":
      // Metric scaling only -- millimetres to kilometres, never to miles.
      return { text: fixed(n / 1_000_000, 2), unitLabel: "km" };
    case "minutes":
      return { text: fixed(n, 0), unitLabel: "min" };
    case "caloriesKcal":
      return { text: fixed(n, 0), unitLabel: "kcal" };
    case "seconds":
      // Durations carry their own units inside the text.
      return { text: formatDuration(n), unitLabel: "" };
    case "beatsPerMinute":
      return { text: fixed(n, 0), unitLabel: "bpm" };
    case "rootMeanSquareOfSuccessiveDifferencesMilliseconds":
      return { text: fixed(n, 0), unitLabel: "ms" };
    case "percentage":
      return { text: fixed(n, 1), unitLabel: "%" };
    case "breathsPerMinute":
      return { text: fixed(n, 1), unitLabel: "br/min" };
    case "celsiusDelta":
      // A delta's sign is the whole content of the number, so it is always
      // printed -- "0.3" and "-0.3" must not look like the same reading.
      return { text: `${n > 0 ? "+" : ""}${fixed(n, 1)}`, unitLabel: "°C" };
    case "vo2Max":
      return { text: fixed(n, 1), unitLabel: "mL/kg/min" };
    case "weightGrams":
      return { text: fixed(n / 1000, 1), unitLabel: "kg" };
    default:
      // An unrecognised unit prints the exact number the provider sent with no
      // unit word attached -- guessing one would be asserting a unit we do not
      // know, which is worse than printing none.
      return { text: fixed(n, 2).replace(/\.00$/, ""), unitLabel: "" };
  }
}

/**
 * Human labels for every catalog metric.
 *
 * Names track the provider's own vocabulary rather than a friendlier
 * consumer-app synonym: "Oxygen saturation", not "Blood oxygen". Renaming a
 * measurement is the first step toward interpreting it, and nothing in this
 * surface interprets anything.
 */
export const METRIC_LABELS: Record<string, string> = {
  steps: "Steps",
  distance: "Distance",
  "active-zone-minutes": "Active Zone Minutes",
  "active-energy-burned": "Active calories",
  "total-calories": "Total calories",
  "sedentary-period": "Sedentary time",
  floors: "Floors climbed",
  "heart-rate": "Heart rate",
  "heart-rate-intraday": "Heart rate (detailed)",
  "daily-resting-heart-rate": "Resting heart rate",
  "daily-heart-rate-variability": "Heart rate variability",
  "daily-oxygen-saturation": "Oxygen saturation",
  "daily-respiratory-rate": "Respiratory rate",
  "daily-sleep-temperature-derivations": "Sleep skin temperature",
  "daily-vo2-max": "VO₂ max",
  weight: "Weight",
  "body-fat": "Body fat",
  sleep: "Sleep",
  exercise: "Exercise",
};

/** Compact labels for the Rabbit R1's 480px-wide layout. */
export const METRIC_SHORT_LABELS: Record<string, string> = {
  steps: "Steps",
  distance: "Distance",
  "active-zone-minutes": "Zone min",
  "active-energy-burned": "Active cal",
  "total-calories": "Total cal",
  "sedentary-period": "Sedentary",
  floors: "Floors",
  "heart-rate": "Heart rate",
  "heart-rate-intraday": "HR detail",
  "daily-resting-heart-rate": "Resting HR",
  "daily-heart-rate-variability": "HRV",
  "daily-oxygen-saturation": "SpO₂",
  "daily-respiratory-rate": "Resp rate",
  "daily-sleep-temperature-derivations": "Skin temp",
  "daily-vo2-max": "VO₂ max",
  weight: "Weight",
  "body-fat": "Body fat",
  sleep: "Sleep",
  exercise: "Exercise",
};

/**
 * Title-cased kebab split, used only when Google adds a metric before this map
 * does. Deliberately not a throw: `metric` is unconstrained text in both
 * Postgres and Zod (ADR-050), so an unknown id is an expected future state,
 * and a screen that crashes on it is worse than one that reads slightly stiff.
 */
function fallbackLabel(metric: string): string {
  const words = metric.split("-").filter(Boolean);
  if (words.length === 0) return metric;
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

// Own-property check via .call rather than `metric in map`: `metric` is
// unconstrained provider text, and `in` would happily resolve "constructor" or
// "toString" to an inherited function.
function ownLabel(map: Record<string, string>, metric: string): string | null {
  return Object.prototype.hasOwnProperty.call(map, metric) ? map[metric] : null;
}

export function metricLabel(metric: string): string {
  return ownLabel(METRIC_LABELS, metric) ?? fallbackLabel(metric);
}

export function metricShortLabel(metric: string): string {
  return ownLabel(METRIC_SHORT_LABELS, metric) ?? fallbackLabel(metric);
}
