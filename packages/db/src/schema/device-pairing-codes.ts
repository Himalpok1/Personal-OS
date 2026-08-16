import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The actual fix for POST /devices' access control: without this, any
// tailnet peer could call POST /devices freely, which made device-token
// revocation meaningless for a still-tailnet-connected lost device (it
// could just re-register). A code is generated only by a trusted
// server-side CLI action (apps/api/scripts/generate-pairing-code.ts, run
// via SSH access to personal-os -- a materially stronger trust boundary
// than "somewhere on the tailnet"), never by a network-reachable endpoint.
//
// Same one-way-hash pattern as devices.tokenHash -- the raw code is never
// stored, only its sha256. consumedAt is set atomically on successful
// registration (an UPDATE ... WHERE consumed_at IS NULL ... RETURNING, so
// two concurrent registration attempts against the same code can never
// both succeed).
export const devicePairingCodes = pgTable("device_pairing_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
