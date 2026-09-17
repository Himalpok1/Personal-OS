import { describe, expect, it } from "vitest";
import {
  EXPORT_ENTITY_MAX_ROWS,
  EXPORT_FORMAT_VERSION,
  ExportResponseSchema,
  InboxItemExportSchema,
} from "./export.js";

const ZERO = { returned: 0, total: 0 };

function body(overrides: Record<string, unknown> = {}) {
  return {
    format_version: EXPORT_FORMAT_VERSION,
    generated_at: "2026-09-03T12:00:00.000Z",
    scope: "user_authored_core",
    truncated: false,
    counts: { projects: ZERO, tasks: ZERO, notes: ZERO, inbox_items: ZERO, memories: ZERO },
    projects: [],
    tasks: [],
    notes: [],
    inbox_items: [],
    memories: [],
    ...overrides,
  };
}

describe("ExportResponseSchema", () => {
  it("accepts a well-formed empty export", () => {
    expect(ExportResponseSchema.safeParse(body()).success).toBe(true);
  });

  it("REJECTS a widened scope -- adding a table is a contract change, not a config change", () => {
    for (const widening of [
      { mail_messages: [] },
      { events: [] },
      { health_daily_metrics: [] },
      { devices: [] },
      { ai_provider_connections: [] },
      { monitor_checks: [] },
      { occurrences: [] },
    ]) {
      expect(ExportResponseSchema.safeParse(body(widening)).success).toBe(false);
    }
  });

  it("rejects a counts object that gained an entity", () => {
    const widened = body({
      counts: {
        projects: ZERO,
        tasks: ZERO,
        notes: ZERO,
        inbox_items: ZERO,
        memories: ZERO,
        events: ZERO,
      },
    });
    expect(ExportResponseSchema.safeParse(widened).success).toBe(false);
  });

  it("rejects dishonest counts", () => {
    const dishonest = body({
      counts: {
        projects: ZERO,
        tasks: ZERO,
        notes: { returned: 9, total: 1 },
        inbox_items: ZERO,
        memories: ZERO,
      },
    });
    expect(ExportResponseSchema.safeParse(dishonest).success).toBe(false);
  });

  it("pins the scope literal, so a broader export cannot claim this name", () => {
    expect(ExportResponseSchema.safeParse(body({ scope: "everything" })).success).toBe(false);
  });

  it("pins the format version", () => {
    expect(ExportResponseSchema.safeParse(body({ format_version: 2 })).success).toBe(false);
  });

  it("declares a ceiling far above the observed corpus", () => {
    expect(EXPORT_ENTITY_MAX_ROWS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("InboxItemExportSchema", () => {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    raw_text: "remind me to call the plumber",
    source: "siri",
    captured_at: "2026-08-01T10:00:00.000Z",
    timezone: "America/Chicago",
    status: "confirmed",
    entity_type: "task",
    entity_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T10:00:00.000Z",
    archived_at: null,
  };

  it("accepts the authored capture and its disposition", () => {
    expect(InboxItemExportSchema.safeParse(item).success).toBe(true);
  });

  it("REJECTS the machine artifacts it deliberately narrows away", () => {
    for (const artifact of [
      { parse_result: { tool: "create_note" } },
      { confidence: 0.42 },
      { client_uuid: "33333333-3333-4333-8333-333333333333" },
      { audio_path: "/tmp/personal-os-audio/private.m4a" },
    ]) {
      expect(InboxItemExportSchema.safeParse({ ...item, ...artifact }).success).toBe(false);
    }
  });

  it("allows a capture whose transcript does not exist yet", () => {
    expect(InboxItemExportSchema.safeParse({ ...item, raw_text: null }).success).toBe(true);
  });
});
