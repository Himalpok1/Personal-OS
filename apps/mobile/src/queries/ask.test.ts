import type { AiModel, AiProviderConnection, AiTaskRouteInfo } from "@personal-os/schema";
import { MutationObserver, QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { askCloudMutationOptions, findAskRoute, joinModelsWithConnections } from "./ask";

const ROUTE: AiTaskRouteInfo = {
  task_name: "ask",
  primary_model_id: "11111111-1111-4111-8111-111111111111",
  connection_name: "My OpenAI",
  provider_type: "openai",
  base_url_host: null,
  enabled: true,
};

describe("findAskRoute -- whether Cloud Ask is on", () => {
  it("is null before the routes have loaded", () => {
    expect(findAskRoute(undefined)).toBeNull();
  });

  it("is null when the routes list has no 'ask' entry", () => {
    expect(findAskRoute([])).toBeNull();
    expect(findAskRoute([{ ...ROUTE, task_name: "daily_brief" }])).toBeNull();
  });

  it("finds the 'ask' entry among other task routes", () => {
    const other: AiTaskRouteInfo = { ...ROUTE, task_name: "mail_digest" };
    expect(findAskRoute([other, ROUTE])).toEqual(ROUTE);
  });
});

describe("joinModelsWithConnections", () => {
  const CONNECTION: AiProviderConnection = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "My OpenAI",
    provider_type: "openai",
    base_url: null,
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const MODEL: AiModel = {
    id: "33333333-3333-4333-8333-333333333333",
    provider_connection_id: CONNECTION.id,
    model_id: "gpt-4.1",
    display_name: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("joins a model to its connection", () => {
    expect(joinModelsWithConnections([MODEL], [CONNECTION])).toEqual([
      {
        modelId: MODEL.id,
        modelLabel: "gpt-4.1",
        connectionId: CONNECTION.id,
        connectionName: "My OpenAI",
        providerType: "openai",
      },
    ]);
  });

  it("prefers a display_name over the raw provider model id", () => {
    const named = { ...MODEL, display_name: "Everyday GPT-4.1" };
    expect(joinModelsWithConnections([named], [CONNECTION])[0]?.modelLabel).toBe(
      "Everyday GPT-4.1",
    );
  });

  it("drops a model whose connection no longer exists rather than guessing", () => {
    const orphan = { ...MODEL, provider_connection_id: "99999999-9999-4999-8999-999999999999" };
    expect(joinModelsWithConnections([orphan], [CONNECTION])).toEqual([]);
  });

  it("excludes models on a disabled connection -- nothing usable to pick", () => {
    expect(joinModelsWithConnections([MODEL], [{ ...CONNECTION, enabled: false }])).toEqual([]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(joinModelsWithConnections([], [])).toEqual([]);
  });
});

describe("askCloudMutationOptions", () => {
  afterEach(() => {
    // Real, process-global singletons -- reset to their defaults so this
    // file's focus/reconnect simulation cannot leak into any other test.
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  it("sets retry to exactly 0 -- a retried Ask would silently re-send note/task text", () => {
    expect(askCloudMutationOptions().retry).toBe(0);
  });

  it(
    "NEVER fires api.askCloud on a focus regain or a reconnect -- only mutate() does",
    async () => {
      // This is the regression the brief calls out by name: a `useQuery` in
      // this app's config would retry and refetch on window focus/reconnect,
      // which would silently re-transmit the user's note/task bodies with no
      // tap. A `useMutation` (what `askCloudMutationOptions` is built for)
      // never does either, for ANY event the library fires -- proven here
      // against the real `MutationObserver`, `focusManager` and
      // `onlineManager` from `@tanstack/react-query`, not a reimplementation
      // of them.
      const spy = vi.spyOn(api, "askCloud").mockResolvedValue({
        answer: "ok",
        sources: [],
        redactions: 0,
        model_id: null,
      });

      const queryClient = new QueryClient();
      const observer = new MutationObserver(queryClient, askCloudMutationOptions());

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      // Let any microtask/timer the managers might have queued run.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spy).not.toHaveBeenCalled();

      // ...and the wiring genuinely works: a deliberate mutate() call DOES
      // reach api.askCloud, exactly once, with the exact question passed.
      await observer.mutate("a real question");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("a real question");
    },
  );
});

// Belt-and-suspenders source guard, same convention as
// apps/worker/src/mobile-inert-rendering.test.ts: a behavioral test proves
// today's code is safe, but a future edit that quietly rewrites `useAskCloud`
// to wrap `api.askCloud` in `useQuery` (which DOES refetch on focus/
// reconnect by this app's own default `staleTime`-based config) would not
// necessarily fail the MutationObserver test above, because that test
// exercises `askCloudMutationOptions` directly rather than the exported hook.
// This closes that gap at the source level.
describe("useAskCloud is wired through useMutation, never useQuery", () => {
  const source = readFileSync(fileURLToPath(new URL("./ask.ts", import.meta.url)), "utf8");

  it("defines useAskCloud with useMutation", () => {
    expect(source).toMatch(/export function useAskCloud\(\)[\s\S]*?useMutation\(/);
  });

  it("never wraps api.askCloud in a useQuery call", () => {
    const lines = source.split("\n").filter((line) => line.includes("api.askCloud"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/useQuery/);
    }
  });
});
