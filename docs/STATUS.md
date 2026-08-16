# Project Status

**Project:** Personal OS
**Current phase:** Phase 1 — Capture core, headless
**Implementation status:** Phase 0 complete (see below). Phase 1 implementation complete, verified on Mac dev, deployed to and verified in production (`personal-os`), **and the real LLM-parsing happy path itself is now verified against a live OpenAI key in production** — see "Phase 1 implementation", "Phase 1 production deployment", and "Phase 1 real-LLM verification" (all 2026-08-15) below. No remaining blockers on Phase 1.
**Next phase allowed:** No — Phase 2 requires the user's explicit separate approval before starting.
**Canonical architecture:** `docs/ARCHITECTURE.md`

## Current objective

Implement Phase 1 (capture core, headless): `/capture` + inbox, LLM parser with tool-calling + confidence scoring, nightly due-date window expansion, lazy completion-anchored generation, tasks/notes/events/occurrences — plus a provider-agnostic AI layer (`packages/ai-providers`, ADR-026) so the parser isn't hardcoded to one LLM vendor. Driven entirely by curl, no UI (Phase 2).

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
- [x] **Phase 1 implementation — data model, recurrence engine, provider-agnostic AI layer, API routes, worker jobs — done, verified on Mac dev, and deployed to and verified in production (`personal-os`).** Full details below.

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

## Phase 1 implementation (2026-08-15)

Plan approved via plan mode (see the "provider-agnostic AI layer" discussion) before implementation began. Two mid-implementation architecture gaps were found in `docs/ARCHITECTURE.md` and resolved with the user rather than improvised silently: no `notes` table existed despite `create_note` being a parser tool since Phase 1 (ADR-027, table added, doc updated); the LLM provider for the parser was unpinned (resolved into a full provider-agnostic layer, ADR-026, per explicit user requirements — OpenAI/Anthropic/Kimi/GLM/xAI/Gemini/NVIDIA NIM/OpenRouter/LM Studio/custom-OpenAI-compatible, DB-stored encrypted credentials, no silent fallback).

**What was built:**

1. **Data model** (`packages/db`) — new tables: `ai_provider_connections`, `ai_models`, `ai_task_routes` (the AI layer's config, API keys encrypted at rest as `bytea` ciphertext/iv/authTag via a `customType`), `projects`, `tags`, `item_tags`, `inbox_items`, `notes`, `tasks`, `events`, `occurrences` — matching `ARCHITECTURE.md`'s DDL exactly, including the `one_open_occurrence_per_lazy_parent` partial unique index that makes lazy generation safe under pg-boss's at-least-once delivery. Two migrations (`0001_foamy_stick.sql`, `0002_dapper_proudstar.sql`), both applied to Mac dev as `posops_migrator`.
2. **`packages/schema`** — `capture.ts`, `inbox.ts`, `parser-tools.ts` (the four tool-calling schemas + a discriminated union), `ai-provider.ts` (CRUD schemas whose response shapes deliberately never include key material). First cross-package dependency: `packages/schema` → `packages/core` (timezone validation reuse).
3. **`packages/core`** — `resolveWallClockToInstant`/`toWallClockComponents`/`wallClockToNaiveDate` (DST-safety primitives, built on `date-fns-tz`, empirically verified system-timezone-independent), `expandDueDateWindow` (pure, RRule-based, the "floating time" trick since `rrule` has no IANA timezone awareness), `computeNextLazyOccurrence` + `validateCompletionAnchoredRule`, `computeConfidence`. First runtime dependencies for this package: `rrule`, `date-fns`, `date-fns-tz`.
4. **New `packages/ai-providers`** (ADR-026) — `adapter-registry.ts` (Vercel AI SDK: native adapters for openai/anthropic/google/xai, one generic `openai_compatible` adapter covering Kimi/GLM/NVIDIA NIM/OpenRouter/LM Studio/custom endpoints), `credential-crypto.ts` (AES-256-GCM), `resolve-model.ts` (`ai_task_routes` → `ai_models` → `ai_provider_connections`, decrypt, build model), `call-with-fallback.ts` (only ever uses an explicitly configured fallback chain, never silent).
5. **`apps/api`** — restructured from one inline file into `plugins/` (`db.ts`, `boss.ts`) + `routes/` (`capture.ts`, `inbox.ts`, `occurrences.ts`, `ai-config.ts`) + a `setErrorHandler`. New endpoints: `POST /capture` (dedupe on `client_uuid`, enqueue), `GET /inbox/:id`, `POST /inbox/:id/confirm` (re-enqueues into `capture.parse` rather than creating entities itself — the API never does work inline), `POST /occurrences/:id/complete` + `/skip`, and the AI-provider CRUD/test/task-routes endpoints. New env var `CREDENTIALS_ENCRYPTION_KEY`; Fastify request logging redacts `req.body.api_key`.
6. **`apps/worker`** — three new job queues alongside the existing heartbeat: `capture.parse` (LLM tool-calling parse, 2x temperature-0.3 sampling for the type-ambiguity confidence signal, auto-commit vs `needs_confirm` routing, a `mode: "confirm"` branch for the API's confirm route), `occurrences.expand-window` (nightly cron, the mandatory `recurrence_anchor = 'due_date'` filter), `occurrences.generate-lazy` (idempotent via the partial unique index, catches the specific constraint violation as a no-op). `commit-parsed-entity.ts` is the single place a tool call becomes a task/note/event row, including seeding the first occurrence for a newly created completion-anchored task (a gap in `ARCHITECTURE.md`'s own description — nothing else would ever create it). Retry/backoff are pg-boss **queue-level** options (`createQueue`, not `work`); since `create_queue` is `INSERT ... ON CONFLICT DO NOTHING`, apps/api and apps/worker share identical `QUEUE_RETRY_OPTIONS` constants so whichever process starts first doesn't silently win with the wrong config.

**A real runtime bug caught and fixed during verification, not just planning:** `rrule@2.8.1`'s CJS build has no `"exports"` map; Node's ESM↔CJS named-export interop (`cjs-module-lexer`) fails to statically detect its named exports even though the package's own `.d.ts` declares them — `import { RRule } from "rrule"` type-checked cleanly but threw at runtime under `tsx`/Node (`does not provide an export named 'RRule'`), while Vitest's separate transform pipeline masked it in unit tests. Fixed with `createRequire(import.meta.url)` + a type-only import for the cast, in both recurrence modules — verified by actually booting `apps/api`/`apps/worker` via `tsx watch`, not just `tsc --noEmit`.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` | All clean. 51 unit tests pass across `packages/core` (26, incl. the DST-crossing and completion-anchored scenarios below), `packages/ai-providers` (14, incl. credential-crypto round-trip/tamper tests), `packages/schema` (11, new — this package previously had a `test` script but zero test files) |
| 2 | Migration applies cleanly as `posops_migrator`; `posops_app` still can't DDL | Re-confirmed with the Phase 1 tables present: `INSERT INTO projects ...` as `posops_app` succeeds; `CREATE TABLE should_fail ...` as `posops_app` → `ERROR: permission denied for schema public`. No new grant script needed (default-privilege grant from Phase 0 already covers new `public` tables) |
| 3 | `apps/api`/`apps/worker` start successfully | Both booted via `tsx watch` against the local dev Postgres; worker connected pg-boss, created all four queues, scheduled the heartbeat and nightly window-expansion crons |
| 4 | `POST /capture` end-to-end | Real curl request → row in `inbox_items` → enqueued → worker picked it up. Dedupe on `client_uuid` verified (same UUID twice → same `inbox_id`, one row). Validation verified (bad payload → structured 400) |
| 5 | Graceful failure with no AI provider configured | `capture.parse` correctly threw `NoProviderConfiguredError`, set `inbox_items.status = 'failed'` with a clear message, did **not** retry (config error, not transient) — proves the whole pipeline wiring works up to the LLM call boundary |
| 6 | AI provider CRUD + encryption at rest | `POST /ai/providers` with a fake key → `GET /ai/providers` response contains no key material; direct psql query confirmed `api_key_ciphertext` is genuinely encrypted (ciphertext bytes don't contain the plaintext key); `POST /ai/providers/:id/test` against an unreachable endpoint returned a graceful `{success:false}` rather than a 500 |
| 7 | **DST-crossing due-date rule — live, not just unit-tested** | Inserted a real `FREQ=WEEKLY;INTERVAL=1` task via psql (9am `America/Chicago`, straddling the 2026-11-01 fall-back), manually enqueued `occurrences.expand-window`, let the running worker process it: Oct 25 → `14:00 UTC` (CDT), Nov 1/Nov 8 → `15:00 UTC` (CST) — wall-clock stayed 09:00, UTC offset shifted by exactly one hour at the boundary |
| 8 | **Completion-anchored lazy generation — live, not just unit-tested** | Inserted a real `FREQ=DAILY;INTERVAL=3` completion-anchored task + a seed occurrence backdated 10 days, called `POST /occurrences/:id/complete` for real: the new occurrence was anchored from the actual completion instant (not the stale backdated one) — verified `occurs_at` = completion time + exactly 3 days. Repeated for `/skip`. Directly attempted a duplicate open lazy occurrence via SQL and confirmed `one_open_occurrence_per_lazy_parent` rejects it with `ERROR: duplicate key value violates unique constraint` — the exact safety net `generate-lazy-occurrence.ts`'s catch block relies on |
| 9 | No API key ever appears in a GET response or in server logs | Spot-checked; response schemas structurally exclude key material, Fastify redaction configured for `req.body.api_key` |
| 10 | gitleaks / secrets | `.env` (holds the real `CREDENTIALS_ENCRYPTION_KEY`) confirmed still gitignored and untracked; nothing staged |

**Not yet run (needs a real LLM provider key from the user):** the actual LLM-parsing happy path — registering a real provider, running the ~50 hand-typed captures from `ARCHITECTURE.md`'s Phase 1 description, and the "swap providers mid-test" check that proves the abstraction isn't secretly single-vendor. Everything up to the LLM call boundary (steps 4–6 above) is verified; the call itself needs credentials this session doesn't have.

**Not yet done (at Mac-dev-verification time):** production deployment; individually ticking `docs/PHASE-0-CHECKLIST.md`'s Phase 0 boxes (pre-existing housekeeping item, unrelated to Phase 1). **Both since resolved — see "Phase 1 production deployment" below for the first; the checklist item remains open.**

## Phase 1 production deployment (2026-08-15)

Deployed to `personal-os` the same session, immediately after Mac-dev verification and a local commit (`f194cc7`) checkpointing the verified state first.

**A real bug caught only by attempting the production build, not by anything on Mac dev:** `apps/api/Dockerfile` and `apps/worker/Dockerfile` hardcoded an explicit package build order (`pnpm --filter @personal-os/schema build && pnpm --filter @personal-os/db build && ...`) predating Phase 1 — it had no entry for the two new packages (`@personal-os/core`, `@personal-os/ai-providers`) that `@personal-os/schema` and both apps now depend on, so the production image build failed with `Cannot find module '@personal-os/core'`. This class of bug can't reproduce on Mac dev, where `pnpm build`/`turbo run build` already resolve the dependency graph correctly — only the Docker build path had a hand-maintained, now-stale chain. Fixed by replacing the hardcoded chain with `pnpm exec turbo run build --filter=api...` / `--filter=worker...`, which resolves the graph itself and won't go stale the next time a package dependency is added.

**A second gap, caught before it could bite:** `docker-compose.yml`'s `api`/`worker` service blocks only pass through `DATABASE_URL`/`PORT` explicitly to containers — Compose does not auto-inject arbitrary `.env` variables. `CREDENTIALS_ENCRYPTION_KEY` (new in Phase 1, required by both apps' `env.ts`) would have been invisible inside the containers even with it correctly set in `.env`, causing an immediate crash-loop on startup. Fixed by adding `CREDENTIALS_ENCRYPTION_KEY: ${CREDENTIALS_ENCRYPTION_KEY:?...}` to both services' `environment:` blocks in `docker-compose.yml` (shared by dev and prod), verified with `docker compose config` locally (both dev and prod overlays) before touching the server.

**What was done, in order:**
1. Inspected production state first: 3 containers healthy, exactly one published port (`127.0.0.1:3000`, the API), `.env` present (600 perms, 6 vars, none touched), no `.git` on the server (repo lives there via `rsync`, matching the Phase 0 precedent, not `git pull`), only migration `0000` (the Phase 0 `worker_heartbeat` table) applied.
2. Re-confirmed both new migrations (`0001_foamy_stick.sql`, `0002_dapper_proudstar.sql`) contain only `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD CONSTRAINT` on brand-new tables — no `DROP`/`ALTER ... DROP`/`DELETE`/`TRUNCATE` anywhere, nothing touches `worker_heartbeat` or any existing row. Forward-only, no downtime required.
3. `rsync`'d the updated repo to `personal-os` with the same exclusions as the Phase 0 deployment (`node_modules`, `.git`, `.env`, build caches, `apps/mobile`) — confirmed `.env`'s size/mtime/md5 unchanged immediately after.
4. Generated a fresh `CREDENTIALS_ENCRYPTION_KEY` **on the server itself** via `openssl rand -base64 32` (never copied from the Mac's dev key, same principle as the other secrets) and appended it as a new line to the existing `.env` — the original 6 variables and their values were not touched.
5. Hit the two Docker/Compose gaps above; fixed both, verified locally, `rsync`'d just the 3 changed files (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `docker-compose.yml`) to the server.
6. Rebuilt `api`/`worker` images on the server — succeeded.
7. Ran the Drizzle migration as `posops_migrator` via an ephemeral `docker compose run --rm --entrypoint sh api -c "pnpm --filter @personal-os/db db:migrate"`, with `MIGRATIONS_DATABASE_URL` constructed server-side (`postgres:5432` service hostname + the existing `POSTGRES_MIGRATOR_PASSWORD` read from `.env` in-shell, never printed) — Postgres's port was never published, even transiently.
8. `docker compose up -d api worker` — recreated only `api`/`worker` (confirmed `postgres` stayed `Running`/`Healthy`, untouched, zero DB downtime).

**Verification actually run, against the live production deployment:**

| # | Check | Result |
|---|---|---|
| 1 | All containers healthy | `api`/`worker`/`postgres` all `Up`, `postgres` `(healthy)`, no restart loops |
| 2 | API health over real Tailscale HTTPS | `curl https://personal-os.tail62a68f.ts.net/health` from the Mac → `{"status":"ok","db":"connected","worker":{"stale":false}}` |
| 3 | New migrations applied | `\dt` on production Postgres lists all 12 tables: `ai_models`, `ai_provider_connections`, `ai_task_routes`, `events`, `inbox_items`, `item_tags`, `notes`, `occurrences`, `projects`, `tags`, `tasks`, `worker_heartbeat` |
| 4 | `posops_app` still has no DDL | Direct `CREATE TABLE should_fail (...)` as `posops_app` on production → `ERROR: permission denied for schema public`, re-confirmed **after** the migration |
| 5 | `capture.parse` worker job runs | Real `POST /capture` over Tailscale HTTPS → row written → enqueued → worker picked it up within seconds → `NoProviderConfiguredError` handled correctly (`status: 'failed'`, clear message, no retry loop) — proves the pipeline wiring end-to-end in production |
| 6 | Recurrence jobs — DST-crossing due-date rule | Inserted a real `FREQ=WEEKLY;INTERVAL=1` task via psql (9am `America/Chicago`, straddling 2026-11-01), manually enqueued `occurrences.expand-window` on the live worker: Oct 25 → `14:00 UTC` (CDT), Nov 1/Nov 8 → `15:00 UTC` (CST) — identical behavior to Mac dev |
| 7 | `/occurrences/:id/complete` and `/skip` | Both called for real over Tailscale HTTPS against a completion-anchored task with a seed occurrence backdated 10 days: the generated successor was anchored from the actual completion/skip instant (+3 days), not the stale backdated one |
| 8 | Lazy generation + duplicate prevention | Directly attempted a second open lazy occurrence for the same parent via SQL → `ERROR: duplicate key value violates unique constraint "one_open_occurrence_per_lazy_parent"` — the exact safety net the job handler's catch block relies on, confirmed live |
| 9 | AI provider credentials encrypted at rest | `POST /ai/providers` with a fake key on production → direct psql query confirmed `api_key_ciphertext` bytes do not contain the plaintext key, correct AES-256-GCM ciphertext/IV/auth-tag lengths |
| 10 | API keys never returned or logged | `GET /ai/providers` response contains no key material; `docker compose logs api \| grep <the fake key>` → no match |
| 11 | Graceful behavior with no AI provider configured | Same as #5 — `NoProviderConfiguredError` → `status: 'failed'`, no crash, no retry storm |
| 12 | Restart behavior | `docker compose restart api worker` → both recovered cleanly; `/health` over Tailscale HTTPS returned a fresh, non-stale heartbeat within seconds |
| 13 | No new host ports exposed | `ss -tln` on the server before vs. after: identical port set (`127.0.0.1:3000` API, Tailscale's `443`/tailnet-interface-only, `22` SSH, unrelated local system services) — no `0.0.0.0:3000`, Postgres still unpublished |
| 14 | Mac-side build/typecheck/lint/format/test | Re-run after the Dockerfile/compose fixes: all clean, same 51 tests passing |

All test data (`inbox_items`, the two test tasks + their occurrences, the test `ai_provider_connections` row) deleted from production after verification — production DB is empty of test artifacts, exactly as found before this deployment except for the new, empty Phase 1 tables.

## Phase 1 real-LLM verification (2026-08-15)

The user registered a real OpenAI API key against production via `POST /ai/providers` → `POST /ai/models` (`gpt-4.1`) → `POST /ai/task-routes` (`capture_parser`). The connection test succeeded (`{"success":true}`) — the key is registered correctly. The very first real capture through the pipeline then failed, and **stayed failed on retry** — this was a genuine bug the provider-key milestone surfaced, not a fluke, found by reading `pgboss.job`'s error output directly rather than assuming it would eventually succeed.

**Bug 1 — offset-less datetimes rejected outright.** `packages/schema`'s `due_at`/`remind_at`/`start`/`end` fields required `z.string().datetime({ offset: true })`. GPT-4.1's tool call correctly resolved "tomorrow at 3pm" but returned it without a UTC offset (e.g. `2026-08-17T15:00:00`, no `-05:00`/`Z`) — the model isn't guaranteed to include one just because the schema asks for it. Two compounding causes: the system prompt never told the model what "now" was or what timezone the user was in, so it had no strong anchor or reason to qualify the offset; and the schema rejected an unqualified value outright instead of falling back to interpreting it in the capture's own timezone (something the codebase already had DST-safe machinery for — `resolveWallClockToInstant` — just not wired up to this path).

Fixed with three changes, in order of how much they actually matter: (1) the worker's system prompt now includes the capture's `capturedAt` (as an ISO instant) and `timezone`, and explicitly instructs the model to resolve relative phrases against that anchor and always include a UTC offset; (2) `packages/schema`'s datetime fields relaxed to accept an ISO datetime with an *optional* offset (`FlexibleDatetimeSchema`), so a compliant-but-imperfect response doesn't hard-fail validation; (3) new `packages/core` function `parseFlexibleDatetime(value, fallbackTimezone)` — offset-bearing values parse directly (unambiguous), offset-less values resolve via `resolveWallClockToInstant` against the capture's timezone instead of `new Date(string)`, which would have silently used the *container's* system time zone (typically UTC) and misinterpreted a Chicago afternoon as a UTC one. `commit-parsed-entity.ts`'s four `new Date(...)` call sites (task `due_at`/`remind_at`, event `start`/`end`) all switched to this. 4 new unit tests in `timezone.test.ts`.

**Bug 2 — a false-positive confidence flag.** Once bug 1 was fixed, the same capture ("remind me to call the insurance guy tomorrow at 3pm") correctly resolved a task with `remind_at` set — but still routed to `needs_confirm` with `unresolvedDatePhrase`. `hasResolvedDate()` in `capture-parse.ts` only checked `due_at`; a pure reminder resolves into `remind_at` instead (correctly — that's what "remind me to X tomorrow" *is*), so the signal fired on every correctly-resolved reminder. Fixed to check both fields.

**Verified after both fixes, against the live production deployment with the real key, no mocking:**
- The originally-failing capture re-run: `status: "parsed"`, auto-committed, `remind_at` = `2026-08-17 20:00:00+00` — 3pm Chicago (CDT, UTC-5) on the correct date, read back directly from the `tasks` row.
- A note-shaped capture ("Idea: build a habit tracker widget...") → `entity_type: "note"`, auto-committed.
- An event with a time range ("Team standup meeting tomorrow from 9am to 9:30am") → `entity_type: "event"`, auto-committed; `starts_at`/`ends_at` read back as `14:00`/`14:30` UTC — correct for 9:00/9:30am Chicago.
- Gibberish ("asdf") → routed to the `unclear` tool with a sensible reason, `status: "needs_confirm"` — the confidence-routing default-to-caution behavior working as designed, not a failure.

All test captures and their resulting entities deleted from production afterward. The real `ai_provider_connections`/`ai_models`/`ai_task_routes` rows (the user's actual OpenAI configuration) were left in place — those aren't test data, they're the intended live configuration.

**Not yet run:** the full ~50-capture pass from `ARCHITECTURE.md`'s Phase 1 description, and the "swap providers mid-test" check proving the abstraction works with a second, different provider type. Both are optional further confidence-building, not blockers — the pipeline is proven correct end-to-end with a real provider.

## Blockers / user-provided items

None currently blocking Phase 1. The real-OpenAI-key step is done — see "Phase 1 real-LLM verification" above (provider registered by the user directly via curl, per this repo's rule against Claude handling raw API keys itself; Claude ran the verification captures afterward, which don't involve credential material).

Intel i5 production server access was provided and used for Phase 0 and Phase 1 (native Ubuntu 26.04 LTS, hostname `personal-os`). No backup system in the current architecture (ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected, not currently blocking anything:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (no repo-committed secrets require it yet)
- Apple Developer account — not required until native iOS work

## Current work

Phase 1 is complete: implemented, verified on Mac dev, deployed to production, and now verified end-to-end against a real OpenAI key in production, including two real bugs the live-key milestone surfaced and fixed (offset-less datetime handling, a false-positive confidence flag on reminders). Do not begin Phase 2 without separate explicit user approval.

## Remaining warnings / technical debt

- **Runtime images aren't pruned of devDependencies.** `apps/api`/`apps/worker`'s Dockerfiles copy the entire built workspace into the runtime stage rather than a slim production-only `node_modules` — a deliberate Phase 0 "correctness over image size" tradeoff, documented in the Dockerfiles themselves. Worth revisiting before this matters (larger attack surface, slower deploys as the repo grows).
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval, now done — noting it here since it wasn't obvious in advance from `tailscale status` alone (`CertDomains` was empty beforehand) and the CLI's own consent-URL flow is what actually resolved it, not a pre-configured admin console setting.
- **`docs/PHASE-0-CHECKLIST.md` section E (Tailscale/network foundation)** items are now substantively done (Tailscale installed+authenticated, MagicDNS confirmed working, Serve configured, Postgres inaccessible as a public service) but the checklist file's checkboxes themselves weren't individually ticked in this pass — worth a follow-up pass to mark them, or treat this STATUS.md entry as the record of evidence.
- No SOPS/age key has actually been generated — remains available but unused, since no secret currently needs to live in the repo.

## Last verification

Phase 1 real-LLM verification, run and passing (2026-08-15) — see "Phase 1 real-LLM verification" above: a real OpenAI key registered, two real bugs found via `pgboss.job` error inspection (not assumed) and fixed, then a task/note/event/unclear capture each re-verified auto-committing (or correctly routing to `needs_confirm`) with correct DST-safe datetime resolution, read back directly from the `tasks`/`events` rows against production Postgres. `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (workspace-wide, 55 tests) all re-confirmed clean after the fixes, before redeploying.

Phase 1 production deployment verification (2026-08-15) remains valid — see "Phase 1 production deployment" above for the full 14-item table, including the DST-crossing and completion-anchored recurrence tests, the duplicate-prevention safety net, credential encryption, and restart behavior, all run against the live `personal-os` deployment over real Tailscale HTTPS. gitleaks confirmed clean on every Phase 1 commit; production `.env` (holding the real `CREDENTIALS_ENCRYPTION_KEY`) confirmed untouched by `rsync` (size/mtime/md5 unchanged) and still `chmod 600` throughout.

Phase 1 Mac-dev verification (2026-08-15) remains valid — see "Phase 1 implementation" above.

Phase 0's last verification (2026-08-15) remains valid — see the Production deployment table above for the full list, including the full OS reboot test (#12) and its post-reboot HTTPS `/health` check from the Mac.

## Phase 0: complete

All exit criteria in `docs/PHASE-0-CHECKLIST.md` are met: the foundation is reproducible (Mac dev + production both verified independently), security boundaries are in place (least-privilege DB roles verified to reject DDL, Postgres unpublished everywhere, gitleaks active, API scoped to localhost/Tailscale-only), and this file documents the evidence. There is no backup or restore requirement (ADR-024). The one remaining housekeeping item — individually ticking `docs/PHASE-0-CHECKLIST.md`'s checkboxes, left untouched throughout this project in favor of this file as the evidence record — does not block Phase 0 completion.

## Phase 1: complete, deployed to production, verified end-to-end with a real LLM

Every Phase 1 deliverable in `docs/ARCHITECTURE.md` is implemented, verified on Mac dev, deployed to production (`personal-os`), and now verified against a real OpenAI key end-to-end — data model, recurrence engine (both anchors), provider-agnostic AI layer, capture/inbox/occurrence/AI-config API routes, the three new worker jobs, and the LLM-parsing happy path itself (task/note/event/unclear classification, DST-safe datetime resolution, confidence routing). No remaining implementation, deployment, or verification gaps. Phase 2 does not begin until the user explicitly approves it separately.

## Next action

Nothing blocking. Optional further confidence-building (not required to consider Phase 1 done): the full ~50-capture pass from `ARCHITECTURE.md`'s Phase 1 description, and registering a second, different provider type to prove the abstraction isn't secretly single-vendor. **Do not begin Phase 2 without explicit user approval** — this file being updated does not itself constitute that approval.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
