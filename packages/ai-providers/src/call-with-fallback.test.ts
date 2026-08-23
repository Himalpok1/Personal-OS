import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { callWithFallbackTracked } from "./call-with-fallback.js";
import type { ResolvedModel } from "./resolve-model.js";

// Fake LanguageModel stand-ins -- these tests never make a network call, so
// a distinguishable opaque object per candidate is all attempt() needs.
const primaryModel = { name: "primary" } as unknown as LanguageModel;
const fallbackModelA = { name: "fallback-a" } as unknown as LanguageModel;
const fallbackModelB = { name: "fallback-b" } as unknown as LanguageModel;

function chainWithFallbacks(
  fallbacks: LanguageModel[],
  fallbackModelRowIds: string[],
): ResolvedModel {
  return {
    model: primaryModel,
    modelRowId: "primary-row-id",
    fallbacks,
    fallbackModelRowIds,
  };
}

describe("callWithFallbackTracked", () => {
  it("returns the primary's modelRowId when the primary succeeds", async () => {
    const chain = chainWithFallbacks([fallbackModelA], ["fallback-a-row-id"]);

    const { result, modelRowId } = await callWithFallbackTracked(chain, (model) => {
      expect(model).toBe(primaryModel);
      return Promise.resolve("primary-result");
    });

    expect(result).toBe("primary-result");
    expect(modelRowId).toBe("primary-row-id");
  });

  it("returns the FALLBACK's modelRowId when the primary throws and a fallback succeeds", async () => {
    // Anti-false-provenance property: a naive implementation that always
    // reported the route's primary modelRowId would pass every other test
    // here but fail this one -- the reported id must track which candidate
    // actually produced the result.
    const chain = chainWithFallbacks([fallbackModelA], ["fallback-a-row-id"]);

    const { result, modelRowId } = await callWithFallbackTracked(chain, (model) => {
      if (model === primaryModel) return Promise.reject(new Error("primary failed"));
      return Promise.resolve("fallback-result");
    });

    expect(result).toBe("fallback-result");
    expect(modelRowId).toBe("fallback-a-row-id");
  });

  it("rejects with the LAST error when every candidate throws", async () => {
    const chain = chainWithFallbacks(
      [fallbackModelA, fallbackModelB],
      ["fallback-a-row-id", "fallback-b-row-id"],
    );

    await expect(
      callWithFallbackTracked(chain, (model) => {
        if (model === primaryModel) throw new Error("primary error");
        if (model === fallbackModelA) throw new Error("fallback-a error");
        throw new Error("fallback-b error");
      }),
    ).rejects.toThrow("fallback-b error");
  });

  it("rejects without trying any fallback when none are configured and the primary throws", async () => {
    const chain = chainWithFallbacks([], []);
    let attempts = 0;

    await expect(
      callWithFallbackTracked(chain, () => {
        attempts++;
        return Promise.reject(new Error("primary error"));
      }),
    ).rejects.toThrow("primary error");
    expect(attempts).toBe(1);
  });

  it("passes an increasing candidateIndex to each attempt", async () => {
    const chain = chainWithFallbacks(
      [fallbackModelA, fallbackModelB],
      ["fallback-a-row-id", "fallback-b-row-id"],
    );
    const seenIndexes: number[] = [];

    await expect(
      callWithFallbackTracked(chain, (_model, candidateIndex) => {
        seenIndexes.push(candidateIndex);
        return Promise.reject(new Error("always fails"));
      }),
    ).rejects.toThrow("always fails");

    expect(seenIndexes).toEqual([0, 1, 2]);
  });
});
