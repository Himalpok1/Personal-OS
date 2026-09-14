import { beforeEach, describe, expect, it, vi } from "vitest";

// Checkpoint 9.4: the `GET /reminders` query the primary device reconciles
// its local alarms from. Asserts the options the hook hands TanStack --
// the stable key other lanes invalidate, the native-only gate, and the
// polling cadence -- with `useQuery` replaced by an identity fake, the same
// no-render-harness approach as reminder-cancel-on-mutation.test.ts.

const reactNativeMock = vi.hoisted(() => ({ platform: { os: "android" as string } }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return reactNativeMock.platform.os;
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
}));

const apiMock = vi.hoisted(() => ({ listReminders: vi.fn() }));
vi.mock("./client", () => ({ api: apiMock }));

const { REMINDERS_QUERY_KEY, useReminders } = await import("./reminders");

interface QueryOptions {
  queryKey: readonly unknown[];
  queryFn: () => unknown;
  enabled: boolean;
  staleTime: number;
  refetchInterval: number;
}

beforeEach(() => {
  reactNativeMock.platform.os = "android";
  apiMock.listReminders.mockReset().mockResolvedValue({ items: [], horizon_days: 45 });
});

describe("useReminders", () => {
  it("uses the stable [\"reminders\"] key", () => {
    const options = useReminders() as unknown as QueryOptions;
    expect(options.queryKey).toEqual(["reminders"]);
    expect(REMINDERS_QUERY_KEY).toEqual(["reminders"]);
  });

  it("fetches api.listReminders() with the server default horizon", async () => {
    const options = useReminders() as unknown as QueryOptions;
    await options.queryFn();
    expect(apiMock.listReminders).toHaveBeenCalledTimes(1);
    expect(apiMock.listReminders).toHaveBeenCalledWith();
  });

  it("polls: 30s stale, 60s refetch -- the same cadence as the device query it pairs with", () => {
    const options = useReminders() as unknown as QueryOptions;
    expect(options.staleTime).toBe(30_000);
    expect(options.refetchInterval).toBe(60_000);
  });

  it("is enabled on native by default and honours the caller's gate", () => {
    expect((useReminders() as unknown as QueryOptions).enabled).toBe(true);
    expect((useReminders({ enabled: false }) as unknown as QueryOptions).enabled).toBe(false);
    expect((useReminders({ enabled: true }) as unknown as QueryOptions).enabled).toBe(true);
  });

  it("is never enabled on web, whatever the caller says", () => {
    reactNativeMock.platform.os = "web";
    expect((useReminders() as unknown as QueryOptions).enabled).toBe(false);
    expect((useReminders({ enabled: true }) as unknown as QueryOptions).enabled).toBe(false);
  });
});
