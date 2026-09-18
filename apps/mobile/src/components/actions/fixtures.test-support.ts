import type { ActionRequestItem, ActionsSummary, PermissionGrantItem } from "@personal-os/schema";

// Shared fixture builders for the action component tests (Checkpoint 10.8).
// Not a test file itself (no `.test.` in the name, so vitest never collects
// it) and never imported by application code.

export const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ASSIGNMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const BASE = {
  id: REQUEST_ID,
  client_uuid: null,
  principal: "app" as const,
  status: "pending" as const,
  source: "academic" as const,
  source_ref: "canvas_assignment",
  reason: "Track this assignment as a task",
  result_summary: null,
  target_type: null,
  target_id: null,
  error_class: null,
  reverses_request_id: null,
  requested_at: "2026-09-17T15:00:00Z",
  expires_at: "2026-09-18T15:00:00Z",
  approved_at: null,
  finished_at: null,
  reversed_by_request_id: null,
};

export function createTaskRequest(overrides: Partial<ActionRequestItem> = {}): ActionRequestItem {
  return {
    ...BASE,
    action_id: "create_task",
    input_summary: "Create task: Project milestone 2",
    input: {
      title: "Project milestone 2",
      due_at: "2026-09-23T04:59:00Z",
      canvas_assignment_id: ASSIGNMENT_ID,
      timezone: "America/Chicago",
    },
    ...overrides,
  };
}

export function createEventRequest(overrides: Partial<ActionRequestItem> = {}): ActionRequestItem {
  return {
    ...BASE,
    action_id: "create_calendar_event",
    source: "focus_now",
    reason: "Due Sep 22 · 11:59 PM · from your Focus Now list",
    input_summary: "Create event: Study: Project milestone 2",
    input: {
      title: "Study: Project milestone 2",
      starts_at: "2026-09-17T15:00:00-05:00",
      ends_at: "2026-09-17T16:00:00-05:00",
      timezone: "America/Chicago",
    },
    ...overrides,
  };
}

export function completeTaskRequest(overrides: Partial<ActionRequestItem> = {}): ActionRequestItem {
  return {
    ...BASE,
    action_id: "complete_task",
    source: "manual",
    reason: null,
    input_summary: "Complete task: Call the insurance guy",
    input: { task_id: TARGET_ID },
    ...overrides,
  };
}

export function permission(overrides: Partial<PermissionGrantItem> = {}): PermissionGrantItem {
  return {
    permission: "tasks.write",
    principal: "app",
    label: "Tasks",
    description: "Create, complete, reopen and archive tasks — only after you approve each one.",
    category: "tasks",
    granted: true,
    granted_at: "2026-09-17T10:00:00Z",
    revoked_at: null,
    disclosure_version: "2026-09-17",
    needs_reconsent: false,
    usage_count: 3,
    last_used_at: "2026-09-17T14:00:00Z",
    action_ids: ["create_task", "archive_task", "complete_task", "reopen_task"],
    ...overrides,
  };
}

export function summary(overrides: Partial<ActionsSummary> = {}): ActionsSummary {
  return {
    pending_total: 2,
    completed_last_7_days: 5,
    permissions_granted: 2,
    permissions_total: 2,
    ...overrides,
  };
}
