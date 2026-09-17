import { View } from "react-native";
import type { AcademicAssignment, AcademicCourseSummary } from "@personal-os/schema";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel } from "@/components/ask/text-field";
import {
  AppText,
  Card,
  Icon,
  ListRow,
  SectionHeader,
  StatusChip,
  type SectionTone,
} from "@/components/ui";
import { courseLabel, formatDueLabel, submissionBadge } from "./format";
import { partitionAssignments, type AssignmentPartition } from "./partition-assignments";
import { badgeChipTone } from "./urgency-chip";

// Links a task to a Canvas assignment (Checkpoint 10.5, ADR-074): an
// explicit, two-step picker -- a course, then one of its assignments --
// mirroring the Project field on this same screen (tasks/[id].tsx): the
// same ChoiceChip look for the course step, and the same "None" clears the
// link the way the Project chip clears to no project. Assignment rows reuse
// the four groups the course detail screen renders (Overdue / Upcoming / No
// due date / Submitted & graded -- partition-assignments.ts).
//
// Hook-free and fully prop-driven, like EditEventView/NewEventView
// (app/events/[id].tsx, app/events/new.tsx): every fetch (courses, a
// course's assignments) and all local state (expanded, the course being
// browsed) is owned by the screen, so this component is exercised directly
// as a plain function call in tests -- the app's only render technique, since
// no render library exists here.

const SECTIONS: readonly { key: keyof AssignmentPartition; title: string; tone: SectionTone }[] = [
  { key: "overdue", title: "Overdue", tone: "danger" },
  { key: "upcoming", title: "Upcoming", tone: "info" },
  { key: "undated", title: "No due date", tone: "default" },
  { key: "closed", title: "Submitted & graded", tone: "success" },
];

export interface TaskAssignmentPickerProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  isLinked: boolean;
  /** The resolved title for the current link, when this session knows it (academic-assignment-cache.ts). */
  linkedTitle: string | null;
  linkedCourseLabel: string | null;
  courses: readonly AcademicCourseSummary[];
  selectedCourseId: string | null;
  onSelectCourse: (id: string | null) => void;
  /** The selected course's assignments, or null while none is selected or still loading. */
  courseAssignments: readonly AcademicAssignment[] | null;
  /** When `courseAssignments` was fetched -- never Date.now() in render (react-hooks/purity). */
  courseAssignmentsFetchedAt: number;
  onSelectAssignment: (assignment: AcademicAssignment) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function TaskAssignmentPicker({
  expanded,
  onToggleExpanded,
  isLinked,
  linkedTitle,
  linkedCourseLabel,
  courses,
  selectedCourseId,
  onSelectCourse,
  courseAssignments,
  courseAssignmentsFetchedAt,
  onSelectAssignment,
  onClear,
  disabled = false,
}: TaskAssignmentPickerProps) {
  const partition =
    courseAssignments === null
      ? null
      : partitionAssignments(courseAssignments, courseAssignmentsFetchedAt);
  const fieldTitle = isLinked ? (linkedTitle ?? "Linked assignment") : "None";
  const fieldSubtitle = isLinked ? (linkedCourseLabel ?? undefined) : undefined;

  return (
    <View className="mb-4" testID="task-assignment-picker">
      <FieldLabel>Assignment</FieldLabel>
      <Card padding="none">
        <ListRow
          testID="task-assignment-field"
          title={fieldTitle}
          subtitle={fieldSubtitle}
          icon="school-outline"
          trailing={
            <Icon
              name={expanded ? "chevron-up" : "chevron-down"}
              size="sm"
              tone="on-surface-muted"
            />
          }
          onPress={onToggleExpanded}
          accessibilityLabel={`Assignment: ${fieldTitle}${fieldSubtitle ? `, ${fieldSubtitle}` : ""}`}
          disabled={disabled}
          last
        />
      </Card>

      {expanded ? (
        <View className="mt-2" testID="task-assignment-picker-panel">
          <View className="flex-row flex-wrap gap-2">
            <ChoiceChip
              testID="task-assignment-none"
              label="None"
              selected={!isLinked}
              disabled={disabled}
              onPress={onClear}
              accessibilityLabel="Clear assignment link"
            />
            {courses.map((course) => (
              <ChoiceChip
                key={course.id}
                label={courseLabel(course.code, course.name)}
                selected={selectedCourseId === course.id}
                disabled={disabled}
                onPress={() => onSelectCourse(selectedCourseId === course.id ? null : course.id)}
                accessibilityLabel={`Course: ${course.name}`}
              />
            ))}
          </View>

          {selectedCourseId !== null && partition !== null ? (
            <View className="mt-3">
              {SECTIONS.map(({ key, title, tone }) => {
                const items = partition[key];
                if (items.length === 0) return null;
                return (
                  <View key={key} className="mt-2">
                    <SectionHeader title={title} count={items.length} tone={tone} spacing="none" />
                    <Card padding="none" className="mt-1">
                      {items.map((item, index) => {
                        const badge = submissionBadge(item.submission);
                        const due = formatDueLabel(item.due_at);
                        return (
                          <ListRow
                            key={item.id}
                            title={item.title}
                            subtitle={due}
                            trailing={
                              badge ? (
                                <StatusChip tone={badgeChipTone(badge.tone)} label={badge.text} />
                              ) : null
                            }
                            onPress={() => onSelectAssignment(item)}
                            disabled={disabled}
                            accessibilityLabel={`${item.title}, ${due}`}
                            last={index === items.length - 1}
                          />
                        );
                      })}
                    </Card>
                  </View>
                );
              })}
              {courseAssignments !== null && courseAssignments.length === 0 ? (
                <AppText variant="body" tone="secondary" className="mt-2">
                  No assignments have synced for this course.
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
