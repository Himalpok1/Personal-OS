import { describe, expect, it } from "vitest";

// The action surfaces never leave the app (Checkpoint 10.8, ADR-078 §8).
//
// An action request is Personal OS's own row; there is no provider URL
// behind it and nothing on these screens should ever open one. The one
// `Linking.openURL` allowlist in apps/worker's inert-rendering guard must
// not grow for them. Read from source, as memory-no-linking.test.ts does,
// because the screens are hooked route modules that cannot be rendered
// under vitest.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(
  [
    "../components/actions/**/*.{ts,tsx}",
    "../app/actions/**/*.{ts,tsx}",
    "../components/today/actions-needs-approval-card.tsx",
    "../queries/actions.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

describe("action surfaces open no URL", () => {
  const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

  it("scans the two screens, the sheet, the rows, the cards and the queries", () => {
    const paths = nonTest.map(([path]) => path);
    for (const expected of [
      "../app/actions/index.tsx",
      "../app/actions/[id].tsx",
      "../components/actions/action-approval-sheet.tsx",
      "../components/actions/action-request-row.tsx",
      "../components/actions/permission-card.tsx",
      "../components/actions/actions-settings-card.tsx",
      "../components/today/actions-needs-approval-card.tsx",
      "../queries/actions.ts",
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
