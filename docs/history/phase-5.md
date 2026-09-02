# Phase 5 — Daily Command Center + Projects

> **Historical record — closed. Do not edit.**
> Today read model, operational project lifecycle, daily/weekly reviews, unified agenda, and the manual AI Daily Brief.
>
> Archived from `docs/STATUS.md` by Checkpoint 8.0 (2026-09-02) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`.

Source line ranges in the pre-8.0 `docs/STATUS.md`: 4197–4214, 4215–4225, 4226–4254, 5142–5159, 5109–5120, 5121–5141, 5042–5108, 4992–5041, 4883–4991, 4599–4882, 4476–4598


> **Note on cross-references.** This file was extracted from a single 7,283-line `docs/STATUS.md`. Phrases like *"above"*, *"below"*, *"further down this file"* and *"see the 6.7A section"* refer to positions in that original document, not to this file. Where a target moved to a different phase file, follow the phase number. Nothing was rewritten to repair these — the text is verbatim.

<!-- ORIGINAL RECORD BEGINS — everything below this line is verbatim from docs/STATUS.md -->
## Phase 5 — Daily Command Center + Projects (plan approved 2026-08-21)

Phase 5 was redefined by explicit user direction (ADR-038): the original "Phase 5 = Finance" entry is deferred to a later phase, still gated on the open finance-source-of-truth decision. Five read-only planning audits (domain/data, UX/navigation, projects/review, AI/worker, independent risk/test) were reconciled into an approved checkpoint plan; production was untouched throughout planning.

**Approved checkpoints:** 5.1 Today/Home command center · 5.2 operational project management · 5.3 daily+weekly reviews · 5.4 unified agenda · 5.5 manual AI Daily Brief · 5.6 mobile/Rabbit daily-use polish · 5.7 gated production deployment.

**Binding user amendments recorded with the approval:**

1. **Overdue semantics:** `overdue ⟺ due_at < effectiveNow` (never end-of-local-day); `due_today` = the requested-timezone local calendar-day window `[startOfLocalDay(tz), startOfNextLocalDay(tz))`; occurrences likewise on `occurs_at`. One `effectiveNow` captured per request/read-model build. Tasks whose own timezone differs from the requested Today timezone are bucketed by instant; their own timezone formats display only.
2. **Recurring dedupe:** where a materialized actionable occurrence exists, the occurrence IS the actionable representation; the parent recurring task must not also appear for that same due instance in Today or Agenda. Skipped/completed occurrences excluded; Upcoming excludes items already shown as overdue/today.
3. **Brief uniqueness:** `ai_daily_briefs` identity is `(brief_date, timezone)` unique; upsert and get/current use the same identity.
4. **Priority reality (verified before freezing next-action):** `tasks.priority` is an unconstrained nullable smallint written only by AI capture and ordered by nothing anywhere; frozen convention **lower value = higher priority**, comparator `due_at ASC NULLS LAST → priority ASC NULLS LAST → created_at DESC NULLS LAST → id ASC`.
5. **Migration accounting:** Phase 5 adds exactly 0010 (project lifecycle), 0011 (reviews), 0012 (daily briefs). Post-Phase-5 production journal must contain exactly **0000–0012 = 13 migrations**.
6. **Approved scope items stay in their assigned checkpoints:** `remind_at` accepted through `TaskUpdateSchema` in 5.4 (reminder reconciliation correctness preserved + physical verification later); Quick Capture `source` reflects real platform instead of hardcoded `"web"` in 5.6. Neither pulled into 5.1.
7. **No production `daily_brief` route now:** 5.5 implements and locally verifies collector/no-provider behavior/routing/persistence/timeouts/UI; actual production provider/model selection is deferred to 5.7.

Docs updated this step: `DECISIONS.md` ADR-038–041; `ARCHITECTURE.md` revised phase plan plus a new frozen-semantics section ("Today & agenda read models"). All Phase 0–4 evidence preserved unchanged.

## Phase 5 Step 0 + Step 1 — documentation reconciliation + contract/core freeze (COMPLETE, 2026-08-21)

**Step 0** (`986a495`): ADR-038 (Phase 5 redefinition, Finance deferred), ADR-039 (project lifecycle vocabulary, archived_at axis separation), ADR-040 (durable reviews model), ADR-041 (manual bounded Daily Brief); `ARCHITECTURE.md` phase plan amended + frozen-semantics section added; this file's header/planning record updated.

**Step 1** (`d328412`): contracts and domain core frozen before any feature work —
- `packages/core/src/actionability.ts`: DST-safe local day windows (`localDayWindow`/`localDayWindowForDate`, including **nonexistent-midnight zones** like America/Santiago), instant-overdue vs local-day due-today categorization with strict precedence, `buildActionableView` recurring dedupe, one-effectiveNow-per-build helper.
- `packages/core/src/project-lifecycle.ts`: active/paused/completed transition predicates (archive axis independent), frozen next-action comparator (`dueAt ASC NULLS LAST → priority ASC NULLS LAST → createdAt DESC NULLS LAST → id ASC`; lower priority value = higher priority — verified reality: column written only by AI capture, ordered by nothing anywhere), stalled predicate (14d, event window disqualifier), progress counts.
- `packages/schema`: today/agenda/reviews/brief contracts; projects extended per ADR-039.
- **Independent adversarial audit (Agent D)** found 8 defects; #1–#6 fixed with regression tests: nonexistent-midnight day-start correction (Santiago), trust-nothing dedupe guard (parent suppressed whenever scheduled occurrences exist regardless of flags), duplicate occKey first-wins, occurrence-must-carry-parent refine, honest-total refine, agenda-overdue restricted to tasks/occurrences. #7 (projects route not yet persisting goal/target_date) accepted as interim-only — closed by Checkpoint 5.1's data layer below. #8 deliberate duplication pinned by tests.
- Gates: all clean; **680 tests** (+137 vs Phase 4 baseline).

## Phase 5 Checkpoint 5.1 — Today / Home command center (COMPLETE, 2026-08-21)

Built with the approved multi-agent split (data-layer agent → parallel API/client agents → independent read-only auditor), main session as integration owner. Local development only; production untouched throughout.

**What was built:**

1. **Migration `0010_project_lifecycle.sql`** — purely additive: `projects.goal text`, `target_date date`, `completed_at timestamptz`, `updated_at timestamptz NOT NULL DEFAULT now()`, CHECK `projects_status IN ('active','paused','completed')` (ADR-039 vocabulary; `'archived'` forbidden), partial index `projects_target_date_active_idx`. Hand-written SQL + hand-appended journal entry (0009 precedent — snapshots stop at 0008; naive generate would re-emit CalDAV DDL). Applied to dev + `personalos_test` as `posops_migrator`; `posops_app` read/write verified, `CREATE TABLE` still denied (SQLSTATE 42501); CHECK rejects `'archived'`, accepts `'active'`/`'paused'`. Drizzle schema updated to declare the index AND check (audit fix — prevents future generate from emitting destructive drops).
2. **`GET /today?tz=`** — `apps/api/src/read-models/today.ts` collector + perimeter-only route. One effectiveNow per build; overdue = instant `< effectiveNow` (strict; earlier-today → overdue, later-today → due-today); due-today = requested-tz local calendar-day window; totals derived from post-dedupe buckets so summary can never contradict sections; recurring parents represented ONLY via their scheduled occurrences (done/skipped excluded); events classified with **local date-string bucketing for all-day items** (fixing the `/events/range` UTC simplification inside Today's own path without touching that route); upcoming = next 7 local days, disjoint from overdue/today; inbox counts pending+needs_confirm+failed with newest needs_confirm/failed previews; projects section with computed next action (frozen comparator), open/overdue/done counts, last activity, stalled flag; `reviews`/`brief` returned as forward-compatible nulls WITHOUT querying nonexistent tables (0011/0012 deliberately not created yet). Response parsed against frozen `TodayResponseSchema` before send.
3. **Event-range extraction** — the existing three-source assembly moved verbatim into exported `apps/api/src/read-models/event-range.ts` (`assembleEventRange`) now used by both `GET /events/range` (unchanged contract; `events.test.ts` diff empty) and the Today collector. Phase 4 calendar infrastructure not redesigned.
4. **Projects persistence** — POST/PATCH persist goal/target_date; PATCH/archive bump `updated_at` (mirroring tasks conventions); response maps real columns (interim shim removed).
5. **Client** — `packages/api-client` `getToday` (+3 tests, URL-encoding + boundary parse); `useToday()` hook (device timezone with Hermes/web-safe fallback); `(tabs)/index.tsx` rebuilt as the Today command center (header + local date, summary chips, Overdue/Due-today task rows with the exact 409→occurrence completion fallback, Today's Events with all-day group, Upcoming days (empty days omitted), Inbox-needs-attention, Active Projects cards with status chip/stalled badge/next action/target date, loading/error+Retry states, per-section empty states); Tasks list moved verbatim to stack route `/tasks` registered in both ProductionContent and UiTestContent stacks; tab title "Tasks"→"Today"; tab count stays 5; FAB/PTT/notification/reconciliation code untouched.

**Independent audit (Agent D) — CHANGES_REQUIRED verdict, all findings fixed:** D1 missing drizzle index/check declarations (destructive-drift hazard) → declared; D2 unbounded-below occurrence/task queries could starve today's occurrence under accumulated stale rows → limits removed (honest full sets; single-user scale; accumulation noted as debt); D3 stall disqualifier ignored recurring-event occurrences → folded `occurrences(parent_type='event')` within the 14-day horizon into nextEventStarts; D4 duplicate React keys for multi-occurrence parents → occurrence-aware keys. Post-fix gates green.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && typecheck && lint && format:check` | All clean workspace-wide |
| 2 | Full test suite | **691 tests pass, 14/14 turbo tasks** (core 185, schema 114, calendar-providers 57, ai-providers 20, api-client 30, api 138 incl. 8 new today-route tests, worker 70, mobile 77) — zero regressions vs Phase 4's 543 |
| 3 | Migration 0010 on dev + test DBs as migrator | Applied once each; columns/index/CHECK verified via `\d`; role denials re-proven |
| 4 | Live HTTP `/today` with seeded fixtures over real curl | Earlier-today task → overdue while later-today task → due_today; recurring chore appeared twice as merged occurrences with `occurrence_id` set and **zero bare-parent leak**; skipped occurrence excluded; honest totals == sections; Auckland-style UTC-vs-local all-day distinction proven live (a `CURRENT_DATE`(UTC) seed correctly landed in tomorrow's local bucket; corrected local-date seed landed in events_today); invalid tz → 400; smoke cleanup count-verified (11 rows, zero residue, zero orphan occurrences) |
| 5 | Web SPA regression | Exported bundle served: `/`, `/tasks`, `/tasks/<uuid>` all HTTP 200 via SPA fallback; `expo export --platform web` clean |
| 6 | Physical Rabbit R1 pass (480×640) via side-by-side `com.himal.personalos.dev` UI-test identity — production package never targeted | Today renders as default tab with live dev-API data through adb reverse (API log shows device-originated `GET /today?tz=America/Chicago`): header date, summary chips, OVERDUE·2 / DUE TODAY·1 rows, TODAY'S EVENTS with ALL-DAY group, INBOX NEEDS ATTENTION (9 waiting + previews), ACTIVE PROJECTS empty state; error state + Retry genuinely exercised mid-pass; "All tasks" opens the `/tasks` list (filters/actions intact); cold-start deep link `personal-os-ui-test://tasks/<uuid>` opened the correct task detail; Calendar month grid intact ("Fri Aug 21 2026, 1 event"); five tab labels visible and separated. `.dev` build uninstalled afterward; production `com.himal.personalos` versionCode 4, install/update timestamps identical before/after |

**Device-pass incident, diagnosed to root cause:** the release-mode UI-test APK initially could not reach the dev API at all. Cause: the committed (gitignored-generated) `android/` manifest predates UI-test mode and lacks `android:usesCleartextTraffic`, so SDK 36 silently blocks the app's cleartext `http://localhost:3000` fetch before any packet leaves the device — shell curl worked while the app never connected. Fixed temporarily during the pass only (manifest edit reverted afterward; EAS/production builds regenerate manifests from `app.config.ts`, which sets the flag for ui-test builds). This also retroactively explains Checkpoint 4.2's recorded need for local fixtures ("Rabbit could not open the Mac's development TCP port").

**Honest limitations recorded:** FAB/PTT physical clearance was NOT verifiable in this pass — the UI-test identity deliberately does not mount them; their code is untouched by 5.1 and prior physical verification stands; re-verify during Checkpoint 5.6's production-identity pass. `active_project_count` counts all non-archived projects (including paused/completed) — naming to revisit if it ever matters. Never-completed scheduled occurrences accumulate without bound (pre-existing behavior, now visible honestly in totals) — candidate for a future sweep job, deliberately not built speculatively.

## Phase 5 Checkpoint 5.2 — Real Project Management (COMPLETE, 2026-08-22)

Built with the approved multi-agent split (aggregation/core agent first, then parallel API and client agents, then an independent read-only auditor), main session as integration owner. Local development only; production untouched. No new migration (0010 suffices; 0011 deliberately not created).

**What was built:**

1. **Frozen contracts (main session, before parallel writers)** — `packages/schema/src/projects.ts`: `ProjectSummaryItemSchema` (row + next_action + stalled + last_activity_at + counts), `ProjectSummaryListResponseSchema`, `ProjectDetailResponseSchema` (project + computed + bounded tasks/notes/events sections with honest totals).
2. **Core finalization (Agent B)** — `ProjectActivitySignals.taskWrites?: Date[]` (additive; tasks DO have created_at/updated_at — audited before use); `lastProjectActivity` flattens all four arrays.
3. **Lifecycle API (Agent A)** — `POST /projects/:id/{pause,resume,complete,reopen}` per the kickoff table exactly (pause/resume idempotent on target state; complete idempotent on completed PRESERVING original completed_at; reopen clears completed_at, active-idempotent, paused→409); 409 shape `{error:"invalid_status_transition",status}` mirrors the tasks convention. **Archive now sets `archived_at` ONCE** (re-archive returns the original timestamp — fixes the recorded overwrite debt) and preserves status/completed_at; new `POST /projects/:id/unarchive` restores the exact underlying status, never forcing active. Generic PATCH remains name/color/goal/target_date only with strict rejection of status/archived_at/completed_at (now explicitly tested). `updated_at` advances on real mutations via a monotonic `+1ms` floor over the previous row value (rapid-write safety); pure idempotent no-ops return the row untouched.
4. **Shared aggregation (`read-models/project-summaries.ts`)** — one effectiveNow per build; grouped/batched SQL; eligible-open = inbox|active non-archived; next action = frozen comparator over eligible tasks; overdue count includes a recurring parent having ≥1 scheduled overdue occurrence exactly once (task-level counting makes parent+occurrence double-count structurally impossible); stalled computed ONLY for active non-archived projects (archived guard lives in the collector since core checks status only) with all five rescue signals proven: task write, task completion, note write (notes DO carry updated_at — verified), occurrence completion (incl. archived parents), upcoming linked event (template ∪ scheduled event-type occurrences within `[now, now+14d)`). Endpoints: `GET /projects/summaries?include_archived=` (group-rank active<paused<completed<archived, name ASC; static-beats-parametric routing tested) and `GET /projects/:id/detail` (works for archived projects; tasks open-first/due-asc ordering; non-archived children only; **detached event children excluded from items AND totals** so overridden instances never duplicate alongside their series; >50 truncation with honest totals).
5. **Today semantic correction (user-mandated)** — `active_project_count` and the projects items list now include ONLY non-archived `status='active'` projects (paused/completed excluded); collector's per-project overdue definition aligned with the shared aggregate (recurring-overdue EXISTS clause) and its stall activity input now includes taskWrites — both cross-surface drift findings from the independent audit, fixed.
6. **Client (Agent C)** — api-client: getProjectSummaries/getProjectDetail/pause/resume/complete/reopen/unarchive (boundary schema-parses; bodyless POSTs send no Content-Type — Phase 2 lesson guarded by test); hooks invalidate `["projects"]` prefix AND `["today"]`. Projects list rebuilt as grouped Active/Paused/Completed/Archived sections with status pills, next-action lines, counts·target-date meta, stalled badges, Unarchive on archived rows. Detail screen rebuilt operationally: status pill, inline-editable goal/target-date (onBlur commit, repo convention), contextual lifecycle action row, NEXT ACTION highlight card, counts + last-activity strip, Tasks section (open-first, completion via the exact existing 409→occurrence fallback), Notes and series-level Events sections, "+ Task/+ Note/+ Event" shortcuts preselecting the project via query params on the existing create forms (global flows unchanged when param absent). No percentages or fake progress anywhere.

**Independent audit (fresh Agent D): CHANGES_REQUIRED → all fixed.** D1 Today-vs-shared overdue definition drift; D2 Today stalled-rescue missing taskWrites (its fix legitimately flipped one stale fixture that wasn't actually cold under finalized semantics — fixture backdated properly); D3 literal `&apos;` rendered inside a JS string. Verdict on all other axes: transition matrix, archive-axis orthogonality, completed_at invariants, aggregate correctness, next-action eligibility, detail model, client layer, calendar/sync regression — CLEAR.

**Verification actually run:** build/typecheck/lint/format clean workspace-wide; **754 tests / 14 turbo tasks pass** (+63 vs 5.1's 691: core 188, schema 114, calendar-providers 57, ai-providers 20, api-client 41, api 187 incl. 51 owned lifecycle/aggregation tests, worker 70, mobile 77); web export clean; `git diff --check` clean. Live HTTP verification against dev DB: full lifecycle driven hop-by-hop with state assertions (initial-paused idempotent pause left updated_at byte-identical; resume→active; complete set completed_at; repeat complete preserved it; pause-on-completed 409; reopen cleared it; archive preserved status; re-archive timestamp preserved; unarchive restored underlying status; reopen-on-paused 409); summaries grouping/order/aggregates verified; detail goal/target/next-action/counts/sections verified; Today returned active_count=1 listing only the active project while paused/completed existed. Physical Rabbit layout pass via side-by-side `.dev` identity (production never targeted; versionCode 4 + install timestamps identical before/after; `.dev` uninstalled after; cleartext manifest flag applied for the pass then reverted — same root cause as 5.1's incident, now documented): rebuilt Projects list renders all four lifecycle sections with pills/next-action/counts at 480×640; detail screen renders pill/goal/target/NEXT ACTION/actions/counts/activity/Tasks; a real Pause executed on-device flipping the pill to PAUSED and swapping the action to Resume, then Resume restored ACTIVE through the full live stack.


## Phase 5 Checkpoint 5.3 STEP 0 — Migration tooling repair (COMPLETE, 2026-08-22, commit 035301a)

Executed with a parallel read-only audit wave (repo/journal/snapshot auditor, installed-internals auditor, live-DB prover across both databases, git historian) plus disposable-DB reproduction agents and an independent safety critic (APPROVE-WITH-CHANGES; all changes adopted).

**Exact root cause:** migrations 0009 (Checkpoint 4.6) and 0010 (5.1) were authored as hand-written SQL with hand-appended `_journal.json` entries — `drizzle-kit generate` became unusable after 0009 because snapshots stop at 0008 — and were applied to local dev/test via direct migrator-role psql. The runner (drizzle-kit 0.31.10 → drizzle-orm 0.45.2 programmatic migrate) tracks applied state as a **max(created_at) watermark** in `drizzle.__drizzle_migrations` (hash = sha256 of raw file bytes; folderMillis = journal `when`; strict `<` comparison; single transaction per run), so locally it saw the 0008 watermark and replayed 0009 into existing objects, dying on its duplicate `ADD CONSTRAINT`. **Production is unaffected**: it applied through 0009 via drizzle-kit inside the migrator container and is properly tracked ("journal contains exactly 0000–0009, 10 rows").

**Additional fabrication found and fixed:** journal idx 10's appended `when` was future-dated (`1787528400000`) — under watermark semantics that would have permanently suppressed migration 0011. Corrected to the true authoring-commit epoch `1787362339000`. Idx 9's `1787268000000` was kept deliberately: it equals production's tracked row byte-for-byte, and raising it would replay 0009 on production at the next deploy.

**Repair (reproducible, repo-level):** `packages/db/scripts/reconcile-drizzle-tracking.ts` (+`db:reconcile`, `--check` mode) — computes runner-exact hashes, mechanically derives fail-closed schema-effect probes from EVERY parsed DDL statement (column/constraintdef-equality/indexdef-equality/table existence; unhandled statement classes abort rather than mark applied), advisory-lock + in-tx watermark re-read, abort-on-ambiguous history, literal `(hash, journal.when)` inserts ascending as migrator role. Also: declared the orphaned-but-live unique constraint `calendar_connections_google_account_id_unique` in the Drizzle schema (as `.unique()` CONSTRAINT matching live contype='u', per critic — not an index); added permanent journal-guard tests (contiguous idx, tag↔file bijection, strictly increasing whens, no future-dated entries, exact snapshot allowlist, which at the time was {0009,0010} and is now {0009,0010,0011,0012} — the test is authoritative and each addition is a deliberate, reviewed act).

**Proofs (all PASS):** pre-repair failure reproduced on a cloned affected DB; affected dev+test reconciled to identical 11-row tables then `drizzle-kit migrate` up-to-date twice each with ZERO DDL; fresh disposable DB migrated 0000→0010 cleanly with EMPTY schema diff vs dev (325/325 objects); production-watermark simulation proved migrate applies exactly {0010} while skipping 0009; probes 34/34 (0009) + 6/6 (0010) verified before any insert; `posops_app` DDL denial intact; production untouched.

## Phase 5 Checkpoint 5.3 — Daily + Weekly Review (COMPLETE, 2026-08-22)

Built with maximum agent parallelism per the approved directive: Step-0 audit wave (4 investigators + repro labs + safety critic), Wave-2 implementation (migration agent; core periods; core lifecycle; recently-completed collector; api-client; mobile hooks/UI-kit; API surface; Today integration; daily UI+banners; weekly UI — ten disjoint-ownership writers across two dependency waves), then a four-auditor adversarial wave (API/lifecycle/security; Today+regressions; domain semantics; UI/resume/Rabbit). Main session froze contracts first, owned barrels/shared files, integrated, fixed all findings.

**What was built:**

1. **Migration `0011_review_history.sql`** (additive): reviews table per ADR-040 — id uuid PK, kind CHECK('daily','weekly'), period_start date NOT NULL, timezone NOT NULL, status CHECK('in_progress','completed','skipped') default in_progress, content jsonb, summary text, created/updated timestamptz default now(), completed_at nullable; UNIQUE(kind,period_start) via named unique index; completed_at idx. Applied to dev+test as `posops_migrator` through the repaired workflow; reconcile probe-gated backfill proven end-to-end on the new migration.
2. **Frozen contracts** (main session before writers): content contract v1 — `{version:1, kind:"daily"|"weekly", checklist:{known keys, optional booleans, strict}, selected_priorities:[≤10 uuid refs]}`; summary bounded at 2000 chars. Daily checklist keys inbox/overdue/priorities/calendar/projects/next_actions/summary; weekly adds active_projects/paused_projects/stalled_projects/missing_next_actions/upcoming_week/recently_completed. References are historical metadata (no FK ownership). Daily/weekly context response schemas reusing frozen Today item shapes with bounded sections + honest totals. `TodayResponseSchema.reviews` → nested real state `{daily|weekly:{period_start,review_id,status,last_completed_at}}`.
3. **Core**: `review-periods.ts` (DST-safe local daily periods; locale-proof Monday-start weekly via fixed en-US Intl + Date.UTC weekday math; next-period helpers; invalid tz/string throws incl. non-real dates) and `review-lifecycle.ts` (statuses, canComplete/canSkip from in_progress only, transitions map with terminal states).
4. **Review API**: POST /reviews upsert-by-(kind,period_start) race-safe (existing ANY-status returned byte-unchanged, never reopened); GET list (paginated)/latest(404-empty)/:id; PATCH in_progress-only with row-kind-bound content validation, no-op detection (identical payload doesn't advance updated_at); complete/skip idempotent on own terminal state preserving original completed_at, cross-state 409s. **TOCTOU hardening from audit:** every mutation UPDATE carries a status predicate so exactly one writer transitions; losers re-read into idempotent/409 logic against the winner's state.
5. **Context collectors** (`GET /reviews/context/daily|weekly?tz=`): one effectiveNow threaded (now injectable into project aggregates per audit H1); inbox attention counts+previews; overdue/due-today via frozen actionability semantics incl. occurrence merge/dedupe; events_today via event-range assembly + LOCAL date classification for all-day items; active/paused/stalled/no-next-action project sections derived from one computeProjectSummaries pass; upcoming_7d day grouping (weekly); recently_completed via the frozen collector.
6. **Recently-completed semantics (frozen + tested)**: window = last 7 local calendar days including today (calendar-date arithmetic, DST-immune); tasks done+non-recurring+completed-in-window (archived included as historical fact; dropped excluded by status); occurrences done-in-window with parent title regardless of parent state; skipped excluded; structural parent+occurrence double-count impossibility proven incl. forced-mutation guard test; deterministic order; honest totals pre-limit.
7. **Today integration**: real derived review state (current-period row lookup kind-scoped — Monday-collision safe — plus max(completed_at) over COMPLETED rows only; skipped never counts as completion).
8. **Client**: api-client review methods with boundary parses and bodyless-POST regression guard; TanStack hooks invalidating reviews/review-context/today; ReviewStepList indicator (compact Rabbit mode); shared audited resume helpers (`savedChecklist/savedPriorities/savedSummary/isCurrentPeriod`) trusting non-null content wholesale.
9. **Daily screen** (/reviews/daily): start gate → guided 7-step resumable flow → finish section → read-only terminal views; interactive priority selection capped at 10 writing occurrence-aware refs; incremental whole-content v1 saves on every toggle; summary blur-save; complete/skip ≥44px targets.
10. **Weekly screen** (/reviews/weekly): 9-step flow adding paused/stalled/missing-next-action sections, upcoming-week day grouping, discriminated recently-completed rendering. **Today banners**: four-state cards for both kinds driven by /today's derived state.

**Independent audit findings — all fixed:** D1 (HIGH, resume persistence): sparse checklists made key-presence narrowing structurally unsound on both screens → root-fixed via explicit `kind` discriminator in content v1 + shared tested helpers + sparse round-trip regressions; D2 (MED): stale older-period in_progress could resume against wrong context → period guards both screens; TOCTOU double-complete window → status-predicates; summary unbounded → max(2000); PATCH no-op bumps → no-op detection; second-effectiveNow in project aggregates → injectable now; prettier violation + unrealistic Friday fixture → realistic Monday pair; kind-scoped current-period resolution test added. Audits otherwise CLEAR: lifecycle matrix, race-correct upsert, kind binding, strict validation, parse-before-send everywhere, SQL parameterization, logging/redaction hygiene, perimeter auth, Calendar/Google/CalDAV zero-diff, reminders/tasks surfaces untouched, dead-code/barrel completeness clean, domain semantics (DST/Monday/year-boundary/Auckland divergence, dedupe, honest totals) verified.

**Verification run:** build/typecheck/lint/format clean workspace-wide; **876 tests pass across 15 turbo tasks** (db 5 incl. new journal guards, core 233, schema 115, calendar-providers 57, ai-providers 20, api-client 56, api 228 incl. 29 route + 8 collector tests, worker 70, mobile 92); web export clean; `git diff --check` + gitleaks clean. Live HTTP verification drove the entire lifecycle against dev: create→duplicate-unchanged→incremental content PATCH→summary→kind-mismatch 400→lifecycle-field 400→complete(set once)→repeat-idempotent(preserved)→skip-on-completed 409→POST-on-terminal unchanged; weekly skip path symmetric; latest endpoint; `/today` reporting exact derived state incl. correct Monday weekly period; smoke rows cleaned count-verified. Physical Rabbit pass (side-by-side `.dev` identity; production package untouched, versionCode 4 + install timestamps identical before/after; cleartext flag applied for pass then reverted): Today banners rendered; full daily flow exercised live on-device — start gate, step toggle persisted server-mid-flow (verified via API between taps), summary blur-save, Complete → terminal view, return to Today showing "✓ DAILY REVIEW COMPLETED"; weekly entry rendered the correct Monday period start gate; five-tab layout intact throughout; `.dev` uninstalled afterward.

## Phase 5 Checkpoint 5.4 — Smart Agenda / Planning (COMPLETE, 2026-08-22)

Built with maximum agent parallelism under the approved plan: a read-only planning wave (6 investigators), then two implementation waves (S1 core helpers · S2 schema · S3 event-range · S4 worker+capture · S5 events route · S6 Agenda read model/route · S7 remind_at · S8 api-client · S9 Agenda UI · S10 mobile fixes) with strict one-writer-per-file ownership, then a seven-agent adversarial audit wave. Main Opus owned all shared/integration files (`packages/core/src/index.ts`, `packages/api-client/src/index.ts`, `apps/api/src/server.ts`, `(tabs)/calendar.tsx`, docs) and every conflict/correctness decision. Local development only; **production untouched; zero migrations**.

### The headline finding: recurring all-day events never expanded ANYWHERE

Open Code reported that recurring all-day instances rendered with the parent's date repeated ("Aug 10, Aug 10, Aug 10"). Independent verification found the defect is **worse than reported** and the reported symptom was unreachable. Three independent layers all key recurrence off `events.starts_at`, which `EventCreateSchema` **forces to be NULL** for a canonical all-day event:

1. `event-range.ts:146` — the recurring-parent SQL predicate `lte(events.startsAt, to)` drops NULL-`starts_at` rows via SQL three-valued logic, so they never reach expansion.
2. `event-range.ts:29` — the private `buildRecurrenceRule` returned `null` when `!row.startsAt`.
3. `expand-due-date-window.ts:114` — the nightly worker's identical guard, plus `events.ts` skipping creation/PATCH materialization and `isValidOccurrence` rejecting detach/cancel.

Net effect: a recurring all-day event was **invisible** in `/events/range`, `/today`, review contexts, Month and Week, and the nightly cron never materialized a single occurrence for it. Not misplaced — absent.

**Fix (ADR-042):** one shared `buildEventRecurrenceRule` in `packages/core/src/recurrence/event-recurrence.ts`, used by all four call sites, anchoring an all-day series' DTSTART at **local noon** derived from `start_date` — the convention already documented on `DueDateRecurrenceRule.dtstart` since Phase 1 but never used by any caller. `starts_at` is still **never** written for an all-day event; the SQL predicate was widened narrowly; and for `is_recurring_instance && all_day` the emitted `start_date`/`end_date` are re-pointed to that instance's actual dates (preserving the template day-span) from `occurrence.occursLocal`, with no UTC round-trip. Timed recurrence is byte-identical.

Because `EventRangeItem`, `TodayEventItem` and `AgendaItem` carry **no per-instance date field**, re-pointing was the only way to express an all-day instance's date without breaking the frozen Agenda response shape. This contradicts the old `EventRangeItemSchema` doc comment, which was rewritten rather than left silently false.

### Open Code findings — verified, rejected, corrected

| Finding | Verdict |
|---|---|
| Agenda response shape should stay frozen | **Confirmed** — and load-bearing (see above) |
| Agenda cap is 62 days; no `project_id` | **Confirmed** |
| Raise cap 62 → 366 | **REJECTED.** Recurring TASK instances exist only as materialized `occurrences`, capped at 90 days by every writer (`WINDOW_DAYS = 90`, hardcoded `90` in POST/PATCH `/tasks`), and there is no on-demand task expansion anywhere. Worse, `AgendaOccurrenceItemSchema` requires a real `occurrence_id` uuid, so a virtual occurrence is **inexpressible** in the frozen contract. A 366-day Agenda would show recurring tasks for ~90 days then silently none, with no `total` field to admit it. Cap set to **90**, matching the materialization horizon exactly (user-approved) |
| Event-range SQL / rule-builder / instance-date defects | **Confirmed**, and broader (above) |
| Use the repo's "local noon" technique | **Confirmed as the repo's own documented, unused convention** |
| AI capture can write malformed all-day rows | **Confirmed** — `commit-parsed-entity.ts` inserts directly via Drizzle, bypassing `EventCreateSchema`, always setting `startsAt` and never `startDate` while passing `all_day` straight from the LLM |
| Calendar sync depends on `EventRangeItem` | **REJECTED** — zero references in `apps/worker` or `packages/calendar-providers`; sync reads `events` rows directly. The projection change is sync-safe |
| Sort: all-day → all events → all tasks | **REJECTED** — type-grouping puts a 15:00 task after an 18:00 meeting. Frozen instead as all-day first, then **chronological interleave across kinds** (user-approved) |

### Also fixed (latent bugs this checkpoint made reachable)

- **Mobile UTC-date bug:** `computeOccurrenceTiming` derived an occurrence's date via `occursAt.slice(0, 10)` — the **UTC** date. With a noon anchor in Pacific/Auckland (UTC+13) local noon is 23:00 UTC the previous day, so it computed the wrong day. Dead code until all-day series could recur; now derives in the event's recurrence timezone via the existing client-safe `resolveInstantToLocalUntil`. Auckland/Chicago/UTC regressions added.
- **AI capture canonicalization:** all-day captures now write canonical `start_date`/`end_date` with `starts_at`/`ends_at` null. This also removes a **live crash**: `calendar-push-event.ts` throws `event ... has all_day=true but no start_date` on the old malformed shape, so AI-captured all-day events could never push to Google/CalDAV. No migration, no backfill (local dev DB verified clean, 0 malformed rows); a read-only production audit is deferred to 5.7.
- **Detach template fallback:** the all-day detach branch fell back to the parent's `start_date`, which would have stamped every detached instance with the series' first date.

### Independent adversarial audit — 7 agents, 3 real defects found and fixed

- **D3-8 (BROKEN):** a timed event with no end is a zero-duration instant; the half-open overlap test degenerates to the empty interval `[start, start)`, so an event starting **exactly at local midnight** matched no day window and vanished from the Agenda entirely. Fixed with point-membership for zero-duration instants (deliberately *not* by relaxing the general test to `>=`, which would duplicate real-duration events ending on a boundary). Two regressions added.
- **D4-4 (BROKEN):** `recurrence_timezone` and `timezone` are independently settable, and the detach handler derived the child's date in the **display** timezone rather than the zone the occurrence instant was generated in — landing a detached all-day child a full day off from the EXDATE recorded against its own parent. Fixed by separating `occurrenceTz` from `targetTz`; regression uses `America/Los_Angeles` + `Pacific/Kiritimati`.
- **D1-8:** `allDayInstanceDates` had no clamp on an inverted parent span (unreachable through the API today, but the shared helper must defend itself — mobile's parallel implementation already clamped). Fixed and pinned.

Audits otherwise CLEAR: `starts_at` never written for all-day; timed recurrence byte-identical; **worker/on-demand parity holds**, and the DST duplicate-occurrence risk was specifically analysed and disproved (the noon anchor sits outside the 1–3 AM transition band, so `resolveWallClockToInstant` is idempotent per calendar date, and the `(parent_type, parent_id, occurs_at)` unique index collapses reruns); shared request-level recurrence budget charged pre-filter with whole-request failure and no partial results; overdue strictly `<`; overdue/days disjoint; events never overdue; recurring dedupe sound including synthetic-parent synthesis; SQL fully parameterized; route perimeter-only; **zero forbidden-file drift**; **zero calendar-provider drift**.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && typecheck && lint && format:check` | Clean workspace-wide |
| 2 | Full uncached suite (`turbo run test --force`) | **993 tests pass, 15/15 tasks** — core 257, db 5, schema 123, calendar-providers **57 (unchanged — zero-drift canary)**, ai-providers 20, api-client 62, api 276, worker 80, mobile 113. Baseline 876 → **+117**, zero regressions |
| 3 | Migration invariant | Exactly 12 `.sql` files, 12 journal entries, no 0012; `db:reconcile --check` reports the tracking table consistent |
| 4 | `git diff --check`, gitleaks | Clean; 63 commits scanned, no leaks |
| 5 | Expo web export | Bundles cleanly (SPA single output) |
| 6 | Live HTTP proof vs dev API | Canonical all-day weekly series expands to **6 distinct instance dates** with `starts_at` null and `occurs_at` = 17:00Z (noon Chicago); identical dates from Auckland/Chicago/UTC (no date shift); 90d accepted / 91d rejected with the exact message; invalid tz and invalid uuid → 400; overdue task in `overdue[]` with **no event ever overdue**; recurring task appears once as an `occurrence` with the parent suppressed; undated task excluded; **chronological interleave proven** (task 20:00 → event 20:30 → occurrence 21:00); project filter returns only the project's item and **survives the project being paused**; multi-day event appears on **all three** overlapping days; detach of the 2026-09-07 instance produced a child at **2026-09-07** (its own date, proving the template-fallback fix) with parent EXDATE `2026-09-07`, cancel removed 09-14, bogus instant → 400, and the series showed 5 items across 5 distinct dates with no template duplicate |
| 7 | `remind_at` lifecycle | set (offset-less 09:00 → 14:00Z, resolved in the task's own timezone) → earlier → later → **unrelated title-only PATCH left it byte-identical** (the property the reconciler's exact-string comparison depends on) → cleared to null |
| 8 | Smoke cleanup | Count-verified twice: 98 + 101 occurrences, 6 events, 8 tasks, 2 projects removed; zero residue, zero orphans; dev DB back to its pre-checkpoint 2 events / 3 tasks |
| 9 | Browser (desktop + 480×640) | Month renders the recurring all-day series on **both Aug 24 and Aug 31** (previously invisible); Agenda shows the 90-day range, OVERDUE with `+1 day`, ALL-DAY first, interleaved rows, long scroll, project filter chips narrowing correctly, and a genuine error state (`Couldn't load the agenda.` + Retry) with recovery confirmed on remount |
| 10 | **Physical Rabbit R1** (side-by-side `.dev` identity) | Three toggle pills measured at **48px** touch targets on real hardware; Agenda live against the dev API through `adb reverse`; range `2026-08-22 – 2026-11-19`; **MON, AUG 31 ALL-DAY showing the second recurring instance at its own date**; recurring occurrences with ⟲/Skip; long scrolling; a **live on-device Skip persisted to Postgres** (occurrence `2026-09-01 16:00+00` → `skipped`) and the now-empty day correctly disappeared from the list |

**Rabbit production safety:** production `com.himal.personalos` evidence identical before and after — versionCode `4`, versionName `1.0.0`, `firstInstallTime 2026-08-19 16:26:10`, `lastUpdateTime 2026-08-21 15:28:16`, dataDir unchanged. The `.dev` package was uninstalled afterward and only production remains. **No production FAB/PTT or physical reminder-alarm claim is made** — those controls are deliberately not mounted in UI-test mode.

### Root cause of the recurring "Rabbit can't reach the dev API" incident — finally diagnosed

Checkpoints 5.1, 5.2 and 5.3 each hit this and each worked around it by hand-patching the generated manifest. The actual cause: **`android.usesCleartextTraffic` is not a valid Expo app-config property** — it was set in `app.config.ts` and silently ignored, and because `android/` is gitignored the hand-patch never showed up in review. The inert property has been removed and replaced with a comment naming the supported fix (`expo-build-properties`, not currently a dependency). Expo SDK 57 API usage was verified against the versioned docs per `apps/mobile/AGENTS.md`.


## Phase 5 Checkpoint 5.5 — Personal OS Daily Brief (COMPLETE, 2026-08-23)

Built with maximum agent parallelism under the approved plan: Wave 0 contract freeze (main Opus), then three parallel implementation waves (DB/migration · AI-provider provenance · core text-bounds · collector · prompt · generation service · api-client · route · Today metadata · mobile card) with strict one-writer-per-file ownership and two read-only Haiku evidence agents, then an eight-agent adversarial audit wave and a targeted fix wave. Main Opus owned every shared/integration file (`packages/schema/src/brief.ts`, `apps/api/src/brief/contracts.ts`, all barrels, `_journal.json`, `apps/api/src/server.ts`, `build-test-app.ts`, the Today screen, docs) and every contract/correctness decision. **Local development only; production untouched.**

### What was built

`POST /briefs` (body `{tz}`) collects a bounded, id-free snapshot of Personal OS state, sends it through the existing provider-agnostic `ai_task_routes` layer as `task_name='daily_brief'`, and — only after the model call fully succeeds — upserts one row per `(brief_date, timezone)`. `GET /briefs/current?tz=` is a pure read that never generates (404 → client-normalized null). `GET /today` now returns real `brief` metadata and still never calls a provider. A Today card renders the prose with Generate/Regenerate and five explicit states. No queue, no cron, no push, no tools, no autonomous behaviour (ADR-041).

**Migration `0012_ai_daily_briefs`** (hand-written, additive, styled on 0011): `ai_daily_briefs` with `brief_date date`, `timezone text`, `content jsonb`, nullable `model_id uuid` → `ai_models(id)` `ON DELETE SET NULL` (a deleted model must not delete history), and `UNIQUE (brief_date, timezone)` — deliberately not `brief_date` alone, since the same instant is a different local date in different zones. Drizzle declares table, unique index and FK so a future `generate` cannot emit a destructive drop (the 5.1 D1 lesson). Migration level is now **0000–0012 = exactly 13**.

**Collector** (`apps/api/src/brief/collect-input.ts`) derives entirely from `buildTodayResponse` rather than re-querying — Today already owns the frozen overdue/due-today/recurring-dedupe semantics, and re-deriving would repeat the duplication `review-contexts.ts` already carries as debt. `buildTodayResponse` gained an **internal-only** optional `now` seam; `TodayQuerySchema` was deliberately left untouched so no HTTP client can pin or spoof the clock.

**Provenance**: `ResolvedModel` gained `modelRowId`/`fallbackModelRowIds` and a new sibling `callWithFallbackTracked` reports which candidate actually served the call, so `model_id` records the real model even when a configured fallback answers. The original `callWithFallback` is byte-unchanged and `capture-parse.ts` was never edited.

### Frozen decisions (ADR-043, extending ADR-041)

Routes `POST /briefs` + `GET /briefs/current` (honoring the already-frozen `BriefRequestSchema`); `TodayResponseSchema.brief` stays metadata-only so multi-KB prose never rides Today's focus-refetch; identity `(brief_date, timezone)` from `localDayWindow(tz, effectiveNow).localDate`, never a UTC slice; **structural** secret exclusion (`BriefInput` is a closed scalar allowlist with no ids/uuids/bodies — a credential is inexpressible, not merely discouraged); server owns the persisted shape (only `{ text }` is stored despite `.passthrough()`); **30 s per attempt under a 45 s whole-chain budget** with a fresh `AbortSignal` per attempt; taxonomy `409 no_provider_configured` / `504 brief_generation_timeout` / `502 brief_generation_failed` / `400 validation_failed`, replied explicitly because `setErrorHandler` only passes 4xx through.

### Adversarial audit wave — four real defects found and fixed

Eight independent read-only auditors (security/leakage, prompt-injection, concurrency/timeout, provenance/fallback, timezone identity, collector bounds, UI/hygiene, forbidden-drift).

1. **Undersized payload ceiling (critical).** The three sections the drop ladder refused to touch (overdue 8 + due_today 10 + events_today 8) reach ~8.6k chars once their capped items also carry real project names and locations — so `MAX_BRIEF_INPUT_CHARS = 6000` made the collector's self-described "unreachable" throw reachable by an ordinary busy day, and because the collector was called outside the route's try/catch it would surface as an **opaque 500**. Fixed three ways: the ladder now also trims whole items from the largest time-critical section as a last resort (totals never touched, so the brief still says "8 overdue, 3 shown"); the ceiling was raised to a measured 12000 (independently re-measured worst case 13,193 → post-drop 8,642 → empty envelope 557, so the throw is now genuinely unreachable); and the route wraps collection so no collector error can ever be an opaque 500 or reach the raw logger. Regression test added covering the exact field combination the original test omitted. **Honest note:** that test passes at both ceilings — the trim ladder is the load-bearing fix; the raise is a quality decision that keeps busy days intact.
2. **Silent `date`-column off-by-one east of UTC (critical, pre-existing and repo-wide).** `pg` parses `date` (oid 1082) into a JS `Date` built in the **process-local** zone, and Drizzle's string-mode column converts it back via `toISOString()`, which reads **UTC**. Any positive-offset server TZ shifts the calendar date back one day, silently (still a valid `YYYY-MM-DD`, so no schema rejects it). Reproduced against real Postgres: `TZ=UTC`/`America/Chicago` correct, `Asia/Kolkata`/`Australia/Sydney` one day early. Production is masked only by `node:22-alpine` defaulting to UTC — an accident, not a guarantee. Fixed at the driver boundary in `packages/db/src/client.ts` with identity type parsers for oid 1082 and the `date[]` oid 1182, which also fixes the same latent bug for `reviews.period_start`, `projects.target_date`, and `events.start_date`/`end_date`.
3. **No-provider state was a dead end.** The card rendered the calm message with no control at all, so after configuring a provider the user could not generate without reloading the app. Added a "Try again" action (default tone — an unconfigured provider is non-fatal, not a failure).
4. **Resolution-phase errors bypassed sanitization.** `resolveModelForTask` sits outside the generation try/catch and can throw plain errors carrying a user-chosen connection label, an internal `ai_models` uuid, or a raw Node crypto error (rotated `CREDENTIALS_ENCRYPTION_KEY`), which reached `request.log.error({ err })` verbatim. Now mapped to the static-message failure error, preserving the module's stated no-raw-error invariant for the resolution phase too.

Audits otherwise CLEAR: no credential structurally reachable from `BriefInput`; role separation with a static system prompt and zero tools; the `<snapshot>` fence proven unbreakable by `JSON.stringify` escaping (now pinned by a test using literal fence markers in a task title); no silent provider fallback; true provenance including the fallback case; upsert target matches the real unique index; concurrency safe under `READ COMMITTED`; abort classification matches what `AbortSignal.timeout` and the installed SDK actually throw; failure never clobbers a cached brief; honest totals survive every cap and drop; **zero forbidden-area drift** (`calendar-providers`, all worker jobs including `capture-parse.ts`, recurrence, reminders, pairing, Docker/Tailscale/production config, migrations 0000–0011 all byte-unchanged); no new dependency anywhere, including no markdown renderer.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Fresh pre-change baseline | **993 tests / 15 tasks**, build+typecheck clean — matched the plan before any edit |
| 2 | `pnpm build && typecheck && lint && format:check` | Clean workspace-wide |
| 3 | Full uncached suite (`turbo run test --force`) | See "Last verification" below; `@personal-os/calendar-providers` unchanged at exactly **57** as the zero-drift canary |
| 4 | Migration proofs | 0011→0012 applied once to dev + test as `posops_migrator`; **13 tracked rows** in both; unique index and `ON DELETE SET NULL` FK verified in `pg_indexes`/`pg_constraint`; disposable fresh DB migrated **0000→0012** to a schema **byte-identical to dev** (358 objects, empty diff) then dropped; `db:reconcile --check` consistent on both DBs; journal guards pass |
| 5 | Role separation of duties | `posops_app` `CREATE TABLE` denied (`42501`) and `ALTER TABLE` denied (must be owner) while INSERT/UPDATE/SELECT succeed; duplicate `(date, tz)` rejected (`23505`) |
| 6 | Live HTTP proof vs a real fake OpenAI-compatible provider (whole stack, real routing + real credential decryption) | no route → **409**; `GET current` → **404**; register route → **200** with prose and `model_id` equal to the registered model; regenerate → **same row id**, `generated_at` advanced; second timezone → **two distinct rows**; provider 500 → **502**, cached brief byte-identical, canary secret absent from body and logs; hung provider → **504 at 31 s**, cache intact; 3 concurrent POSTs → all 200, **exactly one row** |
| 7 | Prompt inspected at the wire | roles `[system, user]`, `max_tokens: 800`, **no `tools`**, **zero UUIDs**, no `sk-`/api_key/token/password/ciphertext substrings, `<snapshot>` fence parses as JSON, payload 1334 chars vs the 12000 ceiling |
| 8 | Today never generates | `GET /today` returned real `{generated_at, model_id}` with **no provider request recorded**, and no `text` field |
| 9 | Browser (desktop + 480×640) | All five card states: empty→Generate, calm no-provider (neutral, Today intact), present with prose + generated time + Regenerate, failed regeneration **keeping the cached prose visible** with inline error + Retry, and recovery on remount; five-tab layout intact at 480×640 |
| 10 | Expo web export | Clean, single-`index.html` SPA output |
| 11 | `git diff --check`, gitleaks | Clean; 69 commits scanned, no leaks |
| 12 | Smoke cleanup | Count-verified: brief rows, fake provider/model/`daily_brief` route and the browser-paired device rows removed; pre-existing `capture_parser`/`voice_transcribe` routes and the real Groq connection left untouched; zero residue |

**Physical Rabbit pass: deliberately deferred to Checkpoint 5.6.** The plan made it optional, and reaching a local dev API from a side-by-side `.dev` build still requires hand-patching the generated Android manifest (the `expo-build-properties` debt recorded in 5.4, which 5.5 was explicitly told not to pull in). Desktop and 480×640 browser evidence is recorded instead; **no physical-device claim is made for the Brief card.**

**No production provider was configured and no paid model call was made** — the entire checkpoint is verified against fake model infrastructure and a local fake OpenAI-compatible server, exactly as the plan required. Production `daily_brief` registration remains deferred to Checkpoint 5.7.

## Phase 5 Checkpoint 5.6 — Mobile / Rabbit daily-use polish (COMPLETE, 2026-08-23)

Built with maximum agent parallelism: a three-agent read-only planning wave, a Wave 0 contract freeze owned by main Opus, ten parallel single-file-ownership writers, then a three-agent adversarial audit wave and a main-session fix wave. **Local development only; production untouched; zero migrations (level stays 0000–0012 = 13).**

The physical Rabbit R1 matrix was run on the real device via the side-by-side `com.himal.personalos.dev` identity. **Production `com.himal.personalos` was never installed over, uninstalled, cleared, paired, or mutated — its versionCode 4 / versionName 1.0.0 / firstInstallTime 2026-08-19 16:26:10 / lastUpdateTime 2026-08-21 15:28:16 / dataDir are byte-identical before and after**, and only the production package remained installed at the end.

### The headline: the dev harness is reproducible in tracked config

`expo-build-properties@~57.0.13` (exactly one new dependency, installed via `npx expo install` so it is SDK-matched) supplies `android.usesCleartextTraffic` for the **UI-test profile only**, via the same conditional-plugin idiom `app.config.ts` already used for `expo-audio`/`expo-notifications`. `apps/mobile/package.json` gained `android:ui-test`, so the build incantation no longer lives only as prose in this file.

Production non-impact was **proved, not asserted**, by clean prebuilds of both identities:

| Check | Result |
|---|---|
| Production `AndroidManifest.xml` | **no `usesCleartextTraffic` attribute** |
| Production prebuild re-run | manifest **byte-identical** to the first run (deterministic) |
| `gradle.properties`, `proguard-rules.pro` | **byte-identical between the two identities** — the plugin wrote nothing beyond the one manifest attribute |
| Full manifest diff (prod vs ui-test) | exactly cleartext + scheme + the expo-audio permissions/service the dev build already omitted. **No unexpected delta** |
| Plugin output vs the old hand-patch | identical apart from attribute ordering within the `<application>` tag |
| Lockfile | exactly **one** package added, **zero** versions removed or changed (the rest of the diff is pnpm re-keying peer hashes) |

**Two hazards caught during execution that the plan had not anticipated:**

1. **The Checkpoint 5.1–5.4 cleartext hand-patch was never actually reverted.** `apps/mobile/android/app/src/main/AndroidManifest.xml` still carried `usesCleartextTraffic="true"` in the gitignored generated tree, contradicting this file's own claim (now corrected below). Any verification run against that tree would have been a **false positive**, so the tree was deleted and every proof above used `expo prebuild --clean`.
2. **`android/app/debug.keystore` signs the dev build and its SHA-1 is the one registered with the Google OAuth Android client** (Checkpoint 4.5 Stage A). It was preserved outside the repo before deletion. It then turned out Expo ships a fixed template debug keystore, so the regenerated file has the identical SHA-1 (`5E:8F:…F6:25`) and the OAuth registration was never at risk — the precaution proved unnecessary, recorded honestly rather than presented as a save.

**Additional hardening beyond the plan:** an audit noted the one link repo inspection cannot see — EAS's dashboard could in principle set `EXPO_PUBLIC_UI_TEST_MODE` for the `production` environment. `app.config.ts` now **throws at config-resolution time** if the UI-test flag is combined with an `EAS_BUILD_PROFILE` starting with `production`, turning an unverifiable trust assumption into a hard build failure. Verified: the guard fires on that combination, while a normal production build (`com.himal.personalos`, no build-properties) and a normal UI-test build (`com.himal.personalos.dev`, build-properties present) both resolve correctly.

### Dev-identity parity (approved amendment)

`UiTestContent` previously declared 3 of 13 stack routes and mounted neither floating control, which is precisely why FAB/PTT clearance had never been verified on hardware. It now shares one `AppStack` route table with production and mounts a **live** `QuickAddFab` plus `PttButton layoutOnly`.

`layoutOnly` is a **component split, not a flag inside the hook**: `usePttRecorder` calls `useAudioRecorder` at mount, which constructs a native recorder, and the dev build ships no expo-audio plugin and therefore no `RECORD_AUDIO`. An independent audit confirmed no code path reaches `useAudioRecorder` in layout-only mode. Still absent from the dev shell: pairing/device identity, reminder reconciliation, notification lifecycle, push-token registration, background outbox flushing, EAS projectId, `google-services.json`.

New `assertUiTestPackageIsolation` fails fast at module load if the JS bundle's UI-test flag disagrees with the native `applicationId` — the one path by which the two identities could collide, since `device-identity/storage.ts` uses the **same SecureStore key names** in both builds and isolation rests entirely on the differing Android package. An audit separately confirmed `assertUiTestApiIsolation` is fail-closed against every case tried, including the real production Tailscale hostname and its `100.64.0.0/10` CGNAT address.

### Correctness defects found and fixed

1. **Notification cold start was unhandled.** `use-notification-lifecycle.ts` used only `addNotificationResponseReceivedListener`, which the SDK 57 docs state is insufficient for a tap that launches a killed app — and `ProductionContent` gates rendering on loading + pairing, so the subscription landed late. Replaced with `useLastNotificationResponse()`, plus a once-only guard keyed on the notification's stable `identifier`. Reading the installed source also surfaced that the hook **cannot be called at all on web** (expo-notifications has no web implementation of `getLastNotificationResponse`), so the platform branch selects *which function* to call at module scope, keeping hook order constant.
2. **A live all-day date off-by-one, above the Checkpoint 5.5 driver-boundary fix.** Seeding all-day dates from `params.startsAt?.slice(0, 10)` read the **UTC** date of a local wall-clock slot. Tapping a timed slot then flipping All-day on created the event one day late in negative-offset zones and one day early in positive-offset ones. **Mutation-tested**: reintroducing the bug fails with `expected '2026-08-24' to be '2026-08-23'`; the fix passes under Chicago, Auckland, UTC, Kolkata and Kiritimati.
3. **Two CRITICAL review-save races** (found by adversarial audit, one of them introduced by this checkpoint's own first attempt at a fix). The initial per-toggle rollback-on-error was **unsound**: with two rapid toggles of the same key both failing, the guarded revert could settle on a value never persisted, and the screen cannot self-heal because the flow is keyed by `review.id` and seeds state once. Separately — and pre-existing since 5.3 — the PATCH body is the **whole** content object with no request sequencing, so a slower earlier request could silently overwrite a newer successful one server-side. Both fixed by **serializing saves through a promise chain and building each body at send time from the latest state**, and deliberately abandoning per-key rollback: a review checkbox that silently unchecks itself is a worse failure than one that says it has not saved yet.
4. **A test file inside Expo Router's routes directory broke the web build.** A colocated `src/app/events/new.test.ts` became a route, so Metro bundled it and its `vitest` import dragged Node-only `vite` into the web bundle — `expo export --platform web` failed with an opaque `Invalid call at line 1018: import(filepath)`, while typecheck, lint and the whole test suite stayed green. **A writing agent reported this as a "pre-existing bundler issue"; it was not** — the pristine baseline exports cleanly, verified by stashing all work and re-running. The helper moved to `src/utils/all-day-seed.ts`, and a permanent `routes-hygiene` guard now fails loudly and names any test file under `src/app` (verified by planting one).

### Polish delivered

FAB/PTT geometry frozen in `components/floating-layout.ts` and lowered from `bottom-40` (a stale offset tuned for a "New task" button that Checkpoint 5.1 moved to `/tasks`) to `bottom-20`; **every** scroll container now pads to clear them — including the eight create/edit forms and Settings, which no writer owned and which an audit caught still unpadded. Those same forms gained `keyboardShouldPersistTaps="handled"`, fixing the two-tap submit problem (most concretely on Settings' CalDAV connect form). `SafeAreaProvider` is mounted at the root for the first time — `quick-add-fab.tsx` had consumed `SafeAreaView` from `react-native-safe-area-context` since Phase 3 with the provider never mounted, so those insets silently resolved to zero. Pairing screen made scrollable and keyboard-safe. Touch targets raised to ≥44px effective across Today, Agenda, Projects, Reviews, Brief, Calendar, Tasks, Inbox and Notes — the worst being the Projects task-completion circle at 24px with no hitSlop. Press-bleed guards added where a nested action Pressable sat inside a navigating row (Today's completion checkbox, the Tasks list's Start/Done/Drop/Archive, Notes archive, Projects unarchive). Brief prose clamped to 6 lines with a measured (`onTextLayout`, not string-length) expand/collapse that resets when the text changes. Outbox pending/failed badge added to the FAB, since that backlog was previously visible only in Settings. Five duplicated `parseLocalDate`/`formatTargetDate` copies replaced by one tested `utils/local-date` module.

**Cross-agent inconsistencies caught by the integrator and reconciled:** two writers picked different time-gutter widths (80px vs 96px) for identical `HH:MM–HH:MM` content — 80px would have wrapped to two lines on Today, so both are now 96px; and the same event title used `numberOfLines={1}` on Today but `{2}` on Agenda, giving one event two row heights.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Fresh pre-change baseline | **exactly 1099 tests / 15 tasks**, matching the record before any edit |
| 2 | `pnpm build && typecheck && lint && format:check` | Clean workspace-wide |
| 3 | Full uncached suite (`turbo run test --force`) | **1154 tests / 15 tasks** (+55, all in mobile: 132 → 187). Server-side packages byte-identical: core 271, db 14, ai-providers 25, schema 123, api-client 70, api 327, worker 80, and **`calendar-providers` unchanged at exactly 57** as the zero-drift canary |
| 4 | Migration invariant | **13 `.sql` files, 13 journal entries, no 0013** |
| 5 | Forbidden-area drift | **Zero** across `packages/db/drizzle`, `apps/worker`, `apps/api`, `packages/calendar-providers`, `packages/core`, Docker/Compose, `eas.json`, `apps/mobile/plugins`, `apps/mobile/modules`, `google-services.json` |
| 6 | Clean prebuild proofs | Both identities; production cleartext-free and deterministic (see table above) |
| 7 | `expo export --platform web` | Clean, single-`index.html` SPA output — after diagnosing and fixing the routes-directory breakage |
| 8 | Timezone sweep | `local-date` and `all-day-seed` suites pass under UTC, America/Chicago, Pacific/Auckland, Asia/Kolkata, Pacific/Kiritimati |
| 9 | Mutation testing | The all-day fix and the routes-hygiene guard were both proved to FAIL when their defect is reintroduced |
| 10 | Lint warnings | 3 remain, **all pre-existing** — verified by stashing all work and re-running (baseline also reports 3) |
| 11 | `git diff --check`, gitleaks | Clean; 74 commits scanned, no leaks |

Three independent adversarial auditors ran on the finished tree (native/production isolation; interaction correctness; layout/touch/keyboard). Their findings drove the fix wave above.

### Physical Rabbit R1 verification (480x640, dev identity only)

**The headline proof:** `pnpm --filter mobile android:ui-test` built and installed `com.himal.personalos.dev`, which reached the local dev API over `adb reverse` **with zero hand-edits to the generated AndroidManifest.xml** — the API log recorded device-originated `GET /today?tz=America/Chicago` and `GET /briefs/current`. Production's generated manifest carries no cleartext attribute; the dev one gets it purely from tracked config.

| Area | Result |
|---|---|
| Dev/prod isolation | Both packages side-by-side; production evidence identical before/after; `.dev` uninstalled afterward |
| Five tabs | Today / Inbox / Notes / Projects / Calendar all render and switch (verified twice around) |
| Stack routes | `/tasks`, task detail, project detail, **Daily review**, **Weekly review**, event detail, new event, Settings — all resolve with correct titles (the review titles now come from the root layout, proving the inline-`Stack.Screen` refactor) |
| FAB / PTT | Both mounted; PTT carries `Push to talk (layout only)`; no horizontal overlap (x 25-83 vs 397-455); 14px clear of the tab bar; **at max scroll on Today, Agenda, Projects, Notes, Tasks and both reviews the only things in the button band are the buttons themselves** |
| PTT inertness | `RECORD_AUDIO` **not declared**; 3 taps produced no permission dialog, zero audio activity in logcat, zero `/transcribe` calls |
| Quick Capture (online) | Exactly one `/capture`, exactly one row, **`source = "web"`** — the frozen entry-path rule verified on a native device |
| Offline / outbox | API process stopped (removing `adb reverse` alone is unreliable — an established keep-alive socket survives it, as Checkpoint 5 recorded); "Saved offline" → badge "1 capture waiting" → force-stop + relaunch (badge survived) → API restored → Flush now → "Flushed 1, 0 pending" → **exactly one server row**, badge cleared |
| Review saves | Normal save persisted; **5 rapid toggles ended with server and UI agreeing exactly** (`inbox:false`), proving serialization; API killed mid-toggle → error banner, intent kept on screen, no false "saved"; reconnect → coherent |
| Weekly review | Start + toggle persisted with correct Monday period and `kind` discriminator |
| Notification routes | Both resolver targets resolve physically: `/tasks/<id>` → Task detail, Inbox tab → Inbox. **Physical push delivery is NOT claimed** (the dev build ships no notifications capability) |
| Date-only, America/Chicago | Today header "Sunday, August 23"; target date 2026-08-31; **timed 19:00 slot → All-day ON seeded 2026-08-23** (pre-fix: 2026-08-24) |
| Date-only, Pacific/Auckland | Today header "Monday, August 24"; weekly period rolled to Aug 24; target date unshifted; **06:00 slot → All-day ON seeded 2026-08-24** (pre-fix: 2026-08-23) — the mirror case. Device timezone restored afterward |
| Daily Brief | No-provider path returns **409** with the calm message and a working "Try again"; a locally seeded long brief clamped to 126px (6 lines) with Show more → 283px → Show less; **no paid model call** |
| Calendar | Month, Week and Agenda all render; Agenda shows the 90-day range, project filter, and the all-day event on its correct date |
| Keyboard | Quick Capture submits with the keyboard up; on Daily Review a **single tap on "Complete review" with the keyboard open completed the review** |
| Touch targets | Sweep found no clickable under 44px on the exercised screens; calendar "Jump to today" 53px; lifecycle buttons 52px; view pills 47px |

### Device-only defects found and fixed (none were visible to CI)

1. **`android:ui-test` could build and try to install the PRODUCTION package over the real app.** `expo run:android` reuses an existing generated `android/`; with the tree last prebuilt for production it produced `com.himal.personalos` despite the UI-test env var. Only Android's signature check stopped the install — luck, not design. Replaced the script with `apps/mobile/scripts/run-ui-test-android.sh`, which always prebuilds for this identity and then **hard-asserts the generated applicationId before anything touches the device**.
2. **The app froze after a few taps.** The new FAB outbox badge polled SQLite every 5s from a globally-mounted component; on this low-end device that starved the JS thread until the UI stopped responding. Proven by bisection on-device (polling off → navigation fine; on → frozen). The badge is now **event-driven**, refreshed by `["outbox"]` invalidation from capture and flush, which is exactly when the count can change.
3. **The in-flow "New task/note/project" CTA sat underneath the floating buttons.** `FLOATING_CLEARANCE` pads a scroll container's *content*; the CTA is a sibling pinned near the bottom, so it was never moved. Fixed with two derived constants — `FLOATING_CTA_CLEARANCE` for tab screens and `FLOATING_CTA_CLEARANCE_NO_TABBAR` for pushed stack routes, which need more because no tab bar absorbs part of the offset.
4. **Review Complete/Skip were unreachable with the keyboard open.** The app window does not resize for the IME, whose `touchableRegion` was measured as `(0,238,480,640)` — it swallows every touch below y=238, so `keyboardShouldPersistTaps` cannot help and scrolling could not lift the controls. Fixed by reusing the repo's own measured-keyboard-height technique (extracted to `use-keyboard-height.ts`) to pad the scroll containers.
5. **The floating buttons overlapped the tab bar by 3px** at the original offset; raised from `bottom-20` to `bottom-24`, measured clear by 14px.

### Debt recorded, deliberately not fixed

- **Physical reminder-alarm verification remains impossible on the dev identity** (no pairing, no expo-notifications plugin) and production is out of scope — deferred to 5.7, per the approved amendment. 5.6 substituted 18 automated tests covering the previously-untested `useReminderReconciliation` paths (ineligible-cancel, 401, and the load-bearing "generic fetch failure preserves alarms" rule) plus the full `remind_at` lifecycle.
- The reminder-hook tests use a **hand-rolled React hooks harness** (no renderer is installed). An audit judged it faithful for this module's fixed-order hooks but found two real gaps: stale `AppState` listeners accumulate across tests (inert today, would corrupt results the moment the foreground-triggered path is tested — which is itself untested), and its `useState` applies eagerly rather than batching.
- No Retry affordance on the error states of Tasks, Projects, Notes, Inbox, Calendar and Settings (Today/Agenda/Reviews have one).
- No `KeyboardAvoidingView` anywhere; 5.6 added only `keyboardShouldPersistTaps`. `adjustResize` covers the ScrollView cases.
- Agenda standardized on `min-h-[40px]`+hitSlop while every other screen uses `min-h-[44px]`; both clear 44 effective, but the row density differs.
- The left PTT button's x-band (24–80) still overlaps the completion-checkbox column (16–48); whether real rows land in that band needs the physical pass.
- `source: "app"` enum member still requires a migration — see the reclassification above and the new capture-source section in `ARCHITECTURE.md`.
- Worth one manual check before the next production build: that `EXPO_PUBLIC_UI_TEST_MODE` is not set on the EAS dashboard for the `production` environment. The new config guard now fails the build if it is.

## Phase 5 Checkpoint 5.7 — Production deployment + Phase 5 closure (COMPLETE, 2026-08-24)

Executed under the approved gate sequence A–M with five explicit user-approval stops
(migrations, APK install, `daily_brief` route, Rabbit reboot, host reboot). Main Opus was
the sole production mutation owner throughout; every production command was issued from the
integration session, never delegated. **Phase 5 is now live in production.**

### Release lineage — one source commit for every component

`main` was fast-forwarded from `c25e13a` to `efd466a` (all **seven** Checkpoint 5.6 commits;
the prior record said six). Gate A then found a real, latent, test-only defect that had to be
fixed to obtain a green baseline, so the release source is **`656c1fc`** = `efd466a` + that one
commit. API, worker, web and the Android APK all derive from `656c1fc`. Unlike Checkpoint 4.7,
no component comes from a different commit.

**The Gate A defect (test-only, no production code):** `apps/api/src/routes/agenda.test.ts`'s
"all-day events first, then everyone else interleaved" test seeded its fixture on *today's*
window including a task at dayStart+15h. Once the suite runs after 15:00 local that task
satisfies `due_at < effectiveNow` and is correctly routed to `overdue[]` rather than the day's
items, so the assertion failed purely as a function of wall-clock time. The product was behaving
exactly per frozen ADR-038 semantics — only the *task* disappeared, because events are never
overdue. Latent since Checkpoint 5.4 and never caught because every prior baseline happened to
run before 15:00. Fixed by seeding a future day (the `futureDayWindow` idiom its neighbours
already use). Suite total unchanged at 1154. **This also means 5.6's recorded 1154-pass baseline
was a pre-15:00 run.**

### Two corrections to the approved plan, both caught before any production mutation

1. **The plan's "migrate first, then build" ordering would have silently no-opped.** The
   migration runs *from the api image*, and the deployed image contained only migrations
   0000–0009 — the command would have applied **nothing** and still reported
   `migrations applied successfully`, leaving production at 0009 while appearing to succeed.
   Caught by inspecting the running image's `/repo/packages/db/drizzle` directly. Corrected to
   build first (which does not touch running containers), then migrate from the new image.
2. **Deployment uses a per-release source directory.** The host carries *two* trees:
   `/home/himallinux/personal-os` holds the real `.env` but is **stale Phase 3 source**
   (migrations only to 0004, no `events.ts`), while Checkpoint 4.7 actually built from
   `/home/himallinux/personal-os-4.7-release`. This is why the frozen safety rule pins
   `--env-file /home/himallinux/personal-os/.env`. Checkpoint 5.7 shipped `656c1fc` via
   `git archive` into a **new** `/home/himallinux/personal-os-5.7-release` (472 tracked files,
   verified free of `.env`, `google-services.json`, generated `android/`, `node_modules`).
   This eliminated the Checkpoint 4.7 `rsync --delete` deletion-manifest hazard entirely and
   left the 4.7 tree intact as a rollback source.

### Component lineage

| Component | Source | Image / artifact | Container |
|---|---|---|---|
| api | `656c1fc` | `sha256:833ecb08f8fde48501859cc8861b72824c421719f672ab58a274c8f382a1a235` | `d2ce2818cf7d` |
| worker | `656c1fc` | `sha256:bb0f3ec47631023cd93a23f88d968c12092d6c7f6ba82ea8138d653898b3a98e` | `78d47c492a07` |
| web | `656c1fc` | `sha256:ada43d9e133b5e56539af0b88eb09f9fa455acb6adcf6dca3c8f97867de658c5` | `d761de8456c6` |
| postgres | unchanged | `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168` | `404de24ef86b` |
| Android | `656c1fc` | EAS `66669534-9cc1-4999-b90f-e72245b3ca26`, APK SHA-256 `39ae353feff867f2feee5f6ec735ad613268002cd326b5c1b4187934258b513a` | versionCode 5 |

Rollback tags `personal-os-{api,worker,web}:pre-phase5` were created **by image digest** from the
exact serving images (`51f14ae98178`, `14f58997fd29`, `18b74c818966`) before any build. Because
all three migrations are additive, those Phase 4 images run correctly against the 0012 schema —
that is what makes the server rollback real. Mobile recovery is forward-only (same key,
versionCode > 5); never a downgrade or uninstall.

### Migrations (Gate D)

| Tag | SHA-256 | journal `when` |
|---|---|---|
| `0010_project_lifecycle` | `00a4bcb994c384165f3f0f54bc6b3926572389ad9a2ac01e519ddb3ce0b6a3fc` | 1787362339000 |
| `0011_review_history` | `7a2b45f4bebbba8dc66adf82a7e984df601b747e5961c2ccc57ae991680dc78e` | 1787398945193 |
| `0012_ai_daily_briefs` | `33c6d041400ccb95308d6e017998f00b32d2a7eb9c6d4beffdcfb644bc5b988d` | 1787466808983 |

Production went **10 tracking rows (watermark 1787268000000) → 13**, the three new rows carrying
the exact journal `when` values rather than wall-clock, with no replay of 0000–0009. The one
identified hazard — `0010`'s `projects_status` CHECK validates every existing row — was cleared
by a read-only preflight showing `projects` was **empty (0 rows, 0 violations)**. A Gate C
rehearsal on a disposable database seeded to production's exact watermark proved the arithmetic
first, including that `'archived'` is rejected and that duplicate `(brief_date, timezone)` is
rejected while the same date in a different timezone yields a separate row.

**The Checkpoint 4.7 Gate C incident did not recur.** Postgres kept container `404de24ef86b`,
its image digest, its start time `2026-08-21T22:02:03.921869141Z` and `restarts=0` across
migration, both rollout steps and every subsequent gate; both volumes kept their original
creation timestamps (`postgres_data` 2026-08-15, `audio_data` 2026-08-19). Every compose command
pinned `-p personal-os`, `--env-file`, both compose files, and `--no-deps`, and never named
`postgres`.

**A pre-existing discrepancy recorded honestly:** the Checkpoint 4.7 record lists the postgres
container as `bf484f07d7ef…`; at Gate B it was already `404de24ef86b…` (same image, same original
volume). Postgres was therefore recreated at some point *after* that record was written and
before Checkpoint 5.7 began. Not caused by this checkpoint; the Gate B baseline was used as the
invariant instead of the stale documented value.

### Server verification (Gate F)

`/today` returned **404 before the rollout and 200 after** — direct proof Phase 5 went live.
Agenda enforces its 90-day cap (91 → `400 range must not exceed 90 days`); invalid tz and invalid
uuid both 400. Worker restarted clean with all five schedules, all queues listening and **zero
brief queues and zero brief crons** — the ADR-041 invariant verified in production, not merely in
source. Zero secret matches in api/worker logs, bindings identical to baseline, Postgres
unpublished, Serve tailnet-only with no Funnel. CORS advertises GET/HEAD/POST/PATCH/DELETE to the
approved origin and returns no `allow-origin` to an unapproved one.

**`POST /briefs` returned `409 no_provider_configured` before the route existed** — the ADR-041
graceful-degradation path captured in production as evidence.

**Not verified, stated rather than claimed:** the real-browser CORS proof. The Chrome extension
was not connected and the sandboxed browser pane cannot load `/_expo/static/*` on the
non-standard `:8443` port (the documented Phase 2 limitation). curl proved the exact header
contract, the deployed bundle audit is clean, and `WEB_APP_ORIGIN` plus the compose file are
byte-identical to the Phase 4 state that *was* browser-verified — but no browser exercised it
this pass.

### APK audit (Gate G) — Category A adjudicated fresh, not inherited

Profile `production-internal` with `--freeze-credentials`; versionCode derived remotely
(4 → **5**). Signer SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`
(SHA-1 `7eac1aa400ac4450c322fb0936d240cd292eeae8`) — identical to the installed production signer.

Manifest carries **no `usesCleartextTraffic`** (5.6's dev-only plugin correctly absent), is not
debuggable, uses scheme `mobile`, and declares RECORD_AUDIO / SCHEDULE_EXACT_ALARM /
RECEIVE_BOOT_COMPLETED / POST_NOTIFICATIONS. Bundle is Hermes bytecode, Expo Updates disabled,
zero dev-launcher/menu/client entries, production API URL present, **`localhost:3000` absent**
(proving EAS supplied `EXPO_PUBLIC_API_URL`), and no `EXPO_TOKEN`, OAuth secret or private key.

The single `http://localhost:8081` literal was traced **fresh for this APK hash** to React Native
0.86.2 `Libraries/Core/Devtools/getDevServer.js:15` (`const FALLBACK`), with `apps/mobile/src`
containing zero `8081` references. Checkpoint 6's exception was deliberately **not** reused.
Two further string hits were adjudicated as Hermes packed-string-table artifacts: the `sk-` match
is the tail of `expo-tab-task----ExpoFetchFormBoundary` (from `task-`), and neither is a key value.

**The EAS environment gap identified in planning was closed by verification, not assumption:** no
build profile declares an `env` block and `queries/client.ts` falls back to `http://localhost:3000`,
so the EAS `production` environment was inspected read-only and confirmed to hold exactly
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_SERVICES_JSON`, with
**`EXPO_PUBLIC_UI_TEST_MODE` absent**.

### Rabbit upgrade (Gate H)

A four-condition guard (package, signer, versionCode > installed, production profile at the
release commit) was re-evaluated against the live device immediately before `adb install -r`.
Post-install: versionCode 4 → **5**, `firstInstallTime` **unchanged** at `2026-08-19 16:26:10`
(proving update, not reinstall), `lastUpdateTime` advanced, dataDir unchanged, only the
production package installed.

**No pairing screen, same device row `c6c0b43d-2eed-41f4-8ee1-4c1aff65bc61`, PRIMARY preserved,
push token preserved, `last_seen_at` refreshed immediately** — the SecureStore credential survived
the update. The production Google Calendar connection was still present in Settings.

### Physical verification (Gate I) — both items deferred from 5.6 are now closed

**FAB/PTT on the production identity** (which 5.6 could not do, since its dev shell mounts PTT
only in `layoutOnly` mode): PTT `[25,482][83,540]` and FAB `[397,482][455,540]`, both 58px,
314px apart, 14px clear of the tab bar. **At max scroll on Today the only clickable elements in
the y482–540 band are the two buttons themselves** — this closes 5.6's open question about the
left PTT x-band overlapping the completion-checkbox column.

**Reminder — real fire.** `remind_at` 03:47 produced exactly one alarm at `window=0
exactAllowReason=permission`; moving it to 03:48 removed handle `543a616` and left exactly one
new handle `33a76a1`, still exact. It **fired while the app was backgrounded** at
`when=1787561280096` = **03:48:00.096 CDT — 96 ms after the scheduled instant**, posting exactly
one notification on channel `reminders` at importance 5 titled with the task name, consuming the
alarm, and **tapping it opened the correct task detail**.

> **ROM inconsistency re-confirmed:** `dumpsys package` reports `SCHEDULE_EXACT_ALARM
> granted=false` while the scheduled alarm reports `exactAllowReason=permission` and delivers
> exactly. This matches the Checkpoint 5 finding that the ROM's package/app-op report is
> internally inconsistent and the alarm plus actual delivery are the deciding evidence. No user
> action was required. An earlier advance warning in this session that a grant would be needed
> was based on the package report and is corrected here.

**Push.** One bounded `alert` was enqueued through the real `notifications.dispatch` worker path
(the Settings screen ships no test-notification control, and the device bearer token is
deliberately unreadable from SecureStore). Dispatch log recorded `accepted` with Expo ticket
`01a032fa-a5e9-7269-a010-431d9e24b539` and no error, and the notification was **physically
present on the device**, exactly one, with the tap routing correctly. Per ADR-030 the ticket
proves acceptance only; the device-side record is the delivery proof.

**PTT.** One real capture ran the full production chain — Rabbit mic → `/transcribe` → shared
audio volume → Groq `whisper-large-v3-turbo` → transcript → gpt-4.1 `capture_parser` → committed
entity. Inbox `cb7415d1…` reached `status=parsed` with a **real Groq `avg_logprob` of
`-0.5232116`** propagated, `audio_path` cleared, `/data/audio` empty, exactly one `/transcribe`
request and no duplicate. Driven by ambient audio rather than dictated speech — recorded honestly.

**Capture/parser observation:** two deliberately ambiguous captures (including bare `asdf`) both
parsed confidently as notes and never reached `needs_confirm`. Production gpt-4.1 is more decisive
than the dev model Phase 3 used. Model behaviour, not a defect — the same class of observation
Checkpoint 4 recorded.

**Core Phase 5 smokes** all passed against production: project pause→resume→complete→reopen with
`completed_at` set and cleared, 409 on an invalid transition, computed `next_action`/`stalled`/
counts; `remind_at` PATCH lifecycle with a title-only PATCH leaving it **byte-identical**; daily
review create → duplicate-returns-same-row → content v1 with kind binding → 400 on kind mismatch
→ summary → complete, reflected in `/today`'s derived state; and **ADR-042 verified in production**
— a recurring all-day weekly series expanded to 4 distinct dates each carrying its own
`start_date`, a series that was invisible everywhere before Checkpoint 5.4.

### Daily Brief production route (Gate J)

Registered with a **single** `POST /ai/task-routes` reusing the existing gpt-4.1 model row
`313633f4-2c52-4a06-a696-4f7740a95f28` — no new provider connection, no new model row, no
fallback, no credential handling. Verified afterward: providers still 2 and models still 2,
`capture_parser` and `voice_transcribe` byte-unchanged, and `/today` still makes no provider call.

Generation returned HTTP 200 in ~4 s with `brief_date=2026-08-24` (the correct local calendar
date), 707 characters of prose accurately narrating real state, and `model_id` equal to the
gpt-4.1 row that **actually served** the call. `ai_daily_briefs` held exactly one row, proving the
`(brief_date, timezone)` upsert; `/today` returned brief **metadata only with no `text` field**;
and no brief queue or cron was created.

**Honest accounting:** two `POST /briefs` calls were issued, not one — a duplicated `curl` line in
the operator's own command, not a planned regenerate. The second upserted the first, which is why
exactly one row existed; the upsert is proven by that accident and no third call was made.

**There is no DELETE endpoint for task routes.** Returning to the no-provider state requires
another upsert repointing `primary_model_id`, or direct SQL.

### Reboot survival (Gates K and L) — both axes passed

**Rabbit:** one normal reboot with **no manual app launch and no manual Tailscale start**. Fresh
boot confirmed (uptime 1 min); `tun0` came up and `IPNService` ran on their own; MagicDNS resolved
and the device pinged the server; versionCode 5, `firstInstallTime` and `lastUpdateTime` all
unchanged; **no pairing screen**; Today rendered live production data including the **Daily Brief
card with a working Show more/Show less clamp**; Calendar rendered Month/Week/Agenda; device row
still PRIMARY with a fresh `last_seen_at`; crash buffer clean.

**Ubuntu host:** one normal reboot (issued by the user — `sudo reboot` needs their password).
Host down 04:34:57, back 04:35:37, fresh boot 04:35:23. All four containers auto-started with
**identical container IDs and identical image digests**, `restarts=0`; both volume identities
unchanged; migration level still exactly 13; 5 schedules; queues drained; heartbeat fresh within
seconds; Serve tailnet-only on both ports; bindings identical; Postgres still unpublished; and the
**Rabbit reconnected with no manual repair** (0% packet loss, ~14 ms). The worker's 54 log error
entries were all timestamped in the shutdown window (`terminating connection due to administrator
command`, `getaddrinfo EAI_AGAIN postgres`) and **zero errors occurred after the post-reboot
`pg-boss started`** — correct graceful-shutdown behaviour, verified rather than assumed.

### Defect found in production — recorded, deliberately not fixed mid-deployment

**ADR-042's local-noon anchor surfaces as a real clock time for recurring all-day events.** One
root cause, two surfaces:

1. `apps/mobile/src/app/(tabs)/index.tsx:155` — `EventRow`'s `timeRange` fallback chain never
   checks `event.all_day`. A canonical all-day event has `starts_at = null` (ADR-042), so a
   **recurring instance** falls through to `occurs_at` (the noon anchor) and renders **`12:00`**.
2. `apps/api/src/brief/collect-input.ts:72` — `eventEffectiveStart` returns
   `item.occurs_at ?? item.starts_at`, so the **model is handed the noon anchor as a real start
   time**. The production brief prose literally read *"an all-day weekly event beginning at
   12:00 PM"* while the non-recurring all-day event was correctly *"start time not specified"*.

Proven side by side on the device: `'12:00, P57-SMOKE all-day weekly'` versus
`'All-day, P57-SMOKE all-day single'`. Dates are correct everywhere and Agenda grouping is
correct, so this is **not** data corruption — but the AI narrating a wrong time is more than a
display nit, and this entry deliberately upgrades an initial "cosmetic" assessment made earlier in
the session. Newly reachable because recurring all-day events did not render at all before
Checkpoint 5.4. Not fixed during deployment because it would require a new image, a new EAS build
and install, and a release-lineage change.

### Smoke data

All smoke rows carried a `P57-SMOKE` prefix and were removed in one count-verified transaction:
4 occurrences, 3 inbox items, 3 notes, 3 events, 1 task, 1 project, 1 review, 1 brief. Post-purge
scans showed **zero residue, zero orphan occurrences and zero orphan `event_external_links`**, and
preserved production data matched the Gate B baseline exactly (2 tasks, 3 notes, 6 inbox items,
2 devices, 0 projects, 0 events, 13 tracking rows).

The generated brief was **deleted** rather than kept: it narrated the now-deleted smoke rows, so
retaining it would have been misleading. It regenerates on demand with one tap. The
`daily_brief` route itself is retained — it is real configuration, not smoke. Notification
dispatch history was preserved as audit lineage, consistent with the Checkpoint 6 precedent.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Gate A release gate at `656c1fc` | build/typecheck/lint/format clean; **1154 tests / 15 turbo tasks**; `calendar-providers` exactly **57**; 13 migrations / 13 journal entries; `git diff --check` clean; gitleaks 81 commits, no leaks; single-`index.html` SPA export |
| 2 | Lint warnings | **0** — better than 5.6's recorded 3; recorded as an improvement rather than silently accepted |
| 3 | Gate B read-only preflight | Every expected value matched: watermark `1787268000000`, `projects` empty, signer `4601e3a2…`, sole PRIMARY, 5 schedules, no `daily_brief` |
| 4 | Gate C disposable rehearsal | Exactly 0010–0012 applied at production's watermark, 10→13, no replay; constraints/indexes/FK verified; `'archived'` and duplicate `(date,tz)` both rejected; re-run a clean no-op; DB destroyed |
| 5 | Gate D production migrations | 13 rows, exact journal `when` values, all Phase 5 objects present, `posops_app` DDL denied (`42501` / must be owner) while DML succeeds, Postgres untouched |
| 6 | Gate E rollout | api+worker then web, all `--no-deps --no-build --force-recreate`; Postgres never reconciled |
| 7 | Gate F smoke + security | `/today` 404→200; `POST /briefs` 409; 5 schedules; **0 brief queues**; 0 secret matches; bindings unchanged; CORS contract correct |
| 8 | Gate G APK audit | Signer/package/versionCode all correct; no cleartext; `localhost:3000` absent; Category A adjudicated fresh |
| 9 | Gate H upgrade | versionCode 5; `firstInstallTime` unchanged; pairing, PRIMARY and push token preserved |
| 10 | Gate I physical | Reminder fired at +96 ms with correct tap route; push accepted **and** delivered; PTT chain with real `avg_logprob`; FAB/PTT clearance on the production identity |
| 11 | Gate J Daily Brief | One route POST; true model provenance; single-row upsert; Today metadata-only; no queue/cron |
| 12 | Gates K/L reboots | Both passed; identical container IDs and image digests after host reboot; Rabbit self-recovered |
| 13 | Gate M cleanup | Count-verified purge, zero residue, zero orphans, baseline data intact |

## Phase 5 Checkpoint 5.7.1 — All-day noon-anchor hotfix (COMPLETE, 2026-08-24)

Closes the defect Checkpoint 5.7 found in production. **No migration — level stays
0000–0012 = 13.**

### The invariant now enforced

ADR-042 anchors a recurring **all-day** series' DTSTART at **local noon** so date-only
recurrence is DST-safe and correct in nonexistent-midnight zones. That value is
implementation metadata. It escaped into presentation:

- Today rendered **`12:00`** for an all-day event;
- the Daily Brief narrated **"an all-day weekly event beginning at 12:00 PM"**.

> `all_day === true` → date-only everywhere outside recurrence internals.
> Never format, position, or narrate `occurs_at` for an all-day item.

### Audit — every consumer, not just the two symptoms

Two independent read-only audits covered all 30 files referencing
`occurs_at`/`occursAt`/`occurs_local`/`starts_at`/`is_recurring_instance`/`all_day`
across Today, Agenda, Month, Week, project sections, reviews, the Brief collector,
notification text and the API client.

**Exactly two live leaks**, both fixed:

| File | Defect |
|---|---|
| `apps/mobile/src/app/(tabs)/index.tsx:155` | `EventRow` re-derived the time with no `all_day` knowledge. `EventsSection` *did* split all-day from timed, but both groups funnelled through the same row component — the grouping was discarded exactly where it was needed. |
| `apps/api/src/brief/collect-input.ts:72` | `eventEffectiveStart` returned `occurs_at ?? starts_at` unguarded, handing the model a synthetic noon timestamp. |

**Three further spots were safe only by accident** and are now structurally safe:

- `read-models/event-range.ts` `sortKey` sorted an all-day *recurring* instance by its
  noon anchor (17:00Z) while a non-recurring all-day event on the same day sorted at
  midnight. Invisible through Today/Agenda (both re-sort and hoist all-day items), real
  for any direct `/events/range` consumer trusting array order.
- `read-models/review-contexts.ts:118` holds the **byte-identical** leaking expression,
  protected only by four lines above it.
- `calendar/week-grid.tsx` `formatTimeLabel` reads `occurs_at` with no guard of its own;
  safe only because `week-grid-layout.ts` `continue`s past the timed path for all-day
  entries.

Everything else was genuinely safe, and the audit recorded *why* in each case —
`reviews/daily.tsx` splits into groups and gives each a different `time` prop;
`reviews/weekly.tsx` and `agenda-rows.tsx` check `all_day` inline before the fallback;
`grid-math.ts` and `week-grid-layout.ts` branch on `all_day` before any instant math;
`projects/[id].tsx` is structurally immune because `ProjectDetailEventSchema` carries no
`occurs_at` at all.

### A contract gap, not just a bad expression

`BriefEventItem` was `{title, starts_at, all_day, location}` — **no date field**. Fixing
`starts_at` alone would have left the model with `all_day: true` and no way to know
*which day*. It now carries `date` (the instance's own calendar date, already re-pointed
per instance by `assembleEventRange`), and `starts_at` is **always null** when `all_day`
is true, so a time is inexpressible rather than merely discouraged.

The system prompt previously contained **zero** `all_day` guidance, which made narrating
the timestamp technically compliant with its own "state only facts present in the JSON"
rule. It now states the rule explicitly as defense in depth.

The `all_day`-first decision lives in one shared helper
(`apps/mobile/src/utils/event-time-label.ts`) used by **both** Today and Agenda, so the
two chains cannot drift apart again.

### Google / CalDAV deliberately untouched — and provably safe

Sync reads `events` rows directly (`row.allDay` / `row.startDate`) and has **zero**
references to `EventRangeItem`, `TodayEventItem` or `AgendaItem` anywhere in
`apps/worker` or `packages/calendar-providers`. The presentation change therefore cannot
reach it. `calendar-providers` stayed at exactly **57** tests and `worker` at exactly
**80** as the zero-drift canaries, and the worker image was **not rebuilt** because its
dependency closure is unchanged.

### Verification

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build/typecheck/lint/format clean; **1169 tests / 15 tasks** (1154 → +15); `calendar-providers` **57**; worker **80** |
| 2 | Migration invariant | 13 `.sql`, 13 journal entries, **no 0013** |
| 3 | Timezone matrix | Regression tests across **America/Chicago, Pacific/Auckland, America/Santiago** — the noon anchor lands on a different UTC hour, and a different UTC *day*, in each |
| 4 | Mutation testing | Removing the collector guard fails exactly the 3 timezone tests; removing the mobile helper's short-circuit fails 6 — **both guards proven load-bearing** |
| 5 | Deployed web artifact | The exact leaking expression is **present in the pre-fix bundle and absent from the post-fix one**; the new `All day` label appears only in the new bundle |
| 6 | Production Brief prose | Before: *"an all-day weekly event beginning at 12:00 PM"*. After: *"This event will also occur as an all-day event on both August 25 and August 26."* — **zero** mentions of 12:00 or noon |
| 7 | Production read models | 3 instances on 3 distinct dates, each `start_date` equal to its own day, `starts_at` null |
| 8 | Physical device (versionCode 6) | Today `'All day, P571-SMOKE all-day recurring'` (was `'12:00, …'`); Agenda ALL-DAY on all 3 dates; Week 3 all-day chips with no time; Month no time. **No `12:00` on any surface.** |
| 9 | Google/CalDAV | Connection active, 1985 calendar jobs completed, **zero failures**; worker untouched |
| 10 | Smoke cleanup | 3 occurrences + 1 event + 1 brief removed; **zero residue, zero orphan occurrences, zero orphan `event_external_links`, zero `calendar_event_instances`**; baseline preserved (2 tasks, 3 notes, 6 inbox, 2 devices, 13 tracking rows) |

### Deployment

Source `b7f7bf1`, shipped via `git archive` to `/home/himallinux/personal-os-5.7.1-release`.
Rollback tags `personal-os-{api,web}:pre-5.7.1` taken by digest first.

| Component | Rebuilt | Image |
|---|---|---|
| api | yes | `sha256:bf0f5ea055425a99bdc9d211b49afd9b25a09d503e83dfa1ce809073cdf23e45` |
| web | yes | `sha256:9325077877fffaf13fcb87ec197a8336ec14f63b8f4d5c1dcb28edeb322cf26c` |
| worker | **no** — dependency closure unchanged | `bb0f3ec47631` (unchanged) |
| postgres | **no** | `404de24ef86b` (unchanged, `restarts=0`) |

Android: EAS `f5b7955a-6cbb-4e79-9747-1f3e702aa2b4`, profile `production-internal`,
versionCode **6**, APK SHA-256
`9fe77d4aa70c6534215cfcca068585b69528242018cf5ac8d7044e3d915b2679`, signer
`4601e3a2…6cc23ea` (unchanged). Installed with `adb install -r` only —
`firstInstallTime` still `2026-08-19 16:26:10`, pairing and PRIMARY preserved, no
pairing screen. The build **fingerprint is identical** to versionCode 5
(`5e208f678a90699d930e3cdf40c6431dc7d32857`), which is the evidence that the native
dependency graph — and therefore the React Native 0.86.2 `getDevServer.js`
`localhost:8081` Category A adjudication — carries over unchanged.

### Still open

**The real-browser CORS proof remains the one uncompleted 5.7 acceptance item.** Both
browser surfaces available to this session failed for environmental reasons, not because
of the application: the Chrome extension was not connected, and the sandboxed browser
pane returns `net::ERR_BLOCKED_BY_CLIENT`, which blocks the request before it leaves the
browser and is therefore not a CORS result at all. Server-side evidence stands — the
approved origin receives `access-control-allow-origin` plus GET/HEAD/POST/PATCH/DELETE,
and an unapproved origin receives no `allow-origin` header — but no browser has exercised
it against the Phase 5 deployment.

