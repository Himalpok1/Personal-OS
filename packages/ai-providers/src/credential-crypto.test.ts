import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./credential-crypto.js";

const KEY = randomBytes(32).toString("base64");

describe("credential-crypto", () => {
  it("round-trips a plaintext secret", () => {
    const encrypted = encryptSecret("sk-super-secret-key", KEY);
    expect(decryptSecret(encrypted, KEY)).toBe("sk-super-secret-key");
  });

  it("produces ciphertext that does not contain the plaintext", () => {
    const encrypted = encryptSecret("sk-super-secret-key", KEY);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("sk-super-secret-key");
  });

  it("uses a fresh IV per call", () => {
    const a = encryptSecret("same-plaintext", KEY);
    const b = encryptSecret("same-plaintext", KEY);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails to decrypt with a corrupted auth tag rather than returning garbage", () => {
    const encrypted = encryptSecret("sk-super-secret-key", KEY);
    encrypted.authTag[0] = (encrypted.authTag[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it("fails to decrypt with a corrupted ciphertext rather than returning garbage", () => {
    const encrypted = encryptSecret("sk-super-secret-key", KEY);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret(encrypted, KEY)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptSecret("sk-super-secret-key", KEY);
    const wrongKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it("rejects a key that isn't 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.from("too-short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
