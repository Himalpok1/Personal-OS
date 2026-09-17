import type { AcademicWorkload } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { workloadChip, workloadNeedsAttention } from "./workload-state";

function workload(overrides: Partial<AcademicWorkload> = {}): AcademicWorkload {
  return {
    status: "on_track",
    open_total: 0,
    overdue_total: 0,
    missing_total: 0,
    due_within_24h_total: 0,
    due_this_week_total: 0,
    points_at_stake: 0,
    horizon_days: 7,
    days: [],
    ...overrides,
  };
}

describe("workloadChip", () => {
  it("behind is danger, explained by the overdue and missing counts", () => {
    expect(
      workloadChip(workload({ status: "behind", overdue_total: 2, missing_total: 1 })),
    ).toEqual({ tone: "danger", label: "Behind", detail: "2 overdue · 1 missing" });
    expect(
      workloadChip(workload({ status: "behind", overdue_total: 0, missing_total: 1 })),
    ).toEqual({ tone: "danger", label: "Behind", detail: "1 missing" });
    expect(workloadChip(workload({ status: "behind", overdue_total: 3 }))).toEqual({
      tone: "danger",
      label: "Behind",
      detail: "3 overdue",
    });
  });

  it("at_risk is warning, explained by the 24h count", () => {
    expect(workloadChip(workload({ status: "at_risk", due_within_24h_total: 1 }))).toEqual({
      tone: "warning",
      label: "At risk",
      detail: "1 due in 24h",
    });
  });

  it("on_track is success, with the week's count, else the open count, else nothing", () => {
    expect(workloadChip(workload({ due_this_week_total: 3, open_total: 5 }))).toEqual({
      tone: "success",
      label: "On track",
      detail: "3 due this week",
    });
    expect(workloadChip(workload({ open_total: 1 }))).toEqual({
      tone: "success",
      label: "On track",
      detail: "1 open assignment",
    });
    expect(workloadChip(workload())).toEqual({ tone: "success", label: "On track", detail: null });
  });

  it("never re-derives the status from the counts -- the server's word is final", () => {
    // A `behind` with zero counts (a contract oddity) still reads Behind, with
    // nothing to explain it, rather than being silently promoted to on_track.
    expect(workloadChip(workload({ status: "behind" }))).toEqual({
      tone: "danger",
      label: "Behind",
      detail: null,
    });
  });
});

describe("workloadNeedsAttention", () => {
  it("is true for behind and at_risk only", () => {
    expect(workloadNeedsAttention("behind")).toBe(true);
    expect(workloadNeedsAttention("at_risk")).toBe(true);
    expect(workloadNeedsAttention("on_track")).toBe(false);
  });
});
