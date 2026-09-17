import { describe, expect, it } from "vitest";

// Every academic surface opens a provider URL through ONE component, and that
// component checks the origin first (Checkpoint 10.2, ADR-070).
//
// Checkpoint 10.1 verified live, in the browser, that a Canvas assignment row
// pointed at evil.example.com rendered inert -- no link role, no handler.
// That rule now lives in components/academic/same-origin.ts and is applied by
// components/academic/source-link.tsx. This guard pins the SHAPE that keeps
// it unskippable: the Today card and both /academic screens never touch
// `Linking` themselves, and source-link.tsx's single `Linking.openURL` sits
// behind `isSameOrigin`. apps/worker/src/mobile-inert-rendering.test.ts pins
// the repo-wide call-site allowlist on top.
//
// Read from source rather than rendered, as today-ask-chip.test.ts and
// today-suggested-focus.test.ts do: the screens are hooked route modules
// that cannot be rendered under vitest. Implemented with Vite's compile-time
// `import.meta.glob` rather than node:fs for routes-hygiene.test.ts's reason.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(["../components/academic/**/*.{ts,tsx}", "../app/academic/**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const SOURCE_LINK = "../components/academic/source-link.tsx";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function source(path: string): string {
  const found = SOURCES[path];
  if (found === undefined) throw new Error(`${path} not found -- update this guard`);
  return found;
}

describe("academic surfaces open URLs through exactly one gated place", () => {
  const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

  it("scans the card, the sheet, the helpers and both screens", () => {
    const paths = nonTest.map(([path]) => path);
    expect(paths).toContain("../components/academic/academic-today-card.tsx");
    expect(paths).toContain("../components/academic/assignment-sheet.tsx");
    expect(paths).toContain("../app/academic/index.tsx");
    expect(paths).toContain("../app/academic/[id].tsx");
    expect(paths).toContain(SOURCE_LINK);
  });

  it("has no Linking.openURL outside source-link.tsx", () => {
    const offenders = nonTest
      .filter(
        ([path, body]) => path !== SOURCE_LINK && /Linking\.openURL/.test(stripComments(body)),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("imports Linking nowhere but source-link.tsx", () => {
    // The stronger form of the rule above: a screen that never imports
    // `Linking` cannot grow a second call site by accident.
    const offenders = nonTest
      .filter(([path, body]) => path !== SOURCE_LINK && /\bLinking\b/.test(stripComments(body)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("calls Linking.openURL exactly once in source-link.tsx, only when the origin check passed", () => {
    const body = stripComments(source(SOURCE_LINK));
    expect(body.match(/Linking\.openURL/g)).toHaveLength(1);
    // The check is computed first, from the same-origin helper...
    expect(body).toMatch(/const openable = isSameOrigin\(htmlUrl, sourceBaseUrl\);/);
    // ...and the handler EXISTS only when it passed: no handler at all
    // otherwise, rather than a handler that checks and returns.
    expect(body).toMatch(
      /onPress=\{openable \? \(\) => void Linking\.openURL\(htmlUrl as string\) : undefined\}/,
    );
    expect(body).toMatch(/accessibilityRole=\{openable \? "link" : undefined\}/);
    expect(body).toMatch(/disabled=\{!openable\}/);
  });

  it("never renders html_url as text on any academic surface", () => {
    // A bare `{item.html_url}` / `{course.html_url}` child inside JSX would
    // print the provider URL. The only legitimate uses are passing it as a
    // prop (`htmlUrl={item.html_url}` -- the brace is preceded by `=`) or to
    // the origin check (no braces at all).
    const offenders = nonTest
      .filter(([, body]) => /(?<!=)\{[a-zA-Z_.]*html_url\}/.test(stripComments(body)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // ...and the guard is not vacuous: the prop form IS present -- since
    // Checkpoint 10.6 (ADR-076 §3) in the assignment sheet, the one place an
    // assignment's Canvas link is offered, rather than on the card's rows.
    expect(source("../components/academic/assignment-sheet.tsx")).toContain(
      "htmlUrl={assignment.html_url}",
    );
  });

  it("keeps the Today card free of any bucketing, sorting or counting of its own", () => {
    // The server's overdue / due-today / due-this-week buckets are rendered
    // verbatim; the card must not re-derive them from due instants.
    const body = stripComments(source("../components/academic/academic-today-card.tsx"));
    expect(body).not.toMatch(/Date\.now\(\)|new Date\(|Date\.parse\(|\.sort\(/);
    // Since 10.3 the sections are told which ids "Do next" already shows; the
    // call is still the state helper's, with the data passed through whole.
    expect(body).toMatch(/visibleAcademicSections\(\s*data,/);
    expect(body).toContain("shouldRenderAcademicCard(data)");
  });
});
