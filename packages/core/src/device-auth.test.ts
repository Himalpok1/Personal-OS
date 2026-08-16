import { describe, expect, it } from "vitest";
import {
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  hashPairingCode,
} from "./device-auth.js";

describe("device tokens", () => {
  it("generates a URL-safe token with no collisions across a large sample", () => {
    const tokens = new Set(Array.from({ length: 10_000 }, () => generateDeviceToken()));
    expect(tokens.size).toBe(10_000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("hashes deterministically", () => {
    const token = generateDeviceToken();
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashDeviceToken(generateDeviceToken())).not.toBe(hashDeviceToken(generateDeviceToken()));
  });

  it("hash is a 64-char lowercase hex string (sha256)", () => {
    expect(hashDeviceToken(generateDeviceToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("pairing codes", () => {
  it("formats as XXXX-XXXX using only the unambiguous alphabet", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/);
  });

  it("generates codes with no collisions across a large sample", () => {
    const codes = new Set(Array.from({ length: 10_000 }, () => generatePairingCode()));
    expect(codes.size).toBe(10_000);
  });

  it("hashes deterministically", () => {
    const code = generatePairingCode();
    expect(hashPairingCode(code)).toBe(hashPairingCode(code));
  });

  it("is case- and hyphen-insensitive", () => {
    const code = generatePairingCode();
    const lower = code.toLowerCase();
    const noHyphen = code.replace("-", "");
    expect(hashPairingCode(code)).toBe(hashPairingCode(lower));
    expect(hashPairingCode(code)).toBe(hashPairingCode(noHyphen));
  });
});
