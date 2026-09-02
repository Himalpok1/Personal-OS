# Phase 4 — Calendar UI, recurrence UI, external sync

> **Historical record — closed. Do not edit.**
> Events backend, month/week/agenda views, the RRULE editor, occurrence detach/cancel, and Google Calendar + CalDAV two-way sync.
>
> Archived from `docs/STATUS.md` by Checkpoint 8.0 (2026-09-02) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`.

Source line ranges in the pre-8.0 `docs/STATUS.md`: 4255–4285, 4286–4324, 4325–4366, 4367–4412, 6089–6177, 6178–6229, 6230–6298, 6299–6352


> **Note on cross-references.** This file was extracted from a single 7,283-line `docs/STATUS.md`. Phrases like *"above"*, *"below"*, *"further down this file"* and *"see the 6.7A section"* refer to positions in that original document, not to this file. Where a target moved to a different phase file, follow the phase number. Nothing was rewritten to repair these — the text is verbatim.

<!-- ORIGINAL RECORD BEGINS — everything below this line is verbatim from docs/STATUS.md -->
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



