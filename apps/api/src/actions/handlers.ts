import { parseFlexibleDatetime, toWallClockComponents } from "@personal-os/core";
import { log } from "@personal-os/core/logging/logger";
import { events, projects, type Db } from "@personal-os/db";
import { ACTION_SUMMARY_MAX_CHARS, type ActionInput } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import { resolveWritableCalendar } from "../routes/calendar-targets.js";
import {
  archiveLocalEvent,
  createLocalEvent,
  enqueuePushIfLinked,
  resolveWritableCalendarInTx,
  type CalendarLinkTarget,
  type EventTx,
} from "../services/events.js";
import {
  archiveTask,
  canvasAssignmentExists,
  canvasAssignmentValidationIssue,
  completeTask,
  createTask,
  loadTaskForAction,
  reopenTask,
  type TaskActionView,
  type TaskTx,
} from "../services/tasks.js";
import {
  ActionExecutionError,
  ActionValidationError,
  type ActionHandler,
  type ActionHandlerMap,
  type ActionTarget,
  type ActionValidationIssue,
} from "./types.js";

// The six executors (Checkpoint 10.8, ADR-078 §2). Each `execute` is a thin
// caller of the SAME service function the direct route calls
// (services/events.ts, services/tasks.ts); each `prepare` is read-only and
// composes the bounded summary the owner approves. Nothing here logs a
// title, a summary or an input: the one log line (a reopen's swallowed
// occurrence-seeding failure) carries a task id and an error token, exactly
// as POST /tasks/:id/reopen's own warn does.
//
// Every ActionValidationError / ActionExecutionError message below is a
// static string: never a title, never provider prose, never the input.

// ---- Summaries --------------------------------------------------------------

const ELLIPSIS = "…";

/**
 * `${prefix}“${title}”${suffix}`, bounded at ACTION_SUMMARY_MAX_CHARS by
 * shortening the TITLE (never the server-authored frame around it). Titles
 * are bounded at ENTITY_TITLE_MAX_CHARS (512) upstream, so this bites only
 * on a long title; the frame itself is always well under the limit.
 */
function quotedSummary(prefix: string, title: string, suffix = ""): string {
  const frame = `${prefix}“”${suffix}`;
  const room = ACTION_SUMMARY_MAX_CHARS - frame.length;
  const shown =
    title.length <= room ? title : `${title.slice(0, Math.max(0, room - 1))}${ELLIPSIS}`;
  return `${prefix}“${shown}”${suffix}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD HH:MM` on the wall clock of `timezone` -- what the owner will see on the sheet. */
function formatLocal(instant: Date, timezone: string): { date: string; time: string } {
  const c = toWallClockComponents(instant, timezone);
  return {
    date: `${c.year}-${pad(c.month)}-${pad(c.day)}`,
    time: `${pad(c.hour)}:${pad(c.minute)}`,
  };
}

/** `2026-09-20 14:00–15:30`, or `2026-09-20 22:00–2026-09-21 01:00` across a local midnight. */
function formatLocalRange(startsAt: Date, endsAt: Date, timezone: string): string {
  const start = formatLocal(startsAt, timezone);
  const end = formatLocal(endsAt, timezone);
  const endText = start.date === end.date ? end.time : `${end.date} ${end.time}`;
  return `${start.date} ${start.time}–${endText}`;
}

// ---- Shared checks ------------------------------------------------------------

function issue(path: string[], message: string): ActionValidationIssue {
  return { code: "custom", path, message };
}

async function projectExists(db: Db | EventTx, id: string): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
  return row !== undefined;
}

async function requireProject(db: Db, id: string | undefined): Promise<void> {
  if (id === undefined) return;
  if (!(await projectExists(db, id))) {
    throw new ActionValidationError(
      issue(["project_id"], "project_id does not reference an existing project"),
    );
  }
}

/**
 * A timed, non-recurring event's two instants, resolved the way POST /events
 * resolves them (an offset-less value against the input's own timezone).
 * The schema's refine already compared the raw strings; this is the
 * instant-level check the route performs after parsing.
 */
function parseEventInstants(input: ActionInput<"create_calendar_event">): {
  startsAt: Date;
  endsAt: Date;
} | null {
  const startsAt = parseFlexibleDatetime(input.starts_at, input.timezone);
  const endsAt = parseFlexibleDatetime(input.ends_at, input.timezone);
  if (endsAt.getTime() <= startsAt.getTime()) return null;
  return { startsAt, endsAt };
}

interface EventActionView {
  id: string;
  title: string;
  origin: string;
  archivedAt: Date | null;
  parentEventId: string | null;
}

async function loadEventForAction(
  db: Db | EventTx,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<EventActionView | null> {
  const query = db
    .select({
      id: events.id,
      title: events.title,
      origin: events.origin,
      archivedAt: events.archivedAt,
      parentEventId: events.parentEventId,
    })
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  const [row] = options.forUpdate ? await query.for("update") : await query;
  return row ?? null;
}

// The routes/events.ts ownership gate, verbatim in spirit: an external row is
// read-only, and so is a detached child whose PARENT is external -- the
// child's own `origin` came from the detach that created it, but its
// identity belongs to the external series.
async function isExternallyOwnedEvent(db: Db | EventTx, row: EventActionView): Promise<boolean> {
  if (row.origin !== "local") return true;
  if (row.parentEventId === null) return false;
  const parent = await loadEventForAction(db, row.parentEventId);
  return parent === null || parent.origin !== "local";
}

const EVENT_NOT_FOUND = "event_id does not reference an existing event";
const EVENT_NOT_LOCAL = "event is read-only (synced from a calendar)";
const EVENT_ARCHIVED = "event is already archived";

const TASK_NOT_FOUND = "task_id does not reference an existing task";
const TASK_ARCHIVED = "task is archived";
const TASK_RECURRING = "recurring tasks complete through their occurrences";
const TASK_NOT_OPEN = "task is not open";
const TASK_NOT_REOPENABLE = "task is not done or dropped";

function isOpenTask(status: string): boolean {
  return status === "inbox" || status === "active";
}

function isReopenableTask(status: string): boolean {
  return status === "done" || status === "dropped";
}

/**
 * The read-only target check every task action's `prepare` shares: the row
 * must exist and must not be archived. The per-action status rule is layered
 * on by the caller.
 */
async function prepareTaskTarget(db: Db, id: string): Promise<TaskActionView> {
  const task = await loadTaskForAction(db, id);
  if (!task) throw new ActionValidationError(issue(["task_id"], TASK_NOT_FOUND));
  if (task.archivedAt) throw new ActionValidationError(issue(["task_id"], TASK_ARCHIVED));
  return task;
}

/** The same check at approval time, under the row lock, as execution error classes. */
async function lockTaskTarget(tx: TaskTx, id: string): Promise<TaskActionView> {
  const task = await loadTaskForAction(tx, id, { forUpdate: true });
  if (!task) throw new ActionExecutionError("target_not_found", TASK_NOT_FOUND);
  if (task.archivedAt) throw new ActionExecutionError("target_archived", TASK_ARCHIVED);
  return task;
}

function taskTarget(id: string): ActionTarget {
  return { type: "task", id };
}

function eventTarget(id: string): ActionTarget {
  return { type: "event", id };
}

// The reopen service reports a swallowed occurrence-seeding failure through
// this sink -- ids and an error token only, the same shape the route's own
// app.log.warn line carries.
const reopenWarnSink = {
  warn(fields: { taskId: string; error: string }): void {
    log.warn("actions.reopen_task.occurrence_seeding_failed", fields);
  },
};

// ---- Calendar -----------------------------------------------------------------

const createCalendarEvent: ActionHandler<"create_calendar_event"> = {
  async prepare(db, input) {
    const instants = parseEventInstants(input);
    if (!instants) {
      throw new ActionValidationError(issue(["ends_at"], "ends_at must be after starts_at"));
    }
    await requireProject(db, input.project_id);
    if (input.calendar) {
      const resolved = await resolveWritableCalendar(db, input.calendar);
      if (!resolved.ok) throw new ActionValidationError(issue(["calendar"], resolved.reason));
    }
    return {
      inputSummary: quotedSummary(
        "Create event ",
        input.title,
        ` · ${formatLocalRange(instants.startsAt, instants.endsAt, input.timezone)}`,
      ),
      target: null,
    };
  },

  async execute(ctx, input) {
    const instants = parseEventInstants(input);
    if (!instants)
      throw new ActionExecutionError("input_invalid", "ends_at is not after starts_at");

    // Re-resolved under the transaction: a calendar that stopped being
    // write-eligible between the request and the approval must not receive
    // a pending_push link it can never honour.
    let calendarTarget: CalendarLinkTarget | null = null;
    if (input.calendar) {
      const resolved = await resolveWritableCalendarInTx(ctx.tx, input.calendar);
      if (!resolved.ok) {
        throw new ActionExecutionError("calendar_not_eligible", "calendar is not write-eligible");
      }
      calendarTarget = resolved;
    }

    const { row, link } = await createLocalEvent(
      ctx.tx,
      {
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: instants.startsAt,
        endsAt: instants.endsAt,
        timezone: input.timezone,
        allDay: false,
        startDate: null,
        endDate: null,
        projectId: input.project_id,
        rrule: null,
        recurrenceTimezone: null,
        recurrenceUntil: null,
        recurrenceCount: null,
        recurrenceExdates: null,
        clientUuid: null,
        calendarTarget,
      },
      ctx.now,
    );

    const linked = link !== null;
    return {
      output: { event_id: row.id },
      target: eventTarget(row.id),
      resultSummary: quotedSummary("Created event ", row.title),
      ...(linked ? { afterCommit: (app) => enqueuePushIfLinked(app, row.id, true) } : {}),
    };
  },
};

const archiveCalendarEvent: ActionHandler<"archive_calendar_event"> = {
  async prepare(db, input) {
    const event = await loadEventForAction(db, input.event_id);
    if (!event) throw new ActionValidationError(issue(["event_id"], EVENT_NOT_FOUND));
    if (await isExternallyOwnedEvent(db, event)) {
      throw new ActionValidationError(issue(["event_id"], EVENT_NOT_LOCAL));
    }
    if (event.archivedAt) throw new ActionValidationError(issue(["event_id"], EVENT_ARCHIVED));
    return {
      inputSummary: quotedSummary("Archive event ", event.title),
      target: eventTarget(event.id),
    };
  },

  async execute(ctx, input) {
    const event = await loadEventForAction(ctx.tx, input.event_id, { forUpdate: true });
    if (!event) throw new ActionExecutionError("target_not_found", EVENT_NOT_FOUND);
    if (await isExternallyOwnedEvent(ctx.tx, event)) {
      throw new ActionExecutionError("target_not_local", EVENT_NOT_LOCAL);
    }
    if (event.archivedAt) throw new ActionExecutionError("target_archived", EVENT_ARCHIVED);

    const { row, linked } = await archiveLocalEvent(ctx.tx, event.id, ctx.now);
    // The row was locked above, so a concurrent archive cannot have won the
    // conditional stamp; a null here is a defect, not a race to tolerate.
    if (!row) throw new ActionExecutionError("target_archived", EVENT_ARCHIVED);

    return {
      output: { event_id: row.id },
      target: eventTarget(row.id),
      resultSummary: "Archived",
      // The archive route enqueues the remote delete after commit exactly
      // the same way; `linked` came from the link's own pending_push flip.
      ...(linked ? { afterCommit: (app) => enqueuePushIfLinked(app, row.id, true) } : {}),
    };
  },
};

// ---- Tasks --------------------------------------------------------------------

const createTaskAction: ActionHandler<"create_task"> = {
  async prepare(db, input) {
    await requireProject(db, input.project_id);
    if (
      input.canvas_assignment_id !== undefined &&
      !(await canvasAssignmentExists(db, input.canvas_assignment_id))
    ) {
      throw new ActionValidationError(canvasAssignmentValidationIssue());
    }
    const due = input.due_at ? parseFlexibleDatetime(input.due_at, input.timezone) : null;
    const suffix = due
      ? ` · due ${formatLocal(due, input.timezone).date} ${formatLocal(due, input.timezone).time}`
      : "";
    return { inputSummary: quotedSummary("Create task ", input.title, suffix), target: null };
  },

  async execute(ctx, input) {
    // The ADR-074 link is re-checked under the transaction, as PATCH /tasks/:id
    // checks it before its own write; the FK would otherwise surface as a
    // generic execution_failed.
    if (
      input.canvas_assignment_id !== undefined &&
      !(await canvasAssignmentExists(ctx.tx, input.canvas_assignment_id))
    ) {
      throw new ActionExecutionError("target_not_found", "canvas assignment no longer exists");
    }
    const row = await createTask(
      ctx.tx,
      {
        title: input.title,
        body: input.body,
        status: "active",
        dueAt: input.due_at ? parseFlexibleDatetime(input.due_at, input.timezone) : null,
        remindAt: input.remind_at ? parseFlexibleDatetime(input.remind_at, input.timezone) : null,
        timezone: input.timezone,
        priority: input.priority,
        projectId: input.project_id,
        canvasAssignmentId: input.canvas_assignment_id ?? null,
        rrule: null,
        recurrenceTimezone: null,
        recurrenceAnchor: null,
        recurrenceUntil: null,
        recurrenceCount: null,
        recurrenceExdates: null,
      },
      ctx.now,
    );
    return {
      output: { task_id: row.id },
      target: taskTarget(row.id),
      resultSummary: quotedSummary("Created task ", row.title),
    };
  },
};

const archiveTaskAction: ActionHandler<"archive_task"> = {
  async prepare(db, input) {
    const task = await prepareTaskTarget(db, input.task_id);
    return {
      inputSummary: quotedSummary("Archive task ", task.title),
      target: taskTarget(task.id),
    };
  },

  async execute(ctx, input) {
    const task = await lockTaskTarget(ctx.tx, input.task_id);
    const row = await archiveTask(ctx.tx, task.id, ctx.now);
    if (!row) throw new ActionExecutionError("target_not_found", TASK_NOT_FOUND);
    return { output: { task_id: row.id }, target: taskTarget(row.id), resultSummary: "Archived" };
  },
};

const completeTaskAction: ActionHandler<"complete_task"> = {
  async prepare(db, input) {
    const task = await prepareTaskTarget(db, input.task_id);
    if (task.rrule !== null) throw new ActionValidationError(issue(["task_id"], TASK_RECURRING));
    if (!isOpenTask(task.status))
      throw new ActionValidationError(issue(["task_id"], TASK_NOT_OPEN));
    return {
      inputSummary: quotedSummary("Complete task ", task.title),
      target: taskTarget(task.id),
    };
  },

  async execute(ctx, input) {
    const task = await lockTaskTarget(ctx.tx, input.task_id);
    if (task.rrule !== null) throw new ActionExecutionError("task_recurring", TASK_RECURRING);
    if (!isOpenTask(task.status)) throw new ActionExecutionError("task_not_open", TASK_NOT_OPEN);
    const row = await completeTask(ctx.tx, task.id, ctx.now);
    if (!row) throw new ActionExecutionError("target_not_found", TASK_NOT_FOUND);
    return {
      output: { task_id: row.id },
      target: taskTarget(row.id),
      resultSummary: "Marked done",
    };
  },
};

const reopenTaskAction: ActionHandler<"reopen_task"> = {
  async prepare(db, input) {
    const task = await prepareTaskTarget(db, input.task_id);
    if (!isReopenableTask(task.status)) {
      throw new ActionValidationError(issue(["task_id"], TASK_NOT_REOPENABLE));
    }
    return { inputSummary: quotedSummary("Reopen task ", task.title), target: taskTarget(task.id) };
  },

  async execute(ctx, input) {
    const task = await lockTaskTarget(ctx.tx, input.task_id);
    if (!isReopenableTask(task.status)) {
      throw new ActionExecutionError("task_not_reopenable", TASK_NOT_REOPENABLE);
    }
    const row = await reopenTask(ctx.tx, task.id, ctx.now, reopenWarnSink);
    if (!row) throw new ActionExecutionError("target_not_found", TASK_NOT_FOUND);
    return { output: { task_id: row.id }, target: taskTarget(row.id), resultSummary: "Reopened" };
  },
};

export const ACTION_HANDLERS: ActionHandlerMap = {
  create_calendar_event: createCalendarEvent,
  archive_calendar_event: archiveCalendarEvent,
  create_task: createTaskAction,
  archive_task: archiveTaskAction,
  complete_task: completeTaskAction,
  reopen_task: reopenTaskAction,
};
