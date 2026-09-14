import { ApiClientError } from "@personal-os/api-client";
import type { Device, ReminderItem, RemindersResponse } from "@personal-os/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Minimal hooks harness --------------------------------------------------
// use-reminder-reconciliation.ts has no JSX/rendering surface -- it's pure
// hook composition (useState/useRef/useEffect + useDeviceIdentity + two
// useQuery calls) over already-tested primitives (scheduler.ts, channel.ts,
// exact-alarm.ts). This repo has no React renderer installed for tests (no
// react-test-renderer / @testing-library/react-native in node_modules --
// see apps/mobile/package.json), and this task is test-only, so rather than
// add a rendering dependency this harness implements the exact minimal
// subset of the hooks API the module calls, as deterministic, call-order-
// indexed slots. This mirrors how scheduler.test.ts mocks expo-notifications
// wholesale instead of pulling in native test infra -- same idea, applied to
// 'react' itself.
//
// Hook call order in the real module never varies across renders (no
// conditional hooks), so indexing by call order is safe and faithfully
// reproduces React's own same-order-every-render contract.
const hooksHarness = vi.hoisted(() => {
  const values = new Map<number, unknown>();
  const effectDeps = new Map<number, readonly unknown[] | undefined>();
  const effectCleanups = new Map<number, (() => void) | undefined>();
  let index = 0;

  function reset(): void {
    values.clear();
    effectDeps.clear();
    effectCleanups.clear();
    index = 0;
  }

  function beginRender(): void {
    index = 0;
  }

  function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
  }

  function useState<T>(initial: T): [T, (updater: T | ((prev: T) => T)) => void] {
    const idx = index++;
    if (!values.has(idx)) values.set(idx, initial);
    const setState = (updater: T | ((prev: T) => T)): void => {
      const prev = values.get(idx) as T;
      values.set(idx, typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater);
    };
    return [values.get(idx) as T, setState];
  }

  function useRef<T>(initial: T): { current: T } {
    const idx = index++;
    if (!values.has(idx)) values.set(idx, { current: initial });
    return values.get(idx) as { current: T };
  }

  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const idx = index++;
    const isFirstRun = !effectDeps.has(idx);
    const prevDeps = effectDeps.get(idx);
    const changed =
      isFirstRun || deps === undefined || prevDeps === undefined || !depsEqual(deps, prevDeps);
    effectDeps.set(idx, deps);
    if (!changed) return;
    const prevCleanup = effectCleanups.get(idx);
    if (prevCleanup) prevCleanup();
    const cleanup = effect();
    effectCleanups.set(idx, typeof cleanup === "function" ? cleanup : undefined);
  }

  return { reset, beginRender, useState, useRef, useEffect };
});

vi.mock("react", () => ({
  useState: hooksHarness.useState,
  useRef: hooksHarness.useRef,
  useEffect: hooksHarness.useEffect,
}));

const reactNativeMock = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    Platform: { OS: "android" as string },
    AppState: {
      addEventListener: vi.fn((_event: string, cb: (state: string) => void) => {
        listeners.add(cb);
        return { remove: () => listeners.delete(cb) };
      }),
    },
  };
});
vi.mock("react-native", () => ({
  Platform: reactNativeMock.Platform,
  AppState: reactNativeMock.AppState,
}));

const deviceIdentityMock = vi.hoisted(() => ({ useDeviceIdentity: vi.fn() }));
vi.mock("@/device-identity/provider", () => ({
  useDeviceIdentity: deviceIdentityMock.useDeviceIdentity,
}));

const queryMock = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: queryMock.useQuery }));

const apiMock = vi.hoisted(() => ({
  getDevice: vi.fn(),
  listReminders: vi.fn(),
}));
vi.mock("@/queries/client", () => ({ api: apiMock }));

const channelMock = vi.hoisted(() => ({
  ensureNotificationChannels: vi.fn(),
  ensureNotificationPermission: vi.fn(),
}));
vi.mock("./channel", () => channelMock);

const exactAlarmMock = vi.hoisted(() => ({ ensureExactAlarmPermission: vi.fn() }));
vi.mock("./exact-alarm", () => exactAlarmMock);

const schedulerMock = vi.hoisted(() => ({
  applyReminderReconciliation: vi.fn(),
  cancelOwnedReminders: vi.fn(),
}));
vi.mock("./scheduler", () => schedulerMock);

const { useReminderReconciliation } = await import("./use-reminder-reconciliation");

// --- Fixtures ----------------------------------------------------------------

const IDENTITY = { token: "device-token", deviceId: "device-1" };

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "device-1",
    name: "rabbit r1",
    platform: "android",
    push_token: null,
    is_primary_reminder_device: true,
    notifications_enabled: true,
    notify_reminders: false,
    notify_confirmations: true,
    notify_digests: false,
    notify_alerts: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    last_seen_at: null,
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";

// Checkpoint 9.4: the hook reads `GET /reminders`, not a page of tasks.
function reminderItem(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return {
    key: `task:${TASK_ID}`,
    task_id: TASK_ID,
    occurrence_id: null,
    title: "Call the insurance guy",
    remind_at: "2026-08-18T09:00:00.000Z",
    due_at: "2026-08-18T09:00:00.000Z",
    timezone: "America/Chicago",
    recurring: false,
    ...overrides,
  };
}

function feed(items: ReminderItem[]): RemindersResponse {
  return { items, horizon_days: 45 };
}

// --- Query-result plumbing ---------------------------------------------------
// Mirrors the real useQuery shape only in the fields the hook actually
// reads (`data`, `error`); the hook is mocked, not react-query, so nothing
// else needs to be faithful.

interface QueryResult {
  data: unknown;
  error: unknown;
}

let deviceQueryResult: QueryResult;
let remindersQueryResult: QueryResult;
let remindersQueryOptions: { enabled?: boolean } | undefined;

function idle(): QueryResult {
  return { data: undefined, error: null };
}

function render(): void {
  hooksHarness.beginRender();
  // Not a real component/hook -- this drives the fake hooks harness above
  // directly, which is why the real react-hooks lint rule doesn't apply.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useReminderReconciliation();
}

async function flush(): Promise<void> {
  // Lets the fire-and-forget async IIFEs inside the effect(s) settle.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  hooksHarness.reset();
  vi.clearAllMocks();

  deviceIdentityMock.useDeviceIdentity.mockReturnValue({
    identity: IDENTITY,
    isLoading: false,
    setIdentity: vi.fn(),
    clearIdentity: vi.fn(),
  });

  deviceQueryResult = idle();
  remindersQueryResult = idle();
  remindersQueryOptions = undefined;
  queryMock.useQuery.mockImplementation(
    (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
      const key = options.queryKey[0];
      if (key === "devices") return deviceQueryResult;
      if (key === "reminders") {
        remindersQueryOptions = options;
        return remindersQueryResult;
      }
      throw new Error(`unexpected queryKey in test: ${String(key)}`);
    },
  );

  channelMock.ensureNotificationChannels.mockResolvedValue(undefined);
  channelMock.ensureNotificationPermission.mockResolvedValue(true);
  exactAlarmMock.ensureExactAlarmPermission.mockReturnValue(true);
  schedulerMock.applyReminderReconciliation.mockResolvedValue(undefined);
  schedulerMock.cancelOwnedReminders.mockResolvedValue(undefined);
});

describe("useReminderReconciliation", () => {
  it("cancels owned reminders when the device has been revoked", async () => {
    deviceQueryResult = { data: device({ revoked_at: "2026-08-17T00:00:00.000Z" }), error: null };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("cancels owned reminders when notifications_enabled is false", async () => {
    deviceQueryResult = { data: device({ notifications_enabled: false }), error: null };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("cancels owned reminders when this device is not the primary reminder device", async () => {
    deviceQueryResult = { data: device({ is_primary_reminder_device: false }), error: null };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("treats a 401 from getDevice as authoritative and cancels owned reminders", async () => {
    deviceQueryResult = { data: undefined, error: new ApiClientError(401, "invalid_token") };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("preserves already-scheduled alarms on a generic fetch failure -- does NOT cancel", async () => {
    // Not an ApiClientError, not a 401 -- an ordinary network/500 failure.
    // This is the deliberate "reminders keep working while the server is
    // unreachable" rule (use-reminder-reconciliation.ts's own top-of-file
    // comment) and the single most important assertion in this suite.
    deviceQueryResult = { data: undefined, error: new Error("network request failed") };
    remindersQueryResult = { data: undefined, error: new Error("network request failed") };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("preserves already-scheduled alarms on a generic 500 ApiClientError -- does NOT cancel", async () => {
    // A non-401 ApiClientError (e.g. a real 500) must not be treated as
    // authoritative revocation either -- only 401 is.
    deviceQueryResult = { data: undefined, error: new ApiClientError(500, "internal_error") };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("cancels owned reminders when device identity is lost across a re-render", async () => {
    // First render: paired and eligible.
    deviceIdentityMock.useDeviceIdentity.mockReturnValue({
      identity: IDENTITY,
      isLoading: false,
      setIdentity: vi.fn(),
      clearIdentity: vi.fn(),
    });
    deviceQueryResult = { data: device(), error: null };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };
    render();
    await flush();
    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();

    // Second render: identity has gone from non-null to null (e.g. "forget
    // this device"). The identity-lost effect must fire regardless of
    // device/task query state, which the next render also idles out.
    deviceIdentityMock.useDeviceIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      setIdentity: vi.fn(),
      clearIdentity: vi.fn(),
    });
    deviceQueryResult = idle();
    remindersQueryResult = idle();
    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on the very first render just because identity is already null", async () => {
    // previousIdentity starts equal to the current identity (both null) on
    // first mount -- there is no transition, so no cancellation should fire.
    deviceIdentityMock.useDeviceIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      setIdentity: vi.fn(),
      clearIdentity: vi.fn(),
    });
    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
  });

  it("reconciles an eligible device: applyReminderReconciliation is called with the feed projected to ReminderTasks", async () => {
    const items = [
      reminderItem(),
      reminderItem({
        key: `occ:${OCC_ID}`,
        occurrence_id: OCC_ID,
        title: "Water the plants",
        recurring: true,
      }),
    ];
    deviceQueryResult = { data: device(), error: null };
    remindersQueryResult = { data: feed(items), error: null };
    exactAlarmMock.ensureExactAlarmPermission.mockReturnValue(true);

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
    expect(channelMock.ensureNotificationChannels).toHaveBeenCalledTimes(1);
    expect(channelMock.ensureNotificationPermission).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).toHaveBeenCalledTimes(1);
    expect(schedulerMock.applyReminderReconciliation).toHaveBeenCalledWith(
      [
        {
          key: `task:${TASK_ID}`,
          taskId: TASK_ID,
          occurrenceId: null,
          title: "Call the insurance guy",
          remindAt: "2026-08-18T09:00:00.000Z",
          dueAt: "2026-08-18T09:00:00.000Z",
          recurring: false,
        },
        {
          key: `occ:${OCC_ID}`,
          taskId: TASK_ID,
          occurrenceId: OCC_ID,
          title: "Water the plants",
          remindAt: "2026-08-18T09:00:00.000Z",
          dueAt: "2026-08-18T09:00:00.000Z",
          recurring: true,
        },
      ],
      true,
    );
  });

  it("reads the feed through the stable [\"reminders\"] key, gated on pairing", async () => {
    deviceQueryResult = { data: device(), error: null };
    remindersQueryResult = { data: feed([]), error: null };

    render();
    await flush();

    expect(remindersQueryOptions?.enabled).toBe(true);

    deviceIdentityMock.useDeviceIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      setIdentity: vi.fn(),
      clearIdentity: vi.fn(),
    });
    render();
    expect(remindersQueryOptions?.enabled).toBe(false);
  });

  it("does not reconcile while the reminders query has not resolved yet, even for an eligible device", async () => {
    deviceQueryResult = { data: device(), error: null };
    remindersQueryResult = idle();

    render();
    await flush();

    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
  });

  it("does not reconcile or cancel when notification permission is denied", async () => {
    deviceQueryResult = { data: device(), error: null };
    remindersQueryResult = { data: feed([reminderItem()]), error: null };
    channelMock.ensureNotificationPermission.mockResolvedValue(false);

    render();
    await flush();

    expect(schedulerMock.applyReminderReconciliation).not.toHaveBeenCalled();
    expect(schedulerMock.cancelOwnedReminders).not.toHaveBeenCalled();
  });
});
