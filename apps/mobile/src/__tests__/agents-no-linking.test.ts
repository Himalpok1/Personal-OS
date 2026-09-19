import { describe, expect, it } from "vitest";

// The agent surfaces never leave the app (Checkpoint 10.9, ADR-081 §9).
//
// An agent is Personal OS's own row; there is no provider URL behind it and
// nothing on these screens should ever open one -- least of all the token,
// which is shown once as text and handed over by the owner. The one
// `Linking.openURL` allowlist in apps/worker's inert-rendering guard must
// not grow for them. Read from source, as actions-no-linking.test.ts does,
// because the screens are hooked route modules that cannot be rendered
// under vitest.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(
  [
    "../components/agents/**/*.{ts,tsx}",
    "../app/agents/**/*.{ts,tsx}",
    "../queries/agents.ts",
    "../queries/device-token.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

describe("agent surfaces open no URL", () => {
  const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

  it("scans the three screens, the cards, the state module and the queries", () => {
    const paths = nonTest.map(([path]) => path);
    for (const expected of [
      "../app/agents/index.tsx",
      "../app/agents/new.tsx",
      "../app/agents/[id].tsx",
      "../components/agents/agents-state.ts",
      "../components/agents/agent-permission-card.tsx",
      "../components/agents/agents-settings-card.tsx",
      "../queries/agents.ts",
      "../queries/device-token.ts",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("imports Linking nowhere", () => {
    const offenders = nonTest
      .filter(([, body]) => /\bLinking\b/.test(stripComments(body)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("calls openURL nowhere, and never renders an <a>", () => {
    const offenders = nonTest
      .filter(([, body]) => /openURL|<a\b|href=/.test(stripComments(body)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("never confirms through Alert.alert (confirmDestructive is the one wrapper)", () => {
    const offenders = nonTest
      .filter(([, body]) => /Alert\.alert/.test(stripComments(body)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
