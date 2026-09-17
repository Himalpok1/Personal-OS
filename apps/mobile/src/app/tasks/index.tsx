import type { Task, TaskStatus } from "@personal-os/schema";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  classifyTaskActionError,
  completionTarget,
  taskListMetaLine,
  taskListPrimaryLabel,
  taskListPrimaryWord,
  taskListRowActions,
  taskListRowChips,
  type TaskListMoreAction,
} from "@/components/task-actions-state";
import { useCompleteOccurrence } from "@/queries/occurrences";
import { useProjects } from "@/queries/projects";
import {
  useActivateTask,
  useArchiveTask,
  useCompleteTask,
  useDropTask,
  useReopenTask,
  useTasks,
} from "@/queries/tasks";
import { FLOATING_CLEARANCE, FLOATING_CTA_CLEARANCE_NO_TABBAR } from "@/components/floating-layout";
import {
  AnimatedView,
  AppText,
  BottomSheet,
  Button,
  Card,
  CompletionCircle,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ScreenFrame,
  SegmentedControl,
  SheetRow,
  SkeletonList,
  SwipeableRow,
  TrailingChipGroup,
  enterFade,
  showToast,
  useRefreshControl,
  type CompletionState,
  type SegmentedOption,
  type SwipeAction,
} from "@/components/ui";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";

// The Tasks tab (Checkpoint 10.6, ADR-076 §2): one `ListRow` per task on a
// card, half the height of the pre-10.6 row that stacked two or three full
// buttons under every title. The actions are the SAME SET per status
// (components/task-actions-state.ts's `taskListRowActions`, pinned there):
//
//   * the leading `CompletionCircle` starts a new task, completes an active
//     one, reopens a done one (Start -> Done semantics as before);
//   * swiping right offers the same primary action; swiping left offers
//     Archive behind the existing `confirmDestructive` gate;
//   * the trailing "More" button (and a long press) opens a `BottomSheet`
//     with Drop / Reopen / Archive -- which is also how every action stays
//     reachable on web, where a swipe does not exist (a swipe is a shortcut,
//     never the only route), alongside the detail screen.
//
// Done and Archive confirm through a toast; a failure keeps its inline line
// under the row, because an error needs reading (docs/MOBILE-DESIGN-SYSTEM.md
// -> Toasts).

type Filter = "new" | "active" | "done" | "dropped";

const FILTER_STATUS: Record<Filter, TaskStatus[]> = {
  new: ["inbox"],
  active: ["active"],
  done: ["done"],
  dropped: ["dropped"],
};

const FILTERS: readonly SegmentedOption<Filter>[] = (
  ["new", "active", "done", "dropped"] as Filter[]
).map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1) }));

const MORE_ROW: Record<
  TaskListMoreAction,
  {
    label: string;
    icon: "close" | "restore" | "archive-arrow-down-outline";
    tone: "warning" | "primary" | "danger";
  }
> = {
  drop: { label: "Drop", icon: "close", tone: "warning" },
  reopen: { label: "Reopen", icon: "restore", tone: "primary" },
  archive: { label: "Archive", icon: "archive-arrow-down-outline", tone: "danger" },
};

function TaskRow({ task, projectName }: { task: Task; projectName: string | null }) {
  const router = useRouter();
  const activate = useActivateTask();
  const complete = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();
  const drop = useDropTask();
  const reopen = useReopenTask();
  const archive = useArchiveTask();
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const showFailure = (err: unknown) => {
    const failure = classifyTaskActionError(err);
    if (failure.kind === "message") setError(failure.message);
  };

  // A list row is a `Task`, which carries no occurrence_id, so `completionTarget`
  // always resolves to the task endpoint here; the shared helper keeps the
  // recurring 409 handling identical to Today's (Checkpoint 9.3): complete the
  // named occurrence, or say that none is generated yet. Done stays one tap.
  const onCompleted = () => showToast({ message: "Task completed", tone: "success" });
  const onComplete = () => {
    setError(null);
    const target = completionTarget(task);
    if (target.kind === "occurrence") {
      completeOccurrence.mutate(target.occurrenceId, {
        onSuccess: onCompleted,
        onError: showFailure,
      });
      return;
    }
    complete.mutate(target.taskId, {
      onSuccess: onCompleted,
      onError: (err) => {
        const failure = classifyTaskActionError(err);
        if (failure.kind === "use_occurrence") {
          completeOccurrence.mutate(failure.occurrenceId, {
            onSuccess: onCompleted,
            onError: showFailure,
          });
          return;
        }
        setError(failure.message);
      },
    });
  };

  const onStart = () => {
    setError(null);
    activate.mutate(task.id, { onError: showFailure });
  };

  const onReopen = () => {
    setError(null);
    reopen.mutate(task.id, { onError: showFailure });
  };

  // Drop and Archive were the two list-row actions the ledger recorded as
  // unconfirmed ("List-row Archive and Drop still fire without confirmation")
  // -- one fat-finger tap on the Rabbit's 480px row hid an item. Same gate
  // and same copy as the detail screen, on the sheet and on the swipe alike.
  const onDrop = () =>
    confirmDestructive({
      title: "Drop this task?",
      message: "It moves to Dropped. You can reopen it later from there.",
      confirmLabel: "Drop",
      onConfirm: () => {
        setError(null);
        drop.mutate(task.id, { onError: showFailure });
      },
    });

  const onArchive = () =>
    confirmDestructive({
      title: "Archive this task?",
      message:
        "This hides it from your lists. There's currently no way to view or restore it from the app.",
      confirmLabel: "Archive",
      onConfirm: () => {
        setError(null);
        archive.mutate(task.id, {
          onSuccess: () => showToast({ message: "Task archived" }),
          onError: () => setError("Couldn't archive this task. Please try again."),
        });
      },
    });

  const actions = taskListRowActions(task.status);
  const runPrimary = { start: onStart, complete: onComplete, reopen: onReopen }[actions.primary];
  const primaryPending =
    activate.isPending || complete.isPending || completeOccurrence.isPending || reopen.isPending;
  const circleState: CompletionState | null =
    actions.circle === null ? null : primaryPending ? "pending" : actions.circle;
  const primaryLabel = taskListPrimaryLabel(actions.primary, task.title);

  const runMore: Record<TaskListMoreAction, () => void> = {
    drop: onDrop,
    reopen: onReopen,
    archive: onArchive,
  };
  const morePending = drop.isPending || reopen.isPending || archive.isPending;

  // Swipe right: the primary action (never while it is already in flight);
  // swipe left: Archive, through the same confirmation the sheet uses.
  const swipePrimary: SwipeAction[] = primaryPending
    ? []
    : [
        {
          key: actions.primary,
          label: taskListPrimaryWord(actions.primary),
          icon: actions.primary === "reopen" ? "restore" : "check",
          tone: actions.primary === "complete" ? "success" : "primary",
          onPress: runPrimary,
          haptic: actions.primary === "complete" ? "success" : "light",
        },
      ];
  const swipeArchive: SwipeAction[] = archive.isPending
    ? []
    : [
        {
          key: "archive",
          label: "Archive",
          icon: "archive-arrow-down-outline",
          tone: "danger",
          onPress: onArchive,
        },
      ];

  const chips = taskListRowChips(task, projectName);
  const meta = taskListMetaLine(task);
  const openSheet = () => setSheetOpen(true);
  const closeSheet = () => setSheetOpen(false);

  return (
    <Card padding="none" className="mb-2">
      <SwipeableRow leftActions={swipePrimary} rightActions={swipeArchive}>
        <ListRow
          title={task.title}
          meta={meta ?? undefined}
          done={task.status === "done"}
          leading={
            circleState === null ? undefined : (
              <CompletionCircle
                state={circleState}
                tone={actions.primary === "complete" ? "success" : "primary"}
                onPress={runPrimary}
                accessibilityLabel={primaryLabel}
                testID={`task-row-circle-${task.id}`}
              />
            )
          }
          icon={circleState === null ? "close-circle-outline" : undefined}
          trailing={
            <View className="flex-row items-center gap-1">
              {chips.length > 0 ? <TrailingChipGroup chips={chips} /> : null}
              <IconButton
                icon="dots-horizontal"
                onPress={openSheet}
                accessibilityLabel={`More actions: ${task.title}`}
                tone="on-surface-variant"
                busy={morePending}
              />
            </View>
          }
          onPress={() => router.push(`/tasks/${task.id}`)}
          onLongPress={openSheet}
          accessibilityLabel={`Open task: ${task.title}`}
          // The circle and the More button are the row's own controls, so
          // the row drops its button role (no <button> inside a <button> on
          // web) and each control keeps its own label.
          containsControl
          inset
          last
          className="px-3"
        />
      </SwipeableRow>
      {error ? (
        <AppText variant="caption" tone="danger" className="px-4 pb-2" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <BottomSheet
        open={sheetOpen}
        onClose={closeSheet}
        title={task.title}
        testID={`task-row-sheet-${task.id}`}
      >
        {actions.more.map((action, index) => (
          <SheetRow
            key={action}
            icon={MORE_ROW[action].icon}
            label={MORE_ROW[action].label}
            tone={MORE_ROW[action].tone}
            onPress={() => {
              closeSheet();
              runMore[action]();
            }}
            accessibilityLabel={`${MORE_ROW[action].label} task: ${task.title}`}
            disabled={morePending}
            last={index === actions.more.length - 1}
          />
        ))}
      </BottomSheet>
    </Card>
  );
}

export default function TasksScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const { data, isLoading, isError, isRefetching, refetch } = useTasks({
    status: FILTER_STATUS[filter],
  });
  // Project names for the rows' chips: the same list the detail screen's
  // picker reads, so a name is never fetched per row.
  const { data: projects } = useProjects();
  const projectName = (id: string | null): string | null =>
    id === null ? null : (projects?.find((project) => project.id === id)?.name ?? null);
  const refreshControl = useRefreshControl(isRefetching, () => void refetch());

  return (
    <ScreenFrame>
      <View className="px-4 pt-3">
        <SegmentedControl value={filter} options={FILTERS} onChange={setFilter} />
      </View>

      {isLoading ? (
        <SkeletonList className="px-4 pt-2" />
      ) : isError ? (
        <ErrorState
          size="screen"
          message="Couldn't load tasks."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading tasks"
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            // The animated leaf around each row: fades in on appearance.
            // `enterFade`, deliberately, not `enterRise`: a preset built with
            // `withInitialValues` is a CUSTOM keyframe to Reanimated's web
            // layout-animation manager, whose cleanup then pins the entering
            // element `position: absolute` (componentUtils.ts's
            // `setElementPosition`), collapsing a FlatList cell under it --
            // observed on the web target with rows stacked at one top offset.
            // A named preset (`FadeIn`) never enters that path. No `layout`
            // transition either: the row's only height change is its error
            // line, not worth a second web animation surface.
            <AnimatedView entering={enterFade}>
              <TaskRow task={item} projectName={projectName(item.project_id)} />
            </AnimatedView>
          )}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-4`}
          refreshControl={refreshControl}
          ListEmptyComponent={
            <EmptyState
              size="screen"
              icon="checkbox-marked-circle-outline"
              title={`No ${filter} tasks.`}
            />
          }
        />
      )}

      <View className={`mx-4 mt-4 ${FLOATING_CTA_CLEARANCE_NO_TABBAR}`}>
        <Button
          label="New task"
          onPress={() => router.push("/tasks/new")}
          variant="primary"
          // Navigation, not an action: no haptic (components/ui/haptics.ts).
          haptic={false}
          icon="plus"
          block
          accessibilityLabel="New task"
        />
      </View>
    </ScreenFrame>
  );
}
