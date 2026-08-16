// Run via: pnpm --filter api pairing:generate
// or, in production: docker compose exec api node dist/scripts/generate-pairing-code.js
//
// Deliberately a CLI script, not a network endpoint -- see
// apps/api/src/routes/devices.ts's comment on why. Generating a code
// requires shell access to the box running this API (SSH to personal-os
// in production), a materially stronger trust boundary than "somewhere on
// the tailnet", which is the exact trust level that made POST /devices
// insufficiently protected before this mechanism existed.
import { generatePairingCode, hashPairingCode } from "@personal-os/core";
import { devicePairingCodes } from "@personal-os/db";
import Fastify from "fastify";
import { registerDb } from "../plugins/db.js";

const PAIRING_CODE_TTL_MS = 15 * 60_000;

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  registerDb(app);

  const code = generatePairingCode();
  await app.db.insert(devicePairingCodes).values({
    codeHash: hashPairingCode(code),
    expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
  });

  console.log(`Pairing code (expires in 15 minutes): ${code}`);
  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
