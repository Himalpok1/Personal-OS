import { ApiClientError } from "@personal-os/api-client";
import type { Task } from "@personal-os/schema";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Checkpoint 9.4: tasks.ts imports the local-reminder scheduler (for
// cancel-on-mutation), whose expo-notifications import chain cannot load
// under vitest (`__DEV__` is undefined). Stubbed exactly as the notifications
// tests stub it; nothing in this file exercises it.
vi.mock("expo-notifications", () => ({
  getAllScheduledNotificationsAsync: vi.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: "date" },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

const { api } = await import("./client");
const { reopenTaskMutationOptions, taskUpdateAffectsReminder } = await import("./tasks");

// No render harness in this app (see ask.test.ts), so the mutation config is
// exported as a plain function and driven through the real MutationObserver.

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function reopenedTask(): Task {
  return {
    id: TASK_ID,
    title: "Call the insurance guy",
    body: null,
    status: "active",
    due_at: null,
    remind_at: null,
    timezone: "America/Chicago",
    priority: null,
    project_id: null,
    completed_at: null,
    rrule: null,
    recurrence_anchor: null,
    recurrence_timezone: null,
    recurrence_until: null,
    recurrence_count: null,
    recurrence_exdates: null,
    archived_at: null,
    created_at: "2026-09-13T00:00:00.000Z",
    updated_at: "2026-09-13T00:00:00.000Z",
  };
}

// `api.reopenTask` is added to @personal-os/api-client by the API lane of the
// same checkpoint. Installing the stub by assignment rather than `vi.spyOn`
// keeps this test runnable against either build of the client -- spyOn throws
// on a property that does not exist yet -- while still proving the hook
// reaches the method by exactly that name.
function installReopenStub(impl: (id: string) => Promise<Task>): () => void {
  const target = api as unknown as Record<string, unknown>;
  const original = target["reopenTask"];
  target["reopenTask"] = impl;
  return () => {
    if (original === undefined) delete target["reopenTask"];
    else target["reopenTask"] = original;
  };
}

describe("reopenTaskMutationOptions", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
  });

  it("calls api.reopenTask with the task id and resolves the reopened task", async () => {
    const stub = vi.fn().mockResolvedValue(reopenedTask());
    restore = installReopenStub(stub);

    const observer = new MutationObserver(new QueryClient(), reopenTaskMutationOptions());
    const result = await observer.mutate(TASK_ID);

    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledWith(TASK_ID);
    expect(result.status).toBe("active");
    expect(result.completed_at).toBeNull();
  });

  it("surfaces a 409 task_not_reopenable to the caller rather than swallowing it", async () => {
    const err = new ApiClientError(409, "task_not_reopenable", {
      error: "task_not_reopenable",
      status: "active",
    });
    restore = installReopenStub(vi.fn().mockRejectedValue(err));

    const observer = new MutationObserver(new QueryClient(), reopenTaskMutationOptions());
    await expect(observer.mutate(TASK_ID)).rejects.toBe(err);
  });
});

// Source guard, same convention as ask.test.ts: the hook must be a mutation
// on the dedicated action route -- never a generic PATCH of `status`, which
// TaskUpdateSchema deliberately does not accept (ADR-039's rule, applied to
// tasks).
describe("useReopenTask source shape", () => {
  const source = readFileSync(fileURLToPath(new URL("./tasks.ts", import.meta.url)), "utf8");

  it("defines useReopenTask with useMutation over reopenTaskMutationOptions", () => {
    expect(source).toMatch(
      /export function useReopenTask\(\)[\s\S]*?useMutation\(\{[\s\S]*?\.\.\.reopenTaskMutationOptions\(\)/,
    );
  });

  it("reaches the API through api.reopenTask, never through updateTask", () => {
    const block = source.slice(source.indexOf("export function reopenTaskMutationOptions"));
    expect(block).toContain("api.reopenTask(id)");
    expect(block).not.toContain("updateTask");
  });
});

// Checkpoint 9.4: which PATCHes cancel the on-device alarm before the
// reconcile pass restores whatever is still due. A patch that cannot move or
// remove a reminder must NOT cancel it -- see useInvalidateAfterTaskMutation.
describe("taskUpdateAffectsReminder", () => {
  it("is true for every field that can move or remove a reminder", () => {
    expect(taskUpdateAffectsReminder({ remind_at: null })).toBe(true);
    expect(taskUpdateAffectsReminder({ remind_at: "2026-09-14T14:00:00.000Z" })).toBe(true);
    expect(taskUpdateAffectsReminder({ due_at: "2026-09-14T14:00:00.000Z" })).toBe(true);
    expect(taskUpdateAffectsReminder({ rrule: "FREQ=DAILY" })).toBe(true);
    expect(taskUpdateAffectsReminder({ rrule: null })).toBe(true);
    expect(taskUpdateAffectsReminder({ recurrence_anchor: "completion_date" })).toBe(true);
    expect(taskUpdateAffectsReminder({ recurrence_timezone: "Europe/London" })).toBe(true);
    expect(taskUpdateAffectsReminder({ recurrence_until: null })).toBe(true);
    expect(taskUpdateAffectsReminder({ recurrence_count: 3 })).toBe(true);
    expect(taskUpdateAffectsReminder({ recurrence_exdates: ["2026-09-15"] })).toBe(true);
  });

  it("is false for a title/body/project/priority edit", () => {
    expect(taskUpdateAffectsReminder({ title: "Renamed" })).toBe(false);
    expect(taskUpdateAffectsReminder({ body: "notes" })).toBe(false);
    expect(taskUpdateAffectsReminder({ project_id: null })).toBe(false);
    expect(taskUpdateAffectsReminder({ priority: 1 })).toBe(false);
    expect(taskUpdateAffectsReminder({})).toBe(false);
  });

  it("keys on presence, not value: an explicit null still counts as a change", () => {
    expect(taskUpdateAffectsReminder({ title: "x", remind_at: null })).toBe(true);
  });
});
