import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { mailDigests, type Db } from "@personal-os/db";
import { isValidTimezone } from "@personal-os/core/timezone";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../../env.js";
import { errorToken, log } from "../../logger.js";
import { collectMailDigestInput } from "./collect-input.js";
import {
  MailDigestFailedError,
  MailDigestTimeoutError,
  type MailDigestInput,
} from "./contracts.js";
import { generateMailDigest, type GenerateMailDigestOptions } from "./generate.js";

// The mail digest pass: collect, generate, persist.
//
// ===========================================================================
// A FAILED GENERATION CAN NEVER OVERWRITE A GOOD DIGEST, STRUCTURALLY.
// ===========================================================================
//
// Not "we are careful not to". The upsert is PHYSICALLY UNREACHABLE from any
// failure path: `generateMailDigest` either returns a complete, filtered,
// non-empty content object or throws, and the only call to
// `persistMailDigest` sits after it in the same straight line. There is no
// catch branch that writes, no partial value to write, and no "write what we
// have" fallback -- so yesterday's digest survives every provider outage,
// timeout, empty completion and filter refusal without any code needing to
// remember that it should.
//
// This is the `ai_daily_briefs` rule (ADR-041/043) restated for mail, and
// migration 0014's own comment demanded it of this checkpoint by name.

export type MailDigestSkipReason =
  "not_configured" | "no_provider_configured" | "no_active_mailboxes";

export interface MailDigestResult {
  skipped: MailDigestSkipReason | null;
  /** Set only on a successful generation. */
  digestDate: string | null;
  modelRowId: string | null;
  linksRemoved: number;
  /** True when the window held no INBOX mail; a digest is still written. */
  emptyWindow: boolean;
  failureClass: string | null;
}

const EMPTY: MailDigestResult = {
  skipped: null,
  digestDate: null,
  modelRowId: null,
  linksRemoved: 0,
  emptyWindow: false,
  failureClass: null,
};

export interface MailDigestDeps {
  db: Db;
  now?: () => Date;
  /** Overridden in tests; production reads the configured zone. */
  timezone?: string;
  generate?: typeof generateMailDigest;
  generateOptions?: GenerateMailDigestOptions;
}

/**
 * The timezone a SCHEDULED digest is generated for.
 *
 * `mail_digests` is keyed on `(digest_date, timezone)` because the same instant
 * is a different local date in different zones. An on-demand caller states which
 * zone it wants; a cron has nobody to ask, so the zone must come from config.
 *
 * The alternatives were considered and rejected as worse: deriving it from the
 * newest capture's `timezone`, or from the primary reminder device's
 * `quiet_hours_timezone`, would make the digest's IDENTITY drift silently as
 * devices come and go -- and a key that moves on its own produces duplicate rows
 * nobody asked for. Explicit configuration is the honest answer.
 *
 * Defaults to UTC when unset, which is deliberate rather than convenient: a
 * deployment that has not chosen a zone gets a correct, boring answer instead of
 * a guessed one, and Checkpoint 7.6's UI can request a different zone on demand.
 */
export function resolveDigestTimezone(): string {
  const configured = env.MAIL_DIGEST_TIMEZONE;
  if (configured !== undefined && isValidTimezone(configured)) return configured;
  if (configured !== undefined) {
    // Named but unusable. Falling back silently would generate digests under a
    // key the operator did not choose and cannot find.
    log.warn("mail.digest.invalid_timezone");
  }
  return "UTC";
}

/**
 * Upserts on `(digest_date, timezone)`.
 *
 * Regeneration replaces the row rather than appending: ADR-054 keeps exactly one
 * digest per key with no history, mirroring `ai_daily_briefs`. `created_at` is
 * left alone on conflict so the row keeps its original identity while
 * `generated_at` records when the CONTENT was produced -- two distinct facts the
 * table deliberately separates.
 */
export async function persistMailDigest(
  db: Db,
  params: {
    digestDate: string;
    timezone: string;
    text: string;
    modelRowId: string | null;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(mailDigests)
    .values({
      digestDate: params.digestDate,
      timezone: params.timezone,
      content: { text: params.text },
      modelId: params.modelRowId,
      generatedAt: params.now,
      updatedAt: params.now,
    })
    .onConflictDoUpdate({
      target: [mailDigests.digestDate, mailDigests.timezone],
      set: {
        content: sql`excluded.content`,
        modelId: sql`excluded.model_id`,
        generatedAt: sql`excluded.generated_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({ id: mailDigests.id });
  return row!.id;
}

/** Reads the digest for one key. Used by tests and by Checkpoint 7.6's route. */
export async function readMailDigest(
  db: Db,
  digestDate: string,
  timezone: string,
): Promise<typeof mailDigests.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(mailDigests)
    .where(and(eq(mailDigests.digestDate, digestDate), eq(mailDigests.timezone, timezone)))
    .limit(1);
  return row;
}

/**
 * Runs one digest pass.
 *
 * Returns rather than throws on every expected condition, for the reason every
 * mail job does: the queue is registered `retryLimit: 0`, so throwing would make
 * pg-boss neither the retry nor a useful record. The next scheduled tick is the
 * retry, and it re-collects from current state rather than replaying a stale
 * payload.
 */
export async function runMailDigest(deps: MailDigestDeps): Promise<MailDigestResult> {
  const now = deps.now ? deps.now() : new Date();
  const timezone = deps.timezone ?? resolveDigestTimezone();

  const collected = await collectMailDigestInput({ db: deps.db, timezone, now });

  if (collected.input.summary.mailbox_count === 0 && collected.empty) {
    // No active mailbox contributed anything. Generating a digest here would
    // mean paying a provider call to be told there is no mail -- and writing a
    // row that says nothing would displace a real digest from an earlier pass
    // on the same local date.
    log.info("mail.digest.skipped", {
      reason: "no_active_mailboxes",
      localDate: collected.localDate,
    });
    return { ...EMPTY, skipped: "no_active_mailboxes", emptyWindow: true };
  }

  const generate = deps.generate ?? generateMailDigest;

  let generated;
  try {
    generated = await generate(
      deps.db,
      collected.input,
      env.CREDENTIALS_ENCRYPTION_KEY,
      deps.generateOptions ?? {},
    );
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) {
      // A deployment state, not a fault: no `mail_digest` route is registered.
      // Recorded distinctly so it is never mistaken for a provider outage.
      log.info("mail.digest.skipped", { reason: "no_provider_configured" });
      return { ...EMPTY, skipped: "no_provider_configured" };
    }
    const failureClass =
      error instanceof MailDigestTimeoutError
        ? "digest_timeout"
        : error instanceof MailDigestFailedError
          ? "digest_failed"
          : "digest_error";

    // NOTHING IS WRITTEN HERE. See the module comment: the persist call is
    // physically unreachable from this branch, so a previous digest for this
    // key survives untouched.
    log.warn("mail.digest.failed", { failureClass, error: errorToken(error) });
    return { ...EMPTY, failureClass, emptyWindow: collected.empty };
  }

  await persistMailDigest(deps.db, {
    digestDate: collected.localDate,
    timezone,
    text: generated.content.text,
    modelRowId: generated.modelRowId,
    now,
  });

  log.info("mail.digest.generated", {
    localDate: collected.localDate,
    tz: timezone,
    messages: collected.input.summary.total_count,
    unread: collected.input.summary.unread_count,
    mailboxes: collected.input.summary.mailbox_count,
    highlights: collected.input.highlights.items.length,
    linksRemoved: generated.linksRemoved,
    // The model row id, never the text: the text is the one thing in this pass
    // derived from attacker-authored input.
    modelId: generated.modelRowId,
  });

  return {
    skipped: null,
    digestDate: collected.localDate,
    modelRowId: generated.modelRowId,
    linksRemoved: generated.linksRemoved,
    emptyWindow: collected.empty,
    failureClass: null,
  };
}

export type { MailDigestInput };
