import { describe, expect, it } from "vitest";
import { resolveNotificationRoute } from "./resolve-notification-route";

describe("resolveNotificationRoute", () => {
  it("routes a local reminder payload to its task detail screen", () => {
    expect(resolveNotificationRoute({ taskId: "abc", remindAt: "2026-08-18T12:00:00Z" })).toBe(
      "/tasks/abc",
    );
  });

  // The worker's capture-parse.ts dispatches confirmations with
  // `data: { inboxId }`. Before this existed the tap foregrounded the app
  // and navigated nowhere.
  it("routes a capture-confirmation payload to the Inbox tab", () => {
    expect(resolveNotificationRoute({ inboxId: "def" })).toBe("/(tabs)/inbox");
  });

  it("prefers taskId when a payload carries both", () => {
    expect(resolveNotificationRoute({ taskId: "abc", inboxId: "def" })).toBe("/tasks/abc");
  });

  it("returns null for payloads with no destination", () => {
    expect(resolveNotificationRoute(undefined)).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
    expect(resolveNotificationRoute({ title: "no ids here" })).toBeNull();
  });

  it("ignores non-string and empty ids rather than routing to a broken path", () => {
    expect(resolveNotificationRoute({ taskId: 42 })).toBeNull();
    expect(resolveNotificationRoute({ taskId: "" })).toBeNull();
    expect(resolveNotificationRoute({ inboxId: "" })).toBeNull();
    // A non-string taskId must not shadow a usable inboxId.
    expect(resolveNotificationRoute({ taskId: null, inboxId: "def" })).toBe("/(tabs)/inbox");
  });
});
