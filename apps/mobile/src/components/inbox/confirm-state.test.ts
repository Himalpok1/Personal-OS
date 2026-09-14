import { ApiClientError } from "@personal-os/api-client";
import type { InboxItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { canConfirmInboxItem, canFileInboxItem, confirmErrorMessage } from "./confirm-state";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    client_uuid: null,
    raw_text: "x",
    source: "web",
    captured_at: "2026-09-01T00:00:00.000Z",
    timezone: "America/Chicago",
    status: "needs_confirm",
    parse_result: null,
    confidence: null,
    entity_type: null,
    entity_id: null,
    archived_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const UNCLEAR = {
  toolCall: { tool: "unclear", args: { reason: "one character, no verb" } },
  confidenceFlags: ["modelUnclear"],
};
const NOTE = {
  toolCall: { tool: "create_note", args: { title: "Groceries", body: "milk" } },
  confidenceFlags: [],
};

describe("canConfirmInboxItem", () => {
  it("does not offer confirmation for an `unclear` parse result", () => {
    // The exact production shape of the two items whose confirms silently
    // failed on 2026-09-03.
    expect(canConfirmInboxItem(item({ parse_result: UNCLEAR }))).toBe(false);
  });

  it("offers confirmation for a committable parse result", () => {
    expect(canConfirmInboxItem(item({ parse_result: NOTE }))).toBe(true);
  });

  it("does not offer confirmation when there is no readable parse result", () => {
    expect(canConfirmInboxItem(item({ parse_result: null }))).toBe(false);
    expect(canConfirmInboxItem(item({ parse_result: { error: "no provider" } }))).toBe(false);
    // The bare tool call the API used to store for a correction.
    expect(
      canConfirmInboxItem(item({ parse_result: { tool: "create_note", args: { title: "T", body: "B" } } })),
    ).toBe(false);
  });

  it("never offers confirmation for a status the API refuses as not_awaiting_confirmation", () => {
    for (const status of ["pending", "parsed", "confirmed"] as const) {
      expect(canConfirmInboxItem(item({ status, parse_result: NOTE }))).toBe(false);
    }
  });

  // Checkpoint 9.3 contract 7: a `failed` row is confirmable when its
  // preserved tool call is committable. Before 9.3 this returned false.
  it("offers confirmation for a FAILED item whose preserved tool call is committable", () => {
    const failedWithCall = {
      ...NOTE,
      failure: { reason: "retries_exhausted", mode: "confirm", failed_at: "2026-09-10T00:00:00Z" },
    };
    expect(canConfirmInboxItem(item({ status: "failed", parse_result: failedWithCall }))).toBe(true);
    expect(canConfirmInboxItem(item({ status: "failed", parse_result: UNCLEAR }))).toBe(false);
    // A failure marker stored ALONE (the auto-parse path) carries no call.
    expect(
      canConfirmInboxItem(
        item({
          status: "failed",
          parse_result: { reason: "retries_exhausted", mode: "auto", failed_at: "2026-09-10T00:00:00Z" },
        }),
      ),
    ).toBe(false);
  });
});

describe("canFileInboxItem", () => {
  it("is true for exactly needs_confirm and failed -- the two statuses confirm accepts", () => {
    expect(canFileInboxItem({ status: "needs_confirm" })).toBe(true);
    expect(canFileInboxItem({ status: "failed" })).toBe(true);
    for (const status of ["pending", "parsed", "confirmed"] as const) {
      expect(canFileInboxItem({ status })).toBe(false);
    }
  });
});

describe("confirmErrorMessage", () => {
  it("maps every closed refusal code to its own copy", () => {
    const codes = [
      "parse_result_not_committable",
      "parse_result_unreadable",
      "not_awaiting_confirmation",
      "job_queue_unavailable",
      "not_found",
    ];
    const messages = codes.map((c) => confirmErrorMessage(new ApiClientError(409, c)));
    expect(new Set(messages).size).toBe(codes.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it("falls back to a real sentence for an unknown code and a non-API error", () => {
    expect(confirmErrorMessage(new ApiClientError(500, "boom"))).toBe(
      "Couldn't confirm this capture.",
    );
    expect(confirmErrorMessage(new Error("network down"))).toBe("Couldn't confirm this capture.");
    expect(confirmErrorMessage(undefined)).toBe("Couldn't confirm this capture.");
  });

  it("never surfaces the server's raw body or an error message to the user", () => {
    const err = new ApiClientError(409, "parse_result_not_committable", {
      error: "parse_result_not_committable",
      tool: "unclear",
    });
    const message = confirmErrorMessage(err);
    expect(message).not.toContain("parse_result");
    expect(message).not.toContain("unclear");
    expect(message).not.toContain("409");
  });
});
