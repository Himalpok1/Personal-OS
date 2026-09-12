import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { monitorKey, monitorTargetKey } from "./monitor";

// This app has no render harness (see `ask.test.ts`'s own note on the same
// constraint), and every mutation hook here calls `useQueryClient()`, which
// needs a live `QueryClientProvider` React tree to run at all -- so, like
// `ask.test.ts`'s "useAskCloud is wired through useMutation" block, the
// invalidation contract below is pinned by reading the module's own source
// rather than by rendering it. What CAN run as ordinary unit tests is the
// query-key shape, which is pure.

describe("monitor query keys", () => {
  it("monitorKey is the shared invalidation prefix every mutation targets", () => {
    expect(monitorKey).toEqual(["monitor"]);
  });

  it("monitorTargetKey nests a specific target's id under that same prefix", () => {
    expect(monitorTargetKey("abc-123")).toEqual(["monitor", "targets", "abc-123"]);
  });

  it("two different ids never collide", () => {
    expect(monitorTargetKey("a")).not.toEqual(monitorTargetKey("b"));
  });
});

describe("every monitor CRUD mutation invalidates the shared ['monitor'] prefix", () => {
  const source = readFileSync(fileURLToPath(new URL("./monitor.ts", import.meta.url)), "utf8");

  it("useInvalidateMonitor invalidates exactly monitorKey, not a narrower slice", () => {
    expect(source).toMatch(
      /function useInvalidateMonitor\(\)[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*monitorKey\s*\}\)/,
    );
  });

  // Checkpoint 8.6D added five of these; useAcknowledgeMonitorIncident already
  // existed (Checkpoint 7.6) and is included so a future edit that
  // accidentally narrows ITS invalidation is caught here too.
  const mutationHookNames = [
    "useCreateMonitorTarget",
    "useUpdateMonitorTarget",
    "useEnableMonitorTarget",
    "useDisableMonitorTarget",
    "useArchiveMonitorTarget",
    "useAcknowledgeMonitorIncident",
  ];

  it.each(mutationHookNames)(
    "%s calls useMutation and routes onSuccess through useInvalidateMonitor",
    (name) => {
      const pattern = new RegExp(
        `export function ${name}\\([^\\n]*\\)[\\s\\S]*?useInvalidateMonitor\\(\\)[\\s\\S]*?useMutation\\([\\s\\S]*?onSuccess: invalidate`,
      );
      expect(source).toMatch(pattern);
    },
  );

  it("defines exactly the expected number of monitor mutation hooks", () => {
    const exportedMutationHooks = source.match(/export function use\w+\(\)/g) ?? [];
    // useMonitorOverview / useMonitorTarget / useMonitorIncidents are queries,
    // not mutations, and useMonitorTarget takes an argument so it does not
    // match this zero-arg pattern anyway -- this count is a belt-and-suspenders
    // check that no 7th mutation hook was added without also being listed
    // (and therefore tested) above.
    const mutationOnly = exportedMutationHooks.filter(
      (decl) => !decl.includes("useMonitorOverview") && !decl.includes("useMonitorIncidents"),
    );
    expect(mutationOnly.length).toBe(mutationHookNames.length);
  });
});
