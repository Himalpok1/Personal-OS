// The one privacy line every memory surface shows (Checkpoint 10.7, ADR-077
// §6). It states the two guarantees the API and the ADR make structural --
// nothing is stored that the owner did not add or accept, and no memory ever
// reaches a model -- so it is a constant in a pure module and byte-pinned by
// src/__tests__/memory-privacy-line.test.ts: rewording it is a decision
// about the guarantee, not copy.
//
// Deliberately hookless and import-free so the pin test, the settings card,
// the Memory Center hero and the editor all read the same bytes.

export const MEMORY_PRIVACY_LINE = "Only what you add or accept. Never sent to an AI model.";
