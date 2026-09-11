import { loadModelForConnection, encryptSecret } from "@personal-os/ai-providers";
import { classifyAiProviderTestFailure } from "./ai-provider-test-failure.js";
import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import {
  AiModelCreateSchema,
  AiModelSchema,
  AiProviderConnectionCreateSchema,
  AiProviderConnectionSchema,
  AiProviderConnectionUpdateSchema,
  AiProviderTestResponseSchema,
  AiTaskRouteInfoSchema,
  AiTaskRouteSchema,
  AiTaskRouteUpsertSchema,
  type AiTaskRouteInfo,
} from "@personal-os/schema";
import { generateText } from "ai";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ASK_TASK_NAME } from "../ask/contracts.js";
import { env } from "../env.js";

/**
 * The closed set of `task_name` values this API has ever registered a route
 * for. `DELETE /ai/task-routes/:task_name` refuses anything outside it with
 * `400 unknown_task_name` -- a defence against a typo silently no-oping (a
 * DELETE on a name that could never exist returns 404 either way, but 400
 * distinguishes "you asked for something that isn't a task" from "that task
 * route just isn't configured right now").
 */
const KNOWN_TASK_NAMES: ReadonlySet<string> = new Set([
  "capture_parser",
  "daily_brief",
  "mail_digest",
  "voice_transcribe",
  ASK_TASK_NAME,
]);

function toConnectionResponse(row: typeof aiProviderConnections.$inferSelect) {
  return AiProviderConnectionSchema.parse({
    id: row.id,
    name: row.name,
    provider_type: row.providerType,
    base_url: row.baseUrl,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function toModelResponse(row: typeof aiModels.$inferSelect) {
  return AiModelSchema.parse({
    id: row.id,
    provider_connection_id: row.providerConnectionId,
    model_id: row.modelId,
    display_name: row.displayName,
    created_at: row.createdAt.toISOString(),
  });
}

function toTaskRouteResponse(row: typeof aiTaskRoutes.$inferSelect) {
  return AiTaskRouteSchema.parse({
    id: row.id,
    task_name: row.taskName,
    primary_model_id: row.primaryModelId,
    fallback_model_ids: row.fallbackModelIds,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

/** The HOST of a base_url, or null when none is set. Never the full URL (no path, no query, no credentials). */
function baseUrlHost(baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

// Minimal, curl-testable CRUD over the AI provider layer -- data model,
// encryption, and adapter registry are built in @personal-os/ai-providers;
// this is just the HTTP surface a future Settings UI will sit on top of.
// Response schemas deliberately never include key material (see
// packages/schema/src/ai-provider.ts).
export default function aiConfigRoutes(app: FastifyInstance): void {
  app.post("/ai/providers", async (request, reply) => {
    const body = AiProviderConnectionCreateSchema.parse(request.body);
    const encrypted = encryptSecret(body.api_key, env.CREDENTIALS_ENCRYPTION_KEY);
    const [row] = await app.db
      .insert(aiProviderConnections)
      .values({
        name: body.name,
        providerType: body.provider_type,
        baseUrl: body.base_url,
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
      })
      .returning();
    if (!row) throw new Error("insert into ai_provider_connections returned no row");
    return reply.code(201).send(toConnectionResponse(row));
  });

  app.get("/ai/providers", async () => {
    const rows = await app.db.select().from(aiProviderConnections);
    return rows.map(toConnectionResponse);
  });

  app.patch<{ Params: { id: string } }>("/ai/providers/:id", async (request, reply) => {
    const body = AiProviderConnectionUpdateSchema.parse(request.body);
    const [row] = await app.db
      .update(aiProviderConnections)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        updatedAt: new Date(),
      })
      .where(eq(aiProviderConnections.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toConnectionResponse(row);
  });

  // Fires a trivial prompt through the adapter registry to confirm a key +
  // model actually work, before the caller commits to registering a model.
  // Writes nothing to the capture pipeline.
  app.post<{ Params: { id: string } }>("/ai/providers/:id/test", async (request) => {
    const { model_id } = z.object({ model_id: z.string().min(1) }).parse(request.body);
    const startedAt = Date.now();
    try {
      const model = await loadModelForConnection(
        app.db,
        request.params.id,
        model_id,
        env.CREDENTIALS_ENCRYPTION_KEY,
      );
      await generateText({
        model,
        prompt: "Reply with exactly the word: ok",
        // Checkpoint 8.6B (D1f) -- see capture-parse.ts's identical comment.
        // This route already reports success/failure to the caller in one
        // request/response; a silent SDK-level retry would just make a slow
        // failure look like a longer success.
        maxRetries: 0,
        experimental_telemetry: { isEnabled: false },
      });
      return AiProviderTestResponseSchema.parse({
        success: true,
        latency_ms: Date.now() - startedAt,
      });
    } catch (err) {
      // `err` here comes off an LLM vendor's SDK and can carry the upstream
      // response body -- and this is the one route whose whole job is to talk
      // to a user-supplied endpoint with a user-supplied key. It gets the same
      // treatment as the calendar and health provider surfaces: a bounded
      // classification, never the vendor's words.
      return AiProviderTestResponseSchema.parse({
        success: false,
        latency_ms: Date.now() - startedAt,
        error: classifyAiProviderTestFailure(err),
      });
    }
  });

  app.post("/ai/models", async (request, reply) => {
    const body = AiModelCreateSchema.parse(request.body);
    const [row] = await app.db
      .insert(aiModels)
      .values({
        providerConnectionId: body.provider_connection_id,
        modelId: body.model_id,
        displayName: body.display_name,
      })
      .returning();
    if (!row) throw new Error("insert into ai_models returned no row");
    return reply.code(201).send(toModelResponse(row));
  });

  app.get("/ai/models", async () => {
    const rows = await app.db.select().from(aiModels);
    return rows.map(toModelResponse);
  });

  // Upserts by task_name -- Phase 1 only ever sets "capture_parser", but
  // this is generic for future tasks (see ai_task_routes.task_name).
  //
  // CHECKPOINT 8.6B EXCEPTION: the "ask" row is create-or-delete ONLY, never
  // re-pointed. Its presence IS the Cloud Ask switch (see
  // apps/api/src/ask/authorize.ts), and re-pointing it silently would let a
  // model swap happen without the one-time disclosure sheet the mobile client
  // shows only on CREATE. Changing the model is therefore always a
  // DELETE-then-create cycle, which is the re-consent moment design §6.4
  // requires.
  app.post("/ai/task-routes", async (request, reply) => {
    const body = AiTaskRouteUpsertSchema.parse(request.body);

    if (body.task_name === ASK_TASK_NAME) {
      // A plain INSERT with onConflictDoNothing rather than an upsert: if a
      // row already exists, RETURNING yields nothing and the conflict itself
      // is the signal, without a separate SELECT-then-INSERT race window.
      const [row] = await app.db
        .insert(aiTaskRoutes)
        .values({
          taskName: body.task_name,
          primaryModelId: body.primary_model_id,
          fallbackModelIds: body.fallback_model_ids,
        })
        .onConflictDoNothing({ target: aiTaskRoutes.taskName })
        .returning();
      if (!row) return reply.code(409).send({ error: "ask_route_immutable" });
      return reply.code(201).send(toTaskRouteResponse(row));
    }

    const [row] = await app.db
      .insert(aiTaskRoutes)
      .values({
        taskName: body.task_name,
        primaryModelId: body.primary_model_id,
        fallbackModelIds: body.fallback_model_ids,
      })
      .onConflictDoUpdate({
        target: aiTaskRoutes.taskName,
        set: {
          primaryModelId: body.primary_model_id,
          fallbackModelIds: body.fallback_model_ids,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("upsert into ai_task_routes returned no row");
    return reply.code(200).send(toTaskRouteResponse(row));
  });

  // Read-only, JOINED view for a Settings card: what each task route resolves
  // to, in terms a person can read. Also how the mobile client learns whether
  // Cloud Ask is enabled at all -- an "ask" entry in this list IS the switch
  // being on (packages/schema/src/ai-provider.ts's AiTaskRouteInfoSchema
  // comment).
  app.get("/ai/task-routes", async (): Promise<AiTaskRouteInfo[]> => {
    const rows = await app.db
      .select({
        taskName: aiTaskRoutes.taskName,
        primaryModelId: aiTaskRoutes.primaryModelId,
        connectionName: aiProviderConnections.name,
        providerType: aiProviderConnections.providerType,
        baseUrl: aiProviderConnections.baseUrl,
        enabled: aiProviderConnections.enabled,
      })
      .from(aiTaskRoutes)
      .innerJoin(aiModels, eq(aiTaskRoutes.primaryModelId, aiModels.id))
      .innerJoin(
        aiProviderConnections,
        eq(aiModels.providerConnectionId, aiProviderConnections.id),
      );

    return rows.map((row) =>
      AiTaskRouteInfoSchema.parse({
        task_name: row.taskName,
        primary_model_id: row.primaryModelId,
        connection_name: row.connectionName,
        provider_type: row.providerType,
        base_url_host: baseUrlHost(row.baseUrl),
        enabled: row.enabled,
      }),
    );
  });

  // Deletes a task route by name -- the other half of the "ask" row's
  // create-or-delete lifecycle, and generically useful for any task route
  // (there was previously no DELETE at all -- recorded standing debt).
  app.delete<{ Params: { task_name: string } }>(
    "/ai/task-routes/:task_name",
    async (request, reply) => {
      const { task_name } = request.params;
      if (!KNOWN_TASK_NAMES.has(task_name)) {
        return reply.code(400).send({ error: "unknown_task_name" });
      }
      const deleted = await app.db
        .delete(aiTaskRoutes)
        .where(eq(aiTaskRoutes.taskName, task_name))
        .returning({ id: aiTaskRoutes.id });
      if (deleted.length === 0) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );
}
