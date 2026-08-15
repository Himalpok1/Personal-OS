# Project Status

**Project:** Personal OS
**Current phase:** Phase 0 — Foundation & hardening
**Implementation status:** Local + Docker-dependent scaffolding done and verified. i5 production server access now provided (native Ubuntu, hostname `personal-os`) — production deployment in progress. No backup/restore requirement (see `docs/DECISIONS.md` ADR-024).
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
- [ ] Tailscale Serve configured on the production server (`personal-os`).
- [ ] Production Docker deployment verified end-to-end.
- [ ] Phase 0 verification complete.

## Blockers / user-provided items

Docker Desktop (Mac) is installed and running — no longer a blocker. Intel i5 production server access is now provided: native Ubuntu 26.04 LTS, hostname `personal-os`, reachable via `ssh personal-os` (SSH key auth already configured), connected to the existing Tailscale tailnet. No backup system in the current architecture (see `docs/DECISIONS.md` ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (not currently blocking — no repo-committed secrets require it yet)
- Apple Developer account is not required until native iOS work, but should be planned for later

Agents must not invent these values.

## Current work

In progress: deploying the already-verified Docker Compose stack to the production server (`personal-os`) — Docker Engine install, repo transfer, migrations, Tailscale Serve. Local Mac dev environment is untouched and remains healthy; local Postgres (`personalosdashboard-postgres-1`) is left running for continued local dev.

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

Not yet run: full production deployment verification on `personal-os` (Docker install, migrations, Tailscale Serve, end-to-end health/heartbeat checks) — in progress, see Current work.

## Next action

Complete the production deployment to `personal-os`: install Docker, transfer the repo, generate a fresh production `.env`, run migrations as `posops_migrator`, bring up the full stack, configure Tailscale Serve, and run the full verification checklist. Record actual results here when done.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
