# Phase 9 — Reliability, daily-use and read-only intelligence (CLOSED 2026-09-15, ADR-069)

> **Closed-phase record, verbatim.** This file is the Phase 9 checkpoint record (9.0–9.8) exactly as
> it stood in `docs/STATUS.md` at commit `ae864f4` (the Phase 10.1C record), partitioned out on
> 2026-09-16 when Phase 9 was closed under ADR-069. **Nothing below the rule was reworded, reordered
> or dropped** — SHA-256 of the block below is
> `5c4635a19be9cd04def37b24e2b59bfb5e8b0551723e69df0ac4389e2d0a3006` (1,238 lines), and the same block is byte-identical
> in the pre-partition `docs/STATUS.md`. Phase 9's companion record for the owner-terminated
> adoption soak is `docs/SOAK-9.2.md`; its decisions are ADR-062 … ADR-067 and its closure is ADR-069
> (`docs/decisions/`). The nine "Last verification" entries Phase 9 accumulated in `docs/STATUS.md`
> are archived verbatim in `docs/history/superseded-present-state-2026-09-16.md`.
>
> Per `AGENTS.md`, files under `docs/history/` are never edited.

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
