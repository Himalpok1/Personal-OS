import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Single-use OAuth state for the Google Health authorization flow (ADR-046,
// migration 0013).
//
// Only the sha256 of the state is stored -- never the raw value -- mirroring
// device_pairing_codes' hash-only convention. Validation is an atomic
// UPDATE ... WHERE consumed_at IS NULL ... RETURNING, the same single-use
// pattern apps/api/src/routes/devices.ts already uses for pairing codes, so
// two concurrent callbacks cannot both consume one state.
//
// redirect_uri is stored so a state can be bound to the exact allowlisted
// redirect it was issued for: a state minted for one redirect must not be
// replayable against another.
export const healthOauthStates = pgTable(
  "health_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("health_oauth_states_state_hash_unique").on(table.stateHash),
    index("health_oauth_states_expires_at_idx").on(table.expiresAt),
  ],
);
