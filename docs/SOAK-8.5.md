# Checkpoint 8.5 — Instrumented daily-driver soak

**Status: TERMINATED BY OWNER 2026-09-04. Adoption soak DEFERRED.** This file is the checkpoint's working record: the window, the
baseline, the health-check readings and the observation ledger. `docs/STATUS.md` carries only the
summary. Closed-phase material never goes here; this file is deleted into `docs/history/` when
Phase 8 closes.

Checkpoint 8.5 exists to answer one question: **does Personal OS become genuinely useful when
development stops?** The deliverable is evidence, not features.

---

## Window

Recorded first-hand on the development machine, `America/Chicago`.

| Marker | Date (America/Chicago) | Notes |
|---|---|---|
| **SOAK_START** | **2026-09-03 15:07 CDT** (`2026-09-03T20:07:40Z`) | baseline taken at this instant |
| DAY_7 | 2026-09-10 | interim report |
| DAY_14 | 2026-09-17 | interim report |
| DAY_21 | 2026-09-24 | **minimum valid close** — full A–H review |
| DAY_28 | 2026-10-01 | **preferred close** |

**Minimum valid observation window is 21 full days.** The soak is not closed early because the
first week looks good. If the Day-21 evidence is weak, it continues to Day 28.

**Entry state:** branch `phase-8-consolidation`, HEAD `9538f66`, working tree clean, local and
`origin` identical. Migration level **16**. Rabbit R1 on **versionCode 10**.

---

## Freeze

Hard feature freeze for the duration. No new integrations, no embeddings, no semantic search, no Ask
lane, no AI chat, no finance, no new Calendar capability, no new search entities, no export UI, no
further capture front doors, no notification-shade reply, no automation engine, no dashboard
redesign, no new tables, no migrations, no speculative polish. Phase 9 planning does not begin
during the soak.

**The only permitted interruptions** are P0 security/privacy exposure, P0 data loss or corruption,
P1 a core existing flow broken, and P1 a severe silent failure. Everything else is recorded and
deferred — including friction that is merely annoying.

Every freeze exception must be logged in the ledger below with its severity and justification, and
counted in the closure report.

---

## Baseline — 2026-09-03T20:07Z

Collected first-hand from production over Tailscale using **existing observability only**. No
analytics code was added, no telemetry introduced, and **no user-authored content was read or
recorded** — counts, timestamps and structural metrics only.

### Core content

| Table | Total | Archived | Notes |
|---|---:|---:|---|
| `projects` | **0** | 0 | none have ever been created |
| `tasks` | **5** | 3 | 2 active, 2 done, 1 inbox |
| `notes` | **4** | 2 | |
| `inbox_items` | **8** | — | |
| `events` | **98** | 0 | all from the primary calendar, enabled at 8.2 |
| `occurrences` | **1** | — | lazy, parent archived — does **not** surface (verified) |
| `reviews` | **1** | — | 1 completed |

The user-authored core is essentially empty. That is the measurement Phase 8 was built around and it
is the baseline the soak moves against.

### Capture

| Dimension | Value |
|---|---|
| By source | `web` 4 · `ptt` 3 · `share` 1 |
| By status | `parsed` 5 · `needs_confirm` 2 · `confirmed` 1 |
| By entity type | `note` 3 · `task` 3 · none 2 |
| Audio retained | 0 of 3 PTT (hourly orphan sweep) |
| Parser: completed jobs | 5 |
| Parser: failed jobs | **2** — the known 8.4 `unclear` pair, `retry_count 5/5` |

`share` = 1 is the single 8.4 acceptance capture. **The launcher shortcut has no distinguishing
source** — it produces `web`, identical to in-app Quick Capture — so launcher-vs-Quick-Capture split
is **NOT MEASURABLE** without a schema change, which the freeze forbids. Share-vs-everything-else is
measurable.

### Reminders

| Measure | Value |
|---|---|
| Tasks with `remind_at` | 3 |
| **Live future reminders** | **0** — 2 are `done` and past, 1 is the archived 8.4 test task |
| Scheduled alarms on device | **0** — correct, given the above |
| Primary device | `c6c0b43d` android, PRIMARY, not revoked, notifications enabled, push token present |
| `POST_NOTIFICATIONS` | granted |
| Exact-alarm appop | `allow` |
| Notification dispatches | 9 rows, **all `accepted`, 0 failed** |

`notify_reminders = false` on the primary device is **not** a defect: it is intentionally unwired
(`apps/worker/src/jobs/notifications-dispatch.ts:32`), and the local scheduling gate in
`use-reminder-reconciliation.ts` checks the same three conditions the Today banner checks — revoked,
notifications disabled, not primary. Reminders will schedule. Checked because the baseline reading
looked alarming; recording the negative result so it is not re-investigated.

**The reminder path is built and proven but has zero real use.** That is an adoption fact, not a bug.

### Search / export

| Measure | Value |
|---|---|
| `/search` requests in current API log | 4 |
| `/export` requests in current API log | 1 |

**Measurable, with a stated limitation.** Frequency is countable from Fastify's request log without
retaining query text (`grep -c`, never printing the line). But the log begins at container start
(`2026-09-03T06:28:42Z`) and the driver is `local` with default rotation, so **any API recreation
resets the count**. Counts are therefore per-log-epoch, not cumulative, and each health check records
the container start time so a reset is visible rather than silent. Query *content* is deliberately
never read — which also means search *quality* is not measurable, only frequency.

No telemetry was added for this, per the checkpoint's instruction.

### Calendar

Connection `a0cc5563` google **active**, no error. **2 of 5 calendars** sync-enabled. 98 events (29
all-day, 2 recurring), 98 external links — 1:1, no orphans. Last successful sync `20:00:14Z`.

### Mail

Connection `6d4cb26c` gmail **active**, no error, cursor present, `needs_full_resync = false`,
**0 cursor expirations**. 567 messages spanning 2026-07-26 → 2026-09-03. Sync runs **200 succeeded,
0 failed**. 3 digests, latest 2026-09-03. Digest notifications: 3, all accepted.

### Health

Connection `ac3d47ad` google_health **active**, no error. 19 streams, 18 enabled. 161 daily-metric
rows (138 with data, 5 distinct metrics) covering 2026-07-26 → 2026-09-03. 0 sessions, 0 observations.
Sync runs **1,854 succeeded, 1 failed** — the single failure is the known `auth_permanent` of
2026-09-01T00:00:06Z (ADR-051b), already remediated.

### Monitoring

5 targets, all enabled. **7,577 checks: 7,576 up, 1 down. 0 incidents, ever.** The single `down` is
`api-internal-health` at 2026-09-02T23:27:19Z, during a deployment recreation; below the
3-consecutive threshold, so correctly no incident. Worker heartbeat fresh (51 s).

Under-sampling persists as recorded debt: over the trailing 24 h, `api-internal-health` 1,328 of a
nominal 1,440 (92.2%), `worker-heartbeat` 1,438 (99.9%), the three 300 s targets 277 of 288 (96.2%).

### System

| Measure | Value |
|---|---|
| Migration level | **16**, `0016` absent |
| Containers | api / web / worker / postgres — **all `restarts=0`**, API `(healthy)` |
| `GET /health` | `status ok`, `db connected`, `worker.stale false` |
| Postgres host port | **none published** |
| pg-boss non-completed jobs, all time | **3**: 2 × `capture.parse` (known 8.4 pair), 1 × `calendar.google.sync-calendar` (pre-deployment 2026-08-31) |
| AI task routes | all 4 present with a primary model |
| Daily briefs | 1, latest 2026-09-02 |
| `ai.usage` events in worker log | 1 (mail digest lane only — Brief lane uninstrumented, known debt) |

---

## Health-check cadence

Lightweight, **read-only**, at Day 1 / 7 / 14 / 21 / 28. Each verifies: Gmail, Calendar and Health
active; monitoring healthy; worker heartbeat fresh; migration level unchanged; container restart
counts; failed and retried jobs; `capture.parse` failures; reminder delivery health; new incidents;
Rabbit versionCode; branch and remote durability.

**A health check is never a reason to deploy.**

### Readings

| Day | Date | Result |
|---|---|---|
| Day 0 (baseline) | 2026-09-03 15:07 CDT | All green. Recorded above. |
| Day 0 spot check | 2026-09-03 18:22 CDT | **All green, zero deltas.** Every content, capture, job and integration figure identical to baseline; migration 16; all containers `restarts=0`; 0 incidents; heartbeat 38 s. Monitoring advanced 7,576 → 8,063 up checks, as expected. `/search` held at 4 and `/export` at 1 in the same log epoch, confirming the counter is stable. **No adoption inference drawn from a 3h15m window.** |

---

## Observation ledger

Format: `DATE · CATEGORY · OBSERVATION · SEVERITY · ACTION`.
Categories: adoption · friction · reliability · security · data_quality · UI_UX · missing_capability ·
unexpected_usage · abandoned_workflow.
Severity: P0 · P1 · P2 · P3 · OBSERVATION. Action: FIX_NOW · DEFER · WATCH · PHASE_9_CANDIDATE · NO_ACTION.

**No private content is ever recorded here** — no capture text, no titles, no subjects, no addresses.

| Date | Category | Observation | Severity | Action |
|---|---|---|---|---|
| 2026-09-03 | adoption | Baseline: 0 projects, 2 active tasks, 4 notes, 8 captures against 98 events / 567 mail / 161 health rows. Integrations hold data; the authored core does not. This is the thesis under test. | OBSERVATION | WATCH |
| 2026-09-03 | adoption | 0 live future reminders exist. The reminder path is proven but unused. | OBSERVATION | WATCH |
| 2026-09-03 | friction | Today permanently shows `inbox_attention_total = 2` from the two `unclear` captures that can never be confirmed in-app (409 by design, 8.4). A counter that never clears trains the owner to ignore it, which will bias the soak. Owner can clear via `corrected_tool_call`; there is no in-app route. | P2 | DEFER |
| 2026-09-03 | data_quality | Launcher-shortcut captures are indistinguishable from Quick Capture — both are `source: "web"`. Splitting them needs a CHECK-constraint migration, which the freeze forbids. Share is measurable; launcher is not. | OBSERVATION | DEFER |
| 2026-09-03 | reliability | Search-usage counting resets on any API container recreation, so counts are per-log-epoch. Container start time is recorded at each check so a reset is visible. | OBSERVATION | WATCH |
| 2026-09-03 | reliability | Checked and cleared: `notify_reminders = false` on the primary device does not block local scheduling — the column is intentionally unwired. Negative result recorded so it is not re-investigated. | OBSERVATION | NO_ACTION |
| 2026-09-03 | data_quality | Checked and cleared: the archived 8.4 smoke task's open past-dated occurrence does **not** surface on Today (`overdue_total = 0`). Read model filters archived parents correctly. | OBSERVATION | NO_ACTION |
| 2026-09-03 | reliability | The auto-loaded doc set has grown 169,578 → **255,675 bytes** (~64k tokens) since 8.0's compaction, +51%, almost all of it `docs/STATUS.md` (86k → 114k). Four more soak reports are due. **Mitigation adopted now rather than after it hurts:** every Day-7/14/21/28 reading and every ledger row goes in this file, which `CLAUDE.md` does **not** import; `docs/STATUS.md` gets a summary only. | OBSERVATION | WATCH |

---

## Known debt carried into the soak — do not fix by default

Carried forward unchanged. These are **not** soak work and are not absorbed unless real usage raises
their severity to P0/P1:

notification-shade direct reply deferred · `capture.parse` has no dead-letter queue · Kotlin only
compiled through EAS · share draft not durable until submit · pickers Android-only · `events/new.tsx`
still hand-typed · calendar event text unbounded at write · calendar `summary` stores the ID not the
display name · zero-length all-day event expressible · Today multi-day timed bucketing · `done`
occurrence presentation ambiguity · `/search` `q` appears in `req.url` logs · events and projects not
searchable · no client export affordance · Brief lane emits no `ai.usage` · alerts share the
`reminders` notification channel · configuration/key durability open
(`CREDENTIALS_ENCRYPTION_KEY` has no version, KDF or rotation path) · retention windows undecided ·
monitoring under-samples every probing target · worker log redactor fires on an intentionally-logged
field · a live `EXPO_TOKEN` sits in a mode-644 ignored file · tailnet suffix embedded in commit
metadata.

---

## Closure

The checkpoint closes on the 30-point report specified in the 8.5 brief, comparing baseline to final
across content, capture, reminders, search, Today/Agenda, each integration, reliability, incidents,
job failures, freeze exceptions, defects, friction, repeatedly-desired features, features never
missed, and the capture-first vs integration-first strategic fork — plus the Ask Personal OS and
retrieval/embeddings recommendations.

Neither Ask Personal OS nor embeddings is built during 8.5. pgvector remains excluded from Phase 8.
The privacy posture remains local retrieval → bounded cloud reasoning.

**Checkpoint 8.6 does not begin automatically.**


---

## TERMINATION RECORD — 2026-09-04 00:04 CDT

**CHECKPOINT 8.5 TERMINATED BY OWNER — ADOPTION SOAK DEFERRED.**

The owner elected to continue normal Personal OS development rather than hold a 3–4 week feature
freeze. **This is an intentional product-management decision, not a technical failure and not a
failed checkpoint.** Nothing in the system misbehaved; every health signal was green at termination.

### Duration — and why it disqualifies every adoption conclusion

| | |
|---|---|
| SOAK_START | 2026-09-03 15:07 CDT |
| TERMINATED | 2026-09-04 00:04 CDT |
| **Elapsed** | **9.1 hours (0.38 days)** |
| Minimum valid window | 21 full days |
| **Fraction of minimum reached** | **1.8%** |
| Milestones reached | **none** — DAY_7, DAY_14, DAY_21 and DAY_28 were all unreached |

Nine hours, most of them overnight, is not an observation window. It is a rounding error against
the 21-day minimum.

### What may NOT be claimed from this checkpoint

These are hard prohibitions on every future document, not cautions:

- **No capture-first conclusion may be claimed.** The evidence for Strategic Fork A does not exist.
- **No integration-first conclusion may be claimed.** The evidence for Strategic Fork B does not exist.
- **No inference about any feature's usefulness may be presented as soak evidence** — not for
  Ask Personal OS, not for search, not for reminders, not for the share sheet or the launcher
  shortcut, not for the digest.
- **The strategic fork is UNRESOLVED.** Not "leaning A", not "probably C". Unresolved.
- **The zero organic usage observed in the window means NOTHING.** It is what nine mostly-overnight
  hours look like on any system. It is not disengagement, and reading it as such would be a
  fabrication in the opposite direction.
- **Never write "the soak showed…"**, because it did not show anything.

### What this checkpoint DID produce, and what remains usable

The baseline above is **real, first-hand, privacy-safe measurement of production on 2026-09-03**,
and it stays valid as historical data regardless of the soak's termination. It is a dated snapshot,
not adoption evidence — a distinction that must survive into every later document.

Also durable: the two negative results the baseline forced (`notify_reminders` does not gate local
scheduling; the archived smoke task's occurrence does not leak onto Today), and the two
measurability limits discovered (launcher captures are indistinguishable from Quick Capture; search
frequency is per-log-epoch). Those are properties of the system, not of the soak, so they survive.

### Freeze status

**The feature freeze is LIFTED as of 2026-09-04.** Development may continue normally across all
modules.

**Freeze exceptions during the soak: 0.** No code was written, no deployment occurred, no production
write was made, and no migration was created. Three documentation-only commits exist: `d32b376`,
`76ebb24`, `3bf03db`.

### Accepted consequence

Ongoing development will contaminate any adoption measurement taken from here. The owner accepts
this deliberately. **Phase 8 therefore does NOT use soak evidence as a gating dependency**, and
every subsequent decision must separate **VERIFIED TECHNICAL EVIDENCE** from **UNVERIFIED PRODUCT
HYPOTHESIS**.

A fresh soak may be run against a future stable release if the owner wants adoption evidence. That
would be a new checkpoint with a new baseline, not a resumption of this one.
