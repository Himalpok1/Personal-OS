import { describe, expect, it } from "vitest";
import {
  scrubQueryForUnknownRoute,
  scrubSensitiveQueryParams,
  SENSITIVE_QUERY_PARAMS,
} from "./scrub-url.js";

describe("scrubSensitiveQueryParams", () => {
  // Checkpoint 8.6A. `q` is the /search query string. Not a credential -- it is
  // the owner's own text -- but the request serializer emits `url` on every
  // request, so every search anyone typed was landing in the container log.
  it("destroys a /search query string but keeps the route visible", () => {
    const out = scrubSensitiveQueryParams("/search?q=insurance%20renewal&limit=20");
    expect(out).not.toContain("insurance");
    expect(out).toContain("/search");
    expect(out).toContain("q=");
    expect(out).toContain("limit=20");
  });

  it("redacts q even when it carries a LIKE wildcard", () => {
    expect(scrubSensitiveQueryParams("/search?q=%25%25")).not.toContain("%25%25");
  });

  it("names q as sensitive", () => {
    expect(SENSITIVE_QUERY_PARAMS).toContain("q");
  });

  it("destroys an OAuth authorization code", () => {
    const out = scrubSensitiveQueryParams(
      "/health-connections/google/callback?code=4/0AbCdEfGhIjKlMnOp&state=abc123",
    );
    expect(out).not.toContain("4/0AbCdEfGhIjKlMnOp");
    expect(out).not.toContain("abc123");
    expect(out).toBe("/health-connections/google/callback?code=[redacted]&state=[redacted]");
  });

  // The log must still show that a callback was hit -- only the value dies.
  it("keeps the parameter name and the path", () => {
    const out = scrubSensitiveQueryParams("/health-connections/google/callback?code=secret");
    expect(out).toContain("/health-connections/google/callback");
    expect(out).toContain("code=");
  });

  it("leaves non-sensitive parameters untouched", () => {
    expect(scrubSensitiveQueryParams("/today?tz=America/Chicago")).toBe(
      "/today?tz=America/Chicago",
    );
  });

  it("scrubs only the sensitive parameter in a mixed query", () => {
    const out = scrubSensitiveQueryParams("/x?tz=UTC&code=abc&limit=50");
    expect(out).toBe("/x?tz=UTC&code=[redacted]&limit=50");
  });

  it("passes through a URL with no query string", () => {
    expect(scrubSensitiveQueryParams("/health")).toBe("/health");
    expect(scrubSensitiveQueryParams("/health?")).toBe("/health?");
  });

  // A code containing & or = must not let part of itself survive into the log.
  it("does not leak a value containing separator characters", () => {
    const out = scrubSensitiveQueryParams("/cb?code=a%3Db%26c=d&tz=UTC");
    expect(out).not.toContain("a%3Db");
    expect(out).toContain("tz=UTC");
  });

  it("scrubs a repeated parameter every time it appears", () => {
    const out = scrubSensitiveQueryParams("/cb?code=one&code=two");
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
  });

  it("scrubs a parameter with an empty value without throwing", () => {
    expect(scrubSensitiveQueryParams("/cb?code=")).toBe("/cb?code=[redacted]");
  });

  it("scrubs a valueless parameter", () => {
    expect(scrubSensitiveQueryParams("/cb?code")).toBe("/cb?code=[redacted]");
  });

  // A malformed percent-escape must never throw inside the logger -- that would
  // turn a log line into a 500.
  it("survives a malformed percent-escape in a parameter name", () => {
    expect(() => scrubSensitiveQueryParams("/cb?%E0%A4%A=1&code=secret")).not.toThrow();
    expect(scrubSensitiveQueryParams("/cb?%E0%A4%A=1&code=secret")).not.toContain("secret");
  });

  it("matches a percent-encoded parameter name", () => {
    expect(scrubSensitiveQueryParams("/cb?%63ode=secret")).not.toContain("secret");
  });

  // Checkpoint 9.0 Part B review. find-my-way splits the query on `#` as well
  // as `?` (lib/url-sanitizer.js), so `/search#q=x` is routed to /search AND
  // executed with q=x. A scrubber that only knew `?` treated the whole string
  // as a path and logged the search text verbatim -- bypassing the 8.6A scrub.
  it("scrubs a query introduced by # exactly as one introduced by ?", () => {
    expect(scrubSensitiveQueryParams("/search#q=SECRET&limit=5")).toBe(
      "/search#q=[redacted]&limit=5",
    );
    expect(scrubSensitiveQueryParams("/cb#code=SECRET")).toBe("/cb#code=[redacted]");
  });

  it("takes the earliest delimiter when both ? and # appear", () => {
    // `#` first: everything after it is query, so the later `?x=1` is part of
    // `code`'s VALUE (exactly as the querystring parser sees it) and dies
    // with it.
    expect(scrubSensitiveQueryParams("/cb#code=SECRET?x=1")).toBe("/cb#code=[redacted]");
    // `?` first: the `#` is inside `x`'s VALUE as far as the querystring
    // parser is concerned, so there is no parameter named `code` here and the
    // name-based policy leaves it -- the same way it leaves any other
    // non-sensitive value on a known route.
    expect(scrubSensitiveQueryParams("/cb?x=1#code=v&code=SECRET")).toBe(
      "/cb?x=1#code=v&code=[redacted]",
    );
  });

  // REVERSED AT CHECKPOINT 8.6A. This previously pinned exactly
  // ["access_token", "code", "state"]. `q` (the /search query string) was added
  // because Fastify's request serializer emits `url` on every request, so the
  // owner's own search text was being written to the container log verbatim.
  // The set-equality assertion is kept rather than loosened: it is what makes
  // an accidental ADDITION or REMOVAL fail here instead of silently changing
  // what gets redacted in production.
  it("covers exactly code, state, access_token and q", () => {
    expect([...SENSITIVE_QUERY_PARAMS].sort()).toEqual(["access_token", "code", "q", "state"]);
  });
});

describe("scrubQueryForUnknownRoute", () => {
  // Checkpoint 9.0 Part B. A route that does not exist can carry any parameter
  // name, so the name list above can never enumerate what to hide for it; the
  // whole query goes, and only the path plus a "there was a query" marker stays.
  it("destroys every parameter, including one no list has heard of", () => {
    const out = scrubQueryForUnknownRoute("/does-not-exist?anything=NOVEL&code=SECRET");
    expect(out).not.toContain("NOVEL");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("anything");
    expect(out).toBe("/does-not-exist?[redacted]");
  });

  it("keeps the path so a 404 remains diagnosable", () => {
    expect(scrubQueryForUnknownRoute("/health-connections/google/callbak?code=x")).toBe(
      "/health-connections/google/callbak?[redacted]",
    );
  });

  it("passes a bare path through, and an empty query too", () => {
    expect(scrubQueryForUnknownRoute("/nope")).toBe("/nope");
    expect(scrubQueryForUnknownRoute("/nope?")).toBe("/nope?");
  });

  // A value containing a second `?` must not let anything after it survive.
  it("treats everything after the first ? as query", () => {
    expect(scrubQueryForUnknownRoute("/a?b=c?d=SECRET")).toBe("/a?[redacted]");
  });

  // Same router fact as above: `#` starts the query to find-my-way, so
  // `/nope#code=x` is a 404 on `/nope` carrying `code=x` -- and it must not be
  // logged as if `#code=x` were part of the path.
  it("destroys a query introduced by # and keeps the delimiter as sent", () => {
    expect(scrubQueryForUnknownRoute("/nope#code=SECRET")).toBe("/nope#[redacted]");
    expect(scrubQueryForUnknownRoute("/nope#")).toBe("/nope#");
    expect(scrubQueryForUnknownRoute("/nope#a=1?code=SECRET")).toBe("/nope#[redacted]");
    expect(scrubQueryForUnknownRoute("/nope?a=1#code=SECRET")).toBe("/nope?[redacted]");
  });

  // `;` is a PATH character to the router unless `useSemicolonDelimiter` is
  // on (Fastify default: off, and this API never sets it), so it is kept --
  // the policy is "keep what the router treats as the path", not "hide
  // anything that looks like a parameter".
  it("leaves a ;-separated pseudo-parameter alone, because the router does", () => {
    expect(scrubQueryForUnknownRoute("/nope;code=x")).toBe("/nope;code=x");
  });
});
