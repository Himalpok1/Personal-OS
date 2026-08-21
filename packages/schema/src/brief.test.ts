import { describe, expect, it } from "vitest";
import { BriefContentSchema, BriefRequestSchema, DailyBriefRecordSchema } from "./brief.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-08-21T09:00:00Z";

describe("Brief schemas", () => {
  describe("BriefRequestSchema", () => {
    it("accepts a valid timezone", () => {
      expect(BriefRequestSchema.safeParse({ tz: "America/Chicago" }).success).toBe(true);
    });

    it("rejects an invalid timezone", () => {
      expect(BriefRequestSchema.safeParse({ tz: "Mars/Olympus" }).success).toBe(false);
    });

    it("rejects extra keys (strict)", () => {
      expect(BriefRequestSchema.safeParse({ tz: "UTC", brief_date: "2026-08-21" }).success).toBe(
        false,
      );
    });
  });

  describe("BriefContentSchema", () => {
    it("requires text and passes through additional LLM fields", () => {
      const result = BriefContentSchema.safeParse({
        text: "Good morning.",
        highlights: ["Dentist at 3pm"],
        provider_meta: { tokens: 512 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.text).toBe("Good morning.");
        expect((result.data as Record<string, unknown>)["highlights"]).toEqual(["Dentist at 3pm"]);
      }
    });

    it("rejects missing or non-string text", () => {
      expect(BriefContentSchema.safeParse({}).success).toBe(false);
      expect(BriefContentSchema.safeParse({ text: 7 }).success).toBe(false);
    });
  });

  describe("DailyBriefRecordSchema", () => {
    it("accepts a persisted record with nullable model_id", () => {
      const result = DailyBriefRecordSchema.safeParse({
        id: UUID,
        brief_date: "2026-08-21",
        timezone: "America/Chicago",
        content: { text: "Two overdue tasks.", sections: {} },
        model_id: null,
        generated_at: NOW,
      });
      expect(result.success).toBe(true);
    });

    it("rejects malformed uuids, dates, and naive timestamps", () => {
      const base = {
        id: UUID,
        brief_date: "2026-08-21",
        timezone: "UTC",
        content: { text: "x" },
        model_id: null,
        generated_at: NOW,
      };
      expect(DailyBriefRecordSchema.safeParse({ ...base, id: "not-a-uuid" }).success).toBe(false);
      expect(DailyBriefRecordSchema.safeParse({ ...base, model_id: "not-a-uuid" }).success).toBe(
        false,
      );
      expect(DailyBriefRecordSchema.safeParse({ ...base, brief_date: "08/21/2026" }).success).toBe(
        false,
      );
      expect(
        DailyBriefRecordSchema.safeParse({ ...base, generated_at: NOW.slice(0, -1) }).success,
      ).toBe(false);
    });

    it("rejects content without a text field", () => {
      expect(
        DailyBriefRecordSchema.safeParse({
          id: UUID,
          brief_date: "2026-08-21",
          timezone: "UTC",
          content: { sections: {} },
          model_id: null,
          generated_at: NOW,
        }).success,
      ).toBe(false);
    });
  });
});
