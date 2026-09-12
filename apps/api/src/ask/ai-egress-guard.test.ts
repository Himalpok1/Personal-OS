import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Mechanical ratchets for Cloud Ask (Checkpoint 8.6B design §6.3), against
// mistakes rather than a determined attacker in the same process -- see
// apps/api/src/ask/authorize.ts's module comment for what actually bears the
// security weight. Two guards live here because they are two sides of the same
// question: which files may transmit user content to a cloud model, and which
// files may read the tables that content lives in.
//
// This file lives under apps/api because Node's fs/path/url are needed to
// cross a package boundary -- the same technique
// apps/worker/src/mobile-inert-rendering.test.ts already uses to enforce a
// rule that lives outside its own package.

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const API_SRC = path.join(REPO_ROOT, "apps/api/src");
const WORKER_SRC = path.join(REPO_ROOT, "apps/worker/src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    acc.push(full);
  }
  return acc;
}

function relToRepo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

// ===========================================================================
// GUARD 1 -- the frozen MODEL-INVOCATION caller set.
// ===========================================================================
//
// Deliberately narrower than "any import from the `ai` package": that would
// also flag apps/api/src/logging/serialize-error.ts, which imports ONLY the
// `AISDKError` class for structural error-shape detection (Checkpoint 8.6B
// A3) and calls no model. The property this guard actually protects --
// "no new place can silently start transmitting user content to a cloud
// model" -- is about the SDK's invocation surface specifically, so that is
// what is matched: `generateText`/`streamText`/`generateObject`/`streamObject`
// imported under ANY local binding (named, aliased, or via a namespace
// import), or a direct `.doGenerate(`/`.doStream(` call bypassing the
// high-level API entirely.
const MODEL_INVOCATION_EXPORTS = ["generateText", "streamText", "generateObject", "streamObject"];

const NAMED_IMPORT_FROM_AI = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']ai["']/g;
const NAMESPACE_IMPORT_FROM_AI = /import\s+\*\s+as\s+\w+\s+from\s*["']ai["']/;
const LOW_LEVEL_CALL = /\.(doGenerate|doStream)\s*\(/;

function importsModelInvocation(contents: string): boolean {
  if (NAMESPACE_IMPORT_FROM_AI.test(contents)) return true;
  if (LOW_LEVEL_CALL.test(contents)) return true;
  for (const match of contents.matchAll(NAMED_IMPORT_FROM_AI)) {
    const names = (match[1] ?? "")
      .split(",")
      .map((entry) =>
        entry
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((name): name is string => Boolean(name));
    if (names.some((name) => MODEL_INVOCATION_EXPORTS.includes(name))) return true;
  }
  return false;
}

/** The closed set. A sixth entry is a reviewed architectural decision, not a drive-by addition. */
const EXPECTED_MODEL_CALLERS = new Set([
  "apps/api/src/ask/generate.ts",
  "apps/api/src/brief/generate.ts",
  "apps/api/src/routes/ai-config.ts",
  "apps/worker/src/jobs/capture-parse.ts",
  "apps/worker/src/mail/digest/generate.ts",
]);

/**
 * Both hardening literals every closed-set member must carry, as PLAIN
 * substrings of its source. This is the regression guard Checkpoint 8.6B's
 * Part A explicitly requires: a future edit to any of these five files that
 * drops either literal fails here, not in production telemetry nobody is
 * watching.
 */
const REQUIRED_HARDENING_LITERALS = [
  "maxRetries: 0",
  "experimental_telemetry: { isEnabled: false }",
];

/**
 * Strips `//` line comments before the hardening check runs.
 *
 * WITHOUT this, the check is self-defeating: every one of these five files
 * carries an explanatory comment ABOUT `maxRetries: 0` directly above the
 * real code (by design -- that is what makes the hardening reviewable), so a
 * bare substring search matches the PROSE even when the real
 * `generateText(...)` call is mutated to remove the actual option. Verified by
 * deliberately deleting the real `maxRetries: 0,` from capture-parse.ts during
 * this checkpoint's own review and confirming the unstripped version of this
 * check kept passing -- exactly the false-guarantee this strip closes.
 *
 * `(^|[^:])` avoids treating `://` (as in a URL literal) as a comment opener.
 * Block comments are not handled -- none of the five files uses one near
 * their `generateText` call.
 */
function stripLineComments(contents: string): string {
  return contents
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

describe("the frozen AI SDK model-invocation caller set (Checkpoint 8.6B design §6.3.1)", () => {
  const files = [...walk(API_SRC), ...walk(WORKER_SRC)]
    .filter((file) => importsModelInvocation(readFileSync(file, "utf8")))
    .map(relToRepo)
    .sort();

  it("matches exactly the reviewed set of five call sites -- no more, no fewer", () => {
    expect(files).toEqual([...EXPECTED_MODEL_CALLERS].sort());
  });

  it("scans real files, so a broken walker cannot pass by finding nothing", () => {
    expect(walk(API_SRC).length + walk(WORKER_SRC).length).toBeGreaterThan(40);
  });

  it.each([...EXPECTED_MODEL_CALLERS])("%s disables SDK retry and telemetry explicitly", (rel) => {
    const code = stripLineComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
    for (const literal of REQUIRED_HARDENING_LITERALS) {
      expect(code, `${rel} is missing "${literal}" in actual code (not just a comment)`).toContain(
        literal,
      );
    }
  });
});

// ===========================================================================
// GUARD 2 -- body-table access outside sanctioned readers.
// ===========================================================================
//
// Frozen at the file's OWN inventory rather than an idealized location list,
// because that is what makes this a ratchet and not aspirational prose: every
// entry below was verified, first-hand, to be the complete current set of
// non-test apps/api/apps/worker files referencing `.from(notes`, `.from(tasks`,
// `db.query.notes` or `db.query.tasks`. Adding a new body-reading file anywhere
// is a real, reviewable change to the surface that can put note/task text in
// front of anything -- a cloud model included -- and must extend this list
// deliberately, the same discipline the console-call and no-raw-console
// ratchets already apply to their own surfaces.
const EXPECTED_BODY_READERS = new Set([
  "apps/api/src/ask/select-context.ts",
  "apps/api/src/read-models/agenda.ts",
  "apps/api/src/read-models/project-summaries.ts",
  "apps/api/src/read-models/recent-completed.ts",
  "apps/api/src/read-models/review-contexts.ts",
  "apps/api/src/read-models/search.ts",
  "apps/api/src/read-models/today.ts",
  "apps/api/src/read-models/user-export.ts",
  "apps/api/src/routes/notes.ts",
  "apps/api/src/routes/occurrences.ts",
  "apps/api/src/routes/projects.ts",
  "apps/api/src/routes/tasks.ts",
  "apps/worker/src/jobs/expand-due-date-window.ts",
  "apps/worker/src/jobs/generate-lazy-occurrence.ts",
  // Checkpoint 9.0: the generate-lazy dead-letter handler reads the parent
  // task row to re-check its state (status, archive axis, recurrence anchor)
  // and to name the task in the alert push by its TITLE -- control-stripped
  // and capped at 80 characters, never the body, never the rule. The title
  // reaches Expo Push exactly as the Phase 3 confirmation push already sends
  // a capture's full raw text; no model ever sees it. Reviewed here rather
  // than widened silently, which is what this ratchet is for.
  "apps/worker/src/jobs/occurrences-dead-letter.ts",
]);

const BODY_TABLE_REFERENCE = /\.from\(notes|\.from\(tasks|db\.query\.notes|db\.query\.tasks/;

describe("body-table access outside sanctioned readers (Checkpoint 8.6B design §6.3.2)", () => {
  const files = [...walk(API_SRC), ...walk(WORKER_SRC)]
    .filter((file) => BODY_TABLE_REFERENCE.test(readFileSync(file, "utf8")))
    .map(relToRepo)
    .sort();

  it("matches exactly the reviewed inventory -- a new reader is a deliberate, reviewed addition", () => {
    expect(files).toEqual([...EXPECTED_BODY_READERS].sort());
  });
});

// ===========================================================================
// GUARD 3 -- no cast near the authorization boundary.
// ===========================================================================
//
// `as unknown as`, `as any` and `as CloudAskGrant` are exactly the three
// shapes that would let code forge a grant the WeakSet in authorize.ts never
// actually minted. Scoped to apps/api/src/ask/ and to any file importing from
// it, matching design §6.3.3.
const FORBIDDEN_CASTS = [/\bas\s+unknown\s+as\b/, /\bas\s+any\b/, /\bas\s+CloudAskGrant\b/];

describe("no cast near the Cloud Ask authorization boundary (Checkpoint 8.6B design §6.3.3)", () => {
  const askDir = path.join(API_SRC, "ask");
  const importsFromAsk = /from\s*["'](?:\.{1,2}\/)*ask\/[^"']+["']/;

  const filesToCheck = [...walk(API_SRC), ...walk(WORKER_SRC)].filter((file) => {
    if (file.startsWith(askDir)) return true;
    return importsFromAsk.test(readFileSync(file, "utf8"));
  });

  it("contains no forged-grant cast anywhere in the ask/ module or its importers", () => {
    const offenders: string[] = [];
    for (const file of filesToCheck) {
      const contents = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_CASTS) {
        if (pattern.test(contents)) offenders.push(`${relToRepo(file)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("checked at least the ask/ module's own files", () => {
    expect(filesToCheck.some((file) => file.startsWith(askDir))).toBe(true);
  });
});
