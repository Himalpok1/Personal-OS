import {
  ACTION_REGISTRY,
  READ_TOOL_DESCRIPTIONS,
  type ActionRequestItem,
  type ActionRequestStatus,
  type Agent,
  type AgentActivityItem,
  type AgentPermissionCategory,
  type AgentPermissionGrantItem,
  type AgentToolCallStatus,
  type AgentTrustLevel,
  type ReadToolName,
} from "@personal-os/schema";
import { formatDateLabel } from "@/components/academic/format";
import type { IconName } from "@/components/ui/icon";
import type { ChipTone } from "@/components/ui/status-chip";
import type { GradientName } from "@/components/ui/theme";

// Pure presentation for the Agent Center (Checkpoint 10.9, ADR-081 §9): the
// trust chips, the hero's words and gradient, the humanised tool names, the
// tool-call status chips, the correlation grouping of an agent's activity,
// the attribution of an action request to the agent that proposed it, the
// last-seen line and the permission card's copy. Every word here is a word
// for a value the schema or a row carries -- the client derives no trust
// level, no permission and no status of its own -- and nothing here reads a
// clock: a `now` is always the caller's (a query's `dataUpdatedAt`), per
// docs/MOBILE-DESIGN-SYSTEM.md rule 7.
//
// Agent-authored text (a request's `reason`) is never interpreted here: it
// is display text, quoted by the sheet under "Agent says" and never used as
// a label, a key or a decision.

export interface ChipPresentation {
  label: string;
  tone: ChipTone;
  icon?: IconName;
}

// --- trust ---------------------------------------------------------------

/** The chip for a trust level: the schema's own label, toned by how much it allows. */
export const AGENT_TRUST_CHIP: Readonly<Record<AgentTrustLevel, ChipPresentation>> = {
  none: { label: "Paused", tone: "neutral", icon: "pause-circle-outline" },
  read: { label: "Read", tone: "info", icon: "eye-outline" },
  propose: { label: "Propose", tone: "primary", icon: "lightbulb-on-outline" },
};

export const REVOKED_CHIP: ChipPresentation = {
  label: "Revoked",
  tone: "danger",
  icon: "robot-off-outline",
};

/** The chips a list row draws after the name. */
export function agentRowChips(
  agent: Pick<Agent, "trust_level" | "revoked_at">,
): ChipPresentation[] {
  return agent.revoked_at === null
    ? [AGENT_TRUST_CHIP[agent.trust_level]]
    : [AGENT_TRUST_CHIP[agent.trust_level], REVOKED_CHIP];
}

// --- hero ----------------------------------------------------------------

/** `warm` (needs attention) while an agent proposal waits, `calm` otherwise. */
export function agentsHeroGradient(pendingAgentProposals: number): GradientName {
  return pendingAgentProposals > 0 ? "warm" : "calm";
}

/** "No agents yet" / "1 agent, nothing waiting" / "2 agent proposals need you". */
export function agentsHeroHeadline(agentCount: number, pendingAgentProposals: number): string {
  if (pendingAgentProposals > 0) {
    return pendingAgentProposals === 1
      ? "1 agent proposal needs you"
      : `${pendingAgentProposals} agent proposals need you`;
  }
  if (agentCount <= 0) return "No agents yet";
  return agentCount === 1 ? "1 agent, nothing waiting" : `${agentCount} agents, nothing waiting`;
}

/** The pending requests an agent proposed -- the hero's "Proposals waiting" count. */
export function countAgentProposals(items: readonly Pick<ActionRequestItem, "source">[]): number {
  return items.filter((item) => item.source === "agent").length;
}

// --- tools ----------------------------------------------------------------

/** The manifest's own display name for a tool, never the snake_case id. */
export function humanizeToolName(name: ReadToolName): string {
  return READ_TOOL_DESCRIPTIONS[name].name;
}

/** The short word for a token-shaped refusal class (ADR-081 §4: never prose on the wire). */
const REFUSAL_LABEL: Readonly<Record<string, string>> = {
  permission_not_granted: "Not allowed",
  trust_insufficient: "Paused",
  budget_calls_exceeded: "Over budget",
  budget_chars_exceeded: "Over budget",
  rate_limited: "Rate limited",
  input_invalid: "Invalid input",
  target_not_found: "Not found",
};

export function toolCallStatusChip(
  status: AgentToolCallStatus,
  errorClass: string | null,
): ChipPresentation {
  switch (status) {
    case "completed":
      return { label: "Read", tone: "success" };
    case "refused":
      return {
        label: (errorClass !== null && REFUSAL_LABEL[errorClass]) || "Refused",
        tone: "warning",
      };
    case "failed":
      return { label: "Failed", tone: "danger" };
  }
}

// --- activity grouping -----------------------------------------------------

export interface ActivityGroup {
  /** The agent-supplied correlation id, or the request's own id for a request that carries none. */
  correlation_id: string;
  /** The newest instant in the group (the list arrives newest first). */
  at: string;
  /** Humanised names of the tools that were READ, deduped, in call order. */
  reads: string[];
  /** Tool calls the gateway refused (a permission, trust, budget or rate limit). */
  refusals: number;
  /** Tool calls that failed inside the tool. */
  failures: number;
  /** The action request proposed under this correlation, if any. */
  request: ActionRequestItem | null;
}

function groupKey(item: AgentActivityItem): string {
  if (item.kind === "tool_call") return item.correlation_id;
  return item.correlation_id ?? item.request.id;
}

/**
 * Activity rows grouped by correlation id, newest group first (the order
 * the API returns), each group carrying what was read, what was refused and
 * what was proposed. A refusal-only group and a request-only group are both
 * honest groups: the first is an agent asking for more than it may have,
 * the second a proposal made without a read.
 */
export function groupActivityByCorrelation(items: readonly AgentActivityItem[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup & { calls: { at: string; name: string }[] }>();
  for (const item of items) {
    const key = groupKey(item);
    let group = groups.get(key);
    if (!group) {
      group = {
        correlation_id: key,
        at: item.at,
        reads: [],
        refusals: 0,
        failures: 0,
        request: null,
        calls: [],
      };
      groups.set(key, group);
    }
    if (item.at > group.at) group.at = item.at;
    if (item.kind === "tool_call") {
      const call = item.tool_call;
      if (call.status === "completed") {
        group.calls.push({ at: call.called_at, name: humanizeToolName(call.tool_name) });
      } else if (call.status === "refused") {
        group.refusals += 1;
      } else {
        group.failures += 1;
      }
    } else if (group.request === null || item.request.requested_at > group.request.requested_at) {
      group.request = item.request;
    }
  }
  return [...groups.values()].map(({ calls, ...group }) => {
    const ordered = [...calls].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const reads: string[] = [];
    for (const call of ordered) if (!reads.includes(call.name)) reads.push(call.name);
    return { ...group, reads };
  });
}

/** The status word after a proposal in the activity line. */
export const PROPOSAL_STATUS_WORD: Readonly<Record<ActionRequestStatus, string>> = {
  pending: "Waiting for you",
  executing: "Running",
  completed: "Approved",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** "Read: Today · Calendar → Proposed: Create calendar event → Approved". */
export function activityGroupLine(group: ActivityGroup): string {
  const parts: string[] = [];
  if (group.reads.length > 0) parts.push(`Read: ${group.reads.join(" · ")}`);
  else if (group.refusals > 0) {
    parts.push(`Refused: ${group.refusals} ${group.refusals === 1 ? "read" : "reads"}`);
  } else if (group.failures > 0) {
    parts.push(`Failed: ${group.failures} ${group.failures === 1 ? "read" : "reads"}`);
  }
  if (group.request) {
    parts.push(`Proposed: ${ACTION_REGISTRY[group.request.action_id].name}`);
    parts.push(PROPOSAL_STATUS_WORD[group.request.status]);
  }
  return parts.length > 0 ? parts.join(" → ") : "Activity";
}

/** The chips a group's row carries: the waiting state first, then what was refused or failed. */
export function activityGroupChips(group: ActivityGroup): ChipPresentation[] {
  const chips: ChipPresentation[] = [];
  if (group.request?.status === "pending")
    chips.push({ label: "Waiting for you", tone: "warning" });
  if (group.refusals > 0) chips.push({ label: `${group.refusals} refused`, tone: "warning" });
  if (group.failures > 0) chips.push({ label: `${group.failures} failed`, tone: "danger" });
  return chips;
}

// --- attribution ------------------------------------------------------------

export interface AgentAttribution {
  /** The agent's name, or null when the list does not carry it (unknown id, list not loaded). */
  name: string | null;
  revoked: boolean;
}

/** Null unless the request came from an agent; the agent is resolved by `source_ref === agent.id`. */
export function agentAttribution(
  item: Pick<ActionRequestItem, "source" | "source_ref">,
  agents: readonly Pick<Agent, "id" | "name" | "revoked_at">[] | undefined,
): AgentAttribution | null {
  if (item.source !== "agent") return null;
  const agent = agents?.find((candidate) => candidate.id === item.source_ref);
  if (!agent) return { name: null, revoked: false };
  return { name: agent.name, revoked: agent.revoked_at !== null };
}

/** "Agent · Ray", "Agent (revoked)", or plain "Agent" when the name is unknown. */
export function agentAttributionLabel(attribution: AgentAttribution): string {
  if (attribution.revoked) return "Agent (revoked)";
  return attribution.name === null ? "Agent" : `Agent · ${attribution.name}`;
}

// --- last seen ---------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now" / "3 minutes ago" / "2 hours ago" / "4 days ago" / "Sep 2" (beyond 30 days). `now` is the caller's. */
export function relativeInstantLabel(
  iso: string,
  now: number,
  options: { timeZone?: string } = {},
): string {
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return "—";
  const elapsed = Math.max(0, now - instant);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsed < 30 * DAY_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return formatDateLabel(iso, options);
}

/** "Never used" / "Active just now" / "Active 3 hours ago" / "Last active Sep 2". */
export function agentLastSeenLabel(
  lastSeenAt: string | null,
  now: number,
  options: { timeZone?: string } = {},
): string {
  if (lastSeenAt === null || Number.isNaN(new Date(lastSeenAt).getTime())) return "Never used";
  const relative = relativeInstantLabel(lastSeenAt, now, options);
  return relative.endsWith("ago") || relative === "just now"
    ? `Active ${relative}`
    : `Last active ${relative}`;
}

// --- permission card -----------------------------------------------------------

export const AGENT_PERMISSION_CATEGORY_ICON: Readonly<Record<AgentPermissionCategory, IconName>> = {
  tasks: "checkbox-marked-outline",
  calendar: "calendar-month",
  context: "view-dashboard-outline",
  items: "text-box-outline",
  academic: "school-outline",
};

export interface AgentPermissionCardCopy {
  icon: IconName;
  kindChip: ChipPresentation;
  stateChip: ChipPresentation;
  /** Present only when the live grant predates the current disclosure. */
  reconsentChip: ChipPresentation | null;
  /** The tools (read) or the registry names of the actions (write) the capability covers. */
  coverage: string[];
  toggleLabel: "Revoke" | "Allow";
  revokeTitle: string;
  revokeMessage: string;
}

export function permissionCardCopy(item: AgentPermissionGrantItem): AgentPermissionCardCopy {
  const write = item.kind === "write";
  return {
    icon: AGENT_PERMISSION_CATEGORY_ICON[item.category],
    kindChip: write
      ? { label: "Write", tone: "primary", icon: "pencil-outline" }
      : { label: "Read", tone: "info", icon: "eye-outline" },
    stateChip: item.granted
      ? { label: "Allowed", tone: "success" }
      : { label: "Off", tone: "neutral" },
    reconsentChip:
      item.granted && item.needs_reconsent ? { label: "Re-consent needed", tone: "warning" } : null,
    coverage: write
      ? item.action_ids.map((id) => ACTION_REGISTRY[id].name)
      : item.tool_names.map(humanizeToolName),
    toggleLabel: item.granted ? "Revoke" : "Allow",
    revokeTitle: `Revoke ${item.label} for agents?`,
    revokeMessage: write
      ? "Pending agent actions that need it will be cancelled."
      : `Agents will no longer be able to read ${item.label}.`,
  };
}

/** What a screen reader hears for the whole card. */
export function permissionCardSpoken(
  item: AgentPermissionGrantItem,
  copy: AgentPermissionCardCopy,
): string {
  const reconsent = copy.reconsentChip ? `, ${copy.reconsentChip.label}` : "";
  return `${item.label}, ${copy.kindChip.label}: ${copy.stateChip.label}${reconsent}. ${item.description}`;
}
