import { describe, expect, it } from "vitest";

// Checkpoint 10.6 (ADR-076 §3): an assignment row anywhere opens the in-app
// assignment sheet, whose host is mounted EXACTLY once, at the root
// (app/_layout.tsx) -- the store is module-global and Expo Router keeps the
// Today tab mounted under a pushed course screen, so a host per screen would
// draw two modals for one record (10.6 review, finding 2). Read from source,
// as academic-open-url.test.ts does, because the screens are hooked route
// modules that cannot be rendered under vitest.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(
  [
    "../app/_layout.tsx",
    "../app/(tabs)/index.tsx",
    "../app/academic/**/*.tsx",
    "../components/academic/*.tsx",
    "../components/today/*.tsx",
  ],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function source(path: string): string {
  const found = SOURCES[path];
  if (found === undefined) throw new Error(`${path} not found -- update this guard`);
  return stripComments(found);
}

function hostMounts(body: string): number {
  return (body.match(/<AssignmentSheetHost \/>/g) ?? []).length;
}

describe("the assignment sheet has exactly one host, at the root", () => {
  it("the root layout mounts it once, beside ToastHost", () => {
    expect(hostMounts(source("../app/_layout.tsx"))).toBe(1);
  });

  it("no screen or card mounts a second host (Today stays mounted under a pushed course screen)", () => {
    for (const path of [
      "../app/(tabs)/index.tsx",
      "../app/academic/[id].tsx",
      "../app/academic/index.tsx",
      "../components/today/focus-now-card.tsx",
      "../components/today/briefing-card.tsx",
      "../components/academic/academic-today-card.tsx",
    ]) {
      expect(hostMounts(source(path))).toBe(0);
    }
  });

  it("every opener goes through openAssignmentSheet, and no assignment row wraps SourceLink any more", () => {
    for (const path of [
      "../components/today/focus-now-card.tsx",
      "../components/today/briefing-card.tsx",
      "../components/academic/academic-today-card.tsx",
      "../app/academic/[id].tsx",
    ]) {
      expect(source(path)).toContain("openAssignmentSheet(");
    }
    // The card no longer imports SourceLink at all: its rows are sheet buttons.
    expect(source("../components/academic/academic-today-card.tsx")).not.toContain("SourceLink");
    // The course screen keeps SourceLink for announcements, events and the
    // course header -- but its AssignmentRow opens the sheet.
    const course = source("../app/academic/[id].tsx");
    const assignmentRow = course.slice(
      course.indexOf("function AssignmentRow("),
      course.indexOf("function AssignmentSection("),
    );
    expect(assignmentRow).toContain("openAssignmentSheet({ assignment: item })");
    expect(assignmentRow).not.toContain("SourceLink");
  });

  it("the sheet offers Open in Canvas only through SourceLink, only when the origin check passed", () => {
    const sheet = source("../components/academic/assignment-sheet.tsx");
    expect(sheet).toMatch(
      /if \(!isSameOrigin\(assignment\.html_url, assignment\.source_base_url\)\) return null;/,
    );
    expect(sheet).toMatch(/<SourceLink[\s\S]*?htmlUrl=\{assignment\.html_url\}/);
    expect(sheet).not.toMatch(/\bLinking\b/);
  });
});
