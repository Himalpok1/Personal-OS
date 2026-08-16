import { describe, expect, it } from "vitest";
import {
  AiProviderConnectionCreateSchema,
  AiProviderConnectionUpdateSchema,
} from "./ai-provider.js";

describe("AiProviderConnectionCreateSchema", () => {
  it("accepts a native provider with no base_url", () => {
    const result = AiProviderConnectionCreateSchema.safeParse({
      name: "My Anthropic",
      provider_type: "anthropic",
      api_key: "sk-ant-fake",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an openai_compatible connection with a base_url", () => {
    const result = AiProviderConnectionCreateSchema.safeParse({
      name: "LM Studio",
      provider_type: "openai_compatible",
      base_url: "http://localhost:1234/v1",
      api_key: "unused",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an openai_compatible connection with no base_url", () => {
    const result = AiProviderConnectionCreateSchema.safeParse({
      name: "LM Studio",
      provider_type: "openai_compatible",
      api_key: "unused",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown provider_type", () => {
    const result = AiProviderConnectionCreateSchema.safeParse({
      name: "bogus",
      provider_type: "not_a_real_provider",
      api_key: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("AiProviderConnectionUpdateSchema", () => {
  it("accepts enabled alone", () => {
    expect(AiProviderConnectionUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("accepts name alone", () => {
    expect(AiProviderConnectionUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("rejects an empty update with neither field", () => {
    expect(AiProviderConnectionUpdateSchema.safeParse({}).success).toBe(false);
  });
});
