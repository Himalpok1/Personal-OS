// Mechanical guard: untrusted text stays INERT in the Expo client.
//
// ===========================================================================
// WHAT THIS PROTECTS, AND WHY IT IS WORTH A TEST
// ===========================================================================
//
// The app renders strings that third parties chose. Mail subjects and sender
// display names are the sharp end -- ADR-054 names them as exactly the two
// attacker-controlled fields in the system -- and Checkpoint 8.3's search
// screen puts them in a tappable list for the first time. Calendar titles,
// locations and inbox captures are in the same category.
//
// The reason none of that is dangerous today is not vigilance, it is a property
// of the renderer: every string in this app lands in React Native's <Text>,
// which interprets no markup and detects no links unless `dataDetectorTypes`
// is set. That property is currently true by accident of never having added a
// markdown renderer. This test makes it true on purpose.
//
// The failure it prevents is a quiet one: someone adds react-native-markdown
// or a WebView to make a note render nicely, and a mail subject silently
// becomes clickable. No test would otherwise fail.
//
// ===========================================================================
// WHY THIS LIVES IN apps/worker
// ===========================================================================
//
// Identical reasoning to mobile-bundle-boundary.test.ts, its sibling: it needs
// `node:fs`, and apps/mobile's tsconfig deliberately ships no Node types --
// which is itself part of the boundary being enforced. See that file's header.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../mobile/src/", import.meta.url));

/**
 * Rendering surfaces that interpret their input rather than displaying it.
 *
 * Each entry is a substring searched for in source text. They are deliberately
 * coarse: this is a "has anyone introduced one of these" tripwire, not a
 * parser. A false positive is cheap to resolve (name the file, state why); a
 * false negative is a clickable phishing link in a search result.
 */
const INTERPRETING_SURFACES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bWebView\b/, why: "a WebView executes whatever markup it is handed" },
  {
    // `marked` is matched only in its IMPORT form. A bare /marked\b/ matched the
    // English word in monitor/index.tsx's "stays marked as down" copy -- a
    // guard that fires on ordinary prose is one that gets deleted.
    pattern:
      /react-native-markdown|react-markdown|markdown-display|MarkdownIt|from\s+["']marked["']/,
    why: "a markdown renderer turns [text](url) in a subject line into a live link",
  },
  {
    pattern: /dangerouslySetInnerHTML|innerHTML/,
    why: "raw HTML injection",
  },
  {
    pattern: /\bdataDetectorTypes\b/,
    why: "this is the switch that makes <Text> autolink URLs and phone numbers",
  },
  {
    pattern: /react-native-parsed-text|ParsedText|\bautoLink\b|\blinkify/i,
    why: "autolinking turns attacker-authored text into a tappable destination",
  },
];

/**
 * `Linking.openURL` opens whatever it is given, so every call site is listed
 * here by hand and must stay justified.
 *
 * TWO files are allowed. `settings.tsx` opens the Gmail OAuth authorize URL,
 * which comes from this project's own API (`getGmailAuthorizeUrl`), not from
 * mail, calendar or capture content. `components/academic/source-link.tsx`
 * (Checkpoint 10.2, succeeding 10.1's `components/canvas/
 * upcoming-assignments-card.tsx`) is the ONE component every academic
 * surface -- the Today card, the course list, the course screen -- renders an
 * "open in Canvas" row through. It opens a synced row's `html_url` --
 * Canvas-generated, not user-typed, but still provider-supplied content this
 * project does not control -- ONLY after checking its origin is exactly the
 * same connection's own `source_base_url` origin
 * (`components/academic/same-origin.ts`), so the call can never navigate
 * anywhere but the owner's own configured Canvas instance.
 * apps/mobile/src/__tests__/academic-open-url.test.ts pins that no other
 * academic file imports `Linking` at all.
 *
 * Same shape as src/__tests__/confirmation-hygiene.test.ts's ALLOWED list, and
 * for the same reason: an explicit, short allowlist makes a new call site a
 * test failure rather than a review question nobody asks.
 */
const OPEN_URL_ALLOWED = new Set(["app/settings.tsx", "components/academic/source-link.tsx"]);

/**
 * Strips comments before scanning.
 *
 * Necessary rather than fastidious: this repository explains its security
 * controls in prose, and the search screen's own header comment NAMES
 * `dataDetectorTypes` in order to say it is never set. A guard that forbade
 * discussing the hazard would push exactly the reasoning a future reader needs
 * out of the file -- the same "prose naming the search needle" false positive
 * `docs/STATUS.md` already records against gitleaks.
 *
 * KNOWN IMPRECISION, stated rather than discovered: `//` inside a string
 * literal (a URL) truncates that line early. It cannot produce a false PASS for
 * anything this guard looks for, because every pattern here is an identifier or
 * a package name, and none of those live after a `//` inside a string.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__mocks__") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests legitimately NAME these surfaces in order to assert their absence.
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("apps/mobile renders untrusted text inertly", () => {
  const files = sourceFiles(SRC);

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("introduces no rendering surface that interprets its input", () => {
    const offences: { file: string; why: string }[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const { pattern, why } of INTERPRETING_SURFACES) {
        if (pattern.test(source)) {
          offences.push({ file: relative(SRC, file), why });
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("opens a URL from exactly one justified place", () => {
    const callers = files
      .filter((file) => /Linking\.openURL/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(SRC, file).split("\\").join("/"));

    expect(new Set(callers)).toEqual(OPEN_URL_ALLOWED);
  });

  it("still renders search results, so this guard is not vacuous", () => {
    // If the search screen were deleted or renamed, the scans above would pass
    // trivially. Pinning the file that motivated the guard keeps it honest.
    const screen = files.find((file) => relative(SRC, file).includes("app/search"));
    expect(screen).toBeDefined();
    expect(readFileSync(screen!, "utf8")).toContain("<Text");
  });
});
