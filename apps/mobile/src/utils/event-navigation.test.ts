import { describe, expect, it } from "vitest";
import { eventDetailHref } from "./event-navigation";

describe("eventDetailHref", () => {
  it("carries the instance's occurs_at for a recurring instance, URL-encoded", () => {
    expect(eventDetailHref("series-1", "2026-09-15T14:00:00.000Z")).toBe(
      "/events/series-1?occursAt=2026-09-15T14%3A00%3A00.000Z",
    );
  });

  it("omits the query for a one-off (null or absent occurs_at)", () => {
    expect(eventDetailHref("oneoff-1", null)).toBe("/events/oneoff-1");
    expect(eventDetailHref("oneoff-1", undefined)).toBe("/events/oneoff-1");
  });
});
