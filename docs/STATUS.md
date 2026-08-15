# Project Status

**Project:** Personal OS
**Current phase:** Phase 0 — Foundation & hardening
**Implementation status:** Phase 0 complete. Local dev environment and production deployment both done and verified end-to-end, including a full OS reboot test. No backup/restore requirement (see `docs/DECISIONS.md` ADR-024).
**Next phase allowed:** No — Phase 0 is complete, but Phase 1 requires the user's explicit separate approval before starting.
**Canonical architecture:** `docs/ARCHITECTURE.md`

## Current objective

Create the repository and infrastructure foundation exactly as described in the architecture without beginning Phase 1 capture logic.

## Completed

- [x] Architecture discussion completed.
- [x] Revision 3 architecture document accepted as the current plan.
- [x] Shared agent instructions created.
- [x] Git repository initialized; docs, scaffold, Docker fix, backup-removal, and production-overlay commits.
- [x] pnpm/Turborepo workspace created (pnpm 11.21.0 via Corepack, TypeScript pinned to `^6.0.3` for `typescript-eslint` compatibility).
- [x] `apps/mobile` scaffolded — Expo Router, pinned to **SDK 57**. Trimmed to a single Home screen. Verified: `expo start --web` bundles and renders "Personal OS" in the browser.
- [x] `apps/api` scaffolded — Fastify. `/health` probes the DB with a 3s timeout and never throws on failure. Verified locally (degraded/healthy) and in production (see below).
- [x] `apps/worker` scaffolded — pg-boss. `boss.start()` wrapped in retry/backoff. Verified locally and in production, including the scheduled heartbeat job firing.
- [x] shared packages scaffolded — `packages/schema`, `packages/core`, `packages/db`, `packages/api-client`. All build/typecheck/test clean (re-confirmed 2026-08-15 on the Mac, post-deployment).
- [x] Drizzle configured and applied, locally and in production, as `posops_migrator`.
- [x] pg-boss schema pre-created and applied, locally and in production, as `posops_migrator`; worker runs with `migrate: false` under `posops_app`.
- [x] least-privilege DB roles created and verified, locally and in production: `posops_migrator` (DDL) / `posops_app` (no DDL — confirmed both places via a direct `CREATE TABLE` attempt that correctly fails with `permission denied`).
- [x] secrets handling configured — `.env` gitignored everywhere, `.env.example` placeholders only, gitleaks pre-commit hook (verified: blocks a staged fake secret, clean on real commits, clean on every commit made this session including the production-deployment ones).
- [x] ESLint (type-aware) + Prettier configured. Clean across the whole workspace.
- [x] Docker Compose authored and verified, both locally (Mac dev via `docker-compose.dev.yml`) and in production (Ubuntu server via `docker-compose.prod.yml`).
- [x] **No backup system** — removed as a Phase 0 requirement per user-approved architecture decision (`docs/DECISIONS.md` ADR-024). Persistent Docker volume storage is not a backup.
- [x] **Production deployment to native Ubuntu i5 (`personal-os`) — done and verified end-to-end.** Full details below.

## Production deployment (2026-08-15)

Target: `personal-os` — Ubuntu 26.04 LTS, HP EliteDesk 800 G5, Intel i5-9500T, 30GB RAM, reachable via `ssh personal-os` (key auth), on the same tailnet as this Mac.

**What was done:**
1. Docker Engine 29.7.2 + Compose plugin v5.4.0 installed via Docker's official apt repo (user ran the install commands interactively — sudo requires a password this session can't supply). `himallinux` added to the `docker` group (user-approved, explained as root-equivalent access first) and set as the Tailscale operator, both verified working passwordlessly afterward.
2. Repo transferred via `rsync` over the existing SSH connection (not git — no GitHub remote was created, per instruction). Excluded `node_modules`, `.git`, `.env`, build caches, and `apps/mobile` (not part of the server-side stack).
3. New `docker-compose.prod.yml`: binds only the API to `127.0.0.1:3000` (needed because `tailscale serve` runs on the host and can't reach the Docker network directly — Postgres remains published nowhere in every case), adds explicit `restart: unless-stopped` and Docker's `local` logging driver (rotation, so container logs can't fill the disk on an always-on box) to all three services.
4. Production `.env` generated fresh directly on the server via `openssl rand -hex 16` — never copied from the Mac's dev `.env`. `chmod 600`.
5. Images built on the server; Postgres brought up; migrations run via ephemeral `docker compose run` containers (never publishing Postgres's port, even temporarily) — Drizzle migration and `pg-boss migrate` both as `posops_migrator`, then `scripts/grant-pgboss-runtime.sql` for `posops_app`'s scoped runtime grants.
6. Full stack brought up with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
7. `tailscale serve --bg 3000` — the CLI itself surfaced a one-time web-consent URL (Serve wasn't yet enabled for the tailnet); user approved it in-browser, then the command completed and the proxy came up.

**Verification actually run (all 15 items from the deployment plan):**

| # | Check | Result |
|---|---|---|
| 1 | Docker Engine works | `docker run hello-world` succeeds |
| 2 | Compose works, base file publishes nothing | `docker compose -f docker-compose.yml config` has no `ports:` block anywhere |
| 3 | Postgres healthy, persistent volume, no published port | `docker compose ps` → healthy; `docker volume inspect personal-os_postgres_data` → local driver, real mountpoint; merged prod config shows exactly one published port (`127.0.0.1:3000`, the API) |
| 4 | Migrations ran as `posops_migrator` | `\dt` → `worker_heartbeat` owned by `posops_migrator` |
| 5 | pg-boss schema via migrator | `\dn+` → `pgboss` schema owned by `posops_migrator`, `posops_app` granted `USAGE` only |
| 6 | `posops_app` has no DDL | direct `CREATE TABLE` as `posops_app` → `ERROR: permission denied for schema public` |
| 7 | API `/health` reports real DB connectivity | `{"status":"ok","db":"connected",...}` |
| 8 | Worker independent, heartbeat updates | `worker.lastBeatAt` advances, `stale: false`; worker logs show `pg-boss started` / `worker started, bootstrap.heartbeat scheduled every minute` with no errors |
| 9 | API/worker reach Postgres only over the Docker network | `getent hosts postgres` resolves inside the API container (172.18.0.2); `curl 127.0.0.1:5432` from the host fails to connect (nothing published) |
| 10 | Tailscale Serve HTTPS reachable from the Mac | `curl https://personal-os.tail62a68f.ts.net/health` from the Mac → HTTP 200, `db: "connected"` |
| 11 | No unintended public exposure | `ss -tln` on the server: API only on `127.0.0.1:3000`; Tailscale's HTTPS listener bound to the tailscale interface IP specifically (`100.117.78.19:443` / the `fd7a:...` IPv6), not `0.0.0.0` — unreachable from LAN or the public internet, tailnet peers only |
| 12 | Restart behavior correct | `docker compose stop`/`start`/`restart` on api/worker all recover cleanly, confirmed via `/health` after each. **Full OS reboot test actually performed and verified** (2026-08-15): user ran `sudo reboot` (needs their password, outside this session's reach); post-reboot, `uptime -s` confirmed a fresh boot (`2026-08-15 17:43:42`, ~8 minutes prior); `docker compose ps` showed all three containers `Up`/`Up (healthy)` with **no manual intervention**; local `/health` on the server returned `db: "connected"` with a live worker heartbeat; **`https://personal-os.tail62a68f.ts.net/health` from the Mac over Tailscale returned HTTP 200 with `db: "connected"` and a fresh, non-stale heartbeat** — the full stack, including Tailscale Serve, survives an unattended reboot |
| 13 | Prod config stays separate from dev | `docker-compose.dev.yml` was never referenced in any server-side command this session |
| 14 | Worker/API lifecycle independence | stopped `api` — `worker` and `postgres` stayed `Up`; confirmed by design too (compose file has no `depends_on` between api and worker) |
| 15 | lint/typecheck/tests still pass | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @personal-os/core test` — all clean (Mac side, re-run post-deployment) |

## Blockers / user-provided items

None currently blocking. Intel i5 production server access was provided and used (native Ubuntu 26.04 LTS, hostname `personal-os`). No backup system in the current architecture (ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected, not currently blocking anything:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (no repo-committed secrets require it yet)
- Apple Developer account — not required until native iOS work

## Current work

None. Production deployment is complete and verified. Both environments are up: Mac dev (local Postgres + `pnpm dev`) and production (`personal-os`, full Docker stack behind Tailscale Serve).

## Remaining warnings / technical debt

- **Runtime images aren't pruned of devDependencies.** `apps/api`/`apps/worker`'s Dockerfiles copy the entire built workspace into the runtime stage rather than a slim production-only `node_modules` — a deliberate Phase 0 "correctness over image size" tradeoff, documented in the Dockerfiles themselves. Worth revisiting before this matters (larger attack surface, slower deploys as the repo grows).
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval, now done — noting it here since it wasn't obvious in advance from `tailscale status` alone (`CertDomains` was empty beforehand) and the CLI's own consent-URL flow is what actually resolved it, not a pre-configured admin console setting.
- **`docs/PHASE-0-CHECKLIST.md` section E (Tailscale/network foundation)** items are now substantively done (Tailscale installed+authenticated, MagicDNS confirmed working, Serve configured, Postgres inaccessible as a public service) but the checklist file's checkboxes themselves weren't individually ticked in this pass — worth a follow-up pass to mark them, or treat this STATUS.md entry as the record of evidence.
- No SOPS/age key has actually been generated — remains available but unused, since no secret currently needs to live in the repo.

## Last verification

Run and passing (2026-08-15) — see the Production deployment table above for the full list, including the full OS reboot test (#12) and its post-reboot HTTPS `/health` check from the Mac. Mac-side: `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm --filter @personal-os/core test`. gitleaks pre-commit hook confirmed still blocking a staged fake secret and clean on every real commit made this session.

## Phase 0: complete

All exit criteria in `docs/PHASE-0-CHECKLIST.md` are met: the foundation is reproducible (Mac dev + production both verified independently), security boundaries are in place (least-privilege DB roles verified to reject DDL, Postgres unpublished everywhere, gitleaks active, API scoped to localhost/Tailscale-only), and this file documents the evidence. There is no backup or restore requirement (ADR-024). The one remaining housekeeping item — individually ticking `docs/PHASE-0-CHECKLIST.md`'s checkboxes, left untouched throughout this project in favor of this file as the evidence record — does not block Phase 0 completion.

## Next action

**Phase 0 is done. Do not begin Phase 1 without explicit user approval** — this file being updated does not itself constitute that approval.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
