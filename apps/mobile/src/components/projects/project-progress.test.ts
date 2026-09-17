import { describe, expect, it } from "vitest";
import { projectProgress } from "./project-progress";

describe("projectProgress (Checkpoint 10.6)", () => {
  it("is null when there is nothing open and nothing done -- no bar, not an empty one", () => {
    expect(projectProgress({ open: 0, done: 0 })).toBeNull();
  });

  it("is done over open plus done", () => {
    expect(projectProgress({ open: 3, done: 2 })).toEqual({
      fraction: 0.4,
      done: 2,
      total: 5,
      label: "2 of 5 done",
    });
  });

  it("is empty with open work and nothing done, and full with nothing left open", () => {
    expect(projectProgress({ open: 4, done: 0 })).toMatchObject({
      fraction: 0,
      label: "0 of 4 done",
    });
    expect(projectProgress({ open: 0, done: 4 })).toMatchObject({
      fraction: 1,
      label: "4 of 4 done",
    });
  });

  it("never exceeds 1 or drops below 0 on a malformed count", () => {
    expect(projectProgress({ open: -1, done: 2 })!.fraction).toBe(1);
    expect(projectProgress({ open: 2, done: -1 })!.fraction).toBe(0);
  });
});
