// The "Academics" card for the Today screen (Checkpoint 10.2, ADR-070;
// redesigned in Checkpoint 10.3 as the academic intelligence card) -- over
// `GET /academic/today`, whose overdue / due-today / due-this-week buckets,
// ranked priorities, workload status and per-day workload are ALL computed
// server-side under the same `tz` and the same rules as `/today`'s own
// sections.
//
// Owns its own query, exactly like HealthTodayCard / MailDigestCard /
// BriefCard above it on Today -- a slow or failing Canvas sync must never
// delay, blank, or error the command centre. Renders NOTHING at all (not an
// empty state) while loading, on an error, when the server is not configured
// for academics, or when there is nothing to act on (see
// shouldRenderAcademicCard): a permanent not-configured placeholder would be
// clutter on the busiest screen in the app, and a card that appears a moment
// late is a smaller disruption than one that appears and then vanishes.
//
// Nothing here is AI. This card renders the server's read model verbatim and
// derives nothing: no bucketing, no counting, no re-sorting, no urgency of
// its own -- every chip is a word for a value the server sent. The three
// Checkpoint 10.3 keys are OPTIONAL on the wire (an older server omits them)
// and every block guards on their absence.
//
// Checkpoint 10.6 (ADR-076 §3): an assignment row no longer leaves the app
// on a tap. It opens the in-app assignment sheet (assignment-sheet.tsx --
// the screen mounts its one host), which shows the assignment's facts and
// only then offers "Open in Canvas" through SourceLink, so this file no
// longer imports SourceLink at all. The workload bars grow in on mount.
import { useRouter, type Href } from "expo-router";
import type { AcademicAssignment, AcademicPriorityItem } from "@personal-os/schema";
import { Pressable, View } from "react-native";
import { AppText, Card, Icon, ListRow, SectionHeader, StatusChip, useTheme } from "@/components/ui";
import { useAcademicToday } from "@/queries/academic";
import {
  shouldRenderAcademicCard,
  visibleAcademicSections,
  visiblePriorities,
  type AcademicSectionTone,
} from "./academic-today-card-state";
import { openAssignmentSheet } from "./assignment-sheet";
import { courseLabel, formatDueLabel, pluralize, submissionBadge } from "./format";
import { badgeChipTone, urgencyChip } from "./urgency-chip";
import { courseFocusRow } from "./course-focus";
import { WorkloadBar } from "./workload-bar";
import { workloadChip } from "./workload-state";
import { workloadStripColumns, workloadStripLabel } from "./workload-strip";

/**
 * The course list. Typed through `Href` rather than as a bare literal for the
 * reason health-today-card.tsx records: expo-router's route union is a
 * GENERATED, gitignored artifact, so a route added in the same changeset as
 * its first caller cannot typecheck until expo regenerates it.
 */
const ACADEMIC_ROUTE = "/academic" as Href;

function courseRoute(id: string): Href {
  return `/academic/${encodeURIComponent(id)}` as Href;
}

const SECTION_TONE: Record<AcademicSectionTone, "danger" | "info" | "default"> = {
  red: "danger",
  blue: "info",
  neutral: "default",
};

function AssignmentRow({ item, last }: { item: AcademicAssignment; last: boolean }) {
  const course = courseLabel(item.course_code, item.course_name);
  const due = formatDueLabel(item.due_at);
  const badge = submissionBadge(item.submission);
  return (
    <ListRow
      title={item.title}
      subtitle={`${course} · ${due}`}
      trailingChips={badge ? [{ tone: badgeChipTone(badge.tone), label: badge.text }] : undefined}
      onPress={() => openAssignmentSheet({ assignment: item })}
      accessibilityLabel={`${item.title}, ${course}, due ${due}${badge ? `, ${badge.text}` : ""}`}
      inset
      chevron
      last={last}
    />
  );
}

function PriorityRow({ item, last }: { item: AcademicPriorityItem; last: boolean }) {
  const { assignment } = item;
  const course = courseLabel(assignment.course_code, assignment.course_name);
  const due = formatDueLabel(assignment.due_at);
  const chip = urgencyChip(item.urgency);
  const badge = submissionBadge(assignment.submission);
  return (
    <ListRow
      title={assignment.title}
      subtitle={`${course} · ${due}`}
      trailingChips={[
        { tone: chip.tone, label: chip.label },
        ...(badge ? [{ tone: badgeChipTone(badge.tone), label: badge.text }] : []),
      ]}
      onPress={() => openAssignmentSheet({ assignment })}
      accessibilityLabel={`${assignment.title}, ${course}, due ${due}, ${chip.label}${
        badge ? `, ${badge.text}` : ""
      }`}
      inset
      chevron
      last={last}
    />
  );
}

function WorkloadStrip({ days }: { days: Parameters<typeof workloadStripColumns>[0] }) {
  // A raw colour is unavoidable for a drawn bar (theme.ts: "a chart stroke"),
  // so it comes from the resolved palette, never a hex or a `dark:` class.
  const { colors } = useTheme();
  const columns = workloadStripColumns(days);
  if (columns.length === 0) return null;
  return (
    <View
      className="mt-3"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={workloadStripLabel(columns)}
    >
      <AppText variant="overline" tone="muted">
        This week
      </AppText>
      <View className="mt-1.5 flex-row items-end gap-1.5">
        {columns.map((column) => (
          <View key={column.date} className="flex-1 items-center">
            <WorkloadBar
              heightPx={column.heightPx}
              color={column.dueTotal > 0 ? colors.primary : colors["outline-strong"]}
              testID={`workload-bar-${column.date}`}
            />
            <AppText variant="caption" tone="muted" className="mt-1">
              {column.weekdayInitial}
            </AppText>
          </View>
        ))}
      </View>
    </View>
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

  const priorities = visiblePriorities(data);
  // The bucket sections skip whatever "Do next" already lists (see
  // visibleAcademicSections): the priority candidates ARE the three buckets.
  const sections = visibleAcademicSections(
    data,
    new Set(priorities?.rows.map((row) => row.assignment.id) ?? []),
  );
  const workload = data.workload === undefined ? null : workloadChip(data.workload);
  const focus = courseFocusRow(data);
  const termName = data.current_term?.name ?? null;
  const unread = data.summary.unread_announcements_total;

  return (
    <Card className="mb-3" accessibilityRole="summary">
      <SectionHeader
        title="Academics"
        icon="school-outline"
        spacing="none"
        trailing={
          <Pressable
            onPress={() => router.push(ACADEMIC_ROUTE)}
            accessibilityRole="button"
            accessibilityLabel="View courses"
            hitSlop={8}
            className="min-h-[44px] flex-row items-center justify-center active:opacity-70"
          >
            <AppText variant="label" tone="primary">
              Courses ›
            </AppText>
          </Pressable>
        }
      />
      {termName ? (
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {termName}
        </AppText>
      ) : null}

      {workload ? (
        <View className="mt-2 flex-row flex-wrap items-center gap-2">
          <StatusChip tone={workload.tone} label={workload.label} size="md" dot />
          {workload.detail ? (
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {workload.detail}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {/* "Which courses need focus?" -- the server's course_attention, one
          chip per course at high (danger) or medium (warning) attention. */}
      {focus ? (
        <View
          className="mt-2 flex-row flex-wrap items-center gap-1.5"
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`Needs focus: ${focus.chips
            .map((c) => `${c.label} (${c.reason})`)
            .join(", ")}${focus.hiddenCount > 0 ? `, and ${focus.hiddenCount} more` : ""}`}
        >
          <AppText variant="caption" tone="muted">
            Focus on
          </AppText>
          {focus.chips.map((chip) => (
            <Pressable
              key={chip.courseId}
              onPress={() => router.push(courseRoute(chip.courseId))}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Open course: ${chip.label}`}
              className="active:opacity-70"
            >
              <StatusChip tone={chip.tone} label={chip.label} />
            </Pressable>
          ))}
          {focus.hiddenCount > 0 ? (
            <AppText variant="caption" tone="muted">
              +{focus.hiddenCount}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {priorities ? (
        <View className="mt-3">
          <View className="flex-row items-center gap-1.5 pb-1">
            <Icon name="flag-outline" size="sm" tone="primary" />
            <AppText variant="overline" tone="primary">
              Do next
            </AppText>
          </View>
          {priorities.rows.map((item, index) => (
            <PriorityRow
              key={item.assignment.id}
              item={item}
              last={index === priorities.rows.length - 1}
            />
          ))}
          {priorities.hiddenCount > 0 ? (
            <AppText variant="caption" tone="muted" className="pt-1">
              +{priorities.hiddenCount} more
            </AppText>
          ) : null}
        </View>
      ) : null}

      {sections.map((section) => (
        <View key={section.key} className="mt-3">
          <SectionHeader
            title={section.title}
            count={section.total}
            tone={SECTION_TONE[section.tone]}
            spacing="none"
            className="pb-1"
          />
          {section.rows.map((item, index) => (
            <AssignmentRow key={item.id} item={item} last={index === section.rows.length - 1} />
          ))}
          {section.hiddenCount > 0 ? (
            <AppText variant="caption" tone="muted" className="pt-1">
              +{section.hiddenCount} more
            </AppText>
          ) : null}
        </View>
      ))}

      {data.workload ? <WorkloadStrip days={data.workload.days} /> : null}

      {unread > 0 ? (
        <View className="mt-3 flex-row items-center gap-1.5">
          <Icon name="bullhorn-outline" size="sm" tone="on-surface-muted" />
          <AppText variant="caption" tone="muted">
            {pluralize(unread, "unread announcement")}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}
