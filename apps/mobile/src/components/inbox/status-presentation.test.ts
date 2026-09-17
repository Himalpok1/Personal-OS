import { describe, expect, it } from "vitest";
import { inboxStatusPresentation, type InboxStatus } from "./status-presentation";

const STATUSES: InboxStatus[] = ["pending", "parsed", "needs_confirm", "confirmed", "failed"];

describe("inboxStatusPresentation (Checkpoint 10.3)", () => {
  it("keeps the labels the inbox has shown since Phase 2", () => {
    expect(STATUSES.map((s) => inboxStatusPresentation(s).label)).toEqual([
      "Parsing...",
      "Parsed",
      "Needs confirmation",
      "Confirmed",
      "Failed",
    ]);
  });

  it("draws attention states in warning and danger, settled states in success, pending in neutral", () => {
    expect(inboxStatusPresentation("pending")).toEqual({
      label: "Parsing...",
      icon: "progress-clock",
      tone: "neutral",
    });
    expect(inboxStatusPresentation("needs_confirm")).toEqual({
      label: "Needs confirmation",
      icon: "help-circle-outline",
      tone: "warning",
    });
    expect(inboxStatusPresentation("failed")).toEqual({
      label: "Failed",
      icon: "alert-circle-outline",
      tone: "danger",
    });
    for (const status of ["parsed", "confirmed"] as const) {
      expect(inboxStatusPresentation(status).icon).toBe("check-circle-outline");
      expect(inboxStatusPresentation(status).tone).toBe("success");
    }
  });

  it("covers every status with a distinct, non-empty label", () => {
    const labels = STATUSES.map((s) => inboxStatusPresentation(s).label);
    expect(new Set(labels).size).toBe(STATUSES.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });
});
