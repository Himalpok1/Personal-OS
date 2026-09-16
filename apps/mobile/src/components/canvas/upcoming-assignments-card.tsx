// Canvas "upcoming assignments" card for the Today screen (Checkpoint 10.1,
// ADR-068).
//
// Owns its own query, exactly like HealthTodayCard/MailDigestCard/BriefCard
// above it on Today -- a slow or failing Canvas sync must never delay, blank,
// or error the command centre. Renders nothing at all (not an empty state)
// when there is no active connection or nothing due soon, the same posture
// HealthTodayCard documents for the identical reason: a permanent
// not-configured placeholder would be clutter on the busiest screen in the
// app, and a card that appears a moment late is a smaller disruption than
// one that appears and then vanishes.
import { Linking, Pressable, Text, View } from "react-native";
import { useCanvasUpcomingAssignments } from "@/queries/canvas";

const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

/** At most this many rows on Today -- the same headline-count discipline HealthTodayCard applies. */
const MAX_ROWS = 5;

function formatDue(iso: string | null): string {
  if (iso === null) return "No due date";
  const date = new Date(iso);
  const dayLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dayLabel} · ${timeLabel}`;
}

/**
 * `html_url` is Canvas-generated, not user-typed, but it is still
 * provider-supplied content this project does not control, and
 * `Linking.openURL` opens whatever it is given (the one thing
 * `mobile-inert-rendering.test.ts` requires every such call site to
 * justify). This turns "trust Canvas's own link" into a checked invariant:
 * a row only opens if `html_url`'s origin is exactly the same connection's
 * own `canvas_base_url` origin, so this card can never navigate anywhere
 * other than the owner's own configured Canvas instance. Malformed URLs
 * fail closed (not openable) rather than throwing.
 */
function isOwnCanvasOrigin(htmlUrl: string, canvasBaseUrl: string): boolean {
  try {
    return new URL(htmlUrl).origin === new URL(canvasBaseUrl).origin;
  } catch {
    return false;
  }
}

export function CanvasUpcomingAssignmentsCard() {
  const query = useCanvasUpcomingAssignments();
  const items = query.data?.items;

  // Nothing while loading and nothing on an error -- the HealthTodayCard
  // convention, for the identical reason: this card is not the place to
  // explain a Canvas outage, and a server with no Canvas connection
  // configured answers `{ items: [] }` rather than an error, so "no data
  // yet" and "not configured" both correctly render nothing here.
  if (items === undefined || items.length === 0) return null;

  const rows = items.slice(0, MAX_ROWS);

  return (
    <View className={CARD_CLASS} accessibilityRole="summary">
      <Text className="text-base font-medium text-black dark:text-white">Canvas</Text>
      <View className="mt-2">
        {rows.map((item) => {
          const openable =
            item.html_url !== null && isOwnCanvasOrigin(item.html_url, item.canvas_base_url);
          return (
          <Pressable
            key={item.id}
            disabled={!openable}
            onPress={() => {
              if (openable) void Linking.openURL(item.html_url!);
            }}
            accessibilityRole={openable ? "link" : undefined}
            accessibilityLabel={`${item.title}, ${item.course_name}, due ${formatDue(item.due_at)}`}
            hitSlop={4}
            className="min-h-[44px] justify-center border-b border-neutral-100 py-2 last:border-b-0 dark:border-neutral-900 active:opacity-70"
          >
            <Text className="text-sm font-medium text-black dark:text-white" numberOfLines={1}>
              {item.title}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-2">
              <Text
                className="shrink text-xs text-neutral-500 dark:text-neutral-400"
                numberOfLines={1}
              >
                {item.course_name}
              </Text>
              <Text className="text-xs text-neutral-400 dark:text-neutral-500">·</Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {formatDue(item.due_at)}
              </Text>
              {item.submission_missing === true ? (
                <Text className="text-xs font-medium text-red-600 dark:text-red-400">Missing</Text>
              ) : item.submission_late === true ? (
                <Text className="text-xs font-medium text-amber-600 dark:text-amber-400">Late</Text>
              ) : null}
            </View>
          </Pressable>
          );
        })}
      </View>
    </View>
  );
}
