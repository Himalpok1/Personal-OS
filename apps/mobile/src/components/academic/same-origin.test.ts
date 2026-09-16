import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./same-origin";

// The semantics Checkpoint 10.1 verified LIVE in the browser for the retired
// upcoming-assignments card (a row pointed at evil.example.com rendered inert
// with no link role) are pinned here so the move to a shared helper cannot
// loosen them.

const BASE = "https://uta.instructure.com";

describe("isSameOrigin", () => {
  it("accepts a link on exactly the connection's own origin", () => {
    expect(isSameOrigin(`${BASE}/courses/1/assignments/2`, BASE)).toBe(true);
    // A base URL with a path or trailing slash still compares by origin only.
    expect(isSameOrigin(`${BASE}/courses/1`, `${BASE}/`)).toBe(true);
    expect(isSameOrigin(`${BASE}/courses/1`, `${BASE}/some/prefix`)).toBe(true);
  });

  it("rejects a different host, even a lookalike or a subdomain", () => {
    expect(isSameOrigin("https://evil.example.com/courses/1", BASE)).toBe(false);
    expect(isSameOrigin("https://uta.instructure.com.evil.example/x", BASE)).toBe(false);
    expect(isSameOrigin("https://files.uta.instructure.com/x", BASE)).toBe(false);
  });

  it("rejects a scheme or port change on the same host", () => {
    expect(isSameOrigin("http://uta.instructure.com/courses/1", BASE)).toBe(false);
    expect(isSameOrigin("https://uta.instructure.com:8443/courses/1", BASE)).toBe(false);
  });

  it("rejects userinfo tricks that would read as the right host", () => {
    expect(isSameOrigin("https://uta.instructure.com@evil.example.com/x", BASE)).toBe(false);
  });

  it("fails CLOSED on a missing or malformed link, never throws", () => {
    expect(isSameOrigin(null, BASE)).toBe(false);
    expect(isSameOrigin("", BASE)).toBe(false);
    expect(isSameOrigin("not a url", BASE)).toBe(false);
    expect(isSameOrigin("/courses/1/assignments/2", BASE)).toBe(false);
    expect(isSameOrigin("javascript:alert(1)", BASE)).toBe(false);
  });

  it("fails CLOSED on a malformed base URL too", () => {
    expect(isSameOrigin(`${BASE}/courses/1`, "")).toBe(false);
    expect(isSameOrigin(`${BASE}/courses/1`, "uta.instructure.com")).toBe(false);
  });
});
