import { describe, expect, it } from "vitest";
import { isValidTimezone } from "./timezone.js";

describe("isValidTimezone", () => {
  it("accepts a real IANA timezone", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
  });

  it("rejects a bogus timezone", () => {
    expect(isValidTimezone("Not/A_Zone")).toBe(false);
  });
});
