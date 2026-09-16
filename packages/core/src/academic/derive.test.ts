import { describe, expect, it } from "vitest";
import {
  deriveCourseStatus,
  deriveGradingStatus,
  derivePercentage,
  isOpenAssignment,
  normalizeReadState,
  normalizeSubmissionStatus,
} from "./derive.js";

describe("normalizeSubmissionStatus", () => {
  it.each(["unsubmitted", "submitted", "graded", "pending_review"] as const)(
    "maps the known Canvas token %s to itself",
    (token) => {
      expect(normalizeSubmissionStatus(token)).toBe(token);
    },
  );

  it("maps null and undefined to unknown", () => {
    expect(normalizeSubmissionStatus(null)).toBe("unknown");
    expect(normalizeSubmissionStatus(undefined)).toBe("unknown");
  });

  it("maps any token it has never heard of to unknown, never to a known member", () => {
    for (const raw of ["excused", "", "Submitted", " submitted", "submitted ", "GRADED", "late"]) {
      expect(normalizeSubmissionStatus(raw)).toBe("unknown");
    }
  });
});

describe("isOpenAssignment", () => {
  it("treats unsubmitted and unknown as open -- the direction that never hides work", () => {
    expect(isOpenAssignment("unsubmitted")).toBe(true);
    expect(isOpenAssignment("unknown")).toBe(true);
  });

  it("treats submitted, graded and pending_review as closed", () => {
    expect(isOpenAssignment("submitted")).toBe(false);
    expect(isOpenAssignment("graded")).toBe(false);
    expect(isOpenAssignment("pending_review")).toBe(false);
  });
});

describe("deriveGradingStatus", () => {
  it("is a function of the submission status alone", () => {
    expect(deriveGradingStatus("graded")).toBe("graded");
    expect(deriveGradingStatus("pending_review")).toBe("pending_review");
    expect(deriveGradingStatus("submitted")).toBe("not_graded");
    expect(deriveGradingStatus("unsubmitted")).toBe("not_graded");
    expect(deriveGradingStatus("unknown")).toBe("not_graded");
  });
});

describe("derivePercentage", () => {
  it("computes score / points * 100 rounded to one decimal", () => {
    expect(derivePercentage(97, 100)).toBe(97);
    expect(derivePercentage(8.5, 10)).toBe(85);
    expect(derivePercentage(1, 3)).toBe(33.3);
    expect(derivePercentage(2, 3)).toBe(66.7);
  });

  it("never clamps -- extra credit exceeds 100", () => {
    expect(derivePercentage(110, 100)).toBe(110);
  });

  it("is null when either side is missing", () => {
    expect(derivePercentage(null, 100)).toBeNull();
    expect(derivePercentage(undefined, 100)).toBeNull();
    expect(derivePercentage(97, null)).toBeNull();
    expect(derivePercentage(97, undefined)).toBeNull();
    expect(derivePercentage(null, null)).toBeNull();
  });

  it("is null when points_possible is zero or negative (an ungraded / extra-credit-only item)", () => {
    expect(derivePercentage(5, 0)).toBeNull();
    expect(derivePercentage(0, 0)).toBeNull();
    expect(derivePercentage(5, -1)).toBeNull();
  });

  it("is null for a non-finite input rather than NaN or Infinity on the wire", () => {
    expect(derivePercentage(Number.NaN, 100)).toBeNull();
    expect(derivePercentage(50, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("avoids the binary-fraction error a naive score/points*100 would carry", () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE 754.
    expect(derivePercentage(29, 100)).toBe(29);
    expect(derivePercentage(0.07, 1)).toBe(7);
  });

  it("returns a zero score as 0, never -0", () => {
    expect(Object.is(derivePercentage(0, 100), 0)).toBe(true);
    expect(Object.is(derivePercentage(-0.004, 100), 0)).toBe(true);
  });
});

describe("deriveCourseStatus", () => {
  it("archived_at wins over everything", () => {
    expect(deriveCourseStatus(new Date("2026-01-01T00:00:00Z"), "completed", "completed")).toBe(
      "archived",
    );
    expect(deriveCourseStatus("2026-01-01T00:00:00Z", "active", "available")).toBe("archived");
  });

  it("completed when either Canvas state says completed", () => {
    expect(deriveCourseStatus(null, "completed", "available")).toBe("completed");
    expect(deriveCourseStatus(null, "active", "completed")).toBe("completed");
    expect(deriveCourseStatus(null, "completed", null)).toBe("completed");
  });

  it("active for everything else, including nulls and unknown tokens", () => {
    expect(deriveCourseStatus(null, "active", "available")).toBe("active");
    expect(deriveCourseStatus(null, null, null)).toBe("active");
    expect(deriveCourseStatus(undefined, "invited", "unpublished")).toBe("active");
    expect(deriveCourseStatus(null, "Completed", "COMPLETED")).toBe("active");
  });
});

describe("normalizeReadState", () => {
  it("maps read/unread to true/false and everything else to null", () => {
    expect(normalizeReadState("read")).toBe(true);
    expect(normalizeReadState("unread")).toBe(false);
    expect(normalizeReadState(null)).toBeNull();
    expect(normalizeReadState(undefined)).toBeNull();
    expect(normalizeReadState("")).toBeNull();
    expect(normalizeReadState("Read")).toBeNull();
  });
});
