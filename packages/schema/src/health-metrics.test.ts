import { describe, expect, it } from "vitest";
import {
  ConnectGoogleHealthRequestSchema,
  HealthAuthorizeUrlQuerySchema,
  HealthBackfillRequestSchema,
  HealthConnectionSchema,
  HealthMetricsQuerySchema,
  HealthStreamUpdateSchema,
  HealthSummaryQuerySchema,
  HealthSyncRequestSchema,
} from "./health-metrics.js";

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "google_health",
  health_user_id: "hu-abc",
  legacy_user_id: null,
  granted_scope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  source_family: "users/me/dataSourceFamilies/all-sources",
  status: "active",
  identity_verified_at: null,
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};

describe("HealthConnectionSchema is structurally credential-free", () => {
  it("parses a valid connection", () => {
    expect(HealthConnectionSchema.parse(CONNECTION).health_user_id).toBe("hu-abc");
  });

  // The security property is structural, not a matter of remembering to omit
  // fields at the call site: the shape simply has no key that could carry a
  // secret. Same guarantee ai-provider.ts and calendar-connections.ts rely on.
  it("has no key for any token, ciphertext, iv or auth tag", () => {
    const keys = Object.keys(HealthConnectionSchema.shape);
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "ciphertext",
      "iv",
      "auth_tag",
      "state",
      "client_secret",
    ]) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });

  // The three approved read scopes return no email and no id_token, so an
  // account email is not merely absent -- it is not obtainable. Asserting its
  // absence stops a future change quietly promising one.
  it("exposes no account email", () => {
    const keys = Object.keys(HealthConnectionSchema.shape);
    expect(keys.some((k) => k.includes("email"))).toBe(false);
  });
});

describe("request schemas are strict", () => {
  it("rejects an unknown key on the connect request", () => {
    expect(() =>
      ConnectGoogleHealthRequestSchema.parse({
        auth_code: "code",
        redirect_uri: "https://example.test/cb",
        state: "s",
        extra: true,
      }),
    ).toThrow();
  });

  it("requires state on the connect request", () => {
    expect(() =>
      ConnectGoogleHealthRequestSchema.parse({
        auth_code: "code",
        redirect_uri: "https://example.test/cb",
      }),
    ).toThrow();
  });

  it("rejects a non-URL redirect_uri", () => {
    expect(() => HealthAuthorizeUrlQuerySchema.parse({ redirect_uri: "not-a-url" })).toThrow();
  });

  it("rejects an unknown key on a stream update", () => {
    expect(() =>
      HealthStreamUpdateSchema.parse({ metric: "steps", sync_enabled: true, force: true }),
    ).toThrow();
  });

  it("rejects a non-date backfill target", () => {
    expect(() => HealthBackfillRequestSchema.parse({ target_date: "2026-08" })).toThrow();
  });

  it("defaults a sync request to the authoritative warm kind", () => {
    expect(HealthSyncRequestSchema.parse({}).kind).toBe("warm");
  });

  it("does not accept backfill as an on-demand sync kind", () => {
    // Backfill has its own endpoint, its own queue and its own cursor; letting
    // it be requested here would bypass all three.
    expect(() => HealthSyncRequestSchema.parse({ kind: "backfill" })).toThrow();
  });
});

describe("range and timezone validation", () => {
  it("rejects an inverted range", () => {
    expect(() =>
      HealthMetricsQuerySchema.parse({ metric: "steps", from: "2026-08-24", to: "2026-08-20" }),
    ).toThrow();
  });

  it("rejects an empty range", () => {
    expect(() =>
      HealthMetricsQuerySchema.parse({ metric: "steps", from: "2026-08-24", to: "2026-08-24" }),
    ).toThrow();
  });

  it("accepts a valid range and defaults include_empty to true", () => {
    const q = HealthMetricsQuerySchema.parse({
      metric: "steps",
      from: "2026-08-20",
      to: "2026-08-24",
    });
    expect(q.include_empty).toBe(true);
  });

  // booleanQueryParam, not z.coerce.boolean() -- Boolean("false") is true, the
  // bug that silently inverted include_archived API-wide in Phase 2.
  it("honours an explicit include_empty=false", () => {
    const q = HealthMetricsQuerySchema.parse({
      metric: "steps",
      from: "2026-08-20",
      to: "2026-08-24",
      include_empty: "false",
    });
    expect(q.include_empty).toBe(false);
  });

  it("rejects an unknown IANA timezone", () => {
    expect(() => HealthSummaryQuerySchema.parse({ tz: "Mars/Olympus" })).toThrow();
    expect(HealthSummaryQuerySchema.parse({ tz: "Pacific/Kiritimati" }).tz).toBe(
      "Pacific/Kiritimati",
    );
  });
});
