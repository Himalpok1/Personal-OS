# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 10 — Codebase Consolidation & Agent Readiness — OPEN** (opened by the owner
2026-09-15). **Phases 0–9 are complete and production-deployed**; Phase 9 closed under ADR-069 with
no further checkpoint selected. Within Phase 10: **Checkpoint 10.0** (behavior-preserving cleanup and
the `docs/AGENT-READINESS.md` inventory) and **Checkpoint 10.1 / 10.1B** (read-only Canvas LMS
integration, migration `0020`, deployed and live-validated against the owner's real account) are
**deployed and accepted**. **Checkpoint 10.1C — the Canvas reconnect-after-disconnect fix — is
DEPLOYED and LIVE-VALIDATED (2026-09-16, api only, no migration)**: reconnect returned 200 on the
same connection row, history preserved, hourly cron succeeding since. **Checkpoint 10.2 — the
Academic Intelligence Layer — is DEPLOYED (api, worker, web; migration `0021`, level 22),
PRODUCTION-VALIDATED against the owner's real UTA account (2026-09-16 ~17:30Z), and ACCEPTED ON THE
RABBIT R1 (versionCode 25, built LOCALLY on the owner's Mac at ~18:05Z after the EAS quota refused
the cloud build).** The owner's live disconnect → reconnect (22:32Z) closed the last validation step
— and surfaced a **credential-in-log defect**, contained within minutes and fixed the same evening
(hotfix `4c614db`); the owner also decided the academic surfaces show **the current term only**
(ADR-070a, `1edb61b`). Both are **DEPLOYED** (api/worker/web at `1edb61b`, ~22:53Z). **The Canvas PAT
was rotated and the connection reconnected by the owner on 2026-09-17**, live-verified server-side:
the same connection row (`8b8e2cb6…`) reactivated in place, a manual sync succeeded (16 courses/355
assignments/21 announcements), zero token-shaped strings in either log — Canvas is **active** again
and the academic surfaces now show real data. **Checkpoint 10.3 — Academic Intelligence Expansion +
Mobile UX Modernization — is IMPLEMENTED, INDEPENDENTLY REVIEWED and DEPLOYED** (ADR-071; no
migration; api/web recreated at `ba23472`, worker/postgres untouched; the Rabbit R1 accepted on
versionCode 27, built locally). **Checkpoint 10.4 — "Focus Now" unified Today ranking (ADR-072),
Canvas invalid-token alerting with two-run hysteresis (ADR-073), and a four-item mobile polish
bundle — is IMPLEMENTED, VERIFIED (6,530 tests, 23/23 tasks), INDEPENDENTLY REVIEWED clean, and
DEPLOYED** (merged to `main` at `965900f`; worker+web recreated in production, no migration;
api/postgres untouched; the Rabbit R1 accepted on versionCode 28, built locally 2026-09-16 ~23:04Z,
zero crash lines). **Checkpoint 10.5 — Personal Context Layer — is IMPLEMENTED, VERIFIED (6,588
tests, 23/23 tasks), INDEPENDENTLY REVIEWED clean, and DEPLOYED** (merged to `main` at `f29418b`;
migration `0022` applied, level 23; `api`+`web` recreated in production, `worker`/`postgres`
untouched; the Rabbit R1 accepted on versionCode 29, built locally 2026-09-17 ~08:00Z, zero crash
lines): one narrow FK (`tasks.canvas_assignment_id`) plus two new `GET /<entity>/:id/context` read
models and mobile linking UI, live-exercised against real production data and cleaned up after.
**Checkpoint 10.6 — Intelligence + Mobile Experience Expansion — is IMPLEMENTED, VERIFIED (6,824
tests, 23/23 tasks), INDEPENDENTLY REVIEWED (safe after fixes, all closed), merged to `main`
(`3a90c0c` + the `3928dd3` device fix, PR #6) and DEPLOYED** (owner authorized: "Deploy"; no
migration; `api`+`web` recreated in production 2026-09-17, `worker`/`postgres` untouched; the Rabbit
R1 ACCEPTED on versionCode 31 after versionCode 30 crashed on launch and was rolled back and fixed
the same hour — see the 10.6 record):
explainable, context-aware Focus Now, a deterministic client-composed daily briefing, and a motion +
gesture design system on the already-installed Reanimated/gesture-handler stack (ADR-075/076).
**Checkpoint 10.7 — Personal Memory & Preference Layer — is IMPLEMENTED, VERIFIED (7,089 tests,
23/23 tasks), LIVE-VERIFIED IN THE BROWSER against the local database, and INDEPENDENTLY REVIEWED
(safe after fixes; every required fix closed in-checkpoint) on branch
`claude/personal-memory-preference-layer-45c590`, merged to `main` (`436da0f`, PR #7) and
**DEPLOYED** (owner authorized; migration `0023` applied, level **24**; `api`+`web` recreated in
production 2026-09-17 23:58Z, `worker`/`postgres` untouched; the memory lifecycle, Focus Now
influence and privacy boundary validated live against real production data) **and ACCEPTED ON THE
RABBIT R1 (versionCode 32, built locally, installed in place 2026-09-18 02:41Z, create / edit /
delete / toggle walked on-device in light and dark, 0 crash lines). Checkpoint 10.7 is CLOSED.**
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

Rows are as last verified first-hand at the checkpoint named in the row (10.4's deployment check on
2026-09-16 ~23:07Z for the deployment, container and Rabbit rows; 10.1C for Canvas; 9.8 on
2026-09-15 for the others unless stated). The
per-checkpoint acceptance evidence is in the Phase 10 entries below and in `docs/history/phase-9.md`.

| | |
|---|---|
| Migration level | **24** (`0000`–`0023`); local and production agree. 10.7 added `0023_personal_memory_layer` (ADR-077, three tables), applied to production 2026-09-17 23:57Z from the 10.7 api image — 23 → 24 by row count, tracked hash equal to the shipped file's SHA-256. |
| Serving commit | **api and web at `436da0f`** (10.7; recreated 2026-09-17 23:58Z from `personal-os-10.7-release`; rollback `personal-os-{api,web}:rollback-pre-10.7` = the 10.6 images `dccf3ff797df` / `c6e390875f7b`); **worker at `965900f`** (10.4, untouched — 10.5–10.7 changed nothing under `apps/worker`); postgres untouched since 2026-08-30. Previous entry, for provenance: api at `3a90c0c`, web at `3928dd3` (10.6; the fix commit changed only `apps/mobile`, so `api`'s image is byte-equivalent to one built from `3928dd3` and was not rebuilt; api recreated 2026-09-17 10:08Z, web 10:19Z, both from `personal-os-10.6-release`); **worker at `965900f`** (10.4, untouched since — 10.5 and 10.6 changed nothing under `apps/worker`); postgres untouched since 2026-08-30. Provenance is by compose `working_dir`; the images carry no commit label. Rollback: `personal-os-{api,web}:rollback-pre-10.6` = the 10.5 images (`d293d6f813d7` / `7e8cce9615b3`), plus every earlier tag, all by resolved digest. |
| Containers | all four `RestartCount=0`; api `(healthy)` within 8 s of the 10.6 recreation; postgres `postgres:17-alpine` up since 2026-08-30 (never recreated since); `GET /health` → `ok` / `connected` / `stale:false` (2026-09-17 10:08Z) |
| Rabbit R1 | `com.himal.personalos` **versionCode 32**, built from `436da0f` **locally** (10.7; `adb install -r` → `Success` 2026-09-18 02:41Z, `firstInstallTime` 2026-08-19 preserved, exact-alarm `allow`, notifications granted; Memory Center create/edit/delete/toggle walked on-device in light and dark, 0 crash lines). Previous: **versionCode 31**, built from `3928dd3` **locally** (`eas build --local`, profile `production-internal`, the EAS-managed keystore fetched at build time — signer SHA-256 `4601e3a2…` identical to the installed app's, compared with `apksigner` before installing), `adb install -r` → `Success` with `firstInstallTime` 2026-08-19, exact-alarm appop `allow`, `POST_NOTIFICATIONS` preserved — no re-pair. versionCode 30 (from `3a90c0c`) **crashed on launch** (a worklet calling a JS-thread function) and was rolled back to 29 within minutes, then fixed; the 10.6 record has the full account. Today (light + dark), the briefing hero and assignment sheet on real data, Settings and Projects walked live; 0 crash lines on 31. |
| Academic layer (10.2 + ADR-070a) | `GET /academic/today?tz=` · `GET /academic/courses[?include_past_terms=]` · `GET /academic/courses/:id` — a provider-agnostic read model computed over the Canvas tables (ADR-070), **current term only by default** (ADR-070a: the most recently started term, by date — `current_term: 2026 Fall` echoed on the wire), a deterministic Today card and `/academic` course screens, `score`/`grade` synced (ADR-068a; 165 of 355 real assignments carry a grade). **Live and validated**: Today `overdue 2 · due today 1 · due this week 8 · 8 unread` from the 6 Fall 2026 courses (was 11 overdue across 16 courses in 3 terms before the rule); `include_past_terms=true` still lists all 16. |
| Canvas (10.1/10.1B/10.1C + 10.2 hotfix) | `packages/canvas-providers` + six tables, PAT-authenticated, read-only, hourly `canvas.sync-cron`. Connection `8b8e2cb6…` **reactivated in place by the owner's live disconnect → reconnect** (22:32–22:33Z: same row, `created_at` unchanged, 16/355/22 still linked, manual sync `succeeded`). A pasted token is now trimmed and refused if it carries whitespace/control characters, the client refuses to build a header from one, and the api's error serializer scrubs bearer/PAT shapes (hotfix `4c614db`). **Live-validated against the owner's real UTA account 2026-09-16**: connect → sync (16 courses, 355 assignments, 19 announcements, 0 events) → idempotent resync → disconnect (credential triple NULLed) → invalid token rejected (`400 canvas_auth_failed`) → reconnect → resync, left **active**. **Reconnect path (10.1C) verified live 2026-09-16**: disconnect → `200` · reconnect → **`200` on the same row `8b8e2cb6…`** (`created_at` unchanged at 10:50:30Z, all 16 courses still linked) · second connect on the active row → `409` · manual resync `202` → `succeeded` · hourly cron `succeeded` at 12:00:17Z. Zero PAT-shaped strings and zero warn/error lines in the api and worker logs since the api was recreated. |
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
| Test baseline | **7,089 tests across 13 packages** at `436da0f` (10.7, deployed): api 1,568 · mobile 1,903 · core 1,172 · worker 738 · schema 574 · health-providers 332 · api-client 213 · canvas-providers 79 · monitoring 151 · calendar-providers 119 · mail-providers 116 · db 99 · ai-providers 25. Was 6,824 at 10.6 (`3928dd3`). |
| Personal memory (10.7) | **LIVE** since 2026-09-17 23:58Z (level 24); validated against real production data the same hour (lifecycle, Focus Now "You said" explanation on a real ACCT assignment, privacy) and left with 0 rows. Shipped: three tables (`memories`, `memory_suggestions`, `memory_settings`; migration `0023`), `GET/PATCH /memory-settings`, `GET/POST/PATCH/DELETE /memories`, `POST /memories/delete-all`, `GET /memory-suggestions`, `POST /memory-suggestions/:key/decide`, memories in `GET /export`; a Memory Center at `/memory`; Focus Now `matches_preference`/`supports_goal` (+15, capped at the pre-10.7 context ceiling of 75) and a briefing working-hours line, all client-composed by typed link; Guard 6 keeps memory out of every AI lane, the three AI route files, every other read model and the worker. |
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

### Checkpoint 10.1C — Canvas reconnect lifecycle fix: IMPLEMENTED, LOCALLY VERIFIED, **DEPLOYED AND LIVE-VALIDATED** (2026-09-16)

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

**Deployment plan (NOT executed when this plan was written — executed later the same day; see
*Deployment — COMPLETE* below).** Nothing here requires the full frozen order's migration step, since there is no
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

#### Deployment — COMPLETE (2026-09-16, api only, no migration)

**How this record came to be written.** The deployment was executed at 11:44–11:53Z by a session
other than the one recording it; the recording session was asked to "deploy 10.1C" at ~12:30Z,
found on its read-only preflight that the api container had already been recreated from a
`personal-os-10.1c-release` working directory 45 minutes earlier, and **verified the outcome
first-hand against production instead of redeploying**. Everything below was read directly from the
host, the containers, the database and the logs at ~12:32–12:35Z; nothing is inferred from the plan.

| Step | Evidence |
|---|---|
| 1. Release source | `/home/himallinux/personal-os-10.1c-release`, created 11:44Z: 1,066 files, and the README / `docs/STATUS.md` / Phase 0 checklist / mobile README hashes match **`f85779a` exactly** (the fix commit; no `.env`, no `docs/decisions/`). |
| 2. Rollback tag | `personal-os-api:rollback-pre-10.1c` → image `a889dfd2…`, created 09:42Z — the 10.1B api image that was serving. |
| 3. Build + verify | New api image `60cfdb04…` built 11:45:27Z. Inside the **running** container: `dist/services/canvas-connection.js` carries `CanvasAccountMismatchError` (4 hits) and `dist/routes/canvas-connections.js` carries `canvas_account_mismatch` and the `result.created ? 201 : 200` branch. |
| 4. Rollout | api recreated 11:47:57Z, `RestartCount=0`, `(healthy)`. **worker (09:46:10Z, image 09:42Z) and web (09:46:10Z, image 09:42Z) untouched; postgres untouched since 2026-08-30** — nothing else recreated. Migration journal still 21. |
| 5. Validation (real production routes, owner's real UTA account) | 11:48:32Z `POST /canvas-connections/8b8e2cb6…/disconnect` → **200**. 11:52:20Z `POST /canvas-connections` → **200** (reactivation, not 201): row `8b8e2cb6…` **reused** — `created_at` still 10:50:30Z, `status: active`, `canvas_user_name` refreshed, `last_sync_error` null, all 16 `canvas_courses` still linked to the same `connection_id` (10.1B had to delete the row to reconnect; 10.1C keeps its history). 11:52:35Z `POST /canvas-connections` → **409** (the active-row refusal). 11:52:45Z `POST …/sync` → **202**, run `3f6d0c33…` manual **succeeded** 11:52:46Z. 12:00:17Z cron run `ec02a04f…` **succeeded** — the hourly cron works on the reactivated row. |
| Log audit | api log since recreation: **0** PAT-shaped strings (`<digits>~<30+ chars>`), **0** warn/error lines. Worker log since 11:45Z: 2× `canvas.sync.started` / 2× `canvas.sync.finished`, 0 token-shaped strings. 31 queues / 11 schedules unchanged. |
| Perimeter | Both Tailscale Serve routes `tailnet only`; Postgres publishes no host port. |

**One plan step is unprovable in production and is recorded as such, not as done.** Step 5 asked
to "confirm the account-mismatch guard 409s a deliberately-wrong synthetic token". It cannot:
`connectCanvasConnection` calls `getSelf` (token verification) **before** the mismatch check, so a
synthetic token can only ever produce `400 canvas_auth_failed`. The mismatch guard fires only for a
valid PAT belonging to a *different* Canvas account, which the plan itself forbids using. The guard
therefore rests on its unit tests (`canvas-connections.test.ts`: the reconnect/mismatch tests plus
the review-added `invalid_token` reactivation test), and the 409 observed at 11:52:35Z is the
active-row refusal, not the mismatch branch.

**Rollback, if ever needed:** `docker tag personal-os-api:rollback-pre-10.1c personal-os-api:latest`
then the frozen `up -d --no-deps --no-build --force-recreate api`. No schema involved.

---

### Checkpoint 10.2 — Academic Intelligence Layer: IMPLEMENTED, LOCALLY VERIFIED, INDEPENDENTLY REVIEWED (2026-09-16) — NOT DEPLOYED

**Objective (owner-directed, 2026-09-16).** Convert the Canvas data Checkpoint 10.1 already syncs
into user-facing academic intelligence — Canvas data → normalized academic model → Today
integration → user interface — without redesigning or replacing the Canvas connection layer.
Decision records: **ADR-070** (the design) and **ADR-068a** (the one amendment to ADR-068). One
migration, **`0021_canvas_assignment_grades`** (two nullable columns, level 21 → 22).

**Three decisions were put to the owner before any code was written**, because the brief as
received collided with the tree in three places. (1) The four "normalized academic entities" it
asked for already existed as `canvas_courses`/`canvas_assignments`/`canvas_events`/
`canvas_announcements` with every named field; the owner chose a **read model computed over those
tables** (no `academic_*` tables, no normalization job, no second source of truth) over the literal
reading. (2) Two requested fields — grades and an assignment-description preview — were excluded by
the Locked ADR-068 §3 with a code comment requiring "a fresh, explicit owner decision"; the owner
chose **grades only** (ADR-068a). Grading status needed no storage at all (it is the existing
`submission_state`) and percentage is derived, so only `score`/`grade` are new columns. (3) The
brief was truncated after "10.2B … Create deterministic cards: Examples:"; the owner approved the
proposed default card set. One further shape decision was made by the integrator, not asked:
the Today integration is a **separate `GET /academic/today` read model, not a section of
`GET /today`**, so academic data is structurally outside the object both AI collectors consume
(the ADR-046 Health posture) — "no AI processing of academic data" by construction, with an egress
guard on top.

**Execution model.** One integrator wrote the frozen contract first (migration, Drizzle columns,
`packages/schema/src/academic.ts`, the api-client bindings, both ADRs), then three implementation
lanes ran in parallel in the same working tree with disjoint file ownership and their own
test-database clones (`personalos_test_api102`, `personalos_test_worker102`), followed by an
independent adversarial review lane. The brief's separate "Frontend (web)" and "Mobile" lanes were
collapsed into one — Personal OS has one universal Expo client (ADR-002/003); there is no separate
web app.

**What shipped, by lane:**

- **Contract (integrator).** `packages/schema/src/academic.ts`: `AcademicCourse`/`Summary`,
  `AcademicAssignment` (closed `submission.status` and `grade.status` enums with an honest
  `unknown`, derived `open`, derived `grade.percentage`), `AcademicAnnouncement`, `AcademicEvent`
  (kinds `assignment_due`/`calendar_event`/`announcement` — the brief's future-extensibility shape,
  a projection never stored), `AcademicTodayResponse` (sections `overdue`/`due_today`/
  `due_this_week`/`announcements`/`events`, each `{items,total}`, plus `summary` and `configured`),
  the courses list/detail responses, and the horizon/cap constants. Every item carries
  `source_base_url` for the client's same-origin check. `CanvasAssignmentSchema` gained nullable
  `score`/`grade`; its structural guards were flipped so `description`/`entered_*`/`attachments`
  remain rejected and every `Academic*` schema is key-walked for the same names.
- **API lane.** `packages/core/src/academic/{derive,buckets}.ts` — pure, client-safe derivations
  (`normalizeSubmissionStatus`, `isOpenAssignment`, `deriveGradingStatus`, `derivePercentage`,
  `deriveCourseStatus`, `normalizeReadState`) and the bucketing built on the same
  `localDayWindow`/`addCalendarDays` primitives `read-models/today.ts` uses, DST-tested in
  `America/Chicago`. `apps/api/src/read-models/academic.ts` (one `effectiveNow`, one batched query
  per entity kind, active connections and unarchived rows only, every ordering ending in `id`) and
  `apps/api/src/routes/academic.ts` (three GETs). `GET /canvas-assignments/upcoming` is retained
  for the versionCode-22 client with its wire shape **frozen at 10.1** — `CanvasUpcomingAssignmentSchema`
  now `.omit()`s `score`/`grade` structurally (see the review record below for why) — and marked
  superseded for new clients. **Guard 5** in `apps/api/src/ask/ai-egress-guard.test.ts`: nothing
  under `intelligence/`, `ask/`, `focus/`, `brief/` may import the academic read model, core
  `academic/*`, or even name a Canvas table — proven to bite with a temporary probe, then removed.
- **Worker lane.** `translate.ts` carries `score` (finite or null) and `grade` (bounded to 64 chars,
  never rejected) and pins the row's exact 15-key set; `persist.ts` upserts both behind the
  `is distinct from` gate (two identical syncs still write zero rows — count-based `persist.test.ts`
  added). **`invalid_token` is finally written**: a CONNECTION-level `auth_failed` (401, or a
  non-rate-limit 403 on the account's own course list) flips `canvas_connections.status` in one
  UPDATE guarded by `status = 'active'` (mirroring `markMailConnectionNeedsReauth`, so a concurrent
  disconnect is never resurrected); the credential triple is not touched; a per-course 403 is
  contained by the course loop and never reaches the flip; the cron enqueuer already selects
  `active` only; 10.1C's reconnect reactivates any non-active row, so a revoked PAT now surfaces in
  Settings as `needs_reconnect` and recovers without a manual disconnect — closing the 10.1C
  "recorded, not fixed" entry. No alert is enqueued (an alert producer needs its own ADR-058 key).
- **Mobile/web lane.** `queries/academic.ts`; `components/academic/` — `academic-today-card.tsx`
  (owns its query; renders nothing while loading, on error, unconfigured, or empty; header
  "Academics" + "Courses ›"; Overdue/Due today/Due this week with honest totals, ≤ 3 rows each and
  a "+N more" line; Missing/Late badges; a "N unread announcement(s)" footer), `source-link.tsx`
  (**the single `Linking.openURL` call site** — `role="link"` and a handler only when
  `isSameOrigin(html_url, source_base_url)`, otherwise inert), `format.ts`, `partition-assignments.ts`,
  `group-courses.ts` (all pure, all tested); `app/academic/index.tsx` (courses grouped by term with
  open/overdue/next-due) and `app/academic/[id].tsx` (Overdue / Upcoming / No due date /
  Submitted & graded with the grade label, then announcements and events); two `Stack.Screen`
  entries; a Settings "View courses" link. `upcoming-assignments-card.tsx` and its hook deleted; the
  worker's `mobile-inert-rendering.test.ts` allowlist re-pointed. `__tests__/academic-open-url.test.ts`
  is a source-regex guard that no academic file other than `source-link.tsx` imports `Linking`.

**One environment finding worth every future migration's attention.** The local `personalos` and
`personalos_test` databases carried a **poisoned migration watermark**: `0020` had been recorded
with `created_at = 1790375000000` — the +1,000,000,000 journal bug 10.1 later corrected to
`1789376000000` — roughly ten days in the future, so `drizzle-kit migrate` printed "migrations
applied successfully" for `0021` while applying nothing (the Checkpoint 5.7 trap, from the other
direction). Repaired locally (`update … set created_at = 1789376000000 where created_at =
1790375000000`, one row per database). **Production was checked read-only and is clean** —
`0020` at `1789376000000` — so `0021` (`when` `1789377000000`) will apply there normally; the
deployment plan below still verifies the count actually increases. A second local-only gotcha:
a database cloned with `TEMPLATE personalos_test` does not inherit the database-level `CREATE`
grant, so the migrator fails on `CREATE SCHEMA IF NOT EXISTS "drizzle"` without printing an error;
`grant create on database <clone> to posops_migrator` fixes it.

**Verification (integrator, serial, on the shared `personalos_test`):** `pnpm build --force` 12/12 ·
`pnpm typecheck` 23/23 · `npx eslint .` clean (one type-only import in the integrator's own test
fixed) · `npx prettier --check .` clean · `git diff --check` clean · `gitleaks detect` no leaks ·
`pnpm test --force` **23/23 tasks, 6,265 tests across 13 packages, zero failing** (api 1,478 [+45]
· mobile 1,467 [+77] · core 955 [+40] · worker 728 [+18] · schema 540 [+21] · canvas-providers 75
[+5] · api-client 200 [+5]; the other six packages unchanged). One Round-0 miss surfaced by the
full run and fixed: the api-client's `canvas.test.ts` fixture predated `score`/`grade`. **Migration
invariant:** `0021` applied to the local dev database (21 → 22 by row count, columns present) and
`db:reconcile` clean; the `drizzle` journal guard's allowlist extended. `apps/mobile`'s
`expo lint` output is byte-identical to the untouched main checkout (one pre-existing purity error
in `monitor/index.tsx` and nine unused-directive warnings, none in new files).

**Live browser verification (local dev API + Expo web, seeded data, all rows removed after).** A
connection, three courses (two Fall 2026, one completed Summer 2026), eleven assignments spanning
every bucket, three announcements and one event were seeded directly into the local dev database.
`GET /academic/today?tz=America/Chicago` bucketed exactly per the frozen semantics: an assignment
due one hour earlier landed in **Overdue, not Due today**; one due in three hours in Due today; two
in Due this week; a 20-day-out midterm and a 20-day-old announcement outside their windows;
graded/pending-review rows never bucketed; the unread announcement first. Course list ordered by
term with correct open/overdue/next-due counts and the `completed` status; course detail carried
`22 / 20 · 110% · A+` (extra credit, unclamped) and `—` for a pending-review submission; unknown
id → 404, malformed id / missing or invalid `tz` → 400. In the client, the Today card rendered its
three sections, the `Missing` badge and the "1 unread announcement" footer; `/academic` and
`/academic/[id]` rendered as designed at desktop and at the Rabbit's 480 px width; the same-origin
guard was proven **both ways in the accessibility tree** — a row whose `html_url` pointed at
`evil.example.com` was the only assignment row without the `link` role, every `uta.instructure.com`
row and the header "Open this course in Canvas" had it. Setting the seeded connection
`disconnected` made `GET /academic/today` answer `configured:false` with zero totals, the course
detail 404, and the Today card disappear while its neighbours still rendered. Console errors were
the unpaired web session's `/devices` 401s and `/briefs/current` 404 — pre-existing, unrelated.

**Independent adversarial review (a separate agent, no implementation context, read-only,
instructed to verify every claim itself).** Lenses: AI boundary, read-model correctness,
worker/migration safety, mobile safety, contract consistency, hygiene. **One MAJOR, CONFIRMED,
closed in-checkpoint — and it was the integrator's own Round-0 brief that caused it:** the API lane
had been told to add `score`/`grade` to `GET /canvas-assignments/upcoming` because the new
`CanvasUpcomingAssignmentSchema` required them, but the deployed versionCode-22 client parses that
route through the **10.1** form of the same schema, which is `.strict()` — the reviewer reproduced
the rejection (`unrecognized_keys: ["score","grade"]`) with the workspace's zod, and the 10.1
card's own `return null` on a failed query would have made the live Canvas card on the Rabbit
**silently vanish the moment the new api deployed**, for the whole EAS-build/install gap. Fixed by
making the exclusion structural: `CanvasUpcomingAssignmentSchema = CanvasAssignmentSchema.omit({
score, grade }).extend(...).strict()`, the route no longer selects the columns, its test flips to
asserting absence for a graded row, a schema test pins that the 10.1 shape parses and either key is
rejected, and the api-client's `canvas.test.ts` fixture — which the integrator had "fixed" by adding
the two keys, i.e. in exactly the wrong direction — was restored to HEAD and passes unchanged, which
is the proof the deployed contract is intact. **Five MINOR/NOTE findings, all CONFIRMED, all closed:**
Guard 5 was direct-import-only (now also matches the snake_case table names a raw `sql\`` template
would use, and asserts no other `read-models/*` file imports or re-exports the academic module —
the one-hop evasion); `events` used 7×24h arithmetic while `due_this_week` used local days (now the
same local-day horizon end, and an event still in progress is kept rather than dropped — the 8.2
Today debt not repeated here); `include_archived=true` listed courses the detail route then 404'd
(detail now opens an archived course as `status: "archived"`; 404 only for unknown or paused);
`points_possible` rendered as a raw float on the course screen (now `formatPoints`); the academic
query cache was not invalidated by Canvas connect/disconnect/sync (now it is); plus two doc fixes
(the window scope of `unread_announcements_total` documented on the schema; a stale reference to the
deleted card). **One PLAUSIBLE note accepted as debt:** a non-rate-limit 403 on the account's own
course list classifies as `auth_failed` and flips `invalid_token`; a Canvas permission blip would
force a re-paste (recoverable, reversible, no data loss) — a two-consecutive-runs hysteresis is
recorded below, not built. Per-lens verdicts after fixes: A clean, B clean, C clean, D clean, E
clean, F clean. The reviewer's overall verdict before the fix was "not safe to commit as-is" on the
MAJOR alone; every fix was re-verified by the full gate below.

**Unchanged and reaffirmed:** ADR-018 (no new ingress), ADR-024 (Canvas data remains a re-syncable
cache), ADR-056 (no embeddings, no write-capable lane; Cloud Ask and Suggested Focus cannot see
academic data), ADR-058 (no new alert producer), ADR-065 (Canvas rows stay outside `GET /search`
and `GET /export`), ADR-066/067 unchanged.

**Recorded, not fixed:** `GET /canvas-assignments/upcoming`, its frozen `CanvasUpcomingAssignmentSchema`
and the api-client's `listUpcomingCanvasAssignments` have no consumer in the new client; retained
through the 10.2 deployment for the versionCode-22 APK, they can be removed now that versionCode 25
is installed (a small, separate cleanup). `expo doctor` reports 22 Expo SDK 57 patch-version drifts
(`expo 57.0.13` vs `~57.0.23` etc.), a duplicate `expo-constants` (57.0.11/57.0.12) and a missing
`expo-asset` peer of `expo-audio` — non-fatal in every build so far, but an `npx expo install
--check` pass is due before the next native change.
A connection-level non-rate-limit 403 flips `invalid_token` on a single run (no hysteresis). The core logger's
`FORBIDDEN_FIELD_FRAGMENTS` was not extended with `score`/`grade` (the substrings also match
`upgrade`/`underscore`; the guarantee is instead a worker-side log-capture test on every Canvas
line). `unread_announcements_total` is window-scoped (unread within the seven-day section), a
deliberate reading of the schema comment; flip to windowless if the owner prefers. The root
`.prettierignore` excludes `apps/mobile/**`, so a root `prettier --check` is vacuous for the
client (the lane checked from `apps/mobile`); `settings.tsx` was already non-prettier-formatted
at HEAD and only the new hunk is formatted. Relative day labels ("Tomorrow") were not added to
the card. The `personalos_test_api102`/`_worker102` clones were dropped at closeout.

**Deployment plan (as authorized; executed 2026-09-16 — see the record below).** Full frozen
order: commit and push; tag the serving images `rollback-pre-10.2` by digest; `git archive` to a
per-release directory; build all three; verify the new api image carries `0021` and production's
watermark is below it; migrate with `--no-deps`; recreate `api worker web` (never `postgres`);
validate against the real account; EAS build → versionCode 23 → `adb install -r`.

#### Deployment — COMPLETE for api / worker / web (2026-09-16, 17:26–17:31Z); Rabbit build PENDING

**Owner authorization received 2026-09-16 (~17:20Z)** with a step list; this record follows it.

**Step 0 — merge.** `claude/academic-intelligence-foundation-8931dd` fast-forwarded into `main`
(`1a2b5c5` → `7c7164e`, then `b2c273b` after one lint fix — the frozen-upcoming-shape pin test's
unused destructure, caught by linting `main` with eslint's exit code captured rather than piped
through `tail`, which had hidden the summary line in the worktree). Both pushed to the private
`origin`. Final checks on the merged checkout: `pnpm build --force` 12/12 · `pnpm typecheck`
23/23 · `npx eslint apps packages` exit 0 · `prettier --check` clean · `git diff --check` clean ·
`pnpm test --force` **23/23 tasks, 6,265 tests, zero failing** · working-copy gitleaks: the same
nine pre-existing findings in git-ignored local files (`.env`, `apps/mobile/.env`, two
`google-services.json`), history clean. Two environment notes: a root `npx eslint .` from the main
checkout recurses into `.claude/worktrees/*` (three worktrees present, one from another session)
and exhausts the heap — lint `apps packages` explicitly; `git worktree list` showed
`codebase-repo-cleanup-24ab28` and `zen-zhukovsky-11cc89` alongside this one, untouched.

**Step 1 — pre-deployment validation (read-only).** Production journal: 21 rows, `max(created_at)
1789376000000`, **0 future-dated rows** (host clock `1789579478040` ms) — the local watermark
poison was confirmed absent; `0021` (`when 1789377000000`) therefore applies; `score`/`grade`
columns absent (nothing partially applied). Canvas connection `8b8e2cb6…` `active`, credential
present, last cron sync `succeeded` 17:00:18Z (16/355/21/0). `/health` ok, worker `stale:false`,
all four containers healthy; provenance api = `personal-os-10.1c-release`, worker/web =
`personal-os-10.1-release`. Cloud Ask OFF (`ai_task_routes` has no `ask` row).

**Step 2 — rollback point.** Running images tagged by resolved id: api `60cfdb04138c` (10.1C),
worker `c53a04754053` (10.1B), web `c8209f9fcdc5` (10.1B) → `personal-os-{api,worker,web}:rollback-pre-10.2`.
DB 21 rows / `1789376000000`; git api `f85779a`, worker/web `1e406f7`; Rabbit versionCode 22.

**Step 3 — frozen order.** `git archive` of `b2c273b` → `/home/himallinux/personal-os-10.2-release`
(1,175 tracked files; 0 `.env`/`google-services.json`; `docs/STATUS.md` and `README.md` hashes match
`main` exactly). Built api/worker/web (`build_exit=0`, running containers untouched — verified by
image id before proceeding). **Image verification before anything ran:** api carries 22 `.sql`
files with `0021_canvas_assignment_grades.sql` and a journal whose last entry is idx 21 /
`1789377000000`, `dist/routes/academic.js` + `dist/read-models/academic.js`, and the compiled
`omit({` in the schema package; worker `dist/canvas/orchestrate.js` carries `invalid_token`,
`persist.js` the score column, `translate.js` the grade field; no `.env` or private key in the api
image. **Migration** from the new api image with `--no-deps` and the `MIGRATIONS_DATABASE_URL`
pass-through: **21 → 22** by row count, new row `id 22 · created_at 1789377000000 · hash
f8c3ed8896c0…` — byte-identical to the tracked file's SHA-256 — `score real` and `grade text`
both nullable, all 355 assignment rows untouched (0 scored). **Rollout**, each service alone,
`postgres` never named: api recreated 17:30:32Z → `(healthy)`, `/health` ok; worker 17:30:49Z →
`worker.started` with **31 queues / 11 schedules** (unchanged — 10.2 adds no queue); web
17:30:59Z. All `RestartCount=0`; postgres still "Up 2 weeks".

**Step 4 — production validation (real account, real routes).** A manual sync
(`POST /canvas-connections/…/sync` → 202) finished in 28 s: `coursesSeen 16 · coursesFailed 0 ·
assignmentsSynced 355 · announcementsSynced 21 · eventsSynced 0`; **165 assignments now carry
`score` and `grade`** (166 in `graded` state; 1 graded without a numeric score, legitimate); the
connection stayed `active`, credential intact, `last_sync_error` null — the idempotent
content-gated write populated the two columns in one pass, as designed. `GET /academic/today?tz=
America/Chicago` → `configured:true`, `overdue 11 · due_today 1 · due_this_week 8 · missing 5 ·
unread_announcements 12` (5 announcement rows shown, honest total 12; 0 events — the account has
none); every overdue row open and due before `effective_now`, every due-today row at/after it,
sections sorted, every `source_base_url` the owner's own instance, announcements unread-first.
`GET /academic/courses` → 16 courses (2026 Fall 6 · 2026 Spring 5 · Default Term 5), all
`active`, counts and next-due populated. `GET /academic/courses/:id` on the course with the most
grades (a Spring MARK course, 50 assignments, all graded) → 50 numeric percentages **consistent
with `score / points_possible`**, `open` consistent with submission status, `due_at asc nulls
last`, no `description`/`entered_*`/`attachments` key anywhere. **The frozen 10.1 route**
`GET /canvas-assignments/upcoming?within_days=14` → 15 rows carrying `course_name` and
`canvas_base_url` and **no `score`/`grade` key** — the deployed client's contract. Error paths
404 / 400 / 400 / 400. Over the Tailscale HTTPS route the api answers identically.

**Web client (a real browser over Tailscale).** The browser pane now loads `:8443` (the Phase 2
limitation is gone). A throwaway web device `10.2-verification-browser` was paired with a
single-use code minted by `generate-pairing-code.js` in the api container (the
`cp6-security-probe` precedent) and **revoked afterwards** (row retained, `revoked_at` set; 0
unconsumed pairing codes). Verified in the live web app: the **Academics** card on Today with
`OVERDUE · 11` (real compliance-training and INSY rows, a `Missing` badge), `DUE TODAY · 1`,
"+8 more"-style overflow, "Courses ›"; `/academic` — "16 courses across 3 terms", grouped 2026
FALL / 2026 SPRING / DEFAULT TERM with open / overdue (red) / next-due per course; `/academic/[id]`
for `2268-ACCT-2302-004` — `OVERDUE · 2` (one `Missing`), `UPCOMING · 22`, `NO DUE DATE · 2`,
`SUBMITTED & GRADED · 7` with real `score / points · %` labels (`14 / 15 · 93.3%`, `14.94 / 15 ·
99.6%`, a `0 / 5`), every assignment row a `link` (same-origin `uta.instructure.com`); the
header "Open this course in Canvas" is absent because Canvas's courses API returns no `html_url`
for a course (the row is null, so the gated link correctly does not render). Console: only the
pre-existing `/briefs/current` 404s.

**The deployed versionCode-22 Rabbit, on the physical device.** Today → scrolled → the 10.1
"Canvas" card renders with real MATH-1315 rows and due dates against the **new** api — the
regression the adversarial review caught (an added key would have blanked this card behind a
strict schema) proven absent on the device it protects, and doubly important now that the
replacement build is blocked for two weeks. Recorded honestly: the app was relaunched with
`am force-stop` (the project's own record says to use `am kill`), which puts the package in the
stopped state and cancels its alarms; the relaunch cleared the stopped state (`stopped=false`) and
`GET /reminders?horizon_days=30` is currently empty, so **no reminder alarm existed to lose** (0
scheduled before and after); the capture-shortcut notification is present.

**Step 5 — privacy / security.** api log since recreation: 0 PAT-shaped strings, 0 warn/error, 0
lines carrying a `score`/`grade`/`percentage` field; worker log: 0 / 0 / 0 (the `canvas.sync.*`
lines are counts-only). Egress Guard 5 passed in the merged gate; Cloud Ask has no route row, so
no model call can occur at all; `tailscale serve` shows both routes `tailnet only`; Postgres
publishes no host port; the credential triple is present and was never read by anything but the
sync; nothing beyond the six ADR-068 tables plus the two ADR-068a columns is stored.

**Warnings / issues discovered.** (1) **EAS build refused**: "This account has used its Android
builds from the Free plan this month" (resets 2026-10-01); the upload succeeded and the remote
`versionCode` counter ticked 22 → 23 before the refusal, so the next successful build will carry
a higher code. A plan upgrade is a purchase and an owner decision; a local build is impossible on
this machine (no JVM). (2) One `mail.gmail.sync-connection` job started 17:30:36Z on the old
worker, 13 s before that container was recreated, and was expired by pg-boss as `job timed out`
at 17:46:35Z — the documented restart semantics; its `mail_sync_runs` row shows the honest
`failed`-opened-never-finished shape and the next cron `succeeded` at 17:47:53Z; no `retry`/`active`
jobs remain. (3) The disconnect → reconnect regression step was **not exercised live**: it needs
the owner's real PAT, which the integrator does not handle; `apps/api/src/services/canvas-connection.ts`
is byte-unchanged since its 10.1C live validation on this same connection row, and its reconnect
tests passed in the gate. The owner can exercise it from Settings at any time. (4) The
`am force-stop` note above.

**Device build — CLOSED the same day with local tooling (owner-directed, ~17:55–18:10Z).** The owner
chose to stop depending on the EAS build service. Discovery showed nothing needed installing: JDK 17
(`/opt/homebrew/opt/openjdk@17`, not on PATH — the standing "this machine has no JVM" note meant
"not wired up") and a complete `~/Library/Android/sdk` (cmdline-tools, build-tools 36, platform 36,
NDK 27.1, CMake, accepted licenses) were already present; `~/.zshrc` now exports `JAVA_HOME`/
`ANDROID_HOME` and puts `java`/`adb`/`sdkmanager` on PATH. The build is `eas build --local
--profile production-internal` from the main checkout with three env values passed explicitly
(`EXPO_PUBLIC_API_URL`, the production OAuth client id, and `GOOGLE_SERVICES_JSON` as an absolute
path — the git-ignored `apps/mobile/.env` points at `localhost:3000` and the git-ignored
`google-services.json` is not in the archive eas-cli builds from); `credentialsSource: remote` is
unchanged, so the ADR-037 keystore is fetched at build time and no copy lives on disk; local builds
do not count against the EAS quota. **The first local build failed in gradle's bundling step with
`Cannot find module '@babel/plugin-transform-react-jsx'` — the Checkpoint 10.0 recorded
phantom-dependency debt, finally biting**: eas-cli's own eager bundle resolved it, gradle's did not,
and a fresh install cannot resolve the bare name from `apps/mobile/` at all. Closed on `main`
(`8ae7bff`) with `publicHoistPattern: ["@babel/plugin-transform-react-jsx"]` in
`pnpm-workspace.yaml` (pnpm 11 ignores the `.npmrc` form), lockfile unchanged, verified by a
cache-cleared `expo export --platform web` and the second local build: `BUILD SUCCESSFUL in 4m 12s`,
111 MB APK, Hermes bundle carrying the tailnet API URL and no `localhost:3000`. Pre-existing
`expo doctor` findings (22 patch-version drifts, a duplicate `expo-constants`, a missing
`expo-asset` peer) are non-fatal in both cloud and local builds and are recorded as debt below.

**Phase 10.2 production closure status: api / worker / web DEPLOYED and PRODUCTION-VALIDATED; the
Rabbit R1 ACCEPTED on versionCode 25; the live disconnect → reconnect done by the owner (below).**
#### The owner's live reconnect, the credential-in-log incident, and its hotfix (2026-09-16, 22:32–22:55Z)

**The last validation step, done by the owner.** From Settings on the device: Disconnect → Connect
with the PAT → Sync now. Read back from production: the same row `8b8e2cb6…` reactivated
(`created_at` still 10:50:30Z, `updated_at` 22:33:09Z, credential present, `last_sync_error`
null), all 16 courses / 355 assignments / 165 grades / 22 announcements still linked, the manual
sync `succeeded` (16/355/22). 10.1C's reconnect path holds live on the deployed 10.2 api.

**The incident.** The api log for the same window carried the raw PAT **twice**. Two of the owner's
connect attempts had pasted the token with a line break; `personal_access_token` was only
length-checked, `packages/canvas-providers`'s `request()` interpolated it straight into
`Authorization: Bearer <token>`, undici's `Headers.append` refused the header value with a
`TypeError` whose message embeds the ENTIRE value, and the api's generic 500 path logged that
message (`serialize-error.ts` withholds provider-authored messages, and a Node `TypeError` is not
one). The third attempt, with the newline gone, succeeded. **Containment within minutes**: the api
container was recreated from the same image, which deletes the container's json log file with it
(no `sudo` needed); the new container's log has 0 token-shaped strings; the worker log never had
one; nothing ships container logs off the host. **The token also passed through the chat that
delivered it, so rotation is mandatory and is the open owner action** (Canvas → Account → Settings
→ Approved Integrations → revoke; mint a fresh one; reconnect from Settings — the app now trims a
pasted newline).

**The fix (`4c614db`, three layers, mutation-checked).** (1) `CanvasConnectRequestSchema.personal_access_token`
is `.trim()`med, then rejected with `400 validation_failed` if any whitespace or control character
remains (Zod 4 issues carry the pattern and a static message, never the input). (2) `request()`
refuses a header-unsafe token BEFORE any header exists, throwing `CanvasTokenFormatError` — a
static message, nothing from the token — classified `auth_failed`/never retryable, mapped by the
connect service to `canvas_auth_failed`; it runs on every client call, so the worker's hourly sync
with a stored token is covered too. (3) `serializeErrorForLog` withholds any "invalid header
value" message outright (any header value may be a secret) and scrubs `Bearer <token>` and the
Canvas PAT shape from every other message. Tests: schema/client/classifier units, a route test
that a token with an embedded newline is refused before any Canvas call with nothing echoed, and
**a replay of the exact production `TypeError` against the real log stream** (the fake client now
scripts any `Error`) — shown to FAIL with the serializer backstop disabled and pass with it.

#### ADR-070a — the academic surfaces show the current term only (owner decision, 2026-09-16)

After a day on the deployed layer the owner's card read `OVERDUE · 11`, mostly Spring 2026 work and
undated "Default Term" compliance trainings due in March. Decision: **Canvas information in the app
comes from the current term (Fall 2026), not older courses.** Implemented as a pure, date-driven
rule (`packages/core/src/academic/current-term.ts`, `1edb61b`): the current term is the most
recently started term (latest `term_start_at` at or before the build's `effectiveNow`), identified
by its start instant; undated courses are never current; an ended term stays current until the
next starts; with no started term anywhere nothing is filtered. `GET /academic/today` applies it to
every course-scoped section (personal events are never term-filtered); `GET /academic/courses`
defaults to the current term with `include_past_terms=true` to browse older ones; the detail route
still opens any course by id; both responses echo `current_term` (optional on the wire, so the
versionCode-25 client's compiled schema keeps parsing). The sync is unchanged — the filter is a
read-model rule, reversible without a migration.

**Deployment (`1edb61b`, no migration, ~22:50–22:54Z).** Rollback tags `rollback-pre-10.2b` by
image id (api `e4e115eb…`, worker `9c23c00b…`, web `3360ef67…`'s predecessor `163f4ac0…`); `git
archive` to `/home/himallinux/personal-os-10.2b-release` (1,178 files, 0 `.env`/`google-services.json`,
ADR-070a hash matches `main`); all three images built (`build_exit=0`); verified before rollout —
api carries `CanvasTokenFormatError`, the serializer's withheld-message marker, `selectCurrentTerm`
and `CANVAS_TOKEN_SAFE_PATTERN`, worker carries the client guard; api → worker → web recreated in
that order, `postgres` never named, all `RestartCount=0`, 31 queues / 11 schedules, `/health` ok.
**Validated on real data**: `current_term` = `2026 Fall`; Today `overdue 2 · due today 1 · due
this week 8 · unread 8`, every course code on the card `2268-`; courses default 6 (Fall only),
`include_past_terms=true` 16 across 3 terms; a synthetic token with an embedded newline → `400
validation_failed`, one with surrounding newlines → trimmed → `400 canvas_auth_failed` (Canvas
rejected the synthetic value), neither response echoes the token; api log 0 token-shaped strings, 0
warn/error; the live connection untouched. The Rabbit (versionCode 25) needs no rebuild — both
changes are server-side — but it had left the USB bus by then, so its card was not re-read after
the rule; the web client and the API confirm it. Full gate at `1edb61b`: build 12/12, typecheck
23/23, eslint exit 0, prettier clean, **6,292 tests / 23 tasks, zero failing**.
 Rollback, if ever needed: `docker tag
personal-os-{api,worker,web}:rollback-pre-10.2 personal-os-{api,worker,web}:latest` then the
frozen `up -d --no-deps --no-build --force-recreate api worker web`; `0021` is additive, so the
pre-10.2 images run against the post-migration schema.

### Checkpoint 10.3 — Academic Intelligence Expansion + Mobile UX Modernization: IMPLEMENTED, INDEPENDENTLY REVIEWED, DEPLOYED (api/web), ACCEPTED ON THE RABBIT R1 (2026-09-16/17)

**Objective (owner-directed, 2026-09-16).** Two objectives in one checkpoint: turn the 10.2 academic
read model into a daily intelligence system that answers *what needs attention today, what is
approaching, which courses need focus, am I falling behind, what should I do next* — deterministic,
derived from the existing `canvas_*` tables, outside every AI collector — and give the universal
Expo client a production-grade design system so Personal OS "feels like a premium personal
operating system on mobile". Decision record: **ADR-071**. **No migration** (level stays 22), no
new route, no new queue, no new consent surface; the worker is untouched.

**Execution model.** One integrator wrote the design-system foundation first (tokens, primitives,
mocks, navigator theming) and verified it in the browser pane at the Rabbit's 480px width in both
schemes before any screen was built on it; four implementation lanes then ran in parallel with
disjoint file ownership — **A** backend intelligence (`packages/core`, `packages/schema`,
`apps/api`, on its own test-database clone `personalos_test_a103`, dropped at closeout), **B** Today
+ academic surfaces, **C1** Health + Settings + Capture, **C2** the four tabs, Search and every
detail/edit screen — followed by an independent adversarial review lane (record below). The
integrator resolved the cross-lane seams by hand: the Today tab now hides its navigator bar and
draws its own header (greeting as the title, Search/Settings beside it, "+ Event" and "All tasks" as
section actions), stack screens use a `compact` header so the navigator title is never repeated,
and a `containsControl` rule on `ListRow` (plus the calendar day cell) removed the nested
`<button>`-inside-`<button>` the first render produced on web.

**What shipped — academic intelligence (Lane A; rules stated in ADR-071):**

- `packages/core/src/academic/urgency.ts` — `deriveUrgency` (critical ⟺ overdue; high ⟺ due
  < 24 h; medium ⟺ due before the same end-of-local-day + 7 horizon the buckets use; low
  otherwise; undated never urgent), `scoreAcademicPriority` (base 400/300/200/100 by urgency plus
  `marked_missing` +50, `marked_late` +25, `high_points` +25 at ≥ 50 points, over a closed
  six-member reason vocabulary — the ADR-065 search-scoring idiom), `rankAcademicPriorities`
  (score → due → title → id), `deriveWorkloadStatus` (`behind` ⟺ overdue or missing; else
  `at_risk` ⟺ due within 24 h; else `on_track`), `deriveCourseAttention` (high / medium / low /
  none by the same counts); `workload.ts` (today + seven local days of due counts and points,
  zero-filled, from the buckets' own `localDayWindowForDate`); `grade-summary.ts` (graded count,
  mean percentage, points-weighted percentage; an excused graded row counts in the total only).
- `packages/schema/src/academic.ts` — five new `.strict()` shapes and four enums, exposed ONLY as
  **optional top-level keys** (`priorities`, `workload`, `course_attention` on the Today response;
  `grade_summary` on the course detail) — the `current_term` precedent, because the deployed
  versionCode-25 client parses every academic item schema as `.strict()` (the 10.2 review's
  MAJOR); a test pins that the pre-10.3 shape still parses and that `urgency` is rejected on an
  assignment item. Every new schema joined the structural key-walk guard; the enum vocabularies and
  both thresholds are test-pinned equal to core's.
- `apps/api/src/read-models/academic.ts` — the three sections computed inside the existing
  `buildAcademicTodayResponse` (same `effectiveNow`, same current-term scope, same horizon), the
  grade summary inside `getAcademicCourseDetail`; the not-configured response carries every key
  zeroed. Egress Guard 5 passed unmodified.

**What shipped — mobile (integrator + Lanes B, C1, C2):**

- **Design system** (`apps/mobile/src/components/ui/`, `docs/MOBILE-DESIGN-SYSTEM.md`): one token
  file (`tokens.js`, CommonJS so `tailwind.config.js` can require it; `theme.ts` re-exports it typed
  and `theme.test.ts` pins the two equal) — Material 3 colour roles with a dark sibling per role,
  a seven-step type scale, card/inner radii, two card shadows, six gradient presets — and the
  primitives `Screen`/`ScreenFrame`/`ScreenCentered`/`ScreenHeader` (pull-to-refresh, floating
  clearance, `safeTop`, `compact`), `Card`/`GradientCard`, `SectionHeader`, `ListRow`,
  `StatusChip`, `MetricCard`, `ProgressBar`, `Button`/`IconButton`, `EmptyState`/`ErrorState`,
  `Skeleton*`, `Icon`, `triggerHaptic`, `navigationTheme`, `useSyncWebColorSchemeClass`. Three
  Expo SDK 57 modules added (`expo-linear-gradient`, `expo-haptics`, `@expo/vector-icons`) with
  vitest mocks beside the existing `expo-router`/`nativewind` ones (and one for
  `react-native-safe-area-context`, which `Screen` now reads). Tab bar and header icons replace the
  emoji glyphs; the navigator chrome is themed from the palette.
- **One pre-existing web defect fixed:** `darkMode: "class"` has been pinned since Phase 2 but
  nothing ever set the `dark` class on the document, so a browser in dark mode drew a dark
  navigator over light content and every raw colour read through NativeWind's hook was the dark
  value on a light surface (header icons invisible). Verified in the pane before the fix
  (`document.querySelectorAll('.dark').length === 0` with `prefers-color-scheme: dark` matching).
- **Today** rebuilt on the primitives: greeting header (pure `utils/greeting.ts`, hour from the
  query's `dataUpdatedAt`, never a clock read), the one hero gradient (counts only — the summary
  carries no completed count, so no progress is invented), a `MetricCard` stat row, sections on
  `Card`/`ListRow` with honest empty states, `SkeletonScreen`/`ErrorState`, pull-to-refresh; every
  existing behaviour kept (occurrence-first completion with the 409 fallback, review banners, the
  Ask chip and Suggested Focus gated exactly as before, the Brief/Health/Mail/Academic/Reminder
  card slots).
- **Academics card** now answers all five questions: a workload `StatusChip` ("Behind · 1 overdue ·
  1 missing" / "At risk" / "On track"), a "Focus on" row of course chips from `course_attention`
  (high → danger, medium → warning), a "Do next" list of the top three priorities with urgency chips
  (Overdue / Due <24h / This week), the existing Overdue / Due today / Due this week rows, a
  seven-day workload strip, and the unread-announcement footer — every piece guarded for an older
  server that omits the key. `/academic`: semester hero (term, courses, open, overdue, next due),
  a "Show past terms" toggle (new `include_past_terms` api-client binding), course cards with
  overdue/open/next-due chips. `/academic/[id]`: course hero with the grade summary and a clamped
  progress bar, urgency chips on upcoming rows (client-side `deriveUrgency` against the query's
  `dataUpdatedAt` and the device zone's horizon — the one permitted client derivation, as the 10.2
  detail screen already documented for its partition), graded rows with grade labels, announcements
  with a "New" chip. Every provider link still opens only through `source-link.tsx`.
- **Health** (hero, metric grid on cards with the missing-value rule verbatim, chart colours from
  the palette), **Settings** (Integrations / Academics / Monitoring / Devices / Diagnostics /
  Privacy & AI on cards, chips, buttons with `busy` wired to `isPending`; all six
  `confirmDestructive` gates byte-identical), **Capture** (56px primary FAB, bottom-sheet composer
  with a success haptic, PTT circle with a pulsing recording ring, pairing screen), the **four
  tabs**, **Search** (segmented Search/Ask, field well, result cards by type), and every
  task/note/project/event/review/monitor screen restyled without behavioural change; the
  recurrence editor and repeat fields moved onto the palette by the integrator (their one test
  re-pinned from `bg-blue-600` to `bg-primary`).

**Live browser verification (local dev API + Expo web at 480 × 800, light and dark, seeded data
removed after).** A synthetic connection (`https://seed-10-3.example.edu`), four courses (three
Fall 2026, one completed Spring 2026 with an old overdue that must not surface), fourteen
assignments spanning every bucket and two announcements were seeded into the local dev database.
`GET /academic/today?tz=America/Chicago` answered `workload.status: behind` (1 overdue · 1
missing), `points_at_stake 95` (the overdue 100-point paper correctly excluded), priorities
`475 [overdue, marked_missing, high_points] → 300 → 300 → 225 → 200`, course attention `INSY
high · MATH high · ACCT medium`, `days` with the expected per-day counts, and the past-term course
absent; the course detail carried `grade_summary { graded_total 2, average 96.3, weighted 96.3 }`.
Walked in the browser: Today (both schemes), the Academics card with every new block, `/academic`
and a course detail, Health, Settings, Inbox, Notes, Projects, Calendar (month), Search with
results, Tasks and a task detail, the capture sheet; `document.querySelectorAll('button button')`
is 0 on every screen after the `containsControl`/day-cell fixes; a cache-cleared
`expo export --platform web` bundles cleanly (3.3 MB entry, the icon font as its one asset).

**Verification (integrator, serial, on the shared `personalos_test`):** `pnpm build --force` 12/12
· `pnpm typecheck` 23/23 · `npx eslint apps packages` exit 0 and `apps/mobile` `npx eslint .` **0
errors** (the ten pre-existing unused-directive warnings removed with `--fix`; the
`monitor/index.tsx` purity error is gone — it now reads `overview.dataUpdatedAt`; one warning
remains, in the generated, git-ignored `.expo/types/router.d.ts`, confirmed source-free) · root
`npx prettier --check .` clean · `git diff --check` clean · `gitleaks detect --no-git` no leaks ·
`pnpm test --force` **23/23 tasks, 6,477 tests across 13 packages, zero failing** (core 1,014
[+50] · schema 563 [+17] · api 1,496 [+10] · api-client 201 [+1] · mobile 1,574 [+107]; the
other eight packages unchanged; was 6,292 at `1edb61b`; 6,471 before the review fixes). Mobile
prettier: 80 files fail `--check`, every one already unformatted at HEAD (the root
`.prettierignore` skips `apps/mobile` — recorded debt); every new file is formatted and no file
that was clean at HEAD regressed. The one remaining mobile eslint warning is in the generated,
git-ignored `.expo/types/router.d.ts`.

**Independent adversarial review (a separate agent, read-only, no implementation context,
instructed to verify every claim against code and library source; seven lenses).** Verdict:
**safe to commit after fixes — no BLOCKER.** Lenses A (privacy / AI boundary), B (wire
compatibility: HEAD's response schemas are plain `z.object`, zod 4.4.3 strips the new keys, no
`.strict()` item schema gained a field) and C (read-model correctness: every urgency boundary, the
total order, the caps, the DST windows, the grade math) were confirmed clean. **Four MAJOR
findings, all on the mobile half, all closed in-checkpoint:** (1) light-mode gradient text failed
contrast (white-90 on the health gradient measured **2.26:1**, academic 3.16:1) — the light stops
were darkened (`hero`, `academic`, `health`, `warm`, `calm`), `on-gradient-muted` raised from
white-80 to white-90, and `theme.test.ts` now pins white / white-90 ≥ 4.5:1 on every stop of
every white-text gradient; (2) `on-surface-muted` carried 11–13px captions, eyebrows and tab
labels at 3.2–3.7:1 — darkened to `#646A7F` / `#8E95AD`, the `danger` text colour nudged to
`#D12222` (4.43 → 4.86 on the canvas), a `placeholder` role added and `usePlaceholderColor`
routed through it (the old `#737373` read 4.16:1 on the new input wells), and the test pins every
text role ≥ 4.5:1 on every surface plus every on-container pair; (3) Today's completion circle
was drawn in `outline-strong` at 1.57:1 — now `on-surface-variant`, matching Agenda and the
project screen; (4) the web dark-mode "fix" was PLAUSIBLY dev-server-only — **confirmed by a
static `expo export` under `prefers-color-scheme: dark`: `.dark` absent, light rendering** —
because react-native-css-interop pins the scheme to "light" at boot whenever the compiled
stylesheet is already applied; fixed by calling NativeWind's `colorScheme.set("system")` once at
boot before the class sync, re-verified on the export (`.dark` present under dark, absent under
light; a mid-session preference change needs a reload). **Sixteen MINOR findings; fourteen closed:**
the Today event time column truncating a real range (`w-24` at caption size restored, matching
Agenda); the reminder-eligibility banner demoted below three sections in Settings (restored to
the top, above every section — ADR-036); haptics firing on the four navigation "New …" buttons
(`haptic={false}`); `SectionHeader` putting the heading role on the row (moved to the title Text,
the loosened search-screen assertion restored to Text-level); group labels on non-accessible Views
never spoken (`accessible` + `summary` on labelled `Card`/`ListRow`/skeletons and the academic
strip, focus row and grade block); decorative icons not hidden on web (`aria-hidden`); the
segmented control at 40px (44); the tab-bar `HeaderActions` wrapper a handler-less `Pressable`
(`View`); "Do next" re-listing the same assignments as the three buckets, since the priority
candidates are exactly their union (`visibleAcademicSections` now skips ids already shown above,
keeps the honest total, drops a section shown in full; pinned in state and render tests); the
haptic contract having no positive test (one under a stubbed Android platform); the worker's
inert-rendering positive control made vacuous by `<TextField` (re-pinned on `<AppText` and the
results-list testID); the unmigrated `reminder-action-banner` colours; dead code
(`monitorStateToneClass`, the boolean `useAcademicCourses` overload, `inboxStatusLabel`, an
untested `segmentClass` export) and four stale comments. **Two accepted as recorded debt:** the
calendar grids' sub-44px event pills and hour slots (the grid's own geometry), and the three
composites (`ChoiceChip`, `TextField`, `SegmentedControl`) living beside their first consumer.
The review also corrected the claim of "zero behavioural change": the data layer, mutations, all
seventeen `confirmDestructive` gates and every navigation target are unchanged, but ~25 labels
moved to sentence case or lost glyphs ("⟲" → "Repeats"), six entry points went from `Link` to
`router.push`, the Inbox tab's "Confirm as parsed" and the project screen's completion circle no
longer also navigate on web (a nested-Pressable bug at HEAD), `monitor/index.tsx` now reads
`dataUpdatedAt` instead of the clock, and the FAB's pending label reads "Capture…". The docs and
ADR-071 were reconciled to the code after the fixes (closed primitive set → primitives plus three
named composites; the contrast tiers; the haptic rule; the web dark-mode mechanism; the exceptions
list; three shadows, not two; the full mock list).

**Unchanged and reaffirmed:** ADR-018, ADR-024, ADR-056 (no embeddings, no write-capable lane;
Cloud Ask and Suggested Focus cannot see academic data), ADR-058 (no new alert producer), ADR-065
(Canvas rows stay outside `GET /search` and `GET /export`), ADR-066/067, ADR-068/068a, ADR-070/070a.

**Recorded, not fixed:** three composites live beside their first consumer rather than in `ui/`
(`components/calendar/segmented-control.tsx`, `components/ask/choice-chip.tsx`,
`components/ask/text-field.tsx`) — promote when a fourth consumer appears (moving them now would
make the `ui` barrel import itself), and `settings.tsx`/`pairing-screen.tsx` restate the field
well at 42px; the calendar month/week grids' event pills and hour slots are under 44px (the grid's
own geometry); the Settings integration cards show a state chip at both the card and the row
level; the two modal scrims (`bg-black/50` in `events/[id].tsx`, `bg-black/40` in the FAB) and
the on-gradient pill are the documented raw-colour exceptions; a selected `ChoiceChip` shares
`StatusChip tone="primary"`'s colours and differs by radius; destructive confirms fire no haptic;
a web colour-scheme change mid-session needs a reload; `course_attention` renders only on the
Today card, not on `/academic`; relative day labels ("Tomorrow") are still not on the Academics
card; `hours_until_due` is on the wire and unused by the client; the `@expo/vector-icons` font
(~1 MB) is now part of every bundle; toggling "Show past terms" flashes the courses skeleton (no
`placeholderData`); Settings' per-section loading lines still read `Loading…`; the 80 pre-existing
unformatted mobile files. The Rabbit R1 has NOT been rebuilt — every client change
needs a full APK, and the three new modules make this a native rebuild (`eas build --local`, see
the 10.2 record); versionCode 25 keeps working against the new api by construction (optional keys
only), which the schema test pins.

**Deployment plan, as authorized by the owner's written release brief 2026-09-16/17; executed the
same evening.** No migration, so the frozen order minus its migrate step. The plan below is
preserved verbatim; the executed record follows immediately after it.

No migration, so the frozen order minus its migrate step: **Step 0 — merge:**
`claude/phase-10-3-academic-mobile-36b57c` (currently `c7d3f53`, PR opened against `main`) is
fast-forwarded into `main`, matching every prior checkpoint's own "merge before archive" step; the
archive in the step below is of `main`'s new tip, named explicitly at execution time. Then: tag the
serving api/web images `rollback-pre-10.3` by digest (worker untouched — no rebuild, no tag); `git
archive` to `/home/himallinux/personal-os-10.3-release`; build api + web; verify the api image
carries `priorities`/`workload`/`course_attention` in `dist/read-models/academic.js`; recreate
`api` then `web` alone (`--no-deps --no-build --force-recreate`, `postgres` and `worker` never
named); validate `GET /academic/today?tz=America/Chicago` on the real account (every new key
present, `configured: true`, `current_term` Fall 2026) and that the versionCode-25 Rabbit's card
still renders (its strict item schemas ignore the new top-level keys); then
`eas build --local --profile production-internal` → `adb install -r` → walk Today, the Academics
card, `/academic`, Health, Settings, the capture sheet and one dark-mode screen on the device.
**Rollback:** `docker tag personal-os-{api,web}:rollback-pre-10.3 personal-os-{api,web}:latest`
then the frozen `up -d --no-deps --no-build --force-recreate api web`; no schema involved, and the
pre-10.3 client keeps parsing either api.

#### Final release-gate review (2026-09-16/17, before merge) — four parallel lanes

The owner's brief asked for a final review before deployment, on top of the earlier full
adversarial review already recorded above. Four read-only lanes ran in parallel, each narrower
than a full re-audit: **API compatibility & security** (versionCode-25 wire compatibility
re-verified byte-for-byte against the 10.2 commit, `GET /canvas-assignments/upcoming`'s frozen
`.omit()` shape confirmed never reopened, egress Guard 5 confirmed to already cover the new
`academic/*` modules by its directory-prefix regex, zero new log lines, zero credential-shaped
strings, zero migration, zero new route); **mobile design system** (independently re-verified
every one of the prior review's MAJOR fixes against the actual committed code — the darkened
tokens, the checkbox tone, the web boot-fix's own test coverage, the Do-next dedup, the haptic
test, the worker guard re-pin, the Settings banner order — plus a fresh full mobile test run,
1,574/1,574, and a spot-check of four screens not previously named in detail); **academic
intelligence correctness** (an independent hand-verification of the urgency boundaries, the
priority-score reconstruction claim, the ranking total order, the workload/attention thresholds,
the 8-day zero-fill and DST behavior, `points_at_stake`'s window, and the grade-summary math,
against `docs/decisions/ADR-071.md`'s own stated rules); **docs & release checklist** (STATUS.md's
internal number consistency, the deployment plan's executability against
`docs/ARCHITECTURE.md`'s frozen order, ADR-071's accuracy against the actual code, the recorded-
debt ledger's honesty, and PR #3's mergeability). All four returned **deploy-safe** / **release-
ready-with-fix**; the two fixes (a self-contradictory eslint-warning sentence in this file, and
naming the merge-to-main step explicitly in the plan above) were applied in commit `ba23472` before
merge. Full findings are in each lane's own report; nothing here duplicates the earlier adversarial
review's four MAJOR / fourteen MINOR record.

#### Deployment — COMPLETE for api/web (2026-09-16 20:29–20:47Z); Rabbit ACCEPTED (2026-09-17 01:18Z)

**Repository.** `claude/phase-10-3-academic-mobile-36b57c` pushed; PR #3 opened against `main`;
`rollback-pre-10.3` git tag placed at `13d3f89` (the pre-merge `main` tip) and pushed. After the
two release-gate fixes landed as `ba23472`, PR #3 showed `MERGEABLE`/`CLEAN` and was fast-forwarded
into `main` directly (`git push origin HEAD:main`, verified `origin/main` was a strict ancestor of
`HEAD` first) — a true fast-forward, no merge commit, matching WORKFLOW.md's own rule; PR #3
auto-closed as `MERGED`. `main` is now `ba23472`.

**Frozen order, executed.** Images `personal-os-{api,web}:latest` (`39da3c20c5f4`/`3360ef674ca6`,
the 10.2b build) tagged `rollback-pre-10.3` by digest; worker untouched, no tag. `git archive` of
`ba23472` shipped to `/home/himallinux/personal-os-10.3-release` (1,241 files + 154 dirs, matching
the tarball's own entry count exactly; no `.env`, no `google-services.json`). Built `api`+`web`
(`docker compose -p personal-os --env-file .../.env -f docker-compose.yml -f
docker-compose.prod.yml build api web`) — both succeeded. **Verified the new api image before
touching anything running:** `dist/read-models/academic.js` contains `priorities` (×3),
`course_attention` (×2), `workload` (×7), `grade_summary` (×1); `/repo/packages/db/drizzle` holds
22 migration files, highest `0021_canvas_assignment_grades.sql` — level 22, identical to
production's current level (confirmed `select max(created_at)` beforehand: `1789377000000`,
untouched — no migration ran, none was needed); no `.env` or `google-services.json` baked into the
image. Rolled out `api` alone, then `web` alone (`up -d --no-deps --no-build --force-recreate`,
`postgres` and `worker` never named): both `RestartCount=0`, api `(healthy)` within 8 s, `worker`
(3 h uptime) and `postgres` (2 wk uptime) confirmed untouched throughout by their own `docker ps`
uptime. Zero warn/error log lines on `api` in the 60 s following recreation; `worker`'s own cron
jobs (calendar redrive, role refresh, mail sync) kept running on schedule, unaffected.

**Production validation (real routes, real account).** `GET /academic/today?tz=America/Chicago` →
200, every new key present (`priorities`, `workload`, `course_attention`, all correctly zeroed with
an honest 8-entry `workload.days` array) — but `configured: false`, because the real Canvas
connection had independently flipped to **`status: 'invalid_token'`** at `2026-09-16 23:00:18Z`,
over two hours before this deployment (`api` was recreated at `01:34:17Z`) and through code this
checkpoint never touched (`git diff --stat 13d3f89..ba23472 -- packages/canvas-providers
apps/worker/src/canvas` is empty). The worker's own log shows the honest cause:
`canvas.sync.connection_invalidated` / `failureClass: auth_failed` / `error: "CanvasTokenFormatError"`
— the 10.2 hotfix's own header-safety check (ADR from that checkpoint), now rejecting the
already-stored credential at USE time on every sync attempt. Zero PAT-shaped strings appear in
either log across the whole incident. This is not a 10.3 defect and is not new: it converges with
the already-open "rotate the Canvas PAT" owner action from the 10.2 credential-in-log incident —
reconnecting via Settings with a freshly-pasted token (which the app now trims) closes both at
once. `GET /academic/courses` → `200 {"configured":false,...}`; the frozen versionCode-25 route
`GET /canvas-assignments/upcoming?within_days=14` → `200 {"items":[]}` (correctly empty, not
broken). Regression sweep: `GET /today`, `/health`, `/reminders`, `/mail-digests/current`,
`/health-summary` (with `tz`) all `200`; `/briefs/current` `404` (no brief generated today yet —
correct, manual/on-demand per ADR-041); Gmail/Health/Google-Calendar connections all still
`active`; 5 monitor targets; pg-boss shows 63 `completed` jobs in the prior 10 minutes, 0
failed/retry/active.

**Rabbit R1 — built locally, installed, walked on-device.** `main` fast-forwarded in the primary
checkout to `ba23472`; `pnpm install` picked up the new packages. First build attempt used
`EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` read from `apps/mobile/.env` — WRONG:
that file holds the local-dev values (`http://localhost:3000` + a dev OAuth client id), and a
`strings` dump of the resulting APK's `assets/index.android.bundle` confirmed `http://localhost:3000`
baked in with zero occurrences of the tailnet hostname. **Caught before installing; the APK was
discarded, never touched the device.** Re-verified the correct values two ways — `ssh personal-os
"tailscale serve status"` (`https://personal-os.tail62a68f.ts.net`) and `npx --yes eas-cli@latest
env:list production` (same URL; OAuth client id
`868049601968-ebh3hmk43mrtu9utmvj9mb2acs4mb6se.apps.googleusercontent.com`) — and rebuilt with
both hardcoded explicitly. `eas build --local --profile production-internal`, `versionCode` 25 →
27 (the discarded attempt ticked the remote counter to 26). **Verified before installing, the same
way the mistake was caught the first time:** `strings` on the new bundle showed 0 occurrences of
`localhost:3000` and 1 of `https://personal-os.tail62a68f.ts.net`; `apksigner verify --print-certs`
showed the identical SHA-256 (`4601e3a2…`) on the new APK and the currently-installed one (pulled
live off the device first), proving signature continuity before the install was attempted.
`adb install -r` → `Success`. Post-install: `versionCode` 27, `firstInstallTime` preserved at
2026-08-19 (no re-pair), exact-alarm appop still `allow`, `POST_NOTIFICATIONS` still granted,
`stopped=false`.

Launched with `am start` (never `am force-stop`, which cancels alarms). **Screenshots taken
directly off the device** (`adb exec-out screencap`) confirmed, in order: Today renders the
greeting header, the hero gradient ("At a glance" — 0/0/0, fully legible), the stat cards, and
Search/Settings header icons, all on real data; scrolling showed the Health card with real synced
values (1,713 steps · 1.27 km · 175/1,504 kcal) and the Mail Digest card with a real generated
summary (22 emails, 17 unread); the Overdue section correctly rendered the `EmptyState`
("Nothing overdue", green check) and Due-today showed its `SectionHeader` action; **no Academic
card rendered on Today**, which is the correct, honest behavior for `configured: false` — not a
bug. Switching the device to system dark mode (`cmd uimode night yes`) and re-screenshotting
confirmed the hero gradient and every card stayed fully legible in dark mode too. Settings showed
the Canvas integration card with a "needs reconnect" chip and the exact copy "Canvas rejected the
saved access token. Reconnect with a fresh one." — the `invalid_token` state surfaced honestly and
actionably to the owner. `logcat` was cleared before launch and swept for `FATAL EXCEPTION`/
`AndroidRuntime` lines tied to `com.himal.personalos` across the entire session: **zero.** Device
restored to system light mode afterward; no other state changed.

**What was NOT validated live:** the Academic card, `/academic` and course-detail screens with
real populated data, since the only real Canvas connection is currently `invalid_token` (see
above) — this path was validated with seeded local data and by the independent academic-
correctness review lane instead, not against production data, and remains open until the owner
reconnects.

**Post-deployment state:** production serves `api`+`web` at `ba23472` (worker/postgres still on
their pre-10.3 images — no rebuild was needed); migration level 22, unchanged; the Rabbit R1 runs
`com.himal.personalos` versionCode 27 built locally from `ba23472`.

---

### Checkpoint 10.4 — Focus Now + Canvas alert hysteresis + mobile polish: IMPLEMENTED, VERIFIED, REVIEWED, DEPLOYED (2026-09-16/17)

**Objective (owner-directed, 2026-09-16).** Not a new product surface from scratch: make Personal OS
better at answering "what should I focus on right now" — deterministic first, explainable, privacy
preserving, minimal AI calls — plus continue the mobile UX polish pass Checkpoint 10.3 started, plus
close the one concrete reliability gap that let the 10.2 `invalid_token` incident go unnoticed. A
bounded architecture review (three parallel read-only lanes over Today/intelligence, integrations
reliability, and mobile UX) preceded any code; its findings are what selected this scope. **No new
AI surface was built** — Cloud Ask/Suggested Focus/Daily Brief are unchanged, deliberately, per the
owner's own "deterministic first... no unnecessary AI calls" framing and because widening either
would mean touching the Guard 5 privacy wall, which this checkpoint does not do.

**Lane 1 — "Focus Now" (ADR-072).** The Today screen already showed two independently-ranked lists —
personal overdue/due-today items and (Checkpoint 10.3's) academic priorities — that never spoke to
each other; a critical Canvas assignment due in 2 hours and an overdue personal task each looked
"most urgent" in their own card with no way to tell which mattered more. Guard 5
(`apps/api/src/ask/ai-egress-guard.test.ts`) structurally forbids `read-models/today.ts` from
importing academic data at all, so the merge is **client-side only**: a new pure scoring module,
`packages/core/src/focus-now/score.ts` (new `./focus-now/*` subpath export, mirroring `./academic/*`),
scores a personal task on the SAME urgency ladder `packages/core/src/academic/urgency.ts` already
uses (critical/high/medium/low by the identical boundaries) and wraps an already-scored academic
priority item verbatim rather than re-deriving it, then ranks both onto one total order (score DESC,
due-at ASC nulls-last, title ASC, id ASC — ending in `id`, this codebase's standing tie-break rule).
No new API route, no new database access, no AI call, no migration — the card
(`apps/mobile/src/components/today/focus-now-card.tsx`) composes the Today screen's two ALREADY-
FETCHED queries and renders nothing while either is loading, erroring, or both are empty, matching
the Academics card's own discipline. This extends ADR-071's "one permitted client derivation"
precedent to a second, narrowly-scoped case.

**Lane 4 — Canvas invalid-token alerting, with two-run hysteresis (ADR-073, amending ADR-068 §6).**
Every OTHER integration (Gmail, Health, Calendar) fires a deduped push alert the instant its
connection breaks; Canvas was the only one that didn't (`apps/worker/src/canvas/orchestrate.ts`'s
own header comment said so). That gap is exactly what let the real 2026-09-16 `invalid_token`
incident go unnoticed until the academic UI went blank. Because the cron enqueuer only selects
`status = 'active'` connections, the PREVIOUS single-failure flip meant "two consecutive failed
runs" could never occur naturally — sync stopped after the first failure. The fix changes the flip
itself: on a connection-level `auth_failed`, the pass now looks up the immediately preceding
`canvas_sync_runs` row for that connection (no migration — existing table); only if THAT row was
also a connection-level `auth_failed` does it flip to `invalid_token` and fire the new alert
(`apps/worker/src/canvas/alerts.ts`, a direct structural mirror of `mail/alerts.ts`: closed one-
member alert-copy taxonomy, no institution name/base URL/course content in the body, dedupe key
`canvas-invalid-token:<connectionId>:<last_sync_error_at ISO>` under ADR-058's episode-scoped
contract). A single transient permission blip is absorbed (`recordConnectionError` only, status
stays `active`, retried next cron tick); two in a row is treated as real. This also closes the
already-recorded Checkpoint 10.2 debt entry ("a two-consecutive-runs hysteresis is recorded... not
built"). `apps/api`, `packages/schema`, `packages/db` and the credential columns are untouched.

**Lane 2 — mobile polish bundle**, all four items from Checkpoint 10.3's own "Recorded, not fixed"
list, zero new dependencies: (1) `SegmentedControl` promoted from `components/calendar/` into
`components/ui/` — it had already gained a second, unrelated consumer (`app/tasks/index.tsx`),
tripping the design system's own documented promotion rule; both call sites updated, pure
relocation, no behavior change. (2) `apps/academic/index.tsx`'s "Show past terms" toggle no longer
flashes an empty skeleton — `useAcademicCourses` now carries `placeholderData: keepPreviousData`
(TanStack Query), matching the one existing precedent for this pattern (`useSearch`). (3) Five
"Loading…" strings in `settings.tsx` that had no accessible live-region behavior: two whole-section
loading states became `SkeletonList` (already `accessibilityRole="progressbar"`), three inline
single-label states gained `accessibilityLiveRegion="polite"`/`accessibilityRole="text"` so a screen
reader announces the transition instead of silence-then-value. (4) `confirm-destructive.ts` — the
single shared helper every destructive confirmation in the app already goes through — now fires a
warning haptic before the dialog shows, on native only (`triggerHaptic` already no-ops on web/test
environments, so no extra guard was needed).

**Verification (integrator, serial, on the full monorepo).** `pnpm build --force` **12/12** ·
`pnpm typecheck` **23/23** · `npx eslint apps packages` and `apps/mobile`'s own `npx eslint .` both
exit 0 · root `npx prettier --check .` clean · `git diff --check` clean · `gitleaks detect --no-git`
no leaks · `pnpm test --force` **23/23 tasks, 6,530 tests across 13 packages, zero failing** (core
1,031 [+17 focus-now] · mobile 1,600 [+26: 24 focus-now + 2 haptic] · worker 738 [+10 canvas
hysteresis/alerts]; api 1,496, schema 563, db 79, canvas-providers 79, health-providers 332,
ai-providers 25, api-client 201, monitoring 151, calendar-providers 119, mail-providers 116 all
unchanged — neither `apps/api` nor `packages/schema`/`packages/db` was touched this checkpoint, as
scoped). `git status` confirms the three lanes' file sets never overlapped.

**Independent adversarial review — CLEAN, zero CONFIRMED or PLAUSIBLE findings.** Six lenses, run by
an agent with no implementation context, each verified against code and by actually running the
relevant suites rather than trusting comments: **A (AI data leakage)** — neither `focus-now` nor the
new mobile components import anything AI/intelligence-related; `apps/api/src/ask/ai-egress-guard.test.ts`
(including Guard 5) re-run directly, 23/23 passed; the one Canvas-content link an academic row can
reach still routes through the existing same-origin-gated `SourceLink`, not a new call site;
`mobile-inert-rendering.test.ts`'s `Linking` allowlist guard, 4/4 passed. **B (credential exposure)**
— the new hysteresis query and alert producer each select only `{status, failureClass}`/
`{status, lastSyncErrorAt}`, never the credential triple; the alert body is a fixed literal carrying
only a connection UUID, verified against the actual test asserting the payload contains no base URL/
user name/token. **C (new egress)** — the alert producer's only outbound path is the existing
`pg-boss` → `NOTIFICATIONS_DISPATCH_QUEUE` route Gmail/Health/Calendar already use; Focus Now adds no
network call beyond the two already-fetched queries. **D (dedupe-key/hysteresis correctness)** — hand
-verified against a first-ever-sync (no crash, correctly absorbed), two interleaved connections
(query structurally scoped to one `connectionId`), and episode-key uniqueness across a reconnect
(`keyB !== keyA`, proven by an existing test); 30/30 canvas tests re-run on an isolated clone DB.
**E (mobile regressions)** — `triggerHaptic` cannot throw synchronously (async + `.catch(() => {})`),
so the new haptic call cannot block a destructive dialog from showing; the `SegmentedControl`
relocation left no stale import anywhere (`grep` confirmed empty); 35/35 targeted mobile tests
re-run. **F (scope discipline)** — `git diff --stat` confirms the touched set is exactly
`apps/mobile/**`, `apps/worker/src/canvas/*`, `packages/core/focus-now/**` and the two new ADR
files plus their two-line `docs/DECISIONS.md` index addition (the one file outside the three lanes'
stated scope, and that addition is this project's own required ADR-indexing step per `CLAUDE.md`,
not a defect); nothing under `apps/api`, `packages/schema`, `packages/db`, or any migration.

**New ADRs:** `docs/decisions/ADR-072.md` (Focus Now — Locked), `docs/decisions/ADR-073.md`
(Canvas alert hysteresis, amending ADR-068 §6 — Locked); both indexed in `docs/DECISIONS.md`.

**Deployment — COMPLETE (2026-09-16 22:52–23:07Z), owner-authorized ("deploy it").** Repository:
`claude/personal-os-phase-10-4-a254c7` pushed, PR #4 opened, confirmed a true fast-forward
(`git merge-base --is-ancestor origin/main HEAD`), and pushed directly to `main` (`538bd22` →
`965900f`) — the same fast-forward-only pattern Checkpoint 10.3 established; PR #4 auto-closed
`MERGED`.

**Pre-deployment read (production, before anything was touched).** `/health` ok/connected/
`stale:false`; migration `22` rows, `max(created_at) 1789377000000` (unchanged — 10.4 ships no
migration); Canvas connection `8b8e2cb6…` still `invalid_token` since 23:00:18Z the prior day
(pre-existing, unrelated); all four containers healthy, `worker`/`web` on their 10.2b/10.3 images.

**Frozen order, worker + web only (`api`/`postgres` never named).** Running `worker`/`web` images
tagged `rollback-pre-10.4` by digest (`fcc97debae22…`/`1ede9b84f9e7…`). `git archive` of `965900f`
shipped to `/home/himallinux/personal-os-10.4-release` (1,253 tracked files, 0 `.env`/
`google-services.json`). Built `worker`+`web` only — **verified before touching anything running**:
the new worker image's `dist/canvas/orchestrate.js`/`alerts.js` carry
`enqueueCanvasInvalidTokenAlert`; the new web image's served bundle contains the string `"Focus
Now"` (confirmed twice — once against the built image directly, once against the live HTTP
response after rollout). `worker` recreated alone → `worker.started`, **31 queues / 11 schedules**
unchanged, zero warn/error in the first 60s. `web` recreated alone → `200` on its published port.
`api` (`Up 2 hours`, unchanged `StartedAt`) and `postgres` (`Up 2 weeks`, unchanged `StartedAt`)
confirmed untouched by their own container start timestamps throughout.

**Production validation.** `/health` still ok/connected/`stale:false`; migration count unchanged at
22; 56 pg-boss jobs completed in the following 10 minutes, **zero failed/retry/active**; Gmail,
Health and Google Calendar connections still `active` (Canvas unaffected, still `invalid_token`,
pre-existing); both Tailscale Serve routes still `tailnet only`; the live web bundle at
`https://personal-os.tail62a68f.ts.net:8443` re-confirmed to contain `"Focus Now"` over real HTTP,
not just inside the built image.

**Rabbit R1 — built locally, verified before install, installed, walked on-device.** Pre-flight
read of the installed app: versionCode 27, cert SHA-256 `4601e3a2…` (pulled the live `base.apk` and
verified with `apksigner`, matching every prior checkpoint's continuity check). Production env
values re-confirmed via `eas env:list production` rather than trusted from memory —
`EXPO_PUBLIC_API_URL=https://personal-os.tail62a68f.ts.net`,
`EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=868049601968-ebh3hmk43mrtu9utmvj9mb2acs4mb6se.apps.googleusercontent.com`
(deliberately NOT the different, dev-pointed values sitting in `apps/mobile/.env` — the exact trap
Checkpoint 10.3 caught the hard way) — both passed as explicit env vars, plus the absolute
`GOOGLE_SERVICES_JSON` path. `packages/core` rebuilt first so the new `focus-now` subpath actually
resolves. `eas build --local --profile production-internal` → `BUILD SUCCESSFUL in 3m 33s`, 108 MB
APK. **Verified before installing, the same two ways prior checkpoints did:** the Hermes bytecode
bundle extracted and `strings`-checked — 0 occurrences of `localhost:3000`, 1 of `tail62a68f`, 1 of
`"Focus Now"`; `apksigner verify --print-certs` on the new APK showed the **identical** SHA-256
(`4601e3a2…`) to the installed app's, confirmed before `adb install -r` was run. Install → `Success`
(an in-place replace only succeeds on a matching signature, so this is itself signing-continuity
proof). Post-install: **versionCode 28**, `firstInstallTime` preserved at 2026-08-19 (no re-pair),
exact-alarm appop still `allow`, `POST_NOTIFICATIONS` still `granted=true`.

Launched with `am start` (never `am force-stop`, which cancels alarms — the 10.3 lesson). Logcat
cleared before launch and swept for `FATAL EXCEPTION`/`AndroidRuntime` tied to
`com.himal.personalos` across the whole session: **zero**, both immediately after launch and again
after the full walk below. **Screenshots taken directly off the device** confirmed: Today renders
the greeting header, the "At a glance" hero (0/0/0 — this account genuinely has nothing overdue,
due today, or academic-priority right now, so the new Focus Now card correctly renders **nothing**,
the same honest empty-state discipline the Academics card already established, not a bug);
scrolling showed the Daily Brief, Health (1,713 steps · 1.27 km · 175/1,647 kcal) and Mail Digest
cards all rendering real synced data; Settings showed the Canvas integration card with its
"needs reconnect" chip and the exact copy "Canvas rejected the saved access token. Reconnect with a
fresh one." — the pre-existing `invalid_token` state (unrelated to 10.4) still surfaces honestly,
confirming the mobile-polish changes to that same screen didn't disturb it.

**What was NOT validated live:** the Focus Now card's actual populated rendering (candidate items,
reason chips, ranking) and the new Canvas alert firing for real, since the current account has
nothing overdue/due-today/academic-priority right now and the real Canvas connection is
`invalid_token` rather than mid-episode. Both paths are covered by their own test suites (24 and 10
new tests respectively) and were walked with seeded local data during implementation; this is the
same "not validated against production data, covered by seeded data instead" gap Checkpoint 10.3
recorded for its own Academic card before the owner had reconnected.

**Post-deployment state:** production serves `worker`+`web` at `965900f` (10.4); `api`/`postgres`
remain on their pre-10.4 images (10.1C/2026-08-30 respectively) — no rebuild needed, migration level
unchanged at 22. The Rabbit R1 runs `com.himal.personalos` versionCode 28, built locally from
`965900f`.

**Rollback, if ever needed:** `docker tag personal-os-{worker,web}:rollback-pre-10.4
personal-os-{worker,web}:latest` then the frozen `up -d --no-deps --no-build --force-recreate worker
web`; no schema involved, so no rollback-side migration concern either way.

---

### Checkpoint 10.5 — Personal Context Layer: IMPLEMENTED, VERIFIED, REVIEWED — NOT DEPLOYED (2026-09-17)

**Objective (owner-directed, 2026-09-17).** Move Personal OS from "connected data sources" toward
"a system that understands relationships between the user's information" — but a bounded
architecture review (four parallel lanes: context architecture, database/schema impact, search/
retrieval, mobile UX) ran BEFORE any code, and its central finding reshaped the scope: this codebase
already built a generic entity/relationship table once (`item_tags`, Phase 1) and it got **zero
adoption** in a month of real production use — flagged safe-to-drop at Checkpoint 10.0. All four
lanes independently recommended against building the brief's literal "Entity Foundation" / generic
relationship graph. Put to the owner as a three-way scope choice; the owner chose **"read-models +
one real link"**: no generic entity/relationship table, no migration for context retrieval itself,
and exactly ONE new narrow typed relationship — task ↔ Canvas assignment — the one relationship with
real, already-demonstrated product pull (the whole Checkpoint 10.1–10.4 academic-intelligence arc).

**Foundation — `tasks.canvas_assignment_id` (ADR-074, migration `0022`).** One nullable `uuid`
column on `tasks`, FK to `canvas_assignments.id`, `onDelete: set null` — the identical
nullable/set-null shape `projectId` already uses on the same table. No CHECK, no join table, no
generic edge table. **A real migration-tooling ambiguity was resolved empirically, not by
inference**: `packages/db/scripts/reconcile-drizzle-tracking.ts`'s `ADD_COLUMN_DATA_TYPES` allowlist
has never covered `uuid` (or `real`, `boolean`, `bigint`, `smallint`, `integer` — only the types
`0009`/`0010` happened to add) — a genuine, pre-existing gap, confirmed via `git log -p` on that
file. It doesn't block this migration under the actual supported path (`drizzle-kit migrate`, per
`docs/ARCHITECTURE.md`'s frozen order): that allowlist only gates the script's out-of-band-apply
backfill probe, never invoked for a migration whose tracking row was inserted normally by
`drizzle-kit`'s own migrator. Proven on a disposable clone (`personalos_test_1054`, dropped after):
real `drizzle-kit migrate` 21→22, `db:reconcile` clean twice, then the historical failure mode
reproduced ON PURPOSE (deleted the `0022` tracking row, reconcile correctly **aborted**
`unsupported ADD COLUMN type 'uuid'`, fail-closed as designed) and restored. `ON DELETE SET NULL`
verified empirically as the least-privilege `posops_app` role (linked a task, deleted the seeded
assignment, task survived with the FK reset to null). The allowlist gap itself was **not** patched —
recorded as debt below, a decision about a shared safety-critical script, not a side effect of one
column.

**Read-model layer, zero additional migration.** `GET /academic/courses/:id/context` — added
**inside** the existing `apps/api/src/read-models/academic.ts` (already Guard-5-denylisted for every
AI lane, so no new exclusion was needed) — returns the existing course detail (assignments, grade
summary, announcements, events) plus a new `related_reminders` section: unarchived tasks whose
`canvas_assignment_id` matches one of THIS course's own assignment ids, ordered `due_at asc nulls
last, title, id`. `GET /projects/:id/context` — extracted `/projects/:id/detail`'s inline queries
into a new `apps/api/src/read-models/project-context.ts` (byte-identical `/detail` response,
verified by the pre-existing `/detail` suite passing unchanged) and added `related_captures`
(a deterministic join: `inbox_items.entity_type/entity_id` against the project's task/note/event
ids — never a text match, never a guess) and `recent_activity` (task completions, note writes,
occurrence completions in the last 30 days, reusing `isStalledProject`'s own signal categories).
**Privacy boundary, proven not asserted**: `read-models/project-context.ts` imports nothing from
`@personal-os/canvas-providers` and queries no `canvas_*` table — a linked task's
`canvas_assignment_id` surfaces only as an opaque uuid. A dedicated test seeds a Canvas
course/assignment with the title `"Should never appear in a project response"` and asserts that
exact string is absent from the project-context response while the opaque id is present — the
independent adversarial review re-read this test and confirmed it is real, not vacuous. Guard 5
itself (`apps/api/src/ask/ai-egress-guard.test.ts`) is **byte-unmodified**; only Guard 2's
`EXPECTED_BODY_READERS` gained two justified entries for the new body-table reads, per that guard's
own documented extension process.

**Write path — `PATCH /tasks/:id`.** Accepts an optional `canvas_assignment_id: uuid | null`,
mirroring `project_id`'s exact shape. A non-null value is validated against a real
`canvas_assignments` row before the write (`400 validation_failed` otherwise, matching the route's
existing `rruleValidationIssue` shape — there was no `project_id`-equivalent existence check to
mirror, since an invalid `project_id` today relies on the raw FK and would 500). **No other write
path exists anywhere in the codebase.** `apps/worker` was not touched by this checkpoint at all —
confirmed by the adversarial review as the clearest possible evidence against automatic/inferred
linking, since a background write path is exactly the shape a smuggled-in "guess" would take.
`TaskCreateSchema` was deliberately left untouched, so a task cannot be created pre-linked either.

**Mobile.** An "Assignment" field on task detail (`tasks/[id].tsx`), mirroring the existing Project
ChoiceChip picker exactly: pick a course, then an assignment from the same four groups
(Overdue/Upcoming/No-due-date/Submitted-graded) course detail already renders, tap to link
immediately via the PATCH above, tap "None" to clear. A session-scoped client cache
(`academic-assignment-cache.ts`) resolves the linked assignment's display title from whatever
course data has already been fetched this session; on a cold start with nothing cached yet it shows
the honest generic "Linked assignment" rather than fabricating or showing stale text — a documented,
accepted limitation (closing it for real needs a `GET` single-assignment lookup route, out of this
checkpoint's `apps/api` boundary). Two independent zero-schema navigation fixes shipped alongside:
a tappable "Project: {name} ›" row on task/event detail, and tappable course chips on the Academic
Today card (Checkpoint 10.4's Focus Now card is unchanged — this checkpoint deliberately did not
touch it). The new context sections (Related Reminders on course detail; Related Captures and
Recent Activity on project detail) render nothing on loading/error/empty, matching this app's
established discipline, confirmed by the adversarial review reading the actual gating code, not
just the component names.

**Unplanned but necessary fix, caught in-flight.** `packages/schema/src/export.ts` aliases
`TaskExportSchema = TaskSchema` directly, so adding the field to `TaskSchema` silently broke
`GET /export` (3 failing tests) the moment any task row existed. Fixed by adding
`canvas_assignment_id` to `toTaskPayload` in `apps/api/src/read-models/user-export.ts` — same
opaque-id reasoning as the project-context boundary, exactly analogous to the already-exported
`project_id` — and extending `export.test.ts`'s frozen-field-set ratchet.

**Verification (integrator, serial, full monorepo).** `pnpm build --force` **12/12** ·
`pnpm typecheck` **23/23** · `npx eslint apps packages` and `apps/mobile`'s own `eslint .` both exit
0 · root `npx prettier --check .` clean · `git diff --check` clean · `gitleaks detect --no-git` no
leaks · **the shared `personalos_test` and local dev `personalos` databases needed migration `0022`
applied before the full suite would pass** — each implementation lane had correctly tested against
its own disposable clone (per this project's own concurrency rule) rather than the shared DB, so the
first full run showed ~300 failures across unrelated test files purely from the missing column;
applied `drizzle-kit migrate` to both, re-verified the column present in both via a direct query,
re-ran `db:reconcile` against `personalos_test` clean (`23 skipped, 0 reconciled` — every migration
including `0022` already below the watermark) — then `pnpm test --force` **23/23 tasks, 6,588 tests
across 13 packages, zero failing** (api 1,513 [+17] · mobile 1,636 [+... net new across academic/
projects components] · db 79, core 1,031, schema 563, api-client 206 [+5], canvas-providers 79,
health-providers 332, monitoring 151, calendar-providers 119, mail-providers 116, ai-providers 25,
worker 738 all unchanged from 10.4's baseline — `apps/worker` genuinely untouched, above).

**Independent adversarial review — CLEAN.** Eight lenses (migration/schema safety, the
no-automatic-guessing invariant, the Guard 5 privacy boundary, course-context correctness,
write-path validation, mobile regressions/egress, test integrity — re-run directly rather than
trusted, scope discipline). Verdict: **no CONFIRMED or PLAUSIBLE blocking finding.** One low-severity
PLAUSIBLE note, not blocking: a TOCTOU window between the assignment-existence pre-check and the
transactional write (an assignment deleted in that instant would surface as a raw 500, not a clean
400) — the reviewer confirmed this exactly mirrors the pre-existing `project_id` gap on the same
route, and that no production code path anywhere hard-deletes a `canvas_assignments` row (only a
full connection-row cascade, which no route performs — disconnect only nulls credentials). Recorded
as debt below, not fixed, to avoid a one-off inconsistency with `project_id`'s established handling.

**New ADR:** `docs/decisions/ADR-074.md` (Locked), indexed in `docs/DECISIONS.md`.

**Deployment — COMPLETE (2026-09-17 07:45–08:00Z), owner-authorized ("deploy it").** Repository:
`claude/personal-os-phase-10-4-a254c7` pushed, PR #5 opened, confirmed a true fast-forward, pushed
directly to `main` (`de150f1` → `f29418b`); PR #5 auto-closed `MERGED`.

**Pre-deployment read (production, before anything was touched).** `/health` ok/connected/
`stale:false`; migration `22` rows unchanged; all four containers healthy, `api` still on its 10.1C
image, `web`/`worker` still on their 10.4 images.

**Frozen order, WITH a migration step for the first time since 10.2 — `api`+`web` rebuilt,
`worker` untouched.** Running `api`/`web` images tagged `rollback-pre-10.5` by digest. `git archive`
of `f29418b` shipped to `/home/himallinux/personal-os-10.5-release` (1,268 tracked files, 0
`.env`/`google-services.json`, 23 migration files present). Built `api`+`web` only — **verified
before touching anything running**: the new api image's `dist/read-models/academic.js` carries
`getAcademicCourseContext`, `dist/routes/tasks.js` carries `canvasAssignmentId`, a standalone
`dist/read-models/project-context.js` exists, and the image ships `0022_task_canvas_assignment_
link.sql`; the new web image's served bundle contains `"Assignment"`-related strings. **Migration**:
the runtime image ships `drizzle-kit` only as a devDependency (no separate migration image exists),
so it was invoked via `docker compose run --rm --no-deps --entrypoint sh api` with
`MIGRATIONS_DATABASE_URL` passed explicitly (the running `api` container's own environment
deliberately does not carry the migrator credential) — **`22 → 23`**, confirmed by a direct
row-count-and-column query (`canvas_assignment_id | uuid` present) rather than trusting "migrations
applied successfully" alone, per this project's own Checkpoint 5.7 discipline. `api`
recreated alone → `(healthy)`, zero warn/error in the following 60s; `web` recreated alone → `200`.
`worker` (`Up 4 hours`, unchanged `StartedAt`) and `postgres` (`Up 2 weeks`) confirmed untouched by
their own container start timestamps throughout.

**Production validation, live, against real data.** `GET /academic/courses/:id/context` on a real
course (`2262-INSY-3305-002`) returned the full course detail plus the new `related_reminders`
section shape. `GET /projects/:id/context` on a real (archived) project returned `related_captures`
and `recent_activity` sections, correctly empty for a project with none. **The write path was
exercised live and cleaned up afterward**: `PATCH /tasks/:id {canvas_assignment_id}` on a real task
(`"Verify Grok transcription"`) linked it to a real assignment, confirmed via a re-read, then
unlinked back to `null` and re-confirmed — no residue left in production data. 63 pg-boss jobs
completed in the following window, zero failed/retry/active; all four integrations (Canvas, Gmail,
Health, Google Calendar) still `active`; zero warn/error and zero token-shaped strings in the api
log across the whole validation window.

**Rabbit R1 — built locally, verified before install, installed, walked on-device.** Pre-flight:
versionCode 28, cert SHA-256 `4601e3a2…` (pulled and verified with `apksigner`, matching every prior
checkpoint's continuity check). `packages/core`/`schema`/`api-client` rebuilt fresh in the primary
checkout before the client build. `eas build --local --profile production-internal` with the
production env values (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`, absolute
`GOOGLE_SERVICES_JSON` path) → `BUILD SUCCESSFUL`, 108 MB APK. **Verified before installing**: the
Hermes bundle `strings`-checked — 0 `localhost:3000`, 1 `tail62a68f`, the new context-screen UI
strings present; `apksigner` showed the identical SHA-256 to the installed app's. `adb install -r`
→ `Success` (itself signing-continuity proof). Post-install: **versionCode 29**, `firstInstallTime`
preserved (no re-pair), exact-alarm appop still `allow`, notifications still granted. Launched with
`am start`; logcat cleared and swept for `FATAL EXCEPTION`/`AndroidRuntime` across the whole
session: **zero**, both immediately after launch and after the full on-device walk below.
**Screenshots taken directly off the device** confirmed: Today renders cleanly; search for the
production-validation task ("Grok") returned real results; the task's detail screen renders a
genuinely new **"Assignment"** field (graduation-cap icon, "None") beneath the existing Project
field, mirroring that field's exact visual treatment; tapping it expanded the picker and showed real
course chips (`2268-ACCT-2302-004`, `2268-BIOL-1442-002`, etc.) pulled live from the device's synced
Canvas data — the full linking flow reachable and functional on-device, closed without linking
(left as found) to avoid mutating real data from a verification pass.

**Post-deployment state:** production serves `api`+`web` at `f29418b` (10.5); `worker`/`postgres`
untouched; migration level **23**. The Rabbit R1 runs `com.himal.personalos` versionCode 29, built
locally from `f29418b`.

**Rollback, if ever needed:** `docker tag personal-os-{api,web}:rollback-pre-10.5
personal-os-{api,web}:latest` then the frozen `up -d --no-deps --no-build --force-recreate api web`
— migration `0022` is additive-only (one nullable column, one index, one FK), so the pre-10.5 images
run correctly against the post-migration schema; no schema rollback would be needed or performed.

---

### Checkpoint 10.6 — Intelligence + Mobile Experience Expansion: IMPLEMENTED, VERIFIED, INDEPENDENTLY REVIEWED (2026-09-17)

**Objective (owner-directed, 2026-09-17).** Two equal pillars: move Today from "here is your
information" to "here is what matters, why, and what you can do next" — deterministic, explainable,
source-cited, no new AI call, no agent runtime — and make the universal Expo client feel like a
polished consumer product (motion, haptics, swipe actions, sheets, quick actions) on the Rabbit R1's
480×640 screen. External agent frameworks (OpenClaw, Hermes) stay out of scope by the owner's own
instruction. Decision records: **ADR-075** (intelligence) and **ADR-076** (mobile). **No migration**
(level stays 23); `apps/worker`, `packages/db` and `packages/schema/src/academic.ts` untouched.

**A bounded architecture + product review preceded any code** (two read-only lanes, intelligence and
mobile UX). Three findings shaped the scope: (1) every "why" a recommendation needs was already on the
wire or one join away; (2) the one structural gap was that `GET /today` task items did not carry
`tasks.canvas_assignment_id` (ADR-074), so a task could not be recognised as an assignment's own
reminder; (3) `AcademicPriorityReasonSchema` is a closed enum inside a `.strict()` item that the
deployed versionCode-29 client parses with `schema.parse`, so a NEW server-side reason would blank the
Academics card and Focus Now on every installed device — while `TodayTaskItemSchema` is a plain
`z.object` whose optional keys an older client simply strips. On the mobile side the decisive fact was
that `react-native-reanimated@4.5.1`, `react-native-gesture-handler@2.32` and `react-native-worklets`
are ALREADY direct dependencies of `apps/mobile` (via Expo Router), in every shipped APK, with the
worklets babel plugin auto-wired by `babel-preset-expo` — so motion and gestures cost no new dependency
and no native change; nothing in `src/` had used either.

**Execution model.** The integrator made the one wire change first (schema + read model + route
tests), wrote both ADRs as the frozen contract, then ran three parallel lanes with disjoint file
ownership — **C** core intelligence (`packages/core/src/focus-now/**`), **D** design-system motion
(`components/ui/**`, root layout, mocks), **S1** secondary screens on existing primitives (health,
settings, projects, inbox, calendar) — followed by two more once those landed — **S2a** Today / Focus
Now / academic surfaces and **S2b** tasks / agenda / brief / mail / notes / search — and an
independent adversarial review. No lane touched the shared test database; the integrator ran the
root gate.

**Intelligence (ADR-075):**

- **One wire change, additive and optional.** `TodayTaskItemSchema.canvas_assignment_id` (nullable
  uuid, optional), emitted by `read-models/today.ts` for one-off tasks, synthesised recurring parents
  and occurrence rows alike. `brief/collect-input.ts` and `intelligence/today-context.ts` map fields
  explicitly into `.strict()` targets, so the id reaches no model; a route test seeds an assignment
  titled "…must never appear in /today" and asserts the raw body lacks it.
- **Explainability layer** — `packages/core/src/focus-now/{reasons,explain}.ts`: a closed vocabulary
  (academic's six + `top_priority` + six new CONTEXT reasons `linked_assignment`, `project_stalled`,
  `course_attention_high`, `no_submission`, `reminder_set`, `snoozed`), one frozen order
  (`sortReasons`), and per reason a label, a one-sentence deterministic "why" and a `source` from a
  closed set (`task`, `reminder`, `project`, `canvas_assignment`, `course`, `calendar`).
  `explainFocusNowCandidate` returns the ranked explanations plus the auditable equation
  (`400 overdue + 25 P1 + 25 linked assignment = 450`).
- **Context-aware prioritization** — `FOCUS_NOW_CONTEXT_POINTS` (25/25/25/0/0/0) on top of a
  candidate's `baseScore`; an academic candidate's base is the server's score VERBATIM (ADR-072
  holds), context is a separately listed layer (`contextPoints`, `score = base + context`).
- **Linked-task dedupe** — `mergeLinkedCandidates`: a task linked to a priority item collapses into ONE
  row of kind `task` (the thing the owner can complete in-app): max base, summed context + the linked
  bonus, sorted reason union, assignment id retained for display.
- **Deterministic daily briefing** — `composeBriefing` (client composition over `/today`,
  `/academic/today`, `/health-summary` and the merged Focus Now list; sections `academic`, `schedule`,
  `health`, `focus`, every line with a source label and a typed `ref`; omitted when a source is absent;
  the sleep line only when the latest session and 7-day average both exist and the wake date is today
  or yesterday) and `freeBlocks` (08:00–22:00 local, ≥ 60 min, DST-tested on 2026-03-08 and 2026-11-01
  in America/Chicago, all-day excluded, in-progress events truncated). NOT a server read model: Guard 5
  keeps academic out of `/today` and ADR-046 keeps health out of every AI-visible object.

**Mobile (ADR-076):**

- **Design system** (`components/ui/`, `docs/MOBILE-DESIGN-SYSTEM.md` Motion + Gestures sections):
  `motion.ts` (durations, springs, `useMotionEnabled`, `enterFade`/`enterRise`/`exitFade`/
  `layoutSettle`), `animated.ts` (`AnimatedPressable`/`AnimatedView` = `createAnimatedComponent` of
  the interop-wrapped host, so one node takes both `className` and an animated style — the reverse
  registration silently drops the class-derived styles on native), `PressableScale` (0.97 spring; wired
  into `Card`, `GradientCard`, `MetricCard`, `Button`, `IconButton`), `CompletionCircle`,
  `SwipeableRow` (web renders children only), `Toast` (root-mounted host + module-level `showToast`
  for hookless callers), `AnimatedNumber`, `ClampedText` (replacing the two clamp class components),
  `BottomSheet`/`SheetRow`; `ListRow trailingChips/onLongPress/entering`, `EmptyState size="compact"`,
  `MetricCard delta/animate`, `Card variant="soft"`, `IconButton busy/disabled`, `useRefreshControl`;
  `GestureHandlerRootView` outermost in `app/_layout.tsx`; vitest mocks for Reanimated and
  gesture-handler. No token changed; `theme.test.ts`'s contrast contract unchanged.
- **Today, actionable-first**: header → **BriefingCard** (the one gradient block; headline, sections
  with on-gradient source pills, ref lines pressable, the Ask chip kept inside it under the same gate)
  → reminder notice → **Focus Now** (rows with `CompletionCircle`, reason chips capped at 2, a 44px
  "Why?" button opening a sheet with reason → why → source chips, the equation, Open task / Mark done /
  three snooze options through the existing occurrence-first + 409-fallback and snooze mutations;
  swipe Done / Snooze) → Suggested Focus (ask-gated) → Overdue → Due today → Events (compact empty
  state) → Brief → Health → Mail → Academics → a collapsed reviews card → Upcoming (rows pressable) →
  Inbox ("Open inbox") → Projects ("All projects"). The duplicate stat row is gone. Pinned by
  `__tests__/today-screen-order.test.ts`; the two older position pins updated with ADR-076 comments.
- **Academics**: every assignment row (Today card, Focus Now, course screen) opens an in-app
  `BottomSheet` (title, course, due, points, submission, grade, the Focus Now explanation) whose
  "Open in Canvas" still goes through `SourceLink` — the one `Linking.openURL` call site, same-origin
  gated, pinned both ways; the sheet's host is mounted ONCE at the root; `WorkloadBar` and
  `GradeProgress` animate in.
- **Tasks list** rebuilt on `ListRow` + `CompletionCircle` + swipe (Done / Archive through
  `confirmDestructive`) + a "More" sheet (Drop / Reopen / Archive), `formatDueLabel` instead of
  `toLocaleString`, per-status action set pinned byte-identical by pure helpers; **Agenda** on
  `CompletionCircle`; **Brief/Mail** on `ClampedText` + compact empty states; **Notes** swipe-to-archive
  (the list row now confirms — closing that ledger entry for notes); **Search** rows fade in;
  **Health** trends on `SegmentedControl` + a sleep-vs-7-day caption; **Settings** skeletons instead of
  "Loading…", one state chip per integration card, an Integrations summary row; **Projects** progress
  bars and a view hero above the form, the default colour from the palette; **Inbox** Open / Dismissed
  segmented control (Dismissed shows archived rows only — a deliberate reading); **Calendar** one chrome
  row with a compact label under 560px.

**Verification (integrator, serial, full monorepo).** `pnpm build --force` **12/12** · `pnpm typecheck`
**23/23** · `npx eslint apps packages` and `apps/mobile`'s own `eslint .` exit 0 · root
`prettier --check .` clean; every mobile file that was prettier-clean at HEAD still is, every new file
formatted · `git diff --check` clean · `gitleaks detect --no-git` no leaks · `pnpm test --force`
**23/23 tasks, 6,816 tests across 13 packages, zero failing** at `3a90c0c` (6,824 at the `3928dd3` device fix: +8 in the new worklet guard) (core 1,111 [+80] · mobile 1,782
[+146] · api 1,515 [+2]; db 79, schema 563, canvas-providers 79, health-providers 332, ai-providers
25, api-client 206, monitoring 151, calendar-providers 119, mail-providers 116, worker 738 unchanged)
· cache-cleared `expo export --platform web`: entry bundle 3.36 → **4.50 MB** (+1.1 MB, the price of
Reanimated 4 + worklets + gesture-handler), contains `GestureHandlerRootView`. **Live browser
verification** (local dev API + Expo web at 480×800, the real local `personalos` data, light and
dark): the briefing hero ("4 overdue, 1 due today.", a free block sourced "Calendar", three focus
lines sourced "Task"), the Focus Now rows, the explanation sheet ("Overdue — Past its due time ·
Task", "Reminder set — A reminder is scheduled · Reminder", `400 overdue = 400`, actions and three
snooze rows), the rows settling after their entering fade, then the whole new order down to Projects;
`document.querySelectorAll('button button').length === 0`; `.dark` present under the dark scheme.

**Independent adversarial review — SAFE AFTER FIXES, all closed in-checkpoint.** Eight lenses, run by
an agent with no implementation context, every claim re-run rather than trusted. **One CONFIRMED
MAJOR:** the briefing's event adapter read `starts_at ?? occurs_at`, but for a timed recurring
instance `/today` emits `starts_at`/`ends_at` as the series TEMPLATE's instants and `occurs_at` as
today's (the class of bug Checkpoint 5.7.1 fixed in the Brief collector) — so "Next:" and the free
blocks would have been wrong for the owner's real synced classes from the first render; the test had
passed on a fixture shape the server never produces. Fixed (`occurs_at ?? starts_at`, end = start +
template duration) with a regression test on the real wire shape that asserts the free time is split
around the lecture. **One PLAUSIBLE MINOR:** two `AssignmentSheetHost`s subscribed to one
module-global store — Expo Router keeps the Today tab mounted under a pushed course screen, so opening
an assignment there would draw two modals; fixed by mounting the host once at the root beside
`ToastHost`, pins updated. **Notes closed:** ADR-076's "three checkboxes replaced" and "Inbox swipe"
overstatements reworded to the code; the briefing now waits for its two optional sources to settle
before its first render so the gradient block never grows mid-view. Lenses A (AI exposure — the id
cannot reach a model; every egress guard green), B (wire compatibility — `academic.ts` diff empty,
`TodayTaskItemSchema` non-strict), C (intelligence math — hand-checked; DST tests genuinely straddle
the transitions), D (mobile regressions — deliberate changes enumerated and pinned), E (motion — the
animated-host construction verified sound against `react-native-css-interop@0.2.6` and Reanimated's
source), F (tokens), G (test integrity — no pin loosened) CLEAN. Two further integrator finds during
integration: `enterRise` had been built with `.withInitialValues`, which Reanimated's web manager
treats as a custom keyframe and pins `position: absolute` after it ends, collapsing every row of a web
list (now the built-in `FadeInDown`, documented); and `ErrorState`/`EmptyState`'s action button was
`self-start` inside an `items-center` column (pre-existing at HEAD; wrapped and centred).

**Unchanged and reaffirmed:** ADR-018, ADR-024, ADR-041/043 (the AI Daily Brief is untouched — the
deterministic briefing is a separate surface), ADR-046 (health consumed only by the client
composition, never sent), ADR-056/066/067 (no new AI call site; Guards 1–5 green), ADR-058, ADR-065,
ADR-068/068a/070/070a/071/072/073/074.

**Recorded, not fixed:** `runOnJS` in `components/ui/bottom-sheet.tsx` is a deprecated Reanimated 4
re-export (`scheduleOnRN` from `react-native-worklets` is the replacement; it works today and needs a
vitest mock for the worklets package to switch); `components/academic/grade-progress.tsx` restates
the on-gradient `bg-white/25` / `bg-white` pair rather than reusing `ProgressBar`'s `onGradient`
variant (an animated fill the primitive does not offer); the project screen still draws its own
completion circle; no Undo action on the completion toasts; snooze-from-Today is offered only for
one-off tasks and occurrence rows (a recurring parent row has no instance to snooze); the
+1.1 MB web bundle; `BriefingTodayInput.inboxAttentionTotal` is accepted by core but no briefing line
reads it yet; the Settings hub split, a persisted appearance preference and the FAB/PTT band remain
candidates.

#### Deployment — COMPLETE for api/web (2026-09-17 10:05–10:09Z), owner-authorized ("Deploy")

**Repository.** `claude/phase-10-6-kickoff-f61cf9` pushed; PR #6 opened; confirmed a true
fast-forward (`git merge-base --is-ancestor origin/main HEAD`) and pushed to `main`
(`8e3bd9b` → `3a90c0c`); PR #6 auto-closed `MERGED`.

**Pre-deployment read (production, before anything was touched).** `/health` ok/connected/
`stale:false`; migration `23` rows, `max(created_at) 1789378000000`; api/web on the 10.5 images,
worker on 10.4; all four integrations `active`; the one `failed` pg-boss job the documented
2026-09-16 mail-sync timeout; Rabbit R1 on the USB bus at versionCode 29.

**Frozen order, `api` + `web` only, no migration.** `git diff --stat 8e3bd9b..3a90c0c -- apps/worker
packages/db` is empty, so `worker` was neither rebuilt nor tagged. Running `api`/`web` images tagged
`rollback-pre-10.6` by id (`d293d6f813d7` / `7e8cce9615b3`). `git archive` of `3a90c0c` shipped to
`/home/himallinux/personal-os-10.6-release` (1,316 tracked files; no `.env`, no
`google-services.json`; 23 migration files; the ADR-075 SHA-256 identical to the worktree's). Built
`api`+`web` (`build_exit=0`, running containers untouched — verified by `docker ps` before and after).
**Verified before rollout:** the api image's `dist/read-models/today.js` carries `canvasAssignmentId`
and `canvas_assignment_id`, `packages/schema/dist/today.js` carries the key, 23 `.sql` files with
`0022_task_canvas_assignment_link.sql` last (equal to production's watermark, so no migrate step —
the 10.3/10.4 precedent), no `.env`/`google-services.json` baked in; the web image's served bundle
(4.50 MB) contains `GestureHandlerRootView` ×2, "Focus Now", "Why it's here", "Past its due time",
"Open in Canvas" ×2, the tailnet hostname once and `localhost:3000` never. `api` recreated alone →
`(healthy)` after 8 s, `/health` ok; `web` recreated alone → `200` on its published port. `worker`
(started 03:57Z) and `postgres` (started 2026-08-30) confirmed untouched by their own start
timestamps; all four `RestartCount=0`.

**Production validation (real routes, real account).** `/health`, `/today`, `/academic/today`,
`/academic/courses`, `/reminders`, `/health-summary`, `/mail-digests/current`, `/search` all `200`
locally and `/today` + the web root `200` over the Tailscale HTTPS route. `GET /academic/today` on
the real account: `configured: true`, `current_term 2026 Fall`, 5 priority items whose reason
vocabulary is exactly the pre-10.6 set (`overdue`, `due_within_24h`, `due_this_week`,
`marked_missing`, `high_points`) — the installed versionCode-29 client's strict schema keeps parsing,
as ADR-075 §5 requires. **The real account currently has zero open personal tasks** (`overdue 0 ·
due_today 0 · upcoming 0 · inbox 0 · projects 0`), so the new `canvas_assignment_id` key could not be
observed on live data; it rests on the two route tests, which ran on the identical code. api log
since recreation: **0** warn/error lines, **0** token-shaped strings; 71 pg-boss jobs completed in
the following window, 0 failed/retry/active.

**Rabbit R1 — the first local build CRASHED ON LAUNCH; fixed, rebuilt, ACCEPTED on versionCode 31
(2026-09-17 10:13–10:27Z).** `eas build --local --profile production-internal` from `3a90c0c` with
the production values hardcoded (never from `.env`) → `BUILD SUCCESSFUL in 3m 40s`, versionCode 29 →
30, 113.7 MB. Verified before installing: `strings` on the Hermes bundle — 0 `localhost:3000`, 1
tailnet hostname, "Focus Now" / "Why it's here" / "Past its due time" / `GestureHandlerRootView`
present; `apksigner` SHA-256 `4601e3a2…` identical to the installed app's (pulled live first).
`adb install -r` → `Success`, `firstInstallTime` 2026-08-19 preserved, exact-alarm appop `allow`,
`POST_NOTIFICATIONS` granted. **Launched with `monkey` (never `am force-stop`) → `FATAL EXCEPTION:
main` on the first frame: `[Worklets] Tried to synchronously call a Remote Function. Called
"anonymous" on the UI Runtime` from `bottomSheetTsx3 → styleUpdater(useAnimatedStyle)`.** Cause:
`components/ui/bottom-sheet.tsx`'s sheet-style worklet called the exported, non-worklet
`sheetTranslateY` helper — legal under the vitest mocks (identity `useAnimatedStyle`) and on web
(no UI runtime), fatal on Android; and because the assignment sheet's host had just been moved to
the root, the crash was at launch, not on first open. **Containment first:** the versionCode-29
`base.apk` pulled for the signature check was reinstalled in place (`adb install -r -d`), the app
relaunched clean (0 crash lines), grants intact. **Fix (`3928dd3`):** the arithmetic inlined in the
worklet, the helper marked `"worklet"`, and a new source guard
`apps/mobile/src/__tests__/worklet-safety.test.ts` that reads every `useAnimatedStyle` /
`useAnimatedProps` / `useDerivedValue` body under `components/` and `app/` and allows only `.get()`,
`Math.*` and named, directive-checked worklets — shown to FAIL with the bug reintroduced and pass
with it fixed. Every other worklet in the tree (`PressableScale`, `CompletionCircle`,
`GradeProgress`, `WorkloadBar`, `AnimatedNumber`'s `formatGroupedInteger`) was audited clean by the
same guard. Mobile suite 1,790 (+8), typecheck/eslint/prettier clean; pushed to `main`
(`3a90c0c` → `3928dd3`, a mobile-only diff — `apps/api`/`packages` byte-identical), the release
directory re-shipped and `web` alone rebuilt and recreated from it (bundle re-verified; `api`,
`worker`, `postgres` untouched — `api`'s image is unaffected by a mobile file). Rebuilt →
`BUILD SUCCESSFUL in 3m 27s`, **versionCode 31**, bundle re-verified (0 `localhost:3000`, 0
`sheetTranslateY(progress` calls), signer identical → `adb install -r` → `Success`,
`firstInstallTime` preserved, grants intact, `stopped=false`.

**On-device walk (versionCode 31, real production data, screenshots off the device).** Cold launch →
Today: greeting header, the **briefing hero** with real data — "2 overdue, 1 due today." · Academics
"2 overdue / 1 due today / 7 due this week / You're behind" each sourced `Canvas assignment`, "8
unread announcements" sourced `Course` · Schedule "Free 08:00–22:00 (14h 00m)" sourced `Calendar` ·
Health "Slept 8h 44m — in line with your 7-day average (8h 40m)" sourced `Health` · Focus now lines
with source pills; every line spoken with its source in the accessibility tree (`uiautomator dump`:
"2 overdue. Source: Canvas assignment", "Podcast 3 — Past its due time. Source: Canvas assignment.
Opens details."). **Focus Now** rows: real ACCT/MATH/INSY assignments with `Overdue`/`Missing`/
`Course needs attention`/`Due <24h`/`High points` chips capped at two with `+N`. Tapping a briefing
focus line and a Focus Now row each opened the **assignment sheet** (the component that had
crashed): `Missing` chip, course, due, points, "Why it's here" with four reasons and their source
chips, the equation `450 Canvas priority + 25 course attention = 475`, "Open in Canvas" — closed
by its X and by BACK. **Dark mode** (`cmd uimode night yes`): the hero and the Focus Now card fully
legible, chips in their dark containers; restored to light afterwards. **Settings**: the new
Integrations summary row (Calendar · connected, Gmail · connected, Health · current, Canvas ·
connected) and one state chip per card; **Projects** tab renders its empty states. Logcat swept for
`FATAL EXCEPTION` after every step: **zero** across the whole versionCode-31 session. Not exercised
on the device (no data or would mutate real data): a completion, a snooze, a swipe panel, the Tasks
list rows (the account has zero open tasks), the toast; all covered by their suites and the web walk.
One mis-tap during the walk opened Android's own Settings (a swipe from the top edge pulled the
shade); nothing there was changed.

**Rollback, if ever needed:** `docker tag personal-os-{api,web}:rollback-pre-10.6
personal-os-{api,web}:latest` then the frozen `up -d --no-deps --no-build --force-recreate api web`;
no schema involved. The Rabbit rolls back by reinstalling a pulled earlier `base.apk` with
`adb install -r -d`, as the versionCode-30 incident did within minutes.

---

### Checkpoint 10.7 — Personal Memory & Preference Layer: IMPLEMENTED, VERIFIED, LIVE-VERIFIED, INDEPENDENTLY REVIEWED (2026-09-17) — NOT DEPLOYED

**Objective (owner-directed, 2026-09-17).** Move Personal OS from "understands today's context"
toward "understands stable user preferences, goals and explicitly saved knowledge" — the foundation
a future agent layer would build on — under four principles: explicit, explainable, editable,
minimal. Forbidden by the brief: hidden behavioural tracking, automatic personality profiling,
unrestricted AI memory, a knowledge graph, a "remember everything" system, silent extraction of
personal facts. Decision record: **ADR-077** (Locked). One migration,
**`0023_personal_memory_layer`** (three tables, level 23 → 24). Branch
`claude/personal-memory-preference-layer-45c590`, three commits on `5e51606` plus the review-fix
commit; `apps/worker` byte-untouched.

**A bounded architecture review preceded any code** — four parallel read-only lanes (intelligence
integration, data model and migration methodology, mobile UX, privacy boundary) — and its findings
converged: the `FocusNowReason` vocabulary is core/client-only, so memory reasons cost no wire
change and no deployed-client risk; every "preference-like" datum that already exists
(`devices.notify_*`/`quiet_hours_*`, `ai_task_routes`, `projects.goal`, `reviews`,
`occurrences.snoozed_until`) stays where it is; memory must be deterministic-only and structurally
invisible to every AI lane; and every behaviour-derived suggestion ("you work best in the evening"
from `completed_at`) is automatic profiling and out. **Four scope decisions were put to the owner
and decided** before the contract was written: deterministic-only (no memory in any prompt);
explicit-moment suggestions only; two narrow links (`project_id`, `canvas_course_id`); the global
switch ships ON (nothing exists until the owner adds it; nothing leaves the machine).

**Execution model.** Round 0 (integrator): the frozen contract — migration, Drizzle schema, the Zod
wire shapes, api-client bindings, ADR-077, Guard 6, `"statement"` in the logger's forbidden-field
list — proven on a disposable clone (`drizzle-kit migrate` 23 → 24 by row count, `db:reconcile` clean
at 24 tracked, `posops_app` insert/delete through default privileges with no explicit GRANT) and then
applied to the shared `personalos_test` and dev `personalos` (both 24) before any lane started (the
10.5 lesson). Round 1: three parallel lanes with disjoint ownership — **API** (routes, read model,
export, tests, on clone `personalos_test_api107`), **core** (`packages/core` only), **mobile Memory
Center** (`components/memory`, `app/memory`, Settings, the project-goal moment). Round 2: one lane
wired memory into Today (`components/today` only). Then the root gate, a live browser walk, and an
independent adversarial review whose required fixes were closed in-checkpoint.

**What shipped:**

- **Schema (`0023`).** `memories` (CHECKed `kind` ∈ preference|goal|fact, `statement` ≤ 1 000,
  `note` ≤ 2 000, CHECKed `source` ∈ user|suggestion, `suggestion_id`/`project_id`/`canvas_course_id`
  all nullable `ON DELETE SET NULL`, `(kind, updated_at)` index), `memory_suggestions` (unique
  deterministic `suggestion_key`, CHECKed `suggestion_kind` ∈ {project_goal}, CHECKed `status` ∈
  accepted|dismissed|never, `ask_again_after`, **no text column**), `memory_settings` (a CHECKed
  singleton, `enabled` default true). Typed columns, no jsonb, no edge table — ADR-074's rule
  applied on a new table. Rollback is image-only; the migration is purely additive.
- **API.** `read-models/memories.ts` (read-only; resolved project/course names; pending suggestions
  computed at request time from `projects` with `goal`, minus decided keys and goal memories already
  linked, capped at 20, `[]` when the switch is off) and three route files: settings (upsert),
  memories (201 create with server-set `source='user'`, link existence pre-checks → `400`, PATCH can
  never touch `source`/`suggestion_id`, 204 row delete, `POST /memories/delete-all {confirm:true}`
  → `{deleted}` via `DELETE`, never `TRUNCATE`), suggestions (one transaction per decision;
  `ON CONFLICT DO NOTHING` + re-read for a raced first decision; 409 `memory_disabled` /
  `memory_suggestion_already_decided`; 201 with the memory on `remember`, `source='suggestion'`).
  Memories join `GET /export` as the flat row (ADR-059). Guard 2 needed no change (no memory file
  touches tasks/notes).
- **Guard 6** (`ai-egress-guard.test.ts`): no non-test file under the four AI lane directories **or
  the three AI route files `routes/{ask,briefs,focus}.ts`** names a memory table binding/name or
  imports the memory read model or `@personal-os/core/memory/*`; no other read model imports,
  re-exports or names the memory module (except `user-export.ts`, a listed body reader); no worker
  file names the tables; the memory route/read model import no AI SDK, provider or lane and touch no
  queue token; the read model carries no write verb; a vacuity check reads the real file. Guard 5
  gained the same three route files. Proven to bite: an `import { memories }` in
  `intelligence/today-context.ts` fails exactly one case naming the file (reverted).
- **Core.** `packages/core/src/memory/match.ts` — typed-link matcher (one memory per reason per
  row; a statement containing the row's title but no link matches nothing — pinned) and
  `memoryWorkingHours`, a FIXED grammar (`work|working|study|studying|focus hours? H[:00]–H[:00]`,
  0–23, start < end) documented as the only inference core performs over memory text.
  `matches_preference`/`supports_goal` join the closed vocabulary at **+15** each, source `memory`,
  whys `You said: <statement>` (≤ 120 chars); the academic base score stays verbatim; a merged
  task+assignment row counts a memory reason once; **`FOCUS_NOW_CONTEXT_POINTS_CAP = 75`**, the exact
  pre-10.7 context maximum, so the fully-stacked P1 merged row pins at `325 + 75 = 400` and sorts
  below a bare overdue with an earlier due — 10.7 never raises a row's ceiling (equation appends
  `, capped to 75` only when it bites). The briefing takes `memory.workingHours` into `freeBlocks`'
  existing bounds and adds `Working hours HH:MM–HH:MM — from your preferences` (source `memory`, no
  `ref`, inert).
- **Mobile.** `/memory` (Concept A: a `soft`-gradient hero "Personal OS remembers N things" with
  On/Off chip, kind counts and the byte-pinned `MEMORY_PRIVACY_LINE` — "Only what you add or accept.
  Never sent to an AI model."; an Off notice; at most ONE "Suggested" card with Remember / Not now /
  Never; Preferences / Goals / Facts sections of `ListRow`s with source line "Added by you · 17 Sep
  2026" / "From a suggestion · …", one link chip, swipe-to-delete plus a long-press sheet; a
  first-run empty state with four starter chips that only prefill the editor; an honest Export card
  pointing at `GET /export`; "Delete all memories" through `confirmDestructive` naming the count),
  `/memory/new` and `/memory/[id]` (kind segmented control, bounded statement/note with counters,
  project and course `ChoiceChip`s, a "Used by" card per kind, the provenance row, Save, Delete;
  **a warn-only credential-shape caption** over Ask's own anchored `redactSecrets` shapes that never
  blocks a save), a `MemorySettingsCard` under Privacy & AI before Cloud Ask (toggle as a reversible
  `Button`), and the **explicit-moment sheet** on `projects/[id]`: after a non-empty goal save the
  client asks the API for a pending suggestion for that project and opens "Remember this?" — the
  only place a suggestion ever surfaces besides the Memory Center; never a Today card
  (`today-screen-order.test.ts` untouched). Today: `useMemoriesForIntelligence` + `useMemorySettings`
  feed a pure `MemoryItem → MemoryLinkInput` adapter; Focus Now renders rows WITHOUT memory while it
  loads and treats an error or the switch off as absent; the per-row match rides on the row into
  every sheet ("Supports a goal — You said: … · Memory", `400 overdue + 15 goal = 415`); the
  briefing waits for memory to settle like its other optional sources. Guards: `memory-no-linking`
  (no `Linking` under memory files), `memory-privacy-line` (byte pin; Ask surfaces never import the
  memory queries; Today never imports the suggestion sheet; exactly one root-mounted host; the
  opener called only from the project goal save); `content-bounds` extended.

**Verification (integrator, serial, full monorepo).** `pnpm build --force` **12/12** · `pnpm
typecheck` **23/23** · `npx eslint apps packages` and `apps/mobile`'s own `eslint .` exit 0 · root
`prettier --check .` clean (every new mobile file formatted; `settings.tsx` unchanged debt) ·
`git diff --check` clean · `gitleaks detect --no-git` no leaks (a JWT-shaped test fixture was
de-literalised after the scan flagged it; the two regenerated Expo dev logs and the copied
`apps/mobile/.env` were deleted) · `pnpm test --force` **23/23 tasks, 7,089 tests across 13
packages, zero failing** (api 1,568 [+53] · mobile 1,903 [+113] · core 1,172 [+61] · schema 574
[+11] · db 99 [+20] · api-client 213 [+7]; worker 738 and the six provider packages unchanged; was
6,824 at 10.6). Migration invariant: `0023` applied on a clone and on both local databases 23 → 24
by row count, `db:reconcile` clean, every CHECK/FK/index verified by name in `pg_constraint` /
`pg_indexes`.

**Live browser verification (local dev API + Expo web at 480 × 800, the real local `personalos`
database, dark and light).** Paired a throwaway web device with a single-use code (revoked
afterwards). First-run Memory Center: hero "remembers nothing yet" + On chip + privacy line, the
empty state, the four starters, the Export card. Tapped "Working hours 9-18" → the editor
prefilled → Save → hero "remembers 1 thing", the row "Added by you · 17 Sep 2026", toast
"Remembered". Seeded a project with a goal → `GET /memory-suggestions` returned the computed
suggestion with its evidence line → the "Suggested" card rendered → **Remember** → a goal memory
"From a suggestion" with the project chip, the card gone, toast with "View"; its detail screen showed
the provenance row, "Project: … ›", the "Used by" copy, Save and Delete. Seeded an overdue task in
that project → **Today**: the briefing read "Working hours 09:00–18:00 — from your preferences" with
a *Memory* pill and the free block bounded to 18:00; Focus Now ranked the task with a "Supports a
goal" chip (reordered within the overdue rung, still below the P1 row); its sheet read "Supports a
goal — You said: Finish the thesis draft by December · Memory" with the equation
`400 overdue + 15 goal = 415`. Settings: the Memory card under Privacy & AI ("On — 2 memories")
→ **Turn off** → Today lost both the working-hours line and the chip and reverted to the 10.6
order → turned back on. A second project, goal typed on the project screen and saved → the
"Remember this?" sheet opened at that moment → **Never ask again** → `GET /memory-suggestions` empty,
the decision row `project_goal:<id> · never` with no text column anywhere. Light mode: legible
throughout. **Delete all** (web's `window.confirm`, stubbed to accept for the walk): the confirm read
"Delete all 2 memories? This can't be undone. Export first if you want a copy.", the danger toast
"Deleted 2 memories", the screen back to first-run. Console: only the pre-existing
`/briefs/current` 404s; every memory request 200. Seeded tasks/projects archived and the decision
rows removed afterwards; both previews stopped.

**Independent adversarial review (a separate agent, read-only, no implementation context, nine
lenses, every claim re-run).** Verdict **SAFE AFTER FIXES — all required fixes closed:** (1)
**MAJOR, CONFIRMED** — drizzle-orm wraps every failed statement in a `DrizzleQueryError` whose
message is `Failed query: <sql>\nparams: <bound values>` under the plain name `Error`, so a
transient Postgres failure during a memory INSERT would have logged the statement verbatim through
the generic 500 path (pre-existing for every user-authored write; 10.7 is the checkpoint that pins
the stronger promise). Fixed in `serializeErrorForLog`: the class is detected structurally, the
message withheld, the SQLSTATE lifted from `cause`; a serializer test and a route test that injects
a failing driver prove the statement is absent from the captured stream — and the route test was
shown to FAIL with the fix disabled. (2) MINOR — the three AI route files sat outside every walked
set; Guards 5 and 6 now walk them. (3) MINOR — ADR-077 §6 promised a warn-only credential check no
lane had built; built (`memoryCredentialWarning`) and the ADR reconciled to the code. (4) MINOR —
two raced first decisions on one key would have surfaced a `23505` as a 500; now `ON CONFLICT DO
NOTHING` + re-read answers 200/409 like a pre-existing row. Lenses A–I otherwise **clean**: no
memory token in any AI lane or worker file; the four strict wire schemas byte-unchanged (the
versionCode-31 client keeps parsing); exactly two INSERT sites, both owner-driven; deletes are row
deletes and the decision table holds no text; the suggestion query persists nothing while pending
and the project-screen hook fires only after a non-empty goal save; matching is by link only; the
cap is applied on every path; SQL ↔ Drizzle parity exact; default privileges cover the runtime
role; the named mobile guards green. Notes accepted as debt (below): #5, #6, #7.

**Unchanged and reaffirmed:** ADR-018, ADR-024, ADR-029, ADR-041/043, ADR-046, ADR-050, ADR-056/
066/067 (no new AI call site; Guards 1–5 green, Guard 6 added), ADR-058 (no new alert producer),
ADR-059 (export widened by one user-authored entity), ADR-065 (memories are NOT in `GET /search`),
ADR-072/075, ADR-074.

**Recorded, not fixed:** an `accepted` decision silences its key for good — after the memory is
deleted the project-goal suggestion is not re-offered and a repeat `remember` returns `memory: null`
(no text retained; the owner re-adds through the editor); `remember` does not re-derive that the key
is currently pending, so provenance is "the owner posted this statement against this key", not "the
sentence the owner saw"; `content-bounds.test.ts`'s `banner` became optional for the shared form (the
two hosting screens are pinned separately); the decide race path is covered by reasoning and the
existing-row tests, not by a concurrency test; on web `confirmDestructive` is `window.confirm`
(pre-existing); the 480 px starter chips sit under the floating capture band until the page scrolls
(the band overlays every screen — a short-content artefact, not a memory-screen defect);
`settings.tsx` remains non-prettier at HEAD; the Rabbit R1 has NOT been rebuilt.

**Deployment plan (NOT executed; awaits owner authorization).** Frozen order WITH the migrate step:
merge the branch to `main` by fast-forward (PR as the review surface); tag the serving `api`/`web`
images `rollback-pre-10.7` by digest (`worker` untouched — no rebuild, no tag); `git archive` the
new `main` tip to `/home/himallinux/personal-os-10.7-release`; build `api` + `web`; verify the api
image carries 24 migration files with `0023_personal_memory_layer.sql` last, `dist/routes/memories.js`
and `dist/read-models/memories.js`, and that production's watermark is `1789378000000` with 23 rows
and no future-dated row; migrate from the new image with `--no-deps` and the `MIGRATIONS_DATABASE_URL`
pass-through, asserting **23 → 24 by row count** and the three tables present; recreate `api` then
`web` alone (`postgres` and `worker` never named); validate `GET /memory-settings` →
`{enabled:true, memory_count:0}`, `GET /memories` empty, `GET /memory-suggestions` (real projects
with goals will appear — that is correct), `GET /export` carries `memories`, `/today` and
`/academic/today` unchanged, 0 warn/error and 0 statement-shaped log lines; then `eas build --local
--profile production-internal` with the production env values passed explicitly (never from
`apps/mobile/.env`), `strings`-check the bundle (0 `localhost:3000`, the tailnet host, "Personal OS
remembers"), `apksigner` continuity, `adb install -r` → versionCode 32, launch with `am start` and
sweep logcat for `FATAL EXCEPTION` — the Memory Center adds two new sheets and `enterRise` rows but
no custom worklet (`worklet-safety.test.ts` green). **Rollback:** `docker tag
personal-os-{api,web}:rollback-pre-10.7 personal-os-{api,web}:latest` + the frozen recreate; `0023`
is additive-only, so the pre-10.7 images run against the post-migration schema; no schema rollback.

#### Deployment — COMPLETE for api/web (2026-09-17 23:52–23:58Z), owner-authorized ("Proceed with deployment only")

**Pre-deployment (read-only).** Branch clean at `436da0f`, pushed, a strict fast-forward of
`origin/main` (`5e51606`); PR #7 `MERGEABLE`/`CLEAN`; `gitleaks` over the four branch commits: no
leaks. Production: `/health` ok/connected/`stale:false`; `drizzle.__drizzle_migrations` **23 rows,
`max(created_at) 1789378000000`, 0 future-dated rows**; 0 `memor%` tables; api (`dccf3ff797df`,
started 10:08Z) and web (`c6e390875f7b`, 10:19Z) on the 10.6 images, worker (03:57Z) on 10.4,
postgres up since 2026-08-30, all `RestartCount=0`; Canvas/Gmail/Health/GCal all `active`; the one
`failed` pg-boss job the documented 2026-09-16 mail-sync timeout; `ai_task_routes` has no `ask` row
(Cloud Ask OFF).

**Rollback references, before anything changed.** `personal-os-api:rollback-pre-10.7` =
`dccf3ff797df`, `personal-os-web:rollback-pre-10.7` = `c6e390875f7b` (both by image id, both
confirmed equal to the running containers' `.Image`); git tag `rollback-pre-10.7` at `5e51606`,
pushed. `worker` untouched — no tag, no rebuild.

**Merge.** `git push origin HEAD:main` — a true fast-forward, `5e51606` → **`436da0f`**; PR #7
auto-closed `MERGED` (merge commit = `436da0f`, i.e. none). `main` is `436da0f` and canonical; the
primary checkout fast-forwarded to it.

**Frozen order, executed.** `git archive` of `436da0f` shipped to
`/home/himallinux/personal-os-10.7-release` (1,359 tracked files; 0 `.env`/`google-services.json`;
24 migration files; ADR-077 SHA-256 identical to the worktree's). Built `api`+`web` (`build_exit=0`;
running containers confirmed still on the old image ids afterwards). **Verified the new images
before anything ran:** api carries 24 `.sql` files with `0023_personal_memory_layer.sql` last and
a journal whose last entry is idx 23 / `1789379000000`, `dist/read-models/memories.js`, the three
memory route files, the `[DrizzleQueryError message withheld]` serializer marker, `memories` in
`dist/read-models/user-export.js`, and no `.env`/`google-services.json`; the web bundle carries
"Personal OS remembers" ×2, "Remember this?", "Matches your preference" ×2, "from your preferences",
the tailnet hostname once and `localhost:3000` never. **Migration** from the new api image via
`docker compose run --rm --no-deps -e MIGRATIONS_DATABASE_URL=… --entrypoint sh api`
(`node_modules/.bin/drizzle-kit migrate`): **23 → 24 by row count**, new row `id 24 · created_at
1789379000000 · hash b2c670dbd1dde4fd…` — identical to the shipped file's SHA-256. **Direct schema
inspection:** `memories` (10 columns), `memory_suggestions` (9), `memory_settings` (4) present with
the exact nullability and defaults; constraints `memories_kind`, `memories_source`,
`memory_settings_singleton`, `memory_suggestions_status`, `memory_suggestions_suggestion_kind`
(CHECK), the four `ON DELETE SET NULL` FKs and three PKs; indexes `memories_{project_id,
canvas_course_id,suggestion_id,kind_updated_at}_idx`, `memory_suggestions_key_unique`,
`memory_suggestions_project_id_idx`; `posops_app` holds `DELETE,INSERT,SELECT,UPDATE` on all three
through the migrator's default privileges — no GRANT in the migration, as designed; 0 rows.
**Rollout:** `api` recreated alone → `(healthy)` in 6 s, `/health` ok; `web` recreated alone →
`200` on `:8081`. `worker` (`StartedAt` 03:57Z) and `postgres` (2026-08-30) untouched by their own
timestamps; all four `RestartCount=0`.

**Production validation (real routes, real data).** `GET /memory-settings` →
`{enabled:true, memory_count:0}` (the singleton is answered lazily; no row written); `GET /memories`
empty; `GET /memory-suggestions` → 0 pending (the account's one project is archived); `GET /export`
carries `memories` with `{returned:0,total:0}`; `/today`, `/academic/today`, `/reminders`,
`/health-summary`, `/mail-digests/current`, `/search`, `/projects`, `/tasks` all `200`; `/today`,
`/memory-settings` and the web root `200` over the Tailscale HTTPS route. **Memory lifecycle,
end to end:** `POST /memories` → 201 (`source: user`); `PATCH` note + kind → 200 with `updated_at`
advanced; `PATCH` linking to a real course (`2268-BIOL-1442-002`) AND the real (archived) project
→ 200 with both names resolved; `PATCH {source}` → 400 (provenance immutable); `GET /memories/:id`,
`GET /memories?kind=&canvas_course_id=` (total 1) and `GET /export` (1 flat row with exactly the
ten `MemorySchema` keys) all read it back; `POST` with a bogus course id → 400; `DELETE` → 204;
`GET` → 404 afterwards; export back to 0; all three tables 0 rows. **Memory influence, in the
production web client (paired as `10.7 deploy verification browser` with a single-use code,
revoked after):** a course-linked preference on the real ACCT course made Focus Now's "Podcast 3"
row carry a third hidden chip and its assignment sheet read **"Matches your preference — You said:
… · Memory"** with the equation `450 Canvas priority + 25 course attention + 15 preference = 490`
(the server's academic score verbatim plus the explained bonus); a "Working hours 9-18" preference
produced **no** briefing line — correctly, because at 19:00 local no ≥ 60-minute free block remained
inside the preference window, so no unsupported line was invented; the production Memory Center
rendered both rows with the real course chip. **Privacy:** Cloud Ask has no consent row, so
`POST /ask` and `POST /focus/suggestion` answer 409 — no model call can be built at all in
production; `/today`'s body contains no `memor` key; the api log since recreation holds 0 statement
text, 0 warn/error lines and 0 `DrizzleQueryError`; the worker log names no memory table; 190
pg-boss jobs completed in the following 30 minutes, the same one pre-existing `failed`; both
Tailscale Serve routes `tailnet only`. Guard 6 passed in the gate on `436da0f`, the exact commit
deployed. Both verification memories deleted (204, 204) → all three tables 0 rows; the browser
device revoked; 0 live pairing codes. One expired pairing code from this session remains
unconsumed (minted, then 15 minutes passed during the lifecycle run before pairing — the retention
sweep does not cover `device_pairing_codes`; harmless, expired).

**Rabbit R1 — APK built and verified; INSTALL PENDING (device not on the USB bus).** Main checkout
fast-forwarded to `436da0f`, `schema`/`core`/`api-client`/`db` rebuilt; `eas build --local
--profile production-internal` with the production values hardcoded (never from `apps/mobile/.env`)
→ `BUILD SUCCESSFUL in 4m 15s`, **versionCode 31 → 32**, 113.7 MB at
`/tmp/personal-os-10.7-vc32.apk`. Verified before installing: `strings` on the Hermes bundle — 0
`localhost:3000`, 1 tailnet hostname, "Personal OS remembers" / "Remember this?" / "Matches your
preference" / "Never sent to an AI model" each present; `apksigner` V2 signer SHA-256 `4601e3a2…`
(the certificate every prior checkpoint recorded for the installed app); `aapt` package
`com.himal.personalos`, `versionCode 32`. `adb devices` and `ioreg -p IOUSB` showed no Rabbit on the
bus at build time, so the install waited for the owner to plug the device in.

**Rabbit R1 — INSTALLED AND ACCEPTED on versionCode 32 (2026-09-18 02:41–02:47Z, owner plugged the
device in).** Pre-install read: versionCode 31, `firstInstallTime` 2026-08-19 16:26:10, exact-alarm
appop `allow`, `POST_NOTIFICATIONS` granted; the installed `base.apk` pulled and its V2 signer
`4601e3a2…` compared equal to the new APK's before anything was installed. `adb install -r` →
`Success`; post-install: **versionCode 32**, `firstInstallTime` preserved (no re-pair), exact-alarm
`allow`, notifications granted, `stopped=false`. Launched with `am start` (never `am force-stop`),
logcat cleared first. **On-device walk, real production data, screenshots off the device
(480 × 640):** Today renders the briefing hero (2 overdue · academics · sleep line · Focus Now
lines, every line spoken with its source in the accessibility tree); Settings → Privacy & AI shows
the **Memory** card ("On — 0 memories. Focus Now and your briefing use them.", the privacy line,
"Open Memory", "Turn off") above Cloud Ask; the **Memory Center** first-run state (hero "remembers
nothing yet", On chip, counts, privacy line, the empty state, "Add a memory"); **create** through
the editor (kind segmented control, statement typed, Save) → hero "remembers 1 thing", the row
"I work best in the evening · Added by you · 17 Sep 2026" spoken as "Preference: … Added by you 17
September", the "Remembered" toast, and the row present on the production server (`source: user`);
**edit** on the detail screen (provenance row, a note added, "Save changes") → the note persisted
server-side with `updated_at` advanced; **delete** through the native `Alert` ("Delete this memory?
This can't be undone. Export first if you want a copy." · CANCEL / DELETE) → back to the empty
state, server at 0; **settings toggle** → "Off — 0 memories kept, not used by Focus Now or your
briefing." with the server at `enabled:false`, then back on (`enabled:true` — this upsert is what
created production's `memory_settings` singleton row); **dark mode** (`cmd uimode night yes`): the
`soft` hero, chips and empty state fully legible; restored to light afterwards. `enterRise` rows,
the toast and both sheets' hosts all ran on the real UI runtime. Logcat swept after every step:
**0 `FATAL EXCEPTION`/`AndroidRuntime` lines and 0 uncaught JS errors across the whole
versionCode-32 session.** Not exercised on the device (no data, or would mutate real data): the
project-goal suggestion sheet (the account's only project is archived), a course-linked memory's
Focus Now chip (validated in the production web client instead, above), swipe-to-delete. Rollback:
the pulled versionCode-31 `base.apk` with `adb install -r -d`.

**One formatting slip, fixed after the fact.** `436da0f`'s `apps/api/src/routes/memories.test.ts`
was left prettier-unclean by an `eslint --fix` that ran AFTER the gate's prettier pass (three
`as never` casts removed); `npx prettier --check .` on that commit therefore fails on one file. The
whitespace-only fix (6 lines) landed in the closing docs commit; tests, lint and behaviour are
identical, and the deployed images were built from `436da0f`'s source, which compiles the same.

**Checkpoint 10.7 is CLOSED (2026-09-18):** deployed, production-validated, and accepted on the
device. Final state: `main` at the closing docs commit; production `api`+`web` at `436da0f`,
`worker` at `965900f`, migration level **24**; Rabbit R1 versionCode **32**; production memory
tables `memories 0 · memory_suggestions 0 · memory_settings 1 (enabled)`.

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
- **`reconcile-drizzle-tracking.ts`'s `ADD_COLUMN_DATA_TYPES` allowlist has a genuine, pre-existing
  gap (found at Checkpoint 10.5).** It covers only `text`/`bytea`/`date`/the two timestamp spellings
  — never `uuid`, `real`, `boolean`, `bigint`, `smallint` or `integer`, i.e. only the types
  `0009`/`0010` happened to add. This does not block any migration applied the normal way
  (`drizzle-kit migrate`, the only supported path), because that allowlist only gates the script's
  out-of-band-apply backfill probe — but a genuinely untracked ADD COLUMN of any of those types would
  still abort reconcile with a false "unsupported type" rather than actually verifying it. Fixing the
  shared script is its own reviewed decision, not a side effect of adding one column; recorded rather
  than patched in-checkpoint.
- **A worklet body that calls a JS-thread function is invisible to every local check (found at
  Checkpoint 10.6, the hard way).** The vitest mocks make `useAnimatedStyle` an identity call and the
  web target has no UI runtime, so `bottom-sheet.tsx`'s call to a plain helper passed 6,816 tests and a
  static export and then crashed the versionCode-30 APK on its first frame. `worklet-safety.test.ts`
  now scans every animated body under `apps/mobile/src/{components,app}` for calls other than
  `.get()`, `Math.*` and named directive-checked worklets; it is a regex over source, not a type
  check, so a call hidden behind a member expression or a new hook name (`useAnimatedReaction`,
  `useAnimatedScrollHandler`) would need the guard extended. Until Reanimated's babel plugin can be
  exercised under vitest, an on-device launch remains the only real proof.
- **The Today header's personal subtitle and the briefing's headline can disagree (10.6).** The
  `ScreenHeader` subtitle ("All clear for today") is computed from `/today`'s personal counts, while
  the briefing headline ("2 overdue, 1 due today.") adds the academic counts. Both are honest to their
  own source, but 100px apart they read as a contradiction on a day with only academic work due;
  worth one shared headline rule in a later pass.
- **`PATCH /tasks/:id`'s `canvas_assignment_id` link has a TOCTOU gap identical to `project_id`'s
  existing one (found at Checkpoint 10.5, not fixed to avoid a one-off inconsistency).** The
  existence pre-check and the transactional write are not atomic; an assignment deleted in that
  instant surfaces as a raw, unhandled `23503` (500) rather than a clean `400`. No production code
  path anywhere hard-deletes a `canvas_assignments` row (only a full connection-row cascade, which no
  route performs), so this is believed unreachable in practice, matching the same accepted risk
  `project_id` has carried since it shipped.
- **A memory suggestion, once accepted, is never re-offered for that key (10.7, deliberate).** The
  `accepted` decision row survives the memory's deletion (it holds no text), so deleting a goal
  memory does not bring the project-goal prompt back; the owner re-adds through the editor. Flip
  by deleting the decision row alongside the memory if the product prefers.
- **`POST /memory-suggestions/:key/decide` with `remember` does not re-derive that the key is
  currently pending (10.7).** Any valid project id plus an owner-typed statement is stored as
  `source='suggestion'`; provenance means "the owner posted this against this key". A re-derivation
  inside the transaction would refuse a key that is not offered.
- **The decide route's raced-first-decision path (`ON CONFLICT DO NOTHING` + re-read) has no
  concurrency test (10.7).** Covered by the existing-row tests and by reading; a two-connection
  test would need the clone-DB harness.
- **`apps/mobile/src/__tests__/content-bounds.test.ts` made `banner` optional (10.7)** so the shared
  `memory-form.tsx` can be listed; the two hosting screens pin their banners separately, but a future
  entry can now omit one silently.

---

---

## Current objective

**Phase 10 — Codebase Consolidation & Agent Readiness — is open.** Checkpoints 10.0, 10.1/10.1B and
10.1C are closed: 10.1C (implemented, tested 6,054/6,054, independently reviewed with zero
blocker/major findings) was **deployed to production on 2026-09-16 and its reconnect path validated
live** — see the deployment record at the end of the 10.1C entry above. Production serves the
10.1C api (`f85779a`) alongside the 10.1B worker and web (`1e406f7`).

**Checkpoint 10.2 — the Academic Intelligence Layer — is deployed (api/worker/web at `1edb61b`,
level 22), production-validated, accepted on the Rabbit R1 (versionCode 25, built locally), and
amended the same day by the current-term rule (ADR-070a) and the credential-in-log hotfix.** The
record is above; the Canvas PAT rotation/reconnect carried from this incident is now done (owner
reconnected 2026-09-17).

**Checkpoint 10.3 — Academic Intelligence Expansion + Mobile UX Modernization — is deployed**
(api/web at `ba23472`, level 22 unchanged; worker/postgres untouched — no rebuild needed) **and
accepted on the Rabbit R1 (versionCode 27, built locally).** `main` fast-forwarded to `ba23472`;
PR #3 merged.

**Checkpoint 10.4 — "Focus Now" + Canvas alert hysteresis + mobile polish — is implemented,
verified, independently reviewed clean, merged to `main` (`965900f`), and DEPLOYED** (owner
authorized: "deploy it"). See the full entry above. No migration; touches `packages/core`,
`apps/worker/src/canvas`, and `apps/mobile` only — `apps/api`, `packages/schema` and `packages/db`
are untouched. Production serves `worker`+`web` at `965900f`; `api`/`postgres` untouched. The
Rabbit R1 runs versionCode 28.

**Checkpoint 10.5 — Personal Context Layer — is implemented, verified (6,588 tests, 23/23 tasks),
independently reviewed clean, merged to `main` (`f29418b`), and DEPLOYED** (owner authorized:
"deploy it"). See the full entry above. Migration `0022` (one nullable FK,
`tasks.canvas_assignment_id`) applied, level 23; two new `GET /<entity>/:id/context` read models and
mobile linking UI live-exercised against real production data and cleaned up after. This was the
first checkpoint since 10.1C to need `api` and `db` touched, not just `worker`/`web`/mobile —
production serves `api`+`web` at `f29418b`, `worker`/`postgres` untouched, Rabbit R1 versionCode 29.


**Checkpoint 10.7 — Personal Memory & Preference Layer — is implemented, verified (7,089 tests,
23/23 tasks), independently reviewed (safe after fixes, all closed), merged to `main` (`436da0f`,
PR #7), DEPLOYED (owner authorized: migration `0023` applied, level 24, `api`+`web` recreated,
`worker`/`postgres` untouched, lifecycle/influence/privacy validated live on production data) and
ACCEPTED ON THE RABBIT R1 (versionCode 32). CLOSED 2026-09-18.** No checkpoint after 10.7 is
selected; Phase 10.8 is not begun.

**Checkpoint 10.6 — Intelligence + Mobile Experience Expansion — is implemented, verified (6,824
tests, 23/23 tasks), independently reviewed (safe after fixes, all closed in-checkpoint), merged to
`main` (`3a90c0c`, then the `3928dd3` device fix; PR #6), and DEPLOYED** (owner authorized: "Deploy").
See the full entry above. No migration; touches `packages/schema/src/today.ts` (one optional key), `apps/api/src/read-models/
today.ts`, `packages/core/src/focus-now/**` and `apps/mobile/**` — `apps/worker`, `packages/db` and
the strict academic schemas are untouched. Production serves `api`+`web` at `3a90c0c`;
`worker`/`postgres` untouched. The Rabbit R1 record is in the 10.6 entry.
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
| **10.1C** | Canvas reconnect lifecycle fix: `connectCanvasConnection` SELECTs any prior row by `canvas_base_url` first and reactivates a non-active row in place (same `id`/`created_at`, FK-linked history preserved), refuses an active row (`409 canvas_already_connected`) and a different `canvas_user_id` (`409 canvas_account_mismatch`); route returns 200 on reactivation, 201 on creation. **Deployed (api only, no migration) and live-validated against the owner's real UTA account 2026-09-16** — reconnect `200` on the same row with history preserved, cron succeeding since. |
| **10.2** | Academic Intelligence Layer: a provider-agnostic academic read model computed over the Canvas tables (`GET /academic/today`, `/academic/courses`, `/academic/courses/:id`; ADR-070), `score`/`grade` synced under ADR-068a (migration `0021`), a deterministic Today card (Overdue / Due today / Due this week / unread announcements) and `/academic` course screens, the single same-origin-gated "open in Canvas" call site, `invalid_token` wired into the worker's auth-failure path, an egress guard keeping academic data out of every AI lane. **Deployed (api/worker/web, level 22) and production-validated against the owner's real UTA account 2026-09-16** (ADR-070/068a); Rabbit R1 accepted on versionCode 25, built locally after the EAS quota refused the cloud build. |
| **10.3** | Academic Intelligence Expansion + Mobile UX Modernization: deterministic urgency / explainable priority scoring / workload status / course attention / grade summary as optional keys on the academic read model (ADR-071, no migration), a token-based mobile design system (`components/ui/`, three new Expo modules, web dark mode fixed) and every screen restyled on it. **Implemented, verified (6,477 tests), independently reviewed (twice — the full adversarial pass and a four-lane final release gate), merged to `main` (`ba23472`) and DEPLOYED 2026-09-16/17** (api/web recreated, worker/postgres untouched); Rabbit R1 accepted on versionCode 27, built locally after catching and fixing a wrong-API-URL build before it ever reached the device. |
| **10.4** | "Focus Now" — a deterministic, client-side-only unified ranking merging personal urgent items and academic priorities on Today (`packages/core/src/focus-now`, ADR-072, no new route/migration/AI call); Canvas invalid-token alerting gated on two consecutive connection-level auth failures, mirroring Gmail/Health/Calendar's existing alert producers (`apps/worker/src/canvas/alerts.ts`, ADR-073 amending ADR-068 §6); a four-item mobile polish bundle (`SegmentedControl` promoted to the design system, courses-screen skeleton flash fixed, accessible Settings loading states, haptic on destructive confirms). **Implemented, verified (6,530 tests, 23/23 tasks, zero failing), independently reviewed clean, merged to `main` (`965900f`) and DEPLOYED 2026-09-16/17** (worker+web recreated, api/postgres untouched, no migration); Rabbit R1 accepted on versionCode 28, built locally. |
| **10.5** | Personal Context Layer: exactly one narrow, explicit-write-only FK (`tasks.canvas_assignment_id`, migration `0022`, ADR-074) instead of the generic entity/relationship table a preceding 4-lane architecture review found this codebase already tried once and got zero adoption for (`item_tags`, Checkpoint 10.0); two new `GET /<entity>/:id/context` read models (`related_reminders` on course context, `related_captures`/`recent_activity` on project context) built entirely over existing FKs; a task-detail linking picker and two zero-schema navigation fixes on mobile. **Implemented, verified (6,588 tests, 23/23 tasks, zero failing), independently reviewed clean, merged to `main` (`f29418b`) and DEPLOYED 2026-09-17** (migration `0022` applied, level 23; api/web recreated, worker/postgres untouched); Rabbit R1 accepted on versionCode 29, built locally, the write path and both context routes live-exercised against real production data. |
| **10.6** | Intelligence + Mobile Experience Expansion: an explainability layer (closed reason vocabulary with sources and deterministic "why"s, frozen context points, linked-task dedupe, an auditable score equation — ADR-075) and a client-composed deterministic daily briefing (academic / schedule with free blocks / sleep vs 7-day average / focus) over already-fetched read models, with one additive optional wire key (`TodayTaskItem.canvas_assignment_id`, opaque, never forwarded to a model); a motion + gesture design system on the already-installed Reanimated 4 / gesture-handler stack (`PressableScale`, `CompletionCircle`, `SwipeableRow`, `Toast`, `AnimatedNumber`, `ClampedText`, `BottomSheet` — ADR-076), Today reorganised actionable-first with a briefing hero and an explanation sheet on every Focus Now row, an in-app assignment sheet before "Open in Canvas", and every major screen polished on the design system. **Implemented, verified (6,824 tests, 23/23 tasks, zero failing), independently reviewed (safe after fixes, all closed), merged to `main` (`3a90c0c`, then the `3928dd3` device fix) and DEPLOYED 2026-09-17** (api/web recreated, worker/postgres untouched, no migration); Rabbit R1 accepted on versionCode 31 after versionCode 30 crashed on launch (a worklet calling a JS-thread function — fixed, guarded by a new source test, rolled back within minutes). |

**Production is at migration level 23** and serves `api` built from `3a90c0c` and `web` from `3928dd3` (10.6);
`worker`/`postgres` are untouched since 10.4/2026-08-30 respectively (10.5 and 10.6 changed nothing under `apps/worker`). Google Calendar, Gmail, Health
and Canvas are all **active** (the Canvas PAT was rotated and reconnected by the owner on
2026-09-17, the same connection row reactivated in place, real data flowing again — closing the
open action carried since the 10.2 credential-in-log incident). Monitoring runs
against five active targets including both Tailscale Serve routes, with full CRUD. A daily
retention cron bounds `monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/
`health_sync_runs` and sweeps expired `health_oauth_states`/`mail_oauth_states`. Every retrying
pg-boss queue has a dead-letter queue. Calendar events authored in Personal OS sync outward to the
owner's chosen writable calendar; imported events are read-only. Search covers tasks, notes,
events, projects, captures and mail with an explainable score, and every text field is bounded at
write. Cloud Ask, when the owner enables it, answers questions about today's schedule with cited
sources and can suggest one task to focus on. Academic intelligence (urgency, priorities, workload,
course attention, grade summary) is live on `/academic/today` and `/academic/courses`, answering
with real Fall 2026 data. Today also carries a deterministic, client-side "Focus Now" card unifying
personal and academic urgency. A task can now be explicitly linked to a Canvas assignment
(`tasks.canvas_assignment_id`), surfacing as a "related reminder" on that assignment's course
context and a "related capture"/activity trail on its project context. The Rabbit R1 runs
`com.himal.personalos` versionCode 29, built locally from `f29418b`.

## Current work

**Checkpoint 10.7 is DEPLOYED, ACCEPTED and CLOSED.** `main` carries `436da0f` (PR #7,
fast-forward) plus the closing docs commits; production serves `api`+`web` at `436da0f`, `worker`
still at `965900f`, postgres untouched; migration level **24**; the memory lifecycle, the Focus Now
"You said" explanation and the privacy boundary were validated live against real production data
and every verification row deleted afterwards; the Rabbit R1 runs versionCode 32 with the Memory
Center walked on-device. Nothing is in flight.

**Checkpoint 10.6 is implemented, verified (6,824 tests, 23/23 tasks), independently reviewed, merged
to `main` (`3928dd3`), and DEPLOYED.** `main` is `3928dd3` and canonical; PR #6 merged; production
serves `api` at `3a90c0c` (unaffected by the mobile-only fix) and `web` at `3928dd3` (`worker` still
on 10.4's `965900f`, `postgres` untouched); no migration (level 23); the Rabbit R1 on versionCode 31. Today now leads with a deterministic briefing and an explainable Focus Now;
the mobile design system has motion, gestures, sheets and toasts on the already-installed Reanimated
stack. Android APKs remain built locally (`eas build --local`).

**Checkpoint 10.5 is implemented, verified (6,588 tests, 23/23 tasks), independently reviewed
clean, merged to `main` (`f29418b`), and DEPLOYED.** `main` is `f29418b` and canonical; PR #5
merged; production serves `api`+`web` at that commit (`worker`/`postgres` untouched); migration
`0022` applied, level 23; the Rabbit R1 runs versionCode 29. The write path
(`PATCH /tasks/:id {canvas_assignment_id}`) and both new context routes were exercised live against
real production data (a real task linked to a real assignment, then unlinked) and left exactly as
found. It was the first checkpoint since 10.1C to need `apps/api`/`packages/db` in its own right.

**Checkpoint 10.4 is implemented, verified, independently reviewed clean, merged to `main`, and
DEPLOYED.** `main` is now `f29418b` (10.5 built on top of it); `api`/`web` were later rebuilt by
10.5, but `worker` still serves 10.4's own image (`965900f`); the Rabbit R1 runs versionCode 29
(10.5's build, which naturally includes 10.4's client-side work). Android APKs are built locally
(see the 10.2 entry's *Device build* paragraph, and the 10.3/10.4/10.5 deployment records' build-
verification discipline); the EAS build service is no longer on the release path.

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

**Checkpoint 10.7 deployment (2026-09-17 23:52–00:35Z), read directly from production.** `main`
fast-forwarded to `436da0f`, PR #7 merged · `api`/`web` images tagged `rollback-pre-10.7` by id,
git tag at `5e51606` · `git archive` (1,359 files, no `.env`/`google-services.json`) · new api
image verified to carry 24 migrations (`0023` last), the memory routes/read model, the serializer
fix and memories in the export; the web bundle verified to carry the 10.7 strings and the tailnet
URL, never `localhost:3000` · migration **23 → 24** by row count, tracked hash = file SHA-256,
three tables inspected column/constraint/index/grant by name · `api` then `web` recreated alone,
`(healthy)` in 6 s, `worker`/`postgres` untouched by their own start timestamps · every read route
`200` locally and over Tailscale · the full memory lifecycle, a real-course "You said" explanation
in the production web client, and the privacy boundary validated on real data, 0 rows left · 0
statement text / 0 warn/error / 0 `DrizzleQueryError` in the api log · versionCode-32 APK built and
verified · **Rabbit R1 (2026-09-18 02:41–02:47Z):** installed signer pulled and matched, `adb
install -r` → `Success`, versionCode 32, `firstInstallTime`/grants preserved, `am start`, Today +
Settings + Memory Center (create → edit → native-confirm delete → toggle off/on) walked on real
data in light and dark, 0 crash lines, 0 uncaught JS errors.

**Checkpoint 10.7 gate (2026-09-17), full monorepo, integrator-run, at the branch tip.** `pnpm build
--force` 12/12 · `pnpm typecheck` 23/23 · `npx eslint apps packages` and `apps/mobile`'s own
`eslint .` exit 0 · root `prettier --check .` clean · `git diff --check` clean · `gitleaks detect
--no-git` no leaks · `pnpm test --force` **23/23 tasks, 7,089 tests across 13 packages, zero
failing** · migration `0023` proven on a clone (23 → 24 by row count; `db:reconcile` 24 tracked / 0
discrepancies; `posops_app` write access through default privileges) and applied to both local
databases · live browser walk at 480 × 800, dark and light, against the real local database (the
whole create / suggest / remember / never / detail / switch-off / Focus Now + briefing / delete-all
cycle — record in the 10.7 entry) · independent adversarial review (nine lenses): SAFE AFTER FIXES,
all four required fixes closed and re-gated. Production not touched.

**Checkpoint 10.6 gate (2026-09-17), full monorepo, integrator-run, at `3a90c0c`.** `pnpm build
--force` 12/12 · `pnpm typecheck` 23/23 · `npx eslint apps packages` and `apps/mobile`'s own
`eslint .` exit 0 · root `prettier --check .` clean, every mobile file that was prettier-clean at
HEAD still clean, every new file formatted · `git diff --check` clean · `gitleaks detect --no-git`
no leaks · `pnpm test --force` **23/23 tasks, 6,816 tests across 13 packages, zero failing** ·
cache-cleared `expo export --platform web` clean (entry 4.50 MB, `GestureHandlerRootView` present) ·
live browser walk of Today at 480×800 in light and dark against the real local `personalos` data
(briefing hero, Focus Now rows, the explanation sheet with source chips and the score equation, the
whole new order; 0 nested `<button>`s; `.dark` present) · independent adversarial review (eight
lenses, every suite re-run by the reviewer on its own clone DB): one CONFIRMED MAJOR (recurring
events' template instants in the briefing) and one PLAUSIBLE MINOR (a second assignment-sheet host)
closed with regression pins; A/B/C/D/E/F/G lenses CLEAN. Full record: *Phase 10 → Checkpoint 10.6*
above.

**Checkpoint 10.6 deployment (2026-09-17 10:05–10:09Z), read directly from production.** `main`
fast-forwarded to `3a90c0c`, PR #6 merged · `api`/`web` images tagged `rollback-pre-10.6` by id ·
`git archive` (1,316 files, no `.env`/`google-services.json`) · new api image verified to carry the
`canvas_assignment_id` emission and all 23 migrations (level unchanged, none applied); new web
bundle verified to carry the 10.6 strings and the tailnet URL, never `localhost:3000` · `api` then
`web` recreated alone, `(healthy)` in 8 s, `worker`/`postgres` untouched by their own start
timestamps · every read route `200` locally and over Tailscale · the real account's academic
priorities keep the pre-10.6 reason vocabulary (versionCode-29 wire-safe) · 0 warn/error and 0
token-shaped log lines; 71 jobs completed, 0 failed.

**Checkpoint 10.6 device acceptance (2026-09-17 10:13–10:27Z).** versionCode 30 from `3a90c0c`:
bundle and signer verified, installed in place, **crashed on the first frame** (`[Worklets] Tried to
synchronously call a Remote Function` from the bottom sheet's style worklet) — rolled back to 29
within minutes (`adb install -r -d` of the pulled `base.apk`, clean relaunch). Fix `3928dd3`
(worklet inlined, helper marked `"worklet"`, `worklet-safety.test.ts` source guard proven to fail
with the bug reintroduced; mobile 1,790, typecheck/eslint/prettier clean) pushed to `main`; `web`
rebuilt and recreated from it; versionCode 31 built, bundle/signer re-verified, installed in place
(`firstInstallTime` preserved, grants intact) → Today light + dark, the briefing hero and the
assignment sheet on real data, Settings, Projects — **0 crash lines** across the session.

**Checkpoint 10.5 gate (2026-09-17), full monorepo, integrator-run.** `pnpm build --force` 12/12 ·
`pnpm typecheck` 23/23 · `npx eslint apps packages` and `apps/mobile`'s own `eslint .` exit 0 · root
`prettier --check .` clean · `git diff --check` clean · `gitleaks detect --no-git` no leaks ·
migration `0022` applied to both the shared `personalos_test` and local dev `personalos` (each
implementation lane had correctly tested against its own disposable clone, so the shared DBs needed
the migration before the full suite would pass — the first run surfaced ~300 unrelated-looking
failures purely from the missing column, resolved by applying the migration rather than by touching
any code) · `db:reconcile` against `personalos_test` clean (23 tracked, 0 reconciled, 0 discrepancies)
· `pnpm test --force` **23/23 tasks, 6,588 tests across 13 packages, zero failing**. Independent
adversarial review (migration/schema safety, no-automatic-guessing, Guard 5 privacy boundary,
course-context correctness, write-path validation, mobile regressions/egress, test integrity re-run
directly rather than trusted, scope discipline): zero CONFIRMED/PLAUSIBLE blocking findings, one
low-severity accepted-debt note (a TOCTOU gap identical to the pre-existing `project_id` one). Full
record: *Phase 10 → Checkpoint 10.5* above. Not yet deployed.

**Checkpoint 10.4 deployment (2026-09-16 22:52–23:07Z), read directly from production and the
device.** `main` fast-forwarded to `965900f`, PR #4 merged · `worker`/`web` images tagged
`rollback-pre-10.4` by digest before rebuild · `git archive` of `965900f` (1,253 files, no
`.env`/`google-services.json`) · new worker image verified to carry `enqueueCanvasInvalidTokenAlert`,
new web image's served bundle verified to contain `"Focus Now"` (checked twice — against the built
image, and again against the live HTTP response after rollout) · `worker` then `web` recreated
alone, both healthy within seconds, `api`/`postgres` confirmed untouched by their own container
start timestamps · 56 pg-boss jobs completed in the following 10 minutes, zero failed/retry/active ·
Rabbit R1 build verified before install (bundle `strings`-checked for the tailnet URL and the
absence of `localhost:3000`, signature SHA-256 identical to the installed app's) → `adb install -r`
→ **versionCode 28**, `firstInstallTime` preserved, no re-pair, zero crash lines across the full
on-device walk. Full record: *Phase 10 → Checkpoint 10.4* above.

**Checkpoint 10.3 deployment (2026-09-16 20:29–20:47Z api/web; 2026-09-17 01:18Z Rabbit), read
directly from production and the device.** `main` fast-forwarded to `ba23472`, PR #3 merged ·
images tagged `rollback-pre-10.3` by digest before rebuild · `git archive` of `ba23472` (1,241
files, no `.env`/`google-services.json`) · new api image verified to carry `priorities`/
`workload`/`course_attention`/`grade_summary` and 22 migrations (level unchanged, none applied) ·
`api` then `web` recreated alone, both `RestartCount=0`, `worker`/`postgres` untouched throughout ·
zero warn/error log lines since recreation · `GET /academic/today` answers every new key correctly
zeroed (`configured: false` — the real Canvas connection independently went `invalid_token` at
23:00:18Z, over two hours before this deploy, through code 10.3 never touched) · regression sweep
of `/today`, `/health`, `/reminders`, `/mail-digests/current`, `/health-summary`, `/briefs/current`,
Gmail/Health/GCal/monitoring all clean · **the Rabbit R1 build was caught baking the wrong (dev)
API URL before it ever touched the device, discarded, and rebuilt correctly** (`strings` on the
extracted bundle: 0 `localhost:3000`, 1 `tail62a68f`; `apksigner` cert matched the installed app's
before install) · `adb install -r` → `Success`, versionCode 27, `firstInstallTime` preserved, no
re-pair · on-device screenshots (light and dark) showed the hero gradient, Health and Mail Digest
cards with real data, the Overdue empty state, and Settings' honest "needs reconnect" Canvas chip
— zero crash lines in `logcat` across the whole session. Full record in the 10.3 entry above.

**Checkpoint 10.3 final release-gate review (2026-09-16/17), four parallel lanes, before merge.**
API compatibility & security, mobile design system, academic intelligence correctness, docs &
release checklist — all four **deploy-safe** / **release-ready-with-fix**; the two fixes (an
eslint-warning wording contradiction, naming the merge-to-main step) landed as `ba23472`. Record in
the 10.3 entry above.

**Checkpoint 10.3 gate (2026-09-16), before merge, after the earlier full review's fixes.**
`pnpm build --force` 12/12 · `pnpm typecheck` 23/23 · `npx eslint apps packages` exit 0 ·
`apps/mobile` eslint 0 errors (one warning in the generated `.expo/types/router.d.ts`) · root
`prettier --check` clean · `git diff --check` clean · `gitleaks detect --no-git` no leaks ·
`pnpm test --force` **23/23 tasks, 6,477 tests, zero failing** · cache-cleared
`expo export --platform web` clean, and dark mode verified on the static export · local browser
verification at 480 × 800 in both schemes with seeded academic data (removed after) · independent
adversarial review, four MAJOR + fourteen MINOR closed (record in the 10.3 entry).

**10.2 hotfix + ADR-070a deployment (2026-09-16, ~22:50–22:55Z), read directly from production.**
api/worker/web recreated from `personal-os-10.2b-release` (`1edb61b`), `RestartCount=0`, postgres
untouched · `current_term` `2026 Fall`, Today `2 · 1 · 8 · 8` from the 6 Fall courses · synthetic
malformed tokens refused with nothing echoed · 0 token-shaped strings and 0 warn/error in the api log
· gate at `1edb61b`: 6,292 tests / 23 tasks. Record in the 10.2 entry.

**Checkpoint 10.2 deployment (2026-09-16, 17:26–17:49Z), read directly from production.** Migration
21 → 22 with the tracked file's hash · api/worker/web recreated from `personal-os-10.2-release`
(`b2c273b`), `RestartCount=0`, postgres untouched · manual sync 16/355/21/0, 165 graded rows
populated · academic routes validated on real data · web client verified in a real browser · the
versionCode-22 Rabbit's card verified on the device · 0 PAT-shaped strings and 0 warn/error in both
logs · 31 queues / 11 schedules · Serve tailnet-only · Postgres unpublished. Full table in the 10.2
entry's deployment record.

**Checkpoint 10.2 gate (2026-09-16), `b2c273b` on `main`.** `pnpm build --force` 12/12 · `pnpm typecheck`
23/23 · `npx eslint .` clean · `npx prettier --check .` clean · `git diff --check` clean · `gitleaks
detect` no leaks · `pnpm test --force` **23/23 tasks, 6,265 tests across 13 packages, zero failing**
· migration `0021` applied locally 21 → 22 and `db:reconcile` clean · live local browser verification
(API buckets, courses, detail, same-origin gating both ways, not-configured collapse) with seeded
data, cleaned up after · independent adversarial review: one MAJOR (the retained route would have
broken the deployed client's strict schema) and five MINORs, all closed and re-gated (record in the
10.2 entry). Production
unchanged and not re-verified this checkpoint.

**Checkpoint 10.1C deployment check (2026-09-16, ~12:32–12:35Z), read directly from production.**
Release dir = `f85779a` by file hashes · running api image `60cfdb04…` carries the fix (grep in
`dist/`) · api `RestartCount=0` `(healthy)`, worker/web/postgres untouched · `/health` ok · Canvas
row `8b8e2cb6…` `active`, reused across disconnect/reconnect (`created_at` 10:50:30Z), 16 courses
linked · request log 200 / 200 / 409 / 202 as recorded above · manual + cron sync runs `succeeded` ·
0 token-shaped strings and 0 warn/error lines in api and worker logs · 31 queues / 11 schedules ·
Serve tailnet-only · Postgres unpublished. Full table in the 10.1C entry.

**Checkpoint 10.1C gate (2026-09-16), `f85779a`.** `pnpm build --force` 12/12 · `pnpm typecheck` 23/23 ·
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

1. Nothing is gating. Checkpoint 10.7 is deployed (level 24, `api`+`web` at `436da0f`),
   validated on real production data, accepted on the Rabbit R1 (versionCode 32) and **CLOSED**;
   10.4–10.6 likewise. **No checkpoint after 10.7 is selected; Phase 10.8 is not begun.** Worth
   watching on real use: the first real memories the owner adds (the working-hours line will
   appear on the briefing only on a morning with a free block inside the window; a course-linked
   preference shows on Focus Now the moment that course has a priority item), the Reanimated
   surfaces on the Rabbit, and the briefing's free-block line once real classes are on the
   calendar.

2. **Choose the next checkpoint — a product-direction decision for the owner.** Candidates
   carried forward: widen the Canvas integration further (device-token auth on the academic routes;
   announcement/event surfaces beyond the course screen); widen the intelligence lane
   (`get_calendar_context`/`get_task_context`, Option B "what changed", Option C weekly-review
   intelligence — note ADR-074's own rule: any FUTURE second typed relationship gets its own ADR and
   its own narrow column, never a generalization into an edge table); a real tool-calling agent loop
   over `READ_TOOL_NAMES` (needs its own ADR, a `posops_readonly` role and a budgeted grant —
   `docs/AGENT-READINESS.md` §1–2 is the map); E2 health trends; a new 21-day adoption soak (new
   baseline; `scripts/soak/` observer tooling reusable); closing the "no single-assignment lookup
   route" gap the 10.5 mobile lane recorded (its own cold-start label-cache limitation). Two 10.0
   items also wait on an explicit owner decision rather than being debt: the `tags`/`item_tags`
   safe-to-drop classification (a table drop is irreversible under ADR-024 — now doubly relevant
   since 10.5 chose NOT to revive that table for the context layer) and the deferred `knip`
   dead-code-tooling question.

3. **Open owner actions outside any checkpoint:** `docs/SOURCE-DURABILITY.md` Option 2 — the encrypted
   configuration copy — is still not done and remains the sharpest source-durability risk; and the
   `EXPO_TOKEN` that sat in a mode-644 Expo dev log (deleted 2026-09-16) should be rotated.

The per-checkpoint "open, non-blocking, carried forward" observations that 9.4–10.0 appended to this
section (spring-forward early resolution, the 90/91-row fall-back window, `isAbortLikeError`
duplicated four times, the `react-native-css-interop` babel-plugin alignment, and the rest) are
archived verbatim in `docs/history/superseded-present-state-2026-09-16.md` §4. They were not
re-verified at this reconciliation; any that still holds belongs in the ledger above the next time
its area is touched.
