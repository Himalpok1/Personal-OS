// The one trust line every agent surface shows (Checkpoint 10.9, ADR-081
// §9). It states the two guarantees the gateway makes structural -- an
// agent CALLS read tools only under a granted permission and its own trust
// level, and it REQUESTS actions that the owner approves in the Action
// Center (`requires_approval` is a literal `true` on every registry entry;
// there is no agent approve route) -- so it is a constant in a pure module
// and byte-pinned by src/__tests__/agents-trust-line.test.ts: rewording it
// is a decision about the guarantee, not copy.
//
// Deliberately hookless and import-free so the pin test, the Settings card
// and the Agent Center hero all read the same bytes. It never restates the
// Action Center's own line (components/actions/trust-line.ts), which that
// file's pin forbids outside the action surfaces.

export const AGENTS_TRUST_LINE =
  "Agents can only read what you allow and can only propose. You approve every action.";
