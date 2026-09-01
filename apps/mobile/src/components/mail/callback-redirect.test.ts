import { describe, expect, it } from "vitest";
import { mailCallbackRedirectUri } from "./callback-redirect";

describe("mailCallbackRedirectUri", () => {
  it("builds the development loopback callback", () => {
    expect(mailCallbackRedirectUri("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/mail-connections/gmail/callback",
    );
  });

  it("builds the production tailnet callback", () => {
    expect(mailCallbackRedirectUri("https://personal-os.tail62a68f.ts.net")).toBe(
      "https://personal-os.tail62a68f.ts.net/mail-connections/gmail/callback",
    );
  });

  it("produces ONE string whether or not the base has a trailing slash", () => {
    // The server's allowlist is exact-match with no normalization, so two
    // spellings of the same server would be two different redirects and one of
    // them would be rejected 400.
    expect(mailCallbackRedirectUri("http://127.0.0.1:3000/")).toBe(
      mailCallbackRedirectUri("http://127.0.0.1:3000"),
    );
  });

  it("does not inherit a path from the base URL", () => {
    // The callback is absolute on the origin; a base carrying a path must not
    // produce `/api/mail-connections/...`.
    expect(mailCallbackRedirectUri("https://host.example/api")).toBe(
      "https://host.example/mail-connections/gmail/callback",
    );
  });
});
