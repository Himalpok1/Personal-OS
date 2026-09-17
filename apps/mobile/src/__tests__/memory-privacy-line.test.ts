import { describe, expect, it } from "vitest";
import { MEMORY_PRIVACY_LINE } from "@/components/memory/memory-privacy";

// Checkpoint 10.7 (ADR-077 §6): "never sent to an AI model" is a structural
// guarantee -- Guard 6 in apps/api pins the server side. This file pins the
// client side of the same promise:
//
//   1. the privacy line the owner reads is byte-exact (rewording it is a
//      decision about the guarantee, not copy), and every memory surface
//      shows it;
//   2. no Ask surface -- the components under components/ask, the search
//      screen that hosts Ask, or the Ask request builder in queries/ask.ts --
//      imports the memory queries, so no memory can ride along in a question;
//   3. no Today surface imports the suggestion sheet or its opener (ADR-077
//      §4: a suggestion is offered at the explicit moment or in the Memory
//      Center, never as a Today card). Today MAY read memories for the
//      client-side Focus Now composition (§5), so `queries/memory` itself is
//      not forbidden there -- only the nudge is.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(
  [
    "../components/ask/**/*.{ts,tsx}",
    "../app/ask*.{ts,tsx}",
    "../app/ask/**/*.{ts,tsx}",
    "../app/search/**/*.{ts,tsx}",
    "../queries/ask.ts",
    "../components/today/**/*.{ts,tsx}",
    "../app/(tabs)/index.tsx",
    "../components/memory/**/*.{ts,tsx}",
    "../app/memory/**/*.{ts,tsx}",
  ],
  { query: "?raw", import: "default", eager: true },
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const nonTest = Object.entries(SOURCES).filter(([path]) => !/\.test\.tsx?$/.test(path));

function under(prefix: string): [string, string][] {
  return nonTest.filter(([path]) => path.startsWith(prefix));
}

describe("the privacy line", () => {
  it("is byte-exact", () => {
    expect(MEMORY_PRIVACY_LINE).toBe("Only what you add or accept. Never sent to an AI model.");
  });

  it("is shown by the hero, the editor form, the settings card and the suggestion sheet", () => {
    for (const path of [
      "../app/memory/index.tsx",
      "../components/memory/memory-form.tsx",
      "../components/memory/memory-settings-card.tsx",
      "../components/memory/memory-suggestion-sheet.tsx",
    ]) {
      const body = stripComments(SOURCES[path]!);
      expect(body, path).toMatch(
        /import \{ MEMORY_PRIVACY_LINE \} from "(\.\/|@\/components\/memory\/)memory-privacy"/,
      );
      expect(body, path).toMatch(/\{MEMORY_PRIVACY_LINE\}/);
    }
  });

  it("is never restated as a literal anywhere else", () => {
    const offenders = nonTest
      .filter(([path]) => path !== "../components/memory/memory-privacy.ts")
      .filter(([, body]) => body.includes("Never sent to an AI model"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("no Ask surface reads memories", () => {
  const askSources = [
    ...under("../components/ask/"),
    ...under("../app/ask"),
    ...under("../app/search/"),
    ...under("../queries/ask.ts"),
  ];

  it("scans the Ask components, the search screen and the Ask request builder", () => {
    const paths = askSources.map(([path]) => path);
    expect(paths).toContain("../components/ask/ask-view.tsx");
    expect(paths).toContain("../app/search/index.tsx");
    expect(paths).toContain("../queries/ask.ts");
  });

  it("imports neither queries/memory nor any components/memory module", () => {
    const offenders = askSources
      .filter(([, body]) =>
        /queries\/memory|components\/memory|\/memories\b/.test(stripComments(body)),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the Ask request builder sends only question, scope and tz", () => {
    const body = stripComments(SOURCES["../queries/ask.ts"]!);
    expect(body).toMatch(
      /api\.askCloud\(\{ question: input\.question, scope: input\.scope, tz: deviceTimezone\(\) \}\)/,
    );
    expect(body).not.toMatch(/memor/i);
  });
});

describe("no Today surface offers a memory suggestion", () => {
  const todaySources = [...under("../components/today/"), ...under("../app/(tabs)/")];

  it("scans Today", () => {
    const paths = todaySources.map(([path]) => path);
    expect(paths).toContain("../app/(tabs)/index.tsx");
    expect(paths).toContain("../components/today/focus-now-card.tsx");
  });

  it("never imports the suggestion sheet, its opener, or the suggestions query", () => {
    const offenders = todaySources
      .filter(([, body]) =>
        /memory-suggestion-sheet|showMemorySuggestion|useMemorySuggestions|fetchMemorySuggestionForProject|MemorySettingsCard/.test(
          stripComments(body),
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("the suggestion sheet has exactly one host and two openers", () => {
  const ALL = (
    import.meta as unknown as {
      glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
    }
  ).glob(["../app/**/*.tsx", "../components/**/*.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it("the root layout mounts MemorySuggestionSheetHost once, and nothing else mounts it", () => {
    const mounts = Object.entries(ALL)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .map(
        ([path, body]) =>
          [
            path,
            (stripComments(body).match(/<MemorySuggestionSheetHost \/>/g) ?? []).length,
          ] as const,
      )
      .filter(([, count]) => count > 0);
    expect(mounts).toEqual([["../app/_layout.tsx", 1]]);
  });

  it("showMemorySuggestion is called only from the project screen's goal save", () => {
    const callers = Object.entries(ALL)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([path]) => path !== "../components/memory/memory-suggestion-sheet.tsx")
      .filter(([, body]) => /showMemorySuggestion\(/.test(stripComments(body)))
      .map(([path]) => path);
    expect(callers).toEqual(["../app/projects/[id].tsx"]);
    const project = stripComments(ALL["../app/projects/[id].tsx"]!);
    // Gated on a non-empty goal having just been saved -- the explicit moment.
    expect(project).toMatch(
      /onSuccess: \(\) => \{\s*if \(typeof body\.goal === "string" && body\.goal\.length > 0\) \{\s*void fetchMemorySuggestionForProject\(queryClient, project\.id\)/,
    );
  });
});
