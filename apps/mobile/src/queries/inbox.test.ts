import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INBOX_COMMIT_POLL_INTERVAL_MS,
  INBOX_COMMIT_POLL_MAX,
  inboxItemKey,
  inboxKey,
  inboxListKey,
} from "./inbox";

// Same constraint monitor.test.ts records: no render harness, and every
// mutation hook calls useQueryClient(), so the wiring is pinned by reading the
// module source while the key shapes -- which are pure -- run as unit tests.

describe("inbox query keys", () => {
  it("inboxKey is the prefix every other inbox key extends and every outside invalidation uses", () => {
    expect(inboxKey).toEqual(["inbox"]);
    expect(inboxListKey({ status: "pending" }).slice(0, 1)).toEqual(inboxKey);
    expect(inboxItemKey("abc").slice(0, 1)).toEqual(inboxKey);
  });

  it("list and item keys never collide, and two items never collide", () => {
    expect(inboxListKey({})).not.toEqual(inboxItemKey(""));
    expect(inboxItemKey("a")).not.toEqual(inboxItemKey("b"));
  });

  it("the list key carries its params, so the default list and a filtered one are cached apart", () => {
    // include_archived (Checkpoint 9.3, contract 6) rides through the same
    // params object, so the archived and default lists never share a cache entry.
    expect(inboxListKey({ status: "failed" })).not.toEqual(inboxListKey({}));
  });

  it("commit polling is bounded to at most 30 seconds", () => {
    expect(INBOX_COMMIT_POLL_INTERVAL_MS * INBOX_COMMIT_POLL_MAX).toBeLessThanOrEqual(30_000);
  });
});

describe("mutation wiring", () => {
  const source = readFileSync(fileURLToPath(new URL("./inbox.ts", import.meta.url)), "utf8");

  it("useArchiveInboxItem calls the archive endpoint (never a delete) and invalidates the inbox prefix", () => {
    expect(source).toMatch(
      /export function useArchiveInboxItem\(\)[\s\S]*?useMutation\([\s\S]*?api\.archiveInboxItem\(id\)[\s\S]*?onSuccess: invalidate/,
    );
    expect(source).not.toMatch(/deleteInboxItem/);
  });

  it("useConfirmInboxItem forwards the optional corrected_tool_call body", () => {
    expect(source).toMatch(/api\.confirmInboxItem\(id, body\)/);
  });

  it("both mutations invalidate Today, whose attention counts change with either", () => {
    expect(source).toMatch(/invalidateQueries\(\{ queryKey: \["today"\] \}\)/);
    expect(source).toMatch(/invalidateQueries\(\{ queryKey: inboxKey \}\)/);
  });

  it("useInboxItem exposes refetchInterval only through the options seam, defaulting off", () => {
    expect(source).toMatch(/refetchInterval: options\.refetchIntervalMs \?\? false/);
  });
});
