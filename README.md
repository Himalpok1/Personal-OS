# Personal OS

Personal OS is a **single-user, self-hosted personal command center** for notes, reminders, tasks, calendar events, projects, finance, health, email summaries, service monitoring, ideas, voice capture, and a future AI layer.

The canonical design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Current state

Phase 10 (Codebase Consolidation & Agent Readiness) is open. Checkpoint 10.0 —
behavior-preserving cleanup and agent-readiness audit — and Checkpoint 10.1 — a
read-only Canvas LMS integration (courses/assignments sync, live-validated in
production) — are deployed and accepted; Checkpoint 10.1C (the Canvas reconnect
fix) is implemented and reviewed but not yet deployed. Phases 0–9 are complete;
per-phase records are archived in `docs/history/`. Production runs on a
Tailscale-only home server, with the mobile client on a physical Rabbit R1.
`main` is the canonical branch.

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

## Monorepo layout

```text
apps/
  mobile/
  api/
  worker/

packages/
  schema/              # shared Zod schemas
  db/                  # Drizzle schema, migrations
  api-client/          # typed API client
  core/                # shared domain logic
  ai-providers/        # AI SDK adapters + credential crypto
  calendar-providers/  # Google Calendar + CalDAV clients
  health-providers/    # Google Health catalog, OAuth, sync
  mail-providers/      # Gmail catalog, OAuth, metadata-only client
  monitoring/          # probes, thresholds, incident state machine
  canvas-providers/    # Canvas LMS read-only client

docs/
  ARCHITECTURE.md
  DECISIONS.md         # ADR index; full text in docs/decisions/
  STATUS.md            # present state only
  AGENT-READINESS.md   # service-boundary inventory
  WORKFLOW.md
  history/             # closed-phase records, verbatim
```

## Important

This app will eventually hold sensitive personal data.

- Do not publish PostgreSQL.
- Do not commit secrets.
- Do not expose the application publicly for the MVP.
- Tailscale is the network perimeter.
- The app is the system of record.
- No backup system in the current architecture — persistent Docker storage on the production server is not a backup.

## Starting the project

Open the repository in Claude Code or Codex and instruct the agent to read `AGENTS.md` and the files under `docs/` before making changes.

For Claude Code, `CLAUDE.md` imports the shared project instructions automatically.
