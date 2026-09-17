import { describe, expect, it } from "vitest";

// The memory surfaces never leave the app (Checkpoint 10.7, ADR-077).
//
// A memory is the owner's own sentence; there is no provider URL behind it
// and nothing on these screens should ever open one. The export pointer on
// the Memory Center is deliberately TEXT (selectable), not a link -- the
// export is a browser action on the tailnet, and a tap here would need the
// one `Linking.openURL` allowlist in apps/worker's inert-rendering guard to
// grow. Read from source, as academic-open-url.test.ts does, because the
// screens are hooked route modules that cannot be rendered under vitest.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(["../components/memory/**/*.{ts,tsx}", "../app/memory/**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

describe("memory surfaces open no URL", () => {
  const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

  it("scans the three screens, the row, the form, the settings card and the sheet", () => {
    const paths = nonTest.map(([path]) => path);
    for (const expected of [
      "../app/memory/index.tsx",
      "../app/memory/new.tsx",
      "../app/memory/[id].tsx",
      "../components/memory/memory-row.tsx",
      "../components/memory/memory-form.tsx",
      "../components/memory/memory-settings-card.tsx",
      "../components/memory/memory-suggestion-sheet.tsx",
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

  it("the export pointer is selectable text, not a pressable", () => {
    const body = stripComments(SOURCES["../app/memory/index.tsx"]!);
    const marker = body.indexOf('testID="memory-export-url"');
    expect(marker).toBeGreaterThan(-1);
    const element = body.slice(body.lastIndexOf("<AppText", marker), marker);
    expect(element).toContain("selectable");
    expect(element).not.toContain("onPress");
  });
});
