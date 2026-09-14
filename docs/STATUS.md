# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 9 — OPEN, accelerated operating model.** 9.0 (reliability & privacy),
9.1 (daily-use), 9.3 (capture→task loop) and 9.4 (dependable recurring tasks and reminders) are
deployed and accepted. **9.2 (21-day adoption soak) was OWNER-TERMINATED BEFORE MINIMUM DURATION** —
no adoption conclusion is permitted (`docs/SOAK-9.2.md`). **Checkpoint 9.5 — Calendar as an
authoring surface — is IMPLEMENTED, DEPLOYED and ACCEPTED (2026-09-14)**: explicit event ownership
(`events.origin`), Personal OS-authored events created/edited/cancelled on the Rabbit R1 and synced
outward to a write-eligible connected calendar through a durable, idempotent push path, whole-series
recurrence presets, imported events read-only; migration level **20** (`0019`); Rabbit R1 versionCode
**16** (ADR-064). No further Phase 9 checkpoint is selected yet. Phase 8 closed the same day
Checkpoint 9.0 shipped (ADR-061; record `docs/PHASE-8-CLOSEOUT.md`, checkpoint detail
`docs/history/phase-8.md`).
**Canonical architecture:** `docs/ARCHITECTURE.md` · **Canonical decisions:** `docs/DECISIONS.md` · **Historical record:** `docs/history/`

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

Verified first-hand at the Checkpoint 9.4 acceptance, 2026-09-14 ~07:31Z (Checkpoint 9.0's own
2026-09-12 acceptance evidence is preserved in the Checkpoint 9.0 entry below).

| | |
|---|---|
| Migration level | **20** (`0000`–`0019`); local and production agree; `0019` = `events.origin` + CHECK, `events.client_uuid` + partial unique index, `calendar_connection_calendars.access_role` (9.5) |
| Serving commit | api, worker **and web** all **`91d744c`** (Checkpoint 9.5, 2026-09-14T11:57Z). Provenance is by compose `working_dir` (`personal-os-9.5-release` for all three); the images carry no commit label. Rollback images `personal-os-{api,worker,web}:rollback-pre-9.5`, tagged by resolved digest (earlier `rollback-pre-*` tags preserved underneath). |
| Containers | all four `RestartCount=0`; api `(healthy)`; postgres `postgres:17-alpine` up since 2026-08-30; `GET /health` → `ok` / `connected` / `stale:false` |
| Rabbit R1 | `com.himal.personalos` **versionCode 17**, built from `4d1b565` (EAS build `4e377e86…`; versionCode 16 from `91d744c` was installed first and superseded the same session after the date-picker off-by-one was found), installed in place 2026-09-14 with SecureStore credential, primary-device row, exact-alarm appop, `POST_NOTIFICATIONS` and `firstInstallTime` (2026-08-19) all preserved — no re-pair. Carries the 9.5 event composer and editor, calendar target picker, event Repeat presets, the read-only view for imported events, and the corrected Material date pickers. |
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
| Test baseline | **5,062 tests across 12 packages** (9.5 at `4d1b565`: 5,060 at `91d744c` + 2 picker tests; was 4,636 at 9.4, 4,141 at 9.3, 3,853 at 9.1, 3,788 at 9.0, 3,668 at the Phase 8 closeout — see *Last verification*) |
| pg-boss | **29 queues** (`worker.started` count; `pgboss.queue` reads 30 with the internal `__pgboss__send-it`), 10 schedules. DLQs on `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, the three calendar queues and — since 9.0 — **`occurrences.generate-lazy` → `.dead` and `occurrences.expand-window` → `.dead`**, both verified attached in production `pgboss.queue` and both consumed by registered workers. Every retrying queue now has a dead-letter queue. **`occurrences.expand-window` has a phase 2 since 9.4**: idempotent repair of any completion-anchored parent left with no open occurrence, per-parent contained, failures (including an insert collision that leaves no open row, `reason: collision`) counted into the same `OccurrencesJobError` → dead letter → alert. |
| Retention cleanup | `retention.cleanup`, daily `0 4 * * *` UTC: **seven** independent DELETEs — `monitor_checks` 30d · `mail_messages`/`mail_digests` 45d · `mail_sync_runs`/`health_sync_runs` 30d (8.6C, windows unchanged) · **`health_oauth_states` / `mail_oauth_states` on the row's own `expires_at < now`, no window constant (9.0)**. 9.0 acceptance: 9 + 1 expired states deleted exactly as preflighted, rerun deleted 0. **The first scheduled run is 2026-09-13T04:00Z** and had not yet occurred. |
| Alert keys | Occurrence-scoped (ADR-058). 9.5 adds `calendar.push-event.dead:<eventId>:<link updated_at ISO>` (unexercised in production by design). First live emission `health-sync-alert:…:breaker:daily-heart-rate-variability:2026-09-12:…` accepted 2026-09-12T03:00:14Z. 9.0 adds two producers, unexercised in production by design: `occurrences.generate-lazy.dead:<occurrenceId>` and `occurrences.expand-window.dead:<UTC date>` — the latter now also covers a failed phase-2 lazy repair (9.4; body wording "could not be expanded or repaired overnight"). No new producer in 9.4. |
| Search / export / Ask / Monitor CRUD | `GET /search`, `GET /export`, `POST /ask`, `GET/POST/DELETE /ai/task-routes`, `/monitor/targets` CRUD — all live, perimeter-only |
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
  The live build contexts are `/home/himallinux/personal-os-8.6d-release` (api, web) and
  `/home/himallinux/personal-os-8.6c-release` (worker); every earlier `personal-os-<checkpoint>-release`
  directory is retained as a rollback source. *(Updated at the Phase 8 closeout, 2026-09-12.)*
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

**Phase 9 product development, accelerated operating model (owner direction, 2026-09-14).** Parallel
audit → parallel implementation → integration → adversarial review → fixes → full tests →
deployment → production acceptance. No soak or observation wait between checkpoints; no separate
planning-only checkpoints when implementation is clear; reversible decisions are not owner gates.
Production mutations remain serialized and every standing guardrail holds. **Checkpoint 9.5 is
complete; the next checkpoint is not yet selected.** From the 9.3 ranking's next tier, A3 (recurring
reminders) closed in 9.4 and C2 (Rabbit-native event authoring) closed in 9.5; the remaining ranked
candidates are B1/C4 (search term matching + **event text bounded at write** — now more pressing,
since 9.5 makes event text owner-authored on the device as well as third-party) and E2 health trend
context. All four core entities (tasks, notes, events, inbox) can now be authored and managed on the
Rabbit; the recommended next step is **B1/C4**, which also closes the last ADR-057 #3 residual.

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
| **9.4** | Dependable recurring tasks and reminders: repeat presets, one strictly-after wall-clock successor rule for every writer, nightly lazy repair, occurrence snooze (migration `0018`) and reopen, per-occurrence reminders with Done / Snooze 1h / Tomorrow 9am actions, Today never buckets a recurring parent. **Deployed (api/worker/web, level 19) and accepted on the Rabbit R1 (versionCode 15) 2026-09-14** (ADR-063). |

**Production is at migration level 20** and serves api, worker and web images built from `91d744c`. All three Google integrations are active. Monitoring runs against five
active targets including both Tailscale Serve routes, with full CRUD. A daily retention cron bounds
`monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/`health_sync_runs` and sweeps
expired `health_oauth_states`/`mail_oauth_states`. Every retrying pg-boss queue has a dead-letter queue.
Calendar events authored in Personal OS sync outward to the owner's chosen writable calendar; imported
events are read-only. The Rabbit R1 runs `com.himal.personalos` versionCode 17, built from `4d1b565`.

## Current work

**None in progress.** Checkpoint 9.5 closed 2026-09-14.

---

## Last verification

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

Select the next Phase 9 checkpoint from the remaining ranked tier — recommended **B1/C4: search
term matching + event text bounded at write** (the `events.title/description/location` `.max()` +
truncate-at-write discipline ADR-054 set for mail, then events and projects in `/search`) — and
begin implementation in the same session under the accelerated operating model. Pause for the owner
only on a product-direction tie at significant scope.

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
