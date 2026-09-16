import { describe, expect, it } from "vitest";
import { CanvasUrlBlockedError, isSameOrigin, validateCanvasUrl } from "./ssrf.js";

// Direct port of calendar-providers/src/caldav/ssrf.test.ts's cases onto
// Canvas's near-duplicate module (Checkpoint 10.1's own adversarial review
// finding -- Canvas had no equivalent guard until this file).
describe("Canvas SSRF & cloud-metadata validation", () => {
  it("allows valid HTTPS URLs", () => {
    const url = validateCanvasUrl("https://uta.instructure.com/api/v1/users/self");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("uta.instructure.com");
  });

  it("allows HTTP loopback in test mode", () => {
    const url = validateCanvasUrl("http://localhost:3000/api/v1/users/self");
    expect(url.hostname).toBe("localhost");

    const urlIp = validateCanvasUrl("http://127.0.0.1:3000/api/v1/users/self");
    expect(urlIp.hostname).toBe("127.0.0.1");
  });

  it("blocks non-loopback HTTP URLs", () => {
    expect(() => validateCanvasUrl("http://insecure-canvas.example.com/api/v1/users/self")).toThrow(
      /Insecure protocol/i,
    );
  });

  it("blocks cloud metadata IP 169.254.169.254", () => {
    expect(() => validateCanvasUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /cloud metadata IP/i,
    );
  });

  it("blocks link-local IPv4 ranges", () => {
    expect(() => validateCanvasUrl("https://169.254.1.1/api/v1/users/self")).toThrow(/link-local/i);
  });

  it("blocks IPv6 link-local addresses", () => {
    expect(() => validateCanvasUrl("https://[fe80::1]/api/v1/users/self")).toThrow(/link-local/i);
  });

  it("blocks 0.0.0.0 and broadcast", () => {
    expect(() => validateCanvasUrl("https://0.0.0.0/api/v1/users/self")).toThrow(
      /invalid host IP/i,
    );
    expect(() => validateCanvasUrl("https://255.255.255.255/api/v1/users/self")).toThrow(
      /invalid host IP/i,
    );
  });

  it("blocks a malformed URL rather than throwing an unrelated error", () => {
    expect(() => validateCanvasUrl("not a url")).toThrow(CanvasUrlBlockedError);
  });

  it("blocks an unsupported protocol", () => {
    expect(() => validateCanvasUrl("ftp://uta.instructure.com/")).toThrow(/Unsupported protocol/i);
  });

  it("every rejection is a CanvasUrlBlockedError, never a generic Error", () => {
    for (const bad of [
      "http://insecure.example.com/",
      "https://169.254.169.254/",
      "https://0.0.0.0/",
      "not a url",
    ]) {
      expect(() => validateCanvasUrl(bad)).toThrow(CanvasUrlBlockedError);
    }
  });

  it("identifies same origin vs cross origin for Authorization stripping", () => {
    const u1 = new URL("https://uta.instructure.com/api/v1/users/self");
    const u2 = new URL("https://uta.instructure.com/api/v1/courses");
    const u3 = new URL("https://evil-redirect.example.com/steal/");
    const u4 = new URL("http://uta.instructure.com/api/v1/users/self");

    expect(isSameOrigin(u1, u2)).toBe(true);
    expect(isSameOrigin(u1, u3)).toBe(false);
    expect(isSameOrigin(u1, u4)).toBe(false);
  });
});
