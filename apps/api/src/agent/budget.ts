import {
  AGENT_TOOL_CALLS_PER_MINUTE,
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
  trustLevelAtLeast,
  type AgentToolErrorClass,
  type AgentTrustLevel,
} from "@personal-os/schema";

// The gateway's admission decision for ONE read-tool call (Checkpoint 10.9,
// ADR-081 §5), as a pure function so every ordering rule is unit-tested
// without a database. The order is the contract, not an accident:
//
//   1. trust_insufficient      the agent's level is below what the call needs
//   2. permission_not_granted  the owner has not granted the tool's permission
//   3. rate_limited            ≥ AGENT_TOOL_CALLS_PER_MINUTE rows in the last 60 s
//   4. budget_calls_exceeded   ≥ READ_TOOL_MAX_CALLS_PER_REQUEST consumed on this correlation
//   5. budget_chars_exceeded   ≥ READ_TOOL_MAX_CHARS_PER_REQUEST consumed on this correlation
//
// Trust and permission come first because they are the owner's decisions;
// a paused or ungranted agent learns THAT before it learns anything about
// its budget. `calls` and `chars` are what the correlation has ALREADY
// spent (completed + failed rows -- refusals never count); `lastMinute` is
// every row in the window, refusals included, because a refusal is still a
// request the gateway answered.

export interface BudgetCheckInput {
  trustLevel: AgentTrustLevel;
  /** The level the call needs -- `read` for every read tool. */
  requiredTrust: AgentTrustLevel;
  permissionGranted: boolean;
  /** Calls already consumed on this correlation (completed + failed). */
  calls: number;
  /** Chars already returned on this correlation. */
  chars: number;
  /** Every call by this agent in the last 60 s, refusals included. */
  lastMinute: number;
}

/** `null` means admitted; otherwise the class the refusal is audited and answered with. */
export function checkBudget(input: BudgetCheckInput): AgentToolErrorClass | null {
  if (!trustLevelAtLeast(input.trustLevel, input.requiredTrust)) return "trust_insufficient";
  if (!input.permissionGranted) return "permission_not_granted";
  if (input.lastMinute >= AGENT_TOOL_CALLS_PER_MINUTE) return "rate_limited";
  if (input.calls >= READ_TOOL_MAX_CALLS_PER_REQUEST) return "budget_calls_exceeded";
  if (input.chars >= READ_TOOL_MAX_CHARS_PER_REQUEST) return "budget_chars_exceeded";
  return null;
}

/** The HTTP status a refusal class maps to: the owner's decisions are 403, the gateway's limits 429. */
export function refusalStatus(errorClass: AgentToolErrorClass): 400 | 403 | 404 | 429 {
  switch (errorClass) {
    case "trust_insufficient":
    case "permission_not_granted":
      return 403;
    case "rate_limited":
    case "budget_calls_exceeded":
    case "budget_chars_exceeded":
      return 429;
    case "input_invalid":
      return 400;
    case "target_not_found":
      return 404;
    case "tool_failed":
      // Never a refusal body: a thrown tool is audited `failed` and rethrown
      // through the ordinary error handler as a 500.
      return 400;
  }
}
