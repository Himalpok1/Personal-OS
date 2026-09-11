// Route tests for the Checkpoint 8.6B additions to ai-config.ts:
// GET /ai/task-routes, DELETE /ai/task-routes/:task_name, and the "ask" row's
// create-or-delete-only lifecycle on POST /ai/task-routes. Pre-existing routes
// in this file predate automated coverage (the file's own comment calls them
// "minimal, curl-testable CRUD") and are left as-is; this file does not
// attempt to backfill that.
import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import type { AiProviderType, AiTaskRoute, AiTaskRouteInfo } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

describe("Checkpoint 8.6B additions to /ai/task-routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  async function seedModel(
    name = "Test provider",
    providerType: AiProviderType = "openai_compatible",
    baseUrl: string | null = "https://example.invalid/v1",
  ): Promise<string> {
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name,
        providerType,
        baseUrl,
        apiKeyCiphertext: Buffer.from("ciphertext"),
        apiKeyIv: Buffer.from("iv"),
        apiKeyAuthTag: Buffer.from("authtag"),
      })
      .returning();
    const [model] = await app.db
      .insert(aiModels)
      .values({ providerConnectionId: connection!.id, modelId: "test-model" })
      .returning();
    return model!.id;
  }

  function post(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/ai/task-routes", payload: body });
  }

  describe("POST /ai/task-routes -- the ask row is create-or-delete only", () => {
    it("creates the ask route on first POST", async () => {
      const modelId = await seedModel();
      const response = await post({ task_name: "ask", primary_model_id: modelId });
      expect(response.statusCode).toBe(201);
      expect(response.json<AiTaskRoute>().primary_model_id).toBe(modelId);
    });

    it("refuses to re-point an existing ask route with 409 ask_route_immutable", async () => {
      const firstModel = await seedModel("First");
      const secondModel = await seedModel("Second");
      const first = await post({ task_name: "ask", primary_model_id: firstModel });
      expect(first.statusCode).toBe(201);

      const second = await post({ task_name: "ask", primary_model_id: secondModel });
      expect(second.statusCode).toBe(409);
      expect(second.json<ErrorBody>()).toEqual({ error: "ask_route_immutable" });

      // Unchanged -- still pointed at the first model.
      const [row] = await app.db.select().from(aiTaskRoutes);
      expect(row?.primaryModelId).toBe(firstModel);
    });

    it("every other task_name still upserts normally (unchanged behavior)", async () => {
      const firstModel = await seedModel("First");
      const secondModel = await seedModel("Second");
      const first = await post({ task_name: "daily_brief", primary_model_id: firstModel });
      expect(first.statusCode).toBe(200);
      const second = await post({ task_name: "daily_brief", primary_model_id: secondModel });
      expect(second.statusCode).toBe(200);
      expect(second.json<AiTaskRoute>().primary_model_id).toBe(secondModel);
    });
  });

  describe("GET /ai/task-routes", () => {
    it("returns an empty array when nothing is configured", async () => {
      const response = await app.inject({ method: "GET", url: "/ai/task-routes" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it("joins connection name, provider_type, and the HOST of base_url (never the full url)", async () => {
      const modelId = await seedModel(
        "My LM Studio",
        "openai_compatible",
        "http://localhost:1234/v1/deep/path?key=shouldnotleak",
      );
      await post({ task_name: "ask", primary_model_id: modelId });

      const response = await app.inject({ method: "GET", url: "/ai/task-routes" });
      expect(response.statusCode).toBe(200);
      const rows = response.json<AiTaskRouteInfo[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        task_name: "ask",
        primary_model_id: modelId,
        connection_name: "My LM Studio",
        provider_type: "openai_compatible",
        base_url_host: "localhost:1234",
        enabled: true,
      });
      // The full URL (path, query) never reaches the response -- only the host.
      expect(response.body).not.toContain("deep/path");
      expect(response.body).not.toContain("shouldnotleak");
    });

    it("carries a null base_url_host for a native provider with no base_url", async () => {
      const modelId = await seedModel("My Anthropic", "anthropic", null);
      await post({ task_name: "daily_brief", primary_model_id: modelId });
      const response = await app.inject({ method: "GET", url: "/ai/task-routes" });
      expect(response.json<AiTaskRouteInfo[]>()[0]?.base_url_host).toBeNull();
    });

    it("never emits key material -- same discipline as GET /ai/providers", async () => {
      const modelId = await seedModel();
      await post({ task_name: "ask", primary_model_id: modelId });
      const response = await app.inject({ method: "GET", url: "/ai/task-routes" });
      for (const forbidden of ["ciphertext", "authtag", "api_key", "apiKey"]) {
        expect(response.body.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });

  describe("DELETE /ai/task-routes/:task_name", () => {
    it("deletes an existing route, returning 204", async () => {
      const modelId = await seedModel();
      await post({ task_name: "ask", primary_model_id: modelId });

      const response = await app.inject({ method: "DELETE", url: "/ai/task-routes/ask" });
      expect(response.statusCode).toBe(204);

      const rows = await app.db.select().from(aiTaskRoutes);
      expect(rows).toEqual([]);
    });

    it("404s when the named route does not currently exist", async () => {
      const response = await app.inject({ method: "DELETE", url: "/ai/task-routes/ask" });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>()).toEqual({ error: "not_found" });
    });

    it("400s a task_name outside the closed known set, rather than a no-op 404", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/ai/task-routes/some_made_up_task",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>()).toEqual({ error: "unknown_task_name" });
    });

    it("re-enabling after a delete is a normal create (the re-consent cycle)", async () => {
      const modelId = await seedModel();
      expect((await post({ task_name: "ask", primary_model_id: modelId })).statusCode).toBe(201);
      expect((await app.inject({ method: "DELETE", url: "/ai/task-routes/ask" })).statusCode).toBe(
        204,
      );
      expect((await post({ task_name: "ask", primary_model_id: modelId })).statusCode).toBe(201);
    });
  });
});
