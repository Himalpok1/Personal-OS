import { beforeEach, describe, expect, it, vi } from "vitest";

// Checkpoint 9.4: the reminder action category (Done / Snooze 1h / Tomorrow
// 9am) is registered alongside the channels, from the same call sites, so a
// scheduled reminder that references `categoryIdentifier: "reminder"` never
// races its own category's existence.

const reactNativeMock = vi.hoisted(() => ({ platform: { os: "android" as string } }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return reactNativeMock.platform.os;
    },
  },
}));

const notificationsMock = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  setNotificationCategoryAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync: notificationsMock.setNotificationChannelAsync,
  setNotificationCategoryAsync: notificationsMock.setNotificationCategoryAsync,
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

const { ensureNotificationChannels, ensureReminderCategory } = await import("./channel");

beforeEach(() => {
  reactNativeMock.platform.os = "android";
  notificationsMock.setNotificationChannelAsync.mockClear();
  notificationsMock.setNotificationCategoryAsync.mockClear();
});

describe("ensureReminderCategory", () => {
  it("registers the 'reminder' category with exactly the three foregrounding actions, in order", async () => {
    await ensureReminderCategory();

    expect(notificationsMock.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(notificationsMock.setNotificationCategoryAsync).toHaveBeenCalledWith("reminder", [
      { identifier: "complete", buttonTitle: "Done", options: { opensAppToForeground: true } },
      {
        identifier: "snooze_hour",
        buttonTitle: "Snooze 1h",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "snooze_tomorrow",
        buttonTitle: "Tomorrow 9am",
        options: { opensAppToForeground: true },
      },
    ]);
  });

  it("is a no-op off Android", async () => {
    reactNativeMock.platform.os = "web";
    await ensureReminderCategory();
    reactNativeMock.platform.os = "ios";
    await ensureReminderCategory();

    expect(notificationsMock.setNotificationCategoryAsync).not.toHaveBeenCalled();
  });
});

describe("ensureNotificationChannels", () => {
  it("creates all four channels AND the reminder category, so every existing call site registers it", async () => {
    await ensureNotificationChannels();

    expect(
      notificationsMock.setNotificationChannelAsync.mock.calls.map(([id]) => id),
    ).toEqual(["reminders", "alerts", "updates", "capture"]);
    expect(notificationsMock.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(notificationsMock.setNotificationCategoryAsync.mock.calls[0]?.[0]).toBe("reminder");
  });

  it("is idempotent across calls (each call re-registers; the platform replaces by id)", async () => {
    await ensureNotificationChannels();
    await ensureNotificationChannels();

    expect(notificationsMock.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
    expect(
      new Set(notificationsMock.setNotificationCategoryAsync.mock.calls.map(([id]) => id)).size,
    ).toBe(1);
  });
});
