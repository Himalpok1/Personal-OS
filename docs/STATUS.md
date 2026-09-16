# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 10 — Codebase Consolidation & Agent Readiness — OPEN** (opened by the owner
2026-09-15). **Phases 0–9 are complete and production-deployed**; Phase 9 closed under ADR-069 with
no further checkpoint selected. Within Phase 10: **Checkpoint 10.0** (behavior-preserving cleanup and
the `docs/AGENT-READINESS.md` inventory) and **Checkpoint 10.1 / 10.1B** (read-only Canvas LMS
integration, migration `0020`, deployed and live-validated against the owner's real account) are
**deployed and accepted**. **Checkpoint 10.1C — the Canvas reconnect-after-disconnect fix — is
IMPLEMENTED, TESTED and INDEPENDENTLY REVIEWED but NOT DEPLOYED**, by the owner's own instruction;
its deployment plan is written in the 10.1C entry below and waits for explicit authorization.
**Canonical architecture:** `docs/ARCHITECTURE.md` · **Canonical decisions:** `docs/DECISIONS.md` (one-line
index) with the verbatim text of each ADR in `docs/decisions/ADR-NNN.md` · **Historical record:**
`docs/history/` · **Agent-readiness inventory:** `docs/AGENT-READINESS.md`

---

## How to read this file

This file is **present state only**: what is true *now*, the open Phase 10 record, the open debt
ledger, and the next action. Everything else has a home elsewhere:

- **Closed-phase checkpoint records** are in `docs/history/phase-N.md`, verbatim and never edited.
  Phase 9's record was partitioned there on 2026-09-16 (ADR-069), exactly as Checkpoint 8.0 and the
  Phase 8 closeout partitioned earlier phases — byte-exact, SHA-256 recorded in each file's banner.
- **Replaced present-state text** (earlier headers, at-a-glance tables, the full debt ledger
  including its closed entries, and the stacked per-checkpoint "Last verification" blocks) is in
  `docs/history/superseded-present-state.md` (Checkpoint 8.0) and
  `docs/history/superseded-present-state-2026-09-16.md` (this reconciliation).
- **Decisions** are one line each in `docs/DECISIONS.md`; open `docs/decisions/ADR-NNN.md` for the
  full text. Do not change a Locked decision without owner approval.

Before Checkpoint 8.0 this file was 7,283 lines / 689 KB and auto-loaded ~172k tokens into every
agent session through `CLAUDE.md`; before the 2026-09-16 reconciliation it had regrown to 2,655
lines / 243 KB. Nothing has ever been deleted from the record — only relocated.

## Where the history lives

| File | Contents |
|---|---|
| `docs/history/phase-0.md` … `phase-8.md` | Verbatim checkpoint records for Phases 0–8 (Phase 3 = **MVP**; Phase 7 = Gmail + monitoring, closed 2026-09-02; Phase 8 = consolidation & adoption, closed 2026-09-12 under ADR-061) |
| `docs/history/phase-9.md` | **Phase 9 — Checkpoints 9.0–9.8**, closed 2026-09-15 under ADR-069 (partitioned 2026-09-16) |
| `docs/history/superseded-present-state.md` | Present-state sections replaced by Checkpoint 8.0 |
| `docs/history/superseded-present-state-2026-09-16.md` | Present-state sections replaced at the Phase 9 closure, including the full 92-entry debt ledger and the evidence for each entry closed then |
| `docs/PHASE-8-CLOSEOUT.md` · `docs/CHECKPOINT-8.6-DECISION.md` · `docs/CHECKPOINT-8.6B-DESIGN.md` · `docs/SOAK-8.5.md` | Phase 8 companion records (closed artifacts; referenced from code comments and `phase-8.md`, so they keep their paths) |
| `docs/SOAK-9.2.md` | The owner-terminated 21-day adoption soak (Checkpoint 9.2); observer tooling in `scripts/soak/` |
| `docs/SOURCE-DURABILITY.md` | Source-durability design; Option A (private remote) executed 2026-09-02, **Option 2 (encrypted configuration copy) still open** |
| `docs/PHASE-0-CHECKLIST.md` | Closed Phase 0 artifact |

## Production state at a glance

Rows are as last verified first-hand at the checkpoint named in the row (10.1B on 2026-09-16 for the
deployment, Canvas and Rabbit rows; 9.8 on 2026-09-15 for the others unless stated). The
per-checkpoint acceptance evidence is in the Phase 10 entries below and in `docs/history/phase-9.md`.

| | |
|---|---|
| Migration level | **21** (`0000`–`0020`); local and production agree. 10.1C adds none. |
| Serving commit | api, worker and web at **`1e406f7`** (Checkpoint 10.1B, all three recreated 2026-09-16). **10.1C (`f85779a`, api only) is committed but NOT deployed.** Provenance is by compose `working_dir` (`personal-os-10.1-release`); the images carry no commit label. Rollback images `personal-os-{api,worker,web}:rollback-pre-10.1`, tagged by resolved digest (every earlier `rollback-pre-*` tag preserved underneath). |
| Containers | all four `RestartCount=0`; api `(healthy)`; postgres `postgres:17-alpine` up since 2026-08-30; `GET /health` → `ok` / `connected` / `stale:false` (10.1B) |
| Rabbit R1 | `com.himal.personalos` **versionCode 22**, built from `1e406f7` (EAS build `23f032f5…`), installed in place with SecureStore credential, primary-device row, exact-alarm appop, `POST_NOTIFICATIONS` and `firstInstallTime` (2026-08-19) all preserved — no re-pair, signature unchanged. Carries the Canvas "upcoming assignments" Today card verified live with real data; the 9.7 "Ask about today" flow and 9.8 "Suggested Focus" card unchanged. |
| Canvas (10.1/10.1B/10.1C) | `packages/canvas-providers` + six tables, PAT-authenticated, read-only, hourly `canvas.sync-cron`. **Live-validated against the owner's real UTA account 2026-09-16**: connect → sync (16 courses, 355 assignments, 19 announcements, 0 events) → idempotent resync → disconnect (credential triple NULLed) → invalid token rejected (`400 canvas_auth_failed`) → reconnect → resync, left **active**. Zero PAT occurrences in any log line across the window. **Known gap in production until 10.1C deploys:** reconnecting after a disconnect `409 canvas_already_connected`s (10.1B worked around it by deleting the disconnected row, losing that row's history); 10.1C reactivates the same row in place instead. |
| Capture front doors | Quick Capture · PTT · Siri/Assistant · Android share sheet (8.4) · launcher shortcut (8.4) · notification-shade capture (9.1) — a persistent local "Capture" notification on its own channel; verified live on the Rabbit R1 (9.1). |
| Reminders (9.4) | Scheduled by the primary device from **`GET /reminders`** — one item per one-off task with a reminder and one per open occurrence of a recurring task (derived from the parent's `remind_at` wall clock and its day-offset from `due_at`, in `recurrence_timezone`; `snoozed_until` overrides). Deterministic identifiers `reminder:<key>:<instant>`, exact alarms (`window=0 exactAllowReason=permission`), category `reminder` with **Done / Snooze 1h / Tomorrow 9am**, all `opensAppToForeground: true`. Verified live with the app process killed (`am kill`, not force-stop — force-stop puts the package in Android's stopped state, which cancels every alarm). |
| Notification channels (9.1) | `reminders` (MAX, local reminders only) · `alerts` (HIGH — integration/monitor alerts) · `updates` (DEFAULT — confirmations + mail digest) · `capture` (LOW — the local shortcut only, never through `notifications.dispatch`). All four verified listed and toggleable in Android's per-app settings on the Rabbit R1. |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active** · Canvas **active**. Health stream `daily-heart-rate-variability` re-enabled 2026-09-12T23:58Z after 9.0 corrected its value spec from a live shape observation; `heart-rate-intraday` stays disabled (F5 debt). |
| Calendar sync | 2 of 5 calendars enabled (owner's real primary + the dedicated test calendar). Imported events are `origin='external'` (read-only). **Calendar authoring (9.5):** `POST /events` with `calendar` → durable `pending_push` link → worker push with a link-derived Google id → inbound adoption; `GET /calendar-targets` offers the write-eligible calendars (roles `owner`); roles and display names refreshed by the worker's five-minute calendar cron. |
| Monitoring | 5 active targets (+1 archived 8.6D smoke target); **0 incidents ever, 0 open**; full CRUD live (8.6D). |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row. **`ask` (Cloud Ask, 8.6B/9.7/9.8) absent — OFF**, as shipped; the owner enables it from Settings. |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress. |
| Backups | **None, by design** (ADR-024). |
| Source durability | `origin` = `https://github.com/Himalpok1/Personal-OS` — **PRIVATE** (re-verified 2026-09-16). No CI, no Actions workflow, no repository secret. **`main` is the canonical branch again as of 2026-09-16** (fast-forwarded to the Phase 10 tip; PR #1 merged). |
| Test baseline | **6,054 tests across 13 packages** at 10.1C (`f85779a`): api 1,433 · mobile 1,390 · core 915 · worker 710 · schema 519 · health-providers 332 · api-client 195 · canvas-providers 70 · monitoring 151 · calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25 (was 6,044 at 10.1, 5,815 at 9.8, 3,668 at the Phase 8 closeout). |
| pg-boss | **31 queues, 11 schedules** (worker startup log at 10.1B; `pgboss.queue` reads one more with the internal `__pgboss__send-it`). Every retrying queue has a dead-letter queue (9.0): `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, the three calendar queues, `occurrences.generate-lazy`, `occurrences.expand-window`. `occurrences.expand-window` has a phase-2 idempotent lazy repair since 9.4. |
| Retention cleanup | `retention.cleanup`, daily `0 4 * * *` UTC: **seven** independent DELETEs — `monitor_checks` 30d · `mail_messages`/`mail_digests` 45d · `mail_sync_runs`/`health_sync_runs` 30d (8.6C) · `health_oauth_states` / `mail_oauth_states` on the row's own `expires_at < now` (9.0). First scheduled run 2026-09-13T04:00Z; the job's daily runs have not been individually re-verified since the 9.0 acceptance. |
| Alert keys | Occurrence-scoped (ADR-058). Producers: health-sync breaker (first live emission 2026-09-12T03:00:14Z), `occurrences.generate-lazy.dead:<occurrenceId>`, `occurrences.expand-window.dead:<UTC date>` (9.0; also covers a failed 9.4 phase-2 repair), `calendar.push-event.dead:<eventId>:<link updated_at ISO>` (9.5). The three 9.x producers are unexercised in production by design. |
| Search (9.6) | `GET /search` over **tasks, notes, events, projects, captures, mail** — tokenised, `all → all_without_date → any` ladder, closed date grammar under the client's `tz`, explainable integer `score`, honest per-type `counts.total`; `GET /search/item` → bounded, id-cited `ItemContext`. Semantics in `docs/ARCHITECTURE.md` → *Content bounds and search*. |
| Content bounds (9.6) | `packages/schema/src/text-bounds.ts`: titles/names 512 · task body 4000 · note body 20 000 · event description 4000 · event location 512 · project goal 2000 · capture 4000. User-typed → `400 validation_failed`; provider/model/STT text → truncated at write with counts-only logging. DB columns unchanged (`text`, no CHECK). |
| Personal intelligence (9.7 / 9.8) | `POST /ask` (with `tz`: a body-free, id-free `TodayContext`; every `[n]` citation must resolve or the call is refused `502 ask_uncited`) and `POST /focus/suggestion` (exactly one cited candidate from overdue/due-today; no model call below two candidates). Both reuse the `ask` consent switch, store nothing, and ship **OFF**. Semantics in `docs/ARCHITECTURE.md` → *Personal intelligence*. |
| Recurrence routes (9.4) | `POST /occurrences/:id/snooze` · `/reopen` · `GET /occurrences?order=` · `GET /reminders?horizon_days=` · `due_date` rules validated at `POST/PATCH /tasks` · `POST /tasks/:id/complete` redirects to the earliest **effective** open occurrence. All verified live 2026-09-14. |
| 404 logging | Unknown routes never log or echo their query string (9.0): `setNotFoundHandler` + a `req` serializer that drops the query for `is404`, every `OPTIONS`, and malformed URLs. |

---

## Phase 10 — OPEN (2026-09-15)

### Checkpoint 10.0 — Codebase consolidation & agent readiness: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-15)

**Objective (owner-directed).** Not a product checkpoint: remove proven-dead code, reduce
dependency/API ambiguity, map canonical service boundaries, and leave Personal OS cleaner before
Canvas integration and future Hermes/OpenClaw agent work — a behavior-preserving cleanup with
**zero intentional user-visible change**. Commit **`7dee309`** on `phase-9-reliability` (from
`82fef97`, the 9.8 acceptance record, verified clean and equal to origin). **No migration — level
stays 20; worker byte-unchanged.** No ADR: nothing here is an architectural decision.

**Execution model.** Eight parallel evidence-gathering/cleanup lanes launched at once, each with a
strict, disjoint file-ownership boundary to avoid concurrent-write collisions in the shared working
tree (Lane C's dependency work was folded into Lane AC's package.json ownership rather than split,
specifically to avoid two lanes racing on the same file): **A/C** mobile starter-script +
dependency audit, **I** an independent adversarial cross-check of the same dependency candidates
from scratch, **B** mobile theme-scaffold cleanup, **D** dead mobile hooks/queries + duplicate
date-parsing consolidation, **E** API/worker dead-code cleanup, **F** historical-script
disposition, **G** a read-only `tags`/`item_tags` schema classification, **H** a canonical
service-boundary audit for `docs/AGENT-READINESS.md`. Every deletion required positive
zero-reference evidence (repo-wide grep, barrel-export check, config/plugin check, transitive
dependency-graph check) — "no TypeScript import found" was explicitly treated as insufficient
evidence on its own for a native Expo dependency, per the brief's own caution.

**What was removed, with the evidence that justified it:**

- **`apps/mobile/scripts/reset-project.js`** and its `package.json` script entry — the standard
  Expo-template script that can move/wipe the mobile source tree. Confirmed unused: no CI (none
  exists in this repo), no doc requiring it beyond one stale `README.md` line, no other script
  calling it.
- **The `create-expo-app` theme scaffold**: `ThemedText`, `ThemedView`, `constants/theme.ts`,
  `use-theme.ts`, `use-color-scheme.ts`/`.web.ts` — a closed, fully unused graph (zero references
  outside itself, confirmed by file mtimes matching the original 2026-08-15 scaffold commit while
  every sibling file had been touched since). NativeWind, the app's real styling system per
  `docs/ARCHITECTURE.md`, is untouched — and critically, the app's *real*, active `useColorScheme`
  (imported directly from `nativewind`, used in `_layout.tsx` and `placeholder-color.ts`) is a
  different symbol entirely and was correctly left alone.
- **Four orphaned Expo dependencies**: `expo-image`, `expo-status-bar`, `expo-web-browser`,
  `@babel/plugin-transform-react-jsx`. Two independent audits (Lane AC and adversarial Lane I, run
  from scratch without seeing each other's work) converged on the identical split: these four have
  zero JS/TS usage AND zero transitive requirer in the resolved dependency graph (`pnpm why`), so
  removing them shrinks the actual installed/autolinked footprint. **`expo-glass-effect`,
  `expo-symbols`, `expo-font` were deliberately KEPT** — both audits independently found they are
  *already* required, at the identical version, as real (non-peer, non-optional) dependencies of
  `expo-router`/`expo` themselves, so removing the explicit pin would shrink nothing while
  forfeiting `expo-doctor`'s SDK-version-matrix validation. `@expo/ui` was confirmed load-bearing
  (the Rabbit R1's Material date/time pickers, active since Checkpoints 8.4/9.4/9.5) and untouched.
  Verified live: a cache-cleared `expo export --platform web`, run twice, bundled cleanly with the
  JSX transform still resolving correctly (via `babel-preset-expo`'s own declared dependency) — one
  non-blocking upstream fragility was flagged and recorded below, not fixed, since it isn't caused
  by this checkpoint.
- **Six dead mobile query/outbox exports**, each with a confirmed zero-reference repo-wide search:
  `useProject` (superseded by `useProjectDetail`), `useEvents` (superseded by `useEventsInRange`),
  `useLinkableCalendars` (a never-wired Phase-4-era stub, distinct from the still-live
  `useAvailableGoogleCalendars`/`useAvailableCalendars`), `useInvalidateMailConnections` (every real
  mutation already invalidates inline), `getOutboxCount` (a wrapper around the still-used
  `getOutboxStats`, itself kept — it has two real UI consumers), and two unused `healthKeys`
  sub-key builders with no corresponding hook anywhere.
- **A duplicate agenda date-parsing implementation** in `agenda-grouping.ts` — byte-for-byte
  identical to `utils/local-date.ts`'s `parseLocalDate`, and identical modulo a parameter name for
  `formatLocalDate` — consolidated onto the canonical helper. A dedicated adversarial review
  confirmed CONFIRMED SAFE: neither implementation ever used a UTC-based Date method (both are pure
  local-midnight calendar arithmetic), the existing `local-date.test.ts` fixture already pins the
  DST/leap-year/rollover edge cases this project has been burned by before, and the full mobile
  suite plus a live on-device Agenda screen check (`2026-09-15 – 2026-12-13`, correct) confirmed
  zero behavior delta.
- **Three long-dormant API error classes** (`AskDisabledError`, `AskNoRelevantContextError`,
  `AskInFlightError`, added in the original Checkpoint 8.6B commit and never instantiated, thrown,
  or caught since — the `/ask` and `/focus` routes have always replied directly with
  `reply.code().send()`) and one unused health-connection helper (`countHealthConnections` — the
  actual single-connection invariant it was claimed to support is enforced by
  `completeHealthConnection`'s own inline query, confirmed unchanged).
- **One unused test-fixture export**, `samplePoint` in `packages/health-providers`'s Google Health
  fake client — zero references anywhere including its own test file.

**Adversarial review (four lenses, all CONFIRMED clean, zero blockers).** Reachability (grep-based
false positives on symbol-name substrings, e.g. `useProject` matching inside `usePauseProject`,
individually verified and ruled out; the two transient API test failures during review were the
documented shared-test-DB collision from a concurrent reviewer process, confirmed clean on an
isolated clone); mobile/build regression (a live, cache-cleared `expo export --platform web`, run
twice, plus `expo-doctor` and a full literal-string sweep of `app.config.ts`/`eas.json`); date/time
behavior (see above); privacy/security (the egress guard's six pinned `generateText` call sites and
import/write denylist unaffected; ADR-058's occurrence-scoped dedupe-key contract unaffected; full
privacy/redaction/dedupe test sweep across `apps/worker`/`packages/core`/`packages/monitoring`
green).

**Verification.** `pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean ·
`prettier --check .` clean · `git diff --check` clean · `gitleaks` — the same 18 pre-existing
findings in ignored, untracked files, git history clean · `pnpm test` **21/21 tasks, 5,815 tests
across 12 packages, zero failing — the exact same count as the Checkpoint 9.8 baseline**, meaning
zero test coverage was lost to any deletion (none of the removed symbols had a dedicated test).
**Migration invariant:** 20 `.sql` / 20 journal entries, unchanged; `packages/db` byte-unchanged
outside the two-line fixture cleanup in `health-providers`.

**Deployment — COMPLETE (2026-09-15T18:49Z), frozen order.** `7dee309` pushed to `origin` first.
`git archive` shipped to `/home/himallinux/personal-os-10.0-release` (1,017 tracked files — 1,024 at
9.8 minus the 7 deleted mobile files; no `.env`, no `google-services.json`). Rollback images tagged
by resolved digest `:rollback-pre-10.0` for api (`217419c5…`) and web (`4a174af4…`) — **worker not
tagged**, no worker file changed. api + web built (running containers untouched, verified by
digest); the new api image was verified to contain zero occurrences of `AskDisabledError`/
`countHealthConnections` and all 20 migrations present. `drizzle-kit migrate` from the new api image
with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL` pass-through applied nothing (**20 →
20**, confirmed by direct row count before and after). `api` recreated alone → `(healthy)`,
`/health` `ok`/`connected`/`stale:false`; `web` recreated alone → `200` on its published host port.
`postgres` and `worker` never named or recreated. All four containers `RestartCount=0`.

**Production API acceptance — PASSED.** 0 api/worker warn/error log lines in the 5 minutes following
redeploy; `GET /today` and `GET /search?q=test` both `200`; migration count unchanged at 20; 0
pg-boss jobs failed/retry/active; 0 open monitor incidents; all three integrations (`google_health`,
`gmail`, `gcal`) `active`; `ai_task_routes` has 0 `ask` rows — **Cloud Ask remains OFF by default**,
unchanged by this checkpoint.

**Rabbit R1 — EAS build `24cf8e1c…` from `7dee309`, versionCode 20 → 21** (auto-incremented, remote
keystore reused). `adb install -r` of the 106 MB APK → `Success` (an in-place replace only succeeds
on a matching signature, so this is the signing-continuity proof). Preserved: `firstInstallTime`
2026-08-19, exact-alarm appop `allow`, `POST_NOTIFICATIONS` granted — no re-pair.

**Physical Rabbit R1 regression walk — PASSED, first-hand, zero crash lines in logcat across the
entire session.** Cold launch → Today renders correctly (Overdue 0, Due today 0, Inbox 3, no
Ask/Suggested-Focus chips, matching Cloud Ask OFF). Search → typed "task" → real "Mail" result
returned. Calendar Month view → correct, current date highlighted. **Calendar Agenda view → date
range header reads exactly `2026-09-15 – 2026-12-13`, directly exercising the consolidated
date-parsing code on-device.** Inbox → renders real historical items (9.1 smoke test, 8.6A note,
8.4 cold-share note) correctly. Settings → Connected Calendars renders correctly (exercises the
edited `calendar-connections.ts`), Mail section renders correctly (exercises the edited
`mail.ts`), Cloud Ask disclosure and AI provider list render correctly, Notification diagnostics
renders correctly. Projects → list and detail both render correctly (exercises the edited
`projects.ts` and the canonical `useProjectDetail`). Notes → renders correctly. Quick Capture →
composer sheet opens correctly (exercises the edited `outbox/queue.ts`). Notification-shade capture
→ the persistent "Capture" notification (`capture-shortcut-2`, channel `capture`) is confirmed
still present in the shade. No smoke data was created — every screen was verified against real
existing production data, since the objective was regression-freedom, not feature re-verification.

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry/active; migration 20 (unchanged); three integrations
`active`; 0 open incidents; 0 crash lines on the Rabbit R1.

**New deliverable: `docs/AGENT-READINESS.md`.** A canonical-boundary inventory for future
Hermes/OpenClaw agent work — for each domain (search, Today intelligence, tasks, recurrence,
events, calendar reads, notifications, AI), the canonical service/route to call, its read/write
nature, auth/consent boundary, idempotency behavior, input/output schema, privacy sensitivity, and
whether direct future-agent exposure is a safe candidate, needs a wrapper, or is prohibited. Also
records: the ADR-066 future-agent tool contract's current implementation status (3 of 5 tools
bound: `search_personal_items`, `get_item_context`, `get_today_context`; `get_calendar_context`/
`get_task_context` remain schema-only); the `isAbortLikeError` four-way duplication across AI call
sites (already-tracked accepted debt, deliberately not extracted — a refactor, not proven-dead
cleanup); and the `tags`/`item_tags` schema classification (below).

**Schema classification — read-only, no action taken.** `tags`/`item_tags` were audited and
classified **safe-to-drop**: zero rows in production after a month of live use, zero code
references anywhere in the 12-package monorepo, unmodified since the single Phase 1 commit that
created them, and — the most telling signal — absent from both ADR-059's and ADR-065's explicit
enumerations of every table holding user data. **Not dropped.** Dropping a table is irreversible
under ADR-024's no-backup posture and is categorically different from deleting dead TypeScript; the
recommendation is recorded for an explicit future owner decision, and no migration was written
solely to act on it.

**Dead-code tooling decision: deferred, not adopted.** Evaluated `knip`-style static dead-export
scanning against this specific codebase's dynamic patterns and concluded the signal would be weak:
Lane H's manual zero-consumer sweep of every `packages/*` barrel export found 252 of 1,040 exports
with no external reference, and all but one were either (a) TypeScript `interface`/`type`
companions to Zod schemas — the expected steady state of a schema-first monorepo where a consumer
routinely parses through a schema without ever spelling its inferred type name — or (b) the
ADR-066 future-agent tool contract's deliberately-unconsumed-today schemas. A naive scanner would
flag hundreds of these as false positives, and this repo has no CI to run it in automatically
(confirmed: no `.github/workflows` exists), so it would add local friction without enforcement. The
manual, evidence-based multi-lane audit process this checkpoint itself used is judged more
effective at this codebase's current scale; revisit if the false-positive-prone patterns above
(Zod-schema type companions, forward-designed contracts) ever shrink relative to genuine dead code.

**Recorded, not fixed (new debt from this checkpoint):** `react-native-css-interop`'s babel
entrypoint (used by `nativewind/babel`) references `@babel/plugin-transform-react-jsx` by a bare
string without declaring it as its own dependency; it currently resolves correctly only because
`babel-preset-expo` happens to declare the identical package, confirmed by a live, twice-run,
cache-cleared `expo export --platform web`. Not caused by this checkpoint (the phantom-dependency
pattern predates it and is a third-party package's own design, not something Personal OS's
`package.json` can fix by re-adding its own now-redundant pin) — worth an upstream note if a future
Expo/nativewind SDK bump ever breaks the alignment. `apps/mobile/README.md` still references
`npm run reset-project` (stale boilerplate text, zero functional impact, left untouched since it
falls outside every lane's owned-file scope this checkpoint).

---

### Checkpoint 10.1 — Canvas LMS integration: IMPLEMENTED, DEPLOYED, LIVE-VALIDATED (2026-09-16)

**One migration, `0020_canvas_lms_integration`** (six new tables — `canvas_connections`,
`canvas_courses`, `canvas_assignments`, `canvas_announcements`, `canvas_events`,
`canvas_sync_runs` — level **20 → 21**). Decision record: **ADR-068**. Full design reasoning,
discovery record and field-by-field storage decisions are there; this entry is the execution
record.

**Discovery was re-verified live before any code was written.** A prior "Canvas feasibility"
session existed but left no recoverable artifact anywhere in this repository — every branch, the
full reflog, stash, a content pickaxe across all history, and every dangling git object were
checked and none referenced Canvas. Rather than design against memory, a bounded, read-only,
three-round probe was re-run against the owner's real UTA Canvas account (`uta.instructure.com`)
with a fresh Personal Access Token, confirming real field shapes for `/users/self`, `/courses`
(16 active, with term info), `/courses/:id/assignments?include[]=submission` (confirming
`score`/`grade`/`entered_score`/`entered_grade`/`attachments` are real, populated fields —
deliberately excluded from storage), `/announcements` (real HTML `message`), and
`/calendar_events?type=event` (reachable, zero live examples — recorded honestly). No credential
was persisted: each round's token lived only in a scratchpad file outside the repo, deleted
immediately after that round.

**Implementation — seven parallel agent lanes in dependency rounds** (Foundation: db schema +
`packages/canvas-providers` client + `packages/schema` wire types → Services: API routes + worker
sync job + `packages/api-client` bindings → Mobile UI), each testing only its own package against
an isolated database clone, never the shared `personalos_test`/`personalos` databases directly.
All seven succeeded with passing self-tests.

**Integration found and fixed four real gaps before this could be considered done:**

1. **The DB lane made the three credential columns `NOT NULL` with no way to clear them on
   disconnect.** Fixed: made them nullable, added `canvas_connections_access_token_triple` (the
   `mail_connections` triple-null-or-all CHECK, verbatim), and `disconnectCanvasConnection` now
   actually nulls the ciphertext/iv/auth-tag — a disconnected connection retains no usable
   credential at all, not merely an unread one gated by `status`.
2. **The API lane accidentally ran `drizzle-kit migrate` against the shared `personalos_test`
   database** while debugging a hung clone-DB attempt (self-reported). Verified benign — purely
   additive `CREATE TABLE` statements, zero rows written — and left in place rather than reverted,
   since it matches what `db:reconcile` needed applied to the real dev database anyway. The
   journal's own `when` timestamp had a separate arithmetic bug (1,000,000,000 added instead of
   the documented 1,000,000, pushing it ~9.7 days into the future and failing the journal guard's
   own future-dating test) — corrected to `1789376000000`.
3. **Mobile correctly stopped rather than invent a workaround**: `apps/api` exposed connection
   lifecycle only, no route to read back a synced course or assignment, so the Today "upcoming
   assignments" card the brief asked for had nothing to query. Closed with a new
   `GET /canvas-assignments/upcoming?within_days=` route (denormalized with course name, active-
   connection/unarchived-course/unarchived-assignment filtering, ordered by `due_at`), its
   `packages/api-client` binding, and the mobile card itself.
4. **Two mechanical ratchet-test acknowledgments**: the new `Linking.openURL` call site in the
   Today card (`mobile-inert-rendering.test.ts`'s `OPEN_URL_ALLOWED`) and the two new pg-boss
   queues' containment status (`queue-containment.test.ts`'s frozen map) both needed explicit,
   justified entries — exactly the review-not-skipped friction those guards exist to create.

**A same-origin check defends the one new `Linking.openURL` call site.** `html_url` on a synced
assignment is Canvas-generated, not user-typed, but is still provider-supplied content this
project does not control. `isOwnCanvasOrigin` (`upcoming-assignments-card.tsx`) requires
`html_url`'s origin to exactly equal the connection's own `canvas_base_url` origin before a row
becomes pressable; a mismatch fails closed to inert text. Verified live in the browser (below),
not just in a unit test: a row was made to point at `evil.example.com` and correctly rendered with
no `link` accessibility role and no tap handler.

**An independent adversarial security review (separate agent, no context from the implementation)
found one CONFIRMED gap the fixes above hadn't touched: `canvas_base_url` had zero SSRF
protection.** `connectCanvasConnection` made a live, credential-bearing outbound request to
whatever URL was submitted, validated by nothing beyond `z.string().url()`, and the hourly worker
cron repeated that same unguarded request for the connection's lifetime — a spoofed `base_url`
could exfiltrate a real PAT, and `canvas_sync_runs.failure_class` (`network_error` vs
`provider_error`/`auth_failed`) is a coarse internal-network reconnaissance oracle. This project
already solved the identical shape of problem for CalDAV
(`packages/calendar-providers/src/caldav/ssrf.ts`'s `validateCalDavUrl`); Canvas simply hadn't
gotten the same guard. Fixed by porting it as `packages/canvas-providers/src/ssrf.ts`
(`validateCanvasUrl`/`isSameOrigin`) — HTTPS-only (except test/dev loopback), blocks
`169.254.0.0/16`, `fe80::/10`, `0.0.0.0` and broadcast — wired into `canvas-client.ts`'s single
`request()` chokepoint so it runs on the initial URL **and** on every redirect hop, with manual
redirect following (`redirect: "manual"`) that re-validates each target and drops `Authorization`
the instant a redirect leaves the original origin. A new `blocked_url` member was added to the
closed `CanvasFailureClass` enum (never retryable), and the connect route gained
`400 canvas_url_blocked`. Building this test suite caught a further latent bug in my own port —
and, it turns out, in the seven-months-running CalDAV original it was copied from: `net.isIP()`
does not recognize a bracketed IPv6 hostname (`URL#hostname` keeps the brackets on an IPv6
literal), so the whole IPv6-link-local check silently never ran. Fixed in the Canvas copy;
**flagged as a separate task for the CalDAV original**, since that file is live production sync
code and out of this checkpoint's scope to touch. The review's remaining findings were one
PLAUSIBLE (redirect `Authorization`-stripping behavior was previously unverified — now closed by
the same fix) and two low-severity notes (no explicit per-connection course cap, beyond the
fail-closed `expireInSeconds: 900`/`retryLimit: 0` queue bound; in-memory form state not cleared
on a failed connect attempt) recorded as non-blocking.

**Verification (integrator, serial):** `pnpm build --force` 13/13 · `pnpm typecheck` 23/23 ·
`eslint .` clean · `prettier --check .` clean · `gitleaks detect` — the same class of pre-existing
findings in ignored, untracked files (`.env`, `google-services.json` ×2, Expo dev logs), zero new,
zero Canvas-related, and the live PAT used for discovery was independently confirmed absent from
every tracked file and from the session scratchpad · `pnpm test --force` **23/23 tasks, 6,044
tests across 13 packages (a new `@personal-os/canvas-providers`), zero failing** — canvas-providers
70 (new) · api 1,423 (+41) · mobile 1,390 (+23) · schema 519 (+42) · core 915 (+17) · worker 710
(+12) · api-client 195 (+24) · db 79 (unchanged) · health-providers/monitoring/calendar-providers/
mail-providers/ai-providers unchanged. **Migration invariant:** `db:reconcile` clean (0
discrepancies) against the real local dev database after a genuine `drizzle-kit migrate` run
(20 → 21), proving the hand-written SQL matches the Drizzle schema exactly, not merely that it
parses.

**Live browser verification, not just tests.** A real Canvas connection, course, and two
assignments (one `submission_missing: true`) were seeded directly into the local dev database; the
built api server answered `GET /canvas-assignments/upcoming` with the correct shape, ordering and
denormalized course name; the mobile web client (paired via a real pairing code, not a bypass)
rendered the Canvas card on Today exactly as designed, including the "Missing" badge; the
same-origin guard was proven both positively (matching origin → `link` role, confirmed via the
accessibility tree) and negatively (mismatched origin → inert `generic` text) by mutating a seeded
row's `html_url` and reloading. All seeded rows, the test device-pairing row, and both preview
servers were cleaned up afterward — the dev database was left exactly as found.

**This checkpoint was implemented and locally verified in one session, committed
(`d3bfeb2`/`1e406f7`), then deployed to production and live-validated in a follow-up session — see
*Checkpoint 10.1B* immediately below for the full deployment and live-validation record.**

**Unchanged and reaffirmed:** ADR-018 (Tailscale-only; no Canvas webhook, no public ingress),
ADR-024 (no backup system — Canvas data is a locally cached reflection of the institution's own
record, recoverable by re-sync), ADR-056 (no embeddings, no pgvector, no AI/write-capable lane
touched — Canvas content is never summarized or sent to any model, confirmed to sit entirely
outside both of `ai-egress-guard.test.ts`'s pinned surfaces by construction).

**Recorded, not fixed:** no explicit cap on courses-per-connection beyond the queue's own
`expireInSeconds`/`retryLimit: 0` fail-closed bound; the Canvas connect form's in-memory token
state is not cleared on a failed attempt (cosmetic — the field is `secureTextEntry`-masked either
way); the IPv6-link-local bracket-stripping bug in CalDAV's own `validateCalDavUrl` (spawned as a
separate task, not fixed here — out of this checkpoint's scope to touch live calendar-sync code);
**no route exists to reconnect a Canvas connection after disconnect** — found live during 10.1B's
own validation: `canvas_connections_base_url_unique` has no status filter, so `POST
/canvas-connections` after a disconnect always returns `409 canvas_already_connected` for that
base URL, and the only way to reconnect today is deleting the disconnected row directly (which
cascades away its synced courses/assignments, all re-fetchable on the next sync). A dedicated
"reactivate" path, or relaxing the unique index to `WHERE status != 'disconnected'`, is Phase 10
candidate follow-up work, not fixed here.

---

### Checkpoint 10.1B — Production deployment & live validation: COMPLETE (2026-09-16)

**Scope: deploy Checkpoint 10.1 to production and validate it against the owner's real UTA Canvas
account.** No Canvas implementation code was changed — the mission was explicitly deployment and
validation only, with any discovered fix to be scoped and reviewed separately rather than made
inline. None was needed; the one real gap found (no reconnect-after-disconnect path, above) was
worked around operationally (delete + reconnect) rather than patched, per that scope boundary.

**Pre-deployment decisions, resolved with the owner before touching production:**

- **Rollback readiness:** the mission brief's Step 2 asked for a database backup, which conflicts
  with the locked ADR-024 (no backup system). Flagged explicitly; the owner chose **image-digest
  rollback only** — the same pattern every deployment since Phase 7 (ADR-051a) has used, justified
  identically here because migration `0020` is pure `CREATE TABLE`, so the pre-migration images
  keep working against the post-migration schema.
- **Live PAT validation:** the owner initially believed a token from a prior session was still
  available. A targeted search (this session's scratchpad tree, the prior implementation session's
  leftover scratchpad, the local dev `canvas_connections` table) found nothing — confirming
  ADR-068's own non-persistence discipline had held, not a gap. The owner then pasted a fresh PAT
  directly in chat; it was used immediately over SSH via stdin (never a shell argument, never
  written to any file) and never appears in any log.

**Deployment (frozen order, all verified at each step):**

1. Pushed `1e406f7` to `origin` (was 2 commits ahead).
2. Tagged the then-running api/worker/web images `rollback-pre-10.1` by resolved digest.
3. Shipped the release via `git archive` of `1e406f7` to
   `/home/himallinux/personal-os-10.1-release` (1,066 tracked files; no `.env`, no
   `google-services.json`; migration `0020` present).
4. Built api/worker/web images from that release dir; verified the new api image before deploying
   anything — 21 migrations present (highest `0020`), Canvas routes and the worker's
   `canvas-sync-connection` job present in `dist/`, no baked secrets (spot-checked).
5. Ran `drizzle-kit migrate` from the new api image, `--no-deps`, `MIGRATIONS_DATABASE_URL`
   passthrough: **20 → 21**. Verified structurally against the live schema rather than via
   `db:reconcile` (not runnable in a production image — no `tsx`, matching the documented
   image-contents pattern): all six tables present with the exact column counts, foreign keys and
   CHECK constraints ADR-068 specifies, including the `access_token_ciphertext`-triple CHECK from
   Checkpoint 10.1's own integration fix.
6. Recreated `api`, `worker` and `web` (`--no-deps --no-build --force-recreate`, named explicitly;
   `postgres` never touched). All four containers healthy within seconds; `GET /health` →
   `ok`/`connected`/`stale:false`; worker startup log shows **31 queues** (was 29) and **11
   schedules** (was 10) with `canvasSyncCron: "canvas.sync-cron"` present; zero warn/error log
   lines in either process since redeploy; `GET /canvas-assignments/upcoming` and
   `GET /canvas-connections` both respond correctly (empty, as expected pre-connection).

**Live validation against the owner's real UTA Canvas account (all through real production
routes, no synthetic data):**

- **Connect:** `POST /canvas-connections {base_url: "https://uta.instructure.com",
  personal_access_token}` → `201`, `canvas_user_name: "Himal Pokhrel"`, `status: "active"`.
- **Sync:** `POST /canvas-connections/:id/sync` → `202` queued → worker `canvas.sync.finished`:
  **16 courses, 355 assignments, 19 announcements, 0 events** (the account genuinely has none, per
  ADR-068's own discovery notes) — real course names (e.g. `2262-INSY-4315-001-ADVANCED WEB
  DEVELOPMENT`) landed correctly in `canvas_courses`.
- **Idempotency:** triggered a second sync on the same connection; table counts unchanged
  (16/355/19), confirming the `onConflictDoUpdate` content-comparison gate writes nothing on
  unchanged rows.
- **Disconnect:** `POST /canvas-connections/:id/disconnect` → `200`, `status: "disconnected"`; the
  credential triple was queried before (`ciphertext/iv/auth_tag` all present) and after (all
  **NULL**) — confirming Checkpoint 10.1's own integration fix (disconnect retains no usable
  credential) holds in production, not just in tests.
- **Invalid token:** a synthetic, clearly-fake token (never the owner's real one) against
  `POST /canvas-connections` → `400 canvas_auth_failed`, no Canvas error prose forwarded.
- **Reconnect:** the same base URL refused a fresh connect (`409 canvas_already_connected` — see
  the reconnect-path gap recorded under Checkpoint 10.1 above); worked around by deleting the
  disconnected row (cascades only its own synced rows, all re-fetchable) and reconnecting fresh.
  Final resync reproduced the identical real counts (16/355/19/0), left **active**.
- **`GET /canvas-assignments/upcoming?within_days=14`** returned 15 real, correctly ordered,
  correctly denormalized upcoming assignments.
- **Log audit:** grepped api and worker logs across the entire ~10-minute test window for the raw
  PAT string — **zero occurrences**. Zero warn/error lines. The three `canvas.sync.*` log lines
  emitted are counts-only (`coursesSeen`, `assignmentsSynced`, etc.), no titles or content — one is
  `canvas.sync.skipped reason:"connection_not_active"` from a job that was queued before disconnect
  and correctly no-op'd rather than erroring when it ran after.

**Rabbit R1 (versionCode 21 → 22):**

- EAS build `23f032f5-0228-4ec6-b0c9-f42f694998a1` from `1e406f7`, `production-internal` profile,
  ~13 min.
- Pre-install state recorded: versionCode 21, `firstInstallTime` 2026-08-19, exact-alarm appop
  `allow`, `POST_NOTIFICATIONS` granted.
- `adb install -r` → `Success` (an in-place replace only succeeds on a matching signature, so this
  is the signing-continuity proof). Post-install: versionCode **22**, `firstInstallTime`
  2026-08-19 preserved, exact-alarm appop still `allow`, `POST_NOTIFICATIONS` still granted — no
  re-pair.
- Cold launch initially showed "Couldn't load today" — root-caused to the device's Tailscale VPN
  not being actively connected at that moment (`UnknownHostException` resolving
  `personal-os.tail62a68f.ts.net`, `ConnectivityService` reporting `BLOCKED`), **a device network
  condition, not a deployment or code defect** — ordinary WAN connectivity worked throughout
  (`ping 8.8.8.8` succeeded). Opening the Tailscale app showed it already `Connected`; a retry
  loaded Today successfully with zero crash lines in logcat throughout.
- **The Canvas card renders correctly on-device with real data**: labeled "Canvas", five real
  upcoming assignments with correct course names, titles and due dates/times, in the identical
  order the API returned. Tapped a real assignment row: correctly opened the device browser to
  `https://uta.instructure.com/...`, redirecting through the institution's real SSO gateway
  (`oit.uta.edu`) — proving the same-origin link guard passes for real Canvas URLs on the physical
  device, not just in a unit test.

**Post-validation production health:** `/health` `ok`/`connected`/`stale:false`; all four
containers `RestartCount=0`; migration 21; Canvas connection left `active` with real synced data;
zero crash lines on the Rabbit R1 across the session.

**Rollback, if ever needed:** `docker tag personal-os-{api,worker,web}:rollback-pre-10.1
personal-os-{api,worker,web}:latest` then `docker compose ... up -d --no-deps --no-build
--force-recreate api worker web` — no schema rollback (migration `0020` is additive-only, so the
pre-10.1 images run correctly against the post-migration schema, per the frozen deployment order's
own reasoning).

---

### Checkpoint 10.1C — Canvas reconnect lifecycle fix: IMPLEMENTED, LOCALLY VERIFIED, **NOT DEPLOYED** (2026-09-16)

**Scope: fix the reconnect-after-disconnect bug found live in Checkpoint 10.1B, nothing else.** No
migration, no sync-behavior change, no other provider touched. Owner-directed constraint: implement,
test and review only — do not deploy until explicitly authorized.

**Root cause.** `canvas_connections_base_url_unique` is a plain (non-partial) unique index with no
status filter — deliberately, mirroring `mail_connections_provider_account_unique` and
`health_connections_health_user_id_unique`, which carry the identical property. The bug was never
the index; it was that `connectCanvasConnection` enforced that identity with a blind INSERT caught
against a unique-violation ("let the constraint be the truth," the `routes/events.ts` `client_uuid`
pattern), which cannot distinguish "a row already exists and is active" from "a row already exists
but was disconnected." `completeGmailConnection`/`completeHealthConnection`
(`apps/api/src/services/{mail,health}-connection.ts`) never had this bug because both already SELECT
any prior row by identity first and UPDATE it in place — the established Personal OS reconnect
pattern this checkpoint's own investigation confirmed by reading both functions in full, not
assumed from memory.

**Fix.** `connectCanvasConnection` now SELECTs any prior row by `canvas_base_url` before writing.
A prior row with `status: 'active'` still refuses with `CanvasAlreadyConnectedError` (`409
canvas_already_connected`) — unlike Gmail/Health's unconditional update, because a PAT paste is one
deliberate manual action, not an OAuth popup that can legitimately re-fire mid-session; silently
swapping a live connection's credentials without an explicit disconnect first would be surprising.
A prior row belonging to a DIFFERENT `canvas_user_id` refuses with a new `CanvasAccountMismatchError`
(`409 canvas_account_mismatch`, no identifiers in the message), mirroring
`completeHealthConnection`'s existing `AccountMismatchError` for the identical structural risk — an
identity key (`canvas_base_url`, `health_user_id`) that is not the account id itself, unlike
`mail_connections`' `(provider, external_account_id)` compound key where a mismatch is structurally
impossible. Otherwise — no prior row, or a prior row that is not active and belongs to the same
user — the connection is INSERTed (new) or UPDATEd in place (reactivated): credential replaced,
`status` back to `active`, `last_sync_error`/`last_sync_error_at` cleared, `canvas_user_name`
refreshed, but `id` and `created_at` preserved, so every FK-linked `canvas_courses`/
`canvas_assignments`/`canvas_announcements`/`canvas_events`/`canvas_sync_runs` row survives
(`ON DELETE CASCADE` triggers only on a row DELETE, never an UPDATE) — a real improvement over
10.1B's own operational workaround, which had to delete the disconnected row and lose that history
to reconnect at all. The route (`POST /canvas-connections`) now returns **200** on a reactivation and
**201** only on a genuine creation (`result.created`), mirroring `routes/mail-connections.ts`'s
identical `result.created ? 201 : 200` for `completeGmailConnection` — the api-client's `fetchJson`
only ever checks `response.ok`, so this is an honest wire signal, not a compatibility requirement.

**Verification.** `pnpm build --force` 12/12 · `pnpm typecheck` 23/23 · `npx eslint .` clean ·
`npx prettier --check` clean on every changed file · `git diff --check` clean · `gitleaks detect`
— the same 21 pre-existing findings in one ignored, untracked file
(`apps/mobile/.expo/dev/logs/export.log`), confirmed via `git check-ignore`, zero new · `pnpm test
--force` **23/23 tasks, 6,054 tests across 13 packages, zero failing** (api 1,433 [+10 net: 9 new
reconnect/mismatch tests plus 1 added after review] · mobile 1,390 · core 915 · worker 710 · schema
519 · health-providers 332 · api-client 195 · canvas-providers 70 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25; was 6,044 at 10.1). **No
migration** — `canvas_connections_status`'s existing CHECK vocabulary (`active`, `disconnected`,
`invalid_token`) already covers every state the fix needs; nothing about the schema was wrong.

**Independent adversarial review** (a separate agent with no context from the implementation,
instructed to verify the "mirrors Gmail/Health" claim by reading the precedent functions itself
rather than trusting the description, and to run the tests itself rather than trusting a prior
claim): **zero BLOCKER, zero MAJOR findings.** Explicitly checked and cleared: no
ownership/authorization bypass (route remains Tailscale-perimeter-only, unchanged); old credentials
cannot be retained or reused (disconnect nulls all three columns, the triple CHECK makes a partial
state impossible, reactivation always encrypts the freshly-verified token, never conditionally
skips it); no secret, ciphertext or PAT appears in any log line or error message in the diff; the
account-mismatch check cannot false-positive for the same legitimate user (`toNumericId` normalizes
`self.id` identically on every call); the race window between the SELECT and the write is accepted
on the same terms Gmail/Health's identical pattern already accepts, and Canvas's INSERT path is
**more** defensive than Gmail's own precedent (Gmail's insert has no unique-violation catch at all;
Canvas kept one as a backstop); scope stayed to exactly the three expected files, no sync-job,
other-provider or schema change. **One MINOR finding, closed in-checkpoint**: no test reactivated
specifically from `status: 'invalid_token'` (only `disconnected` was exercised) — low severity
because no production code path writes that status today (confirmed by repo-wide grep: it exists
only in the CHECK constraint, the Zod enum and mobile display logic), but closed anyway with a
dedicated test proving the reactivate branch is genuinely status-agnostic (keyed on "not active"),
not coincidentally correct only for one vocabulary member.

**Recorded, not fixed (pre-existing, unrelated to this checkpoint):** `invalid_token` is a real,
CHECK-enforced member of `canvas_connections.status` that no production code path ever writes —
`apps/worker/src/canvas/orchestrate.ts`'s `recordConnectionError` only ever sets
`last_sync_error`/`last_sync_error_at` on a sync failure, never `status`, so a connection with a
revoked PAT stays `active` locally while sync keeps failing quietly into `last_sync_error`. This
means an owner whose live PAT was revoked cannot reconnect with a fresh one without first explicitly
disconnecting (the `status: 'active'` block in this fix's own reconnect guard would otherwise
refuse it) — not a regression from this checkpoint, but wiring `invalid_token` into the worker's
failure path is recorded as Phase 10 candidate follow-up, since it would let a broken connection
surface itself for reconnect without a manual disconnect step first.

**Deployment plan (NOT executed — awaiting explicit authorization, per this checkpoint's own
scope).** Nothing here requires the full frozen order's migration step, since there is no
migration:

1. Commit (`apps/api/src/services/canvas-connection.ts`,
   `apps/api/src/routes/canvas-connections.ts`,
   `apps/api/src/routes/canvas-connections.test.ts` only) and push to `origin`.
2. Tag the then-running `personal-os-api` image `rollback-pre-10.1c` by resolved digest (worker and
   web are untouched by this diff, so neither needs a new rollback tag or rebuild).
3. Ship the release via `git archive`, build the `api` image only, verify the built image carries
   the new `canvas_account_mismatch`/`created ? 201 : 200` logic before deploying.
4. Recreate `api` alone (`--no-deps --no-build --force-recreate api`) — `worker`, `web` and
   `postgres` untouched.
5. Validate against the real production Canvas connection already live from 10.1B: disconnect it,
   confirm the reconnect now returns 200 (not 409) and the SAME connection id, confirm a resync
   still succeeds, confirm the account-mismatch guard 409s a deliberately-wrong synthetic token
   (never the owner's real second account) before leaving the connection reconnected with the
   owner's real PAT.

---

---

## Remaining warnings / technical debt

> **Open entries only.** Every entry below is verbatim from the pre-2026-09-16 ledger, in its original
> order. The 22 entries already struck through as closed, and the 12 closed at the 2026-09-16
> reconciliation (each with the checkpoint or commit that closed it), are archived in
> `docs/history/superseded-present-state-2026-09-16.md` §3 and §5. One duplicate
> (`resolveFreshAccessToken`, recorded at 6.6 and again at 9.0) is merged into a single entry.
> Entries are **not** re-verified against the current tree unless their text says so — an entry
> being here means no later checkpoint recorded closing it.

- **The real-browser CORS proof has not been run against the Phase 5 deployment.** The Chrome
  extension was unavailable and the sandboxed browser pane cannot load `/_expo/static/*` on the
  non-standard `:8443` port (documented Phase 2 limitation). curl proved the exact header contract
  and `WEB_APP_ORIGIN`/compose are byte-identical to the browser-verified Phase 4 state.
- **`/home/himallinux/personal-os` on the production host is stale Phase 3 source** (migrations
  only to 0004) but holds the real `.env`. It is a trap for anyone who builds from it by habit.
  The live build context is `/home/himallinux/personal-os-9.6-release` (api, worker, web); every
  earlier `personal-os-<checkpoint>-release` directory is retained as a rollback source. *(Updated at
  Checkpoint 9.6, 2026-09-15.)*
- **The Settings screen ships no test-notification control**, although
  `POST /devices/:id/test-notification` and the api-client method both exist. Verifying push
  therefore requires enqueuing a `notifications.dispatch` job server-side, since the device bearer
  token is deliberately unreadable from SecureStore.
- **Production gpt-4.1 rarely routes captures to `needs_confirm`.** Two deliberately ambiguous
  captures (including bare `asdf`) both parsed confidently as notes. Model behaviour, not a defect,
  but it means the confirmation-push path is hard to exercise on demand in production.
- **`ai_daily_briefs.model_id` FK violation is unhandled.** If the referenced `ai_models` row disappeared between resolution and the upsert, the insert would raise `23503` and surface as a generic 500, discarding an already-paid generation. Currently unreachable — the API exposes no delete endpoint for `ai_models` — so it is recorded rather than pre-solved.
- **POST/GET clock-read skew across local midnight.** A generation started just before local midnight persists `brief_date = D`, while a `GET /briefs/current` issued after the rollover computes `D+1` and returns 404. Correct per-instant behaviour on both sides and self-correcting on the next generation; only worth changing if the product wants a "just generated, don't let it vanish" guarantee.
- **`generated_at` can read one calendar day after `brief_date`** for the same near-midnight case, since it is stamped at persistence rather than at collection. Cosmetic; only visible if a UI shows both together.
- **Collector re-sorts projects inside Today's already-capped top 10**, so its "stalled first" ordering is guaranteed only within that window, not globally. Totals stay honest either way.
- **`callWithFallbackTracked` still invokes the attempt callback for candidates after the budget is exhausted** — each returns immediately without reaching a provider, so no call is made and no result changes; noted only because the timeout comment reads stricter than the loop behaves.
- **Drizzle snapshots stop at 0008** — `db:generate` remains unusable until faithful 0009/0010(+0011) snapshots are reconstructed or the hand-written-SQL + mandatory-`db:reconcile` methodology is superseded. Recorded decision from Step 0; each new hand-written migration must consciously extend the journal-guard allowlist and run reconcile.
- **No composite index on `occurrences(parent_type, status, occurs_at)` and no index on `events.start_date`** — the Agenda and event-range queries filter on both. Not a practical risk at single-user scale with a 90-day materialized horizon; two additive index migrations would close it if scale assumptions change.
- **All-day `recurrence_until` must resolve to end-of-local-day.** The shipped mobile editor always serializes it to 23:59:59.999, so the product flow is correct, but the schema neither enforces nor documents it — a raw API caller sending midnight silently loses the final occurrence (a noon-anchored instance sorts after it). Untested; document or normalize server-side in a future pass.
- **`ALL_DAY_ANCHOR_SLACK_MS` (36h) padding charges a few extra candidates against the shared 10,000 recurrence budget** per all-day series. Negligible for daily/weekly/monthly rules; only material for a pathological sub-daily all-day rule, which nothing currently forbids.
- **Priority chips ~37px without hitSlop on the daily flow** — below the 40px bar elsewhere; queued for 5.6.
- **No UI to browse past settled reviews** (client list method exists; no screen) — intentional MVP scope.
- **`reviews` route screens use inline Stack.Screen options rather than root-layout declarations** — conventionally inconsistent with other stack routes, functionally identical.
- **The exact-alarm grant does not survive reinstall.** Every rebuild silently returns the app to inexact reminders until the user re-grants "Alarms & reminders".
- **Duplicate-alarm repair is covered by unit tests only.**
- **Runtime images aren't pruned of devDependencies.**
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval.
- **The web app's `EXPO_PUBLIC_API_URL` is baked in at Docker build time.**
- **`tailscaled` runs as a snap** on the production host — the monitoring unit is `snap.tailscale.tailscaled.service`, not `tailscaled.service`.
- **Rabbit Tailscale auto-start depends on Android's Always-on VPN setting** (enabled 2026-08-21; lockdown off). It is a device-side OS setting, not app-managed — a factory reset or Tailscale reinstall would require re-enabling it.
- **One archived Gate H smoke note row (`132020f6…`) remains as lineage** — invisible in UI, referenced by nothing, deliberately outside the approved purge scope.
- **Raw-heart-rate reconcile stability (F5) is DEFERRED ACCEPTANCE DEBT (2026-08-25).** F5
  capture 1 is preserved at `~/.personal-os-phase6/f5/capture-1.json`; capture 2 was
  explicitly deferred by the user. F5 is **neither passed nor failed**. Consequence:
  `heart-rate-intraday` stays disabled and raw intraday ingestion is excluded from 6.3.
  Reconsider via either the delayed reconcile-stability proof or the `list` + local
  multi-source de-duplication fallback keyed on `DataPoint.dataSource`.
- **Disconnect disables every stream, and reconnect deliberately does not restore them (6.6).** This
  is by design — `syncStreamsForGrantedScopes` cannot distinguish a disconnect's blanket disable from
  a user's own per-stream choice, and silently re-enabling a stream the user turned off would be
  worse. The consequence is real though: after a reconnect the connection is active but **nothing
  syncs** until streams are re-enabled, and a sync pass reports `skipped: "no_enabled_streams"` rather
  than anything a user would read as a problem. There is no UI affordance for this today. It is also
  the exact condition that would have turned 6.6's post-reconnect idempotency check into a false pass.
- **`health_sessions.session_type` / `session_subtype` and the three `HealthSourceIdentity` fields are
  unconstrained `z.string()` with no length cap (6.6 review).** Currently safe because they come from
  Google's documented enum-shaped fields through an allowlisted three-field `SessionDetail`, but
  nothing in the schema would catch it if that assumption broke. The daily-metric path has no
  equivalent exposure.
- **`resolveFreshAccessToken` (API) writes the access-token columns by id without re-checking
  `status` (6.6 review).** A disconnect landing concurrently with a refresh could re-populate a column
  being NULLed, last-write-wins. Unreachable today — no route calls that function; only the two
  standalone scripts do — and the worker's equivalent re-checks `status` inside the advisory lock.
  *(Folded in at the 2026-09-16 reconciliation: the 9.0 review recorded the same finding a second time — its hourly-pass shape probe exercised exactly this path, a refresh landing 35 s before the pass — so the two entries are merged here.)*
- **The local `.env` holds the development loopback callback**, not the Tailscale one.
  Restore before anything production-facing.
- **Twelve of eighteen Google Health value specs remain unverified (6.3L).** Six are now OBSERVED
  live — `steps`, `distance`, `floors`, `total-calories`, `heart-rate` (rollup leaves) and the
  `sleep` session shape. The rest are `unverified_no_account_data`: this account has never produced
  data for them, which is not a defect and for which no fixture was fabricated. A wrong declaration
  fails the run loudly and cannot store a wrong number.
- **An authoritative window returning zero sessions cannot tombstone the last remaining one (6.3),**
  because the sweep is gated on a non-empty seen-key set — `x <> ALL('{}'::text[])` is TRUE in
  Postgres, so an ungated sweep would tombstone the whole window. Deliberate cost of the guard.
- **`enqueueHealthSyncForAllActiveConnections` and the `not_configured` skip path are untested
  (6.3)** — the first needs a live pg-boss, the second is unreachable in a workspace whose `.env`
  sets the Health credentials.
- **Only the integrator may run database-backed suites (process rule, 6.3).** `apps/api` and
  `apps/worker` share one `personalos_test` database, so a sub-agent running vitest concurrently
  produces shifting, meaningless failures in unrelated pre-existing tests. Sub-agents run pure unit
  tests only and hand off first. Never pipe a vitest run through `| head`: the SIGPIPE can orphan a
  worker that keeps truncating into the next run.
- **List-row Archive and Drop still fire without confirmation (6.5).** Checkpoint 6.5 added
  `Alert.alert` gates to the four detail screens and to Settings' Revoke/Disconnect/Forget, but the
  same actions one tap away in a Tasks or Notes list row are still unconfirmed — and the new detail
  copy correctly tells the user that an archived task, note or event has no in-app route back. A
  fat-finger tap on the Rabbit's 480px screen therefore hides an item with no recovery. Deliberately
  left: routing list rows through the same gate is a behaviour change to the app's highest-traffic
  interaction and wanted its own decision.
- **Reminder, notification and pairing paths cannot be verified on the UI-test identity (6.5).** It
  mounts none of them by design, so the physical Rabbit pass covers layout, navigation, Health, the
  error/retry paths and offline behaviour — but not a real alarm firing, a real push, or the
  revoked-session banner. Closing that needs a production-identity build, i.e. an EAS build and a
  `versionCode` bump.
- **`nativewind` cannot be imported under the mobile vitest transform (6.5).** It is aliased to a
  mock, the same route already taken for `expo-router`. Any future module that reaches NativeWind at
  import time inherits the mock rather than the real runtime; `placeholder-color.test.ts` guards the
  alias itself.
- **Stopping a stale dev server requires enumerating ALL `tsx watch` supervisors (process rule,
  6.3),** by command line and working directory, and stopping supervisors before children. Walking
  up from the port-3000 listener finds only the one currently serving; a surviving supervisor will
  notice the next edit and respawn a child that reclaims the port.
- **Monitoring under-samples every probing target (found at 7.9 closure).** Since deployment:
  `api-internal-health` 1,463 checks against 1,538 due (95.1%); the three 300 s targets 301 against
  307 (98.0%) each; `worker-heartbeat`, which performs no probe, 1,536/1,538 (99.9%). Every check is
  `up`, so this is `monitor.run` beat-skew rather than an outage — but "5/5 up, 0 incidents" masks a
  sampling shortfall and lengthens worst-case detection latency. Never yet coincided with a real
  outage, so its worst case is unmeasured.
- **The worker log redactor fires on an intentionally-logged field.** `mail.digest.generated` emits
  `"mailboxes":"[forbidden-field]"` on every generation. Defensive rather than a leak — the control
  is working — but the field was meant to carry a count, so the line is silently less useful than it
  reads.
- **A live `EXPO_TOKEN` sits in a world-readable ignored file.** `apps/mobile/.expo/dev/logs/export.log`
  is mode 644 and carries a plaintext token (9 gitleaks findings). It is ignored and untracked, so it
  is **not** a push risk, but it defeats the deliberate 600 hardening on both `.env` files. Delete
  it; tooling regenerates it, so treat as recurring hygiene. `apps/mobile/.env.example` does not
  document `EXPO_TOKEN` at all.
  *(2026-09-16: `export.log` (21 findings by then) and its sibling `start.log` (1) were deleted from
  the primary checkout; a working-copy gitleaks scan now reports only the intended, ignored `.env`
  and `google-services.json` files. The entry stays open because the logs regenerate on the next
  `expo export`/`expo start`, and because rotating the token that sat on disk is an owner action.)*
- **The tailnet suffix is embedded in immutable commit metadata.** 104 of 255 commits (recounted at
  the Phase 8 closeout; the earlier "117 of 249" was a miscount) carry an author email at the tailnet
  domain. Now that a remote exists this is replicated off-machine. Harmless in a private repository
  and **not** fixable without rewriting every SHA including `a5bbc48`, which production is pinned to.
  `git config user.email` is no longer set to that domain at either scope, so the count no longer
  grows. **This is the concrete reason the repository must never be made public without a separate
  deliberate decision.**
- **One ingested all-day event has `end_date` one day BEFORE `start_date` (8.2).** Google's all-day
  `end.date` is exclusive and the translator converts to inclusive by subtracting a day
  (`googleAllDayToLocal`), so this row is a faithful conversion of an upstream event whose
  `end.date == start.date` — a zero-length all-day event at Google. Personal OS has no guard that
  rejects or normalises `end_date < start_date` on ingest. One 2021 row; harmless today, but a
  reversed span is expressible in the schema.
- **A timed multi-day event in progress appears on NO Today day (found at 8.2, latent).**
  `classifyEventIntoWindows` returns the first matching window and matches a timed event only on its
  start instant, so an event that began before today's local midnight and is still running is
  bucketed nowhere. All-day multi-day events are matched by date containment and do appear. The 24 h
  front padding widens the fetch, not the classification. Not triggered by current data.
- **A `done` event occurrence still renders on Today and Agenda (found at 8.2, latent).** Only
  `skipped` occurrences are excluded, and `status` is absent from `TodayEventItemSchema` and
  `AgendaEventItemSchema`, so a completed occurrence is indistinguishable from a scheduled one.
  `status` is exposed only via `GET /events/range`.
- **`GET /calendar-connections/:id/available-calendars` can write to the database (found at 8.2).**
  It is a live provider pass-through: when the stored access token has under 60 s of life it refreshes
  and UPDATEs the token columns on `calendar_connections`. Harmless, but it is not the read-only probe
  its name suggests. Separately, a failed refresh there surfaces as **500**, not 401, because
  `GoogleOAuthError` carries `httpStatus` rather than the `statusCode` the API's 4xx passthrough tests
  for.
- **`POST /calendar-connections/:id/sync-now` is not a safe read probe (noted at 8.2).** It enqueues
  real sync jobs. Checkpoint 8.2 deliberately used the natural cron instead.


---
- **Mail search does not filter on connection status (8.3, deliberate).** The digest requires an
  active connection; search does not, because a disconnected mailbox's rows are still stored and no
  prune job exists (ADR-057 finding #2). Hiding rows demonstrably in the table would be the
  dishonest option, but it means a disconnected mailbox stays searchable.
- **There is no export affordance in the client (8.3).** `GET /export` is reachable by `curl` or a
  browser from any tailnet machine; saving a file from the app would need new native file-system and
  sharing surface, which this checkpoint did not open.
- **Every client change needs a full APK (standing).** `expo-updates` is not a dependency, so there
  is no OTA channel and each client-side checkpoint costs an EAS cloud build plus a physical
  in-place install. A property of the architecture, not an 8.3 regression.
- **The search error state has never been exercised (8.3).** Reproducing it needs network disruption
  on the owner's daily-driver device. The state is covered by unit tests, not by a device.
- **Notification-shade *inline text* capture (typing directly into a notification action without
  opening the app) is still not shipped (8.4 Lane 3, deferred on evidence) — distinct from what
  Checkpoint 9.1 shipped.** Android direct reply IS natively implemented in the installed
  `expo-notifications@57.0.12`, but with the process dead the reply is parked in a static in-process
  collection and lost if the process dies before JS boots. The durable path needs
  `expo-task-manager`, which is **absent** from the dependency set. **Checkpoint 9.1 instead shipped
  a persistent notification whose tap opens the existing Quick Capture composer** — verified live on
  the Rabbit R1 across repeated taps — which needed neither `expo-task-manager` nor a new dedupe
  fix, at the cost of one extra tap versus true inline reply. Revisiting true inline reply still means
  accepting a background-task framework and a fix to the identifier-based dedupe in
  `use-notification-lifecycle.ts` that would otherwise swallow every reply after the first.
- **Kotlin correctness is only ever verified by the EAS cloud build (8.4).** This machine has no
  JVM, so neither the new `CaptureIntentModule.kt` nor any future native module can be compiled or
  unit-tested locally. The `native-contract.test.ts` guard pins the cross-file strings but cannot
  typecheck Kotlin.
- **The share composer holds text only in component state (8.4).** A share pre-fills the Quick
  Capture sheet; if the app is killed before the owner taps Capture, the draft is gone — the native
  intent was already consumed. Deliberate (consuming once is what prevents duplicates) but it means
  a share is not durable until submitted. The outbox covers everything after that point.
- **Date/time pickers are Android-only (8.4).** `@expo/ui` ships no DatePicker in its `universal`
  build, so the web target keeps the ISO text input via a `.web.tsx` fallback. Acceptable — the
  friction this closes is on the Rabbit — but the two surfaces now differ.
- **`events/new.tsx` still uses hand-typed ISO date fields (8.4, deliberate).** Lane 4 replaced the
  fields named in the recorded debt (task due date and reminder). The event screen has four more and
  was left alone to keep the checkpoint scoped.
- **One 8.4 smoke capture remains in the inbox as lineage.** The task it committed is archived and
  invisible; the `inbox_items` row is not archivable and stays, matching the Gate H smoke-note
  precedent. It is searchable.
- **ADR-054's retention window is explicit and recorded but not configurable (found at the Phase 8
  closeout).** The five windows are constants in `apps/worker/src/jobs/retention-cleanup.ts`; no
  env key exists. The owner chose the windows (8.6C D3–D6), so the decision is satisfied in
  substance; the "configurable" clause is recorded as unmet rather than silently reinterpreted.
  Intentionally deferred.
- **8.6D's monitor URL guard is a literal-hostname regex.** `169.254.0.0/16` is blocked only when
  written as a dotted IPv4 literal; a DNS name resolving there, decimal/hex IPv4 or an IPv6
  link-local literal passes. The probe stores no response body or error text, so the oracle is
  status and latency only, and the routes are Tailscale-perimeter-only (D1e deferred). Security
  debt, Phase 9 candidate alongside D1e.

---

---

## Current objective

**Phase 10 — Codebase Consolidation & Agent Readiness — is open.** Checkpoints 10.0 and 10.1/10.1B
are closed. **Checkpoint 10.1C is implemented, tested (6,054/6,054) and independently reviewed
(zero blocker, zero major) but not deployed**, by the owner's own instruction — its five-step,
api-only deployment plan is written at the end of the 10.1C entry above and waits for explicit
authorization. Until it deploys, production keeps the 10.1B reconnect gap described in the
at-a-glance Canvas row.

The product track is otherwise unchanged by Phase 10 so far: Personal OS has a first read-only
intelligence surface (9.7) and a second, narrower one (9.8) on the 9.6 retrieval layer, exactly as
ADR-056 sequenced. What comes after 10.1C is a product-direction choice for the owner (see *Next
action*).

---

## Completed

Phases 0 through 9 are implemented and production-deployed; Phase 10 is open. Detail for each closed
phase is in `docs/history/`; the one-line summary is:

| Phase | Outcome |
|---|---|
| **0** | Monorepo, Docker Compose, least-privilege DB roles, Tailscale Serve HTTPS, gitleaks. Deployed 2026-08-15. |
| **1** | `/capture`, inbox, LLM tool-calling parser, confidence routing, recurrence engine (both anchors), provider-agnostic AI layer with encrypted credentials. |
| **2** | Expo Router web app, soft-delete model, full CRUD for tasks/notes/projects, always-on web deployment. |
| **3** | Native Android build, device pairing, local exact-alarm reminders, PTT + Groq transcription, offline outbox, Expo Push. **MVP.** |
| **4** | Calendar month/week views, RRULE editor, occurrence detach/cancel, Google Calendar + CalDAV two-way sync. |
| **5** | Today command center, project lifecycle, daily/weekly reviews, unified agenda, manual AI Daily Brief. |
| **6** | Server-side Google Health cloud integration, daily aggregates + sessions, health dashboard (ADR-046). |
| **7** | Gmail `gmail.metadata` integration, incremental sync with cursor recovery, AI mail digest, service-monitoring platform with incident lifecycle. **Deployed 2026-09-01; CLOSED 2026-09-02.** |
| **8** | Consolidation & adoption: failure visibility, real calendar, search + export, capture front doors, owner-terminated soak, `capture.parse` DLQ, Cloud Ask (OFF by default), monitor CRUD, retention cleanup. **CLOSED 2026-09-12** (ADR-061). |
| **9.0** | Reliability & privacy housekeeping: occurrences DLQs + durable failure evidence, 404 query scrub, HRV spec re-observed and re-enabled, OAuth-state sweep wired into retention. **Deployed and accepted 2026-09-12** (ADR-062). |
| **9.1** | Daily-use: notification-shade capture (no new native code), dedicated `alerts`/`updates`/`capture` Android channels, the Rabbit calendar-toggle fix. **Deployed and accepted 2026-09-13**, all three verified on the physical Rabbit R1. |
| **9.2** | 21-day adoption soak. **OWNER-TERMINATED after 25 min** (`2026-09-14T01:28:10.274Z` → `2026-09-14T01:53:37.600Z`; intended end `2026-10-05T01:28:10.274Z`). **No adoption conclusion.** Reviewed read-only observer tooling retained in `scripts/soak/`; record in `docs/SOAK-9.2.md`. |
| **9.3** | Close the capture→task loop: `/inbox/[id]` file-as/dismiss screen, capture follow-through, task complete/reopen/snooze, direct occurrence completion, recurrence integrity (in-transaction successor, validated rules, closed-parent guard), inbox archive (migration `0017`), Brief priority scalars. **Deployed (api/worker/web) and accepted on the Rabbit R1 (versionCode 14) 2026-09-14.** |
| **9.4** | Dependable recurring tasks and reminders: repeat presets, one strictly-after wall-clock successor rule for every writer, nightly lazy repair, occurrence snooze (migration `0018`) and reopen, per-occurrence reminders with Done / Snooze 1h / Tomorrow 9am actions, Today never buckets a recurring parent. **Deployed (api/worker/web, level 19) and accepted on the Rabbit R1 (versionCode 15) 2026-09-14** (ADR-063). |
| **9.5** | Calendar as an authoring surface: explicit event ownership (`events.origin`, migration `0019`), Personal OS-authored events created/edited/cancelled on the Rabbit and synced outward through a durable, idempotent push path (link-derived remote ids, pending-link adoption, race-safe flips, five-minute redrive), write-eligibility from provider roles, whole-series recurrence presets with a round-trip-tested conversion layer, imported events read-only. **Deployed (api/worker/web, level 20) and accepted on the Rabbit R1 (versionCode 17) 2026-09-14** (ADR-064). |
| **9.6** | Search foundation + content bounds: every text field bounded at write (reject typed, truncate provider/model/STT), six-entity tokenised search with a fallback ladder, date tokens, explainable integer scoring, `getItemContext`, mobile search UX with sections/chips/date chip, bounded inputs. **Deployed (api/worker/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 18) 2026-09-15Z** (ADR-065). |
| **9.7** | Personal intelligence, read-only: Cloud Ask widened with a bounded, id-free, wall-clock-only `TodayContext` and three preset questions ("Ask about today"); validated citations (`502 ask_uncited` on an unresolvable ref); nothing stored; no migration; worker untouched; the read-only future-agent tool contract defined (not integrated). **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 19) 2026-09-15** (ADR-066). |
| **9.8** | Suggested Focus: a narrow, cited AI suggestion over today's overdue/due-today tasks, reusing Ask's `TodayContext`/"focus" preset and its `ask` consent switch entirely — zero new intelligence lineage, zero new consent surface. No model call below two candidates (server-enforced); exactly one citation required, validated against the narrower candidate ref set. Deterministic summary renders for free; the AI line is always an explicit tap. Nothing stored; no migration; worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 20) 2026-09-15** (ADR-067). |
| **10.0** | Codebase consolidation & agent readiness: proven-dead mobile/API code removed (Expo starter scaffold, 6 dead query/outbox exports, 3 dormant API error classes, 1 unused health-connection helper, 1 unused test fixture), 4 orphaned Expo dependencies removed (`expo-image`/`expo-status-bar`/`expo-web-browser`/`@babel/plugin-transform-react-jsx`), a duplicate date-parsing implementation consolidated, new `docs/AGENT-READINESS.md` canonical-boundary inventory, `tags`/`item_tags` classified safe-to-drop (not acted on). Zero behavior change, zero migration, worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 21) 2026-09-15.** |
| **10.1** | Canvas LMS integration: read-only, Personal-Access-Token-authenticated sync of courses/assignments/announcements/calendar events into six new tables (migration `0020`), a Today "upcoming assignments" card, a same-origin-checked "open in Canvas" link, CalDAV-derived SSRF protection on `canvas_base_url`. **Deployed (api/worker/web, level 21) and live-validated against the owner's real UTA account and the physical Rabbit R1 (versionCode 22) 2026-09-16** (ADR-068). |
| **10.1C** | Canvas reconnect lifecycle fix: `connectCanvasConnection` SELECTs any prior row by `canvas_base_url` first and reactivates a non-active row in place (same `id`/`created_at`, FK-linked history preserved), refuses an active row (`409 canvas_already_connected`) and a different `canvas_user_id` (`409 canvas_account_mismatch`); route returns 200 on reactivation, 201 on creation. **Implemented, tested and independently reviewed 2026-09-16 (`f85779a`); NOT DEPLOYED — awaiting explicit authorization.** |

**Production is at migration level 21** and serves api, worker and web images built from `1e406f7`.
All three Google integrations plus Canvas are active. Monitoring runs against five active targets
including both Tailscale Serve routes, with full CRUD. A daily retention cron bounds
`monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/`health_sync_runs` and sweeps
expired `health_oauth_states`/`mail_oauth_states`. Every retrying pg-boss queue has a dead-letter
queue. Calendar events authored in Personal OS sync outward to the owner's chosen writable calendar;
imported events are read-only. Search covers tasks, notes, events, projects, captures and mail with
an explainable score, and every text field is bounded at write. Cloud Ask, when the owner enables
it, answers questions about today's schedule with cited sources and can suggest one task to focus
on. Canvas assignments sync hourly and surface on Today. The Rabbit R1 runs `com.himal.personalos`
versionCode 22, built from `1e406f7`.

## Current work

**Checkpoint 10.1C — awaiting deployment authorization.** The fix is committed at `f85779a`
(api only: `apps/api/src/services/canvas-connection.ts`, `apps/api/src/routes/canvas-connections.ts`
and its test file), pushed to `origin`, and on `main`. No other work is in progress.

**Repository housekeeping done 2026-09-16 (this reconciliation, no product change):** `main`
fast-forwarded to the Phase 10 tip and made canonical again (PR #1 merged); the decision log split
into an index plus per-ADR files; Phase 9 closed (ADR-069) and its record partitioned to
`docs/history/phase-9.md`; this file reduced to present state; stale rules in `AGENTS.md`,
`ARCHITECTURE.md`, `CLAUDE.md`, `README.md` and `WORKFLOW.md` reconciled (the list is in the
housekeeping commit messages); merged branches deleted locally and on the remote (which now holds only `main`), the two
never-merged Phase 6 audit originals converted to local `archive/*` tags (not pushed, per
`docs/SOURCE-DURABILITY.md`), and the two token-bearing Expo dev logs plus stray `.DS_Store` files
removed from the primary checkout.

---

## Last verification

**Checkpoint 10.1C (2026-09-16), `f85779a`.** `pnpm build --force` 12/12 · `pnpm typecheck` 23/23 ·
`npx eslint .` clean · `npx prettier --check` clean on every changed file · `git diff --check` clean
· `gitleaks detect` — the same 21 pre-existing findings in one ignored, untracked file
(`apps/mobile/.expo/dev/logs/export.log`), zero new · `pnpm test --force` **23/23 tasks, 6,054 tests
across 13 packages, zero failing**. No migration. Independent adversarial review: zero BLOCKER, zero
MAJOR; one MINOR (no test reactivating from `status: 'invalid_token'`) closed in-checkpoint. Full
record: *Phase 10 → Checkpoint 10.1C* above.

**Documentation reconciliation (2026-09-16).** Doc-only; no code, migration or production change.
Verified: the 73 ADR rows re-assemble byte-exact from `docs/decisions/` (SHA-256 `018d5f03…`);
the Phase 9 block and every replaced present-state section are embedded byte-exact in their history
files (SHA-256 in each banner); `pnpm format:check` and `git diff --check` clean; gitleaks clean on
every commit.

Earlier verification records — 10.1B, 10.1, 10.0, 9.8 back to the Phase 8 closeout — are archived
verbatim in `docs/history/superseded-present-state-2026-09-16.md` §4.

---

## Next action

1. **Deploy Checkpoint 10.1C when the owner authorizes it**, following the plan in the 10.1C entry:
   push is done; tag the running api image `rollback-pre-10.1c` by digest; ship `f85779a` via
   `git archive`; build and verify the api image alone; recreate `api` with
   `--no-deps --no-build --force-recreate`; validate against the real production Canvas connection
   (disconnect → reconnect returns **200 and the same connection id** → resync → the account-mismatch
   guard 409s a synthetic wrong-account token → leave reconnected with the owner's real PAT).
   Worker, web and postgres are untouched; there is no migration.

2. **Then choose the next checkpoint — a product-direction decision for the owner.** Candidates
   carried from the 9.8 and 10.0/10.1 closeouts, none advanced or foreclosed since: widen the Canvas
   integration (course/announcement/event UI beyond the Today card, device-token auth on the new
   routes, wiring `invalid_token` into the worker's failure path so a revoked PAT surfaces itself
   for reconnect); widen the intelligence lane (`get_calendar_context`/`get_task_context`, Option B
   "what changed", Option C weekly-review intelligence); a real tool-calling agent loop over
   `READ_TOOL_NAMES` (needs its own ADR, a `posops_readonly` role and a budgeted grant —
   `docs/AGENT-READINESS.md` §1–2 is the map); E2 health trends; a new 21-day adoption soak (new
   baseline; `scripts/soak/` observer tooling reusable). Two 10.0 items also wait on an explicit
   owner decision rather than being debt: the `tags`/`item_tags` safe-to-drop classification (a table
   drop is irreversible under ADR-024) and the deferred `knip` dead-code-tooling question.

3. **Open owner action outside any checkpoint:** `docs/SOURCE-DURABILITY.md` Option 2 — the encrypted
   configuration copy — is still not done and remains the sharpest source-durability risk.

The per-checkpoint "open, non-blocking, carried forward" observations that 9.4–10.0 appended to this
section (spring-forward early resolution, the 90/91-row fall-back window, `isAbortLikeError`
duplicated four times, the `react-native-css-interop` babel-plugin alignment, and the rest) are
archived verbatim in `docs/history/superseded-present-state-2026-09-16.md` §4. They were not
re-verified at this reconciliation; any that still holds belongs in the ledger above the next time
its area is touched.
