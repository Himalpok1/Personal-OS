import { describe, expect, it } from "vitest";
import { generateDeviceToken, hashDeviceToken } from "./device-auth.js";
import {
  AGENT_TOKEN_PREFIX,
  generateAgentToken,
  hashAgentToken,
  looksLikeAgentToken,
} from "./agent-auth.js";

describe("agent tokens (Checkpoint 10.9)", () => {
  it("are prefixed, URL-safe and unique", () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^posa_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeAgentToken(a)).toBe(true);
  });

  it("hash deterministically to sha256 hex and never to the token itself", () => {
    const token = generateAgentToken();
    const hash = hashAgentToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashAgentToken(`${token}x`)).not.toBe(hash);
  });

  it("a device token is not an agent token, and the same secret hashes identically under both helpers", () => {
    const device = generateDeviceToken();
    expect(looksLikeAgentToken(device)).toBe(false);
    expect(looksLikeAgentToken("posa_")).toBe(false);
    expect(looksLikeAgentToken("")).toBe(false);
    // The hash primitive is shared on purpose; it is the TABLE that differs.
    expect(hashAgentToken(device)).toBe(hashDeviceToken(device));
  });
});
