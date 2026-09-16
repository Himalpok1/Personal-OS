# Personal OS — Agent Instructions

This repository is the implementation workspace for **Personal OS**, a single-user, self-hosted life dashboard.

## Required reading before any work

Read these files in this order:

1. `docs/ARCHITECTURE.md`
2. `docs/DECISIONS.md`
3. `docs/STATUS.md`
4. `docs/WORKFLOW.md`

Do not begin implementation until you understand the locked decisions and current phase.

**`docs/STATUS.md` is present state only.** It carries the open phase's checkpoint record, the open
debt ledger and the next action — nothing closed. Closed-phase records live in
`docs/history/phase-0.md` … `phase-9.md`, verbatim and unaltered; read a phase file only when you
need the detail behind a completed checkpoint, never by default.

**`docs/DECISIONS.md` is an index** — one line per ADR. The full, verbatim text of each decision is in
`docs/decisions/ADR-NNN.md`; open one only when the index line is not enough. `docs/PHASE-0-CHECKLIST.md`
is a closed Phase 0 artifact and is not required reading.

## Locked architecture

The canonical source is `docs/ARCHITECTURE.md`.

Key constraints:

- Standalone rebuild.
- One universal Expo + Expo Router client for iOS, Android, and web.
- TypeScript backend using Fastify.
- PostgreSQL with Drizzle ORM.
- Separate `apps/worker` process for background work.
- pg-boss for the Postgres-backed job queue.
- One monorepo with shared Zod schemas.
- Tailscale-only network access for the MVP.
- The app is the system of record.
- Offline support is an outbox for writes, not full bidirectional offline sync.
- The first functional module is capture: notes, reminders, tasks, events, and voice.
- The project is phase-gated: a checkpoint is not started until the previous one is complete,
  verified and explicitly approved. `docs/STATUS.md` states the current phase and what is approved.

Do not silently replace or reinterpret these decisions.

## Repository layout

This is the layout as it exists today, not a plan (verified against the tree 2026-09-16).

```text
apps/
  mobile/              # Expo Router: iOS, Android, web
  api/                 # Fastify HTTP API only
  worker/              # pg-boss workers, cron, polling

packages/
  schema/              # Zod schemas + inferred TypeScript types
  db/                  # Drizzle schema, migrations, DB connection factory
  api-client/          # typed, framework-agnostic API client
  core/                # recurrence/date math, parsing helpers, shared domain logic
  ai-providers/        # Vercel AI SDK adapters + AES-256-GCM credential crypto (Phase 1)
  calendar-providers/  # Google Calendar + CalDAV clients (Phase 4)
  health-providers/    # Google Health catalog, OAuth, client, sync (Phase 6)
  mail-providers/      # Gmail catalog, OAuth, metadata-only client (Phase 7)
  monitoring/          # probes, thresholds, incident state machine (Phase 7)
  canvas-providers/    # Canvas LMS read-only client + SSRF guard (Phase 10)

docs/
  ARCHITECTURE.md          # canonical architecture
  DECISIONS.md             # ADR INDEX — one line per decision
  decisions/ADR-NNN.md     # full verbatim text of each ADR, on demand
  STATUS.md                # PRESENT STATE ONLY (see history/)
  AGENT-READINESS.md       # canonical service-boundary inventory (10.0)
  WORKFLOW.md
  SOURCE-DURABILITY.md     # source-durability design; Option 2 still open
  SOAK-9.2.md              # owner-terminated adoption soak record
  PHASE-8-CLOSEOUT.md, CHECKPOINT-8.6*.md, SOAK-8.5.md   # closed Phase 8 companion records
  PHASE-0-CHECKLIST.md     # closed Phase 0 artifact
  history/                 # closed-phase records, verbatim, not auto-loaded, never edited
    phase-0.md … phase-9.md
    superseded-present-state.md
    superseded-present-state-2026-09-16.md

scripts/
  grant-pgboss-runtime.sql # runtime grants for the least-privilege app role
  soak/                    # read-only observer tooling from Checkpoint 9.2 (reusable)
```

`packages/db`, `packages/ai-providers`, `packages/calendar-providers`, `packages/health-providers`,
`packages/mail-providers`, `packages/canvas-providers` and `packages/monitoring` are **server-only** —
they import `pg`, `node:crypto` or another Node built-in and must never reach the Expo bundle. Only
`packages/schema`, `packages/api-client` and the client-safe subpaths of `packages/core` are
client-reachable.
`packages/core` is mixed: its barrel re-exports Node-only recurrence and device-auth modules, so
client-reachable code imports the deep subpaths its `exports` map exposes (`./timezone`,
`./recurrence/editor`, `./health/*`), never the barrel.

## Engineering rules

- TypeScript strict mode.
- Prefer small, explicit modules over large files.
- Business/domain logic must not live in React components.
- Shared validation belongs in `packages/schema`.
- Shared domain/date/recurrence logic belongs in `packages/core`.
- Database schema and migrations belong in `packages/db`.
- The Fastify API handles HTTP only. Slow, scheduled, retryable, or externally rate-limited work belongs in `apps/worker`.
- Queue jobs must be idempotent.
- Raw captures must be stored before LLM parsing.
- PostgreSQL must never be exposed publicly.
- The application DB role must be least-privilege; migrations use a separate role.
- Never commit real secrets.
- Never bake secrets into container images.
- Keep `.env.example` free of real credentials.
- Do not add Redis unless the architecture is explicitly changed by the user.
- Do not add a separate Next.js dashboard unless explicitly approved.
- Do not introduce a second source of truth for tasks/reminders/calendar data.

## Recurrence rules

Follow `docs/ARCHITECTURE.md` exactly:

- `due_date` recurrence may be pre-expanded into the rolling occurrence window.
- `completion_date` recurrence is lazy and generates only the next occurrence after completion/skip.
- Completion-anchored recurrence must not be pre-expanded.
- Preserve wall-clock time and timezone for recurring items.
- All-day events use dates, not timestamp-midnight hacks.

## Git and agent collaboration rules

- Inspect `git status`, current branch, and recent commits before modifying files.
- Never discard another agent's uncommitted work.
- Never rewrite or force-push shared history.
- Work in a focused branch/worktree when possible.
- Make small, descriptive commits.
- One agent may implement while another reviews.
- If asked only to review, do not edit files.
- If architecture appears inconsistent, stop and report it instead of improvising a new architecture.
- Update `docs/STATUS.md` after meaningful work — it is **present state only**. Append the
  checkpoint's own record there while the phase is open; closed-phase detail is archived to
  `docs/history/` when the phase closes. Never edit a file under `docs/history/`.

## Verification before declaring work complete

Run the relevant checks for the scope completed. At minimum, once the workspace exists:

- install succeeds
- formatting/linting succeeds
- TypeScript typecheck succeeds
- relevant tests pass
- affected services start successfully
- any database migration applies cleanly in a test/dev environment

Do not claim completion if you did not run the verification.

## Scope control

The project is phase-gated.

**`docs/STATUS.md` is the canonical statement of the current phase and of what is approved next. Read it before assuming scope.** This section states the rule; it does not track the phase number.

As of 2026-09-16: **Phases 0–9 are complete and production-deployed; production is at migration level 22.** Phase 8
closed under ADR-061 (`docs/PHASE-8-CLOSEOUT.md`, `docs/history/phase-8.md`); Phase 9 closed under
ADR-069 (`docs/history/phase-9.md`). **Phase 10 — Codebase Consolidation & Agent Readiness — is open:
Checkpoints 10.0, 10.1/10.1B, 10.1C and 10.2 are deployed** (production api, worker and web at
`b2c273b`, migration level 22; the Rabbit R1 on versionCode 25, built locally), and no checkpoint
after 10.2 is selected — the next product direction is an owner decision. Android APKs are built
locally with `eas build --local` (JDK 17 + Android SDK on the owner's Mac); the EAS build service is
no longer on the release path. Standing rules carry forward regardless of phase: read-only
intelligence before write-capable intelligence, no unrestricted full-content cloud egress, no pgvector
or Postgres image change without its own infrastructure ADR (ADR-056), every new alert producer
carries an occurrence-scoped dedupe key (ADR-058), and the API performs no background work inline —
the only synchronous model calls are the three ADR-approved, request-scoped reads (Brief, Ask,
Suggested Focus; see `docs/ARCHITECTURE.md` → *Background execution*).

Do not start the next checkpoint until the current one is complete, verified, and explicitly approved. Checkpoints marked with a stop are hard gates; for closed phases those markers are in the relevant
`docs/history/phase-N.md`.

If a task requires credentials, hardware access, Tailscale access, Google Cloud access, production access, or another user-only action, stop at the point where user input is needed and ask for it clearly.
