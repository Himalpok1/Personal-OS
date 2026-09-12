# Phase 8 — Closeout record and Phase 9 starting brief

**Date:** 2026-09-12 · **Decision:** ADR-061 · **Branch:** `phase-8-consolidation` · **Starting HEAD:** `81662ff`
**Verbatim checkpoint record:** `docs/history/phase-8.md` (partitioned from `docs/STATUS.md`, SHA-256 `b72fe7f6…`, byte-exact)

This document is the single closure record for Phase 8 (Consolidation & adoption, ADR-056). It
records the evidence the closure rests on, the final repository and production baseline, the
classification of every remaining known item, and the starting brief for Phase 9. **It does not
approve Phase 9.**

---

## 1. Closure decision

**Phase 8 is CLOSED.** Every closure criterion was verified first-hand on 2026-09-12 by six parallel
read-only audit lanes (repository consistency, production state, debt classification, quality
baseline, adversarial phase-close review, Phase 9 inputs), and every load-bearing finding was
re-checked by the integrator before being acted on.

| Criterion | Result |
|---|---|
| All approved checkpoints implemented or intentionally terminated/deferred by owner decision | **Met.** 8.0–8.4 complete; 8.5 terminated by the owner after 9.1 h (no adoption conclusion permitted); 8.6 decision gate → 8.6A/B/C/D all accepted. |
| All 8.6 sub-checkpoints accepted | **Met.** Each has a live production acceptance record in `docs/history/phase-8.md`. |
| Production healthy | **Met.** See §3. |
| Repository clean and reproducible | **Met.** See §2. |
| No known blocker invalidates the Phase 8 product contract | **Met.** The adversarial lane found no blocker; its material findings are all documentation-, scope- or debt-class and are recorded in §5 and ADR-061. |
| Remaining debt explicitly classified and non-blocking | **Met.** §5. |
| Documentation matches reality | **Met after reconciliation.** Six stale present-tense statements and seven stale ledger entries were corrected in this closeout (§6). |

**Ruling on the one contested item.** The debt lane proposed `occurrences.generate-lazy`'s missing
dead-letter queue as a failure-visibility violation. It is a real reliability defect (a completed
completion-anchored task whose successor job exhausts five retries silently never spawns it, with
`console.warn`-only logging). It does **not** block closure: Checkpoint 8.6A was owner-scoped to four
named items, this defect was identified by the 8.6 decision gate and carried explicitly as "still
flagged, still not absorbed" through 8.6C, so it is a known deferred item rather than an accepted
guarantee that current source violates. It is the **recommended first Phase 9 item** (§7).

## 2. Repository baseline

| | |
|---|---|
| Branch | `phase-8-consolidation` |
| HEAD at closeout start | `81662ff` (clean, `git status --porcelain` empty, equal to `origin/phase-8-consolidation`) |
| Migration invariant | 17 `.sql` / 17 journal entries, highest `0016_monitor_target_archive`; no untracked file under `packages/db/drizzle` |
| Quality gates (rerun, uncached) | `eslint .` zero output · `prettier --check .` clean · `git diff --check` clean · `gitleaks` no leaks · `pnpm typecheck` 21/21 |
| Test baseline (rerun, `pnpm test --force`, turbo concurrency 1) | **3,668 tests across 12 packages, zero failing** — api 815 · mobile 673 · worker 464 · core 486 · schema 322 · health-providers 315 · monitoring 151 · api-client 146 · mail-providers 116 · db 79 · calendar-providers 76 · ai-providers 25. Reproduces the 8.6C figure exactly; no package decreased. |
| Source-scanning guard suites | `queue-containment`, `queue-parity`, `mobile-inert-rendering`, `mobile-bundle-boundary`, `no-raw-console`, `ai-egress-guard`: 37/37 |
| `docs/history/` | Untouched by any commit after the 8.0 partition until this closeout added `phase-8.md` |
| Secrets | Only `.env.example` and `apps/mobile/.env.example` are tracked among secret-shaped paths; `.gitignore` covers `.env.*` |

## 3. Production baseline (read-only, 2026-09-12 ~15:05Z)

| | |
|---|---|
| Containers | api `(healthy)` up since 05:20Z · web up since 05:20Z · worker up since 14:21Z · postgres `postgres:17-alpine` up since 2026-08-30; **all `RestartCount=0`** |
| Serving source | api/web from `personal-os-8.6d-release` (`ca04e57`), worker from `personal-os-8.6c-release` (`6913f78`), by compose `working_dir`; images carry no commit label |
| Migration | `drizzle.__drizzle_migrations` count **17**; `monitor_targets.archived_at` present |
| Integrations | Calendar `active` (last calendar sync 15:00:08Z) · Health `active` (last success 15:00:15Z) · Gmail `active` (96/96 syncs in 24 h, last 15:00:06Z) |
| Monitoring | 5 active targets + 1 archived; 39,649 checks; **0 incidents ever, 0 open** |
| pg-boss | 0 failed / retry / active jobs; 69,036 completed; 27 queues; 10 schedules. DLQ on `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, three calendar queues; **none on `occurrences.generate-lazy`, `occurrences.expand-window`** |
| Retention | Two manual acceptance runs `completed` (51 then 0 rows deleted); **first scheduled run is 2026-09-13T04:00Z** |
| Cloud Ask | `ai_task_routes` = `capture_parser, daily_brief, mail_digest, voice_transcribe`; **no `ask` row — OFF** |
| Heartbeat | `last_beat_at` ≈58 s old; `/health` `ok` / `connected` / `stale:false` |
| Content | tasks 6 · notes 6 · inbox 10 · projects 0 · events 98 · occurrences 1 · mail_messages 783 · mail_digests 12 · briefs 2 · dispatch log 20 |
| Logs (24 h) | 0 error-level and 0 warn-level lines in api and worker |
| Network | Postgres publishes no host port |

**One new operational finding.** Health stream `daily-heart-rate-variability` breaker-tripped after
five consecutive `value_shape_violation` failures (2026-09-11T23:00Z–2026-09-12T03:00Z, 294 prior
successes) and is now disabled. It is one of the twelve value specs Checkpoint 6.3 recorded as
`unverified_no_account_data`; the account produced its first HRV record and the guessed leaf name
(`rootMeanSquareOfSuccessiveDifferencesMilliseconds`) did not match. ADR-047's design held — loud
failure, nothing wrong stored — and **the Checkpoint 8.1 occurrence-scoped alert key fired live for
the first time** (`health-sync-alert:…:breaker:daily-heart-rate-variability:2026-09-12:…`, accepted
03:00:14Z). The raw shape was in a worker log that the 8.6C recreation discarded, so the fix is a
re-observe. Classified as operational housekeeping (§5); not a Phase 8 defect.

## 4. Checkpoint status

| Checkpoint | Status | Notes |
|---|---|---|
| 8.0 Foundation | Complete (docs only) | ADR-056/057; context compaction −78.7%; private remote established |
| 8.1 Failure visibility + AI I/O hardening | Complete, deployed | ADR-058; keys now proven live (§3) |
| 8.2 Real Google Calendar | Complete | No code; one boolean; 98 events |
| 8.3 Search + export | Complete, deployed, Rabbit v8 | ADR-059 |
| 8.4 Capture front doors | Complete, deployed, Rabbit v10 | ADR-060; Lane 3 deferred on evidence |
| 8.5 Adoption soak | **Terminated by owner** after 9.1 h / 21-day minimum (1.8%) | **No adoption conclusion exists.** Baseline is dated measurement only (`docs/SOAK-8.5.md`). |
| 8.6 Decision gate | Complete | `docs/CHECKPOINT-8.6-DECISION.md`; §29's "no mobile build / no migration 0016 / no client surface" exclusions were overridden by owner approval in 8.6B/8.6D and the document is left as written |
| 8.6A Reliability | Complete, deployed, accepted | `capture.parse.dead`, durable failed state, all-day floor, `q` scrub |
| 8.6B Cloud Ask + egress hardening | Complete, deployed, accepted, Rabbit v11 | Corrected the false "bodies were local" premise; Ask ships OFF; D1e deferred |
| 8.6D Monitor CRUD | Complete, deployed, accepted | Migration `0016`; archive, never delete |
| 8.6C Retention | Complete, deployed, accepted | Irreversible under ADR-024; windows fixed by owner |

## 5. Remaining known debt, classified

None of these blocks closure. "P9" = Phase 9 candidate.

| Item | Class | Notes |
|---|---|---|
| `occurrences.generate-lazy` — no DLQ, no structured logging, no durable failure state | **Reliability debt · P9 (first)** | Silent successor loss on retry exhaustion; identical class to the 8.6A `capture.parse` fix |
| `occurrences.expand-window` — no DLQ | Reliability debt · P9 | Nightly cron re-runs; no per-item loss |
| `basic404` path logs and echoes the raw URL outside the pino `req` scrub | Security/privacy debt · P9 | A mistyped OAuth callback with `?code=` would reach the log |
| D1e — no device-token auth on `/ai/*` writes | Intentionally deferred (security in substance) | Owner-deferred as its own ADR-029 amendment; perimeter-only like every other write route |
| `DELETE /ai/task-routes/:task_name` can delete `capture_parser` | Security/reliability · P9 | Captures then fail durably until re-created; recoverable |
| Two unwired OAuth-state sweep functions | Operational housekeeping | `health_oauth_states` / `mail_oauth_states` grow monotonically; wire or delete |
| HRV stream breaker-disabled (unverified value spec) | Operational housekeeping | Re-observe shape, correct spec, re-enable |
| Rabbit R1 APK behind source | Operational housekeeping | See §8 for the closeout result |
| No standalone index on `monitor_checks.checked_at` | Scalability debt | Retention scan accepted at 8.6C at ~60–110k rows; revisit on growth |
| Monitoring under-samples due checks (~95–98%) | Reliability debt · P9 | Three-state uptime prevents a false 0% |
| Event text unbounded at write | Security/privacy debt · P9 | Precondition for adding `events` to search or Ask |
| Monitor URL guard is a literal-hostname regex | Security debt · P9 (with D1e) | Probe stores no body; perimeter-only |
| ADR-054 "configurable" window unmet | Intentionally deferred | Constants chosen by owner; recorded in ADR-061 |
| `credential-crypto.ts` has no AAD; `CREDENTIALS_ENCRYPTION_KEY` unversioned, no rotation | Security/privacy debt | The sharpest durability risk in the system (SOPS + age still the intended direction) |
| Alerts share the `reminders` channel | Operational housekeeping (APK) | Muting Reminders mutes alerts |
| Search per keystroke, no debounce | P9 | Harmless at single-user scale |
| List-row Archive/Drop unconfirmed | P9 | Detail screens and monitor CRUD do confirm |
| `calendar_connection_calendars.summary` holds the ID; no `GET` for persisted per-calendar state | Reliability (data quality) · P9 | **Visible on device at closeout:** Settings renders every calendar toggle OFF although two are enabled, because the client can only learn `sync_enabled` from a PATCH response. A misleading control on the owner's daily driver; cheap to fix (one GET route). |
| In-progress timed multi-day event on no Today day; `done` occurrence still renders; `classifyEventIntoWindows` duplicated | Reliability debt · P9 | Latent; would mislead any Ask over Today |
| Log redactor censors the `mailboxes` count | Operational housekeeping | Denylist fragment `mailbox` |
| Live `EXPO_TOKEN` in `apps/mobile/.expo/dev/logs/export.log` (mode 644, ignored) | Security/privacy debt | Cheapest high-value fix: revoke + delete |
| Tailnet suffix in 104 of 255 commits' author email | Intentionally deferred | Immutable; `user.email` no longer set to it |
| Drizzle snapshots stop at 0008 | Operational housekeeping | Hand-written SQL + mandatory reconcile remains the method |
| No `expo-updates` OTA; every client change needs an APK; Kotlin only compiled by EAS; no local JVM | Intentionally deferred (architecture property) | — |
| 8.5 measurability limits (launcher vs Quick Capture indistinguishable; search frequency per log epoch) | Intentionally deferred | A `source` split needs a CHECK migration |
| `ai_daily_briefs.model_id` FK violation unhandled | Intentionally deferred | Still unreachable — no `ai_models` delete exists |

## 6. Documentation changes made by this closeout

- `docs/history/phase-8.md` — **new**; lines 84–1605 of the pre-closeout `docs/STATUS.md`, verbatim, hash-proven.
- `docs/STATUS.md` — rewritten to present state only (2,045 → ~540 lines): Phase 8 marked closed; production table refreshed from the read-only verification; seven stale ledger entries corrected (`capture.parse` DLQ, DELETE task-route endpoint, Brief `ai.usage`, search `q` logging, alert keys unemitted, build-context path, tailnet commit count); three new ledger items (HRV stream, ADR-054 configurability, monitor URL guard); the "Approved scope is 8.0 only" and "8.6C not started" sentences removed.
- `docs/DECISIONS.md` — **ADR-061** added; `[Present state corrected by ADR-061.]` pointers on ADR-057, ADR-059, ADR-060. No Locked text edited.
- `AGENTS.md` — scope-control paragraph updated from "8.0 is the current work / 7.9 still OPEN / level 16" to the closed state; history range extended to `phase-8.md`. `CLAUDE.md` — history range extended.
- `docs/PHASE-8-CLOSEOUT.md` — this file.

No application code, test, migration, queue, container or production row was changed by the closeout.

## 7. Phase 9 starting brief

**Not a design. Not an approval.** Inputs for the owner's first Phase 9 decision.

### 7.1 Exact technical baseline
Repository and production as in §2–§3: HEAD `81662ff` plus this closeout's documentation commits;
migration 17; 3,668 tests; api/web `ca04e57`, worker `6913f78`; Rabbit R1 per §8; all three Google
integrations active; Cloud Ask OFF; retention live with its first scheduled run pending.

### 7.2 Current major capabilities
Capture (Quick Capture, PTT + Groq, Siri/Assistant, Android share sheet, launcher shortcut, offline
outbox, confidence-routed LLM parse with a durable failed state and DLQ) · tasks/notes/projects with
both recurrence anchors · calendar month/week, RRULE editor, Google + CalDAV two-way sync, the real
primary calendar enabled · Today, agenda, daily/weekly reviews, manual Daily Brief · Google Health
read-only daily aggregates + sessions with a health dashboard · Gmail metadata sync, digest, and a
needs-reauth alert · service monitoring with incidents, watchdog and full target CRUD · lexical
search over four entities, JSON export · Cloud Ask (read-only, no tools, OFF by default) ·
occurrence-scoped alerting · daily retention · a private GitHub remote.

### 7.3 Mandatory carry-forward constraints
ADR-018 Tailscale-only, no ingress of any kind · ADR-024 no backup system (retention deletes are
final) · ADR-046 Health passive, never fed to AI · ADR-052/053/054 Gmail metadata-only, never act
on mail · ADR-056 read-only intelligence before write-capable, no unrestricted full-content cloud
egress, pgvector and any Postgres image change require their own infrastructure ADR, no agent may
hold `posops_app` · ADR-058 every new alert producer carries an occurrence-scoped dedupe key ·
migration posture: new tables over widened ones, `ADD COLUMN` limited to the reconcile script's
five-type allowlist, btree indexes only · frozen deployment order (build → verify image → migrate
with `--no-deps` → recreate api and worker separately, never target `postgres`) · every client
change costs an EAS build and an in-place APK install; Kotlin compiles only on EAS.

### 7.4 Optional debt worth considering
The §5 rows marked P9, in this order of value: the two `occurrences.*` DLQs; `basic404` scrub;
event text bounded at write (unlocks `events` in search/Ask); D1e together with the URL guard;
Today read-model correctness (in-progress multi-day, `done` occurrences, deduplicating
`classifyEventIntoWindows`); the dedicated alerts channel; search debounce; list-row confirmations.

### 7.5 New product opportunities (recorded, not ranked by evidence — no adoption evidence exists)
From `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` open questions and the 8.6 decision gate:
Finance (source-of-truth decision first: Copilot export / Plaid-SimpleFIN / Actual Budget) ·
Daily Brief health integration (would extend `BriefInput`'s closed allowlist, facts only) ·
Microsoft Graph as a second mail provider · notification-shade capture (needs `expo-task-manager`)
· an in-app correction editor for `unclear` captures (the soak's one real friction item) · a
client export affordance · the 8.6 gate's Option B (deterministic preselection) when the corpus
approaches the payload ceiling, with an embeddings lane only after that, per ADR-056 · Rabbit
wake-word capture · a dedicated Next.js dashboard.

**The strategic fork (capture-first vs integration-first) remains unresolved and cannot be settled
from existing data.** Any product decision in Phase 9 must be labelled as hypothesis unless a fresh,
new-baseline soak is run against a stable release.

### 7.6 Recommended first Phase 9 decision / gate
**Checkpoint 9.0 — reliability closure, then the phase decision.** Close the last known gaps in
the failure-visibility contract before any product work: DLQ + durable failure state for
`occurrences.generate-lazy` and `occurrences.expand-window` (same pattern as 8.6A), the `basic404`
scrub, the HRV value-spec re-observe and re-enable, and wiring or deleting the two OAuth-state
sweeps. Zero migrations, one worker deploy, one api deploy. Then a short owner gate choosing the
Phase 9 theme — the recommendation is to decide it as an explicit hypothesis rather than to infer
it from usage that was never measured.

### 7.7 Suggested parallel subagent use for Checkpoint 9.0
Non-overlapping lanes: (1) worker — the two DLQ handlers and durable failure records, modelled on
`capture-parse-dead-letter.ts`, with the `queue-parity` guard extended; (2) api — a `setNotFoundHandler`
that routes through the existing scrub, plus tests; (3) health — the 6.2P probe against the HRV
stream to capture the real leaf, then the value-spec correction (pure unit); (4) api services —
wire the two sweeps into `retention.cleanup` or delete them, with a decision note; (5) an
independent adversarial reviewer over the combined diff before deployment. Database-backed suites
run only by the integrator, serially. Production writes only by the integrator, in the frozen order.

## 8. Rabbit R1 housekeeping

EAS build `ba38b032-47c3-4dfc-bcd5-a8b043104081`, profile `production-internal`, from commit
`81662ff`, keystore `Build Credentials 91FWKRpxFX`, EAS auto-incremented **versionCode 11 → 12**.
Result and install verification: see the line below, filled in when the build finished.

**Performed and verified, 2026-09-12.** Build `finished` at 15:21Z from HEAD `81662ff` (the closeout
started from a clean tree, so the APK carries exactly the accepted 8.6 source). APK 116,909,143
bytes, sha256 `cdf18483d710cfc4…`; `aapt2 dump badging` reads `package: name='com.himal.personalos'
versionCode='12'`. Hermes bundle markers, checked before install: `Cloud Ask` ×5,
`ask_route_immutable`, `monitor/new` and `target_has_active_incident` present (8.6B + 8.6D UI);
production tailnet API URL present; `localhost:3000` and `EXPO_PUBLIC_UI_TEST_MODE` absent.
Installed with `adb install -r` only (no uninstall, no data clear) → `Success`; Android's package
manager refuses an in-place replace on a signing mismatch, so the success is the signing-continuity
proof.

| Check | Before | After |
|---|---|---|
| versionCode | 11 | **12** |
| `firstInstallTime` | 2026-08-19 16:26:10 | **unchanged** |
| `dataDir` | `/data/user/0/com.himal.personalos` | unchanged |
| Packages matching `himal` | 1 | 1 — no duplicate |
| `SCHEDULE_EXACT_ALARM` appop | `allow` | **`allow` — preserved** |
| `POST_NOTIFICATIONS` | granted | granted |
| Device row `c6c0b43d…` | primary, active, push token | **same row**, primary, `last_seen_at` refreshed 9 s after cold launch |
| Pairing codes consumed | 2 | **2 — no re-pairing** |

Cold launch (`am force-stop` → launcher) rendered Today with live production data (Inbox 3, Daily
Brief card) and **no pairing screen**. Settings opened normally. Full physical acceptance of the
Monitor CRUD screens was **not** repeated on device — 8.6D's acceptance ran through the same API the
screens call, and the bundle markers above prove the screens shipped. Observed while there, and
recorded in §5: the Connected Calendars card renders every calendar toggle OFF although two are
sync-enabled, the visible consequence of the long-recorded missing `GET` for persisted per-calendar
state.
