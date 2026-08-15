# Project Status

**Project:** Personal OS
**Current phase:** Phase 0 — Foundation & hardening
**Implementation status:** In progress — local scaffolding done, Docker-dependent verification pending
**Next phase allowed:** No
**Canonical architecture:** `docs/ARCHITECTURE.md`

## Current objective

Create the repository and infrastructure foundation exactly as described in the architecture without beginning Phase 1 capture logic.

## Completed

- [x] Architecture discussion completed.
- [x] Revision 3 architecture document accepted as the current plan.
- [x] Shared agent instructions created.
- [x] Git repository initialized; baseline docs commit, then scaffold commit.
- [x] pnpm/Turborepo workspace created (pnpm 11.21.0 via Corepack, TypeScript pinned to `^6.0.3` for `typescript-eslint` compatibility).
- [x] `apps/mobile` scaffolded — Expo Router, pinned to **SDK 57** (`create-expo-app@latest --template default@sdk-57`; docs currently warn the unversioned form defaults to SDK 54 during the transition). Trimmed to a single Home screen. Verified: `expo start --web` bundles and renders "Personal OS" in the browser.
- [x] `apps/api` scaffolded — Fastify. `/health` probes the DB with a 3s timeout and never throws on failure. Verified: boots with no Postgres running, returns `{"status":"degraded","db":"unreachable",...}` rather than crashing.
- [x] `apps/worker` scaffolded — pg-boss. `boss.start()` wrapped in retry/backoff. Verified: boots with no Postgres running, logs and retries every 5s rather than crashing. `bootstrap.heartbeat` queue/job code written but not yet exercised against a live queue.
- [x] shared packages scaffolded — `packages/schema` (Zod), `packages/core` (`isValidTimezone`, tested), `packages/db` (Drizzle schema + lazy connection factory + generated initial migration), `packages/api-client`. All build/typecheck/test clean via `pnpm build`, `pnpm typecheck`, `pnpm --filter @personal-os/core test`.
- [x] Drizzle configured — `packages/db/drizzle.config.ts`; initial migration generated (`packages/db/drizzle/0000_strong_nuke.sql`, the `worker_heartbeat` singleton table). **Not yet applied to a live database.**
- [x] pg-boss worker plumbing configured — schema/migrate settings chosen so pg-boss's own schema is pre-created once by the migrator role, then the worker runs with `migrate: false` under the least-privilege app role (see role note below). **Not yet exercised against a live queue.**
- [x] least-privilege DB roles **designed** — `docker/postgres/init/01-roles.sh` creates `posops_migrator` (DDL) and `posops_app` (least privilege, no CREATE) on first Postgres init; `scripts/grant-pgboss-runtime.sql` grants `posops_app` only the DML pg-boss needs on its `pgboss` schema (no DDL/CREATE), run once after `pg-boss migrate`. **Not yet run against a live database — role behavior is unverified.**
- [x] secrets handling configured — `.env` gitignored, `.env.example` has dummy values only, gitleaks pre-commit hook installed via husky. **Verified**: staged a fake AWS key, commit was blocked; removed the fake secret and confirmed a clean re-scan.
- [x] ESLint (flat config, type-aware, `no-floating-promises`/`no-misused-promises` enforced) + Prettier configured. Verified clean across the whole workspace.
- [x] Docker Compose **authored** — `docker-compose.yml` (production shape, no published ports), `docker-compose.dev.yml` (localhost-only overlay for Postgres and the API, local dev only), `apps/api/Dockerfile`, `apps/worker/Dockerfile`. YAML syntax validated. **`docker compose up`/image builds are untested** — see blocker below.
- [ ] PostgreSQL development container running and connected to.
- [ ] Tailscale server configuration completed.
- [ ] encrypted backup automation configured.
- [ ] offsite backup destination configured.
- [ ] manual restore test successfully performed and documented.
- [ ] Phase 0 verification complete.

## Blockers / user-provided items

**Active blocker:** Docker Desktop is not installed on this Mac (no Docker Desktop, OrbStack, or Colima were found). Installing it via Homebrew (`brew install --cask docker`) requires an interactive sudo password prompt this session cannot supply. **User needs to run `brew install --cask docker` themselves and open Docker.app once**, then verification can continue: bring up Postgres via `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`, run the Drizzle migration and `pg-boss migrate` as `posops_migrator`, run `scripts/grant-pgboss-runtime.sql`, then verify `apps/api`'s `/health` reports `db: "connected"`, the worker's heartbeat row updates while connected as `posops_app` (confirming no DDL/CREATE grants are needed), and that no Postgres/API ports are published outside the dev overlay's `127.0.0.1` bindings.

Not yet collected — likely Phase 0 user-only inputs for later in this phase:

- final Intel i5 server access details
- NAS backup destination
- Backblaze B2 account/bucket credentials if used
- Tailscale account/tailnet access
- age/SOPS key handling preference
- Apple Developer account is not required until native iOS work, but should be planned for later

Agents must not invent these values.

## Current work

Paused on task "bring the Docker stack up and verify end-to-end" pending Docker Desktop installation (see blocker above). All work not requiring a live Postgres/Docker is complete and verified.

## Last verification

Run and passing (2026-08-15): `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm --filter @personal-os/core test`, `drizzle-kit generate`, gitleaks pre-commit hook (blocks a staged fake secret), `apps/api` boots and degrades gracefully with no Postgres, `apps/worker` boots and retries gracefully with no Postgres, `apps/mobile`'s `expo start --web` bundles and renders.

Not yet run (blocked on Docker): `docker compose config`/`up`, Drizzle migration apply, `pg-boss migrate`, `scripts/grant-pgboss-runtime.sql`, `/health` returning `db: "connected"`, worker heartbeat writes under `posops_app`, port-binding verification, image builds for `apps/api`/`apps/worker` Dockerfiles, the encrypted backup job, and the mandatory manual restore test.

## Next action

Once Docker Desktop is installed and running: bring up Postgres, apply migrations, run the pg-boss grant script, and complete the end-to-end verification listed above. Then proceed to the remaining Phase 0 items this pass didn't touch — Tailscale server configuration, encrypted backup automation, offsite backup destination, and the mandatory manual restore test — all of which need user-provided access/credentials per the blockers above.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
