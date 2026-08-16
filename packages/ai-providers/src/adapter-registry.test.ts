import { describe, expect, it } from "vitest";
import { AI_PROVIDER_TYPES, buildLanguageModel } from "./adapter-registry.js";

describe("buildLanguageModel", () => {
  it.each(["openai", "anthropic", "google", "xai"] as const)(
    "constructs a model for native provider type %s without making a network call",
    (providerType) => {
      expect(() =>
        buildLanguageModel(providerType, "some-model-id", { apiKey: "fake-key" }),
      ).not.toThrow();
    },
  );

  it("constructs an openai_compatible model given a baseUrl", () => {
    expect(() =>
      buildLanguageModel("openai_compatible", "some-model-id", {
        apiKey: "fake-key",
        baseUrl: "http://localhost:1234/v1",
        name: "LM Studio",
      }),
    ).not.toThrow();
  });

  it("rejects an openai_compatible connection with no baseUrl", () => {
    expect(() =>
      buildLanguageModel("openai_compatible", "some-model-id", { apiKey: "fake-key" }),
    ).toThrow(/baseUrl/);
  });

  it("covers every provider type in AI_PROVIDER_TYPES", () => {
    expect(AI_PROVIDER_TYPES).toEqual([
      "openai",
      "anthropic",
      "google",
      "xai",
      "openai_compatible",
    ]);
  });
});
