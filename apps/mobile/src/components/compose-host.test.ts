import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical guard: every `@expo/ui/jetpack-compose` view is a DIRECT child of
 * `<Host>`.
 *
 * ===========================================================================
 * WHY THIS IS WORTH A TEST
 * ===========================================================================
 *
 * Checkpoint 8.4 shipped the first `@expo/ui` usage in this app, and got this
 * wrong on the first attempt. The dialog was rendered inside the component's
 * own `<View>`, which is a non-Compose ViewGroup and therefore breaks the
 * Compose composition boundary.
 *
 * The failure mode is the reason this is mechanical rather than remembered:
 * **nothing throws, nothing renders, and no test fails.** Tapping the field
 * simply did nothing. The only evidence anywhere was a single logcat line on
 * the physical device:
 *
 *   ExpoComposeView: expo.modules.kotlin.views.MissingHostException:
 *   A Jetpack Compose view "DatePickerDialogView" must be rendered as a
 *   direct child of a <Host> component.
 *
 * A unit test cannot catch it (the components are native views), and a
 * reviewer would have to know the rule. So the source is checked instead.
 */
const SRC = path.resolve(import.meta.dirname, "..");
// A real import statement, not a mention in a comment -- both the pure
// state module and the web fallback DISCUSS this rule without importing.
const COMPOSE_IMPORT = /import\s*\{[^}]*\}\s*from\s*"@expo\/ui\/jetpack-compose"/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Component names imported from the jetpack-compose entrypoint, minus Host. */
function importedComposeViews(source: string): string[] {
  const importMatch = /import\s*\{([^}]*)\}\s*from\s*"@expo\/ui\/jetpack-compose"/.exec(source);
  if (!importMatch) return [];
  return importMatch[1]!
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name !== "Host");
}

describe("@expo/ui Compose views are hosted", () => {
  const files = sourceFiles(SRC).filter((f) => COMPOSE_IMPORT.test(readFileSync(f, "utf8")));

  it("finds the files that use Compose views at all (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.length ? files : ["<none>"])("%s wraps every Compose view in <Host>", (file) => {
    if (file === "<none>") return;
    const source = readFileSync(file, "utf8");
    const views = importedComposeViews(source);
    expect(views.length).toBeGreaterThan(0);

    for (const view of views) {
      const usage = new RegExp(`<${view}[\\s/>]`, "g");
      let match: RegExpExecArray | null;
      let seen = 0;
      while ((match = usage.exec(source)) !== null) {
        seen += 1;
        // Walk back to the nearest preceding JSX opening tag. It must be
        // <Host>; a <View> (or anything else) between them is exactly the
        // MissingHostException this guard exists for.
        const before = source.slice(0, match.index);
        const previousTag = /<([A-Za-z][A-Za-z0-9_.]*)[^<]*$/.exec(before);
        expect(previousTag, `${view} in ${path.basename(file)} has no enclosing tag`).not.toBeNull();
        expect(previousTag![1], `${view} must be a direct child of <Host>`).toBe("Host");
      }
      expect(seen, `${view} is imported but never used in ${path.basename(file)}`).toBeGreaterThan(
        0,
      );
    }
  });
});
