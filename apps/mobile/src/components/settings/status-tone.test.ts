import { describe, expect, it } from "vitest";
import type { CanvasConnectionDisplayState } from "@/components/canvas/connection-state";
import type { MailConnectionDisplayState } from "@/components/mail/connection-state";
import {
  calendarConnectionChipLabel,
  calendarConnectionChipTone,
  canvasConnectionChipTone,
  healthConnectionChipTone,
  mailConnectionChipTone,
  monitorSummaryTone,
} from "./status-tone";

const MAIL_STATES: MailConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "disconnected",
  "error",
  "connected",
];

const CANVAS_STATES: CanvasConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "disconnected",
  "error",
  "connected",
];

describe("settings chip tones", () => {
  it("mail: red only when Personal OS itself is unreachable, green only when connected", () => {
    expect(MAIL_STATES.filter((s) => mailConnectionChipTone(s) === "danger")).toEqual([
      "unavailable",
    ]);
    expect(MAIL_STATES.filter((s) => mailConnectionChipTone(s) === "success")).toEqual([
      "connected",
    ]);
    expect(MAIL_STATES.filter((s) => mailConnectionChipTone(s) === "warning")).toEqual([
      "needs_reconnect",
      "error",
    ]);
    // An absence is not a fault.
    for (const state of ["not_configured", "not_connected", "disconnected"] as const) {
      expect(mailConnectionChipTone(state)).toBe("neutral");
    }
  });

  it("canvas: the same semantics as mail, state for state", () => {
    for (const state of CANVAS_STATES) {
      expect(canvasConnectionChipTone(state)).toBe(mailConnectionChipTone(state));
    }
  });

  it("calendar: active is green, a stopped grant is amber, a deliberate disconnect is neutral", () => {
    expect(calendarConnectionChipTone("active")).toBe("success");
    expect(calendarConnectionChipTone("needs_reauth")).toBe("warning");
    expect(calendarConnectionChipTone("revoked")).toBe("warning");
    expect(calendarConnectionChipTone("disconnected")).toBe("neutral");
  });

  it("calendar: every wire status has a one-phrase label with no raw enum token", () => {
    for (const status of ["active", "needs_reauth", "revoked", "disconnected"] as const) {
      const label = calendarConnectionChipLabel(status);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
    }
  });

  it("re-exports the health map so Settings and /health agree", () => {
    expect(healthConnectionChipTone("current")).toBe("success");
    expect(healthConnectionChipTone("stale")).toBe("warning");
  });

  it("monitoring: red on a load error or an open incident, default otherwise", () => {
    expect(monitorSummaryTone(true, 0)).toBe("danger");
    expect(monitorSummaryTone(false, 1)).toBe("danger");
    expect(monitorSummaryTone(false, 0)).toBe("default");
  });
});
