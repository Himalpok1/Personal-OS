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
// Checkpoint 10.8 (ADR-078 §6): the first product moment. Above "Open in
// Canvas" the sheet offers "Plan study block" and "Add a task for this".
// Neither WRITES anything: each composes an action REQUEST (pure builders in
// components/actions/build-assignment-requests.ts), the host proposes it
// (`POST /actions` -> a pending row), and on success this sheet closes and
// the root-mounted approval sheet opens on the returned row, where the
// owner approves or cancels. A failed proposal stays here as an inert
// danger row, never a toast.
//
// `AssignmentSheetHost` is the leaf (a React hook); `AssignmentDetail` and
// `AssignmentSheetContent` are hookless and are what the tests render.
import type { FocusNowCandidateExplanation } from "@personal-os/core/focus-now/explain";
import type { AcademicAssignment, ActionRequestCreate } from "@personal-os/schema";
import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { openActionApprovalSheet } from "@/components/actions/action-approval-sheet";
import {
  buildAssignmentTaskRequest,
  buildStudyBlockRequest,
} from "@/components/actions/build-assignment-requests";
import { FocusNowExplanationBlock } from "@/components/today/focus-now-explanation";
import { AppText, BottomSheet, ListRow, SheetRow, StatusChip } from "@/components/ui";
import { useCreateActionRequest } from "@/queries/actions";
import { deviceTimezone } from "@/queries/today";
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

/** The host's proposer: composes a request and POSTs it; the sheet only asks. */
export interface AssignmentProposer {
  onPropose: (request: ActionRequestCreate) => void;
  pending: boolean;
  /** The failure line of the last proposal, shown inline. */
  error: string | null;
}

/** The line for a proposal the API refused or a request that never landed. */
export const ASSIGNMENT_PROPOSE_FAILED = "Couldn't propose that. Try again.";

/**
 * The two proposals (Checkpoint 10.8, ADR-078 §6). Each row composes a
 * request through a pure builder and hands it to the host; nothing is
 * written until the owner approves it on the approval sheet. `now` is read
 * inside the press handler, never in render.
 */
export function AssignmentProposalRows({
  assignment,
  propose,
}: {
  assignment: AcademicAssignment;
  propose: AssignmentProposer;
}) {
  return (
    <View testID="assignment-proposals">
      <AppText variant="overline" tone="muted" className="pb-1">
        Propose
      </AppText>
      <SheetRow
        icon="calendar-clock"
        tone="info"
        label="Plan study block"
        subtitle="A 60-minute event, for you to approve"
        onPress={() =>
          propose.onPropose(
            buildStudyBlockRequest({ assignment, now: new Date(), tz: deviceTimezone() }),
          )
        }
        disabled={propose.pending}
        accessibilityLabel={`Plan a study block for ${assignment.title}`}
        testID="assignment-plan-study-block"
      />
      <SheetRow
        icon="checkbox-marked-outline"
        tone="primary"
        label="Add a task for this"
        subtitle="Linked to the assignment, for you to approve"
        onPress={() =>
          propose.onPropose(buildAssignmentTaskRequest({ assignment, tz: deviceTimezone() }))
        }
        disabled={propose.pending}
        accessibilityLabel={`Add a task for ${assignment.title}`}
        last
        testID="assignment-add-task"
      />
      {propose.error ? (
        <ListRow
          title={propose.error}
          titleTone="danger"
          icon="alert-circle-outline"
          iconTone="danger"
          accessibilityLabel={`${assignment.title}: ${propose.error}`}
          inset
          last
          testID="assignment-propose-error"
        />
      ) : null}
    </View>
  );
}

/** Everything inside the sheet frame. Hookless. The proposals render only when the host supplies a proposer. */
export function AssignmentSheetContent({
  record,
  propose,
}: {
  record: AssignmentSheetRecord;
  propose?: AssignmentProposer;
}) {
  return (
    <View className="gap-3 pb-2" testID="assignment-sheet-content">
      <AssignmentDetail assignment={record.assignment} />
      {record.explanation ? <FocusNowExplanationBlock explanation={record.explanation} /> : null}
      {propose ? <AssignmentProposalRows assignment={record.assignment} propose={propose} /> : null}
      <OpenInCanvasRow assignment={record.assignment} />
    </View>
  );
}

// --- the host --------------------------------------------------------------

/** Mounted ONCE, at the root. The leaf. */
export function AssignmentSheetHost() {
  const current = useSyncExternalStore(
    subscribeAssignmentSheet,
    getAssignmentSheet,
    getAssignmentSheet,
  );
  const createRequest = useCreateActionRequest();
  const [proposeError, setProposeError] = useState<string | null>(null);

  const propose: AssignmentProposer = {
    pending: createRequest.isPending,
    error: proposeError,
    onPropose: (request) => {
      setProposeError(null);
      createRequest.mutate(request, {
        onSuccess: (item) => {
          // This sheet first, then the approval sheet -- two hosts, one modal
          // at a time.
          closeAssignmentSheet();
          openActionApprovalSheet(item);
        },
        onError: () => setProposeError(ASSIGNMENT_PROPOSE_FAILED),
      });
    },
  };

  return (
    <BottomSheet
      open={current.visible}
      onClose={() => {
        setProposeError(null);
        closeAssignmentSheet();
      }}
      title={current.record?.assignment.title}
      testID="assignment-sheet"
    >
      {current.record ? <AssignmentSheetContent record={current.record} propose={propose} /> : null}
    </BottomSheet>
  );
}
