// Sleep and exercise sessions.
//
// TIMES ARE RENDERED IN THE ZONE THEY WERE LIVED, not the viewer's current
// one. Every session row carries `start_utc_offset_seconds` and
// `end_utc_offset_seconds` as independent stored facts, so the civil clock is
// recovered losslessly by shifting the instant by its own offset and reading
// UTC components. Formatting through `toLocaleTimeString` instead would
// re-express last Tuesday's 22:41 bedtime in whatever zone the phone is in
// today -- which turns a travel week into a set of times nobody went to bed
// at. This is NOT the conversion ADR-048 forbids: that rule exists to stop a
// civil date being INVENTED from a guessed timezone, whereas here the
// provider supplies the instant and its exact offset as separate facts.
//
// A sleep session is attributed to the civil date it ENDED -- the morning you
// woke (ADR-049). `wake_local_date` is named for that meaning, and it is the
// axis the provider filter and the tombstone sweep use too.
import { Text, View } from "react-native";
import type { HealthSleepSession, HealthWorkoutSession } from "@personal-os/schema";
import { formatShortDate } from "@/utils/local-date";
import { formatDuration } from "./format";

const CARD_CLASS = "rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";
const ROW_CLASS = "border-b border-neutral-100 px-4 py-3 dark:border-neutral-900";

/**
 * Detail Personal OS does not have, said once, in one place.
 *
 * Exported so the workouts screen and any future surface share a single
 * sentence rather than each inventing its own wording for the same gap. The
 * gap is ours, not Google's: the Checkpoint 6.3 sync engine stores an
 * allowlisted SessionDetail of {source, sessionType, sessionSubtype} only.
 */
export const WORKOUT_DETAIL_NOTE =
  "Distance, calories and heart-rate zones aren't shown — Personal OS doesn't store those details from Google Health yet.";

/** The same statement for sleep stages. */
export const SLEEP_STAGE_NOTE =
  "Stage detail (deep, REM, awake) isn't shown — Personal OS doesn't store a stage breakdown from Google Health yet.";

/**
 * `HH:MM` in the session end's own civil clock.
 *
 * Manual UTC-component assembly rather than a locale formatter, for the
 * reason in this file's header, and 24-hour to match the time shape Today
 * already uses.
 */
export function civilTime(iso: string, offsetSeconds: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const shifted = new Date(ms + offsetSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** `YYYY-MM-DD` in the given end's own civil clock. */
export function civilDate(iso: string, offsetSeconds: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const shifted = new Date(ms + offsetSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function LabelledValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
        {label}
      </Text>
      <Text className="text-base text-black dark:text-white">{value}</Text>
    </View>
  );
}

export interface SleepSummaryCardProps {
  session: HealthSleepSession | null;
  /** HealthSummaryResponse.sleep_7d_average_seconds. */
  averageSeconds: number | null;
  compact?: boolean;
}

export function SleepSummaryCard({ session, averageSeconds, compact }: SleepSummaryCardProps) {
  if (session === null) {
    return (
      <View className={CARD_CLASS} accessible accessibilityLabel="Sleep: no sleep sessions recorded">
        <Text className="text-base font-medium text-black dark:text-white">Sleep</Text>
        <Text className="mt-1 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
          No sleep sessions have reached Google Health yet.
        </Text>
      </View>
    );
  }

  const duration = formatDuration(session.duration_seconds);
  const bedtime = civilTime(session.start_at, session.start_utc_offset_seconds);
  const wake = civilTime(session.end_at, session.end_utc_offset_seconds);
  const wakeDate = formatShortDate(session.wake_local_date);

  const accessibilityLabel = [
    `Sleep, night ending ${wakeDate}`,
    `${duration} total`,
    `bedtime ${bedtime}, woke ${wake}`,
    averageSeconds === null ? null : `seven day average ${formatDuration(averageSeconds)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(". ");

  return (
    <View className={CARD_CLASS} accessible accessibilityLabel={accessibilityLabel}>
      <Text className="text-base font-medium text-black dark:text-white">Sleep</Text>
      <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        Night ending {wakeDate}
      </Text>

      <Text className="mt-2 text-3xl font-semibold text-black dark:text-white">{duration}</Text>

      {/* Stacked on the Rabbit: two side-by-side columns at 480px wide leave
          each label about 60px, which wraps "Bedtime" onto two lines. */}
      <View className={`mt-3 ${compact ? "gap-2" : "flex-row gap-4"}`}>
        <LabelledValue label="Bedtime" value={bedtime} />
        <LabelledValue label="Wake" value={wake} />
      </View>

      {averageSeconds === null ? null : (
        <Text className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          7-day average {formatDuration(averageSeconds)}
        </Text>
      )}

      {/* Rendered from the CONTRACT, not hardcoded: `stages` is always null
          today, but if a future sync change starts storing a breakdown this
          note disappears on its own rather than lying about a gap that has
          been filled. */}
      {session.stages === null ? (
        <Text className="mt-3 text-xs leading-4 text-neutral-500 dark:text-neutral-400">
          {SLEEP_STAGE_NOTE}
        </Text>
      ) : null}
    </View>
  );
}

export function SleepSessionRow({ session }: { session: HealthSleepSession }) {
  const duration = formatDuration(session.duration_seconds);
  const bedtime = civilTime(session.start_at, session.start_utc_offset_seconds);
  const wake = civilTime(session.end_at, session.end_utc_offset_seconds);
  const wakeDate = formatShortDate(session.wake_local_date);

  return (
    <View
      className={ROW_CLASS}
      accessible
      accessibilityLabel={`Night ending ${wakeDate}, ${duration}, bedtime ${bedtime}, woke ${wake}`}
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-base text-black dark:text-white">{wakeDate}</Text>
        <Text className="text-base font-semibold text-black dark:text-white">{duration}</Text>
      </View>
      <Text className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
        {bedtime} → {wake}
      </Text>
    </View>
  );
}

/**
 * Provider strings verbatim.
 *
 * `session_type`/`session_subtype` have never been observed on this account
 * (Checkpoint 6.3L), so there is no vocabulary to map and any prettifying
 * would be inventing one. A null type gets the neutral word "Workout" rather
 * than a guess.
 */
function workoutTitle(session: HealthWorkoutSession): string {
  const parts = [session.session_type, session.session_subtype].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return parts.length === 0 ? "Workout" : parts.join(" · ");
}

export function WorkoutSessionRow({ session }: { session: HealthWorkoutSession }) {
  const title = workoutTitle(session);
  const duration = formatDuration(session.duration_seconds);
  const startTime = civilTime(session.start_at, session.start_utc_offset_seconds);
  const startDate = formatShortDate(session.start_local_date);

  return (
    <View
      className={ROW_CLASS}
      accessible
      accessibilityLabel={`${title}, ${startDate} at ${startTime}, ${duration}`}
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-base text-black dark:text-white" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-base font-semibold text-black dark:text-white">{duration}</Text>
      </View>
      <Text className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
        {startDate} at {startTime}
      </Text>
      {/* distance_meters / calories_kcal / heart_rate_zones are always null
          today. Their rows are OMITTED entirely rather than printed with an
          empty value: a "Distance" label with nothing beside it reads as a
          measurement of nothing. The standing gap is stated once per screen
          via WORKOUT_DETAIL_NOTE instead of once per row. */}
    </View>
  );
}
