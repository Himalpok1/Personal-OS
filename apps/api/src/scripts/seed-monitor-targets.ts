// Run via: pnpm --filter api monitor:seed
// or, in production: docker compose exec api node dist/scripts/seed-monitor-targets.js
//
// Deliberately a CLI script rather than an endpoint or a startup side effect,
// following generate-pairing-code.ts's precedent. Two reasons, and the second is
// the load-bearing one:
//
//   1. Targets are OPERATOR CONFIGURATION, not application state. Seeding on
//      boot would mean every restart re-asserting a set of URLs, which is one
//      redeploy away from silently resurrecting a target someone deleted on
//      purpose.
//   2. WORKER-TO-TAILSCALE REACHABILITY IS UNVERIFIED. ADR-055 says so
//      explicitly and requires it be proven in this checkpoint rather than
//      assumed. The worker container sits on a plain Docker bridge network and
//      the Serve routes terminate on the HOST's tailscaled -- so the two tailnet
//      targets are OPTIONAL here and are only seeded when their origins are
//      passed. Seeding them blindly would manufacture a permanent false outage
//      and, worse, teach whoever is on call to ignore the alerts.
//
// Existing targets are never overwritten (see seedDefaultMonitorTargets).
import { seedDefaultMonitorTargets } from "@personal-os/monitoring";
import Fastify from "fastify";
import { registerDb } from "../plugins/db.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  registerDb(app);

  // In-cluster service names, matching docker-compose's own network. Plain HTTP
  // on a private Docker network is correct here: TLS terminates at Tailscale
  // Serve on the host, so an https:// URL would be probing something that does
  // not exist.
  const apiBaseUrl = process.env["MONITOR_API_BASE_URL"] ?? "http://api:3000";
  const webBaseUrl = process.env["MONITOR_WEB_BASE_URL"] ?? "http://web:8080";
  const tailnetApiOrigin = process.env["MONITOR_TAILNET_API_ORIGIN"];
  const tailnetWebOrigin = process.env["MONITOR_TAILNET_WEB_ORIGIN"];

  const result = await seedDefaultMonitorTargets(app.db, {
    apiBaseUrl,
    webBaseUrl,
    ...(tailnetApiOrigin !== undefined ? { tailnetApiOrigin } : {}),
    ...(tailnetWebOrigin !== undefined ? { tailnetWebOrigin } : {}),
  });

  console.log(`created: ${result.created.join(", ") || "(none)"}`);
  console.log(`already present, left untouched: ${result.skipped.join(", ") || "(none)"}`);
  if (tailnetApiOrigin === undefined && tailnetWebOrigin === undefined) {
    console.log(
      "tailnet targets NOT seeded: set MONITOR_TAILNET_API_ORIGIN / MONITOR_TAILNET_WEB_ORIGIN\n" +
        "only after proving the worker container can actually reach those routes (ADR-055).",
    );
  }

  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
