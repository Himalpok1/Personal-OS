import { describe, expect, it } from "vitest";
import { booleanQueryParam } from "./pagination.js";

// Regression coverage for a real bug found via a real browser in
// Checkpoint 4.2 (Phase 4): z.coerce.boolean() runs Boolean(value) on the
// raw query string, and Boolean("false") is true -- every
// include_archived/include_revoked query flag silently ignored an explicit
// `?include_archived=false` and behaved as if `true` had been requested.
// See docs/STATUS.md's Checkpoint 4.2 entry.
describe("booleanQueryParam", () => {
  const schema = booleanQueryParam(false);

  it("parses the literal string 'false' as false", () => {
    expect(schema.parse("false")).toBe(false);
  });

  it("parses the literal string 'true' as true", () => {
    expect(schema.parse("true")).toBe(true);
  });

  it("falls back to the default when omitted", () => {
    expect(schema.parse(undefined)).toBe(false);
  });

  it("rejects strings other than the exact supported literals", () => {
    for (const value of ["0", "1", "", "no", "yes", "TRUE", "False", " true "]) {
      expect(() => schema.parse(value)).toThrow();
    }
  });

  it("passes through a real boolean unchanged", () => {
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it("respects a non-false default", () => {
    expect(booleanQueryParam(true).parse(undefined)).toBe(true);
  });

  it("rejects non-string, non-boolean values", () => {
    for (const value of [null, 0, 1, [], {}]) {
      expect(() => schema.parse(value)).toThrow();
    }
  });
});
