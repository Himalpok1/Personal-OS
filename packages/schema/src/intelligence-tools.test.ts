import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GetCalendarContextInputSchema,
  GetItemContextInputSchema,
  GetTaskContextInputSchema,
  GetTodayContextInputSchema,
  GetAcademicContextInputSchema,
  GetAcademicContextOutputSchema,
  GetCalendarContextOutputSchema,
  GetTaskContextOutputSchema,
  READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX,
  READ_TOOL_CALENDAR_ITEMS_MAX,
  READ_TOOL_INPUT_SCHEMAS,
  READ_TOOL_NAMES,
  READ_TOOL_OUTPUT_SCHEMAS,
  SearchPersonalItemsInputSchema,
  TODAY_CONTEXT_CAPS,
  TODAY_CONTEXT_MAX_CHARS,
  TodayContextSchema,
} from "./intelligence-tools.js";

/** Every property name anywhere in a schema, via its JSON Schema projection. */
function collectObjectKeys(schema: z.ZodTypeAny): string[] {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
  const keys: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record["properties"] === "object" && record["properties"] !== null) {
      keys.push(...Object.keys(record["properties"] as object));
    }
    Object.values(record).forEach(visit);
  };
  visit(json);
  return keys;
}

// Checkpoint 9.7 (ADR-066). The Today context is a CLOSED allowlist in the
// BriefInput tradition: its key set is pinned here so that adding a field --
// which widens what leaves the machine -- is a reviewed change that fails a
// test, never a drift. The pinned sets are the design's §3 shape exactly.

const EXPECTED_TOP_LEVEL_KEYS = [
  "local_date",
  "tz",
  "now_local",
  "summary",
  "overdue",
  "due_today",
  "upcoming",
  "events_today",
  "reminders",
  "recently_completed",
  "projects_touched",
  "open_loops",
].sort();

const EXPECTED_OPEN_LOOPS_KEYS = [
  "inbox",
  "stalled_projects",
  "projects_without_next_action",
  "snoozed_within_horizon",
  "reviews",
].sort();

function emptyContext(): unknown {
  return {
    local_date: "2026-09-14",
    tz: "America/Chicago",
    now_local: "2026-09-14 09:30",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    upcoming: { items: [], total: 0 },
    events_today: { items: [], total: 0 },
    reminders: { items: [], total: 0, horizon_days: 7 },
    recently_completed: { items: [], total: 0 },
    projects_touched: [],
    open_loops: {
      inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, captures: [] },
      stalled_projects: { items: [], total: 0 },
      projects_without_next_action: { items: [], total: 0 },
      snoozed_within_horizon: { items: [], total: 0 },
      reviews: { daily_status: null, weekly_status: null },
    },
  };
}

describe("TodayContextSchema (Checkpoint 9.7)", () => {
  it("pins the top-level key set -- a new key is a reviewed change", () => {
    expect(Object.keys(TodayContextSchema.shape).sort()).toEqual(EXPECTED_TOP_LEVEL_KEYS);
  });

  it("pins the open_loops key set", () => {
    expect(Object.keys(TodayContextSchema.shape.open_loops.shape).sort()).toEqual(
      EXPECTED_OPEN_LOOPS_KEYS,
    );
  });

  it("parses the empty context", () => {
    expect(TodayContextSchema.safeParse(emptyContext()).success).toBe(true);
  });

  it("is strict at the top level and inside open_loops -- an unknown key is a parse failure", () => {
    const top = { ...(emptyContext() as Record<string, unknown>), extra: 1 };
    expect(TodayContextSchema.safeParse(top).success).toBe(false);
    const nested = emptyContext() as { open_loops: Record<string, unknown> };
    nested.open_loops["ids"] = [];
    expect(TodayContextSchema.safeParse(nested).success).toBe(false);
  });

  it("refuses an id-shaped or instant-shaped field on an item", () => {
    const ctx = emptyContext() as { overdue: { items: unknown[]; total: number } };
    ctx.overdue.items.push({
      ref: 1,
      title: "x",
      due_local: "2026-09-14 09:00",
      project: null,
      priority: null,
      recurring: false,
      has_reminder: false,
      snoozed: false,
      id: "0b8e6a5a-4a2c-4d3f-9a2b-1c2d3e4f5a6b",
    });
    ctx.overdue.total = 1;
    expect(TodayContextSchema.safeParse(ctx).success).toBe(false);
    ctx.overdue.items = [
      {
        ref: 1,
        title: "x",
        due_local: "2026-09-14T09:00:00Z",
        project: null,
        priority: null,
        recurring: false,
        has_reminder: false,
        snoozed: false,
      },
    ];
    expect(TodayContextSchema.safeParse(ctx).success).toBe(false);
  });

  it("refuses a total smaller than its items", () => {
    const ctx = emptyContext() as { recently_completed: { items: unknown[]; total: number } };
    ctx.recently_completed.items.push({ ref: 1, title: "x", completed_local: "2026-09-14 09:00" });
    ctx.recently_completed.total = 0;
    expect(TodayContextSchema.safeParse(ctx).success).toBe(false);
  });

  it("enforces the reminder horizon literal and the section caps", () => {
    const ctx = emptyContext() as { reminders: { horizon_days: number } };
    ctx.reminders.horizon_days = 14;
    expect(TodayContextSchema.safeParse(ctx).success).toBe(false);
    const overCap = emptyContext() as { overdue: { items: unknown[]; total: number } };
    for (let i = 1; i <= TODAY_CONTEXT_CAPS.overdue + 1; i += 1) {
      overCap.overdue.items.push({
        ref: i,
        title: "x",
        due_local: null,
        project: null,
        priority: null,
        recurring: false,
        has_reminder: false,
        snoozed: false,
      });
    }
    overCap.overdue.total = overCap.overdue.items.length;
    expect(TodayContextSchema.safeParse(overCap).success).toBe(false);
  });

  it("carries the D5 ceiling", () => {
    expect(TODAY_CONTEXT_MAX_CHARS).toBe(12_000);
  });
});

describe("read-tool contract (Checkpoint 9.7, schemas only)", () => {
  const validInputs: Record<(typeof READ_TOOL_NAMES)[number], Record<string, unknown>> = {
    search_personal_items: { q: "dentist" },
    get_item_context: { type: "task", id: "0b8e6a5a-4a2c-4d3f-9a2b-1c2d3e4f5a6b" },
    get_today_context: { tz: "America/Chicago" },
    get_calendar_context: { tz: "America/Chicago", from: "2026-09-14", to: "2026-09-20" },
    get_task_context: { id: "0b8e6a5a-4a2c-4d3f-9a2b-1c2d3e4f5a6b" },
    get_academic_context: { tz: "America/Chicago" },
  };

  it("names every tool search_* or get_* -- a write-shaped tool cannot be named", () => {
    for (const name of READ_TOOL_NAMES) expect(name).toMatch(/^(search|get)_/);
    expect(Object.keys(READ_TOOL_INPUT_SCHEMAS).sort()).toEqual([...READ_TOOL_NAMES].sort());
  });

  it.each(READ_TOOL_NAMES)("%s input schema is strict", (name) => {
    const schema = READ_TOOL_INPUT_SCHEMAS[name];
    expect(schema.safeParse(validInputs[name]).success).toBe(true);
    expect(schema.safeParse({ ...validInputs[name], extra: 1 }).success).toBe(false);
  });

  it("binds the named schemas to the registry", () => {
    expect(READ_TOOL_INPUT_SCHEMAS.search_personal_items).toBe(SearchPersonalItemsInputSchema);
    expect(READ_TOOL_INPUT_SCHEMAS.get_item_context).toBe(GetItemContextInputSchema);
    expect(READ_TOOL_INPUT_SCHEMAS.get_today_context).toBe(GetTodayContextInputSchema);
    expect(READ_TOOL_INPUT_SCHEMAS.get_calendar_context).toBe(GetCalendarContextInputSchema);
    expect(READ_TOOL_INPUT_SCHEMAS.get_task_context).toBe(GetTaskContextInputSchema);
    expect(READ_TOOL_INPUT_SCHEMAS.get_academic_context).toBe(GetAcademicContextInputSchema);
  });

  it("carries a strict, body-free output schema for every tool (Checkpoint 10.9)", () => {
    expect(Object.keys(READ_TOOL_OUTPUT_SCHEMAS).sort()).toEqual([...READ_TOOL_NAMES].sort());
    for (const name of READ_TOOL_NAMES) {
      const shape = READ_TOOL_OUTPUT_SCHEMAS[name];
      expect(shape.safeParse({ not: "a", real: "output" }).success).toBe(false);
    }
    // The three outputs defined in 10.9 never carry a body, a description or a rule.
    for (const schema of [
      GetCalendarContextOutputSchema,
      GetTaskContextOutputSchema,
      GetAcademicContextOutputSchema,
    ]) {
      const keys = collectObjectKeys(schema);
      for (const forbidden of ["body", "description", "rrule", "html_url", "source_base_url"]) {
        expect(keys, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("converts every tool input/output to JSON Schema without throwing (the manifest)", () => {
    for (const name of READ_TOOL_NAMES) {
      expect(() =>
        z.toJSONSchema(READ_TOOL_INPUT_SCHEMAS[name], { io: "input", unrepresentable: "any" }),
      ).not.toThrow();
      expect(() =>
        z.toJSONSchema(READ_TOOL_OUTPUT_SCHEMAS[name], { io: "output", unrepresentable: "any" }),
      ).not.toThrow();
    }
  });

  it("caps academic and calendar outputs with an honest total", () => {
    expect(READ_TOOL_CALENDAR_ITEMS_MAX).toBe(100);
    expect(READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX).toBe(40);
    expect(
      GetAcademicContextOutputSchema.shape.assignments.safeParse({
        provenance: "first_party",
        items: [],
        total: 0,
      }).success,
    ).toBe(false);
  });

  it("bounds the calendar span and the search limit", () => {
    expect(
      GetCalendarContextInputSchema.safeParse({
        tz: "UTC",
        from: "2026-09-01",
        to: "2026-09-30",
      }).success,
    ).toBe(false);
    expect(SearchPersonalItemsInputSchema.safeParse({ q: "xy", limit: 11 }).success).toBe(false);
  });
});
