import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

// provider_type is a closed set of Vercel AI SDK adapter kinds, not a
// vendor name. Every OpenAI-compatible vendor -- Kimi/Moonshot, GLM/Z.AI,
// NVIDIA NIM, OpenRouter, LM Studio, and any future custom endpoint -- is
// modeled as "openai_compatible", distinguished only by name + baseUrl.
// This is the whole point of the abstraction: one adapter type covers
// nearly every vendor, instead of bespoke logic per vendor.
export const AI_PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "openai_compatible",
] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export interface AdapterConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  /** Display name, used as the "name" for openai_compatible connections
   * (surfaces in provider error messages / telemetry). */
  name?: string | undefined;
}

export function buildLanguageModel(
  providerType: AiProviderType,
  modelId: string,
  config: AdapterConfig,
): LanguageModel {
  switch (providerType) {
    case "openai":
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }).chat(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl }).languageModel(
        modelId,
      );
    case "google":
      return createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl }).chat(
        modelId,
      );
    case "xai":
      return createXai({ apiKey: config.apiKey, baseURL: config.baseUrl }).languageModel(modelId);
    case "openai_compatible": {
      if (!config.baseUrl) {
        throw new Error("openai_compatible connections require a baseUrl");
      }
      return createOpenAICompatible({
        name: config.name ?? "openai_compatible",
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      }).chatModel(modelId);
    }
    default: {
      const exhaustive: never = providerType;
      throw new Error(`unknown provider type: ${String(exhaustive)}`);
    }
  }
}
