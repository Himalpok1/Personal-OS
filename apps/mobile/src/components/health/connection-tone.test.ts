import { describe, expect, it } from "vitest";
import type { HealthConnectionDisplayState } from "./connection-state";
import { healthConnectionChipTone } from "./connection-tone";

const ALL_STATES: HealthConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "no_streams_enabled",
  "syncing",
  "partial_scope",
  "stale",
  "error",
  "current",
];

describe("healthConnectionChipTone", () => {
  it("maps every state to a chip tone", () => {
    for (const state of ALL_STATES) {
      expect(typeof healthConnectionChipTone(state)).toBe("string");
    }
  });

  it("reserves success for the one healthy state and info for the in-flight one", () => {
    expect(ALL_STATES.filter((s) => healthConnectionChipTone(s) === "success")).toEqual([
      "current",
    ]);
    expect(ALL_STATES.filter((s) => healthConnectionChipTone(s) === "info")).toEqual(["syncing"]);
  });

  it("warns exactly on the states the card's copy already marks as needing action", () => {
    expect(ALL_STATES.filter((s) => healthConnectionChipTone(s) === "warning")).toEqual([
      "needs_reconnect",
      "no_streams_enabled",
      "partial_scope",
      "stale",
    ]);
  });

  it("never uses the danger tone -- nothing on this card is an error the user caused", () => {
    expect(ALL_STATES.filter((s) => healthConnectionChipTone(s) === "danger")).toEqual([]);
  });

  it("keeps the states that assert nothing about the connection neutral", () => {
    for (const state of ["unavailable", "not_configured", "not_connected", "error"] as const) {
      expect(healthConnectionChipTone(state)).toBe("neutral");
    }
  });
});
