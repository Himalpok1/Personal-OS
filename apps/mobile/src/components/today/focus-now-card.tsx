// The "Focus Now" card for the Today screen (Checkpoint 10.4, ADR-072): a
// single, deterministic, ranked list merging personal urgent tasks (Today's
// overdue / due-today buckets) with academic priority items (the "Do next"
// candidates GET /academic/today already ranks). Every score and every
// reason chip is computed by packages/core/src/focus-now/score.ts and
// focus-now-card-state.ts's focusNowRows -- this file only lays the result
// out, the same split every other Today card (`academic-today-card.tsx`,
// `mail/digest-today-card.tsx`) uses.
//
// Owns its own two queries -- `useToday()` / `useAcademicToday()` -- rather
// than taking props, so it degrades exactly like every other self-owned Today
// card: a failed or still-loading source renders nothing, never a stale or
// partial list. Calling the same two hooks the screen and the Academics card
// already call is not a second network round trip; React Query dedupes by
// query key. Renders NOTHING at all (not an empty state) while either query
// is loading or erroring, or once merged there is nothing to show -- the
// AcademicTodayCard convention, restated in focusNowRows's own doc comment.
//
// Nothing here is AI, and nothing here re-derives an academic score: a task
// is scored fresh, on the same ladder; an assignment's score/reasons are
// copied from the server verbatim. See packages/core/src/focus-now/score.ts.
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { courseLabel, formatDueLabel } from "@/components/academic/format";
import { SourceLink } from "@/components/academic/source-link";
import { AppText, Card, ListRow, SectionHeader, StatusChip } from "@/components/ui";
import { useAcademicToday } from "@/queries/academic";
import { useToday } from "@/queries/today";
import { focusNowRows, type FocusNowRow } from "./focus-now-card-state";
import { focusNowReasonChips } from "./focus-now-reason-chip";

function ReasonChips({ row }: { row: FocusNowRow }) {
  const chips = focusNowReasonChips(row.reasons);
  if (chips.length === 0) return null;
  return (
    <View className="items-end gap-1">
      {chips.map((chip) => (
        <StatusChip key={chip.label} tone={chip.tone} label={chip.label} />
      ))}
    </View>
  );
}

function FocusNowTaskRowView({
  row,
  last,
}: {
  row: Extract<FocusNowRow, { kind: "task" }>;
  last: boolean;
}) {
  const router = useRouter();
  const due = formatDueLabel(row.task.due_at);
  const subtitle = [due, row.task.project_name]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <ListRow
      title={row.task.title}
      subtitle={subtitle}
      trailing={<ReasonChips row={row} />}
      onPress={() => router.push(`/tasks/${row.task.id}` as Href)}
      accessibilityLabel={`${row.task.title}, ${due}`}
      inset
      chevron
      last={last}
    />
  );
}

function FocusNowAcademicRowView({
  row,
  last,
}: {
  row: Extract<FocusNowRow, { kind: "academic_assignment" }>;
  last: boolean;
}) {
  const { assignment } = row.priorityItem;
  const course = courseLabel(assignment.course_code, assignment.course_name);
  const due = formatDueLabel(assignment.due_at);
  return (
    <SourceLink
      htmlUrl={assignment.html_url}
      sourceBaseUrl={assignment.source_base_url}
      accessibilityLabel={`${assignment.title}, ${course}, due ${due}`}
      className="active:opacity-70"
    >
      {/* The press lives on SourceLink (academic's one gated call site); the
          row is a plain View, so there is exactly one pressable per row --
          the same shape academic-today-card.tsx's own AssignmentRow keeps. */}
      <ListRow
        title={assignment.title}
        subtitle={`${course} · ${due}`}
        trailing={<ReasonChips row={row} />}
        inset
        last={last}
      />
    </SourceLink>
  );
}

function FocusNowRowView({ row, last }: { row: FocusNowRow; last: boolean }) {
  return row.kind === "task" ? (
    <FocusNowTaskRowView row={row} last={last} />
  ) : (
    <FocusNowAcademicRowView row={row} last={last} />
  );
}

export function FocusNowCard() {
  const today = useToday();
  const academic = useAcademicToday();

  // Nothing while either source is loading, and nothing on either error --
  // the AcademicTodayCard convention: a slow or failing source must never
  // block, blank or error the command centre's busiest card.
  if (today.data === undefined || today.isError) return null;
  if (academic.data === undefined || academic.isError) return null;

  const rows = focusNowRows(today.data, academic.data, new Date(today.dataUpdatedAt));
  if (rows === null) return null;

  return (
    <Card className="mb-3" accessibilityRole="summary">
      <SectionHeader title="Focus Now" icon="target" spacing="none" />
      <AppText variant="caption" tone="muted" className="pb-2">
        What needs you first, across tasks and coursework.
      </AppText>
      {rows.map((row, index) => (
        <FocusNowRowView key={`${row.kind}:${row.id}`} row={row} last={index === rows.length - 1} />
      ))}
    </Card>
  );
}
