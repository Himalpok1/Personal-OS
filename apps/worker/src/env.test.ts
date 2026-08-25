import { describe, expect, it } from "vitest";
import { z } from "zod";

// Regression for the Checkpoint 6.3 audit finding.
//
// docker-compose passes the optional Google Health credentials as
// `${GOOGLE_HEALTH_OAUTH_CLIENT_ID:-}`, which renders an EMPTY STRING rather
// than omitting the key. `z.string().min(1).optional()` tolerates `undefined`
// but THROWS on "" -- and because both env schemas are parsed at module load,
// that killed api and worker at import on any host without Health credentials,
// which is production today.
//
// This test deliberately restates the shape rather than importing `env`:
// importing it would parse the real process environment, which in this
// workspace has the variables set, so the regression would be unreachable.

function optionalNonEmpty() {
  return z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
}

describe("optional env vars fed by docker-compose's ${VAR:-}", () => {
  it("the naive shape rejects an empty string -- the bug this guards", () => {
    expect(() => z.string().min(1).optional().parse("")).toThrow();
  });

  it("treats an empty string exactly like an absent variable", () => {
    expect(optionalNonEmpty().parse("")).toBeUndefined();
    expect(optionalNonEmpty().parse(undefined)).toBeUndefined();
  });

  it("still accepts a real value", () => {
    expect(optionalNonEmpty().parse("client-id")).toBe("client-id");
  });

  it("still rejects a non-string", () => {
    expect(() => optionalNonEmpty().parse(42)).toThrow();
  });

  it("an object with the empty-string keys parses, so the process can boot", () => {
    const schema = z.object({
      GOOGLE_HEALTH_OAUTH_CLIENT_ID: optionalNonEmpty(),
      GOOGLE_HEALTH_OAUTH_CLIENT_SECRET: optionalNonEmpty(),
    });
    expect(
      schema.parse({
        GOOGLE_HEALTH_OAUTH_CLIENT_ID: "",
        GOOGLE_HEALTH_OAUTH_CLIENT_SECRET: "",
      }),
    ).toEqual({});
  });
});
