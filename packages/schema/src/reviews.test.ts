import { describe, expect, it } from "vitest";
import {
  ReviewCreateSchema,
  ReviewKindSchema,
  ReviewListQuerySchema,
  ReviewSchema,
  ReviewStatusSchema,
  ReviewUpdateSchema,
} from "./reviews.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-08-21T09:00:00Z";

function reviewRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    kind: "daily",
    period_start: "2026-08-21",
    timezone: "America/Chicago",
    status: "in_progress",
    content: {
      version: 1,
      kind: "daily",
      checklist: { inbox: true, priorities: false },
      selected_priorities: [{ kind: "task", id: "123e4567-e89b-12d3-a456-426614174009" }],
    },
    summary: null,
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
    ...overrides,
  };
}

describe("Review schemas", () => {
  describe("ReviewSchema", () => {
    it("accepts an in-progress daily review with checklist content", () => {
      expect(ReviewSchema.safeParse(reviewRecord()).success).toBe(true);
    });

    it("accepts a completed weekly review with null content", () => {
      const result = ReviewSchema.safeParse(
        reviewRecord({
          kind: "weekly",
          status: "completed",
          content: null,
          summary: "Good week",
          completed_at: NOW,
        }),
      );
      expect(result.success).toBe(true);
    });

    it("accepts a skipped review", () => {
      expect(ReviewSchema.safeParse(reviewRecord({ status: "skipped" })).success).toBe(true);
    });

    it("rejects bad enum values", () => {
      expect(ReviewSchema.safeParse(reviewRecord({ kind: "monthly" })).success).toBe(false);
      expect(ReviewSchema.safeParse(reviewRecord({ status: "pending" })).success).toBe(false);
    });

    it("rejects a malformed period_start and naive timestamps", () => {
      expect(ReviewSchema.safeParse(reviewRecord({ period_start: "2026/08/21" })).success).toBe(
        false,
      );
      expect(
        ReviewSchema.safeParse(reviewRecord({ created_at: "2026-08-21T09:00:00" })).success,
      ).toBe(false);
    });
  });

  describe("ReviewCreateSchema", () => {
    it("accepts a valid create body", () => {
      const result = ReviewCreateSchema.safeParse({
        kind: "daily",
        period_start: "2026-08-21",
        tz: "America/Chicago",
      });
      expect(result.success).toBe(true);
    });

    it("rejects extra keys (strict)", () => {
      expect(
        ReviewCreateSchema.safeParse({
          kind: "daily",
          period_start: "2026-08-21",
          tz: "UTC",
          status: "completed",
        }).success,
      ).toBe(false);
    });

    it("rejects invalid timezone and malformed dates", () => {
      expect(
        ReviewCreateSchema.safeParse({
          kind: "daily",
          period_start: "2026-08-21",
          tz: "Mars/Olympus",
        }).success,
      ).toBe(false);
      expect(
        ReviewCreateSchema.safeParse({ kind: "daily", period_start: "not-a-date", tz: "UTC" })
          .success,
      ).toBe(false);
    });
  });

  describe("ReviewUpdateSchema", () => {
    it("accepts content-only, summary-only, and null-summary updates", () => {
      expect(
        ReviewUpdateSchema.safeParse({
          content: {
            version: 1,
            kind: "daily",
            checklist: { inbox: true },
            selected_priorities: [],
          },
        }).success,
      ).toBe(true);
      expect(ReviewUpdateSchema.safeParse({ summary: "Wrapped up" }).success).toBe(true);
      expect(ReviewUpdateSchema.safeParse({ summary: null }).success).toBe(true);
      // v1 content is a typed object -- explicit null-clearing is not part of
      // the contract (summary remains clearable).
      expect(ReviewUpdateSchema.safeParse({ content: null }).success).toBe(false);
      expect(ReviewUpdateSchema.safeParse({ summary: null }).success).toBe(true);
    });

    it("rejects an empty update", () => {
      expect(ReviewUpdateSchema.safeParse({}).success).toBe(false);
    });

    it("rejects unknown keys (strict)", () => {
      expect(ReviewUpdateSchema.safeParse({ content: {}, status: "completed" }).success).toBe(
        false,
      );
    });

    it("enforces v1 content bounds (audit: version, priority cap, ref shape, unknown keys)", () => {
      const base = {
        version: 1 as const,
        kind: "daily" as const,
        checklist: {},
        selected_priorities: [] as { kind: "task"; id: string }[],
      };
      expect(ReviewSchema.safeParse({ ...reviewRecord({ content: { ...base } }) }).success).toBe(
        true,
      );
      // wrong version
      expect(
        ReviewSchema.safeParse({
          ...reviewRecord({ content: { ...base, version: 2 } }),
        }).success,
      ).toBe(false);
      // >10 priorities
      const eleven = Array.from({ length: 11 }, (_, i) => ({
        kind: "task" as const,
        id: `123e4567-e89b-12d3-a456-4266141740${i.toString().padStart(2, "0")}`,
      }));
      expect(
        ReviewSchema.safeParse({
          ...reviewRecord({ content: { ...base, selected_priorities: eleven } }),
        }).success,
      ).toBe(false);
      // non-uuid ref
      expect(
        ReviewSchema.safeParse({
          ...reviewRecord({
            content: { ...base, selected_priorities: [{ kind: "task", id: "nope" }] },
          }),
        }).success,
      ).toBe(false);
      // unknown checklist key (strict)
      expect(
        ReviewSchema.safeParse({
          ...reviewRecord({
            content: { ...base, checklist: { not_a_step: true } },
          }),
        }).success,
      ).toBe(false);
      // summary bound (2000)
      expect(
        ReviewSchema.safeParse({ ...reviewRecord({ summary: "x".repeat(2001) }) }).success,
      ).toBe(false);
      expect(
        ReviewSchema.safeParse({ ...reviewRecord({ summary: "x".repeat(2000) }) }).success,
      ).toBe(true);
    });

    it("rejects a non-string summary", () => {
      expect(ReviewUpdateSchema.safeParse({ summary: 42 }).success).toBe(false);
    });
  });

  describe("ReviewListQuerySchema", () => {
    it("extends pagination with an optional kind filter", () => {
      const result = ReviewListQuerySchema.parse({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(ReviewListQuerySchema.parse({ kind: "weekly" }).kind).toBe("weekly");
    });

    it("rejects unknown kinds and non-numeric limits", () => {
      expect(ReviewListQuerySchema.safeParse({ kind: "yearly" }).success).toBe(false);
      expect(ReviewListQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
    });
  });

  describe("enum vocabularies", () => {
    it("match the frozen contract exactly", () => {
      expect(ReviewKindSchema.options).toEqual(["daily", "weekly"]);
      expect(ReviewStatusSchema.options).toEqual(["in_progress", "completed", "skipped"]);
    });
  });
});
