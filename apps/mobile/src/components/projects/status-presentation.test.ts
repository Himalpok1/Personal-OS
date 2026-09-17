import { describe, expect, it } from "vitest";
import {
  PROJECT_STALLED_PRESENTATION,
  projectDisplayStatus,
  projectStatusPresentation,
} from "./status-presentation";

describe("projectDisplayStatus (Checkpoint 10.3)", () => {
  it("reads an archived project as archived whatever its lifecycle status", () => {
    for (const status of ["active", "paused", "completed"] as const) {
      expect(projectDisplayStatus({ status, archived_at: "2026-09-01T00:00:00.000Z" })).toBe(
        "archived",
      );
    }
  });

  it("reads an unarchived project by its lifecycle status", () => {
    for (const status of ["active", "paused", "completed"] as const) {
      expect(projectDisplayStatus({ status, archived_at: null })).toBe(status);
    }
  });
});

describe("projectStatusPresentation", () => {
  it("maps active to success, paused and archived to neutral, completed to info", () => {
    expect(projectStatusPresentation("active")).toEqual({ label: "Active", tone: "success" });
    expect(projectStatusPresentation("paused")).toEqual({ label: "Paused", tone: "neutral" });
    expect(projectStatusPresentation("completed")).toEqual({
      label: "Completed",
      tone: "info",
    });
    expect(projectStatusPresentation("archived")).toEqual({
      label: "Archived",
      tone: "neutral",
    });
  });

  it("flags a stalled project as a warning", () => {
    expect(PROJECT_STALLED_PRESENTATION).toEqual({ label: "Stalled", tone: "warning" });
  });
});
