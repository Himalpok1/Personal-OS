import {
  AGENT_TOOL_CALLS_PER_MINUTE,
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
} from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { checkBudget, refusalStatus, type BudgetCheckInput } from "./budget.js";

// The admission ORDER is the contract (ADR-081 §5): the owner's decisions
// (trust, permission) are reported before the gateway's limits (rate,
// calls, chars), and each limit is a strict `>=` on what was already spent.

const admitted: BudgetCheckInput = {
  trustLevel: "read",
  requiredTrust: "read",
  permissionGranted: true,
  calls: 0,
  chars: 0,
  lastMinute: 0,
};

describe("checkBudget", () => {
  it("admits a read agent with a grant and nothing spent", () => {
    expect(checkBudget(admitted)).toBeNull();
  });

  it("admits a propose agent for a read-level tool (propose ≥ read)", () => {
    expect(checkBudget({ ...admitted, trustLevel: "propose" })).toBeNull();
  });

  it("refuses trust_insufficient for a paused (none) agent before anything else", () => {
    expect(
      checkBudget({
        ...admitted,
        trustLevel: "none",
        permissionGranted: false,
        calls: 99,
        chars: 99_999,
        lastMinute: 999,
      }),
    ).toBe("trust_insufficient");
  });

  it("refuses permission_not_granted before any limit", () => {
    expect(checkBudget({ ...admitted, permissionGranted: false, calls: 99, lastMinute: 999 })).toBe(
      "permission_not_granted",
    );
  });

  it("refuses rate_limited at exactly AGENT_TOOL_CALLS_PER_MINUTE, before the per-correlation budgets", () => {
    expect(checkBudget({ ...admitted, lastMinute: AGENT_TOOL_CALLS_PER_MINUTE - 1 })).toBeNull();
    expect(
      checkBudget({
        ...admitted,
        lastMinute: AGENT_TOOL_CALLS_PER_MINUTE,
        calls: 99,
        chars: 99_999,
      }),
    ).toBe("rate_limited");
  });

  it("refuses budget_calls_exceeded at exactly READ_TOOL_MAX_CALLS_PER_REQUEST consumed calls", () => {
    expect(checkBudget({ ...admitted, calls: READ_TOOL_MAX_CALLS_PER_REQUEST - 1 })).toBeNull();
    expect(
      checkBudget({ ...admitted, calls: READ_TOOL_MAX_CALLS_PER_REQUEST, chars: 99_999 }),
    ).toBe("budget_calls_exceeded");
  });

  it("refuses budget_chars_exceeded at exactly READ_TOOL_MAX_CHARS_PER_REQUEST returned chars", () => {
    expect(checkBudget({ ...admitted, chars: READ_TOOL_MAX_CHARS_PER_REQUEST - 1 })).toBeNull();
    expect(checkBudget({ ...admitted, chars: READ_TOOL_MAX_CHARS_PER_REQUEST })).toBe(
      "budget_chars_exceeded",
    );
  });
});

describe("refusalStatus", () => {
  it("maps the owner's decisions to 403 and the gateway's limits to 429", () => {
    expect(refusalStatus("trust_insufficient")).toBe(403);
    expect(refusalStatus("permission_not_granted")).toBe(403);
    expect(refusalStatus("rate_limited")).toBe(429);
    expect(refusalStatus("budget_calls_exceeded")).toBe(429);
    expect(refusalStatus("budget_chars_exceeded")).toBe(429);
    expect(refusalStatus("input_invalid")).toBe(400);
    expect(refusalStatus("target_not_found")).toBe(404);
  });
});
