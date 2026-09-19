import { AGENT_TOOL_ERROR_CLASSES, AGENT_TRUST_LEVELS, READ_TOOL_NAMES } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  AGENT_TRUST_CHIP,
  REVOKED_CHIP,
  activityGroupChips,
  activityGroupLine,
  agentAttribution,
  agentAttributionLabel,
  agentLastSeenLabel,
  agentRowChips,
  agentsHeroGradient,
  agentsHeroHeadline,
  countAgentProposals,
  groupActivityByCorrelation,
  humanizeToolName,
  permissionCardCopy,
  permissionCardSpoken,
  relativeInstantLabel,
  toolCallStatusChip,
} from "./agents-state";
import {
  AGENT_ID,
  CORRELATION_A,
  CORRELATION_B,
  agent as agentFixture,
  agentRequest,
  readGrant,
  requestActivity,
  revokedAgent,
  toolCallActivity,
  writeGrant,
} from "./fixtures.test-support";

const NOW = Date.parse("2026-09-18T15:00:00Z");

describe("trust chips", () => {
  it("has a chip for every trust level, with the schema's own words", () => {
    for (const level of AGENT_TRUST_LEVELS) expect(AGENT_TRUST_CHIP[level].label).toBeTruthy();
    expect(AGENT_TRUST_CHIP.none).toMatchObject({ label: "Paused", tone: "neutral" });
    expect(AGENT_TRUST_CHIP.read).toMatchObject({ label: "Read", tone: "info" });
    expect(AGENT_TRUST_CHIP.propose).toMatchObject({ label: "Propose", tone: "primary" });
  });

  it("a row carries the trust chip, plus Revoked for a revoked agent", () => {
    expect(agentRowChips(agentFixture())).toEqual([AGENT_TRUST_CHIP.propose]);
    expect(agentRowChips(revokedAgent())).toEqual([AGENT_TRUST_CHIP.read, REVOKED_CHIP]);
  });
});

describe("the hero", () => {
  it("is warm while an agent proposal waits and calm otherwise", () => {
    expect(agentsHeroGradient(1)).toBe("warm");
    expect(agentsHeroGradient(0)).toBe("calm");
  });

  it("leads with what needs the owner, then with how many agents there are", () => {
    expect(agentsHeroHeadline(0, 0)).toBe("No agents yet");
    expect(agentsHeroHeadline(1, 0)).toBe("1 agent, nothing waiting");
    expect(agentsHeroHeadline(3, 0)).toBe("3 agents, nothing waiting");
    expect(agentsHeroHeadline(3, 1)).toBe("1 agent proposal needs you");
    expect(agentsHeroHeadline(0, 2)).toBe("2 agent proposals need you");
  });

  it("counts only agent-sourced requests as proposals", () => {
    expect(
      countAgentProposals([
        { source: "agent" },
        { source: "focus_now" },
        { source: "manual" },
        { source: "agent" },
      ]),
    ).toBe(2);
  });
});

describe("tools", () => {
  it("humanises every read tool through the manifest's own name, never the id", () => {
    for (const name of READ_TOOL_NAMES) {
      const label = humanizeToolName(name);
      expect(label).toBeTruthy();
      expect(label).not.toContain("_");
    }
    expect(humanizeToolName("get_today_context")).toBe("Today");
    expect(humanizeToolName("get_calendar_context")).toBe("Calendar");
  });

  it("chips a completed call as Read, a refusal by its class, a failure as Failed", () => {
    expect(toolCallStatusChip("completed", null)).toEqual({ label: "Read", tone: "success" });
    expect(toolCallStatusChip("refused", "permission_not_granted")).toEqual({
      label: "Not allowed",
      tone: "warning",
    });
    expect(toolCallStatusChip("refused", "budget_chars_exceeded").label).toBe("Over budget");
    expect(toolCallStatusChip("refused", "rate_limited").label).toBe("Rate limited");
    expect(toolCallStatusChip("refused", "trust_insufficient").label).toBe("Paused");
    expect(toolCallStatusChip("refused", "something_new")).toEqual({
      label: "Refused",
      tone: "warning",
    });
    expect(toolCallStatusChip("failed", "tool_failed")).toEqual({
      label: "Failed",
      tone: "danger",
    });
    // Every known class has a short word or the honest fallback -- never the token itself.
    for (const errorClass of AGENT_TOOL_ERROR_CLASSES) {
      expect(toolCallStatusChip("refused", errorClass).label).not.toContain("_");
    }
  });
});

describe("activity grouping", () => {
  it("groups reads and the proposal under one correlation, in call order, deduped", () => {
    const items = [
      requestActivity({ requested_at: "2026-09-18T14:00:30Z" }),
      toolCallActivity({ tool_name: "get_calendar_context", called_at: "2026-09-18T14:00:20Z" }),
      toolCallActivity({ tool_name: "get_today_context", called_at: "2026-09-18T14:00:10Z" }),
      toolCallActivity({ tool_name: "get_today_context", called_at: "2026-09-18T14:00:00Z" }),
    ];
    const groups = groupActivityByCorrelation(items);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.correlation_id).toBe(CORRELATION_A);
    expect(group.at).toBe("2026-09-18T14:00:30Z");
    expect(group.reads).toEqual(["Today", "Calendar"]);
    expect(group.refusals).toBe(0);
    expect(group.request?.id).toBe(agentRequest().id);
    expect(activityGroupLine(group)).toBe(
      "Read: Today · Calendar → Proposed: Create calendar event → Waiting for you",
    );
    expect(activityGroupChips(group)).toEqual([{ label: "Waiting for you", tone: "warning" }]);
  });

  it("keeps a refusal-only group honest, and a request-only group too", () => {
    const groups = groupActivityByCorrelation([
      toolCallActivity({
        correlation_id: CORRELATION_B,
        status: "refused",
        error_class: "permission_not_granted",
        called_at: "2026-09-18T13:00:00Z",
      }),
      requestActivity({ status: "completed" }, null),
    ]);
    expect(groups).toHaveLength(2);
    const refusal = groups[0]!;
    expect(refusal.reads).toEqual([]);
    expect(refusal.refusals).toBe(1);
    expect(refusal.request).toBeNull();
    expect(activityGroupLine(refusal)).toBe("Refused: 1 read");
    expect(activityGroupChips(refusal)).toEqual([{ label: "1 refused", tone: "warning" }]);
    const proposal = groups[1]!;
    // A request with no correlation id is its own group, keyed on the request.
    expect(proposal.correlation_id).toBe(agentRequest().id);
    expect(activityGroupLine(proposal)).toBe("Proposed: Create calendar event → Approved");
    expect(activityGroupChips(proposal)).toEqual([]);
  });

  it("names every terminal proposal state and counts failures separately", () => {
    for (const [status, word] of [
      ["cancelled", "Cancelled"],
      ["expired", "Expired"],
      ["failed", "Failed"],
    ] as const) {
      const [group] = groupActivityByCorrelation([requestActivity({ status })]);
      expect(activityGroupLine(group!)).toContain(`→ ${word}`);
    }
    const [group] = groupActivityByCorrelation([
      toolCallActivity({ status: "failed", error_class: "tool_failed" }),
      toolCallActivity({ tool_name: "get_task_context", status: "completed" }),
    ]);
    expect(group!.failures).toBe(1);
    expect(activityGroupLine(group!)).toBe("Read: Task");
    expect(activityGroupChips(group!)).toEqual([{ label: "1 failed", tone: "danger" }]);
  });

  it("orders groups as the list arrived (newest first) and never reads a clock", () => {
    const groups = groupActivityByCorrelation([
      toolCallActivity({ correlation_id: CORRELATION_B, called_at: "2026-09-18T14:30:00Z" }),
      toolCallActivity({ correlation_id: CORRELATION_A, called_at: "2026-09-18T14:00:00Z" }),
    ]);
    expect(groups.map((group) => group.correlation_id)).toEqual([CORRELATION_B, CORRELATION_A]);
  });
});

describe("attribution", () => {
  it("is null for every non-agent source, whatever the list", () => {
    expect(
      agentAttribution({ source: "focus_now", source_ref: AGENT_ID }, [agentFixture()]),
    ).toBeNull();
    expect(agentAttribution({ source: "manual", source_ref: null }, undefined)).toBeNull();
  });

  it("resolves the agent by source_ref, marks a revoked one, and stays honest for an unknown id", () => {
    const agents = [agentFixture(), revokedAgent()];
    expect(agentAttribution(agentRequest(), agents)).toEqual({ name: "Ray", revoked: false });
    expect(agentAttribution(agentRequest({ source_ref: revokedAgent().id }), agents)).toEqual({
      name: "Old helper",
      revoked: true,
    });
    expect(agentAttribution(agentRequest({ source_ref: "unknown" }), agents)).toEqual({
      name: null,
      revoked: false,
    });
    expect(agentAttribution(agentRequest(), undefined)).toEqual({ name: null, revoked: false });
  });

  it("labels the chip Agent · name, Agent (revoked), or Agent", () => {
    expect(agentAttributionLabel({ name: "Ray", revoked: false })).toBe("Agent · Ray");
    expect(agentAttributionLabel({ name: "Ray", revoked: true })).toBe("Agent (revoked)");
    expect(agentAttributionLabel({ name: null, revoked: false })).toBe("Agent");
  });
});

describe("last seen", () => {
  it("is relative to the caller's now, never the clock", () => {
    expect(relativeInstantLabel("2026-09-18T14:59:30Z", NOW)).toBe("just now");
    expect(relativeInstantLabel("2026-09-18T14:55:00Z", NOW)).toBe("5 minutes ago");
    expect(relativeInstantLabel("2026-09-18T14:59:00Z", NOW)).toBe("1 minute ago");
    expect(relativeInstantLabel("2026-09-18T12:00:00Z", NOW)).toBe("3 hours ago");
    expect(relativeInstantLabel("2026-09-16T15:00:00Z", NOW)).toBe("2 days ago");
    expect(relativeInstantLabel("2026-07-01T15:00:00Z", NOW, { timeZone: "UTC" })).toBe("Jul 1");
    expect(relativeInstantLabel("not a date", NOW)).toBe("—");
  });

  it("phrases an agent's last-seen line, and says Never used for null", () => {
    expect(agentLastSeenLabel(null, NOW)).toBe("Never used");
    expect(agentLastSeenLabel("2026-09-18T14:00:00Z", NOW)).toBe("Active 1 hour ago");
    expect(agentLastSeenLabel("2026-09-18T14:59:50Z", NOW)).toBe("Active just now");
    expect(agentLastSeenLabel("2026-07-01T15:00:00Z", NOW, { timeZone: "UTC" })).toBe(
      "Last active Jul 1",
    );
    expect(agentLastSeenLabel("garbage", NOW)).toBe("Never used");
  });
});

describe("permission card copy", () => {
  it("names a read grant's kind, tools and the read-flavoured revoke message", () => {
    const copy = permissionCardCopy(readGrant());
    expect(copy.icon).toBe("view-dashboard-outline");
    expect(copy.kindChip).toMatchObject({ label: "Read", tone: "info" });
    expect(copy.stateChip).toEqual({ label: "Allowed", tone: "success" });
    expect(copy.coverage).toEqual(["Search", "Today", "Calendar", "Task"]);
    expect(copy.toggleLabel).toBe("Revoke");
    expect(copy.revokeTitle).toBe("Revoke Today, calendar & tasks for agents?");
    expect(copy.revokeMessage).toBe(
      "Agents will no longer be able to read Today, calendar & tasks.",
    );
    expect(copy.reconsentChip).toBeNull();
  });

  it("names a write grant's kind, actions and the cancel-pending revoke message", () => {
    const copy = permissionCardCopy(writeGrant({ granted: true, needs_reconsent: true }));
    expect(copy.icon).toBe("checkbox-marked-outline");
    expect(copy.kindChip).toMatchObject({ label: "Write", tone: "primary" });
    expect(copy.coverage).toEqual(["Create task", "Archive task", "Complete task", "Reopen task"]);
    expect(copy.revokeMessage).toBe("Pending agent actions that need it will be cancelled.");
    expect(copy.reconsentChip).toEqual({ label: "Re-consent needed", tone: "warning" });
    const off = permissionCardCopy(writeGrant());
    expect(off.stateChip).toEqual({ label: "Off", tone: "neutral" });
    expect(off.toggleLabel).toBe("Allow");
    expect(off.reconsentChip).toBeNull();
  });

  it("speaks the whole card", () => {
    const item = readGrant();
    expect(permissionCardSpoken(item, permissionCardCopy(item))).toBe(
      `Today, calendar & tasks, Read: Allowed. ${item.description}`,
    );
  });
});
