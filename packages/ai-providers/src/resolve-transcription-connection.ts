import { aiModels, aiProviderConnections, aiTaskRoutes, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./credential-crypto.js";
import { NoProviderConfiguredError } from "./resolve-model.js";

export interface ResolvedTranscriptionConnection {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

// Structurally parallel to resolve-model.ts's resolveModelForTask, but
// returns raw connection details instead of a Vercel AI SDK LanguageModel.
// Deliberate design choice, not an oversight: a transcription call needs a
// TranscriptionModel, a structurally different SDK type with a different
// input shape (an audio buffer, not a text+tool-schema prompt), and
// @ai-sdk/openai-compatible -- the one adapter this codebase uses for
// every non-native chat vendor, including how a Groq connection would
// otherwise be registered -- has no transcription support at all. Reusing
// only the credential/config tables (ai_provider_connections/ai_models/
// ai_task_routes) and speaking the portable HTTP contract directly also
// keeps ADR-015's "swapping to a self-hosted faster-whisper server later is
// an env var change, not a rewrite" promise intact -- a self-hosted server
// is far more likely to speak that generic contract than to exist as its
// own AI-SDK adapter package.
//
// No fallback chain here (unlike resolveModelForTask's fallbackModelIds) --
// Phase 3 only ever configures one STT provider, and generalizing
// call-with-fallback.ts to be generic over model kind for a single call
// site would be exactly the premature abstraction this codebase avoids.
//
// baseUrl is required, with no native-adapter fallback the way chat models
// have one: every voice_transcribe connection must be registered as
// provider_type "openai_compatible" with an explicit base_url, via the
// existing, unchanged POST /ai/providers routes (which are already generic
// over provider type and task name -- no code changes needed there).
export async function resolveTranscriptionConnectionForTask(
  db: Db,
  taskName: string,
  encryptionKey: string,
): Promise<ResolvedTranscriptionConnection> {
  const [route] = await db.select().from(aiTaskRoutes).where(eq(aiTaskRoutes.taskName, taskName));
  if (!route) {
    throw new NoProviderConfiguredError(taskName);
  }

  const [row] = await db
    .select({
      modelId: aiModels.modelId,
      baseUrl: aiProviderConnections.baseUrl,
      enabled: aiProviderConnections.enabled,
      name: aiProviderConnections.name,
      apiKeyCiphertext: aiProviderConnections.apiKeyCiphertext,
      apiKeyIv: aiProviderConnections.apiKeyIv,
      apiKeyAuthTag: aiProviderConnections.apiKeyAuthTag,
    })
    .from(aiModels)
    .innerJoin(aiProviderConnections, eq(aiModels.providerConnectionId, aiProviderConnections.id))
    .where(eq(aiModels.id, route.primaryModelId));

  if (!row) {
    throw new Error(
      `ai_models row ${route.primaryModelId} referenced by task route "${taskName}" no longer exists`,
    );
  }
  if (!row.enabled) {
    throw new Error(`AI provider connection "${row.name}" is disabled`);
  }
  if (!row.baseUrl) {
    throw new Error(
      `AI provider connection "${row.name}" has no base_url -- required for transcription`,
    );
  }

  const apiKey = decryptSecret(
    { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag },
    encryptionKey,
  );

  return { baseUrl: row.baseUrl, apiKey, modelId: row.modelId };
}
