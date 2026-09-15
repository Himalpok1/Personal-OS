import { ApiClientError } from "@personal-os/api-client";
import { MutationObserver, QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import {
  focusCandidateCount,
  focusErrorMessage,
  isFocusNotEnoughCandidatesError,
  suggestFocusMutationOptions,
} from "./focus";
import { deviceTimezone } from "./today";

describe("focusCandidateCount", () => {
  it("sums overdue and due-today totals", () => {
    expect(focusCandidateCount({ overdue_total: 3, due_today_total: 2 })).toBe(5);
  });

  it("is zero when nothing is overdue or due today", () => {
    expect(focusCandidateCount({ overdue_total: 0, due_today_total: 0 })).toBe(0);
  });
});

describe("isFocusNotEnoughCandidatesError", () => {
  it("is true only for the exact focus_not_enough_candidates code", () => {
    expect(isFocusNotEnoughCandidatesError(new ApiClientError(409, "focus_not_enough_candidates"))).toBe(
      true,
    );
  });

  it("is false for every other error, including a different 409", () => {
    expect(isFocusNotEnoughCandidatesError(new ApiClientError(409, "cloud_ask_disabled"))).toBe(false);
    expect(isFocusNotEnoughCandidatesError(new ApiClientError(502, "focus_failed"))).toBe(false);
    expect(isFocusNotEnoughCandidatesError(new Error("network"))).toBe(false);
    expect(isFocusNotEnoughCandidatesError(null)).toBe(false);
  });
});

describe("focusErrorMessage", () => {
  it("never returns an empty string, and never echoes provider or server text", () => {
    const cases: unknown[] = [
      new ApiClientError(409, "cloud_ask_disabled"),
      new ApiClientError(409, "ask_consent_outdated"),
      new ApiClientError(429, "focus_in_flight"),
      new ApiClientError(502, "focus_uncited"),
      new ApiClientError(502, "focus_failed"),
      new ApiClientError(504, "focus_timeout"),
      new ApiClientError(409, "no_provider_configured"),
      new ApiClientError(500, "some_new_unmapped_code"),
      new Error("a raw provider error message that must never be shown"),
      null,
    ];
    for (const err of cases) {
      const message = focusErrorMessage(err);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("a raw provider error message");
    }
  });

  it("maps every known code to distinct, non-generic copy", () => {
    expect(focusErrorMessage(new ApiClientError(409, "cloud_ask_disabled"))).toBe(
      "Cloud Ask was turned off.",
    );
    expect(focusErrorMessage(new ApiClientError(502, "focus_uncited"))).toContain("discarded");
  });
});

describe("suggestFocusMutationOptions", () => {
  afterEach(() => {
    // Real, process-global singletons -- reset to their defaults so this
    // file's focus/reconnect simulation cannot leak into any other test.
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  it("sets retry to exactly 0 -- a retry would silently re-send today's schedule again", () => {
    expect(suggestFocusMutationOptions().retry).toBe(0);
  });

  it("NEVER fires api.suggestFocus on a focus regain or a reconnect -- only mutate() does", async () => {
    const spy = vi.spyOn(api, "suggestFocus").mockResolvedValue({
      suggestion: "Consider the electric bill [1].",
      source: {
        ref: 1,
        type: "task",
        id: "11111111-1111-4111-8111-111111111111",
        title: "Electric bill",
        section: "overdue",
      },
      candidate_count: 2,
      model_id: null,
    });

    const queryClient = new QueryClient();
    const observer = new MutationObserver(queryClient, suggestFocusMutationOptions());

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).not.toHaveBeenCalled();

    await observer.mutate();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ tz: deviceTimezone() });
  });
});

// Belt-and-suspenders source guard, same convention as ask.test.ts's
// equivalent block: a behavioral test proves today's code is safe, but a
// future edit that quietly rewrites useSuggestFocus to wrap api.suggestFocus
// in useQuery would not necessarily fail the MutationObserver test above,
// because that test exercises suggestFocusMutationOptions directly rather
// than the exported hook.
describe("useSuggestFocus is wired through useMutation, never useQuery", () => {
  const source = readFileSync(fileURLToPath(new URL("./focus.ts", import.meta.url)), "utf8");

  it("defines useSuggestFocus with useMutation", () => {
    expect(source).toMatch(/export function useSuggestFocus\(\)[\s\S]*?useMutation\(/);
  });

  it("never wraps api.suggestFocus in a useQuery call", () => {
    const lines = source.split("\n").filter((line) => line.includes("api.suggestFocus"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/useQuery/);
    }
  });

  it("routes onError through handleAskCloudError, reusing Cloud Ask's consent state", () => {
    expect(source).toMatch(/onError:\s*\(err: unknown\)\s*=>\s*handleAskCloudError\(queryClient, err\)/);
  });
});
