# Personal OS

Personal OS is a **single-user, self-hosted personal command center** for notes, reminders, tasks, calendar events, projects, finance, health, email summaries, service monitoring, ideas, voice capture, and a future AI layer.

The canonical design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Current state

The repository is at **pre-implementation / Phase 0 start**.

No later phase should begin until Phase 0 is complete, including a real backup restore test.

See [`docs/STATUS.md`](docs/STATUS.md).

## Core stack

- Expo + Expo Router — iOS, Android, web
- TypeScript
- Fastify
- PostgreSQL
- Drizzle ORM
- pg-boss
- Zod
- pnpm
- Turborepo
- Docker Compose
- Tailscale

## Intended monorepo layout

```text
apps/
  mobile/
  api/
  worker/

packages/
  schema/
  db/
  api-client/
  core/

docs/
  ARCHITECTURE.md
  DECISIONS.md
  STATUS.md
  PHASE-0-CHECKLIST.md
  WORKFLOW.md
```

## Important

This app will eventually hold sensitive personal data.

- Do not publish PostgreSQL.
- Do not commit secrets.
- Do not expose the application publicly for the MVP.
- Tailscale is the network perimeter.
- The app is the system of record.
- Backups are not considered complete until restore is tested.

## Starting the project

Open the repository in Claude Code or Codex and instruct the agent to read `AGENTS.md` and the files under `docs/` before making changes.

For Claude Code, `CLAUDE.md` imports the shared project instructions automatically.
