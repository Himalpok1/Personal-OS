import type { AcademicCourseSummary } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { courseLabel, formatDueLabel, pluralize } from "@/components/academic/format";
import { groupCoursesByTerm } from "@/components/academic/group-courses";
import { semesterOverview } from "@/components/academic/semester-overview";
import { courseStatusChip } from "@/components/academic/urgency-chip";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  GradientCard,
  Screen,
  ScreenCentered,
  ScreenFrame,
  ScreenHeader,
  SectionHeader,
  SkeletonScreen,
  StatusChip,
} from "@/components/ui";
import { useAcademicCourses } from "@/queries/academic";

// The course list (Checkpoint 10.2, ADR-070; redesigned in Checkpoint 10.3):
// every active connection's CURRENT-TERM courses (ADR-070a), grouped by term
// with the most recent term first, each row carrying the three computed
// facts the server already derived (open count, overdue count, next due
// instant), under one semester-overview hero. "Show past terms" widens the
// query to every term. Reached from the Today card's "Courses ›" and from
// the Canvas section of Settings -- not a sixth tab, for the same 480px
// reason Health, Monitoring and Search are not.
//
// Read-only by construction: there is nothing on this screen that could
// write, because the academic routes expose nothing writable (ADR-068 §2).
// Nothing here is derived either -- the grouping helper only walks the
// server's own order (group-courses.ts) and the hero only sums the
// per-course counts the server sent (semester-overview.ts).

const SETTINGS_ROUTE = "/settings" as Href;

function courseRoute(id: string): Href {
  return `/academic/${encodeURIComponent(id)}` as Href;
}

function CourseCard({ course }: { course: AcademicCourseSummary }) {
  const router = useRouter();
  const hasCode = courseLabel(course.code, course.name) !== course.name;
  const overdue = course.overdue_assignment_count;
  const nextDue = course.next_due_at === null ? null : formatDueLabel(course.next_due_at);
  const status = courseStatusChip(course.status);

  const label = [
    course.code ?? course.name,
    hasCode ? course.name : null,
    pluralize(course.open_assignment_count, "open assignment"),
    pluralize(overdue, "overdue assignment"),
    nextDue === null ? "no upcoming due date" : `next due ${nextDue}`,
    status === null ? null : status.label,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  return (
    <Card
      onPress={() => router.push(courseRoute(course.id))}
      accessibilityLabel={label}
      className="mb-3 min-h-[44px]"
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          <AppText variant="title" numberOfLines={1}>
            {hasCode ? course.code : course.name}
          </AppText>
          {hasCode ? (
            <AppText
              variant="label"
              tone="secondary"
              numberOfLines={2}
              className="mt-0.5 font-normal"
            >
              {course.name}
            </AppText>
          ) : null}
        </View>
        {status ? <StatusChip tone={status.tone} label={status.label} /> : null}
      </View>
      <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
        {overdue > 0 ? <StatusChip tone="danger" label={`${overdue} overdue`} dot /> : null}
        <StatusChip tone="neutral" label={`${course.open_assignment_count} open`} />
        {nextDue === null ? null : <StatusChip tone="info" label={`Next ${nextDue}`} />}
      </View>
    </Card>
  );
}

function SemesterHero({
  courses,
  termName,
  allTerms,
}: {
  courses: readonly AcademicCourseSummary[];
  termName: string | null;
  allTerms: boolean;
}) {
  const overview = semesterOverview(courses);
  const nextDue = overview.nextDueAt === null ? "—" : formatDueLabel(overview.nextDueAt);
  return (
    <GradientCard gradient="academic" className="mt-4">
      <AppText variant="overline" tone="on-gradient-muted" numberOfLines={1}>
        {allTerms ? "All terms" : (termName ?? "Current term")}
      </AppText>
      <AppText variant="headline" tone="on-gradient" className="mt-1" numberOfLines={1}>
        {pluralize(overview.courseCount, "course")}
      </AppText>
      <View className="mt-4 flex-row gap-5">
        <View>
          <AppText variant="display" tone="on-gradient">
            {String(overview.openTotal)}
          </AppText>
          <AppText variant="caption" tone="on-gradient-muted">
            Open
          </AppText>
        </View>
        <View>
          <AppText variant="display" tone="on-gradient">
            {String(overview.overdueTotal)}
          </AppText>
          <AppText variant="caption" tone="on-gradient-muted">
            Overdue
          </AppText>
        </View>
        <View className="flex-1">
          <AppText variant="title" tone="on-gradient" numberOfLines={2}>
            {nextDue}
          </AppText>
          <AppText variant="caption" tone="on-gradient-muted">
            Next due
          </AppText>
        </View>
      </View>
    </GradientCard>
  );
}

export default function AcademicCoursesScreen() {
  const router = useRouter();
  const [includePastTerms, setIncludePastTerms] = useState(false);
  const { data, isLoading, isError, isRefetching, refetch } = useAcademicCourses({
    includePastTerms,
  });

  if (isLoading) {
    return (
      <ScreenFrame>
        <SkeletonScreen />
      </ScreenFrame>
    );
  }

  if (isError || !data) {
    // Deliberately does NOT fall through to "nothing connected": when the API
    // is unreachable we know nothing about the connection, and telling the
    // owner to connect Canvas would send them to fix a network problem with a
    // fresh access token (the same rule health/index.tsx records).
    return (
      <ScreenCentered>
        <ErrorState
          size="screen"
          message="Couldn't load courses."
          onRetry={() => void refetch()}
          retryLabel="Retry"
          retryAccessibilityLabel="Retry loading courses"
        />
      </ScreenCentered>
    );
  }

  if (!data.configured) {
    return (
      <ScreenCentered>
        <EmptyState
          size="screen"
          icon="school-outline"
          title="No academic account is connected"
          body="Connect Canvas in Settings and your courses will appear here after the first sync."
          action={{
            label: "Open Settings",
            onPress: () => router.push(SETTINGS_ROUTE),
            accessibilityLabel: "Open Settings",
          }}
        />
      </ScreenCentered>
    );
  }

  const groups = groupCoursesByTerm(data.items);
  const termName = data.current_term?.name ?? null;
  const toggle = (
    <View className="mt-3 flex-row">
      <Button
        variant="tonal"
        size="sm"
        icon={includePastTerms ? "calendar-check" : "history"}
        label={includePastTerms ? "Current term only" : "Show past terms"}
        onPress={() => setIncludePastTerms((value) => !value)}
      />
    </View>
  );

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      {/* The navigator bar already says "Academics"; the hero below carries
          the term and the course count, so the in-flow header is compact
          and only speaks up when more than one term is listed. */}
      <ScreenHeader
        variant="compact"
        title="Academics"
        subtitle={
          groups.length > 1
            ? `${pluralize(data.items.length, "course")} across ${pluralize(groups.length, "term")}`
            : undefined
        }
      />

      <SemesterHero courses={data.items} termName={termName} allTerms={includePastTerms} />
      {toggle}

      {groups.length === 0 ? (
        <EmptyState
          icon="book-open-outline"
          title="No courses have synced yet"
          body="Canvas syncs hourly, or use Sync now in Settings."
          className="mt-4"
        />
      ) : (
        groups.map((group) => (
          <View key={group.title}>
            <SectionHeader title={group.title} count={group.courses.length} />
            {group.courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
