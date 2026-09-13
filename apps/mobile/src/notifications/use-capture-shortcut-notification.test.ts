import { beforeEach, describe, expect, it, vi } from "vitest";

// Deliberately NOT mocking "./channel" -- this exercises the real
// ensureCaptureChannel() + permission-gate + scheduleNotificationAsync path
// end to end, mocking only the native boundary (expo-notifications,
// react-native), the same choice scheduler.test.ts and
// use-notification-lifecycle.test.ts make.
//
// `Platform.OS` is held in a hoisted MUTABLE box, unlike scheduler.test.ts's
// fixed `{ OS: "android" }`, because this file (unlike that one) also has to
// prove the non-Android no-op.
const {
  setNotificationChannelAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
} = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
}));

const platformState = vi.hoisted(() => ({ os: "android" as string }));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return platformState.os;
    },
  },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

// use-capture-shortcut-notification.ts also imports useDeviceIdentity purely
// to gate its own React hook (untested by this file -- see
// use-capture-shortcut-notification.hook.test.ts for that). Mocking it here
// only short-circuits the real provider's expo-secure-store import chain,
// which throws in this test environment (`__DEV__` undefined).
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));

const { postCaptureShortcutNotification, clearCaptureShortcutNotification } = await import(
  "./use-capture-shortcut-notification"
);
const { CAPTURE_CHANNEL_ID } = await import("./channel");
const { resetCaptureShortcutNotificationIdentifierForTest, isCaptureShortcutNotification } =
  await import("./capture-shortcut-notification");

function presented(identifier: string, isShortcut: boolean) {
  return {
    request: {
      identifier,
      content: { data: isShortcut ? { captureShortcut: true } : { taskId: "x" } },
    },
  };
}

describe("postCaptureShortcutNotification", () => {
  beforeEach(() => {
    platformState.os = "android";
    resetCaptureShortcutNotificationIdentifierForTest();
    setNotificationChannelAsync.mockReset().mockResolvedValue(undefined);
    getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
    scheduleNotificationAsync.mockReset().mockResolvedValue("scheduled");
    getPresentedNotificationsAsync.mockReset().mockResolvedValue([]);
    dismissNotificationAsync.mockReset().mockResolvedValue(undefined);
  });

  it("ensures the capture channel, then posts an ongoing notification pinned to it", async () => {
    await postCaptureShortcutNotification();

    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      CAPTURE_CHANNEL_ID,
      expect.objectContaining({ importance: 2 }),
    );
    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: expect.stringMatching(/^capture-shortcut-/),
      content: {
        title: "Capture",
        body: "Tap to add a note, task, or reminder.",
        sticky: true,
        autoDismiss: false,
        data: { captureShortcut: true },
      },
      trigger: { channelId: CAPTURE_CHANNEL_ID },
    });
  });

  it("checks permission but never requests it -- that is owned by other hooks", async () => {
    await postCaptureShortcutNotification();

    expect(getPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("does not post when notification permission is not granted", async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });

    await postCaptureShortcutNotification();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("still ensures the channel exists even when permission is not (yet) granted", async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });

    await postCaptureShortcutNotification();

    expect(setNotificationChannelAsync).toHaveBeenCalled();
  });

  it("posts a FRESH identifier on every call -- a reused one would make repeated taps invisible", async () => {
    await postCaptureShortcutNotification();
    await postCaptureShortcutNotification();

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const [firstCall] = scheduleNotificationAsync.mock.calls[0] as [{ identifier: string }];
    const [secondCall] = scheduleNotificationAsync.mock.calls[1] as [{ identifier: string }];
    expect(firstCall.identifier).not.toBe(secondCall.identifier);
  });

  it("dismisses a previously-presented capture-shortcut notification, by content marker, after posting the fresh one", async () => {
    getPresentedNotificationsAsync.mockResolvedValue([presented("capture-shortcut-7", true)]);

    await postCaptureShortcutNotification();

    expect(dismissNotificationAsync).toHaveBeenCalledWith("capture-shortcut-7");
  });

  it("never dismisses the instance it just scheduled, even if already 'presented' by the time it checks", async () => {
    scheduleNotificationAsync.mockImplementation(async ({ identifier }: { identifier: string }) => {
      getPresentedNotificationsAsync.mockResolvedValue([presented(identifier, true)]);
      return identifier;
    });

    await postCaptureShortcutNotification();

    expect(dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("never dismisses an unrelated presented notification (a reminder, an alert, ...)", async () => {
    getPresentedNotificationsAsync.mockResolvedValue([presented("some-reminder-id", false)]);

    await postCaptureShortcutNotification();

    expect(dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("does not fail the whole post when dismissing a stale instance throws (already gone)", async () => {
    getPresentedNotificationsAsync.mockResolvedValue([presented("capture-shortcut-old", true)]);
    dismissNotificationAsync.mockRejectedValue(new Error("already dismissed"));

    await expect(postCaptureShortcutNotification()).resolves.toBeUndefined();
  });

  it("does nothing at all on a non-Android platform", async () => {
    platformState.os = "ios";

    await postCaptureShortcutNotification();

    expect(setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(getPermissionsAsync).not.toHaveBeenCalled();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("clearCaptureShortcutNotification", () => {
  beforeEach(() => {
    platformState.os = "android";
    getPresentedNotificationsAsync.mockReset().mockResolvedValue([]);
    dismissNotificationAsync.mockReset().mockResolvedValue(undefined);
  });

  it("dismisses every presented notification recognised as the capture shortcut, and nothing else", async () => {
    getPresentedNotificationsAsync.mockResolvedValue([
      presented("capture-shortcut-3", true),
      presented("some-alert-id", false),
    ]);

    await clearCaptureShortcutNotification();

    expect(dismissNotificationAsync).toHaveBeenCalledExactlyOnceWith("capture-shortcut-3");
  });

  it("does nothing when nothing matching is presented", async () => {
    getPresentedNotificationsAsync.mockResolvedValue([presented("some-digest-id", false)]);

    await clearCaptureShortcutNotification();

    expect(dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("does nothing on a non-Android platform", async () => {
    platformState.os = "ios";

    await clearCaptureShortcutNotification();

    expect(getPresentedNotificationsAsync).not.toHaveBeenCalled();
  });
});

// Sanity check that this test file's own `presented()` fixture actually
// round-trips through the real recognizer, so the mocked shape above isn't
// accidentally testing something the real isCaptureShortcutNotification
// wouldn't recognise.
describe("presented() fixture sanity", () => {
  it("the 'isShortcut: true' fixture is recognised by the real predicate", () => {
    expect(isCaptureShortcutNotification(presented("x", true).request.content.data)).toBe(true);
  });
  it("the 'isShortcut: false' fixture is not", () => {
    expect(isCaptureShortcutNotification(presented("x", false).request.content.data)).toBe(false);
  });
});
