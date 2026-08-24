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
  // Shared filesystem between apps/api and apps/worker -- POST /transcribe
  // writes a PTT recording here, apps/worker's ptt.transcribe job reads and
  // then deletes it once a transcript is committed (or on permanent
  // failure/orphan sweep). Must resolve to the same physical location in
  // both processes: locally that's trivially true (same machine), in
  // production it's the audio_data named volume mounted into both
  // containers at this same path -- see docker-compose.yml.
  AUDIO_STORAGE_PATH: z.string().min(1).default("/tmp/personal-os-audio"),

  // Google Calendar OAuth (Phase 4 Checkpoint 4.5 Stage B). The client id is
  // non-secret and also lives in apps/mobile's EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
  // (Stage A's native AuthorizationClient flow needs it client-side too) --
  // the two must refer to the same OAuth client. The secret is server-only
  // and must never be exposed to apps/mobile.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  // Google Health OAuth (Phase 6 Checkpoint 6.2). A SEPARATE OAuth client from
  // GOOGLE_OAUTH_* above -- a Calendar token is never reused as a Health token.
  //
  // OPTIONAL, unlike the Calendar pair, and deliberately so: the API and worker
  // must still boot when Health is not configured, degrading to a structured
  // "not configured" error rather than crash-looping. That mirrors how the AI
  // layer returns 409 no_provider_configured instead of refusing to start.
  //
  // GOOGLE_HEALTH_OAUTH_REDIRECT_URI is the exact-match ALLOWLIST, not a
  // default: it is comma-separated so a second entry can be added later, and a
  // redirect_uri that is not in it is rejected outright. It is never taken from
  // the client.
  GOOGLE_HEALTH_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_HEALTH_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_HEALTH_OAUTH_REDIRECT_URI: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? []
        : value
            .split(",")
            .map((uri) => uri.trim())
            .filter((uri) => uri.length > 0),
    ),
});

// Fail fast on missing config. This is distinct from DB *reachability*,
// which /health tolerates at runtime.
export const env = EnvSchema.parse(process.env);
