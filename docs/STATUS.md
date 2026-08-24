# Project Status

**Project:** Personal OS
**Current phase:** Phase 6 — Google Health Integration — **Checkpoints 6.0 and 6.1 COMPLETE; HARD STOP before 6.2** pending the M2–M8 Google Cloud actions and a separate explicit approval. Phase 5 — Daily Command Center + Projects — **COMPLETE** (Steps 0–1 and Checkpoints 5.1–5.7 all complete; **Checkpoint 5.7 deployed Phase 5 to production on 2026-08-24** and passed both reboot-survival tests physically). Phases 0–5 are now COMPLETE, production-deployed, and physically verified.
**Implementation status:** Phases 0–5 are implemented and production-deployed. **Production migration level is unchanged at 0000–0012 = 13 migrations**; Phase 6's additive `0013` exists in local dev/test only and is not deployed. The production Rabbit runs `com.himal.personalos` versionCode **6** (Checkpoint 5.7.1 hotfix).
**Next phase allowed:** **Phase 6 Checkpoints 6.0 and 6.1 ONLY** — approved 2026-08-24. Work stops completely after 6.1; Checkpoint 6.2 requires manual Google Cloud actions M2–M8 plus a separate explicit approval, and 6.3 onward requires the 6.2P probe to pass and be approved. Phase 6 is **Google Health cloud integration** (ADR-046), which **supersedes** the original HealthKit / Health Connect entry — that native scope is removed entirely. Finance remains deferred (ADR-038). Phases 7/8 have not been approved or planned.
**Canonical architecture:** `docs/ARCHITECTURE.md`. **Canonical Phase 6 plan:** `/Users/himalpokhrel/.claude/plans/you-are-the-lead-crispy-deer.md` (not part of this repo — a local Claude Code plan file, revision 3 **plus a normative Appendix A that supersedes conflicting body passages**, user-approved; the summary below is the durable, repo-tracked record). **Canonical Phase 4 plan:** `/Users/himalpokhrel/.claude/plans/personal-os-dreamy-ladybug.md` (not part of this repo — a local Claude Code plan file, revision 2, user-approved; the summary below is the durable, repo-tracked record). **Canonical Phase 3 plan:** `/Users/himalpokhrel/.claude/plans/personal-os-begin-unified-cook.md`. **Canonical Phase 2 plan:** `/Users/himalpokhrel/.claude/plans/zesty-twirling-piglet.md`.

## Phase 6 — Google Health Integration (plan approved 2026-08-24)

Phase 6 was redefined by explicit user direction (ADR-046): the original `ARCHITECTURE.md`
entry — HealthKit via `@kingstinct/react-native-healthkit`, Health Connect via
`react-native-health-connect` — is **removed from scope entirely**. No native health
access, no device-local health sync, no Apple Developer dependency. Phase 6 as approved is
a **read-only, server-side Google Health API integration**.

**Approved checkpoints:** 6.0 ADRs + repository verification + docs · 6.1 contracts +
additive migration `0013` + provider fake · **⛔ full stop** · 6.2 OAuth · 6.2P real-account
capability *and* identity-stability probe · **⛔ stop** · 6.3 sync engine · 6.4 dashboard
(web + Rabbit) · 6.5 hardening · 6.6 full live proof · 6.7 gated production deployment.

**Approved scope at this time is 6.0 and 6.1 only.**

### Planning record — what the research actually changed

Planning ran four parallel read-only investigation agents plus an independent adversarial
review. It went through three revisions, and the corrections are worth recording because
several were errors of fact that would have shipped:

1. **There is no incremental-sync primitive.** The API documents no sync token, no
   `updateTime` filter, no `showDeleted` and no tombstones, and `reconcile` is multi-source
   de-duplication — not change tracking. The only change-detection mechanism is webhooks,
   which require public ingress (excluded by ADR-018). Sync is therefore a bounded
   trailing-window re-fetch with content hashing, carrying an accepted **35-day staleness
   contract** (ADR-046).
2. **The documented OAuth client type is Web Server with a required `redirect_uri`** —
   directly contradicting Phase 4's proven native `AuthorizationClient` flow, which
   deliberately sends none. `packages/calendar-providers/src/google-oauth.ts` is therefore
   **not** reusable, and is deliberately near-duplicated rather than extended (that package
   is also the standing 57-test zero-drift canary).
3. **All Google Health scopes are Restricted**, but the documented personal-use exception
   (<100 users) applies, so no verification and no CASA security assessment is triggered.
   **Publishing status — not verification — governs the 7-day refresh-token expiry**, and
   "In production + Unverified" is a documented supported state.
4. **`dailyRollUp` documents `civilStartTime`/`civilEndTime` and supplies no physical
   instants or UTC offsets.** So `local_date` is taken verbatim from the API and no IANA
   timezone is stored (ADR-048) — but daily rows carry no physical bounds, so
   duration-normalized daily rates are not derivable and are not offered.
5. **Sleep is filtered by `sleep.interval.civil_end_time`**, a sleep-exclusive filter; the
   generic session-start filter explicitly excludes sleep. Attribution, fetch filter and
   deletion scope are therefore one axis (ADR-049), deleting a planned one-day widening.
6. **`list` does not accept `dataSourceFamily`** — only `reconcile`, `rollUp` and
   `dailyRollUp` do.
7. **`pairedDevices.list` requires `googlehealth.settings.readonly`** — a fourth scope. All
   paired-device functionality was cut rather than silently widening consent.
8. **`DataSource` documents no stable identifier** (only `recordingMethod`,
   `device.formFactor`, `application.platform`), and `ReconciledDataPoint` carries no
   `dataSource` at all. Raw-heart-rate identity is therefore a fully-specified deterministic
   key over every field the API actually returns, with an explicit collision strategy — and
   **raw-HR rows are never tombstoned** until a live probe proves identity stability, since
   `reconcile` recomputes off-wrist filtering per call and an omission is evidence of
   upstream recomputation, not deletion.

The adversarial review additionally caught three defects that would have reached
production: an **OAuth authorization code written to the request log** (Fastify logs the URL
at `lib/route.js:522`, before `onRequest` hooks at `:561`, and the default serializer emits
neither query nor body — so the proposed hook and redact paths were both ineffective); a
**bucket-count check that would have dead-lettered every backfill chunk** covering days the
watch was not worn; and a **hot-sync path that could blank real daily data with NULL** on a
single empty 200 response.

**Scope decisions recorded with the approval:** exactly three read scopes
(`activity_and_fitness`, `sleep`, `health_metrics_and_measurements`); raw heart-rate samples
included (the one selection carrying ongoing cost); web **and** Rabbit delivery, so Phase 6
ships an APK at versionCode 7; publishing status **In production, unverified**.

### Checkpoint 6.0 — ADRs and documentation reconciliation (COMPLETE, 2026-08-24)

No code. No migration. No dependency change. No credentials. No production access.

**Repository baseline verified directly** (not inferred from prose): branch `main`, HEAD
`e1effa4cadaca5440345841286bc06e846cd3203`, working tree clean, exactly **13** `.sql`
migrations and **13** journal entries with `0012_ai_daily_briefs` (`when` 1787466808983)
last, and ADR-045 the highest existing ADR.

**Added:** `docs/DECISIONS.md` ADR-046 (Phase 6 redefinition; trailing-window sync; 35-day
staleness contract; webhooks permanently excluded; densification restricted to
warm/manual/backfill and clamped) · ADR-047 (daily-aggregate storage; intraday for
`heart-rate` only; **no automatic health-data deletion**) · ADR-048 (`local_date` is the
API's civil date; no timezone stored; no physical bounds on daily rows; sync window
UTC-computed and widened one day each end; ADR-042/045 explicitly **not** reused) ·
ADR-049 (sleep attributed *and queried* on the civil-end axis) · ADR-050 (CHECK only
project-controlled closed vocabularies, citing the `0009` reconcile fallout).

**Reconciled seven documented conflicts:** `ARCHITECTURE.md` Phase 6 entry replaced (C1);
the Apple Developer gotcha narrowed — it still gates iOS builds, no longer Health (C2); the
HealthKit reference removed from the native-module note (C3); this file's header, current
work and next action updated (C4); the "passive vs proactive health" open question answered
as **passive** in both `ARCHITECTURE.md` and `DECISIONS.md` (C5); the `health` namespace
collision recorded — `GET /health` and `packages/schema/src/health.ts` are already the
liveness probe, so Phase 6 uses `health-*` siblings throughout (C7).

**Deliberately not yet changed (C6):** the three lines asserting "13 `.sql` files, 13
journal entries, **no 0013**" remain **accurate** until migration `0013` actually lands in
Checkpoint 6.1, and are updated then — not pre-emptively.

### Checkpoint 6.1 — Contracts, migration 0013, provider fake (COMPLETE, 2026-08-24)

Single-writer, per the plan. **Local development only; production untouched.** No Google
credentials were needed or used, and none exist yet — 6.1 is deliberately buildable without
them.

**Migration `0013_google_health_sync`** — 39 statements in drizzle-kit style (7 `CREATE
TABLE`, 6 FKs, 12 CHECKs, 14 indexes; 38 `--> statement-breakpoint`s). Only statement
classes `reconcile-drizzle-tracking.ts` can process; **no `DROP CONSTRAINT`**, which is the
`0009` lesson. Journal entry idx 13 appended with a real authoring epoch, and
`0013_google_health_sync` added to `journal.test.ts`'s `HAND_WRITTEN_WITHOUT_SNAPSHOT` set
(an exact-equality assertion — the suite fails without it).

**Seven tables:** `health_connections` · `health_oauth_states` · `health_metric_streams` ·
`health_daily_metrics` · `health_observations` · `health_sessions` · `health_sync_runs`.

Design points worth recording because they were decided against an alternative:

- **`health_daily_metrics` carries no physical instants and no UTC offsets.** `dailyRollUp`
  documents `civilStartTime`/`civilEndTime` and supplies neither, so those columns could
  only have held invented values. The consequence, accepted in ADR-048: duration-normalized
  daily rates are not derivable and are not offered.
- **No per-row "we checked" timestamp.** Verification lives on the stream
  (`last_successful_sync_at`) and in `health_sync_runs`, so two identical consecutive syncs
  can write zero health-data rows.
- **`health_user_id` is `NOT NULL`.** A Postgres unique index permits unlimited NULLs, so a
  nullable identity would let a partially-failed connect bypass the account-mismatch guard.
- **All-or-nothing CHECKs on both encrypted credential triples** — a partially-populated
  triple is undecryptable and is now unrepresentable.
- **`provider`, `metric`, `source_family` and `failure_class` carry no CHECK** (ADR-050),
  so adding a metric never requires an unreconcilable `DROP CONSTRAINT`.

**`packages/core/src/health/`** — `civil-time.ts`, `day-attribution.ts` (the single home of
the ADR-049 wake-date rule) and `windows.ts`. `packages/core`'s `exports` map gained
`"./health/*"`, without which a mobile import would fail to resolve or would drag `rrule`
into the web bundle for the first time.

**A real defect its own tests caught, worth recording rather than quietly fixing:** the
first `trailingWindow` used `endDate = today + 1` in a half-open range, so the last covered
day was `today` — it never actually included the ahead-of-UTC local day the widening exists
for. Worse, `densifiableRange` excluded one day at *each* edge, which (a) was insufficient,
since at 19:00 UTC a user at −07:00 is still mid-way through their own current day, and
(b) would have punched a systematic hole at every backfill chunk seam, because chunks abut.
Corrected to: exclusive end `today + 2`; densification clamped by
`lastGloballyCompleteDateExclusive(now)` (a date is knowably empty only once it has ended at
−12:00, the maximum lag); and **no start-edge clamp at all**.

**`packages/schema/src/health-metrics.ts`** — named to avoid the existing `health.ts`
liveness schema. Response shapes are structurally credential-free, asserted by a test that
walks the schema keys rather than trusting review.

**`packages/health-providers`** (new package, 82 tests) — `google-health-catalog.ts` (the
single source of truth for capability metadata, in code rather than in columns),
`google-health-oauth.ts`, `google-health-client.ts` (injectable `fetchFn`, following the
CalDAV client rather than the Google Calendar one, which has no test file at all),
`google-health-client.fake.ts` (scripted queues that **throw on an unqueued call**, so an
unexpected request fails loudly instead of returning an empty page and a green test) and
`identity.ts`.

The catalog pins the facts that were got wrong during planning: **`list` never carries
`dataSourceFamily`**; **sleep filters on `sleep.interval.civil_end_time`, never
`start_time`**; the 14-day cap is marked `documented_rollup_cap` while every `list`/
`reconcile` window is marked `self_imposed`; and **`daily-vo2-max` sits under
`activity_and_fitness`, not `health_metrics`** — verified against the data-types table
after two research passes disagreed.

**Deliberately NOT built in 6.1** (they belong to 6.2/6.3): API routes, worker jobs, queue
registration, the rate limiter, record-to-row translation, and any client or UI. No
`apps/api`, `apps/worker` or `apps/mobile` source file was modified — only their two test
harnesses, to truncate the new tables in FK order.

**Documentation correction made during this checkpoint:** the plan asserted that three
`STATUS.md` lines claiming "13 `.sql` files, 13 journal entries, no 0013" would all become
stale. Two of them are **historical verification records** for Checkpoints 5.6 and 5.7.1
and were accurate when written; rewriting them would falsify the record. Only the live
statements were changed — the header's implementation status (now distinguishing local from
production migration level) and the "Last verification" section.

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

## Phase 4 Checkpoint 4.1 — Events backend (COMPLETE, 2026-08-20)

Built with a 4-agent parallel effort under the approved Phase 4 plan (revision 2), main Claude as integration owner. No credentials required, no production access. Everything below is local development only.

**What was built:**

1. **`events.archived_at`** (migration `0005_nasty_blazing_skull.sql`) — a nullable `archived_at timestamptz` column plus a new partial index `events_starts_at_active_idx` (`where archived_at is null`), added alongside the pre-existing unconditional `events_starts_at_idx` rather than converting it, to keep the migration purely additive (no `DROP INDEX`). Both indexes were confirmed to pull real weight for the range endpoint's actual query shapes (the common `include_archived=false` case uses the partial index; `include_archived=true` and the recurring-event pre-filter use the unconditional one) — not redundant, not removed. Applied to local dev and the dedicated `personalos_test` database; `posops_app` re-confirmed unable to perform DDL (`CREATE TABLE` → `permission denied for schema public`; `ALTER TABLE events` → `must be owner of table events` — a different error string than the schema-level case, but an equally hard denial) while able to read/write the new column.
2. **`packages/schema/src/events.ts`** (new) — `EventSchema`, `EventCreateSchema`/`EventUpdateSchema` (`.strict()`, no `rrule`/`recurrence_*`/`archived_at` fields — recurrence stays capture-only until Checkpoint 4.3, matching the exact precedent already established for `TaskCreateSchema`), `EventListQuerySchema`, and `EventRangeQuerySchema`/`EventRangeItemSchema`/`EventRangeResponseSchema` for the new range endpoint.
3. **`apps/api/src/routes/events.ts`** (new) — full CRUD (`GET/POST /events`, `GET/PATCH /events/:id`, `POST /events/:id/archive`) plus **`GET /events/range?from=&to=&include_archived=`**, a complete read contract per the plan's §3.5 design: never writes from the GET handler; assembles its response from three sources — a direct overlap query for one-off timed events (`starts_at < to AND ends_at > from`, half-open interval, so boundary-adjacent events aren't double-counted or dropped), a separate date-based overlap query for all-day events (calendar dates compared directly, never through a UTC instant, per `ARCHITECTURE.md`'s "dates, not timestamp-midnight hacks" rule), and an on-demand, in-memory expansion of recurring events for the exact requested range (padded by the event's own duration on the front edge, so an occurrence starting before `from` but ending inside the range isn't missed), left-joined against real `occurrences` rows for status where one exists (a `skipped` occurrence is excluded; a missing row defaults to the same `scheduled` state a real pre-generated row would have). This makes calendar-view correctness independent of nightly-cron timing — verified directly, not assumed (see tests below).
4. **`packages/core/src/recurrence/due-date-window.ts`** — refactored. The pre-existing `expandDueDateWindow(rule, windowDays, now)` hard-filters anything before `now` and only ever expands `[now, now+windowDays]` — a real finding, confirmed by direct code read before any implementation began, that made it unsafe to reuse unmodified for a range query that must include past dates. The shared DST-safe expansion machinery (RRULE parsing via the existing `createRequire`/`rrulestr` Node-ESM-interop workaround, exdate handling, floating-space-to-instant resolution) was extracted into a private helper; a new public function, **`expandRecurrenceInRange(rule, from, to)`**, was added on top of it with no now-floor and no window-size limit; `expandDueDateWindow` itself became a thin wrapper over the same helper, its public signature and exact behavior unchanged (proven by its original, unmodified test suite continuing to pass after the refactor).
5. **`apps/worker/src/jobs/expand-due-date-window.ts`** — added the missing `isNull(events.archivedAt)` filter to the events query (it previously only filtered `isNotNull(events.rrule)`), mirroring the equivalent, pre-existing task filter — closing the one real gap in what was otherwise already-working code (this job has expanded recurring events into `occurrences` since Phase 1, a fact this session confirmed by direct read rather than assuming from file/queue naming).
6. **`packages/api-client/src/events.ts`** (new) — `listEvents`, `getEvent`, `createEvent`, `updateEvent`, `archiveEvent`, `listEventsInRange`, exported through `createApiClient`'s existing method-bag pattern.

**Validation hardening completed during closure:** timed events require `starts_at`, forbid date-only fields, and require `ends_at > starts_at` when an end is present; all-day events require `start_date`, forbid timestamp fields, and require inclusive `end_date >= start_date` when an end is present. PATCH validates the fully merged stored-plus-patch state, including complete timed/all-day conversion.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after integrating all four agents' work |
| 2 | Migration `0005` applies cleanly as `posops_migrator`; `posops_app` still can't DDL | Re-confirmed against local dev and the dedicated test database; read/write on the new `archived_at` column succeeds as `posops_app` |
| 3 | `expandDueDateWindow`'s existing behavior is unchanged after the refactor | Its full original test suite passed with zero modifications |
| 4 | `expandRecurrenceInRange` correctness | New tests: a range entirely in the past; a range crossing a real DST transition (reusing `packages/core`'s existing `2026-11-01`/`America/Chicago` reference dates); an exhausted `recurrenceCount` before the range starts; an open-ended rule queried 6 months out, well beyond the 90-day pre-generation window; exdate exclusion within an arbitrary range |
| 5 | Nightly job's events-path archive filter | New tests: an active recurring event generates occurrences; an archived recurring event generates zero |
| 6 | `GET /events/range` completeness contract | New tests, all passing: one-off event spanning a range boundary (both directions); a recurring occurrence starting before `from` and ending inside the range (proves the duration-padding logic); a detached-instance scenario (a parent's `recurrence_exdates` excludes a date, a separate standalone event stands in for it) appearing exactly once, not duplicated by the parent's expansion; an all-day event at a month boundary with non-midnight-aligned query bounds; a real `skipped` occurrence correctly excluded while its series' other occurrences remain; a past range with **zero** pre-generated `occurrences` rows still returning correct results (proving completeness doesn't depend on the cron having run); a far-future range for an open-ended rule beyond the 90-day window |
| 7 | Full events CRUD | Route tests: create/list/get/update/archive, `.strict()` rejecting `rrule`/`recurrence_*`/`archived_at` in the request body, archive independence (archived event excluded from the default list, included with `?include_archived=true`, still directly fetchable by id) |
| 8 | `packages/api-client/src/events.ts` | New tests: each CRUD method's request shape, `listEventsInRange`'s query-string construction, a non-2xx response throwing `ApiClientError` correctly |
| 9 | Full workspace test suite after integrating all four agents | **250 tests pass, 12/12 turbo tasks** — `@personal-os/core` 58 (+5), `@personal-os/schema` 11, `@personal-os/ai-providers` 20, `@personal-os/api-client` 19 (+9), `api` 71 (+21), `worker` 35 (+2), `mobile` 36 — zero regressions anywhere in the workspace, confirmed by main Claude independently re-checking `git status`/`git diff --stat` against every agent's self-reported file list before this entry was written |

**Not yet done (deliberately, per the approved plan):** nothing in `apps/mobile` — Checkpoint 4.2 (calendar UI + normal event CRUD) is next. The `GET /events/range` response shape (documented in the route file and above) is the frozen contract 4.2's UI work builds against. No commit has been made yet — all Checkpoint 4.1 changes remain in the working tree pending explicit commit approval, per this project's standing git-safety rule that commits require explicit user request.

## Phase 4 Checkpoint 4.2 — Calendar UI + normal event CRUD (COMPLETE, 2026-08-20)

Built with a 4-agent parallel effort (month grid, week grid, event CRUD screens, cross-platform verification), main Claude assembling the three independent components into a real screen and fixing two real bugs the verification agent found. Local development only; no production access.

**What was built:**

1. **`apps/mobile/src/components/calendar/`** — `grid-math.ts`/`day-cell.tsx`/`month-grid.tsx` (month view) and `week-grid-layout.ts`/`week-grid.tsx` (week view), both pure-logic-plus-thin-renderer pairs matching this codebase's established split between tested pure domain logic and untested RN composition (`notifications/reconcile.ts`'s precedent). No third-party calendar library, per the locked architecture decision — built entirely on `View`/`FlatList`/`ScrollView` + NativeWind. `date-fns` was added as this app's first calendar-math dependency, verified safe in both Node and a real browser (not just "the bundler didn't error") before being trusted, given this project's history of Hermes/web-bundle incompatibilities with other packages (`rrule`, `Intl.supportedValuesOf`). All-day entries render in a distinct top strip (Google Calendar's own convention); multi-day and midnight-crossing timed entries are positioned via wall-clock reads rather than elapsed-millisecond math, specifically so a DST transition doesn't misplace them (tested against the same `2026-11-01`/`America/Chicago` reference date `packages/core`'s own DST tests use). Recurring instances are positioned by their real `occurs_at`, never the parent series' template `starts_at`.
2. **`apps/mobile/src/app/events/new.tsx` / `events/[id].tsx`** — full create/edit/archive screens covering every field `EventCreateSchema`/`EventUpdateSchema` accept, mirroring `tasks/new.tsx`/`tasks/[id].tsx`'s exact conventions (plain ISO-8601 text inputs for date/time — this codebase has no date/time picker dependency anywhere yet, confirmed by direct search, so the existing precedent was mirrored rather than a new one invented). `events/new.tsx` accepts documented pre-fill query params (`date`/`startsAt`/`endsAt`/`allDay`) so tap-to-create from the calendar grid can pre-populate the form.
3. **`apps/mobile/src/app/(tabs)/calendar.tsx`** (new, assembled by main Claude from the three agents' independent, prop-driven components) — a Month/Week toggle, prev/next/today navigation, `useEventsInRange` wired to whichever range the current view needs, tap-an-empty-day/slot → pre-filled create form, tap-an-entry → detail/edit. Registered as a 5th tab (Tasks, **Calendar**, Inbox, Notes, Projects) and as new `events/[id]`/`events/new` routes in the root `<Stack>`.
4. **`apps/mobile/src/queries/events.ts`** — TanStack Query hooks (`useEvents`, `useEvent`, `useEventsInRange`, `useCreateEvent`, `useUpdateEvent`, `useArchiveEvent`), mirroring `queries/tasks.ts`'s invalidation convention.

**Two real, pre-existing bugs found by a real browser pass (not introduced by this checkpoint, but first actually exercised by it) — both diagnosed to exact root cause and fixed:**

- **CORS silently blocked every PATCH/DELETE from the web client, API-wide.** `@fastify/cors`'s own default `methods` is `GET,HEAD,POST` (not the wider default most people assume from the plain `cors` package) — `apps/api/src/server.ts`'s CORS registration never set `methods` explicitly, so every edit/archive action from the web target failed its preflight silently. Invisible to every prior curl-based verification in this project's history, since curl never sends a preflight — only a real browser's `fetch` triggers one. This affected tasks/notes/projects too, not just events; fixed by explicitly listing `["GET","HEAD","POST","PATCH","DELETE"]`.
- **`include_archived=false` was silently treated as `true`, API-wide.** `z.coerce.boolean()` runs JS's `Boolean(value)` on the raw query string, and `Boolean("false")` is `true` — any client that explicitly sends `?include_archived=false` (as the new mobile web calendar client always does, unlike prior curl-based tests which relied on omitting the param for the false case) got the *opposite* of what it asked for. Affected `include_archived` on tasks/notes/projects/events and `include_revoked` on devices — six call sites sharing the identical buggy pattern. Fixed with a new shared `booleanQueryParam(default)` helper in `packages/schema/src/pagination.ts` (explicit string-literal check, not `Boolean()` coercion), applied at all six sites. New regression tests added: a direct unit test of the helper (`pagination.test.ts`) and an API-level assertion in `events.test.ts` proving an explicit `include_archived=false` now correctly excludes an archived row (previously would have failed).

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, both before and after the two bug fixes |
| 2 | Full workspace test suite | **277 tests pass, 12/12 turbo tasks** (`@personal-os/core` 58, `@personal-os/ai-providers` 20, `@personal-os/schema` 17 (+6, the new `booleanQueryParam` regression tests), `api` 71, `@personal-os/api-client` 19, `worker` 35, `mobile` 57) — zero regressions |
| 3 | Real browser pass (web target) | A real pairing code generated and used against a running local dev API; month grid renders a correct 6-week grid including empty; Month/Week toggle and prev/next navigation work; tapping an empty day/slot navigates to the pre-filled create form with the exact documented param shape; a real created event appears in the grid immediately via TanStack Query invalidation, with no manual refresh; tapping an event opens its real detail/edit screen. This pass is what surfaced both bugs above — confirmed fixed afterward |
| 4 | Physical Rabbit R1 pass | **Blocked — see below** |

**Physical device verification — genuine hard stop, not resolved unilaterally:** the verification agent discovered, before installing anything, that the connected Rabbit R1 is not a disposable test unit but the user's actual production device from Checkpoint 6 — still running the live, EAS-signed production build (`versionCode 3`, `versionName 1.0.0`), with real production task rows visible on screen. A local debug build was compiled successfully (`expo run:android`, Gradle build succeeded) but its install correctly failed (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, differing signatures) rather than silently overwriting the production app. The agent stopped there rather than uninstalling the production build to make room, since that would unpair the user's real device, strand its primary-reminder-device status, and disrupt real reminders (documented risk, per this project's own recorded debt: "the exact-alarm grant does not survive reinstall" / SecureStore is wiped on rebuild). As a partial, lower-confidence substitute, the calendar screen was checked in the Browser pane resized to the R1's exact 480×640 — the 5-tab bar rendered with all labels visible, no truncation, and the month grid stayed legible at that width — but this is a web-DOM proxy, not genuine native tab-bar-chrome/touch evidence, and is explicitly not being treated as equivalent.

**What's needed to close this**: either (a) explicit user approval to temporarily uninstall the production R1's app for a debug-build verification pass, with the exact preserved production artifact (`/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/79aed729-77ef-4102-a98a-f0aa00d02ea1/personal-os-production-v1.0.0-3.apk`, SHA-256 already on record) reinstalled afterward and the device re-paired, or (b) a second, disposable Android device/emulator for native verification that doesn't touch the production unit. Checkpoint 4.2 is **not** being marked fully complete until one of these happens — code is integrated, tested, and believed correct, but the empirical "5-tab bar vs. header-icon" call the plan explicitly deferred to real hardware has only web-proxy evidence behind it, not the real thing.

### Checkpoints 4.1–4.2 closure correction (2026-08-20)

The preceding physical-device blocker was closed without modifying production. A temporary release-mode application was built and installed side-by-side as `com.himal.personalos.dev`, display name `Personal OS UI Test`, scheme `personal-os-ui-test`. UI-test mode accepts only loopback/private-network development API URLs, uses the distinct Android package's isolated app data/SecureStore, bypasses identity and pairing, and does not mount push registration, notification/reminder scheduling, background outbox work, PTT, or quick capture. Its native manifest omitted microphone, notification, exact-alarm, and boot permissions. A local-only event fixture and empty-calendar fallback existed only in this mode to permit layout inspection when the Rabbit could not open the Mac's development TCP port.

At 480×640 on the physical Rabbit, the fifth Calendar tab remained usable with all five labels visible and separated; month and week layouts rendered cleanly; empty day/slot navigation opened correctly prefilled forms; create/edit forms scrolled and remained usable with the physical keyboard overlay. The fifth tab was therefore retained. The temporary package was then uninstalled. Production `com.himal.personalos` was never targeted by an install, uninstall, clear, force-stop, signing, pairing, registration, or data command. Before/after production evidence is identical: versionCode `3`, versionName `1.0.0`, install/update time `2026-08-19 16:26:10`, data directory `/data/user/0/com.himal.personalos`, APK SHA-256 `f2a2009dd67ea800ac0d2e9736aab62d8a4ff6ccd5d6943a6e70288d1a0fb1dc`, and signing-certificate SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`. Afterward only the production package remained installed.

The backend closure pass also added the approved hard bounds and browser regressions. `GET /events/range` requires offset datetimes, rejects `from >= to` and spans over 366 days with structured validation errors, accepts exactly 366 days, and enforces one shared 10,000-candidate recurrence-expansion budget across the request. Every RRULE candidate is charged before range/recurrence-until filtering; candidate 10,001 stops expansion and returns `400 { error: "recurrence_expansion_limit_exceeded", event_id, limit: 10000 }`, never partial results. An independent review found and then verified the fix for initially under-counted filtered candidates. Strict boolean parsing now accepts only actual booleans or exact `"true"`/`"false"` strings. CORS preflight tests prove the approved origin receives GET/HEAD/POST/PATCH/DELETE (including PATCH and DELETE), PUT is not advertised, an unapproved origin receives no usable authorization, and ordinary non-browser requests remain unaffected.

Final local verification: migration `0005` applied successfully using `MIGRATIONS_DATABASE_URL`; the runtime role's `CREATE TABLE` was denied with SQLSTATE `42501`; build, typecheck, lint, format check, web export, API startup, worker startup, and release APK build all passed; **291 tests in 40 files** passed across the workspace; gitleaks scanned 29 commits/~1.47 MB and found no leaks. Checkpoints 4.1 and 4.2 are complete.

## Phase 4 Checkpoint 4.3 — Shared RRULE editor + backend recurrence-write enablement (COMPLETE, 2026-08-20)

Built with a 5-agent parallel effort under the approved plan with corrections, main Antigravity session as integration owner and Agent E as independent read-only auditor. Local development only; no production access.

**What was built:**

1. **`@personal-os/core/recurrence/editor`** (`packages/core/src/recurrence/editor.ts`) — client-safe, pure recurrence editor model:
   - Supported editable grammar: `DAILY`, `WEEKLY` (with `BYDAY=MO..SU`), `MONTHLY` (with `BYMONTHDAY=1..31`), `YEARLY`, `INTERVAL >= 1`, `WKST`.
   - `parseRRuleStringToEditorState`: parses standard rules; detects pre-existing unsupported/custom rules (`BYSETPOS`, complex `BYMONTH`, ordinal days) as `isCustom: true` and retains `rawRrule` without destructive mutations.
   - `serializeEditorStateToRRule`: converts UI state to RFC 5545 RRULE and structured columns (`recurrence_until`, `recurrence_count`, `recurrence_timezone`, `recurrence_anchor`).
   - `resolveLocalUntilToInstant` / `resolveInstantToLocalUntil`: DST-safe inclusive local calendar date (`YYYY-MM-DD` at `23:59:59.999`) resolution to real UTC cutoff.
   - `formatRecurrenceSummary`: live human-readable summary.
   - Zero Node APIs or `rrule` npm package imports.

2. **Server Recurrence Validation & Invalidation** (`packages/core/src/recurrence/validation.ts`, `apps/api/src/routes/tasks.ts`, `apps/api/src/routes/events.ts`):
   - Server-side `validateRecurrenceRule` enforcing RFC 5545 syntax via `rrulestr`, rejecting compound `RRuleSet` or embedded `UNTIL=`/`COUNT=`, and enforcing mutual exclusivity of `recurrence_until` and `recurrence_count`.
   - Completion-anchored tasks strictly restricted to `FREQ`, `INTERVAL`, `WKST` with no `recurrence_until`/`recurrence_count`/`recurrence_exdates`.
   - Events strictly forbid `recurrence_anchor`.
   - Transition-specific transactional occurrence invalidation using a single `effectiveNow` timestamp:
     - **Due-Date -> Due-Date edit**: preserves overdue scheduled (`occurs_at < effectiveNow`), done, and skipped occurrences; replaces future scheduled occurrences (`occurs_at >= effectiveNow`); re-expands 90-day forward window.
     - **Event -> Event edit**: preserves historical scheduled and skipped occurrences; replaces future scheduled occurrences; re-expands 90-day window.
     - **Due-Date -> Completion-Date transition**: deletes all open scheduled non-lazy occurrences (including overdue); preserves done/skipped; seeds 1 open lazy occurrence.
     - **Completion-Date -> Due-Date transition**: deletes open lazy scheduled occurrence; preserves done/skipped; materializes 90-day forward window (`lazy_generated = false`).
     - **Clearing Recurrence (`rrule = null`)**: deletes all scheduled occurrences (including overdue); preserves done/skipped; clears all recurrence columns.
     - **Creation with Recurrence**: materializes 90-day window for due-date tasks/events; seeds 1 lazy occurrence for completion-date tasks.

3. **Shared Mobile `<RecurrenceEditor />` & Screen Integration** (`apps/mobile/src/components/recurrence/recurrence-editor.tsx`, `apps/mobile/src/app/tasks/`, `apps/mobile/src/app/events/`):
   - Single reusable component for tasks and events.
   - Frequency chips, interval inputs, weekly day chips, month-day input, end condition selectors (never, until date, count), and task-only anchor selector ("On due date" vs "After completion").
   - Custom recurrence notice card: displays existing unsupported rule and preserves it until user clicks "Replace with standard recurrence".
   - Integrated into `tasks/new.tsx`, `tasks/[id].tsx`, `events/new.tsx`, and `events/[id].tsx`.

4. **Schema & API Client Updates** (`packages/schema/src/tasks.ts`, `packages/schema/src/events.ts`, `packages/api-client/src/`):
   - Updated `TaskSchema`, `TaskCreateSchema`, `TaskUpdateSchema`, `EventSchema`, `EventCreateSchema`, `EventUpdateSchema` with strict validation.
   - API client methods and types re-exported and verified.

**Verification run:**
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all passed cleanly across all 8 packages.
- Total **379 automated tests across 46 test files** passed with zero failures.
- Expo web export bundled cleanly with 0 errors (`npx expo export --platform web`).
- Independent read-only audit (Agent E) verified all 5 invariant categories with zero defects.

## Phase 4 Checkpoint 4.4 — Event occurrence override/detach + single-occurrence cancel (COMPLETE, 2026-08-20)

Built with a 4-agent parallel effort under the approved plan, main Antigravity session as integration owner, Agent A on backend exception domain, Agent B on API client, Agent C on mobile calendar UX, and Agent D as independent read-only auditor. Local development only; no production access.

**What was built:**

1. **Database Schema & Constraints** (migration `0006_great_lizard.sql`, `packages/db/src/schema/events.ts`):
   - Created partial unique index `events_detached_unique_idx` on `(parent_event_id, original_start_at) WHERE parent_event_id IS NOT NULL AND archived_at IS NULL`, preventing duplicate active detached exception events for the same occurrence slot.
   - Applied cleanly to local dev and dedicated test database.

2. **Schema & API Client Updates** (`packages/schema/src/events.ts`, `packages/api-client/src/events.ts`):
   - Added `parent_event_id` (uuid nullable) and `original_start_at` (datetime nullable) to `EventSchema` and `EventRangeItemSchema`.
   - Added `EventDetachSchema` and `EventCancelOccurrenceSchema` with strict validation.
   - Added `detachEvent(baseUrl, id, body)` (`POST /events/:id/detach`) and `cancelEventOccurrence(baseUrl, id, body)` (`POST /events/:id/cancel-occurrence`) to `@personal-os/api-client`.

3. **Backend Exception & Cancellation Endpoints** (`apps/api/src/routes/events.ts`):
   - `POST /events/:id/detach`:
     - Validates parent is recurring and `original_start_at` matches a valid occurrence instant.
     - Idempotent: returns existing active detached event if already present.
     - Atomically updates parent `recurrence_exdates` with local occurrence date (`YYYY-MM-DD`), removes pre-materialized occurrence row, and inserts detached event row with `parent_event_id` and `original_start_at` while setting recurrence columns to null.
   - `POST /events/:id/cancel-occurrence`:
     - Validates parent is recurring and `original_start_at` is a valid occurrence instant.
     - Returns `409 already_detached` if the slot is already occupied by a detached event.
     - Atomically appends exdate to parent `recurrence_exdates` and cleans up materialized occurrence.
   - `PATCH /events/:id`:
     - Strictly rejects setting `rrule` on detached events (`parentEventId !== null`) with `400 validation_failed`.
   - `POST /events/:id/archive`:
     - Cascades archive to all active detached children when archiving a recurring parent series; archiving a detached event only archives that event.
   - `GET /events/range`:
     - Populates `parent_event_id` and `original_start_at` on returned items. Recurring series expansion skips exdated occurrences; detached items appear once from Source 1/2 with zero duplicates.

4. **Mobile Calendar UX & Action Sheet** (`apps/mobile/src/app/(tabs)/calendar.tsx`, `apps/mobile/src/app/events/[id].tsx`, `apps/mobile/src/queries/events.ts`):
   - Tapping a recurring instance routes with `?occursAt=<iso>` parameter.
   - In `events/[id].tsx`, recurring instance with `occursAt` displays cross-platform action modal with three choices:
     - **Edit this occurrence**: computes occurrence timing, pre-fills form, hides recurrence editor, and saves via `useDetachEvent()`.
     - **Edit entire series**: opens standard series edit mode.
     - **Cancel this occurrence**: calls `useCancelEventOccurrence()` and navigates back.
   - Detached events display a modified occurrence banner and hide `<RecurrenceEditor />`.
   - Zero Node API or `rrule` imports in mobile bundle.

**Verification run:**
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all passed cleanly workspace-wide.
- All 12 Turbo tasks and all test suites passed cleanly: **385+ tests across 47 test files**.
- `npx expo export --platform web` completed with 0 errors.
- Independent read-only audit (Agent D) verified all 6 invariant categories with zero defects.

## Current objective

Phase 3 (native builds, voice, notifications — the MVP milestone in `docs/ARCHITECTURE.md`) is complete. The production Rabbit R1 runs the internal-distribution APK signed by the stable EAS-managed production identity, connects only through Tailscale, stores its device credential in SecureStore, schedules exact local reminders, uploads PTT audio to production for Groq Whisper transcription, and receives real Expo/FCM pushes. Production capture parsing remains on the pre-existing protected OpenAI `gpt-4.1` route.

Phase 2 (Expo Router app, web target) is complete: quick-add box, inbox triage, task list, notes, project view, per `docs/ARCHITECTURE.md`'s Phase plan. Full manual CRUD for tasks/notes/projects (not just AI capture), TanStack Query on a rebuilt `packages/api-client`, soft-delete/archive semantics (`archived_at`, no hard deletes), a real `inbox → active` task transition, a global quick-add reachable from every screen, and an always-on production web deployment (not just a local dev server) with explicit SPA-fallback routing for the app's UUID-keyed dynamic routes (`tasks/[id]`, `notes/[id]`, `projects/[id]`) — all implemented, deployed to `personal-os`, and verified against the live deployment in a real browser.

## Completed

- [x] Architecture discussion completed.
- [x] Revision 3 architecture document accepted as the current plan.
- [x] Shared agent instructions created.
- [x] Git repository initialized; docs, scaffold, Docker fix, backup-removal, and production-overlay commits.
- [x] pnpm/Turborepo workspace created (pnpm 11.21.0 via Corepack, TypeScript pinned to `^6.0.3` for `typescript-eslint` compatibility).
- [x] `apps/mobile` scaffolded — Expo Router, pinned to **SDK 57**. Trimmed to a single Home screen. Verified: `expo start --web` bundles and renders "Personal OS" in the browser.
- [x] `apps/api` scaffolded — Fastify. `/health` probes the DB with a 3s timeout and never throws on failure. Verified locally (degraded/healthy) and in production (see below).
- [x] `apps/worker` scaffolded — pg-boss. `boss.start()` wrapped in retry/backoff. Verified locally and in production, including the scheduled heartbeat job firing.
- [x] shared packages scaffolded — `packages/schema`, `packages/core`, `packages/db`, `packages/api-client`. All build/typecheck/test clean (re-confirmed 2026-08-15 on the Mac, post-deployment).
- [x] Drizzle configured and applied, locally and in production, as `posops_migrator`.
- [x] pg-boss schema pre-created and applied, locally and in production, as `posops_migrator`; worker runs with `migrate: false` under `posops_app`.
- [x] least-privilege DB roles created and verified, locally and in production: `posops_migrator` (DDL) / `posops_app` (no DDL — confirmed both places via a direct `CREATE TABLE` attempt that correctly fails with `permission denied`).
- [x] secrets handling configured — `.env` gitignored everywhere, `.env.example` placeholders only, gitleaks pre-commit hook (verified: blocks a staged fake secret, clean on real commits, clean on every commit made this session including the production-deployment ones).
- [x] ESLint (type-aware) + Prettier configured. Clean across the whole workspace.
- [x] Docker Compose authored and verified, both locally (Mac dev via `docker-compose.dev.yml`) and in production (Ubuntu server via `docker-compose.prod.yml`).
- [x] **No backup system** — removed as a Phase 0 requirement per user-approved architecture decision (`docs/DECISIONS.md` ADR-024). Persistent Docker volume storage is not a backup.
- [x] **Production deployment to native Ubuntu i5 (`personal-os`) — done and verified end-to-end.** Full details below.
- [x] **Phase 1 implementation — data model, recurrence engine, provider-agnostic AI layer, API routes, worker jobs — done, verified on Mac dev, and deployed to and verified in production (`personal-os`).** Full details below.
- [x] **Phase 2 backend implementation — `archived_at` soft-delete data model, task-lifecycle core helpers, tasks/notes/projects/occurrences schemas + API routes, the `expand-due-date-window` drop/archive regression fix, and a rebuilt `packages/api-client` — done and verified on Mac dev.** Full details below.
- [x] **Phase 2 automated tests — 33 new tests across `apps/api` (Fastify `.inject()` against a real dedicated test database), `apps/worker`, `packages/core`, and `packages/api-client` — closing the standing zero-test gap in both apps.** Full details below.
- [x] **Phase 2 mobile UI — NativeWind, TanStack Query, all five screens, global quick-add, explicit SPA routing config — built, verified in a real browser against a local production-mode build, deployed to production (`personal-os`), and verified end-to-end in a real browser against the live deployment.** Full details below, including four real bugs the live build/deploy surfaced and fixed.
- [x] **Phase 3 Checkpoint 1 — schema + auth foundation: `devices`/`device_pairing_codes`/`notification_dispatch_log` tables, pairing-code-gated device registration, scoped bearer-token auth with an explicit documented security boundary, nullable `inbox_items.raw_text` propagated through every consuming layer — implemented and verified with a live curl-driven pairing/registration/auth/revoke cycle against a real running server.** Full details below under "Phase 3 Checkpoint 1".
- [x] **Phase 3 Checkpoint 2 — API + worker behavior: crash-safe `notifications.dispatch` with an explicit pending/accepted/failed state machine and permanent-vs-transient Expo error classification, a provider-agnostic transcription client reusing the existing encrypted AI-provider tables, `POST /transcribe`, the `ptt.transcribe` job with `deadLetter`-driven terminal cleanup, and a required orphan-audio sweep cron — implemented and verified with a live curl-driven `/transcribe` → worker → graceful-degradation cycle against a real running server.** Full details below under "Phase 3 Checkpoint 2", including exactly what remains unverified pending real provider/push credentials.
- [x] **Phase 3 Checkpoint 3 — native app foundation: the Rabbit R1 hardware spike (KEY_POWER and the scroll wheel both conclusively confirmed unusable at the app level, recorded honestly rather than assumed), two real latent bugs fixed by the first-ever native build of this codebase, `expo-secure-store`-backed device credential persistence, pairing-code onboarding, device settings, primary-device selection, and an isolated hardware-input abstraction — implemented and verified live on the physical device, including SecureStore persistence across a real app restart.** Full details below under "Phase 3 Checkpoint 3".
- [x] **Phase 3 Checkpoint 4 — PTT + notifications + reboot survival: implemented, hardened, and verified end to end on the physical Rabbit R1, including both credential-dependent gates (real Groq `voice_transcribe` STT and real Expo Push via Firebase/FCM V1) — local development only, nothing deployed.** Full details below under "Phase 3 Checkpoint 4".
- [x] **Phase 3 Checkpoint 5 — real-device lifecycle verification: the full five-state lifecycle matrix, primary-device/revocation/re-pair, task eligibility, offline-capture durability, real foreground and background push, network transitions, small-screen UX, a web regression pass, and the full PTT lifecycle driven by the user's real voice — all run on the physical Rabbit R1, surfacing five defects, all five fixed and re-verified; Stage H found zero application defects.** Full details below under "Phase 3 Checkpoint 5".
- [x] **Phase 3 Checkpoint 6 — production deployment: migration `0004`, targeted API/worker/web rollout, Groq-only voice transcription, stable EAS-signed Rabbit transition and pairing, physical reminder/PTT/push acceptance, security verification, and targeted restart recovery — complete.** Full evidence is recorded below.
- [x] **Phase 4 Checkpoints 4.1–4.7 — calendar UI, RRULE editor, occurrence detach/cancel, Google Calendar + CalDAV sync (local dev), then production deployment with reboot-survival verification on both the Rabbit and the host — complete (2026-08-21).** Full evidence in "Phase 4 Checkpoint 4.7" above.
- [x] Phase 5 Step 0 (docs reconciliation) + Step 1 (contract/core freeze) — complete 2026-08-21.
- [x] Phase 5 Checkpoint 5.1 — Today / Home command center: migration 0010, GET /today read model, Today as default landing tab, /tasks stack route — complete 2026-08-21 (local only; production untouched).
- [x] Phase 5 Checkpoint 5.2 — Real project management: lifecycle actions, project summaries/detail read models, operational Projects UI, Today active-project correction — complete 2026-08-22 (local only; production untouched).
- [x] Phase 5 Checkpoint 5.3 STEP 0 — Migration-tooling repair: drizzle tracking reconciled on dev/test with probe-gated reproducible script + permanent journal guards; fresh-DB and production-watermark paths proven — complete 2026-08-22 (commit 035301a).
- [x] Phase 5 Checkpoint 5.3 — Daily + Weekly Review: migration 0011, review API/context collectors with TOCTOU hardening, resumable guided flows (daily + weekly), recently-completed collector, Today derived review state — complete 2026-08-22 (local only; production untouched).
- [x] Phase 5 Checkpoint 5.4 — Smart Agenda / Planning: GET /agenda read model + route (90-day cap, project filter, chronological interleave), Calendar Month|Week|**Agenda**, the central canonical all-day recurrence fix (ADR-042) across core/API/worker/routes, AI-capture canonicalization, mobile UTC-date fix, and `remind_at` PATCH — complete 2026-08-22 (local only; production untouched; **zero migrations**).
- [x] Phase 5 Checkpoint 5.6 — Mobile / Rabbit daily-use polish: reproducible dev harness via expo-build-properties (dev-profile only, production proved unaffected), dev-shell parity, FAB/PTT clearance, notification cold-start, all-day date off-by-one, serialized review saves, keyboard reachability, touch/layout polish — complete 2026-08-23 (physically verified on the Rabbit R1; production untouched; zero migrations).
- [x] **Phase 5 Checkpoint 5.7 — Production deployment + Phase 5 closure: migrations 0010–0012 applied exactly once (level 0000–0012 = 13), api/worker/web rolled out from `656c1fc`, Rabbit upgraded in place to versionCode 5 with pairing/PRIMARY/credential preserved, production `daily_brief` route registered on the existing gpt-4.1 model, reminder real-fire + push delivery + PTT all physically verified, and BOTH reboot axes passed — complete 2026-08-24. PHASE 5 COMPLETE.**
- [x] **Phase 5 Checkpoint 5.7.1 — All-day noon-anchor hotfix: ADR-042's local-noon recurrence anchor no longer reaches presentation. Two live leaks fixed (Today `12:00`, Brief "beginning at 12:00 PM"), three latent spots hardened, `BriefEventItem` gained a `date` field, one shared all_day-first helper, regression + mutation tests across Chicago/Auckland/Santiago. api+web rebuilt, versionCode 6 installed in place. Google/CalDAV untouched and provably unaffected. **No migration.** — complete 2026-08-24.**
- [x] Phase 5 Checkpoint 5.5 — Personal OS Daily Brief: migration 0012 (`ai_daily_briefs`, identity `(brief_date, timezone)`), deterministic Today-derived collector, injection-guarded prompt, provider-agnostic generation with true model provenance, `POST /briefs` + `GET /briefs/current`, Today brief metadata, and the Today Brief card — complete 2026-08-23 (local only; production untouched; no paid provider call).

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


## Phase 3 Checkpoint 6 — Stage 2A artifact gate (2026-08-19)

Stage 2A's corrective build preparation and EAS retry completed successfully at release commit `59aa29326329509f4bb286b2d731220e470c15b9`. The narrow `apps/mobile` lifecycle fix is recorded in that commit: `postinstall` runs `pnpm --filter '@personal-os/api-client...' build`, which rebuilds only the dependency closure required by the mobile app (`@personal-os/core`, `@personal-os/schema`, and `@personal-os/api-client`) before EAS's eager JavaScript bundle. A clean archived checkout with a frozen install rebuilt those outputs and bundled the Android app successfully; the complete local release gate passed, including 214 tests and gitleaks. Normal root/local workflows remained passing.

The successful EAS build is `79aed729-77ef-4102-a98a-f0aa00d02ea1`, profile `production-internal`, status `FINISHED`, package `com.himal.personalos`, version `1.0.0`, and Android `versionCode` `3`. The exact APK is preserved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/79aed729-77ef-4102-a98a-f0aa00d02ea1/personal-os-production-v1.0.0-3.apk` with SHA-256 `f2a2009dd67ea800ac0d2e9736aab62d8a4ff6ccd5d6943a6e70288d1a0fb1dc`. Its signer matches the approved EAS-managed production certificate SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`; the existing remote credential was reused with `--freeze-credentials`. Firebase project/package identity and FCM V1 assignment were verified separately through EAS metadata.

### Narrow Category A localhost exception

The APK verification rule is amended only for this exact artifact and provenance. The single embedded `http://localhost:8081` occurrence (bundle byte offset `503098`) is a React Native `0.86.2` framework fallback from `Libraries/Core/Devtools/getDevServer.js`, proven by deterministic source-map mapping from an analysis-only release export at the exact commit and production URL. Release evidence is `__DEV__ === false`, an embedded Hermes bundle, no Expo dev client/menu/launcher, Expo Updates disabled, and no Metro requirement for app launch. The Personal OS API URL is `https://personal-os.tail62a68f.ts.net`; the application fallback `http://localhost:3000` is absent from the release bundle.

This exception does not carry forward to another React Native version, bundle, APK hash, occurrence count, or source provenance. Application-reachable localhost, loopback, private-IP, development-host, and configuration-derived endpoints remain forbidden. Any new local/development endpoint is an immediate hard stop pending separate provenance analysis and approval. No application code was changed to remove this inert framework literal.

Stage 2A is an artifact-only gate. No Rabbit uninstall/install, rsync, migration, production Compose recreation, production AI configuration, database mutation, or other production mutation has occurred. The next authorized action is the read-only Stage 2B deletion-manifest gate; its exact list still requires explicit approval before any real transfer.

### Stage 2B read-only deletion-manifest hard stop (2026-08-19)

The first hardened `rsync --delete` dry run was read-only and was saved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/stage-2b-20260819T161846Z/`. Its exact would-delete manifest has SHA-256 `45da86d850f3f12c651b747eed7b9a06907dbbb6ec453f322ca2b095134abf83`. The manifest contains the expected stale tracked-source path `apps/mobile/app.json`, but also 18 generated/server-only `.husky/_/**` paths and generated `apps/mobile/expo-env.d.ts`; those paths are not deleted tracked source between deployed baseline `0c6112e` and release `59aa293`. The `.env` file remained protected and excluded; its remote owner, mode, size, mtime, and digest were captured without exposing its value.

This is a mandatory hard stop under the Checkpoint 6 deletion gate. No exclusion was added, no manifest was approved, and no real rsync transfer was run. The generated/server-only paths require explicit classification and an amended read-only dry run before any transfer can be considered. Production services, database, AI configuration, Rabbit state, and the production `.env` remain untouched.

The approved amended read-only rerun used current deployment HEAD `398ad515a19891b84f69477bdda205565c7db944` and added protect/exclude rules only for `/.husky/_/***` and `/apps/mobile/expo-env.d.ts` (the existing protections for `.env`, mobile env files, `google-services.json`, and `.claude` remained unchanged). The Git-derived expected deletion set from `0c6112e` to `398ad51` is exactly `apps/mobile/app.json`; the new itemized rsync manifest is exactly that one path with SHA-256 `0d8e40c9a006eb8bdf693bf3bd04b312cd9784fb3fde977b3777acecabf757d9`. The full audit is saved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/stage-2b-20260819T162710Z-head-398ad51/`. No `.env`, mobile env file, `google-services.json`, `.claude`, `.husky/_/***`, `apps/mobile/expo-env.d.ts`, runtime/generated state, logs, credentials, or other unexpected path is proposed for deletion; `.env` owner, mode, size, mtime, and SHA-256 are unchanged before and after the dry run.

The approved APK remains provenance-bound to application-code commit `59aa29326329509f4bb286b2d731220e470c15b9`. Current deployment HEAD `398ad51` differs only by Checkpoint 6 documentation/evidence commits and does not invalidate the APK build provenance. The real rsync transfer remains pending explicit approval of this exact one-path manifest.

### Stage 3B migration and accepted Compose volume side effect (2026-08-19)

Migration `0004_eminent_moondragon.sql` was applied once with `posops_migrator` using the reviewed two-file Compose `run --rm --no-deps` command. Its SHA-256 is `6fb71f0de872a0a220119d0000058be16c5d418cfd331cf1c7a009b08a022fd4`; the journal now contains only migrations 0000–0004, the three Phase 3 tables/index are present, and `inbox_items.raw_text` is nullable.

Expected Compose side effect discovered during Stage 3B: the one-off API migration container materialized the API service's declared `personal-os_audio_data` named volume. This did not start dependencies, restart services, alter PostgreSQL, or mount the volume into any persistent service. The volume is accepted as the Stage 4 shared audio volume and has identity `personal-os_audio_data`, local driver, Compose project `personal-os`, Compose volume `audio_data`, created `2026-08-19T15:50:54-05:00`, and was empty at verification.

For the remainder of Checkpoint 6, creation of this exact declared `personal-os_audio_data` volume during the completed Stage 3B migration is accepted. Any different or newly unexpected volume remains a hard stop; replacement or identity change of `personal-os_audio_data` is a hard stop; any change to `personal-os_postgres_data` remains an immediate hard stop.

### Checkpoint 6 final production evidence (COMPLETE, 2026-08-20)

The tracked production source is frozen at `398ad515a19891b84f69477bdda205565c7db944`; later commits are deployment-evidence documentation only and were not synced back to the server. The hardened `rsync --delete` transfer used the approved one-path deletion manifest (`apps/mobile/app.json`, SHA-256 `0d8e40c9a006eb8bdf693bf3bd04b312cd9784fb3fde977b3777acecabf757d9`) and preserved production-only/generated state. Production `.env` remained `himallinux:himallinux`, mode `600`, size `577`, mtime epoch `1786863203`, and SHA-256 `66ff0e2a5327d620309bcdf55c744851b38819bf24606e224256796de4df5cb9` through final verification.

Migration `0004_eminent_moondragon.sql` (SHA-256 `6fb71f0de872a0a220119d0000058be16c5d418cfd331cf1c7a009b08a022fd4`) was applied exactly once by `posops_migrator` with the reviewed two-file Compose `run --rm --no-deps` command. The journal contains only 0000–0004. The three additive Phase 3 tables/indexes exist, `inbox_items.raw_text` is nullable, existing data was preserved, and `posops_app` passed rolled-back DML while direct `CREATE`, `ALTER`, and `DROP` attempts remained denied.

The targeted rollout recreated only API/worker and then web. Final identities are: PostgreSQL container `bf484f07d7efebdf6958d7047c7d8b4837bb8dfe145330d7b0db936aa6ff08de`, image `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168`; API container `5f7e6965a10b890058343aeda77b722bf34f57b7289dfa8f9f57c76bdef7c3a0`, image `sha256:f686eca7189c9a2ef3d2bc74cad59b5fa9e266d2642448e4bdd5547d760d6d65`; worker container `f4457a1ee42143c083f65158e790f2219282e4f9252cdb616e15313dda4e2786`, image `sha256:7333ce956719952f5408a170dd45435c91d71d5f3e703138829b0ab2e7c09a07`; web container `9cdcfd76a9c6539e8727b1d260985176763e620b84e5ff7013b638d54fe7a209`, image `sha256:8e5ff0b45118e5716864a412e29d3f1f9dd7a98ed2ab41cc1bd28f2fb3b8e3fb`. PostgreSQL retained its original start time (`2026-08-16T06:57:20.115181374Z`) and zero restarts throughout deployment and the final application restart test.

Persistent volume identities remained `personal-os_postgres_data` (local driver, created `2026-08-15T17:32:00-05:00`) and `personal-os_audio_data` (local driver, created `2026-08-19T15:50:54-05:00`). API and worker mount the same audio volume at `/data/audio`. Final queues include `ptt.transcribe`, `notifications.dispatch`, their DLQs, and the existing capture/occurrence queues; zero failed/active jobs remained. The heartbeat, nightly occurrence expansion, and hourly orphan-audio schedules each had exactly one row after restart.

Production remains private: API `https://personal-os.tail62a68f.ts.net` maps to loopback `127.0.0.1:3000`; web `https://personal-os.tail62a68f.ts.net:8443` maps to loopback `127.0.0.1:8081`; PostgreSQL publishes no host port; both Serve routes report `tailnet only`; no Funnel/public listener exists. Both URLs were confirmed unreachable from cellular with Tailscale disabled. The production URL is embedded in the web and Rabbit artifacts; no application-reachable local/development API endpoint was found.

The Android release uses the EAS-managed remote keystore under project `@himal_pok/mobile` (`b704be80-5b01-411e-9239-fa0cea642783`) with profile `production-internal`, internal APK distribution, `credentialsSource: remote`, and `--freeze-credentials`. Build `79aed729-77ef-4102-a98a-f0aa00d02ea1` finished successfully from application-code commit `59aa29326329509f4bb286b2d731220e470c15b9`: package `com.himal.personalos`, version `1.0.0`, versionCode `3`, APK SHA-256 `f2a2009dd67ea800ac0d2e9736aab62d8a4ff6ccd5d6943a6e70288d1a0fb1dc`, signing-certificate SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`. Firebase project/package and the FCM V1 credential assignment were verified independently in EAS metadata. Future releases must reuse this EAS project/profile/remote credential, freeze credentials, use a higher versionCode, and compare the signer fingerprint before installation.

The exact APK retains the narrowly approved Category A React Native `0.86.2` framework literal: one `http://localhost:8081` occurrence from `Libraries/Core/Devtools/getDevServer.js`, deterministically source-map-proven unreachable in this release (`__DEV__ === false`, embedded bundle, no dev client/menu/launcher, Expo Updates disabled, no Metro launch dependency). The exception is bound to this APK hash, React Native version, occurrence count, and provenance and does not carry forward. The application fallback `http://localhost:3000` is absent.

The physical Rabbit R1 completed the one-time debug-to-production signing transition only after its old APK was preserved and hashed and the new artifact was reverified. The installed APK is byte-identical to the approved artifact and has the approved signer. Production device `c6c0b43d-2eed-41f4-8ee1-4c1aff65bc61` paired once, stores only a token hash server-side and the raw token in SecureStore, retained identity across app/process and production-service restarts, registered a push token, and is the sole active primary device. Notifications, microphone, and exact-alarm authorization were verified. An earlier code expired unused naturally; consumed codes could not be reused. A disposable security-probe device was revoked and returned `401 device_revoked`; the general API remained governed by the separate Tailscale perimeter exactly as ADR-029 specifies.

The physical reminder smoke created one production Inbox/task reminder for 02:55 America/Chicago. Android reported an exact zero-window alarm with the permission-based exact scheduling reason; it fired once while the app was backgrounded, and tapping it opened the correct task. No development endpoint, Metro session, or ADB reverse mapping participated.

The physical PTT smoke produced one Inbox item and one task from the user's actual speech: transcript `Checkpoint 6. Voice Smoke. Remind me to verify Grok transcription at 3 a.m. today.`, real average log probability `-0.395417`, and a 03:00 America/Chicago reminder. Production processed Rabbit microphone → `/transcribe` → shared audio volume → `Groq Production` / `whisper-large-v3-turbo` / `voice_transcribe` → transcript → the protected `My OpenAI` / `gpt-4.1` / `capture_parser` route → task. Both routes had zero fallbacks, no duplicate entity was created, `audio_path` was cleared, and the shared volume was empty afterward. The 03:00 physical reminder fired and opened the correct task. The transcript's “Grok” spelling reflects the spoken proper name and is non-blocking.

Both production push cases passed with Expo acceptance recorded separately from physical delivery. The diagnostic dispatch was accepted with ticket `01a01e31-c902-72a9-954a-d82733841236`, physically arrived, and opened correctly. A real `needs_confirm` Inbox item (`0cd123a1-7dfa-4fde-bf0d-1915168fdd90`) produced one dispatch accepted with ticket `01a01e37-094f-73dc-90cb-457de5599b57`; it physically arrived in the background and tapping it opened that exact Inbox item. An earlier intentionally ambiguous sentence legitimately parsed as a note and therefore did not dispatch; this was not treated as a push failure.

The protected production AI topology remained byte-for-byte stable for the existing parser: `My OpenAI` provider `ffa90bb6-1656-4bf6-8c91-007ba4b86b08` → `gpt-4.1` model `313633f4-2c52-4a06-a696-4f7740a95f28` → `capture_parser` route `bda49ae5-2ab6-406e-9c9e-f327867f37da`, no fallback. The only new production AI path is `Groq Production` provider `b0afa568-47a9-4942-aa86-3a65c5aaecde` → `whisper-large-v3-turbo` model `a5e3dc4d-db8f-434b-a780-13477fbf886d` → `voice_transcribe` route `7c0ef9c1-a751-40ef-80de-427d764f2770`, no fallback. No Groq parser model/route exists, and credential values were absent from repository, images, output, and final log scans.

Final targeted recovery restarted API/worker and then web without recreating any container. Their IDs/images remained identical and only their start timestamps advanced; PostgreSQL was not restarted. API health/DB connectivity, fresh worker heartbeat, zero-failure queues, singleton schedules, local and Tailscale web/API HTTP 200 responses, Rabbit SecureStore reconnection, primary/push settings, and both AI routes all recovered. No full host reboot, backup infrastructure, Google Play publication, public exposure, production-source resync, or Phase 4 work occurred.

Known non-blocking evidence retained intentionally: pairing-code and notification dispatch history were not destructively erased; the revoked disposable security-probe row remains as audit evidence; labeled smoke-test Inbox/task/note rows remain identifiable in the otherwise minimal production dataset. The reserved server-side `notify_reminders` flag remains false because MVP reminders are locally scheduled on the primary Rabbit, as designed.

## Production deployment (2026-08-15)

Target: `personal-os` — Ubuntu 26.04 LTS, HP EliteDesk 800 G5, Intel i5-9500T, 30GB RAM, reachable via `ssh personal-os` (key auth), on the same tailnet as this Mac.

**What was done:**
1. Docker Engine 29.7.2 + Compose plugin v5.4.0 installed via Docker's official apt repo (user ran the install commands interactively — sudo requires a password this session can't supply). `himallinux` added to the `docker` group (user-approved, explained as root-equivalent access first) and set as the Tailscale operator, both verified working passwordlessly afterward.
2. Repo transferred via `rsync` over the existing SSH connection (not git — no GitHub remote was created, per instruction). Excluded `node_modules`, `.git`, `.env`, build caches, and `apps/mobile` (not part of the server-side stack).
3. New `docker-compose.prod.yml`: binds only the API to `127.0.0.1:3000` (needed because `tailscale serve` runs on the host and can't reach the Docker network directly — Postgres remains published nowhere in every case), adds explicit `restart: unless-stopped` and Docker's `local` logging driver (rotation, so container logs can't fill the disk on an always-on box) to all three services.
4. Production `.env` generated fresh directly on the server via `openssl rand -hex 16` — never copied from the Mac's dev `.env`. `chmod 600`.
5. Images built on the server; Postgres brought up; migrations run via ephemeral `docker compose run` containers (never publishing Postgres's port, even temporarily) — Drizzle migration and `pg-boss migrate` both as `posops_migrator`, then `scripts/grant-pgboss-runtime.sql` for `posops_app`'s scoped runtime grants.
6. Full stack brought up with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
7. `tailscale serve --bg 3000` — the CLI itself surfaced a one-time web-consent URL (Serve wasn't yet enabled for the tailnet); user approved it in-browser, then the command completed and the proxy came up.

**Verification actually run (all 15 items from the deployment plan):**

| # | Check | Result |
|---|---|---|
| 1 | Docker Engine works | `docker run hello-world` succeeds |
| 2 | Compose works, base file publishes nothing | `docker compose -f docker-compose.yml config` has no `ports:` block anywhere |
| 3 | Postgres healthy, persistent volume, no published port | `docker compose ps` → healthy; `docker volume inspect personal-os_postgres_data` → local driver, real mountpoint; merged prod config shows exactly one published port (`127.0.0.1:3000`, the API) |
| 4 | Migrations ran as `posops_migrator` | `\dt` → `worker_heartbeat` owned by `posops_migrator` |
| 5 | pg-boss schema via migrator | `\dn+` → `pgboss` schema owned by `posops_migrator`, `posops_app` granted `USAGE` only |
| 6 | `posops_app` has no DDL | direct `CREATE TABLE` as `posops_app` → `ERROR: permission denied for schema public` |
| 7 | API `/health` reports real DB connectivity | `{"status":"ok","db":"connected",...}` |
| 8 | Worker independent, heartbeat updates | `worker.lastBeatAt` advances, `stale: false`; worker logs show `pg-boss started` / `worker started, bootstrap.heartbeat scheduled every minute` with no errors |
| 9 | API/worker reach Postgres only over the Docker network | `getent hosts postgres` resolves inside the API container (172.18.0.2); `curl 127.0.0.1:5432` from the host fails to connect (nothing published) |
| 10 | Tailscale Serve HTTPS reachable from the Mac | `curl https://personal-os.tail62a68f.ts.net/health` from the Mac → HTTP 200, `db: "connected"` |
| 11 | No unintended public exposure | `ss -tln` on the server: API only on `127.0.0.1:3000`; Tailscale's HTTPS listener bound to the tailscale interface IP specifically (`100.117.78.19:443` / the `fd7a:...` IPv6), not `0.0.0.0` — unreachable from LAN or the public internet, tailnet peers only |
| 12 | Restart behavior correct | `docker compose stop`/`start`/`restart` on api/worker all recover cleanly, confirmed via `/health` after each. **Full OS reboot test actually performed and verified** (2026-08-15): user ran `sudo reboot` (needs their password, outside this session's reach); post-reboot, `uptime -s` confirmed a fresh boot (`2026-08-15 17:43:42`, ~8 minutes prior); `docker compose ps` showed all three containers `Up`/`Up (healthy)` with **no manual intervention**; local `/health` on the server returned `db: "connected"` with a live worker heartbeat; **`https://personal-os.tail62a68f.ts.net/health` from the Mac over Tailscale returned HTTP 200 with `db: "connected"` and a fresh, non-stale heartbeat** — the full stack, including Tailscale Serve, survives an unattended reboot |
| 13 | Prod config stays separate from dev | `docker-compose.dev.yml` was never referenced in any server-side command this session |
| 14 | Worker/API lifecycle independence | stopped `api` — `worker` and `postgres` stayed `Up`; confirmed by design too (compose file has no `depends_on` between api and worker) |
| 15 | lint/typecheck/tests still pass | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @personal-os/core test` — all clean (Mac side, re-run post-deployment) |

## Phase 1 implementation (2026-08-15)

Plan approved via plan mode (see the "provider-agnostic AI layer" discussion) before implementation began. Two mid-implementation architecture gaps were found in `docs/ARCHITECTURE.md` and resolved with the user rather than improvised silently: no `notes` table existed despite `create_note` being a parser tool since Phase 1 (ADR-027, table added, doc updated); the LLM provider for the parser was unpinned (resolved into a full provider-agnostic layer, ADR-026, per explicit user requirements — OpenAI/Anthropic/Kimi/GLM/xAI/Gemini/NVIDIA NIM/OpenRouter/LM Studio/custom-OpenAI-compatible, DB-stored encrypted credentials, no silent fallback).

**What was built:**

1. **Data model** (`packages/db`) — new tables: `ai_provider_connections`, `ai_models`, `ai_task_routes` (the AI layer's config, API keys encrypted at rest as `bytea` ciphertext/iv/authTag via a `customType`), `projects`, `tags`, `item_tags`, `inbox_items`, `notes`, `tasks`, `events`, `occurrences` — matching `ARCHITECTURE.md`'s DDL exactly, including the `one_open_occurrence_per_lazy_parent` partial unique index that makes lazy generation safe under pg-boss's at-least-once delivery. Two migrations (`0001_foamy_stick.sql`, `0002_dapper_proudstar.sql`), both applied to Mac dev as `posops_migrator`.
2. **`packages/schema`** — `capture.ts`, `inbox.ts`, `parser-tools.ts` (the four tool-calling schemas + a discriminated union), `ai-provider.ts` (CRUD schemas whose response shapes deliberately never include key material). First cross-package dependency: `packages/schema` → `packages/core` (timezone validation reuse).
3. **`packages/core`** — `resolveWallClockToInstant`/`toWallClockComponents`/`wallClockToNaiveDate` (DST-safety primitives, built on `date-fns-tz`, empirically verified system-timezone-independent), `expandDueDateWindow` (pure, RRule-based, the "floating time" trick since `rrule` has no IANA timezone awareness), `computeNextLazyOccurrence` + `validateCompletionAnchoredRule`, `computeConfidence`. First runtime dependencies for this package: `rrule`, `date-fns`, `date-fns-tz`.
4. **New `packages/ai-providers`** (ADR-026) — `adapter-registry.ts` (Vercel AI SDK: native adapters for openai/anthropic/google/xai, one generic `openai_compatible` adapter covering Kimi/GLM/NVIDIA NIM/OpenRouter/LM Studio/custom endpoints), `credential-crypto.ts` (AES-256-GCM), `resolve-model.ts` (`ai_task_routes` → `ai_models` → `ai_provider_connections`, decrypt, build model), `call-with-fallback.ts` (only ever uses an explicitly configured fallback chain, never silent).
5. **`apps/api`** — restructured from one inline file into `plugins/` (`db.ts`, `boss.ts`) + `routes/` (`capture.ts`, `inbox.ts`, `occurrences.ts`, `ai-config.ts`) + a `setErrorHandler`. New endpoints: `POST /capture` (dedupe on `client_uuid`, enqueue), `GET /inbox/:id`, `POST /inbox/:id/confirm` (re-enqueues into `capture.parse` rather than creating entities itself — the API never does work inline), `POST /occurrences/:id/complete` + `/skip`, and the AI-provider CRUD/test/task-routes endpoints. New env var `CREDENTIALS_ENCRYPTION_KEY`; Fastify request logging redacts `req.body.api_key`.
6. **`apps/worker`** — three new job queues alongside the existing heartbeat: `capture.parse` (LLM tool-calling parse, 2x temperature-0.3 sampling for the type-ambiguity confidence signal, auto-commit vs `needs_confirm` routing, a `mode: "confirm"` branch for the API's confirm route), `occurrences.expand-window` (nightly cron, the mandatory `recurrence_anchor = 'due_date'` filter), `occurrences.generate-lazy` (idempotent via the partial unique index, catches the specific constraint violation as a no-op). `commit-parsed-entity.ts` is the single place a tool call becomes a task/note/event row, including seeding the first occurrence for a newly created completion-anchored task (a gap in `ARCHITECTURE.md`'s own description — nothing else would ever create it). Retry/backoff are pg-boss **queue-level** options (`createQueue`, not `work`); since `create_queue` is `INSERT ... ON CONFLICT DO NOTHING`, apps/api and apps/worker share identical `QUEUE_RETRY_OPTIONS` constants so whichever process starts first doesn't silently win with the wrong config.

**A real runtime bug caught and fixed during verification, not just planning:** `rrule@2.8.1`'s CJS build has no `"exports"` map; Node's ESM↔CJS named-export interop (`cjs-module-lexer`) fails to statically detect its named exports even though the package's own `.d.ts` declares them — `import { RRule } from "rrule"` type-checked cleanly but threw at runtime under `tsx`/Node (`does not provide an export named 'RRule'`), while Vitest's separate transform pipeline masked it in unit tests. Fixed with `createRequire(import.meta.url)` + a type-only import for the cast, in both recurrence modules — verified by actually booting `apps/api`/`apps/worker` via `tsx watch`, not just `tsc --noEmit`.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` | All clean. 51 unit tests pass across `packages/core` (26, incl. the DST-crossing and completion-anchored scenarios below), `packages/ai-providers` (14, incl. credential-crypto round-trip/tamper tests), `packages/schema` (11, new — this package previously had a `test` script but zero test files) |
| 2 | Migration applies cleanly as `posops_migrator`; `posops_app` still can't DDL | Re-confirmed with the Phase 1 tables present: `INSERT INTO projects ...` as `posops_app` succeeds; `CREATE TABLE should_fail ...` as `posops_app` → `ERROR: permission denied for schema public`. No new grant script needed (default-privilege grant from Phase 0 already covers new `public` tables) |
| 3 | `apps/api`/`apps/worker` start successfully | Both booted via `tsx watch` against the local dev Postgres; worker connected pg-boss, created all four queues, scheduled the heartbeat and nightly window-expansion crons |
| 4 | `POST /capture` end-to-end | Real curl request → row in `inbox_items` → enqueued → worker picked it up. Dedupe on `client_uuid` verified (same UUID twice → same `inbox_id`, one row). Validation verified (bad payload → structured 400) |
| 5 | Graceful failure with no AI provider configured | `capture.parse` correctly threw `NoProviderConfiguredError`, set `inbox_items.status = 'failed'` with a clear message, did **not** retry (config error, not transient) — proves the whole pipeline wiring works up to the LLM call boundary |
| 6 | AI provider CRUD + encryption at rest | `POST /ai/providers` with a fake key → `GET /ai/providers` response contains no key material; direct psql query confirmed `api_key_ciphertext` is genuinely encrypted (ciphertext bytes don't contain the plaintext key); `POST /ai/providers/:id/test` against an unreachable endpoint returned a graceful `{success:false}` rather than a 500 |
| 7 | **DST-crossing due-date rule — live, not just unit-tested** | Inserted a real `FREQ=WEEKLY;INTERVAL=1` task via psql (9am `America/Chicago`, straddling the 2026-11-01 fall-back), manually enqueued `occurrences.expand-window`, let the running worker process it: Oct 25 → `14:00 UTC` (CDT), Nov 1/Nov 8 → `15:00 UTC` (CST) — wall-clock stayed 09:00, UTC offset shifted by exactly one hour at the boundary |
| 8 | **Completion-anchored lazy generation — live, not just unit-tested** | Inserted a real `FREQ=DAILY;INTERVAL=3` completion-anchored task + a seed occurrence backdated 10 days, called `POST /occurrences/:id/complete` for real: the new occurrence was anchored from the actual completion instant (not the stale backdated one) — verified `occurs_at` = completion time + exactly 3 days. Repeated for `/skip`. Directly attempted a duplicate open lazy occurrence via SQL and confirmed `one_open_occurrence_per_lazy_parent` rejects it with `ERROR: duplicate key value violates unique constraint` — the exact safety net `generate-lazy-occurrence.ts`'s catch block relies on |
| 9 | No API key ever appears in a GET response or in server logs | Spot-checked; response schemas structurally exclude key material, Fastify redaction configured for `req.body.api_key` |
| 10 | gitleaks / secrets | `.env` (holds the real `CREDENTIALS_ENCRYPTION_KEY`) confirmed still gitignored and untracked; nothing staged |

**Not yet run (needs a real LLM provider key from the user):** the actual LLM-parsing happy path — registering a real provider, running the ~50 hand-typed captures from `ARCHITECTURE.md`'s Phase 1 description, and the "swap providers mid-test" check that proves the abstraction isn't secretly single-vendor. Everything up to the LLM call boundary (steps 4–6 above) is verified; the call itself needs credentials this session doesn't have.

**Not yet done (at Mac-dev-verification time):** production deployment; individually ticking `docs/PHASE-0-CHECKLIST.md`'s Phase 0 boxes (pre-existing housekeeping item, unrelated to Phase 1). **Both since resolved — see "Phase 1 production deployment" below for the first; the checklist item remains open.**

## Phase 1 production deployment (2026-08-15)

Deployed to `personal-os` the same session, immediately after Mac-dev verification and a local commit (`f194cc7`) checkpointing the verified state first.

**A real bug caught only by attempting the production build, not by anything on Mac dev:** `apps/api/Dockerfile` and `apps/worker/Dockerfile` hardcoded an explicit package build order (`pnpm --filter @personal-os/schema build && pnpm --filter @personal-os/db build && ...`) predating Phase 1 — it had no entry for the two new packages (`@personal-os/core`, `@personal-os/ai-providers`) that `@personal-os/schema` and both apps now depend on, so the production image build failed with `Cannot find module '@personal-os/core'`. This class of bug can't reproduce on Mac dev, where `pnpm build`/`turbo run build` already resolve the dependency graph correctly — only the Docker build path had a hand-maintained, now-stale chain. Fixed by replacing the hardcoded chain with `pnpm exec turbo run build --filter=api...` / `--filter=worker...`, which resolves the graph itself and won't go stale the next time a package dependency is added.

**A second gap, caught before it could bite:** `docker-compose.yml`'s `api`/`worker` service blocks only pass through `DATABASE_URL`/`PORT` explicitly to containers — Compose does not auto-inject arbitrary `.env` variables. `CREDENTIALS_ENCRYPTION_KEY` (new in Phase 1, required by both apps' `env.ts`) would have been invisible inside the containers even with it correctly set in `.env`, causing an immediate crash-loop on startup. Fixed by adding `CREDENTIALS_ENCRYPTION_KEY: ${CREDENTIALS_ENCRYPTION_KEY:?...}` to both services' `environment:` blocks in `docker-compose.yml` (shared by dev and prod), verified with `docker compose config` locally (both dev and prod overlays) before touching the server.

**What was done, in order:**
1. Inspected production state first: 3 containers healthy, exactly one published port (`127.0.0.1:3000`, the API), `.env` present (600 perms, 6 vars, none touched), no `.git` on the server (repo lives there via `rsync`, matching the Phase 0 precedent, not `git pull`), only migration `0000` (the Phase 0 `worker_heartbeat` table) applied.
2. Re-confirmed both new migrations (`0001_foamy_stick.sql`, `0002_dapper_proudstar.sql`) contain only `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD CONSTRAINT` on brand-new tables — no `DROP`/`ALTER ... DROP`/`DELETE`/`TRUNCATE` anywhere, nothing touches `worker_heartbeat` or any existing row. Forward-only, no downtime required.
3. `rsync`'d the updated repo to `personal-os` with the same exclusions as the Phase 0 deployment (`node_modules`, `.git`, `.env`, build caches, `apps/mobile`) — confirmed `.env`'s size/mtime/md5 unchanged immediately after.
4. Generated a fresh `CREDENTIALS_ENCRYPTION_KEY` **on the server itself** via `openssl rand -base64 32` (never copied from the Mac's dev key, same principle as the other secrets) and appended it as a new line to the existing `.env` — the original 6 variables and their values were not touched.
5. Hit the two Docker/Compose gaps above; fixed both, verified locally, `rsync`'d just the 3 changed files (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `docker-compose.yml`) to the server.
6. Rebuilt `api`/`worker` images on the server — succeeded.
7. Ran the Drizzle migration as `posops_migrator` via an ephemeral `docker compose run --rm --entrypoint sh api -c "pnpm --filter @personal-os/db db:migrate"`, with `MIGRATIONS_DATABASE_URL` constructed server-side (`postgres:5432` service hostname + the existing `POSTGRES_MIGRATOR_PASSWORD` read from `.env` in-shell, never printed) — Postgres's port was never published, even transiently.
8. `docker compose up -d api worker` — recreated only `api`/`worker` (confirmed `postgres` stayed `Running`/`Healthy`, untouched, zero DB downtime).

**Verification actually run, against the live production deployment:**

| # | Check | Result |
|---|---|---|
| 1 | All containers healthy | `api`/`worker`/`postgres` all `Up`, `postgres` `(healthy)`, no restart loops |
| 2 | API health over real Tailscale HTTPS | `curl https://personal-os.tail62a68f.ts.net/health` from the Mac → `{"status":"ok","db":"connected","worker":{"stale":false}}` |
| 3 | New migrations applied | `\dt` on production Postgres lists all 12 tables: `ai_models`, `ai_provider_connections`, `ai_task_routes`, `events`, `inbox_items`, `item_tags`, `notes`, `occurrences`, `projects`, `tags`, `tasks`, `worker_heartbeat` |
| 4 | `posops_app` still has no DDL | Direct `CREATE TABLE should_fail (...)` as `posops_app` on production → `ERROR: permission denied for schema public`, re-confirmed **after** the migration |
| 5 | `capture.parse` worker job runs | Real `POST /capture` over Tailscale HTTPS → row written → enqueued → worker picked it up within seconds → `NoProviderConfiguredError` handled correctly (`status: 'failed'`, clear message, no retry loop) — proves the pipeline wiring end-to-end in production |
| 6 | Recurrence jobs — DST-crossing due-date rule | Inserted a real `FREQ=WEEKLY;INTERVAL=1` task via psql (9am `America/Chicago`, straddling 2026-11-01), manually enqueued `occurrences.expand-window` on the live worker: Oct 25 → `14:00 UTC` (CDT), Nov 1/Nov 8 → `15:00 UTC` (CST) — identical behavior to Mac dev |
| 7 | `/occurrences/:id/complete` and `/skip` | Both called for real over Tailscale HTTPS against a completion-anchored task with a seed occurrence backdated 10 days: the generated successor was anchored from the actual completion/skip instant (+3 days), not the stale backdated one |
| 8 | Lazy generation + duplicate prevention | Directly attempted a second open lazy occurrence for the same parent via SQL → `ERROR: duplicate key value violates unique constraint "one_open_occurrence_per_lazy_parent"` — the exact safety net the job handler's catch block relies on, confirmed live |
| 9 | AI provider credentials encrypted at rest | `POST /ai/providers` with a fake key on production → direct psql query confirmed `api_key_ciphertext` bytes do not contain the plaintext key, correct AES-256-GCM ciphertext/IV/auth-tag lengths |
| 10 | API keys never returned or logged | `GET /ai/providers` response contains no key material; `docker compose logs api \| grep <the fake key>` → no match |
| 11 | Graceful behavior with no AI provider configured | Same as #5 — `NoProviderConfiguredError` → `status: 'failed'`, no crash, no retry storm |
| 12 | Restart behavior | `docker compose restart api worker` → both recovered cleanly; `/health` over Tailscale HTTPS returned a fresh, non-stale heartbeat within seconds |
| 13 | No new host ports exposed | `ss -tln` on the server before vs. after: identical port set (`127.0.0.1:3000` API, Tailscale's `443`/tailnet-interface-only, `22` SSH, unrelated local system services) — no `0.0.0.0:3000`, Postgres still unpublished |
| 14 | Mac-side build/typecheck/lint/format/test | Re-run after the Dockerfile/compose fixes: all clean, same 51 tests passing |

All test data (`inbox_items`, the two test tasks + their occurrences, the test `ai_provider_connections` row) deleted from production after verification — production DB is empty of test artifacts, exactly as found before this deployment except for the new, empty Phase 1 tables.

## Phase 1 real-LLM verification (2026-08-15)

The user registered a real OpenAI API key against production via `POST /ai/providers` → `POST /ai/models` (`gpt-4.1`) → `POST /ai/task-routes` (`capture_parser`). The connection test succeeded (`{"success":true}`) — the key is registered correctly. The very first real capture through the pipeline then failed, and **stayed failed on retry** — this was a genuine bug the provider-key milestone surfaced, not a fluke, found by reading `pgboss.job`'s error output directly rather than assuming it would eventually succeed.

**Bug 1 — offset-less datetimes rejected outright.** `packages/schema`'s `due_at`/`remind_at`/`start`/`end` fields required `z.string().datetime({ offset: true })`. GPT-4.1's tool call correctly resolved "tomorrow at 3pm" but returned it without a UTC offset (e.g. `2026-08-17T15:00:00`, no `-05:00`/`Z`) — the model isn't guaranteed to include one just because the schema asks for it. Two compounding causes: the system prompt never told the model what "now" was or what timezone the user was in, so it had no strong anchor or reason to qualify the offset; and the schema rejected an unqualified value outright instead of falling back to interpreting it in the capture's own timezone (something the codebase already had DST-safe machinery for — `resolveWallClockToInstant` — just not wired up to this path).

Fixed with three changes, in order of how much they actually matter: (1) the worker's system prompt now includes the capture's `capturedAt` (as an ISO instant) and `timezone`, and explicitly instructs the model to resolve relative phrases against that anchor and always include a UTC offset; (2) `packages/schema`'s datetime fields relaxed to accept an ISO datetime with an *optional* offset (`FlexibleDatetimeSchema`), so a compliant-but-imperfect response doesn't hard-fail validation; (3) new `packages/core` function `parseFlexibleDatetime(value, fallbackTimezone)` — offset-bearing values parse directly (unambiguous), offset-less values resolve via `resolveWallClockToInstant` against the capture's timezone instead of `new Date(string)`, which would have silently used the *container's* system time zone (typically UTC) and misinterpreted a Chicago afternoon as a UTC one. `commit-parsed-entity.ts`'s four `new Date(...)` call sites (task `due_at`/`remind_at`, event `start`/`end`) all switched to this. 4 new unit tests in `timezone.test.ts`.

**Bug 2 — a false-positive confidence flag.** Once bug 1 was fixed, the same capture ("remind me to call the insurance guy tomorrow at 3pm") correctly resolved a task with `remind_at` set — but still routed to `needs_confirm` with `unresolvedDatePhrase`. `hasResolvedDate()` in `capture-parse.ts` only checked `due_at`; a pure reminder resolves into `remind_at` instead (correctly — that's what "remind me to X tomorrow" *is*), so the signal fired on every correctly-resolved reminder. Fixed to check both fields.

**Verified after both fixes, against the live production deployment with the real key, no mocking:**
- The originally-failing capture re-run: `status: "parsed"`, auto-committed, `remind_at` = `2026-08-17 20:00:00+00` — 3pm Chicago (CDT, UTC-5) on the correct date, read back directly from the `tasks` row.
- A note-shaped capture ("Idea: build a habit tracker widget...") → `entity_type: "note"`, auto-committed.
- An event with a time range ("Team standup meeting tomorrow from 9am to 9:30am") → `entity_type: "event"`, auto-committed; `starts_at`/`ends_at` read back as `14:00`/`14:30` UTC — correct for 9:00/9:30am Chicago.
- Gibberish ("asdf") → routed to the `unclear` tool with a sensible reason, `status: "needs_confirm"` — the confidence-routing default-to-caution behavior working as designed, not a failure.

All test captures and their resulting entities deleted from production afterward. The real `ai_provider_connections`/`ai_models`/`ai_task_routes` rows (the user's actual OpenAI configuration) were left in place — those aren't test data, they're the intended live configuration.

**Not yet run:** the full ~50-capture pass from `ARCHITECTURE.md`'s Phase 1 description, and the "swap providers mid-test" check proving the abstraction works with a second, different provider type. Both are optional further confidence-building, not blockers — the pipeline is proven correct end-to-end with a real provider.

## Phase 2 backend implementation (2026-08-16)

Plan approved via plan mode, including two corrections made by the user before approval: delete semantics changed from an initial hard-delete+cascade draft to soft-delete/archive (`archived_at`, no destructive removal of `occurrences`/`item_tags`/`inbox_items` lineage, no Trash/Restore UI built but the API is shaped so restoration can be added later); and the web deployment section was made explicit about `web.output: "single"` SPA routing for the app's UUID-keyed dynamic routes, verified live against Expo's current documentation rather than assumed from memory. This entry covers the backend layer only — see "Not yet done" at the end.

**What was built:**

1. **Data model** (`packages/db`) — nullable `archived_at timestamptz` added to `tasks`/`notes`/`projects` (soft-delete axis, independent of task lifecycle `status`); new indexes `tasks_project_id_idx`, `tasks_status_due_at_idx` (partial, `where archived_at is null`), `notes_project_id_idx` (partial), `events_project_id_idx`, `events_starts_at_idx`; a missing doc comment added on `inbox_items.entity_id`'s polymorphism (matching the existing comments on `occurrences.parent_id`/`item_tags.item_id`). Deliberately did **not** add a `projects.status` check constraint (an earlier plan draft proposed `('active','archived')`, which would have collided in meaning with the new `archived_at` column on the same table — organizational status and soft-delete are kept as separate axes, per the user's correction). One new migration, `packages/db/drizzle/0003_shiny_klaw.sql` — purely additive (3 `ADD COLUMN`, 5 `CREATE INDEX`), no drops or data-migrating statements.
2. **`packages/core`** — new `task-lifecycle.ts`: `canCompleteTaskDirectly` (false for any task with an `rrule` — recurring tasks complete via their occurrence, not directly) and `canActivateTask` (true only from `status: "inbox"`). Pure, colocated tests.
3. **`packages/schema`** — new `tasks.ts`, `notes.ts`, `projects.ts`, `occurrences.ts`, `pagination.ts` (shared `PaginationQuerySchema` + `paginatedResponseSchema` factory). `TaskCreateSchema`/`TaskUpdateSchema` are `.strict()` — an attempt to sneak `rrule`/`recurrence_*`/`status`/`archived_at` into a request body is a `400 validation_failed`, not a silent strip, since RRULE creation/editing stays capture(AI)-only until Phase 4's RRULE editor. `FlexibleDatetimeSchema` exported out of `parser-tools.ts` for reuse instead of duplicating the offset-optional datetime regex.
4. **`apps/api`** — new `routes/tasks.ts`, `notes.ts`, `projects.ts`; extended `routes/inbox.ts` (`GET /inbox` list, previously missing) and `routes/occurrences.ts` (`GET /occurrences` list, new — lets a client discover a recurring task's open occurrence id). Full endpoint list: `GET/POST /tasks`, `GET/PATCH /tasks/:id`, `POST /tasks/:id/{archive,activate,complete,drop}`; `GET/POST /notes`, `GET/PATCH /notes/:id`, `POST /notes/:id/archive`; `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/archive`. No `DELETE` verb anywhere — archiving is modeled as a `POST .../archive` action endpoint since it's a reversible state change, not a deletion, matching the existing `/complete`/`/drop` convention. `POST /tasks/:id/complete` on a recurring task returns `409 { error: "recurring_task_use_occurrence", occurrence_id }` rather than acting — the occurrence id is resolved via the same "earliest scheduled occurrence" query `GET /occurrences` exposes. `POST /projects/:id/archive` has no manual cascade code at all — the existing `project_id` FK (`onDelete: "set null"`) already does the right thing since nothing is being deleted at the database level.
5. **`apps/worker`** — `jobs/expand-due-date-window.ts`'s query gained `ne(tasks.status, "dropped")` and `isNull(tasks.archivedAt)`. Before Phase 2, nothing could ever change a task's status or archive it, so this filter didn't exist and wasn't needed; `POST /tasks/:id/drop` and `POST /tasks/:id/archive` are the first code paths that can, and without this fix the nightly cron would have kept silently regenerating occurrences for a task the user just dropped or archived.
6. **`packages/api-client`** — rebuilt from a one-method (`health()` only, no error handling) stub into `client.ts` (`fetchJson` helper, `ApiClientError{status, code, issues?, body}` thrown on any non-2xx, a generic `buildQuery` helper) plus one file per domain (`capture.ts`, `inbox.ts`, `tasks.ts`, `notes.ts`, `projects.ts`, `occurrences.ts`), composed into a flat `createApiClient(baseUrl)` method bag in `index.ts`. Also filled in the pre-existing gap that Phase 1's `/capture`/`/inbox`/`/occurrences` endpoints never got client methods. Zero React/TanStack dependency in this package, per `packages/api-client`'s framework-agnostic contract — those hooks are Phase 2's next step, in `apps/mobile`.

**Verification actually run (Mac dev):**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after every change in this section |
| 2 | Migration `0003` applies cleanly as `posops_migrator` | `\d tasks`/`\d notes`/`\d projects`/`\d events` show the new columns/indexes exactly as generated; `posops_app` re-confirmed unable to `CREATE TABLE` (`permission denied for schema public`) and able to read the new `archived_at` columns |
| 3 | `apps/api`/`apps/worker` boot via `tsx watch` against local dev Postgres | Clean start, `/health` → `{"status":"ok","db":"connected",...}` |
| 4 | Full task CRUD + lifecycle, live curl | `POST /tasks` with `rrule` in the body → `400`; plain create → `active`; `PATCH` → field updates persist; `POST /tasks/:id/complete` → `done`+`completed_at`; `POST /tasks/:id/archive` → `archived_at` set |
| 5 | Archive is independent of status, and hides from default list views without touching anything else | The same task stayed `status: "done"` after archiving (two independent axes, as designed); `GET /tasks?project_id=` → `total: 0` after archiving, `GET /tasks?project_id=&include_archived=true` → `total: 1`, `GET /tasks/:id` → still returns the row directly |
| 6 | `inbox → active` real transition | Inserted a `status: "inbox"` task directly via `psql` (simulating an AI capture); `POST /tasks/:id/activate` → `active`; calling it again → `409 invalid_status_transition`; calling `/activate` on a `done`+archived task → `409` from the wrong starting state |
| 7 | Notes CRUD + archive | Create → patch → archive; `GET /notes` excludes the archived one afterward |
| 8 | Project archive does not orphan its tasks | Archived a project owning a task; the task's `project_id` stayed set (confirmed via `GET /tasks/:id`) — no cascade, exactly as designed (soft-delete never triggers the `set null` FK, since nothing is deleted at the database level) |
| 9 | Recurring-task `/complete` redirect | Inserted a real `FREQ=WEEKLY;INTERVAL=1` due-date task via `psql`, ran `expand-due-date-window` manually (12 occurrences generated over the 90-day window), called `POST /tasks/:id/complete` directly → `409 { error: "recurring_task_use_occurrence", occurrence_id: "<the earliest scheduled one>" }` |
| 10 | **The `expand-due-date-window` regression fix, live, not just read** | Dropped the same recurring task, deleted its 12 occurrences, re-ran the window job → **0** new occurrences generated (previously it would have regenerated all 12, silently undoing the drop). Repeated with a second recurring task using `archive` instead of `drop` → same result, **0** regenerated. A third, still-active recurring task in the same test confirmed the job still works normally (12 generated) — the filter excludes exactly `dropped`/archived tasks, not recurring tasks in general |

All test data (projects, tasks, notes, occurrences created during this verification) deleted from the dev database afterward.

**Automated tests added** (closing the standing zero-test gap): `apps/api` gained `vitest.config.ts` (pointing `DATABASE_URL` at a dedicated `personalos_test` database, `fileParallelism: false` since all route test files share that one database) and route tests for tasks/notes/projects/inbox/occurrences (23 tests) using Fastify's `.inject()` against real Postgres, not mocks — covering CRUD happy paths, `.strict()` rejecting `rrule`/`status`/`archived_at`, the recurring-task 409 redirect, the `activate` 409 from non-inbox states, and archive-independence (a follow-up `SELECT` confirms occurrences/item_tags/inbox_items row counts are unchanged after archiving, not just that the response looked right). `apps/worker` gained a direct regression test for the drop/archive fix above (3 tests). `packages/api-client` gained `client.test.ts` (8 tests, stubbed `fetch`) verifying `ApiClientError` shape and request formatting.

## Phase 2 mobile UI + production deployment (2026-08-16)

Built the `apps/mobile` web UI and deployed it as an always-on production service, per decisions 5 and 6. This is the part of Phase 2 with the most genuine surprises — four real bugs, none visible from source review alone, each found only by actually booting the app (first locally, then in production) and clicking through it in a real browser.

**What was built:**

1. **NativeWind** — `nativewind`, `tailwindcss`, `babel-preset-expo` added; `tailwind.config.js` (content globs over `src/`, `darkMode: "class"` — see Bug 2 below), `babel.config.js`, `metro.config.js` (`withNativeWind`), `nativewind-env.d.ts`. The existing `src/global.css` already had `@/global.css` wired into the app's import graph from Phase 0 (for CSS custom properties) — added the `@tailwind base/components/utilities` directives to that same file rather than introducing a second CSS entry point. `app.json`'s `web.output` changed from `"static"` to `"single"` — the SPA mode the plan requires, verified live against Expo's own docs during planning: no per-route static HTML, no `generateStaticParams` needed, routing for `tasks/[id]`/`notes/[id]`/`projects/[id]` happens entirely client-side.
2. **TanStack Query** — `src/queries/client.ts` (the `QueryClient` + `createApiClient(EXPO_PUBLIC_API_URL)` instance) plus one hooks file per domain (`tasks.ts`, `notes.ts`, `projects.ts`, `inbox.ts`, `occurrences.ts`, `capture.ts`), each invalidating the relevant query key on mutation success.
3. **Five screens** under a `(tabs)` group (Tasks — default, New/Active/Done/Dropped filter; Inbox triage; Notes; Projects) plus pushed routes for `tasks/[id]`, `tasks/new`, `notes/[id]`, `notes/new`, `projects/[id]`, `projects/new`. A recurring task's `rrule` renders read-only on its edit screen, never editable, per decision 1. Completing a recurring task from the list catches the API's `409 recurring_task_use_occurrence` and falls back to completing its open occurrence instead of the task directly.
4. **Global quick-add** (`src/components/quick-add-fab.tsx`) — a floating action button + modal mounted once in the root `_layout.tsx`, reachable from every screen, per decision 5.
5. **Production deployment**: new `apps/mobile/Dockerfile` (multi-stage — builds the workspace's package dependencies via `turbo run build --filter=mobile...`, then `expo export --platform web` with `EXPO_PUBLIC_API_URL` baked in via a build arg, then a `serve -s dist` runtime stage — the `-s` flag is the actual SPA-fallback mechanism, rewriting any unmatched path to `index.html` instead of 404ing). New `web` service in `docker-compose.yml` (no ports — matches the base file's "nothing published" pattern) and `docker-compose.prod.yml` (`127.0.0.1:8081:8080`, matching the API's own localhost-only binding pattern). `.dockerignore`'s prior blanket `apps/mobile` exclusion removed (Phase 0/1 never needed that directory in any Docker build context; Phase 2's web image does). New `@fastify/cors` on `apps/api`, scoped to a `WEB_APP_ORIGIN` env var (comma-separated allowlist, defaults cover local Metro dev ports) — needed because the web app and the API are different origins (different Tailscale Serve ports). A second Tailscale Serve HTTPS listener, `--https=8443`, proxying to the web container — confirmed the `himallinux` Tailscale-operator grant from the Phase 0 deployment still works passwordlessly for this, no sudo needed.

**Four real bugs found and fixed, each only by running the actual app:**

- **Bug 1 — Node-only `rrule` workaround leaking into the browser bundle.** The Phase 1 fix for `rrule`'s CJS/ESM interop bug (`createRequire(import.meta.url)`, see the 2026-08-15 entry above) is Node-only — `import.meta.url` and `node:module` don't exist in a browser. `packages/schema` imports `isValidTimezone` from the `@personal-os/core` barrel, which `export *`s the recurrence module; Metro bundles whatever a barrel import statically reaches, so the web build crashed at boot with `Cannot use 'import.meta' outside a module`. Fixed by adding a `./timezone` subpath export to `packages/core/package.json` and changing `packages/schema`'s two call sites to import from `@personal-os/core/timezone` directly, keeping `rrule` and the Node-only workaround out of the web bundle's module graph entirely. `apps/api`/`apps/worker` are unaffected — they still import the full barrel and run in Node.
- **Bug 2 — NativeWind's dark-mode `MutationObserver` crashed under the default `media` strategy.** `react-native-css-interop`'s web runtime observes the DOM and calls its own `colorScheme.set()` internally to sync OS preference — under NativeWind's default `darkMode: "media"`, that internal `.set()` call throws unconditionally (`Cannot manually set color scheme, as dark mode is type 'media'`), crashing app boot. Fixed by setting `darkMode: "class"` in `tailwind.config.js` (using NativeWind's own `useColorScheme` hook, not React Native's raw one, for the root layout's theme selection) — the interop runtime still follows OS preference automatically, just through a code path the library actually supports.
- **Bug 3 — the API client always sent `Content-Type: application/json` even with no body.** Every action endpoint (`/tasks/:id/archive`, `/activate`, `/complete`, `/drop`, `/notes/:id/archive`, `/projects/:id/archive`, occurrence complete/skip) is called with no request body — but `fetchJson` unconditionally set `Content-Type: application/json` regardless, which Fastify's JSON body parser correctly rejects as `FST_ERR_CTP_EMPTY_JSON_BODY` (a claimed JSON body that's actually empty). This shipped past all 23 new route tests because `.inject()` never goes through the client's request-shaping logic at all — only exercising the real UI against a real server caught it. Fixed in `packages/api-client/src/client.ts`: only set `Content-Type` when `init.body` is actually present. Added a regression test (`client.test.ts`) asserting the header is absent for a bodyless request.
- **Bug 4 — the error handler coerced every framework-level error to `500`.** Bug 3's malformed-request error has its own `statusCode: 400` from Fastify, but `apps/api`'s `setErrorHandler` only special-cased `ZodError` and treated everything else as an opaque `500 internal_error` — masking a genuine, actionable 400 as an unexplained server failure and making Bug 3 harder to diagnose than it should have been. Fixed to respect a thrown error's own `statusCode` (and `code`) when it's a real 4xx, falling back to `500` only for errors that don't self-report a client-error status.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | Local dev (`expo start --web`), real browser | Booted clean after the two crash fixes (Bugs 1–2); NativeWind styling visibly applied; console free of the earlier `import.meta`/color-scheme errors |
| 2 | Global quick-add | Reachable from every tab; a real capture landed in Inbox triage and displayed its `status: "failed"` / `"no AI provider is configured for task \"capture_parser\""` correctly (dev DB has no AI provider configured — this is the same graceful Phase 1 error-handling behavior, working as designed, not a new failure) |
| 3 | Notes: create/edit/archive | Full cycle through the UI; **live TanStack Query invalidation confirmed** — archiving a note removed it from the default list within the same session, no manual page refresh, verified via a clean single-action test after an earlier double-click test produced a momentarily confusing (but ultimately consistent) render |
| 4 | Tasks/Projects screens | Rendered correctly; project creation, task creation with project assignment, and project-scoped task/note lists all confirmed via curl cross-checks against the running dev API |
| 5 | **Production-mode SPA build, local** (`expo export --platform web` + `serve -s dist`, not the dev server) | `dist/` contains exactly one `index.html`, one JS bundle, one CSS bundle (confirms `web.output: "single"` is genuinely producing SPA output, no per-route prerendering) |
| 6 | Direct cold load of `/tasks/<uuid>`, refresh, and a fresh-tab deep link to `/projects/<uuid>` (no prior `/` visit) | All three render the correct screen with real data, not a 404 — run against the local `serve -s dist` build |
| 7 | Production deployment | `docker compose build api worker web` succeeded on `personal-os`; migration `0003` applied via ephemeral `posops_migrator` container (see note below on an unintended `postgres` container recreation); `docker compose up -d api worker web` — all 4 containers healthy, the user's real AI-provider configuration (1 connection/model/task-route row) confirmed intact throughout |
| 8 | Port/security audit | `ss -tln` on the server: only `127.0.0.1:3000` (api), `127.0.0.1:8081` (web), and Tailscale's own tailnet-interface listeners on `443`/`8443` — no `0.0.0.0` bindings, Postgres still unpublished, identical security posture to Phase 0/1 |
| 9 | API health + web app, real Tailscale HTTPS | `https://personal-os.tail62a68f.ts.net/health` → `db: "connected"`; `https://personal-os.tail62a68f.ts.net:8443/` → `200` |
| 10 | CORS, real Tailscale HTTPS | A preflight from the deployed web origin (`https://personal-os.tail62a68f.ts.net:8443`) → `access-control-allow-origin` present; the identical request with `Origin: https://evil.example.com` → header absent, request would be blocked client-side |
| 11 | **Full SPA-routing check against the live deployment, in a real browser** (Claude's in-app browser sandbox blocked `/_expo/static/*` requests on the non-standard `:8443` port — confirmed via `curl` that the exact same URLs return `200`; re-verified visually using the user's real Chrome instead) | Direct cold load of `/tasks/<real-uuid>` and a hard refresh on it both rendered correctly against the live deployment |
| 12 | **Full lifecycle cycle against live production data, in a real browser**: create → view via direct deep link → refresh → archive (one task), and separately capture-simulated inbox → activate → complete → archive (a second task) | Every transition confirmed both visually (UI state updated correctly, no manual refresh needed) and via a follow-up `GET`/`psql` check that the database state actually changed |
| 13 | Restart behavior | `docker compose restart api worker web` on production → all three recovered cleanly within seconds, confirmed via `/health` and the web app reloading |
| 14 | Final workspace verification | `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all clean workspace-wide (now including `apps/mobile`, which gained its own `typecheck` script — previously absent, so the root command silently never checked it) |

**One deployment-process mistake, caught and explained rather than hidden:** the migration step's `docker compose run --rm --entrypoint sh api -c "..."` command omitted the `-f docker-compose.prod.yml` flag, causing Compose to reconcile against a different merged config than what was actually running and recreate the `postgres` container. The named volume (`postgres_data`) is independent of container recreation, so no data was lost — confirmed immediately via `select count(*) from ai_provider_connections` before and after (both `1`, matching the user's real, intentionally-preserved AI provider configuration) — but it was a few seconds of avoidable restart that a Phase 1-style "zero downtime" deployment shouldn't have had. Every subsequent command in this deployment explicitly passed both `-f docker-compose.yml -f docker-compose.prod.yml` to prevent a repeat.

All test data (tasks, notes, projects, inbox items created during this verification) deleted from both the dev and production databases afterward. The user's real AI-provider configuration was left untouched in production throughout.

## Phase 3 Checkpoint 1: schema + auth foundation (2026-08-16)

Plan approved via plan mode after three revisions. The target native device is a Rabbit R1 running CipherOS (community AOSP-based Android 16/SDK 36), inspected directly via `adb` during planning (screen 480x640px/density-override 190, live input-event capture of the scroll wheel and side button) rather than trusting public hardware reports — the side-button driver was found to fire real interrupts on this exact unit, contradicting a public "zero interrupts" report, though the button fires as `KEY_POWER`, which Android conventionally intercepts before app dispatch (an open question deferred to a Checkpoint 3 spike). Plan review also caught and corrected: an ineffective `POST /devices` access control (any tailnet peer could re-register a revoked device), an unclassified push-retry design, an ambiguous nullable-`raw_text` UI fallback, and an under-specified reboot-survival requirement for local reminders (the MVP's core property).

**What was built (this checkpoint):**

1. **Schema** (`packages/db`) — new tables `devices` (bearer-token auth, hash-only storage, one-primary-device partial unique index), `device_pairing_codes` (one-time registration gate), `notification_dispatch_log` (crash-safe dispatch state: `pending`/`accepted`/`failed` — deliberately not `sent`, since a successful Expo ticket only means Expo accepted the request, not that FCM or the device received it). Existing-table change: `inbox_items.raw_text` made nullable (a PTT capture writes its row before a transcript exists). One migration (`0004_eminent_moondragon.sql`), purely additive/loosening — no drops, no data-touching statements.
2. **`packages/core`** — `device-auth.ts`: `generateDeviceToken`/`hashDeviceToken` (256-bit random token, SHA-256 hash-only storage — deliberately not the AES-256-GCM scheme `credential-crypto.ts` uses for AI keys, since a device token is never decrypted, only compared) and `generatePairingCode`/`hashPairingCode` (8-char Crockford-Base32 codes, same one-way-hash pattern, case/hyphen-insensitive comparison).
3. **`apps/api`** — `plugins/device-auth.ts` (a `preHandler`, attached per-route-file via `addHook` so it can never leak onto the existing tasks/notes/projects/capture/inbox/occurrences routes, which remain Tailscale-perimeter-only, unchanged — this scoping is stated explicitly as a security-boundary comment in the plugin itself, not just implied); `routes/devices.ts` (two Fastify sub-contexts in one file — an unauthenticated, pairing-gated `POST /devices`, and everything else behind the auth hook: `GET/PATCH /devices/:id`, `/primary` two-statement transaction, `/push-token` self-only, `/revoke` idempotent); `scripts/generate-pairing-code.ts` (a CLI script, deliberately **not** a network endpoint — generating a code requires shell access to the box running the API, a materially stronger trust boundary than "somewhere on the tailnet," which is the exact trust level that made `POST /devices` insufficiently protected before this existed). `server.ts`'s logger redaction gained `req.headers.authorization`.
4. **`apps/worker`** — `capture-parse.ts` gained an explicit invariant check (`row.rawText === null` throws loudly) rather than silently accepting a null now that the type allows it; enforces that `capture.parse` must never run against a still-transcribing PTT row (a future bug, not a current one — `ptt.transcribe` doesn't exist until Checkpoint 2).
5. **`packages/schema`/`packages/api-client`** — `devices.ts` schemas (`.strict()` throughout, the registration response is the only shape that ever includes the raw token, returned exactly once) and matching typed client functions; `inbox.ts`'s `raw_text` changed to `z.string().nullable()`.
6. **`apps/mobile`** — the Inbox screen's transcript rendering is now three-way: transcript present → show it; `raw_text: null` + `status: "pending"` → "Transcribing…"; `raw_text: null` + `status: "failed"` → "Transcription failed" (this maps cleanly onto the existing state machine with no new column, since a PTT row can only have null `raw_text` in exactly those two statuses).

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing two real lint errors (`require-await` on the two-context route registration and a throwaway test route) and one TS4111 (bracket-notation-required index-signature access) surfaced during this pass |
| 2 | Migration applies cleanly as `posops_migrator`, in both the dev and dedicated test databases | `\d devices`/`\d device_pairing_codes`/`\d notification_dispatch_log`/`\d inbox_items` all match the schema exactly, including the `one_primary_device` partial unique index and the `notification_dispatch_log_status`/`devices_platform` CHECK constraints |
| 3 | `posops_app` still cannot DDL, and can read/write the new tables | Direct `CREATE TABLE should_fail` as `posops_app` → `permission denied for schema public`; a direct `INSERT`/`DELETE` against `devices` as `posops_app` succeeds |
| 4 | Automated tests | 129 tests total across the workspace, all passing: `packages/core` 44 (+8 new, `device-auth.test.ts`), `packages/schema` 11, `packages/ai-providers` 14, `packages/api-client` 10 (+2 new), `apps/worker` 3, `apps/api` 42 across 7 files (+2 new files: `routes/devices.test.ts` and `plugins/device-auth.test.ts`) — covering pairing-code rejection (missing/unknown/expired/already-consumed), **atomic single-use under real concurrency** (`Promise.all` of two simultaneous registration attempts against the same code — exactly one succeeds), every auth rejection path (missing header, malformed header, unknown token, revoked device), primary-swap atomicity (exactly one `is_primary_reminder_device = true` after two swaps), self-only push-token `403`, idempotent revoke, and `last_seen_at` bumping |
| 5 | `apps/api` boots and serves real traffic | `tsx` against local dev Postgres; `GET /health` → `db: "connected"` |
| 6 | **Full live pairing → registration → auth → revoke cycle, real curl against a real running server, not just `.inject()`** | `pnpm --filter api pairing:generate` printed a real code → `POST /devices` with it → `201` + one-time token → **reusing the same code** → `401 invalid_or_expired_pairing_code` → `GET /devices` with the token → `200`, `last_seen_at` populated → `POST /devices/:id/revoke` → `200` → same token on `GET /devices` → `401 device_revoked` → **`GET /tasks` with no Authorization header at all** → `200`, confirming the security-boundary claim live: revoking a device blocks the device-specific routes but has zero effect on the existing Tailscale-only API surface |

All test data (the one real device row and pairing code created during step 6) deleted from the dev database afterward.

**Not yet done (deferred to later checkpoints, per the approved plan):** `notifications.dispatch`/`ptt.transcribe`/orphan-audio-sweep worker jobs, the Groq transcription client, `POST /transcribe`, the shared audio Docker volume (Checkpoint 2); all native/Expo work including the `KEY_POWER` app-deliverability spike, the exact-alarm strategy spike, and reboot-survival verification (Checkpoints 3–5); production deployment (Checkpoint 6).

## Phase 3 Checkpoint 2: API + worker behavior (2026-08-16)

Continues directly from Checkpoint 1, per the approved plan. No new database tables or migrations this checkpoint — everything below is new code against Checkpoint 1's existing schema.

**What was built:**

1. **`packages/core`** — `quiet-hours.ts`: `isWithinQuietHours(now, start, end, timezone)`, a pure function handling the overnight-wraparound case (e.g. 22:00→06:00) via `toWallClockComponents`. Used by `notifications.dispatch` to suppress `confirmation`/`digest` categories during a device's quiet hours — `alert` is never suppressed.
2. **`packages/ai-providers`** — `transcription-client.ts`: `transcribeAudio()` speaks the raw OpenAI-compatible multipart `/audio/transcriptions` contract directly (Node's global `FormData`/`Blob`, no new dependency), parsing `verbose_json`'s per-segment `avg_logprob` into a mean confidence signal. `resolve-transcription-connection.ts`: `resolveTranscriptionConnectionForTask()`, structurally parallel to `resolve-model.ts` but returns raw connection details (`baseUrl`/`apiKey`/`modelId`) instead of a Vercel AI SDK `LanguageModel` — reuses `ai_provider_connections`/`ai_models`/`ai_task_routes` and `credential-crypto.ts` exactly as-is, **zero schema changes**, no new `provider_type`. Deliberately **not** an extension of the chat-oriented abstraction: `TranscriptionModel` is a structurally different SDK type from `LanguageModel`, and `@ai-sdk/openai-compatible` (the adapter every non-native vendor in this codebase goes through) has no transcription support at all — confirmed by reading `adapter-registry.ts` directly, not assumed. No fallback chain (Phase 3 only ever configures one STT provider). No dedicated unit test file for the resolver itself — matches `resolve-model.ts`'s own established precedent of zero dedicated tests for DB-querying resolution logic; its behavior (including the `NoProviderConfiguredError` path) is instead covered by `apps/worker`'s real-Postgres-backed `ptt-transcribe.test.ts`.
3. **`apps/api`** — new dependency `@fastify/multipart`. `routes/transcribe.ts`: `POST /transcribe`, Tailscale-only (matching `/capture`'s auth posture, not folded into the device-token scope), multipart parsing via `request.parts()`, `client_uuid` dedupe reusing the exact `onConflictDoNothing` pattern already in `capture.ts`, write-before-processing (`raw_text: null`, `audio_path` set, before any transcription work happens). `queue-names.ts` gained `PTT_TRANSCRIBE_QUEUE`; `plugins/boss.ts` now creates it. New `AUDIO_STORAGE_PATH` env var (shared with `apps/worker`), defaulting to `/tmp/personal-os-audio` locally.
4. **`apps/worker`** — new dependency `expo-server-sdk`. `jobs/notifications-dispatch.ts`: an explicit `pending`/`accepted`/`failed` state machine on `notification_dispatch_log`, with **per-target Expo ticket error classification verified against the actual installed `expo-server-sdk@7.1.0` type definitions** (not assumed) — `DeviceNotRegistered`/`MessageTooBig`/`MessageRateExceeded`/`InvalidCredentials` are treated as permanent (finalized `failed` immediately, never retried; `DeviceNotRegistered` additionally clears that device's `push_token`), everything else (network failures, unrecognized error codes) is transient and left `pending` for pg-boss's own retry. A `deadLetter`-registered dead-letter queue (`notifications.dispatch.dead`) finalizes any row still `pending` once retries are genuinely exhausted, so a row can never linger forever with no terminal state. `jobs/ptt-transcribe.ts`: idempotency via presence of `audio_path` (not attempt count), commits the transcript *before* deleting the source file, hands off to the **existing, unchanged** `capture.parse` job on success, and uses the identical `deadLetter`-driven terminal-cleanup pattern for exhausted transient retries. `jobs/sweep-orphan-audio.ts`: hourly cron, deletes any file in `AUDIO_STORAGE_PATH` older than 2 hours with no matching `inbox_items.audio_path` — the required backstop for the crash window between committing a transcript/failure and this project's own subsequent file delete. `index.ts` wiring: **both dead-letter queues are created via `createQueue()` before their primary queues** — verified by reading pg-boss's actual installed source (`dead_letter` is a foreign-key column against `queue.name`, not an auto-created convenience) rather than assumed, and confirmed correct in practice by booting the worker for real with zero FK errors.
5. **Docker** — `docker-compose.yml` gained a shared `audio_data` named volume mounted into both `api` and `worker` at `/data/audio`, matching `AUDIO_STORAGE_PATH`.

**A real bug caught only by running the actual test suite and inspecting the filesystem afterward, not by any automated assertion:** `POST /transcribe`'s route handler writes real files to disk, and neither `apps/api`'s nor `apps/worker`'s test suites isolated or cleaned up `AUDIO_STORAGE_PATH` — both silently used the same real default path (`/tmp/personal-os-audio`) a genuine local dev run also uses, and `apps/api`'s tests left real files behind indefinitely (no cleanup at all). Fixed by giving each package its own dedicated test-only `AUDIO_STORAGE_PATH` override in `vitest.config.ts`, plus explicit `afterAll` cleanup in `transcribe.test.ts`. Verified by a fresh full-suite run producing zero leftover files under `/tmp/` afterward.

**A second real bug, caught by the automated suite itself:** the first draft of `notifications-dispatch.test.ts` mocked `expo-server-sdk`'s `Expo` class as an arrow function (`vi.fn().mockImplementation(() => ({...}))`) — arrow functions have no `[[Construct]]` internal method, so `new Expo()` inside `notifications-dispatch.ts` threw `TypeError: ... is not a constructor` at module-load time. This crashed the whole test file and produced a confusing, unrelated-looking cascading failure in a separately-scheduled test file (`ptt-transcribe.test.ts`) within the same worker test run — resolved by re-running that file in isolation first (it passed cleanly on its own, proving the fault was elsewhere) before finding the actual cause. Fixed by using a named `function` expression in the mock instead.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing the two bugs above plus two ESLint issues (`no-restricted-syntax`-style inline `typeof import()` type annotations, and `unbound-method` false positives on `boss.send` property access — fixed by referencing a local `vi.fn()` directly instead of a property path) |
| 2 | Automated tests | **165 tests total across the workspace, all passing (41 new)**: `packages/core` 49 (+5, `quiet-hours.test.ts`), `packages/ai-providers` 20 (+6, `transcription-client.test.ts`), `packages/schema` 11, `packages/api-client` 10, `apps/worker` 27 (+24: 13 `notifications-dispatch.test.ts`, 7 `ptt-transcribe.test.ts`, 4 `sweep-orphan-audio.test.ts`), `apps/api` 48 (+6, `transcribe.test.ts`) — covering the full `pending`→`accepted`/`pending`→`failed`(permanent, no retry)/`pending`→rethrow(transient)/dead-letter-finalizes-still-pending state machine, `DeviceNotRegistered` clearing `push_token`, quiet-hours suppression (confirmation suppressed, alert never suppressed, verified with `vi.useFakeTimers`), `ptt.transcribe`'s audio-path idempotency and commit-before-delete ordering, and the orphan sweep's age-threshold/still-referenced-file/missing-directory behavior |
| 3 | `apps/api`/`apps/worker` boot and serve real traffic | Both booted via `tsx` against local dev Postgres; worker log confirmed `notifications.dispatch.dead`/`ptt.transcribe.dead` created before their primary queues with **zero foreign-key errors** — the dead-letter ordering requirement, verified correct in practice, not just in the source |
| 4 | **Full live `POST /transcribe` → worker → graceful-degradation cycle, real curl against a real running server with a real (small, synthetic) audio file, not just `.inject()`** | `POST /transcribe` with a real multipart upload → `202` + `inbox_items` row (`raw_text: null`, `source: "ptt"`, `audio_path` set, `status: "pending"`) → the running worker's `ptt.transcribe` job picked it up and, since no `voice_transcribe` provider is configured in this environment (confirmed empty `ai_provider_connections`/`ai_task_routes` tables), gracefully finalized it `status: "failed"` with `audio_path` cleared **and the uploaded file actually deleted from disk** — the same graceful `NoProviderConfiguredError` degradation pattern already proven for `capture.parse` in Phase 1, now proven for `ptt.transcribe` too. A second identical `POST /transcribe` (same `client_uuid`) confirmed live dedupe: same `inbox_id` returned, exactly one row in the database |

All test data (the one real `inbox_items` row and its audio file from step 4) deleted afterward; both servers stopped.

**Not yet verified — explicitly, because the required real credentials don't exist in this environment:**

- **No real `voice_transcribe` provider is configured** (confirmed via a direct query: zero rows in `ai_provider_connections` and `ai_task_routes` in the dev database). The actual Groq (or any real STT vendor) transcription happy path — a real audio file producing a real transcript, and the `avgLogprob` confidence signal it feeds — has **not** been verified end-to-end. What **is** verified: the multipart request/response contract itself against a mocked `fetch` (`transcription-client.test.ts`), and the full pipeline's graceful behavior with no provider configured, both as an automated test and live over real curl (table row 4 above).
- **No device has a real Expo push token registered** in this environment. `notifications.dispatch`'s actual delivery to a real device via the real Expo Push API has **not** been verified end-to-end — only against a mocked Expo SDK. Registering a real device with a real push token isn't possible until Checkpoint 3's native build exists.
- Both gaps require the user to supply real credentials directly (a Groq/STT API key via the existing, unchanged `POST /ai/providers` routes; a physical device with a real push token, starting at Checkpoint 3) — neither is something this session can supply itself, per this project's standing rule that Claude doesn't handle raw API keys.

## Phase 3 Checkpoint 3: native app foundation (2026-08-17)

Opened with the planned Rabbit R1 hardware spike, per explicit instruction, before any UI work began. Everything below was verified on the actual physical unit — not a simulator, not `.inject()`.

### Hardware spike — conclusive, empirical, and negative for both inputs

Environment: the R1 reconnected via `adb` (it had disconnected between sessions). Local native build tooling had to be assembled from scratch — the Android SDK's build-tools/platforms/cmdline-tools were already present (from earlier `adb`-only setup), but no JDK was linked; a Homebrew-installed `openjdk@17` (already present, just unlinked from `PATH`/`JAVA_HOME`) was wired up directly rather than reinstalling anything.

**First native build surfaced two real, previously-latent bugs** — neither is a regression from this checkpoint's own code; both existed since earlier phases and were simply never exercised, because Phase 2's verification only ever used Expo's web bundler, never Metro's native transform pipeline:

1. **`apps/mobile/package.json`'s `babel-preset-expo` was pinned to a stale `~13.0.0`** (a pre-SDK-57-alignment version scheme), pulling in `@react-native/codegen@0.79.0-rc.4` alongside the correct `0.86.2` used elsewhere in the dependency tree. The mismatch broke Metro's codegen parser on react-native's *own* `VirtualViewNativeComponent.js`, crashing the JS bundle load entirely. Fixed via `npx expo install babel-preset-expo`, which correctly resolved `~57.0.7`.
2. **`packages/core/src/timezone.ts`'s `isValidTimezone` used `Intl.supportedValuesOf("timeZone")`** — an ES2022 addition Hermes (React Native's JS engine) does not implement, even though Node and every browser do. Every screen that imports `packages/schema` (which imports this function) blanked silently with `[TypeError: undefined is not a function]`, visible only via a hidden LogBox overlay (itself rendered black-on-black, invisible in a screenshot — found via a raw UI-hierarchy dump, not the screen itself). Fixed to use the portable `new Intl.DateTimeFormat(undefined, {timeZone: tz})`-throws-on-invalid pattern instead, which works identically across Node, browsers, and Hermes. Rebuilt `packages/core` and re-ran its 49 tests clean.
3. A third, environmental (not code) issue: **the R1's WiFi is disabled** (USB-only) — Metro's own port (8081) already worked via an `adb reverse` tunnel Expo's CLI sets up automatically, but reaching the locally-running API server (port 3000) for functional testing needed the same treatment added manually (`adb reverse tcp:3000 tcp:3000`).

**KEY_POWER spike result: negative, conclusive.** A native `dispatchKeyEvent` override (`apps/mobile/plugins/withHardwareInputBridge.ts`, an Expo config plugin patching the generated `MainActivity.kt` so the bridge survives every future `expo prebuild`) bridges `KEYCODE_POWER` into a `HardwareSideButtonEvent` DeviceEventEmitter event. During a live 90-second capture with the debug screen confirmed in foreground throughout, the user pressed the side button (short and long) — `adb logcat` showed `PowerManagerService: Going to sleep due to power_button` firing four times; **zero** `HardwareSideButtonEvent`s and **zero** `ReactNativeJS` log lines appeared. The button is handled as a literal system power button before Android ever queues the event for app dispatch.

**Scroll-wheel spike result: negative, conclusive.** The same bridge forwards `KEYCODE_DPAD_UP`/`DOWN` as `HardwareScrollWheelEvent`. During the same capture, rotating the wheel produced rapid, repeated `SystemUI` `VolumeDialogImpl: showH r=volume_changed` log lines (matching the previously-confirmed 8-12-events-per-rotation burst cadence) — the system intercepts these exact key codes as literal volume control. Again, zero app-level events, zero `ReactNativeJS` lines.

**Both results directly correct the optimistic reading of the raw `adb getevent` kernel-level capture from Phase 3 planning** — that capture proved the kernel driver fires real interrupts, but could not and did not prove anything about Android's higher policy layer, which on this ROM claims both key codes for system-level semantics before any app ever sees them. This is exactly the distinction the plan review's explicit instruction ("do not assume either behavior from the raw getevent results alone") anticipated. The native bridge and JS-side debounce/coalescing logic are correctly implemented and harmless to keep — they would start working immediately if a future CipherOS update changes this interception policy — but neither is currently usable as an app-level input. **Touch is not a fallback on this hardware; it is currently the only working interaction mechanism**, exactly as the checkpoint's own constraints already required regardless of the spike's outcome.

### What was built

1. **`packages/core`** — the Hermes-compatibility fix to `isValidTimezone` described above (a real bug fix, not new functionality).
2. **`apps/mobile/plugins/withHardwareInputBridge.ts`** — new Expo config plugin (new devDependency `@expo/config-plugins`), patches `MainActivity.kt`'s `dispatchKeyEvent` to bridge the two Rabbit-specific key codes into `DeviceEventEmitter`. Verified to survive `expo prebuild` regeneration (re-ran prebuild, confirmed the patch reapplied).
3. **`apps/mobile/src/hardware-input/`** — the isolated hardware-input abstraction: `useScrollWheel()`, a debounced hook coalescing the confirmed multi-event burst into one logical scroll call within a 200ms trailing window, direction-reversal-aware. Exported through a single barrel (`index.ts`). No screen anywhere checks `Platform`/device model directly for Rabbit-specific purposes — this directory is the only place that concept exists, satisfying the "don't scatter vendor checks" constraint. Currently inert per the spike, by design not a required dependency for anything.
4. **`apps/mobile/src/app/hardware-debug.tsx`** — a diagnostic screen (reachable via deep link only, `mobile://hardware-debug`, not primary navigation) built for the spike and kept as a standing tool for future hardware-input work.
5. **`apps/mobile/src/device-identity/`** — `storage.ts` (`expo-secure-store` wrapper for the device token + id — new dependencies `expo-secure-store`, `expo-application`), `provider.tsx` (a React context loading credentials once from SecureStore on mount, the single source of truth every device-authenticated query hook reads from), `pairing-screen.tsx` (device name — defaulted from `expo-device`'s real device-name detection — + pairing-code form, calling the existing, unchanged `POST /devices`).
6. **`apps/mobile/src/app/_layout.tsx`** — restructured into a whole-app gate: no stored credentials → `PairingScreen` renders in place of everything else; credentials present → the existing `Stack`, now also registering `settings` and `hardware-debug` routes.
7. **`apps/mobile/src/app/(tabs)/_layout.tsx`** — a shared settings header icon (⚙️, via `screenOptions.headerRight`) across all four tabs rather than a 6th tab — the small-screen decision from the Phase 3 plan, given the R1's 480px-wide display.
8. **`apps/mobile/src/app/settings.tsx`** — device list, primary-device selection (`POST /devices/:id/primary`), per-device notification toggles (`PATCH /devices/:id` for `notify_confirmations`/`notify_alerts`/`notify_digests`), revoke, and a local "forget this device" sign-out (clears SecureStore only, does not itself revoke server-side).
9. **`apps/mobile/src/queries/devices.ts`** — TanStack Query hooks wrapping the existing `packages/api-client` device functions, reading the bearer token from `DeviceIdentityProvider` rather than SecureStore directly on every call.
10. **`apps/mobile/eas.json`** — `development`/`preview`/`production` build profiles (APK build type for internal distribution). Written but not yet exercised — no `eas build` was run this checkpoint; every verification below used a local `expo run:android` build, which needs neither an EAS account nor a final package name.

**Rabbit-R1-optimized responsive layout**: achieved via NativeWind's existing mobile-first styling applied uniformly to every new screen (large touch targets, single-column vertical layouts) rather than any Rabbit-specific conditional logic — this benefits any small screen generically and keeps normal Android phones equally usable, satisfying the "no scattered vendor checks" / "normal phones must remain usable" constraints simultaneously rather than in tension.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after the two real bugs above |
| 2 | Automated tests | 165 tests, all passing (unchanged count — no new automated tests this checkpoint; device-identity/pairing/settings code has no automated coverage yet, matching this project's established minimal-mobile-testing philosophy from Phase 2 — verified via the real device instead, not skipped) |
| 3 | **Fresh registration, live on the real R1** | Generated a real pairing code via `pnpm --filter api pairing:generate`, typed it into the actual device, submitted → `POST /devices` → `201` in the API log → app transitioned from `PairingScreen` to the main Tasks screen |
| 4 | **Token persistence across a real app restart** | Force-stopped and relaunched the app via `adb`; it went straight to the Tasks screen with no re-pairing prompt, confirming `expo-secure-store` correctly persisted and was read back on cold start |
| 5 | **Primary-device selection, live** | Tapped "Set as primary reminder device" in Settings; the `PRIMARY` badge appeared and the button correctly disappeared, backed by a real `POST /devices/:id/primary` → `200` in the API log |
| 6 | **Device notification settings, live** | Toggled the Digests switch; confirmed a real `PATCH /devices/:id` → `200` in the API log and the toggle visually reflecting the new state after TanStack Query's invalidation refetch |
| 7 | KEY_POWER / scroll-wheel spikes | See above — both conclusively negative, recorded honestly rather than assumed |

The registered device (`rabbit r1`, this session's real pairing) was left in place — it is the actual working credential for continued Phase 3 work on this unit, not disposable test data, matching how the user's real AI-provider configuration was left in place after Phase 1's verification.

### Known items / not yet resolved

- The current local Android package is **`com.himal.personalos`**. No EAS build or store-distribution decision has been made; local verification continues through `expo run:android`.
- **No Expo/EAS account is logged in** (`eas-cli whoami` → "Not logged in", checked read-only, no login attempted). Neither this nor the package-name gate blocked anything this checkpoint; both remain open items for whenever an EAS-based build actually becomes necessary.
- A minor, non-blocking React warning ("Can't perform a React state update on a component that hasn't mounted yet") appears once during the pairing → main-app transition — functionally harmless (every subsequent action verified working correctly); most likely `PairingScreen` unmounting immediately after its mutation resolves. Not chased down further — doesn't affect any required behavior.

## Phase 3 Checkpoint 4: PTT + notifications + reboot survival (COMPLETE, 2026-08-18)

Implementation began only after explicit user approval. Production was not accessed or modified. No migration was added or changed.

### What is implemented

1. **Local reminder reconciliation:** the primary Android device pages through all inbox/active tasks, schedules future `remind_at` values locally, and diffs against the OS-owned schedule. Task edits replace stale alarms; done, dropped, archived, or absent tasks cancel them. Reconciliation is serialized, refreshes on foreground and polling, preserves already-scheduled alarms during ordinary API/Tailscale outages, and cancels Personal-OS-owned alarms on authoritative revocation, lost identity, disabled notifications, or loss of primary status. Exact-alarm capability is stored with each schedule so a permission change forces replacement rather than leaving an inexact alarm in place.
2. **Notification lifecycle:** Android channel and permission setup are platform-guarded; foreground notifications use an explicit handler; notification taps route task payloads to the task detail screen; TanStack Query follows native foreground/background focus. Settings include exact-alarm, local-delivery, reboot, push-token, remote-test, and outbox diagnostics. The API adds a self-only `POST /devices/:id/test-notification` endpoint targeting exactly that device.
3. **Reboot survival:** the planned early physical-device test passed with Expo Notifications' built-in mechanism. A two-minute reminder was scheduled, the Rabbit rebooted, Personal OS was not opened, `BOOT_COMPLETED` caused the stored exact alarm to be restored, and the notification fired. The conditional custom BroadcastReceiver/Headless JS fallback was therefore correctly not added.
4. **Capture outbox:** quick-add now persists to SQLite before the first HTTP attempt, retains the same `client_uuid` across retries/restarts, applies persisted exponential backoff, separates permanent client failures from retryable failures, and exposes pending/needs-attention counts. Startup, connectivity changes, foregrounding, and a bounded interval trigger flushing; public-internet reachability is deliberately not treated as authoritative for the private Tailscale API. A web localStorage implementation preserves the universal Expo web build.
5. **PTT state machine:** touch-driven `expo-audio` recording has guarded start/stop transitions, a two-minute cap, AppState/unmount cleanup, stable retry identity/audio, non-overlapping bounded polling, and distinct preparing/recording/stopping/uploading/transcribing/done/failed states. Expo SDK 57 requires an `expo-file-system` `File`/Blob multipart part; its fetch implementation intentionally rejects the older React Native `{uri,name,type}` shape, and the real-device upload now uses the supported path.
6. **Transcription confidence and confirmation push:** `ptt.transcribe` persists mean `avg_logprob`; low-confidence PTT transcripts join the existing parse-confidence signals. A durable `needs_confirm` row enqueues `notifications.dispatch` with an Inbox payload and stable dedupe key, including on retry after a crash between the row update and enqueue.
7. **Dispatch correctness:** queue definitions are identical in API and worker startup (including dead-letter linkage), terminal failed targets are not resent, `MessageRateExceeded` is retryable, missing Expo tickets remain pending, and diagnostics can target one device. Expo Push tokens receive structural validation. Automatic token registration runs at startup/foreground and awaits server persistence.
8. **Rabbit small-screen fix:** quick capture now respects keyboard and bottom safe-area insets. Before the fix, CipherOS rendered the Capture button inside the untappable system area; afterward it moved into the reachable 480×640 content area and the offline capture succeeded physically.
9. **Web/native compatibility:** SecureStore and SQLite have web storage adapters, notification APIs are web-guarded, and the exact-alarm module has an iOS stub. A production-mode Expo web export succeeds.

### Verification actually run so far

| Check | Result |
|---|---|
| Android debug native build | Successful on the physical Rabbit R1, including `expo-crypto` and `expo-file-system` native modules |
| Foreground local notification | Fired as an exact `RTC_WAKEUP`; visible while Personal OS remained foregrounded |
| Reboot protocol | Passed without reopening Personal OS; Expo's built-in boot restoration rescheduled and delivered the alarm |
| PTT record/upload/poll | Physical touch start/stop and retry states worked; SDK-57 multipart upload reached `/transcribe`; with no local STT route, the worker's deliberate terminal failure rendered “Transcription failed” rather than a network error or indefinite spinner |
| Offline outbox restart/replay | With API reachability removed: saved offline → force-stop/restart → Settings showed one pending capture. Restoring reachability flushed to zero and Inbox showed “Offline outbox checkpoint” exactly once |
| Exact-alarm bridge | The ROM's package/app-op reports are internally inconsistent, but actual scheduled alarms carry Android's exact-permission reason and deliver exactly; runtime behavior is the deciding evidence |
| Automated workspace gate | Build, typecheck, and lint pass. 200 tests pass when DB-backed API and worker packages are serialized; the root test command now enforces this because both suites intentionally share `personalos_test` |
| Formatting | `pnpm format:check` passes |
| Web regression | `expo export --platform web` succeeds |

### Checkpoint 4 hardening follow-up (2026-08-17)

Implemented only the four post-audit hardening items approved after commit
`76b314c`: the PTT lifecycle effect now explicitly restores its mounted ref
when mounted (including StrictMode development effect re-invocation); direct
deferred-promise concurrency tests prove reminder reconciliation and capture
outbox operations remain serialized, preserve call order, execute exactly once,
and continue after an earlier operation fails; reminder reconciliation now
self-heals duplicate Personal OS alarms by retaining exactly one matching alarm
and cancelling only the owned extras; and the temporary
`inbox_items.confidence` PTT `avg_logprob` handoff semantics plus the future
dedicated-field cleanup are documented without a migration or routing change.

Verification for this follow-up: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, and the full serialized `pnpm test` suite all pass (200
tests total, including 22 mobile tests). `pnpm --filter mobile exec expo export
--platform web` succeeds. The touched native PTT/notification paths warranted
an Android check, and `./gradlew assembleDebug` succeeds with JDK 17 (489 tasks;
only existing Gradle deprecation notices and cross-volume hard-link fallbacks).
No credentials were configured, no migration was added, production was not
accessed, and no later checkpoint work began.

### Real `voice_transcribe` STT gate — CLOSED (2026-08-17)

Verified against a real Groq account on **local development only** (production
untouched, nothing deployed, no migration). The user enabled
`whisper-large-v3-turbo` and `openai/gpt-oss-20b` on the Groq project
mid-session after both were initially blocked at the project level.

Configured through the existing `/ai/providers` → `/ai/models` →
`/ai/task-routes` endpoints and the existing AES-256-GCM credential
encryption — no direct database writes, no key in `.env`, the repository, or
any log. Non-secret identifiers: provider `09016fd3-081c-46e6-8c61-8a74bb84693c`
(`openai_compatible`, `https://api.groq.com/openai/v1`); models
`496bf3e9-52ff-4c89-a6f4-164c69d294f3` (`whisper-large-v3-turbo`) and
`153271de-b227-4a87-bc57-6209d27ffed2` (`openai/gpt-oss-20b`); routes
`1020f76b-ce2d-46a7-a876-91ac40bd3767` (`voice_transcribe`) and
`cd2d8104-10d6-415e-9e19-e772f2558c51` (`capture_parser`), both with no
fallback. Credential-safety re-checked after configuration: the stored row is
real AES-256-GCM (56B ciphertext / 12B IV / 16B auth tag) and does not contain
the plaintext in any encoding; `GET /ai/providers` exposes no key material; no
local log, tracked file, or untracked repo file contains the key.

**Five real captures were run on the physical Rabbit R1**, driven through the
device's actual microphone (speech played acoustically into the unit), not by
injecting an audio file. The complete path was exercised: R1 mic → `expo-audio`
→ multipart `POST /transcribe` → persisted temporary audio → `ptt.transcribe` →
real Groq `whisper-large-v3-turbo` → transcript + `avg_logprob` → `capture.parse`
→ real `openai/gpt-oss-20b` → entity or `needs_confirm`.

| Capture | Transcript (real) | `avg_logprob` | Outcome |
|---|---|---|---|
| clear task | " Remind me to call the insurance company tomorrow at 3 p.m." | **-0.1592956** | `parsed` → task "Call insurance company", `remind_at` 2026-08-18T20:00Z (3pm CDT — DST-correct) |
| note-shaped | " . Idea, build a weekly review dashboard for the home server." | (overwritten) | `needs_confirm`, flag `typeAmbiguous` — the two temperature-0.3 samples genuinely disagreed; parsed as `create_note` |
| gibberish | " The Farris Quandary Bramblewick 16 Thistle Apparatus Mumble…" | (overwritten) | `needs_confirm`, flag `modelUnclear` (`unclear` tool) |
| near-silent | " ." | (overwritten) | `needs_confirm`, flag `modelUnclear` |
| quiet task | " Remind me to buy printer paper on Thursday afternoon." | **-0.21939197** | `parsed` → task "Buy printer paper" |

`avg_logprob` **is** returned by `whisper-large-v3-turbo` and is genuinely
propagated: on the last capture the raw value was observed in
`inbox_items.confidence` while the row was still `pending` (before
`capture.parse` ran) and survived unchanged into `parsed`, which is exactly the
temporary-overload behaviour documented for that column. Rows routed to
`needs_confirm` have it overwritten with `0`, also as documented.

Also verified per capture: audio cleanup succeeded (`audio_path` cleared and
`/tmp/personal-os-audio` empty after every capture), no duplicate Inbox row was
produced (zero `client_uuid` collisions across all PTT captures), and a
confirmation `notifications.dispatch` job was enqueued and completed for a
`needs_confirm` capture — writing no `notification_dispatch_log` rows because
the device still has no push token, which is the correct no-eligible-target
behaviour rather than a failure.

**Observed MIME chain** (the previously identified residual risk, resolved by
observation rather than by a speculative change):

| Stage | Observed value |
|---|---|
| Rabbit recording | `.m4a` (expo-audio `RecordingPresets.HIGH_QUALITY`, Android `mpeg4`/`aac`) |
| `expo-file-system` `File.type` | a MIME the API maps to `.mp3`, i.e. `audio/mpeg` (Android `MimeTypeMap`'s mapping for `.m4a`); `audio/mpeg` and `audio/mp3` are indistinguishable from the stored extension alone |
| multipart file MIME | as above |
| multipart original filename | `"audio"` — expo's `File` implements `Blob` but exposes no `name`, so `transcribe.ts`'s `file.name ?? "audio"` fallback applies |
| API-selected storage extension | `.mp3` |
| stored temporary filename | e.g. `daaa840f-da00-486c-9ef0-c6bea2639da9.mp3` |
| worker-derived MIME | `audio/mpeg` (from `.mp3`) |
| filename/MIME sent to Groq | `<uuid>.mp3` + `audio/mpeg` |

The feared `.bin` outcome did **not** occur. The bytes are MPEG-4/AAC but are
labelled `.mp3`/`audio/mpeg` end to end, and Groq's Whisper endpoint accepted
and transcribed them correctly on every capture — it decodes by content, not by
the declared extension. No MIME/extension fallback was implemented, because
nothing failed; per the standing instruction, a speculative change was not made.
This remains a latent fragility worth revisiting only if a future STT provider
validates by extension.

Two further real observations, neither requiring a code change:

- The first capture's Groq request hit a transient IPv6 connect timeout
  (`UND_ERR_CONNECT_TIMEOUT` against `2a06:98c1:...:443`) on a dual-stack path.
  pg-boss retried and the second attempt succeeded, which incidentally proved
  the transcription retry path, the fact that source audio is preserved across a
  failed attempt, and that the retry produced no duplicate Inbox row.
- Because that retry pushed end-to-end latency past 60s, the PTT button's
  bounded polling reported "Transcription is taking longer than expected" for a
  capture that had in fact succeeded server-side. The row was durable and
  correct throughout; this is the implemented bounded-polling policy behaving as
  designed, not data loss, but the wording can read as failure.

The parser leg was also exercised for real: `openai/gpt-oss-20b` produced
correct tool calls and DST-correct datetimes. One accuracy miss worth recording
honestly — "Thursday afternoon" resolved to Wednesday 2026-08-19 rather than
Thursday 2026-08-20. That is model quality, not a pipeline defect, and no
confidence signal flags it because a date *was* resolved.

Not exercised, reported honestly: the `lowTranscriptionConfidence` routing
threshold (`avg_logprob < -0.8`) was never reached across five real captures.
`whisper-large-v3-turbo` stayed confident even on deliberately quiet, fast and
nonsense audio (worst observed `-0.219`), and audio degraded far enough to score
worse instead produced text the parser terminated as `unclear` first — a branch
that returns before the transcription-confidence signal is computed. The signal
itself is verified by `packages/core`'s unit tests; with this provider the
`-0.8` threshold appears effectively unreachable in practice.

### Real Expo Push gate — CLOSED (2026-08-18)

Verified on the physical Rabbit R1 against real Firebase/FCM V1 credentials.
Local development only: production was never accessed, nothing was deployed, no
migration was added, and no unrelated secret was rotated.

**Configuration.** Firebase project `personal-os-196cf` (project number
`868049601968`); Android app registered against the confirmed permanent package
`com.himal.personalos` (mobilesdk app id
`1:868049601968:android:bbaaedd77bfc0417a10275`). `google-services.json` is
placed at `apps/mobile/google-services.json`, referenced by
`android.googleServicesFile`, and **git-ignored** — Google formally treats it as
non-secret since it ships inside the APK, but it embeds a Google API key, so it
is excluded as defense in depth consistent with this repo's posture. Prebuild
copies it to `android/app/` and applies `com.google.gms.google-services`.

The FCM V1 **service-account key** was uploaded by the user directly from their
own terminal via `eas credentials` → Android → Google Service Account → *Manage
your Google Service Account Key for Push Notifications (FCM V1)*, so the private
key never passed through this session, the repository, or any log. EAS reported
`Google Service Account Key assigned to com.himal.personalos for FCM V1`. The
EAS project is `@himal_pok/mobile` (`b704be80-5b01-411e-9239-fa0cea642783`).
No Android upload keystore was created: the browser wizard demands one, but the
CLI path does not, and local `expo run:android` builds are signed with Android's
own debug keystore, so a keystore would have been an unnecessary credential.

**Rebuild was mandatory and performed.** `google-services.json` is compile-time
native configuration, so the previously installed build could not acquire FCM
under any runtime action. Full `expo prebuild --clean` + local native build +
install on the R1. After it, logcat shows `FirebaseApp initialization
successful` — the previous blocker (`Default FirebaseApp is not initialized`)
is gone.

**A real, non-obvious failure was diagnosed rather than misattributed.** The
first token attempt after the correct rebuild still failed, with
`FirebaseMessaging: Failed to get FIS auth token` /
`java.io.IOException: SERVICE_NOT_AVAILABLE`. This was **not** an FCM or
CipherOS limitation: `dumpsys connectivity` reported `Active default network:
none` and `ping` returned `Network is unreachable`. The R1's Wi-Fi had been left
disabled since the Checkpoint 3 hardware spike, so the device reached the API
only through `adb reverse` port tunnels and had no route to
`firebaseinstallations.googleapis.com`. Enabling Wi-Fi (it auto-joined a saved
network; 9.7 ms to 8.8.8.8) resolved it immediately.

**CipherOS GMS support is confirmed, not assumed:** `com.google.android.gms`
(Play Services **26.30.32**), `com.android.vending` and
`com.google.android.gsf` are all installed and enabled. The earlier open
question about whether this community ROM could support FCM is answered
affirmatively by real delivery.

**Real ExpoPushToken acquired and persisted.** Device row
`15017e8f-ddc0-4aa0-aa57-67ad808482b1` holds a token matching
`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$` (41 chars), written through the
existing self-only `POST /devices/:id/push-token` endpoint. The full token is
deliberately not recorded here.

| # | Test | Expo request | Ticket | `notification_dispatch_log` | Physically received | Presentation |
|---|---|---|---|---|---|---|
| 1 | Self-targeted diagnostic (`POST /devices/:id/test-notification`, `deviceId` targeting) | attempted | `01a0133c-532e-71ec-a43a-8f6c33b4f05c` | `accepted` | **yes** — "Personal OS test / Remote notifications are configured for this device." | **foreground** (app open on Settings; presented via `setNotificationHandler`) |
| 2 | Real `notifications.dispatch` worker path | exercised by both rows below/above — test 1 via explicit `deviceId`, test 3 via category fan-out with no `deviceId` | — | — | — | — |
| 3 | Real capture → `needs_confirm` → confirmation push | attempted | `01a0133d-a3ad-7798-…` | `accepted` | **yes** — "Capture needs confirmation / asdf qwerty zzz" | **background** (app backgrounded via HOME) |

Dispatch health across the session: 7 `notifications.dispatch` jobs, all
`completed`, zero retries and zero failures; 2 dispatch-log rows, both
`accepted` with a ticket and no `last_error` — per-device dedupe produced no
duplicate sends. Per ADR-030 the ticket only proves Expo accepted the request;
the physical receipt above is the actual happy-path evidence, and it was
obtained for both foreground and background.

**Honest gaps recorded, not fixed in this gate:**

- **Confirmation notifications are inert on tap.** `capture-parse.ts` publishes
  `data: { inboxId }`, but `use-notification-lifecycle.ts` routes only on
  `data.taskId`. Tapping a confirmation notification brings the app forward but
  navigates nowhere. Local *reminder* notifications do carry `taskId` and route
  correctly, so this affects the confirmation category only. Deliberately not
  changed here: choosing the destination is a product decision, and there is no
  `inbox/[id]` route today — only the Inbox tab.
- Logcat notes `Missing Default Notification Channel metadata in
  AndroidManifest. Default value will be used.` Delivery is unaffected;
  `expo-notifications`' `defaultChannel` plugin option would silence it.

### Still open before Checkpoint 4 can be called complete

Nothing. Both credential-dependent gates are now closed. Checkpoint 5 still owns
the complete lifecycle matrix (foreground/background/swiped-away/Force-Stop),
revoke/security-boundary recheck, and any fixes that matrix finds — that is
Checkpoint 5 scope, not an open Checkpoint 4 item.

## Phase 3 Checkpoint 5: real-device lifecycle verification (COMPLETE, 2026-08-18)

Checkpoint 5 is a verification-and-defect-fixing checkpoint, not feature
development. Everything below was run against the **physical Rabbit R1** on
**local development only** — production was never accessed, nothing was
deployed, and no migration was added. Where a result is automated, mocked, or
inferred rather than physically observed, it says so.

The session began from a **fresh install** (`adb uninstall` → clean local
`expo run:android`), so every result reflects first-run state rather than
accumulated device state from Checkpoint 4.

### Documentation drift repaired first

`926ac3f` marked Checkpoint 4 complete in this file's header and in its
"Still open … Nothing" section, but four other places still described it as
in progress: the "Current objective" paragraph, the unchecked Checkpoint 4
box in "Completed", the Checkpoint 4 section heading, and both "Current work"
and "Next action". Those were documentation drift, not missing work — the
items they described as pending are documented as done, with device-level
evidence, further down the same file. All four were corrected.

### Defects found and fixed

Five findings. Four are fixed and re-verified on the device; one is recorded
as debt.

**1. Confirmation notifications were inert on tap.** `capture-parse.ts`
publishes `data: { inboxId }`, but `use-notification-lifecycle.ts` routed only
on `data.taskId`, so tapping a confirmation foregrounded the app and navigated
nowhere. Routing now goes through a pure `resolveNotificationRoute` helper and
sends confirmations to the Inbox tab (there is no `inbox/[id]` route; `taskId`
keeps priority). Fixed and verified live.

**2. Notification taps did nothing while a pushed screen was on top.** Found
while verifying fix 1: with Settings (or a task detail) on the root stack,
navigating to a tab route switched the tab *underneath* the pushed screen, so
the tap appeared to do nothing. This affected reminder taps too, not only
confirmations. The handler now dismisses to the root first
(`router.canDismiss()` → `dismissAll()`) and then navigates. Reproduced and
re-verified with Settings deliberately on top.

**3. Primary-device drift silently disabled all local reminders.** The live
state at the start of this checkpoint: three device rows all named
`rabbit r1`, the running install (`15017e8f`, holder of the real push token)
**not** primary, and the primary flag stranded on `f93e5ef9`, dead since
2026-08-17 13:45. Observed consequence: two eligible tasks with future
`remind_at`, app running, and **zero** Personal OS alarms registered with
Android. Root cause is not a logic bug — `use-reminder-reconciliation.ts`
correctly cancels owned alarms on a non-primary device, and ADR-019 forbids
auto-promotion — it is that rebuilding wipes SecureStore, which forces a
re-pair, which mints a new device row and strands primary status on the old
one, with nothing surfacing it. Settings now renders a banner naming the exact
blocking reason, driven by a pure `describeReminderEligibility`.

A related observation, recorded rather than changed: **revoking a device does
not clear its primary flag**, so a revoked row can continue to hold primary
and no device schedules reminders until primary is reassigned. The new banner
surfaces this on whichever device the user is holding.

**4. Exact-alarm permission was never requested, so a fresh install scheduled
reminders with a one-hour delivery window.** `targetSdk` is 36 and the app
declares `SCHEDULE_EXACT_ALARM` without `USE_EXACT_ALARM`, so Android 14+ does
not auto-grant it, and the grant does not survive reinstall. Observed directly
in `dumpsys alarm`: `window=+1h0m0s0ms` with **no** `exactAllowReason`, versus
`window=0 exactAllowReason=permission` after granting — other apps' alarms on
the same device showed the granted form throughout, which is what made the
difference legible. The app's own diagnostic reported "NOT granted".

This closes the exact-alarm half of `ARCHITECTURE.md`'s gotcha #6 ("Needs
runtime notification permission *and* exact-alarm permission for precise
scheduling. Request both during onboarding"), which had never been
implemented. Onboarding now prompts once per app run and deep-links to the
system page; the banner reports this degraded state distinctly from a blocked
one, since reminders *are* scheduled, just imprecisely.

Capability detection and alarm replacement needed no changes — both were
already correct. Granting the permission mid-session was observed replacing
the inexact alarms with exact ones on the next reconciliation pass, and
revoking it replaced them in the other direction.

This also **corrects a Checkpoint 4 claim**. That checkpoint recorded
"actual scheduled alarms carry Android's exact-permission reason and deliver
exactly". That is not true on a fresh install. Checkpoint 4 verified with a
two-minute test reminder, which Android delivers promptly regardless of
exactness, and was most likely running with the permission already granted by
hand.

**5. On the 480×640 screen the Quick capture modal was unusable with the
keyboard open.** `KeyboardAvoidingView`'s `behavior="height"` does not work
inside an Android `Modal` (the modal gets its own window, so the activity's
`adjustResize` never applies), which pushed the entire sheet — text field
included — off the bottom of the display. The user could not see what they
were typing and could not reach Capture or Cancel without first hiding the
keyboard by hand; pressing Back to do so dismisses the whole modal and
discards the draft. Checkpoint 4's safe-area fix addressed the navigation-bar
inset, not the keyboard inset. Replaced with explicit padding by the measured
keyboard height, which works on Android and iOS and is inert on web
(`react-native-web` exports `Keyboard.addListener`). Verified by typing and
tapping Capture with the keyboard still open — previously impossible.

### Recorded as debt, not fixed

- **`remind_at` has no create/update API path.** Neither `TaskCreateSchema`
  nor `TaskUpdateSchema` accepts it, so a reminder time can only be set by AI
  capture — there is no manual way to add or change one. This is why the
  Checkpoint 5 brief hedges "reminder-time change *where supported*". Building
  it is feature work, deliberately not done inside a verification checkpoint.
  This checkpoint drove `remind_at` via SQL, which is what capture writes
  anyway.
- **`quick-add-fab.tsx:30` hardcodes `source: "web"`**, so captures made from
  the Android app are recorded with `source = "web"`.
- A dev-build LogBox toast (a `SafeAreaView` deprecation warning from
  `react-native-safe-area-context`) overlays the bottom of the screen and
  covered the Quick capture buttons during testing. Development-only, absent
  from a production build, but it made the small-screen defect above harder to
  see.

### Lifecycle matrix — all five states, physical Rabbit R1

| State | Result |
|---|---|
| **Foreground** | Fired on time with the app focused; exactly one notification posted; tap routed to the task detail screen |
| **Background** | Fired with the launcher focused; exactly one notification |
| **Swiped from Recents** | Performed as the real gesture in the Recents UI (`am task remove` no longer exists on Android 16). Confirmed true swipe-away state — process killed, `stopped=false`, distinct from Force Stop — alarms survived and the reminder fired; expo's broadcast receiver woke the process to post it |
| **Reboot** | Schedule → `adb reboot` → **app never manually opened** (focus stayed on the lock screen throughout) → alarms restored as **exact** and the reminder fired. Re-confirms ADR-031 on a fresh install, and additionally shows restoration preserves exactness |
| **Force Stop** | Android cancels every Personal OS alarm (`stopped=true`, zero registered) and the reminder does **not** fire. This is expected Android platform semantics, **not** a Personal OS defect. Manual relaunch restores `stopped=false` and reschedules every still-eligible alarm |

An alarm whose time elapses **while the device is powered off** does not fire
on boot — observed once when a reboot window straddled the target time. This is
Android behaviour plus the deliberate `isEligible` rule excluding past
`remind_at` (which exists so a device that was off does not fire a burst of
stale reminders on next launch).

### Primary-device, notification-settings and revocation matrix

| Check | Result |
|---|---|
| Demotion (another device claims primary) | Owned alarms cancelled |
| Re-promotion | Alarms restored as exact, ~60s (the device query's refetch interval) |
| `notifications_enabled` false | Alarms cancelled |
| `notifications_enabled` true again | Alarms restored |
| Authoritative revocation (`revoked_at` set server-side) | App noticed via 401 and cancelled every owned alarm; Settings showed "Couldn't load devices." |
| Device-scoped route with a dead/bogus token | `401 invalid_token` |
| **ADR-029 boundary** | With the device revoked, `GET /tasks` → 200, `GET /inbox` → 200, `POST /capture` → 202, **with no `Authorization` header at all**. The documented boundary is accurate, not merely asserted: device-token revocation does not revoke the Tailscale-perimeter API, and a lost device still requires tailnet removal |
| Revoke → re-pair recovery (previously never exercised) | "Forget this device" → new pairing code → paired as a new device row → push token re-registered automatically → promoted to primary → reminders scheduling again as exact alarms |
| Stale device rows | Five rows now exist, all named `rabbit r1`; exactly one primary throughout, and no duplicate alarms were ever observed. Rows were **not** deleted to simplify testing |

### Task/reminder eligibility

Three tasks with future `remind_at` were created, confirmed scheduled, then
completed / dropped / archived respectively: alarm count went 6 → 3 and each
task reached the correct state. No stale reminder fired for an ineligible task
at any point in the session. Reminder-time changes were observed replacing the
alarm cleanly (tracked across three successive `remind_at` values, always
exactly one alarm for the task). Duplicate-repair remains covered by
`reconcile.test.ts` rather than physically injected; the "exactly one alarm per
task" invariant held across every reconciliation pass observed today.

### Foreground/background synchronization

Verified through the matrices above rather than as a separate pass: primary
changes, `notifications_enabled` changes, exact-alarm capability changes,
revocation, and server-side task state changes (complete/drop/archive) were
each noticed and acted on, via the foreground `AppState` trigger and the 60s
poll. Reconciliation continued to preserve already-scheduled alarms while the
API was unreachable.

### Offline capture matrix

Run with the **API process stopped** rather than by removing the `adb reverse`
tunnel. Removing the tunnel proved unreliable: an established keep-alive
socket survived it and captures still reached the server, so that method does
not actually simulate an unreachable API. Throughout the real test the device
kept Wi-Fi and public internet (18 ms to 8.8.8.8) — this is exactly the
"public internet available but Personal OS API unavailable" case.

| Step | Result |
|---|---|
| Capture with API down | "Saved offline — This will be sent automatically once you're back online."; `Pending captures: 1` |
| Force-stop and relaunch | Still `Pending captures: 1` — durable across real process death |
| API restored, **no connectivity transition** | Flushed automatically ~75s later on persisted-backoff expiry, with no manual action and no network change. This is the designed behaviour: the HTTP attempt is authoritative, not a reachability probe |
| Server rows | Exactly **1** |
| Manual "Flush now" + two foreground cycles afterwards | Still exactly 1 — no duplicate; `Pending captures: 0` |

### Real remote push

| Check | Result |
|---|---|
| Foreground push (self-targeted diagnostic) | Physically received; `notification_dispatch_log` `accepted` with a ticket and no error |
| Background push | Physically received with the launcher focused (count 0 → 1) |
| Real confirmation push | A real `needs_confirm` capture produced a confirmation push, physically received |
| Confirmation tap → Inbox tab | Verified, including from a pushed screen after fix 2 |
| Duplicates | None across the session |

Per ADR-030 an `accepted` ticket proves only that Expo accepted the request;
the physical receipts above are the delivery evidence.

### Network transitions

Distinguished explicitly: Wi-Fi up and validated (`dumpsys connectivity`
showed the network `VALIDATED`); API unreachable with internet up; API
restored without any connectivity transition. No failure in this session was
attributed to FCM or GMS without first checking the device's default network.

### Small-screen UX (480×640)

Exercised throughout via real taps driven from `uiautomator` bounds. Quick
capture's keyboard defect is fix 5 above. Otherwise: the pairing form, the
settings screen and its diagnostics, the device cards, the Inbox list with
long parse-result text, the task detail screen, the tab bar, notification
navigation, and the new eligibility banner all rendered within the 480×640
content area with no clipped primary controls.

### Web regression

`expo export --platform web` succeeds and emits SPA output (exactly one
`index.html`). Served with `serve -s dist`: `/`, `/tasks`, `/notes`,
`/projects` and a UUID deep link (`/tasks/<uuid>`) all return 200. Loaded in a
real browser: the app boots with **zero console errors** and renders the
pairing screen, confirming the SecureStore and SQLite web adapters work and
that no native notification API is reached on web. `react-native-web` exports
`Keyboard.addListener`, so fix 5's hook is web-safe.

### Stage H — PTT lifecycle (COMPLETE, 2026-08-18)

Run with the user physically at the Rabbit R1's microphone, driving every
touch and speech action themselves; this session drove the API/worker/DB
side and read back real evidence after each one. Real Groq
`voice_transcribe`/`capture_parser`, no mocking. **Zero application defects
found** — every scenario behaved as designed. The one issue encountered was
in this session's own test method for H6 (below), not in the app.

| Sub-stage | What was exercised | Result |
|---|---|---|
| H1 — normal happy path | "Remind me to water the plants tomorrow." | Real transcript, `avg_logprob -0.43343338`, `parsed` → task "Water the plants", `remind_at` correctly resolved to 9am America/Chicago the next day, audio cleaned, exactly 1 row |
| H2 — consecutive recordings | Two independent recordings back-to-back | Distinct `client_uuid`s, no state leak between them (each transcript contains only what was spoken in that recording); recording 1 → task "Send money and call Karan"; recording 2 (two intents in one utterance, "coffee shop" + "Meeting with Sarah") → correctly flagged `typeAmbiguous`, routed to `needs_confirm` |
| H3 — rapid/double-tap | Double-tap start, double-tap stop, then start→stop→start in quick succession | No crash, no duplicate upload — four short/near-silent recordings each got a distinct `client_uuid` and exactly one row; PTT remained fully usable afterward (idle icon, no stuck state) |
| H4 — background during recording | Start recording, background the app mid-speech via Home | The `AppState` listener (`use-ptt-recorder.ts`) stops recording the instant the app leaves `active` — confirmed by design read and by the near-silent transcript, since the user's speech continued only *after* backgrounding. Correctly classified `unclear`/`modelUnclear`, no orphaned recorder, no duplicate, audio cleaned, app returned usable |
| H5 — upload failure + retry | API process killed outright (not just `adb reverse` removal — Checkpoint 5's offline-outbox stage already found a removed tunnel alone can leave an established socket usable) | "Upload Failed — check your connection (tap to retry)"; confirmed **zero** server-side row while the API was down; API restored; retry reused the same `client_uuid`, succeeded, exactly one row and zero phantom rows across the whole failure window, task created |
| H6 — polling timeout while server work eventually succeeds | Worker paused before recording, held past the client's 60s polling bound, then resumed | See below — genuine reproduction, including a real methodology bug this session found and fixed mid-test |
| H7 — cleanup/audio lifecycle | Consolidated check across all 11 distinct captures from the session | Every row's `audio_path` cleared, `/tmp/personal-os-audio` fully empty at every checkpoint, including through the failure/retry and timeout/resume paths |
| H8 — idempotency | Consolidated check across all 11 captures | 11 distinct `client_uuid`s, each with exactly 1 `inbox_items` row and exactly 1 `ptt.transcribe` job (verified directly against `pgboss.job`, zero `inboxId`s with more than one job) |
| H9 — confidence sanity | Real `avg_logprob` observed across the session: `-0.43343338`, `-0.12421312`, `-0.5018217`, `-0.23860362` | Consistent with Checkpoint 4's finding — Whisper stays confident even on short/degraded audio, so `-0.8` was not reached. Real `typeAmbiguous` and `modelUnclear` confirmation flags both exercised for real ambiguous/unclear speech. Threshold left untouched, per the brief — `packages/core`'s unit tests remain authoritative for it |
| H10 — final usability sanity | One clean recording ("Buy milk tomorrow") after every stress scenario above | Parsed cleanly, PTT fully usable, no stale timers/poll generations, small-screen layout intact |

**H6 in detail, including a real test-methodology bug this session found and
fixed before the test was valid.** The worker runs under `tsx watch`, which
spawns a separate child process to execute the actual script — the first
attempt at "pause the worker" sent `SIGSTOP` to the `tsx watch` supervisor
PID, which does **not** propagate to its child; the child kept running
completely unaffected, and the job processed normally in under a second
despite the supervisor showing `T` (stopped) in `ps`. This was caught by
checking `pgboss.job`'s `started_on`/`completed_on` timestamps against when
`SIGSTOP` was actually sent, then confirmed by inspecting the process tree
(`pgrep -P`) and finding the unaffected child PID. Corrected by resuming the
supervisors and instead pausing the actual child processes. With the real
worker processes confirmed `T` and the pg-boss job confirmed `created` with
no `started_on`, a new recording was made and left untouched for 65+ seconds
— past the client's `TRANSCRIBING_TIMEOUT_MS = 60_000` bound. The UI showed
"Transcription is taking longer than expected. (tap to dismiss)", the audio
file remained on disk untouched, and the pg-boss job stayed `created`,
confirming the server-side work is genuinely durable while the client gives
up polling. The workers were then resumed; the job completed within seconds
into a real note, the Notes tab reflected the eventual result on refetch with
zero duplication, and PTT was immediately usable again after dismiss.

The wording itself ("Transcription is taking longer than expected") does not
claim failure, so per the brief it was left unchanged — it shares red/`!`
styling with genuine failures, but "tap to dismiss" (this path always has
`canRetry: false`) simply returns to idle rather than retrying, and the
result still lands correctly once the relevant screen next refetches. This is
the same behaviour Checkpoint 4 first observed with a real Groq retry; Stage
H reproduces it deliberately and confirms no data loss and no duplication
across it.

Stage H found **zero application defects** — no code changes were made as a
result, so no regression test was added and the automated suite is unchanged
at 214 tests (confirmed by a fresh `pnpm test` run after Stage H, same
count as before it). All Stage H test tasks/notes/events/inbox rows were
deleted from the dev database afterward; the pre-existing Checkpoint 4 STT
captures ("Call insurance company", "Buy printer paper") and the
"Checkpoint 4 local-reminder test" task were left in place, unchanged.

### Automated verification

| Check | Result |
|---|---|
| `pnpm build` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm test` | **214 tests pass**, 12/12 turbo tasks — `packages/core` 53, `packages/ai-providers` 20, `packages/schema` 11, `packages/api-client` 11, `apps/api` 50, `apps/worker` 33, `apps/mobile` **36** (+14: `resolve-notification-route.test.ts` 5, `reminder-eligibility.test.ts` 9) |
| `expo export --platform web` | Succeeds |
| `./gradlew assembleDebug` (JDK 17) | Succeeds, 490 tasks |

One process note worth recording: an intermediate "gate green" reading during
this checkpoint was wrong. The command grepped only the passing-count line and
hid a failing suite — `scheduler.test.ts` was failing with
`ReferenceError: __DEV__ is not defined` because a new `requireNativeModule()`
import had been added to `channel.ts`, which `scheduler.ts` imports. Fixed by
moving the exact-alarm prompt into its own leaf module
(`notifications/exact-alarm.ts`), preserving the plain-vitest testability the
rest of that directory depends on. Gate commands afterwards surfaced the
overall task status, not just the passing count.

All Checkpoint 5 test tasks and inbox items were deleted from the dev database
afterward. Device rows were deliberately left in place.

## Phase 4 Checkpoint 4.5 Stage A — Google Calendar OAuth spike (COMPLETE, 2026-08-20)

Planned via plan mode; the user approved with 10 required corrections (native
AuthorizationClient bridge instead of the legacy GoogleSignin SDK, least-privilege
scopes, a per-link conflict baseline, a corrected recurring-exception mapping
model, exclusive/inclusive all-day date math, a frozen `events.list` request
shape, full-resync reconciliation semantics, non-destructive disconnect,
explicit-only outbound push, and a documented Testing-mode token-expiry caveat)
before Stage A began. The full corrected plan is recorded at
`/Users/himalpokhrel/.claude/plans/linear-gathering-hopper.md`. This entry covers
Stage A only — the narrow real-device OAuth spike gate — not Stage B (schema,
worker, sync engine, UI), which has not started.

**Google Cloud setup** (user, in the existing `personal-os-196cf` project): Calendar
API enabled; OAuth consent screen in Testing status with the user's real Google
account added as a test user (account identifier deliberately not recorded here)
and exactly four scopes (`openid`, `email`,
`.../auth/calendar.events`, `.../auth/calendar.calendarlist.readonly`); an Android
OAuth client (`Personal OS Dev (Rabbit)`, package `com.himal.personalos.dev`); a
Web application OAuth client (`Personal OS API (dev)`) whose id/secret were placed
directly into the root `.env` as `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`
by the user, never typed into chat. `apps/mobile/.env`/`.env.example` gained the
non-secret `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (the Web client id, needed on-device
as `requestOfflineAccess()`'s `webClientId` — the matching secret stays server-side
only).

**A real, non-obvious bug was found and fixed during setup, not assumed away:**
the Android OAuth client was first registered with the SHA-1 fingerprint from the
*global* `~/.android/debug.keystore`. Expo's local prebuild actually signs debug
builds with its own **project-local** `apps/mobile/android/app/debug.keystore`
(generated the first time `expo run:android` creates the native project) — a
completely different key. This produced a real `UNREGISTERED_ON_API_CONSOLE`
error from the live device, not a theoretical concern. Diagnosed by extracting the
actual APK's signing certificate via `apksigner verify --print-certs` (plain
`keytool -printcert -jarfile` doesn't read APK Signature Scheme v2/v3 signatures,
so it silently failed first) and comparing SHA-1 fingerprints directly. The user
corrected the Android client's SHA-1 in the console to the real value
(`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`), after which
authorization succeeded immediately.

**Native bridge built** (per the user's correction, not the legacy GoogleSignin
SDK): a new Expo Module, `apps/mobile/modules/google-calendar-auth/`, modeled
directly on the existing `modules/exact-alarm-status/` precedent. Its Kotlin side
(`GoogleCalendarAuthModule.kt`) wraps `Identity.getAuthorizationClient(activity)` +
`AuthorizationRequest.Builder().setRequestedScopes(...).requestOfflineAccess(webClientId)`
directly, using the Expo Modules Kotlin DSL's `AsyncFunction(name) { args, promise
-> }` overload plus the `OnActivityResult { activity, payload -> }` DSL entry to
receive the `IntentSender` result — both confirmed to exist in the exact installed
`expo-modules-core@57.0.11` by reading its bundled Kotlin sources directly before
writing code, not assumed from general Expo Modules API knowledge. Depends on
`com.google.android.gms:play-services-auth:21.6.0`, added via the module's own
`android/build.gradle`, autolinked with no `app.config.ts` plugin entry needed
(matching the existing `exact-alarm-status` precedent, which also has none). This
module is a real, permanent Stage B deliverable — not thrown away.

**Verification actually run, all on the physical Rabbit R1 using the established
side-by-side `com.himal.personalos.dev` identity** (per Locked Decision 6 —
production's `com.himal.personalos` install was never targeted by any command this
session):

| # | Check | Result |
|---|---|---|
| 1 | Dev-client build with the new native module | `expo run:android` (EXPO_PUBLIC_UI_TEST_MODE=true) succeeded after fixing one real Kotlin compile error (`Scope.scopeUri` doesn't exist in this `play-services-auth` version; `Scope.toString()` returns the scope URI instead — found directly from the Gradle error, not guessed) |
| 2 | Real native authorization call, live on-device | A throwaway button on the existing `hardware-debug` screen invoked the bridge; Android's real account-picker and consent dialogs appeared — confirmed via `uiautomator dump` since `adb screencap` is black-screen-unreliable on this exact hardware, a quirk already documented in Checkpoint 3 (LogBox rendering black-on-black) and re-confirmed here by a real photo the user took of the physical device showing the app genuinely rendering correctly |
| 3 | Wrong-account rejection is real, not assumed | Selecting a different, non-test-user Google account first was correctly rejected (before the SHA-1 fix, this surfaced as `UNREGISTERED_ON_API_CONSOLE`; the flow itself — account picker → consent → result — was already working) |
| 4 | Real `serverAuthCode` received | Confirmed length 73, all four requested scopes reported granted (`grantedScopes` included both calendar scopes plus `openid`/`email`/`userinfo.email`) |
| 5 | Real server-side code exchange | A one-off local script read the real `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` from `.env` and posted to `https://oauth2.googleapis.com/token` — HTTP 200, real `access_token` (253 chars), real `refresh_token` (103 chars), real `id_token` (922 chars) |
| 6 | OIDC identity decoded and correct (Locked Decision 2) | The `id_token` JWT payload was decoded (no signature verification needed for this spike): a real `sub` and the real, `email_verified: true` account email were both present and correctly matched the account selected on-device (values deliberately not recorded here) — proving the OIDC identity is what supplies the stable account id/email, not any calendar-scoped call |
| 7 | `calendar.calendarlist.readonly` works independently | Real `GET .../users/me/calendarList` with the access token → HTTP 200, 4 real calendars returned (including the real primary calendar and a real "Family" calendar) |
| 8 | `calendar.events` works independently, frozen request shape accepted | Real `GET .../calendars/primary/events?singleEvents=false&showDeleted=true&maxResults=10` → HTTP 200, 10 real events returned with no rejection of the frozen parameter shape from the corrected plan §3.6 |
| 9 | Refresh-token grant exercised immediately (Correction 7 — no waiting for real expiry) | A real `grant_type=refresh_token` call succeeded immediately after the code exchange — HTTP 200, a genuinely different new `access_token` returned, and that new token verified against a real second `calendarList.list` call (HTTP 200) |
| 10 | No public callback/listener at any point | Confirmed by construction (native `AuthorizationClient` + direct server↔Google token exchange, no redirect URI configured on either OAuth client) and by observation (no browser tab ever opened on-device) |
| 11 | Production untouched | `dumpsys package com.himal.personalos` before/after: `versionCode=3`, `versionName=1.0.0`, `firstInstallTime`/`lastUpdateTime` both unchanged at `2026-08-19 16:26:10`, matching Checkpoint 6's recorded baseline exactly |
| 12 | Cleanup | Throwaway UI/console.log removed from `hardware-debug.tsx` (reverted to its pre-spike content exactly); the temporary local scratch file holding live tokens was deleted; the `com.himal.personalos.dev` build was uninstalled from the Rabbit afterward, matching the Checkpoint 4.2 precedent of not leaving temporary builds installed |
| 13 | `pnpm typecheck`/`pnpm lint` (apps/mobile) after cleanup | Both clean — typecheck zero errors; lint's one warning is pre-existing and in an unrelated file (`events/[id].tsx`), not touched this session |

**What Stage A leaves behind for Stage B:** the real, working
`modules/google-calendar-auth/` native module; `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` in
the root `.env`; `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` in `apps/mobile/.env`; the
corrected Android client SHA-1 on record; and the exact confirmed scope list. No
schema, worker, or UI code from the corrected plan's Stage B has been written.

**Expected dev-environment caveat, not a defect:** per the corrected plan §11,
while the OAuth consent screen stays in Testing status, Google expires refresh
tokens issued to test users after 7 days — the real refresh token obtained during
this spike will need reconnection after that window. This is expected and
untouched by this session; the production publishing-status decision is deferred
to Checkpoint 4.7.

## Phase 4 Checkpoint 4.5 Stage B — Google Calendar full sync implementation & closure (COMPLETE, 2026-08-20)

Built across stages B1–B5 following the user-approved Stage B plan and locked architecture constraints (per-link conflict baselines, explicit outbound-only linking per Decision 9, non-destructive disconnect, canonical `singleEvents=false` / `showDeleted=true` query shape, atomic 410 full resync with seen/unseen reconciliation, recurrence exception mappings, and full token redaction). Local development only; production untouched.

**What was built & audited:**

1. **B1 — Schema, migrations & Zod contracts (`packages/db`, `packages/schema`)**:
   - Migrations `0007_abnormal_norrin_radd.sql` and `0008_blushing_runaways.sql` applied cleanly.
   - Four tables: `calendar_connections`, `calendar_connection_calendars`, `event_external_links`, and `calendar_event_instances`.
   - Nullable encrypted credential columns for non-destructive disconnects; nullable `google_event_id` in `event_external_links` for initial pending outbound pushes.
   - Strict AES-256-GCM token storage; Zod schemas sanitize all internal secrets from API responses.

2. **B2 — `@personal-os/calendar-providers`**:
   - Google OAuth token exchange & refresh without `redirect_uri` (proven on physical Android in Stage A).
   - Invertible Google all-day end-exclusive ↔ Personal OS end-inclusive conversion.
   - RFC 5545 translation: UNTIL/COUNT extraction, EXDATE isolation, and `LocalMutationIntent` union classification.
   - Zero Node API leaks in web/mobile client paths.

3. **B3 — API routes & worker sync engine (`apps/api`, `apps/worker`)**:
   - Endpoints: Google auth exchange, list connections, list available calendars, patch calendar sync toggles, sync-now, non-destructive disconnect, and explicit outbound linking (`POST /events/:id/link-google-calendar`).
   - Worker jobs: `calendar.google.sync-calendar`, `calendar.google.push-event`, `calendar.google.refresh-token` with pre-created dead-letter queues.
   - Per-link sync baseline tracking `(last_synced_local_updated_at, google_updated_at)` evaluated in `decideConflict`.
   - 410 full resync fallback with transactional seen vs deleted reconciliation.
   - Per-calendar singleton serialization via pg-boss.

4. **B4 — Mobile Settings UI & Event Linking (`apps/mobile`)**:
   - Android-gated native auth bridge with web/iOS fallback banner.
   - Settings UI with connection status, reauth alerts, per-calendar sync toggles, sync-now, and non-destructive disconnect.
   - Explicit Google Calendar picker on `events/new.tsx` and `events/[id].tsx` conforming to Decision 9 (no automatic project fanout).
   - Graceful 409 conflict handling.

5. **B5 — Verification gates & closure checks**:
   - Comprehensive audit verified all locked decisions (Agents A, B, C, D).
   - Deterministic conflict resolution verified: remote-wins and local-wins both advance baselines and suppress ping-pong echo.
   - Recurring exceptions verified in both directions: Google -> Personal OS (detached & cancelled) and Local -> Google (detached instance push with `recurringEventId` and `originalStartTime`).
   - Whole-event delete/archive round-trips verified: local archive deletes Google remote event; Google delete archives local event (soft-delete, link removed) and does not resurrect on re-sync.
   - Worker queue isolation verified: long-running Google sync jobs execute concurrently without blocking or starving notification dispatch or capture workers.
   - Live credential redaction verified: DB contains ciphertext bytea, API responses omit secrets, logs are clean, and `.env` remains gitignored.

**Verification run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | Clean across all 9 packages and apps |
| 2 | Full test suite | **415 tests pass across 53 test files** (`@personal-os/core` 58, `@personal-os/schema` 17, `@personal-os/ai-providers` 20, `@personal-os/calendar-providers` 39, `@personal-os/api-client` 19, `api` 123, `worker` 61, `mobile` 79) |
| 3 | Expo web export (`npx expo export --platform web`) | Bundled cleanly (SPA single output) |
| 4 | Security & git hygiene | `git diff --check` clean; `gitleaks git --verbose` scanned 49 commits with 0 leaks; `.env` gitignored |
| 5 | Recurring exception tests (both directions) | Google->Local (detach & cancel) and Local->Google (detached push with `recurringEventId` + `originalStartTime`) passing |
| 6 | Deterministic conflict & echo suppression | Tested and passing: intentional timestamp winner evaluated, both baselines advance, immediate re-sync produces zero ping-pong |
| 7 | Simultaneous local edit vs remote delete | Tested and passing: local event archived (soft-deleted), link removed, subsequent sync does not resurrect |
| 8 | Queue isolation smoke | Tested and passing: concurrent notification dispatch while calendar sync in-flight |

## Phase 4 Checkpoint 4.6 — CalDAV calendar sync (COMPLETE, 2026-08-21)

Built as the second calendar sync provider behind the architecture proven by Google Calendar. Fully adheres to RFC 4791, RFC 6578, and RFC 5545 specifications, including single `.ics` resource recurrence sets, conditional HTTP operations with ETags, SSRF/redirect defense, and universal client support across iOS, Android, and Web. Local development only; production untouched.

**What was built:**

1. **Database schema & migration `0009` (`packages/db`, `packages/schema`)**:
   - `0009_caldav_provider_support.sql`: Purely additive migration supporting CalDAV columns on `calendar_connections`, `calendar_connection_calendars`, `event_external_links`, and `calendar_event_instances`.
   - CHECK constraints guaranteeing provider invariants (Google connections require `google_account_email` and `auth_type='oauth2'`; CalDAV connections require `server_url`, `username`, encrypted password, and `auth_type IN ('basic', 'bearer')`).
   - Partial unique indexes ensuring provider isolation and no malformed mixed-provider rows.
   - `packages/schema`: Added `ConnectCaldavCalendarRequestSchema`, `AvailableCalendarSchema`, `LinkEventToCalendarRequestSchema`, and updated `CalendarConnectionSchema`.

2. **CalDAV Client, Security, & Translation Engine (`packages/calendar-providers`)**:
   - **SSRF & Credential Protection (`caldav/ssrf.ts`)**: Mandatory HTTPS requirement (HTTP permitted only for local dev/test loopback), link-local (`169.254.0.0/16`, `fe80::/10`) and cloud metadata (`169.254.169.254`) blocked. Cross-origin redirects strip `Authorization` headers.
   - **`HttpCalDavClient` (`caldav/caldav-client.ts`)**: RFC 4791 bootstrap discovery (`/.well-known/caldav` -> `current-user-principal` -> `calendar-home-set`), collection discovery (`supported-report-set`, `resourcetype`), RFC 6578 `sync-collection` REPORT with pagination (`number-of-matches-within-limits`), full-inventory fallback (PROPFIND Depth:1 -> diff), batch multiget REPORT (`calendar-multiget`), conditional `PUT` (`If-Match` / `If-None-Match: *`) and conditional `DELETE`.
   - **`FakeCalDavClient` (`caldav/caldav-client.fake.ts`)**: In-memory mock implementing the full CalDAV protocol, including sync-token invalidation, truncation, ETag conflicts, and recurrence exceptions.
   - **RFC 5545 Translation Engine (`caldav/translate.ts`)**: Multi-component single-resource recurrence set parsing (RFC 4791 §4.1: master VEVENT + RECURRENCE-ID exceptions sharing one UID and ETag), local VCALENDAR serialization, and in-place exception injection (`applyExceptionToVCalendar`).

3. **API Endpoints & Client (`packages/api-client`, `apps/api`)**:
   - Added `POST /calendar-connections/caldav` (server_url, username, password with AES-256-GCM encryption).
   - Added `GET /calendar-connections/:id/available-calendars` (provider-agnostic calendar collection discovery).
   - Added `PATCH /calendar-connections/:id/calendars` (supports `caldav_calendar_url` opt-in/opt-out).
   - Added `POST /calendar-connections/:id/sync-now` and `POST /calendar-connections/:id/disconnect` (clears credentials, preserves mapping rows).
   - Added `POST /events/:id/link-calendar` (supports both Google and CalDAV collections).
   - `packages/api-client`: Exported `connectCaldavCalendar`, `listAvailableCalendars`, and `linkEventToCalendar`.

4. **Worker Sync Engine & Inbound/Outbound Jobs (`apps/worker`)**:
   - `syncCaldavCalendar` in `calendar.sync-calendar` job: Incremental sync via `sync-collection`, fallback to inventory PROPFIND upon invalid sync token, multiget batching, deterministic conflict resolution via ETag baseline (`decideConflict`), soft-deletion handling, and recurrence exception mapping.
   - `pushCaldavEvent` in `calendar.push-event` job: Insert new events (`If-None-Match: *`), update existing events (`If-Match: ETag`), detached occurrence push (reads parent `.ics`, injects RECURRENCE-ID VEVENT, performs conditional PUT on parent resource ETag), and remote event deletion upon local archive.

5. **Universal Mobile UI (`apps/mobile`)**:
   - Added "Connect CalDAV" form and `CaldavCalendarConnectionCard` in Settings screen, available universally on iOS, Android, and Web.
   - Updated `mergeAvailableCalendars` to handle both Google and CalDAV collections.
   - Updated event linking picker and query hooks to support CalDAV calendars.

**Live CalDAV Interoperability Verification (Radicale 3.7.8):**

Tested against a real RFC 4791 reference CalDAV server (Radicale 3.7.8):
- **Discovery**: `discoverHomeSet` resolved principal (`http://127.0.0.1:5232/testuser/`) and calendar-home-set (`http://127.0.0.1:5232/testuser/`). `findCalendars` discovered collections and reported capabilities.
- **One-off Events**: Created remote event with `If-None-Match: *`, imported to Personal OS, modified locally, and pushed back with `If-Match: <etag>`. ETag advanced from `6da924...` to `0157b4...`.
- **All-day Events**: Roundtripped 2-day all-day event (`2026-08-28` to `2026-08-29`). Verified exclusive remote DTEND (`20260830`) correctly translates to inclusive local end date (`2026-08-29`).
- **Recurrence Sets**: Master recurring series created. Detached occurrence injected into the same `.ics` resource via `applyExceptionToVCalendar` with `RECURRENCE-ID` and pushed via conditional PUT. Re-sync returned both master and detached exception without series duplication. Occurrence cancellation applied `EXDATE` to master VEVENT without deleting parent series.
- **Inventory & Fallback**: Radicale does not support RFC 6578 sync-collection; fallback path (`PROPFIND Depth:1` inventory diff $\rightarrow$ `calendar-multiget` batching) executed cleanly.
- **ETag Conflict Protection**: Attempted write with stale ETag returned `412 Precondition Failed` without overwriting remote data.
- **Delete/Archive**: Conditional DELETE verified on remote server (returned 404 on subsequent GET).
- **Disconnect/Reconnect**: Connection disconnected (credentials cleared, event links preserved), then reconnected without duplicate data creation.

**Google Regression Audit:**
- All Google Calendar sync, push, refresh-token, recurrence-exception, and 410 gone reconciliation tests passed with 100% success.
- Provider queues dispatch cleanly to respective provider engines (`google` / `caldav`) with per-calendar serialization intact.

**Android Release Build:**
- Command: `cd apps/mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease --console=plain`
- Result: **BUILD SUCCESSFUL in 20s** (653 actionable tasks: 69 executed, 584 up-to-date).
- Output APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (111MB, SHA-256 `8800dc595daf3c5ba7f5540a09be752cdba0f1003fedbb1c0cbc7396cb9c2508`).

**Verification Summary:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | Clean across all 9 packages and apps (0 errors, 0 warnings) |
| 2 | Full test suite | **462 tests pass across 62 test files** (`@personal-os/core` 58, `@personal-os/schema` 18, `@personal-os/ai-providers` 20, `@personal-os/calendar-providers` 57, `@personal-os/api-client` 20, `api` 124, `worker` 66, `mobile` 77) |
| 3 | Expo web export (`npx expo export --platform web`) | Bundled cleanly (SPA single output) |
| 4 | Android Release Build (`assembleRelease`) | BUILD SUCCESSFUL (653 tasks) |
| 5 | Security & git hygiene | `git diff --check` clean; `gitleaks` scanned 50 commits with 0 leaks; `.env` gitignored; password redacted in API logs |
| 6 | Migration `0009` & DB role verification | Clean application on dev and test DBs; DDL restricted for runtime app role |
| 7 | Real CalDAV Interoperability | 8/8 suites passed against Radicale 3.7.8 |
| 8 | Google Regression Suite | 100% pass across API, worker, and provider packages |

## Phase 4 Checkpoint 4.7 — Production deployment, reboot survival, closure (COMPLETE, 2026-08-21)

Executed across gates A–H followed by final closure gates I1–I8. Server deployment is live; production DB migrations 0000–0009 are applied; the Rabbit was upgraded in place (`com.himal.personalos`, versionCode 4, pairing preserved, PRIMARY preserved, signing identity unchanged); Google production OAuth and a bounded sync smoke test passed; **no CalDAV connection was created in production**; the Tailscale-only network posture is unchanged.

### Gate C incident — postgres recreation on first migration attempt (recorded honestly)

The first migration attempt failed because `MIGRATIONS_DATABASE_URL` was missing — and in the same invocation, `postgres` was unexpectedly recreated. The persistent volume survived: `personal-os_postgres_data` kept its identity, no data was lost, and the migration itself did not run. The successful retry used the reviewed Compose invocation with `--no-deps`: migrations 0005–0009 were applied exactly once each, the journal contains exactly 0000–0009 (10 rows, monotonic timestamps), and runtime DDL denial for `posops_app` was preserved. This repeats the class of process mistake already recorded at Phase 2 ("a few seconds of avoidable restart"); all subsequent Compose commands passed both compose files plus `--no-deps`.

### Gate H discovery and hotfix — linked-event edits did not push

**Defect:** normal local mutations of *already-linked* events did not enqueue the outbound calendar push pipeline. Outbound pushes only fired via explicit link/sync paths, so an ordinary edit left Google/CalDAV stale until the next manual sync — a real pre-existing correctness defect dating to Checkpoints 4.5/4.6.

**Root cause & hotfix** (`121cf3752300e309b523d6584ace219288e4a26b`): new `enqueuePushIfLinked(app, eventId)` helper in `apps/api/src/routes/events.ts` checks `event_external_links` and sends to the existing `calendar.push-event` queue (singletonKey = event id), wired into PATCH `/events/:id`, `/archive`, `/detach` (parent id), and `/cancel-occurrence` (parent id). `apps/worker/src/jobs/calendar-push-event.ts` additionally advances the CalDAV `updated_at` baseline on push success so the next inbound sync does not spuriously re-apply. Regression tests added in `events.test.ts` (+195 lines) and `calendar-push-event.test.ts` (+44 lines).

**Backend-only production redeployment:** `git diff --name-only 0b68a052..121cf375` contains only `apps/api` and `apps/worker` files — zero `apps/mobile` changes — so the versionCode-4 APK built from `0b68a052` remains valid at hotfix HEAD. **Real production proof passed:** a normal local PATCH → automatic outbound push → change visible in Google → sync baseline advanced → follow-up Sync Now produced no echo/ping-pong.

### Component release lineage

Components intentionally do **not** all come from one commit; provenance is stated per component:

| Component | Source commit | Artifact / image | Runtime identity |
|---|---|---|---|
| api | `121cf375` (hotfix) | image sha256:`51f14ae98178…` | container `8601af395405`, restart `unless-stopped` |
| worker | `121cf375` (hotfix) | image sha256:`14f58997fd29…` | container `3f1a2bf824b2`, restart `unless-stopped` |
| web | `0b68a052` (initial 4.7 rollout; backend-only hotfix changed nothing web-relevant) | image sha256:`18b74c818966…` | container `00f010617277`, restart `unless-stopped` |
| mobile (Android) | `0b68a052` | EAS build `11df9c1a-44e0-4286-97c9-291bbb725a9b`, profile `production-internal`; APK SHA-256 `d02fe3c54ad3a213344f55907214b89807b0a2b7f5bec2af5d9f17183034ec60` (preserved outside the repo under `checkpoint-4.7/`) | `com.himal.personalos` versionCode **4**, versionName 1.0.0; signing cert SHA-256 unchanged from Checkpoint 6 (`4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`) per ADR-037 remote-credential reuse |
| database | migration level **0000–0009** (10 journal rows), each applied once as `posops_migrator` | volumes `personal-os_postgres_data` (2026-08-15) / `personal-os_audio_data` (2026-08-19), identities unchanged throughout | `posops_app` remains DML-only |

Rollback tags retained on the server: `pre-hotfix-0b68a05` (api/worker images) and `cp6-rollback-398ad51` (all three services). The pre-upgrade versionCode-3 APK backup is also preserved outside the repo.

### Tailscale-after-reboot finding (I1–I3)

**Previous failure:** after a Rabbit reboot, Tailscale did not automatically re-establish its VPN; Personal OS correctly showed network failure and self-healed once Tailscale was started manually.

**Root cause:** Always-on VPN had never been configured — `settings get secure always_on_vpn_app` returned null (both `secure` and `global` namespaces). Android therefore had no mandate to start Tailscale's VpnService at boot; `BOOT_COMPLETED` fired but nothing spawned until the app was manually opened. A device configuration absence, not a Tailscale or ROM defect.

**Fix applied:** Always-on VPN enabled through Android Settings (Settings → Network & internet → VPN → Tailscale ⚙ → Always-on VPN ON); "Block connections without VPN" deliberately left OFF; verified read-only afterward (`always_on_vpn_app=com.tailscale.ipn`, `always_on_vpn_lockdown=0`). No Tailscale patching, reinstall, or key changes.

**Final Rabbit reboot test — PASS:** boot completed in ~60 s; `tun0` UP and `com.tailscale.ipn/IPNService` running with **no manual launch**; MagicDNS resolved the tailnet name automatically; the API became reachable without intervention; Tasks and Calendar loaded with real data; no pairing screen; zero entries in the crash buffer; versionCode 4 intact.

### Host reboot survival test (I4) — PASS

Pre-reboot state recorded (container IDs/images/start times, `unless-stopped` policies, volume identities, journal = 10 rows, Serve config, health, bindings). One normal host reboot. Recovery: SSH back in ~30 s; all four containers auto-started with **identical container IDs and image digests**; volume identities and creation timestamps unchanged; single compose network unchanged; journal still exactly 10 rows; queues fully drained; heartbeat fresh within seconds of start; Serve restored tailnet-only; bindings identical (API `127.0.0.1:3000`, web `127.0.0.1:8081`, Postgres unpublished, no `0.0.0.0` application listeners); tailnet HTTPS API health and web HTTP 200 verified from a second machine; the Rabbit reconnected with no manual repair (tailnet ping ~28 ms avg).

### Final audits (I5)

- `posops_app` DDL denial re-proven post-reboot (`permission denied for schema public`); journal 10 rows; heartbeat fresh.
- Gate H smoke cleanup verified then completed: exactly three rows purged in a count-verified transaction — archived smoke events `cd3e12fb…` ("inbound smoke") and `7be0fb34…` ("outbound smoke"), plus inbox item `7e468843…` ("4.7 smoke test note"); `event_external_links`/`calendar_event_instances`/`occurrences` held zero referencing rows before deletion; post-purge scans clean. The smoke capture's committed note row (`132020f6…`) deliberately remains as ARCHIVED lineage (outside the approved purge scope; invisible in UI, referenced by nothing).
- Production Google state: exactly one active connection, access/refresh tokens AES-256-GCM encrypted, only the dedicated test calendar sync-enabled, zero orphan/duplicate links, zero instance mappings.
- Secrets: gitleaks clean across 53 commits; server `.env` mode 600; zero secret matches in api/worker container logs.
- Repo gates at `121cf375`: build, typecheck, lint, format check, tests, Expo web export, `git diff --check`, gitleaks — all pass. **543 tests pass across 60 test files** (fresh non-cached run): core 105, schema 57, calendar-providers 57, ai-providers 20, api-client 27, api 130, worker 70, mobile 77.



## Current work

**Phase 6 Checkpoints 6.0 and 6.1 are complete. Work has stopped, as planned.**

6.0 delivered ADR-046..050 and reconciled seven documented conflicts. 6.1 delivered the
shared contracts, additive migration `0013` (local dev/test only — **production is still at
0000–0012**), the `packages/core/src/health/` helpers and the new
`packages/health-providers` package with its in-memory fake. 1303 tests pass across 16
turbo tasks; both zero-drift canaries held exactly.

Phase 5 remains complete and deployed; the 5.7.1 hotfix closed the one production defect
5.7 found.

Production runs migration level 0000–0012, api/web from `b7f7bf1`, worker from `656c1fc`
(deliberately not rebuilt — unchanged dependency closure), and the Rabbit runs
versionCode 6. The Daily Brief is live on the existing gpt-4.1 route.

One acceptance item remains genuinely unverified and is **not** a code defect: the
real-browser CORS proof (see the 5.7.1 entry — both browser surfaces failed for
environmental reasons). It needs a human with a browser, roughly fifteen seconds.

**Do not begin Checkpoint 6.2 without BOTH (a) the M2–M8 Google Cloud actions and
(b) a separate explicit user approval.** Nothing further is authorized.

## Remaining warnings / technical debt

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
  The live build context is `/home/himallinux/personal-os-5.7-release`; `personal-os-4.7-release`
  is retained as a rollback source.
- **There is no DELETE endpoint for AI task routes.** Undoing the production `daily_brief`
  registration requires another upsert repointing `primary_model_id`, or direct SQL.
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

## Remaining warnings / technical debt

- ~~**`remind_at` cannot be set or changed through the API.**~~ — **STALE, corrected 2026-08-23.** Checkpoint 5.4 added `remind_at` to `TaskUpdateSchema` (`PATCH /tasks/:id`), and an editor exists at `apps/mobile/src/app/tasks/[id].tsx`. What remains true, and is the real residual debt: that editor is a raw ISO-8601 `TextInput` with no picker or validation, and `tasks/new.tsx` still cannot set a reminder at creation time.
- ~~**Android captures are labelled `source: "web"`**~~ — **NOT A DEFECT; reclassified in Checkpoint 5.6.** `source` is an ENTRY-PATH vocabulary, not a platform tag, and is closed by both `CaptureSourceSchema` and the `inbox_items_source` CHECK constraint. `web` correctly denotes the in-app Quick Capture sheet on every platform. There is no native member, and adding one would require altering the CHECK constraint (a migration). The rule is now documented in `docs/ARCHITECTURE.md` and pinned by a test. See ADR note in the 5.6 entry.
- **Revoking a device does not clear its `is_primary_reminder_device` flag**, so a revoked row can keep holding primary and no device schedules reminders until primary is reassigned.
- **The exact-alarm grant does not survive reinstall.** Every rebuild silently returns the app to inexact reminders until the user re-grants "Alarms & reminders".
- **Duplicate-alarm repair is covered by unit tests only.**
- **Runtime images aren't pruned of devDependencies.**
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval.
- **`docs/PHASE-0-CHECKLIST.md` section E checkboxes** remain unchecked in favor of `STATUS.md` as canonical record.
- **The web app's `EXPO_PUBLIC_API_URL` is baked in at Docker build time.**
- **No `GET /calendar-connections/:id/calendars` endpoint** — per-calendar `sync_enabled` state is returned via `PATCH` and cached on mobile. A dedicated `GET` route can be added in a future polish pass.
- **`tailscaled` runs as a snap** on the production host — the monitoring unit is `snap.tailscale.tailscaled.service`, not `tailscaled.service`.
- **Rabbit Tailscale auto-start depends on Android's Always-on VPN setting** (enabled 2026-08-21; lockdown off). It is a device-side OS setting, not app-managed — a factory reset or Tailscale reinstall would require re-enabling it.
- **One archived Gate H smoke note row (`132020f6…`) remains as lineage** — invisible in UI, referenced by nothing, deliberately outside the approved purge scope.

## Last verification

**Phase 6 Checkpoint 6.1 — contracts, migration `0013`, provider fake (2026-08-24).**
Local development only; production untouched.

Full gate: build / typecheck / lint / format:check all clean; **1303 tests across 16 turbo
tasks** (1169 → **+134**); `git diff --check` clean; gitleaks 85 commits, no leaks;
`expo export --platform web` clean with a single `index.html`.

**Both zero-drift canaries held exactly: `@personal-os/calendar-providers` 57 and `worker`
80** — Phase 6 has not touched calendar sync, and the worker canary is re-baselined only
when 6.3 legitimately adds worker tests.

Per-package: core 308 (+37) · db 14 (unchanged — the journal guards pass *with* the new
migration) · schema 138 (+15) · **health-providers 82 (new)** · calendar-providers 57 ·
ai-providers 25 · api-client 70 · api 332 · worker 80 · mobile 197.

Migration `0013_google_health_sync` applied once to dev and once to `personalos_test` as
`posops_migrator`: **14 tracking rows, 7 tables, 12 CHECKs, 6 FKs, 21 indexes** in both.
`db:reconcile --check` reports the tracking table consistent with the journal.

**A fresh disposable database migrated `0000 → 0013` produced a `public` schema
byte-identical to dev — an empty diff over 600 lines** — which is the proof that the
hand-written `0013` matches what the Drizzle schema declares, so a future `generate` has
no drift to "fix". The database was dropped afterwards.

Constraints proven to bite, as `posops_app` against the real database: `CREATE TABLE` and
`ALTER TABLE` both denied (`42501`); a partially-populated credential triple rejected; a
bad status, a bad `external_key_source`, a bad run kind and an end-before-start session all
rejected (`23514`); a duplicate `(connection, metric, local_date)` rejected (`23505`); and
**a true zero (`has_data=true, value=0`) and a verified absence (`has_data=false`) both
accepted and distinguishable** — the property ADR-047 exists to guarantee. Cascade delete
left zero residue.

*Previous verification — Phase 5 Checkpoint 5.7.1 all-day noon-anchor hotfix (2026-08-24),
full gate at `b7f7bf1`: 1169 tests across 15 turbo tasks, 13 migrations, gitleaks clean.*

Both guards are **mutation-tested**: removing the collector's `all_day` short-circuit
fails exactly the three timezone tests, and removing the mobile helper's fails six.
Regression coverage spans America/Chicago, Pacific/Auckland and America/Santiago, where
the noon anchor lands on a different UTC hour and a different UTC day.

Production: api and web rebuilt and rolled out with `--no-deps`; **worker and postgres
never recreated**. The deployed web bundle was compared byte-level against the pre-fix
one — the exact leaking expression is present in the old and absent from the new. The
production Daily Brief went from *"an all-day weekly event beginning at 12:00 PM"* to
*"an all-day event on both August 25 and August 26"*, with zero mentions of 12:00 or
noon. Read models returned three instances on three distinct dates with `starts_at` null.

Device (versionCode 6, installed with `adb install -r`, `firstInstallTime` and pairing
and PRIMARY all preserved): Today renders `All day, P571-SMOKE all-day recurring` where
it previously rendered `12:00, …`; Agenda shows ALL-DAY on all three dates; Week shows
three all-day chips with no time; Month shows no time. Google/CalDAV unaffected —
connection active, 1985 calendar jobs completed with zero failures. Smoke cleanup was
count-verified with zero residue and zero orphans of any kind.

**Not verified and not claimed:** the real-browser CORS proof. Both available browser
surfaces failed environmentally — the Chrome extension was not connected, and the
sandboxed pane returns `net::ERR_BLOCKED_BY_CLIENT`, which blocks the request before it
leaves the browser and so is not a CORS result. Server-side header evidence stands.

## Next action

**Stopped. The approved scope (6.0 + 6.1) is complete.** Checkpoint 6.2 is blocked on
user-only actions.

**What is needed from the user, in order — none of which I can do:**

1. **M4a first, because it can invalidate the shipped flow:** try registering
   `https://personal-os.tail62a68f.ts.net/health-connections/google/callback` as an
   Authorized redirect URI. If the Console rejects a `.ts.net` domain, **stop at the OAuth
   gate** — there is no automatic loopback fallback (a `127.0.0.1` callback needs a listener
   on the browser's own device, which neither the web app nor the Rabbit app has), and no
   public ingress will be added under any circumstances.
2. **M8, the other assumption that could break the plan:** press **Publish app** to reach
   *In production* and confirm the Console permits it with only Restricted scopes and an
   unverified domain. This is what stops the 7-day refresh-token expiry. If it is blocked,
   the honest fallback is Testing mode with weekly reconnection — **not** a Cloud Identity
   organization, which would restrict authorization to org accounts and cannot serve a
   consumer Gmail account.
3. M2 enable `health.googleapis.com` · M3 create a **separate** Web Server OAuth client ·
   M5 External user type + your account as a test user · M6 select **exactly** the three
   read scopes (not `settings.readonly`) · M7 put the client id and secret into `.env`
   yourself — **never paste a secret into chat**.

Then explicitly approve Checkpoint 6.2.

One acceptance item is outstanding and needs a human with a browser (~15 seconds):

1. **Real-browser CORS proof.** Open `https://personal-os.tail62a68f.ts.net:8443` in a
   real browser and, from the DevTools console, `fetch` the API origin
   (`https://personal-os.tail62a68f.ts.net`) with a `PATCH` — any HTTP status proves the
   preflight succeeded. The unapproved-origin half is already proven server-side.

Optional, not blockers:

2. Generate a fresh Daily Brief on the device whenever wanted — the route is live and the
   verification brief was deliberately deleted with the smoke data.
3. `week-grid.tsx` `formatTimeLabel` and Today's `eventStartMs` now carry defensive
   guards, but both remain functions whose correctness would be easy to re-break by
   changing a call site; they are covered by the shared-helper convention, not by tests
   of their own.

**The Phase 6 gate after 6.1 is hard.** Checkpoint 6.2 requires all of M2–M8 (enable
`health.googleapis.com`; create a **separate** Web Server OAuth client; register the
Tailscale redirect URI; External user type + test user; select exactly the three read
scopes; put the credentials in `.env` yourself; press **Publish app**) **and** a separate
explicit approval. If the Tailscale callback cannot be registered or used, work stops at
the OAuth gate — there is no automatic loopback fallback and no public ingress under any
circumstances (Appendix A §A2).

Finance remains deferred (ADR-038). Phases 7/8 have not been approved or planned.
