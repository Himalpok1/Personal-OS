import { z } from "zod";

export const AiProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "openai_compatible",
]);
export type AiProviderType = z.infer<typeof AiProviderTypeSchema>;

// api_key is accepted here (write path only) and encrypted at rest by
// packages/ai-providers before it ever reaches Drizzle. Every *response*
// schema in this file deliberately excludes key material -- not ciphertext,
// not plaintext -- so a future Settings UI can't leak a key just by reusing
// an existing response shape.
export const AiProviderConnectionCreateSchema = z
  .object({
    name: z.string().min(1),
    provider_type: AiProviderTypeSchema,
    base_url: z.string().url().optional(),
    api_key: z.string().min(1),
  })
  .refine((value) => value.provider_type !== "openai_compatible" || value.base_url !== undefined, {
    message: "base_url is required for openai_compatible connections",
    path: ["base_url"],
  });
export type AiProviderConnectionCreate = z.infer<typeof AiProviderConnectionCreateSchema>;

export const AiProviderConnectionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.enabled !== undefined, {
    message: "at least one field must be provided",
  });
export type AiProviderConnectionUpdate = z.infer<typeof AiProviderConnectionUpdateSchema>;

export const AiProviderConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  provider_type: AiProviderTypeSchema,
  base_url: z.string().nullable(),
  enabled: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type AiProviderConnection = z.infer<typeof AiProviderConnectionSchema>;

export const AiProviderTestResponseSchema = z.object({
  success: z.boolean(),
  latency_ms: z.number().optional(),
  error: z.string().optional(),
});
export type AiProviderTestResponse = z.infer<typeof AiProviderTestResponseSchema>;

export const AiModelCreateSchema = z.object({
  provider_connection_id: z.string().uuid(),
  model_id: z.string().min(1),
  display_name: z.string().optional(),
});
export type AiModelCreate = z.infer<typeof AiModelCreateSchema>;

export const AiModelSchema = z.object({
  id: z.string().uuid(),
  provider_connection_id: z.string().uuid(),
  model_id: z.string(),
  display_name: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type AiModel = z.infer<typeof AiModelSchema>;

// Phase 1 only ever sets task_name = "capture_parser", but the shape is
// generic for future tasks (e.g. a Phase 7 email digest).
export const AiTaskRouteUpsertSchema = z.object({
  task_name: z.string().min(1),
  primary_model_id: z.string().uuid(),
  fallback_model_ids: z.array(z.string().uuid()).optional(),
});
export type AiTaskRouteUpsert = z.infer<typeof AiTaskRouteUpsertSchema>;

export const AiTaskRouteSchema = z.object({
  id: z.string().uuid(),
  task_name: z.string(),
  primary_model_id: z.string().uuid(),
  fallback_model_ids: z.array(z.string().uuid()).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type AiTaskRoute = z.infer<typeof AiTaskRouteSchema>;

// Checkpoint 8.6B -- GET /ai/task-routes. A read-only, JOINED view for the
// mobile Settings card: what a task route resolves to, in terms a person can
// read (a connection name, a provider type, the HOST of a base_url when one
// is set) rather than raw uuids. This is also how the mobile client learns
// whether Cloud Ask is enabled at all -- the "ask" row's presence IS the
// switch (see apps/api/src/ask/authorize.ts) -- so this schema is the only
// place either surface needs to agree on the shape.
//
// Deliberately excludes any key material -- same discipline as
// AiProviderConnectionSchema above, and for the same reason: a future screen
// that renders this response can never leak one just by reusing it.
export const AiTaskRouteInfoSchema = z
  .object({
    task_name: z.string(),
    primary_model_id: z.string().uuid(),
    connection_name: z.string(),
    provider_type: AiProviderTypeSchema,
    /** The HOST of the connection's base_url when one is configured, else null. */
    base_url_host: z.string().nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type AiTaskRouteInfo = z.infer<typeof AiTaskRouteInfoSchema>;
