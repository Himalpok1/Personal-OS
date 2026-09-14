import { describe, expect, it } from "vitest";
import { canActivateTask, canCompleteTaskDirectly, canReopenTask } from "./task-lifecycle.js";

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

describe("canReopenTask", () => {
  it.each(["done", "dropped"])("is true from %s", (status) => {
    expect(canReopenTask(status)).toBe(true);
  });

  it.each(["inbox", "active", "", "archived"])("is false from %s", (status) => {
    expect(canReopenTask(status)).toBe(false);
  });
});
