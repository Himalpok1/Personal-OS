# Project Status

**Project:** Personal OS
**Current phase:** Phase 1 — Capture core, headless
**Implementation status:** Phase 0 complete (see below). Phase 1 implementation complete and verified on the Mac dev environment (data model, packages/schema, packages/core recurrence engine, new packages/ai-providers, apps/api routes, apps/worker jobs) — see "Phase 1 implementation (2026-08-15)" below. Not yet deployed to production (`personal-os`). One user-only step remains: registering a real LLM provider API key via `POST /ai/providers` to exercise the actual LLM-parsing happy path end-to-end (everything up to that boundary is verified).
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
- [x] **Phase 1 implementation — data model, recurrence engine, provider-agnostic AI layer, API routes, worker jobs — done and verified on Mac dev.** Full details below.

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

**Not yet done:** production deployment of Phase 1 (still only verified on Mac dev); individually ticking `docs/PHASE-0-CHECKLIST.md`'s Phase 0 boxes (pre-existing housekeeping item, unrelated to Phase 1).

## Blockers / user-provided items

**Phase 1:** a real API key for at least one LLM provider (any of OpenAI/Anthropic/Kimi/GLM/xAI/Gemini/NVIDIA NIM/OpenRouter/LM Studio/custom), entered via `POST /ai/providers` + `POST /ai/models` + `POST /ai/task-routes` (`task_name: "capture_parser"`), needed to run the LLM-parsing happy path and the ~50-capture verification pass called for in `ARCHITECTURE.md`.

Intel i5 production server access was provided and used for Phase 0 (native Ubuntu 26.04 LTS, hostname `personal-os`). No backup system in the current architecture (ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected, not currently blocking anything:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (no repo-committed secrets require it yet)
- Apple Developer account — not required until native iOS work

## Current work

Phase 1 implementation is complete and verified on Mac dev, pending the user supplying a real LLM provider key for the final LLM-parsing verification pass, and pending a decision on whether/when to deploy Phase 1 to production (`personal-os`). Do not begin Phase 2 without separate explicit user approval.

## Remaining warnings / technical debt

- **Runtime images aren't pruned of devDependencies.** `apps/api`/`apps/worker`'s Dockerfiles copy the entire built workspace into the runtime stage rather than a slim production-only `node_modules` — a deliberate Phase 0 "correctness over image size" tradeoff, documented in the Dockerfiles themselves. Worth revisiting before this matters (larger attack surface, slower deploys as the repo grows).
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval, now done — noting it here since it wasn't obvious in advance from `tailscale status` alone (`CertDomains` was empty beforehand) and the CLI's own consent-URL flow is what actually resolved it, not a pre-configured admin console setting.
- **`docs/PHASE-0-CHECKLIST.md` section E (Tailscale/network foundation)** items are now substantively done (Tailscale installed+authenticated, MagicDNS confirmed working, Serve configured, Postgres inaccessible as a public service) but the checklist file's checkboxes themselves weren't individually ticked in this pass — worth a follow-up pass to mark them, or treat this STATUS.md entry as the record of evidence.
- No SOPS/age key has actually been generated — remains available but unused, since no secret currently needs to live in the repo.

## Last verification

Phase 1, run and passing (2026-08-15) — see "Phase 1 implementation" above for the full table, including the full-stack DST-crossing and completion-anchored recurrence tests and the graceful-failure-with-no-provider test, all run against the real running `apps/api`/`apps/worker` processes, not just unit tests. `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (workspace-wide, 51 tests) all clean. gitleaks confirmed `.env` (holding the real `CREDENTIALS_ENCRYPTION_KEY`) stays gitignored and untracked.

Phase 0's last verification (2026-08-15) remains valid — see the Production deployment table above for the full list, including the full OS reboot test (#12) and its post-reboot HTTPS `/health` check from the Mac.

## Phase 0: complete

All exit criteria in `docs/PHASE-0-CHECKLIST.md` are met: the foundation is reproducible (Mac dev + production both verified independently), security boundaries are in place (least-privilege DB roles verified to reject DDL, Postgres unpublished everywhere, gitleaks active, API scoped to localhost/Tailscale-only), and this file documents the evidence. There is no backup or restore requirement (ADR-024). The one remaining housekeeping item — individually ticking `docs/PHASE-0-CHECKLIST.md`'s checkboxes, left untouched throughout this project in favor of this file as the evidence record — does not block Phase 0 completion.

## Phase 1: implementation complete, one user step remaining

Every Phase 1 deliverable in `docs/ARCHITECTURE.md` is implemented and verified on Mac dev — data model, recurrence engine (both anchors), provider-agnostic AI layer, capture/inbox/occurrence/AI-config API routes, and the three new worker jobs — with the pipeline proven end-to-end up to the LLM call boundary. What's left is not implementation: (1) the user registers a real LLM provider key so the actual parsing happy path and the ~50-capture verification pass can run, and (2) a decision on deploying Phase 1 to production. Phase 2 does not begin until the user explicitly approves it separately.

## Next action

**Register a real LLM provider key** (`POST /ai/providers` → `POST /ai/models` → `POST /ai/task-routes` with `task_name: "capture_parser"`) so the LLM-parsing happy path can be verified, then decide on deploying Phase 1 to production. **Do not begin Phase 2 without explicit user approval** — this file being updated does not itself constitute that approval.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
