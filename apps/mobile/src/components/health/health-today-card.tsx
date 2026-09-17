// A small Health summary for the Today screen.
//
// Owns its own query, exactly as brief/brief-card.tsx owns useCurrentBrief --
// so Today never waits on Health. `GET /today` and `GET /health-summary` are
// separate requests and a slow or failing Health sync must not delay, blank,
// or error the command centre.
//
// The whole component is deliberately small. Today is the busiest screen in
// the app on a 480x640 device, and health is passive data (ADR-046): it is
// context, not something to act on. Anything beyond a few numbers and a way
// through to the full view belongs on /health.
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import type { HealthMetricCapability, HealthMetricTile } from "@personal-os/schema";
import { AppText, Card, ListRow } from "@/components/ui";
import { useHealthSummary } from "@/queries/health";
import { formatHealthValue, metricShortLabel } from "./format";
import { resolveMetricDisplay } from "./metric-state";

// Checkpoint 10.3: composed from the design system. The card stays ONE
// pressable (a `Card` with `onPress`); its header is an INERT ListRow (no
// onPress, so no nested pressable) for the heart-pulse icon disc and the
// chevron, and the headline metrics are an inline stat row -- MetricCard is
// a Card itself, so nesting it inside a pressable card would nest
// pressables; the row is composed here instead. Every rule below (nothing
// while loading, nothing when unconfigured, values only, the cap) is
// unchanged.

/**
 * At most this many numbers on Today.
 *
 * Not a hardcoded metric list -- which metrics appear is decided purely by
 * "does this one have a value today", so an account that starts producing
 * sleep or heart rate surfaces them without a code change, and an account
 * that stops producing steps stops showing steps rather than showing a stale
 * or zeroed tile.
 */
const MAX_HEADLINE_METRICS = 4;

/**
 * The Health screen.
 *
 * Typed through `Href` rather than as a bare literal because expo-router's
 * route union lives in `.expo/types/router.d.ts` -- a GENERATED, gitignored
 * artifact listing only the routes that existed the last time expo ran. A
 * route added in the same changeset as its first caller therefore cannot
 * typecheck until that file is regenerated, which needs a Metro/expo run.
 * `Link`'s own `href` prop is typed the same way on the Today screen.
 *
 * Checkpoint 6.4 verified that the generator DOES emit all four /health routes
 * once it runs, so this is a transitional guard for a contributor whose .expo
 * cache predates this changeset -- not a permanent gap in the route types.
 */
const HEALTH_ROUTE = "/health" as Href;

interface Headline {
  metric: string;
  text: string;
  unitLabel: string;
}

function pickHeadlines(
  today: readonly HealthMetricTile[],
  capabilities: readonly HealthMetricCapability[],
  todayLocalDate: string,
): Headline[] {
  const byMetric = new Map(capabilities.map((capability) => [capability.metric, capability]));
  const headlines: Headline[] = [];

  for (const tile of today) {
    if (headlines.length >= MAX_HEADLINE_METRICS) break;
    const capability = byMetric.get(tile.metric);
    if (capability === undefined) continue;

    const display = resolveMetricDisplay({ tile, capability, todayLocalDate });
    // Only a real recorded value earns a slot. A missing metric is not
    // rendered here AT ALL -- not as a zero, not as a dash, not as an
    // explanatory sentence. The full reasons live on /health, where there is
    // room to say them properly.
    if (display.state !== "value" || display.value === null) continue;

    const formatted = formatHealthValue(display.value, tile.unit);
    headlines.push({
      metric: tile.metric,
      text: formatted.text,
      unitLabel: formatted.unitLabel,
    });
  }

  return headlines;
}

export function HealthTodayCard() {
  const router = useRouter();
  const summaryQuery = useHealthSummary();
  const data = summaryQuery.data;

  // Nothing at all while loading, and nothing on an error.
  //
  // The house rule elsewhere is to reserve height rather than collapse, but
  // that rule assumes the element will definitely appear. Here the commonest
  // outcome on a server with no Google Health credentials is that this card
  // renders nothing forever, so reserving a skeleton would mean showing a
  // permanent placeholder for a feature that is not configured. A card that
  // appears a moment late is a smaller disruption than one that appears and
  // then vanishes. On an error we say nothing rather than guessing -- the
  // /health screen has the room to explain that the API is unreachable.
  if (data === undefined) return null;

  // No connection (or no server-side config) means Health is not part of this
  // user's Today. Rendering an empty card would be pure clutter.
  if (!data.configured || data.connection === null) return null;

  const headlines = pickHeadlines(data.today, data.capabilities, data.local_date);

  const accessibilityLabel =
    headlines.length === 0
      ? "Health. No data recorded for today yet. Opens the health screen."
      : `Health. ${headlines
          .map((h) => `${metricShortLabel(h.metric)} ${h.text}${h.unitLabel ? ` ${h.unitLabel}` : ""}`)
          .join(", ")}. Opens the health screen.`;

  return (
    <Card
      onPress={() => router.push(HEALTH_ROUTE)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="mb-3 min-h-[44px]"
    >
      <ListRow title="Health" icon="heart-pulse" iconTone="success" chevron inset last />

      {headlines.length === 0 ? (
        <AppText variant="body" tone="secondary" className="mt-2">
          Nothing recorded for today yet.
        </AppText>
      ) : (
        <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-3">
          {headlines.map((headline) => (
            <View key={headline.metric}>
              <AppText variant="overline" tone="muted" numberOfLines={1}>
                {metricShortLabel(headline.metric)}
              </AppText>
              <AppText variant="headline" numberOfLines={1} className="mt-0.5">
                {headline.text}
                {headline.unitLabel ? (
                  <AppText variant="label" tone="muted">{` ${headline.unitLabel}`}</AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
