import type { AskPreset, RemindersResponse, TodayResponse } from "@personal-os/schema";

// The empty-day short-circuit for the "Ask about today" presets (Checkpoint
// 9.7). A preset tap on a day with nothing due, scheduled or waiting is
// answered on the device -- see `askNothingCopyFor` in ask-view.tsx -- and no
// request leaves. Decided from the CACHED `/today` response the owner is
// already looking at, plus the cached `/reminders` list when the device holds
// one; an absent `/today` cache (nothing loaded yet) is NOT empty, because
// "nothing" must never be asserted from ignorance.
//
// Every section the presets could speak about is consulted, and the honest
// `total`s beside the windowed item lists: a section whose items were capped
// to zero on the wire but whose total is positive is not empty. Projects and
// reviews are deliberately NOT part of this -- a project with no task due
// today is neither due, scheduled nor waiting, and the copy says exactly that.
//
// Reminders (9.7 review): the server's Today context includes every reminder
// inside a seven-day horizon, which `/today` cannot show -- a task due next
// month with a reminder tomorrow evening appears nowhere on Today. So the
// cached reminders list is consulted too, over the SAME window the server
// uses (`[now - 1h, now + 7 days]`, read-models/reminders.ts). An undefined
// reminders cache (web, or nothing fetched yet) simply cannot vouch either
// way and is treated like an absent `/today`: not empty.

/** The server's Today-context reminder horizon, mirrored here. */
export const ASK_REMINDER_HORIZON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** The grace hour the server keeps a just-fired reminder listed for. */
const REMINDER_GRACE_MS = 60 * 60 * 1000;

/**
 * True when any cached reminder falls inside the server's seven-day context
 * window. `undefined` (no cache) is NEVER "empty" -- the caller must treat it
 * as unknown, exactly like an unloaded `/today`.
 */
export function hasReminderWithinHorizon(
  reminders: RemindersResponse | undefined,
  now: number,
): boolean | undefined {
  if (reminders === undefined) return undefined;
  const from = now - REMINDER_GRACE_MS;
  const to = now + ASK_REMINDER_HORIZON_DAYS * MS_PER_DAY;
  return reminders.items.some((item) => {
    const at = Date.parse(item.remind_at);
    return Number.isFinite(at) && at >= from && at <= to;
  });
}

export function isTodayEmpty(
  today: TodayResponse | undefined,
  reminders: RemindersResponse | undefined,
  now: number = Date.now(),
): boolean {
  if (today === undefined) return false;
  // `undefined` (no cache) and `true` (one inside the window) both mean the
  // day cannot be called empty; only a cached list with nothing in the window
  // lets the Today sections decide.
  if (hasReminderWithinHorizon(reminders, now) !== false) return false;
  const { summary, overdue, due_today, events_today, upcoming, inbox } = today;
  if (summary.overdue_total > 0 || summary.due_today_total > 0) return false;
  if (summary.inbox_attention_total > 0) return false;
  if (overdue.total > 0 || overdue.items.length > 0) return false;
  if (due_today.total > 0 || due_today.items.length > 0) return false;
  if (events_today.items.length > 0) return false;
  for (const day of upcoming.days) {
    if (day.total > 0 || day.tasks.length > 0 || day.events.length > 0) return false;
  }
  if (inbox.pending_count > 0 || inbox.needs_confirm_count > 0 || inbox.failed_count > 0) {
    return false;
  }
  if (inbox.items.length > 0) return false;
  return true;
}

export type AskSubmissionPlan =
  /** A preset on an empty day: answer locally, send nothing. */
  | { kind: "nothing_today"; preset: AskPreset }
  /** Send. A preset goes as `today` (no note/task body); free text as `both`. */
  | { kind: "send"; question: string; scope: "today" | "both" };

/**
 * THE decision behind every Ask submission (Checkpoint 9.7), pure so it is
 * testable without a renderer. Called from the screen's one `submit`
 * function -- a tap on Ask, the keyboard's send key, or a preset chip -- and
 * never from an effect or from mount.
 */
export function planAskSubmission(
  question: string,
  today: TodayResponse | undefined,
  presetOf: (question: string) => AskPreset | null,
  reminders: RemindersResponse | undefined,
  now: number = Date.now(),
): AskSubmissionPlan {
  const preset = presetOf(question);
  if (preset !== null && isTodayEmpty(today, reminders, now)) {
    return { kind: "nothing_today", preset };
  }
  return { kind: "send", question, scope: preset !== null ? "today" : "both" };
}
