import { describe, expect, it } from "vitest";
import {
  ACTION_ERROR_CLASSES,
  ACTION_ERROR_CLASS_PATTERN,
  ACTION_IDS,
  ACTION_ID_VERB_PATTERN,
  ACTION_INPUT_SCHEMAS,
  ACTION_OUTPUT_SCHEMAS,
  ACTION_PERMISSIONS,
  ACTION_PERMISSION_LABELS,
  ACTION_REASON_MAX_CHARS,
  ACTION_REGISTRY,
  ActionDefinitionSchema,
  ActionRequestCreateSchema,
  ActionRequestItemSchema,
  ActionRequestSchema,
  actionsRequiring,
  parseActionInput,
  reversalActionOf,
} from "./actions.js";
import { READ_TOOL_NAMES } from "./intelligence-tools.js";

// The registry is the contract every lane builds against (ADR-078 §2). These
// pins make widening it a reviewed act: a new action must carry every field,
// a verb from the closed set, a permission that exists, and an input schema.

describe("ACTION_REGISTRY", () => {
  it("has exactly one well-formed entry per ACTION_ID, keyed by its own id", () => {
    expect(Object.keys(ACTION_REGISTRY).sort()).toEqual([...ACTION_IDS].sort());
    for (const id of ACTION_IDS) {
      const parsed = ActionDefinitionSchema.parse(ACTION_REGISTRY[id]);
      expect(parsed.id).toBe(id);
      expect(parsed.requires_approval).toBe(true);
    }
  });

  it("uses only the closed verb set, disjoint from the read-tool vocabulary", () => {
    for (const id of ACTION_IDS) {
      expect(id, id).toMatch(ACTION_ID_VERB_PATTERN);
      expect(id).not.toMatch(/^(?:search|get)_/);
    }
    const reads = new Set<string>(READ_TOOL_NAMES);
    for (const id of ACTION_IDS) expect(reads.has(id), id).toBe(false);
  });

  it("binds an input and an output schema to every action", () => {
    expect(Object.keys(ACTION_INPUT_SCHEMAS).sort()).toEqual([...ACTION_IDS].sort());
    expect(Object.keys(ACTION_OUTPUT_SCHEMAS).sort()).toEqual([...ACTION_IDS].sort());
  });

  it("gives every permission at least one action and a label, and no action an unknown permission", () => {
    for (const permission of ACTION_PERMISSIONS) {
      expect(actionsRequiring(permission).length, permission).toBeGreaterThan(0);
      expect(ACTION_PERMISSION_LABELS[permission].label.length).toBeGreaterThan(0);
    }
    for (const id of ACTION_IDS) {
      expect(ACTION_PERMISSIONS).toContain(ACTION_REGISTRY[id].permission);
    }
  });

  it("ships exactly the 10.8 vocabulary: two write permissions, no read permission", () => {
    expect([...ACTION_PERMISSIONS]).toEqual(["tasks.write", "calendar.write"]);
    for (const permission of ACTION_PERMISSIONS) expect(permission).toMatch(/\.write$/);
  });

  it("points every via_action reversal at a registered action on the same target type", () => {
    for (const id of ACTION_IDS) {
      const reversal = reversalActionOf(id);
      if (reversal === null) continue;
      expect(ACTION_IDS).toContain(reversal);
      expect(ACTION_REGISTRY[reversal].target_type).toBe(ACTION_REGISTRY[id].target_type);
      expect(reversal).not.toBe(id);
    }
  });

  it("ships the three reversible pairs the owner chose", () => {
    expect(reversalActionOf("create_calendar_event")).toBe("archive_calendar_event");
    expect(reversalActionOf("create_task")).toBe("archive_task");
    expect(reversalActionOf("complete_task")).toBe("reopen_task");
    expect(reversalActionOf("reopen_task")).toBe("complete_task");
    expect(reversalActionOf("archive_task")).toBeNull();
    expect(reversalActionOf("archive_calendar_event")).toBeNull();
  });
});

describe("action inputs", () => {
  it("rejects unknown keys on every input (no smuggled fields)", () => {
    for (const id of ACTION_IDS) {
      const result = ACTION_INPUT_SCHEMAS[id].safeParse({ smuggled: true });
      expect(result.success, id).toBe(false);
    }
  });

  it("requires ends_at after starts_at on create_calendar_event", () => {
    const base = {
      title: "Biology study block",
      starts_at: "2026-09-18T20:00:00-05:00",
      ends_at: "2026-09-18T21:00:00-05:00",
      timezone: "America/Chicago",
    };
    expect(ACTION_INPUT_SCHEMAS.create_calendar_event.safeParse(base).success).toBe(true);
    expect(
      ACTION_INPUT_SCHEMAS.create_calendar_event.safeParse({ ...base, ends_at: base.starts_at })
        .success,
    ).toBe(false);
  });

  it("does not accept recurrence or all-day fields on create_task / create_calendar_event", () => {
    expect(
      ACTION_INPUT_SCHEMAS.create_task.safeParse({
        title: "x",
        timezone: "UTC",
        rrule: "FREQ=DAILY",
      }).success,
    ).toBe(false);
    expect(
      ACTION_INPUT_SCHEMAS.create_calendar_event.safeParse({
        title: "x",
        timezone: "UTC",
        all_day: true,
        start_date: "2026-09-18",
      }).success,
    ).toBe(false);
  });
});

describe("ActionRequestCreateSchema", () => {
  const good = {
    action_id: "create_task",
    input: { title: "Read chapter 4", timezone: "America/Chicago" },
    source: "focus_now",
    source_ref: "canvas_assignment",
    reason: "Matches your Focus Now recommendation",
  };

  it("parses a well-formed request", () => {
    expect(ActionRequestCreateSchema.parse(good).action_id).toBe("create_task");
  });

  it("never lets the client name the principal or the status", () => {
    expect(ActionRequestCreateSchema.safeParse({ ...good, principal: "agent" }).success).toBe(
      false,
    );
    expect(ActionRequestCreateSchema.safeParse({ ...good, status: "completed" }).success).toBe(
      false,
    );
  });

  it("bounds the reason and refuses an input that belongs to another action", () => {
    expect(
      ActionRequestCreateSchema.safeParse({
        ...good,
        reason: "x".repeat(ACTION_REASON_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      ActionRequestCreateSchema.safeParse({ ...good, input: { task_id: crypto.randomUUID() } })
        .success,
    ).toBe(false);
  });
});

describe("ActionRequestSchema / ActionRequestItemSchema", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    client_uuid: null,
    action_id: "complete_task",
    input: { task_id: "00000000-0000-4000-8000-000000000002" },
    principal: "app",
    status: "completed",
    source: "manual",
    source_ref: null,
    reason: null,
    input_summary: "Complete task",
    result_summary: "Marked done",
    target_type: "task",
    target_id: "00000000-0000-4000-8000-000000000002",
    error_class: null,
    reverses_request_id: null,
    requested_at: "2026-09-17T12:00:00.000Z",
    expires_at: "2026-09-18T12:00:00.000Z",
    approved_at: "2026-09-17T12:00:05.000Z",
    finished_at: "2026-09-17T12:00:05.000Z",
  };

  it("carries input loosely, narrows it through parseActionInput, and rejects an extra key", () => {
    const parsed = ActionRequestSchema.parse(row);
    expect(parsed.action_id).toBe("complete_task");
    expect(parseActionInput(parsed)).toEqual({ task_id: "00000000-0000-4000-8000-000000000002" });
    // A row whose frozen input no longer parses is still LISTABLE (ADR-078 §4).
    const stale = ActionRequestSchema.parse({ ...row, input: { task_id: "not-a-uuid" } });
    expect(parseActionInput(stale)).toBeNull();
    expect(ActionRequestSchema.safeParse({ ...row, extra: 1 }).success).toBe(false);
    expect(
      ActionRequestItemSchema.parse({ ...row, reversed_by_request_id: null })
        .reversed_by_request_id,
    ).toBeNull();
  });

  it("keeps error_class token-shaped", () => {
    for (const cls of ACTION_ERROR_CLASSES) expect(cls).toMatch(ACTION_ERROR_CLASS_PATTERN);
    expect(
      ActionRequestSchema.safeParse({ ...row, status: "failed", error_class: "Bad thing: 42" })
        .success,
    ).toBe(false);
  });
});
