// Mechanical guard: nothing server-only may reach the Expo bundle.
//
// ===========================================================================
// THE FAILURE CLASS THIS EXISTS FOR: TYPECHECKS, THEN BREAKS AT RUNTIME
// ===========================================================================
//
// `tsc` resolves `@personal-os/db` from apps/mobile perfectly happily -- the
// types are real and the import is valid TypeScript. What it cannot know is that
// the module imports `pg`, or that `@personal-os/core`'s BARREL re-exports
// recurrence and device-auth, which reach `node:module` and `node:crypto`.
//
// So the failure lands in Metro or in the browser, not in the compiler: a bundle
// error, or worse, a runtime crash on a screen nobody opened during review.
// AGENTS.md states the rule in prose --
//
//   "`packages/db`, `packages/ai-providers`, `packages/calendar-providers` and
//    `packages/health-providers` are server-only ... and must never reach the
//    Expo bundle. `packages/core` is mixed: its barrel re-exports Node-only
//    recurrence and device-auth modules, so client-reachable code imports the
//    deep subpaths its `exports` map exposes ... never the barrel."
//
// -- and until now nothing enforced it. This is that enforcement.
//
// It is structural rather than a filename assertion: it reads every source file
// under apps/mobile/src and inspects the actual module specifiers, so it catches
// a new import in a file that did not exist when this was written.
// ===========================================================================
// WHY THIS TEST LIVES IN apps/worker AND NOT IN apps/mobile
// ===========================================================================
//
// It has to read files, which means `node:fs` -- and apps/mobile's tsconfig
// deliberately provides NO Node type definitions, so the import does not
// compile there. That is not an obstacle to work around; it is the boundary
// this test enforces, showing up one level higher. A guard that needed Node
// types inside the mobile package would have had to weaken the very
// configuration that keeps Node APIs out of the bundle.
//
// apps/worker already hosts the sibling structural guard
// (queue-containment.test.ts), has Node types, and is where the repo's other
// source-analysis tests live. The path below walks UP out of the worker and
// into apps/mobile/src, which is the only coupling.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../mobile/src/", import.meta.url));

/**
 * Packages that import `pg` or a `node:` builtin and therefore must never be
 * bundled for a device or a browser.
 *
 * `@personal-os/monitoring` is deliberately ABSENT: it is pure probe/threshold
 * logic with no Node dependency. Listing it would be over-broad, and a guard
 * that forbids more than the rule does is one somebody eventually deletes.
 */
const SERVER_ONLY_PACKAGES = [
  "@personal-os/db",
  "@personal-os/ai-providers",
  "@personal-os/calendar-providers",
  "@personal-os/health-providers",
  "@personal-os/mail-providers",
] as const;

/** Node builtins, which have no implementation in the Expo/web runtime. */
const NODE_BUILTIN = /^node:/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every module specifier a file imports.
 *
 * Covers static `from "..."`, bare side-effect `import "..."`, dynamic
 * `import("...")` and `require("...")`, because a server-only package reaches
 * the bundle identically through any of them.
 */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

interface Offence {
  file: string;
  specifier: string;
  reason: string;
}

describe("mobile bundle boundary", () => {
  const files = sourceFiles(SRC);

  it("scans a non-trivial number of files", () => {
    // A guard that silently scans nothing passes forever. If the layout moves,
    // this fails first and says so, rather than the checks below going green on
    // an empty set.
    expect(files.length).toBeGreaterThan(20);
  });

  it("imports no server-only package, no Node builtin, and no core barrel", () => {
    const offences: Offence[] = [];

    for (const file of files) {
      const relative = file.slice(SRC.length);
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (NODE_BUILTIN.test(specifier)) {
          offences.push({ file: relative, specifier, reason: "node builtin" });
          continue;
        }
        if (
          SERVER_ONLY_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`))
        ) {
          offences.push({ file: relative, specifier, reason: "server-only package" });
          continue;
        }
        // The BARREL, exactly. `@personal-os/core/recurrence/editor` and the
        // other deep subpaths in core's `exports` map are the supported route
        // and must keep working -- only the bare specifier is forbidden.
        if (specifier === "@personal-os/core") {
          offences.push({
            file: relative,
            specifier,
            reason: "core barrel re-exports Node-only modules; import a deep subpath",
          });
        }
      }
    }

    // Reported as data rather than a bare boolean, so a failure names the file,
    // the specifier and why -- the three things needed to fix it.
    expect(offences).toEqual([]);
  });

  it("still permits the deep core subpaths the exports map declares", () => {
    // The negative guard above would also pass if mobile imported nothing from
    // core at all, which would make it vacuous the day someone removed the last
    // usage. This pins that the SUPPORTED route is genuinely in use.
    const all = files.flatMap((file) => importSpecifiers(readFileSync(file, "utf8")));
    expect(all).toContain("@personal-os/core/recurrence/editor");
  });
});
