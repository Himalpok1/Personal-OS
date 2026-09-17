import { ApiClientError } from "@personal-os/api-client";
import type {
  AcademicAnnouncement,
  AcademicAssignment,
  AcademicCourseSummary,
  AcademicEvent,
  AcademicGradeSummary,
} from "@personal-os/schema";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { assignmentUrgency, urgencyContext } from "@/components/academic/assignment-urgency";
import {
  formatDateLabel,
  formatDueLabel,
  formatGradeLabel,
  formatPoints,
  formatWhenLabel,
  submissionBadge,
} from "@/components/academic/format";
import { gradeSummaryView, hasGradedWork } from "@/components/academic/grade-summary-label";
import { partitionAssignments } from "@/components/academic/partition-assignments";
import { isSameOrigin } from "@/components/academic/same-origin";
import { SourceLink } from "@/components/academic/source-link";
import { badgeChipTone, courseStatusChip, urgencyChip } from "@/components/academic/urgency-chip";
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  ListRow,
  ProgressBar,
  Screen,
  ScreenCentered,
  ScreenFrame,
  SectionHeader,
  SkeletonScreen,
  StatusChip,
  type SectionTone,
} from "@/components/ui";
import { useAcademicCourse } from "@/queries/academic";
import { deviceTimezone } from "@/queries/today";

// One course (Checkpoint 10.2, ADR-070; redesigned in Checkpoint 10.3): a
// hero with the course's identity and grade summary, then its assignments
// split into the four sections a student actually scans for, then its
// recent announcements and calendar events. Every row that can open in
// Canvas does so through SourceLink, whose same-origin check is the one
// thing that makes a provider-supplied `html_url` safe to open
// (components/academic/same-origin.ts).
//
// THE CLIENT-SIDE DERIVATIONS on this screen are the overdue / upcoming
// split of already-OPEN rows and the urgency chip on each upcoming row --
// both single instant comparisons against the one `dataUpdatedAt` captured
// per render (partition-assignments.ts and assignment-urgency.ts explain why
// that is permitted here and nowhere else, and the latter goes through
// core's own `deriveUrgency` with the server's own horizon). `open`, grades,
// percentages, the grade summary and course status are all the server's.

function AssignmentRow({
  item,
  urgency,
  last,
}: {
  item: AcademicAssignment;
  urgency: ReturnType<typeof assignmentUrgency>;
  last: boolean;
}) {
  const badge = submissionBadge(item.submission);
  const due = formatDueLabel(item.due_at);
  // A closed row's second line is its grade; an open row's is its due instant.
  const detail = item.open ? due : formatGradeLabel(item.grade, item.points_possible);
  const points =
    item.points_possible === null || !item.open
      ? null
      : `${formatPoints(item.points_possible)} pts`;
  const chip = urgency === null ? null : urgencyChip(urgency);
  // A closed row always carries a badge (Graded / Submitted / Missing / Late
  // -- submissionBadge is null only for a plain open row), so the trailing
  // column is empty only for an open, undated or non-urgent row.
  const chips = [
    chip ? <StatusChip key="urgency" tone={chip.tone} label={chip.label} /> : null,
    badge ? <StatusChip key="badge" tone={badgeChipTone(badge.tone)} label={badge.text} /> : null,
  ].filter((node) => node !== null);
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${item.title}, ${item.open ? `due ${due}` : `grade ${detail}`}${
        chip ? `, ${chip.label}` : ""
      }${badge ? `, ${badge.text}` : ""}`}
      className="active:opacity-70"
    >
      <ListRow
        title={item.title}
        subtitle={points === null ? detail : `${detail} · ${points}`}
        trailing={chips.length === 0 ? null : <View className="items-end gap-1">{chips}</View>}
        last={last}
      />
    </SourceLink>
  );
}

function AssignmentSection({
  title,
  tone,
  items,
  urgencyFor,
}: {
  title: string;
  tone: SectionTone;
  items: AcademicAssignment[];
  urgencyFor?: (item: AcademicAssignment) => ReturnType<typeof assignmentUrgency>;
}) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} count={items.length} tone={tone} />
      <Card padding="none">
        {items.map((item, index) => (
          <AssignmentRow
            key={item.id}
            item={item}
            urgency={urgencyFor === undefined ? null : urgencyFor(item)}
            last={index === items.length - 1}
          />
        ))}
      </Card>
    </View>
  );
}

function AnnouncementRow({ item, last }: { item: AcademicAnnouncement; last: boolean }) {
  const openable = isSameOrigin(item.html_url, item.source_base_url);
  const posted = item.posted_at === null ? null : formatDateLabel(item.posted_at);
  // The unread mark: a fact Canvas reports (`read_state`), rendered only when
  // it is definitely unread -- a null (unknown) read state shows nothing
  // rather than guessing either way.
  const unread = item.read === false;
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${unread ? "Unread. " : ""}${item.title}${
        posted === null ? "" : `, posted ${posted}`
      }`}
      className="active:opacity-70"
    >
      {/* The stored preview is already tag-stripped plain text (ADR-068);
          it lands in <Text>, which interprets nothing. */}
      <ListRow
        title={item.title}
        subtitle={item.preview ?? undefined}
        meta={posted ?? undefined}
        trailing={unread ? <StatusChip tone="primary" label="New" dot /> : null}
        chevron={openable}
        last={last}
      />
    </SourceLink>
  );
}

function EventRow({ item, last }: { item: AcademicEvent; last: boolean }) {
  const when = formatWhenLabel(item);
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${item.title}, ${when}${item.location ? `, ${item.location}` : ""}`}
      className="active:opacity-70"
    >
      <ListRow
        title={item.title}
        subtitle={when}
        meta={item.location ?? undefined}
        icon="calendar-blank-outline"
        iconTone="info"
        last={last}
      />
    </SourceLink>
  );
}

function GradeSummaryBlock({ summary }: { summary: AcademicGradeSummary }) {
  const view = gradeSummaryView(summary);
  const caption = [view.gradedLine, view.averageLine, view.pointsLine]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <View
      className="mt-4"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Grade ${view.headline}, ${caption}`}
    >
      <View className="flex-row items-end justify-between gap-3">
        <AppText variant="display" tone="on-gradient">
          {view.headline}
        </AppText>
        <AppText variant="caption" tone="on-gradient-muted" className="pb-1" numberOfLines={2}>
          {caption}
        </AppText>
      </View>
      {view.fraction === null ? null : (
        <ProgressBar
          value={view.fraction}
          onGradient
          size="md"
          className="mt-2"
          accessibilityLabel={`Weighted grade ${view.headline}`}
        />
      )}
    </View>
  );
}

function CourseHero({
  course,
  gradeSummary,
}: {
  course: AcademicCourseSummary;
  gradeSummary: AcademicGradeSummary | undefined;
}) {
  const meta = [course.code, course.term.name].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );
  const openable = isSameOrigin(course.html_url, course.source_base_url);
  const status = courseStatusChip(course.status);
  return (
    <GradientCard gradient="academic" className="mt-4">
      {meta.length > 0 ? (
        <AppText variant="overline" tone="on-gradient-muted" numberOfLines={1}>
          {meta.join(" · ")}
        </AppText>
      ) : null}
      <AppText variant="headline" tone="on-gradient" className="mt-1" accessibilityRole="header">
        {course.name}
      </AppText>
      {status ? (
        <View className="mt-2 flex-row">
          <StatusChip tone={status.tone} label={status.label} />
        </View>
      ) : null}
      {hasGradedWork(gradeSummary) ? <GradeSummaryBlock summary={gradeSummary} /> : null}
      {/* Shown only when the link can actually open -- an inert "Open in
          Canvas" would promise something the origin check refused. The pill
          is composed here: no primitive exists for a pressable on a gradient. */}
      {openable ? (
        <SourceLink
          htmlUrl={course.html_url}
          sourceBaseUrl={course.source_base_url}
          accessibilityLabel="Open this course in Canvas"
          className="mt-4 min-h-[44px] flex-row items-center justify-center self-start rounded-full border border-white/30 bg-white/20 px-4 py-2 active:opacity-80"
        >
          <AppText variant="label" tone="on-gradient">
            Open in Canvas
          </AppText>
        </SourceLink>
      ) : null}
    </GradientCard>
  );
}

export default function AcademicCourseScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" && params.id.length > 0 ? params.id : null;
  const { data, dataUpdatedAt, isLoading, isError, isRefetching, error, refetch } =
    useAcademicCourse(id);

  if (id === null) {
    return (
      <ScreenCentered>
        <EmptyState size="screen" icon="book-open-outline" title="No course was selected" />
      </ScreenCentered>
    );
  }

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    // A 404 is terminal (the course is archived or its connection is no
    // longer active -- the same answer every time), so the retry affordance
    // appears only for a load failure that could clear.
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          title={status === 404 ? "Course not found" : "Something went wrong"}
          message={
            status === 404
              ? "This course is no longer available from its connection."
              : "Couldn't load this course."
          }
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading this course"
        />
      </ScreenCentered>
    );
  }

  if (isLoading || !data) {
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  // One `now` for the whole render, so no two sections can disagree -- and
  // it is the instant this data was FETCHED, not the instant of the render:
  // `dataUpdatedAt` is the closest thing the client has to the server's own
  // `effective_now`, it is a pure value per render (react-hooks/purity forbids
  // `Date.now()` here for exactly the reason it would be wrong), and it moves
  // forward on every refetch, so a focus refetch re-partitions honestly. The
  // urgency context is built from the same instant and the device zone the
  // Today request sends, so its "this week" edge is the server's.
  const partition = partitionAssignments(data.assignments, dataUpdatedAt);
  const urgency = urgencyContext(dataUpdatedAt, deviceTimezone());
  const urgencyFor = (item: AcademicAssignment) => assignmentUrgency(item.due_at, urgency);

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <CourseHero course={data.course} gradeSummary={data.grade_summary} />

      <AssignmentSection title="Overdue" tone="danger" items={partition.overdue} />
      <AssignmentSection
        title="Upcoming"
        tone="info"
        items={partition.upcoming}
        urgencyFor={urgencyFor}
      />
      <AssignmentSection title="No due date" tone="default" items={partition.undated} />
      <AssignmentSection title="Submitted & graded" tone="success" items={partition.closed} />

      {data.assignments.length === 0 ? (
        <EmptyState
          icon="clipboard-text-outline"
          title="No assignments yet"
          body="No assignments have synced for this course."
          className="mt-4"
        />
      ) : null}

      {data.announcements.length > 0 ? (
        <View>
          <SectionHeader
            title="Announcements"
            count={data.announcements.length}
            icon="bullhorn-outline"
          />
          <Card padding="none">
            {data.announcements.map((item, index) => (
              <AnnouncementRow
                key={item.id}
                item={item}
                last={index === data.announcements.length - 1}
              />
            ))}
          </Card>
        </View>
      ) : null}

      {data.events.length > 0 ? (
        <View>
          <SectionHeader title="Events" count={data.events.length} icon="calendar-blank-outline" />
          <Card padding="none">
            {data.events.map((item, index) => (
              <EventRow key={item.id} item={item} last={index === data.events.length - 1} />
            ))}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
