import { describe, expect, it } from "vitest";
import {
  calendarOverallChipTone,
  integrationChipLabel,
  resolveOverallCalendarState,
  summarizeIntegrations,
  type CalendarOverallState,
} from "./integration-summary";
import {
  canvasConnectionChipTone,
  healthConnectionChipTone,
  mailConnectionChipTone,
} from "./status-tone";

const CALENDAR_STATES: CalendarOverallState[] = [
  "unavailable",
  "not_connected",
  "needs_reconnect",
  "disconnected",
  "connected",
];

describe("resolveOverallCalendarState (Checkpoint 10.6)", () => {
  it("is unavailable when the list itself could not be loaded, whatever it holds", () => {
    expect(
      resolveOverallCalendarState({ connections: [{ status: "active" }], isLoadError: true }),
    ).toBe("unavailable");
  });

  it("is not connected when there is no connection at all", () => {
    expect(resolveOverallCalendarState({ connections: [], isLoadError: false })).toBe(
      "not_connected",
    );
  });

  it("lets the worst connection speak for the row", () => {
    expect(
      resolveOverallCalendarState({
        connections: [{ status: "active" }, { status: "needs_reauth" }],
        isLoadError: false,
      }),
    ).toBe("needs_reconnect");
    expect(
      resolveOverallCalendarState({
        connections: [{ status: "active" }, { status: "revoked" }],
        isLoadError: false,
      }),
    ).toBe("needs_reconnect");
    // A disconnected connection beside a live one does not hide the live one.
    expect(
      resolveOverallCalendarState({
        connections: [{ status: "disconnected" }, { status: "active" }],
        isLoadError: false,
      }),
    ).toBe("connected");
    expect(
      resolveOverallCalendarState({
        connections: [{ status: "disconnected" }],
        isLoadError: false,
      }),
    ).toBe("disconnected");
  });

  it("tones: red only when Personal OS is unreachable, green only when connected", () => {
    expect(CALENDAR_STATES.filter((s) => calendarOverallChipTone(s) === "danger")).toEqual([
      "unavailable",
    ]);
    expect(CALENDAR_STATES.filter((s) => calendarOverallChipTone(s) === "success")).toEqual([
      "connected",
    ]);
    expect(calendarOverallChipTone("needs_reconnect")).toBe("warning");
    expect(calendarOverallChipTone("disconnected")).toBe("neutral");
    expect(calendarOverallChipTone("not_connected")).toBe("neutral");
  });
});

describe("summarizeIntegrations (Checkpoint 10.6)", () => {
  it("always lists the four integrations in a fixed order", () => {
    const items = summarizeIntegrations({
      calendar: "connected",
      mail: "connected",
      health: "current",
      canvas: "connected",
    });
    expect(items.map((item) => item.key)).toEqual(["calendar", "mail", "health", "canvas"]);
    expect(items.map((item) => item.label)).toEqual(["Calendar", "Gmail", "Health", "Canvas"]);
  });

  it("reuses each card's own tone function, so the row can never disagree with the card", () => {
    const items = summarizeIntegrations({
      calendar: "needs_reconnect",
      mail: "unavailable",
      health: "stale",
      canvas: "error",
    });
    expect(items[0]!.tone).toBe(calendarOverallChipTone("needs_reconnect"));
    expect(items[1]!.tone).toBe(mailConnectionChipTone("unavailable"));
    expect(items[2]!.tone).toBe(healthConnectionChipTone("stale"));
    expect(items[3]!.tone).toBe(canvasConnectionChipTone("error"));
  });

  it("spells the state in words, never the enum token", () => {
    const items = summarizeIntegrations({
      calendar: "needs_reconnect",
      mail: "not_configured",
      health: "no_streams_enabled",
      canvas: "needs_reconnect",
    });
    expect(items.map((item) => item.state)).toEqual([
      "needs reconnect",
      "not configured",
      "no streams enabled",
      "needs reconnect",
    ]);
    for (const item of items) expect(item.state).not.toContain("_");
  });

  it("carries a null state and a neutral tone while an integration is still loading", () => {
    const items = summarizeIntegrations({
      calendar: null,
      mail: "connected",
      health: null,
      canvas: "connected",
    });
    expect(items[0]).toMatchObject({ key: "calendar", state: null, tone: "neutral" });
    expect(items[2]).toMatchObject({ key: "health", state: null, tone: "neutral" });
    expect(items[1]).toMatchObject({ key: "mail", state: "connected", tone: "success" });
  });

  it("labels a chip as `Name · state`, or the bare name while loading", () => {
    const [calendar, mail] = summarizeIntegrations({
      calendar: "connected",
      mail: null,
      health: "current",
      canvas: "connected",
    });
    expect(integrationChipLabel(calendar!)).toBe("Calendar · connected");
    expect(integrationChipLabel(mail!)).toBe("Gmail");
  });
});
