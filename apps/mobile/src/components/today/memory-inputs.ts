import type { MemoryLinkInput } from "@personal-os/core/memory/match";
import type { MemoryItem } from "@personal-os/schema";

// The Personal Memory layer's way INTO Today (Checkpoint 10.7, ADR-077 §5):
// a pure, React-free projection of what `useMemoriesForIntelligence()` and
// `useMemorySettings()` return into the two values the Focus Now and briefing
// composers take -- the typed-link inputs core's `memory/match` reads, and
// the global switch. Nothing else about a memory crosses this line: `note`,
// `source`, `suggestion_id`, the resolved project/course NAMES and the
// timestamps are not projected, so the composers cannot read them even by
// accident. `statement` IS projected, because the explanation sheet names
// the matched memory ("You said: …") -- core's `explain.ts` -- and because
// `memoryWorkingHours` reads the one fixed working-hours grammar from it.
// Matching itself is by `projectId` / `canvasCourseId` equality only.
//
// ===========================================================================
// SOFT DEGRADATION: MEMORY NEVER BLOCKS, BLANKS OR ERRORS A TODAY CARD
// ===========================================================================
//
// Focus Now renders its rows the moment `/today` and `/academic/today` are
// in, WITHOUT memory reasons while the two memory queries are still loading,
// then re-renders with them; the briefing (which already waits for its
// optional sources to settle before its first render, 10.6 review finding 5)
// treats memory as one more source in that settle set. Either query ERRORING
// makes memory simply absent -- byte-identical to the switch being off --
// rather than a stale or partial influence. `settled` tells the briefing
// when it may render; `memories === null` tells a composer there is nothing
// to match against.

/** The two fields of a React Query result a composer reads; the hooks' own results fit. */
export interface MemorySourceState<T> {
  data: T | undefined;
  isError: boolean;
}

/** What the composers take (`focusNowRows` / `briefingFor`'s `memory` option). */
export interface MemoryIntelligenceInput {
  /** Null while loading, on error, or when the switch is off: the composers then match nothing. */
  memories: MemoryLinkInput[] | null;
  /** `memory_settings.enabled`; false whenever memory is absent for any reason. */
  memoryEnabled: boolean;
  /** Both queries have data or have errored -- the briefing's settle gate. */
  settled: boolean;
}

/** Memory absent: what a composer receives with the switch off, a failed source, or nothing loaded yet. */
export const MEMORY_ABSENT: MemoryIntelligenceInput = Object.freeze({
  memories: null,
  memoryEnabled: false,
  settled: true,
});

/** The composers' input while a memory query is still loading: absent, and not yet settled. */
export const MEMORY_LOADING: MemoryIntelligenceInput = Object.freeze({
  memories: null,
  memoryEnabled: false,
  settled: false,
});

/** The five fields core's typed-link matcher reads, and nothing else (see the module comment). */
export function toMemoryLinkInput(item: MemoryItem): MemoryLinkInput {
  return {
    id: item.id,
    kind: item.kind,
    statement: item.statement,
    projectId: item.project_id,
    canvasCourseId: item.canvas_course_id,
  };
}

export function toMemoryLinkInputs(items: readonly MemoryItem[]): MemoryLinkInput[] {
  return items.map(toMemoryLinkInput);
}

/**
 * Projects the two memory queries onto the composers' input. Pure: the
 * decision of WHEN memory participates is tested here as data, and the
 * cards only pass the result through.
 *
 *   either errored             → MEMORY_ABSENT (settled, matches nothing)
 *   either still loading       → MEMORY_LOADING (not settled, matches nothing)
 *   switch off                 → settled, `memories` null, enabled false
 *   switch on                  → settled, every memory projected, enabled true
 */
export function memoryIntelligenceInput(
  list: MemorySourceState<{ items: readonly MemoryItem[] }>,
  settings: MemorySourceState<{ enabled: boolean }>,
): MemoryIntelligenceInput {
  if (list.isError || settings.isError) return MEMORY_ABSENT;
  if (list.data === undefined || settings.data === undefined) return MEMORY_LOADING;
  if (!settings.data.enabled) return MEMORY_ABSENT;
  return { memories: toMemoryLinkInputs(list.data.items), memoryEnabled: true, settled: true };
}
