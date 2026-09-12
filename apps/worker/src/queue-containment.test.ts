// Mechanical guard: every pg-boss handler's error-containment status is FROZEN.
//
// ===========================================================================
// WHAT THIS CATCHES, AND WHY A COMMENT COULD NOT
// ===========================================================================
//
// ADR-053 requires that a mail handler's provider errors never escape as prose:
// "every new handler is wrapped in a `withMailJobErrorContainment` before
// registration". Calendar, monitoring and the AI lanes have the same rule and
// their own wrappers. All four are conventions -- nothing enforced them, so the
// only thing standing between a new `boss.work(...)` and a provider error
// string reaching pg-boss's durable `job.output` was whoever reviewed the diff
// remembering that four such wrappers exist.
//
// Checkpoint 6.5 is the precedent for why that matters: provider-authored text
// reached a user's Settings screen through exactly this kind of unguarded path,
// and closing it took a seven-hop fix.
//
// ===========================================================================
// A RATCHET, NOT A BLANKET RULE
// ===========================================================================
//
// Most registrations are NOT contained and correctly so -- a cron tick whose
// whole body is "enqueue the real job" has no provider surface, and wrapping it
// would be cargo cult. So this does not demand containment everywhere. It
// freezes the CURRENT, DELIBERATE state of every registration and fails when
// that state changes: adding a queue, removing one, or flipping one from
// contained to uncontained all break the test until someone updates the
// expectation ON PURPOSE and says why in the diff.
//
// It is structural rather than a filename assertion: it reads index.ts, pulls
// out every `boss.work(...)` call with its handler expression, RESOLVES each
// handler factory to its own definition elsewhere in the tree, and asks whether
// that definition returns a containment wrapper. A factory that quietly stops
// wrapping fails here even though index.ts did not change.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every `with<Something>ErrorContainment` exported anywhere in the worker. */
function containmentWrappers(files: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /export function (with\w*ErrorContainment)\b/g,
    )) {
      found.add(match[1]!);
    }
  }
  return found;
}

/**
 * Every `boss.work(QUEUE, handler)` registration in index.ts, with the raw
 * handler expression.
 *
 * Balanced-paren scan rather than a regex over the whole call: several
 * registrations span multiple lines and carry nested calls, and a naive
 * `\(([^)]*)\)` stops at the first inner `)`.
 */
function registrations(indexSource: string): { queue: string; handler: string }[] {
  const out: { queue: string; handler: string }[] = [];
  const marker = "boss.work(";
  let cursor = 0;
  for (;;) {
    const start = indexSource.indexOf(marker, cursor);
    if (start < 0) break;
    let depth = 0;
    let end = start + marker.length - 1;
    for (let i = start + marker.length - 1; i < indexSource.length; i += 1) {
      const ch = indexSource[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = indexSource.slice(start + marker.length, end);
    const comma = args.indexOf(",");
    const queue = (comma < 0 ? args : args.slice(0, comma)).trim();
    // FULL-LINE COMMENTS ARE DROPPED before the handler is inspected. Several
    // registrations carry an explanatory comment BETWEEN the queue argument and
    // the handler, so the raw slice starts with `//` and every factory-name
    // match would fail -- reporting a properly-wrapped handler as uncontained.
    // This guard missed `MAIL_DIGEST_GENERATE_QUEUE` exactly that way when it
    // was first written. Whole lines only, so a `//` inside a string literal on
    // a line of real code cannot be corrupted.
    const handlerOrOptions =
      comma < 0
        ? ""
        : args
            .slice(comma + 1)
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n")
            .trim();
    // A LEADING WORK-OPTIONS OBJECT IS SKIPPED. `boss.work(queue, { includeMetadata:
    // true }, handler)` is a real pg-boss overload (Checkpoint 9.0's
    // expand-window dead-letter handler uses it), and without this the "handler"
    // would be the options literal, so a wrapped factory behind it would be
    // reported as uncontained -- silently, since `false` is a legal expectation.
    // Only a literal starting with `{` is treated as options; a factory call
    // never starts with one.
    const handler = handlerOrOptions.startsWith("{")
      ? handlerOrOptions.slice(handlerOrOptions.indexOf("},") + 2).trim()
      : handlerOrOptions;
    out.push({ queue, handler });
    cursor = end + 1;
  }
  return out;
}

/**
 * Source text with every comment removed: `/* ... *\/` blocks and `//` to end
 * of line. Applied to a factory's body BEFORE it is searched for a wrapper
 * call, because a comment is exactly where the wrapper's name is most likely
 * to appear without the wrapper being called -- a docblock explaining why the
 * factory is wrapped survives the edit that unwraps it. A guard that a comment
 * can satisfy is no guard; the review of Checkpoint 9.0 found one
 * (`expand-due-date-window.ts` quoted the literal match string in a comment,
 * and a mutation that removed the real call still passed).
 *
 * Line-based for `//`, so a `//` inside a string literal on a line of real
 * code cannot corrupt that line: only text from the FIRST `//` on a line is
 * dropped, and the wrapper call this file looks for never follows one.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const slash = line.indexOf("//");
      return slash < 0 ? line : line.slice(0, slash);
    })
    .join("\n");
}

/** Whether a factory's own (comment-stripped) definition calls a wrapper. */
function bodyReachesWrapper(body: string, wrappers: ReadonlySet<string>): boolean {
  const code = stripComments(body);
  for (const wrapper of wrappers) {
    if (code.includes(`${wrapper}(`)) return true;
  }
  return false;
}

/** A factory's own text: from its declaration to the next top-level export. */
function factoryBody(source: string, factory: string): string | null {
  const defIndex = source.indexOf(`export function ${factory}(`);
  if (defIndex < 0) return null;
  // Bounded to this function's own text: from its declaration to the next
  // top-level `export function`, so a wrapper used by an unrelated neighbour
  // cannot make this one look contained.
  const nextExport = source.indexOf("\nexport function ", defIndex + 1);
  return source.slice(defIndex, nextExport < 0 ? undefined : nextExport);
}

/**
 * Whether a registration's handler reaches a containment wrapper.
 *
 * An INLINE arrow handler is reported as uncontained, which is honest: it has no
 * factory to inspect and its body is visible right there in index.ts.
 *
 * A FACTORY handler is resolved by name across the worker tree and its
 * definition is searched for a wrapper call. That is the part a filename
 * assertion could not do -- it follows the indirection.
 */
function isContained(
  handler: string,
  files: readonly string[],
  wrappers: ReadonlySet<string>,
): boolean {
  if (bodyReachesWrapper(handler, wrappers)) return true;
  const factory = /^(create\w+)\s*\(/.exec(handler)?.[1];
  if (factory === undefined) return false;

  for (const file of files) {
    const body = factoryBody(readFileSync(file, "utf8"), factory);
    if (body === null) continue;
    return bodyReachesWrapper(body, wrappers);
  }
  return false;
}

// ---------------------------------------------------------------------------
// THE FROZEN EXPECTATION.
//
// `true` = the handler reaches a containment wrapper. Changing any value, or
// adding/removing a queue, is a deliberate act that must be made in this file
// alongside the change that caused it.
// ---------------------------------------------------------------------------
const EXPECTED_CONTAINMENT: Readonly<Record<string, boolean>> = {
  HEARTBEAT_QUEUE: false,
  // Dead-letter handlers are NOT containment-wrapped, consistently with every
  // other *_DEAD_QUEUE: they make no provider call, so there is no provider
  // error to contain. Checkpoint 8.6A.
  CAPTURE_PARSE_DEAD_QUEUE: false,
  CAPTURE_PARSE_QUEUE: true,
  // Checkpoint 9.0: both occurrences lanes are now contained
  // (withOccurrencesJobErrorContainment). They make no provider call, but a
  // raw throw here carried the user's own data -- packages/core's recurrence
  // errors interpolate the RRULE text, and a `pg` unique/CHECK violation's
  // `detail` is the whole occurrence row -- into pgboss.job.output and, on
  // exhaustion, onto the dead-letter job. Their dead-letter handlers are
  // uncontained like every other *_DEAD_QUEUE.
  OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE: false,
  OCCURRENCES_EXPAND_WINDOW_QUEUE: true,
  OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE: false,
  OCCURRENCES_GENERATE_LAZY_QUEUE: true,
  PTT_TRANSCRIBE_DEAD_QUEUE: false,
  PTT_TRANSCRIBE_QUEUE: true,
  NOTIFICATIONS_DISPATCH_DEAD_QUEUE: false,
  NOTIFICATIONS_DISPATCH_QUEUE: false,
  SWEEP_ORPHAN_AUDIO_QUEUE: false,
  // No provider/external-API surface -- every statement is a plain timestamp
  // comparison against this project's own database, and retention-cleanup.ts
  // already reduces any underlying error to a bare table name via its own
  // `RetentionCleanupError`, never a message. Checkpoint 8.6C.
  RETENTION_CLEANUP_QUEUE: false,
  CALENDAR_REFRESH_TOKEN_DEAD_QUEUE: false,
  CALENDAR_REFRESH_TOKEN_QUEUE: true,
  CALENDAR_SYNC_CALENDAR_QUEUE: true,
  CALENDAR_SYNC_CALENDAR_DEAD_QUEUE: false,
  CALENDAR_PUSH_EVENT_DEAD_QUEUE: false,
  CALENDAR_PUSH_EVENT_QUEUE: true,
  CALENDAR_SYNC_CRON_QUEUE: false,
  CALENDAR_REFRESH_CRON_QUEUE: false,
  HEALTH_SYNC_CONNECTION_QUEUE: false,
  HEALTH_SYNC_CRON_QUEUE: false,
  MAIL_SYNC_CONNECTION_QUEUE: true,
  MAIL_SYNC_CRON_QUEUE: false,
  MAIL_DIGEST_GENERATE_QUEUE: true,
  MAIL_DIGEST_CRON_QUEUE: false,
  MONITOR_RUN_QUEUE: true,
  MONITOR_CRON_QUEUE: false,
};

describe("pg-boss handler containment", () => {
  const files = sourceFiles(SRC);
  const wrappers = containmentWrappers(files);
  const indexSource = readFileSync(join(SRC, "index.ts"), "utf8");
  const found = registrations(indexSource);

  it("finds the containment wrappers the repo actually defines", () => {
    // If a wrapper is renamed or deleted, everything below silently reports
    // "uncontained" and the ratchet would fail loudly for the wrong reason.
    expect(wrappers.size).toBeGreaterThanOrEqual(4);
    expect(wrappers).toContain("withMailJobErrorContainment");
    expect(wrappers).toContain("withCalendarJobErrorContainment");
    expect(wrappers).toContain("withMonitorJobErrorContainment");
    expect(wrappers).toContain("withAiJobErrorContainment");
    expect(wrappers).toContain("withOccurrencesJobErrorContainment");
  });

  it("does not let a comment stand in for the wrapper call", () => {
    // The failure this prevents: the containment wrapper is removed from a
    // factory (or the factory is refactored into a bare arrow) while its
    // explanatory comment, which names the wrapper, is left standing -- and
    // the frozen `true` for that queue keeps passing. Both comment forms, and
    // the exact real shape that was found satisfiable in review.
    const wrappersUnderTest = new Set(["withOccurrencesJobErrorContainment"]);
    const commentOnly = [
      "export function createX(db: Db) {\n" +
        "  // matches the literal text `withOccurrencesJobErrorContainment(`.\n" +
        "  return (async () => {\n    await run(db);\n  });\n}\n",
      "export function createX(db: Db) {\n" +
        "  /* was wrapped in withOccurrencesJobErrorContainment(queue, ...) */\n" +
        "  return async () => run(db);\n}\n",
    ];
    for (const body of commentOnly) {
      expect(bodyReachesWrapper(body, wrappersUnderTest)).toBe(false);
    }
    // And the real thing still resolves as contained, comment and all.
    const real =
      "export function createX(db: Db) {\n" +
      "  // matches the wrapper's call expression textually.\n" +
      "  return withOccurrencesJobErrorContainment(QUEUE, async () => {\n" +
      "    await run(db);\n  });\n}\n";
    expect(bodyReachesWrapper(real, wrappersUnderTest)).toBe(true);
    // The exact file the review found: its comment no longer reproduces the
    // match string, and its code does.
    const source = readFileSync(join(SRC, "jobs/expand-due-date-window.ts"), "utf8");
    const body = factoryBody(source, "createExpandDueDateWindowHandler");
    expect(body).not.toBeNull();
    expect(stripComments(body!)).toContain("withOccurrencesJobErrorContainment(");
    expect(bodyReachesWrapper(body!, wrappersUnderTest)).toBe(true);
    // Mutation: with the real call removed, the same comments remain and the
    // guard must now say uncontained.
    const mutated = body!.replace(/withOccurrencesJobErrorContainment\(/g, "(");
    expect(bodyReachesWrapper(mutated, wrappersUnderTest)).toBe(false);
  });

  it("registers every queue exactly once", () => {
    const queues = found.map((r) => r.queue);
    expect(new Set(queues).size).toBe(queues.length);
  });

  it("matches the frozen containment map exactly", () => {
    const actual = Object.fromEntries(
      found.map((r) => [r.queue, isContained(r.handler, files, wrappers)]),
    );
    // Compared as whole objects so a NEW registration fails as a missing key
    // rather than slipping through an every()-style check.
    expect(actual).toEqual(EXPECTED_CONTAINMENT);
  });
});
