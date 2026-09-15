import { describe, expect, it } from "vitest";

// app/(tabs)/index.tsx's default export is a hooked screen whose card
// imports (reminders, health, mail, brief) reach native modules that cannot
// load under vitest, so -- as today-ask-chip.test.ts and new-event-screen.test.ts
// do -- Suggested Focus's wiring (Checkpoint 9.8) is pinned by reading the
// source rather than rendering the screen.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("../app/(tabs)/index.tsx", { query: "?raw", import: "default", eager: true });

const today = Object.values(SOURCES)[0]!;

describe("Today's Suggested Focus card (Checkpoint 9.8)", () => {
  it("is rendered ONLY when the 'ask' task route exists -- the same switch as the Ask chip", () => {
    expect(today).toMatch(
      /\{askEnabled \? \(\s*<SuggestedFocusCard\s/,
    );
  });

  it("passes the client-side candidate count computed from the same /today summary the chips render", () => {
    expect(today).toContain("candidateCount={focusCandidateCount(data.summary)}");
  });

  it("never calls the mutation except from the card's own onSuggest prop -- never on mount", () => {
    // Exactly one call site for `.mutate(`, reached only through
    // requestFocusSuggestion (the reentrancy-guarded wrapper -- see the next
    // test), which is itself only ever handed to <SuggestedFocusCard> as its
    // onSuggest prop, never invoked inside a useEffect or at the top of the
    // component body.
    const mutateCalls = today.match(/suggestFocus\.mutate\(/g) ?? [];
    expect(mutateCalls).toHaveLength(1);
    expect(today).toMatch(/onSuggest=\{requestFocusSuggestion\}/);
  });

  it("guards a rapid double-tap with a synchronous ref, not react state alone (Checkpoint 9.8 review)", () => {
    // isPending is React state and cannot stop two mutate() calls fired
    // within the same render frame; a ref checked and set BEFORE mutate()
    // runs closes that window. Pinned here because the failure mode --two
    // POST /focus/suggestion requests from one rapid double-tap-- has no
    // other regression coverage (the card itself is hookless and cannot own
    // this guard; see suggested-focus-card.tsx).
    expect(today).toMatch(/const focusRequestInFlightRef = useRef\(false\);/);
    expect(today).toMatch(
      /const requestFocusSuggestion = useCallback\(\(\) => \{\s*if \(focusRequestInFlightRef\.current\) return;/,
    );
    expect(today).toMatch(/onSettled: \(\) => \{\s*focusRequestInFlightRef\.current = false;/);
  });

  it("derives its state from the useSuggestFocus() mutation object, never a separate useState", () => {
    expect(today).toMatch(/const suggestFocus = useSuggestFocus\(\);/);
    expect(today).toMatch(/const focusState: SuggestedFocusState = suggestFocus\.isPending/);
  });

  it("sits right after the Ask chip's closing row, before the review banners", () => {
    const afterChipRow = today.slice(
      today.indexOf('testID="today-ask-chip"'),
      today.indexOf('title="Daily review"'),
    );
    expect(afterChipRow).toContain("<SuggestedFocusCard");
  });

  it("navigates a tapped source through the same askSourceHref helper Ask uses", () => {
    expect(today).toMatch(
      /onSelectSource=\{\(source\) => router\.push\(askSourceHref\(source\)\)\}/,
    );
  });
});
