import { describe, expect, it } from "vitest";
import { canActivateTask, canCompleteTaskDirectly } from "./task-lifecycle.js";

describe("canCompleteTaskDirectly", () => {
  it("is true for a non-recurring task", () => {
    expect(canCompleteTaskDirectly({ rrule: null })).toBe(true);
  });

  it("is false for a recurring task", () => {
    expect(canCompleteTaskDirectly({ rrule: "FREQ=DAILY;INTERVAL=1" })).toBe(false);
  });
});

describe("canActivateTask", () => {
  it("is true from inbox", () => {
    expect(canActivateTask({ status: "inbox" })).toBe(true);
  });

  it.each(["active", "done", "dropped"])("is false from %s", (status) => {
    expect(canActivateTask({ status })).toBe(false);
  });
});
