# Project Status

**Project:** Personal OS
**Current phase:** Phase 3 — Native builds, voice, notifications — **Checkpoint 4 of 6 (PTT + notifications + reboot survival) COMPLETE** (2026-08-18). Checkpoint 5 not started.
**Implementation status:** Phases 0–2 and Phase 3 Checkpoints 1–4 are complete. Checkpoint 4 is verified end to end on the physical Rabbit R1: foreground/exact local delivery, unattended reboot survival, SDK-57 PTT upload, and offline-outbox persistence/replay; the **real `voice_transcribe` STT path** (R1 microphone → Groq `whisper-large-v3-turbo` → real `avg_logprob` → `capture.parse` → entity); and **real Expo Push** (Firebase `personal-os-196cf` → FCM V1 → physical R1 receipt in both foreground and background). No Phase 3 code has been deployed to production.
**Next phase allowed:** N/A — mid-Phase-3. Checkpoint 4 is complete; Checkpoint 5's complete real-device lifecycle matrix is next and requires explicit approval. Do not deploy or begin Phase 4.
**Canonical architecture:** `docs/ARCHITECTURE.md`. **Canonical Phase 3 plan:** `/Users/himalpokhrel/.claude/plans/personal-os-begin-unified-cook.md` (not part of this repo — a local Claude Code plan file; the summary below is the durable, repo-tracked record). **Canonical Phase 2 plan:** `/Users/himalpokhrel/.claude/plans/zesty-twirling-piglet.md`.

## Current objective

Phase 3 (native builds, voice, notifications — end of Phase 3 is the MVP, per `docs/ARCHITECTURE.md`'s Phase plan) is underway, targeting a Rabbit R1 running CipherOS as the native device. Checkpoints 1–4 are complete; Checkpoint 5 (real-device lifecycle verification) is underway. Local Android work uses package `com.himal.personalos` and local `expo run:android` builds; an EAS login is not required for that workflow. Firebase Android configuration and the corresponding Expo/EAS FCM V1 credential are configured **in local development only**, and real Expo Push token registration and remote delivery are verified on the physical R1.

Phase 2 (Expo Router app, web target) is complete: quick-add box, inbox triage, task list, notes, project view, per `docs/ARCHITECTURE.md`'s Phase plan. Full manual CRUD for tasks/notes/projects (not just AI capture), TanStack Query on a rebuilt `packages/api-client`, soft-delete/archive semantics (`archived_at`, no hard deletes), a real `inbox → active` task transition, a global quick-add reachable from every screen, and an always-on production web deployment (not just a local dev server) with explicit SPA-fallback routing for the app's UUID-keyed dynamic routes (`tasks/[id]`, `notes/[id]`, `projects/[id]`) — all implemented, deployed to `personal-os`, and verified against the live deployment in a real browser.

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
- [x] **Phase 2 backend implementation — `archived_at` soft-delete data model, task-lifecycle core helpers, tasks/notes/projects/occurrences schemas + API routes, the `expand-due-date-window` drop/archive regression fix, and a rebuilt `packages/api-client` — done and verified on Mac dev.** Full details below.
- [x] **Phase 2 automated tests — 33 new tests across `apps/api` (Fastify `.inject()` against a real dedicated test database), `apps/worker`, `packages/core`, and `packages/api-client` — closing the standing zero-test gap in both apps.** Full details below.
- [x] **Phase 2 mobile UI — NativeWind, TanStack Query, all five screens, global quick-add, explicit SPA routing config — built, verified in a real browser against a local production-mode build, deployed to production (`personal-os`), and verified end-to-end in a real browser against the live deployment.** Full details below, including four real bugs the live build/deploy surfaced and fixed.
- [x] **Phase 3 Checkpoint 1 — schema + auth foundation: `devices`/`device_pairing_codes`/`notification_dispatch_log` tables, pairing-code-gated device registration, scoped bearer-token auth with an explicit documented security boundary, nullable `inbox_items.raw_text` propagated through every consuming layer — implemented and verified with a live curl-driven pairing/registration/auth/revoke cycle against a real running server.** Full details below under "Phase 3 Checkpoint 1".
- [x] **Phase 3 Checkpoint 2 — API + worker behavior: crash-safe `notifications.dispatch` with an explicit pending/accepted/failed state machine and permanent-vs-transient Expo error classification, a provider-agnostic transcription client reusing the existing encrypted AI-provider tables, `POST /transcribe`, the `ptt.transcribe` job with `deadLetter`-driven terminal cleanup, and a required orphan-audio sweep cron — implemented and verified with a live curl-driven `/transcribe` → worker → graceful-degradation cycle against a real running server.** Full details below under "Phase 3 Checkpoint 2", including exactly what remains unverified pending real provider/push credentials.
- [x] **Phase 3 Checkpoint 3 — native app foundation: the Rabbit R1 hardware spike (KEY_POWER and the scroll wheel both conclusively confirmed unusable at the app level, recorded honestly rather than assumed), two real latent bugs fixed by the first-ever native build of this codebase, `expo-secure-store`-backed device credential persistence, pairing-code onboarding, device settings, primary-device selection, and an isolated hardware-input abstraction — implemented and verified live on the physical device, including SecureStore persistence across a real app restart.** Full details below under "Phase 3 Checkpoint 3".
- [x] **Phase 3 Checkpoint 4 — PTT + notifications + reboot survival: implemented, hardened, and verified end to end on the physical Rabbit R1, including both credential-dependent gates (real Groq `voice_transcribe` STT and real Expo Push via Firebase/FCM V1) — local development only, nothing deployed.** Full details below under "Phase 3 Checkpoint 4".

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

## Phase 2 backend implementation (2026-08-16)

Plan approved via plan mode, including two corrections made by the user before approval: delete semantics changed from an initial hard-delete+cascade draft to soft-delete/archive (`archived_at`, no destructive removal of `occurrences`/`item_tags`/`inbox_items` lineage, no Trash/Restore UI built but the API is shaped so restoration can be added later); and the web deployment section was made explicit about `web.output: "single"` SPA routing for the app's UUID-keyed dynamic routes, verified live against Expo's current documentation rather than assumed from memory. This entry covers the backend layer only — see "Not yet done" at the end.

**What was built:**

1. **Data model** (`packages/db`) — nullable `archived_at timestamptz` added to `tasks`/`notes`/`projects` (soft-delete axis, independent of task lifecycle `status`); new indexes `tasks_project_id_idx`, `tasks_status_due_at_idx` (partial, `where archived_at is null`), `notes_project_id_idx` (partial), `events_project_id_idx`, `events_starts_at_idx`; a missing doc comment added on `inbox_items.entity_id`'s polymorphism (matching the existing comments on `occurrences.parent_id`/`item_tags.item_id`). Deliberately did **not** add a `projects.status` check constraint (an earlier plan draft proposed `('active','archived')`, which would have collided in meaning with the new `archived_at` column on the same table — organizational status and soft-delete are kept as separate axes, per the user's correction). One new migration, `packages/db/drizzle/0003_shiny_klaw.sql` — purely additive (3 `ADD COLUMN`, 5 `CREATE INDEX`), no drops or data-migrating statements.
2. **`packages/core`** — new `task-lifecycle.ts`: `canCompleteTaskDirectly` (false for any task with an `rrule` — recurring tasks complete via their occurrence, not directly) and `canActivateTask` (true only from `status: "inbox"`). Pure, colocated tests.
3. **`packages/schema`** — new `tasks.ts`, `notes.ts`, `projects.ts`, `occurrences.ts`, `pagination.ts` (shared `PaginationQuerySchema` + `paginatedResponseSchema` factory). `TaskCreateSchema`/`TaskUpdateSchema` are `.strict()` — an attempt to sneak `rrule`/`recurrence_*`/`status`/`archived_at` into a request body is a `400 validation_failed`, not a silent strip, since RRULE creation/editing stays capture(AI)-only until Phase 4's RRULE editor. `FlexibleDatetimeSchema` exported out of `parser-tools.ts` for reuse instead of duplicating the offset-optional datetime regex.
4. **`apps/api`** — new `routes/tasks.ts`, `notes.ts`, `projects.ts`; extended `routes/inbox.ts` (`GET /inbox` list, previously missing) and `routes/occurrences.ts` (`GET /occurrences` list, new — lets a client discover a recurring task's open occurrence id). Full endpoint list: `GET/POST /tasks`, `GET/PATCH /tasks/:id`, `POST /tasks/:id/{archive,activate,complete,drop}`; `GET/POST /notes`, `GET/PATCH /notes/:id`, `POST /notes/:id/archive`; `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/archive`. No `DELETE` verb anywhere — archiving is modeled as a `POST .../archive` action endpoint since it's a reversible state change, not a deletion, matching the existing `/complete`/`/drop` convention. `POST /tasks/:id/complete` on a recurring task returns `409 { error: "recurring_task_use_occurrence", occurrence_id }` rather than acting — the occurrence id is resolved via the same "earliest scheduled occurrence" query `GET /occurrences` exposes. `POST /projects/:id/archive` has no manual cascade code at all — the existing `project_id` FK (`onDelete: "set null"`) already does the right thing since nothing is being deleted at the database level.
5. **`apps/worker`** — `jobs/expand-due-date-window.ts`'s query gained `ne(tasks.status, "dropped")` and `isNull(tasks.archivedAt)`. Before Phase 2, nothing could ever change a task's status or archive it, so this filter didn't exist and wasn't needed; `POST /tasks/:id/drop` and `POST /tasks/:id/archive` are the first code paths that can, and without this fix the nightly cron would have kept silently regenerating occurrences for a task the user just dropped or archived.
6. **`packages/api-client`** — rebuilt from a one-method (`health()` only, no error handling) stub into `client.ts` (`fetchJson` helper, `ApiClientError{status, code, issues?, body}` thrown on any non-2xx, a generic `buildQuery` helper) plus one file per domain (`capture.ts`, `inbox.ts`, `tasks.ts`, `notes.ts`, `projects.ts`, `occurrences.ts`), composed into a flat `createApiClient(baseUrl)` method bag in `index.ts`. Also filled in the pre-existing gap that Phase 1's `/capture`/`/inbox`/`/occurrences` endpoints never got client methods. Zero React/TanStack dependency in this package, per `packages/api-client`'s framework-agnostic contract — those hooks are Phase 2's next step, in `apps/mobile`.

**Verification actually run (Mac dev):**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after every change in this section |
| 2 | Migration `0003` applies cleanly as `posops_migrator` | `\d tasks`/`\d notes`/`\d projects`/`\d events` show the new columns/indexes exactly as generated; `posops_app` re-confirmed unable to `CREATE TABLE` (`permission denied for schema public`) and able to read the new `archived_at` columns |
| 3 | `apps/api`/`apps/worker` boot via `tsx watch` against local dev Postgres | Clean start, `/health` → `{"status":"ok","db":"connected",...}` |
| 4 | Full task CRUD + lifecycle, live curl | `POST /tasks` with `rrule` in the body → `400`; plain create → `active`; `PATCH` → field updates persist; `POST /tasks/:id/complete` → `done`+`completed_at`; `POST /tasks/:id/archive` → `archived_at` set |
| 5 | Archive is independent of status, and hides from default list views without touching anything else | The same task stayed `status: "done"` after archiving (two independent axes, as designed); `GET /tasks?project_id=` → `total: 0` after archiving, `GET /tasks?project_id=&include_archived=true` → `total: 1`, `GET /tasks/:id` → still returns the row directly |
| 6 | `inbox → active` real transition | Inserted a `status: "inbox"` task directly via `psql` (simulating an AI capture); `POST /tasks/:id/activate` → `active`; calling it again → `409 invalid_status_transition`; calling `/activate` on a `done`+archived task → `409` from the wrong starting state |
| 7 | Notes CRUD + archive | Create → patch → archive; `GET /notes` excludes the archived one afterward |
| 8 | Project archive does not orphan its tasks | Archived a project owning a task; the task's `project_id` stayed set (confirmed via `GET /tasks/:id`) — no cascade, exactly as designed (soft-delete never triggers the `set null` FK, since nothing is deleted at the database level) |
| 9 | Recurring-task `/complete` redirect | Inserted a real `FREQ=WEEKLY;INTERVAL=1` due-date task via `psql`, ran `expand-due-date-window` manually (12 occurrences generated over the 90-day window), called `POST /tasks/:id/complete` directly → `409 { error: "recurring_task_use_occurrence", occurrence_id: "<the earliest scheduled one>" }` |
| 10 | **The `expand-due-date-window` regression fix, live, not just read** | Dropped the same recurring task, deleted its 12 occurrences, re-ran the window job → **0** new occurrences generated (previously it would have regenerated all 12, silently undoing the drop). Repeated with a second recurring task using `archive` instead of `drop` → same result, **0** regenerated. A third, still-active recurring task in the same test confirmed the job still works normally (12 generated) — the filter excludes exactly `dropped`/archived tasks, not recurring tasks in general |

All test data (projects, tasks, notes, occurrences created during this verification) deleted from the dev database afterward.

**Automated tests added** (closing the standing zero-test gap): `apps/api` gained `vitest.config.ts` (pointing `DATABASE_URL` at a dedicated `personalos_test` database, `fileParallelism: false` since all route test files share that one database) and route tests for tasks/notes/projects/inbox/occurrences (23 tests) using Fastify's `.inject()` against real Postgres, not mocks — covering CRUD happy paths, `.strict()` rejecting `rrule`/`status`/`archived_at`, the recurring-task 409 redirect, the `activate` 409 from non-inbox states, and archive-independence (a follow-up `SELECT` confirms occurrences/item_tags/inbox_items row counts are unchanged after archiving, not just that the response looked right). `apps/worker` gained a direct regression test for the drop/archive fix above (3 tests). `packages/api-client` gained `client.test.ts` (8 tests, stubbed `fetch`) verifying `ApiClientError` shape and request formatting.

## Phase 2 mobile UI + production deployment (2026-08-16)

Built the `apps/mobile` web UI and deployed it as an always-on production service, per decisions 5 and 6. This is the part of Phase 2 with the most genuine surprises — four real bugs, none visible from source review alone, each found only by actually booting the app (first locally, then in production) and clicking through it in a real browser.

**What was built:**

1. **NativeWind** — `nativewind`, `tailwindcss`, `babel-preset-expo` added; `tailwind.config.js` (content globs over `src/`, `darkMode: "class"` — see Bug 2 below), `babel.config.js`, `metro.config.js` (`withNativeWind`), `nativewind-env.d.ts`. The existing `src/global.css` already had `@/global.css` wired into the app's import graph from Phase 0 (for CSS custom properties) — added the `@tailwind base/components/utilities` directives to that same file rather than introducing a second CSS entry point. `app.json`'s `web.output` changed from `"static"` to `"single"` — the SPA mode the plan requires, verified live against Expo's own docs during planning: no per-route static HTML, no `generateStaticParams` needed, routing for `tasks/[id]`/`notes/[id]`/`projects/[id]` happens entirely client-side.
2. **TanStack Query** — `src/queries/client.ts` (the `QueryClient` + `createApiClient(EXPO_PUBLIC_API_URL)` instance) plus one hooks file per domain (`tasks.ts`, `notes.ts`, `projects.ts`, `inbox.ts`, `occurrences.ts`, `capture.ts`), each invalidating the relevant query key on mutation success.
3. **Five screens** under a `(tabs)` group (Tasks — default, New/Active/Done/Dropped filter; Inbox triage; Notes; Projects) plus pushed routes for `tasks/[id]`, `tasks/new`, `notes/[id]`, `notes/new`, `projects/[id]`, `projects/new`. A recurring task's `rrule` renders read-only on its edit screen, never editable, per decision 1. Completing a recurring task from the list catches the API's `409 recurring_task_use_occurrence` and falls back to completing its open occurrence instead of the task directly.
4. **Global quick-add** (`src/components/quick-add-fab.tsx`) — a floating action button + modal mounted once in the root `_layout.tsx`, reachable from every screen, per decision 5.
5. **Production deployment**: new `apps/mobile/Dockerfile` (multi-stage — builds the workspace's package dependencies via `turbo run build --filter=mobile...`, then `expo export --platform web` with `EXPO_PUBLIC_API_URL` baked in via a build arg, then a `serve -s dist` runtime stage — the `-s` flag is the actual SPA-fallback mechanism, rewriting any unmatched path to `index.html` instead of 404ing). New `web` service in `docker-compose.yml` (no ports — matches the base file's "nothing published" pattern) and `docker-compose.prod.yml` (`127.0.0.1:8081:8080`, matching the API's own localhost-only binding pattern). `.dockerignore`'s prior blanket `apps/mobile` exclusion removed (Phase 0/1 never needed that directory in any Docker build context; Phase 2's web image does). New `@fastify/cors` on `apps/api`, scoped to a `WEB_APP_ORIGIN` env var (comma-separated allowlist, defaults cover local Metro dev ports) — needed because the web app and the API are different origins (different Tailscale Serve ports). A second Tailscale Serve HTTPS listener, `--https=8443`, proxying to the web container — confirmed the `himallinux` Tailscale-operator grant from the Phase 0 deployment still works passwordlessly for this, no sudo needed.

**Four real bugs found and fixed, each only by running the actual app:**

- **Bug 1 — Node-only `rrule` workaround leaking into the browser bundle.** The Phase 1 fix for `rrule`'s CJS/ESM interop bug (`createRequire(import.meta.url)`, see the 2026-08-15 entry above) is Node-only — `import.meta.url` and `node:module` don't exist in a browser. `packages/schema` imports `isValidTimezone` from the `@personal-os/core` barrel, which `export *`s the recurrence module; Metro bundles whatever a barrel import statically reaches, so the web build crashed at boot with `Cannot use 'import.meta' outside a module`. Fixed by adding a `./timezone` subpath export to `packages/core/package.json` and changing `packages/schema`'s two call sites to import from `@personal-os/core/timezone` directly, keeping `rrule` and the Node-only workaround out of the web bundle's module graph entirely. `apps/api`/`apps/worker` are unaffected — they still import the full barrel and run in Node.
- **Bug 2 — NativeWind's dark-mode `MutationObserver` crashed under the default `media` strategy.** `react-native-css-interop`'s web runtime observes the DOM and calls its own `colorScheme.set()` internally to sync OS preference — under NativeWind's default `darkMode: "media"`, that internal `.set()` call throws unconditionally (`Cannot manually set color scheme, as dark mode is type 'media'`), crashing app boot. Fixed by setting `darkMode: "class"` in `tailwind.config.js` (using NativeWind's own `useColorScheme` hook, not React Native's raw one, for the root layout's theme selection) — the interop runtime still follows OS preference automatically, just through a code path the library actually supports.
- **Bug 3 — the API client always sent `Content-Type: application/json` even with no body.** Every action endpoint (`/tasks/:id/archive`, `/activate`, `/complete`, `/drop`, `/notes/:id/archive`, `/projects/:id/archive`, occurrence complete/skip) is called with no request body — but `fetchJson` unconditionally set `Content-Type: application/json` regardless, which Fastify's JSON body parser correctly rejects as `FST_ERR_CTP_EMPTY_JSON_BODY` (a claimed JSON body that's actually empty). This shipped past all 23 new route tests because `.inject()` never goes through the client's request-shaping logic at all — only exercising the real UI against a real server caught it. Fixed in `packages/api-client/src/client.ts`: only set `Content-Type` when `init.body` is actually present. Added a regression test (`client.test.ts`) asserting the header is absent for a bodyless request.
- **Bug 4 — the error handler coerced every framework-level error to `500`.** Bug 3's malformed-request error has its own `statusCode: 400` from Fastify, but `apps/api`'s `setErrorHandler` only special-cased `ZodError` and treated everything else as an opaque `500 internal_error` — masking a genuine, actionable 400 as an unexplained server failure and making Bug 3 harder to diagnose than it should have been. Fixed to respect a thrown error's own `statusCode` (and `code`) when it's a real 4xx, falling back to `500` only for errors that don't self-report a client-error status.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | Local dev (`expo start --web`), real browser | Booted clean after the two crash fixes (Bugs 1–2); NativeWind styling visibly applied; console free of the earlier `import.meta`/color-scheme errors |
| 2 | Global quick-add | Reachable from every tab; a real capture landed in Inbox triage and displayed its `status: "failed"` / `"no AI provider is configured for task \"capture_parser\""` correctly (dev DB has no AI provider configured — this is the same graceful Phase 1 error-handling behavior, working as designed, not a new failure) |
| 3 | Notes: create/edit/archive | Full cycle through the UI; **live TanStack Query invalidation confirmed** — archiving a note removed it from the default list within the same session, no manual page refresh, verified via a clean single-action test after an earlier double-click test produced a momentarily confusing (but ultimately consistent) render |
| 4 | Tasks/Projects screens | Rendered correctly; project creation, task creation with project assignment, and project-scoped task/note lists all confirmed via curl cross-checks against the running dev API |
| 5 | **Production-mode SPA build, local** (`expo export --platform web` + `serve -s dist`, not the dev server) | `dist/` contains exactly one `index.html`, one JS bundle, one CSS bundle (confirms `web.output: "single"` is genuinely producing SPA output, no per-route prerendering) |
| 6 | Direct cold load of `/tasks/<uuid>`, refresh, and a fresh-tab deep link to `/projects/<uuid>` (no prior `/` visit) | All three render the correct screen with real data, not a 404 — run against the local `serve -s dist` build |
| 7 | Production deployment | `docker compose build api worker web` succeeded on `personal-os`; migration `0003` applied via ephemeral `posops_migrator` container (see note below on an unintended `postgres` container recreation); `docker compose up -d api worker web` — all 4 containers healthy, the user's real AI-provider configuration (1 connection/model/task-route row) confirmed intact throughout |
| 8 | Port/security audit | `ss -tln` on the server: only `127.0.0.1:3000` (api), `127.0.0.1:8081` (web), and Tailscale's own tailnet-interface listeners on `443`/`8443` — no `0.0.0.0` bindings, Postgres still unpublished, identical security posture to Phase 0/1 |
| 9 | API health + web app, real Tailscale HTTPS | `https://personal-os.tail62a68f.ts.net/health` → `db: "connected"`; `https://personal-os.tail62a68f.ts.net:8443/` → `200` |
| 10 | CORS, real Tailscale HTTPS | A preflight from the deployed web origin (`https://personal-os.tail62a68f.ts.net:8443`) → `access-control-allow-origin` present; the identical request with `Origin: https://evil.example.com` → header absent, request would be blocked client-side |
| 11 | **Full SPA-routing check against the live deployment, in a real browser** (Claude's in-app browser sandbox blocked `/_expo/static/*` requests on the non-standard `:8443` port — confirmed via `curl` that the exact same URLs return `200`; re-verified visually using the user's real Chrome instead) | Direct cold load of `/tasks/<real-uuid>` and a hard refresh on it both rendered correctly against the live deployment |
| 12 | **Full lifecycle cycle against live production data, in a real browser**: create → view via direct deep link → refresh → archive (one task), and separately capture-simulated inbox → activate → complete → archive (a second task) | Every transition confirmed both visually (UI state updated correctly, no manual refresh needed) and via a follow-up `GET`/`psql` check that the database state actually changed |
| 13 | Restart behavior | `docker compose restart api worker web` on production → all three recovered cleanly within seconds, confirmed via `/health` and the web app reloading |
| 14 | Final workspace verification | `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all clean workspace-wide (now including `apps/mobile`, which gained its own `typecheck` script — previously absent, so the root command silently never checked it) |

**One deployment-process mistake, caught and explained rather than hidden:** the migration step's `docker compose run --rm --entrypoint sh api -c "..."` command omitted the `-f docker-compose.prod.yml` flag, causing Compose to reconcile against a different merged config than what was actually running and recreate the `postgres` container. The named volume (`postgres_data`) is independent of container recreation, so no data was lost — confirmed immediately via `select count(*) from ai_provider_connections` before and after (both `1`, matching the user's real, intentionally-preserved AI provider configuration) — but it was a few seconds of avoidable restart that a Phase 1-style "zero downtime" deployment shouldn't have had. Every subsequent command in this deployment explicitly passed both `-f docker-compose.yml -f docker-compose.prod.yml` to prevent a repeat.

All test data (tasks, notes, projects, inbox items created during this verification) deleted from both the dev and production databases afterward. The user's real AI-provider configuration was left untouched in production throughout.

## Phase 3 Checkpoint 1: schema + auth foundation (2026-08-16)

Plan approved via plan mode after three revisions. The target native device is a Rabbit R1 running CipherOS (community AOSP-based Android 16/SDK 36), inspected directly via `adb` during planning (screen 480x640px/density-override 190, live input-event capture of the scroll wheel and side button) rather than trusting public hardware reports — the side-button driver was found to fire real interrupts on this exact unit, contradicting a public "zero interrupts" report, though the button fires as `KEY_POWER`, which Android conventionally intercepts before app dispatch (an open question deferred to a Checkpoint 3 spike). Plan review also caught and corrected: an ineffective `POST /devices` access control (any tailnet peer could re-register a revoked device), an unclassified push-retry design, an ambiguous nullable-`raw_text` UI fallback, and an under-specified reboot-survival requirement for local reminders (the MVP's core property).

**What was built (this checkpoint):**

1. **Schema** (`packages/db`) — new tables `devices` (bearer-token auth, hash-only storage, one-primary-device partial unique index), `device_pairing_codes` (one-time registration gate), `notification_dispatch_log` (crash-safe dispatch state: `pending`/`accepted`/`failed` — deliberately not `sent`, since a successful Expo ticket only means Expo accepted the request, not that FCM or the device received it). Existing-table change: `inbox_items.raw_text` made nullable (a PTT capture writes its row before a transcript exists). One migration (`0004_eminent_moondragon.sql`), purely additive/loosening — no drops, no data-touching statements.
2. **`packages/core`** — `device-auth.ts`: `generateDeviceToken`/`hashDeviceToken` (256-bit random token, SHA-256 hash-only storage — deliberately not the AES-256-GCM scheme `credential-crypto.ts` uses for AI keys, since a device token is never decrypted, only compared) and `generatePairingCode`/`hashPairingCode` (8-char Crockford-Base32 codes, same one-way-hash pattern, case/hyphen-insensitive comparison).
3. **`apps/api`** — `plugins/device-auth.ts` (a `preHandler`, attached per-route-file via `addHook` so it can never leak onto the existing tasks/notes/projects/capture/inbox/occurrences routes, which remain Tailscale-perimeter-only, unchanged — this scoping is stated explicitly as a security-boundary comment in the plugin itself, not just implied); `routes/devices.ts` (two Fastify sub-contexts in one file — an unauthenticated, pairing-gated `POST /devices`, and everything else behind the auth hook: `GET/PATCH /devices/:id`, `/primary` two-statement transaction, `/push-token` self-only, `/revoke` idempotent); `scripts/generate-pairing-code.ts` (a CLI script, deliberately **not** a network endpoint — generating a code requires shell access to the box running the API, a materially stronger trust boundary than "somewhere on the tailnet," which is the exact trust level that made `POST /devices` insufficiently protected before this existed). `server.ts`'s logger redaction gained `req.headers.authorization`.
4. **`apps/worker`** — `capture-parse.ts` gained an explicit invariant check (`row.rawText === null` throws loudly) rather than silently accepting a null now that the type allows it; enforces that `capture.parse` must never run against a still-transcribing PTT row (a future bug, not a current one — `ptt.transcribe` doesn't exist until Checkpoint 2).
5. **`packages/schema`/`packages/api-client`** — `devices.ts` schemas (`.strict()` throughout, the registration response is the only shape that ever includes the raw token, returned exactly once) and matching typed client functions; `inbox.ts`'s `raw_text` changed to `z.string().nullable()`.
6. **`apps/mobile`** — the Inbox screen's transcript rendering is now three-way: transcript present → show it; `raw_text: null` + `status: "pending"` → "Transcribing…"; `raw_text: null` + `status: "failed"` → "Transcription failed" (this maps cleanly onto the existing state machine with no new column, since a PTT row can only have null `raw_text` in exactly those two statuses).

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing two real lint errors (`require-await` on the two-context route registration and a throwaway test route) and one TS4111 (bracket-notation-required index-signature access) surfaced during this pass |
| 2 | Migration applies cleanly as `posops_migrator`, in both the dev and dedicated test databases | `\d devices`/`\d device_pairing_codes`/`\d notification_dispatch_log`/`\d inbox_items` all match the schema exactly, including the `one_primary_device` partial unique index and the `notification_dispatch_log_status`/`devices_platform` CHECK constraints |
| 3 | `posops_app` still cannot DDL, and can read/write the new tables | Direct `CREATE TABLE should_fail` as `posops_app` → `permission denied for schema public`; a direct `INSERT`/`DELETE` against `devices` as `posops_app` succeeds |
| 4 | Automated tests | 129 tests total across the workspace, all passing: `packages/core` 44 (+8 new, `device-auth.test.ts`), `packages/schema` 11, `packages/ai-providers` 14, `packages/api-client` 10 (+2 new), `apps/worker` 3, `apps/api` 42 across 7 files (+2 new files: `routes/devices.test.ts` and `plugins/device-auth.test.ts`) — covering pairing-code rejection (missing/unknown/expired/already-consumed), **atomic single-use under real concurrency** (`Promise.all` of two simultaneous registration attempts against the same code — exactly one succeeds), every auth rejection path (missing header, malformed header, unknown token, revoked device), primary-swap atomicity (exactly one `is_primary_reminder_device = true` after two swaps), self-only push-token `403`, idempotent revoke, and `last_seen_at` bumping |
| 5 | `apps/api` boots and serves real traffic | `tsx` against local dev Postgres; `GET /health` → `db: "connected"` |
| 6 | **Full live pairing → registration → auth → revoke cycle, real curl against a real running server, not just `.inject()`** | `pnpm --filter api pairing:generate` printed a real code → `POST /devices` with it → `201` + one-time token → **reusing the same code** → `401 invalid_or_expired_pairing_code` → `GET /devices` with the token → `200`, `last_seen_at` populated → `POST /devices/:id/revoke` → `200` → same token on `GET /devices` → `401 device_revoked` → **`GET /tasks` with no Authorization header at all** → `200`, confirming the security-boundary claim live: revoking a device blocks the device-specific routes but has zero effect on the existing Tailscale-only API surface |

All test data (the one real device row and pairing code created during step 6) deleted from the dev database afterward.

**Not yet done (deferred to later checkpoints, per the approved plan):** `notifications.dispatch`/`ptt.transcribe`/orphan-audio-sweep worker jobs, the Groq transcription client, `POST /transcribe`, the shared audio Docker volume (Checkpoint 2); all native/Expo work including the `KEY_POWER` app-deliverability spike, the exact-alarm strategy spike, and reboot-survival verification (Checkpoints 3–5); production deployment (Checkpoint 6).

## Phase 3 Checkpoint 2: API + worker behavior (2026-08-16)

Continues directly from Checkpoint 1, per the approved plan. No new database tables or migrations this checkpoint — everything below is new code against Checkpoint 1's existing schema.

**What was built:**

1. **`packages/core`** — `quiet-hours.ts`: `isWithinQuietHours(now, start, end, timezone)`, a pure function handling the overnight-wraparound case (e.g. 22:00→06:00) via `toWallClockComponents`. Used by `notifications.dispatch` to suppress `confirmation`/`digest` categories during a device's quiet hours — `alert` is never suppressed.
2. **`packages/ai-providers`** — `transcription-client.ts`: `transcribeAudio()` speaks the raw OpenAI-compatible multipart `/audio/transcriptions` contract directly (Node's global `FormData`/`Blob`, no new dependency), parsing `verbose_json`'s per-segment `avg_logprob` into a mean confidence signal. `resolve-transcription-connection.ts`: `resolveTranscriptionConnectionForTask()`, structurally parallel to `resolve-model.ts` but returns raw connection details (`baseUrl`/`apiKey`/`modelId`) instead of a Vercel AI SDK `LanguageModel` — reuses `ai_provider_connections`/`ai_models`/`ai_task_routes` and `credential-crypto.ts` exactly as-is, **zero schema changes**, no new `provider_type`. Deliberately **not** an extension of the chat-oriented abstraction: `TranscriptionModel` is a structurally different SDK type from `LanguageModel`, and `@ai-sdk/openai-compatible` (the adapter every non-native vendor in this codebase goes through) has no transcription support at all — confirmed by reading `adapter-registry.ts` directly, not assumed. No fallback chain (Phase 3 only ever configures one STT provider). No dedicated unit test file for the resolver itself — matches `resolve-model.ts`'s own established precedent of zero dedicated tests for DB-querying resolution logic; its behavior (including the `NoProviderConfiguredError` path) is instead covered by `apps/worker`'s real-Postgres-backed `ptt-transcribe.test.ts`.
3. **`apps/api`** — new dependency `@fastify/multipart`. `routes/transcribe.ts`: `POST /transcribe`, Tailscale-only (matching `/capture`'s auth posture, not folded into the device-token scope), multipart parsing via `request.parts()`, `client_uuid` dedupe reusing the exact `onConflictDoNothing` pattern already in `capture.ts`, write-before-processing (`raw_text: null`, `audio_path` set, before any transcription work happens). `queue-names.ts` gained `PTT_TRANSCRIBE_QUEUE`; `plugins/boss.ts` now creates it. New `AUDIO_STORAGE_PATH` env var (shared with `apps/worker`), defaulting to `/tmp/personal-os-audio` locally.
4. **`apps/worker`** — new dependency `expo-server-sdk`. `jobs/notifications-dispatch.ts`: an explicit `pending`/`accepted`/`failed` state machine on `notification_dispatch_log`, with **per-target Expo ticket error classification verified against the actual installed `expo-server-sdk@7.1.0` type definitions** (not assumed) — `DeviceNotRegistered`/`MessageTooBig`/`MessageRateExceeded`/`InvalidCredentials` are treated as permanent (finalized `failed` immediately, never retried; `DeviceNotRegistered` additionally clears that device's `push_token`), everything else (network failures, unrecognized error codes) is transient and left `pending` for pg-boss's own retry. A `deadLetter`-registered dead-letter queue (`notifications.dispatch.dead`) finalizes any row still `pending` once retries are genuinely exhausted, so a row can never linger forever with no terminal state. `jobs/ptt-transcribe.ts`: idempotency via presence of `audio_path` (not attempt count), commits the transcript *before* deleting the source file, hands off to the **existing, unchanged** `capture.parse` job on success, and uses the identical `deadLetter`-driven terminal-cleanup pattern for exhausted transient retries. `jobs/sweep-orphan-audio.ts`: hourly cron, deletes any file in `AUDIO_STORAGE_PATH` older than 2 hours with no matching `inbox_items.audio_path` — the required backstop for the crash window between committing a transcript/failure and this project's own subsequent file delete. `index.ts` wiring: **both dead-letter queues are created via `createQueue()` before their primary queues** — verified by reading pg-boss's actual installed source (`dead_letter` is a foreign-key column against `queue.name`, not an auto-created convenience) rather than assumed, and confirmed correct in practice by booting the worker for real with zero FK errors.
5. **Docker** — `docker-compose.yml` gained a shared `audio_data` named volume mounted into both `api` and `worker` at `/data/audio`, matching `AUDIO_STORAGE_PATH`.

**A real bug caught only by running the actual test suite and inspecting the filesystem afterward, not by any automated assertion:** `POST /transcribe`'s route handler writes real files to disk, and neither `apps/api`'s nor `apps/worker`'s test suites isolated or cleaned up `AUDIO_STORAGE_PATH` — both silently used the same real default path (`/tmp/personal-os-audio`) a genuine local dev run also uses, and `apps/api`'s tests left real files behind indefinitely (no cleanup at all). Fixed by giving each package its own dedicated test-only `AUDIO_STORAGE_PATH` override in `vitest.config.ts`, plus explicit `afterAll` cleanup in `transcribe.test.ts`. Verified by a fresh full-suite run producing zero leftover files under `/tmp/` afterward.

**A second real bug, caught by the automated suite itself:** the first draft of `notifications-dispatch.test.ts` mocked `expo-server-sdk`'s `Expo` class as an arrow function (`vi.fn().mockImplementation(() => ({...}))`) — arrow functions have no `[[Construct]]` internal method, so `new Expo()` inside `notifications-dispatch.ts` threw `TypeError: ... is not a constructor` at module-load time. This crashed the whole test file and produced a confusing, unrelated-looking cascading failure in a separately-scheduled test file (`ptt-transcribe.test.ts`) within the same worker test run — resolved by re-running that file in isolation first (it passed cleanly on its own, proving the fault was elsewhere) before finding the actual cause. Fixed by using a named `function` expression in the mock instead.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing the two bugs above plus two ESLint issues (`no-restricted-syntax`-style inline `typeof import()` type annotations, and `unbound-method` false positives on `boss.send` property access — fixed by referencing a local `vi.fn()` directly instead of a property path) |
| 2 | Automated tests | **165 tests total across the workspace, all passing (41 new)**: `packages/core` 49 (+5, `quiet-hours.test.ts`), `packages/ai-providers` 20 (+6, `transcription-client.test.ts`), `packages/schema` 11, `packages/api-client` 10, `apps/worker` 27 (+24: 13 `notifications-dispatch.test.ts`, 7 `ptt-transcribe.test.ts`, 4 `sweep-orphan-audio.test.ts`), `apps/api` 48 (+6, `transcribe.test.ts`) — covering the full `pending`→`accepted`/`pending`→`failed`(permanent, no retry)/`pending`→rethrow(transient)/dead-letter-finalizes-still-pending state machine, `DeviceNotRegistered` clearing `push_token`, quiet-hours suppression (confirmation suppressed, alert never suppressed, verified with `vi.useFakeTimers`), `ptt.transcribe`'s audio-path idempotency and commit-before-delete ordering, and the orphan sweep's age-threshold/still-referenced-file/missing-directory behavior |
| 3 | `apps/api`/`apps/worker` boot and serve real traffic | Both booted via `tsx` against local dev Postgres; worker log confirmed `notifications.dispatch.dead`/`ptt.transcribe.dead` created before their primary queues with **zero foreign-key errors** — the dead-letter ordering requirement, verified correct in practice, not just in the source |
| 4 | **Full live `POST /transcribe` → worker → graceful-degradation cycle, real curl against a real running server with a real (small, synthetic) audio file, not just `.inject()`** | `POST /transcribe` with a real multipart upload → `202` + `inbox_items` row (`raw_text: null`, `source: "ptt"`, `audio_path` set, `status: "pending"`) → the running worker's `ptt.transcribe` job picked it up and, since no `voice_transcribe` provider is configured in this environment (confirmed empty `ai_provider_connections`/`ai_task_routes` tables), gracefully finalized it `status: "failed"` with `audio_path` cleared **and the uploaded file actually deleted from disk** — the same graceful `NoProviderConfiguredError` degradation pattern already proven for `capture.parse` in Phase 1, now proven for `ptt.transcribe` too. A second identical `POST /transcribe` (same `client_uuid`) confirmed live dedupe: same `inbox_id` returned, exactly one row in the database |

All test data (the one real `inbox_items` row and its audio file from step 4) deleted afterward; both servers stopped.

**Not yet verified — explicitly, because the required real credentials don't exist in this environment:**

- **No real `voice_transcribe` provider is configured** (confirmed via a direct query: zero rows in `ai_provider_connections` and `ai_task_routes` in the dev database). The actual Groq (or any real STT vendor) transcription happy path — a real audio file producing a real transcript, and the `avgLogprob` confidence signal it feeds — has **not** been verified end-to-end. What **is** verified: the multipart request/response contract itself against a mocked `fetch` (`transcription-client.test.ts`), and the full pipeline's graceful behavior with no provider configured, both as an automated test and live over real curl (table row 4 above).
- **No device has a real Expo push token registered** in this environment. `notifications.dispatch`'s actual delivery to a real device via the real Expo Push API has **not** been verified end-to-end — only against a mocked Expo SDK. Registering a real device with a real push token isn't possible until Checkpoint 3's native build exists.
- Both gaps require the user to supply real credentials directly (a Groq/STT API key via the existing, unchanged `POST /ai/providers` routes; a physical device with a real push token, starting at Checkpoint 3) — neither is something this session can supply itself, per this project's standing rule that Claude doesn't handle raw API keys.

## Phase 3 Checkpoint 3: native app foundation (2026-08-17)

Opened with the planned Rabbit R1 hardware spike, per explicit instruction, before any UI work began. Everything below was verified on the actual physical unit — not a simulator, not `.inject()`.

### Hardware spike — conclusive, empirical, and negative for both inputs

Environment: the R1 reconnected via `adb` (it had disconnected between sessions). Local native build tooling had to be assembled from scratch — the Android SDK's build-tools/platforms/cmdline-tools were already present (from earlier `adb`-only setup), but no JDK was linked; a Homebrew-installed `openjdk@17` (already present, just unlinked from `PATH`/`JAVA_HOME`) was wired up directly rather than reinstalling anything.

**First native build surfaced two real, previously-latent bugs** — neither is a regression from this checkpoint's own code; both existed since earlier phases and were simply never exercised, because Phase 2's verification only ever used Expo's web bundler, never Metro's native transform pipeline:

1. **`apps/mobile/package.json`'s `babel-preset-expo` was pinned to a stale `~13.0.0`** (a pre-SDK-57-alignment version scheme), pulling in `@react-native/codegen@0.79.0-rc.4` alongside the correct `0.86.2` used elsewhere in the dependency tree. The mismatch broke Metro's codegen parser on react-native's *own* `VirtualViewNativeComponent.js`, crashing the JS bundle load entirely. Fixed via `npx expo install babel-preset-expo`, which correctly resolved `~57.0.7`.
2. **`packages/core/src/timezone.ts`'s `isValidTimezone` used `Intl.supportedValuesOf("timeZone")`** — an ES2022 addition Hermes (React Native's JS engine) does not implement, even though Node and every browser do. Every screen that imports `packages/schema` (which imports this function) blanked silently with `[TypeError: undefined is not a function]`, visible only via a hidden LogBox overlay (itself rendered black-on-black, invisible in a screenshot — found via a raw UI-hierarchy dump, not the screen itself). Fixed to use the portable `new Intl.DateTimeFormat(undefined, {timeZone: tz})`-throws-on-invalid pattern instead, which works identically across Node, browsers, and Hermes. Rebuilt `packages/core` and re-ran its 49 tests clean.
3. A third, environmental (not code) issue: **the R1's WiFi is disabled** (USB-only) — Metro's own port (8081) already worked via an `adb reverse` tunnel Expo's CLI sets up automatically, but reaching the locally-running API server (port 3000) for functional testing needed the same treatment added manually (`adb reverse tcp:3000 tcp:3000`).

**KEY_POWER spike result: negative, conclusive.** A native `dispatchKeyEvent` override (`apps/mobile/plugins/withHardwareInputBridge.ts`, an Expo config plugin patching the generated `MainActivity.kt` so the bridge survives every future `expo prebuild`) bridges `KEYCODE_POWER` into a `HardwareSideButtonEvent` DeviceEventEmitter event. During a live 90-second capture with the debug screen confirmed in foreground throughout, the user pressed the side button (short and long) — `adb logcat` showed `PowerManagerService: Going to sleep due to power_button` firing four times; **zero** `HardwareSideButtonEvent`s and **zero** `ReactNativeJS` log lines appeared. The button is handled as a literal system power button before Android ever queues the event for app dispatch.

**Scroll-wheel spike result: negative, conclusive.** The same bridge forwards `KEYCODE_DPAD_UP`/`DOWN` as `HardwareScrollWheelEvent`. During the same capture, rotating the wheel produced rapid, repeated `SystemUI` `VolumeDialogImpl: showH r=volume_changed` log lines (matching the previously-confirmed 8-12-events-per-rotation burst cadence) — the system intercepts these exact key codes as literal volume control. Again, zero app-level events, zero `ReactNativeJS` lines.

**Both results directly correct the optimistic reading of the raw `adb getevent` kernel-level capture from Phase 3 planning** — that capture proved the kernel driver fires real interrupts, but could not and did not prove anything about Android's higher policy layer, which on this ROM claims both key codes for system-level semantics before any app ever sees them. This is exactly the distinction the plan review's explicit instruction ("do not assume either behavior from the raw getevent results alone") anticipated. The native bridge and JS-side debounce/coalescing logic are correctly implemented and harmless to keep — they would start working immediately if a future CipherOS update changes this interception policy — but neither is currently usable as an app-level input. **Touch is not a fallback on this hardware; it is currently the only working interaction mechanism**, exactly as the checkpoint's own constraints already required regardless of the spike's outcome.

### What was built

1. **`packages/core`** — the Hermes-compatibility fix to `isValidTimezone` described above (a real bug fix, not new functionality).
2. **`apps/mobile/plugins/withHardwareInputBridge.ts`** — new Expo config plugin (new devDependency `@expo/config-plugins`), patches `MainActivity.kt`'s `dispatchKeyEvent` to bridge the two Rabbit-specific key codes into `DeviceEventEmitter`. Verified to survive `expo prebuild` regeneration (re-ran prebuild, confirmed the patch reapplied).
3. **`apps/mobile/src/hardware-input/`** — the isolated hardware-input abstraction: `useScrollWheel()`, a debounced hook coalescing the confirmed multi-event burst into one logical scroll call within a 200ms trailing window, direction-reversal-aware. Exported through a single barrel (`index.ts`). No screen anywhere checks `Platform`/device model directly for Rabbit-specific purposes — this directory is the only place that concept exists, satisfying the "don't scatter vendor checks" constraint. Currently inert per the spike, by design not a required dependency for anything.
4. **`apps/mobile/src/app/hardware-debug.tsx`** — a diagnostic screen (reachable via deep link only, `mobile://hardware-debug`, not primary navigation) built for the spike and kept as a standing tool for future hardware-input work.
5. **`apps/mobile/src/device-identity/`** — `storage.ts` (`expo-secure-store` wrapper for the device token + id — new dependencies `expo-secure-store`, `expo-application`), `provider.tsx` (a React context loading credentials once from SecureStore on mount, the single source of truth every device-authenticated query hook reads from), `pairing-screen.tsx` (device name — defaulted from `expo-device`'s real device-name detection — + pairing-code form, calling the existing, unchanged `POST /devices`).
6. **`apps/mobile/src/app/_layout.tsx`** — restructured into a whole-app gate: no stored credentials → `PairingScreen` renders in place of everything else; credentials present → the existing `Stack`, now also registering `settings` and `hardware-debug` routes.
7. **`apps/mobile/src/app/(tabs)/_layout.tsx`** — a shared settings header icon (⚙️, via `screenOptions.headerRight`) across all four tabs rather than a 6th tab — the small-screen decision from the Phase 3 plan, given the R1's 480px-wide display.
8. **`apps/mobile/src/app/settings.tsx`** — device list, primary-device selection (`POST /devices/:id/primary`), per-device notification toggles (`PATCH /devices/:id` for `notify_confirmations`/`notify_alerts`/`notify_digests`), revoke, and a local "forget this device" sign-out (clears SecureStore only, does not itself revoke server-side).
9. **`apps/mobile/src/queries/devices.ts`** — TanStack Query hooks wrapping the existing `packages/api-client` device functions, reading the bearer token from `DeviceIdentityProvider` rather than SecureStore directly on every call.
10. **`apps/mobile/eas.json`** — `development`/`preview`/`production` build profiles (APK build type for internal distribution). Written but not yet exercised — no `eas build` was run this checkpoint; every verification below used a local `expo run:android` build, which needs neither an EAS account nor a final package name.

**Rabbit-R1-optimized responsive layout**: achieved via NativeWind's existing mobile-first styling applied uniformly to every new screen (large touch targets, single-column vertical layouts) rather than any Rabbit-specific conditional logic — this benefits any small screen generically and keeps normal Android phones equally usable, satisfying the "no scattered vendor checks" / "normal phones must remain usable" constraints simultaneously rather than in tension.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after the two real bugs above |
| 2 | Automated tests | 165 tests, all passing (unchanged count — no new automated tests this checkpoint; device-identity/pairing/settings code has no automated coverage yet, matching this project's established minimal-mobile-testing philosophy from Phase 2 — verified via the real device instead, not skipped) |
| 3 | **Fresh registration, live on the real R1** | Generated a real pairing code via `pnpm --filter api pairing:generate`, typed it into the actual device, submitted → `POST /devices` → `201` in the API log → app transitioned from `PairingScreen` to the main Tasks screen |
| 4 | **Token persistence across a real app restart** | Force-stopped and relaunched the app via `adb`; it went straight to the Tasks screen with no re-pairing prompt, confirming `expo-secure-store` correctly persisted and was read back on cold start |
| 5 | **Primary-device selection, live** | Tapped "Set as primary reminder device" in Settings; the `PRIMARY` badge appeared and the button correctly disappeared, backed by a real `POST /devices/:id/primary` → `200` in the API log |
| 6 | **Device notification settings, live** | Toggled the Digests switch; confirmed a real `PATCH /devices/:id` → `200` in the API log and the toggle visually reflecting the new state after TanStack Query's invalidation refetch |
| 7 | KEY_POWER / scroll-wheel spikes | See above — both conclusively negative, recorded honestly rather than assumed |

The registered device (`rabbit r1`, this session's real pairing) was left in place — it is the actual working credential for continued Phase 3 work on this unit, not disposable test data, matching how the user's real AI-provider configuration was left in place after Phase 1's verification.

### Known items / not yet resolved

- The current local Android package is **`com.himal.personalos`**. No EAS build or store-distribution decision has been made; local verification continues through `expo run:android`.
- **No Expo/EAS account is logged in** (`eas-cli whoami` → "Not logged in", checked read-only, no login attempted). Neither this nor the package-name gate blocked anything this checkpoint; both remain open items for whenever an EAS-based build actually becomes necessary.
- A minor, non-blocking React warning ("Can't perform a React state update on a component that hasn't mounted yet") appears once during the pairing → main-app transition — functionally harmless (every subsequent action verified working correctly); most likely `PairingScreen` unmounting immediately after its mutation resolves. Not chased down further — doesn't affect any required behavior.

## Phase 3 Checkpoint 4: PTT + notifications + reboot survival (COMPLETE, 2026-08-18)

Implementation began only after explicit user approval. Production was not accessed or modified. No migration was added or changed.

### What is implemented

1. **Local reminder reconciliation:** the primary Android device pages through all inbox/active tasks, schedules future `remind_at` values locally, and diffs against the OS-owned schedule. Task edits replace stale alarms; done, dropped, archived, or absent tasks cancel them. Reconciliation is serialized, refreshes on foreground and polling, preserves already-scheduled alarms during ordinary API/Tailscale outages, and cancels Personal-OS-owned alarms on authoritative revocation, lost identity, disabled notifications, or loss of primary status. Exact-alarm capability is stored with each schedule so a permission change forces replacement rather than leaving an inexact alarm in place.
2. **Notification lifecycle:** Android channel and permission setup are platform-guarded; foreground notifications use an explicit handler; notification taps route task payloads to the task detail screen; TanStack Query follows native foreground/background focus. Settings include exact-alarm, local-delivery, reboot, push-token, remote-test, and outbox diagnostics. The API adds a self-only `POST /devices/:id/test-notification` endpoint targeting exactly that device.
3. **Reboot survival:** the planned early physical-device test passed with Expo Notifications' built-in mechanism. A two-minute reminder was scheduled, the Rabbit rebooted, Personal OS was not opened, `BOOT_COMPLETED` caused the stored exact alarm to be restored, and the notification fired. The conditional custom BroadcastReceiver/Headless JS fallback was therefore correctly not added.
4. **Capture outbox:** quick-add now persists to SQLite before the first HTTP attempt, retains the same `client_uuid` across retries/restarts, applies persisted exponential backoff, separates permanent client failures from retryable failures, and exposes pending/needs-attention counts. Startup, connectivity changes, foregrounding, and a bounded interval trigger flushing; public-internet reachability is deliberately not treated as authoritative for the private Tailscale API. A web localStorage implementation preserves the universal Expo web build.
5. **PTT state machine:** touch-driven `expo-audio` recording has guarded start/stop transitions, a two-minute cap, AppState/unmount cleanup, stable retry identity/audio, non-overlapping bounded polling, and distinct preparing/recording/stopping/uploading/transcribing/done/failed states. Expo SDK 57 requires an `expo-file-system` `File`/Blob multipart part; its fetch implementation intentionally rejects the older React Native `{uri,name,type}` shape, and the real-device upload now uses the supported path.
6. **Transcription confidence and confirmation push:** `ptt.transcribe` persists mean `avg_logprob`; low-confidence PTT transcripts join the existing parse-confidence signals. A durable `needs_confirm` row enqueues `notifications.dispatch` with an Inbox payload and stable dedupe key, including on retry after a crash between the row update and enqueue.
7. **Dispatch correctness:** queue definitions are identical in API and worker startup (including dead-letter linkage), terminal failed targets are not resent, `MessageRateExceeded` is retryable, missing Expo tickets remain pending, and diagnostics can target one device. Expo Push tokens receive structural validation. Automatic token registration runs at startup/foreground and awaits server persistence.
8. **Rabbit small-screen fix:** quick capture now respects keyboard and bottom safe-area insets. Before the fix, CipherOS rendered the Capture button inside the untappable system area; afterward it moved into the reachable 480×640 content area and the offline capture succeeded physically.
9. **Web/native compatibility:** SecureStore and SQLite have web storage adapters, notification APIs are web-guarded, and the exact-alarm module has an iOS stub. A production-mode Expo web export succeeds.

### Verification actually run so far

| Check | Result |
|---|---|
| Android debug native build | Successful on the physical Rabbit R1, including `expo-crypto` and `expo-file-system` native modules |
| Foreground local notification | Fired as an exact `RTC_WAKEUP`; visible while Personal OS remained foregrounded |
| Reboot protocol | Passed without reopening Personal OS; Expo's built-in boot restoration rescheduled and delivered the alarm |
| PTT record/upload/poll | Physical touch start/stop and retry states worked; SDK-57 multipart upload reached `/transcribe`; with no local STT route, the worker's deliberate terminal failure rendered “Transcription failed” rather than a network error or indefinite spinner |
| Offline outbox restart/replay | With API reachability removed: saved offline → force-stop/restart → Settings showed one pending capture. Restoring reachability flushed to zero and Inbox showed “Offline outbox checkpoint” exactly once |
| Exact-alarm bridge | The ROM's package/app-op reports are internally inconsistent, but actual scheduled alarms carry Android's exact-permission reason and deliver exactly; runtime behavior is the deciding evidence |
| Automated workspace gate | Build, typecheck, and lint pass. 200 tests pass when DB-backed API and worker packages are serialized; the root test command now enforces this because both suites intentionally share `personalos_test` |
| Formatting | `pnpm format:check` passes |
| Web regression | `expo export --platform web` succeeds |

### Checkpoint 4 hardening follow-up (2026-08-17)

Implemented only the four post-audit hardening items approved after commit
`76b314c`: the PTT lifecycle effect now explicitly restores its mounted ref
when mounted (including StrictMode development effect re-invocation); direct
deferred-promise concurrency tests prove reminder reconciliation and capture
outbox operations remain serialized, preserve call order, execute exactly once,
and continue after an earlier operation fails; reminder reconciliation now
self-heals duplicate Personal OS alarms by retaining exactly one matching alarm
and cancelling only the owned extras; and the temporary
`inbox_items.confidence` PTT `avg_logprob` handoff semantics plus the future
dedicated-field cleanup are documented without a migration or routing change.

Verification for this follow-up: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, and the full serialized `pnpm test` suite all pass (200
tests total, including 22 mobile tests). `pnpm --filter mobile exec expo export
--platform web` succeeds. The touched native PTT/notification paths warranted
an Android check, and `./gradlew assembleDebug` succeeds with JDK 17 (489 tasks;
only existing Gradle deprecation notices and cross-volume hard-link fallbacks).
No credentials were configured, no migration was added, production was not
accessed, and no later checkpoint work began.

### Real `voice_transcribe` STT gate — CLOSED (2026-08-17)

Verified against a real Groq account on **local development only** (production
untouched, nothing deployed, no migration). The user enabled
`whisper-large-v3-turbo` and `openai/gpt-oss-20b` on the Groq project
mid-session after both were initially blocked at the project level.

Configured through the existing `/ai/providers` → `/ai/models` →
`/ai/task-routes` endpoints and the existing AES-256-GCM credential
encryption — no direct database writes, no key in `.env`, the repository, or
any log. Non-secret identifiers: provider `09016fd3-081c-46e6-8c61-8a74bb84693c`
(`openai_compatible`, `https://api.groq.com/openai/v1`); models
`496bf3e9-52ff-4c89-a6f4-164c69d294f3` (`whisper-large-v3-turbo`) and
`153271de-b227-4a87-bc57-6209d27ffed2` (`openai/gpt-oss-20b`); routes
`1020f76b-ce2d-46a7-a876-91ac40bd3767` (`voice_transcribe`) and
`cd2d8104-10d6-415e-9e19-e772f2558c51` (`capture_parser`), both with no
fallback. Credential-safety re-checked after configuration: the stored row is
real AES-256-GCM (56B ciphertext / 12B IV / 16B auth tag) and does not contain
the plaintext in any encoding; `GET /ai/providers` exposes no key material; no
local log, tracked file, or untracked repo file contains the key.

**Five real captures were run on the physical Rabbit R1**, driven through the
device's actual microphone (speech played acoustically into the unit), not by
injecting an audio file. The complete path was exercised: R1 mic → `expo-audio`
→ multipart `POST /transcribe` → persisted temporary audio → `ptt.transcribe` →
real Groq `whisper-large-v3-turbo` → transcript + `avg_logprob` → `capture.parse`
→ real `openai/gpt-oss-20b` → entity or `needs_confirm`.

| Capture | Transcript (real) | `avg_logprob` | Outcome |
|---|---|---|---|
| clear task | " Remind me to call the insurance company tomorrow at 3 p.m." | **-0.1592956** | `parsed` → task "Call insurance company", `remind_at` 2026-08-18T20:00Z (3pm CDT — DST-correct) |
| note-shaped | " . Idea, build a weekly review dashboard for the home server." | (overwritten) | `needs_confirm`, flag `typeAmbiguous` — the two temperature-0.3 samples genuinely disagreed; parsed as `create_note` |
| gibberish | " The Farris Quandary Bramblewick 16 Thistle Apparatus Mumble…" | (overwritten) | `needs_confirm`, flag `modelUnclear` (`unclear` tool) |
| near-silent | " ." | (overwritten) | `needs_confirm`, flag `modelUnclear` |
| quiet task | " Remind me to buy printer paper on Thursday afternoon." | **-0.21939197** | `parsed` → task "Buy printer paper" |

`avg_logprob` **is** returned by `whisper-large-v3-turbo` and is genuinely
propagated: on the last capture the raw value was observed in
`inbox_items.confidence` while the row was still `pending` (before
`capture.parse` ran) and survived unchanged into `parsed`, which is exactly the
temporary-overload behaviour documented for that column. Rows routed to
`needs_confirm` have it overwritten with `0`, also as documented.

Also verified per capture: audio cleanup succeeded (`audio_path` cleared and
`/tmp/personal-os-audio` empty after every capture), no duplicate Inbox row was
produced (zero `client_uuid` collisions across all PTT captures), and a
confirmation `notifications.dispatch` job was enqueued and completed for a
`needs_confirm` capture — writing no `notification_dispatch_log` rows because
the device still has no push token, which is the correct no-eligible-target
behaviour rather than a failure.

**Observed MIME chain** (the previously identified residual risk, resolved by
observation rather than by a speculative change):

| Stage | Observed value |
|---|---|
| Rabbit recording | `.m4a` (expo-audio `RecordingPresets.HIGH_QUALITY`, Android `mpeg4`/`aac`) |
| `expo-file-system` `File.type` | a MIME the API maps to `.mp3`, i.e. `audio/mpeg` (Android `MimeTypeMap`'s mapping for `.m4a`); `audio/mpeg` and `audio/mp3` are indistinguishable from the stored extension alone |
| multipart file MIME | as above |
| multipart original filename | `"audio"` — expo's `File` implements `Blob` but exposes no `name`, so `transcribe.ts`'s `file.name ?? "audio"` fallback applies |
| API-selected storage extension | `.mp3` |
| stored temporary filename | e.g. `daaa840f-da00-486c-9ef0-c6bea2639da9.mp3` |
| worker-derived MIME | `audio/mpeg` (from `.mp3`) |
| filename/MIME sent to Groq | `<uuid>.mp3` + `audio/mpeg` |

The feared `.bin` outcome did **not** occur. The bytes are MPEG-4/AAC but are
labelled `.mp3`/`audio/mpeg` end to end, and Groq's Whisper endpoint accepted
and transcribed them correctly on every capture — it decodes by content, not by
the declared extension. No MIME/extension fallback was implemented, because
nothing failed; per the standing instruction, a speculative change was not made.
This remains a latent fragility worth revisiting only if a future STT provider
validates by extension.

Two further real observations, neither requiring a code change:

- The first capture's Groq request hit a transient IPv6 connect timeout
  (`UND_ERR_CONNECT_TIMEOUT` against `2a06:98c1:...:443`) on a dual-stack path.
  pg-boss retried and the second attempt succeeded, which incidentally proved
  the transcription retry path, the fact that source audio is preserved across a
  failed attempt, and that the retry produced no duplicate Inbox row.
- Because that retry pushed end-to-end latency past 60s, the PTT button's
  bounded polling reported "Transcription is taking longer than expected" for a
  capture that had in fact succeeded server-side. The row was durable and
  correct throughout; this is the implemented bounded-polling policy behaving as
  designed, not data loss, but the wording can read as failure.

The parser leg was also exercised for real: `openai/gpt-oss-20b` produced
correct tool calls and DST-correct datetimes. One accuracy miss worth recording
honestly — "Thursday afternoon" resolved to Wednesday 2026-08-19 rather than
Thursday 2026-08-20. That is model quality, not a pipeline defect, and no
confidence signal flags it because a date *was* resolved.

Not exercised, reported honestly: the `lowTranscriptionConfidence` routing
threshold (`avg_logprob < -0.8`) was never reached across five real captures.
`whisper-large-v3-turbo` stayed confident even on deliberately quiet, fast and
nonsense audio (worst observed `-0.219`), and audio degraded far enough to score
worse instead produced text the parser terminated as `unclear` first — a branch
that returns before the transcription-confidence signal is computed. The signal
itself is verified by `packages/core`'s unit tests; with this provider the
`-0.8` threshold appears effectively unreachable in practice.

### Real Expo Push gate — CLOSED (2026-08-18)

Verified on the physical Rabbit R1 against real Firebase/FCM V1 credentials.
Local development only: production was never accessed, nothing was deployed, no
migration was added, and no unrelated secret was rotated.

**Configuration.** Firebase project `personal-os-196cf` (project number
`868049601968`); Android app registered against the confirmed permanent package
`com.himal.personalos` (mobilesdk app id
`1:868049601968:android:bbaaedd77bfc0417a10275`). `google-services.json` is
placed at `apps/mobile/google-services.json`, referenced by
`android.googleServicesFile`, and **git-ignored** — Google formally treats it as
non-secret since it ships inside the APK, but it embeds a Google API key, so it
is excluded as defense in depth consistent with this repo's posture. Prebuild
copies it to `android/app/` and applies `com.google.gms.google-services`.

The FCM V1 **service-account key** was uploaded by the user directly from their
own terminal via `eas credentials` → Android → Google Service Account → *Manage
your Google Service Account Key for Push Notifications (FCM V1)*, so the private
key never passed through this session, the repository, or any log. EAS reported
`Google Service Account Key assigned to com.himal.personalos for FCM V1`. The
EAS project is `@himal_pok/mobile` (`b704be80-5b01-411e-9239-fa0cea642783`).
No Android upload keystore was created: the browser wizard demands one, but the
CLI path does not, and local `expo run:android` builds are signed with Android's
own debug keystore, so a keystore would have been an unnecessary credential.

**Rebuild was mandatory and performed.** `google-services.json` is compile-time
native configuration, so the previously installed build could not acquire FCM
under any runtime action. Full `expo prebuild --clean` + local native build +
install on the R1. After it, logcat shows `FirebaseApp initialization
successful` — the previous blocker (`Default FirebaseApp is not initialized`)
is gone.

**A real, non-obvious failure was diagnosed rather than misattributed.** The
first token attempt after the correct rebuild still failed, with
`FirebaseMessaging: Failed to get FIS auth token` /
`java.io.IOException: SERVICE_NOT_AVAILABLE`. This was **not** an FCM or
CipherOS limitation: `dumpsys connectivity` reported `Active default network:
none` and `ping` returned `Network is unreachable`. The R1's Wi-Fi had been left
disabled since the Checkpoint 3 hardware spike, so the device reached the API
only through `adb reverse` port tunnels and had no route to
`firebaseinstallations.googleapis.com`. Enabling Wi-Fi (it auto-joined a saved
network; 9.7 ms to 8.8.8.8) resolved it immediately.

**CipherOS GMS support is confirmed, not assumed:** `com.google.android.gms`
(Play Services **26.30.32**), `com.android.vending` and
`com.google.android.gsf` are all installed and enabled. The earlier open
question about whether this community ROM could support FCM is answered
affirmatively by real delivery.

**Real ExpoPushToken acquired and persisted.** Device row
`15017e8f-ddc0-4aa0-aa57-67ad808482b1` holds a token matching
`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$` (41 chars), written through the
existing self-only `POST /devices/:id/push-token` endpoint. The full token is
deliberately not recorded here.

| # | Test | Expo request | Ticket | `notification_dispatch_log` | Physically received | Presentation |
|---|---|---|---|---|---|---|
| 1 | Self-targeted diagnostic (`POST /devices/:id/test-notification`, `deviceId` targeting) | attempted | `01a0133c-532e-71ec-a43a-8f6c33b4f05c` | `accepted` | **yes** — "Personal OS test / Remote notifications are configured for this device." | **foreground** (app open on Settings; presented via `setNotificationHandler`) |
| 2 | Real `notifications.dispatch` worker path | exercised by both rows below/above — test 1 via explicit `deviceId`, test 3 via category fan-out with no `deviceId` | — | — | — | — |
| 3 | Real capture → `needs_confirm` → confirmation push | attempted | `01a0133d-a3ad-7798-…` | `accepted` | **yes** — "Capture needs confirmation / asdf qwerty zzz" | **background** (app backgrounded via HOME) |

Dispatch health across the session: 7 `notifications.dispatch` jobs, all
`completed`, zero retries and zero failures; 2 dispatch-log rows, both
`accepted` with a ticket and no `last_error` — per-device dedupe produced no
duplicate sends. Per ADR-030 the ticket only proves Expo accepted the request;
the physical receipt above is the actual happy-path evidence, and it was
obtained for both foreground and background.

**Honest gaps recorded, not fixed in this gate:**

- **Confirmation notifications are inert on tap.** `capture-parse.ts` publishes
  `data: { inboxId }`, but `use-notification-lifecycle.ts` routes only on
  `data.taskId`. Tapping a confirmation notification brings the app forward but
  navigates nowhere. Local *reminder* notifications do carry `taskId` and route
  correctly, so this affects the confirmation category only. Deliberately not
  changed here: choosing the destination is a product decision, and there is no
  `inbox/[id]` route today — only the Inbox tab.
- Logcat notes `Missing Default Notification Channel metadata in
  AndroidManifest. Default value will be used.` Delivery is unaffected;
  `expo-notifications`' `defaultChannel` plugin option would silence it.

### Still open before Checkpoint 4 can be called complete

Nothing. Both credential-dependent gates are now closed. Checkpoint 5 still owns
the complete lifecycle matrix (foreground/background/swiped-away/Force-Stop),
revoke/security-boundary recheck, and any fixes that matrix finds — that is
Checkpoint 5 scope, not an open Checkpoint 4 item.

## Blockers / user-provided items

**Phase 3 Checkpoint 4:** none — both credential-dependent gates are closed. Firebase (`personal-os-196cf`) and the EAS FCM V1 service-account credential are configured, and a real Groq `voice_transcribe`/`capture_parser` route is configured, **both in local development only**. Production has neither the Groq configuration nor the Firebase configuration; provisioning production is a separate, deliberate step that has not been taken.

Phase 0–2: none. Phase 2 is complete with no open blockers. The real-OpenAI-key step from Phase 1 is done — see "Phase 1 real-LLM verification" above (provider registered by the user directly via curl, per this repo's rule against Claude handling raw API keys itself; Claude ran the verification captures afterward, which don't involve credential material).

Intel i5 production server access was provided and used for Phase 0 and Phase 1 (native Ubuntu 26.04 LTS, hostname `personal-os`). No backup system in the current architecture (ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected, not currently blocking anything:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (no repo-committed secrets require it yet)
- Apple Developer account — not required until native iOS work

## Current work

Phase 0, Phase 1, and Phase 2 are complete. Phase 3 Checkpoints 1–4 are complete, including both credential-dependent gates (real Groq STT and real Expo Push), all verified on the physical Rabbit R1 in local development. Checkpoint 5 — the real-device lifecycle verification matrix — is underway. No production deployment has occurred; Checkpoint 6 and Phase 4 remain out of scope.

## Remaining warnings / technical debt

- **Runtime images aren't pruned of devDependencies.** `apps/api`/`apps/worker`'s Dockerfiles copy the entire built workspace into the runtime stage rather than a slim production-only `node_modules` — a deliberate Phase 0 "correctness over image size" tradeoff, documented in the Dockerfiles themselves. Worth revisiting before this matters (larger attack surface, slower deploys as the repo grows).
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval, now done — noting it here since it wasn't obvious in advance from `tailscale status` alone (`CertDomains` was empty beforehand) and the CLI's own consent-URL flow is what actually resolved it, not a pre-configured admin console setting.
- **`docs/PHASE-0-CHECKLIST.md` section E (Tailscale/network foundation)** items are now substantively done (Tailscale installed+authenticated, MagicDNS confirmed working, Serve configured, Postgres inaccessible as a public service) but the checklist file's checkboxes themselves weren't individually ticked in this pass — worth a follow-up pass to mark them, or treat this STATUS.md entry as the record of evidence.
- No SOPS/age key has actually been generated — remains available but unused, since no secret currently needs to live in the repo.
- **The web app's `EXPO_PUBLIC_API_URL` is baked in at Docker build time**, not read at runtime — changing the API's public URL later means rebuilding the `web` image, not just restarting the container or editing `.env`. Documented in `apps/mobile/Dockerfile` and accepted as reasonable for a single-deployment personal app in the Phase 2 plan.
- **Mobile UI still has no component/E2E harness**, but it now has 22 focused unit tests covering reminder diff/scheduling and durable-outbox behavior. Native lifecycle and small-screen behavior are verified on the physical Rabbit rather than simulated.
- **A minor non-blocking React warning** ("Can't perform a React state update on a component that hasn't mounted yet") appears once during the Checkpoint 3 pairing → main-app transition — functionally harmless, not chased down (see "Phase 3 Checkpoint 3" above).
- **`apps/api`/`apps/worker` runtime images still aren't pruned of devDependencies** (unchanged from Phase 0/1 — see the entry above); Phase 2's new `apps/mobile/Dockerfile` follows a different, already-minimal pattern (only the static `dist/` output plus a fresh `serve` install in the runtime stage), so this only remains relevant to the two original images.

## Last verification

Real `voice_transcribe` STT gate verification (2026-08-17) — see "Real `voice_transcribe` STT gate — CLOSED" above: a real Groq provider/model/task-route configured in local development through the existing encrypted-credential endpoints, and five real captures driven through the physical Rabbit R1's actual microphone, each exercising R1 mic → `expo-audio` → multipart `POST /transcribe` → persisted temporary audio → `ptt.transcribe` → real Groq `whisper-large-v3-turbo` → transcript and real `avg_logprob` (observed values `-0.1592956` and `-0.21939197`) → `capture.parse` → real `openai/gpt-oss-20b` → committed task or `needs_confirm` with real confidence flags (`typeAmbiguous`, `modelUnclear`). Audio cleanup, no-duplicate-Inbox-row, retry-without-duplication, and confirmation-dispatch enqueue all verified per capture; the full MIME chain was recorded and the feared `.bin` storage outcome did not occur. No application code required changes, so none were made. Not verified and not claimed: real Expo Push delivery (missing Firebase/FCM configuration), the `lowTranscriptionConfidence` routing threshold (never reached by real Groq audio — see above), full Checkpoint 5 lifecycle matrix, or any Phase 3 production deployment.

Phase 3 Checkpoint 4 in-progress verification, including the post-`76b314c` hardening follow-up, is passing for every non-credential gate (2026-08-17) — see the Checkpoint 4 section above: workspace build/typecheck/lint/format clean; 200 tests passing, including direct serialization and duplicate-repair coverage; Expo web export successful; Android debug build successful; physical Rabbit verification of foreground exact delivery, unattended reboot survival, SDK-57 PTT upload and terminal-failure UI, small-screen quick-capture safe-area behavior, and SQLite outbox persistence/replay across a force-stop restart.

Phase 3 Checkpoint 3 verification, run and passing (2026-08-17) — see "Phase 3 Checkpoint 3" above for the full 7-item table: workspace-wide build/typecheck/lint/format clean (after fixing two real, previously-latent bugs the first-ever native build surfaced — a stale `babel-preset-expo` version and Hermes's missing `Intl.supportedValuesOf`), 165 tests passing (unchanged count, no new automated coverage this checkpoint by design), and — the strongest evidence — a full live registration → SecureStore-persistence-across-restart → primary-device-selection → notification-settings cycle run directly on the physical Rabbit R1, plus the KEY_POWER and scroll-wheel hardware spikes, both run live on the same device with a 90-second logcat capture and recorded as conclusively negative rather than assumed either way.

Phase 3 Checkpoint 2 verification, run and passing (2026-08-16) — see "Phase 3 Checkpoint 2" above for the full 4-item table: workspace-wide build/typecheck/lint/format clean (after fixing an arrow-function-as-constructor bug in a test mock and two ESLint issues), 165 tests passing workspace-wide (41 new), the worker booting cleanly with both dead-letter queues correctly created before their primary queues (zero FK errors), and — the strongest evidence — a full live `POST /transcribe` → worker → graceful-degradation cycle run with real curl and a real audio file against a real running server, including live `client_uuid` dedupe. Explicitly **not** verified: the real Groq/STT transcription happy path and real Expo push delivery, since no `voice_transcribe` provider or real device push token exists in this environment yet — both require credentials only the user can supply. All test data deleted afterward; both servers stopped.

Phase 3 Checkpoint 1 verification, run and passing (2026-08-16) — see "Phase 3 Checkpoint 1" above for the full 6-item table: workspace-wide build/typecheck/lint/format clean, migration applied and permission-re-checked against both dev and test Postgres, 129 tests passing workspace-wide (19 new), and — the strongest evidence — a full live pairing/registration/auth/revoke cycle run with real curl against a real running server, including proving the security-boundary claim (revoking a device blocks device routes but leaves the existing Tailscale-only API surface, exercised directly via `/tasks`, completely unaffected). All test data deleted from the dev database afterward.

Phase 2 mobile UI + production deployment verification, run and passing (2026-08-16) — see "Phase 2 mobile UI + production deployment" above for the full 14-item table: local production-mode SPA build verified (`serve -s dist`, direct load/refresh/fresh-tab deep-link all correct), production deployment verified (all 4 containers healthy, port/security audit clean, user's real AI-provider config confirmed intact throughout including through an unintended-but-harmless `postgres` container recreation), and — the strongest evidence — a full lifecycle cycle (create → deep-link view → refresh → archive; and separately inbox → activate → complete → archive) run in a real browser against live production data over real Tailscale HTTPS, each transition confirmed both visually and via a follow-up database check. `pnpm build`/`typecheck`/`lint`/`format:check` all clean workspace-wide afterward (now genuinely including `apps/mobile`, which previously had no `typecheck` script at all). All test data deleted from both dev and production databases afterward; the user's real AI-provider configuration was left untouched in production throughout.

Phase 2 backend implementation verification (2026-08-16) remains valid — see "Phase 2 backend implementation" above: `pnpm build`/`typecheck`/`lint`/`format:check` clean workspace-wide, migration `0003` applied and permission-re-checked against dev Postgres, live curl verification of every new endpoint, and the two-part `expand-due-date-window` regression fix (dropped and archived recurring tasks each independently confirmed to generate zero new occurrences, contrasted against a still-active control that generated 12) — plus, added afterward, 33 new automated tests across `apps/api`/`apps/worker`/`packages/api-client` covering the same ground with real assertions instead of manual curl transcripts.

Phase 1 real-LLM verification, run and passing (2026-08-15) — see "Phase 1 real-LLM verification" above: a real OpenAI key registered, two real bugs found via `pgboss.job` error inspection (not assumed) and fixed, then a task/note/event/unclear capture each re-verified auto-committing (or correctly routing to `needs_confirm`) with correct DST-safe datetime resolution, read back directly from the `tasks`/`events` rows against production Postgres. `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (workspace-wide, 55 tests) all re-confirmed clean after the fixes, before redeploying.

Phase 1 production deployment verification (2026-08-15) remains valid — see "Phase 1 production deployment" above for the full 14-item table, including the DST-crossing and completion-anchored recurrence tests, the duplicate-prevention safety net, credential encryption, and restart behavior, all run against the live `personal-os` deployment over real Tailscale HTTPS. gitleaks confirmed clean on every Phase 1 commit; production `.env` (holding the real `CREDENTIALS_ENCRYPTION_KEY`) confirmed untouched by `rsync` (size/mtime/md5 unchanged) and still `chmod 600` throughout.

Phase 1 Mac-dev verification (2026-08-15) remains valid — see "Phase 1 implementation" above.

Phase 0's last verification (2026-08-15) remains valid — see the Production deployment table above for the full list, including the full OS reboot test (#12) and its post-reboot HTTPS `/health` check from the Mac.

## Phase 0: complete

All exit criteria in `docs/PHASE-0-CHECKLIST.md` are met: the foundation is reproducible (Mac dev + production both verified independently), security boundaries are in place (least-privilege DB roles verified to reject DDL, Postgres unpublished everywhere, gitleaks active, API scoped to localhost/Tailscale-only), and this file documents the evidence. There is no backup or restore requirement (ADR-024). The one remaining housekeeping item — individually ticking `docs/PHASE-0-CHECKLIST.md`'s checkboxes, left untouched throughout this project in favor of this file as the evidence record — does not block Phase 0 completion.

## Phase 1: complete, deployed to production, verified end-to-end with a real LLM

Every Phase 1 deliverable in `docs/ARCHITECTURE.md` is implemented, verified on Mac dev, deployed to production (`personal-os`), and now verified against a real OpenAI key end-to-end — data model, recurrence engine (both anchors), provider-agnostic AI layer, capture/inbox/occurrence/AI-config API routes, the three new worker jobs, and the LLM-parsing happy path itself (task/note/event/unclear classification, DST-safe datetime resolution, confidence routing). No remaining implementation, deployment, or verification gaps.

## Phase 2: complete, deployed to production, verified end-to-end in a real browser

Every Phase 2 deliverable is implemented, verified on Mac dev, deployed to production (`personal-os`), and verified end-to-end against the live deployment in a real browser over real Tailscale HTTPS — quick-add box, inbox triage, task list with full lifecycle (inbox → active → done/dropped, independent archive axis), notes, project view, all backed by full manual CRUD (not just AI capture), soft-delete/archive semantics, TanStack Query live-updating the UI with no manual refresh, and an always-on production web deployment with correct SPA-fallback routing on its UUID-keyed dynamic routes (direct load, refresh, and fresh-tab deep link all confirmed against live production data). Four real bugs were found and fixed by actually running the app rather than assumed safe from source review — see "Phase 2 mobile UI + production deployment" above. No remaining implementation, deployment, or verification gaps. Phase 3 does not begin until the user explicitly approves it separately.

## Next action

Run Checkpoint 5's complete real-device lifecycle/security matrix on the physical Rabbit R1: the five lifecycle states (foreground, background, swiped-away, reboot, Force Stop), the primary-device and revocation/re-pair matrix, the task/reminder eligibility matrix, foreground/background synchronization, the offline-capture matrix, the PTT lifecycle, real remote push in both foreground and background, network-transition permutations, small-screen UX, and a web regression pass — fixing genuine defects it surfaces. Do not deploy, do not begin Checkpoint 6, and do not begin Phase 4.

Optional further confidence-building left over from Phase 1 (not required to consider Phase 1 done, still open): the full ~50-capture pass from `ARCHITECTURE.md`'s Phase 1 description, and registering a second, different provider type to prove the abstraction isn't secretly single-vendor.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
