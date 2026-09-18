import { parseFlexibleDatetime } from "@personal-os/core/timezone";
import {
  ACTION_PERMISSION_LABELS,
  ACTION_REGISTRY,
  parseActionInput,
  type ActionCategory,
  type ActionDefinition,
  type ActionErrorClass,
  type ActionId,
  type ActionRequestItem,
  type ActionRequestStatus,
  type ActionRiskLevel,
  type ActionSource,
} from "@personal-os/schema";
import { formatDueLabel, formatWhenLabel } from "@/components/academic/format";
import type { IconName } from "@/components/ui/icon";
import type { ChipTone } from "@/components/ui/status-chip";

// Pure presentation for the approval sheet, the Action Center rows and the
// detail screen (Checkpoint 10.8, ADR-078 §6/§8). Every word here is a word
// for a value the REGISTRY or the request row carries -- the client derives
// no risk, no reversibility and no status of its own. Nothing here is AI:
// `reason` and `source` are client-authored at proposal time (§6) and are
// rendered back verbatim.

export interface ChipPresentation {
  label: string;
  tone: ChipTone;
  icon?: IconName;
}

/** The registry entry for a request -- the client imports it, the wire never repeats it. */
export function actionDefinitionFor(item: Pick<ActionRequestItem, "action_id">): ActionDefinition {
  return ACTION_REGISTRY[item.action_id];
}

export const ACTION_CATEGORY_ICON: Readonly<Record<ActionCategory, IconName>> = {
  calendar: "calendar-month",
  tasks: "checkbox-marked-outline",
};

/** The capability chip: the permission's own label, with the category's icon. */
export function permissionChip(definition: ActionDefinition): ChipPresentation {
  return {
    label: ACTION_PERMISSION_LABELS[definition.permission].label,
    tone: "info",
    icon: ACTION_CATEGORY_ICON[definition.category],
  };
}

/** "Reversible" when the registry names an undo action, "Hard to undo" otherwise. */
export function reversibilityChip(definition: ActionDefinition): ChipPresentation {
  return definition.reversibility.kind === "via_action"
    ? { label: "Reversible", tone: "success", icon: "undo-variant" }
    : { label: "Hard to undo", tone: "warning", icon: "alert-outline" };
}

const RISK_CHIP: Readonly<Record<ActionRiskLevel, ChipPresentation>> = {
  low: { label: "Low risk", tone: "neutral" },
  medium: { label: "Medium risk", tone: "warning" },
  high: { label: "High risk", tone: "danger" },
};

export function riskChip(risk: ActionRiskLevel): ChipPresentation {
  return RISK_CHIP[risk];
}

/** The three chips the sheet leads with, in order: capability, reversibility, risk. */
export function actionChipStrip(definition: ActionDefinition): ChipPresentation[] {
  return [permissionChip(definition), reversibilityChip(definition), riskChip(definition.risk)];
}

/** The word for where a proposal came from (ADR-078 §6: a client surface, never a model). */
export const ACTION_SOURCE_LABEL: Readonly<Record<ActionSource, string>> = {
  focus_now: "Focus Now",
  briefing: "Briefing",
  academic: "Academics",
  manual: "You",
};

export function actionSourceChip(source: ActionSource): ChipPresentation {
  return { label: ACTION_SOURCE_LABEL[source], tone: source === "manual" ? "neutral" : "info" };
}

/** The line under "Why": the client-authored reason, or the honest fallback for a bare manual request. */
export const ACTION_REASON_FALLBACK = "You asked for this";

export function actionReasonText(item: Pick<ActionRequestItem, "reason">): string {
  const reason = item.reason?.trim() ?? "";
  return reason.length > 0 ? reason : ACTION_REASON_FALLBACK;
}

const STATUS_CHIP: Readonly<Record<ActionRequestStatus, ChipPresentation>> = {
  pending: { label: "Pending", tone: "warning" },
  executing: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export function actionStatusChip(status: ActionRequestStatus): ChipPresentation {
  return STATUS_CHIP[status];
}

/**
 * A friendly line per token-shaped `error_class` (ADR-078 §4: never prose on
 * the wire, so the words live here). An unknown class -- one a later
 * checkpoint adds -- is named rather than hidden.
 */
const ERROR_CLASS_LABEL: Readonly<Record<ActionErrorClass, string>> = {
  target_not_found: "The item this action was for no longer exists.",
  target_not_local: "That event came from a connected calendar, so it can't be changed here.",
  target_archived: "That item is archived.",
  task_recurring: "That task repeats. Complete it from one of its occurrences instead.",
  task_not_open: "That task isn't open any more.",
  task_not_reopenable: "That task can't be reopened.",
  calendar_not_eligible: "The chosen calendar can't be written to.",
  input_invalid: "The request no longer passes validation.",
  permission_revoked: "That permission was revoked before this could run.",
  execution_failed: "Personal OS couldn't complete the action.",
};

export function actionErrorLabel(errorClass: string | null): string {
  if (errorClass === null) return "The action failed.";
  const known = (ERROR_CLASS_LABEL as Record<string, string | undefined>)[errorClass];
  return known ?? `The action failed (${errorClass}).`;
}

/** One label/value line of the "What will change" block. */
export interface ChangeRow {
  label: string;
  value: string;
}

function whenValue(startsAt: string, endsAt: string, timezone: string): string {
  try {
    const start = parseFlexibleDatetime(startsAt, timezone);
    const end = parseFlexibleDatetime(endsAt, timezone);
    return formatWhenLabel(
      { at: start.toISOString(), ends_at: end.toISOString(), all_day: false },
      { timeZone: timezone },
    );
  } catch {
    return "—";
  }
}

function instantValue(value: string, timezone: string): string {
  try {
    return formatDueLabel(parseFlexibleDatetime(value, timezone).toISOString(), {
      timeZone: timezone,
    });
  } catch {
    return "—";
  }
}

/**
 * The rows the owner reads before approving, derived from the FROZEN input
 * (ADR-078 §4). Raw ids are never printed: a linked project or assignment is
 * named as a fact ("Linked to an assignment"), and a target action shows the
 * server's own bounded `input_summary` for its target.
 *
 * `input` is an opaque record on the wire and is narrowed here through the
 * action's own schema (`parseActionInput`); a row whose frozen input no
 * longer parses still renders -- as its `input_summary` alone -- rather than
 * blanking the sheet.
 */
export function whatWillChangeRows(item: ActionRequestItem): ChangeRow[] {
  switch (item.action_id) {
    case "create_calendar_event": {
      const input = parseActionInput({ action_id: item.action_id, input: item.input });
      if (input === null) return [{ label: "Event", value: item.input_summary }];
      const rows: ChangeRow[] = [
        { label: "Title", value: input.title },
        { label: "When", value: whenValue(input.starts_at, input.ends_at, input.timezone) },
        { label: "Calendar", value: input.calendar ? "Linked calendar" : "Not linked" },
      ];
      if (input.location) rows.push({ label: "Where", value: input.location });
      if (input.project_id) rows.push({ label: "Project", value: "Linked to a project" });
      return rows;
    }
    case "create_task": {
      const input = parseActionInput({ action_id: item.action_id, input: item.input });
      if (input === null) return [{ label: "Task", value: item.input_summary }];
      const rows: ChangeRow[] = [
        { label: "Title", value: input.title },
        {
          label: "Due",
          value: input.due_at ? instantValue(input.due_at, input.timezone) : "No due date",
        },
      ];
      if (input.remind_at) {
        rows.push({ label: "Reminder", value: instantValue(input.remind_at, input.timezone) });
      }
      if (input.priority !== undefined)
        rows.push({ label: "Priority", value: `P${input.priority}` });
      if (input.project_id) rows.push({ label: "Project", value: "Linked to a project" });
      if (input.canvas_assignment_id) {
        rows.push({ label: "Assignment", value: "Linked to an assignment" });
      }
      return rows;
    }
    case "archive_calendar_event":
      return [{ label: "Event", value: item.input_summary }];
    case "archive_task":
    case "complete_task":
    case "reopen_task":
      return [{ label: "Task", value: item.input_summary }];
  }
}

/** What a screen reader hears for the whole "What will change" group. */
export function whatWillChangeSpoken(rows: readonly ChangeRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join(". ");
}

/** The registry name for a row's title chip on the detail screen. */
export function actionName(id: ActionId): string {
  return ACTION_REGISTRY[id].name;
}
