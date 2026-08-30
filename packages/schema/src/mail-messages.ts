import {
  MAIL_ADDRESS_MAX_CHARS,
  MAIL_DISPLAY_NAME_MAX_CHARS,
  MAIL_DOMAIN_MAX_CHARS,
  MAIL_EXTERNAL_ID_MAX_CHARS,
  MAIL_LABELS_MAX_COUNT,
  MAIL_LABEL_MAX_CHARS,
  MAIL_SUBJECT_MAX_CHARS,
  MAIL_THREAD_ID_MAX_CHARS,
} from "@personal-os/core/mail/provider-strings";
import { z } from "zod";

// Message METADATA contracts (ADR-053/054).
//
// THIS SHAPE HAS NO BODY, NO SNIPPET AND NO ATTACHMENT FIELD, and that is the
// security property rather than a feature gap. The connection is authorised
// with `gmail.metadata` alone, under which Gmail rejects `format=FULL` and
// `format=RAW` outright -- so a body is unfetchable, not merely unstored.
//
// Two fields here are ATTACKER-AUTHORED: `subject` and `from_display_name`.
// A sender chooses both. They are the entire untrusted-text surface Phase 7
// introduces, and ADR-054 turns on keeping it exactly that small. Both are
// hard-bounded, and a later checkpoint's digest input bounds them again, much
// harder, before anything reaches a prompt.
//
// Every provider string is `.max()`-bounded. `docs/STATUS.md` records the
// inverse as standing debt -- `health_sessions.session_type` is an
// unconstrained `z.string()`, safe only because Google happens to send
// enum-shaped values there. A subject line is the archetype of the value that
// breaks that assumption, because a third party picks it.

/**
 * Opaque provider-defined tags for a message.
 *
 * `provider_labels`, NOT `label_ids`: "label" is Gmail's storage vocabulary
 * (INBOX, UNREAD, CATEGORY_PROMOTIONS), and a future provider that models mail
 * as folders must not be forced to describe them as labels. The contract is
 * "opaque tags this provider attached", which is true of both.
 */
export const MailProviderLabelsSchema = z
  .array(z.string().min(1).max(MAIL_LABEL_MAX_CHARS))
  .max(MAIL_LABELS_MAX_COUNT);

/**
 * One message's metadata.
 *
 * `from_address`, `from_domain`, `from_display_name` and `subject` are all
 * nullable because a malformed or header-stripped message genuinely may lack
 * them, and inventing an empty string would make "the sender set no subject"
 * indistinguishable from "this message has no Subject header". `from_domain` is
 * derived by `extractEmailDomain`, which returns null rather than guessing.
 *
 * `internal_date` is the provider's own received timestamp as a real instant.
 * This is the point at which mail differs from health: Google Health supplies
 * civil dates with no instants (ADR-048), so `health_daily_metrics` stores a
 * `date`; Gmail supplies a true instant, so storing a civil date here would
 * discard precision the provider already gave us.
 */
export const MailMessageMetadataSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  external_id: z.string().min(1).max(MAIL_EXTERNAL_ID_MAX_CHARS),
  thread_id: z.string().min(1).max(MAIL_THREAD_ID_MAX_CHARS),
  internal_date: z.string().datetime({ offset: true }),
  from_address: z.string().max(MAIL_ADDRESS_MAX_CHARS).nullable(),
  from_domain: z.string().max(MAIL_DOMAIN_MAX_CHARS).nullable(),
  from_display_name: z.string().max(MAIL_DISPLAY_NAME_MAX_CHARS).nullable(),
  subject: z.string().max(MAIL_SUBJECT_MAX_CHARS).nullable(),
  provider_labels: MailProviderLabelsSchema,
  has_attachment: z.boolean(),
  size_estimate: z.number().int().min(0).nullable(),
  // A soft, reversible tombstone for a message the provider stopped returning
  // -- reconciliation with upstream truth, not local deletion (ADR-047a).
  deleted_at: z.string().datetime({ offset: true }).nullable(),
});
export type MailMessageMetadata = z.infer<typeof MailMessageMetadataSchema>;
