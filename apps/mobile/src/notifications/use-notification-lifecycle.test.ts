import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Notifications from "expo-notifications";
import {
  resetCaptureShortcutSignalForTest,
  subscribeToCaptureShortcutTaps,
} from "./capture-shortcut-signal";

// This codebase has no React hook/render-testing library (no
// react-test-renderer, no @testing-library/react-native, no jsdom -- see
// brief-card.test.tsx's header comment for the established precedent), so
// `useNotificationLifecycle` itself -- which calls useRouter/useRef/useEffect
// -- cannot be invoked outside a real React render. use-notification-lifecycle.ts
// factors the actual once-only-navigate decision out into a plain, exported
// `handleNotificationResponse` for exactly this reason; this file tests that
// function directly with plain vitest, matching resolve-notification-route.test.ts's
// and scheduler.test.ts's style.
//
// `react-native` and `expo-notifications` are mocked partly because
// use-notification-lifecycle.ts's module-level `useLastNotificationResponseForPlatform`
// selection reads `Platform.OS` and `Notifications.useLastNotificationResponse`
// at import time (neither mock's return value is exercised by most tests
// below, since `handleNotificationResponse` takes its response directly as
// an argument rather than reading the hook) -- and partly because
// use-notification-lifecycle.ts now imports postCaptureShortcutNotification
// from use-capture-shortcut-notification.ts (Checkpoint 9.1's rearm-on-tap
// fix), which itself needs the full expo-notifications surface it calls
// mocked, or the real module import chain runs for real.
const { getPermissionsAsync, scheduleNotificationAsync, getPresentedNotificationsAsync } =
  vi.hoisted(() => ({
    getPermissionsAsync: vi.fn(),
    scheduleNotificationAsync: vi.fn(),
    getPresentedNotificationsAsync: vi.fn(),
  }));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock("expo-notifications", () => ({
  useLastNotificationResponse: vi.fn(),
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync: vi.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

// use-capture-shortcut-notification.ts also imports useDeviceIdentity purely
// to gate ITS OWN hook (which this file never invokes -- only the plain
// `postCaptureShortcutNotification` function, via the rearm call). Mocking
// it here is only to short-circuit the real provider's expo-secure-store
// import chain, which throws in this test environment (`__DEV__` undefined)
// -- nothing in this file exercises pairing state through THAT module.
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));

// use-notification-lifecycle.ts's rearm call DOES read this one directly
// (it is a plain function, not a hook, so it cannot call useDeviceIdentity()
// itself -- see paired-state.ts's header comment). Defaults to paired=true
// in beforeEach below so the existing rearm tests exercise the common case;
// the dedicated "unpaired" describe block overrides it.
const { isDeviceIdentityPaired } = vi.hoisted(() => ({ isDeviceIdentityPaired: vi.fn() }));
vi.mock("@/device-identity/paired-state", () => ({ isDeviceIdentityPaired }));

const { handleNotificationResponse } = await import("./use-notification-lifecycle");

type RouterParam = Parameters<typeof handleNotificationResponse>[1];

function makeRouter(canDismissReturn = true) {
  return {
    canDismiss: vi.fn(() => canDismissReturn),
    dismissAll: vi.fn(),
    navigate: vi.fn(),
  };
}

function asRouter(router: ReturnType<typeof makeRouter>): RouterParam {
  return router as unknown as RouterParam;
}

function makeResponse(identifier: string, data: unknown): Notifications.NotificationResponse {
  return {
    notification: {
      date: Date.now(),
      request: {
        identifier,
        content: {
          data,
        } as Notifications.NotificationContent,
        trigger: null as unknown as Notifications.NotificationTrigger,
      },
    },
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  } as Notifications.NotificationResponse;
}

describe("handleNotificationResponse", () => {
  let handledIdRef: { current: string | null };

  beforeEach(() => {
    handledIdRef = { current: null };
    resetCaptureShortcutSignalForTest();
  });

  it("navigates for a cold-start response (delivered as the initial value, not via a listener)", () => {
    const router = makeRouter();
    const response = makeResponse("cold-start-1", { taskId: "task-abc" });

    handleNotificationResponse(response, asRouter(router), handledIdRef);

    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
    expect(handledIdRef.current).toBe("cold-start-1");
  });

  it("navigates for a response delivered while the app is already running (the warm-listener case)", () => {
    const router = makeRouter();
    const response = makeResponse("warm-1", { inboxId: "inbox-def" });

    handleNotificationResponse(response, asRouter(router), handledIdRef);

    expect(router.navigate).toHaveBeenCalledWith("/(tabs)/inbox");
  });

  it("does not act on the same response twice", () => {
    const router = makeRouter();
    const response = makeResponse("same-id", { taskId: "task-abc" });

    handleNotificationResponse(response, asRouter(router), handledIdRef);
    // Same response object delivered again -- a re-render, or the cold-start
    // value and a later listener delivery of the identical interaction.
    handleNotificationResponse(response, asRouter(router), handledIdRef);
    // A distinct object with the same identifier must also be treated as
    // already-handled -- the guard compares identifiers, not references.
    handleNotificationResponse(
      makeResponse("same-id", { taskId: "task-abc" }),
      asRouter(router),
      handledIdRef,
    );

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it("routes a genuinely new response after an earlier one was already handled", () => {
    const router = makeRouter();

    handleNotificationResponse(
      makeResponse("first", { taskId: "task-1" }),
      asRouter(router),
      handledIdRef,
    );
    handleNotificationResponse(
      makeResponse("second", { taskId: "task-2" }),
      asRouter(router),
      handledIdRef,
    );

    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenNthCalledWith(1, "/tasks/task-1");
    expect(router.navigate).toHaveBeenNthCalledWith(2, "/tasks/task-2");
    expect(handledIdRef.current).toBe("second");
  });

  it("does nothing for a null or unroutable payload, but still marks the response handled", () => {
    const router = makeRouter();

    handleNotificationResponse(undefined, asRouter(router), handledIdRef);
    handleNotificationResponse(null, asRouter(router), handledIdRef);
    expect(handledIdRef.current).toBeNull();

    handleNotificationResponse(
      makeResponse("unroutable", { title: "no ids here" }),
      asRouter(router),
      handledIdRef,
    );

    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.dismissAll).not.toHaveBeenCalled();
    // An unroutable payload's identifier is still recorded, so a duplicate
    // delivery of the same unroutable response doesn't re-run the check.
    expect(handledIdRef.current).toBe("unroutable");
  });

  it("prefers taskId over inboxId when a payload carries both", () => {
    const router = makeRouter();
    const response = makeResponse("both-ids", { taskId: "task-abc", inboxId: "inbox-def" });

    handleNotificationResponse(response, asRouter(router), handledIdRef);

    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
  });

  it("dismisses back to the root before navigating, when a screen can be dismissed", () => {
    const router = makeRouter(true);
    const calls: string[] = [];
    router.dismissAll.mockImplementation(() => calls.push("dismissAll"));
    router.navigate.mockImplementation(() => calls.push("navigate"));

    handleNotificationResponse(
      makeResponse("order-1", { taskId: "task-abc" }),
      asRouter(router),
      handledIdRef,
    );

    expect(calls).toEqual(["dismissAll", "navigate"]);
  });

  it("skips dismissAll (but still navigates) when there is nothing to dismiss", () => {
    const router = makeRouter(false);

    handleNotificationResponse(
      makeResponse("nothing-to-dismiss", { taskId: "task-abc" }),
      asRouter(router),
      handledIdRef,
    );

    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
  });
});

// Checkpoint 9.1: the persistent notification-shade capture affordance has
// no destination for resolveNotificationRoute -- the composer is a global
// Modal, not a route -- so a tap must be intercepted before route
// resolution and must never attempt to navigate.
describe("capture-shortcut notification tap (Checkpoint 9.1)", () => {
  let handledIdRef: { current: string | null };

  beforeEach(() => {
    handledIdRef = { current: null };
    resetCaptureShortcutSignalForTest();
    getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
    scheduleNotificationAsync.mockReset().mockResolvedValue("scheduled");
    getPresentedNotificationsAsync.mockReset().mockResolvedValue([]);
    isDeviceIdentityPaired.mockReset().mockReturnValue(true);
  });

  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("rearms the notification (posts a fresh instance) immediately after handling a tap", async () => {
    const router = makeRouter();

    handleNotificationResponse(
      makeResponse("shade-tap-rearm", { captureShortcut: true }),
      asRouter(router),
      handledIdRef,
    );
    await flush();

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it(
    "REGRESSION (adversarial re-review finding): does NOT rearm while the " +
      "device is unpaired -- the rearm call is a plain, non-hook function " +
      "and so cannot gate on useDeviceIdentity() the way " +
      "useCaptureShortcutNotification's own mount/foreground path does; " +
      "without isDeviceIdentityPaired() this reposted a dead-end shortcut " +
      "for a tap processed after 'Forget device' or while pairing state was " +
      "still resolving from SecureStore",
    async () => {
      isDeviceIdentityPaired.mockReturnValue(false);
      const router = makeRouter();
      let tapped = 0;
      subscribeToCaptureShortcutTaps(() => {
        tapped += 1;
      });

      handleNotificationResponse(
        makeResponse("shade-tap-unpaired", { captureShortcut: true }),
        asRouter(router),
        handledIdRef,
      );
      await flush();

      // The compose signal still fires -- QuickAddFab isn't mounted while
      // unpaired anyway, so there's nothing to lose by still emitting it --
      // but the shortcut must not be reposted.
      expect(tapped).toBe(1);
      expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    },
  );

  it(
    "REGRESSION (adversarial review finding): a SECOND, distinct tap on the " +
      "rearmed instance is still handled -- reusing one constant identifier " +
      "across every repost was the original bug, since both " +
      "useLastNotificationResponse's own dedupe and handledIdRef below key " +
      "on `request.identifier`; rearming with a NEW identifier is what keeps " +
      "a later tap from being silently invisible",
    async () => {
      const router = makeRouter();
      let tapped = 0;
      subscribeToCaptureShortcutTaps(() => {
        tapped += 1;
      });

      // First tap, on whatever identifier the shortcut originally posted
      // under.
      handleNotificationResponse(
        makeResponse("shade-tap-A", { captureShortcut: true }),
        asRouter(router),
        handledIdRef,
      );
      await flush();
      expect(tapped).toBe(1);

      // The rearm call scheduled a notification under a DIFFERENT identifier
      // (the real makeCaptureShortcutNotificationIdentifier() rotates it) --
      // simulate the OS delivering a tap on THAT one. A test that reused
      // "shade-tap-A" here would not actually exercise this fix.
      handleNotificationResponse(
        makeResponse("shade-tap-B", { captureShortcut: true }),
        asRouter(router),
        handledIdRef,
      );
      await flush();

      expect(tapped).toBe(2);
      expect(scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    },
  );

  it("emits the capture-shortcut signal and does not navigate or dismiss", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });

    handleNotificationResponse(
      makeResponse("shade-tap-1", { captureShortcut: true }),
      asRouter(router),
      handledIdRef,
    );

    expect(tapped).toBe(1);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(handledIdRef.current).toBe("shade-tap-1");
  });

  it("does not emit the signal twice for the same response", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });
    const response = makeResponse("shade-tap-2", { captureShortcut: true });

    handleNotificationResponse(response, asRouter(router), handledIdRef);
    handleNotificationResponse(response, asRouter(router), handledIdRef);

    expect(tapped).toBe(1);
  });

  it("a normal reminder tap is completely unaffected -- no signal emitted, navigation unchanged", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });

    handleNotificationResponse(
      makeResponse("reminder-1", { taskId: "task-abc" }),
      asRouter(router),
      handledIdRef,
    );

    expect(tapped).toBe(0);
    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
  });

  it("a normal alert/digest tap is completely unaffected -- no signal emitted, navigation unchanged", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });

    handleNotificationResponse(
      makeResponse("alert-1", { monitorIncidentId: "incident-1" }),
      asRouter(router),
      handledIdRef,
    );
    handleNotificationResponse(
      makeResponse("digest-1", { mailDigestDate: "2026-09-01" }),
      asRouter(router),
      handledIdRef,
    );

    expect(tapped).toBe(0);
    expect(router.navigate).toHaveBeenNthCalledWith(1, "/monitor");
    expect(router.navigate).toHaveBeenNthCalledWith(2, "/(tabs)");
  });

  it("takes precedence over every route key, should a payload ever carry both", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });

    handleNotificationResponse(
      makeResponse("both", { captureShortcut: true, taskId: "task-abc" }),
      asRouter(router),
      handledIdRef,
    );

    expect(tapped).toBe(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
