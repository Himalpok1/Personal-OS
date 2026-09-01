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

describe("monitoring alerts (Checkpoint 7.6)", () => {
  it("routes an incident alert to the monitoring screen", () => {
    // There is no per-incident screen, so the alert opens the list where the
    // incident appears and can be acknowledged.
    expect(resolveNotificationRoute({ monitorIncidentId: "abc", monitorTargetId: "def" })).toBe(
      "/monitor",
    );
  });

  it("keys on the INCIDENT id, not the target id", () => {
    // A target with no active incident has nothing to act on, so a payload
    // carrying only a target id is not a destination.
    expect(resolveNotificationRoute({ monitorTargetId: "def" })).toBeNull();
  });

  it("ignores an empty incident id", () => {
    expect(resolveNotificationRoute({ monitorIncidentId: "" })).toBeNull();
  });
});

describe("mail digests (Checkpoint 7.6)", () => {
  it("routes a digest to Today, where the digest card lives", () => {
    expect(
      resolveNotificationRoute({ mailDigestDate: "2026-09-01", mailDigestTimezone: "UTC" }),
    ).toBe("/(tabs)");
  });

  it("ignores an empty digest date", () => {
    expect(resolveNotificationRoute({ mailDigestDate: "" })).toBeNull();
  });
});

describe("precedence is preserved for existing payloads", () => {
  // The two new keys are appended, so no notification that already worked
  // changes destination. An alert and a reminder never co-occur in practice,
  // but "an existing notification keeps behaving exactly as it did" is worth
  // more than a tidier ordering.
  it("still prefers taskId over everything", () => {
    expect(
      resolveNotificationRoute({
        taskId: "t1",
        inboxId: "i1",
        monitorIncidentId: "m1",
        mailDigestDate: "2026-09-01",
      }),
    ).toBe("/tasks/t1");
  });

  it("still prefers inboxId over the new keys", () => {
    expect(
      resolveNotificationRoute({ inboxId: "i1", monitorIncidentId: "m1", mailDigestDate: "d" }),
    ).toBe("/(tabs)/inbox");
  });

  it("prefers a monitoring alert over a digest", () => {
    // An outage is more urgent than a summary.
    expect(resolveNotificationRoute({ monitorIncidentId: "m1", mailDigestDate: "d" })).toBe(
      "/monitor",
    );
  });

  it("still returns null for an unrelated payload", () => {
    expect(resolveNotificationRoute({ somethingElse: "x" })).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute(undefined)).toBeNull();
  });
});
