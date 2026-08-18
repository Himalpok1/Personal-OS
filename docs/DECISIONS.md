# Architecture Decision Log

This file is a compact decision log for agent handoff. The detailed rationale remains in `ARCHITECTURE.md`.

Do not change a **Locked** decision without explicit user approval.

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Standalone rebuild rather than extending Jarvis | Locked |
| ADR-002 | Expo + Expo Router as one universal iOS/Android/web client | Locked |
| ADR-003 | Dedicated Next.js dashboard deferred | Locked for MVP |
| ADR-004 | TypeScript backend | Locked |
| ADR-005 | Fastify for HTTP API | Locked |
| ADR-006 | Separate `apps/worker` process for background work | Locked |
| ADR-007 | pg-boss as Postgres-backed queue; no Redis for MVP | Locked |
| ADR-008 | PostgreSQL + Drizzle | Locked |
| ADR-009 | Shared Zod schemas in monorepo | Locked |
| ADR-010 | App owns tasks/reminders/events as system of record | Locked |
| ADR-011 | Event data model exists early; calendar UI/sync later | Locked |
| ADR-012 | RFC 5545 RRULE for recurrence | Locked |
| ADR-013 | Due-date recurrence pre-expanded; completion recurrence lazy | Locked |
| ADR-014 | In-app push-to-talk + Siri/Google voice entry | Locked |
| ADR-015 | Cloud STT first, local faster-whisper later | Locked |
| ADR-016 | Confidence-based auto-file; confirm when uncertain | Locked |
| ADR-017 | Offline outbox queues writes; no full offline-read sync initially | Locked |
| ADR-018 | Tailscale-only network access for MVP | Locked |
| ADR-019 | Primary reminder device explicitly chosen by user | Locked |
| ADR-020 | Local notifications for scheduled reminders | Locked |
| ADR-021 | Raw capture persisted before AI parsing | Locked |
| ADR-022 | Phase 0 requires encrypted backups and a verified manual restore | Superseded by ADR-024 |
| ADR-023 | Python only as later sidecars for ML/data-heavy workloads | Locked |
| ADR-024 | No backup/restore system in current architecture; PostgreSQL persistent Docker storage is not a backup (user-approved 2026-08-15) | Locked |
| ADR-025 | Production host is native Ubuntu Desktop (hostname `personal-os`), Tailscale installed directly on the OS | Locked |
| ADR-026 | Provider-agnostic AI layer: Vercel AI SDK abstraction (`packages/ai-providers`) over user-supplied, DB-stored, encrypted-at-rest API keys — no LLM provider hardcoded, no per-vendor env vars, no silent fallback to an unconfigured provider (user-approved 2026-08-15) | Locked |
| ADR-027 | `notes` table added to the Phase 1 data model — missing from earlier revisions of `ARCHITECTURE.md` despite `create_note` being one of the four parser tools since Phase 1 (user-approved 2026-08-15) | Locked |
| ADR-028 | Device registration requires a 15-minute, atomically single-use pairing code generated only through trusted server CLI access; device bearer tokens are hash-only server-side and stored in SecureStore on-device | Locked |
| ADR-029 | Device-token auth is scoped to device/notification endpoints. General API access remains Tailscale-perimeter-only; full lost-device revocation still requires tailnet removal | Locked |
| ADR-030 | Notification dispatch status `accepted` means Expo accepted the request, not confirmed device delivery; receipt polling is deferred | Locked for MVP |
| ADR-031 | Android reminder reboot survival uses Expo Notifications' built-in boot rescheduling, verified on the physical Rabbit R1 without opening the app after reboot; no parallel Headless JS scheduler is added | Locked for current Android build |
| ADR-032 | `apps/mobile/google-services.json` is git-ignored rather than committed. Google treats it as non-secret (it ships inside the APK), but it embeds a Google API key, so it is excluded as defense in depth. Local `expo run:android` reads it from that path via `android.googleServicesFile`; EAS Build must supply it as a file-type EAS environment variable, which additionally requires migrating `app.json` to a dynamic `app.config.ts` | Locked |
| ADR-033 | The FCM V1 service-account private key is never stored in the repository, `.env`, or any agent-accessible path. It is uploaded directly by the user from their own terminal to the EAS credential store (`eas credentials` → Google Service Account → FCM V1) and deleted locally afterwards. No Android upload keystore is created, because local debug builds sign with Android's own debug keystore and EAS cloud builds are out of MVP scope | Locked |
| ADR-034 | Firebase/FCM and Groq AI-provider configuration exist in **local development only**. Production has neither; provisioning production is a separate, deliberate step | Locked for MVP |

## Open later-phase decisions

These are intentionally deferred:

- Email account scope and whether the app may act on mail.
- Whether health data is passive or proactively used by the AI layer.
- Finance source of truth: Copilot export, Plaid/SimpleFIN, Actual Budget, or another ledger.
- Whether Raspberry Pi wake-word capture remains useful.
- Whether a dedicated Next.js dashboard becomes necessary.
