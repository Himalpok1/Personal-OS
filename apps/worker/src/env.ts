import { z } from "zod";

/**
 * An optional string that treats "" exactly like an absent variable.
 *
 * docker-compose's `${VAR:-}` renders an empty string, not an omitted key, so a
 * plain `z.string().min(1).optional()` rejects an unconfigured optional var and
 * the process dies at import. Anything genuinely present must still be
 * non-empty.
 */
function optionalNonEmpty() {
  return z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());
}

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

  // Google Health OAuth (Phase 6 Checkpoint 6.3). A SEPARATE OAuth client
  // from GOOGLE_OAUTH_* above -- a Calendar token is never reused as a
  // Health token.
  //
  // OPTIONAL, deliberately unlike the Calendar pair immediately above.
  // Checkpoint 6.3 refreshes a Health access token INLINE, from whichever
  // sync operation needs one (there is no refresh-token batch job), so the
  // worker must still boot when Health is not configured and degrade to a
  // logged skip rather than crash-looping. That mirrors apps/api's copy,
  // which is optional for the same reason.
  //
  // The redirect-URI allowlist is deliberately absent: only apps/api mints
  // authorization URLs and handles the callback. The worker never needs it.
  // `optionalNonEmpty`, not a bare `.optional()`: docker-compose passes these
  // as `${VAR:-}`, which renders an EMPTY STRING rather than omitting the
  // variable, and `z.string().min(1).optional()` throws on "" (it only tolerates
  // `undefined`). On a host with no Health credentials -- which is production
  // today -- that killed BOTH api and worker at import, taking capture,
  // calendar, notifications and reminders down with them. Found by the
  // Checkpoint 6.3 audit; the api half predates 6.3.
  GOOGLE_HEALTH_OAUTH_CLIENT_ID: optionalNonEmpty(),
  GOOGLE_HEALTH_OAUTH_CLIENT_SECRET: optionalNonEmpty(),

  // Gmail OAuth (Phase 7 Checkpoint 7.3). A THIRD OAuth client, distinct from
  // both pairs above -- a Calendar or Health token is never reused as a mail
  // token (ADR-053).
  //
  // Checkpoint 7.2 added these to apps/api only, and said why: "the worker has
  // no mail code yet, so 7.3 adds its passthrough alongside the sync engine
  // that needs it". This is that passthrough. The worker needs them because it
  // refreshes a mail access token INLINE from the sync pass, exactly as it does
  // for Health -- there is no refresh-token batch job.
  //
  // `optionalNonEmpty`, not a bare `.optional()`, for the reason recorded
  // above: docker-compose passes these as `${VAR:-}`, which renders an EMPTY
  // STRING rather than omitting the variable, and `z.string().min(1).optional()`
  // throws on "" because it only tolerates `undefined`. On a host with no mail
  // credentials -- which is production today -- the naive shape would kill the
  // worker at import and take capture, calendar, health, notifications and
  // reminders down with it.
  //
  // The redirect-URI allowlist is deliberately absent: only apps/api mints
  // authorization URLs and handles the callback. The worker never needs it.
  GMAIL_OAUTH_CLIENT_ID: optionalNonEmpty(),
  GMAIL_OAUTH_CLIENT_SECRET: optionalNonEmpty(),
});

export const env = EnvSchema.parse(process.env);
