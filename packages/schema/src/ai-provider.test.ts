import { describe, expect, it } from "vitest";
import {
  AiProviderConnectionCreateSchema,
  AiProviderConnectionUpdateSchema,
  AiTaskRouteInfoSchema,
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

describe("AiTaskRouteInfoSchema (Checkpoint 8.6B)", () => {
  const VALID = {
    task_name: "ask",
    primary_model_id: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
    connection_name: "My OpenAI",
    provider_type: "openai",
    base_url_host: null,
    enabled: true,
  };

  it("accepts a valid row with no base_url host", () => {
    expect(AiTaskRouteInfoSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a base_url host for an openai_compatible connection", () => {
    const result = AiTaskRouteInfoSchema.safeParse({
      ...VALID,
      provider_type: "openai_compatible",
      base_url_host: "localhost",
    });
    expect(result.success).toBe(true);
  });

  it("carries no key material -- unknown fields are rejected, not silently dropped", () => {
    // .strict() is the allowlist mechanism itself: a column nobody named here
    // is a parse failure, not a leak, matching MailSearchResultSchema's
    // documented reasoning.
    const result = AiTaskRouteInfoSchema.safeParse({
      ...VALID,
      api_key: "sk-should-never-be-here",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown provider_type", () => {
    expect(AiTaskRouteInfoSchema.safeParse({ ...VALID, provider_type: "not_real" }).success).toBe(
      false,
    );
  });
});
