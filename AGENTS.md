# Personal OS — Agent Instructions

This repository is the implementation workspace for **Personal OS**, a single-user, self-hosted life dashboard.

## Required reading before any work

Read these files in this order:

1. `docs/ARCHITECTURE.md`
2. `docs/DECISIONS.md`
3. `docs/STATUS.md`
4. `docs/PHASE-0-CHECKLIST.md`
5. `docs/WORKFLOW.md`

Do not begin implementation until you understand the locked decisions and current phase.

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
- Phase 0 must pass before Phase 1 begins.

Do not silently replace or reinterpret these decisions.

## Planned repository layout

```text
apps/
  mobile/        # Expo Router: iOS, Android, web
  api/           # Fastify HTTP API only
  worker/        # pg-boss workers, cron, polling

packages/
  schema/        # Zod schemas + inferred TypeScript types
  db/            # Drizzle schema, migrations, DB connection factory
  api-client/    # typed, framework-agnostic API client
  core/          # recurrence/date math, parsing helpers, shared domain logic

docs/
  ARCHITECTURE.md
  DECISIONS.md
  STATUS.md
  PHASE-0-CHECKLIST.md
  WORKFLOW.md
```

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
- Update `docs/STATUS.md` after meaningful work.

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

**Current starting scope: Phase 0 only.**

Do not start Phase 1 implementation until every blocking Phase 0 item is complete.

If a Phase 0 task requires credentials, hardware access, Tailscale access, or another user-only action, stop at the point where user input is needed and ask for it clearly.
