import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// provider_type is a closed set of Vercel AI SDK adapter kinds, not a vendor
// name -- Kimi/GLM/NVIDIA NIM/OpenRouter/LM Studio/custom endpoints are all
// "openai_compatible" connections distinguished by name + base_url.
// API keys are encrypted at rest (AES-256-GCM); see packages/ai-providers/
// credential-crypto.ts for the encrypt/decrypt side. Plaintext key material
// never exists outside a live request to the provider.
export const aiProviderConnections = pgTable(
  "ai_provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    baseUrl: text("base_url"),
    apiKeyCiphertext: bytea("api_key_ciphertext").notNull(),
    apiKeyIv: bytea("api_key_iv").notNull(),
    apiKeyAuthTag: bytea("api_key_auth_tag").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "ai_provider_connections_provider_type",
      sql`${table.providerType} in ('openai','anthropic','google','xai','openai_compatible')`,
    ),
  ],
);
