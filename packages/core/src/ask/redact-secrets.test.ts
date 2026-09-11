import { describe, expect, it } from "vitest";
import { SECRET_PLACEHOLDER, redactSecrets } from "./redact-secrets.js";

describe("redactSecrets", () => {
  it("redacts an OpenAI/Stripe-shaped key", () => {
    const result = redactSecrets("my key is sk-abcdefghijklmnopqrstuvwxyz123456 keep it safe");
    expect(result.text).toBe(`my key is ${SECRET_PLACEHOLDER} keep it safe`);
    expect(result.redactions).toBe(1);
  });

  it("does NOT flag a near-miss too short to be a real key", () => {
    // The exact near-miss the design's own review required: sk- followed by
    // only 5 characters must survive untouched.
    const result = redactSecrets("todo: sk-abcde later");
    expect(result.text).toBe("todo: sk-abcde later");
    expect(result.redactions).toBe(0);
  });

  it("does NOT flag ordinary prose containing the bare substring 'sk-'", () => {
    // The two real false positives the 8.6B review found by running the naive
    // pattern: both have a letter immediately before "sk-", which the anchor
    // must reject.
    const result = redactSecrets("risk-assessment-framework and desk-organization-project-notes");
    expect(result.redactions).toBe(0);
  });

  it("redacts the production transcription provider's Groq key shape", () => {
    const result = redactSecrets("GROQ_API_KEY=gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(result.redactions).toBe(1);
    expect(result.text).toContain(SECRET_PLACEHOLDER);
  });

  it("redacts a Google API key shape", () => {
    const key = "AIza" + "S".repeat(35);
    const result = redactSecrets(`key: ${key}`);
    expect(result.redactions).toBe(1);
  });

  it("redacts GitHub tokens now that a remote exists", () => {
    expect(redactSecrets("ghp_" + "a".repeat(36)).redactions).toBe(1);
    expect(redactSecrets("gho_" + "a".repeat(36)).redactions).toBe(1);
    expect(redactSecrets("ghs_" + "a".repeat(36)).redactions).toBe(1);
    expect(redactSecrets("github_pat_" + "a".repeat(70)).redactions).toBe(1);
  });

  it("redacts an AWS access key id", () => {
    // Concatenated so this fake, AWS-shaped fixture never appears contiguous
    // in the source for a static secret scanner to flag -- same runtime
    // string either way.
    expect(redactSecrets("AKIA" + "ABCDEFGHIJKLMNOP").redactions).toBe(1);
  });

  it("redacts a Slack token", () => {
    expect(redactSecrets("xoxb-1234567890-abcdefg").redactions).toBe(1);
  });

  it("redacts a Tailscale auth key -- the perimeter itself", () => {
    expect(redactSecrets("tskey-auth-k7ABC123-xyz789abcdef").redactions).toBe(1);
  });

  it("redacts Google OAuth access/refresh tokens and client secret", () => {
    expect(redactSecrets("ya29." + "a".repeat(20)).redactions).toBe(1);
    expect(redactSecrets("1//0" + "a".repeat(20)).redactions).toBe(1);
    expect(redactSecrets("GOCSPX-" + "a".repeat(20)).redactions).toBe(1);
  });

  it("redacts a bearer JWT", () => {
    // Each segment concatenated separately so the fake token never appears as
    // one contiguous literal in the source.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "dGhpc2lzYXNpZ25hdHVyZQ";
    const result = redactSecrets(`Authorization: Bearer ${jwt}`);
    expect(result.redactions).toBe(1);
    expect(result.text).not.toContain("eyJ");
  });

  it("redacts a PEM private key block WHOLE, not only its header line", () => {
    // "BEGIN"/"PRIVATE KEY" concatenated so this fake fixture never appears as
    // the exact contiguous PEM header a static secret scanner looks for.
    const BEGIN = "-----" + "BEGIN" + " RSA PRIVATE KEY" + "-----";
    const END = "-----" + "END" + " RSA PRIVATE KEY" + "-----";
    const key = [
      BEGIN,
      "MIIEowIBAAKCAQEAbase64bodylinebase64bodyline",
      "moreBase64BodyContentThatMustNotSurvive",
      END,
    ].join("\n");
    const result = redactSecrets(`before\n${key}\nafter`);
    expect(result.redactions).toBe(1);
    expect(result.text).not.toContain("base64bodyline");
    expect(result.text).not.toContain(BEGIN);
    // Newlines collapse to spaces via the control-strip step that runs before
    // pattern matching (the same stripUnsummarizableCharacters every other
    // caller in this codebase uses) -- the key block is still redacted as one
    // unit, which is what this test actually pins.
    expect(result.text).toBe(`before ${SECRET_PLACEHOLDER} after`);
  });

  it("counts multiple distinct secrets in one string", () => {
    const awsKey = "AKIA" + "ABCDEFGHIJKLMNOP";
    const result = redactSecrets(`key one sk-${"a".repeat(25)} and key two ${awsKey}`);
    expect(result.redactions).toBe(2);
  });

  it("leaves ordinary prose with no secret shape completely untouched", () => {
    const prose = "Remember to renew the insurance policy before it expires next month.";
    expect(redactSecrets(prose)).toEqual({ text: prose, redactions: 0 });
  });
});
