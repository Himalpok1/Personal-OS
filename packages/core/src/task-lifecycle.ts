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
