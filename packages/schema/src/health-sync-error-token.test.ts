import { describe, expect, it } from "vitest";
import { sanitizeHealthSyncErrorToken } from "./health-metrics.js";

describe("sanitizeHealthSyncErrorToken", () => {
  it("passes through the classification tokens the sync engine actually writes", () => {
    for (const token of [
      "scope_not_granted",
      "auth_permanent",
      "oauth_invalid_grant",
      "value_shape_violation",
      "provider_error:503",
      "client_request_defect:INVALID_ARGUMENT",
    ]) {
      expect(sanitizeHealthSyncErrorToken(token)).toBe(token);
    }
  });

  it("collapses prose, which is what a message always is", () => {
    expect(sanitizeHealthSyncErrorToken("Token has been expired or revoked.")).toBe(
      "provider_error",
    );
    expect(
      sanitizeHealthSyncErrorToken("Failing row contains (1, call the insurance guy, ...)."),
    ).toBe("provider_error");
  });

  it("keeps absent distinct from unclassifiable", () => {
    expect(sanitizeHealthSyncErrorToken(null)).toBeNull();
    expect(sanitizeHealthSyncErrorToken("")).toBeNull();
  });

  it("rejects a token long enough to smuggle a sentence", () => {
    expect(sanitizeHealthSyncErrorToken("a".repeat(200))).toBe("provider_error");
  });
});
