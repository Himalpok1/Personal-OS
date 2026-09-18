import { describe, expect, it } from "vitest";
import { ACTIONS_TRUST_LINE } from "@/components/actions/trust-line";

// Checkpoint 10.8 (ADR-078 §3/§8): "nothing runs until you approve it" is a
// structural guarantee -- `requires_approval` is a literal `true` on every
// registry entry and Guard 7 in apps/api keeps every AI lane from writing a
// request. This file pins the client side of the same promise:
//
//   1. the trust line the owner reads is byte-exact (rewording it is a
//      decision about the guarantee, not copy), and the two surfaces that
//      carry it import the constant rather than restating it;
//   2. the approval sheet has EXACTLY ONE host, mounted by the root layout
//      (a module-global store with two hosts draws two modals -- the 10.6
//      review's finding 2), and every approve/cancel goes through it: no
//      other file calls the approve/cancel mutations;
//   3. no AI surface imports the action queries, so no request can be
//      composed from a model's output on the client either.
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

function under(prefix: string): [string, string][] {
  return nonTest.filter(([path]) => path.startsWith(prefix));
}

describe("the trust line", () => {
  it("is byte-exact", () => {
    expect(ACTIONS_TRUST_LINE).toBe(
      "Nothing runs until you approve it. You can revoke any permission.",
    );
  });

  it("is shown by the Action Center hero and the settings card, through the constant", () => {
    for (const path of [
      "../app/actions/index.tsx",
      "../components/actions/actions-settings-card.tsx",
    ]) {
      const body = stripComments(SOURCES[path]!);
      expect(body, path).toMatch(
        /import \{ ACTIONS_TRUST_LINE \} from "(\.\/|@\/components\/actions\/)trust-line"/,
      );
      expect(body, path).toMatch(/\{ACTIONS_TRUST_LINE\}/);
    }
  });

  it("is never restated as a literal anywhere else", () => {
    const offenders = nonTest
      .filter(([path]) => path !== "../components/actions/trust-line.ts")
      .filter(([, body]) => body.includes("Nothing runs until you approve it"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("the approval sheet has exactly one host", () => {
  it("scans the root layout and the sheet", () => {
    const paths = nonTest.map(([path]) => path);
    expect(paths).toContain("../app/_layout.tsx");
    expect(paths).toContain("../components/actions/action-approval-sheet.tsx");
  });

  it("the root layout mounts ActionApprovalSheetHost once, and nothing else mounts it", () => {
    const mounts = nonTest
      .map(
        ([path, body]) =>
          [
            path,
            (stripComments(body).match(/<ActionApprovalSheetHost \/>/g) ?? []).length,
          ] as const,
      )
      .filter(([, count]) => count > 0);
    expect(mounts).toEqual([["../app/_layout.tsx", 1]]);
  });

  it("only the sheet host calls the approve and cancel mutations", () => {
    const callers = nonTest
      .filter(([path]) => path !== "../queries/actions.ts")
      .filter(([, body]) => /useApproveAction\(|api\.approveAction\(/.test(stripComments(body)))
      .map(([path]) => path);
    expect(callers).toEqual(["../components/actions/action-approval-sheet.tsx"]);
  });

  it("the approval sheet never confirms Approve through a dialog and never opens a URL", () => {
    const body = stripComments(SOURCES["../components/actions/action-approval-sheet.tsx"]!);
    expect(body).not.toMatch(/confirmDestructive|Alert\.alert|Linking/);
  });
});

describe("no AI surface proposes an action", () => {
  const askSources = [
    ...under("../components/ask/"),
    ...under("../app/ask"),
    ...under("../app/search/"),
    ...under("../queries/ask.ts"),
    ...under("../queries/focus.ts"),
    ...under("../queries/brief.ts"),
    ...under("../components/focus/"),
    ...under("../components/brief/"),
  ];

  it("scans the Ask, Suggested Focus and Brief surfaces", () => {
    const paths = askSources.map(([path]) => path);
    expect(paths).toContain("../components/ask/ask-view.tsx");
    expect(paths).toContain("../queries/ask.ts");
    expect(paths).toContain("../queries/focus.ts");
  });

  it("imports neither queries/actions nor any components/actions module", () => {
    const offenders = askSources
      .filter(([, body]) =>
        /queries\/actions|components\/actions|createActionRequest|openActionApprovalSheet/.test(
          stripComments(body),
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
