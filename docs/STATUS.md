# Project Status

**Project:** Personal OS
**Current phase:** Phase 0 — Foundation & hardening
**Implementation status:** Local + Docker-dependent scaffolding done and verified. Blocked on user-owned infra (Tailscale/i5/NAS/Backblaze) and the mandatory backup/restore gate.
**Next phase allowed:** No
**Canonical architecture:** `docs/ARCHITECTURE.md`

## Current objective

Create the repository and infrastructure foundation exactly as described in the architecture without beginning Phase 1 capture logic.

## Completed

- [x] Architecture discussion completed.
- [x] Revision 3 architecture document accepted as the current plan.
- [x] Shared agent instructions created.
- [x] Git repository initialized; baseline docs commit, scaffold commit, Docker fix commit.
- [x] pnpm/Turborepo workspace created (pnpm 11.21.0 via Corepack, TypeScript pinned to `^6.0.3` for `typescript-eslint` compatibility).
- [x] `apps/mobile` scaffolded — Expo Router, pinned to **SDK 57** (`create-expo-app@latest --template default@sdk-57`; docs currently warn the unversioned form defaults to SDK 54 during the transition). Trimmed to a single Home screen. Verified: `expo start --web` bundles and renders "Personal OS" in the browser.
- [x] `apps/api` scaffolded — Fastify. `/health` probes the DB with a 3s timeout and never throws on failure. Verified both degraded (no Postgres) and healthy (live Postgres, containerized) paths — see Last verification.
- [x] `apps/worker` scaffolded — pg-boss. `boss.start()` wrapped in retry/backoff. Verified booting with no Postgres (retries cleanly) and against a live Postgres, both as a host process and as a container, with the scheduled heartbeat job actually firing.
- [x] shared packages scaffolded — `packages/schema` (Zod), `packages/core` (`isValidTimezone`, tested), `packages/db` (Drizzle schema + lazy connection factory + generated initial migration), `packages/api-client`. All build/typecheck/test clean.
- [x] Drizzle configured and **applied**: `pnpm --filter @personal-os/db exec drizzle-kit migrate` run as `posops_migrator` against live local Postgres — `worker_heartbeat` table created, owned by `posops_migrator`.
- [x] pg-boss schema pre-created and **applied**: `pg-boss migrate` (CLI, `PGBOSS_SCHEMA=pgboss`) run as `posops_migrator` — created the `pgboss` schema at version 37, owned by `posops_migrator`. Worker then started with `migrate: false` under `posops_app` successfully.
- [x] least-privilege DB roles **created and verified**: `docker/postgres/init/01-roles.sh` created `posops_migrator` (DDL) and `posops_app` (least privilege) on first Postgres init — confirmed via `\dt`/`\dn+`. `scripts/grant-pgboss-runtime.sql` run as `posops_migrator` after `pg-boss migrate`, granting `posops_app` only DML on the `pgboss` schema. **Verified `posops_app` has no DDL**: `CREATE TABLE` as `posops_app` fails with `permission denied for schema public`; the worker still operates fully (job scheduling + heartbeat writes) under that same restricted role.
- [x] secrets handling configured — `.env` gitignored, `.env.example` has dummy values only, gitleaks pre-commit hook installed via husky. Verified: staged a fake AWS key, commit was blocked; removed the fake secret and confirmed a clean re-scan (also ran clean on the full scaffold commit).
- [x] ESLint (flat config, type-aware, `no-floating-promises`/`no-misused-promises` enforced) + Prettier configured. Verified clean across the whole workspace.
- [x] Docker Compose **authored and verified**: `docker-compose.yml` (production shape, no published ports) + `docker-compose.dev.yml` (localhost-only overlay for Postgres and the API). Fixed a real bug found during verification: `apps/api`/`apps/worker` were reusing the host-facing `DATABASE_URL` (pointing at `127.0.0.1`), which doesn't resolve from inside their own containers — now they build their own `DATABASE_URL` pointing at the `postgres` service name. `apps/api/Dockerfile` and `apps/worker/Dockerfile` both build and run successfully as containers on the compose network, confirmed against the live database (`/health` → `db: "connected"`, worker heartbeat updating).
- [x] PostgreSQL development container running and connected to (`postgres:17-alpine`, local dev, healthy).
- [ ] Tailscale server configuration completed.
- [ ] encrypted backup automation configured.
- [ ] offsite backup destination configured.
- [ ] manual restore test successfully performed and documented.
- [ ] Phase 0 verification complete.

## Blockers / user-provided items

Docker Desktop is now installed and running — no longer a blocker.

Not yet collected — needed for the remainder of Phase 0:

- final Intel i5 server access details
- NAS backup destination
- Backblaze B2 account/bucket credentials if used
- Tailscale account/tailnet access
- age/SOPS key handling preference
- Apple Developer account is not required until native iOS work, but should be planned for later

Agents must not invent these values.

## Current work

None. Everything achievable without user-owned infrastructure access is done and verified. Local Postgres (`personalosdashboard-postgres-1`) is left running for continued local dev; `api`/`worker` containers were stopped/removed after verification (run via `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` to bring them back for actual development).

## Last verification

Run and passing (2026-08-15):

- `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm --filter @personal-os/core test`
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` — resolves cleanly; confirmed only `127.0.0.1:5432` (Postgres) and `127.0.0.1:3000` (API) are published, both from the dev overlay only; the base file has no `ports:` block at all
- Postgres brought up via Compose; `01-roles.sh` ran on first init, both roles created (confirmed via container logs and `\dn+`/`\dt`)
- `drizzle-kit migrate` (as `posops_migrator`) — `worker_heartbeat` table created
- `pg-boss migrate` (as `posops_migrator`, `PGBOSS_SCHEMA=pgboss`) — `pgboss` schema created at version 37
- `scripts/grant-pgboss-runtime.sql` (as `posops_migrator`) — grants applied
- `posops_app` confirmed to have **no DDL rights** (`CREATE TABLE` → `permission denied`)
- `apps/api` and `apps/worker` run as host processes against live Postgres: `/health` → `{"status":"ok","db":"connected",...}`, worker's scheduled heartbeat job fired and updated the row, all under `posops_app`
- `docker compose build api worker` — both images build successfully
- `apps/api`/`apps/worker` run as **containers** on the compose network: same successful `/health` and heartbeat result, confirming the `DATABASE_URL` service-name fix
- gitleaks pre-commit hook — blocks a staged fake secret; clean on real commits

Not yet run — genuinely requires user-provided infra, not just more time: Tailscale Serve setup on the i5, encrypted backup job, offsite (Backblaze) destination, and the mandatory manual restore test.

## Next action

Stop and wait for the user to provide: Intel i5 server access, NAS backup destination, Backblaze B2 credentials (if used), Tailscale account/tailnet access, and an age/SOPS key handling preference. Once provided, proceed with Tailscale Serve configuration, encrypted nightly backup automation, the offsite destination, and — the blocking gate before Phase 1 — a real manual backup + restore test recorded here with date, procedure, and result.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
