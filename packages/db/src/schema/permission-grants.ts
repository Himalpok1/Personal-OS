import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Checkpoint 10.8 (ADR-078): the application-level permission layer.
//
// One row per (principal, permission) grant. A grant is the owner's
// user-visible, revocable answer to "may this principal REQUEST actions that
// need this capability?" -- it never means "may it execute without me": every
// action request still needs a per-request approval (ADR-078 §3). These are
// NOT OAuth scopes; the provider grants stay on their connection rows.
//
// `principal`: `app` is Personal OS itself acting on the owner's behalf from
// a client tap; `agent` is RESERVED for a future agent runtime that does not
// exist (ADR-066 §4). Both are CHECKed because the vocabulary is
// project-controlled and closed (ADR-050); widening it is a migration, on
// purpose. `permission` is NOT CHECKed: the registry grows with every action
// checkpoint, and it is Zod-enforced against `ACTION_PERMISSIONS` in
// packages/schema (the ADR-050 provider-vocabulary rule).
//
// Revocation is `revoked_at`, never a DELETE (the devices.revoked_at idiom),
// so the history of what was allowed and when survives; the partial unique
// index keeps at most one LIVE grant per pair. `disclosure_version` is stored
// on the row rather than compared against a code constant, so a re-consent
// after a wider disclosure is a revoke plus a new row -- the ADR-066
// `ASK_TODAY_CONSENT_FROM` weakness, fixed here.
//
// The `app` principal's grants ship ON (owner decision, 2026-09-17): a pair
// with NO row at all -- live or revoked -- is materialised as a live grant
// lazily by the read model (the memory_settings singleton idiom); a revoked
// row is never re-seeded. Nothing is inserted by the migration. The `agent`
// principal has no grant unless the owner creates one.
export const permissionGrants = pgTable(
  "permission_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principal: text("principal").notNull(),
    permission: text("permission").notNull(),
    disclosureVersion: text("disclosure_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("permission_grants_principal", sql`${table.principal} in ('app','agent')`),
    uniqueIndex("permission_grants_live_unique")
      .on(table.principal, table.permission)
      .where(sql`${table.revokedAt} is null`),
    index("permission_grants_permission_idx").on(table.permission),
  ],
);
