import { describe, expect, it } from "vitest";
import { isSameOrigin, validateCalDavUrl } from "./ssrf.js";

describe("CalDAV SSRF & Security Validation", () => {
  it("allows valid HTTPS URLs", () => {
    const url = validateCalDavUrl("https://caldav.fastmail.com/dav/");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("caldav.fastmail.com");
  });

  it("allows HTTP loopback in test mode", () => {
    const url = validateCalDavUrl("http://localhost:5232/dav/");
    expect(url.hostname).toBe("localhost");

    const urlIp = validateCalDavUrl("http://127.0.0.1:5232/dav/");
    expect(urlIp.hostname).toBe("127.0.0.1");
  });

  it("blocks non-loopback HTTP URLs", () => {
    expect(() => validateCalDavUrl("http://insecure-server.com/dav/")).toThrow(
      /Insecure protocol/i,
    );
  });

  it("blocks cloud metadata IP 169.254.169.254", () => {
    expect(() => validateCalDavUrl("https://169.254.169.254/latest/meta-data/")).toThrow(
      /cloud metadata IP/i,
    );
  });

  it("blocks link-local IP ranges", () => {
    expect(() => validateCalDavUrl("https://169.254.1.1/dav/")).toThrow(/link-local/i);
  });

  it("blocks 0.0.0.0 and broadcast", () => {
    expect(() => validateCalDavUrl("https://0.0.0.0/dav/")).toThrow(/invalid host IP/i);
    expect(() => validateCalDavUrl("https://255.255.255.255/dav/")).toThrow(/invalid host IP/i);
  });

  it("identifies same origin vs cross origin for Authorization stripping", () => {
    const u1 = new URL("https://caldav.example.com/dav/home/");
    const u2 = new URL("https://caldav.example.com/dav/calendars/");
    const u3 = new URL("https://evil-redirect.com/steal/");
    const u4 = new URL("http://caldav.example.com/dav/home/");

    expect(isSameOrigin(u1, u2)).toBe(true);
    expect(isSameOrigin(u1, u3)).toBe(false);
    expect(isSameOrigin(u1, u4)).toBe(false);
  });
});
