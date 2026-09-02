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
    const handler =
      comma < 0
        ? ""
        : args
            .slice(comma + 1)
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n")
            .trim();
    out.push({ queue, handler });
    cursor = end + 1;
  }
  return out;
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
  for (const wrapper of wrappers) {
    if (handler.includes(`${wrapper}(`)) return true;
  }
  const factory = /^(create\w+)\s*\(/.exec(handler)?.[1];
  if (factory === undefined) return false;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const defIndex = source.indexOf(`export function ${factory}(`);
    if (defIndex < 0) continue;
    // Bounded to this function's own text: from its declaration to the next
    // top-level `export function`, so a wrapper used by an unrelated neighbour
    // cannot make this one look contained.
    const nextExport = source.indexOf("\nexport function ", defIndex + 1);
    const body = source.slice(defIndex, nextExport < 0 ? undefined : nextExport);
    for (const wrapper of wrappers) {
      if (body.includes(`${wrapper}(`)) return true;
    }
    return false;
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
  CAPTURE_PARSE_QUEUE: true,
  OCCURRENCES_EXPAND_WINDOW_QUEUE: false,
  OCCURRENCES_GENERATE_LAZY_QUEUE: false,
  PTT_TRANSCRIBE_DEAD_QUEUE: false,
  PTT_TRANSCRIBE_QUEUE: true,
  NOTIFICATIONS_DISPATCH_DEAD_QUEUE: false,
  NOTIFICATIONS_DISPATCH_QUEUE: false,
  SWEEP_ORPHAN_AUDIO_QUEUE: false,
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
