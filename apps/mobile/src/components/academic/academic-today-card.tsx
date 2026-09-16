// The "Academics" card for the Today screen (Checkpoint 10.2, ADR-070) --
// the deterministic successor to Checkpoint 10.1's Canvas upcoming-
// assignments card, now over `GET /academic/today`, whose overdue / due-today
// / due-this-week buckets are computed server-side under the same `tz` and
// the same rules as `/today`'s own sections.
//
// Owns its own query, exactly like HealthTodayCard / MailDigestCard /
// BriefCard above it on Today -- a slow or failing Canvas sync must never
// delay, blank, or error the command centre. Renders NOTHING at all (not an
// empty state) while loading, on an error, when the server is not configured
// for academics, or when there is nothing to show (see
// shouldRenderAcademicCard): a permanent not-configured placeholder would be
// clutter on the busiest screen in the app, and a card that appears a moment
// late is a smaller disruption than one that appears and then vanishes.
//
// Nothing here is AI. This card renders the server's read model verbatim and
// derives nothing: no bucketing, no counting, no re-sorting.
import { useRouter, type Href } from "expo-router";
import type { AcademicAssignment } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";
import { useAcademicToday } from "@/queries/academic";
import {
  shouldRenderAcademicCard,
  visibleAcademicSections,
  type AcademicSectionTone,
} from "./academic-today-card-state";
import {
  courseLabel,
  formatDueLabel,
  pluralize,
  submissionBadge,
  type SubmissionBadgeTone,
} from "./format";
import { SourceLink } from "./source-link";

const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

/**
 * The course list. Typed through `Href` rather than as a bare literal for the
 * reason health-today-card.tsx records: expo-router's route union is a
 * GENERATED, gitignored artifact, so a route added in the same changeset as
 * its first caller cannot typecheck until expo regenerates it.
 */
const ACADEMIC_ROUTE = "/academic" as Href;

const SECTION_TONE_CLASS: Record<AcademicSectionTone, string> = {
  red: "text-red-600 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  neutral: "text-neutral-500 dark:text-neutral-400",
};

const BADGE_TONE_CLASS: Record<SubmissionBadgeTone, string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-700 dark:text-green-300",
  neutral: "text-neutral-500 dark:text-neutral-400",
};

function AssignmentRow({ item }: { item: AcademicAssignment }) {
  const course = courseLabel(item.course_code, item.course_name);
  const due = formatDueLabel(item.due_at);
  const badge = submissionBadge(item.submission);
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${item.title}, ${course}, due ${due}${badge ? `, ${badge.text}` : ""}`}
      className="min-h-[44px] justify-center border-b border-neutral-100 py-2 last:border-b-0 dark:border-neutral-900 active:opacity-70"
    >
      <Text className="text-sm font-medium text-black dark:text-white" numberOfLines={1}>
        {item.title}
      </Text>
      <View className="mt-0.5 flex-row items-center gap-2">
        <Text className="shrink text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {course}
        </Text>
        <Text className="text-xs text-neutral-400 dark:text-neutral-500">·</Text>
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">{due}</Text>
        {badge ? (
          <Text className={`text-xs font-medium ${BADGE_TONE_CLASS[badge.tone]}`}>
            {badge.text}
          </Text>
        ) : null}
      </View>
    </SourceLink>
  );
}

export function AcademicTodayCard() {
  const router = useRouter();
  const query = useAcademicToday();
  const data = query.data;

  // Nothing while loading and nothing on an error -- the HealthTodayCard
  // convention: this card is not the place to explain a Canvas outage, and
  // a server with no active connection answers `configured: false` rather
  // than an error, so "no data yet" and "not configured" both correctly
  // render nothing here.
  if (data === undefined) return null;
  if (!shouldRenderAcademicCard(data)) return null;

  const sections = visibleAcademicSections(data);
  const unread = data.summary.unread_announcements_total;

  return (
    <View className={CARD_CLASS} accessibilityRole="summary">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-medium text-black dark:text-white">Academics</Text>
        <Pressable
          onPress={() => router.push(ACADEMIC_ROUTE)}
          accessibilityRole="button"
          accessibilityLabel="View courses"
          hitSlop={8}
          className="min-h-[44px] justify-center active:opacity-70"
        >
          <Text className="text-sm text-blue-600 dark:text-blue-400">Courses ›</Text>
        </Pressable>
      </View>

      {sections.map((section) => (
        <View key={section.key} className="mt-2">
          <Text
            className={`pb-1 text-xs font-semibold uppercase ${SECTION_TONE_CLASS[section.tone]}`}
          >
            {section.title} · {section.total}
          </Text>
          {section.rows.map((item) => (
            <AssignmentRow key={item.id} item={item} />
          ))}
          {section.hiddenCount > 0 ? (
            <Text className="pt-1 text-xs text-neutral-500 dark:text-neutral-400">
              +{section.hiddenCount} more
            </Text>
          ) : null}
        </View>
      ))}

      {unread > 0 ? (
        <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {pluralize(unread, "unread announcement")}
        </Text>
      ) : null}
    </View>
  );
}
