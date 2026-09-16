# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 10 — OPEN.** Phase 9 (9.0–9.8, accelerated operating model) is complete
through Checkpoint 9.8 (Suggested Focus, 2026-09-15) with no further Phase 9 checkpoint selected;
the owner opened Phase 10 — **Codebase Consolidation & Agent Readiness** — as the next checkpoint
rather than resuming Phase 9's product track. **Checkpoint 10.0 — a behavior-preserving cleanup and
agent-readiness audit — is IMPLEMENTED, DEPLOYED and ACCEPTED (2026-09-15)**: proven-dead code and
four orphaned Expo dependencies removed across mobile/API, zero user-visible behavior change, zero
migration (level stays **20**), worker untouched, new `docs/AGENT-READINESS.md` canonical-boundary
inventory, and a `tags`/`item_tags` schema classification (safe-to-drop, not acted on — an owner
decision). **Checkpoint 10.1 — Canvas LMS integration — is IMPLEMENTED, DEPLOYED and LIVE-VALIDATED
(2026-09-16, ADR-068)**: a read-only, Personal-Access-Token-authenticated sync of the owner's real
Canvas courses/assignments into six new tables (migration `0020`, **production level 21**), a Today
"upcoming assignments" card, and a same-origin-checked "open in Canvas" link — with a confirmed SSRF
gap (`canvas_base_url` had no protection) found by adversarial review and fixed by porting the
project's own CalDAV SSRF guard before deployment. **Checkpoint 10.1B — production deployment and
live validation against the owner's real UTA Canvas account — is COMPLETE (2026-09-16)**: production
migrated 20→21, api/worker/web redeployed, a real connect→sync→idempotent-resync→disconnect
(credential columns verified nulled)→invalid-token-rejected→reconnect cycle run against the owner's
actual account (16 courses, 355 assignments, 19 announcements synced, zero token/secret leakage in
any log across the whole test window), and the Rabbit R1 (versionCode **22**) installed in place and
verified live rendering real assignment data with a working same-origin Canvas deep link — see
*Phase 10 → Checkpoint 10.1B* below for the full record. Phase 9's own checkpoint history (9.0–9.8)
is unchanged and remains below Phase 10 in this file. Phase 8 closed 2026-09-12 (ADR-061; record
`docs/PHASE-8-CLOSEOUT.md`, checkpoint detail `docs/history/phase-8.md`).
**Canonical architecture:** `docs/ARCHITECTURE.md` · **Canonical decisions:** `docs/DECISIONS.md` · **Historical record:** `docs/history/` · **Agent-readiness inventory:** `docs/AGENT-READINESS.md`

---

## How to read this file

This file is **present state only**. It was 7,283 lines and 689,163 bytes before Checkpoint 8.0,
which auto-loaded ~172k tokens into every agent context through `CLAUDE.md`. Closed-phase material
lives in `docs/history/`, **verbatim and unaltered** — nothing was deleted, shortened or rewritten,
only relocated. Phase 8's own record (1,522 lines, 112,508 bytes) was partitioned the same way at
the Phase 8 closeout, proven byte-exact by SHA-256 (`b72fe7f6…`).

If you need the detail behind any completed checkpoint, open the phase file. If you need to know
what is true *now*, it is in this file.

## Where the history lives

| File | Phase | Contents |
|---|---|---|
| `docs/history/phase-0.md` | Phase 0 | Foundation, Docker Compose, least-privilege roles, Tailscale Serve, first deployment |
| `docs/history/phase-1.md` | Phase 1 | Capture core, LLM parser, recurrence engine, provider-agnostic AI layer |
| `docs/history/phase-2.md` | Phase 2 | Expo Router web app, soft-delete model, api-client, web deployment |
| `docs/history/phase-3.md` | Phase 3 | Native builds, device pairing, PTT, reminders, push, Rabbit R1 spike (**MVP**) |
| `docs/history/phase-4.md` | Phase 4 | Calendar UI, RRULE editor, occurrence detach, Google Calendar + CalDAV sync |
| `docs/history/phase-5.md` | Phase 5 | Today command center, projects, reviews, agenda, Daily Brief |
| `docs/history/phase-6.md` | Phase 6 | Google Health cloud integration (ADR-046) |
| `docs/history/phase-7.md` | Phase 7 | Gmail integration, mail digest, service monitoring — **7.0 through 7.9; Phase 7 is closed** |
| `docs/history/phase-8.md` | Phase 8 | Consolidation & adoption — **8.0 through 8.6D; Phase 8 is closed**. Companion records: `docs/SOAK-8.5.md`, `docs/CHECKPOINT-8.6-DECISION.md`, `docs/CHECKPOINT-8.6B-DESIGN.md`, `docs/SOURCE-DURABILITY.md` |
| `docs/history/superseded-present-state.md` | — | Prior revisions of this file's present-state sections, archived verbatim by 8.0 |

## Production state at a glance

Verified first-hand at the Checkpoint 9.8 acceptance, 2026-09-15 ~08:15Z (earlier checkpoints'
own acceptance evidence is preserved in their own entries below).

| | |
|---|---|
| Migration level | **21** (`0000`–`0020`); local and production agree |
| Serving commit | api, worker **and web** at **`1e406f7`** (Checkpoint 10.1B, all three recreated 2026-09-16). Provenance is by compose `working_dir` (`personal-os-10.1-release`); the images carry no commit label. Rollback images `personal-os-{api,worker,web}:rollback-pre-10.1`, tagged by resolved digest (every earlier `rollback-pre-*` tag preserved underneath). |
| Containers | all four `RestartCount=0`; api `(healthy)`; postgres `postgres:17-alpine` up since 2026-08-30; `GET /health` → `ok` / `connected` / `stale:false` |
| Rabbit R1 | `com.himal.personalos` **versionCode 22**, built from `1e406f7` (EAS build `23f032f5…`), installed in place with SecureStore credential, primary-device row, exact-alarm appop, `POST_NOTIFICATIONS` and `firstInstallTime` (2026-08-19) all preserved — no re-pair, signature unchanged. Carries the new Canvas "upcoming assignments" Today card verified live with real data; the 9.7 "Ask about today" flow and 9.8 "Suggested Focus" card are unchanged. |
| Canvas (10.1/10.1B) | `packages/canvas-providers` + six new tables, PAT-authenticated, read-only. **Live-validated against the owner's real UTA account 2026-09-16**: connect → sync (16 courses, 355 assignments, 19 announcements, 0 events — the account has none) → idempotent resync (unchanged row counts) → disconnect (credential triple verified NULLed) → invalid-token rejected (`400 canvas_auth_failed`, no provider prose) → reconnect → resync, left **active** and synced. `GET /canvas-assignments/upcoming` verified correct on both api and the physical Rabbit R1; the same-origin "open in Canvas" link verified live (tapped, opened the real `uta.instructure.com` SSO redirect). Zero occurrences of the PAT or any warn/error line in api/worker logs across the whole test window. `canvas.sync-cron` confirmed registered in the worker's startup log (31 queues, up from 29; 11 schedules, up from 10). |
| Capture front doors | Quick Capture · PTT · Siri/Assistant · Android share sheet (8.4) · launcher shortcut (8.4) · **notification-shade capture (9.1)** — a persistent local "Capture" notification on its own channel, tap opens the same composer; verified live on the Rabbit R1 across two sequential taps (the rearm-with-a-fresh-identifier fix), producing a real `inbox_items` row (`source: "web"`, parsed as a task, archived after verification). |
| Reminders (9.4) | Scheduled by the primary device from **`GET /reminders`** — one item per one-off task with a reminder and one per open occurrence of a recurring task (derived from the parent's `remind_at` wall clock and its day-offset from `due_at`, in `recurrence_timezone`; `snoozed_until` overrides). Deterministic identifiers `reminder:<key>:<instant>`, exact alarms (`window=0 exactAllowReason=permission`, verified in `dumpsys alarm`), category `reminder` with **Done / Snooze 1h / Tomorrow 9am** — all `opensAppToForeground: true` (a non-foregrounding action is lost when the process is dead; verified in the installed expo-notifications source). Verified live on the Rabbit R1 with the app process killed (`am kill`, not force-stop — force-stop puts the package in Android's stopped state, which cancels every alarm): both a Snooze 1h and a Done from the shade opened the app to the task with the outcome banner, mutated the right occurrence, dismissed the notification and re-armed the next alarm. |
| Notification channels (9.1) | `reminders` (MAX, unchanged, local reminders only) · `alerts` (HIGH, new — integration/monitor alerts) · `updates` (DEFAULT, new — confirmations + mail digest) · `capture` (LOW, new — the local shortcut only, never through `notifications.dispatch`). All four verified independently listed and toggleable in Android's per-app notification settings on the Rabbit R1; a live test alert (via the existing `notifications.dispatch` job, `category: "alert"`) delivered on the `alerts` channel at `importance=4`. |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active**. Health stream `daily-heart-rate-variability` **re-enabled 2026-09-12T23:58Z** after 9.0 corrected its value spec from a live shape observation: `available_in_window`, `first_data_date 2026-09-11`, one stored row with the deep-sleep RMSSD in `breakdown`, 24/24 streams succeeded on the acceptance pass. |
| Calendar sync | 2 of 5 calendars enabled (owner's real primary + the dedicated test calendar). 98 imported events, all `origin='external'` (read-only). **Calendar authoring (9.5):** `POST /events` with `calendar` → durable `pending_push` link → worker push with a link-derived Google id → inbound adoption; `GET /calendar-targets` offers the two write-eligible calendars (roles `owner`; the holidays calendar is `reader` and excluded). Roles and display names are refreshed by the worker's five-minute calendar cron (first tick 2026-09-14T12:00Z: `updated:5 cleared:0`). |
| Monitoring | 5 active targets (+1 archived 8.6D smoke target); **0 incidents ever, 0 open**; full CRUD live (8.6D) |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row. **`ask` (Cloud Ask, 8.6B) absent — OFF**, as shipped; the owner enables it from Settings. |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Source durability | `origin` = `https://github.com/Himalpok1/Personal-OS` — **PRIVATE**. No CI, no Actions workflow, no repository secret. |
| Test baseline | **5,815 tests across 12 packages** (9.8 at `a08311d`; was 5,735 at 9.7, 5,495 at 9.6, 5,062 at 9.5, 4,636 at 9.4, 4,141 at 9.3, 3,853 at 9.1, 3,788 at 9.0, 3,668 at the Phase 8 closeout — see *Last verification*) |
| pg-boss | **29 queues** (`worker.started` count; `pgboss.queue` reads 30 with the internal `__pgboss__send-it`), 10 schedules. DLQs on `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, the three calendar queues and — since 9.0 — **`occurrences.generate-lazy` → `.dead` and `occurrences.expand-window` → `.dead`**, both verified attached in production `pgboss.queue` and both consumed by registered workers. Every retrying queue now has a dead-letter queue. **`occurrences.expand-window` has a phase 2 since 9.4**: idempotent repair of any completion-anchored parent left with no open occurrence, per-parent contained, failures (including an insert collision that leaves no open row, `reason: collision`) counted into the same `OccurrencesJobError` → dead letter → alert. |
| Retention cleanup | `retention.cleanup`, daily `0 4 * * *` UTC: **seven** independent DELETEs — `monitor_checks` 30d · `mail_messages`/`mail_digests` 45d · `mail_sync_runs`/`health_sync_runs` 30d (8.6C, windows unchanged) · **`health_oauth_states` / `mail_oauth_states` on the row's own `expires_at < now`, no window constant (9.0)**. 9.0 acceptance: 9 + 1 expired states deleted exactly as preflighted, rerun deleted 0. **The first scheduled run is 2026-09-13T04:00Z** and had not yet occurred. |
| Alert keys | Occurrence-scoped (ADR-058). 9.5 adds `calendar.push-event.dead:<eventId>:<link updated_at ISO>` (unexercised in production by design). First live emission `health-sync-alert:…:breaker:daily-heart-rate-variability:2026-09-12:…` accepted 2026-09-12T03:00:14Z. 9.0 adds two producers, unexercised in production by design: `occurrences.generate-lazy.dead:<occurrenceId>` and `occurrences.expand-window.dead:<UTC date>` — the latter now also covers a failed phase-2 lazy repair (9.4; body wording "could not be expanded or repaired overnight"). No new producer in 9.4. |
| Search (9.6) | `GET /search?q=&tz=&types=&order=&limit=&include_archived=` over **tasks, notes, events, projects, captures, mail** — NFKC/lowercase tokens, AND across tokens with an `all → all_without_date → any` ladder (`match_mode`), a closed date grammar under the client's `tz` (`date_filter` echoes the window; month without year = current year), integer `score` + `match.reasons` on every result, total order ending in `id`, `order=score` interleaved (default) or `order=type`; per-type `limit` and honest `counts.total`; external events searchable with `origin`, their description matched but never emitted. `GET /search/item?type=&id=` → bounded, id-cited `ItemContext` (body ≤ 1500). One guarded `search.completed` line per request (duration, mode, term count, per-type totals — never the query). Measured: ~1k rows p95 ≤ 28 ms (8 tokens, 2.5k-char bodies); 30k rows 3 tokens p95 58 ms. |
| Content bounds (9.6) | `packages/schema/src/text-bounds.ts`: titles/names 512 · task body 4000 · note body 20 000 · event description 4000 · event location 512 · project goal 2000 · parser reason 1000 / project ref 200 · capture 4000 (unchanged). User-typed → `400 validation_failed` with field path; provider/model/STT text (Google + CalDAV ingest, PTT transcript, parser tool args before validation, calendar display names) → truncated at write, surrogate-safe, counts-only log (`ptt.transcript_truncated`, `capture.parse.tool_args_truncated`, `calendar.sync.text_bounded`). Read schemas, export and the stored parse-result union stay unbounded. DB columns unchanged (`text`, no CHECK). |
| Export / Ask / Monitor CRUD | `GET /export`, `POST /ask` (widened 9.7 — see below), `GET/POST/DELETE /ai/task-routes`, `/monitor/targets` CRUD — all live, perimeter-only |
| Personal intelligence (9.7) | `POST /ask { question, tz?, scope? }`. Without `tz`: byte-shape-identical to 8.6B (task/note sources only, no `citations_present`) — proven against a frozen copy of the pre-9.7 schema, so the versionCode 18 client keeps working. With `tz`: a body-free, id-free `TodayContext` (overdue/due-today/upcoming/events/reminders/recently-completed/open-loops, one `effectiveNow`, wall-clock times in the request zone, honest totals, 12 000-char ceiling, preset-aware drop ladder) is embedded beside the 8.6B lexical `<records>` block (≤ 5 000 chars / ≤ 4 records when Today is present). `scope: "today"` (every preset chip) selects **no** note/task body at all. Every `[n]` in the answer must resolve to a real source or the call is refused (`502 ask_uncited`); sources carry server-authored `section`/`detail` labels (`[1] Overdue · P1 · title`) so a ranking claim is checkable without opening the item. A row consented before the 9.7 release instant is refused `409 ask_consent_outdated` on a `tz` request until re-created under the new disclosure. Nothing is stored; `ask` ships **OFF** (no row in production by default — the owner enables it from Settings). Future-agent tool contract (`READ_TOOL_NAMES` + schemas + budgets) defined in `packages/schema`, no runtime, no writes, no `posops_readonly` role yet (ADR-066). |
| Suggested Focus (9.8) | `POST /focus/suggestion { tz }` — reuses the `ask` route as its consent switch (no new row, no new disclosure surface) and `buildTodayContext(preset: "focus")`, the identical context Ask's own "focus" preset chip already builds. Candidates are the tasks in `overdue`/`due_today`; below `FOCUS_MIN_CANDIDATES` (2) the route refuses (`409 focus_not_enough_candidates`) **before resolving any provider** — no model call below two candidates. The model must cite **exactly one** candidate, validated against the overdue/due-today ref set only (never the full Today ref space); zero or multiple citations, or one outside that set, is `502 focus_uncited`. `apps/api/src/focus/generate.ts` is Guard 1's sixth pinned `generateText` call site, living outside `apps/api/src/intelligence/` so Guard 4 needed no change. Mobile: a deterministic strip renders for free from data Today already fetches; the one AI line fires only on an explicit tap, never on mount (source-regex-guarded, mirroring `today-ask-chip.test.ts`); a `useRef` reentrancy guard in the Today screen (not local state in the reused hookless card) stops a rapid double-tap from firing two requests. Nothing is stored; no new notification channel; fully manual (ADR-067). |
| Recurrence routes (9.4) | `POST /occurrences/:id/snooze` (task-only, ≤ 31 days, `409 occurrence_not_open` / `occurrence_not_task`, `400 validation_failed` path `until`) · `POST /occurrences/:id/reopen` (latest terminal only; withdraws the open successor of a completion-anchored parent; `409 occurrence_not_reopenable` / `task_not_open` / `occurrence_not_task`) · `GET /occurrences?order=asc|desc` · `GET /reminders?horizon_days=` · `due_date` rules validated at `POST/PATCH /tasks` (`400 validation_failed`, token-only `unsupported_frequency` / `embedded_until_count` / `invalid_rrule`) · `POST /tasks/:id/complete` redirects to the earliest **effective** open occurrence (`greatest(occurs_at, snoozed_until)`). All verified live through real routes on 2026-09-14 (smoke rows archived). |
| 404 logging | **Unknown routes never log or echo their query string (9.0).** A `setNotFoundHandler` replaces Fastify's `basic404`; the `req` serializer drops the whole query for `request.is404`, for every `OPTIONS` (served by `@fastify/cors`'s `OPTIONS *`), and for malformed URLs (`frameworkErrors`). Verified live with four sentinel values: 0 occurrences in the api log; body `{"error":"not_found"}`. |

---

## Phase 9 — OPEN (2026-09-12)

### Checkpoint 9.0 — Reliability & privacy housekeeping: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-12)

Four items carried out of Phase 8, closed in one bounded pass. Commit **`6ff3287`** on branch
`phase-9-reliability` (from `b41f8f0`); **no migration, level stays 17, `packages/db` byte-unchanged**.
Decision record: **ADR-062**. Built by four parallel implementation lanes on per-lane clones of the
test database, seven adversarial review lenses (0 blockers, 6 majors — all fixed or routed and
resolved), then integrator verification.

**A — occurrences reliability.** Both `occurrences.*` queues have dead-letter queues, attached with
the 8.6A `createQueue → createQueue(deadLetter) → updateQueue` sequence so the attach lands on the
already-existing production rows (the api's startup attached `generate-lazy` before the worker was
even recreated). **Durable failure semantics:** exhaustion alerts through the existing
`notifications.dispatch` router with an occurrence-scoped key — `occurrences.generate-lazy.dead:<occurrenceId>`
/ `occurrences.expand-window.dead:<UTC date of the dead job>` — leaving a permanent
`notification_dispatch_log` row (queue, occurrence id or date, `attempted_at`, delivery status) plus
one structured log line per failure. This is the only zero-migration durable record available:
`occurrences.status` and `tasks.status` are CHECKed closed vocabularies with no jsonb, and it
presupposes ≥1 device eligible for alerts (alerts on, notifications on, not revoked, push token) —
production has one, and the same precondition every alert producer already has; with none, the log
line still records the exhaustion and `alert: no_targets`. The generate-lazy dead handler is
idempotent on CURRENT state (occurrence missing / task closed / not completion-anchored / an open
occurrence already exists → no-op with a closed `reason`), makes **one** further idempotent
regeneration attempt (the realistic exhaustion cause is a transient outage that has healed), and
alerts only if that throws — with the task's control-stripped, 80-char-capped title in the body and
ids only in `data`. `expandDueDateWindowJob` now has **per-parent containment**: one bad rule no
longer stops expansion for every parent after it; the contained `OccurrencesJobError` carries counts
and a bounded (≤20) list of failed parent ids, never raw error text, and the dead handler re-logs
those ids at dead-letter time. `generate-lazy`'s four `console.warn`s are structured logs and its
rethrows are token-only. Guards: real pg-boss runtime tests prove the attach against a pre-existing
queue in **both** processes; `queue-parity`/`queue-containment` cover the new queues and are no
longer satisfiable by a comment.

**B — 404 privacy.** Contract in the production-state table above. Regression coverage runs the
real `buildServer` with a captured pino stream (`apps/api/src/server.not-found.test.ts`, 19 tests)
including OPTIONS, HEAD, `#`-delimited queries and malformed percent-encoding. Known routes are
byte-for-byte unchanged (name-based scrubbing of `code`/`state`/`access_token`/`q`).

**C — Health HRV.** Root cause: the `daily-heart-rate-variability` leaf was the catalog unit string
mistaken for a field name (`observed: false`). A read-only, value-free shape probe (field names and
JSON kinds only) run from a throwaway container on the current api image observed the real record:
`dailyHeartRateVariability.{averageHeartRateVariabilityMilliseconds, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds}`,
corroborated by Google's reference. Spec corrected (`observed: true`, deep-sleep RMSSD in the
allowlisted breakdown), the old shape pinned as rejected, fixture added. The same review corrected
three still-unobserved specs to their documented names (SpO2 `averagePercentage`, respiratory rate
`averageBreathsPerMinute`, weight `int64 → double` — strictly more permissive; weight is live and
kept syncing). **Sync runs now record WHICH shape was rejected**: the rejection code as a token in
`health_sync_runs.error_message` (e.g. `value_shape_violation LEAF_MISSING`) and one value-free
`health.sync.rejection` line per distinct `{code, keyPath, sawType, count}` — the information whose
absence forced this checkpoint's live probe. Re-enabled through `PATCH /health-connections/:id/streams`
only after the fixed worker was serving (the breaker reads the last five runs); the manual pass
succeeded 24/24.

**D — OAuth-state sweeps.** Wired, not deleted-as-dead: ADR-047 records the intent that expired
states are swept. The two zero-caller `apps/api` functions were deleted and the cleanup lives in the
existing `retention.cleanup` job as two further independent DELETEs on `expires_at < now` (the pass's
single captured instant; no window constant because the row carries its own 10-minute TTL;
`consumed_at` not consulted). A live in-flight state has `expires_at` strictly in the future and
cannot match; a deleted row changes only which `InvalidStateError` message branch a later consume
throws (same class, same `400 invalid_state`). Irreversible under ADR-024.

**Deployment** (frozen order): `git archive` of `6ff3287` to `/home/himallinux/personal-os-9.0-release`
(855 tracked files; no `.env`, no `google-services.json`) · rollback images tagged by resolved digest
`:rollback-pre-9.0` for api and worker · api + worker built · new images verified (17 migrations,
highest `0016`; every 9.0 artifact present) · `drizzle-kit migrate` from the new api image with
`--no-deps` applied nothing (17 → 17) · `api` recreated alone → `(healthy)` · `worker` recreated alone →
`worker.started queues:29 schedules:10`. Web untouched.

**Production acceptance — PASSED.** *occurrences*: both `dead_letter` columns non-null, both dead
queues exist; a safe synthetic exercise through the real handlers — `generate-lazy` and
`generate-lazy.dead` with a non-existent occurrence id, plus a normal `expand-window` sweep — all
three `completed` within seconds, the dead handler logged `reason: occurrence_missing` and alerted
nobody (0 `occurrences.*` dispatch-log rows), the sweep expanded 2 events / 0 failed. A synthetic
`expand-window.dead` job was deliberately **not** sent: it would push a real alert and burn that
date's key; retry-exhaustion routing is proven by the real-pg-boss test suite, not live. *404*: four
sentinel values against unknown routes, an OAuth-callback typo and `?q=` — **0 occurrences** in the
api log, path/method/`route_not_found` preserved, known routes unchanged. *HRV*: above. *OAuth
sweeps*: preflight 9 + 1 eligible, run 1 deleted 9 + 1 (`tablesOk:7`), run 2 deleted 0; every log
line counts-only. Post-acceptance: all four containers `restarts=0`, `/health` `ok`/`stale:false`,
three integrations `active`, 0 incidents, 0 failed/retry/active jobs, 0 api error/warn lines; the
only worker warn lines are the synthetic exercise's own.

---

### Checkpoint 9.1 — Daily-use: notification-shade capture, alerts channel, calendar-toggle fix (2026-09-12/13)

**Theme shift, per owner direction.** Infrastructure reliability is no longer the primary Phase 9
driver; this checkpoint targets the daily capture/reminder loop directly, ahead of a future 21-day
adoption soak. Three deliverables, built by three parallel implementation lanes, then adversarially
reviewed twice (a first pass found two blockers and one real bug; a second pass, after fixes,
confirmed the blockers closed and found two further narrow real bugs, also fixed and re-verified).
**Zero migrations — level stays 17.**

**A — Notification-shade capture.** Goal: pull down the shade, tap a Personal OS action, get the
existing Quick Capture composer, without opening the app first. **No new native Kotlin code and no
`expo-task-manager`** — both were live candidates going in; `expo-notifications@57.0.12`'s
`NotificationContentInput.sticky`/`.autoDismiss` (Android's `isOngoing`/`setAutoCancel`, confirmed
against the real v57.0.0 docs and the installed native source, not just type comments) already give a
persistent, tappable local notification with zero native additions, and ADR-060 had already
established that Android direct-reply is not durably viable without `expo-task-manager` — this
feature never needed direct-reply at all, since a tap just opens the composer. Tapping the shortcut
synthesizes the SAME `kind: "compose"` `CaptureIntent` shape the Checkpoint 8.4 launcher shortcut
already produces, so it re-enters the identical capture pipeline (composer → `capture.mutate` →
outbox on failure → `source: "web"`) with zero changes to `quick-add-fab.tsx`, the capture API, or
`CaptureSourceSchema` — no new capture source, no migration.

Two blockers surfaced by the first adversarial review, both fixed and re-verified by the second:
(1) reposting under one constant notification `identifier` (needed so Android's `notify(tag,id)`
replaces rather than duplicates) meant `expo-notifications`' own `useLastNotificationResponse` and
this app's `handledIdRef` — both dedupe by `identifier` — could only ever deliver ONE tap per app
process; fixed by rotating the identifier on every post (`makeCaptureShortcutNotificationIdentifier`)
and rearming (repost + dismiss-the-stale-one-by-content-marker, via `getPresentedNotificationsAsync`
+ `isCaptureShortcutNotification`, never by a remembered identifier — a fresh process has no memory
of what a prior process posted) immediately after handling a tap. (2) A genuine cold launch can
deliver the launching tap (`useLastNotificationResponse`'s synchronous `useLayoutEffect`) before
`QuickAddFab` — and its `useCaptureIntent` subscription — has mounted, since that's gated behind an
async SecureStore read; fixed by buffering an unattended tap (`capture-shortcut-signal.ts`'s
`pendingTap`) and consuming it immediately on the next subscribe, mirroring the native
`CaptureIntentModule`'s own "pending slot is the source of truth" pattern. A third finding — the
shortcut was never gated on device pairing, so it could offer a tap with nothing mounted to receive
it — is closed for the hook's own mount/foreground path via `useDeviceIdentity()`
(`useCaptureShortcutNotification`), and, since the tap-driven REARM call is a plain non-hook function
that can't call a hook, via a small synchronous snapshot (`device-identity/paired-state.ts`) the
provider keeps in lockstep. Accepted trade-off, unchanged from the original design: no
`BOOT_COMPLETED` receiver — the shortcut is reposted on mount and on every `AppState`→`"active"`
transition, not restored automatically after a reboot with the app never opened.

**B — Dedicated alerts channel.** `apps/mobile/src/notifications/channel.ts` now creates four Android
channels instead of one: `reminders` (MAX, unchanged, local scheduled reminders only — never touches
`notifications.dispatch`), `alerts` (HIGH, new — every `category: "alert"` push: calendar/mail
reauth, health-sync breakage, monitor incidents, occurrence dead-letters), `updates` (DEFAULT, new —
`confirmation` + `digest` pushes), and `capture` (LOW, new, Part A's local-only shortcut, never
routed through the dispatch log). `apps/worker/src/jobs/notifications-dispatch.ts` now sets an
explicit `channelId` for every category instead of only for `alert` (which previously hardcoded the
*reminders* channel id specifically because it was the only channel that existed — that premise is
now false and the comment explaining it was rewritten rather than left stale, per the ADR-058
precedent for exactly this failure mode). A same-repo cross-file text-assertion test (mirroring
`queue-parity.test.ts`'s established pattern) pins the worker's channel-id literals against
`channel.ts`'s, so a future edit to either side that drifts from the other fails the suite rather
than silently falling back to Android's default channel. **ADR-058's dedupe-key contract is
completely untouched** — verified line-for-line unchanged outside the payload-construction block, by
two independent reviews.

**C — Rabbit calendar-toggle bug.** Root cause, confirmed by reading the code (not assumed):
`apps/mobile/src/queries/calendar-connections.ts`'s `usePersistedCalendarConnectionCalendars` had
`queryFn: () => Promise.resolve([])` — hardcoded, never called the backend at all — so on cold
launch every calendar's `sync_enabled` fell back to `mergeAvailableCalendars`'s `false` default,
regardless of the real database state. Fixed with a new `GET /calendar-connections/:id/calendars`
route (`apps/api/src/routes/calendar-connections.ts`, bare-array response shape matching the existing
PATCH route exactly) and a real client call replacing the stub. A regression test proves the fix:
reverting the `queryFn` back to the old stub was confirmed to fail the new tests before restoring it.
Both Google and CalDAV Settings cards use the identical hook/merge pair (no separate CalDAV-side bug).
Two further real bugs, both found by adversarial review and fixed: a failed persisted-state fetch
previously fell through to rendering every toggle as (misleadingly) OFF with no error indication —
now surfaced with its own retry banner, and the toggle list is suppressed entirely while unresolved,
because the toggle handler always PATCHes the FULL merged set and would otherwise silently disable
every *other* calendar too; and the identical hazard existed during ordinary *loading* (not just
error), since `available` and `persisted` are two independent, unsynchronized queries and one can
resolve before the other — now guarded by the same suppression, gated on `isLoading || isError` for
the persisted query, not error alone.

**Files changed:** `apps/api/src/routes/calendar-connections.ts`, `packages/api-client/src/{calendar-connections,index}.ts`,
`apps/mobile/src/queries/calendar-connections.ts`, `apps/mobile/src/app/settings.tsx`,
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/notifications/{channel,push-token,use-reminder-reconciliation,use-notification-lifecycle}.ts`,
`apps/mobile/src/capture-intent/use-capture-intent.ts`, `apps/mobile/src/device-identity/provider.tsx`,
`apps/worker/src/jobs/notifications-dispatch.ts`, plus new files
`apps/mobile/src/notifications/{capture-shortcut-notification,capture-shortcut-signal,use-capture-shortcut-notification}.ts`
and `apps/mobile/src/device-identity/paired-state.ts`, each with a matching test file.

**Verification:** `pnpm typecheck` 21/21 · `pnpm build` 11/11 · `eslint .` clean · `prettier --check .`
clean · `git diff --check` clean · `gitleaks detect` — the same 18 pre-existing findings in ignored,
untracked files (`.env`, `google-services.json`, `apps/mobile/.expo/dev/logs/export.log`), no new
leaks · `pnpm test --force --concurrency=1` (turbo), run against the shared `personalos_test`
database as integrator after each parallel lane and each review round used its own isolated clone
(per the established `CREATE DATABASE ... TEMPLATE personalos_test` workaround) — **21/21 tasks,
3,853 tests across 12 packages, zero failing** (api 848 · mobile 727 · worker 545 · core 486 ·
schema 322 · health-providers 332 · api-client 146 · mail-providers 116 · monitoring 151 ·
calendar-providers 76 · db 79 · ai-providers 25).

**Deployment and acceptance: COMPLETE (2026-09-13).** Frozen order: release shipped via `git archive`
of `77ea112` to `/home/himallinux/personal-os-9.1-release` (no `.env`, no `google-services.json`) ·
rollback images tagged by resolved digest `:rollback-pre-9.1` for api and worker · both images built
· new api image verified (17 migrations, highest `0016`; the new calendar-connections route and the
worker's new channel constants both present in the built image, checked directly) · `drizzle-kit
migrate` from the new api image with `--no-deps` applied nothing (17 → 17, via an explicit
`MIGRATIONS_DATABASE_URL` pass-through — neither `docker-compose.yml` service wires that var into the
container by default, only `DATABASE_URL`) · `api` recreated alone → `(healthy)` · `worker` recreated
alone → `worker.started queues:29 schedules:10` (unchanged, as expected for a payload-construction-
only change). Web untouched, per dependency-scoped deployment reasoning (see the production-state
table above).

**Physical Rabbit R1 acceptance — PASSED, evidence below is first-hand, not inferred.**

- **Capture.** Cold-launched the app post-install (device already paired, `firstInstallTime`
  preserved, no re-pair) — the "Capture" notification appeared in the shade under Android's low-
  importance "Silent" grouping within moments, tagged `capture-shortcut-1`. Tapped it: the app opened
  directly to the Quick Capture composer. Typed and submitted a smoke capture; it reached the server,
  parsed as a task (`source: "web"`), and the notification rearmed under a fresh tag
  (`capture-shortcut-3`, confirmed via `dumpsys notification`, no duplicate/stacked entry). **Tapped
  the rearmed instance a second time** — the composer opened again, directly proving the multi-tap
  fix (the original identifier-reuse blocker) on real hardware rather than only in mocked tests. The
  smoke task was archived afterward (not hard-deleted), matching the Gate H precedent.
- **Alerts channel.** All four channels (`Alerts`, `Updates`, `Quick capture`, unchanged `Reminders`)
  are listed and independently toggleable in Android's per-app notification settings. Sent one real
  `notifications.dispatch` job (`category: "alert"`, a distinct one-off `dedupeKey`, `retryLimit: 0`)
  through the actual worker — no synthetic failure was manufactured, per instruction. It was
  `accepted` in `notification_dispatch_log` and arrived on-device as a heads-up notification on the
  `alerts` channel at `importance=4`, confirmed both via `dumpsys notification` and a screenshot.
- **Calendar.** Settings → Connected Calendars renders exactly the two truly-enabled calendars ON and
  the other three OFF — matching the database precisely, where before this fix all five would have
  rendered OFF. Force-stopped the app and cold-relaunched: identical state, proving the fix isn't a
  same-session cache artifact.

**Post-acceptance production health:** all four containers `RestartCount=0`; 0 rows in
`state in ('failed','retry')` in `pgboss.job`; 0 `warn`/`error` API log lines in the 20 minutes
following the redeploy; three integrations still `active`; no `FATAL`/crash lines in the Rabbit R1's
logcat for the app process since install.

### Checkpoint 9.2 — 21-day adoption soak: OWNER-TERMINATED BEFORE MINIMUM DURATION (2026-09-14T01:53:37.600Z)

**Terminated by explicit owner decision 25 min 27 s after it began (0.08 % of the 21-day minimum;
no milestone reached).** The owner chose development velocity over completing the observation
window — an intentional product/development-priority decision, not a technical failure. **No
adoption conclusion of any kind may be drawn** (not successful, failed, weak, mixed, meaningful or
insufficient), the partial window may never be reinterpreted as 21-day evidence, and 9.2 is not
compared to 8.5 as an equivalent experiment. Preserved verbatim in `docs/SOAK-9.2.md`: start,
intended end, actual termination timestamp (production DB clock), elapsed duration, baseline, both
observation lines (zero window activity — descriptive only, meaningless over 25 overnight minutes),
and the reason. Both scheduled observer tasks are disabled; observation files are preserved
read-only outside the repository. **Freeze exceptions: 0. The adoption-critical freeze is LIFTED.**
The reviewed read-only observer tooling stays in `scripts/soak/` for any future soak, which would be
a new checkpoint with a new baseline. The record below is the start-of-soak entry, retained as
written.

#### As recorded at soak start (2026-09-13 20:28 CDT)

**Purpose.** With the daily-use friction of 8.1–9.1 removed, observe — never manufacture — whether
Personal OS becomes part of the owner's real workflow over a sustained 21-day period. This is a
product-observation checkpoint; its deliverable is evidence. It is the first valid long-form
adoption observation: the 8.5 soak was terminated after 9.1 hours and produced none, and the two
runs are never compared as equivalent experiments.

**Window.** `SOAK_START = 2026-09-14T01:28:10.274Z` (the production database clock at the baseline
observation; 2026-09-13 20:28 CDT) · `SOAK_END = 2026-10-05T01:28:10.274Z` (2026-10-04 20:28 CDT),
exactly 21 × 24 h. The window touches 22 Chicago calendar dates, the first and last partial.

**Pre-start.** `902b568` pushed to `origin` (was 2 ahead); local and remote identical. Baseline
taken with the frozen read-only observer; production `GREEN` on every check condition. Full
baseline, frozen metric definitions, frozen surfaces, incident classes and the monitoring method are
in **`docs/SOAK-9.2.md`** — deliberately outside the auto-loaded set so 21 days of readings do not
inflate agent context.

**Tooling (read-only, counts only, no analytics SDK, nothing added to production):**
`scripts/soak/soak-9.2-observe.sql` (one statement, 118 keys — counts, dates, status tokens and
8-char id prefixes; never a title, body, subject, address, value or log line) and
`scripts/soak/soak-9.2-observe.sh` (`baseline` / `observe` / `final` / `check`). Observations go to
`~/.personal-os-soak/9.2/` on the development machine, outside the repository. Before the baseline
locked the definitions, five adversarial review lenses (SQL correctness, privacy, metric
definitions, shell robustness, check thresholds) found and the integrator fixed: a locally-authored
event discriminator that would have counted a third party's meeting cancellation as an owner action
(closed by the sync-archive signature `updated_at < archived_at` plus slot-matched instance rows); an
un-allowlisted free-text dedupe-key prefix and task-name column reaching the record; a check mode
that re-graded yesterday's line as GREEN when today's run failed, cascaded on an `ok:false` line,
and never read the freshness, dispatch-failure, device-eligibility, stream-count or monitor-volume
signals the SQL already computed; cumulative counters that would have re-alarmed daily (now delta-
based, with standing counts as `INFO`); and `SOAK_START` depending on the scheduler's environment
(now defaulted from `baseline.json`).

**Automation.** Two desktop scheduled tasks: `soak-9-2-daily-observer` (06:23 America/Chicago
daily, effective ~06:29 with dispatch delay) runs `observe` + `check` and pushes **only on RED** or
when the observer itself cannot run — GREEN/YELLOW/INFO are logged locally, never pushed; and
`soak-9-2-day-21-final-snapshot` (one-shot at `SOAK_END`) takes the `final` snapshot and notifies
that the analysis is ready. Caveat recorded: both run only while the Claude desktop app is open on
the development machine; a missed day runs on next launch, the gap is visible in
`observations.jsonl`, and every adoption metric is recomputed from durable production data at Day
21 regardless.

**Active day (frozen):** a Chicago calendar day with ≥1 of: capture · direct task creation · task
completion · note creation · local calendar action · review completion · project creation · Cloud
Ask (log-only, attributed to the previous date). Reads never count.

**Baseline (starting point, NOT evidence):** 11 captures (`web` 6 · `ptt` 4 · `share` 1; 3
`needs_confirm`, all `unclear`) · 7 tasks (0 open unarchived, 0 live future reminders) · 6 notes ·
0 projects · 98 events (all sync-ingested) · 1 occurrence · 1 review · 2 briefs · Cloud Ask OFF ·
1 active device (primary, reminder-eligible) · 3 integrations `active` · 0 incidents ever ·
migration 17 · all containers `RestartCount=0`.

**Pre-existing caveats (Class A, do not block):** Google Health `daily-respiratory-rate` was
breaker-disabled 2026-09-13T05:00Z on first real data (`value_shape_violation LEAF_MISSING`, one
occurrence-scoped alert accepted) — 17 of 19 streams enabled at baseline; the 3 `unclear` inbox
items keep Today's attention counter non-zero; the web image still predates 9.1; and all
already-classified non-blocking debt (D1e, sleep-temperature spec, capture-shortcut repost race,
buffered-tap expiry, successor seed path, `bossReady` loss, unbounded event text, monitor URL
guard) is carried unchanged.

### Checkpoint 9.3 — Close the capture→task loop: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-13/14)

**Selection (parallel evidence-based ranking, same session as the 9.2 closure).** Six read-only
area audits (tasks/reminders/recurrence · search/knowledge · calendar/planning · capture/inbox ·
Daily Brief + projects · health) produced 21 scored candidates; an architectural/dependency ranker
and an adversarial prioritizer then ranked them independently on the owner's eight criteria
(weights: daily value 3 · usage lift 3 · low cost 2 · low privacy risk 2 · dependency risk,
shippability, architecture fit, blocking debt 1 each). **Both rankers converged on the same top
four, in the same order, with no product-direction tie**, so no owner decision was required:

| Rank | Candidate | Both rankers | Why |
|---|---|---|---|
| 1 | **D1** in-app "File as…" editor for `unclear`/`needs_confirm` captures | 4.43 / 61 | 3 of 11 production captures are stuck with no in-app route; the server-side ADR-060 `corrected_tool_call` hatch already exists and the client already plumbs the body — only the UI is missing |
| 2 | **A2** task follow-through on the Rabbit (complete/reopen/snooze from the screen a reminder tap lands on) | 4.29 / 54 | a fired reminder opens an edit screen with no Complete; no reopen transition exists anywhere (a mis-tap on Done is permanent); no snooze exists |
| 3 | **D2** inbox archive/dismiss (`archived_at`, one additive migration) | 4.00 / 47 | a Today counter that can never reach zero trains the owner to ignore it (the 8.5 friction item); adversarial ranker preferred zero migrations — included as a detachable lane |
| 4 | **A1** recurrence integrity (three verified silent-loss paths, API + worker, no APK) | 3.93 / 52 | completion with pg-boss down loses the successor forever; a rule edit cannot repair it; a captured `due_date` recurring task has no occurrences until 03:00Z |
| ride-along | **D4-min** confirm accepted on `failed`; **brief:2** priority + has_reminder scalars, measure() fix | 49 / 49 | API-only, minutes each, inside ADR-043's closed allowlist |
| deferred | B1/B2/C4 search+event bounds · C2/C3 calendar authoring/planning · E2 health trends · brief:1 scheduled brief · projects (deprioritised outright: 0 projects, 0 open tasks) · E3/brief:3 health-in-brief (owner egress decision) | — | honest area verdicts: "not on its own" — search's lever is content volume; calendar bugs are latent and untriggered; health is passive by ADR-046 |

**Bounded scope.** One migration (`0017`, `inbox_items.archived_at`, byte-pattern of `0016`), one
APK, one api+worker deploy under the frozen order. Contracts: `POST /tasks/:id/reopen`; distinct
`409 recurring_task_no_open_occurrence`; occurrence complete/skip idempotent on terminal rows with
the completion-anchored successor inserted **in the same transaction** (worker job becomes a
belt-and-braces re-check); `PATCH /tasks/:id` seeds/re-points the single open lazy occurrence;
captured `due_date` recurring tasks materialize their window at commit; `POST /inbox/:id/archive`
(idempotent, never deletes) with Today/search excluding and export including archived rows; confirm
accepted on `failed`; new `/inbox/[id]` screen with File as task/note/event, Dismiss, human-readable
parse summary and tap-through; capture follow-through ("Filed as …") with bounded polling; task
detail gains status, Complete/Drop/Reopen/Start, snooze chips (pure DST-safe math in
`packages/core/src/task-snooze.ts`), an error banner; Today completes occurrence rows directly via
the `occurrence_id` it already receives; list-row Drop/Archive gain the confirm gate. **Out:** rrule
in any correction, notification action buttons, recurring reminders (A3), long-press sheets,
reclassify of auto-filed captures, anything in the deferred rows above.

**Execution.** Five parallel implementation lanes with disjoint file ownership on per-lane clones of
`personalos_test` (L1 api tasks/occurrences · L2 inbox archive + migration · L3 worker window-at-
commit + Brief scalars · L4 mobile inbox · L5 mobile tasks), then four adversarial review lenses
(recurrence invariants · API contracts/schema/migration · mobile correctness/privacy · Brief/AI/
logging), fixes, full gates, frozen-order deployment, EAS build, in-place Rabbit install, physical
acceptance. Same-session; no soak wait follows.

**Implementation record.** All five lanes reported green on their clones (L4 one cross-lane export
short, closed at integration). Integration added: the `archiveInboxItem` api-client binding; search
results for an uncommitted capture now route to `/inbox/<id>`; the export inbox shape gains
`archived_at` (additive); migration `0017` applied to the dev and shared-test databases with
`db:reconcile` clean. **Adversarial review found 3 majors and 5 minors, all fixed in-checkpoint with
tests that fail on the old code:**

- *Recurrence (major ×3):* the new window-at-commit ran after the task insert, outside a
  transaction, and `expandDueDateWindow` throws on a parser-emitted rule the tool schema never
  validated — every `capture.parse` retry inserted another orphan task (reproduced: three rows from
  one `"every monday"`). Now validation, instant resolution and expansion happen **before** any
  insert and the task + occurrences commit in one transaction; and an unparseable rule is refused at
  confirm with the existing token-only `409 parse_result_not_committable` (new shared
  `hasCommittableRecurrence` in `packages/core`). `validateCompletionAnchoredRule` checked part
  *names* only, so `FREQ=WEEKLYY` / `INTERVAL=0` were accepted at write and then threw inside the
  in-transaction successor, rolling back the completion and 500ing forever — the validator now
  validates the whole grammar (client-safe, no `rrulestr`), `validateRecurrenceRule` rejects a
  missing FREQ and non-positive INTERVAL (a negative interval spins the iterator forever), and the
  route computes the successor under a savepoint so a throw logs an ids-only warn, the completion
  still commits, and the generate-lazy job's DLQ/alert carries the failure.
- *Recurrence (minor ×3):* successors were generated for `dropped`/archived parents in both the
  new API path and the worker (`parent_closed` skip in both); the completion-date seed resolved
  `due_at` against `recurrence_timezone` while `tasks.due_at` used the capture zone (six-hour
  disagreement with an offset-less time) — now one instant; a `due_date` series with no `due_at`
  was materialized once and never re-expanded by the nightly job (`due_at IS NULL` skip) — the job
  now anchors on the parent's earliest existing occurrence, never `created_at`.
- *Contracts (minor ×2):* `PATCH /tasks/:id` accepted a BY*-bearing rule when the body omitted the
  anchor (the schema refine fires only when the body names `completion_date`) — the route now
  validates the **effective** rule and returns `400 validation_failed`; and search honoured
  `include_archived` for inbox items although the `inbox_item` result member has no `archived`
  flag — dismissed captures are now excluded unconditionally, per the contract.
- *Mobile and Brief/AI/logging lenses:* no findings (mobile tsc clean; bundle-boundary and
  inert-rendering guards pass; `ai-egress-guard` still pins exactly five call sites).

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, none tracked · **`pnpm test --force`
21/21 tasks, 4,141 tests across 12 packages, zero failing** (api 918 · mobile 838 · worker 573 ·
core 545 · schema 331 · health-providers 332 · api-client 157 · monitoring 151 · mail-providers
116 · db 79 · calendar-providers 76 · ai-providers 25; was 3,853 at 9.1). One earlier full run
showed 17 worker failures that vanished in isolation — a reviewer's vitest on the shared database
during the run, the documented shared-DB collision, not a defect. **Migration invariant:** 18 `.sql`
/ 18 journal entries, highest `0017`; the migration is `ADD COLUMN … timestamptz`, byte-pattern of
`0016`, reconcile-allowlisted; forward-compatible with the serving images, so rollback stays
image-only.

**Recorded, not fixed (debt):** ~~a sub-daily `due_date` rule (`FREQ=SECONDLY`) expands 90 days with
no budget at commit~~ — **CLOSED by 9.4** (`validateTaskDueDateRule` refuses sub-daily frequencies
at POST/PATCH; capture commit already validated); the `daily-respiratory-rate`
spec still needs a live shape probe (unchanged); ~~reminders still fire at most once per recurring
task (A3, deferred)~~ — **CLOSED by 9.4** (`GET /reminders`, one alarm per occurrence).

**Deployment — COMPLETE (2026-09-14T03:02Z), frozen order.** Commit **`8132f3b`** pushed to `origin`
first. `git archive` of `8132f3b` shipped to `/home/himallinux/personal-os-9.3-release` (896 tracked
files; no `.env`, no `google-services.json`, no `node_modules`). Rollback images tagged **by
resolved digest** `:rollback-pre-9.3` for api (`5c8cd3e3…`), worker (`402e4e74…`) and web
(`5f0a73a1…`). api + worker built (running containers untouched, verified by digest). New api image
verified to carry `0017_inbox_item_archive.sql`, `/tasks/:id/reopen`, `/inbox/:id/archive`,
`recurring_task_no_open_occurrence`; worker image carries `parent_closed`,
`hasCommittableRecurrence` and the `unanchored` expansion path. `drizzle-kit migrate` from the new
api image with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL` pass-through: **17 → 18**,
`inbox_items.archived_at timestamptz` present. `api` recreated alone → `(healthy)`, `/health`
`ok`/`connected`/`stale:false`; `worker` recreated alone → `worker.started queues:29 schedules:10`.
**Web rebuilt and recreated alone as well** (first web deploy since 8.6D; it now carries the 9.1
calendar-toggle fix and the 9.3 inbox/task screens), serving 200 on Tailscale Serve `:8443`.
`postgres` never named. All four containers `RestartCount=0`.

**Production API acceptance — PASSED (through real routes, smoke rows archived afterwards):**
`POST /tasks` with a completion-anchored daily rule → direct `/complete` → `409
recurring_task_use_occurrence` with the open occurrence id → `POST /occurrences/:id/complete` →
`done` **and a `lazy_generated` successor at +3 days written in the same call** → a second complete
→ idempotent `200 done` (no re-stamp) → the worker's re-check job `completed` with
`generate_lazy.skipped` (successor exists) → `/reopen` on an active task `409 task_not_reopenable`
→ `/drop` then `/reopen` → `active` → archived. `POST /capture` (source `web`) → parsed as a task →
`POST /inbox/:id/archive` twice → identical `archived_at` both times (idempotent) → absent from
`GET /inbox`, present with `include_archived=true`, absent from search results even with
`include_archived=true` (`counts.inbox_item 0/0`), Today's `inbox_attention_total` unchanged (the
smoke item was `parsed`, never counted) → committed task archived. **The owner's three stuck
`needs_confirm` captures were deliberately left for the owner to file from the Rabbit** — deciding
task-vs-note for their own captures is theirs, not the integrator's.

**Rabbit R1 — EAS build `5357add1…` from `8132f3b`, versionCode 13 → 14 (auto-incremented,
remote keystore reused).** Pre-install state recorded for the preservation check: versionCode 13,
`firstInstallTime` 2026-08-19 16:26:10, exact-alarm appop `allow`, `POST_NOTIFICATIONS` granted,
primary device row `c6c0b43d` unrevoked.

**Physical Rabbit R1 acceptance — PASSED (2026-09-13 22:19–22:22 CDT), first-hand.** `adb install -r`
of the 116 MB APK → `Success` (an in-place replace is refused by Android on a certificate mismatch,
so the success is the signing-continuity proof, as in 8.4). After install: **versionCode 14**,
signature hash unchanged (`ad63266e`), `firstInstallTime` 2026-08-19 preserved, exact-alarm appop
still `allow`, `POST_NOTIFICATIONS` still granted, no re-pair. Cold launch → Today renders
(`Inbox 3`), 0 crash lines in logcat. **Inbox:** the list shows human-readable summaries instead of
JSON, "Tap to file" on the stuck row, and a "Show dismissed" toggle; tapping the stuck capture opens
the new detail screen with the parse result in words, **File it as Task / Note / Event** and
**Dismiss**; the Task form pre-fills the title with an optional due field. **The owner's three stuck
captures were deliberately not filed or dismissed** — whether each is a task, a note or noise is the
owner's decision; the screen is verified, the choice is not made for them. **Tasks:** on a smoke task
the detail screen shows the status line, Complete / Drop and the snooze chips; *Tomorrow 9am* set
`due_at` to 14:00Z (09:00 Chicago, DST-correct) on the server; *Complete* → `done` with
`completed_at`, screen flipped to "Done · completed …" with **Reopen**; *Reopen* → `active`,
`completed_at` cleared. Smoke task archived afterwards (all 9.3 smoke rows archived: tasks 2/2,
inbox 1/1). One observation, pre-existing and not a 9.3 regression: a task created outside the app
does not appear in the Tasks list until a cold relaunch (client query cache; in-app mutations
invalidate, external writes do not).

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry/active; migration 18; three integrations `active`;
0 open incidents; 0 api warn/error and 0 worker error lines since the redeploy.

### Checkpoint 9.4 — Dependable recurring tasks and reminders: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-14)

**Objective (owner-directed).** A user can create a task that repeats, receive its reminder
reliably, act on it from the Rabbit R1, and have the next occurrence appear correctly without silent
loss or duplicate successors. Commit **`e7b195e`** on `phase-9-reliability` (from `c8ad0c0`); one
migration, **`0018_occurrence_snooze`** (`occurrences.snoozed_until timestamptz`, level **19**);
decision record **ADR-063**. Three parallel read-only audits (recurrence model, reminder runtime,
mobile UX), one core lane, then four parallel implementation lanes (api, worker, mobile
notifications, mobile UX) on per-lane database clones, six adversarial review lenses, four fixer
passes, integrator gates, frozen-order deployment, EAS build, in-place install, physical acceptance —
all in one session.

**What the audits found first.** Snooze was a `PATCH due_at` that, on a `due_date` series, deleted
every future occurrence and re-anchored the whole series (a weekly-Monday task snoozed to Tuesday
became a Tuesday task); Today leaked a recurring parent as Overdue/Due-today whenever its next
occurrence was more than seven days out; a `PATCH` on a `due_at`-less series anchored at `now`
while the nightly job anchored at `min(occurs_at)` — a parallel-series generator; reminders derived
from the parent's single `remind_at` fired once per recurring task, ever (the A3 debt); no
occurrence reopen existed; `due_date` rules were never validated on the API path (500 on garbage);
and `FREQ=MONTHLY;BYMONTHDAY=31` silently skipped every short month. Action buttons: the installed
expo-notifications 57.0.12 source shows a `opensAppToForeground: false` action is parked in a
static in-process list and lost when the process is dead (ADR-060's direct-reply finding applies
to plain buttons), while a foregrounding action rides the default-tap path already proven cold-start
on the Rabbit in 9.1 — so every action foregrounds.

**Contract shipped (detail in ADR-063 and `docs/ARCHITECTURE.md` "Recurrence design").**
- *Presets:* Never / Daily / Weekdays / Weekly (explicit `BYDAY`) / Monthly (`BYMONTHDAY`, `-1`
  for a month-end due date) / Every N days, plus "After I complete it" (completion anchor,
  `FREQ`+`INTERVAL` only). Bare legacy `FREQ=WEEKLY`/`MONTHLY` map to their presets; anything else
  is "Custom" with the Phase 4 editor behind "Edit advanced…", never clobbered.
- *Successor:* previous occurrence's wall-clock time on the completion date + INTERVAL by pure
  calendar arithmetic (month-end clamped), **strictly after** the completed row's own instant, computed
  through one core function with one shared `wallTimeOfNaiveTimestamp` by all five writers. A
  collision that leaves no open row is a warn + re-check at the API, a throw at the worker (→ DLQ →
  alert), a counted failure in the nightly repair — never a false "successor exists".
- *Nightly repair (phase 2 of `expand-window`):* any open completion-anchored parent with terminal
  history and no open occurrence gets its successor inserted idempotently. `bossReady=false` is not a
  loss (in-transaction successor since 9.3); `boss.send` failing after the commit is a warn + 200.
- *Anchor:* `due_at ?? min(occurs_at) ?? now`, floored to whole seconds (a millisecond anchor dropped
  the first expanded instance), persisted as `due_at` by POST /tasks and capture commit; an
  unchanged effective rule (normalised, part-order-insensitive) causes no occurrence churn on PATCH.
- *Snooze:* `snoozed_until` on the occurrence; effective instant `greatest(occurs_at, snoozed_until)`
  in one SQL helper feeding Today, Agenda, review contexts, project summaries and the complete
  redirect — a snooze may only defer; a day-before reminder snoozed by an hour moves the reminder,
  never the due. One-off tasks keep the 9.3 `due_at`/`remind_at` PATCH.
- *Reopen:* latest terminal row only; a completion-anchored parent's open successor is withdrawn in
  the same transaction (derived state; the partial unique index forbids two open lazy rows).
  `POST /tasks/:id/reopen` on a recurring parent guarantees an open occurrence.
- *Reminders:* `GET /reminders` (one-off tasks with a 1 h grace; derived occurrence reminders
  strictly future so a fresh successor never fires instantly); device schedules with deterministic
  identifiers and the `reminder` category; `${identifier}:${actionIdentifier}` dedupe released on
  failure; every mutation cancels the scheduled entry and dismisses the presented one; pre-9.4
  alarms replaced once; a missed one-off reminder within the grace is presented on the next reconcile
  (Android drops a past `DATE` trigger silently — verified in the native source).

**Adversarial review (six lenses, all findings routed to fixers, all closed with tests that fail on
the old code).** *Blocker (found independently by the recurrence and data-integrity lenses):* the
new wall-clock successor rule date-quantised the next instant, so completing or skipping a lazy
successor on the day it was generated computed its **own** `occurs_at` → unique-key collision →
every writer reported "successor exists" while zero open rows remained — a silent series death and
a 9.4 regression; closed by the strictly-after bound plus the honesty rule above, and proven live
(complete → +3 d 09:00 → same-day complete of the successor → +6 d 09:00, exactly one open row).
*Majors:* PATCH branch F / task reopen ignored `wallTime` (three lenses); the millisecond anchor
dropped the first occurrence; snooze could pull the due instant earlier; `selectNextOccurrence`
preferred an upcoming row over an overdue one; the complete redirect ordered by raw `occurs_at`;
`boss.send` failure → 500 for a recorded completion; snooze/reopen accepted on event occurrences;
retrying a failed shade action was swallowed for the process lifetime; typing an UNTIL date in the
inline advanced editor threw during render. *Minors:* reopen of a non-latest terminal withdrew the
wrong successor; branch C seeded nothing on collision; completion-anchored monthly from the 31st
skipped a month; negative reminder offsets clamped; Feb-28 last-day inconsistency; one unguarded
rule computation could log an rrule; Undo paging; stale "Due <anchor>" on recurring list rows;
stale-notification snooze got "try again" for a permanent 409; legacy alarms retained without
buttons; missed reminders never presented; banner lost when already on the task screen. *Privacy
lens:* every new log line is ids/counts/tokens, event names satisfy the logger grammar, no
`err.message` reaches a log or response, no new egress, `GET /reminders` is in the egress-guard
body-reader inventory (title only, strict shape).

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, git history clean · **`pnpm test --force`
21/21 tasks, 4,636 tests across 12 packages, zero failing** (api 1,020 · mobile 1,062 · core 682 ·
worker 605 · schema 331 · health-providers 332 · api-client 157 · monitoring 151 · mail-providers
116 · db 79 · calendar-providers 76 · ai-providers 25; was 4,141 at 9.3). **Migration invariant:** 19
`.sql` / 19 journal entries, highest `0018`; `ADD COLUMN … timestamp with time zone`, nullable, no
default — forward-compatible with the serving images, so rollback stays image-only.

**Deployment — COMPLETE (2026-09-14T07:09Z), frozen order.** `e7b195e` pushed to `origin` first.
`git archive` shipped to `/home/himallinux/personal-os-9.4-release` (935 tracked files; no `.env`, no
`google-services.json`, no `node_modules`). Rollback images tagged by resolved digest
`:rollback-pre-9.4` for api (`805157d6…`), worker (`334f2b57…`) and web (`b65fd511…`). All three
built with the running containers untouched (verified by digest). New api image verified to carry
`0018_occurrence_snooze.sql`, `/occurrences/:id/snooze`, `/reminders` and the `greatest(` helper;
worker image carries `reconcileLazyParents` and `wallTimeOfNaiveTimestamp`. `drizzle-kit migrate`
from the new api image with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL` pass-through:
**18 → 19**, `occurrences.snoozed_until timestamptz` nullable present. `api` recreated alone →
`(healthy)`, `/health` `ok`/`connected`/`stale:false`, `GET /reminders` 200; `worker` recreated alone
→ `worker.started queues:29 schedules:10`; `web` recreated alone → 200 on Tailscale Serve `:8443`.
`postgres` never named. All four containers `RestartCount=0`.

**Production API acceptance — PASSED (through real routes; every smoke row archived afterwards,
none deleted).** Daily `due_date` task with a reminder → 89 scheduled rows, `/reminders` derives
08:30 CDT per occurrence (44 in the 45-day horizon). Completion-anchored every-3-days task: complete
the seed → exactly one lazy successor at **09:00 CDT +3 d** (previous wall time, not tap time);
second complete idempotent `200 done`; **same-day complete of the successor → next at +6 d, exactly
one open row** (the blocker repro). Snooze the open occurrence +5 d → `snoozed_until` set, rule and
`due_at` untouched; snooze earlier than `occurs_at` accepted (reminder moves, due does not); past
`until` → 400, terminal row → `409 occurrence_not_open`. Reopen the latest done row → successor
withdrawn (`withdrawn_successor_id`), reopened row `scheduled`, exactly one open; reopen of a
withdrawn row → 404. PATCH title + same rule → occurrence ids byte-identical; PATCH to weekdays →
64 rows, Sat/Sun absent; `FREQ=HOURLY` → `400 unsupported_frequency`; `rrule: null` → 0 scheduled
rows, the task's reminder key flips from `occ:` to `task:`. Today shows the chore exactly once via
its occurrence, never as a bare parent. pg-boss: two `occurrences.generate-lazy` re-checks
`completed`, 0 failed/retry, 0 new `notification_dispatch_log` rows.

**Physical Rabbit R1 acceptance — PASSED (2026-09-14 02:18–02:31 CDT), first-hand.** EAS build
`eea50789…` from `e7b195e`, versionCode 14 → 15 (auto-incremented, remote keystore reused);
`adb install -r` → `Success`; versionCode 15, signature `ad63266e` unchanged, `firstInstallTime`
2026-08-19 preserved, exact-alarm appop `allow`, `POST_NOTIFICATIONS` granted, no re-pair. Cold
launch → Today renders, 0 crash lines. A daily task with a reminder created server-side was
reconciled into **45 exact alarms** (`window=0 exactAllowReason=permission`, one per occurrence).
With the process **killed** (`am kill`) the reminder fired on the `reminders` channel at
`importance=5` with the body "Due 2:31 AM · repeats" and **Done / Snooze 1h / Tomorrow 9am**
buttons. **Snooze 1h** from the shade: app opened to the task with "Snoozed until 3:24 AM from
reminder", "⟲ Daily", "Next: … · snoozed"; server `snoozed_until` set, rule untouched; notification
dismissed; alarm re-armed exact at 03:24:28. In-app **Complete** → today's row done, "Next: Sep 15",
alarm re-armed for tomorrow, "Undo last Done" shown; **Undo** → row scheduled again, snooze cleared,
no extra successor. On a second task (every 2 days after completion), **Done** from the shade with
the process killed again: "Completed from reminder", "⟳ Every 2 days after I complete it", "Next:
Sep 16, 2:40 AM" (successor at the previous wall time), notification dismissed, worker re-check
`completed` as a no-op, next reminder armed 12 minutes before it. **New task form:** Title · Notes ·
Due date · **Repeat** chips (Never · Daily · Weekdays · Weekly · Monthly · Every N days · "After I
complete it") · summary "Weekly on Mon" · the amber no-due-date hint · Reminder · Create → server
row `FREQ=WEEKLY;BYDAY=MO`, `recurrence_timezone` America/Chicago, anchor persisted as `due_at`,
first occurrence equal to it, 13 weekly rows. Tasks list shows "⟲ Daily" / "⟲ Every 2 days after I
complete it" with no stale "Due <anchor>". **Cold launch after `am kill`:** Today shows Overdue 1 /
Due today 1, one card per instance with the ⟲ glyph, successors under Upcoming, no duplicates.
After archiving the smoke rows the device dropped every smoke alarm on its next reconcile (0
remaining). **Test-method note, recorded:** `am force-stop` puts the package into Android's stopped
state, which cancels all of its alarms — the first attempt found 0 alarms and no notification for
that reason; a real dead process (memory reclaim, `am kill`) keeps them.

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry; migration 19; three integrations `active`; 0 open
incidents; 0 api and 0 worker warn/error lines since the redeploy.

**Recorded, not fixed (debt):** nonexistent spring-forward wall-clock times resolve one hour early
(pre-existing `date-fns-tz` behaviour, now inherited by derived reminders and lazy `wallTime`); a
90-day window that crosses a fall-back yields 90 rows, not 91 (day 90's wall clock lands an hour past
the absolute horizon); completion-anchored monthly clamps from the completion date's day, so a
series done on the 31st drifts to the 28th; `MAX_SNOOZE_DAYS` is elapsed days; reminder titles are
unbounded (user-authored, local only); snooze targets and weekly/monthly `BY*` derive in the device
and rule zones respectively, which differ only when the device travels; a stale "from reminder"
banner persists on the task screen until it is left; the `singletonKey` on the generate-lazy send
is inert under pg-boss `standard` policy (documented; never switch policy); a permanently malformed
completion rule re-alerts once per night through `expand-window.dead:<date>` until the owner edits or
drops the task (the ADR-062 date-bucket design); `apps/mobile`'s own eslint config reports one
pre-existing `react-hooks/purity` error in `app/monitor/index.tsx:214` (8.6D, untouched by 9.4; the
root `eslint .` gate ignores `apps/mobile/**`).

---

### Checkpoint 9.5 — Calendar as an authoring surface: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-14)

**Objective (owner-directed).** Personal OS originates and manages its own calendar events on the
Rabbit R1 — create, edit, cancel, recurring — synced outward to a chosen writable connected
calendar, with imported events protected. Commit **`91d744c`** on `phase-9-reliability` (from
`44c2ebd`); one migration, **`0019_event_authoring`** (`events.origin`, `events.client_uuid`,
`calendar_connection_calendars.access_role`; level **20**); decision record **ADR-064**;
architecture section "Event ownership and outbound sync". Three parallel read-only audits
(ownership/sync, provider write path, recurrence + mobile), foundation by the integrator, four
parallel implementation lanes (api, provider+worker, mobile, semantics tests) on per-lane database
clones, six adversarial review lenses, three fixer passes, a second review round of two lenses,
integrator gates, frozen-order deployment, EAS build, in-place install, physical acceptance — one
session (interrupted once by a usage limit; the three fixers resumed from their transcripts).

**What the audits found first.** Phase 4 had built genuine two-way sync, so after the first push an
imported event and an authored one were byte-identical in the database — archiving an imported
event deleted it from the owner's Google calendar and editing one wrote back to a calendar of
unknown writability; the Google write body carried no `recurrence` (a linked series landed as one
event); inserts were not idempotent on retry; a second edit inside a ten-second `singletonKey`
window was silently dropped; `accessRole` was discarded at the client boundary; `POST /events`
never validated its rule; Today/Agenda were not invalidated after an event mutation. Consent was
already sufficient (`calendar.events`, read-write) — no scope change anywhere.

**Contract shipped (detail in ADR-064).** *Ownership:* `origin` `local` | `external`, DB default
`external` (fails safe; every local writer sets `local` explicitly); external → `409
event_not_owned` on PATCH / archive / detach / cancel-occurrence / link-calendar and a read-only card
on the device. *Write-eligible target:* sync-enabled, active connection, Google role owner/writer
(NULL = unknown = never); CalDAV by PUT. `GET /calendar-targets`. Roles are refreshed by the
Settings listing, at the toggle-on insert, and by the worker's five-minute calendar cron (which
also NULLs roles for calendars no longer listed and refreshes display names — closing the 8.2
"summary stores the id" cosmetic debt). *Durable intent:* event + occurrence window + `pending_push`
link in one transaction; every mutation flips the link in-transaction; enqueue after commit; lost
enqueues re-driven from the rows every five minutes; `client_uuid` idempotency (200 on retry).
*Provider idempotency:* Google id derived from the link id and sent on insert (`409 duplicate` →
update); deterministic CalDAV UID/href (`412` → conditional re-PUT of the CURRENT body); inbound
sync ADOPTS a pending link whose derived id matches; full-sync reconcile archives only links
synced before the listing began; race-safe final write (ids unconditional, `synced` only if the
link's `updated_at` is unchanged). *Recurrence:* `localRecurrenceToGoogle` ↔
`googleRecurrenceToLocal`, round-trip-tested; `validateEventRecurrenceRule` shared by POST/PATCH and
capture commit (`hasCommittableRecurrence` now refuses uncommittable event rules at confirm);
whole-series editing only — detach on a linked series, and linking a series that has detached
children, are refused (`409 linked_series_detach_unsupported`); cancel-occurrence (EXDATE) is
supported; inbound all-day UNTIL resolves to end of local day and a linked row's zones are never
overwritten with UTC; `recurrence_until` floored to whole seconds so the round trip is a no-op.
*Failure semantics:* dead-letter alert `calendar.push-event.dead:<eventId>:<link updated_at>`
(ADR-058; flip and alert one transaction, pinned to the `updated_at` the key was built from);
permanent errors (`missing_scope`/`invalid_request`/`not_found`, CalDAV 403/405) surface on the
event screen without retry; an inactive connection leaves the link `pending_push`.
*Mobile:* new/edit event screens on the 9.4 pattern — Material date/time pickers, a new date-only
`DateField`, calendar picker (hidden with zero targets; a fetch error shows a note and never blocks
creation), `EventRepeatField` = the task chips minus the completion anchor, end defaults to start
+ 1 h, `client_uuid` minted once per mount and regenerated only for an edit after a failed attempt,
read-only view for external events, sync status line with honest copy (nothing promises a retry
that does not exist), "+ Event" on Today, Today routes recurring instances with `occursAt`, every
event mutation invalidates Today/Agenda.

**Adversarial review (six lenses + two second-round lenses; every finding fixed in-checkpoint
with a test that fails on the old code).** *Blockers (found independently by two lenses):* inbound
sync imported our own just-pushed event as a read-only twin during the retry window, after which
every retry hit the unique index and dead-lettered — closed by pending-link adoption; CalDAV
inserts minted a fresh UID per attempt — closed by link-derived identity. *Majors:* the legacy
`link-calendar` route bypassed write-eligibility; a calendar toggled on in Settings had no role
until Settings re-opened (and every production calendar was NULL on day one) — closed by the
worker refresh + the toggle-time listing; archive after a lost insert orphaned the remote event;
`connection_inactive` was terminal; full-sync reconcile could archive a just-pushed local event;
inbound all-day UNTIL at UTC midnight dropped the last instance and overwrote a local row's zones;
"Edit this occurrence" on a linked series silently removed the occurrence from Google; the push
sent `start.timeZone` from a different zone than the EXDATEs; the 412-adopt re-used the previous
attempt's body; the all-day read-only card showed the series template's date. *Minors:* Google
409 reason check; dead-flip ordering and `updated_at` pin; CalDAV permanent errors; role clamp;
empty listing must not NULL every role; detached children inherit the parent's origin; conflict
copy; `client_uuid` after an edit; sync copy that promised a retry.

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, git history clean · **`pnpm test --force`
21/21 tasks, 5,060 tests across 12 packages, zero failing** (api 1,143 · mobile 1,152 · core 771 ·
worker 687 · schema 334 · health-providers 332 · api-client 157 · monitoring 151 · mail-providers 116
· calendar-providers 113 · db 79 · ai-providers 25; was 4,636 at 9.4). **Migration invariant:** 20
`.sql` / 20 journal entries, highest `0019`; the reconcile script proved all five statements on a
probe clone (5/5); the journal `when` was corrected once after the future-date guard caught it;
forward-compatible with the serving images (defaults/nullable), so rollback stays image-only.

**Deployment — COMPLETE (2026-09-14T11:57Z), frozen order.** `91d744c` pushed to `origin` first.
`git archive` shipped to `/home/himallinux/personal-os-9.5-release` (969 tracked files; no `.env`,
no `google-services.json`). Rollback images tagged by resolved digest `:rollback-pre-9.5` for api
(`703d81ae…`), worker (`af376c54…`) and web (`16890956…`). All three built with the running
containers untouched (verified by digest). New api image verified to carry
`0019_event_authoring.sql`, `calendar-targets.js`, `event_not_owned` and
`linked_series_detach_unsupported`; worker image carries `calendar-push-redrive`,
`calendar-role-refresh` and `adoptPendingGoogleLink`. `drizzle-kit migrate` from the new api image
with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL` pass-through: **19 → 20**; all 98
existing events `external`. `api` recreated alone → `(healthy)`, `GET /calendar-targets` 200;
`worker` recreated alone → `worker.started queues:29 schedules:10`, `calendar.google.push-event`
dead letter attached; `web` recreated alone → 200 on Tailscale Serve `:8443`. `postgres` never
named. **Rollout-window ownership check:** 0 rows `external` without a link (none created in the
migrate→recreate window). First worker cron tick: `role_refresh updated:5 cleared:0`, two targets
offered (the owner's primary and the Gate H test calendar), the holidays calendar correctly
`reader`.

**Production API acceptance — PASSED (through real routes, on the dedicated "Personal OS Gate H
Test" calendar; every smoke row archived afterwards, none deleted).** Timed event with `calendar` +
`client_uuid` → `201`, `origin local`, link `pending_push` → `synced` within seconds with
`google_event_id = replace(link.id,'-','')` and an etag, `push_event.pushed operation:insert`;
the SAME body again → `200` with the same id, one row. Agenda for the day shows it. PATCH title +
time → `pending_push` → `synced`, `operation:update`. All-day one-day and three-day (`starts_at`
NULL, dates preserved), weekly `BYDAY=TU` (13 occurrences) and **monthly `BYMONTHDAY=-1` — accepted
by Google** (the one review question that needed live proof) all pushed and `synced`; inverted
all-day span → `400`, `FREQ=HOURLY` → `400 unsupported_frequency`. Detach on the linked weekly →
`409 linked_series_detach_unsupported`; cancel-occurrence → exdate stored, `operation:update`, the
instance absent from `/events/range` and Agenda. **The 12:15Z inbound sync changed nothing**: each
title exactly one row, all `local`, rrule / exdates / dates / zones byte-identical, 0 adoption or
conflict lines, 0 failed jobs. Archive ×5 → `push_event.deleted` ×5, 0 links remain, re-archive
idempotent `200`; **the 12:30Z inbound sync resurrected nothing** (5 rows still archived, 0 new).
The imported event `538c6d08…`: PATCH / archive / cancel-occurrence / detach all `409
event_not_owned`, `updated_at` untouched; its `sync` projection carries only connection id, calendar
identity and a null error.

**Physical Rabbit R1 acceptance — PASSED (2026-09-14 07:18–07:53 CDT), first-hand.** EAS build
`b7068196…` from `91d744c` → versionCode 16, installed in place (`adb install -r` → `Success`,
signature `ad63266e` unchanged, `firstInstallTime` 2026-08-19 preserved, exact-alarm appop `allow`,
`POST_NOTIFICATIONS` granted, no re-pair); cold launch → Today renders with "+ Event", 0 crash lines.
**A real defect surfaced on the first date pick and was fixed in the same session**: the Material
date dialog highlighted Sep 18 but the field read Sep 17 — Material3's `selectedDateMillis` is UTC
midnight of the chosen day (verified in `@expo/ui`'s `DatePickerView.kt`) and both
`combineDateAndTime` (8.4, `DateTimeField`, so task due dates and reminders since 8.4) and the new
`serializePickedDate` (9.5, `DateField`) read it with local getters — the previous day in every
zone west of UTC. Fixed in `4d1b565` (UTC components; dialogs open on UTC midnight of the local
day; tests model the dialog's real output), EAS build `4e377e86…` → **versionCode 17**, installed in
place with the same preservation. Then, on 17: "+ Event" → title, "Personal OS Gate H Test" chip,
Starts via the pickers (picked Sep 18 → **field reads Sep 18**), End defaulted to start + 1 h,
Repeat "Weekly" → summary "Weekly on Fri" → Create → server row `local`, `FREQ=WEEKLY;BYDAY=FR`,
`recurrence_timezone America/Chicago`, `client_uuid` set, 07:46 CDT on the 18th, link `synced`
with the derived id, 13 occurrences. Edit screen shows "Synced to Personal OS Gate H Test", the
Repeat chips, Save changes / Delete event; edited the title → Save → server updated → push
`operation:update` → `synced`. All-day switch → Start date / End date via the date-only `DateField`
(picked Sep 21 and Sep 23 → fields read exactly those) → Create → `all_day`, `start_date 2026-09-21`,
`end_date 2026-09-23`, `starts_at NULL`, `synced`. Calendar tab month grid: the weekly on Fri 18 and
25, the all-day banner across 21–23, one card per instance, nothing for the bare parent. Delete
event → "Delete this event?" → DELETE → back to Calendar; both rows archived, links removed,
`push_event.deleted` for each. An imported event opened by deep link renders the read-only card
("From <calendar> · read-only", title, time, location, description as inert text) with no Save /
Delete / Link and no occurrence modal. Test-method note, recorded: uiautomator taps land on the soft
keyboard when it is up — dismiss it (BACK) before tapping form controls, or the tap types into the
focused field.

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry; migration 20; three integrations `active`; 0 open
incidents; 0 unarchived `local` events (all smoke rows archived); 0 `calendar.push-event.dead`
dispatch rows; **0 api and 0 worker warn/error lines in the two hours since the redeploy**; 0 crash
lines on the Rabbit R1.

**Recorded, not fixed (debt):** see *Next action*.

### Checkpoint 9.6 — Search foundation + content bounds: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-14/15)

**Objective (owner-directed).** A user can reliably find their own information across captures,
tasks, notes and events without remembering where it was created — a trustworthy local retrieval
layer for later intelligence to build on, and, because 9.5 made event text owner-authored on the
device, every text field bounded at write. Commit **`8f6ffe1`** on `phase-9-reliability` (from
`100299d`); **no migration, level stays 20**; decision record **ADR-065**; architecture section
"Content bounds and search". Three parallel read-only audits (search architecture, write-path
inventory, ranking design), foundation by the integrator (`text-bounds.ts`, bounds on every
Create/Update/tool schema, the v2 search contract), five parallel implementation lanes on per-lane
clones (core primitives, API search, server bounds, mobile search UX, mobile bounds), six
adversarial review lenses (privacy, search correctness, data integrity, event/calendar, future-agent
+ performance, mobile), three fixer passes, integrator gates, frozen-order deployment, EAS build,
in-place install, physical acceptance — one session.

**What the audits found first.** No entity text field had a `.max()`; task/note/event/project text
was `z.string()` down to an unbounded `text` column; the PTT transcript and the parser's tool-call
output were unbounded at write; the read schemas are reused for responses and export (so bounds
there would 500 on legacy rows); the api-client pre-validates, so an over-bound mobile write threw
a raw `ZodError` shown as "check your connection"; Cloud Ask imports only `buildContainsPattern`
and `LIKE_ESCAPE_CHARACTER` from `core/search/query` (both byte-unchanged); search issued one
request per keystroke, matched one substring over two columns, and grouped by recency.

**Contract shipped (detail in ADR-065 and the production-state table).** Content bounds: reject
user-typed, truncate provider/model/STT, bounds on write schemas only. Search: six entities,
tokenised AND matching with the fallback ladder, date tokens under `tz`, integer scoring over a
closed reason vocabulary (exact +100 / prefix +60 / phrase +40 — on the full phrase including a
date word, or the text phrase demoted one rung — all-tokens +30, per-token +10 (+4 boundary, cap
80), secondary +6, body +3, date window +25 / text +5, recency 20→0, type prior 0…−10, penalties
done −15 / archived −25 / completed project −10 / external event −5), total order ending in `id`,
one SQL statement per type with `count(*) over()` and a 100-row candidate cap ordered
`title_all, title_any, recency, id`, TypeScript scoring; `getItemContext` for a future read-only
lane. Mobile: 250 ms debounce, `tz` sent, "Top matches" (first five) then per-type sections that
show `N more · returned of total matched`, type chips, event date lines (all-day by date only),
"From calendar · read-only", partial-match banner, date chip, "Ignored: …" for capped tokens,
"Updating…" while stale; `maxLength` + counter at 90 % on every input; field-specific validation
copy for server and client-side validation errors.

**Adversarial review (six lenses; every finding fixed in-checkpoint with a test that fails on the
old code, or recorded).** *No blockers.* *Majors:* a month word in a title made `title_exact`
unreachable ("May report" lost to "Report" for `may report`) — closed by scoring the full phrase;
the mobile per-type header counted the type's whole `returned` while listing only the rows not in
Top matches — closed with `shown`; the STORED parse-result union was parsed through the now-bounded
tool schema, so a legacy `needs_confirm` item with an over-bound title would have become
`409 parse_result_unreadable` forever (zero such rows in production) — closed by an unbounded
`StoredParserToolCallSchema`. *Minors closed:* U+0130 case-fold mismatch between Postgres ILIKE and
JS (`İstanbul` matched by SQL, scored 0); all-day series occurrences positioned by the local-noon
instant instead of `occurs_local::date` (ADR-045); invalid ISO dates split into bare numbers; capped
tokens invisible on the wire (`dropped` added); candidate cap could evict a partial-title hit behind
100 newer body-only rows (`title_any` order key); `date_text` awarded on rungs where the date was
dropped; calendar ingest truncation had no log line; `calendar-role-refresh` blanked a display name
Google omitted; the share-intent normaliser's cut was not surrogate-safe; the service trusted its
inputs (RangeError guards) and exposed a `cap` seam; stale results showed under a new query; the
project error banner rendered below the fold; TalkBack re-announced the counter on every keystroke.
*Privacy lens:* no content-bearing log line, no egress, no forbidden column, no route from stored
text; `ai-egress-guard` still pins five call sites. *Performance lens:* SQL is 95–98 % of every
number; at production scale p95 ≤ 28 ms.

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, git history clean · **`pnpm test --force`
21/21 tasks, 5,495 tests across 12 packages, zero failing** (mobile 1,250 · api 1,204 · core 898 ·
worker 698 · schema 461 · health-providers 332 · api-client 162 · monitoring 151 · calendar-providers
119 · mail-providers 116 · db 79 · ai-providers 25; was 5,062 at 9.5). One pre-existing
clock-dependent fixture (`events.test.ts` "cancels a timed occurrence", anchored on a 2026-09-14
occurrence that became past on the day) was re-anchored relative to the clock, DST-safely.
**Migration invariant:** 20 `.sql` / 20 journal entries, highest `0019`, `packages/db`
byte-unchanged.

**Deployment — COMPLETE (2026-09-14T23:54Z), frozen order.** `8f6ffe1` pushed to `origin` first.
`git archive` shipped to `/home/himallinux/personal-os-9.6-release` (990 files; no `.env`, no
`google-services.json`). Rollback images tagged by resolved digest `:rollback-pre-9.6` for api
(`a3cdf9a6…`), worker (`74328303…`) and web (`deaf4055…`). All three built with the running
containers untouched (verified by digest). New api image verified to carry `search/service.js`,
`search.completed`, `text-bounds.js` and the five `core/search` modules; worker image carries
`transcript_truncated`, `text_bounded` and the bounded calendar translators. `drizzle-kit migrate`
from the new api image with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL` pass-through
applied nothing (**20 → 20**). `api` recreated alone → `(healthy)`, `/health` `ok`/`stale:false`,
`GET /search` 200 with the v2 shape; `worker` recreated alone → `worker.started queues:29
schedules:10`; `web` recreated alone → 200 on Tailscale Serve `:8443`. `postgres` never named. All
four containers `RestartCount=0`.

**Production API acceptance — PASSED (through real routes; every smoke row archived afterwards,
none deleted).** Created a task, note, project, local event (on the Gate H test calendar) and a
capture, all sharing a sentinel token: `q=<sentinel>` returned all five types with 124/122 points,
the exact title first for `<sentinel> dentist` (178, `title_exact`); `dentist september` with
`tz=America/Chicago` echoed `date_filter {september, month, 2026-09-01…30}` and surfaced the event
(`starts_at`) and the task (`due_at`) with `date_window`; `buy protein` found the capture's committed
task (`Buy protein`, 178) and the capture, and correctly excluded the note that carried only
`protein`; `/search/item` returned the task's bounded body with a self-citation and 404 for a wrong
type; a 513-char title → `400 validation_failed` path `["title"]` "title must be at most 512
characters", a 20 001-char note body and a 4 001-char event description likewise; PATCH on an
imported event → `409 event_not_owned`, and the imported event is searchable as `origin: external`.
**Logs:** 0 occurrences of the sentinel, any smoke title, `q=<word>` or a description sentinel in
the api or worker logs; the access log reads `/search?q=[redacted]&types=event`; every
`search.completed` line is counts and booleans. The local smoke event pushed (`synced`, derived
Google id) and its archive pushed `push_event.deleted`, leaving 0 links.

**Physical Rabbit R1 acceptance — PASSED (2026-09-15 00:02–00:05Z), first-hand.** EAS build
`6d55fcc6…` from `8f6ffe1` → versionCode 18, `adb install -r` → `Success`, `firstInstallTime`
2026-08-19 preserved, exact-alarm appop `allow`, `POST_NOTIFICATIONS` granted, no re-pair. Cold
launch → Today renders. 🔍 → typed the sentinel → "TOP MATCHES" with TASK / EVENT / NOTE / TASK /
INBOX chips, the event's "Sep 23, 2026, 9:00 AM · Elm St clinic" line and previews; tapped the event
→ the 9.5 event editor; tapped the note → the note editor. `dentist september` → "In September
2026" chip with the event and the task. An imported event searched by its title → "From calendar ·
read-only" with a location-only preview (its description with links absent from the list) → the
read-only card. HOME → `am kill` → cold launch → search `<sentinel> notes` → exactly the note
(two-token AND). New Task → typed 600+ characters into Title → capped at exactly 512 with the counter
"512 / 512". 0 crash lines in logcat. Device smoke rows archived afterwards.

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry; migration 20; three integrations `active`; 0 open
incidents; 0 unarchived `local` events; 0 `calendar.push-event.dead` rows; **0 api and 0 worker
warn/error lines in the 40 minutes since the redeploy**; 0 crash lines on the Rabbit R1.

**Recorded, not fixed (debt):** see *Next action*.

### Checkpoint 9.7 — Personal intelligence, read-only: "Ask about today": IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-15)

**Objective (owner-directed design gate, then owner-approved D1–D5).** Move Personal OS from
storage + search toward context + intelligence, without becoming an autonomous agent: the model
never touches the database, search, the filesystem or an integration directly. It receives exactly
a bounded, server-built context object and returns text. Commit **`9b4db0d`** on
`phase-9-reliability` (from `b998646`, the 9.6 acceptance record, verified clean and equal to
origin); **no migration, level stays 20, worker byte-untouched**; decision record **ADR-066**.

**Design gate.** Six parallel read-only audit lanes (existing AI architecture, context/data
architecture, privacy/security, product design, future-agent compatibility, adversarial review)
produced a full design covering D1–D5, the `TodayContext` allowlist, the privacy contract, the API
contract and the future-agent tool contract — returned to the owner and approved without change to
the five decisions:

- **D1 (model strategy): A** — the existing provider layer only, primary model only, through the
  existing `ask` task route.
- **D2 (first surface): B** — "Ask about today": Cloud Ask (8.6B) widened with a bounded Today
  context and three preset questions, not a Brief v2, insight cards, or a dedicated screen.
- **D3 (output storage): A** — never store. Answers exist only in the client's in-memory mutation
  result.
- **D4 (proactivity): A** — user-initiated only. No cron, no push; a preset chip is still an
  explicit tap.
- **D5 (context limits):** `TodayContext` ≤ 12 000 chars (Brief parity), `<records>` ≤ 5 000 chars
  / ≤ 4 records when Today is present (else the 8.6B 12 000 / 8), concatenated user prompt measured
  and asserted ≤ 18 000 chars, 800 output tokens, one model call per explicit request, `maxRetries:
  0`, no client retry, single-flight, nothing persisted.

**Implementation.** Three parallel lanes on per-lane database clones (api-intelligence:
`buildTodayContext` + the reminders extraction + Guard 4; api-ask: the widened `POST /ask` route,
citation validation, redaction; mobile: preset chips, the Today chip, navigation, the rewritten
disclosure), integrated, then six parallel adversarial review lenses (privacy/egress,
citation/hallucination/prompt, context integrity, mobile/Rabbit UX, API contract/backward
compatibility, guard integrity/token budget/performance) found **1 BLOCKER and 8 MAJOR** findings,
all fixed in two parallel fixer passes with tests that fail on the old code, then full gates.

**THE BLOCKER, closed.** `buildTodayContext` assigns refs `1..N` across ten sections, then a
preset-aware drop ladder can empty or trim sections and filter `citations` down to the survivors —
but the route was passing `refOffset: today.citations.length` (the *count* of survivors, not the
*highest ref ever assigned*) to `buildAskContext` for the lexical `<records>` block. After any drop,
record refs collided with surviving Today refs — two different sources sharing one `[n]`, an
ambiguous citation the client could not disambiguate. Fixed by exposing `lastRef` (the highest
ordinal assigned, pre-drop) from `TodayContextBuild` and passing `refOffset: today.lastRef`; a route
invariant now asserts the resolved ref-set size equals `today.citations.length + records.length`
before generation, refusing (`502 ask_failed`, logged `outcome: "ref_collision"`) rather than
returning ambiguous sources if it ever disagrees again.

**The eight MAJORs, closed.** (1) `apps/api/src/ask/citations.ts` let malformed numeric bracket
groups — `[1 2]`, `[1-3-5]`, `[-1]`, `[99999999999999999999]`, `[1.5]` — vanish instead of
surfacing as unresolved, silently defeating the "every `[n]` must resolve" contract; the group
regex and validator now treat any non-clean integer or non-ascending range as an unresolved
sentinel. (2) `ASK_PROMPT_MAX_CHARS` (18 000) was arithmetically reachable (12 000 + 6 000 + 512 +
238 framing = 18 750) and three comments asserted the opposite; `<records>` budget narrowed to
5 000 (17 750 worst case), and the 12 000 Today ceiling gained a last-resort trim of protected
sections so it is a true invariant even under adversarial JSON-escaping titles. (3) `scope`
without `tz` previously fell through to the full body-selecting 8.6B path — the exact opposite of
what the flag means; the request schema now rejects that combination (`400 validation_failed`).
(4) `ASK_TODAY_CONSENT_FROM` (the consent-vintage cutoff) was left in the past relative to the test
suite's fixed clock; test seeding now defaults `created_at` to one second after the constant so
tests never depend on wall-clock timing, and the constant itself was set to the actual release
instant before deploy. (5) The two `open_loops` project lists (`stalled_projects`,
`projects_without_next_action`) carried no `total`, so the drop ladder could empty them with no
signal the model could report — both are now `{items, total}` sections like every other list.
(6) A project row with no computed next action had no citable target under the original
`AskSourceType` enum (which lacked `project`) and was silently omitted from
`projects_without_next_action` — exactly the "what's slipping" case the preset exists for;
`AskSourceType` gained `project`, citing the project itself (`/projects/:id`), so a stalled project
with nothing next is now present and navigable. (7) Guard 4 (the new egress-guard rule barring
writes and `ai`/provider imports under `apps/api/src/intelligence/`) was bypassable via
`db.execute(sql\`...\`)`, `.transaction(`, and dynamic `import("ai")`; the denylist was extended and
an **import allowlist** added for that directory. (8) In-flight double-submission: the mobile
`submit` had no guard against the keyboard's send key firing while a request was already pending,
risking a second transmission of note/task bodies; a pending-mutation guard was added.

**Contract shipped (ADR-066).** `POST /ask { question, tz?, scope? }` — both new fields optional
and additive. **Without `tz`: byte-shape-identical to 8.6B** (task/note sources only, refs from 1,
no `citations_present`), proven by parsing the response through a frozen literal copy of the
pre-9.7 `.strict()` schema — this is what keeps the Rabbit's versionCode 18 client working against
a 9.7 server. With `tz`: a consent-vintage check (`created_at < ASK_TODAY_CONSENT_FROM` →
`409 ask_consent_outdated`) runs before any read; `buildTodayContext` assembles the closed,
`.strict()` `TodayContext` from `buildTodayResponse`, `collectRecentlyCompleted` and the newly
extracted `read-models/reminders.ts` (`buildRemindersResponse`, route now a thin caller, behaviour
byte-identical) under one `effectiveNow`; every string is server-formatted wall-clock (never a UTC
instant) in the request zone; `scope: "today"` (every preset chip) skips `extractAskTerms`/
`selectAskContext` entirely — no note or task body is read or transmitted for a preset tap.
Citations are validated, not trusted: every bracket group in the answer is parsed (lists and
ranges expanded) and an unresolvable ref refuses the answer (`502 ask_uncited`); a zero-citation
answer is not refused (an empty day cites nothing) but returns `citations_present: false`. Sources
carry server-authored `section`/`detail` labels (`[1] Overdue · P1 · title`) so a ranking claim can
be checked against the row without opening it — ranking claims themselves are not machine-verified,
stated rather than hidden. `TodayEventItem` gained an optional `origin` so only external calendar
text is passed to the shared output filter as untrusted provenance. Nothing is persisted; the Brief
lane's inbox snippets now also pass `redactSecrets` before truncation (a ride-along closing the one
capture-derived string that reached a prompt unredacted).

**Future-agent contract, designed not integrated.** `READ_TOOL_NAMES` (`search_personal_items`,
`get_item_context`, `get_today_context`, `get_calendar_context`, `get_task_context`) and their
`.strict()` I/O schemas and per-request budgets (≤ 6 calls, ≤ 30 000 chars, search limit ≤ 10/type,
calendar span ≤ 14 days) are defined in `packages/schema/src/intelligence-tools.ts`. Exactly **one**
implementation ships — `buildTodayContext(ReadContext)` — written so a future `get_today_context`
tool binds it unchanged: one implementation, two callers. No tool runtime, no binding, no loop, no
`posops_readonly` role (deferred to the agent ADR; `ReadContext.db` is the same `Db` type
regardless of role, so the swap is zero call-site changes when that day comes).

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm
typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean ·
`gitleaks detect` — the same 18 pre-existing findings in ignored, untracked files (`.env`,
`apps/mobile/.env`, `google-services.json` ×2, `export.log`), 0 leaks in git history · **`pnpm test
--force` 21/21 tasks, 5,735 tests across 12 packages, zero failing** (mobile 1,336 · api 1,333 ·
core 898 · worker 698 · schema 477 · health-providers 332 · api-client 171 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25; was 5,495 at 9.6). Three
`api` test files (`tasks.recurrence-9-4`, `tasks.test`, `today.9-5-semantics`) showed transient
failures in one interleaved run caused by a reviewer's concurrent `vitest` process on the shared
`personalos_test` database — the documented shared-DB collision, not a defect; all three pass
cleanly in isolation and in the final serial run. **Migration invariant:** 20 `.sql` / 20 journal
entries, `packages/db` byte-unchanged.

**Deployment — COMPLETE (2026-09-15T04:14Z), frozen order.** `9b4db0d` pushed to `origin` first.
`git archive` shipped to `/home/himallinux/personal-os-9.7-release` (1 008 tracked files; no
`.env`, no `google-services.json`). Rollback images tagged by resolved digest
`:rollback-pre-9.7` for api (`4809358b…`) and web (`6f5583e9…`) — **worker not tagged**, because
no worker file changed and the running worker image is unaffected. api + web built (running
containers untouched, verified by digest). New api image verified to carry
`apps/api/dist/intelligence/{read-context,today-context,wall-clock}.js`, the widened
`routes/ask.js` (`ask_consent_outdated`, `citations_present` both present), and the release-instant
`ASK_TODAY_CONSENT_FROM`. `drizzle-kit migrate` from the new api image with `--no-deps` applied
nothing (20 → 20). `api` recreated alone → `(healthy)`, `/health` `ok`/`connected`/`stale:false`;
`web` recreated alone → 200 on Tailscale Serve `:8443`. `postgres` and `worker` never named or
recreated. All four containers `RestartCount=0`.

**Production API acceptance — PASSED (through real routes; every smoke row archived afterwards,
Cloud Ask disabled afterward, none deleted).** Smoke task (overdue, P1), smoke task (due today),
smoke note (with a `gsk_`-prefixed secret), smoke event (today) created. `ask` route enabled on
the existing `gpt-4.1` / `My OpenAI` model (the ADR-044 precedent — zero new credential surface).
`POST /ask` without `tz` → 200, four-key sources (`ref/type/id/title`), no `citations_present`,
`redactions: 1` (the secret correctly stripped before the model ever saw it) — the 8.6B path
verified unchanged on live data. `POST /ask` with `tz`, `scope: "today"` ("What should I focus on
today?") → 200, 8 cited sources spanning overdue/event/completed/capture sections with correct
wall-clock details (`P1`, `14:30`), `citations_present: true`, `redactions: 0` (no body reached the
model for a preset). Free-text question with `tz` (scope defaults to `both`) → the note is
selected, redacted and cited at `ref: 9` — **one past the highest Today ref (8), proving the
ref-collision fix live**, `redactions: 1`, the answer correctly reports the note's un-redacted
content without repeating the secret. `scope` without `tz` → `400 validation_failed`,
`path:["scope"]`. `tz` + `scope: "today"` on a day with no upcoming items ("Summarize tomorrow")
→ 200, not 422, honestly reporting nothing upcoming while still citing the overdue items. Four
`ai.usage` log lines inspected: all counts-only (`task, modelId, latencyMs, usage*, sourceCount,
contextChars, todayChars, todayItemCount, redactionCount, scope, outcome`) — **zero occurrences**
of the question text, the secret token, or the note's content in 20 minutes of api logs; zero
warn/error lines. `ask` route then deleted (`204`), confirmed `409 cloud_ask_disabled` again —
**Cloud Ask ships OFF in production**, per D3/ADR-061. All four smoke rows archived; post-check
confirms 0 unarchived smoke rows, 0 `ask` routes, 0 failed/retry/active pg-boss jobs.

**Physical Rabbit R1 acceptance — PASSED (2026-09-15 04:31–04:33 UTC), first-hand.** EAS build
`9591cf56…` from `9b4db0d` (verified `gitCommitHash` on the build record) → versionCode 18 → 19
(auto-incremented, remote keystore reused, `production-internal` profile). `adb install -r` →
`Success` (an in-place replace is refused by Android on a certificate mismatch, so the success is
the signing-continuity proof); versionCode 19, signature `ad63266e` unchanged, `firstInstallTime`
2026-08-19 preserved, exact-alarm appop still `allow`, `POST_NOTIFICATIONS` still granted, no
re-pair. Cold launch → Today renders, **no** "Ask about today" chip (Cloud Ask off on-device,
correctly hidden rather than disabled). Settings → Cloud Ask card shows the rewritten disclosure
verbatim ("Off — no question is ever sent unless you turn this on... Sends your question to the
model you choose, along with: matching notes and tasks (up to 4, bodies included, secrets redacted
by pattern only); the titles, times and project names of your tasks, reminders and calendar events
for today and the next 7 days..."). Tapped the `GPT-4.1 / My OpenAI` model row → "On — sends
questions to My OpenAI." with a Disable button, no stale-consent banner (a fresh row). Back to
Today → the "Ask about today" chip now renders in the existing chip row. Tapped it →
`/search?mode=ask&preset=focus` deep link opened Ask mode with the "What should I focus on?" chip
pre-selected, the question pre-filled, **no keyboard raised and no request sent** — proving the
no-auto-submit fix live, not just in a mocked test. Footer line: "Sends your question, today's
schedule and matching notes/tasks to My OpenAI." Tapped Ask → a real cited answer rendered within
seconds ("Today, there is nothing overdue or due, and no scheduled events. The main items needing
your attention are three inbox captures requiring confirmation, especially the one asking if you
have any unread emails [3]..."), sources below as `[n] Section · detail` header + title on its own
line. Tapped a capture source → navigated to the real `/inbox/:id` detail screen for that genuine
unconfirmed capture (left untouched — real user data, not a smoke row). Disabled Cloud Ask again
from Settings → card returns to the "Off" disclosure; back on Today the chip is gone again. **0
crash lines in logcat across the entire session.**

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four
containers `RestartCount=0`; 0 pg-boss jobs failed/retry/active; migration 20 (unchanged); three
integrations `active`; 0 open incidents; 0 unarchived smoke rows; 0 `ask` task routes (OFF, as
shipped); 0 api and 0 worker warn/error lines since the redeploy; 0 crash lines on the Rabbit R1.

**Recorded, not fixed (debt):** citation validation proves a referenced item exists, never that a
ranking/priority/time claim about it is true (mitigated, not closed, by the section/detail labels);
`redactSecrets` is prefix-shape pattern matching, not DLP (disclosed in the card text); the
`snoozed_within_horizon` total is honest only within Today's own 7-day/capped window, not a
separate uncapped query; the Brief lane still sends UTC instants for the model to convert, unlike
the wall-clock-only `TodayContext`; the shared `isAbortLikeError`/hardened-`generateText` block
remains duplicated across three call sites (Ask, Brief, mail digest) — extraction deferred, not
attempted, per the owner's explicit scope fence; D1e (device-token auth on `/ai/*` writes) remains
deferred; no `posops_readonly` role exists yet (not needed until a tool loop is approved).

### Checkpoint 9.8 — Suggested Focus, a narrow cited AI suggestion: IMPLEMENTED, DEPLOYED, ACCEPTED (2026-09-15)

**Objective (owner-approved design gate, D1–D5 plus one added product constraint).** Move from
"user asks → AI answers" toward "user opens Today → understands what matters", without becoming an
agent, without a second intelligence lineage, and without spending a model call the owner didn't
ask for. A parallel six-lane read-only design gate (existing-architecture audit, product-opportunity
analysis, context architecture, AI-behavior design, privacy/security, future-agent compatibility)
recommended **Option E** — a bounded combination, not any option as originally scoped — over the
brief's own Options A (full Brief v2), B (change tracking), C (weekly review intelligence) and D (a
dedicated dashboard, rejected outright as redundant with the app's established behind-Settings
minimalism for low-frequency surfaces). The owner approved D1=E, D2 (deterministic-on-load +
tap-triggered AI), D3=never-store, D4=no-feedback-yet, D5=fully-manual, and added: **no model call
below two meaningful candidates** ("zero focus candidates" and "only one obvious candidate" must
both produce no AI call). Full design-gate report and the D1–D5 rationale: this session's plan file
(`personal-os-checkpoint-happy-minsky.md`); the locked decision is ADR-067.

**Contract shipped, built almost entirely from 9.7's own reuse surface — zero new intelligence
lineage.** `POST /focus/suggestion { tz }` calls `buildTodayContext(preset: "focus")` — the IDENTICAL
function and preset Ask's own "What should I focus on?" chip already builds — as its only data
source, and reuses the `ask` `ai_task_routes` row as its consent switch (no new row, one sentence
appended to the existing disclosure) and `ASK_TODAY_CONSENT_FROM` as its vintage check, unchanged.
Candidates are the tasks in the built context's `overdue`/`due_today` sections; below
`FOCUS_MIN_CANDIDATES` (2) the route refuses (`409 focus_not_enough_candidates`) **before resolving
any provider** — the product constraint is server-enforced, not merely a prompt instruction. The
model must cite **exactly one** candidate (stricter than Ask, which tolerates zero), validated
against the overdue/due-today ref set only — never the full Today ref space, so a citation of an
`upcoming` or `reminder` ref is exactly as invalid as an invented one (`502 focus_uncited`).
`apps/api/src/focus/generate.ts` lives outside `apps/api/src/intelligence/` (a sibling of
`apps/api/src/ask/`, exactly mirroring how Ask's own `generate.ts` avoids that directory) and becomes
Guard 1's **sixth** pinned `generateText` call site — the egress-guard pattern's first extension
since its five-site baseline, and it held without modification to Guard 4. Mobile: a deterministic
strip (existing Overdue/Due-today chips) renders for free; the affordance is entirely absent (never
disabled) below the threshold or when Cloud Ask is off; the one AI line fires only on an explicit
tap, never on mount.

**Implementation.** Foundation (the frozen wire contract — `packages/schema/src/focus.ts`,
`packages/api-client/src/focus.ts`) written first by the integrator, matching the 9.6 precedent that
worked well. Two parallel implementation lanes then ran in isolated git worktrees (API, mobile) built
to that one contract. One lane's worktree was provisioned stale (120 commits behind, no 9.7
infrastructure) and its `Write`/`Bash` tools were hard-jailed to it — it fully designed the mobile
implementation by reading the correct worktree but could not write to it; the integrator applied its
design directly to the main tree, verifying every claimed file/line against the live codebase rather
than pasting blind. The API lane's worktree was healthy and merged by direct file copy after a
byte-for-byte diff confirmed its copy of the shared contract matched the integrator's exactly.

**Adversarial review (two lenses, API and mobile) found one MAJOR, closed before deployment.** The
mobile `not_enough_candidates` render state was a genuine dead end: `useMutation`'s `error`/`data`
persist until a NEW `mutate()` call settles, and nothing offered a way back to `idle`, so a real,
everyday race — the owner completing one of exactly two overdue tasks between page load and the tap,
or (independently) `today-context.ts`'s own pre-existing "LAST RESORT" drop-ladder pass touching even
a *protected* section under a quote-heavy-title budget overflow — could strand the card permanently.
Fixed with a "Check again" retry (cheap and safe: a re-refusal makes no model call, since the gate is
checked before any provider is resolved). A MINOR finding — a rapid double-tap on the retry buttons
could fire two `POST /focus/suggestion` requests before React's next render made `isPending` visible
to the closure — is fixed with a `useRef`-based synchronous reentrancy guard
(`focusRequestInFlightRef`) in the Today screen, not local state in the reused component, because
this app's hookless-component convention (`AskView`'s established pattern, restated in
`cloud-ask-card.tsx`'s own module comment) means the card cannot own `useState` without breaking its
no-renderer test harness. A route comment overstating the "focus" preset's drop-ladder guarantee was
corrected to name the pre-existing last-resort exception (inherited from 9.7, not introduced here);
the underlying security/correctness property — `candidateCount` is always computed from the exact
same post-ladder object serialized into the prompt — needed no code change.

**Verification (integrator, shared database, serial):** `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean (root; mobile's own `expo lint` run separately, also clean) · `prettier
--check .` clean · `git diff --check` clean · `gitleaks detect` — the same 21 pre-existing findings
in ignored, untracked files (`.env`, two `google-services.json`, `export.log`), none tracked ·
`pnpm test --force` **21/21 tasks, zero failing** — api **1,382** tests (+49: `focus/{contracts
implicitly, generate, output, prompt}.test.ts`, `routes/focus.test.ts`, the widened
`ai-egress-guard.test.ts`), mobile **1,367** (+31: `queries/focus.test.ts`,
`components/focus/suggested-focus-card.test.tsx`, `__tests__/today-suggested-focus.test.ts`, the
updated `cloud-ask-card.test.tsx` pin), core/schema/api-client/worker/health-providers/monitoring/
calendar-providers/mail-providers/db/ai-providers unchanged (worker byte-unchanged: no file in it
touched). **5,815 tests across 12 packages total.** **Migration invariant:** 20 `.sql` / 20 journal
entries, unchanged; `packages/db` byte-unchanged.

**Deployment — COMPLETE (2026-09-15T08:09Z), frozen order.** Commit **`a08311d`** pushed to `origin`
first (from `1441025`, the 9.7 acceptance record). `git archive` of `a08311d` shipped to
`/home/himallinux/personal-os-9.8-release` (1,024 tracked files; no `.env`, no `google-services.json`
— was 1,008 at 9.7, +16 new files, zero removed, matching the diff exactly). Rollback images tagged
**by resolved digest** `:rollback-pre-9.8` for api (`df197726…`) and web (`08359502…`) — **worker not
tagged**, no worker file changed. api + web built (running containers untouched, verified by digest).
New api image verified to carry `apps/api/dist/focus/{contracts,generate,output,prompt}.js`,
`apps/api/dist/routes/focus.js`, and `focusRoutes` registered twice in `server.js` (import +
`app.register`); migration folder highest still `0019_event_authoring.sql`, 20 files. `drizzle-kit
migrate` from the new api image with `--no-deps` and the explicit `MIGRATIONS_DATABASE_URL`
pass-through applied nothing (**20 → 20**, confirmed by direct row count before and after). `api`
recreated alone → `(healthy)`, `/health` `ok`/`connected`/`stale:false`; `web` recreated alone → `200`
on its published host port (`127.0.0.1:8081`, which Tailscale Serve `:8443` proxies to — plain
`curl localhost:8443` fails by design, `tailscaled`'s own binding, not a regression). `postgres` and
`worker` never named or recreated. All four containers `RestartCount=0`.

**Production API acceptance — PASSED (through real routes; every smoke row archived afterwards, Cloud
Ask disabled afterward, none deleted).** Baseline: 0 overdue, 0 due-today, `ask` route absent.
Enabled `ask` on the existing `gpt-4.1`/`My OpenAI` row (the ADR-044/9.7 precedent — zero new
credential surface). `POST /focus/suggestion` with 0 candidates → `409 focus_not_enough_candidates,
candidate_count:0`. One smoke overdue task created → same request → still `409, candidate_count:1` —
**no model call on either path**, confirmed by the absence of any `intelligence.focus.completed` or
`ai.usage` log line for these two requests. A second smoke task created (2 candidates) → `200` with a
real, correctly-cited suggestion: the model picked the P1 task over the P3 one, cited it `[1]`,
`source.section:"overdue"`, `source.detail:"P1"`. The one `intelligence.focus.completed` log line for
this call carries **only** counts/tokens (`candidateCount:2, contextChars:1521, latencyMs:2627,
usageIn/Out/Total`, `outcome:"answered"`) — no suggestion text, no task titles, no context. Both smoke
tasks archived → counts back to `0/0`. `DELETE /ai/task-routes/ask` → `204` → confirmed `409
cloud_ask_disabled` again — **Cloud Ask ships OFF in production**, per D3/ADR-061, unchanged by this
checkpoint.

**Physical Rabbit R1 acceptance — PASSED (2026-09-15 ~08:26–08:29Z), first-hand.** EAS build
`f4d8499e…` from `a08311d` (`fingerprint fa2179e0…`, 13m25s) → versionCode **19 → 20** (auto-
incremented, remote keystore reused). `adb install -r` of the 117 MB APK → `Success` (an in-place
replace is refused by Android on a certificate mismatch, so the success is the signing-continuity
proof); post-install: versionCode 20, signature `ad63266e` unchanged, `firstInstallTime` 2026-08-19
preserved, exact-alarm appop still `allow`, `POST_NOTIFICATIONS` still granted — no re-pair. Cold
launch (0 candidates, Cloud Ask off, the shipped default) → Today renders, **neither** the "Ask about
today" chip nor the Suggested Focus card present — 0 crash lines in logcat. Two smoke tasks created
server-side and Cloud Ask re-enabled for the on-device pass; cold relaunch → "Overdue 2" chip plus a
"Suggest focus" pill directly beneath the Ask chip. Tapped it: a real, correctly-worded suggestion
rendered ("You might consider paying the water bill now since it is overdue by two days and marked
as a higher priority…[1]") with the source row `[1] Overdue · P2 · [9.8 device smoke] Pay water
bill` and a "Suggest again" button. Tapped the source row → opened the real Task detail screen for
the exact cited task (type+id navigation, never model text). Backed out, tapped **"Suggest again"** →
a fresh, differently-worded suggestion generated, same cited task, no crash — proving the retry path
and the reentrancy guard live, not just in mocked tests. One smoke task archived (down to 1
candidate) → cold relaunch → the Suggested Focus card **rendered nothing at all** (not a disabled
button) — proving the hard "only one obvious candidate" exclusion on real device state, not just
against a fixture. Final smoke task archived, Cloud Ask disabled, cold relaunch → identical to the
very first screenshot (Overdue 0, no chip, no card). **0 crash lines across the entire session.**

**Post-acceptance production health:** `/health` `ok`/`connected`/`stale:false`; all four containers
`RestartCount=0`; 0 pg-boss jobs failed/retry/active; migration 20 (unchanged); 0 unarchived smoke
rows (`select count(*) from tasks where title like '[9.8%' and archived_at is null` → 0); 0 `ask`
task routes (OFF, as shipped); 0 api warn/error lines in the ~20 minutes since the redeploy; 0 crash
lines on the Rabbit R1.

**Recorded, not fixed (debt):** the "focus" preset's drop-ladder protection is not absolute — a rare,
quote-heavy-title budget overflow can still trim `overdue`/`due_today` via the pre-existing
last-resort pass (inherited from 9.7, corrected in a route comment, not in behavior — see ADR-067);
`isAbortLikeError` is now duplicated a **fourth** time (`focus/generate.ts`), the established accepted
pattern, not extracted; D1e (device-token auth on `/ai/*` writes) remains deferred; D4 (feedback) was
deliberately not built, with a one-line extensibility comment at the card's `ready` branch for a
future thumbs-up/down without restructuring; Options B ("what changed") and C (weekly review
intelligence) remain deferred, needing a last-seen watermark and week-bucketed carry-forward diffing
respectively, neither of which exists today.

**Phase 8 is closed.** The full checkpoint record — 8.0 foundation, 8.1 failure visibility, 8.2 the
real calendar, 8.3 search + export, 8.4 capture front doors, the owner-terminated 8.5 soak, the 8.6
decision gate and 8.6A/B/C/D — is archived verbatim in **`docs/history/phase-8.md`**. The closure
evidence, debt classification and Phase 9 starting brief are in **`docs/PHASE-8-CLOSEOUT.md`**.

| Checkpoint | Outcome |
|---|---|
| **8.0** | Documentation-only foundation: ADR-056/057, context compaction (−78.7% auto-load), ledger reconciliation (eight ADR present-state corrections), source durability prepared then established (private GitHub remote). |
| **8.1** | Occurrence-scoped alert dedupe keys (ADR-058), shared AI output filter, Brief-lane prompt premise corrected, API healthcheck. Deployed 2026-09-02. |
| **8.2** | Real Google Calendar enabled by one boolean; 98 events ingested; idempotency and ADR-042/045 invariants verified on real data. No code. |
| **8.3** | Lexical, index-free search over four entities with per-type caps and `ESCAPE`-clause LIKE escaping; user-authored-core export (ADR-059). Rabbit versionCode 8. |
| **8.4** | Confirm contract (`409 parse_result_not_committable`), Android share sheet + launcher shortcut through one consume-once module (ADR-060), Material pickers, `remind_at` at creation. Rabbit versionCode 10. Notification-shade capture deferred on evidence. |
| **8.5** | Adoption soak **terminated by the owner after 9.1 h of a 21-day minimum**. **No adoption conclusion may be drawn from it**; the baseline survives as dated measurement (`docs/SOAK-8.5.md`). |
| **8.6** | Decision gate (`docs/CHECKPOINT-8.6-DECISION.md`) → **8.6A** `capture.parse` DLQ + durable failed state, all-day floor, `q` scrub · **8.6B** five AI call sites hardened (`maxRetries: 0`, telemetry off), Cloud Ask as an explicit, user-initiated, OFF-by-default egress route (D1e deferred) · **8.6D** monitor target CRUD with archive-not-delete, migration `0016` · **8.6C** irreversible bounded retention under ADR-024. All deployed and accepted live. |

**Historically load-bearing facts, preserved unchanged:** capture parsing has always sent every
capture's full `raw_text` to the configured model; 8.6B corrected the false premise that all
note/task bodies were previously local; Cloud Ask is a distinct, explicit, user-initiated egress
route that ships OFF; 8.6C deletion is irreversible because ADR-024 forbids a backup system; 8.6D
never hard-deletes a monitor target.

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

## Phase 7 — Email summaries + service monitoring (CLOSED 2026-09-02)

**Phase 7 is closed.** Checkpoints 7.0–7.8B and the full Checkpoint 7.9 record — the open
observation, verbatim, plus the closure evidence — are archived in **`docs/history/phase-7.md`**.

**Checkpoint 7.9 — Post-deployment observation: COMPLETE (2026-09-02).** The one genuinely unproven
lane was the scheduled mail-digest cron. It fired, and the proof is structural rather than
circumstantial: the cron schedules `mail.digest.cron`, whose *handler* sends `mail.digest.generate`,
while `POST /mail-digests` sends the latter directly and **never creates a cron job at all**. A
completed `mail.digest.cron` row at `12:00:14Z` (= 07:00 `America/Chicago`) with the generate job
created 8.06 ms after that handler started and 7.63 ms before it completed is something a manual
request cannot produce — corroborated by the API log containing **no** `POST /mail-digests` at or
near 12:00Z. Same-key regeneration was then proven to **upsert**: same row id, `created_at`
preserved, and `pg_stat_user_tables` showing `n_tup_del = 0` for the table's entire lifetime.

Production at closure: all three Google integrations `active`; Gmail 96/96 sync runs succeeded with
**0 cursor expirations**; monitoring **3,879 checks, 3,879 up, 0 incidents**; all containers
`restarts=0`; migration level **16**; Postgres publishes no host port. The only failed pg-boss job in
the system remains the pre-deployment `calendar.google.sync-calendar` of 2026-08-31.

**One new defect was found by the closure and is assigned to 8.1:** the digest laundered a
**bare domain out of an attacker-controlled `from_display_name`** into persisted prose, and
`output.ts:43-48`'s written justification for leaving bare domains unstripped — that the model *"is
never given a domain to report in the first place"* — is **factually false**, because
`from_display_name` is one of ADR-054's two allowlisted attacker-controlled fields. Not clickable
(the client has zero autolink sinks) and ADR-054's real guarantee holds, but it is the same defect
class as the Brief-lane backport ADR-057 already assigned to 8.1. Two smaller findings —
monitoring under-samples every probing target (95–98% of due checks), and the log redactor fires on
an intentionally-logged field — are recorded in the ledger below.

---

## Remaining warnings / technical debt

> **Merged by Checkpoint 8.0.** This ledger was previously split across two identically-titled
> sections ("part 1 of 2" / "part 2 of 2"), which meant a reader searching the heading could
> silently read only half of it. The two lists are now one. **Every entry below is verbatim and in
> its originally recorded order** — nothing was reworded, reordered or dropped. The two original
> heading blocks are preserved in `docs/history/superseded-present-state.md`.

- ~~**Recurring all-day events surface ADR-042's local-noon anchor as a real clock time.**~~
  — **CLOSED by Checkpoint 5.7.1.** Both live leaks fixed, three latent spots hardened,
  `BriefEventItem` gained a `date` field, the rule centralised in one shared helper, and
  regression + mutation tests added across three timezones. Verified on the production
  device at versionCode 6.
- **The real-browser CORS proof has not been run against the Phase 5 deployment.** The Chrome
  extension was unavailable and the sandboxed browser pane cannot load `/_expo/static/*` on the
  non-standard `:8443` port (documented Phase 2 limitation). curl proved the exact header contract
  and `WEB_APP_ORIGIN`/compose are byte-identical to the browser-verified Phase 4 state.
- **`/home/himallinux/personal-os` on the production host is stale Phase 3 source** (migrations
  only to 0004) but holds the real `.env`. It is a trap for anyone who builds from it by habit.
  The live build context is `/home/himallinux/personal-os-9.6-release` (api, worker, web); every
  earlier `personal-os-<checkpoint>-release` directory is retained as a rollback source. *(Updated at
  Checkpoint 9.6, 2026-09-15.)*
- ~~**There is no DELETE endpoint for AI task routes.**~~ — **CLOSED by Checkpoint 8.6B.**
  `DELETE /ai/task-routes/:task_name` exists (`apps/api/src/routes/ai-config.ts`). Residual, recorded
  at the Phase 8 closeout: it accepts any known task name, so it can also delete `capture_parser`,
  after which every capture is written `status: "failed"` durably until the route is re-created.
  Perimeter-only; recoverable; a narrower guard is Phase 9 candidate debt.
- ~~**`apps/mobile/src/app/settings.tsx` renders `connection.last_sync_error` verbatim for Google
  Calendar.**~~ — **CLOSED by Checkpoint 6.5.** It was the terminal sink of a seven-hop chain, not a
  display nit: the column, the API response, the API log and pg-boss's durable `job.output` were all
  carrying provider-authored text. Closed at every hop, with the wire field now typed to a closed
  enum so a regression is a parse failure rather than a silent leak.
- **The Settings screen ships no test-notification control**, although
  `POST /devices/:id/test-notification` and the api-client method both exist. Verifying push
  therefore requires enqueuing a `notifications.dispatch` job server-side, since the device bearer
  token is deliberately unreadable from SecureStore.
- **Production gpt-4.1 rarely routes captures to `needs_confirm`.** Two deliberately ambiguous
  captures (including bare `asdf`) both parsed confidently as notes. Model behaviour, not a defect,
  but it means the confirmation-push path is hard to exercise on demand in production.

- **Physical Rabbit verification of the Daily Brief card is deferred to 5.6.** Reaching a local dev API from a side-by-side `.dev` build still needs a hand-patched Android manifest (the `expo-build-properties` debt below), which 5.5 was explicitly told not to pull in. Desktop and 480×640 browser evidence stands in; no on-device claim is made.
- **`ai_daily_briefs.model_id` FK violation is unhandled.** If the referenced `ai_models` row disappeared between resolution and the upsert, the insert would raise `23503` and surface as a generic 500, discarding an already-paid generation. Currently unreachable — the API exposes no delete endpoint for `ai_models` — so it is recorded rather than pre-solved.
- **POST/GET clock-read skew across local midnight.** A generation started just before local midnight persists `brief_date = D`, while a `GET /briefs/current` issued after the rollover computes `D+1` and returns 404. Correct per-instant behaviour on both sides and self-correcting on the next generation; only worth changing if the product wants a "just generated, don't let it vanish" guarantee.
- **`generated_at` can read one calendar day after `brief_date`** for the same near-midnight case, since it is stamped at persistence rather than at collection. Cosmetic; only visible if a UI shows both together.
- **Collector re-sorts projects inside Today's already-capped top 10**, so its "stalled first" ordering is guaranteed only within that window, not globally. Totals stay honest either way.
- **`callWithFallbackTracked` still invokes the attempt callback for candidates after the budget is exhausted** — each returns immediately without reaching a provider, so no call is made and no result changes; noted only because the timeout comment reads stricter than the loop behaves.
- **Drizzle snapshots stop at 0008** — `db:generate` remains unusable until faithful 0009/0010(+0011) snapshots are reconstructed or the hand-written-SQL + mandatory-`db:reconcile` methodology is superseded. Recorded decision from Step 0; each new hand-written migration must consciously extend the journal-guard allowlist and run reconcile.
- ~~**Recurring all-day event instances bucket by series anchor date in Today/review contexts**~~ — **CLOSED by Checkpoint 5.4 (ADR-042)**. The real defect was broader than recorded: such events never expanded anywhere at all. Today/review contexts now receive per-instance dates and required no code change.
- ~~**`expo-build-properties` is not a dependency**~~ — **CLOSED by Checkpoint 5.6.** `expo-build-properties@~57.0.13` is now a dependency and supplies `android.usesCleartextTraffic` for the UI-test profile only; a clean prebuild of both identities proved production's manifest carries no cleartext attribute and its `gradle.properties`/`proguard-rules.pro` are byte-identical to the UI-test build's. Hand-patching the generated manifest is no longer required.
- **No composite index on `occurrences(parent_type, status, occurs_at)` and no index on `events.start_date`** — the Agenda and event-range queries filter on both. Not a practical risk at single-user scale with a 90-day materialized horizon; two additive index migrations would close it if scale assumptions change.
- **All-day `recurrence_until` must resolve to end-of-local-day.** The shipped mobile editor always serializes it to 23:59:59.999, so the product flow is correct, but the schema neither enforces nor documents it — a raw API caller sending midnight silently loses the final occurrence (a noon-anchored instance sorts after it). Untested; document or normalize server-side in a future pass.
- **`ALL_DAY_ANCHOR_SLACK_MS` (36h) padding charges a few extra candidates against the shared 10,000 recurrence budget** per all-day series. Negligible for daily/weekly/monthly rules; only material for a pathological sub-daily all-day rule, which nothing currently forbids.
- **Optimistic review-toggle state does not roll back on PATCH failure** (server truth restored on next refetch; error banner shown) — acceptable MVP tradeoff flagged for 5.6 polish.
- **Priority chips ~37px without hitSlop on the daily flow** — below the 40px bar elsewhere; queued for 5.6.
- **No UI to browse past settled reviews** (client list method exists; no screen) — intentional MVP scope.
- **`reviews` route screens use inline Stack.Screen options rather than root-layout declarations** — conventionally inconsistent with other stack routes, functionally identical.


- ~~**`remind_at` cannot be set or changed through the API.**~~ — **STALE, corrected 2026-08-23.** Checkpoint 5.4 added `remind_at` to `TaskUpdateSchema` (`PATCH /tasks/:id`), and an editor exists at `apps/mobile/src/app/tasks/[id].tsx`. What remains true, and is the real residual debt: that editor is a raw ISO-8601 `TextInput` with no picker or validation, and `tasks/new.tsx` still cannot set a reminder at creation time.
- ~~**Android captures are labelled `source: "web"`**~~ — **NOT A DEFECT; reclassified in Checkpoint 5.6.** `source` is an ENTRY-PATH vocabulary, not a platform tag, and is closed by both `CaptureSourceSchema` and the `inbox_items_source` CHECK constraint. `web` correctly denotes the in-app Quick Capture sheet on every platform. There is no native member, and adding one would require altering the CHECK constraint (a migration). The rule is now documented in `docs/ARCHITECTURE.md` and pinned by a test. See ADR note in the 5.6 entry.
- ~~**Revoking a device does not clear its `is_primary_reminder_device` flag**~~ — **CLOSED by Checkpoint 8.1.** Revoke now clears the flag without auto-promoting (ADR-019/036 stand), which also unblocks the partial unique index that previously prevented promoting a real device.
- **The exact-alarm grant does not survive reinstall.** Every rebuild silently returns the app to inexact reminders until the user re-grants "Alarms & reminders".
- **Duplicate-alarm repair is covered by unit tests only.**
- **Runtime images aren't pruned of devDependencies.**
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval.
- **`docs/PHASE-0-CHECKLIST.md` section E checkboxes** remain unchecked in favor of `STATUS.md` as canonical record.
- **The web app's `EXPO_PUBLIC_API_URL` is baked in at Docker build time.**
- ~~**No `GET /calendar-connections/:id/calendars` endpoint** — per-calendar `sync_enabled` state is returned via `PATCH` and cached on mobile.~~ — **CLOSED by Checkpoint 9.1.** The route now exists;
  `usePersistedCalendarConnectionCalendars` calls it for real instead of hardcoding an empty array.
  **Observed on the Rabbit R1 at the Phase 8 closeout:** Settings rendered every calendar toggle OFF
  although two calendars were enabled — a misleading control on the daily driver. Verified fixed live
  on the Rabbit R1, before and after a cold relaunch: the two truly-enabled calendars now render ON.
- **`tailscaled` runs as a snap** on the production host — the monitoring unit is `snap.tailscale.tailscaled.service`, not `tailscaled.service`.
- **Rabbit Tailscale auto-start depends on Android's Always-on VPN setting** (enabled 2026-08-21; lockdown off). It is a device-side OS setting, not app-managed — a factory reset or Tailscale reinstall would require re-enabling it.
- **One archived Gate H smoke note row (`132020f6…`) remains as lineage** — invisible in UI, referenced by nothing, deliberately outside the approved purge scope.
- **Raw-heart-rate reconcile stability (F5) is DEFERRED ACCEPTANCE DEBT (2026-08-25).** F5
  capture 1 is preserved at `~/.personal-os-phase6/f5/capture-1.json`; capture 2 was
  explicitly deferred by the user. F5 is **neither passed nor failed**. Consequence:
  `heart-rate-intraday` stays disabled and raw intraday ingestion is excluded from 6.3.
  Reconsider via either the delayed reconcile-stability proof or the `list` + local
  multi-source de-duplication fallback keyed on `DataPoint.dataSource`.
- ~~**The 6.2P probe classifies any HTTP 400 as `not_supported`.**~~ — **CLOSED by Checkpoint 6.3.**
  Classification is now reason-driven: `missing_scope` and `not_supported` each require an
  evidenced `error.details[].reason`, and an ambiguous 400/403/404 is `provider_error`. The
  unsupported-reason set starts empty, so a genuinely unsupported metric currently reports
  `provider_error` — the safe direction, since it never disables a working stream.
- **The ≥7-day refresh-token observation is `blocked_time` AND structurally unreachable in Testing
  (2026-08-27, Checkpoint 6.6).** Google expires Testing-mode refresh tokens at exactly seven days, so
  "seven complete days elapsed **and** the token still valid" cannot both hold; the nominal earliest
  date *is* the expiry instant. Closing it needs a publishing-status decision, which 6.6 forbade and
  6.7 owns. 6.6's approved reconnect re-minted the token on **2026-08-27T06:51:49Z**, superseding the
  previously recorded 2026-08-31 expiry.
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
- ~~**One pre-existing pg-boss `health.google.sync-connection` job sits in state `created`**~~ —
  **CLOSED, verified at Checkpoint 7.9 closure (2026-09-02).** The job is gone; it was consumed as
  predicted when a worker next started. Zero rows remain in state `created` for that queue.
- **The development Google Health refresh token expires seven days after issue** (OAuth app
  deliberately left in Testing). 6.6's approved reconnect re-minted it on **2026-08-27T06:51:49Z**,
  so the previously recorded 2026-08-31 expiry is superseded. Reconnect before any further live work.
- **The local `.env` holds the development loopback callback**, not the Tailscale one.
  Restore before anything production-facing.
- **Twelve of eighteen Google Health value specs remain unverified (6.3L).** Six are now OBSERVED
  live — `steps`, `distance`, `floors`, `total-calories`, `heart-rate` (rollup leaves) and the
  `sleep` session shape. The rest are `unverified_no_account_data`: this account has never produced
  data for them, which is not a defect and for which no fixture was fabricated. A wrong declaration
  fails the run loudly and cannot store a wrong number.
- ~~**Session interval UTC-offset field names are unknown (6.3).**~~ — **CLOSED by 6.3L.** Observed
  live: `interval.startUtcOffset` / `endUtcOffset`. Sessions also carry NO civil times, so the civil
  clock is derived from the instant plus its explicit offset (lossless, both inputs stored).
- **An authoritative window returning zero sessions cannot tombstone the last remaining one (6.3),**
  because the sweep is gated on a non-empty seen-key set — `x <> ALL('{}'::text[])` is TRUE in
  Postgres, so an ungated sweep would tombstone the whole window. Deliberate cost of the guard.
- ~~**Session tombstoning may be inert on this account (6.3).**~~ — **CLOSED by 6.3L.** The real
  sleep record carries a resource `name`, so it keys as `data_point_name` and the ADR-047a sweep is
  reachable. F5's empty `dataPointName` on raw heart rate does not generalise to sessions.
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

- ~~**The mail digest launders a bare domain out of an attacker-controlled `from_display_name`**~~
  — **CLOSED by Checkpoint 8.1 (ADR-058).** Fixed structurally in the shared filter by a provenance
  layer plus a syntactic public-suffix layer, and the false `output.ts` justification is replaced
  with the evidence that disproved it. Original finding: The 2026-09-02 digest contains one bare-domain
  token that equals no stored `from_domain` and appears in no stored `subject`, but is a substring
  of one stored display name; 6 stored display names are domain-shaped. Two things are wrong. The
  model violated two explicit prompt rules (`prompt.ts:48`, `:50` — *"Never output … a domain
  name"*). And **`output.ts:43-48`'s written justification is factually false**: it argues the
  un-stripped bare-domain residual is *"narrow BY CONSTRUCTION … the model is never given a domain
  to report in the first place"*, but `from_display_name` **is** one of ADR-054's two allowlisted
  attacker-controlled fields, so production has falsified both of its disjuncts. The comment is
  arguably the more dangerous artifact, because it will stop the next reviewer looking. **Not
  clickable today** — `apps/mobile/src` has zero autolink sinks and push copy carries no mail
  content — and ADR-054's real guarantee (no tools, text only, no other table) is intact. Assigned
  to **8.1**, same defect class as ADR-057's Brief-lane output-filter and prompt-premise backport.
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
- **The tailnet suffix is embedded in immutable commit metadata.** 104 of 255 commits (recounted at
  the Phase 8 closeout; the earlier "117 of 249" was a miscount) carry an author email at the tailnet
  domain. Now that a remote exists this is replicated off-machine. Harmless in a private repository
  and **not** fixable without rewriting every SHA including `a5bbc48`, which production is pinned to.
  `git config user.email` is no longer set to that domain at either scope, so the count no longer
  grows. **This is the concrete reason the repository must never be made public without a separate
  deliberate decision.**

- ~~**Alerts share the `reminders` notification channel (8.1).**~~ — **CLOSED by Checkpoint 9.1.**
  Dedicated `alerts` (HIGH), `updates` (DEFAULT) and `capture` (LOW) channels now exist alongside the
  unchanged `reminders` (MAX); verified independently listed and toggleable in Android's per-app
  notification settings on the Rabbit R1, and a live test alert delivered on `alerts` at
  `importance=4`. Muting Reminders no longer mutes integration alerts.
- ~~**The Brief lane emits no `ai.usage` event (8.1).**~~ — **CLOSED by Checkpoint 8.6B.** The
  guarded logger moved to `packages/core/src/logging/logger.ts` and `apps/api/src/brief/generate.ts`
  now emits `ai.usage` through it.
- ~~**Two obsolete burned `notification_dispatch_log` rows remain (8.1).**~~ — **CLOSED
  2026-09-02, owner-approved.** Deleted by exact full-key equality under a `ROW_COUNT` guard;
  9 → 7 rows with the survivor checksum byte-identical before and after.
- ~~**The new occurrence-scoped keys have not been emitted in production (8.1).**~~ — **CLOSED,
  observed live at the Phase 8 closeout (2026-09-12).** `health-sync-alert:<connId>:breaker:daily-heart-rate-variability:2026-09-12:<deviceId>`
  was dispatched and `accepted` at 03:00:14Z when that stream's breaker tripped — the first genuine
  integration failure since 8.1, and the key carried its date discriminator exactly as ADR-058
  specifies. The calendar and Gmail keys remain unexercised for the same reason as before.

- **`calendar_connection_calendars.summary` stores the calendar ID, not the display name (found at
  8.2).** All 5 rows have `summary == google_calendar_id`, while Google's `calendarList` returns real
  display names (25, 6, 8, 23 and 26 characters). Cause: the **only** insert into that table anywhere
  in non-test source is `apps/api/src/routes/calendar-connections.ts:315`, which sets
  `summary: calendarKey`; the UPDATE branch never touches `summary` and no worker path backfills it.
  Cosmetic only — `summary` is never consulted for sync or matching — but any UI listing calendars
  shows opaque ids. Compounded by there being **no `GET` route for persisted calendar rows**
  (already recorded above).
- **Event text is still unbounded at write (8.2 confirms ADR-057 finding #3's residual).**
  `events.title/description/location` are plain `text` with `z.string()` and no `.max()`, and the
  sync path writes provider values verbatim. Checkpoint 8.1 bounded them at the **prompt** boundary
  only. As of 8.2 this path carries real third-party text for the first time: stored descriptions
  include conference links and meeting passcodes. Not currently reachable by the AI layer —
  `description` is absent from `BriefInput` entirely and title/location are truncated before the
  model — but the write-side bound ADR-054 requires for mail has no calendar counterpart.
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

- ~~**The API logs the search query string (8.3).**~~ — **CLOSED by Checkpoint 8.6A.** `q` is in
  `SENSITIVE_QUERY_PARAMS` (`apps/api/src/logging/scrub-url.ts`) and every request's `req.url` is
  scrubbed. ~~**Residual:** the `basic404` path logs and echoes the raw URL outside the serializer.~~
  — **CLOSED by Checkpoint 9.0** (see the 404 logging row in the production-state table).
  Remaining residuals, recorded: Fastify's `FST_ERR_REP_ALREADY_SENT` warn embeds the raw URL and is
  reachable only by a double-send handler bug (none exists); `;` is not treated as a query delimiter
  because `useSemicolonDelimiter` is off.
- **Search does not cover `events` or `projects` (8.3, deliberate).** Events are excluded because
  8.2 put real third-party text there and it is **still unbounded at write**; projects were left out
  because production holds zero of them and adding an entity is a contract change (ADR-059). Both
  are cheap to add once the write-side bound exists.
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
- ~~**⚠️ Confirming a `needs_confirm` inbox item fails, silently (found at 8.3 closure; NOT caused by
  8.3).**~~ — **CLOSED by Checkpoint 8.4 Lane 0.** Root cause: the stored tool call is `unclear`,
  which `commitParsedEntity` throws on unconditionally, so the confirm could only ever fail. Fixed at
  four layers and proven live on the two original production rows. Original finding: At 2026-09-03 04:38 UTC the app sent `POST /inbox/851d3455…/confirm` and
  `POST /inbox/0cd123a1…/confirm`; both enqueued `capture.parse`, both retried 5× and **failed**, and
  **both items are still `needs_confirm`** — so the confirmation never completed and the user got no
  error. These are the first `capture.parse` failures ever recorded. **Not an AI outage**: a Daily
  Brief generated successfully at 04:38:00, seven seconds earlier, on the same `gpt-4.1` /
  `My OpenAI` connection, and all four AI routes are enabled with keys present. **Not 8.3**: the
  worker was never rebuilt (image digest unchanged) and this preceded the APK install by 20 minutes.
  The cause is opaque by design — the AI error containment strips provider detail from both the log
  and `job.output`, leaving only `AiJobError: capture.parse failed (Error)`. Needs its own
  investigation; it is the one path that turns a capture the user tried to file into a silent no-op.
- **Search issues one request per keystroke (8.3).** Typing a six-character query produced five
  `/search` requests. Harmless at single-user scale with 18–35 ms responses, but a debounce is the
  obvious fix if the corpus or the latency ever grows.
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
- ~~**`capture.parse` still has no dead-letter queue (8.4).**~~ — **CLOSED by Checkpoint 8.6A**
  (`capture.parse.dead`, live in production, with a durable `status: "failed"` record).
  ~~**`occurrences.generate-lazy` (retry 5) and `occurrences.expand-window` (retry 3) still have no
  DLQ.**~~ — **CLOSED by Checkpoint 9.0** (ADR-062): both have DLQs, occurrence-scoped alerts and
  structured logs; `expand-window` additionally gained per-parent containment. Two adjacent gaps
  found by the 9.0 review remain open and are listed below.
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

- ~~**Google Health `daily-heart-rate-variability` stream is breaker-disabled (found at the Phase 8
  closeout, 2026-09-12).**~~ — **CLOSED by Checkpoint 9.0.** Shape re-observed live (value-free),
  spec corrected and `observed: true`, stream re-enabled, one row stored, no bad row ever written.
  Original finding preserved in `docs/history/` via the closeout record. **New, from the same
  review:** `daily-sleep-temperature-derivations` is now KNOWN to match nothing on purpose — Google
  documents an absolute `nightlyTemperatureCelsius`, while the catalog unit `celsiusDelta` is what
  the mobile formatter renders as a signed delta; pointing the leaf at the documented field would
  display "+33.4 °C". It needs an owner product decision (derive nightly − baseline, or store the
  absolute and change the display key — a mobile change) and will trip its breaker loudly on first
  data until then. Two documented-int64 daily leaves (`daily-resting-heart-rate`,
  `daily-respiratory-rate`) are declared `double` by choice (tolerance over strictness; reasoning in
  the file header). Observed `dataSource` envelope puts `platform` at the ROOT while
  `readSourceIdentity` reads `application.platform` — irrelevant to the daily path (no provenance
  stored), relevant to session/sample identity; unchanged, no session record observed.
- **ADR-054's retention window is explicit and recorded but not configurable (found at the Phase 8
  closeout).** The five windows are constants in `apps/worker/src/jobs/retention-cleanup.ts`; no
  env key exists. The owner chose the windows (8.6C D3–D6), so the decision is satisfied in
  substance; the "configurable" clause is recorded as unmet rather than silently reinterpreted.
  Intentionally deferred.
- **The generate-lazy dead alert's advertised repair has no seed path (found by the 9.0 review).**
  `PATCH /tasks/:id` seeds a lazy occurrence only on an anchor CHANGE (`!hadRecurrence ||
  oldAnchor === 'due_date'`), so re-saving a completion-anchored task's rule after a dead-lettered
  successor creates nothing; the only repairs today are the dead handler's one retry, or completing/
  skipping a manually inserted occurrence. The alert body deliberately says "review its repeat
  settings" rather than promising an edit will fix it. Product-contract change; Phase 9 candidate.
- **`POST /occurrences/:id/complete|skip` with `!app.bossReady` returns 200 and enqueues nothing
  (pre-existing, surfaced by the 9.0 review).** The occurrence is marked done/skipped and the
  successor is silently never generated — a real loss no DLQ can see because no job exists. Only
  reachable while pg-boss is down at the API. Returning 503 (or refusing the completion) is a
  contract change; recorded as reliability debt.
- **Health-connection `resolveFreshAccessToken` (API) still writes token columns without re-checking
  `status`** — already recorded above; the 9.0 shape probe exercised exactly that path (a refresh
  landed 35 s before the hourly pass, harmlessly). Unchanged.
- **8.6D's monitor URL guard is a literal-hostname regex.** `169.254.0.0/16` is blocked only when
  written as a dotted IPv4 literal; a DNS name resolving there, decimal/hex IPv4 or an IPv6
  link-local literal passes. The probe stores no response body or error text, so the oracle is
  status and latency only, and the routes are Tailscale-perimeter-only (D1e deferred). Security
  debt, Phase 9 candidate alongside D1e.

---

## Current objective

**Phase 10 opened for codebase consolidation and agent readiness (owner direction, 2026-09-15).**
Checkpoint 10.0 — a behavior-preserving cleanup pass ahead of Canvas integration and future
Hermes/OpenClaw agent work — is complete (see *Phase 10 → Checkpoint 10.0* above). Checkpoint 10.1
— the Canvas integration that 10.0 was preparing for — was implemented and locally verified in one
session, then **deployed to production and live-validated against the owner's real UTA Canvas
account in Checkpoint 10.1B**, same day (see *Phase 10 → Checkpoint 10.1B* above for the full
deployment/validation record). Production is now at migration level 21, serving api/worker/web from
`1e406f7`, Rabbit R1 versionCode 22.

Personal OS still has a first read-only intelligence surface (9.7) and a second, narrower one (9.8)
built on the 9.6 retrieval layer, exactly as ADR-056 sequenced; that product track is unchanged by
10.0/10.1/10.1B. Whether the next checkpoint resumes Phase 9's product track (widening the
intelligence lane, e.g. the `get_calendar_context`/`get_task_context` tool implementations, or a real
agent loop under its own ADR), a health trend view (E2), a new adoption soak, or further Canvas work
(course/announcement/event UI beyond the Today card, a reconnect-after-disconnect path, the deferred
D1e-style scoping question, etc.) is a product-direction choice for the owner.

---

## Completed

Phases 0 through 8 are implemented and production-deployed. Detail for each is in `docs/history/`;
the one-line summary is:

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
| **9.5** | Calendar as an authoring surface: explicit event ownership (`events.origin`, migration `0019`), Personal OS-authored events created/edited/cancelled on the Rabbit and synced outward through a durable, idempotent push path (link-derived remote ids, pending-link adoption, race-safe flips, five-minute redrive), write-eligibility from provider roles, whole-series recurrence presets with a round-trip-tested conversion layer, imported events read-only. **Deployed (api/worker/web, level 20) and accepted on the Rabbit R1 (versionCode 17) 2026-09-14** (ADR-064). |
| **9.6** | Search foundation + content bounds: every text field bounded at write (reject typed, truncate provider/model/STT), six-entity tokenised search with a fallback ladder, date tokens, explainable integer scoring, `getItemContext`, mobile search UX with sections/chips/date chip, bounded inputs. **Deployed (api/worker/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 18) 2026-09-15Z** (ADR-065). |
| **9.4** | Dependable recurring tasks and reminders: repeat presets, one strictly-after wall-clock successor rule for every writer, nightly lazy repair, occurrence snooze (migration `0018`) and reopen, per-occurrence reminders with Done / Snooze 1h / Tomorrow 9am actions, Today never buckets a recurring parent. **Deployed (api/worker/web, level 19) and accepted on the Rabbit R1 (versionCode 15) 2026-09-14** (ADR-063). |
| **9.7** | Personal intelligence, read-only: Cloud Ask widened with a bounded, id-free, wall-clock-only `TodayContext` and three preset questions ("Ask about today"); validated citations (`502 ask_uncited` on an unresolvable ref); nothing stored; no migration; worker untouched; the read-only future-agent tool contract defined (not integrated). **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 19) 2026-09-15** (ADR-066). |
| **9.8** | Suggested Focus: a narrow, cited AI suggestion over today's overdue/due-today tasks, reusing Ask's `TodayContext`/"focus" preset and its `ask` consent switch entirely — zero new intelligence lineage, zero new consent surface. No model call below two candidates (server-enforced); exactly one citation required, validated against the narrower candidate ref set. Deterministic summary renders for free; the AI line is always an explicit tap. Nothing stored; no migration; worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 20) 2026-09-15** (ADR-067). |
| **10.0** | Codebase consolidation & agent readiness: proven-dead mobile/API code removed (Expo starter scaffold, 6 dead query/outbox exports, 3 dormant API error classes, 1 unused health-connection helper, 1 unused test fixture), 4 orphaned Expo dependencies removed (`expo-image`/`expo-status-bar`/`expo-web-browser`/`@babel/plugin-transform-react-jsx`), a duplicate date-parsing implementation consolidated, new `docs/AGENT-READINESS.md` canonical-boundary inventory, `tags`/`item_tags` classified safe-to-drop (not acted on). Zero behavior change, zero migration, worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 21) 2026-09-15.** |
| **10.1** | Canvas LMS integration: read-only, Personal-Access-Token-authenticated sync of courses/assignments/announcements/calendar events into six new tables (migration `0020`), a Today "upcoming assignments" card, a same-origin-checked "open in Canvas" link, CalDAV-derived SSRF protection on `canvas_base_url`. **Deployed (api/worker/web, level 21) and live-validated against the owner's real UTA account and the physical Rabbit R1 (versionCode 22) 2026-09-16** (ADR-068). |

**Production is at migration level 21** and serves api, worker and web images built from `1e406f7`. All three Google integrations plus the new Canvas integration are active. Monitoring runs against five
active targets including both Tailscale Serve routes, with full CRUD. A daily retention cron bounds
`monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/`health_sync_runs` and sweeps
expired `health_oauth_states`/`mail_oauth_states`. Every retrying pg-boss queue has a dead-letter queue.
Calendar events authored in Personal OS sync outward to the owner's chosen writable calendar; imported
events are read-only. Search covers tasks, notes, events, projects, captures and mail with an explainable score, and every text field is bounded at write. Cloud Ask, when the owner enables it, can answer questions about today's schedule with cited sources, and can now also suggest one task to focus on. Canvas assignments sync hourly and surface on Today. The Rabbit R1 runs `com.himal.personalos` versionCode 22, built from `1e406f7`.

## Current work

**None in progress.** Checkpoint 10.0 closed 2026-09-15. Checkpoint 10.1 (Canvas LMS integration)
implemented, locally verified, deployed to production and live-validated against the owner's real
UTA account 2026-09-16 (Checkpoint 10.1B) — closed.

---

## Last verification

**Checkpoint 10.1B (2026-09-16).** Branch `phase-9-reliability`, HEAD `1e406f7` (the 10.1 record),
pushed to `origin` at the start of deployment. Production migrated 20→21 (`0020_canvas_lms_integration.sql`)
and verified structurally against the live schema (six tables, all FKs and CHECK constraints match
spec); api/worker/web recreated with zero warn/error log lines since redeploy. Live validation ran
entirely through real production routes against the owner's actual UTA Canvas account: connect,
sync (16 courses/355 assignments/19 announcements), idempotent resync (unchanged row counts),
disconnect (credential triple verified NULLed), invalid-token rejection, and reconnect+resync
(identical real counts reproduced) — with a full log audit confirming the PAT never appeared in any
api/worker log line. EAS build `23f032f5…` installed in place on the Rabbit R1 (versionCode 21→22,
signing continuity proven by the in-place install succeeding, `firstInstallTime`/exact-alarm/
notification permissions all preserved); the Canvas Today card verified rendering real data with a
working same-origin "open in Canvas" link, tapped live to a real `uta.instructure.com` SSO redirect.
Full record: *Phase 10 → Checkpoint 10.1B* above.

**Checkpoint 10.1 (2026-09-16).** Branch `phase-9-reliability`, working tree uncommitted at
implementation time (HEAD `9927752`, the 10.0 record — later committed as `d3bfeb2`/`1e406f7` and
deployed in Checkpoint 10.1B above). Seven parallel agent lanes in two dependency rounds (Foundation: db
schema/migration, `packages/canvas-providers`, `packages/schema` wire types; Services: API routes,
worker sync job, `packages/api-client`) plus a sequential Mobile round, each testing only its own
package against an isolated database clone. Integration (this session, as integrator) found and
fixed four gaps (credential columns wrongly `NOT NULL`, an accidental migrate against the shared
test database, a genuinely missing read endpoint the mobile lane correctly refused to route around,
two mechanical ratchet-test acknowledgments), then a fully independent adversarial security-review
agent (no context from the implementation) found one CONFIRMED gap — `canvas_base_url` had no SSRF
protection — fixed by porting the project's own CalDAV SSRF guard, which in turn surfaced and fixed
a latent IPv6-bracket bug in both the new Canvas copy and (flagged as a separate task, not fixed
here) the CalDAV original it was copied from. Verification, serially: `pnpm build --force` 13/13 ·
`pnpm typecheck` 23/23 · `eslint .` clean · `prettier --check .` clean · `gitleaks detect` — the
same class of pre-existing findings in ignored, untracked files, zero new, zero Canvas-related ·
`pnpm test --force` **23/23 tasks, 6,044 tests across 13 packages, zero failing** (canvas-providers
70 new · api 1,423 · mobile 1,390 · schema 519 · core 915 · worker 710 · api-client 195 · db 79
unchanged · health-providers/monitoring/calendar-providers/mail-providers/ai-providers unchanged).
**Migration invariant:** `db:reconcile` clean (0 discrepancies) after a genuine `drizzle-kit
migrate` run against the real local dev database (20 → 21), proving the hand-written SQL matches
the Drizzle schema exactly. **Live browser verification** (seeded data, real API + mobile-web
servers, real device pairing, cleaned up afterward): the Today card renders correctly with the
right ordering/formatting/badges, and the same-origin link guard was proven both positively and
negatively by mutating a seeded row and reloading. Full record: *Phase 10 → Checkpoint 10.1* above.

**Checkpoint 10.0 (2026-09-15).** Branch `phase-9-reliability`, HEAD `7dee309` (from `82fef97`, the
9.8 acceptance record, verified clean and equal to origin). Eight parallel lanes (evidence-gathering
and cleanup combined, strict disjoint file ownership) plus an independent adversarial dependency
cross-check, followed by four parallel adversarial review lenses (reachability, mobile/build
regression via a live `expo export --platform web`, date/time behavior equivalence, privacy/
security guard integrity) — zero blockers, zero regressions found. Integrator gates, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean
· `git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored, untracked
files, git history clean · `pnpm test` **21/21 tasks, 5,815 tests across 12 packages, zero
failing — identical to the 9.8 baseline**, confirming zero coverage lost to any deletion. **Migration
invariant:** 20 `.sql` / 20 journal entries, unchanged; `packages/db` byte-unchanged outside a
two-line fixture cleanup; production `drizzle.__drizzle_migrations` 20 before and after a proven
no-op `migrate`. Production and physical-device acceptance: recorded in full under *Phase 10 →
Checkpoint 10.0* above.

**Checkpoint 9.8 (2026-09-15).** Branch `phase-9-reliability`, HEAD `a08311d` (from `1441025`, the
9.7 acceptance record, verified clean and equal to origin). Design gate: three parallel read-only
research lanes (existing intelligence/brief architecture, read-models/search reuse surface, AI safety
infra/mobile UI) grounded a 14-section recommendation report in the live codebase rather than the
docs alone; the owner approved D1=Option E, D2/D3/D4/D5, plus the two-candidate-minimum constraint,
in one message with no back-and-forth. Foundation (the frozen `packages/schema/src/focus.ts` +
`packages/api-client/src/focus.ts` contract) written by the integrator first; two parallel
implementation lanes (API, mobile) launched in isolated worktrees — one worktree was stale and its
write tools jailed to it, so its fully-researched design was applied to the main tree by the
integrator directly, each claim re-verified against the live files before writing (exact navigation
helper name, response field names, `AskSourceRow` type-compatibility all confirmed, not assumed); the
other worktree's diff was merged after a byte-for-byte match against the shared contract. Two
adversarial review lenses (API, mobile) found and the integrator fixed 1 major (a `not_enough_
candidates` dead end) and 1 minor (a double-tap race) before deployment; a second minor (an
overstated drop-ladder guarantee in a code comment) was corrected. Integrator gates, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean (root; mobile's own `expo
lint` separately, also clean) · `prettier --check .` clean · `git diff --check` clean · `gitleaks` —
the same 21 pre-existing findings in ignored, untracked files, none tracked · `pnpm test --force`
**21/21 tasks, 5,815 tests across 12 packages, zero failing** (api 1,382 · mobile 1,367 · core 898 ·
worker 698 · schema 477 · health-providers 332 · api-client 171 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25; was 5,735 at 9.7). **Migration
invariant:** 20 `.sql` / 20 journal entries, unchanged; `packages/db` byte-unchanged; production
`drizzle.__drizzle_migrations` 20 before and after a proven no-op `migrate`. Production and
physical-device acceptance: recorded in full under *Phase 9 → Checkpoint 9.8* above.

**Checkpoint 9.7 (2026-09-15).** Branch `phase-9-reliability`, HEAD `9b4db0d` (from `b998646`,
the 9.6 acceptance record, verified clean and equal to origin). Design gate: six parallel read-only
audit lanes (AI architecture, context/data architecture, privacy/security, product design,
future-agent compatibility, adversarial review) produced the D1–D5 recommendations and the
`TodayContext`/privacy/API/tool contracts, returned for owner review and approved without change.
Implementation: three parallel lanes (api-intelligence, api-ask, mobile) on per-lane clones of
`personalos_test`; integration (two schema fixes: `scope` requires `tz`, project open-loop lists
gained `total`); six parallel adversarial review lenses (privacy/egress, citation/hallucination/
prompt, context integrity, mobile/Rabbit UX, API contract/backward compatibility, guard integrity/
token budget/performance) found **1 blocker (ref collision after a ladder drop) and 8 majors**, all
closed in two parallel fixer passes with regression tests; integrator gates on the shared database,
serially: `pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check
.` clean · `git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored,
untracked files, git history clean · `pnpm test --force` **21/21 tasks, 5,735 tests across 12
packages, zero failing** (mobile 1,336 · api 1,333 · core 898 · worker 698 · schema 477 ·
health-providers 332 · api-client 171 · monitoring 151 · calendar-providers 119 · mail-providers 116
· db 79 · ai-providers 25). **Migration invariant:** 20 `.sql` / 20 journal entries, unchanged;
`packages/db` byte-unchanged; production `drizzle.__drizzle_migrations` 20 before and after a proven
no-op `migrate`. Production and physical-device acceptance: recorded in full under *Phase 9 →
Checkpoint 9.7* above.

**Checkpoint 9.6 (2026-09-14/15).** Branch `phase-9-reliability`, HEAD `8f6ffe1` (from `100299d`,
the 9.5 acceptance record, verified clean and equal to origin). Foundation (text bounds, bounded
schemas, search contract v2) by the integrator; five parallel implementation lanes on per-lane
clones of `personalos_test` (`personalos_test_a…f`, `CREATE DATABASE … TEMPLATE`, dropped
afterwards); six adversarial review lenses, three fixer passes, one integrator fixture fix;
integrator gates on the shared database, serially: `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, git history clean · `pnpm test --force`
**21/21 tasks, 5,495 tests across 12 packages, zero failing** (mobile 1,250 · api 1,204 · core 898
· worker 698 · schema 461 · health-providers 332 · api-client 162 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25). **Migration invariant:** 20
`.sql` / 20 journal entries, highest `0019`; production `drizzle.__drizzle_migrations` 20 before and
after a proven no-op `migrate`. Production and physical-device acceptance: recorded in full under
*Phase 9 → Checkpoint 9.6* above.

**Checkpoint 9.5 (2026-09-14).** Branch `phase-9-reliability`, HEAD `4d1b565` (`91d744c` = the
checkpoint; `4d1b565` = the date-picker fix found at physical acceptance; both from `44c2ebd`, the
9.4 acceptance record, verified clean and equal to origin). Foundation (migration, Drizzle columns,
wire schemas, api-client bindings, shared core validation) by the integrator; four parallel
implementation lanes on per-lane clones of `personalos_test` (`personalos_test_a…f`, `CREATE
DATABASE … TEMPLATE`, dropped afterwards); six adversarial review lenses, three fixer passes, two
second-round lenses, two direct integrator fixes; integrator gates on the shared database, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean ·
`git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored, untracked
files, git history clean · `pnpm test --force` **21/21 tasks, 5,060 tests across 12 packages, zero
failing** at `91d744c` (api 1,143 · mobile 1,152 · core 771 · worker 687 · schema 334 ·
health-providers 332 · api-client 157 · monitoring 151 · mail-providers 116 · calendar-providers 113 ·
db 79 · ai-providers 25), mobile 1,154 at `4d1b565` (+2, the picker tests). **Migration invariant:**
20 `.sql` / 20 journal entries, highest `0019`; production `drizzle.__drizzle_migrations` 19 → 20 by
a migrate run from the new api image. Production and physical-device acceptance: recorded in full
under *Phase 9 → Checkpoint 9.5* above.

**Checkpoint 9.4 (2026-09-14)** — retained for reference. Branch `phase-9-reliability`, HEAD `e7b195e` (from `c8ad0c0`, the
9.3 acceptance record, verified clean and equal to origin). Foundation (migration, wire schemas,
api-client bindings) by the integrator; one core lane; four parallel implementation lanes on
per-lane clones of `personalos_test` (`personalos_test_a…f`, `CREATE DATABASE … TEMPLATE`, dropped
afterwards); six adversarial review lenses; four fixer passes (1 blocker, ~12 majors, ~15 minors, all
closed with regression tests); integrator gates on the shared database, serially: `pnpm build
--force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean · `git diff
--check` clean · `gitleaks` — the same 18 pre-existing findings in ignored, untracked files, git
history clean · `pnpm test --force` **21/21 tasks, 4,636 tests across 12 packages, zero failing**
(api 1,020 · mobile 1,062 · core 682 · worker 605 · health-providers 332 · schema 331 · api-client 157
· monitoring 151 · mail-providers 116 · db 79 · calendar-providers 76 · ai-providers 25). **Migration
invariant:** 19 `.sql` / 19 journal entries, highest `0018`; production `drizzle.__drizzle_migrations`
18 → 19 by a migrate run from the new api image. Production and physical-device acceptance: recorded
in full under *Phase 9 → Checkpoint 9.4* above.

**Checkpoint 9.3 (2026-09-13/14)** — retained for reference. Branch `phase-9-reliability`, HEAD `8132f3b` (from `643a563`, the
9.2 termination record, verified clean and equal to origin). Five parallel implementation lanes on
per-lane clones of `personalos_test` (`personalos_test_a…e`, created with `CREATE DATABASE …
TEMPLATE`, dropped afterwards), four adversarial review lenses, one fixer pass (3 majors, 5 minors,
all closed with regression tests), integrator gates on the shared database, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean ·
`git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored, untracked files ·
`pnpm test --force` **21/21 tasks, 4,141 tests across 12 packages, zero failing** (api 918 · mobile
838 · worker 573 · core 545 · health-providers 332 · schema 331 · api-client 157 · monitoring 151 ·
mail-providers 116 · db 79 · calendar-providers 76 · ai-providers 25). **Migration invariant:** 18
`.sql` / 18 journal entries, highest `0017`; production `drizzle.__drizzle_migrations` 17 → 18 by a
migrate run from the new api image. Production and physical-device acceptance: recorded in full
under *Phase 9 → Checkpoint 9.3*.


**Checkpoint 9.1 (2026-09-13).** Branch `phase-9-reliability`, HEAD `77ea112` (from `b695dba`, the
Checkpoint 9.0 acceptance-record commit, verified clean and equal to origin before mutation). Three
implementation lanes ran in parallel (mobile capture-shortcut lane, mobile+worker channel lane, api+
mobile calendar-toggle lane) on isolated Postgres clones (`personalos_test_b`/`_c`, created via
`CREATE DATABASE … TEMPLATE personalos_test`, dropped afterward); three parallel adversarial review
lenses followed (one per lane), surfacing two blockers in the capture-shortcut lane (a same-
identifier dedupe collision limiting the shortcut to one tap per process, and a cold-launch race
losing a tap before `QuickAddFab` mounts) and one real bug in the calendar lane (a failed persisted-
state fetch falling through to misleading all-OFF toggles); all three fixed directly, then a fourth,
focused re-review confirmed the fixes and surfaced two further narrow real bugs (the tap-driven rearm
bypassing the pairing gate; the identical all-OFF hazard during ordinary *loading*, not just error),
both also fixed and re-verified. The integrator then ran every gate on the shared database.

- **Quality gates, rerun uncached:** `eslint .` zero output · `prettier --check .` clean ·
  `git diff --check` clean · `gitleaks detect` — the same 18 pre-existing findings in ignored,
  untracked files, no new leaks · `pnpm typecheck` 21/21 · `pnpm build --force` 11/11 ·
  `pnpm test --force` (turbo `--concurrency=1`) **21/21 tasks, 3,853 tests across 12 packages, zero
  failing** — api 848 · mobile 727 · worker 545 · core 486 · schema 322 · health-providers 332 ·
  api-client 146 · mail-providers 116 · monitoring 151 · calendar-providers 76 · db 79 ·
  ai-providers 25.
- **Migration invariant:** 17 `.sql` / 17 journal entries, highest `0016`, unchanged; production
  `drizzle.__drizzle_migrations` count 17 before and after a proven no-op `migrate`.
- **Production and physical-device acceptance:** recorded in full under *Phase 9 → Checkpoint 9.1*
  above.

**Checkpoint 9.0 (2026-09-12)** — retained for reference. Branch `phase-9-reliability`, HEAD `6ff3287` (from `b41f8f0`, the
Phase 8 closeout HEAD, verified clean and equal to origin before mutation). Four implementation
lanes ran in parallel on per-lane clones of `personalos_test` (`personalos_test_a…e`, created with
`CREATE DATABASE … TEMPLATE`, dropped afterwards), seven adversarial review lenses, four fixer
passes; the integrator then ran every gate on the shared database, serially.

- **Quality gates, rerun uncached:** `eslint .` zero output · `prettier --check .` clean ·
  `git diff --check` clean · `gitleaks detect` (git history) no leaks — the working-tree scan's 18
  hits are all in ignored, untracked files (`.env`, `google-services.json` per ADR-032, the
  `export.log` already in this ledger) · `pnpm typecheck` 21/21 · `pnpm build --force` 11/11 ·
  `pnpm test --force` (turbo `--concurrency=1`) **21/21 tasks, 0 cached, 3,788 tests across 12
  packages, zero failing** — api 843 · mobile 673 · worker 539 · core 486 · schema 322 ·
  health-providers 332 · monitoring 151 · api-client 146 · mail-providers 116 · db 79 ·
  calendar-providers 76 · ai-providers 25. Pre-commit gitleaks hook passed on the commit.
- **Migration invariant:** 17 `.sql` / 17 journal entries, highest `0016`; `packages/db` byte-unchanged;
  production `drizzle.__drizzle_migrations` count 17 before and after a proven no-op `migrate`.
- **Production acceptance:** recorded in full under *Phase 9 → Checkpoint 9.0* above.

**Phase 8 closeout (2026-09-12)** — retained for reference: HEAD `81662ff`, 3,668 tests, all gates
clean; full evidence in `docs/PHASE-8-CLOSEOUT.md`.

## Next action

**Checkpoint 10.1 (Canvas LMS integration) is deployed, live-validated, and closed (2026-09-16,
Checkpoint 10.1B).** Production is at migration 21, api/worker/web serve `1e406f7`, Rabbit R1 is at
versionCode 22, and the owner's real Canvas account is connected and syncing hourly. One real,
non-blocking gap was found live during validation and is recorded as Phase 10 candidate follow-up
rather than fixed inline (per the deployment session's own scope boundary): **there is no route to
reconnect a Canvas connection once disconnected** — `POST /canvas-connections` always
`409 canvas_already_connected`s for a base URL that has any row, even a disconnected one, because
the unique index carries no status filter. A dedicated reactivate endpoint, or relaxing the index to
`WHERE status != 'disconnected'`, is the fix. If the owner wants further Canvas work (widening what's
synced, course/announcement/event UI beyond the Today card, the reconnect path above), that's a
follow-up checkpoint, not urgent.

**Checkpoint 10.0 (codebase consolidation & agent readiness) is complete.** It was explicitly not a
product checkpoint — no candidate below was advanced or foreclosed by it. `docs/AGENT-READINESS.md`
now gives whatever comes next (a real agent loop, or further Canvas/Hermes-OpenClaw work) a
canonical-boundary map to build from rather than a fresh audit. Two items from 10.0 are recorded for
an explicit future owner decision, not carried as blocking debt: the `tags`/`item_tags` safe-to-drop
schema classification (a table drop is irreversible under ADR-024 and is the owner's call), and the
deferred dead-code-tooling (`knip`) decision (revisit only if the codebase's Zod-schema-companion/
forward-design-export ratio shifts).

Select the next Phase 9 (or later) checkpoint. 9.7 shipped the
first read-only intelligence lane and
9.8 added a second, narrower one on the same substrate; ADR-056's read-only-before-write-capable
sequencing is now exercised twice. The 9.3 ranked tiers are exhausted except E2 (health trend
context). Candidates now: **widen the Canvas integration** (course/announcement/event UI beyond the
Today card, a full course-browsing screen, device-token auth on the new routes), **widen the
intelligence lane further** (implement
`get_calendar_context`/`get_task_context`, build Option B "what changed" — needs a last-seen
watermark — or Option C weekly review intelligence — needs week-bucketed carry-forward diffing —
both deferred by the 9.8 design gate as genuinely new backend work, not a context-reuse win like
Suggested Focus was), **a real tool-calling agent loop** over `READ_TOOL_NAMES` (needs its own ADR, a
`posops_readonly` role, and a budgeted multi-use grant — `docs/AGENT-READINESS.md` §1–2 is the
starting map), **E2 health trends**, a **new 21-day adoption soak** (a new checkpoint with a new
baseline; the reviewed observer tooling in `scripts/soak/` is reusable), or the **Canvas/
Hermes-OpenClaw integration** this checkpoint was explicitly preparing for. This is a
product-direction choice — pause for the owner.

Open, non-blocking, carried forward from 10.0: `react-native-css-interop`'s babel entrypoint
references `@babel/plugin-transform-react-jsx` by a bare string without declaring it as its own
dependency, currently resolving only via `babel-preset-expo`'s own declared dependency on the same
package (not caused by 10.0, worth an upstream note if a future SDK bump ever breaks the alignment);
`apps/mobile/README.md` still references `npm run reset-project` (stale boilerplate text only).

Open, non-blocking, carried forward from 9.8: the "focus" preset's drop-ladder protection is not
absolute (a rare quote-heavy-title overflow can still trim `overdue`/`due_today` via the pre-existing
9.7 last-resort pass — a route comment now names this, behavior unchanged); `isAbortLikeError` is
duplicated a fourth time (`apps/api/src/focus/generate.ts`); D4 (feedback) has a one-line
extensibility comment but no built affordance; Options B/C (above) remain unbuilt.

Open, non-blocking, carried forward from 9.7: citation validation proves a ref exists, never that a
ranking/priority/time claim is true (mitigated by section/detail labels, not closed); `redactSecrets`
is pattern-based, not DLP; `snoozed_within_horizon.total` is honest only within Today's own capped
7-day lists; the Brief lane still sends UTC instants for the model to convert, unlike the
wall-clock-only `TodayContext`; D1e (device-token auth on `/ai/*` writes) remains deferred; no
`posops_readonly` role exists yet.


Open, non-blocking, carried forward from 9.6: `may` is recognised as a month (rung 2 drops it when
the window is empty); a single CJK character or digit is refused by the 2-char query minimum;
stored text is not NFKC-normalised, so a full-width or ligature form in a row is not found by its
folded query, and Greek final sigma folds differently in Postgres and JS; `title_exact` is
punctuation-sensitive; a date-only query with no hits reports `all_without_date`; `match.fields` can
name `description` on an external event (an existence signal to the same owner); the ISO-date walk
enumerates ≤ 50 rows per type per call (a future lane must budget calls); a local linked event whose
description the owner lengthened past 4000 chars in Google is stored truncated and pushed back
truncated on the next local edit (one-way, no loop); RN `maxLength` cuts a paste silently at the
bound (the counter is the feedback); the CalDAV truncation count is inferred from stored length
(`≥ bound − 1`) rather than exact; `match.reasons` is ~60 % of a large response's payload; the
over-bound-capture outbox row (unreachable now that the composer is bounded) would sit permanently
failed with no UI to clear it; ILIKE over long note bodies is the cost driver at 30× production
scale (index-free mitigation: stop shipping bodies to TypeScript).

Open, non-blocking, carried forward from 9.5: no `If-Match` on Google update (inbound
`decideConflict` is the guard); `singletonKey` inert under pg-boss `standard` policy (duplicate
pushes are idempotent by design); full-sync reconcile no longer archives a link in `error`/`conflict`
whose remote event was deleted (incremental sync still does; a later edit then lands `not_found`);
`listCalendars` reads one page (a calendar beyond the first 100, or hidden in Google's sidebar, is
not offered); a remote un-delete of a locally deleted event re-imports as a new external row; an
ambiguous-failure edit-and-resubmit mints a new `client_uuid` (a duplicate is the accepted cost of
never losing an edit); a `reader` calendar's imported events show "From connected calendar" rather
than its name; `POST /occurrences/:id/complete|skip` is now `409 event_not_owned` for external event
occurrences (mobile never calls it); the `_layout` title stays "Event" for the read-only view; the
primary calendar's Google summary is the account address and is shown as the calendar name on the
device.

Open, non-blocking, carried forward from 9.4: the spring-forward early-resolution note; the 90/91-row
fall-back window; completion-anchored monthly drift to the 28th; unbounded reminder titles; the
nightly re-alert for a permanently malformed completion rule; the pre-existing mobile-config lint
error in `app/monitor/index.tsx`.

*(Retained for reference — the 9.3 selection brief.)* Rank the Phase 9 product candidates (tasks/reminders/recurrence · search/knowledge · calendar/
planning · capture/inbox · Daily Brief · projects · health intelligence) on daily value, usage
lift, cost, dependency risk, privacy risk, incremental shippability, architectural fit and blocking
debt — using parallel read-only audit agents over the existing closeout, debt and product documents
— select the dominant candidate, and begin Checkpoint 9.3 implementation in the same session. Pause
for the owner only if two candidates with materially different product directions tie on value at
significant scope. Also in scope as ordinary work: the `daily-respiratory-rate` value-spec
correction.

Open, non-blocking, carried forward: D1e; the generate-lazy repair-path and `bossReady` silent-loss
gaps (9.0 review); `daily-sleep-temperature-derivations` needs a product decision; the monitor URL
guard; event text unbounded at write; the standing "every client change needs an APK" property; a
narrow, self-healing race where the AppState-foreground repost and the tap-driven rearm can each
dismiss the other's freshly-scheduled capture-shortcut notification if they fire within the same
tick (9.1 re-review, low likelihood, self-corrects on the next trigger); a buffered notification tap
that arrives while genuinely unpaired has no expiry and will open the composer whenever the device is
eventually paired, however much later (9.1 re-review, narrow); the web client was not rebuilt this
checkpoint, so its Settings screen still shows the pre-fix calendar-toggle behavior until web is next
deployed.

Deliberately **not** started: any Phase 9 product work beyond this checkpoint's three fixes, any
embeddings or retrieval work, any write-capable AI lane, any Postgres image change, the 21-day
adoption soak itself.
