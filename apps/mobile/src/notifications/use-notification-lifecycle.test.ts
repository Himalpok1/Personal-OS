import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Notifications from "expo-notifications";

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
// `react-native` and `expo-notifications` are mocked only because
// use-notification-lifecycle.ts's module-level `useLastNotificationResponseForPlatform`
// selection reads `Platform.OS` and `Notifications.useLastNotificationResponse`
// at import time -- neither mock's return value is exercised by these tests,
// since `handleNotificationResponse` takes its response directly as an
// argument rather than reading the hook.
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  useLastNotificationResponse: vi.fn(),
  setNotificationHandler: vi.fn(),
}));

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
    handleNotificationResponse(makeResponse("same-id", { taskId: "task-abc" }), asRouter(router), handledIdRef);

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it("routes a genuinely new response after an earlier one was already handled", () => {
    const router = makeRouter();

    handleNotificationResponse(makeResponse("first", { taskId: "task-1" }), asRouter(router), handledIdRef);
    handleNotificationResponse(makeResponse("second", { taskId: "task-2" }), asRouter(router), handledIdRef);

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

    handleNotificationResponse(makeResponse("unroutable", { title: "no ids here" }), asRouter(router), handledIdRef);

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

    handleNotificationResponse(makeResponse("order-1", { taskId: "task-abc" }), asRouter(router), handledIdRef);

    expect(calls).toEqual(["dismissAll", "navigate"]);
  });

  it("skips dismissAll (but still navigates) when there is nothing to dismiss", () => {
    const router = makeRouter(false);

    handleNotificationResponse(makeResponse("nothing-to-dismiss", { taskId: "task-abc" }), asRouter(router), handledIdRef);

    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith("/tasks/task-abc");
  });
});
