// The in-app assignment sheet (Checkpoint 10.6, ADR-076 §3): tapping an
// assignment row anywhere -- the Academics card on Today, a course screen,
// a Focus Now row -- opens THIS bottom sheet (title, course, due, points,
// submission, grade, and, from Focus Now, the explanation) and only then
// offers "Open in Canvas", still through `SourceLink`, still the one gated
// `Linking.openURL` call site (src/__tests__/academic-open-url.test.ts). No
// academic row leaves the app on a single tap any more.
//
// STATE LIVES IN A MODULE STORE, NOT IN THE ROWS. The rows that open the
// sheet are hookless (the Academics card and the Focus Now card are walked
// by the tree-walking tests, which cannot host React state), so
// `openAssignmentSheet()` is a plain function that writes one record into
// a tiny external store -- exactly the `showToast()` pattern
// (components/ui/toast.tsx) -- and ONE `AssignmentSheetHost`, mounted once
// at the root beside `ToastHost` (app/_layout.tsx), reads it through
// `useSyncExternalStore` and draws the `BottomSheet`. The store is
// module-global and Expo Router keeps the Today tab mounted under a pushed
// course screen, so a host per screen would draw two modals for one record;
// `__tests__/academic-assignment-sheet.test.ts` pins that no screen mounts
// one.
//
// `AssignmentSheetHost` is the leaf (a React hook); `AssignmentDetail` and
// `AssignmentSheetContent` are hookless and are what the tests render.
import type { FocusNowCandidateExplanation } from "@personal-os/core/focus-now/explain";
import type { AcademicAssignment } from "@personal-os/schema";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { FocusNowExplanationBlock } from "@/components/today/focus-now-explanation";
import { AppText, BottomSheet, ListRow, StatusChip } from "@/components/ui";
import {
  courseLabel,
  formatDueLabel,
  formatGradeLabel,
  formatPoints,
  submissionBadge,
} from "./format";
import { isSameOrigin } from "./same-origin";
import { SourceLink } from "./source-link";
import { badgeChipTone } from "./urgency-chip";

export interface AssignmentSheetRecord {
  assignment: AcademicAssignment;
  /** The Focus Now explanation, when the sheet was opened from a Focus Now row. */
  explanation?: FocusNowCandidateExplanation | null;
}

export interface AssignmentSheetState {
  /** Whether the sheet is up. The record is kept through the exit animation. */
  visible: boolean;
  record: AssignmentSheetRecord | null;
}

// --- the store -------------------------------------------------------------

type Listener = () => void;

const CLOSED: AssignmentSheetState = { visible: false, record: null };
let state: AssignmentSheetState = CLOSED;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the sheet for an assignment, replacing whatever it showed. */
export function openAssignmentSheet(record: AssignmentSheetRecord): void {
  state = { visible: true, record };
  emit();
}

/** Close the sheet. The record stays for the exit animation and is replaced by the next open. */
export function closeAssignmentSheet(): void {
  if (!state.visible) return;
  state = { visible: false, record: state.record };
  emit();
}

export function getAssignmentSheet(): AssignmentSheetState {
  return state;
}

export function subscribeAssignmentSheet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: back to closed with no record. */
export function resetAssignmentSheetForTests(): void {
  state = CLOSED;
  emit();
}

// --- the content -----------------------------------------------------------

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3 py-1">
      <AppText variant="label" tone="secondary" className="font-normal">
        {label}
      </AppText>
      <AppText variant="body" className="flex-1 text-right" numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

/**
 * The assignment's facts: course, due, points, submission and grade -- every
 * one a value the server sent (no derivation here). The title is the
 * sheet's own title, so it is not repeated.
 */
export function AssignmentDetail({ assignment }: { assignment: AcademicAssignment }) {
  const course = courseLabel(assignment.course_code, assignment.course_name);
  const badge = submissionBadge(assignment.submission);
  const graded = assignment.grade.status === "graded";
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${course}, due ${formatDueLabel(assignment.due_at)}${
        assignment.points_possible === null
          ? ""
          : `, ${formatPoints(assignment.points_possible)} points`
      }${badge ? `, ${badge.text}` : ""}${
        graded ? `, grade ${formatGradeLabel(assignment.grade, assignment.points_possible)}` : ""
      }`}
    >
      {badge ? (
        <View className="flex-row pb-1">
          <StatusChip tone={badgeChipTone(badge.tone)} label={badge.text} size="md" dot />
        </View>
      ) : null}
      <DetailLine label="Course" value={course} />
      <DetailLine label="Due" value={formatDueLabel(assignment.due_at)} />
      {assignment.points_possible === null ? null : (
        <DetailLine label="Points" value={formatPoints(assignment.points_possible)} />
      )}
      {graded ? (
        <DetailLine
          label="Grade"
          value={formatGradeLabel(assignment.grade, assignment.points_possible)}
        />
      ) : null}
    </View>
  );
}

/**
 * The "Open in Canvas" row -- rendered only when the link can actually open
 * (the course hero's rule: an inert row would promise something the origin
 * check refused), and even then only through `SourceLink`, whose own
 * `isSameOrigin` gate runs again before the handler exists.
 */
export function OpenInCanvasRow({ assignment }: { assignment: AcademicAssignment }) {
  if (!isSameOrigin(assignment.html_url, assignment.source_base_url)) return null;
  return (
    <SourceLink
      htmlUrl={assignment.html_url}
      sourceBaseUrl={assignment.source_base_url}
      accessibilityLabel={`Open ${assignment.title} in Canvas`}
      className="active:opacity-70"
    >
      <ListRow title="Open in Canvas" icon="open-in-new" iconTone="primary" chevron inset last />
    </SourceLink>
  );
}

/** Everything inside the sheet frame. Hookless. */
export function AssignmentSheetContent({ record }: { record: AssignmentSheetRecord }) {
  return (
    <View className="gap-3 pb-2" testID="assignment-sheet-content">
      <AssignmentDetail assignment={record.assignment} />
      {record.explanation ? <FocusNowExplanationBlock explanation={record.explanation} /> : null}
      <OpenInCanvasRow assignment={record.assignment} />
    </View>
  );
}

// --- the host --------------------------------------------------------------

/** Mounted ONCE per screen that has assignment rows. The leaf. */
export function AssignmentSheetHost() {
  const current = useSyncExternalStore(
    subscribeAssignmentSheet,
    getAssignmentSheet,
    getAssignmentSheet,
  );
  return (
    <BottomSheet
      open={current.visible}
      onClose={closeAssignmentSheet}
      title={current.record?.assignment.title}
      testID="assignment-sheet"
    >
      {current.record ? <AssignmentSheetContent record={current.record} /> : null}
    </BottomSheet>
  );
}
