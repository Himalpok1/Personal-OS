import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Single-use OAuth state for the Gmail authorization flow (ADR-053,
// migration 0014). Deliberately a near-copy of health_oauth_states: that
// design is proven in production and the threat model is identical.
//
// Only the sha256 of the state is stored -- never the raw value -- mirroring
// device_pairing_codes' hash-only convention, so a database dump cannot be
// replayed into a consent flow. Validation is an atomic
// UPDATE ... WHERE consumed_at IS NULL ... RETURNING, so two concurrent
// callbacks cannot both consume one state.
//
// redirect_uri is stored so a state is bound to the exact allowlisted redirect
// it was issued for: a state minted for one redirect must not be replayable
// against another.
//
// Checkpoint 7.1 provides the persistence contract only. The routes that mint
// and consume these rows belong to Checkpoint 7.2.
export const mailOauthStates = pgTable(
  "mail_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mail_oauth_states_state_hash_unique").on(table.stateHash),
    index("mail_oauth_states_expires_at_idx").on(table.expiresAt),
  ],
);
