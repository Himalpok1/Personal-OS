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
| ADR-035 | Exact-alarm permission (`SCHEDULE_EXACT_ALARM`) is requested during onboarding via a system-settings deep link, and its absence is surfaced as a distinct "reminders may be delayed" state rather than treated as a blockage. `USE_EXACT_ALARM` is deliberately **not** declared: it is auto-granted but Google Play restricts it to alarm-clock/calendar-category apps, and this app is self-hosted and never listed, so the prompt is the honest route (Checkpoint 5, user-approved 2026-08-18) | Locked |
| ADR-036 | Primary-device eligibility is surfaced, never auto-corrected. ADR-019 stands — no automatic promotion — so when the current device is revoked, has notifications disabled, or is not primary, Settings names the reason instead of silently scheduling nothing (Checkpoint 5, user-approved 2026-08-18) | Locked |
| ADR-037 | Production Android releases for `com.himal.personalos` use an EAS-managed app-signing keystore and the `production-internal` internal-distribution APK profile; no Google Play publication. The private key remains only in EAS credential storage. Every release must reuse that remote credential and match the recorded production signing-certificate SHA-256 before installation. This supersedes only ADR-033's no-upload-keystore/no-EAS-cloud-build clause; ADR-033's FCM private-key handling remains locked (Checkpoint 6, user-approved 2026-08-18) | Locked |
| ADR-038 | Phase 5 is **Daily Command Center + Projects** (Today/Home command center, operational project management, daily/weekly reviews, unified agenda, manual AI daily brief, mobile/Rabbit polish, gated deployment). **Finance is deferred to a later phase**, still gated on the open finance-source-of-truth decision. Supersedes the original `ARCHITECTURE.md` phase-plan numbering for Phase 5 only (user-approved 2026-08-21) | Locked |
| ADR-039 | Project lifecycle vocabulary is `active / paused / completed`, enforced by CHECK constraint on `projects.status`, with `completed_at` set on completion and `updated_at` added. `archived_at` remains the **independent archive axis**; `'archived'` is forbidden in the status vocabulary (axis-collision rule recorded in `packages/db/src/schema/projects.ts`). Status changes go through dedicated action endpoints (`/pause`, `/resume`, `/complete`, `/reopen`), never generic PATCH. Next actions, stalled state, and progress are **computed read models**, never stored duplication (user-approved 2026-08-21) | Locked |
| ADR-040 | Daily/weekly reviews are durable first-class artifacts in a `reviews` table — unique `(kind, period_start)` with kind `daily\|weekly`, checklist state in `content` jsonb, optional `summary`, completed via explicit completion. "Last review" timestamps are **derived** from completed rows (`max(completed_at)` per kind), not duplicated into columns. No elaborate journaling system (user-approved 2026-08-21) | Locked |
| ADR-041 | The Personal OS Daily Brief is **manual/on-demand only**: deterministic bounded collector → single provider-agnostic LLM call through the existing `ai_task_routes` layer (`task_name='daily_brief'`) with an explicit abort timeout, output-token cap, injection-guarded prompt, structured graceful degradation when no provider is configured, and persistence unique per `(brief_date, timezone)`. **No queue, no cron, no scheduled or autonomous agents** in Phase 5. Production provider/model registration is deferred to the gated deployment checkpoint (user-approved 2026-08-21) | Locked |
| ADR-042 | **Canonical all-day event recurrence.** An all-day event's `start_date`/`end_date` are authoritative and `starts_at`/`ends_at` remain NULL — `starts_at` is **never** written for an all-day event, including to make recurrence work. The recurrence engine anchors an all-day series' DTSTART at **local noon** derived from `start_date` (the convention already documented on `DueDateRecurrenceRule.dtstart` but previously unused), which is DST-safe and correct in nonexistent-midnight zones such as America/Santiago. One shared builder, `buildEventRecurrenceRule` in `packages/core/src/recurrence/event-recurrence.ts`, is the **only** place a stored event row becomes a recurrence rule, and on-demand expansion (`assembleEventRange`), nightly worker materialization, create/PATCH materialization, and occurrence-validity checks (`isValidOccurrence`) all use it — a split-brain recurrence model is forbidden. For `is_recurring_instance && all_day`, `EventRangeItem.start_date`/`end_date` are **re-pointed to that instance's actual calendar dates** (preserving the template's day-span), deliberately asymmetric with timed instances (whose `starts_at`/`ends_at` stay the series template and are positioned by `occurs_at`), because the frozen `EventRangeItem`/`TodayEventItem`/`AgendaItem` shapes carry no per-instance date field and the instance date would otherwise be inexpressible. Pure calendar dates never round-trip through a UTC instant (Checkpoint 5.4, user-approved 2026-08-22) | Locked |
| ADR-043 | **Daily Brief implementation clarification (extends ADR-041, does not supersede it).** Routes are `POST /briefs` (body `{tz}`, honoring the already-frozen `BriefRequestSchema`) and `GET /briefs/current?tz=`, which **never generates** — a missing brief is `404 not_found`, normalized client-side to null per the `/reviews/latest` convention. Persisted identity is `(brief_date, timezone)` where `brief_date` is the **requested timezone's local calendar date** derived from `localDayWindow(tz, effectiveNow).localDate`, never by UTC-slicing an instant; regeneration upserts that same row and no brief history is kept. The deterministic collector **derives from `buildTodayResponse`** rather than re-deriving Today's rules, so a brief can never narrate numbers that contradict the Today screen; `buildTodayResponse` gained an **internal-only** optional `now` seam that is deliberately absent from `TodayQuerySchema` so no HTTP client can pin or spoof the clock. Secret exclusion is **structural**: the model only ever sees `BriefInput`, a closed scalar allowlist carrying no ids, no uuids, no free-text bodies and no credential-bearing field, so a secret is inexpressible rather than merely discouraged. The server **owns the persisted output shape** — only `{ text }` built from the model's prose is stored, never arbitrary model-returned fields, despite `BriefContentSchema` being `.passthrough()`. Timeout model is **30 s per attempt under a 45 s whole-chain budget**, each attempt receiving a fresh `AbortSignal` and no candidate being attempted once the budget is spent. Error taxonomy: `409 no_provider_configured`, `504 brief_generation_timeout`, `502 brief_generation_failed`, `400 validation_failed`; because `setErrorHandler` only passes 4xx through, the 5xx codes are replied explicitly by the route. `ai_daily_briefs.model_id` records the ai_models row that **actually served** the call via the new `callWithFallbackTracked`, never the route's primary assumed after the fact. Generation is synchronous and manual: no queue, no cron, no tools, no push (Checkpoint 5.5, 2026-08-23) | Locked |

## Open later-phase decisions

These are intentionally deferred:

- Email account scope and whether the app may act on mail.
- Whether health data is passive or proactively used by the AI layer.
- Finance source of truth: Copilot export, Plaid/SimpleFIN, Actual Budget, or another ledger (Finance itself deferred by ADR-038).
- Whether Raspberry Pi wake-word capture remains useful.
- Whether a dedicated Next.js dashboard becomes necessary.
