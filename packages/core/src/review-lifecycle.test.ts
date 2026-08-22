import { describe, expect, it } from "vitest";
import {
  REVIEW_STATUSES,
  REVIEW_TRANSITIONS,
  canCompleteReview,
  canSkipReview,
  type ReviewStatus,
} from "./review-lifecycle.js";

const TERMINAL: ReviewStatus[] = ["completed", "skipped"];
const GARBAGE = ["", "in-progress", "In Progress", "IN_PROGRESS", "pending", "archived", "done"];

describe("REVIEW_STATUSES", () => {
  it("is exactly the ADR-040 vocabulary", () => {
    expect([...REVIEW_STATUSES]).toEqual(["in_progress", "completed", "skipped"]);
  });
});

describe("canCompleteReview", () => {
  it("is true only from in_progress", () => {
    expect(canCompleteReview("in_progress")).toBe(true);
  });

  it.each(TERMINAL)(
    "rejects the terminal status %s — completion is not re-runnable as a transition",
    (status) => {
      expect(canCompleteReview(status)).toBe(false);
    },
  );

  it.each(GARBAGE)("rejects the invalid source %s", (status) => {
    expect(canCompleteReview(status)).toBe(false);
  });
});

describe("canSkipReview", () => {
  it("is true only from in_progress", () => {
    expect(canSkipReview("in_progress")).toBe(true);
  });

  it.each(TERMINAL)(
    "rejects the terminal status %s — skipping is not re-runnable as a transition",
    (status) => {
      expect(canSkipReview(status)).toBe(false);
    },
  );

  it.each(GARBAGE)("rejects the invalid source %s", (status) => {
    expect(canSkipReview(status)).toBe(false);
  });
});

describe("REVIEW_TRANSITIONS", () => {
  it("maps every status to its exact reachable targets", () => {
    expect(REVIEW_TRANSITIONS).toEqual({
      in_progress: ["completed", "skipped"],
      completed: [],
      skipped: [],
    });
  });

  it("has exactly one key per vocabulary status (exhaustive, no extras)", () => {
    expect(Object.keys(REVIEW_TRANSITIONS).sort()).toEqual([...REVIEW_STATUSES].sort());
    for (const from of REVIEW_STATUSES) {
      expect(REVIEW_TRANSITIONS[from]).toBeDefined();
    }
  });

  it("only targets vocabulary statuses and agrees with both predicates", () => {
    for (const from of REVIEW_STATUSES) {
      for (const to of REVIEW_TRANSITIONS[from]) {
        expect(REVIEW_STATUSES).toContain(to);
        const allowed =
          (to === "completed" && canCompleteReview(from)) ||
          (to === "skipped" && canSkipReview(from));
        expect(allowed).toBe(true);
      }
    }
  });

  it("leaves terminal statuses with no outgoing transitions", () => {
    for (const terminal of TERMINAL) {
      expect(REVIEW_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe("idempotency boundary (API-layer concern)", () => {
  // Core owns only strict legality from in_progress. The API layer must treat
  // completed→complete as row-unchanged and skipped→skip as idempotent BEFORE
  // these predicates would ever see the request; if the API consulted core on
  // a terminal row, these assertions are what make that call fail loudly
  // rather than silently double-apply.
  it("both predicates refuse every terminal source so no second application can look legal", () => {
    for (const terminal of TERMINAL) {
      expect(canCompleteReview(terminal)).toBe(false);
      expect(canSkipReview(terminal)).toBe(false);
      expect(REVIEW_TRANSITIONS[terminal].length).toBe(0);
    }
  });

  it("accepts garbage sources nowhere, so an unknown stored status can never complete or skip", () => {
    for (const junk of GARBAGE) {
      expect(canCompleteReview(junk)).toBe(false);
      expect(canSkipReview(junk)).toBe(false);
    }
  });
});
