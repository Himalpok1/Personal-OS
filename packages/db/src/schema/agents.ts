import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Checkpoint 10.9 (ADR-081): one row per registered agent -- the identity a
// future agent runtime operates through. The owner registers it from a
// paired device, a raw bearer token is returned exactly ONCE, and only its
// sha256 hex lands here (the devices.token_hash idiom, ADR-028). Nothing in
// this table is model-facing and nothing in it is ever sent anywhere.
//
//   `trust_level`   the per-agent axis, CHECKed `none|read|propose`
//                   (project-controlled and closed, ADR-050). `none` is
//                   "registered, paused"; `read` may call read tools;
//                   `propose` may also REQUEST actions. There is no
//                   `operator` member: ADR-079 §4's trusted operator is host
//                   access outside the product, and no product principal
//                   ever executes without the owner's tap (ADR-078).
//   `disclosure_version`  WHICH registration disclosure the owner agreed to
//                   (the permission_grants idiom), so a widened disclosure
//                   can be shown as needing re-consent.
//   `revoked_at`    revocation is a timestamp, never a DELETE (the
//                   devices.revoked_at idiom): the audit rows that reference
//                   this agent keep their attribution forever. A revoked
//                   agent's token authenticates nothing.
//   `last_seen_at`  diagnostic only, bumped by the gateway's auth hook --
//                   NOT a heartbeat, exactly as devices.last_seen_at is not.
//
// What an agent is granted lives in permission_grants under principal
// 'agent' (per principal, not per row -- trust level is the per-agent axis);
// what it did lives in agent_tool_calls and action_requests.agent_id.
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    trustLevel: text("trust_level").notNull().default("none"),
    tokenHash: text("token_hash").notNull(),
    disclosureVersion: text("disclosure_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check("agents_trust_level", sql`${table.trustLevel} in ('none','read','propose')`),
    check("agents_name_length", sql`char_length(${table.name}) between 1 and 60`),
    uniqueIndex("agents_token_hash_unique").on(table.tokenHash),
  ],
);
