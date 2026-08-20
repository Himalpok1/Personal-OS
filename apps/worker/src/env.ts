import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Master key for AES-256-GCM decryption of AI provider API keys at rest
  // (see @personal-os/ai-providers/credential-crypto.ts). 32 bytes,
  // base64-encoded. Must match apps/api's copy.
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
  // Must match apps/api's copy exactly -- see the comment there.
  AUDIO_STORAGE_PATH: z.string().min(1).default("/tmp/personal-os-audio"),

  // Google Calendar OAuth (Phase 4 Checkpoint 4.5 Stage B) -- must match
  // apps/api's copy exactly. The worker needs these for the token-refresh
  // job (calendar.google.refresh-token), which calls Google's token
  // endpoint directly, not through apps/api.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
});

export const env = EnvSchema.parse(process.env);
