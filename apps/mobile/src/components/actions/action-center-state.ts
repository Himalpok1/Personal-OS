import { toWallClockComponents } from "@personal-os/core/timezone";
import {
  ACTION_REASON_MAX_CHARS,
  reversalActionOf,
  type ActionRequestCreate,
  type ActionRequestItem,
  type ActionsSummary,
} from "@personal-os/schema";
import { formatDateLabel } from "@/components/academic/format";
import type { GradientName } from "@/components/ui/theme";
import { ACTION_SOURCE_LABEL, actionReasonText } from "./action-approval-sheet-state";

// Pure presentation for the Action Center screen (Checkpoint 10.8, ADR-078
// §8): the hero's words and gradient, the three tabs, the history grouping.
// No clock is read here -- a `now` is always the caller's (a query's
// `dataUpdatedAt`), per docs/MOBILE-DESIGN-SYSTEM.md rule 7.

export const ACTION_TABS = ["pending", "history", "permissions"] as const;
export type ActionTab = (typeof ACTION_TABS)[number];

/** A `?tab=` deep-link param: a known tab, else Pending. */
export function coerceActionTabParam(value: unknown): ActionTab {
  return typeof value === "string" && (ACTION_TABS as readonly string[]).includes(value)
    ? (value as ActionTab)
    : "pending";
}

/** "Nothing waiting" / "1 action needs you" / "N actions need you". */
export function actionsHeroHeadline(pendingTotal: number): string {
  if (pendingTotal <= 0) return "Nothing waiting";
  return pendingTotal === 1 ? "1 action needs you" : `${pendingTotal} actions need you`;
}

/** `warm` (needs attention) while something is pending, `calm` (all clear) otherwise. */
export function actionsHeroGradient(pendingTotal: number): GradientName {
  return pendingTotal > 0 ? "warm" : "calm";
}

export interface HeroCount {
  key: "pending" | "completed" | "allowed";
  label: string;
  value: number;
}

/** The three counts under the headline, in order. */
export function actionsHeroCounts(summary: ActionsSummary): HeroCount[] {
  return [
    { key: "pending", label: "Pending", value: summary.pending_total },
    { key: "completed", label: "Done this week", value: summary.completed_last_7_days },
    { key: "allowed", label: "Allowed", value: summary.permissions_granted },
  ];
}

/** "3 of 4 capabilities allowed" -- the Settings card's caption. */
export function capabilitiesAllowedLine(
  summary: Pick<ActionsSummary, "permissions_granted" | "permissions_total">,
): string {
  const noun = summary.permissions_total === 1 ? "capability" : "capabilities";
  return `${summary.permissions_granted} of ${summary.permissions_total} ${noun} allowed`;
}

/** The pending row's second line: the client-authored reason, else where it came from. */
export function pendingRowSubtitle(item: ActionRequestItem): string {
  const reason = item.reason?.trim() ?? "";
  return reason.length > 0 ? reason : `From ${ACTION_SOURCE_LABEL[item.source]}`;
}

/** What a screen reader hears for a pending row. */
export function pendingRowSpoken(item: ActionRequestItem): string {
  return `${item.input_summary}. ${actionReasonText(item)}. Opens the approval sheet`;
}

/** Everything the list returned that is no longer waiting on the owner. */
export function historyItems(items: readonly ActionRequestItem[]): ActionRequestItem[] {
  return items.filter((item) => item.status !== "pending" && item.status !== "executing");
}

export interface HistoryDayGroup {
  /** The local `YYYY-MM-DD` the group stands for. */
  date: string;
  /** "Today", "Yesterday", or "Sep 15". */
  label: string;
  items: ActionRequestItem[];
}

function localDateKey(iso: string, timeZone: string): string {
  const c = toWallClockComponents(new Date(iso), timeZone);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

/** The instant a history row is filed under: when it finished, else when it was requested. */
function historyInstant(item: ActionRequestItem): string {
  return item.finished_at ?? item.requested_at;
}

/**
 * Rows grouped by local day, newest group first, each group in the order
 * the list arrived (the API already orders newest first). `now` is the
 * query's `dataUpdatedAt`, never a clock read.
 */
export function groupHistoryByDay(
  items: readonly ActionRequestItem[],
  options: { timeZone: string; now: number },
): HistoryDayGroup[] {
  const today = localDateKey(new Date(options.now).toISOString(), options.timeZone);
  const yesterday = localDateKey(
    new Date(options.now - 24 * 60 * 60 * 1000).toISOString(),
    options.timeZone,
  );
  const groups = new Map<string, HistoryDayGroup>();
  for (const item of items) {
    const instant = historyInstant(item);
    const date = localDateKey(instant, options.timeZone);
    let group = groups.get(date);
    if (!group) {
      const label =
        date === today
          ? "Today"
          : date === yesterday
            ? "Yesterday"
            : formatDateLabel(instant, { timeZone: options.timeZone });
      group = { date, label, items: [] };
      groups.set(date, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// --- undo (the detail screen) ---------------------------------------------

export type UndoAvailability = "available" | "undone" | "none";

/**
 * "Undo" is offered only for a COMPLETED request whose registry entry names
 * a reversal, that produced a target, and that no later request has already
 * reversed (ADR-078 §8). A reversed row shows "Undone" instead.
 */
export function undoAvailability(
  item: Pick<ActionRequestItem, "status" | "action_id" | "target_id" | "reversed_by_request_id">,
): UndoAvailability {
  if (item.reversed_by_request_id !== null) return "undone";
  if (item.status !== "completed" || item.target_id === null) return "none";
  return reversalActionOf(item.action_id) === null ? "none" : "available";
}

/**
 * The NEW request an Undo proposes: the registry's reversal action over the
 * completed request's own target, `source: "manual"` (the owner tapped it),
 * a reason naming what it undoes, and `reverses_request_id` so the original
 * row can render "Undone" once this one completes. Null when no undo is
 * available. The request is approved like any other -- never automatic.
 */
export function buildUndoRequest(item: ActionRequestItem): ActionRequestCreate | null {
  if (undoAvailability(item) !== "available" || item.target_id === null) return null;
  const reversal = reversalActionOf(item.action_id);
  if (reversal === null) return null;
  const common = {
    source: "manual" as const,
    reason: Array.from(`Undo: ${item.input_summary}`).slice(0, ACTION_REASON_MAX_CHARS).join(""),
    reverses_request_id: item.id,
  };
  switch (reversal) {
    case "archive_calendar_event":
      return { action_id: reversal, input: { event_id: item.target_id }, ...common };
    case "archive_task":
    case "complete_task":
    case "reopen_task":
      return { action_id: reversal, input: { task_id: item.target_id }, ...common };
    case "create_calendar_event":
    case "create_task":
      // The registry names no create as a reversal; a reversal that needs a
      // full input has no target to build it from.
      return null;
  }
}
