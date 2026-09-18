// The one trust line every action surface shows (Checkpoint 10.8, ADR-078
// §3/§8). It states the two guarantees the registry and the permission
// layer make structural -- `requires_approval` is a literal `true` on every
// action, and a grant is revocable at any time -- so it is a constant in a
// pure module and byte-pinned by src/__tests__/actions-trust-line.test.ts:
// rewording it is a decision about the guarantee, not copy.
//
// Deliberately hookless and import-free so the pin test, the Settings card
// and the Action Center hero all read the same bytes.

export const ACTIONS_TRUST_LINE =
  "Nothing runs until you approve it. You can revoke any permission.";
