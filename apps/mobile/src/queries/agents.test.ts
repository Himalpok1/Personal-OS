import { describe, expect, it, vi } from "vitest";
import { agentKeys, coerceAgentIdParam } from "./agents";

// The hooks reach the device-identity provider (SecureStore-backed) and the
// api client; neither is exercised here, so both are stubbed at import.
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));
vi.mock("./client", () => ({ api: {} }));

describe("coerceAgentIdParam", () => {
  it("accepts a uuid and rejects anything else, so a stale deep link never reaches the API", () => {
    expect(coerceAgentIdParam("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(coerceAgentIdParam("not-a-uuid")).toBeNull();
    expect(coerceAgentIdParam(undefined)).toBeNull();
    expect(coerceAgentIdParam(["a", "b"])).toBeNull();
  });
});

describe("agentKeys", () => {
  it("every key shares the domain prefix so one invalidate covers it", () => {
    expect(agentKeys.list()[0]).toBe("agents");
    expect(agentKeys.detail("x")[0]).toBe("agents");
    expect(agentKeys.activity("x", { limit: 30 })).toEqual([
      "agents",
      "activity",
      "x",
      { limit: 30 },
    ]);
    expect(agentKeys.permissions()).toEqual(["agents", "permissions"]);
  });
});
