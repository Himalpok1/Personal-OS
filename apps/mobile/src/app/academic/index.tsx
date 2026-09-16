import type { AcademicCourseSummary } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { courseLabel, formatDueLabel, pluralize } from "@/components/academic/format";
import { groupCoursesByTerm } from "@/components/academic/group-courses";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { useAcademicCourses } from "@/queries/academic";

// The course list (Checkpoint 10.2, ADR-070): every active connection's
// courses, grouped by term with the most recent term first, each row carrying
// the three computed facts the server already derived (open count, overdue
// count, next due instant). Reached from the Today card's "Courses ›" and
// from the Canvas section of Settings -- not a sixth tab, for the same 480px
// reason Health, Monitoring and Search are not.
//
// Read-only by construction: there is nothing on this screen that could
// write, because the academic routes expose nothing writable (ADR-068 §2).
// Nothing here is derived either -- the grouping helper only walks the
// server's own order (group-courses.ts).

const SETTINGS_ROUTE = "/settings" as Href;

function courseRoute(id: string): Href {
  return `/academic/${encodeURIComponent(id)}` as Href;
}

function CourseRow({ course }: { course: AcademicCourseSummary }) {
  const router = useRouter();
  const hasCode = courseLabel(course.code, course.name) !== course.name;
  const overdue = course.overdue_assignment_count;
  const nextDue = course.next_due_at === null ? null : formatDueLabel(course.next_due_at);

  const label = [
    course.code ?? course.name,
    hasCode ? course.name : null,
    pluralize(course.open_assignment_count, "open assignment"),
    pluralize(overdue, "overdue assignment"),
    nextDue === null ? "no upcoming due date" : `next due ${nextDue}`,
    course.status === "active" ? null : course.status,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  return (
    <Pressable
      onPress={() => router.push(courseRoute(course.id))}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      className="min-h-[44px] justify-center border-b border-neutral-100 px-4 py-3 active:opacity-70 dark:border-neutral-900"
    >
      <View className="flex-row items-center gap-2">
        <Text
          className="shrink text-base font-semibold text-black dark:text-white"
          numberOfLines={1}
        >
          {hasCode ? course.code : course.name}
        </Text>
        {course.status === "active" ? null : (
          <View className="rounded bg-neutral-200 px-2 py-0.5 dark:bg-neutral-800">
            <Text className="text-[10px] uppercase text-neutral-600 dark:text-neutral-300">
              {course.status}
            </Text>
          </View>
        )}
      </View>
      {hasCode ? (
        <Text className="text-sm text-neutral-700 dark:text-neutral-300" numberOfLines={2}>
          {course.name}
        </Text>
      ) : null}
      <View className="mt-1 flex-row flex-wrap items-center gap-x-2">
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">
          {course.open_assignment_count} open
        </Text>
        <Text className="text-xs text-neutral-400 dark:text-neutral-500">·</Text>
        <Text
          className={`text-xs ${
            overdue > 0
              ? "font-medium text-red-600 dark:text-red-400"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {overdue} overdue
        </Text>
        {nextDue === null ? null : (
          <>
            <Text className="text-xs text-neutral-400 dark:text-neutral-500">·</Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">Next {nextDue}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

function TermHeader({ title }: { title: string }) {
  return (
    <Text className="px-4 pb-2 pt-5 text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
      {title}
    </Text>
  );
}

export default function AcademicCoursesScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useAcademicCourses();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (isError || !data) {
    // Deliberately does NOT fall through to "nothing connected": when the API
    // is unreachable we know nothing about the connection, and telling the
    // owner to connect Canvas would send them to fix a network problem with a
    // fresh access token (the same rule health/index.tsx records).
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-red-600">Couldn&apos;t load courses.</Text>
        <Pressable
          onPress={() => void refetch()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading courses"
          className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!data.configured) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-base font-medium text-black dark:text-white">
          No academic account is connected.
        </Text>
        <Text className="text-center text-sm text-neutral-500 dark:text-neutral-400">
          Connect Canvas in Settings and your courses will appear here after the first sync.
        </Text>
        <Pressable
          onPress={() => router.push(SETTINGS_ROUTE)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          className="min-h-[44px] items-center justify-center rounded-lg bg-neutral-200 px-4 py-2 active:opacity-70 dark:bg-neutral-800"
        >
          <Text className="font-semibold text-black dark:text-white">Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  const groups = groupCoursesByTerm(data.items);

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
    >
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">Academics</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {pluralize(data.items.length, "course")}
          {groups.length > 1 ? ` across ${pluralize(groups.length, "term")}` : ""}
        </Text>
      </View>

      {groups.length === 0 ? (
        <Text className="px-4 pt-5 text-sm text-neutral-500 dark:text-neutral-400">
          No courses have synced yet. Canvas syncs hourly, or use Sync now in Settings.
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.title}>
            <TermHeader title={group.title} />
            {group.courses.map((course) => (
              <CourseRow key={course.id} course={course} />
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}
