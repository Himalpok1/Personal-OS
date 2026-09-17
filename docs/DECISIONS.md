# Architecture Decision Log

This file is the **index** of every architecture decision, one line per ADR, for agent handoff.
The **full, verbatim text of each decision lives in `docs/decisions/ADR-NNN.md`** — open a file only
when you need the detail behind a decision. The index was split out on 2026-09-16 because the single
table had grown to 143 KB and was auto-loaded into every agent session; every row was moved byte-exact
— re-assembling the 73 rows from the split files reproduces the pre-split table exactly (SHA-256 of the
row set `018d5f03a079cd6dc5cff7a6767558172df2c0e0cc324226148dc3e8007abd3f` on both sides) — and nothing
was reworded or dropped.

Do not change a **Locked** decision without explicit user approval. Amendments are recorded as new
ADRs (or suffixed amendments such as `ADR-046a`), never by editing the original.

Ordering below is the original log order: amendments (`ADR-046a`, `ADR-047a`, `ADR-053a`,
`ADR-051a`, `ADR-051b`) sit where they were recorded, after the ADR they amend.

| ID | Decision | Status |
|---|---|---|
| [ADR-001](decisions/ADR-001.md) | Standalone rebuild rather than extending Jarvis | Locked |
| [ADR-002](decisions/ADR-002.md) | Expo + Expo Router as one universal iOS/Android/web client | Locked |
| [ADR-003](decisions/ADR-003.md) | Dedicated Next.js dashboard deferred | Locked for MVP |
| [ADR-004](decisions/ADR-004.md) | TypeScript backend | Locked |
| [ADR-005](decisions/ADR-005.md) | Fastify for HTTP API | Locked |
| [ADR-006](decisions/ADR-006.md) | Separate `apps/worker` process for background work | Locked |
| [ADR-007](decisions/ADR-007.md) | pg-boss as Postgres-backed queue; no Redis for MVP | Locked |
| [ADR-008](decisions/ADR-008.md) | PostgreSQL + Drizzle | Locked |
| [ADR-009](decisions/ADR-009.md) | Shared Zod schemas in monorepo | Locked |
| [ADR-010](decisions/ADR-010.md) | App owns tasks/reminders/events as system of record | Locked |
| [ADR-011](decisions/ADR-011.md) | Event data model exists early; calendar UI/sync later | Locked |
| [ADR-012](decisions/ADR-012.md) | RFC 5545 RRULE for recurrence | Locked |
| [ADR-013](decisions/ADR-013.md) | Due-date recurrence pre-expanded; completion recurrence lazy | Locked |
| [ADR-014](decisions/ADR-014.md) | In-app push-to-talk + Siri/Google voice entry | Locked |
| [ADR-015](decisions/ADR-015.md) | Cloud STT first, local faster-whisper later | Locked |
| [ADR-016](decisions/ADR-016.md) | Confidence-based auto-file; confirm when uncertain | Locked |
| [ADR-017](decisions/ADR-017.md) | Offline outbox queues writes; no full offline-read sync initially | Locked |
| [ADR-018](decisions/ADR-018.md) | Tailscale-only network access for MVP | Locked |
| [ADR-019](decisions/ADR-019.md) | Primary reminder device explicitly chosen by user | Locked |
| [ADR-020](decisions/ADR-020.md) | Local notifications for scheduled reminders | Locked |
| [ADR-021](decisions/ADR-021.md) | Raw capture persisted before AI parsing | Locked |
| [ADR-022](decisions/ADR-022.md) | Phase 0 requires encrypted backups and a verified manual restore | Superseded by ADR-024 |
| [ADR-023](decisions/ADR-023.md) | Python only as later sidecars for ML/data-heavy workloads | Locked |
| [ADR-024](decisions/ADR-024.md) | No backup/restore system; persistent Docker storage is not a backup (supersedes ADR-022) | Locked |
| [ADR-025](decisions/ADR-025.md) | Production host is native Ubuntu Desktop (hostname `personal-os`), Tailscale installed directly on the OS | Locked |
| [ADR-026](decisions/ADR-026.md) | Provider-agnostic AI layer over user-supplied, DB-stored, encrypted API keys; no hardcoded provider, no silent fallback | Locked |
| [ADR-027](decisions/ADR-027.md) | `notes` table added to the Phase 1 data model | Locked |
| [ADR-028](decisions/ADR-028.md) | Device registration via a 15-minute single-use pairing code minted from trusted CLI; bearer tokens hash-only server-side | Locked |
| [ADR-029](decisions/ADR-029.md) | Device-token auth scoped to device/notification endpoints; general API stays Tailscale-perimeter-only | Locked |
| [ADR-030](decisions/ADR-030.md) | Dispatch status `accepted` means Expo accepted the request, not device delivery; receipt polling deferred | Locked for MVP |
| [ADR-031](decisions/ADR-031.md) | Android reminder reboot survival via Expo Notifications' built-in boot rescheduling; no Headless JS scheduler | Locked for current Android build |
| [ADR-032](decisions/ADR-032.md) | `google-services.json` is git-ignored; supplied to EAS as a file-type environment variable | Locked |
| [ADR-033](decisions/ADR-033.md) | FCM V1 service-account key lives only in the EAS credential store, never in repo, `.env` or an agent path | Locked |
| [ADR-034](decisions/ADR-034.md) | Firebase/FCM and Groq configuration exist in local development only (MVP) | Locked for MVP |
| [ADR-035](decisions/ADR-035.md) | Exact-alarm permission requested at onboarding via a system-settings deep link; `USE_EXACT_ALARM` not declared | Locked |
| [ADR-036](decisions/ADR-036.md) | Primary-device eligibility is surfaced in Settings, never auto-corrected (no automatic promotion) | Locked |
| [ADR-037](decisions/ADR-037.md) | Production Android releases: EAS-managed signing keystore + `production-internal` APK profile; no Play publication | Locked |
| [ADR-038](decisions/ADR-038.md) | Phase 5 is Daily Command Center + Projects; Finance deferred to a later phase | Locked |
| [ADR-039](decisions/ADR-039.md) | Project lifecycle `active/paused/completed` via CHECK; `archived_at` is an independent axis; next action/stalled are computed | Locked |
| [ADR-040](decisions/ADR-040.md) | Daily/weekly reviews are durable `reviews` rows, unique `(kind, period_start)`; last-review timestamps derived | Locked |
| [ADR-041](decisions/ADR-041.md) | Daily Brief is manual/on-demand only — no queue, no cron, no scheduled or autonomous agents | Locked |
| [ADR-042](decisions/ADR-042.md) | Canonical all-day event recurrence: `start_date` authoritative, DTSTART anchored at local noon, one shared rule builder | Locked |
| [ADR-043](decisions/ADR-043.md) | Daily Brief implementation: `POST /briefs` + `GET /briefs/current`, `(brief_date, timezone)` identity, structural secret exclusion, 30 s/45 s budgets | Locked |
| [ADR-044](decisions/ADR-044.md) | Production `daily_brief` route reuses the existing `gpt-4.1` model row; per-release source directories; build images before migrating | Locked |
| [ADR-045](decisions/ADR-045.md) | The local-noon recurrence anchor is implementation metadata and must never reach presentation | Locked |
| [ADR-046](decisions/ADR-046.md) | Phase 6 is a read-only, server-side Google Health cloud integration; trailing-window re-fetch; webhooks permanently excluded | Locked |
| [ADR-047](decisions/ADR-047.md) | Health storage is daily aggregates plus sessions; intraday is heart-rate only; nothing is auto-deleted | Locked |
| [ADR-048](decisions/ADR-048.md) | `local_date` is the API's civil date; no timezone stored; sync window UTC-computed and widened one day each end | Locked |
| [ADR-049](decisions/ADR-049.md) | A sleep session is attributed to, and queried on, its civil END (wake) date | Locked |
| [ADR-050](decisions/ADR-050.md) | CHECK constraints only on project-controlled, closed vocabularies; provider-defined vocabularies are Zod-enforced | Locked |
| [ADR-046a](decisions/ADR-046a.md) | Amendment to ADR-046: authoritative zero-bucket daily densification permitted, insert-only, still clamped | Locked |
| [ADR-047a](decisions/ADR-047a.md) | Amendment to ADR-047: a provider-side deletion marker (`deleted_at`) is reconciliation, not deletion; hot sync never tombstones | Locked |
| [ADR-051](decisions/ADR-051.md) | Checkpoint 6.7 seven-day pre-deployment token-longevity gate waived by owner; OAuth In production before deploy; longevity deferred to monitoring | Locked |
| [ADR-052](decisions/ADR-052.md) | Phase 7 is Email summaries + service monitoring, read-only throughout | Locked |
| [ADR-053](decisions/ADR-053.md) | Mail integration is Gmail, `gmail.metadata` only, cursor-based, and polled | Locked |
| [ADR-054](decisions/ADR-054.md) | Header-only mail storage; email is the first attacker-authored input to reach the AI layer | Locked |
| [ADR-055](decisions/ADR-055.md) | Service monitoring is worker-owned; the worker-heartbeat watchdog is API-owned | Locked |
| [ADR-053a](decisions/ADR-053a.md) | Amendment to ADR-053: every Google authorization MUST send `include_granted_scopes=true` — consent is per app, not per client | Locked |
| [ADR-051a](decisions/ADR-051a.md) | Amendment to ADR-051: the Phase 6 post-deployment observation milestone is waived by owner; ADR-024 reaffirmed (no snapshot for Phase 7) | Locked |
| [ADR-051b](decisions/ADR-051b.md) | Amendment to ADR-051: Google Health moves to its own Google Cloud project `personal-os-health` (single-project rule superseded for Health only) | Locked |
| [ADR-056](decisions/ADR-056.md) | Phase 8 is Consolidation and Adoption, not an AI capability phase; no pgvector, no write-capable agent | Locked |
| [ADR-057](decisions/ADR-057.md) | Present-state reconciliation of the decision log (Checkpoint 8.0) | Locked |
| [ADR-058](decisions/ADR-058.md) | Alert dedupe keys are OCCURRENCE-scoped; AI output filtering is SHARED (Checkpoint 8.1) | Locked |
| [ADR-059](decisions/ADR-059.md) | Search is lexical, query-time and index-free; export is the user-authored core only (Checkpoint 8.3) | Locked |
| [ADR-060](decisions/ADR-060.md) | A 202 on a confirm means a commit will be ATTEMPTED; every Android capture launch is consumed exactly once (Checkpoint 8.4) | Locked |
| [ADR-061](decisions/ADR-061.md) | Phase 8 is CLOSED (2026-09-12); the four 8.6 owner decisions recorded as Locked | Locked |
| [ADR-062](decisions/ADR-062.md) | Checkpoint 9.0: every retrying queue has a DLQ; occurrences failures durable through the alert router; 404s drop their query; OAuth state swept | Locked |
| [ADR-063](decisions/ADR-063.md) | Checkpoint 9.4: dependable recurring tasks and reminders — one successor rule, snooze as an occurrence property, per-occurrence reminders (migration 0018) | Locked |
| [ADR-064](decisions/ADR-064.md) | Checkpoint 9.5: Calendar is an authoring surface — explicit event ownership, durable outbound sync, whole-series recurrence (migration 0019) | Locked |
| [ADR-065](decisions/ADR-065.md) | Checkpoint 9.6: content bounded at every write; search tokenised, six-entity, date-aware, explainably ranked — still lexical and index-free | Locked |
| [ADR-066](decisions/ADR-066.md) | Checkpoint 9.7: personal intelligence is READ-ONLY, request-scoped, body-free by default, and cited ("Ask about today") | Locked |
| [ADR-067](decisions/ADR-067.md) | Checkpoint 9.8: Suggested Focus — a narrow, cited, bounded-candidate AI suggestion reusing 9.7's TodayContext and consent switch | Locked |
| [ADR-068](decisions/ADR-068.md) | Checkpoint 10.1: Canvas LMS integration — read-only, PAT-authenticated, storage narrower than Canvas's shapes (migration 0020) | Locked |
| [ADR-069](decisions/ADR-069.md) | Phase 9 is CLOSED (2026-09-15); Phase 10 — Codebase Consolidation & Agent Readiness — is open | Locked |
| [ADR-068a](decisions/ADR-068a.md) | Amendment to ADR-068: assignment `score` and `grade` are stored (migration 0021); `description`, `entered_*` and attachments stay excluded | Locked |
| [ADR-070](decisions/ADR-070.md) | Checkpoint 10.2: the Academic Intelligence Layer is a computed read model over the Canvas tables, structurally outside the AI lanes | Locked |
| [ADR-070a](decisions/ADR-070a.md) | Amendment to ADR-070: academic surfaces show the current term only, selected by date (most recently started term), never by name | Locked |
| [ADR-071](decisions/ADR-071.md) | Checkpoint 10.3: deterministic, explainable academic intelligence sections (urgency, priorities, workload, course attention, grade summary) as optional wire keys; a token-based mobile design system with three new Expo modules | Locked |

## Open later-phase decisions

These are intentionally deferred:

- ~~Email account scope and whether the app may act on mail.~~ **Answered for Phase 7 by ADR-052/053/054: Gmail only, read-only, metadata only, and the app may never act on mail.** Scope is exactly `gmail.metadata` — headers, labels and identifiers, with **no message body, snippet, payload part or attachment** fetched or stored. Microsoft Graph is deferred (below). The app may not send, reply, delete, archive, mark read, move or label, and may not create tasks or events from mail. Mail digests are read-only summaries, global across all connected mailboxes, generated through the existing `ai_task_routes` layer with no tools.
- Whether Microsoft Graph (Outlook / Microsoft 365 mail) is added as a second mail provider, and on what terms. Deferred by ADR-052 because Graph needs a separate Entra ID app registration, a second consent surface and a per-folder delta cursor — a second credential lane and a different sync engine, not a variation on Gmail's. The provider interface is shaped to accept it without a `DROP CONSTRAINT` migration.
- ~~Whether health data is passive or proactively used by the AI layer.~~ **Answered for Phase 6 by ADR-046: passive.** Health data is displayed, never fed to the AI layer. Daily Brief integration is deferred to a separately approved checkpoint and, if it ever lands, must deliberately extend `BriefInput`'s closed scalar allowlist and be limited to factual statements, never advice.
- Finance source of truth: Copilot export, Plaid/SimpleFIN, Actual Budget, or another ledger (Finance itself deferred by ADR-038).
- Whether Raspberry Pi wake-word capture remains useful.
- Whether a dedicated Next.js dashboard becomes necessary.
