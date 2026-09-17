import type { MemoryKind } from "@personal-os/schema";

// The "Try one" starter chips on an empty Memory Center (Checkpoint 10.7).
//
// These are PROMPTS, not inferences: fixed example sentences that only
// PREFILL the editor -- the owner still reads, edits and taps Save, and
// nothing is written until they do. ADR-077 §4 forbids deriving a sentence
// about the person from what they do; a static list of suggestions the app
// makes to everyone is the opposite of that, and this module has no input
// but the chip the owner tapped.

export interface MemoryStarter {
  statement: string;
  kind: MemoryKind;
}

export const MEMORY_STARTERS: readonly MemoryStarter[] = [
  { statement: "I work best in the evening", kind: "preference" },
  { statement: "Short tasks first", kind: "preference" },
  { statement: "Mornings are for classes", kind: "fact" },
  { statement: "Working hours 9-18", kind: "preference" },
];

/** The editor route with a kind and statement prefilled -- never an id, never a write. */
export function memoryNewHref(prefill: { kind?: MemoryKind; statement?: string } = {}): string {
  const params: string[] = [];
  if (prefill.kind) params.push(`kind=${encodeURIComponent(prefill.kind)}`);
  if (prefill.statement) params.push(`statement=${encodeURIComponent(prefill.statement)}`);
  return params.length === 0 ? "/memory/new" : `/memory/new?${params.join("&")}`;
}

export function memoryStarterHref(starter: MemoryStarter): string {
  return memoryNewHref({ kind: starter.kind, statement: starter.statement });
}
