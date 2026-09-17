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

/**
 * The closed set. A sixth entry is a reviewed architectural decision, not a
 * drive-by addition: `apps/api/src/focus/generate.ts` (Checkpoint 9.8,
 * Suggested Focus) is the deliberate sixth caller, added the same way this
 * set grew from five to six -- it lives outside apps/api/src/intelligence/
 * (Guard 4 forbids an `ai` import there) for the same reason
 * apps/api/src/ask/generate.ts does, and it reuses the SAME "ask" task route
 * Cloud Ask uses rather than adding a new `ai_task_routes` row.
 */
const EXPECTED_MODEL_CALLERS = new Set([
  "apps/api/src/ask/generate.ts",
  "apps/api/src/brief/generate.ts",
  "apps/api/src/focus/generate.ts",
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
  // Checkpoint 9.4 / 9.7: the reminders read model (extracted from
  // routes/reminders.ts by 9.7 so the Ask lane's Today context can share it)
  // joins tasks to derive one reminder per occurrence. It selects the TITLE
  // (the primary device puts it in the local notification, exactly as the
  // pre-9.4 GET /tasks feed already did), the instants and the timezone --
  // never `body`, and the response is parsed through the strict
  // RemindersResponseSchema, which has no body field. The route is now a
  // thin caller and no longer references the table itself.
  "apps/api/src/read-models/reminders.ts",
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
  // Checkpoint 10.5 (ADR-074): GET /academic/courses/:id/context's
  // "related reminders" section selects the owner's own tasks whose
  // canvas_assignment_id names one of the course's assignments. Selects only
  // `title`/`due_at`/`remind_at`/`status` -- the same column list
  // read-models/reminders.ts's own entry above documents -- never `body`.
  // This file is Guard 5's own subject (academic data must never reach an AI
  // lane); reading a handful of task columns from it does not change that,
  // since Guard 5 checks the opposite direction -- that no AI-lane file ever
  // imports this one, not what this one may read.
  "apps/api/src/read-models/academic.ts",
  // Checkpoint 10.5: GET /projects/:id/detail's own task/event section
  // queries, extracted here so GET /projects/:id/context (also this file)
  // reuses them instead of duplicating them. Selects
  // `title`/`status`/`due_at`/`priority`/`rrule`/`completed_at`/
  // `canvas_assignment_id` -- never `body` -- plus note id/title/timestamps
  // for the recent-activity feed and note ids (never bodies) for the
  // related-captures join. routes/projects.ts is already on this list for
  // the identical reason.
  "apps/api/src/read-models/project-context.ts",
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

// ===========================================================================
// GUARD 4 -- the intelligence lane is read-only and provider-free.
// ===========================================================================
//
// Checkpoint 9.7 (ADR-066, design §6/§10). apps/api/src/intelligence/ holds the
// ONE context builder the Ask lane calls today and a future read-only agent
// tool would bind unchanged. Two properties make that lane safe to grow:
// it can never call a model itself (no `ai`, no `@personal-os/ai-providers`,
// no dynamic `import("ai")`, no `require(`) and it can never write, nor reach
// into the worker. A future write-shaped tool is additionally impossible by
// NAME: every entry in READ_TOOL_NAMES must match /^(search|get)_/ -- read as
// text, the queue-parity technique, so the check cannot be satisfied by a
// re-export.
//
// THREE BYPASSES THE 9.7 REVIEW FOUND IN THE FIRST DRAFT, all closed below:
//   * `db.execute(sql`DELETE …`)` and `.transaction(` wrote without ever
//     naming `.insert(`/`.update(`/`.delete(` -- both are now denied outright,
//     and any `sql` template whose first keyword is a write verb fails too.
//   * a dynamic `await import("ai")` evaded the static import patterns.
//   * `stripLineComments` strips `//` inside a STRING literal as well as in a
//     comment, so a denied token placed after a `//` in a string vanished
//     before the scan. The import ALLOWLIST closes that class generally: it
//     reads the ORIGINAL source (no stripping) and fails on ANY import
//     specifier outside a short reviewed set, so a new capability cannot
//     arrive at all -- the denylist alone could only ever chase shapes.
const INTELLIGENCE_DIR = path.join(API_SRC, "intelligence");
const SCHEMA_TOOLS_FILE = path.join(REPO_ROOT, "packages/schema/src/intelligence-tools.ts");

const FORBIDDEN_INTELLIGENCE_IMPORTS: readonly [string, RegExp][] = [
  ['from "ai"', /from\s*["']ai["']/],
  ["@personal-os/ai-providers", /["']@personal-os\/ai-providers(?:\/[^"']*)?["']/],
  ["apps/worker", /from\s*["'][^"']*(?:apps\/worker|\.\.\/\.\.\/\.\.\/worker)[^"']*["']/],
];
const FORBIDDEN_INTELLIGENCE_WRITE_VERBS: readonly [string, RegExp][] = [
  [".insert(", /\.insert\s*\(/],
  [".update(", /\.update\s*\(/],
  [".delete(", /\.delete\s*\(/],
  ["sql.raw", /\bsql\.raw\b/],
  ["onConflict", /\bonConflict/],
  // `db.execute(sql`DELETE …`)` and `db.transaction(tx => tx.insert(...))`
  // both write without naming any verb above. Neither has a read-only use in
  // this lane -- every read goes through an existing read model -- so both
  // are denied outright rather than pattern-matched for intent.
  [".execute(", /\.execute\s*\(/],
  [".transaction(", /\.transaction\s*\(/],
  // A dynamic import evades every static `from "ai"` pattern.
  ['import("ai")', /\bimport\s*\(\s*["'`]ai["'`]\s*\)/],
  ["require(", /\brequire\s*\(/],
  // Any `sql` template whose first keyword is a write verb, whatever it is
  // then passed to. Case-insensitive and whitespace/newline tolerant.
  ["sql`<write verb>", /sql\s*`\s*(?:insert|update|delete|truncate|alter|create|drop)\b/i],
];

/**
 * The COMPLETE set of import specifiers a non-test file under
 * apps/api/src/intelligence/ may name. An allowlist rather than a denylist,
 * because a denylist can only forbid the capabilities someone already thought
 * of: anything outside this set -- a provider package, `node:fs`, a route, a
 * worker path, a db table module -- fails here and must be argued for.
 * Read from the ORIGINAL source, so a comment-stripping trick cannot hide one.
 */
const ALLOWED_INTELLIGENCE_IMPORTS: readonly RegExp[] = [
  /^@personal-os\/core\/[\w./-]+$/,
  /^@personal-os\/schema$/,
  /^@personal-os\/db$/, // type-only: the Db type on ReadContext
  /^fastify$/, // type-only: FastifyRequest
  /^\.\.\/read-models\/[\w.-]+\.js$/,
  /^\.\.\/ask\/authorize\.js$/,
  /^\.\/[\w.-]+\.js$/, // siblings within intelligence/
];

/**
 * Every import/export specifier in a file, static and dynamic alike. Quotes
 * only -- a backtick after `from` is prose in a comment ("never from
 * `citations.length`"), never a module specifier, and a template-literal
 * specifier is a dynamic import, which `require(`/`import("ai")` already deny.
 */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(contents: string): string[] {
  return [...contents.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]!);
}

describe("the intelligence lane is read-only and provider-free (Checkpoint 9.7, Guard 4)", () => {
  const files = walk(INTELLIGENCE_DIR);

  it("walks real files under apps/api/src/intelligence", () => {
    expect(files.map(relToRepo)).toContain("apps/api/src/intelligence/today-context.ts");
    expect(files.map(relToRepo)).toContain("apps/api/src/intelligence/read-context.ts");
  });

  it("imports neither the AI SDK, nor the provider package, nor anything from apps/worker", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_IMPORTS) {
        if (pattern.test(code)) offenders.push(`${relToRepo(file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("contains no write verb -- insert/update/delete/sql.raw/onConflict", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_WRITE_VERBS) {
        if (pattern.test(code)) offenders.push(`${relToRepo(file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports only from the reviewed allowlist -- a new capability cannot arrive quietly", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Deliberately NOT comment-stripped: the allowlist must see the file as
      // the module loader does.
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (!ALLOWED_INTELLIGENCE_IMPORTS.some((pattern) => pattern.test(specifier))) {
          offenders.push(`${relToRepo(file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually collects the imports it checks, so a broken matcher cannot pass by finding none", () => {
    const all = files.flatMap((file) => importSpecifiers(readFileSync(file, "utf8")));
    expect(all).toContain("@personal-os/schema");
    expect(all).toContain("../read-models/today.js");
    expect(all.length).toBeGreaterThan(8);
  });

  it("every READ_TOOL_NAMES entry is search_* or get_* -- no write-shaped tool can be named", () => {
    const source = readFileSync(SCHEMA_TOOLS_FILE, "utf8");
    const block = /export const READ_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(source);
    expect(block, "READ_TOOL_NAMES literal not found in intelligence-tools.ts").not.toBeNull();
    const names = [...(block![1] ?? "").matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names)
      expect(name, `${name} is not a read-shaped tool name`).toMatch(/^(search|get)_/);
  });
});

// ===========================================================================
// GUARD 5 -- academic data never reaches an AI lane.
// ===========================================================================
//
// Checkpoint 10.2 (ADR-068a, ADR-070). The Academic Intelligence Layer is a
// read model over the canvas_* tables -- courses, assignments with a stored
// score and grade, announcements, calendar events -- and its rule is "no AI
// processing of academic data": displayed, never fed to a model, the ADR-046
// posture Health already holds. `AcademicTodayResponseSchema` is deliberately
// NOT a section of `TodayResponseSchema`, so the two AI collectors
// (intelligence/today-context.ts, brief/collect-input.ts), which build from
// `buildTodayResponse` alone, cannot see it by construction. This guard pins
// the import boundary on top of that structural fact, in both directions:
//
//   (a) no non-test file under apps/api/src/{intelligence,ask,focus,brief}
//       may import read-models/academic, any `@personal-os/core/academic/*`
//       subpath, or a canvas_* table binding from `@personal-os/db` -- nor
//       even NAME one of those bindings, so a re-export or a namespace import
//       (`import * as db`) cannot smuggle one past the specifier check;
//   (b) read-models/academic.ts and routes/academic.ts import neither the AI
//       SDK nor the provider package, reach into no AI lane, and (the read
//       model) carry no write verb -- the same denylist Guard 4 applies to the
//       intelligence lane, because a read model that can write is not a read
//       model.
const AI_LANE_DIRS = ["intelligence", "ask", "focus", "brief"].map((dir) =>
  path.join(API_SRC, dir),
);
const ACADEMIC_READ_MODEL = path.join(API_SRC, "read-models/academic.ts");
const ACADEMIC_ROUTE = path.join(API_SRC, "routes/academic.ts");

// Both the Drizzle bindings AND the snake_case table names: a raw
// sql`select grade from canvas_assignments` template names no binding and no
// write verb, so without the second set it would pass Guards 4 and 5 unseen
// (10.2 review finding).
const CANVAS_TABLE_BINDINGS = [
  "canvasAssignments",
  "canvasCourses",
  "canvasAnnouncements",
  "canvasEvents",
] as const;
const CANVAS_TABLE_NAMES = [
  "canvas_assignments",
  "canvas_courses",
  "canvas_announcements",
  "canvas_events",
] as const;
const CANVAS_TABLE_IDENTIFIER = new RegExp(
  `\\b(?:${[...CANVAS_TABLE_BINDINGS, ...CANVAS_TABLE_NAMES].join("|")})\\b`,
);
// A lane may import any `../read-models/<x>.js` under Guard 4's allowlist, so
// a non-lane module re-exporting the academic read model under another name
// would be a one-hop evasion. Close it at the source: nothing under
// read-models/ except academic.ts itself may import the academic module.
const READ_MODELS_DIR = path.join(API_SRC, "read-models");
const ACADEMIC_RELATIVE_SPECIFIER = /(?:^|\/)academic(?:\.js)?$/;

const FORBIDDEN_AI_LANE_SPECIFIERS: readonly [string, RegExp][] = [
  ["read-models/academic", /(?:^|\/)read-models\/academic(?:\.js)?$/],
  ["@personal-os/core/academic/*", /^@personal-os\/core\/academic(?:\/|$)/],
];
const NAMESPACE_IMPORT_FROM_DB = /import\s+\*\s+as\s+\w+\s+from\s*["']@personal-os\/db["']/;

const FORBIDDEN_ACADEMIC_LANE_IMPORTS: readonly [string, RegExp][] = [
  ['from "ai"', /from\s*["']ai["']/],
  ['import("ai")', /\bimport\s*\(\s*["'`]ai["'`]\s*\)/],
  ["@personal-os/ai-providers", /["']@personal-os\/ai-providers(?:\/[^"']*)?["']/],
  ["an AI lane", /from\s*["'](?:\.{1,2}\/)*(?:intelligence|ask|focus|brief)\/[^"']+["']/],
];

describe("academic data never reaches an AI lane (Checkpoint 10.2, Guard 5)", () => {
  const laneFiles = AI_LANE_DIRS.flatMap((dir) => walk(dir));

  it("walks every AI lane, so an empty directory cannot pass by finding nothing", () => {
    const rels = laneFiles.map(relToRepo);
    expect(rels).toContain("apps/api/src/intelligence/today-context.ts");
    expect(rels).toContain("apps/api/src/ask/generate.ts");
    expect(rels).toContain("apps/api/src/focus/generate.ts");
    expect(rels).toContain("apps/api/src/brief/collect-input.ts");
  });

  it("no AI-lane file imports the academic read model, core's academic helpers, or a canvas table", () => {
    const offenders: string[] = [];
    for (const file of laneFiles) {
      // Specifiers are read from the ORIGINAL source, as the module loader
      // sees them (Guard 4's reasoning for its allowlist).
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_AI_LANE_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${relToRepo(file)}: ${label}`);
        }
      }
      if (NAMESPACE_IMPORT_FROM_DB.test(original)) {
        offenders.push(`${relToRepo(file)}: import * as … from "@personal-os/db"`);
      }
      // Any mention of a canvas table binding in code -- an import, a
      // re-export, or a `.from(canvasAssignments` reached through a
      // namespace -- fails, whatever specifier it arrived under.
      const code = stripLineComments(original);
      const identifier = CANVAS_TABLE_IDENTIFIER.exec(code);
      if (identifier) offenders.push(`${relToRepo(file)}: ${identifier[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no other read model re-exports or imports the academic read model (one-hop evasion)", () => {
    const offenders: string[] = [];
    const siblings = walk(READ_MODELS_DIR).filter((f) => f !== ACADEMIC_READ_MODEL);
    expect(siblings.map(relToRepo)).toContain("apps/api/src/read-models/today.ts");
    for (const file of siblings) {
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        if (ACADEMIC_RELATIVE_SPECIFIER.test(specifier) || /academic/.test(specifier)) {
          offenders.push(`${relToRepo(file)}: ${specifier}`);
        }
      }
      // `export * from "./academic.js"` / `export { x } from …` are imports
      // to the loader but not to `importSpecifiers` if it only reads
      // `import` statements -- scan for the re-export form explicitly.
      const reexport = /export\s+(?:\*|\{[^}]*\})\s+from\s*["'][^"']*academic[^"']*["']/.exec(
        stripLineComments(original),
      );
      if (reexport) offenders.push(`${relToRepo(file)}: ${reexport[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the academic read model and route import neither the AI SDK, the provider package, nor an AI lane", () => {
    const offenders: string[] = [];
    for (const file of [ACADEMIC_READ_MODEL, ACADEMIC_ROUTE]) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      for (const [label, pattern] of FORBIDDEN_ACADEMIC_LANE_IMPORTS) {
        if (pattern.test(code)) offenders.push(`${relToRepo(file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the academic read model contains no write verb -- it is a projection, never a store", () => {
    const code = stripLineComments(readFileSync(ACADEMIC_READ_MODEL, "utf8"));
    const offenders: string[] = [];
    for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_WRITE_VERBS) {
      if (pattern.test(code)) offenders.push(label);
    }
    expect(offenders).toEqual([]);
  });

  it("actually reads the academic read model, so a moved file cannot pass vacuously", () => {
    const all = importSpecifiers(readFileSync(ACADEMIC_READ_MODEL, "utf8"));
    expect(all).toContain("@personal-os/db");
    expect(all).toContain("@personal-os/core/academic/buckets");
    expect(all).toContain("@personal-os/core/academic/derive");
    const code = stripLineComments(readFileSync(ACADEMIC_READ_MODEL, "utf8"));
    for (const binding of CANVAS_TABLE_BINDINGS) expect(code).toContain(binding);
  });
});
