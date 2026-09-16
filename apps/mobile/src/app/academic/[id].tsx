import { ApiClientError } from "@personal-os/api-client";
import type {
  AcademicAnnouncement,
  AcademicAssignment,
  AcademicCourseSummary,
  AcademicEvent,
} from "@personal-os/schema";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  formatDateLabel,
  formatDueLabel,
  formatGradeLabel,
  formatPoints,
  formatWhenLabel,
  submissionBadge,
  type SubmissionBadgeTone,
} from "@/components/academic/format";
import { partitionAssignments } from "@/components/academic/partition-assignments";
import { isSameOrigin } from "@/components/academic/same-origin";
import { SourceLink } from "@/components/academic/source-link";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { useAcademicCourse } from "@/queries/academic";

// One course (Checkpoint 10.2, ADR-070): its assignments split into the four
// sections a student actually scans for, then its recent announcements and
// calendar events. Every row that can open in Canvas does so through
// SourceLink, whose same-origin check is the one thing that makes a
// provider-supplied `html_url` safe to open (components/academic/same-origin.ts).
//
// THE ONE CLIENT-SIDE DERIVATION on any academic screen is the overdue /
// upcoming split of already-OPEN rows by a single instant comparison,
// captured once per render (partition-assignments.ts explains why that is
// permitted here and nowhere else). `open`, grades, percentages and course
// status are all the server's.

const BADGE_TONE_CLASS: Record<SubmissionBadgeTone, string> = {
  red: "text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-700 dark:text-green-300",
  neutral: "text-neutral-500 dark:text-neutral-400",
};

type Tone = "red" | "blue" | "neutral";

const SECTION_TONE_CLASS: Record<Tone, string> = {
  red: "text-red-600 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  neutral: "text-neutral-500 dark:text-neutral-400",
};

const ROW_CLASS =
  "min-h-[44px] justify-center border-b border-neutral-100 px-4 py-3 active:opacity-70 dark:border-neutral-900";

function SectionHeader({ title, count, tone }: { title: string; count: number; tone: Tone }) {
  return (
    <Text className={`px-4 pb-2 pt-5 text-sm font-semibold uppercase ${SECTION_TONE_CLASS[tone]}`}>
      {title} · {count}
    </Text>
  );
}

function AssignmentRow({ item }: { item: AcademicAssignment }) {
  const badge = submissionBadge(item.submission);
  const due = formatDueLabel(item.due_at);
  // A closed row's second line is its grade; an open row's is its due instant.
  const detail = item.open ? due : formatGradeLabel(item.grade, item.points_possible);
  const points =
    item.points_possible === null || !item.open
      ? null
      : `${formatPoints(item.points_possible)} pts`;
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${item.title}, ${item.open ? `due ${due}` : `grade ${detail}`}${
        badge ? `, ${badge.text}` : ""
      }`}
      className={ROW_CLASS}
    >
      <Text className="text-base text-black dark:text-white" numberOfLines={2}>
        {item.title}
      </Text>
      <View className="mt-0.5 flex-row flex-wrap items-center gap-x-2">
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">{detail}</Text>
        {points === null ? null : (
          <>
            <Text className="text-xs text-neutral-400 dark:text-neutral-500">·</Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">{points}</Text>
          </>
        )}
        {badge ? (
          <Text className={`text-xs font-medium ${BADGE_TONE_CLASS[badge.tone]}`}>
            {badge.text}
          </Text>
        ) : null}
      </View>
    </SourceLink>
  );
}

function AssignmentSection({
  title,
  tone,
  items,
}: {
  title: string;
  tone: Tone;
  items: AcademicAssignment[];
}) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} count={items.length} tone={tone} />
      {items.map((item) => (
        <AssignmentRow key={item.id} item={item} />
      ))}
    </View>
  );
}

function AnnouncementRow({ item }: { item: AcademicAnnouncement }) {
  const openable = isSameOrigin(item.html_url, item.source_base_url);
  const posted = item.posted_at === null ? null : formatDateLabel(item.posted_at);
  const unread = item.read === false;
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${unread ? "Unread. " : ""}${item.title}${
        posted === null ? "" : `, posted ${posted}`
      }`}
      className={ROW_CLASS}
    >
      <View className="flex-row items-center gap-2">
        {/* The unread dot: a fact Canvas reports (`read_state`), rendered
            only when it is definitely unread -- a null (unknown) read state
            shows nothing rather than guessing either way. */}
        {unread ? <View className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" /> : null}
        <Text
          className={`flex-1 text-base text-black dark:text-white ${unread ? "font-semibold" : ""}`}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {openable ? <Text className="text-xs text-blue-600 dark:text-blue-400">Open ›</Text> : null}
      </View>
      {/* The stored preview is already tag-stripped plain text (ADR-068);
          it lands in <Text>, which interprets nothing. */}
      {item.preview ? (
        <Text className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300" numberOfLines={2}>
          {item.preview}
        </Text>
      ) : null}
      {posted === null ? null : (
        <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{posted}</Text>
      )}
    </SourceLink>
  );
}

function EventRow({ item }: { item: AcademicEvent }) {
  const when = formatWhenLabel(item);
  return (
    <SourceLink
      htmlUrl={item.html_url}
      sourceBaseUrl={item.source_base_url}
      accessibilityLabel={`${item.title}, ${when}${item.location ? `, ${item.location}` : ""}`}
      className={ROW_CLASS}
    >
      <Text className="text-base text-black dark:text-white" numberOfLines={2}>
        {item.title}
      </Text>
      <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{when}</Text>
      {item.location ? (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {item.location}
        </Text>
      ) : null}
    </SourceLink>
  );
}

function CourseHeader({ course }: { course: AcademicCourseSummary }) {
  const meta = [course.code, course.term.name].filter(
    (part): part is string => part !== null && part.trim().length > 0,
  );
  const openable = isSameOrigin(course.html_url, course.source_base_url);
  return (
    <View className="px-4 pt-4">
      <Text className="text-2xl font-bold text-black dark:text-white">{course.name}</Text>
      {meta.length > 0 ? (
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">{meta.join(" · ")}</Text>
      ) : null}
      {course.status === "active" ? null : (
        <Text className="mt-1 text-xs uppercase text-neutral-500 dark:text-neutral-400">
          {course.status}
        </Text>
      )}
      {/* Shown only when the link can actually open -- an inert "Open in
          Canvas" would promise something the origin check refused. */}
      {openable ? (
        <SourceLink
          htmlUrl={course.html_url}
          sourceBaseUrl={course.source_base_url}
          accessibilityLabel="Open this course in Canvas"
          className="mt-2 min-h-[44px] justify-center self-start rounded bg-neutral-200 px-3 py-2 active:opacity-70 dark:bg-neutral-800"
        >
          <Text className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Open in Canvas
          </Text>
        </SourceLink>
      ) : null}
    </View>
  );
}

export default function AcademicCourseScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" && params.id.length > 0 ? params.id : null;
  const { data, dataUpdatedAt, isLoading, isError, error, refetch } = useAcademicCourse(id);

  if (id === null) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Text className="text-center text-base font-medium text-black dark:text-white">
          No course was selected.
        </Text>
      </View>
    );
  }

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6 dark:bg-black">
        <Text className="text-center text-red-600">
          {status === 404 ? "Course not found." : "Couldn't load this course."}
        </Text>
        {/* A 404 is terminal (the course is archived or its connection is no
            longer active -- the same answer every time), so the affordance
            appears only for a load failure that could clear. */}
        {status === 404 ? null : (
          <Pressable
            onPress={() => void refetch()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading this course"
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
          >
            <Text className="font-semibold text-white">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (isLoading || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  // One `now` for the whole render, so no two sections can disagree -- and
  // it is the instant this data was FETCHED, not the instant of the render:
  // `dataUpdatedAt` is the closest thing the client has to the server's own
  // `effective_now`, it is a pure value per render (react-hooks/purity forbids
  // `Date.now()` here for exactly the reason it would be wrong), and it moves
  // forward on every refetch, so a focus refetch re-partitions honestly.
  const partition = partitionAssignments(data.assignments, dataUpdatedAt);

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
    >
      <CourseHeader course={data.course} />

      <AssignmentSection title="Overdue" tone="red" items={partition.overdue} />
      <AssignmentSection title="Upcoming" tone="blue" items={partition.upcoming} />
      <AssignmentSection title="No due date" tone="neutral" items={partition.undated} />
      <AssignmentSection title="Submitted & graded" tone="neutral" items={partition.closed} />

      {data.assignments.length === 0 ? (
        <Text className="px-4 pt-5 text-sm text-neutral-500 dark:text-neutral-400">
          No assignments have synced for this course.
        </Text>
      ) : null}

      {data.announcements.length > 0 ? (
        <View>
          <SectionHeader title="Announcements" count={data.announcements.length} tone="neutral" />
          {data.announcements.map((item) => (
            <AnnouncementRow key={item.id} item={item} />
          ))}
        </View>
      ) : null}

      {data.events.length > 0 ? (
        <View>
          <SectionHeader title="Events" count={data.events.length} tone="neutral" />
          {data.events.map((item) => (
            <EventRow key={item.id} item={item} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
