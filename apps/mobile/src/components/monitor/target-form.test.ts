import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import {
  describeMonitorTargetMutationFailure,
  isHttpsUrl,
  monitorTargetFormFieldsToPayload,
  onlyDigits,
  parseOptionalPositiveInt,
  type MonitorTargetFormFields,
} from "./target-form";

const BASE_FIELDS: MonitorTargetFormFields = {
  kind: "http",
  url: "",
  expectedStatus: "",
  expectHealthyPayload: false,
  timeoutMs: "",
  intervalSeconds: "",
  failureThreshold: "",
  recoveryThreshold: "",
  tlsWarnDays: "",
  heartbeatMaxAgeSeconds: "",
};

describe("onlyDigits", () => {
  it("strips non-digit characters", () => {
    expect(onlyDigits("12a3")).toBe("123");
    expect(onlyDigits("-5")).toBe("5");
    expect(onlyDigits("")).toBe("");
    expect(onlyDigits("  10 ")).toBe("10");
  });
});

describe("parseOptionalPositiveInt", () => {
  it("is undefined for blank or whitespace-only input -- never 0", () => {
    expect(parseOptionalPositiveInt("")).toBeUndefined();
    expect(parseOptionalPositiveInt("   ")).toBeUndefined();
  });

  it("parses a positive integer, trimming surrounding whitespace", () => {
    expect(parseOptionalPositiveInt("10")).toBe(10);
    expect(parseOptionalPositiveInt("  12 ")).toBe(12);
    expect(parseOptionalPositiveInt("007")).toBe(7);
  });

  it("rejects zero and negative values rather than sending an invalid number", () => {
    expect(parseOptionalPositiveInt("0")).toBeUndefined();
    expect(parseOptionalPositiveInt("-5")).toBeUndefined();
  });

  it("rejects non-numeric input", () => {
    expect(parseOptionalPositiveInt("abc")).toBeUndefined();
  });
});

describe("isHttpsUrl", () => {
  it("is true for an https url, case-insensitively and trimmed", () => {
    expect(isHttpsUrl("https://example.com")).toBe(true);
    expect(isHttpsUrl("HTTPS://example.com")).toBe(true);
    expect(isHttpsUrl("  https://example.com")).toBe(true);
  });

  it("is false for http, an empty string, or garbage", () => {
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});

describe("monitorTargetFormFieldsToPayload", () => {
  it("includes http-only fields for an http target", () => {
    const payload = monitorTargetFormFieldsToPayload({
      ...BASE_FIELDS,
      kind: "http",
      url: "https://example.com/health",
      expectedStatus: "200",
      expectHealthyPayload: true,
    });
    expect(payload.url).toBe("https://example.com/health");
    expect(payload.expected_status).toBe(200);
    expect(payload.expect_healthy_payload).toBe(true);
    // Never present for an http target.
    expect(payload).not.toHaveProperty("heartbeat_max_age_seconds");
  });

  it("includes tls_warn_days only when the url is https", () => {
    const overHttps = monitorTargetFormFieldsToPayload({
      ...BASE_FIELDS,
      kind: "http",
      url: "https://example.com",
      tlsWarnDays: "14",
    });
    expect(overHttps.tls_warn_days).toBe(14);

    const overPlainHttp = monitorTargetFormFieldsToPayload({
      ...BASE_FIELDS,
      kind: "http",
      url: "http://example.com",
      tlsWarnDays: "14",
    });
    expect(overPlainHttp).not.toHaveProperty("tls_warn_days");
  });

  it("omits every http-only field for a worker_heartbeat target, and includes heartbeat_max_age_seconds instead", () => {
    const payload = monitorTargetFormFieldsToPayload({
      ...BASE_FIELDS,
      kind: "worker_heartbeat",
      url: "https://example.com", // should never leak through for this kind
      expectedStatus: "200",
      expectHealthyPayload: true,
      heartbeatMaxAgeSeconds: "300",
    });
    expect(payload).not.toHaveProperty("url");
    expect(payload).not.toHaveProperty("expected_status");
    expect(payload).not.toHaveProperty("expect_healthy_payload");
    expect(payload).not.toHaveProperty("tls_warn_days");
    expect(payload.heartbeat_max_age_seconds).toBe(300);
  });

  it("omits a blank numeric field rather than sending 0 or NaN", () => {
    const payload = monitorTargetFormFieldsToPayload(BASE_FIELDS);
    expect(payload).not.toHaveProperty("timeout_ms");
    expect(payload).not.toHaveProperty("interval_seconds");
    expect(payload).not.toHaveProperty("failure_threshold");
    expect(payload).not.toHaveProperty("recovery_threshold");
    expect(payload).not.toHaveProperty("expected_status");
  });

  it("includes the shared thresholds/timing fields regardless of kind", () => {
    const payload = monitorTargetFormFieldsToPayload({
      ...BASE_FIELDS,
      kind: "worker_heartbeat",
      timeoutMs: "10000",
      intervalSeconds: "300",
      failureThreshold: "3",
      recoveryThreshold: "2",
    });
    expect(payload.timeout_ms).toBe(10000);
    expect(payload.interval_seconds).toBe(300);
    expect(payload.failure_threshold).toBe(3);
    expect(payload.recovery_threshold).toBe(2);
  });
});

describe("describeMonitorTargetMutationFailure", () => {
  it("gives specific, actionable copy for the two resolvable business-rule refusals", () => {
    expect(describeMonitorTargetMutationFailure(new ApiClientError(409, "name_already_exists"))).toBe(
      "A monitor with that name already exists.",
    );
    expect(
      describeMonitorTargetMutationFailure(new ApiClientError(409, "target_has_active_incident")),
    ).toBe("Can't change the target/type while an incident is open on it.");
  });

  it("gives generic-but-distinct copy for validation and not-found", () => {
    expect(describeMonitorTargetMutationFailure(new ApiClientError(400, "validation_failed"))).toBe(
      "That configuration wasn't valid.",
    );
    expect(describeMonitorTargetMutationFailure(new ApiClientError(404, "not_found"))).toBe(
      "This monitor target couldn't be found.",
    );
  });

  it("falls back to a generic message for an unrecognized code or a non-ApiClientError", () => {
    expect(describeMonitorTargetMutationFailure(new ApiClientError(500, "something_else"))).toBe(
      "Couldn't save that monitor target.",
    );
    expect(describeMonitorTargetMutationFailure(new Error("network down"))).toBe(
      "Couldn't save that monitor target.",
    );
    expect(describeMonitorTargetMutationFailure("not even an error")).toBe(
      "Couldn't save that monitor target.",
    );
  });
});
