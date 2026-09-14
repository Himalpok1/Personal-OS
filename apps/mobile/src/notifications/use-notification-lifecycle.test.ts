import { ApiClientError } from "@personal-os/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Notifications from "expo-notifications";
import {
  resetCaptureShortcutSignalForTest,
  subscribeToCaptureShortcutTaps,
} from "./capture-shortcut-signal";
import type { ReminderActionDeps } from "./reminder-action";
import {
  consumeReminderActionOutcome,
  resetReminderActionSignalForTest,
  subscribeReminderActionOutcome,
  type ReminderActionOutcome,
} from "./reminder-action-signal";

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
const {
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
} = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  getLastNotificationResponseAsync: vi.fn().mockResolvedValue(null),
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: vi.fn(),
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

// use-notification-lifecycle.ts binds the REAL api client and query client
// into its default ReminderActionDeps at import time. The client module
// reaches expo-constants/ui-test-mode at import, so it is stubbed here; the
// action tests below inject their own deps and never touch this stub.
vi.mock("@/queries/client", () => ({
  api: {},
  queryClient: { invalidateQueries: vi.fn() },
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

const { handleNotificationResponse, resetHandledNotificationResponsesForTest, responseDedupeKey } =
  await import("./use-notification-lifecycle");

type RouterParam = Parameters<typeof handleNotificationResponse>[1];

const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

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

function makeResponse(
  identifier: string,
  data: unknown,
  actionIdentifier = DEFAULT_ACTION,
): Notifications.NotificationResponse {
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
    actionIdentifier,
  } as Notifications.NotificationResponse;
}

describe("handleNotificationResponse", () => {
  beforeEach(() => {
    resetHandledNotificationResponsesForTest();
    resetCaptureShortcutSignalForTest();
  });

  it("navigates for a cold-start response (delivered as the initial value, not via a listener)", () => {
    const router = makeRouter();
    const response = makeResponse("cold-start-1", { taskId: "task-abc" });

    handleNotificationResponse(response, asRouter(router));

    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
  });

  it("navigates for a response delivered while the app is already running (the warm-listener case)", () => {
    const router = makeRouter();
    const response = makeResponse("warm-1", { inboxId: "inbox-def" });

    handleNotificationResponse(response, asRouter(router));

    // Checkpoint 9.3: a confirmation opens the item's own screen, not the tab.
    expect(router.navigate).toHaveBeenCalledWith("/inbox/inbox-def");
  });

  it("does not act on the same response twice", () => {
    const router = makeRouter();
    const response = makeResponse("same-id", { taskId: "task-abc" });

    handleNotificationResponse(response, asRouter(router));
    // Same response object delivered again -- a re-render, or the cold-start
    // value and a later listener delivery of the identical interaction.
    handleNotificationResponse(response, asRouter(router));
    // A distinct object with the same identifier must also be treated as
    // already-handled -- the guard compares identifiers, not references.
    handleNotificationResponse(
      makeResponse("same-id", { taskId: "task-abc" }),
      asRouter(router),
    );

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it("routes a genuinely new response after an earlier one was already handled", () => {
    const router = makeRouter();

    handleNotificationResponse(
      makeResponse("first", { taskId: "task-1" }),
      asRouter(router),
    );
    handleNotificationResponse(
      makeResponse("second", { taskId: "task-2" }),
      asRouter(router),
    );

    expect(router.navigate).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenNthCalledWith(1, "/tasks/task-1");
    expect(router.navigate).toHaveBeenNthCalledWith(2, "/tasks/task-2");
  });

  it("does nothing for a null or unroutable payload", () => {
    const router = makeRouter();

    handleNotificationResponse(undefined, asRouter(router));
    handleNotificationResponse(null, asRouter(router));
    handleNotificationResponse(
      makeResponse("unroutable", { title: "no ids here" }),
      asRouter(router),
    );

    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.dismissAll).not.toHaveBeenCalled();
  });

  it("the dedupe key pairs the request identifier with the action identifier", () => {
    expect(responseDedupeKey(makeResponse("n1", {}))).toBe(`n1:${DEFAULT_ACTION}`);
    expect(responseDedupeKey(makeResponse("n1", {}, "complete"))).toBe("n1:complete");
  });

  it("prefers taskId over inboxId when a payload carries both", () => {
    const router = makeRouter();
    const response = makeResponse("both-ids", { taskId: "task-abc", inboxId: "inbox-def" });

    handleNotificationResponse(response, asRouter(router));

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
    );

    expect(calls).toEqual(["dismissAll", "navigate"]);
  });

  it("skips dismissAll (but still navigates) when there is nothing to dismiss", () => {
    const router = makeRouter(false);

    handleNotificationResponse(
      makeResponse("nothing-to-dismiss", { taskId: "task-abc" }),
      asRouter(router),
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
  beforeEach(() => {
    resetHandledNotificationResponsesForTest();
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
      "useLastNotificationResponse's own dedupe and handledResponseKeys key " +
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
    );

    expect(tapped).toBe(1);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.dismissAll).not.toHaveBeenCalled();
  });

  it("does not emit the signal twice for the same response", () => {
    const router = makeRouter();
    let tapped = 0;
    subscribeToCaptureShortcutTaps(() => {
      tapped += 1;
    });
    const response = makeResponse("shade-tap-2", { captureShortcut: true });

    handleNotificationResponse(response, asRouter(router));
    handleNotificationResponse(response, asRouter(router));

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
    );
    handleNotificationResponse(
      makeResponse("digest-1", { mailDigestDate: "2026-09-01" }),
      asRouter(router),
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
    );

    expect(tapped).toBe(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

// Checkpoint 9.4: the Done / Snooze 1h / Tomorrow 9am buttons. Delivered
// with an action identifier other than DEFAULT; every one of them
// foregrounds the app, so a cold start launched by a button arrives here
// exactly like a cold-start tap (read once on mount via
// getLastNotificationResponseAsync), and a warm press arrives via the
// response listener. Both paths end in the same handleNotificationResponse.
describe("reminder notification actions (Checkpoint 9.4)", () => {
  const TASK_ID = "11111111-1111-4111-8111-111111111111";
  const OCC_ID = "22222222-2222-4222-8222-222222222222";
  const AT = "2026-08-18T09:00:00.000Z";
  const NOW = new Date("2026-08-18T09:05:00.000Z");
  const IDENTIFIER = `reminder:occ:${OCC_ID}:${AT}`;

  function occurrencePayload() {
    return { key: `occ:${OCC_ID}`, taskId: TASK_ID, occurrenceId: OCC_ID, remindAt: AT };
  }

  function oneOffPayload() {
    return { key: `task:${TASK_ID}`, taskId: TASK_ID, occurrenceId: null, remindAt: AT };
  }

  function makeDeps() {
    const api = {
      completeOccurrence: vi.fn().mockResolvedValue({ id: OCC_ID, status: "done" }),
      completeTask: vi.fn().mockResolvedValue({}),
      snoozeOccurrence: vi.fn().mockResolvedValue({}),
      // Open (the shade snooze refuses a closed task client-side, D3).
      getTask: vi.fn().mockResolvedValue({ id: TASK_ID, status: "active", remind_at: AT }),
      updateTask: vi.fn().mockResolvedValue({}),
    };
    const deps = {
      api,
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      dismissNotification: vi.fn().mockResolvedValue(undefined),
      cancelRemindersForKey: vi.fn().mockResolvedValue(undefined),
      now: () => NOW,
      timezone: () => "America/Chicago",
    } satisfies ReminderActionDeps;
    return { api, deps };
  }

  let outcomes: ReminderActionOutcome[];

  beforeEach(() => {
    resetHandledNotificationResponsesForTest();
    resetReminderActionSignalForTest();
    outcomes = [];
    subscribeReminderActionOutcome((outcome) => outcomes.push(outcome));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("Done on an occurrence reminder completes the occurrence, dismisses, cancels the key, invalidates, publishes and then navigates to the task", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();
    const order: string[] = [];
    deps.dismissNotification.mockImplementation(async () => {
      order.push("dismiss");
    });
    deps.cancelRemindersForKey.mockImplementation(async () => {
      order.push("cancel");
    });
    deps.invalidateQueries.mockImplementation(async () => {
      order.push("invalidate");
    });
    router.navigate.mockImplementation(() => order.push("navigate"));

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
      asRouter(router),
      deps,
    );

    expect(api.completeOccurrence).toHaveBeenCalledWith(OCC_ID);
    expect(deps.dismissNotification).toHaveBeenCalledWith(IDENTIFIER);
    expect(deps.cancelRemindersForKey).toHaveBeenCalledWith(`occ:${OCC_ID}`);
    expect(deps.invalidateQueries.mock.calls.map(([key]) => key)).toEqual([
      ["tasks"],
      ["today"],
      ["occurrences"],
      ["reminders"],
    ]);
    // The four invalidations are STARTED before the navigation (so the task
    // screen finds fresh queries in flight) but never awaited by it.
    expect(order).toEqual([
      "dismiss",
      "cancel",
      "invalidate",
      "invalidate",
      "invalidate",
      "invalidate",
      "navigate",
    ]);
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
    expect(outcomes).toEqual([{ taskId: TASK_ID, action: "complete", status: "done", label: "" }]);
    // The task screen mounted by that navigation can pull it.
    expect(consumeReminderActionOutcome(TASK_ID)?.status).toBe("done");
  });

  it("Done on a one-off reminder completes the task, with the 409 -> occurrence fallback", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();
    api.completeTask.mockRejectedValue(
      new ApiClientError(409, "recurring_task_use_occurrence", {
        error: "recurring_task_use_occurrence",
        occurrence_id: OCC_ID,
      }),
    );

    await handleNotificationResponse(
      makeResponse(`reminder:task:${TASK_ID}:${AT}`, oneOffPayload(), "complete"),
      asRouter(router),
      deps,
    );

    expect(api.completeTask).toHaveBeenCalledWith(TASK_ID);
    expect(api.completeOccurrence).toHaveBeenCalledWith(OCC_ID);
    expect(deps.cancelRemindersForKey).toHaveBeenCalledWith(`task:${TASK_ID}`);
    expect(outcomes[0]?.status).toBe("done");
  });

  it("Snooze 1h on an occurrence snoozes THAT occurrence until now + 1h; Tomorrow 9am until 09:00 tomorrow in the device zone", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "snooze_hour"),
      asRouter(router),
      deps,
    );
    await handleNotificationResponse(
      makeResponse(`${IDENTIFIER}-b`, occurrencePayload(), "snooze_tomorrow"),
      asRouter(router),
      deps,
    );

    expect(api.snoozeOccurrence).toHaveBeenNthCalledWith(1, OCC_ID, {
      until: "2026-08-18T10:05:00.000Z",
    });
    expect(api.snoozeOccurrence).toHaveBeenNthCalledWith(2, OCC_ID, {
      until: "2026-08-19T14:00:00.000Z",
    });
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(outcomes.map((outcome) => `${outcome.action}:${outcome.status}`)).toEqual([
      "snooze_hour:done",
      "snooze_tomorrow:done",
    ]);
    // The label is the formatted target (device-local), never a sentence.
    expect(outcomes[0]?.label).toMatch(/\d{1,2}:\d{2}/);
    expect(outcomes[1]?.label).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2}/);
  });

  it("Snooze on a one-off reminder fetches the task and PATCHes due_at + remind_at", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse(`reminder:task:${TASK_ID}:${AT}`, oneOffPayload(), "snooze_hour"),
      asRouter(router),
      deps,
    );

    expect(api.getTask).toHaveBeenCalledWith(TASK_ID);
    expect(api.updateTask).toHaveBeenCalledWith(TASK_ID, {
      due_at: "2026-08-18T10:05:00.000Z",
      remind_at: "2026-08-18T10:05:00.000Z",
    });
    expect(api.snoozeOccurrence).not.toHaveBeenCalled();
  });

  it("on failure: no dismiss, no cancel, no invalidation -- but a FAILED outcome is published and the app still navigates to the task", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();
    api.completeOccurrence.mockRejectedValue(new TypeError("Network request failed"));

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
      asRouter(router),
      deps,
    );

    expect(deps.dismissNotification).not.toHaveBeenCalled();
    expect(deps.cancelRemindersForKey).not.toHaveBeenCalled();
    expect(deps.invalidateQueries).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { taskId: TASK_ID, action: "complete", status: "failed", label: "", reason: "network" },
    ]);
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("navigation does not wait on the invalidations: a refetch that never settles still lands the owner on the task", async () => {
    const router = makeRouter();
    const { deps } = makeDeps();
    deps.invalidateQueries.mockImplementation(() => new Promise(() => undefined));

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
      asRouter(router),
      deps,
    );

    expect(deps.invalidateQueries).toHaveBeenCalledTimes(4);
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  describe("already on the task (the owner tapped a button while its screen was showing)", () => {
    it("skips dismissAll and navigate, so the mounted screen keeps the banner it just received", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();

      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
        () => `/tasks/${TASK_ID}`,
      );

      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
      expect(outcomes).toHaveLength(1);
      expect(router.dismissAll).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it("still navigates from any OTHER screen, and from an unknown one", async () => {
      const { deps } = makeDeps();

      const elsewhere = makeRouter();
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(elsewhere),
        deps,
        () => "/tasks/some-other-task",
      );
      expect(elsewhere.dismissAll).toHaveBeenCalledTimes(1);
      expect(elsewhere.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);

      const unknown = makeRouter();
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "snooze_hour"),
        asRouter(unknown),
        deps,
        () => null,
      );
      expect(unknown.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
    });

    it("the pathname is read when the action RESOLVES, not when the tap arrived", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      let resolveComplete!: (value: unknown) => void;
      api.completeOccurrence.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveComplete = resolve;
          }),
      );
      let pathname = "/";

      const pending = handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
        () => pathname,
      );
      // The owner opens the task while the call is in flight.
      pathname = `/tasks/${TASK_ID}`;
      resolveComplete({ id: OCC_ID, status: "done" });
      await pending;

      expect(router.navigate).not.toHaveBeenCalled();
    });

    it("a plain reminder tap (no action) is unaffected -- it always routes", () => {
      const router = makeRouter();
      const { deps } = makeDeps();

      void handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload()),
        asRouter(router),
        deps,
        () => `/tasks/${TASK_ID}`,
      );

      expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
    });
  });

  it("COLD START: the launching action (delivered as the mount-time read, not via a listener) is acted on", async () => {
    // Nothing distinguishes a cold response from a warm one at this layer
    // -- which is the point: the hook feeds both getLastNotificationResponseAsync
    // and the listener into this one function. This pins that a response
    // arriving as the very first thing the process sees runs the action.
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
      asRouter(router),
      deps,
    );

    expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  describe("dedupe on (identifier, action)", () => {
    it("two DIFFERENT actions on the same notification are both handled (a failed snooze, then Done)", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      api.snoozeOccurrence.mockRejectedValue(new TypeError("Network request failed"));

      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "snooze_hour"),
        asRouter(router),
        deps,
      );
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );

      expect(api.snoozeOccurrence).toHaveBeenCalledTimes(1);
      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
      expect(outcomes.map((outcome) => `${outcome.action}:${outcome.status}`)).toEqual([
        "snooze_hour:failed",
        "complete:done",
      ]);
    });

    it("a FAILED action releases its key: the same button tapped again after a network failure runs for real", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      api.completeOccurrence
        .mockRejectedValueOnce(new TypeError("Network request failed"))
        .mockResolvedValueOnce({ id: OCC_ID, status: "done" });

      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );

      expect(api.completeOccurrence).toHaveBeenCalledTimes(2);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(["failed", "done"]);
      // The key is released only AFTER the failed outcome was published.
      expect(deps.dismissNotification).toHaveBeenCalledTimes(1);
    });

    it("a SUCCESSFUL action keeps its key: a re-delivery after success is still absorbed", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();

      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );

      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
    });

    it("a re-delivery mid-flight of an action that will FAIL is still ignored (the key is held until the outcome is published)", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      let rejectComplete!: (reason: unknown) => void;
      api.completeOccurrence.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectComplete = reject;
          }),
      );
      const response = makeResponse(IDENTIFIER, occurrencePayload(), "complete");

      const first = handleNotificationResponse(response, asRouter(router), deps);
      const second = handleNotificationResponse(response, asRouter(router), deps);
      rejectComplete(new TypeError("Network request failed"));
      await Promise.all([first, second]);

      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
      expect(outcomes).toHaveLength(1);
    });

    it("the SAME (identifier, action) pair delivered twice runs the action exactly once", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      const response = makeResponse(IDENTIFIER, occurrencePayload(), "complete");

      // Cold read on mount, then the listener firing for the same
      // interaction, then a remount re-reading the last response.
      await handleNotificationResponse(response, asRouter(router), deps);
      await handleNotificationResponse(response, asRouter(router), deps);
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );

      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(outcomes).toHaveLength(1);
    });

    it("a re-delivery mid-flight (before the first call resolved) is ignored, not queued", async () => {
      const router = makeRouter();
      const { api, deps } = makeDeps();
      let resolveComplete!: (value: unknown) => void;
      api.completeOccurrence.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveComplete = resolve;
          }),
      );
      const response = makeResponse(IDENTIFIER, occurrencePayload(), "complete");

      const first = handleNotificationResponse(response, asRouter(router), deps);
      const second = handleNotificationResponse(response, asRouter(router), deps);
      resolveComplete({ id: OCC_ID, status: "done" });
      await Promise.all([first, second]);

      expect(api.completeOccurrence).toHaveBeenCalledTimes(1);
    });

    it("the default tap on a notification whose action already ran is still routed (different pair)", async () => {
      const router = makeRouter();
      const { deps } = makeDeps();

      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload(), "complete"),
        asRouter(router),
        deps,
      );
      await handleNotificationResponse(
        makeResponse(IDENTIFIER, occurrencePayload()),
        asRouter(router),
        deps,
      );

      expect(router.navigate).toHaveBeenCalledTimes(2);
    });
  });

  it("the DEFAULT tap on a reminder is a plain Open -- no API call, no outcome", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload()),
      asRouter(router),
      deps,
    );

    expect(api.completeOccurrence).not.toHaveBeenCalled();
    expect(api.snoozeOccurrence).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
    expect(outcomes).toEqual([]);
  });

  it("a legacy (pre-9.4) reminder tap still opens the task", async () => {
    const router = makeRouter();
    const { deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse("legacy-1", { taskId: TASK_ID, remindAt: AT }),
      asRouter(router),
      deps,
    );

    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("an action identifier on a NON-reminder payload is ignored gracefully (routed as a plain tap)", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse("alert-1", { monitorIncidentId: "incident-1" }, "complete"),
      asRouter(router),
      deps,
    );
    await handleNotificationResponse(
      makeResponse("nothing-1", { title: "no ids" }, "snooze_hour"),
      asRouter(router),
      deps,
    );

    expect(api.completeOccurrence).not.toHaveBeenCalled();
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith("/monitor");
    expect(outcomes).toEqual([]);
  });

  it("an unknown action identifier on a reminder payload is treated as a plain tap", async () => {
    const router = makeRouter();
    const { api, deps } = makeDeps();

    await handleNotificationResponse(
      makeResponse(IDENTIFIER, occurrencePayload(), "some_future_action"),
      asRouter(router),
      deps,
    );

    expect(api.completeOccurrence).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });
});
