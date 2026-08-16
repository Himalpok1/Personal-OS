import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  // Master key for AES-256-GCM encryption of AI provider API keys at rest
  // (see @personal-os/ai-providers/credential-crypto.ts). 32 bytes,
  // base64-encoded.
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
});

// Fail fast on missing config. This is distinct from DB *reachability*,
// which /health tolerates at runtime.
export const env = EnvSchema.parse(process.env);
