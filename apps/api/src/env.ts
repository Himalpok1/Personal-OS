import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  // Master key for AES-256-GCM encryption of AI provider API keys at rest
  // (see @personal-os/ai-providers/credential-crypto.ts). 32 bytes,
  // base64-encoded.
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(1),
  // Comma-separated CORS allowlist for apps/mobile's web build -- the
  // deployed static export and the local Metro dev server are different
  // origins from this API (different port, and in production a different
  // Tailscale Serve port entirely), so the browser enforces CORS even
  // though both sides are same-user, same-tailnet. No wildcard; defaults
  // cover Expo's common local dev ports so `expo start --web` works
  // out of the box without extra config.
  WEB_APP_ORIGIN: z
    .string()
    .default("http://localhost:8081,http://localhost:8082,http://localhost:19006")
    .transform((value) => value.split(",").map((origin) => origin.trim())),
});

// Fail fast on missing config. This is distinct from DB *reachability*,
// which /health tolerates at runtime.
export const env = EnvSchema.parse(process.env);
