# Project Status

**Project:** Personal OS
**Current phase:** Phase 4 — Calendar UI + external sync + recurrence UI — **IN PROGRESS**. Checkpoints 4.1, 4.2, 4.3, and 4.4 are complete (2026-08-20). Checkpoint 4.5 Stage A (Google OAuth spike) is complete (2026-08-20); Stage B (full sync implementation) has not begun. Phase 3 remains COMPLETE, production-deployed, and physically verified — see below.
**Implementation status:** Phases 0–3 are implemented and production-verified. Phase 4 Checkpoints 4.1–4.4 are implemented and verified in local development only; nothing from Phase 4 was deployed to production.
**Next phase allowed:** Checkpoint 4.5 Stage A (OAuth spike) is complete. Checkpoint 4.5 Stage B (full sync schema/worker/UI implementation, per the corrected plan) is safe to begin, but must not begin until the user reviews this Stage A closure report.
**Canonical architecture:** `docs/ARCHITECTURE.md`. **Canonical Phase 4 plan:** `/Users/himalpokhrel/.claude/plans/personal-os-dreamy-ladybug.md` (not part of this repo — a local Claude Code plan file, revision 2, user-approved; the summary below is the durable, repo-tracked record). **Canonical Phase 3 plan:** `/Users/himalpokhrel/.claude/plans/personal-os-begin-unified-cook.md`. **Canonical Phase 2 plan:** `/Users/himalpokhrel/.claude/plans/zesty-twirling-piglet.md`.

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

## Blockers / user-provided items

**Phase 3:** none. Firebase (`personal-os-196cf`) and the EAS FCM V1 credential are configured for the production Rabbit build; production Groq is configured only for `voice_transcribe`; the protected production OpenAI `gpt-4.1` route remains the capture parser.

Phase 0–2: none. Phase 2 is complete with no open blockers. The real-OpenAI-key step from Phase 1 is done — see "Phase 1 real-LLM verification" above (provider registered by the user directly via curl, per this repo's rule against Claude handling raw API keys itself; Claude ran the verification captures afterward, which don't involve credential material).

Intel i5 production server access was provided and used for Phase 0 and Phase 1 (native Ubuntu 26.04 LTS, hostname `personal-os`). No backup system in the current architecture (ADR-024) — NAS/Backblaze are no longer relevant.

Not yet collected, not currently blocking anything:

- age/SOPS key handling preference, if/when repo-stored encrypted config is actually needed (no repo-committed secrets require it yet)
- Apple Developer account — not required until native iOS work

## Current work

Phases 0–3 are complete and production-deployed (Checkpoint 6). Phase 4 Checkpoints 4.1–4.4 are complete in local development, isolated-device-verified, with production proven unchanged. Checkpoint 4.5 Stage A (Google Calendar OAuth spike) is complete — the real native `AuthorizationClient` flow, server-side token exchange, both calendar scopes, and an immediate refresh-token grant were all verified live against the physical Rabbit R1's side-by-side dev identity, with production untouched throughout. Checkpoint 4.5 Stage B (the full sync schema/worker/UI implementation) has not begun and awaits the user's review of this Stage A closure.

## Remaining warnings / technical debt

- **`remind_at` cannot be set or changed through the API.** Neither `TaskCreateSchema` nor `TaskUpdateSchema` accepts it, so a reminder time can only originate from AI capture. Found in Checkpoint 5; deliberately not built there, since adding it is feature work rather than lifecycle verification.
- **Android captures are labelled `source: "web"`** — `apps/mobile/src/components/quick-add-fab.tsx` hardcodes it regardless of platform.
- **Revoking a device does not clear its `is_primary_reminder_device` flag**, so a revoked row can keep holding primary and no device schedules reminders until primary is reassigned. ADR-019 forbids auto-promotion, so Checkpoint 5 surfaced this in the UI (the Settings eligibility banner) rather than changing the rule.
- **The exact-alarm grant does not survive reinstall.** Every rebuild silently returns the app to inexact (one-hour-window) reminders until the user re-grants "Alarms & reminders". Checkpoint 5 added the onboarding prompt and the banner, but the underlying Android behaviour is unavoidable and worth remembering during native development.
- **Duplicate-alarm repair is covered by unit tests only.** `reconcile.test.ts` exercises the retain-one-cancel-the-rest path; Checkpoint 5 never physically injected a duplicate OS notification, relying instead on the observed "exactly one alarm per task" invariant across every reconciliation pass.
- **Runtime images aren't pruned of devDependencies.** `apps/api`/`apps/worker`'s Dockerfiles copy the entire built workspace into the runtime stage rather than a slim production-only `node_modules` — a deliberate Phase 0 "correctness over image size" tradeoff, documented in the Dockerfiles themselves. Worth revisiting before this matters (larger attack surface, slower deploys as the repo grows).
- **HTTPS Certificates / Serve consent** was a one-time per-tailnet approval, now done — noting it here since it wasn't obvious in advance from `tailscale status` alone (`CertDomains` was empty beforehand) and the CLI's own consent-URL flow is what actually resolved it, not a pre-configured admin console setting.
- **`docs/PHASE-0-CHECKLIST.md` section E (Tailscale/network foundation)** items are now substantively done (Tailscale installed+authenticated, MagicDNS confirmed working, Serve configured, Postgres inaccessible as a public service) but the checklist file's checkboxes themselves weren't individually ticked in this pass — worth a follow-up pass to mark them, or treat this STATUS.md entry as the record of evidence.
- No SOPS/age key has actually been generated — remains available but unused, since no secret currently needs to live in the repo.
- **The web app's `EXPO_PUBLIC_API_URL` is baked in at Docker build time**, not read at runtime — changing the API's public URL later means rebuilding the `web` image, not just restarting the container or editing `.env`. Documented in `apps/mobile/Dockerfile` and accepted as reasonable for a single-deployment personal app in the Phase 2 plan.
- **Mobile UI still has no component/E2E harness**, but it now has 22 focused unit tests covering reminder diff/scheduling and durable-outbox behavior. Native lifecycle and small-screen behavior are verified on the physical Rabbit rather than simulated.
- **A minor non-blocking React warning** ("Can't perform a React state update on a component that hasn't mounted yet") appears once during the Checkpoint 3 pairing → main-app transition — functionally harmless, not chased down (see "Phase 3 Checkpoint 3" above).
- **`apps/api`/`apps/worker` runtime images still aren't pruned of devDependencies** (unchanged from Phase 0/1 — see the entry above); Phase 2's new `apps/mobile/Dockerfile` follows a different, already-minimal pattern (only the static `dist/` output plus a fresh `serve` install in the runtime stage), so this only remains relevant to the two original images.

## Last verification

Phase 4 Checkpoint 4.5 Stage A verification, complete and passing (2026-08-20) — see "Phase 4 Checkpoint 4.5 Stage A" above for the full 13-item table. Strongest evidence: a real native `AuthorizationClient` authorization on the physical Rabbit R1 (account picker and consent dialogs confirmed via `uiautomator dump`, since `adb screencap` is unreliable on this exact hardware); a real `serverAuthCode` exchanged server-side for a real `access_token`/`refresh_token`/`id_token`; the OIDC `id_token` decoded to a real, verified `sub`/`email`; both `calendar.calendarlist.readonly` and `calendar.events` scopes proven to work independently against real Google Calendar data; a real refresh-token grant exercised immediately (not after waiting for expiry) and the new token verified with a second live API call; and `dumpsys package com.himal.personalos` showing an unchanged `versionCode`/`versionName`/install timestamps before and after, proving production was never touched. One real bug (Android OAuth client registered with the wrong debug keystore's SHA-1) was found and fixed using real diagnostic evidence (`apksigner verify --print-certs`), not assumed. `pnpm typecheck`/`pnpm lint` clean after all throwaway spike code was removed.

Phase 3 Checkpoint 6 production verification, complete and passing (2026-08-20) — see "Checkpoint 6 final production evidence" above. Strongest evidence: migration `0004` alone applied by the migrator while the original PostgreSQL container/volume remained unchanged; targeted API/worker/web rollout over Tailscale-only endpoints; a stable EAS-signed internal APK installed and paired on the physical Rabbit; exact reminder delivery and routing; real Rabbit microphone → Groq Whisper → protected OpenAI parser PTT; separate Expo-accepted and physically delivered diagnostic/`needs_confirm` pushes; revoked-token and non-tailnet isolation checks; and targeted restart recovery with unchanged container IDs and PostgreSQL start time. Final documentation gates: `pnpm format:check` clean and gitleaks clean. No Phase 4 work began.

Phase 3 Checkpoint 5 verification, complete and passing (2026-08-18) — see "Phase 3 Checkpoint 5" above for the full matrices, including Stage H. Strongest evidence: the complete five-state lifecycle matrix run from a **fresh install** on the physical Rabbit R1, including a reboot test where the app was never manually opened (focus stayed on the lock screen) and the alarm was restored as **exact** before firing; the ADR-029 security boundary demonstrated live (device revoked → `401` on device routes, while `/tasks`, `/inbox` and `/capture` still answered 200/200/202 with **no** `Authorization` header); the revoke → re-pair recovery path exercised for the first time; the offline outbox surviving a real force-stop and then flushing automatically on backoff expiry with **no** connectivity transition, producing exactly one server row across repeated flushes; and Stage H's full real-voice PTT pass through the physical microphone — happy path, consecutive recordings, rapid-tap protection, backgrounding mid-recording, a genuine upload-failure-and-retry cycle (API process killed, not just the tunnel), and a genuine polling-timeout-then-eventual-success cycle (workers paused via the correct child PIDs, held past the 60s client bound, then resumed) — finding zero application defects across eleven distinct real captures. `pnpm build`/`typecheck`/`lint`/`format:check` clean; **214 tests** pass (12/12 turbo tasks, mobile 36, unchanged since Stage H made no code changes); `expo export --platform web` succeeds and the export boots in a real browser with zero console errors; `./gradlew assembleDebug` succeeds. Everything was local development only — Checkpoint 5 never touched production.

Real `voice_transcribe` STT gate verification (2026-08-17) — see "Real `voice_transcribe` STT gate — CLOSED" above: a real Groq provider/model/task-route configured in local development through the existing encrypted-credential endpoints, and five real captures driven through the physical Rabbit R1's actual microphone, each exercising R1 mic → `expo-audio` → multipart `POST /transcribe` → persisted temporary audio → `ptt.transcribe` → real Groq `whisper-large-v3-turbo` → transcript and real `avg_logprob` (observed values `-0.1592956` and `-0.21939197`) → `capture.parse` → real `openai/gpt-oss-20b` → committed task or `needs_confirm` with real confidence flags (`typeAmbiguous`, `modelUnclear`). Audio cleanup, no-duplicate-Inbox-row, retry-without-duplication, and confirmation-dispatch enqueue all verified per capture; the full MIME chain was recorded and the feared `.bin` storage outcome did not occur. No application code required changes, so none were made. Not verified and not claimed: real Expo Push delivery (missing Firebase/FCM configuration), the `lowTranscriptionConfidence` routing threshold (never reached by real Groq audio — see above), full Checkpoint 5 lifecycle matrix, or any Phase 3 production deployment.

Phase 3 Checkpoint 4 in-progress verification, including the post-`76b314c` hardening follow-up, is passing for every non-credential gate (2026-08-17) — see the Checkpoint 4 section above: workspace build/typecheck/lint/format clean; 200 tests passing, including direct serialization and duplicate-repair coverage; Expo web export successful; Android debug build successful; physical Rabbit verification of foreground exact delivery, unattended reboot survival, SDK-57 PTT upload and terminal-failure UI, small-screen quick-capture safe-area behavior, and SQLite outbox persistence/replay across a force-stop restart.

Phase 3 Checkpoint 3 verification, run and passing (2026-08-17) — see "Phase 3 Checkpoint 3" above for the full 7-item table: workspace-wide build/typecheck/lint/format clean (after fixing two real, previously-latent bugs the first-ever native build surfaced — a stale `babel-preset-expo` version and Hermes's missing `Intl.supportedValuesOf`), 165 tests passing (unchanged count, no new automated coverage this checkpoint by design), and — the strongest evidence — a full live registration → SecureStore-persistence-across-restart → primary-device-selection → notification-settings cycle run directly on the physical Rabbit R1, plus the KEY_POWER and scroll-wheel hardware spikes, both run live on the same device with a 90-second logcat capture and recorded as conclusively negative rather than assumed either way.

Phase 3 Checkpoint 2 verification, run and passing (2026-08-16) — see "Phase 3 Checkpoint 2" above for the full 4-item table: workspace-wide build/typecheck/lint/format clean (after fixing an arrow-function-as-constructor bug in a test mock and two ESLint issues), 165 tests passing workspace-wide (41 new), the worker booting cleanly with both dead-letter queues correctly created before their primary queues (zero FK errors), and — the strongest evidence — a full live `POST /transcribe` → worker → graceful-degradation cycle run with real curl and a real audio file against a real running server, including live `client_uuid` dedupe. Explicitly **not** verified: the real Groq/STT transcription happy path and real Expo push delivery, since no `voice_transcribe` provider or real device push token exists in this environment yet — both require credentials only the user can supply. All test data deleted afterward; both servers stopped.

Phase 3 Checkpoint 1 verification, run and passing (2026-08-16) — see "Phase 3 Checkpoint 1" above for the full 6-item table: workspace-wide build/typecheck/lint/format clean, migration applied and permission-re-checked against both dev and test Postgres, 129 tests passing workspace-wide (19 new), and — the strongest evidence — a full live pairing/registration/auth/revoke cycle run with real curl against a real running server, including proving the security-boundary claim (revoking a device blocks device routes but leaves the existing Tailscale-only API surface, exercised directly via `/tasks`, completely unaffected). All test data deleted from the dev database afterward.

Phase 2 mobile UI + production deployment verification, run and passing (2026-08-16) — see "Phase 2 mobile UI + production deployment" above for the full 14-item table: local production-mode SPA build verified (`serve -s dist`, direct load/refresh/fresh-tab deep-link all correct), production deployment verified (all 4 containers healthy, port/security audit clean, user's real AI-provider config confirmed intact throughout including through an unintended-but-harmless `postgres` container recreation), and — the strongest evidence — a full lifecycle cycle (create → deep-link view → refresh → archive; and separately inbox → activate → complete → archive) run in a real browser against live production data over real Tailscale HTTPS, each transition confirmed both visually and via a follow-up database check. `pnpm build`/`typecheck`/`lint`/`format:check` all clean workspace-wide afterward (now genuinely including `apps/mobile`, which previously had no `typecheck` script at all). All test data deleted from both dev and production databases afterward; the user's real AI-provider configuration was left untouched in production throughout.

Phase 2 backend implementation verification (2026-08-16) remains valid — see "Phase 2 backend implementation" above: `pnpm build`/`typecheck`/`lint`/`format:check` clean workspace-wide, migration `0003` applied and permission-re-checked against dev Postgres, live curl verification of every new endpoint, and the two-part `expand-due-date-window` regression fix (dropped and archived recurring tasks each independently confirmed to generate zero new occurrences, contrasted against a still-active control that generated 12) — plus, added afterward, 33 new automated tests across `apps/api`/`apps/worker`/`packages/api-client` covering the same ground with real assertions instead of manual curl transcripts.

Phase 1 real-LLM verification, run and passing (2026-08-15) — see "Phase 1 real-LLM verification" above: a real OpenAI key registered, two real bugs found via `pgboss.job` error inspection (not assumed) and fixed, then a task/note/event/unclear capture each re-verified auto-committing (or correctly routing to `needs_confirm`) with correct DST-safe datetime resolution, read back directly from the `tasks`/`events` rows against production Postgres. `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (workspace-wide, 55 tests) all re-confirmed clean after the fixes, before redeploying.

Phase 1 production deployment verification (2026-08-15) remains valid — see "Phase 1 production deployment" above for the full 14-item table, including the DST-crossing and completion-anchored recurrence tests, the duplicate-prevention safety net, credential encryption, and restart behavior, all run against the live `personal-os` deployment over real Tailscale HTTPS. gitleaks confirmed clean on every Phase 1 commit; production `.env` (holding the real `CREDENTIALS_ENCRYPTION_KEY`) confirmed untouched by `rsync` (size/mtime/md5 unchanged) and still `chmod 600` throughout.

Phase 1 Mac-dev verification (2026-08-15) remains valid — see "Phase 1 implementation" above.

Phase 0's last verification (2026-08-15) remains valid — see the Production deployment table above for the full list, including the full OS reboot test (#12) and its post-reboot HTTPS `/health` check from the Mac.

## Phase 0: complete

All exit criteria in `docs/PHASE-0-CHECKLIST.md` are met: the foundation is reproducible (Mac dev + production both verified independently), security boundaries are in place (least-privilege DB roles verified to reject DDL, Postgres unpublished everywhere, gitleaks active, API scoped to localhost/Tailscale-only), and this file documents the evidence. There is no backup or restore requirement (ADR-024). The one remaining housekeeping item — individually ticking `docs/PHASE-0-CHECKLIST.md`'s checkboxes, left untouched throughout this project in favor of this file as the evidence record — does not block Phase 0 completion.

## Phase 1: complete, deployed to production, verified end-to-end with a real LLM

Every Phase 1 deliverable in `docs/ARCHITECTURE.md` is implemented, verified on Mac dev, deployed to production (`personal-os`), and now verified against a real OpenAI key end-to-end — data model, recurrence engine (both anchors), provider-agnostic AI layer, capture/inbox/occurrence/AI-config API routes, the three new worker jobs, and the LLM-parsing happy path itself (task/note/event/unclear classification, DST-safe datetime resolution, confidence routing). No remaining implementation, deployment, or verification gaps.

## Phase 2: complete, deployed to production, verified end-to-end in a real browser

Every Phase 2 deliverable is implemented, verified on Mac dev, deployed to production (`personal-os`), and verified end-to-end against the live deployment in a real browser over real Tailscale HTTPS — quick-add box, inbox triage, task list with full lifecycle (inbox → active → done/dropped, independent archive axis), notes, project view, all backed by full manual CRUD (not just AI capture), soft-delete/archive semantics, TanStack Query live-updating the UI with no manual refresh, and an always-on production web deployment with correct SPA-fallback routing on its UUID-keyed dynamic routes (direct load, refresh, and fresh-tab deep link all confirmed against live production data). Four real bugs were found and fixed by actually running the app rather than assumed safe from source review — see "Phase 2 mobile UI + production deployment" above. No remaining implementation, deployment, or verification gaps. Phase 3 does not begin until the user explicitly approves it separately.

## Next action

Phase 3 is complete. Phase 4 Checkpoints 4.1–4.4 are complete in local development, including isolated physical Rabbit verification with production proven unchanged. Checkpoint 4.5 Stage A (Google OAuth spike) is complete — real native authorization, real token exchange, both scopes, and an immediate refresh grant all verified live, with production untouched. **Stop here for user review.** Checkpoint 4.5 Stage B (schema/worker/sync-engine/UI, per the corrected plan) is safe to begin only after that review; it has not begun. Checkpoint 4.6 (CalDAV) still needs real CalDAV credentials and its own scoping, and 4.7 needs separate production-deployment approval.

Four items are recorded as debt and are product decisions, not defects to fix silently: `remind_at` has no create/update API path (reminder times can only be set by AI capture); `quick-add-fab.tsx` labels Android captures `source: "web"`; revoking a device does not clear its `is_primary_reminder_device` flag; and duplicate-alarm repair is covered by unit tests only, never physically injected.

Optional further confidence-building left over from Phase 1 (not required to consider Phase 1 done, still open): the full ~50-capture pass from `ARCHITECTURE.md`'s Phase 1 description, and registering a second, different provider type to prove the abstraction isn't secretly single-vendor.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
