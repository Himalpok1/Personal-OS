import { describe, expect, it } from "vitest";
import type { Review } from "@personal-os/schema";
import {
  isCurrentPeriod,
  savedChecklist,
  savedPriorities,
  savedSummary,
} from "./review-content";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

function reviewFixture(overrides: Partial<Review> = {}): Review {
  return {
    id: UUID,
    kind: "daily",
    period_start: "2026-08-21",
    timezone: "America/Chicago",
    status: "in_progress",
    content: null,
    summary: null,
    created_at: "2026-08-21T09:00:00Z",
    updated_at: "2026-08-21T09:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("review-content resume helpers (audit D1)", () => {
  it("restores a SPARSE checklist wholesale — no key-presence narrowing", () => {
    // Stored state that never ticked the `priorities` step checkbox must
    // still restore inbox/overdue/calendar flags.
    const review = reviewFixture({
      content: {
        version: 1,
        kind: "daily",
        checklist: { inbox: true, overdue: true, calendar: true },
        selected_priorities: [],
      },
    });
    expect(savedChecklist(review)).toEqual({
      inbox: true,
      overdue: true,
      calendar: true,
    });
  });

  it("restores selected_priorities even when the priorities checklist flag was never set", () => {
    const review = reviewFixture({
      content: {
        version: 1,
        kind: "daily",
        checklist: {},
        selected_priorities: [{ kind: "task", id: UUID }],
      },
    });
    expect(savedPriorities(review)).toEqual([{ kind: "task", id: UUID }]);
    expect(savedChecklist(review)).toEqual({});
  });

  it("weekly sparse checklist restores identically", () => {
    const review = reviewFixture({
      kind: "weekly",
      period_start: "2026-08-17",
      content: {
        version: 1,
        kind: "weekly",
        checklist: { inbox: true },
        selected_priorities: [],
      },
    });
    expect(savedChecklist(review)).toEqual({ inbox: true });
  });

  it("null content means nothing saved", () => {
    const review = reviewFixture({ content: null });
    expect(savedChecklist(review)).toEqual({});
    expect(savedPriorities(review)).toEqual([]);
    expect(savedSummary(review)).toBe("");
  });

  it("summary restores independently of content", () => {
    const review = reviewFixture({ summary: "Wrapped", content: null });
    expect(savedSummary(review)).toBe("Wrapped");
  });

  it("isCurrentPeriod pins resume to the matching period only", () => {
    const review = reviewFixture({ period_start: "2026-08-21" });
    expect(isCurrentPeriod(review, "2026-08-21")).toBe(true);
    expect(isCurrentPeriod(review, "2026-08-22")).toBe(false);
  });
});
