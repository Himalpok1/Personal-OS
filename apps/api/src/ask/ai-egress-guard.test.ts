import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  // Checkpoint 10.8 (ADR-078): the task service extracted from routes/tasks.ts
  // so an approved action and the direct route share one code path. Its only
  // SELECT (`loadTaskForAction`) reads id/title/status/rrule/archived_at --
  // never the body; every other statement is an INSERT or UPDATE.
  "apps/api/src/services/tasks.ts",
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
  // Checkpoint 10.9 (ADR-081): the `get_task_context` read tool's row loader.
  // It selects the task's SCHEDULE columns and never `body` or `rrule`
  // (intelligence/task-context.ts projects it through a body-free strict
  // schema); it is listed because it names the table at all.
  "apps/api/src/read-models/task-context.ts",
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
// The three ROUTE files that own a model call's request-scoped inputs (the
// Ask route assembles the `<records>` candidates it hands to buildAskContext;
// the Brief and Focus routes call their generators). They live under routes/,
// not under a lane directory, so a walk of the lane dirs alone leaves them
// unguarded -- the one concrete evasion the 10.7 adversarial review found.
// Guards 5 and 6 walk them alongside the lane files.
const AI_ROUTE_FILES = ["routes/ask.ts", "routes/briefs.ts", "routes/focus.ts"].map((file) =>
  path.join(API_SRC, file),
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
  // `agent` joined the alternation in Checkpoint 10.9 (Guard 8): the gateway
  // may call INTO the academic/memory/action modules under its own rules, but
  // none of them may reach back into it.
  ["an AI lane", /from\s*["'](?:\.{1,2}\/)*(?:intelligence|ask|focus|brief|agent)\/[^"']+["']/],
];

describe("academic data never reaches an AI lane (Checkpoint 10.2, Guard 5)", () => {
  const laneFiles = [...AI_LANE_DIRS.flatMap((dir) => walk(dir)), ...AI_ROUTE_FILES];

  it("walks every AI lane and the three AI route files, so an empty directory cannot pass by finding nothing", () => {
    const rels = laneFiles.map(relToRepo);
    expect(rels).toContain("apps/api/src/intelligence/today-context.ts");
    expect(rels).toContain("apps/api/src/ask/generate.ts");
    expect(rels).toContain("apps/api/src/focus/generate.ts");
    expect(rels).toContain("apps/api/src/brief/collect-input.ts");
    expect(rels).toContain("apps/api/src/routes/ask.ts");
    for (const file of AI_ROUTE_FILES) expect(existsSync(file)).toBe(true);
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

// ===========================================================================
// GUARD 6 -- memory never reaches an AI lane, another read model, or the
// worker (Checkpoint 10.7, ADR-077 §6).
// ===========================================================================
//
// The Personal Memory layer is the owner's most deliberately authored text --
// preferences, goals and facts they typed on purpose. ADR-077 makes it
// DETERMINISTIC-ONLY: it influences Focus Now and the briefing on the client
// (packages/core, by explicit typed link) and is never part of any prompt, any
// pg-boss job payload or any push body. Guard 5's structure is reused
// verbatim, parameterised for the memory tables, with one addition: the
// worker tree is walked too, because "never rides a job or a push" is a
// worker-side property (ADR-077 invariant 4). Lifting this boundary is a
// future ADR plus a new ASK_TODAY_CONSENT_FROM vintage, never an edit here.
const MEMORY_READ_MODEL = path.join(API_SRC, "read-models/memories.ts");
const MEMORY_ROUTES = [
  path.join(API_SRC, "routes/memories.ts"),
  path.join(API_SRC, "routes/memory-settings.ts"),
  path.join(API_SRC, "routes/memory-suggestions.ts"),
];
const MEMORY_TABLE_BINDINGS = ["memories", "memorySuggestions", "memorySettings"] as const;
const MEMORY_TABLE_NAMES = ["memory_suggestions", "memory_settings"] as const;
const MEMORY_TABLE_IDENTIFIER = new RegExp(
  `\\b(?:${[...MEMORY_TABLE_BINDINGS, ...MEMORY_TABLE_NAMES].join("|")})\\b`,
);
const FORBIDDEN_MEMORY_SPECIFIERS: readonly [string, RegExp][] = [
  ["read-models/memories", /(?:^|\/)read-models\/memories(?:\.js)?$/],
  ["@personal-os/core/memory/*", /^@personal-os\/core\/memory(?:\/|$)/],
];
const MEMORY_RELATIVE_SPECIFIER = /(?:^|\/)memories(?:\.js)?$/;

describe("memory never reaches an AI lane, another read model, or the worker (Checkpoint 10.7, Guard 6)", () => {
  const laneFiles = [...AI_LANE_DIRS.flatMap((dir) => walk(dir)), ...AI_ROUTE_FILES];
  const workerFiles = walk(WORKER_SRC);

  it("walks every AI lane, the three AI route files and the worker, so an empty directory cannot pass by finding nothing", () => {
    const rels = laneFiles.map(relToRepo);
    expect(rels).toContain("apps/api/src/intelligence/today-context.ts");
    expect(rels).toContain("apps/api/src/brief/collect-input.ts");
    expect(rels).toContain("apps/api/src/routes/ask.ts");
    expect(rels).toContain("apps/api/src/routes/focus.ts");
    expect(workerFiles.map(relToRepo)).toContain("apps/worker/src/jobs/retention-cleanup.ts");
  });

  it("no AI-lane file and no worker file imports the memory read model, core's memory helpers, or names a memory table", () => {
    const offenders: string[] = [];
    for (const file of [...laneFiles, ...workerFiles]) {
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_MEMORY_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${relToRepo(file)}: ${label}`);
        }
      }
      const code = stripLineComments(original);
      const identifier = MEMORY_TABLE_IDENTIFIER.exec(code);
      if (identifier) offenders.push(`${relToRepo(file)}: ${identifier[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no other read model imports, re-exports or names the memory module or tables (one-hop evasion)", () => {
    const offenders: string[] = [];
    const siblings = walk(READ_MODELS_DIR).filter((f) => f !== MEMORY_READ_MODEL);
    expect(siblings.map(relToRepo)).toContain("apps/api/src/read-models/today.ts");
    expect(siblings.map(relToRepo)).toContain("apps/api/src/read-models/reminders.ts");
    for (const file of siblings) {
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        if (MEMORY_RELATIVE_SPECIFIER.test(specifier) || /core\/memory/.test(specifier)) {
          offenders.push(`${relToRepo(file)}: ${specifier}`);
        }
      }
      const code = stripLineComments(original);
      const reexport = /export\s+(?:\*|\{[^}]*\})\s+from\s*["'][^"']*memories[^"']*["']/.exec(code);
      if (reexport) offenders.push(`${relToRepo(file)}: ${reexport[0]}`);
      // user-export.ts is the ONE sibling allowed to name the table: GET /export
      // carries memories as user-authored core (ADR-059/077 §2), and Guard 2
      // already lists it as a reviewed body reader.
      if (relToRepo(file) === "apps/api/src/read-models/user-export.ts") continue;
      const identifier = MEMORY_TABLE_IDENTIFIER.exec(code);
      if (identifier) offenders.push(`${relToRepo(file)}: ${identifier[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the memory read model and routes import neither the AI SDK, the provider package, nor an AI lane", () => {
    const offenders: string[] = [];
    for (const file of [MEMORY_READ_MODEL, ...MEMORY_ROUTES]) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      for (const [label, pattern] of FORBIDDEN_ACADEMIC_LANE_IMPORTS) {
        if (pattern.test(code)) offenders.push(`${relToRepo(file)}: ${label}`);
      }
      // ADR-077 §6: memory never rides a job or a push. The memory route set
      // has no reason to touch the queue at all. Every enqueue in this
      // codebase goes through `app.boss.*` or a `pg-boss` import, so those
      // are the tokens denied -- not a bare `.send(`, which would also match
      // Fastify's `reply.send`.
      if (/\bboss\b|pg-boss|NOTIFICATIONS_DISPATCH_QUEUE|_QUEUE\b/.test(code)) {
        offenders.push(`${relToRepo(file)}: queue`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the memory read model contains no write verb -- writes live in the routes, reads in the projection", () => {
    const code = stripLineComments(readFileSync(MEMORY_READ_MODEL, "utf8"));
    const offenders: string[] = [];
    for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_WRITE_VERBS) {
      if (pattern.test(code)) offenders.push(label);
    }
    expect(offenders).toEqual([]);
  });

  it("actually reads the memory read model, so a moved file cannot pass vacuously", () => {
    const all = importSpecifiers(readFileSync(MEMORY_READ_MODEL, "utf8"));
    expect(all).toContain("@personal-os/db");
    const code = stripLineComments(readFileSync(MEMORY_READ_MODEL, "utf8"));
    for (const binding of MEMORY_TABLE_BINDINGS) expect(code).toContain(binding);
  });
});

// ===========================================================================
// GUARD 7 -- the Action Framework never reaches an AI lane, and the executor
// never reaches a model, a memory, a credential or a queue (Checkpoint 10.8,
// ADR-078 §7).
// ===========================================================================
//
// Two directions, plus the worker, like Guards 5 and 6:
//   (a) no AI lane, AI route file, other read model or worker file may import
//       an action module or name an action table / registry binding -- so no
//       model output can become an action request, and no job can execute one;
//   (b) the action modules (registry types, handlers, service, routes, read
//       model) import neither the AI SDK, a provider package, a memory module
//       nor an AI lane, name no credential/consent/device table, and carry no
//       enqueue token -- the one thing that may leave the process (a linked
//       calendar push) runs through services/events.ts after commit.
const ACTIONS_DIR = path.join(API_SRC, "actions");
const ACTIONS_READ_MODEL = path.join(API_SRC, "read-models/actions.ts");
const ACTIONS_ROUTES = [
  path.join(API_SRC, "routes/actions.ts"),
  path.join(API_SRC, "routes/permissions.ts"),
];
const ACTION_TABLE_BINDINGS = ["actionRequests", "permissionGrants"] as const;
const ACTION_TABLE_NAMES = ["action_requests", "permission_grants"] as const;
const ACTION_REGISTRY_BINDINGS = ["ACTION_REGISTRY", "ACTION_HANDLERS", "ACTION_IDS"] as const;
const ACTION_IDENTIFIER = new RegExp(
  `\\b(?:${[...ACTION_TABLE_BINDINGS, ...ACTION_TABLE_NAMES, ...ACTION_REGISTRY_BINDINGS].join("|")})\\b`,
);
const FORBIDDEN_ACTION_SPECIFIERS: readonly [string, RegExp][] = [
  ["read-models/actions", /(?:^|\/)read-models\/actions(?:\.js)?$/],
  ["actions/*", /(?:^|\/)actions\/(?:service|handlers|types)(?:\.js)?$/],
  ["@personal-os/core/actions/*", /^@personal-os\/core\/actions(?:\/|$)/],
];
const ACTIONS_RELATIVE_SPECIFIER = /(?:^|\/)actions(?:\.js)?$/;
// The tables an action must never touch: consent switches, credentials,
// devices. Bindings and snake_case names both (the Guard 5 lesson).
const OFF_LIMITS_TABLE_IDENTIFIER =
  /\b(?:aiTaskRoutes|aiProviderConnections|aiModels|devicePairingCodes|calendarConnections|mailConnections|healthConnections|canvasConnections|ai_task_routes|ai_provider_connections|ai_models|device_pairing_codes|calendar_connections|mail_connections|health_connections|canvas_connections)\b/;
const OFF_LIMITS_DEVICES_IDENTIFIER =
  /\.from\(devices\)|\.insert\(devices\)|\.update\(devices\)|\.delete\(devices\)|\bdevices\.[a-z]/;

describe("the action framework never reaches an AI lane, and the executor never reaches a model, a memory, a credential or a queue (Checkpoint 10.8, Guard 7)", () => {
  const laneFiles = [...AI_LANE_DIRS.flatMap((dir) => walk(dir)), ...AI_ROUTE_FILES];
  const workerFiles = walk(WORKER_SRC);
  const actionFiles = [...walk(ACTIONS_DIR), ...ACTIONS_ROUTES, ACTIONS_READ_MODEL];

  it("walks every AI lane, the three AI route files, the worker and the action modules, so an empty directory cannot pass by finding nothing", () => {
    const rels = laneFiles.map(relToRepo);
    expect(rels).toContain("apps/api/src/intelligence/today-context.ts");
    expect(rels).toContain("apps/api/src/routes/ask.ts");
    expect(workerFiles.map(relToRepo)).toContain("apps/worker/src/jobs/retention-cleanup.ts");
    const actionRels = actionFiles.map(relToRepo);
    expect(actionRels).toContain("apps/api/src/actions/service.ts");
    expect(actionRels).toContain("apps/api/src/actions/handlers.ts");
    expect(actionRels).toContain("apps/api/src/routes/actions.ts");
    expect(actionRels).toContain("apps/api/src/read-models/actions.ts");
  });

  it("no AI-lane file and no worker file imports an action module or names an action table or registry", () => {
    const offenders: string[] = [];
    for (const file of [...laneFiles, ...workerFiles]) {
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_ACTION_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${relToRepo(file)}: ${label}`);
        }
      }
      const code = stripLineComments(original);
      const identifier = ACTION_IDENTIFIER.exec(code);
      if (identifier) offenders.push(`${relToRepo(file)}: ${identifier[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no other read model imports, re-exports or names the action module or tables (one-hop evasion)", () => {
    const offenders: string[] = [];
    const siblings = walk(READ_MODELS_DIR).filter((f) => f !== ACTIONS_READ_MODEL);
    expect(siblings.map(relToRepo)).toContain("apps/api/src/read-models/today.ts");
    for (const file of siblings) {
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        if (ACTIONS_RELATIVE_SPECIFIER.test(specifier) || /core\/actions/.test(specifier)) {
          offenders.push(`${relToRepo(file)}: ${specifier}`);
        }
      }
      const code = stripLineComments(original);
      const reexport = /export\s+(?:\*|\{[^}]*\})\s+from\s*["'][^"']*actions[^"']*["']/.exec(code);
      if (reexport) offenders.push(`${relToRepo(file)}: ${reexport[0]}`);
      // user-export.ts is the ONE sibling allowed to name the table: GET /export
      // carries the action audit summary (ADR-078 §4), and it does not import
      // the action read model.
      if (relToRepo(file) === "apps/api/src/read-models/user-export.ts") continue;
      const identifier = ACTION_IDENTIFIER.exec(code);
      if (identifier) offenders.push(`${relToRepo(file)}: ${identifier[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the action modules import neither the AI SDK, the provider package, a memory module nor an AI lane, name no credential/consent/device table, and carry no enqueue token", () => {
    const offenders: string[] = [];
    for (const file of actionFiles) {
      const original = readFileSync(file, "utf8");
      const code = stripLineComments(original);
      for (const [label, pattern] of FORBIDDEN_ACADEMIC_LANE_IMPORTS) {
        if (pattern.test(code)) offenders.push(`${relToRepo(file)}: ${label}`);
      }
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_MEMORY_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${relToRepo(file)}: ${label}`);
        }
      }
      const memory = MEMORY_TABLE_IDENTIFIER.exec(code);
      if (memory) offenders.push(`${relToRepo(file)}: ${memory[0]}`);
      const offLimits =
        OFF_LIMITS_TABLE_IDENTIFIER.exec(code) ?? OFF_LIMITS_DEVICES_IDENTIFIER.exec(code);
      if (offLimits) offenders.push(`${relToRepo(file)}: ${offLimits[0]}`);
      // Every enqueue in this codebase goes through `app.boss.*` or a
      // `pg-boss` import -- those are the tokens denied, never a bare
      // `.send(`, which would also match Fastify's `reply.send`.
      if (/\bboss\b|pg-boss|_QUEUE\b/.test(code)) offenders.push(`${relToRepo(file)}: queue`);
    }
    expect(offenders).toEqual([]);
  });

  it("the services the handlers call never WRITE a credential, consent or device table (one-hop evasion)", () => {
    // handlers.ts reaches its writes through apps/api/src/services/*, which
    // the walk above does not cover (10.8 review finding). services/events.ts
    // legitimately READS calendar_connections and calendar_connection_calendars
    // to resolve a write-eligible target; that is the whole allowlist, and a
    // write verb aimed at any off-limits table is denied outright.
    const servicesDir = path.join(API_SRC, "services");
    const files = walk(servicesDir).filter((f) => /\/services\/(?:events|tasks)\.ts$/.test(f));
    expect(files.map(relToRepo)).toEqual([
      "apps/api/src/services/events.ts",
      "apps/api/src/services/tasks.ts",
    ]);
    const READ_ALLOWED = new Set(["calendarConnections", "calendarConnectionCalendars"]);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripLineComments(readFileSync(file, "utf8"));
      const writeAimed =
        /\.(?:insert|update|delete)\(\s*(?:aiTaskRoutes|aiProviderConnections|aiModels|devices|devicePairingCodes|calendarConnections|calendarConnectionCalendars|mailConnections|healthConnections|canvasConnections|permissionGrants|actionRequests)\b/.exec(
          code,
        );
      if (writeAimed) offenders.push(`${relToRepo(file)}: ${writeAimed[0]}`);
      for (const match of code.matchAll(
        /\b(?:aiTaskRoutes|aiProviderConnections|aiModels|devicePairingCodes|calendarConnections|calendarConnectionCalendars|mailConnections|healthConnections|canvasConnections|permissionGrants|actionRequests)\b/g,
      )) {
        if (!READ_ALLOWED.has(match[0])) offenders.push(`${relToRepo(file)}: ${match[0]}`);
      }
      if (OFF_LIMITS_DEVICES_IDENTIFIER.test(code)) offenders.push(`${relToRepo(file)}: devices`);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("the action read model contains no write verb -- writes live in actions/service.ts", () => {
    const code = stripLineComments(readFileSync(ACTIONS_READ_MODEL, "utf8"));
    const offenders: string[] = [];
    for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_WRITE_VERBS) {
      if (pattern.test(code)) offenders.push(label);
    }
    expect(offenders).toEqual([]);
  });

  it("actually reads the action read model and the registry contract, so a moved file cannot pass vacuously", () => {
    const code = stripLineComments(readFileSync(ACTIONS_READ_MODEL, "utf8"));
    for (const binding of ACTION_TABLE_BINDINGS) expect(code).toContain(binding);
    const schema = readFileSync(path.join(REPO_ROOT, "packages/schema/src/actions.ts"), "utf8");
    expect(schema).toContain("ACTION_ID_VERB_PATTERN");
    expect(schema).toContain("requires_approval: z.literal(true)");
  });
});

// ===========================================================================
// GUARD 8 -- the Agent Gateway is a boundary, not a lane (Checkpoint 10.9,
// ADR-081). It may read through the intelligence builders and propose through
// the action service; it may never reach a model, a provider, a memory, a
// credential, health, mail or a queue, and it may never approve. And nothing
// may reach back into it.
// ===========================================================================
//
//   (a) the agent modules (agent/**, the two route files, the auth plugin, the
//       read model) import neither the AI SDK nor a provider package; no memory
//       module or table; no academic module or canvas table EXCEPT
//       agent/academic-tool.ts, the one projection ADR-070b permits, which only
//       agent/tools.ts may import (behind the `academic.read` check); no
//       health or mail read model or table; no credential / consent / device
//       table; no queue token; and never `approveActionRequest` or
//       `setPermissionGrant` -- an agent proposes, the owner approves, the
//       owner grants. Their only write verbs are aimed at `agents` and
//       `agentToolCalls`; the read model has none.
//   (b) no AI lane, AI route file, other read model or worker file imports an
//       agent module or names an agent table -- with ONE exemption: the
//       retention job may name `agentToolCalls` (30-day sweep), never `agents`.
//   (c) the second grant-mint site, `authorizeAgentRead`, is named by exactly
//       two non-test files: ask/authorize.ts (the definition) and
//       agent/tools.ts (the caller).
//   (d) routes/agent.ts is guarded by the AGENT token hook and never imports
//       the device hook; routes/devices.ts never imports the agent hook. The
//       two principals cannot share a route.
const AGENT_DIR = path.join(API_SRC, "agent");
const AGENT_ROUTES = [
  path.join(API_SRC, "routes/agent.ts"),
  path.join(API_SRC, "routes/agents.ts"),
];
const AGENT_PLUGIN = path.join(API_SRC, "plugins/agent-auth.ts");
const AGENT_READ_MODEL = path.join(API_SRC, "read-models/agents.ts");
const AGENT_ACADEMIC_TOOL = path.join(AGENT_DIR, "academic-tool.ts");
const AGENT_TOOLS = path.join(AGENT_DIR, "tools.ts");
const RETENTION_JOB = path.join(WORKER_SRC, "jobs/retention-cleanup.ts");
// `agentToolCalls`/`agent_tool_calls` as bare identifiers; `agents` only in a
// table position (`.from(agents)`, `agents.id`) because the bare word is
// ordinary prose in doc comments the line-comment stripper does not remove.
const AGENT_TOOL_CALLS_IDENTIFIER = /\b(?:agentToolCalls|agent_tool_calls)\b/;
const AGENTS_TABLE_IDENTIFIER =
  /\.from\(agents\)|\.insert\(agents\)|\.update\(agents\)|\.delete\(agents\)|\bagents\.[a-z]|\bfrom\s+agents\b|\binto\s+agents\b/;
const FORBIDDEN_AGENT_SPECIFIERS: readonly [string, RegExp][] = [
  ["agent/*", /(?:^|\/)agent\/[^/]+(?:\.js)?$/],
  ["routes/agent(s)", /(?:^|\/)routes\/agents?(?:\.js)?$/],
  ["read-models/agents", /(?:^|\/)read-models\/agents(?:\.js)?$/],
  ["plugins/agent-auth", /(?:^|\/)plugins\/agent-auth(?:\.js)?$/],
  ["@personal-os/core/agent-auth", /^@personal-os\/core\/agent-auth$/],
];
// What the gateway may NOT import: the model-calling half of every lane. The
// read-context/today-context builders and the grant module are the allowed
// exceptions, by design -- they are the same functions Ask calls.
const FORBIDDEN_GATEWAY_LANE_IMPORT =
  /from\s*["'](?:\.{1,2}\/)*(?:ask\/(?!authorize\.js["'])|focus\/|brief\/)[^"']*["']/;
const HEALTH_MAIL_TABLE_IDENTIFIER =
  /\b(?:healthConnections|healthDailyMetrics|healthObservations|healthSessions|healthOauthStates|healthMetricStreams|healthSyncRuns|mailConnections|mailMessages|mailDigests|mailSyncCursors|mailOauthStates|mailSyncRuns|health_connections|health_daily_metrics|health_observations|health_sessions|health_oauth_states|health_metric_streams|health_sync_runs|mail_connections|mail_messages|mail_digests|mail_sync_cursors|mail_oauth_states|mail_sync_runs)\b/;
const HEALTH_MAIL_READ_MODEL_SPECIFIER = /(?:^|\/)read-models\/(?:health|mail)[\w-]*(?:\.js)?$/;
const APPROVE_OR_GRANT = /\b(?:approveActionRequest|setPermissionGrant)\b/;
// A write verb whose argument is anything but the two agent tables.
const WRITE_VERB_ARGUMENT = /\.(insert|update|delete)\(\s*([A-Za-z_]+)/g;
const AGENT_WRITE_ALLOWED = new Set(["insert:agents", "insert:agentToolCalls", "update:agents"]);

describe("the Agent Gateway is a boundary, not a lane (Checkpoint 10.9, Guard 8)", () => {
  const laneFiles = [...AI_LANE_DIRS.flatMap((dir) => walk(dir)), ...AI_ROUTE_FILES];
  const workerFiles = walk(WORKER_SRC);
  // Tolerate the directory's absence in the walk so Guards 1-7 still run; the
  // non-vacuity case below is what fails when the gateway is missing.
  const agentFiles = [
    ...(existsSync(AGENT_DIR) ? walk(AGENT_DIR) : []),
    ...AGENT_ROUTES,
    AGENT_PLUGIN,
    AGENT_READ_MODEL,
  ].filter((file) => existsSync(file));

  it("walks the gateway, the routes, the plugin and the read model, so an empty directory cannot pass by finding nothing", () => {
    const rels = agentFiles.map(relToRepo);
    expect(rels).toContain("apps/api/src/agent/tools.ts");
    expect(rels).toContain("apps/api/src/agent/academic-tool.ts");
    expect(rels).toContain("apps/api/src/routes/agent.ts");
    expect(rels).toContain("apps/api/src/routes/agents.ts");
    expect(rels).toContain("apps/api/src/plugins/agent-auth.ts");
    expect(rels).toContain("apps/api/src/read-models/agents.ts");
    for (const file of agentFiles) expect(existsSync(file), relToRepo(file)).toBe(true);
  });

  it("(a) the gateway imports no model, provider, memory, academic (except its one projection), health, mail, credential or queue surface, and never approves or grants", () => {
    const offenders: string[] = [];
    for (const file of agentFiles) {
      const rel = relToRepo(file);
      const original = readFileSync(file, "utf8");
      const code = stripLineComments(original);
      for (const [label, pattern] of FORBIDDEN_ACADEMIC_LANE_IMPORTS) {
        if (label === "an AI lane") continue; // replaced by the narrower rule below
        if (pattern.test(code)) offenders.push(`${rel}: ${label}`);
      }
      if (FORBIDDEN_GATEWAY_LANE_IMPORT.test(code)) offenders.push(`${rel}: model-calling lane`);
      if (NAMESPACE_IMPORT_FROM_DB.test(code)) offenders.push(`${rel}: import * as db`);
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_MEMORY_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${rel}: ${label}`);
        }
        if (file !== AGENT_ACADEMIC_TOOL) {
          for (const [label, pattern] of FORBIDDEN_AI_LANE_SPECIFIERS) {
            if (pattern.test(specifier)) offenders.push(`${rel}: ${label}`);
          }
        }
        if (HEALTH_MAIL_READ_MODEL_SPECIFIER.test(specifier))
          offenders.push(`${rel}: ${specifier}`);
      }
      const memory = MEMORY_TABLE_IDENTIFIER.exec(code);
      if (memory) offenders.push(`${rel}: ${memory[0]}`);
      if (file !== AGENT_ACADEMIC_TOOL) {
        const canvas = CANVAS_TABLE_IDENTIFIER.exec(code);
        if (canvas) offenders.push(`${rel}: ${canvas[0]}`);
      }
      const healthMail = HEALTH_MAIL_TABLE_IDENTIFIER.exec(code);
      if (healthMail) offenders.push(`${rel}: ${healthMail[0]}`);
      const offLimits =
        OFF_LIMITS_TABLE_IDENTIFIER.exec(code) ?? OFF_LIMITS_DEVICES_IDENTIFIER.exec(code);
      if (offLimits) offenders.push(`${rel}: ${offLimits[0]}`);
      if (/\bboss\b|pg-boss|_QUEUE\b/.test(code)) offenders.push(`${rel}: queue`);
      const approve = APPROVE_OR_GRANT.exec(code);
      if (approve) offenders.push(`${rel}: ${approve[0]}`);
      for (const match of code.matchAll(WRITE_VERB_ARGUMENT)) {
        const key = `${match[1]}:${match[2]}`;
        if (!AGENT_WRITE_ALLOWED.has(key)) offenders.push(`${rel}: .${match[1]}(${match[2]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(a) the academic projection is imported by agent/tools.ts alone, and tools.ts gates every tool through READ_TOOL_PERMISSION", () => {
    const importers = walk(API_SRC).filter((file) =>
      importSpecifiers(readFileSync(file, "utf8")).some((s) =>
        /(?:^|\/)academic-tool(?:\.js)?$/.test(s),
      ),
    );
    expect(importers.map(relToRepo)).toEqual(["apps/api/src/agent/tools.ts"]);
    const tools = stripLineComments(readFileSync(AGENT_TOOLS, "utf8"));
    expect(tools).toContain("READ_TOOL_PERMISSION");
    expect(tools).toContain("isPermissionGranted(");
  });

  it("(a) the agent read model contains no write verb -- writes live in agent/service.ts", () => {
    const code = stripLineComments(readFileSync(AGENT_READ_MODEL, "utf8"));
    const offenders: string[] = [];
    for (const [label, pattern] of FORBIDDEN_INTELLIGENCE_WRITE_VERBS) {
      if (pattern.test(code)) offenders.push(label);
    }
    expect(offenders).toEqual([]);
    expect(code).toContain("agentToolCalls");
  });

  it("(b) no AI lane, AI route file, other read model or worker file imports an agent module or names an agent table", () => {
    const offenders: string[] = [];
    const siblings = walk(READ_MODELS_DIR).filter((f) => f !== AGENT_READ_MODEL);
    expect(siblings.map(relToRepo)).toContain("apps/api/src/read-models/today.ts");
    for (const file of [...laneFiles, ...workerFiles, ...siblings]) {
      const rel = relToRepo(file);
      const original = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(original)) {
        for (const [label, pattern] of FORBIDDEN_AGENT_SPECIFIERS) {
          if (pattern.test(specifier)) offenders.push(`${rel}: ${label}`);
        }
      }
      const code = stripLineComments(original);
      const reexport = /export\s+(?:\*|\{[^}]*\})\s+from\s*["'][^"']*\/agents?(?:\.js)?["']/.exec(
        code,
      );
      if (reexport) offenders.push(`${rel}: ${reexport[0]}`);
      if (AGENTS_TABLE_IDENTIFIER.test(code)) offenders.push(`${rel}: agents`);
      if (file === RETENTION_JOB) continue; // the one file that may name agentToolCalls
      const calls = AGENT_TOOL_CALLS_IDENTIFIER.exec(code);
      if (calls) offenders.push(`${rel}: ${calls[0]}`);
    }
    expect(offenders).toEqual([]);
    // The exemption is real, not vacuous: the sweep names the table.
    expect(stripLineComments(readFileSync(RETENTION_JOB, "utf8"))).toMatch(
      AGENT_TOOL_CALLS_IDENTIFIER,
    );
  });

  it("(c) authorizeAgentRead is named by exactly ask/authorize.ts and agent/tools.ts", () => {
    const namers = [...walk(API_SRC), ...walk(WORKER_SRC)]
      .filter((file) =>
        /\bauthorizeAgentRead\b/.test(stripLineComments(readFileSync(file, "utf8"))),
      )
      .map(relToRepo)
      .sort();
    expect(namers).toEqual(["apps/api/src/agent/tools.ts", "apps/api/src/ask/authorize.ts"]);
  });

  it("(d) the agent routes are agent-token-bound and the device routes are device-token-bound, never crossed", () => {
    const agentRoute = readFileSync(path.join(API_SRC, "routes/agent.ts"), "utf8");
    expect(agentRoute).toContain("agentAuthPreHandler");
    expect(agentRoute).not.toMatch(/deviceAuthPreHandler|device-auth/);
    expect(agentRoute).not.toMatch(/\/approve\b/);
    const devicesRoute = readFileSync(path.join(API_SRC, "routes/devices.ts"), "utf8");
    expect(devicesRoute).not.toMatch(/agentAuthPreHandler|agent-auth/);
    // The owner's agent-management routes are DEVICE-bound (ADR-082) and never agent-bound.
    const agentsRoute = readFileSync(path.join(API_SRC, "routes/agents.ts"), "utf8");
    expect(agentsRoute).toContain("deviceAuthPreHandler");
    expect(agentsRoute).not.toMatch(/agentAuthPreHandler/);
  });
});
