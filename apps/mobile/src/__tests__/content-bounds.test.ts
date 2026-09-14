import { describe, expect, it } from "vitest";

// Checkpoint 9.6 (ADR-065): every user text field in the app carries
// `maxLength` equal to the server's own constant, so an over-long paste is
// stopped in the input rather than refused as a 400 -- and, where it IS
// refused (a legacy draft, a client-side parse), the banner names the field.
//
// The route files are hooked screens with no render harness (see
// new-event-screen.test.ts), so the wiring is pinned by reading their source:
// each TextInput's `maxLength` prop, in document order, must be exactly the
// constant the schema binds that field to.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string | string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(["../app/**/*.tsx", "../components/**/*.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Each `<TextInput ... />` element's `maxLength` expression (null when absent), in source order. */
function maxLengthsOf(source: string): (string | null)[] {
  return [...source.matchAll(/<TextInput\b([\s\S]*?)\/>/g)].map((element) => {
    const bound = /maxLength=\{([^}]+)\}/.exec(element[1]!);
    return bound ? bound[1]!.trim() : null;
  });
}

const SCREENS: Record<string, { inputs: string[]; unbounded?: number; banner: RegExp }> = {
  "../app/tasks/new.tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "TASK_BODY_MAX_CHARS"],
    banner: /describeValidationError\(createTask\.error\) \?\? "Couldn't create that task\."/,
  },
  "../app/tasks/[id].tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "TASK_BODY_MAX_CHARS"],
    banner: /const fieldLine = describeValidationError\(err\);/,
  },
  "../app/notes/new.tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "NOTE_BODY_MAX_CHARS"],
    banner: /describeValidationError\(createNote\.error\) \?\? "Couldn't create that note\."/,
  },
  "../app/notes/[id].tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "NOTE_BODY_MAX_CHARS"],
    banner: /onError: \(err\) =>\s*setSaveError\(\s*describeValidationError\(err\) \?\?/,
  },
  "../app/events/new.tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "EVENT_LOCATION_MAX_CHARS", "EVENT_DESCRIPTION_MAX_CHARS"],
    banner: /setFormError\(eventMutationErrorLine\(error, "create that event"\)\)/,
  },
  "../app/events/[id].tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "EVENT_LOCATION_MAX_CHARS", "EVENT_DESCRIPTION_MAX_CHARS"],
    banner: /setErrorMessage\(eventMutationErrorLine\(err, verb\)\)/,
  },
  "../app/projects/new.tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS"],
    // The color field is a 64-char hex-ish string with no user-facing bound.
    unbounded: 1,
    banner: /describeValidationError\(createProject\.error\) \?\? "Couldn't create that project\."/,
  },
  "../app/projects/[id].tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS", "PROJECT_GOAL_MAX_CHARS"],
    // The target-date field is a YYYY-MM-DD pattern, validated on blur.
    unbounded: 1,
    banner: /setMetadataError\(\s*describeValidationError\(err\) \?\?/,
  },
  "../components/inbox/inbox-detail-view.tsx": {
    inputs: ["ENTITY_TITLE_MAX_CHARS"],
    banner: /confirmErrorMessage\(props\.confirm\.error\)/,
  },
  "../components/quick-add-fab.tsx": {
    inputs: ["CAPTURE_TEXT_MAX_LENGTH"],
    banner: /describeValidationError\(capture\.error\) \?\?/,
  },
};

describe("every user text field is bounded at the schema's constant (Checkpoint 9.6)", () => {
  for (const [file, expected] of Object.entries(SCREENS)) {
    it(`${file}: maxLength per TextInput, imported from @personal-os/schema`, () => {
      const source = SOURCES[file];
      expect(source, file).toBeDefined();
      const bounds = maxLengthsOf(source!);
      expect(bounds.filter((b) => b !== null)).toEqual(expected.inputs);
      expect(bounds.filter((b) => b === null)).toHaveLength(expected.unbounded ?? 0);
      // The constant must be the schema's, never a local number.
      const importBlock = source!.slice(0, source!.indexOf("export "));
      for (const constant of new Set(expected.inputs)) {
        expect(importBlock, `${file} imports ${constant}`).toMatch(
          new RegExp(`${constant}[\\s\\S]*?from "@personal-os/schema"`),
        );
      }
      // A live counter follows every bounded input.
      expect((source!.match(/<FieldLengthCounter\b/g) ?? []).length).toBe(expected.inputs.length);
    });

    it(`${file}: a refused field reaches the banner through describeValidationError`, () => {
      expect(SOURCES[file]!).toMatch(expected.banner);
    });
  }
});

describe("a refused project metadata save is visible above the fold (Checkpoint 9.6 review)", () => {
  it("projects/[id].tsx renders metadataError under the goal counter, before the target-date field and the lifecycle buttons", () => {
    const source = SOURCES["../app/projects/[id].tsx"]!;
    const error = source.indexOf("{metadataError ? (");
    const goalCounter = source.indexOf("maxLength={PROJECT_GOAL_MAX_CHARS} />");
    const targetDate = source.indexOf("Target date (YYYY-MM-DD)");
    const lifecycle = source.indexOf('label="Pause"');
    expect(error).toBeGreaterThan(-1);
    expect(goalCounter).toBeGreaterThan(-1);
    // Rendered exactly once, directly after the goal field's counter and
    // before anything that would push it below a 480x640 viewport.
    expect(source.match(/\{metadataError \? \(/g)).toHaveLength(1);
    expect(error).toBeGreaterThan(goalCounter);
    expect(error).toBeLessThan(targetDate);
    expect(error).toBeLessThan(lifecycle);
    expect(source).toMatch(/testID="project-metadata-error"[\s\S]*?accessibilityRole="alert"/);
  });
});
