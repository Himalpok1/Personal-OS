import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACTION_IDS,
  ACTION_INPUT_SCHEMAS,
  ACTION_PERMISSIONS,
  ACTION_SOURCES,
  ActionRequestCreateSchema,
  ActionRequestItemSchema,
  PermissionGrantItemSchema,
} from "./actions.js";
import {
  AGENT_DISCLOSURE_TEXT,
  AGENT_PERMISSIONS,
  AGENT_TOKEN_PREFIX,
  AGENT_TOOL_CALLS_PER_MINUTE,
  AGENT_TOOL_ERROR_CLASSES,
  AGENT_TRUST_LEVELS,
  AgentActionCreateSchema,
  AgentActionItemSchema,
  AgentActivityItemSchema,
  AgentManifestSchema,
  AgentPermissionGrantItemSchema,
  AgentPermissionSchema,
  AgentRegisterResponseSchema,
  AgentRegisterSchema,
  AgentSchema,
  AgentToolCallSchema,
  AgentToolErrorClassSchema,
  AgentUpdateSchema,
  READ_PERMISSIONS,
  READ_TOOL_PERMISSION,
  READ_TOOL_SENSITIVITY,
  RESERVED_PERMISSION_NAMES,
  isActionPermission,
  isReadPermission,
  permissionKind,
  toolsRequiring,
  trustLevelAtLeast,
} from "./agents.js";
import { READ_TOOL_NAMES } from "./intelligence-tools.js";

// Checkpoint 10.9 (ADR-081). The gateway contract is pinned the way the
// action registry is: closed vocabularies, disjoint read/write permissions,
// and the deployed 10.8 wire shapes byte-frozen -- an agent grant or an agent
// attribution must never be a NEW KEY on a strict schema the versionCode-33
// client parses.

const UUID = "0b8e6a5a-4a2c-4d3f-9a2b-1c2d3e4f5a6b";
const AT = "2026-09-18T12:00:00.000Z";

describe("trust levels", () => {
  it("is exactly none < read < propose -- no operator member (ADR-079 §4 is host access, not a product level)", () => {
    expect([...AGENT_TRUST_LEVELS]).toEqual(["none", "read", "propose"]);
    expect(trustLevelAtLeast("propose", "read")).toBe(true);
    expect(trustLevelAtLeast("read", "propose")).toBe(false);
    expect(trustLevelAtLeast("none", "read")).toBe(false);
    expect(trustLevelAtLeast("read", "read")).toBe(true);
  });
});

describe("permissions", () => {
  it("keeps ACTION_PERMISSIONS at exactly the two 10.8 members (the deployed Permissions tab is strict)", () => {
    expect([...ACTION_PERMISSIONS]).toEqual(["tasks.write", "calendar.write"]);
  });

  it("read and write vocabularies are disjoint and together form AGENT_PERMISSIONS", () => {
    for (const p of READ_PERMISSIONS) expect(ACTION_PERMISSIONS).not.toContain(p);
    expect([...AGENT_PERMISSIONS]).toEqual([...ACTION_PERMISSIONS, ...READ_PERMISSIONS]);
    for (const p of ACTION_PERMISSIONS) {
      expect(permissionKind(p)).toBe("write");
      expect(isActionPermission(p)).toBe(true);
      expect(isReadPermission(p)).toBe(false);
    }
    for (const p of READ_PERMISSIONS) {
      expect(permissionKind(p)).toBe("read");
      expect(isReadPermission(p)).toBe(true);
    }
  });

  it("every read permission has an enforcement site: at least one tool requires it", () => {
    for (const p of READ_PERMISSIONS) expect(toolsRequiring(p).length).toBeGreaterThan(0);
    expect(Object.keys(READ_TOOL_PERMISSION).sort()).toEqual([...READ_TOOL_NAMES].sort());
    expect(Object.keys(READ_TOOL_SENSITIVITY).sort()).toEqual([...READ_TOOL_NAMES].sort());
  });

  it("the body-bearing and the academic tools sit behind their own permissions", () => {
    expect(READ_TOOL_PERMISSION.get_item_context).toBe("items.read");
    expect(READ_TOOL_SENSITIVITY.get_item_context).toBe("bodies");
    expect(READ_TOOL_PERMISSION.get_academic_context).toBe("academic.read");
    expect(READ_TOOL_SENSITIVITY.get_academic_context).toBe("third_party_text");
    expect(toolsRequiring("context.read")).toEqual([
      "search_personal_items",
      "get_today_context",
      "get_calendar_context",
      "get_task_context",
    ]);
  });

  it("memory.read is reserved, NOT a member -- no memory text reaches an agent (ADR-077 §6)", () => {
    expect([...RESERVED_PERMISSION_NAMES]).toEqual(["memory.read"]);
    for (const name of RESERVED_PERMISSION_NAMES) {
      expect(AgentPermissionSchema.safeParse(name).success).toBe(false);
    }
    for (const never of ["health.read", "mail.read", "credentials.read", "ai.config"]) {
      expect(AgentPermissionSchema.safeParse(never).success).toBe(false);
    }
  });

  it("an agent grant has its own wire shape; the 10.8 PermissionGrantItemSchema still refuses a read permission", () => {
    const item = {
      permission: "context.read",
      principal: "agent",
      kind: "read",
      category: "context",
      label: "x",
      description: "y",
      granted: false,
      granted_at: null,
      revoked_at: null,
      disclosure_version: null,
      needs_reconsent: false,
      action_ids: [],
      tool_names: ["get_today_context"],
    };
    expect(AgentPermissionGrantItemSchema.safeParse(item).success).toBe(true);
    expect(AgentPermissionGrantItemSchema.safeParse({ ...item, principal: "app" }).success).toBe(
      false,
    );
    expect(
      PermissionGrantItemSchema.safeParse({
        permission: "context.read",
        principal: "app",
        label: "x",
        description: "y",
        category: "tasks",
        granted: true,
        granted_at: null,
        revoked_at: null,
        disclosure_version: null,
        needs_reconsent: false,
        usage_count: 0,
        last_used_at: null,
        action_ids: [],
      }).success,
    ).toBe(false);
  });
});

describe("the 10.8 wire shapes stay frozen", () => {
  const request = {
    id: UUID,
    client_uuid: null,
    action_id: "create_task",
    input: { title: "x", timezone: "UTC" },
    principal: "agent",
    status: "pending",
    source: "agent",
    source_ref: UUID,
    reason: "because",
    input_summary: "Create task",
    result_summary: null,
    target_type: null,
    target_id: null,
    error_class: null,
    reverses_request_id: null,
    requested_at: AT,
    expires_at: AT,
    approved_at: null,
    finished_at: null,
    reversed_by_request_id: null,
  };

  it("an agent-sourced request parses through the deployed item schema with NO new key", () => {
    expect(ActionRequestItemSchema.safeParse(request).success).toBe(true);
    expect(ActionRequestItemSchema.safeParse({ ...request, agent_id: UUID }).success).toBe(false);
    expect(ActionRequestItemSchema.safeParse({ ...request, correlation_id: UUID }).success).toBe(
      false,
    );
  });

  it("`agent` is the fifth and only new source; the owner's create schema still cannot send it as a principal", () => {
    expect([...ACTION_SOURCES]).toEqual(["focus_now", "briefing", "academic", "manual", "agent"]);
    expect(
      ActionRequestCreateSchema.safeParse({
        action_id: "create_task",
        input: { title: "x", timezone: "UTC" },
        source: "manual",
        principal: "agent",
      }).success,
    ).toBe(false);
  });
});

describe("the owner's wire", () => {
  it("registers with a bounded name and an explicit trust level, and the token is returned once with its prefix", () => {
    expect(
      AgentRegisterSchema.safeParse({ name: "  curl-agent ", trust_level: "read" }),
    ).toMatchObject({ success: true, data: { name: "curl-agent" } });
    expect(
      AgentRegisterSchema.safeParse({ name: "x".repeat(61), trust_level: "read" }).success,
    ).toBe(false);
    expect(AgentRegisterSchema.safeParse({ name: "a" }).success).toBe(false);
    expect(AgentRegisterSchema.safeParse({ name: "a", trust_level: "operator" }).success).toBe(
      false,
    );
    const agent = {
      id: UUID,
      name: "a",
      trust_level: "read",
      disclosure_version: "2026-09-18",
      created_at: AT,
      updated_at: AT,
      last_seen_at: null,
      revoked_at: null,
    };
    expect(AgentSchema.safeParse(agent).success).toBe(true);
    expect(AgentSchema.safeParse({ ...agent, token_hash: "x" }).success).toBe(false);
    expect(
      AgentRegisterResponseSchema.safeParse({ agent, token: `${AGENT_TOKEN_PREFIX}abc` }).success,
    ).toBe(true);
    expect(AgentRegisterResponseSchema.safeParse({ agent, token: "abc" }).success).toBe(false);
  });

  it("an update must change something", () => {
    expect(AgentUpdateSchema.safeParse({}).success).toBe(false);
    expect(AgentUpdateSchema.safeParse({ trust_level: "none" }).success).toBe(true);
  });

  it("activity items are tool calls or action requests, nothing else", () => {
    const call = {
      id: UUID,
      agent_id: UUID,
      correlation_id: UUID,
      tool_name: "get_today_context",
      status: "refused",
      error_class: "permission_not_granted",
      chars_returned: 0,
      duration_ms: 3,
      called_at: AT,
    };
    expect(AgentToolCallSchema.safeParse(call).success).toBe(true);
    expect(AgentToolCallSchema.safeParse({ ...call, input: {} }).success).toBe(false);
    expect(
      AgentActivityItemSchema.safeParse({
        kind: "tool_call",
        at: AT,
        correlation_id: UUID,
        tool_call: call,
      }).success,
    ).toBe(true);
    expect(AgentActivityItemSchema.safeParse({ kind: "prompt", at: AT }).success).toBe(false);
  });

  it("the disclosure names every boundary the gateway enforces", () => {
    for (const phrase of [
      "never run an action",
      "change a permission",
      "memories, health or mail",
      "Revoke",
    ]) {
      expect(AGENT_DISCLOSURE_TEXT).toContain(phrase);
    }
  });
});

describe("the agent's wire", () => {
  it("an agent proposal requires a reason and a correlation id and cannot name a source, principal or reversal", () => {
    const base = {
      action_id: "create_task",
      input: { title: "Study", timezone: "UTC" },
      reason: "Biology is due tomorrow",
      correlation_id: UUID,
    };
    expect(AgentActionCreateSchema.safeParse(base).success).toBe(true);
    expect(AgentActionCreateSchema.safeParse({ ...base, reason: undefined }).success).toBe(false);
    expect(AgentActionCreateSchema.safeParse({ ...base, correlation_id: undefined }).success).toBe(
      false,
    );
    for (const extra of [
      { source: "manual" },
      { source_ref: "x" },
      { principal: "app" },
      { reverses_request_id: UUID },
    ]) {
      expect(AgentActionCreateSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(AgentActionCreateSchema.safeParse({ ...base, reason: "x".repeat(161) }).success).toBe(
      false,
    );
  });

  it("covers every registered action with the SAME input schema the owner's path uses", () => {
    const variants = AgentActionCreateSchema.options.map((option) => option.shape.action_id.value);
    expect([...variants].sort()).toEqual([...ACTION_IDS].sort());
    for (const option of AgentActionCreateSchema.options) {
      expect(option.shape.input).toBe(ACTION_INPUT_SCHEMAS[option.shape.action_id.value]);
    }
  });

  it("the agent-facing item never echoes the frozen input or the reason", () => {
    const item = {
      id: UUID,
      action_id: "create_task",
      status: "pending",
      input_summary: "Create task",
      result_summary: null,
      error_class: null,
      target_type: null,
      target_id: null,
      correlation_id: UUID,
      requested_at: AT,
      expires_at: AT,
      approved_at: null,
      finished_at: null,
    };
    expect(AgentActionItemSchema.safeParse(item).success).toBe(true);
    expect(AgentActionItemSchema.safeParse({ ...item, input: {} }).success).toBe(false);
    expect(AgentActionItemSchema.safeParse({ ...item, reason: "x" }).success).toBe(false);
  });

  it("error classes are token-shaped", () => {
    for (const c of AGENT_TOOL_ERROR_CLASSES)
      expect(AgentToolErrorClassSchema.safeParse(c).success).toBe(true);
    expect(AgentToolErrorClassSchema.safeParse("Provider said: no").success).toBe(false);
    expect(AGENT_TOOL_CALLS_PER_MINUTE).toBe(60);
  });

  it("the manifest is strict, versioned, and every tool carries a JSON schema for input and output", () => {
    const tool = {
      tool_id: "get_today_context",
      name: "Today",
      description: "d",
      classification: "read",
      permission: "context.read",
      sensitivity: "titles",
      audited: true,
      input_schema: z.toJSONSchema(z.object({ tz: z.string() })),
      output_schema: {},
    };
    const manifest = {
      contract_version: "2026-09-18",
      agent: { id: UUID, name: "a", trust_level: "read" },
      budgets: { calls_per_correlation: 6, chars_per_correlation: 30_000, calls_per_minute: 60 },
      validation: "server-side",
      tools: [tool],
      actions: [],
      grants: [],
    };
    expect(AgentManifestSchema.safeParse(manifest).success).toBe(true);
    expect(AgentManifestSchema.safeParse({ ...manifest, contract_version: "1" }).success).toBe(
      false,
    );
    expect(
      AgentManifestSchema.safeParse({ ...manifest, tools: [{ ...tool, classification: "write" }] })
        .success,
    ).toBe(false);
    expect(AgentManifestSchema.safeParse({ ...manifest, secrets: {} }).success).toBe(false);
  });
});
