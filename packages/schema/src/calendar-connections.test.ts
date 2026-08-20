import { describe, expect, it } from "vitest";
import {
  AvailableGoogleCalendarSchema,
  CalendarConnectionCalendarSchema,
  CalendarConnectionCalendarUpdateSchema,
  CalendarConnectionSchema,
  ConnectGoogleCalendarRequestSchema,
} from "./calendar-connections.js";

describe("Calendar connection schemas", () => {
  describe("CalendarConnectionSchema", () => {
    it("accepts a valid connection response", () => {
      const result = CalendarConnectionSchema.safeParse({
        id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
        provider: "google",
        google_account_email: "user@example.com",
        status: "active",
        granted_scope: "https://www.googleapis.com/auth/calendar",
        last_sync_error: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown provider", () => {
      const result = CalendarConnectionSchema.safeParse({
        id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
        provider: "outlook",
        google_account_email: "user@example.com",
        status: "active",
        granted_scope: "calendar",
        last_sync_error: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unknown status", () => {
      const result = CalendarConnectionSchema.safeParse({
        id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
        provider: "google",
        google_account_email: "user@example.com",
        status: "syncing",
        granted_scope: "calendar",
        last_sync_error: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      });
      expect(result.success).toBe(false);
    });

    it("never exposes token/credential fields even if present on the input object", () => {
      const result = CalendarConnectionSchema.safeParse({
        id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
        provider: "google",
        google_account_email: "user@example.com",
        status: "active",
        granted_scope: "calendar",
        last_sync_error: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
        access_token_ciphertext: "should-not-appear",
        refresh_token_ciphertext: "should-not-appear",
      });
      expect(result.success).toBe(true);
      expect(result.data).not.toHaveProperty("access_token_ciphertext");
      expect(result.data).not.toHaveProperty("refresh_token_ciphertext");
    });
  });

  describe("CalendarConnectionCalendarSchema", () => {
    it("accepts a valid calendar row", () => {
      const result = CalendarConnectionCalendarSchema.safeParse({
        id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
        connection_id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab7",
        google_calendar_id: "primary",
        summary: "My Calendar",
        sync_enabled: true,
        project_id: null,
        last_successful_sync_at: null,
        last_full_sync_at: null,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("CalendarConnectionCalendarUpdateSchema", () => {
    it("accepts a valid toggle request", () => {
      const result = CalendarConnectionCalendarUpdateSchema.safeParse({
        google_calendar_id: "primary",
        sync_enabled: true,
        project_id: "8f14e45f-ceea-467e-adde-cb2ffa8b8ab6",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid request with project_id omitted", () => {
      const result = CalendarConnectionCalendarUpdateSchema.safeParse({
        google_calendar_id: "primary",
        sync_enabled: false,
      });
      expect(result.success).toBe(true);
    });

    it("requires sync_enabled", () => {
      const result = CalendarConnectionCalendarUpdateSchema.safeParse({
        google_calendar_id: "primary",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields (strict)", () => {
      const result = CalendarConnectionCalendarUpdateSchema.safeParse({
        google_calendar_id: "primary",
        sync_enabled: true,
        next_sync_token: "sneaky",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ConnectGoogleCalendarRequestSchema", () => {
    it("accepts a valid auth code", () => {
      const result = ConnectGoogleCalendarRequestSchema.safeParse({ auth_code: "4/0Adeu5B..." });
      expect(result.success).toBe(true);
    });

    it("rejects an empty auth code", () => {
      const result = ConnectGoogleCalendarRequestSchema.safeParse({ auth_code: "" });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields (strict)", () => {
      const result = ConnectGoogleCalendarRequestSchema.safeParse({
        auth_code: "4/0Adeu5B...",
        access_token: "sneaky",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("AvailableGoogleCalendarSchema", () => {
    it("accepts a valid live-listing entry", () => {
      const result = AvailableGoogleCalendarSchema.safeParse({
        google_calendar_id: "primary",
        summary: "My Calendar",
        primary: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a missing summary", () => {
      const result = AvailableGoogleCalendarSchema.safeParse({
        google_calendar_id: "primary",
        primary: true,
      });
      expect(result.success).toBe(false);
    });
  });
});
