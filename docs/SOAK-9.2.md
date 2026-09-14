# Checkpoint 9.2 — 21-day adoption soak

**Status: OWNER-TERMINATED BEFORE MINIMUM DURATION (2026-09-14T01:53:37.600Z). NO ADOPTION
CONCLUSION IS PERMITTED.** See the termination record at the end of this file. This file
is the checkpoint's record: window, baseline, frozen definitions, monitoring method, incident ledger,
final snapshot and analysis. `docs/STATUS.md` carries only a summary, so that this file's growth does
not inflate every agent context.

Checkpoint 9.2 exists to answer one question: **with the major daily-use friction removed
(Checkpoints 8.1–9.1), does Personal OS become part of the owner's real workflow over a sustained
21-day period?** The deliverable is evidence. Usage is never manufactured, never requested at a
quota, and never inferred early.

**Relationship to Checkpoint 8.5.** The 8.5 soak was terminated by the owner after 9.1 hours of a
21-day minimum and produced **no adoption evidence** (`docs/SOAK-8.5.md`). 9.2 is a new checkpoint
with a new baseline, not a resumption, and **the two runs are never compared as equivalent
experiments**. 9.2 is the first valid long-form adoption observation.

---

## Window

Recorded first-hand. `SOAK_START` is the production database clock (`now()`) of the baseline
observation; `SOAK_END` is exactly 21 × 24 hours later. The soak does not close at "roughly three
weeks"; it closes at this instant.

| Marker | UTC | America/Chicago |
|---|---|---|
| **SOAK_START** | **`2026-09-14T01:28:10.274Z`** | `2026-09-13 20:28:10 CDT` |
| DAY_7 | `2026-09-21T01:28:10.274Z` | — |
| DAY_14 | `2026-09-28T01:28:10.274Z` | — |
| **SOAK_END** | **`2026-10-05T01:28:10.274Z`** | `2026-10-04 20:28:10 CDT` |

Anything created, completed or attempted at or after `SOAK_START` (server clock) is inside the
window.

## Entry state

| | |
|---|---|
| Branch / HEAD | `phase-9-reliability` / `902b568`, working tree clean, `origin` identical (`902b568` pushed 2026-09-13 before the baseline) |
| Migration level | **17** (`0000`–`0016`); local and production agree |
| Serving images | api and worker built from `77ea112` (release dir `personal-os-9.1-release`); web from `ca04e57` (`personal-os-8.6d-release`) — the web image was not rebuilt by 9.1, so the browser Settings screen still carries the pre-9.1 calendar-toggle behaviour |
| Rabbit R1 | `com.himal.personalos` **versionCode 13**, built from `77ea112`, installed in place 2026-09-12, `firstInstallTime` 2026-08-19 preserved |
| Containers | api / worker / web / postgres all `RestartCount=0`; api `(healthy)`; postgres up since 2026-08-30 |

---

## Frozen adoption-critical surfaces

Unless a production defect forces intervention (see *Incident classes*), the following are **not
materially changed** for the duration: notification-shade capture · the Quick Capture composer ·
capture parsing (`capture.parse`, confidence routing, confirm contract) · task creation/completion
UX · note creation · reminders (scheduling, channels, exact-alarm handling) · the Daily Brief ·
calendar behaviour relevant to daily use (Today/Agenda/month/week, occurrence complete/skip, sync
cadence) · the four Android notification channels · the Cloud Ask entry point and its privacy
contract · the Today surface · Rabbit R1 navigation on these paths.

**No major adoption-driving feature is added mid-run.** Doing so is a Class C event.

**What may continue:** backend maintenance that does not change user-visible behaviour,
documentation, tests, internal tooling, isolated infrastructure cleanup, and refactors with provably
identical behaviour. Anything that could plausibly make the app easier or harder to use daily is
deferred past `SOAK_END`. Retention windows are not altered. Migrations are not planned.

---

## Metric definitions — FROZEN AT SOAK_START

The single source of truth is `scripts/soak/soak-9.2-observe.sql`, run only through
`scripts/soak/soak-9.2-observe.sh`. The same statement produced the baseline, produces every daily
observation and will produce the Day-21 final snapshot, so the numbers are comparable by
construction. **Definitions are not edited mid-soak.** If one is found wrong, the defect is recorded
in the ledger and a *new* field is added; existing fields keep their meaning.

**Privacy contract.** Every observation contains counts, dates, timestamps, closed status tokens and
8-character id prefixes only. No note body, task title, capture text, subject, address, display
name, prompt, answer, health value, error message or log line is ever selected, printed or stored.
Log-derived counters use `grep -c` on fixed patterns and never emit a matching line.

**Window membership** is server receipt time: `created_at`, `completed_at` or `attempted_at` ≥
`SOAK_START`. **Calendar-day attribution** is `America/Chicago` (the owner's zone), using
`captured_at` for captures (the moment the owner acted, which an offline-outbox replay can deliver
later) and the action timestamp otherwise.

**Active day (frozen before the soak began).** A Chicago calendar day with **at least one** durable
product action of these kinds:

| Kind | Durable source |
|---|---|
| capture | `inbox_items` row |
| direct task creation | `tasks` row not referenced by any `inbox_items.entity_id` |
| task completion | `tasks.completed_at` with `status='done'`, or a task `occurrences` row marked `done` |
| note creation | `notes` row |
| local calendar action | a locally authored `events` row (see discriminator), or an event occurrence marked `done`/`skipped` |
| review completion | `reviews.completed_at` with `status='completed'` |
| project creation | `projects` row |
| Cloud Ask | **log-only** — an `ai.usage` line with `task: "ask"` in the api container log; folded in from the daily observer's cumulative delta and attributed to the **previous** Chicago date (the observer runs at 06:23, so the interval is mostly the prior day; the 06:23 cutoff is the accepted imprecision) |

The definition is deliberately conservative: reads (opening Today, viewing the calendar, running a
search) do **not** make an active day. They are recorded separately as log-epoch counters and are
descriptive only. `w_active_days` is the headline set; `w_daily_actions` is its per-day
**descriptive** breakdown and additionally carries `task_occurrence_skipped` and
`note_created_direct` (a note not committed from a capture), neither of which changes the set.

**Denominator.** `SOAK_START` falls mid-afternoon Chicago, so the 21 × 24 h window touches **22
Chicago calendar dates**, the first and last partial. Active days are reported as "n of 22 dates
(20 full + 2 partial)", and `w_active_days_in_window` additionally excludes any pre-window date
reached only by an offline-outbox replay of a capture made before the baseline.

**Breadth.** A capture that parses to a note produces both a `capture` and a `note_created`
action on the same day by definition (one gesture, two durable rows). The breadth analysis
therefore uses `w_notes_created_direct` / `note_created_direct` and `w_tasks_created_direct` to
say whether the notes and tasks surfaces were used *directly*, and `*_via_capture` for the
capture-fed share.

**Locally authored event discriminator.** Sync ingests an event and its `event_external_links`
row (or its `calendar_event_instances` row for a detached instance) inside one transaction, so their
`created_at` are identical. Local authoring links through a separate `POST /events/:id/link-calendar`
request, so the link's `created_at` is strictly later — or there is no link at all. Two further
guards, both found by the pre-baseline adversarial review of the observer: upstream removal
(cancellation at Google or CalDAV, or a full-sync reconcile) **deletes** the link but stamps only
`events.archived_at`, leaving `updated_at` older — whereas every local archive route stamps
`archived_at = updated_at` — so the signature `archived_at is not null and updated_at <
archived_at` marks an ingested event whose link is gone; and instance rows are matched by
occurrence slot (`local_parent_event_id`, `local_original_start_at`) rather than by the child
pointer the cancel path nulls out. Without these, a third party cancelling a meeting would have
registered as an owner action. Verified at baseline: `events_link_same_instant = 98`,
`events_link_later = 0`, matching the 98 events known to be sync-ingested.

**Measurability limits, stated up front.**

- **Notification-shade capture, the launcher shortcut and the in-app Quick Capture sheet are all
  `source: "web"`** and cannot be told apart (ADR frozen in Checkpoint 5.6; splitting them is a
  CHECK-constraint migration). Share (`share`) and push-to-talk (`ptt`) are distinguishable.
- **Search, export, Cloud Ask, Brief generation/opening and every other request count come from the
  api container log** and reset whenever that container is recreated. Each observation records the
  container's `StartedAt` so a reset is visible, never silent.
- **`GET /briefs/current` is fetched by the Today screen**, so it is a Today-open proxy, not a
  "brief read" signal. Brief *generation* is durable (`ai_daily_briefs.generated_at`) but the table
  upserts one row per date, so it counts generation *days*, not attempts.
- **pg-boss job rows live 14 days and are deleted 7 days later**, so failed/retry/dead-letter job
  counts are only meaningful in the daily observation; the durable failure record is
  `inbox_items.status='failed'` and `notification_dispatch_log`.
- **Reminder *delivery* is not observable server-side** (local alarms fire on the device). What is
  observable: `tasks_live_future_reminders` and the device's primary/eligibility state.
- **`w_event_occurrences_done/skipped` are structurally zero from the versionCode 13 client**: no
  event surface (Today, Agenda, month/week) carries an occurrence id or offers complete/skip for
  events; those actions exist only for tasks. The one recurring-calendar action the client does
  offer — *Cancel this occurrence* on the event detail screen — deletes the occurrence row and
  leaves no durable trace, so it is counted **log-epoch only** (`api_log.events_cancel_occurrence_post`),
  alongside detach (`events_detach_post`, cross-checkable against the child `events` row).
- **`w_tasks_dropped_of_window_created` is exact only for tasks created in the window.** `tasks`
  has no drop timestamp and `updated_at` is bumped by every later edit, so an all-population
  "dropped in window" count is not derivable and is not reported.
- **Since-start pg-boss counters in `final.json` see only the trailing ~7 days** (pg-boss deletes
  job rows 7 days after completion). Window-level failed/dead-letter figures are therefore taken
  as the per-queue **maximum across every daily observation line**, never from the final snapshot
  alone. `ptt.transcribe.dead`, `notifications.dispatch.dead` and the calendar `.dead` queues have
  no durable fallback record; `capture.parse.dead` does (`inbox_items.status='failed'`).

**Completion ratio** = `w_tasks_completed_of_window_created / w_tasks_created` — both drawn from
the window-created population, so it is bounded in [0, 1]. `w_tasks_completed` (completions of any
task, including the pre-window backlog) is reported separately as a count. Tasks created in the
final days of the window have had little time to be completed; that survivorship caveat is stated
with the ratio rather than corrected for.

---

## Baseline — `2026-09-14T01:28:10.274Z`

Collected first-hand from production over Tailscale with the frozen observer (`baseline` mode).
**These values are the starting point; they are not adoption evidence.**

### Content and adoption baseline (all time)

| Measure | Value |
|---|---|
| `inbox_items` total | **11** |
| captures by source | `web` 6 · `ptt` 4 · `share` 1 (no `siri`, no `assistant`) |
| captures by status | `parsed` 7 · `confirmed` 1 · `needs_confirm` 3 · `failed` 0 · `pending` 0 |
| captures by entity type | `note` 4 · `task` 4 · none 3 |
| `tasks` total / by status / archived | **7** / `active` 3 · `inbox` 2 · `done` 2 · `dropped` 0 / 5 |
| open unarchived tasks | **0** (every open-status task is archived) |
| recurring tasks / with `remind_at` / live future reminders | 1 / 3 / **0** |
| `notes` total / archived | **6** / 4 |
| `projects` total | **0** |
| `events` total / linked / archived | **98** / 98 / 0 |
| `occurrences` | 1 (`task`, `scheduled`, lazy — parent archived, does not surface) |
| `reviews` | 1 (`daily`, `completed`) |
| Daily Briefs (rows / latest date / last generated) | 2 rows · latest `2026-09-11` · last generated 2026-09-11T22:28Z |
| Cloud Ask | **OFF** — no `ask` row in `ai_task_routes` (`ask_route_present = false`); Ask usage in the current api log epoch: 0 |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` (0 other) |
| devices total / active / primary active / with push token | 2 / 1 / 1 / 1 — the single active device is the Rabbit R1: primary, reminder-eligible, push token present, last seen 2026-09-14T01:28Z |

### System health baseline

| Measure | Value |
|---|---|
| `GET /health` | `status ok` · `db connected` · `worker.stale false` |
| worker heartbeat | `ok`, age 50 s |
| pg-boss jobs by state | `completed` 64,051 (no `failed`, `retry`, `active` or `created`-and-due rows) |
| monitor | 5 active targets · **0 incidents ever, 0 open** · 3,581 `up` / 0 `down` checks in the trailing 24 h · 10 pg-boss schedules · nightly crons last completed: `occurrences.expand-window` 2026-09-13T03:00Z, `retention.cleanup` 2026-09-13T04:00Z (7 tables ok, 0 failed, 6 rows deleted), `mail.digest.cron` 2026-09-13T12:00Z |
| Google Calendar | connection `a0cc5563` google **active**, no error · 2 of 5 calendars enabled · last success 2026-09-14T01:15Z · 98 events, 98 links, `events_link_same_instant` 98 / `events_link_later` 0 |
| Gmail | connection `6d4cb26c` gmail **active**, no error · cursor present, `needs_full_resync false` · last success 2026-09-14T01:15Z · 806 messages · 13 digests, latest `2026-09-13` |
| Google Health | connection `ac3d47ad` google_health **active**, no error · 19 streams, **17 enabled** (see caveats) · last success 2026-09-14T01:00Z · 221 daily-metric rows (212 with data) · 9 sessions |
| retention.cleanup | last `retention.cleanup.completed` 2026-09-13T04:00:07Z — `tablesOk 7`, `tablesFailed 0`, `totalDeleted 6` |
| notification dispatch log by producer | all `accepted`, 0 `failed`: `mail-digest` 13 · `confirmation` 4 · `health-sync-alert` 2 · `alert` 1 · `test` 2 · other 1 (the 9.1 smoke key) |
| api log epoch (since `2026-09-13T01:46:41Z`) | 14,544 lines, 0 error, 0 warn · `/search` 0 · `/export` 0 · Ask 0 answered / 0 failed · `POST /briefs` 0 · `GET /briefs/current` 5 · `GET /today` 5 · `POST /capture` 1 · every other write route 0 |
| worker log epoch (since `2026-09-13T01:47:01Z`) | 111 lines, 0 error, 4 warn (the 9.0/9.1 acceptance exercises) · 0 dead-lettered · 0 `capture.parse.failed` · 0 `monitor.incident` · 1 `ai.usage` |

Raw baseline: `~/.personal-os-soak/9.2/baseline.json` on the development machine (outside the
repository, mode 700; counts only).

### Pre-existing caveats recorded at baseline

- **Google Health `daily-respiratory-rate` is breaker-disabled** (`sync_enabled = false`,
  `capability_status = provider_error`) after five `value_shape_violation LEAF_MISSING` hot runs
  between 2026-09-13T01:00Z and 05:00Z — first real data meeting a still-unobserved value spec,
  exactly the failure mode Checkpoint 9.0 documented for the three specs it corrected blind. The
  breaker behaved as designed and one occurrence-scoped alert was dispatched
  (`health-sync-alert:…:breaker:daily-respiratory-rate:2026-09-13`, accepted). **Class A** — health
  is passive (ADR-046) and not on any adoption-critical surface. Fixing it is a worker spec
  correction plus a deployment and may be done as unrelated maintenance during the soak, or after.
  `daily-heart-rate-variability` (corrected in 9.0) is syncing normally.
- `heart-rate-intraday` remains deliberately disabled (F5 deferred acceptance debt).
- `daily-sleep-temperature-derivations` still needs an owner product decision (9.0) and will trip
  its breaker on first data. Class A.
- **3** inbox items sit in `needs_confirm`, of which all 3 store
  the `unclear` tool call and therefore cannot be confirmed in-app (409 by design, ADR-060). They
  keep Today's inbox-attention counter permanently non-zero — the 8.5 friction item, still open.
  Recorded so that a persistent counter is not misread as new usage.
- The web image was not rebuilt by 9.1 (see *Entry state*); the Rabbit R1 is the daily-driver
  client and carries the fix.
- Known non-blocking debt is carried unchanged and is **not** soak work: D1e; the
  sleep-temperature spec; the narrow capture-shortcut repost race; unpaired buffered-tap expiry; the
  generate-lazy successor seed path; the `bossReady` silent-loss gap; event text unbounded at
  write; the literal-regex monitor URL guard; monitoring under-sampling; the `EXPO_TOKEN` in an
  ignored log file.

---

## Monitoring method

**Daily, read-only, automated where the environment allows it.** No analytics SDK, no telemetry,
no new production infrastructure.

1. **Observer:** `scripts/soak/soak-9.2-observe.sh observe` — one SQL statement over SSH, container
   inspection, `GET /health`, and `grep -c` log counters. Appends one JSON line to
   `~/.personal-os-soak/9.2/observations.jsonl` (outside the repo). A failed run appends an
   `ok:false` line with a short operator reason so a gap is visible rather than silent; the
   observer defaults `SOAK_START` from its own `baseline.json`, so an unattended run never depends
   on the scheduler's environment.
2. **Check:** `scripts/soak/soak-9.2-observe.sh check` evaluates the latest line and prints `GREEN`,
   or one `RED`/`YELLOW`/`INFO` line per condition. Cumulative since-start counters alert on their
   **delta versus the previous observation**, so one event does not re-alarm for the remaining
   days; standing counts print once as `INFO`. RED means production or soak validity is
   threatened: the observation itself failed or is > 26 h old; health not `ok`, DB not connected,
   worker stale or heartbeat > 300 s; migration count ≠ 17; a container not running or with
   `RestartCount > 0`; a new pg-boss failure or dead-letter arrival; jobs due > 30 min unstarted or
   active > 30 min; pg-boss schedule count ≠ 10, or `retention.cleanup` / `occurrences.expand-window`
   last completed > 26 h ago (from pg-boss's own history, not the log epoch); an open incident; the
   monitor lane producing < 1,000 checks in 24 h; an integration in `needs_reauth`/`revoked`
   (owner-initiated `disconnected` is not RED); calendar or mail last success > 3 h old, health >
   6 h; `health_streams_enabled` below baseline (a breaker or scope disabled a stream); a new
   capture in `status='failed'`, or any capture pending > 15 min (the API-stored-but-never-enqueued
   loss no job can see); a new failed push dispatch (dead token); no active primary device, primary
   not reminder-eligible, or no device holding a push token. YELLOW is informational: a container
   recreated (log-epoch reset), an incident opened and resolved, a `last_sync_error` on an active
   connection, new failed sync runs, a mail cursor expiry (designed recovery), a new alert-class
   push, a device-count change versus baseline, new error-level log lines.
3. **Schedule:** a desktop scheduled task (`soak-9-2-daily-observer`) runs the observer and check
   once a day at 06:23 America/Chicago — after the 03:00Z occurrence sweep and 04:00Z retention run,
   before the owner's day — and **notifies only on RED** (one push, under 200 characters) or when
   the observer itself cannot run. GREEN and YELLOW are logged locally, never pushed. A second,
   one-time task fires at `SOAK_END`, takes the `final` snapshot and notifies that the analysis is
   ready to run. **Caveat recorded:** these tasks run only while the Claude desktop app is open on
   the development machine; a missed day runs on next launch and the gap is visible in
   `observations.jsonl`. Every soak metric is recomputed from durable production data at Day 21
   regardless, so a missed daily run costs only that day's non-durable pg-boss/log readings.
4. **Production mutations remain serialized and manual.** The observer never writes. Any fix is
   classified first (below), by parallel adversarial review when the class is uncertain.

**A health check is never a reason to deploy.**

---

## Incident classes

| Class | Meaning | Effect on the soak |
|---|---|---|
| **A** | No soak impact — unrelated backend issue, cosmetic issue outside the daily workflow, isolated non-adoption feature | Fix normally. No reset. |
| **B** | Degraded but interpretable — capture briefly unavailable, reminder delivery interrupted, a daily-use calendar path temporarily broken | Record exact downtime, user impact, fix, and whether observations stay interpretable. No automatic reset. |
| **C** | Experiment-invalidating — core app unusable for a substantial interval, capture/task workflow fundamentally unavailable, user data lost, baseline or instrumentation invalid, a major adoption-driving feature introduced mid-run | Ordinarily the only class that restarts the 21 days. Decided only after parallel adversarial assessment. |

## Incident ledger

Format: `DATE (UTC) · CLASS · WHAT · DOWNTIME · USER IMPACT · FIX · INTERPRETABLE?`. **No private
content is ever recorded here.**

| Date | Class | What | Downtime | User impact | Fix | Interpretable? |
|---|---|---|---|---|---|---|
| 2026-09-13 (pre-start) | A | `daily-respiratory-rate` health stream breaker-disabled on first real data (spec LEAF_MISSING) | none (passive data) | none on daily workflow | deferred; may be corrected as unrelated maintenance | yes |

## Observation ledger

Format: `DATE · CATEGORY · OBSERVATION · ACTION`. Categories: adoption · friction · reliability ·
security · data_quality · UI_UX · missing_capability · unexpected_usage · abandoned_workflow.
Interim rows are **descriptive only** — counts, uptime, health, observed usage, incidents. No row
may say adoption passed or failed, that the app is or is not habitual, or that usage is sufficient
or insufficient, before `SOAK_END`.

| Date | Category | Observation | Action |
|---|---|---|---|
| 2026-09-13 | adoption | Baseline recorded (above). The user-authored core is small against the integrations' data, as at 8.5. This is the starting point, not a finding. | WATCH |
| 2026-09-13 | data_quality | Shade/launcher/Quick Capture captures are indistinguishable (`web`); share and PTT are. Recorded before the soak so it is not rediscovered. | NO_ACTION |
| 2026-09-13 | reliability | Log-epoch counters (search, export, Ask, brief, request counts) reset on container recreation; each observation records the epoch start. | WATCH |

---

## Final snapshot — not before `2026-10-05T01:28:10.274Z`

*(Empty until the boundary. The `final` observation is compared against the baseline using the
identical definitions above.)*

## Analysis — not before `2026-10-05T01:28:10.274Z`

Dimensions, fixed now: **frequency** (active days of 21, and their distribution across weeks 1/2/3),
**breadth** (which of capture / tasks / notes / calendar / brief / Ask / reviews were used),
**follow-through** (captures acted on, tasks completed, downstream behaviour), **persistence**
(usage in weeks 2 and 3), **friction signals** (abandoned workflows, incidents), **reliability**
(availability when needed). Temporal distribution is examined explicitly: a high total concentrated
in one or two days is not repeated organic use. No numeric threshold is chosen or moved after
seeing the data.

Outcome vocabulary, fixed now: `meaningful adoption demonstrated` · `mixed / inconclusive adoption`
· `weak adoption demonstrated`. Product-learning output separates **direct evidence**,
**interpretation** and **hypothesis**, and never treats absence of usage as proof a feature has no
value without context.

## Conclusion — not before `2026-10-05T01:28:10.274Z`

*(Empty.)*

---

## TERMINATION RECORD — 2026-09-14T01:53:37.600Z (2026-09-13 20:53 CDT)

**CHECKPOINT 9.2 OWNER-TERMINATED BEFORE MINIMUM DURATION — NO ADOPTION CONCLUSION.**

The owner elected to continue full Personal OS development immediately rather than hold the
adoption-critical surfaces frozen for 21 days. **This is an intentional product/development-priority
decision, not a technical failure and not a failed checkpoint.** Every health signal was GREEN at
termination; no incident occurred; no code was deployed; no production write was made. The record
follows the same discipline as the terminated 8.5 soak (`docs/SOAK-8.5.md`).

| | |
|---|---|
| SOAK_START | `2026-09-14T01:28:10.274Z` (2026-09-13 20:28:10 CDT) |
| Intended SOAK_END | `2026-10-05T01:28:10.274Z` (2026-10-04 20:28:10 CDT) |
| **Actual termination** | **`2026-09-14T01:53:37.600Z`** — the production database clock of the final read-only observation (2026-09-13 20:53:37 CDT) |
| **Elapsed** | **25 min 27 s (0.018 days)** |
| Minimum valid window | 21 full days |
| **Fraction of minimum reached** | **0.08 %** |
| Milestones reached | none — DAY_7, DAY_14 and SOAK_END were all unreached |
| Reason | owner chose development velocity over completing the observation window |

### What may NOT be claimed from this checkpoint

Hard prohibitions on every future document:

- Adoption may not be classified as successful, failed, weak, mixed, meaningful, insufficient, or
  anything else. The three fixed outcome labels in *Analysis* above are **void** for 9.2.
- The partial window may never be reinterpreted as valid 21-day evidence, in whole or in part.
- **Never write "the 9.2 soak showed…"** — it observed 25 minutes, overnight, on a Sunday.
- 9.2 is not to be compared to 8.5 as an equivalent experiment; both are terminated runs with no
  adoption evidence.

### Observations collected (descriptive only, preserved verbatim)

Two read-only observation lines exist, both `ok:true`, both `GREEN` on every check condition:
the baseline at `01:28:10Z` and the termination observation at `01:53:37Z`. Between them, **zero
window activity of any kind** was recorded (0 captures, 0 tasks created or completed, 0 notes,
0 active days; 0 search/export/Ask requests; the api log epoch unchanged at 5 `GET /today`). That
is what 25 overnight minutes look like on any system. It means nothing.

Files, outside the repository, mode 700 directory, preserved unchanged:
`~/.personal-os-soak/9.2/baseline.json` (SHA-256 `18c52707…`, mode 444) and
`~/.personal-os-soak/9.2/observations.jsonl` (2 lines, SHA-256 `7cf14738…`; a read-only copy
`observations.jsonl.terminated-2026-09-14T01-53Z` sits beside it). No `daily.log`, `alerts.log` or
`final.json` was ever written.

### Observer shutdown

Both desktop scheduled tasks — `soak-9-2-daily-observer` (daily 06:23) and
`soak-9-2-day-21-final-snapshot` (one-shot at the void boundary) — were **disabled** at termination,
with their descriptions marked accordingly, and the daily task's single test run (which had parked on
an unapproved Bash permission prompt and never executed the observer) was stopped. The observer
scripts `scripts/soak/soak-9.2-observe.{sql,sh}` remain in the repository as reusable, reviewed
tooling for any future soak; they were never run by automation.

### What this checkpoint DID produce, and what remains usable

- A **reviewed, privacy-safe, read-only observer** with frozen definitions (active day, local-event
  discriminator, measurability limits) that a future soak can reuse unchanged — the pre-baseline
  adversarial review closed five real defects that would otherwise have contaminated any run.
- A **dated baseline of production on 2026-09-13**, valid as historical measurement, never as
  adoption evidence.
- One reliability fact worth keeping: `daily-respiratory-rate` was breaker-disabled on first real
  data before the soak began (Class A; carried into Phase 9 development as ordinary work).

### Freeze status

**The adoption-critical feature freeze is LIFTED as of 2026-09-14T01:53:37.600Z.** Development
continues normally across all modules under the standing guardrails (privacy boundaries, production
rollback, migration discipline, ADR invariants, durable failure semantics, full gates, serialized
production mutations).

**Freeze exceptions during the soak: 0.** No code was written, deployed or run against production
except the read-only observer.

### Accepted consequence

Ongoing development contaminates any adoption measurement taken from here. The owner accepts this
deliberately. Adoption may be reassessed later, once the product has materially matured, as a **new
checkpoint with a new baseline** — not a resumption of 9.2 and not a resumption of 8.5.
