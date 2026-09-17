import { describe, expect, it } from "vitest";
import { assignmentUrgency, urgencyContext } from "./assignment-urgency";

// 2026-09-16 13:00Z is 08:00 in America/Chicago (CDT, UTC-5); the week's
// horizon end is the start of local 2026-09-24, i.e. 2026-09-24T05:00:00Z.
const NOW_MS = Date.parse("2026-09-16T13:00:00Z");
const TZ = "America/Chicago";

describe("urgencyContext", () => {
  it("resolves the same horizon end the server's due_this_week uses", () => {
    const context = urgencyContext(NOW_MS, TZ);
    expect(context?.now.toISOString()).toBe("2026-09-16T13:00:00.000Z");
    expect(context?.horizonEndUtc.toISOString()).toBe("2026-09-24T05:00:00.000Z");
  });

  it("is null before the first fetch (dataUpdatedAt 0) and for an unreadable instant", () => {
    expect(urgencyContext(0, TZ)).toBeNull();
    expect(urgencyContext(Number.NaN, TZ)).toBeNull();
  });
});

describe("assignmentUrgency", () => {
  const context = urgencyContext(NOW_MS, TZ);

  it("walks core's ladder against the one instant", () => {
    expect(assignmentUrgency("2026-09-16T12:59:00Z", context)).toBe("critical");
    expect(assignmentUrgency("2026-09-16T13:00:00Z", context)).toBe("high");
    expect(assignmentUrgency("2026-09-17T12:59:00Z", context)).toBe("high");
    expect(assignmentUrgency("2026-09-17T13:00:00Z", context)).toBe("medium");
    expect(assignmentUrgency("2026-09-24T04:59:00Z", context)).toBe("medium");
    expect(assignmentUrgency("2026-09-24T05:00:00Z", context)).toBe("low");
  });

  it("is null for an undated or unreadable due instant, or with no context", () => {
    expect(assignmentUrgency(null, context)).toBeNull();
    expect(assignmentUrgency("garbage", context)).toBeNull();
    expect(assignmentUrgency("2026-09-16T12:59:00Z", null)).toBeNull();
  });
});
