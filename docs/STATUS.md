# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 9 — OPEN.** Checkpoint 9.0 (reliability & privacy housekeeping) is
IMPLEMENTED, DEPLOYED and ACCEPTED (2026-09-12, ADR-062). Checkpoint 9.1 (daily-use: notification-
shade capture, a dedicated alerts channel, the Rabbit calendar-toggle fix) is IMPLEMENTED, DEPLOYED
and ACCEPTED (2026-09-13), with physical Rabbit R1 verification of all three deliverables.
**Checkpoint 9.2 — the 21-day adoption soak — is RUNNING: `SOAK_START 2026-09-14T01:28:10.274Z`,
`SOAK_END 2026-10-05T01:28:10.274Z`. Adoption-critical surfaces are frozen; no adoption conclusion
may be drawn before `SOAK_END`.** Record: `docs/SOAK-9.2.md`. Phase 8 closed the same day
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

Verified first-hand at the Checkpoint 9.1 acceptance, 2026-09-13 ~02:05Z (Checkpoint 9.0's own
2026-09-12 acceptance evidence is preserved in the Checkpoint 9.0 entry below).

| | |
|---|---|
| Migration level | **17** (`0000`–`0016`); local and production agree; unchanged by 9.1 |
| Serving commit | api **`77ea112`** · worker **`77ea112`** (Checkpoint 9.1, 2026-09-13) · web **`ca04e57`** (Checkpoint 8.6D — not rebuilt by 9.1 either; the checkpoint's web-relevant change, the calendar-toggle fix, is not part of this deployment's scoped dependency impact). Provenance is by compose `working_dir` (api/worker → `personal-os-9.1-release`, web → `personal-os-8.6d-release`); the images carry no commit label. Rollback images `personal-os-{api,worker}:rollback-pre-9.1`, tagged by resolved digest (9.0's own `rollback-pre-9.0` tags are preserved underneath). |
| Containers | all four `RestartCount=0`; api `(healthy)`; postgres `postgres:17-alpine` up since 2026-08-30; `GET /health` → `ok` / `connected` / `stale:false` |
| Rabbit R1 | `com.himal.personalos` **versionCode 13**, built from `77ea112` (EAS build `4cea0ffd…`), installed in place 2026-09-13 with SecureStore credential, primary-device row, exact-alarm appop and `firstInstallTime` (2026-08-19) all preserved — no re-pair. Carries the Checkpoint 9.1 UI (notification-shade capture, the alerts/updates/capture channels, the calendar-toggle fix). |
| Capture front doors | Quick Capture · PTT · Siri/Assistant · Android share sheet (8.4) · launcher shortcut (8.4) · **notification-shade capture (9.1)** — a persistent local "Capture" notification on its own channel, tap opens the same composer; verified live on the Rabbit R1 across two sequential taps (the rearm-with-a-fresh-identifier fix), producing a real `inbox_items` row (`source: "web"`, parsed as a task, archived after verification). |
| Notification channels (9.1) | `reminders` (MAX, unchanged, local reminders only) · `alerts` (HIGH, new — integration/monitor alerts) · `updates` (DEFAULT, new — confirmations + mail digest) · `capture` (LOW, new — the local shortcut only, never through `notifications.dispatch`). All four verified independently listed and toggleable in Android's per-app notification settings on the Rabbit R1; a live test alert (via the existing `notifications.dispatch` job, `category: "alert"`) delivered on the `alerts` channel at `importance=4`. |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active**. Health stream `daily-heart-rate-variability` **re-enabled 2026-09-12T23:58Z** after 9.0 corrected its value spec from a live shape observation: `available_in_window`, `first_data_date 2026-09-11`, one stored row with the deep-sleep RMSSD in `breakdown`, 24/24 streams succeeded on the acceptance pass. |
| Calendar sync | 2 of 5 calendars enabled (owner's real primary + the dedicated test calendar). 98 events. **The Rabbit R1 Settings screen now renders this correctly (9.1)** — verified live, before and after a force-stop + cold relaunch, where it previously showed all five as OFF regardless of real state. |
| Monitoring | 5 active targets (+1 archived 8.6D smoke target); **0 incidents ever, 0 open**; full CRUD live (8.6D) |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row. **`ask` (Cloud Ask, 8.6B) absent — OFF**, as shipped; the owner enables it from Settings. |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Source durability | `origin` = `https://github.com/Himalpok1/Personal-OS` — **PRIVATE**. No CI, no Actions workflow, no repository secret. |
| Test baseline | **3,853 tests across 12 packages** (9.1; was 3,788 at Checkpoint 9.0 and 3,668 at the Phase 8 closeout — see *Last verification*) |
| pg-boss | **29 queues** (`worker.started` count; `pgboss.queue` reads 30 with the internal `__pgboss__send-it`), 10 schedules. DLQs on `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, the three calendar queues and — since 9.0 — **`occurrences.generate-lazy` → `.dead` and `occurrences.expand-window` → `.dead`**, both verified attached in production `pgboss.queue` and both consumed by registered workers. Every retrying queue now has a dead-letter queue. |
| Retention cleanup | `retention.cleanup`, daily `0 4 * * *` UTC: **seven** independent DELETEs — `monitor_checks` 30d · `mail_messages`/`mail_digests` 45d · `mail_sync_runs`/`health_sync_runs` 30d (8.6C, windows unchanged) · **`health_oauth_states` / `mail_oauth_states` on the row's own `expires_at < now`, no window constant (9.0)**. 9.0 acceptance: 9 + 1 expired states deleted exactly as preflighted, rerun deleted 0. **The first scheduled run is 2026-09-13T04:00Z** and had not yet occurred. |
| Alert keys | Occurrence-scoped (ADR-058). First live emission `health-sync-alert:…:breaker:daily-heart-rate-variability:2026-09-12:…` accepted 2026-09-12T03:00:14Z. 9.0 adds two producers, unexercised in production by design: `occurrences.generate-lazy.dead:<occurrenceId>` and `occurrences.expand-window.dead:<UTC date>`. |
| Search / export / Ask / Monitor CRUD | `GET /search`, `GET /export`, `POST /ask`, `GET/POST/DELETE /ai/task-routes`, `/monitor/targets` CRUD — all live, perimeter-only |
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

### Checkpoint 9.2 — 21-day adoption soak: RUNNING (started 2026-09-13 20:28 CDT)

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

**Checkpoint 9.2 — the 21-day adoption soak — is running until `2026-10-05T01:28:10.274Z`.**
Observe real usage; keep the adoption-critical surfaces frozen; classify any incident (A/B/C) before
acting; draw no conclusion before the boundary. Interim statements are descriptive only.

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
| **9.2** | 21-day adoption soak. **RUNNING** — `2026-09-14T01:28:10.274Z` → `2026-10-05T01:28:10.274Z`. Read-only observer + daily scheduled check; no code deployed; record in `docs/SOAK-9.2.md`. |

**Production is at migration level 17** and serves api/worker images built from `77ea112` and a web
image built from `ca04e57`. All three Google integrations are active. Monitoring runs against five
active targets including both Tailscale Serve routes, with full CRUD. A daily retention cron bounds
`monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/`health_sync_runs` and sweeps
expired `health_oauth_states`/`mail_oauth_states`. Every retrying pg-boss queue has a dead-letter queue.
The Rabbit R1 runs `com.himal.personalos` versionCode 13, built from the same `77ea112`.

## Current work

**Checkpoint 9.2 adoption soak — observation in progress.** Nothing is being built. Permitted
during the soak: backend maintenance that does not change user-visible behaviour, documentation,
tests, internal tooling, isolated infrastructure cleanup, provably behaviour-identical refactors.
Deferred past `SOAK_END`: anything that could plausibly make the app easier or harder to use daily.

---

## Last verification

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

**Let the soak run to `2026-10-05T01:28:10.274Z`.** The owner uses Personal OS when it is genuinely
useful — no quota, no prompting. The daily observer pushes only on RED. At the boundary, the
one-shot task takes the final snapshot; the end-of-soak analysis then compares it to the baseline
under the frozen definitions in `docs/SOAK-9.2.md` (frequency, breadth, follow-through,
persistence, friction, reliability; weeks 1/2/3; burst vs sustained) and produces exactly one of
`meaningful adoption demonstrated` / `mixed / inconclusive adoption` / `weak adoption demonstrated`,
plus the product-learning output and a recommended 9.3 direction. Phase 9.3 does not begin
automatically.

Optional, non-blocking, safe during the soak (Class A): correct the `daily-respiratory-rate` value
spec (a worker-only change plus deployment; health is passive and off every frozen surface).

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
