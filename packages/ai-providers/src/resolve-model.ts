import { aiModels, aiProviderConnections, aiTaskRoutes, type Db } from "@personal-os/db";
import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { type AiProviderType, buildLanguageModel } from "./adapter-registry.js";
import { decryptSecret } from "./credential-crypto.js";

// Thrown when no ai_task_routes row exists for taskName -- a configuration
// error, not a transient one. Callers (worker jobs) should treat this as
// immediately terminal, not retry it.
export class NoProviderConfiguredError extends Error {
  constructor(taskName: string) {
    super(`no AI provider is configured for task "${taskName}"`);
    this.name = "NoProviderConfiguredError";
  }
}

export interface ResolvedModel {
  model: LanguageModel;
  fallbacks: LanguageModel[];
}

async function loadModel(
  db: Db,
  modelRowId: string,
  encryptionKey: string,
): Promise<LanguageModel> {
  const [row] = await db
    .select({
      modelId: aiModels.modelId,
      providerType: aiProviderConnections.providerType,
      baseUrl: aiProviderConnections.baseUrl,
      name: aiProviderConnections.name,
      enabled: aiProviderConnections.enabled,
      apiKeyCiphertext: aiProviderConnections.apiKeyCiphertext,
      apiKeyIv: aiProviderConnections.apiKeyIv,
      apiKeyAuthTag: aiProviderConnections.apiKeyAuthTag,
    })
    .from(aiModels)
    .innerJoin(aiProviderConnections, eq(aiModels.providerConnectionId, aiProviderConnections.id))
    .where(eq(aiModels.id, modelRowId));

  if (!row) {
    throw new Error(`ai_models row ${modelRowId} referenced by a task route no longer exists`);
  }
  if (!row.enabled) {
    throw new Error(`AI provider connection "${row.name}" is disabled`);
  }

  const apiKey = decryptSecret(
    { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag },
    encryptionKey,
  );

  return buildLanguageModel(row.providerType as AiProviderType, row.modelId, {
    apiKey,
    baseUrl: row.baseUrl ?? undefined,
    name: row.name,
  });
}

// Builds a model directly from a provider connection + an ad-hoc model id,
// without requiring an ai_models row to exist yet -- used by the
// POST /ai/providers/:id/test route so a connection can be smoke-tested
// before the user commits to registering a model under it.
export async function loadModelForConnection(
  db: Db,
  connectionId: string,
  modelId: string,
  encryptionKey: string,
): Promise<LanguageModel> {
  const [row] = await db
    .select()
    .from(aiProviderConnections)
    .where(eq(aiProviderConnections.id, connectionId));
  if (!row) {
    throw new Error(`ai_provider_connections row ${connectionId} not found`);
  }
  if (!row.enabled) {
    throw new Error(`AI provider connection "${row.name}" is disabled`);
  }

  const apiKey = decryptSecret(
    { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag },
    encryptionKey,
  );

  return buildLanguageModel(row.providerType as AiProviderType, modelId, {
    apiKey,
    baseUrl: row.baseUrl ?? undefined,
    name: row.name,
  });
}

// Looks up ai_task_routes -> ai_models -> ai_provider_connections, decrypts
// the stored API key, and builds a ready-to-call model via the adapter
// registry. Fallback models are only ever the ones the caller explicitly
// configured on the route -- see call-with-fallback.ts.
export async function resolveModelForTask(
  db: Db,
  taskName: string,
  encryptionKey: string,
): Promise<ResolvedModel> {
  const [route] = await db.select().from(aiTaskRoutes).where(eq(aiTaskRoutes.taskName, taskName));
  if (!route) {
    throw new NoProviderConfiguredError(taskName);
  }

  const model = await loadModel(db, route.primaryModelId, encryptionKey);
  const fallbacks: LanguageModel[] = [];
  for (const fallbackModelId of route.fallbackModelIds ?? []) {
    fallbacks.push(await loadModel(db, fallbackModelId, encryptionKey));
  }

  return { model, fallbacks };
}
