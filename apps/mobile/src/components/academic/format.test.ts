import type { AcademicGrade, AcademicSubmission } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  courseLabel,
  formatDateLabel,
  formatDueLabel,
  formatGradeLabel,
  formatPercentage,
  formatPoints,
  formatTimeLabel,
  formatWhenLabel,
  pluralize,
  submissionBadge,
} from "./format";

// Locale and zone are pinned in every date test so the assertions do not
// depend on the machine running them; the components pass neither and get
// the device's own.
const EN_CHICAGO = { locale: "en-US", timeZone: "America/Chicago" } as const;

describe("formatDueLabel", () => {
  it("renders month, day and time in the requested zone -- the retired 10.1 card's exact shape", () => {
    // 2026-09-23T04:59:00Z is 11:59 PM on Sep 22 in Chicago (CDT, UTC-5).
    expect(formatDueLabel("2026-09-23T04:59:00Z", EN_CHICAGO)).toBe("Sep 22 · 11:59 PM");
  });

  it("follows the zone, not the instant's own offset", () => {
    expect(
      formatDueLabel("2026-09-23T04:59:00Z", { locale: "en-US", timeZone: "Asia/Tokyo" }),
    ).toBe("Sep 23 · 1:59 PM");
  });

  it("says 'No due date' for a null due_at", () => {
    expect(formatDueLabel(null, EN_CHICAGO)).toBe("No due date");
  });

  it("never renders 'Invalid Date' or the raw string for an unreadable instant", () => {
    const label = formatDueLabel("not-an-instant", EN_CHICAGO);
    expect(label).toBe("—");
    expect(label).not.toContain("Invalid");
  });
});

describe("formatDateLabel / formatTimeLabel", () => {
  it("split the same instant the due label joins", () => {
    expect(formatDateLabel("2026-09-23T04:59:00Z", EN_CHICAGO)).toBe("Sep 22");
    expect(formatTimeLabel("2026-09-23T04:59:00Z", EN_CHICAGO)).toBe("11:59 PM");
  });

  it("fail closed on garbage", () => {
    expect(formatDateLabel("", EN_CHICAGO)).toBe("—");
    expect(formatTimeLabel("garbage", EN_CHICAGO)).toBe("—");
  });
});

describe("formatWhenLabel", () => {
  it("renders an all-day event as its date only", () => {
    expect(
      formatWhenLabel({ at: "2026-09-22T05:00:00Z", ends_at: null, all_day: true }, EN_CHICAGO),
    ).toBe("Sep 22");
  });

  it("renders an all-day span as two dates", () => {
    expect(
      formatWhenLabel(
        { at: "2026-09-22T05:00:00Z", ends_at: "2026-09-24T05:00:00Z", all_day: true },
        EN_CHICAGO,
      ),
    ).toBe("Sep 22 – Sep 24");
  });

  it("renders a timed same-day event as date, start and end time", () => {
    expect(
      formatWhenLabel(
        { at: "2026-09-22T20:00:00Z", ends_at: "2026-09-22T21:00:00Z", all_day: false },
        EN_CHICAGO,
      ),
    ).toBe("Sep 22 · 3:00 PM – 4:00 PM");
  });

  it("repeats the date when a timed event ends on another day", () => {
    expect(
      formatWhenLabel(
        { at: "2026-09-22T20:00:00Z", ends_at: "2026-09-23T21:00:00Z", all_day: false },
        EN_CHICAGO,
      ),
    ).toBe("Sep 22 · 3:00 PM – Sep 23 · 4:00 PM");
  });

  it("drops an end that is not after the start rather than rendering a backwards range", () => {
    expect(
      formatWhenLabel(
        { at: "2026-09-22T20:00:00Z", ends_at: "2026-09-22T20:00:00Z", all_day: false },
        EN_CHICAGO,
      ),
    ).toBe("Sep 22 · 3:00 PM");
    expect(
      formatWhenLabel(
        { at: "2026-09-22T20:00:00Z", ends_at: "2026-09-22T19:00:00Z", all_day: false },
        EN_CHICAGO,
      ),
    ).toBe("Sep 22 · 3:00 PM");
  });

  it("says 'No date' when there is no start", () => {
    expect(formatWhenLabel({ at: null, ends_at: null, all_day: false }, EN_CHICAGO)).toBe(
      "No date",
    );
  });
});

describe("formatPoints / formatPercentage", () => {
  it("print whole numbers without a decimal point", () => {
    expect(formatPoints(97)).toBe("97");
    expect(formatPercentage(97)).toBe("97");
  });

  it("cap points at two decimals and percentages at one, trimming trailing zeros", () => {
    expect(formatPoints(9.5)).toBe("9.5");
    expect(formatPoints(33.3333)).toBe("33.33");
    expect(formatPoints(12.5)).toBe("12.5");
    expect(formatPercentage(96.67)).toBe("96.7");
    expect(formatPercentage(66.6667)).toBe("66.7");
    expect(formatPercentage(100)).toBe("100");
  });

  it("do not clamp extra credit", () => {
    expect(formatPercentage(105)).toBe("105");
  });

  it("never print NaN", () => {
    expect(formatPoints(Number.NaN)).toBe("—");
    expect(formatPercentage(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

function grade(overrides: Partial<AcademicGrade> = {}): AcademicGrade {
  return { status: "graded", score: null, grade: null, percentage: null, ...overrides };
}

describe("formatGradeLabel", () => {
  it("renders score over points possible with the server's percentage", () => {
    expect(formatGradeLabel(grade({ score: 97, grade: "97", percentage: 97 }), 100)).toBe(
      "97 / 100 · 97%",
    );
  });

  it("uses the SERVER percentage rather than recomputing it", () => {
    // 29/30 is 96.666...; the server rounds to one decimal (ADR-068a) and
    // this formatter must show that value, never a second derivation.
    expect(formatGradeLabel(grade({ score: 29, grade: "29", percentage: 96.7 }), 30)).toBe(
      "29 / 30 · 96.7%",
    );
  });

  it("appends a letter or word grade, but not one that merely repeats the score", () => {
    expect(formatGradeLabel(grade({ score: 97, grade: "A", percentage: 97 }), 100)).toBe(
      "97 / 100 · 97% · A",
    );
    expect(formatGradeLabel(grade({ score: 97, grade: "97%", percentage: 97 }), 100)).toBe(
      "97 / 100 · 97%",
    );
    expect(formatGradeLabel(grade({ score: 97, grade: "97.0", percentage: 97 }), 100)).toBe(
      "97 / 100 · 97%",
    );
  });

  it("renders a grade string alone when there is no score (letter / complete / excused)", () => {
    expect(formatGradeLabel(grade({ grade: "A" }), 100)).toBe("A");
    expect(formatGradeLabel(grade({ grade: "complete" }), null)).toBe("complete");
    expect(formatGradeLabel(grade({ grade: "  excused  " }), 10)).toBe("excused");
  });

  it("renders the bare score when points possible is unknown (so no percentage exists)", () => {
    expect(formatGradeLabel(grade({ score: 5, grade: "5" }), null)).toBe("5");
  });

  it("says 'Graded' when graded with neither a score nor a grade string", () => {
    expect(formatGradeLabel(grade(), 100)).toBe("Graded");
    expect(formatGradeLabel(grade({ grade: "   " }), 100)).toBe("Graded");
  });

  it("renders a dash for anything not graded, including pending review", () => {
    expect(formatGradeLabel(grade({ status: "not_graded" }), 100)).toBe("—");
    expect(formatGradeLabel(grade({ status: "pending_review", score: 50 }), 100)).toBe("—");
  });
});

function submission(overrides: Partial<AcademicSubmission> = {}): AcademicSubmission {
  return { status: "unsubmitted", missing: false, late: false, submitted_at: null, ...overrides };
}

describe("submissionBadge", () => {
  it("puts Canvas's own missing flag first, in red", () => {
    expect(submissionBadge(submission({ missing: true }))).toEqual({
      text: "Missing",
      tone: "red",
    });
    // Missing outranks late even when both are set.
    expect(submissionBadge(submission({ missing: true, late: true, status: "graded" }))).toEqual({
      text: "Missing",
      tone: "red",
    });
  });

  it("then late, in amber, even for a graded submission", () => {
    expect(submissionBadge(submission({ late: true, status: "graded" }))).toEqual({
      text: "Late",
      tone: "amber",
    });
  });

  it("then the normalized status", () => {
    expect(submissionBadge(submission({ status: "graded" }))).toEqual({
      text: "Graded",
      tone: "green",
    });
    expect(submissionBadge(submission({ status: "submitted" }))).toEqual({
      text: "Submitted",
      tone: "neutral",
    });
    expect(submissionBadge(submission({ status: "pending_review" }))).toEqual({
      text: "Submitted",
      tone: "neutral",
    });
  });

  it("renders NO badge for an open assignment that is neither missing nor late, and none for unknown", () => {
    expect(submissionBadge(submission())).toBeNull();
    // An unrecognized provider status must never read as "Submitted".
    expect(submissionBadge(submission({ status: "unknown" }))).toBeNull();
  });
});

describe("courseLabel", () => {
  it("prefers the code and falls back to the name", () => {
    expect(courseLabel("INSY 4315", "Advanced Web Development")).toBe("INSY 4315");
    expect(courseLabel(null, "Advanced Web Development")).toBe("Advanced Web Development");
    expect(courseLabel("   ", "Advanced Web Development")).toBe("Advanced Web Development");
  });
});

describe("pluralize", () => {
  it("handles one and many", () => {
    expect(pluralize(1, "unread announcement")).toBe("1 unread announcement");
    expect(pluralize(3, "unread announcement")).toBe("3 unread announcements");
    expect(pluralize(0, "unread announcement")).toBe("0 unread announcements");
  });

  it("accepts an irregular plural", () => {
    expect(pluralize(2, "course", "courses")).toBe("2 courses");
  });
});
