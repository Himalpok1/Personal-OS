# Superseded present-state sections of `docs/STATUS.md` — archived 2026-09-16

> **Verbatim archive.** When Phase 9 was closed (ADR-069) and `docs/STATUS.md` was reconciled to the
> Phase 10.1C present state on 2026-09-16, the sections below were **replaced** in that file and are
> preserved here **exactly as they stood at commit `ae864f4`** — nothing reworded, reordered or
> dropped. Each block is followed by its SHA-256 as it appeared in the pre-reconciliation file, whose
> whole-file SHA-256 was `8cefb42978268d8932fd6b0dcb16eedb7210e78af5acb65017b6569d49a78bad`.
>
> The blocks, in the order they appeared: (1) the file header through the "Production state at a
> glance" table; (2) the Phase 7 summary stub that survived the Phase 7 partition; (3) the complete
> "Remaining warnings / technical debt" ledger — 92 entries, 22 of them already struck through as
> closed; (4) "Current objective" through "Next action", including the nine stacked "Last
> verification" entries from Checkpoint 9.0 to 10.1B.
>
> **What changed in the live file, and why:** the ledger in `docs/STATUS.md` now carries **open entries
> only**. The 22 entries that were already struck through here, plus the 13 entries closed at this
> reconciliation (listed in §5 with the evidence for each), no longer appear in the live ledger. The
> Phase 9 checkpoint record itself is in `docs/history/phase-9.md`. The prior archive of the same kind,
> made by Checkpoint 8.0, is `docs/history/superseded-present-state.md`.
>
> Per `AGENTS.md`, files under `docs/history/` are never edited.

---

## 1. File header through "Production state at a glance" (verbatim)

<!-- SHA-256 79b7d2e0afc964bbe96fe20e0a985dddc3d661dabf6f8c3940fb971253bc70b7 -->

# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 10 — OPEN.** Phase 9 (9.0–9.8, accelerated operating model) is complete
through Checkpoint 9.8 (Suggested Focus, 2026-09-15) with no further Phase 9 checkpoint selected;
the owner opened Phase 10 — **Codebase Consolidation & Agent Readiness** — as the next checkpoint
rather than resuming Phase 9's product track. **Checkpoint 10.0 — a behavior-preserving cleanup and
agent-readiness audit — is IMPLEMENTED, DEPLOYED and ACCEPTED (2026-09-15)**: proven-dead code and
four orphaned Expo dependencies removed across mobile/API, zero user-visible behavior change, zero
migration (level stays **20**), worker untouched, new `docs/AGENT-READINESS.md` canonical-boundary
inventory, and a `tags`/`item_tags` schema classification (safe-to-drop, not acted on — an owner
decision). **Checkpoint 10.1 — Canvas LMS integration — is IMPLEMENTED, DEPLOYED and LIVE-VALIDATED
(2026-09-16, ADR-068)**: a read-only, Personal-Access-Token-authenticated sync of the owner's real
Canvas courses/assignments into six new tables (migration `0020`, **production level 21**), a Today
"upcoming assignments" card, and a same-origin-checked "open in Canvas" link — with a confirmed SSRF
gap (`canvas_base_url` had no protection) found by adversarial review and fixed by porting the
project's own CalDAV SSRF guard before deployment. **Checkpoint 10.1B — production deployment and
live validation against the owner's real UTA Canvas account — is COMPLETE (2026-09-16)**: production
migrated 20→21, api/worker/web redeployed, a real connect→sync→idempotent-resync→disconnect
(credential columns verified nulled)→invalid-token-rejected→reconnect cycle run against the owner's
actual account (16 courses, 355 assignments, 19 announcements synced, zero token/secret leakage in
any log across the whole test window), and the Rabbit R1 (versionCode **22**) installed in place and
verified live rendering real assignment data with a working same-origin Canvas deep link — see
*Phase 10 → Checkpoint 10.1B* below for the full record. Phase 9's own checkpoint history (9.0–9.8)
is unchanged and remains below Phase 10 in this file. Phase 8 closed 2026-09-12 (ADR-061; record
`docs/PHASE-8-CLOSEOUT.md`, checkpoint detail `docs/history/phase-8.md`).
**Canonical architecture:** `docs/ARCHITECTURE.md` · **Canonical decisions:** `docs/DECISIONS.md` · **Historical record:** `docs/history/` · **Agent-readiness inventory:** `docs/AGENT-READINESS.md`

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

Verified first-hand at the Checkpoint 9.8 acceptance, 2026-09-15 ~08:15Z (earlier checkpoints'
own acceptance evidence is preserved in their own entries below).

| | |
|---|---|
| Migration level | **21** (`0000`–`0020`); local and production agree |
| Serving commit | api, worker **and web** at **`1e406f7`** (Checkpoint 10.1B, all three recreated 2026-09-16). Provenance is by compose `working_dir` (`personal-os-10.1-release`); the images carry no commit label. Rollback images `personal-os-{api,worker,web}:rollback-pre-10.1`, tagged by resolved digest (every earlier `rollback-pre-*` tag preserved underneath). |
| Containers | all four `RestartCount=0`; api `(healthy)`; postgres `postgres:17-alpine` up since 2026-08-30; `GET /health` → `ok` / `connected` / `stale:false` |
| Rabbit R1 | `com.himal.personalos` **versionCode 22**, built from `1e406f7` (EAS build `23f032f5…`), installed in place with SecureStore credential, primary-device row, exact-alarm appop, `POST_NOTIFICATIONS` and `firstInstallTime` (2026-08-19) all preserved — no re-pair, signature unchanged. Carries the new Canvas "upcoming assignments" Today card verified live with real data; the 9.7 "Ask about today" flow and 9.8 "Suggested Focus" card are unchanged. |
| Canvas (10.1/10.1B) | `packages/canvas-providers` + six new tables, PAT-authenticated, read-only. **Live-validated against the owner's real UTA account 2026-09-16**: connect → sync (16 courses, 355 assignments, 19 announcements, 0 events — the account has none) → idempotent resync (unchanged row counts) → disconnect (credential triple verified NULLed) → invalid-token rejected (`400 canvas_auth_failed`, no provider prose) → reconnect → resync, left **active** and synced. `GET /canvas-assignments/upcoming` verified correct on both api and the physical Rabbit R1; the same-origin "open in Canvas" link verified live (tapped, opened the real `uta.instructure.com` SSO redirect). Zero occurrences of the PAT or any warn/error line in api/worker logs across the whole test window. `canvas.sync-cron` confirmed registered in the worker's startup log (31 queues, up from 29; 11 schedules, up from 10). |
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
| Test baseline | **5,815 tests across 12 packages** (9.8 at `a08311d`; was 5,735 at 9.7, 5,495 at 9.6, 5,062 at 9.5, 4,636 at 9.4, 4,141 at 9.3, 3,853 at 9.1, 3,788 at 9.0, 3,668 at the Phase 8 closeout — see *Last verification*) |
| pg-boss | **29 queues** (`worker.started` count; `pgboss.queue` reads 30 with the internal `__pgboss__send-it`), 10 schedules. DLQs on `capture.parse`, `ptt.transcribe`, `notifications.dispatch`, the three calendar queues and — since 9.0 — **`occurrences.generate-lazy` → `.dead` and `occurrences.expand-window` → `.dead`**, both verified attached in production `pgboss.queue` and both consumed by registered workers. Every retrying queue now has a dead-letter queue. **`occurrences.expand-window` has a phase 2 since 9.4**: idempotent repair of any completion-anchored parent left with no open occurrence, per-parent contained, failures (including an insert collision that leaves no open row, `reason: collision`) counted into the same `OccurrencesJobError` → dead letter → alert. |
| Retention cleanup | `retention.cleanup`, daily `0 4 * * *` UTC: **seven** independent DELETEs — `monitor_checks` 30d · `mail_messages`/`mail_digests` 45d · `mail_sync_runs`/`health_sync_runs` 30d (8.6C, windows unchanged) · **`health_oauth_states` / `mail_oauth_states` on the row's own `expires_at < now`, no window constant (9.0)**. 9.0 acceptance: 9 + 1 expired states deleted exactly as preflighted, rerun deleted 0. **The first scheduled run is 2026-09-13T04:00Z** and had not yet occurred. |
| Alert keys | Occurrence-scoped (ADR-058). 9.5 adds `calendar.push-event.dead:<eventId>:<link updated_at ISO>` (unexercised in production by design). First live emission `health-sync-alert:…:breaker:daily-heart-rate-variability:2026-09-12:…` accepted 2026-09-12T03:00:14Z. 9.0 adds two producers, unexercised in production by design: `occurrences.generate-lazy.dead:<occurrenceId>` and `occurrences.expand-window.dead:<UTC date>` — the latter now also covers a failed phase-2 lazy repair (9.4; body wording "could not be expanded or repaired overnight"). No new producer in 9.4. |
| Search (9.6) | `GET /search?q=&tz=&types=&order=&limit=&include_archived=` over **tasks, notes, events, projects, captures, mail** — NFKC/lowercase tokens, AND across tokens with an `all → all_without_date → any` ladder (`match_mode`), a closed date grammar under the client's `tz` (`date_filter` echoes the window; month without year = current year), integer `score` + `match.reasons` on every result, total order ending in `id`, `order=score` interleaved (default) or `order=type`; per-type `limit` and honest `counts.total`; external events searchable with `origin`, their description matched but never emitted. `GET /search/item?type=&id=` → bounded, id-cited `ItemContext` (body ≤ 1500). One guarded `search.completed` line per request (duration, mode, term count, per-type totals — never the query). Measured: ~1k rows p95 ≤ 28 ms (8 tokens, 2.5k-char bodies); 30k rows 3 tokens p95 58 ms. |
| Content bounds (9.6) | `packages/schema/src/text-bounds.ts`: titles/names 512 · task body 4000 · note body 20 000 · event description 4000 · event location 512 · project goal 2000 · parser reason 1000 / project ref 200 · capture 4000 (unchanged). User-typed → `400 validation_failed` with field path; provider/model/STT text (Google + CalDAV ingest, PTT transcript, parser tool args before validation, calendar display names) → truncated at write, surrogate-safe, counts-only log (`ptt.transcript_truncated`, `capture.parse.tool_args_truncated`, `calendar.sync.text_bounded`). Read schemas, export and the stored parse-result union stay unbounded. DB columns unchanged (`text`, no CHECK). |
| Export / Ask / Monitor CRUD | `GET /export`, `POST /ask` (widened 9.7 — see below), `GET/POST/DELETE /ai/task-routes`, `/monitor/targets` CRUD — all live, perimeter-only |
| Personal intelligence (9.7) | `POST /ask { question, tz?, scope? }`. Without `tz`: byte-shape-identical to 8.6B (task/note sources only, no `citations_present`) — proven against a frozen copy of the pre-9.7 schema, so the versionCode 18 client keeps working. With `tz`: a body-free, id-free `TodayContext` (overdue/due-today/upcoming/events/reminders/recently-completed/open-loops, one `effectiveNow`, wall-clock times in the request zone, honest totals, 12 000-char ceiling, preset-aware drop ladder) is embedded beside the 8.6B lexical `<records>` block (≤ 5 000 chars / ≤ 4 records when Today is present). `scope: "today"` (every preset chip) selects **no** note/task body at all. Every `[n]` in the answer must resolve to a real source or the call is refused (`502 ask_uncited`); sources carry server-authored `section`/`detail` labels (`[1] Overdue · P1 · title`) so a ranking claim is checkable without opening the item. A row consented before the 9.7 release instant is refused `409 ask_consent_outdated` on a `tz` request until re-created under the new disclosure. Nothing is stored; `ask` ships **OFF** (no row in production by default — the owner enables it from Settings). Future-agent tool contract (`READ_TOOL_NAMES` + schemas + budgets) defined in `packages/schema`, no runtime, no writes, no `posops_readonly` role yet (ADR-066). |
| Suggested Focus (9.8) | `POST /focus/suggestion { tz }` — reuses the `ask` route as its consent switch (no new row, no new disclosure surface) and `buildTodayContext(preset: "focus")`, the identical context Ask's own "focus" preset chip already builds. Candidates are the tasks in `overdue`/`due_today`; below `FOCUS_MIN_CANDIDATES` (2) the route refuses (`409 focus_not_enough_candidates`) **before resolving any provider** — no model call below two candidates. The model must cite **exactly one** candidate, validated against the overdue/due-today ref set only (never the full Today ref space); zero or multiple citations, or one outside that set, is `502 focus_uncited`. `apps/api/src/focus/generate.ts` is Guard 1's sixth pinned `generateText` call site, living outside `apps/api/src/intelligence/` so Guard 4 needed no change. Mobile: a deterministic strip renders for free from data Today already fetches; the one AI line fires only on an explicit tap, never on mount (source-regex-guarded, mirroring `today-ask-chip.test.ts`); a `useRef` reentrancy guard in the Today screen (not local state in the reused hookless card) stops a rapid double-tap from firing two requests. Nothing is stored; no new notification channel; fully manual (ADR-067). |
| Recurrence routes (9.4) | `POST /occurrences/:id/snooze` (task-only, ≤ 31 days, `409 occurrence_not_open` / `occurrence_not_task`, `400 validation_failed` path `until`) · `POST /occurrences/:id/reopen` (latest terminal only; withdraws the open successor of a completion-anchored parent; `409 occurrence_not_reopenable` / `task_not_open` / `occurrence_not_task`) · `GET /occurrences?order=asc|desc` · `GET /reminders?horizon_days=` · `due_date` rules validated at `POST/PATCH /tasks` (`400 validation_failed`, token-only `unsupported_frequency` / `embedded_until_count` / `invalid_rrule`) · `POST /tasks/:id/complete` redirects to the earliest **effective** open occurrence (`greatest(occurs_at, snoozed_until)`). All verified live through real routes on 2026-09-14 (smoke rows archived). |
| 404 logging | **Unknown routes never log or echo their query string (9.0).** A `setNotFoundHandler` replaces Fastify's `basic404`; the `req` serializer drops the whole query for `request.is404`, for every `OPTIONS` (served by `@fastify/cors`'s `OPTIONS *`), and for malformed URLs (`frameworkErrors`). Verified live with four sentinel values: 0 occurrences in the api log; body `{"error":"not_found"}`. |

---
---

## 2. Phase 7 summary stub (verbatim)

<!-- SHA-256 c0c7055c84fb460875a2aa447af921f0460b2f1c4e0d6396c2a8a414afdd16c3 -->

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
---

## 3. "Remaining warnings / technical debt" ledger (verbatim, all 92 entries)

<!-- SHA-256 078324b6c696c38128cbbfe58a9d4c5621f17acda468ca889800181bdac61e25 -->

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
  The live build context is `/home/himallinux/personal-os-9.6-release` (api, worker, web); every
  earlier `personal-os-<checkpoint>-release` directory is retained as a rollback source. *(Updated at
  Checkpoint 9.6, 2026-09-15.)*
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
---

## 4. "Current objective" through "Next action" (verbatim)

<!-- SHA-256 68f6459ca91ea8651c9f3838775e5fd3f98fa6f3ea61d4088ce857e5f7126576 -->

## Current objective

**Phase 10 opened for codebase consolidation and agent readiness (owner direction, 2026-09-15).**
Checkpoint 10.0 — a behavior-preserving cleanup pass ahead of Canvas integration and future
Hermes/OpenClaw agent work — is complete (see *Phase 10 → Checkpoint 10.0* above). Checkpoint 10.1
— the Canvas integration that 10.0 was preparing for — was implemented and locally verified in one
session, then **deployed to production and live-validated against the owner's real UTA Canvas
account in Checkpoint 10.1B**, same day (see *Phase 10 → Checkpoint 10.1B* above for the full
deployment/validation record). Production is now at migration level 21, serving api/worker/web from
`1e406f7`, Rabbit R1 versionCode 22.

Personal OS still has a first read-only intelligence surface (9.7) and a second, narrower one (9.8)
built on the 9.6 retrieval layer, exactly as ADR-056 sequenced; that product track is unchanged by
10.0/10.1/10.1B. Whether the next checkpoint resumes Phase 9's product track (widening the
intelligence lane, e.g. the `get_calendar_context`/`get_task_context` tool implementations, or a real
agent loop under its own ADR), a health trend view (E2), a new adoption soak, or further Canvas work
(course/announcement/event UI beyond the Today card, a reconnect-after-disconnect path, the deferred
D1e-style scoping question, etc.) is a product-direction choice for the owner.

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
| **9.6** | Search foundation + content bounds: every text field bounded at write (reject typed, truncate provider/model/STT), six-entity tokenised search with a fallback ladder, date tokens, explainable integer scoring, `getItemContext`, mobile search UX with sections/chips/date chip, bounded inputs. **Deployed (api/worker/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 18) 2026-09-15Z** (ADR-065). |
| **9.4** | Dependable recurring tasks and reminders: repeat presets, one strictly-after wall-clock successor rule for every writer, nightly lazy repair, occurrence snooze (migration `0018`) and reopen, per-occurrence reminders with Done / Snooze 1h / Tomorrow 9am actions, Today never buckets a recurring parent. **Deployed (api/worker/web, level 19) and accepted on the Rabbit R1 (versionCode 15) 2026-09-14** (ADR-063). |
| **9.7** | Personal intelligence, read-only: Cloud Ask widened with a bounded, id-free, wall-clock-only `TodayContext` and three preset questions ("Ask about today"); validated citations (`502 ask_uncited` on an unresolvable ref); nothing stored; no migration; worker untouched; the read-only future-agent tool contract defined (not integrated). **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 19) 2026-09-15** (ADR-066). |
| **9.8** | Suggested Focus: a narrow, cited AI suggestion over today's overdue/due-today tasks, reusing Ask's `TodayContext`/"focus" preset and its `ask` consent switch entirely — zero new intelligence lineage, zero new consent surface. No model call below two candidates (server-enforced); exactly one citation required, validated against the narrower candidate ref set. Deterministic summary renders for free; the AI line is always an explicit tap. Nothing stored; no migration; worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 20) 2026-09-15** (ADR-067). |
| **10.0** | Codebase consolidation & agent readiness: proven-dead mobile/API code removed (Expo starter scaffold, 6 dead query/outbox exports, 3 dormant API error classes, 1 unused health-connection helper, 1 unused test fixture), 4 orphaned Expo dependencies removed (`expo-image`/`expo-status-bar`/`expo-web-browser`/`@babel/plugin-transform-react-jsx`), a duplicate date-parsing implementation consolidated, new `docs/AGENT-READINESS.md` canonical-boundary inventory, `tags`/`item_tags` classified safe-to-drop (not acted on). Zero behavior change, zero migration, worker untouched. **Deployed (api/web, level 20, no migration) and accepted on the Rabbit R1 (versionCode 21) 2026-09-15.** |
| **10.1** | Canvas LMS integration: read-only, Personal-Access-Token-authenticated sync of courses/assignments/announcements/calendar events into six new tables (migration `0020`), a Today "upcoming assignments" card, a same-origin-checked "open in Canvas" link, CalDAV-derived SSRF protection on `canvas_base_url`. **Deployed (api/worker/web, level 21) and live-validated against the owner's real UTA account and the physical Rabbit R1 (versionCode 22) 2026-09-16** (ADR-068). |

**Production is at migration level 21** and serves api, worker and web images built from `1e406f7`. All three Google integrations plus the new Canvas integration are active. Monitoring runs against five
active targets including both Tailscale Serve routes, with full CRUD. A daily retention cron bounds
`monitor_checks`/`mail_messages`/`mail_digests`/`mail_sync_runs`/`health_sync_runs` and sweeps
expired `health_oauth_states`/`mail_oauth_states`. Every retrying pg-boss queue has a dead-letter queue.
Calendar events authored in Personal OS sync outward to the owner's chosen writable calendar; imported
events are read-only. Search covers tasks, notes, events, projects, captures and mail with an explainable score, and every text field is bounded at write. Cloud Ask, when the owner enables it, can answer questions about today's schedule with cited sources, and can now also suggest one task to focus on. Canvas assignments sync hourly and surface on Today. The Rabbit R1 runs `com.himal.personalos` versionCode 22, built from `1e406f7`.

## Current work

**None in progress.** Checkpoint 10.0 closed 2026-09-15. Checkpoint 10.1 (Canvas LMS integration)
implemented, locally verified, deployed to production and live-validated against the owner's real
UTA account 2026-09-16 (Checkpoint 10.1B) — closed.

---

## Last verification

**Checkpoint 10.1B (2026-09-16).** Branch `phase-9-reliability`, HEAD `1e406f7` (the 10.1 record),
pushed to `origin` at the start of deployment. Production migrated 20→21 (`0020_canvas_lms_integration.sql`)
and verified structurally against the live schema (six tables, all FKs and CHECK constraints match
spec); api/worker/web recreated with zero warn/error log lines since redeploy. Live validation ran
entirely through real production routes against the owner's actual UTA Canvas account: connect,
sync (16 courses/355 assignments/19 announcements), idempotent resync (unchanged row counts),
disconnect (credential triple verified NULLed), invalid-token rejection, and reconnect+resync
(identical real counts reproduced) — with a full log audit confirming the PAT never appeared in any
api/worker log line. EAS build `23f032f5…` installed in place on the Rabbit R1 (versionCode 21→22,
signing continuity proven by the in-place install succeeding, `firstInstallTime`/exact-alarm/
notification permissions all preserved); the Canvas Today card verified rendering real data with a
working same-origin "open in Canvas" link, tapped live to a real `uta.instructure.com` SSO redirect.
Full record: *Phase 10 → Checkpoint 10.1B* above.

**Checkpoint 10.1 (2026-09-16).** Branch `phase-9-reliability`, working tree uncommitted at
implementation time (HEAD `9927752`, the 10.0 record — later committed as `d3bfeb2`/`1e406f7` and
deployed in Checkpoint 10.1B above). Seven parallel agent lanes in two dependency rounds (Foundation: db
schema/migration, `packages/canvas-providers`, `packages/schema` wire types; Services: API routes,
worker sync job, `packages/api-client`) plus a sequential Mobile round, each testing only its own
package against an isolated database clone. Integration (this session, as integrator) found and
fixed four gaps (credential columns wrongly `NOT NULL`, an accidental migrate against the shared
test database, a genuinely missing read endpoint the mobile lane correctly refused to route around,
two mechanical ratchet-test acknowledgments), then a fully independent adversarial security-review
agent (no context from the implementation) found one CONFIRMED gap — `canvas_base_url` had no SSRF
protection — fixed by porting the project's own CalDAV SSRF guard, which in turn surfaced and fixed
a latent IPv6-bracket bug in both the new Canvas copy and (flagged as a separate task, not fixed
here) the CalDAV original it was copied from. Verification, serially: `pnpm build --force` 13/13 ·
`pnpm typecheck` 23/23 · `eslint .` clean · `prettier --check .` clean · `gitleaks detect` — the
same class of pre-existing findings in ignored, untracked files, zero new, zero Canvas-related ·
`pnpm test --force` **23/23 tasks, 6,044 tests across 13 packages, zero failing** (canvas-providers
70 new · api 1,423 · mobile 1,390 · schema 519 · core 915 · worker 710 · api-client 195 · db 79
unchanged · health-providers/monitoring/calendar-providers/mail-providers/ai-providers unchanged).
**Migration invariant:** `db:reconcile` clean (0 discrepancies) after a genuine `drizzle-kit
migrate` run against the real local dev database (20 → 21), proving the hand-written SQL matches
the Drizzle schema exactly. **Live browser verification** (seeded data, real API + mobile-web
servers, real device pairing, cleaned up afterward): the Today card renders correctly with the
right ordering/formatting/badges, and the same-origin link guard was proven both positively and
negatively by mutating a seeded row and reloading. Full record: *Phase 10 → Checkpoint 10.1* above.

**Checkpoint 10.0 (2026-09-15).** Branch `phase-9-reliability`, HEAD `7dee309` (from `82fef97`, the
9.8 acceptance record, verified clean and equal to origin). Eight parallel lanes (evidence-gathering
and cleanup combined, strict disjoint file ownership) plus an independent adversarial dependency
cross-check, followed by four parallel adversarial review lenses (reachability, mobile/build
regression via a live `expo export --platform web`, date/time behavior equivalence, privacy/
security guard integrity) — zero blockers, zero regressions found. Integrator gates, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check .` clean
· `git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored, untracked
files, git history clean · `pnpm test` **21/21 tasks, 5,815 tests across 12 packages, zero
failing — identical to the 9.8 baseline**, confirming zero coverage lost to any deletion. **Migration
invariant:** 20 `.sql` / 20 journal entries, unchanged; `packages/db` byte-unchanged outside a
two-line fixture cleanup; production `drizzle.__drizzle_migrations` 20 before and after a proven
no-op `migrate`. Production and physical-device acceptance: recorded in full under *Phase 10 →
Checkpoint 10.0* above.

**Checkpoint 9.8 (2026-09-15).** Branch `phase-9-reliability`, HEAD `a08311d` (from `1441025`, the
9.7 acceptance record, verified clean and equal to origin). Design gate: three parallel read-only
research lanes (existing intelligence/brief architecture, read-models/search reuse surface, AI safety
infra/mobile UI) grounded a 14-section recommendation report in the live codebase rather than the
docs alone; the owner approved D1=Option E, D2/D3/D4/D5, plus the two-candidate-minimum constraint,
in one message with no back-and-forth. Foundation (the frozen `packages/schema/src/focus.ts` +
`packages/api-client/src/focus.ts` contract) written by the integrator first; two parallel
implementation lanes (API, mobile) launched in isolated worktrees — one worktree was stale and its
write tools jailed to it, so its fully-researched design was applied to the main tree by the
integrator directly, each claim re-verified against the live files before writing (exact navigation
helper name, response field names, `AskSourceRow` type-compatibility all confirmed, not assumed); the
other worktree's diff was merged after a byte-for-byte match against the shared contract. Two
adversarial review lenses (API, mobile) found and the integrator fixed 1 major (a `not_enough_
candidates` dead end) and 1 minor (a double-tap race) before deployment; a second minor (an
overstated drop-ladder guarantee in a code comment) was corrected. Integrator gates, serially:
`pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean (root; mobile's own `expo
lint` separately, also clean) · `prettier --check .` clean · `git diff --check` clean · `gitleaks` —
the same 21 pre-existing findings in ignored, untracked files, none tracked · `pnpm test --force`
**21/21 tasks, 5,815 tests across 12 packages, zero failing** (api 1,382 · mobile 1,367 · core 898 ·
worker 698 · schema 477 · health-providers 332 · api-client 171 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25; was 5,735 at 9.7). **Migration
invariant:** 20 `.sql` / 20 journal entries, unchanged; `packages/db` byte-unchanged; production
`drizzle.__drizzle_migrations` 20 before and after a proven no-op `migrate`. Production and
physical-device acceptance: recorded in full under *Phase 9 → Checkpoint 9.8* above.

**Checkpoint 9.7 (2026-09-15).** Branch `phase-9-reliability`, HEAD `9b4db0d` (from `b998646`,
the 9.6 acceptance record, verified clean and equal to origin). Design gate: six parallel read-only
audit lanes (AI architecture, context/data architecture, privacy/security, product design,
future-agent compatibility, adversarial review) produced the D1–D5 recommendations and the
`TodayContext`/privacy/API/tool contracts, returned for owner review and approved without change.
Implementation: three parallel lanes (api-intelligence, api-ask, mobile) on per-lane clones of
`personalos_test`; integration (two schema fixes: `scope` requires `tz`, project open-loop lists
gained `total`); six parallel adversarial review lenses (privacy/egress, citation/hallucination/
prompt, context integrity, mobile/Rabbit UX, API contract/backward compatibility, guard integrity/
token budget/performance) found **1 blocker (ref collision after a ladder drop) and 8 majors**, all
closed in two parallel fixer passes with regression tests; integrator gates on the shared database,
serially: `pnpm build --force` 11/11 · `pnpm typecheck` 21/21 · `eslint .` clean · `prettier --check
.` clean · `git diff --check` clean · `gitleaks` — the same 18 pre-existing findings in ignored,
untracked files, git history clean · `pnpm test --force` **21/21 tasks, 5,735 tests across 12
packages, zero failing** (mobile 1,336 · api 1,333 · core 898 · worker 698 · schema 477 ·
health-providers 332 · api-client 171 · monitoring 151 · calendar-providers 119 · mail-providers 116
· db 79 · ai-providers 25). **Migration invariant:** 20 `.sql` / 20 journal entries, unchanged;
`packages/db` byte-unchanged; production `drizzle.__drizzle_migrations` 20 before and after a proven
no-op `migrate`. Production and physical-device acceptance: recorded in full under *Phase 9 →
Checkpoint 9.7* above.

**Checkpoint 9.6 (2026-09-14/15).** Branch `phase-9-reliability`, HEAD `8f6ffe1` (from `100299d`,
the 9.5 acceptance record, verified clean and equal to origin). Foundation (text bounds, bounded
schemas, search contract v2) by the integrator; five parallel implementation lanes on per-lane
clones of `personalos_test` (`personalos_test_a…f`, `CREATE DATABASE … TEMPLATE`, dropped
afterwards); six adversarial review lenses, three fixer passes, one integrator fixture fix;
integrator gates on the shared database, serially: `pnpm build --force` 11/11 · `pnpm typecheck`
21/21 · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean · `gitleaks` — the
same 18 pre-existing findings in ignored, untracked files, git history clean · `pnpm test --force`
**21/21 tasks, 5,495 tests across 12 packages, zero failing** (mobile 1,250 · api 1,204 · core 898
· worker 698 · schema 461 · health-providers 332 · api-client 162 · monitoring 151 ·
calendar-providers 119 · mail-providers 116 · db 79 · ai-providers 25). **Migration invariant:** 20
`.sql` / 20 journal entries, highest `0019`; production `drizzle.__drizzle_migrations` 20 before and
after a proven no-op `migrate`. Production and physical-device acceptance: recorded in full under
*Phase 9 → Checkpoint 9.6* above.

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

**Checkpoint 10.1 (Canvas LMS integration) is deployed, live-validated, and closed (2026-09-16,
Checkpoint 10.1B).** Production is at migration 21, api/worker/web serve `1e406f7`, Rabbit R1 is at
versionCode 22, and the owner's real Canvas account is connected and syncing hourly. One real,
non-blocking gap was found live during validation and is recorded as Phase 10 candidate follow-up
rather than fixed inline (per the deployment session's own scope boundary): **there is no route to
reconnect a Canvas connection once disconnected** — `POST /canvas-connections` always
`409 canvas_already_connected`s for a base URL that has any row, even a disconnected one, because
the unique index carries no status filter. A dedicated reactivate endpoint, or relaxing the index to
`WHERE status != 'disconnected'`, is the fix. If the owner wants further Canvas work (widening what's
synced, course/announcement/event UI beyond the Today card, the reconnect path above), that's a
follow-up checkpoint, not urgent.

**Checkpoint 10.0 (codebase consolidation & agent readiness) is complete.** It was explicitly not a
product checkpoint — no candidate below was advanced or foreclosed by it. `docs/AGENT-READINESS.md`
now gives whatever comes next (a real agent loop, or further Canvas/Hermes-OpenClaw work) a
canonical-boundary map to build from rather than a fresh audit. Two items from 10.0 are recorded for
an explicit future owner decision, not carried as blocking debt: the `tags`/`item_tags` safe-to-drop
schema classification (a table drop is irreversible under ADR-024 and is the owner's call), and the
deferred dead-code-tooling (`knip`) decision (revisit only if the codebase's Zod-schema-companion/
forward-design-export ratio shifts).

Select the next Phase 9 (or later) checkpoint. 9.7 shipped the
first read-only intelligence lane and
9.8 added a second, narrower one on the same substrate; ADR-056's read-only-before-write-capable
sequencing is now exercised twice. The 9.3 ranked tiers are exhausted except E2 (health trend
context). Candidates now: **widen the Canvas integration** (course/announcement/event UI beyond the
Today card, a full course-browsing screen, device-token auth on the new routes), **widen the
intelligence lane further** (implement
`get_calendar_context`/`get_task_context`, build Option B "what changed" — needs a last-seen
watermark — or Option C weekly review intelligence — needs week-bucketed carry-forward diffing —
both deferred by the 9.8 design gate as genuinely new backend work, not a context-reuse win like
Suggested Focus was), **a real tool-calling agent loop** over `READ_TOOL_NAMES` (needs its own ADR, a
`posops_readonly` role, and a budgeted multi-use grant — `docs/AGENT-READINESS.md` §1–2 is the
starting map), **E2 health trends**, a **new 21-day adoption soak** (a new checkpoint with a new
baseline; the reviewed observer tooling in `scripts/soak/` is reusable), or the **Canvas/
Hermes-OpenClaw integration** this checkpoint was explicitly preparing for. This is a
product-direction choice — pause for the owner.

Open, non-blocking, carried forward from 10.0: `react-native-css-interop`'s babel entrypoint
references `@babel/plugin-transform-react-jsx` by a bare string without declaring it as its own
dependency, currently resolving only via `babel-preset-expo`'s own declared dependency on the same
package (not caused by 10.0, worth an upstream note if a future SDK bump ever breaks the alignment);
`apps/mobile/README.md` still references `npm run reset-project` (stale boilerplate text only).

Open, non-blocking, carried forward from 9.8: the "focus" preset's drop-ladder protection is not
absolute (a rare quote-heavy-title overflow can still trim `overdue`/`due_today` via the pre-existing
9.7 last-resort pass — a route comment now names this, behavior unchanged); `isAbortLikeError` is
duplicated a fourth time (`apps/api/src/focus/generate.ts`); D4 (feedback) has a one-line
extensibility comment but no built affordance; Options B/C (above) remain unbuilt.

Open, non-blocking, carried forward from 9.7: citation validation proves a ref exists, never that a
ranking/priority/time claim is true (mitigated by section/detail labels, not closed); `redactSecrets`
is pattern-based, not DLP; `snoozed_within_horizon.total` is honest only within Today's own capped
7-day lists; the Brief lane still sends UTC instants for the model to convert, unlike the
wall-clock-only `TodayContext`; D1e (device-token auth on `/ai/*` writes) remains deferred; no
`posops_readonly` role exists yet.


Open, non-blocking, carried forward from 9.6: `may` is recognised as a month (rung 2 drops it when
the window is empty); a single CJK character or digit is refused by the 2-char query minimum;
stored text is not NFKC-normalised, so a full-width or ligature form in a row is not found by its
folded query, and Greek final sigma folds differently in Postgres and JS; `title_exact` is
punctuation-sensitive; a date-only query with no hits reports `all_without_date`; `match.fields` can
name `description` on an external event (an existence signal to the same owner); the ISO-date walk
enumerates ≤ 50 rows per type per call (a future lane must budget calls); a local linked event whose
description the owner lengthened past 4000 chars in Google is stored truncated and pushed back
truncated on the next local edit (one-way, no loop); RN `maxLength` cuts a paste silently at the
bound (the counter is the feedback); the CalDAV truncation count is inferred from stored length
(`≥ bound − 1`) rather than exact; `match.reasons` is ~60 % of a large response's payload; the
over-bound-capture outbox row (unreachable now that the composer is bounded) would sit permanently
failed with no UI to clear it; ILIKE over long note bodies is the cost driver at 30× production
scale (index-free mitigation: stop shipping bodies to TypeScript).

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
---

## 5. Ledger entries closed at the 2026-09-16 reconciliation

These entries were **not** struck through in §3 above but are contradicted by a later, recorded
checkpoint. Each closure cites the record it rests on; none is inferred. They are removed from the
live ledger in `docs/STATUS.md` and listed here so the closure itself is auditable.

| Entry (as it opened in §3) | Closed by | Evidence |
|---|---|---|
| Physical Rabbit verification of the Daily Brief card is deferred to 5.6 | Checkpoint 5.7, Gate K | `docs/history/phase-5.md` — the Rabbit reboot proof rendered "the Daily Brief card with a working Show more/Show less clamp" live on production data; 5.7.1 then verified the card again at versionCode 6. |
| Optimistic review-toggle state does not roll back on PATCH failure | Checkpoint 5.6 (decision) | `docs/history/phase-5.md` — 5.6 serialized review saves through a promise chain and **deliberately abandoned per-key rollback** ("a review checkbox that silently unchecks itself is a worse failure than one that says it has not saved yet"). The tradeoff is now a recorded decision, not open debt. |
| `docs/PHASE-0-CHECKLIST.md` section E checkboxes remain unchecked | commit `ae864f4` (2026-09-16) | The checklist now opens with a "Closed artifact" banner stating that unchecked boxes do not represent current work. |
| The ≥7-day refresh-token observation is `blocked_time` AND structurally unreachable in Testing (6.6) | ADR-051 / ADR-051a | The OAuth app was published **In production** on 2026-08-28 (ADR-051), which removes the seven-day Testing-mode expiry the entry describes; the post-deployment milestone was then waived by the owner (ADR-051a). |
| The development Google Health refresh token expires seven days after issue (OAuth app in Testing) | ADR-051 / ADR-051b | Same publishing change; Health additionally moved to its own Google Cloud project (ADR-051b). The seven-day expiry no longer applies. |
| `calendar_connection_calendars.summary` stores the calendar ID, not the display name (8.2) | Checkpoint 9.5 | `docs/history/phase-9.md` — the worker's five-minute calendar cron "refreshes display names — closing the 8.2 'summary stores the id' cosmetic debt"; first tick `updated:5`. |
| Event text is still unbounded at write (8.2) | Checkpoint 9.6, ADR-065 | Content bounds: event title 512 · description 4000 · location 512, rejected for typed input and truncated for provider ingest (`packages/schema/src/text-bounds.ts`). |
| Search does not cover `events` or `projects` (8.3, deliberate) | Checkpoint 9.6, ADR-065 | Search is six-entity: tasks, notes, events, projects, captures, mail. External events are searchable with `origin`. |
| Search issues one request per keystroke (8.3) | Checkpoint 9.6 | Mobile search UX ships a 250 ms debounce. |
| The generate-lazy dead alert's advertised repair has no seed path (9.0 review) | Checkpoint 9.4, ADR-063 | `expand-window` phase 2: "any open completion-anchored parent with terminal history and no open occurrence gets its successor inserted idempotently" nightly — the repair the alert advertises now exists. |
| `POST /occurrences/:id/complete\|skip` with `!app.bossReady` returns 200 and enqueues nothing (9.0 review) | Checkpoints 9.3 / 9.4 | The successor is inserted **in the same transaction** as the completion since 9.3; 9.4 records "`bossReady=false` is not a loss (in-transaction successor since 9.3); `boss.send` failing after the commit is a warn + 200". |
| Health-connection `resolveFreshAccessToken` (API) still writes token columns without re-checking `status` — "already recorded above" | merged | Duplicate of the 6.6-review entry that remains open in the live ledger; the 9.0 observation (a refresh landing 35 s before the hourly pass) is folded into that entry's text. |
| `apps/mobile/README.md` still references `npm run reset-project` (carried in "Next action", not the ledger) | commit `4536a72` (2026-09-16) | The Expo template README was replaced with a project README. |
