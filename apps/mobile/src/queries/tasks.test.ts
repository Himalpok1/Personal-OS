import { ApiClientError } from "@personal-os/api-client";
import type { Task } from "@personal-os/schema";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { reopenTaskMutationOptions } from "./tasks";

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
