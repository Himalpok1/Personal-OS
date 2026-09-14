import { beforeEach, describe, expect, it, vi } from "vitest";

// Checkpoint 9.4, cancel-on-mutation: every task/occurrence mutation that can
// make a scheduled local reminder stale FIRST cancels the on-device alarm for
// its key (awaited), THEN invalidates the read models. No render harness in
// this app, so `useMutation`/`useQueryClient` are replaced by minimal fakes
// that hand back the options object -- the test then drives `onSuccess`
// exactly as TanStack would, with (result, variables).

const scheduler = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    cancelRemindersForKey: vi.fn(async (key: string) => {
      calls.push(`cancel:${key}`);
    }),
  };
});
vi.mock("@/notifications/scheduler", () => ({
  cancelRemindersForKey: scheduler.cancelRemindersForKey,
}));

const reactQuery = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: reactQuery.invalidateQueries }),
}));

const apiMock = vi.hoisted(() => ({
  updateTask: vi.fn(),
  archiveTask: vi.fn(),
  completeTask: vi.fn(),
  dropTask: vi.fn(),
  reopenTask: vi.fn(),
  createTask: vi.fn(),
  activateTask: vi.fn(),
  completeOccurrence: vi.fn(),
  skipOccurrence: vi.fn(),
  snoozeOccurrence: vi.fn(),
  reopenOccurrence: vi.fn(),
}));
vi.mock("./client", () => ({ api: apiMock }));

const tasks = await import("./tasks");
const occurrences = await import("./occurrences");

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";

interface MutationLike<TVariables> {
  onSuccess?: (result: unknown, variables: TVariables) => unknown;
}

function invalidatedKeys(): unknown[] {
  return reactQuery.invalidateQueries.mock.calls.map(([arg]) => (arg as { queryKey: unknown }).queryKey);
}

beforeEach(() => {
  scheduler.calls.length = 0;
  scheduler.cancelRemindersForKey.mockClear();
  reactQuery.invalidateQueries.mockReset().mockImplementation((arg: { queryKey: unknown[] }) => {
    scheduler.calls.push(`invalidate:${String(arg.queryKey[0])}`);
    return Promise.resolve();
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("task mutations (queries/tasks.ts)", () => {
  it.each([
    ["useCompleteTask", () => tasks.useCompleteTask() as MutationLike<string>],
    ["useDropTask", () => tasks.useDropTask() as MutationLike<string>],
    ["useArchiveTask", () => tasks.useArchiveTask() as MutationLike<string>],
  ])("%s cancels task:<id> BEFORE invalidating tasks/today/reminders", async (_name, hook) => {
    await hook().onSuccess?.({}, TASK_ID);

    expect(scheduler.cancelRemindersForKey).toHaveBeenCalledWith(`task:${TASK_ID}`);
    expect(scheduler.calls).toEqual([
      `cancel:task:${TASK_ID}`,
      "invalidate:tasks",
      "invalidate:today",
      "invalidate:reminders",
    ]);
  });

  it("useUpdateTask cancels when the patch touches a reminder-affecting field", async () => {
    const hook = tasks.useUpdateTask() as MutationLike<{ id: string; body: { remind_at: null } }>;

    await hook.onSuccess?.({}, { id: TASK_ID, body: { remind_at: null } });

    expect(scheduler.calls).toEqual([
      `cancel:task:${TASK_ID}`,
      "invalidate:tasks",
      "invalidate:today",
      "invalidate:reminders",
    ]);
  });

  it("useUpdateTask does NOT cancel for a title-only edit (the alarm is still exactly right), but still invalidates", async () => {
    const hook = tasks.useUpdateTask() as MutationLike<{ id: string; body: { title: string } }>;

    await hook.onSuccess?.({}, { id: TASK_ID, body: { title: "Renamed" } });

    expect(scheduler.cancelRemindersForKey).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([["tasks"], ["today"], ["reminders"]]);
  });

  it("a failing cancel is contained: invalidation still runs", async () => {
    scheduler.cancelRemindersForKey.mockRejectedValueOnce(new Error("store unavailable"));
    const hook = tasks.useCompleteTask() as MutationLike<string>;

    await hook.onSuccess?.({}, TASK_ID);

    expect(invalidatedKeys()).toEqual([["tasks"], ["today"], ["reminders"]]);
  });

  it.each([
    ["useCreateTask", () => tasks.useCreateTask() as MutationLike<unknown>],
    ["useActivateTask", () => tasks.useActivateTask() as MutationLike<string>],
    ["useReopenTask", () => tasks.useReopenTask() as MutationLike<string>],
  ])("%s invalidates tasks/today/reminders without cancelling (nothing is stale)", async (_name, hook) => {
    await hook().onSuccess?.({}, TASK_ID);

    expect(scheduler.cancelRemindersForKey).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([["tasks"], ["today"], ["reminders"]]);
  });
});

describe("occurrence mutations (queries/occurrences.ts)", () => {
  it.each([
    ["useCompleteOccurrence", () => occurrences.useCompleteOccurrence() as MutationLike<string>],
    ["useSkipOccurrence", () => occurrences.useSkipOccurrence() as MutationLike<string>],
    ["useReopenOccurrence", () => occurrences.useReopenOccurrence() as MutationLike<string>],
  ])("%s cancels occ:<id> BEFORE invalidating occurrences/tasks/today/reminders", async (_name, hook) => {
    await hook().onSuccess?.({}, OCC_ID);

    expect(scheduler.calls).toEqual([
      `cancel:occ:${OCC_ID}`,
      "invalidate:occurrences",
      "invalidate:tasks",
      "invalidate:today",
      "invalidate:reminders",
    ]);
  });

  it("useSnoozeOccurrence cancels the occurrence's alarm (the feed re-issues it at the snoozed instant)", async () => {
    const hook = occurrences.useSnoozeOccurrence() as MutationLike<{
      id: string;
      body: { until: string };
    }>;

    await hook.onSuccess?.({}, { id: OCC_ID, body: { until: "2026-09-14T14:00:00.000Z" } });

    expect(scheduler.calls[0]).toBe(`cancel:occ:${OCC_ID}`);
    expect(invalidatedKeys()).toEqual([["occurrences"], ["tasks"], ["today"], ["reminders"]]);
  });

  it("the mutation functions reach the API by the expected names", async () => {
    const complete = occurrences.useCompleteOccurrence() as unknown as {
      mutationFn: (id: string) => unknown;
    };
    const snooze = occurrences.useSnoozeOccurrence() as unknown as {
      mutationFn: (vars: { id: string; body: { until: string } }) => unknown;
    };
    const reopen = occurrences.useReopenOccurrence() as unknown as {
      mutationFn: (id: string) => unknown;
    };

    await complete.mutationFn(OCC_ID);
    await snooze.mutationFn({ id: OCC_ID, body: { until: "2026-09-14T14:00:00.000Z" } });
    await reopen.mutationFn(OCC_ID);

    expect(apiMock.completeOccurrence).toHaveBeenCalledWith(OCC_ID);
    expect(apiMock.snoozeOccurrence).toHaveBeenCalledWith(OCC_ID, {
      until: "2026-09-14T14:00:00.000Z",
    });
    expect(apiMock.reopenOccurrence).toHaveBeenCalledWith(OCC_ID);
  });
});
