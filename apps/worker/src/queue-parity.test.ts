import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// apps/api and apps/worker each keep their own copy of the queue vocabulary.
//
// THAT DUPLICATION IS DELIBERATE AND IS NOT WHAT THIS TEST ARGUES WITH. The two
// processes share an interface through Postgres and pg-boss, not through code
// (docs/ARCHITECTURE.md), and a shared package would make the HTTP app's build
// depend on the worker's module graph for the sake of a dozen string literals.
//
// WHAT THE DUPLICATION COSTS, AND WHY IT NEEDS A GUARD:
//
// pg-boss's `create_queue` is `INSERT ... ON CONFLICT DO NOTHING`. Whichever
// process starts first WINS THE QUEUE'S OPTIONS, and the later call is silently
// ignored -- no error, no warning, no log line. So if the two files disagree,
// the effective configuration depends on boot order:
//
//   * a name that differs by one character produces two queues, one of which
//     nobody is listening to, and jobs sent to it sit `created` forever;
//   * `policy: "stately"` present in the worker and absent in the API means an
//     API-first boot silently discards the per-connection depth bound, and a
//     "sync now" storm becomes unbounded queue growth;
//   * a `retryLimit` mismatch on the mail or health queue re-introduces exactly
//     the `stately` retry-drop interaction that `retryLimit: 0` exists to
//     remove.
//
// None of those fail loudly. All of them are one careless edit away, because
// the two files are edited from different checkpoints and nothing has ever
// compared them. This test compares them.
//
// It reads the files as TEXT rather than importing apps/api, because apps/api
// is not a dependency of apps/worker and must not become one just to be tested.

const WORKER = path.resolve(import.meta.dirname, "queue-names.ts");
const API = path.resolve(import.meta.dirname, "../../api/src/queue-names.ts");

/** `export const NAME = "value";` -> { NAME: "value" } */
function parseConstants(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export const ([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*;/g;
  for (const match of source.matchAll(re)) out.set(match[1]!, match[2]!);
  return out;
}

/**
 * Extracts the `QUEUE_RETRY_OPTIONS` body and returns, per queue CONSTANT NAME,
 * its options with comments and whitespace removed.
 *
 * Deliberately compares the normalized SOURCE of each entry rather than
 * evaluating it: evaluating would mean executing one app's module inside the
 * other's test, and the thing under test is whether the two texts say the same
 * thing.
 */
function parseRetryOptions(source: string): Map<string, string> {
  const start = source.indexOf("export const QUEUE_RETRY_OPTIONS = {");
  if (start === -1) throw new Error("QUEUE_RETRY_OPTIONS not found");
  const body = source.slice(start);

  const out = new Map<string, string>();
  const re = /\[([A-Z][A-Z0-9_]*)\]:\s*(\{[\s\S]*?\})\s*,/g;
  for (const match of body.matchAll(re)) {
    const normalized = match[2]!
      // Strip line comments before collapsing whitespace, or a `//` comment
      // would swallow the rest of the entry.
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "")
      .replace(/,}/g, "}");
    out.set(match[1]!, normalized);
  }
  return out;
}

const workerSource = readFileSync(WORKER, "utf8");
const apiSource = readFileSync(API, "utf8");

const workerConstants = parseConstants(workerSource);
const apiConstants = parseConstants(apiSource);
const workerOptions = parseRetryOptions(workerSource);
const apiOptions = parseRetryOptions(apiSource);

describe("queue-name parity between apps/api and apps/worker", () => {
  it("parsed something from both files, so an empty comparison cannot pass", () => {
    // Without this, a regex that stopped matching would make every assertion
    // below trivially true -- the classic way a parity test dies quietly.
    expect(workerConstants.size).toBeGreaterThan(10);
    expect(apiConstants.size).toBeGreaterThan(10);
    expect(workerOptions.size).toBeGreaterThan(5);
    expect(apiOptions.size).toBeGreaterThan(5);
  });

  it("gives every shared constant the same queue name", () => {
    const mismatches: string[] = [];
    for (const [name, workerValue] of workerConstants) {
      const apiValue = apiConstants.get(name);
      if (apiValue !== undefined && apiValue !== workerValue) {
        mismatches.push(`${name}: worker="${workerValue}" api="${apiValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("gives every shared queue identical options", () => {
    const mismatches: string[] = [];
    for (const [name, workerEntry] of workerOptions) {
      const apiEntry = apiOptions.get(name);
      if (apiEntry !== undefined && apiEntry !== workerEntry) {
        mismatches.push(`${name}: worker=${workerEntry} api=${apiEntry}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("never lets two different constants resolve to the same queue name", () => {
    // A copy-paste that renames the constant but not the string produces two
    // handlers on one queue, which is far harder to diagnose than a typo.
    for (const constants of [workerConstants, apiConstants]) {
      const seen = new Map<string, string>();
      for (const [name, value] of constants) {
        const previous = seen.get(value);
        expect(previous, `"${value}" is declared by both ${previous} and ${name}`).toBeUndefined();
        seen.set(value, name);
      }
    }
  });

  it("declares the mail sync queue identically in both processes", () => {
    // Named explicitly rather than left to the generic sweep: this is the queue
    // Checkpoint 7.3 adds, and its `policy: "stately"` + `retryLimit: 0` pair is
    // exactly the configuration an API-first boot would silently discard if the
    // two files disagreed.
    expect(workerConstants.get("MAIL_SYNC_CONNECTION_QUEUE")).toBe("mail.gmail.sync-connection");
    expect(apiConstants.get("MAIL_SYNC_CONNECTION_QUEUE")).toBe("mail.gmail.sync-connection");

    const entry = workerOptions.get("MAIL_SYNC_CONNECTION_QUEUE");
    expect(entry).toBe(apiOptions.get("MAIL_SYNC_CONNECTION_QUEUE"));
    expect(entry).toContain('policy:"stately"');
    expect(entry).toContain("retryLimit:0");
    expect(entry).toContain("expireInSeconds:900");
  });

  it("keeps every dead-letter constant paired with a primary queue", () => {
    // pg-boss enforces a foreign key from queue.dead_letter to queue.name, so a
    // dead-letter name with no primary is a queue nothing can ever route into.
    for (const [name, value] of workerConstants) {
      if (!name.endsWith("_DEAD_QUEUE")) continue;
      const primary = name.replace(/_DEAD_QUEUE$/, "_QUEUE");
      expect(workerConstants.get(primary), `${name} has no primary`).toBeDefined();
      expect(value).toBe(`${workerConstants.get(primary)!}.dead`);
    }
  });
});
