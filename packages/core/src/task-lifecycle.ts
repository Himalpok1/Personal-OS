// Small pure invariants shared between apps/api's task routes and (later)
// the mobile UI, so "can this task be completed/activated directly" isn't
// re-derived inline in a route handler or a React component.

/** A task can only be marked done directly if it isn't recurring -- a
 * recurring task's completion goes through its open occurrence instead
 * (see docs/ARCHITECTURE.md's recurrence design). */
export function canCompleteTaskDirectly(task: { rrule: string | null }): boolean {
  return task.rrule === null;
}

/** The inbox -> active transition is only valid from 'inbox'; every other
 * status (active/done/dropped) rejects it. */
export function canActivateTask(task: { status: string }): boolean {
  return task.status === "inbox";
}

/** done|dropped -> active (Checkpoint 9.3, POST /tasks/:id/reopen). `inbox`
 * has its own forward transition (activate) and `active` is already open,
 * so both reject rather than silently no-op -- the route turns a false here
 * into 409 task_not_reopenable. Takes the bare status, not the row: the
 * mobile client decides whether to show a Reopen control from the same
 * predicate without holding a full Task. */
export function canReopenTask(status: string): boolean {
  return status === "done" || status === "dropped";
}
