import {
  AiModelSchema,
  AiProviderConnectionSchema,
  AiTaskRouteInfoSchema,
  AiTaskRouteSchema,
  AiTaskRouteUpsertSchema,
  type AiModel,
  type AiProviderConnection,
  type AiTaskRoute,
  type AiTaskRouteInfo,
} from "@personal-os/schema";
import { z } from "zod";
import { ApiClientError, fetchJson } from "./client.js";

export type { AiModel, AiProviderConnection, AiTaskRoute, AiTaskRouteInfo };

/** GET /ai/models -- every registered model, across every connection. */
export async function listAiModels(baseUrl: string): Promise<AiModel[]> {
  return fetchJson(baseUrl, "/ai/models", z.array(AiModelSchema));
}

/** GET /ai/providers -- every registered provider connection. Never key material. */
export async function listAiProviders(baseUrl: string): Promise<AiProviderConnection[]> {
  return fetchJson(baseUrl, "/ai/providers", z.array(AiProviderConnectionSchema));
}

/**
 * GET /ai/task-routes -- a read-only, joined view (connection name, provider
 * type, base_url host) of every configured task route. This is also how a
 * client learns whether Cloud Ask is enabled: an entry with
 * `task_name === "ask"` IS the switch being on (Checkpoint 8.6B).
 */
export async function getTaskRoutes(baseUrl: string): Promise<AiTaskRouteInfo[]> {
  return fetchJson(baseUrl, "/ai/task-routes", z.array(AiTaskRouteInfoSchema));
}

/**
 * POST /ai/task-routes. For `task_name: "ask"` specifically, the server
 * refuses to re-point an existing row (`409 ask_route_immutable`) -- changing
 * the model is a DELETE-then-create cycle, which is the re-consent moment
 * Checkpoint 8.6B's design requires. Every other task name upserts as before.
 */
export async function createTaskRoute(
  baseUrl: string,
  taskName: string,
  primaryModelId: string,
): Promise<AiTaskRoute> {
  const parsed = AiTaskRouteUpsertSchema.parse({
    task_name: taskName,
    primary_model_id: primaryModelId,
  });
  return fetchJson(baseUrl, "/ai/task-routes", AiTaskRouteSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

/**
 * DELETE /ai/task-routes/:task_name. Resolves on success (204); a 404 (no such
 * route configured) is normalized to a no-op return rather than a thrown
 * error, matching `disconnectMailConnection`'s treatment of "already gone".
 */
export async function deleteTaskRoute(baseUrl: string, taskName: string): Promise<void> {
  try {
    await fetchJson(baseUrl, `/ai/task-routes/${encodeURIComponent(taskName)}`, z.undefined(), {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return;
    throw error;
  }
}
