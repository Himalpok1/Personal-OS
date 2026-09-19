import { AGENT_DISCLOSURE_TEXT } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { AGENTS_TRUST_LINE } from "@/components/agents/trust-line";

// Checkpoint 10.9 (ADR-081 §9): "agents can only read what you allow and can
// only propose" is a structural guarantee -- every read tool sits behind a
// grant and a trust level in the gateway, and there is no agent approve
// route. This file pins the client side of the same promise:
//
//   1. the trust line the owner reads is byte-exact (rewording it is a
//      decision about the guarantee, not copy), the two surfaces that carry
//      it import the constant rather than restating it, and it never
//      restates the Action Center's own line;
//   2. the disclosure the owner registers under is the schema's own sentence,
//      imported by the registration screen and never restated anywhere in
//      the client, so the sentence agreed to is the sentence in the code.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(["../app/**/*.{ts,tsx}", "../components/**/*.{ts,tsx}", "../queries/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

describe("the agents trust line", () => {
  it("is byte-exact", () => {
    expect(AGENTS_TRUST_LINE).toBe(
      "Agents can only read what you allow and can only propose. You approve every action.",
    );
  });

  it("does not restate the Action Center's line (that pin forbids it outside the action files)", () => {
    expect(AGENTS_TRUST_LINE).not.toContain("Nothing runs until you approve it");
  });

  it("is shown by the Agent Center hero and the settings card, through the constant", () => {
    for (const path of [
      "../app/agents/index.tsx",
      "../components/agents/agents-settings-card.tsx",
    ]) {
      const body = stripComments(SOURCES[path]!);
      expect(body, path).toMatch(
        /import \{ AGENTS_TRUST_LINE \} from "(\.\/|@\/components\/agents\/)trust-line"/,
      );
      expect(body, path).toMatch(/\{AGENTS_TRUST_LINE\}/);
    }
  });

  it("is never restated as a literal anywhere else", () => {
    const offenders = nonTest
      .filter(([path]) => path !== "../components/agents/trust-line.ts")
      .filter(([, body]) => body.includes("Agents can only read what you allow"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("the registration disclosure", () => {
  it("is the schema's sentence and names the four guarantees", () => {
    expect(AGENT_DISCLOSURE_TEXT).toMatch(/^An agent with this token can read only what/);
    expect(AGENT_DISCLOSURE_TEXT).toContain("approve in the Action Center");
    expect(AGENT_DISCLOSURE_TEXT).toContain("never run an action");
    expect(AGENT_DISCLOSURE_TEXT).toContain("memories, health or mail");
    expect(AGENT_DISCLOSURE_TEXT).toContain("Revoke it here at any time");
  });

  it("is imported from @personal-os/schema by app/agents/new.tsx and rendered through the constant", () => {
    const body = stripComments(SOURCES["../app/agents/new.tsx"]!);
    expect(body).toMatch(/AGENT_DISCLOSURE_TEXT[\s\S]*?from "@personal-os\/schema"/);
    expect(body).toMatch(/\{AGENT_DISCLOSURE_TEXT\}/);
  });

  it("is never restated as a literal anywhere under apps/mobile/src", () => {
    const fragment = "An agent with this token can read only";
    const offenders = nonTest.filter(([, body]) => body.includes(fragment)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
