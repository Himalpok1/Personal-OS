import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A guard, not an audit.
//
// `docs/STATUS.md` records "worker top-level console.error lacks serializer
// discipline" as standing debt. Checkpoint 7.3 does not clear that debt across
// the whole process -- the remaining call sites live in health/orchestrate.ts
// and three older job modules, and health sync is explicitly outside this
// checkpoint's scope. What 7.3 DOES do is make the debt unable to grow: every
// pre-existing site is pinned by count below, so adding one anywhere fails
// here, and the mail lane is required to have none at all.
//
// A count rather than a line number, deliberately: line numbers churn on every
// unrelated edit, and a test that has to be updated for reasons unrelated to
// what it guards is a test people learn to update without reading.

const SRC = path.resolve(import.meta.dirname);

/**
 * The REAL sanctioned sink, since Checkpoint 8.6B ported it to
 * `@personal-os/core/logging/logger` so `apps/api` could share it (see that
 * module and `./logger.ts`, now a re-export shim with no console call of its
 * own). Resolved relative to this file rather than assumed, and reached across
 * the package boundary via plain fs -- the same cross-directory scanning
 * `apps/worker/src/mobile-inert-rendering.test.ts` already uses to enforce a
 * boundary that lives outside its own package.
 */
const PORTED_LOGGER_PATH = path.resolve(
  fileURLToPath(new URL("../../../packages/core/src/logging/logger.ts", import.meta.url)),
);

/**
 * Pre-existing `console.*` call sites, frozen at Checkpoint 7.3.
 *
 * Each of these predates the logger and lives in a module this checkpoint is
 * not authorised to touch. Reducing a count is always fine; raising one, or
 * adding a file, is not.
 */
const PRE_EXISTING: Readonly<Record<string, number>> = {
  "health/orchestrate.ts": 3,
  "jobs/capture-parse.ts": 1,
  // "jobs/generate-lazy-occurrence.ts" held 4 until Checkpoint 9.0 moved every
  // one of them onto the structured logger; the entry is removed rather than
  // zeroed so a reintroduced call fails as an UNEXPECTED file, not as a count.
  "jobs/ptt-transcribe.ts": 3,
  "jobs/sweep-orphan-audio.ts": 1,
};

/** The one sanctioned sink. */
const SANCTIONED = "logger.ts";

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    acc.push(full);
  }
  return acc;
}

function countConsoleCalls(contents: string): number {
  return contents.match(/\bconsole\.(log|info|warn|error|debug|trace)\s*\(/g)?.length ?? 0;
}

function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === SANCTIONED) continue;
    const count = countConsoleCalls(readFileSync(file, "utf8"));
    if (count > 0) counts.set(rel, count);
  }
  return counts;
}

describe("raw console usage in apps/worker", () => {
  it("has no console call anywhere in the mail lane", () => {
    // The hard rule. Mail metadata is the first attacker-authored input to
    // reach this process (ADR-054), and a `console.error("...", err)` on a path
    // holding a message payload would put a subject line in a log in one call.
    const offenders = [...scan().keys()].filter((rel) => rel.startsWith("mail/"));
    expect(offenders).toEqual([]);
  });

  it("has not grown a new console call site outside the frozen set", () => {
    const found = scan();
    const unexpected = [...found.entries()]
      .filter(([rel]) => !(rel in PRE_EXISTING))
      .map(([rel, count]) => `${rel} (${count})`);
    expect(unexpected).toEqual([]);
  });

  it("has not increased the count at any pre-existing site", () => {
    const found = scan();
    const grown: string[] = [];
    for (const [rel, allowed] of Object.entries(PRE_EXISTING)) {
      const actual = found.get(rel) ?? 0;
      if (actual > allowed) grown.push(`${rel}: ${allowed} -> ${actual}`);
    }
    expect(grown).toEqual([]);
  });

  it("finds the sanctioned sink exactly where it is supposed to be", () => {
    // A guard on the guard: if the ported logger stopped containing a console
    // call the scan would still pass while nothing was being written anywhere,
    // and the exclusion above would be silently pointless. Checkpoint 8.6B
    // moved the real call out of this directory entirely (into
    // @personal-os/core/logging/logger, shared with apps/api), so the local
    // shim is expected to hold zero -- this asserts the call exists at its new
    // home instead of assuming the port preserved it.
    const contents = readFileSync(PORTED_LOGGER_PATH, "utf8");
    expect(countConsoleCalls(contents)).toBeGreaterThan(0);
  });

  it("the local shim itself carries no console call of its own", () => {
    const contents = readFileSync(path.join(SRC, SANCTIONED), "utf8");
    expect(countConsoleCalls(contents)).toBe(0);
  });

  it("scans real files, so a broken walker cannot pass by finding nothing", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });
});
