# Personal OS — Architecture & Phase Plan

Single-user, self-hosted life dashboard. Notes, reminders, tasks, calendar, projects, finance, health, email summaries, service monitoring, idea dump — with voice capture and an AI layer on top.

*Revision 3 — separate worker process, completion-anchored recurrence generated lazily, primary reminder device explicitly selected.*

---

## Decisions locked

| Decision | Choice |
|---|---|
| Relationship to Jarvis | Standalone rebuild |
| Client | **Expo + Expo Router — one universal codebase for iOS, Android, and web** |
| Dedicated web dashboard | Deferred, not precluded |
| Backend | **TypeScript + Fastify + Drizzle + PostgreSQL** |
| Background work | **Separate `apps/worker` process, same DB and packages** |
| Job queue | pg-boss (Postgres-backed, no Redis) |
| Python services | Later, as sidecars for ML / data-heavy work |
| Code layout | One monorepo, shared Zod schemas |
| Server host | Intel i5 micro PC (not the Pi), native Ubuntu Desktop (hostname `personal-os`) |
| System of record | This app owns everything |
| Events/calendar | Data model in Phase 1, UI and sync in Phase 4 |
| Recurrence | Schema from day one, UI later |
| Voice entry | In-app push-to-talk + Siri Shortcut / Google Assistant |
| STT | Cloud now (Groq), local faster-whisper later |
| Parse confirmation | Auto-file when confident, ask when not |
| Offline | App outbox queues writes — no full offline read sync |
| Network | Tailscale only, VPN On Demand on iOS |
| First module | Capture: notes / reminders / tasks + voice |

---

## Client: one universal Expo codebase

Expo Router targets iOS, Android, and web from a single tree. Practical consequences:

- **Develop on the web target first.** The browser gives instant refresh with no EAS build in the loop. Only native-module work — notifications, audio — requires a dev build. Batch that work rather than interleaving it.
- **Use NativeWind** for styling. It gives you Tailwind semantics that compile to RN styles on native and real CSS on web, which is the only way to keep one stylesheet honest across three platforms.
- **Charts and dense tables are the weak spot.** React Native Web has no CSS grid and no native table primitives. Pick cross-platform-capable libraries from the start — `victory-native` (which shares an API with Victory on web) and `@shopify/flash-list` for long lists — rather than reaching for a web-only chart library you'd have to rip out.

**Keeping the door open for a dedicated web dashboard:** the constraint is simply that no business logic lives in the client. Push everything into shared packages:

```
apps/
  mobile/          # Expo Router — ios, android, web
  api/             # Fastify — HTTP only, enqueues work
  worker/          # background jobs, cron, polling
packages/
  schema/          # Zod schemas + inferred types — single source of truth
  db/              # Drizzle schema, migrations, connection factory
  api-client/      # typed fetch wrapper, framework-agnostic
  core/            # date math, recurrence expansion, parse helpers
```

A future Next.js app imports `schema`, `api-client`, and `core` unchanged and only writes new UI. If you find yourself putting a date calculation inside a React component, it belongs in `core`.

The honest cost of this choice: when the finance and health dashboards arrive in later phases, dense data views in RN Web will be more friction than they'd be in Next.js. The monorepo boundary above is what makes that a contained, deferrable problem rather than a rewrite.

---

## Backend: Fastify

Both Fastify and Hono are good. **Fastify** for this build, because Phases 7 and 8 need scheduled jobs, long-running email polling, queue workers, and structured logging on a persistent box — that ecosystem (pino, BullMQ, graceful shutdown, plugin encapsulation) is more battle-tested for a stateful always-on server. Hono's typed `hc` client is the nicer DX and it's a defensible alternative; the shared Zod schema package gives you end-to-end types either way, so the decision isn't load-bearing.

Drizzle over Prisma: real SQL semantics, no separate engine binary, and migrations you can read. You'll be writing recurrence and date-window queries that ORMs tend to obscure.

---

## Background execution: `apps/worker`

The API handles HTTP and nothing else. Anything slow, scheduled, retried, or externally rate-limited runs in a separate process.

**Why the split matters here specifically:** LLM parse calls take seconds, email polling can hang, and monitoring checks block on timeouts. Sharing a process means one stuck upstream API degrades your quick-add latency. Separate processes also mean you can restart the worker after changing a cron schedule without dropping in-flight HTTP requests, and later move the worker to the HP EliteDesk without touching the API.

**Queue: pg-boss.** Postgres-backed, so it gives you queues, scheduled/cron jobs, retries with backoff, and dead-letter handling with zero additional services. BullMQ is faster but drags in Redis, which is a whole extra thing to back up, secure, and keep alive on a mini PC for a single-user workload you'll never saturate.

**What the worker owns:**

| Job | Trigger |
|---|---|
| Parse capture → entity | Enqueued by `POST /capture` |
| Transcribe PTT audio | Enqueued by `POST /transcribe` |
| Expand recurrence window | Nightly cron + on rule change |
| Generate next completion-anchored occurrence | Enqueued on task completion |
| Dispatch push notifications | Enqueued + cron sweep |
| Gmail polling and mail digests | Cron (Phase 7, ADR-052/053) |
| Service monitoring: probes and incident lifecycle | Cron (Phase 7, ADR-055) |
| Embedding generation | **Deferred — not Phase 8 (ADR-056).** No embeddings layer is approved; revisit only if measured corpus size justifies it |

**Rules for the split:**

- The API **never** performs the work inline, only enqueues. `/capture` writes the inbox row and enqueues, then returns 202 — that's already the design, this makes ownership explicit.
- **Every job must be idempotent.** pg-boss retries on failure and can deliver twice under crash conditions. Key on `client_uuid`, `inbox_id`, or `(parent_id, occurs_at)` and make a second run a no-op.
- Both processes import `packages/db` and connect to the same Postgres. No API-to-worker HTTP calls; the database and queue are the entire interface.
- Separate containers in the same compose file, separate health endpoints, `restart: unless-stopped` on both.
- Worker crashes must be loud. A silently dead worker means captures sit unparsed and reminders never dispatch, and you won't notice for days. Add a heartbeat row it updates each cycle and alert on staleness. **The heartbeat row shipped in Phase 0 and `GET /health` has reported `worker.stale` ever since, but nothing ever alerted on it. ADR-055 assigns that alerting to the *API* process, not to a worker job — a worker-hosted monitor cannot alert on its own death. All other service monitoring stays worker-owned. The residual blind spot, a hung or crash-looping worker behind a healthy API, is documented rather than papered over.**

---

## Core insight: capture is one pipeline with many front doors

Speech-to-text is *not* the center of this system. Siri's "Dictate Text" action and Google Assistant both hand you finished text — Apple and Google do the transcription on-device, for free, faster than you can. Only the in-app push-to-talk button produces audio you need to transcribe yourself.

Every entry path converges on one endpoint:

```
POST /capture
{
  "text": "remind me to call the insurance guy tomorrow at 3",
  "source": "siri" | "ptt" | "web" | "share" | "assistant",
  "client_uuid": "uuid-v4",       // idempotency key
  "captured_at": "2026-08-14T09:12:00-05:00",
  "timezone": "America/Chicago"    // REQUIRED — see gotchas
}
→ 202 Accepted, { inbox_id }
```

### `source` is an entry path, not a platform (frozen, Checkpoint 5.6)

The five members of `source` name **how a capture entered the system**, never
which device or platform it came from. The vocabulary is closed and enforced in
three places that must agree: `CaptureSourceSchema` in `packages/schema`, the
`inbox_items_source` CHECK constraint in `packages/db`, and this document.

| Entry path | `source` | Set by |
|---|---|---|
| In-app Quick Capture sheet — **web and native alike** | `web` | client |
| In-app push-to-talk | `ptt` | **server** (`POST /transcribe` hardcodes it; never client-supplied) |
| Siri Shortcut | `siri` | external caller |
| Google Assistant | `assistant` | external caller |
| OS share sheet | `share` | external caller |

So a Quick Capture made on the Rabbit R1 is correctly `web`: it came through
the in-app quick-add box, which is one entry path regardless of the platform
rendering it. There is deliberately **no** `app`/`mobile`/`android` member —
adding one would mean altering the CHECK constraint, i.e. a migration, and it
would buy nothing today: the only code anywhere that branches on `source` is
`isLowTranscriptionConfidence`, which tests for `ptt`.

This was previously recorded as debt ("Android captures are labelled
`source: "web"`"). It is not a defect; the label was being read as a platform
tag. If a future need genuinely requires distinguishing platforms, that is a
new field or a new enum member with its own migration — not a reinterpretation
of these five.

**Write the raw text to Postgres before doing anything else.** Return 202 immediately. Parse asynchronously. If the LLM is down, rate-limited, or returns nonsense, the thought is still captured — it just sits in the inbox unfiled. Never lose a capture because an upstream API had a bad minute.

This pattern generalizes to every future module. A transaction, a project note, an idea, a health observation all enter the same door and differ only in what the parser emits.

---

## Data model (Phase 1 scope)

### Capture

```sql
inbox_items (
  id              uuid pk,
  client_uuid     uuid unique,        -- dedupes offline retries
  raw_text        text not null,
  source          text not null,
  audio_path      text,               -- only for PTT captures
  captured_at     timestamptz not null,
  timezone        text not null,
  status          text not null,      -- pending|parsed|needs_confirm|confirmed|failed
  parse_result    jsonb,
  confidence      real,               -- temporarily PTT avg_logprob; see below
  entity_type     text,               -- note|task|event
  entity_id       uuid,
  created_at      timestamptz default now()
)
```

`inbox_items.confidence` is temporarily overloaded during the PTT handoff.
After transcription and before capture parsing, it carries the transcription
provider's mean `avg_logprob` so a weak transcript can trigger the existing
confirmation path. Once `capture.parse` consumes that signal, the existing
parse/confirmation semantics (`status`, `parse_result`, and their confidence
routing) take over; consumers must not treat the column as a durable,
general-purpose transcription-confidence field. If a later feature already
justifies another schema migration, clean this up by adding a dedicated
transcription-confidence field. Do not add a migration solely for that split.

### Tasks

```sql
tasks (
  id                    uuid pk,
  title                 text not null,
  body                  text,
  status                text not null,   -- inbox|active|done|dropped
  due_at                timestamptz,
  due_local             timestamp,       -- wall clock, for recurring
  remind_at             timestamptz,
  timezone              text not null,
  priority              smallint,
  project_id            uuid,
  completed_at          timestamptz,
  -- recurrence
  rrule                 text,            -- RFC 5545
  recurrence_timezone   text,
  recurrence_anchor     text,            -- 'due_date' | 'completion_date'
  recurrence_until      timestamptz,
  recurrence_count      integer,
  recurrence_exdates    date[],
  parent_task_id        uuid,            -- detached overridden instance
  original_due_at       timestamptz,
  created_at, updated_at
)
```

**A reminder is just a task with `remind_at` set.** Don't build a separate reminders table — it's the same object with a notification attached, and splitting them means every query becomes a union.

### Events

Modeled now because the parser already emits `create_event`, and because adding these columns later to a populated table is a worse migration than adding them empty.

```sql
events (
  id                    uuid pk,
  title                 text not null,
  description           text,
  location              text,
  starts_at             timestamptz,
  ends_at               timestamptz,
  start_local           timestamp,       -- wall clock, authoritative for recurring
  end_local             timestamp,
  timezone              text not null,
  all_day               boolean default false,
  start_date            date,            -- all-day events use dates, NOT timestamps
  end_date              date,
  -- recurrence (same shape as tasks)
  rrule                 text,
  recurrence_timezone   text,
  recurrence_until      timestamptz,
  recurrence_count      integer,
  recurrence_exdates    date[],
  parent_event_id       uuid,
  original_start_at     timestamptz,
  -- external sync, unused until Phase 4
  external_id           text,
  external_source       text,            -- google|caldav|ics
  external_etag         text,
  external_synced_at    timestamptz,
  project_id            uuid,
  created_at, updated_at
)
```

### Notes

Missing from earlier revisions of this document despite `create_note` being one of the four parser tools and `inbox_items.entity_type` allowing `'note'` since Phase 1 — added 2026-08-15 as the obvious missing piece, not a new decision.

```sql
notes (
  id              uuid pk,
  title           text not null,
  body            text not null,
  project_id      uuid,
  created_at, updated_at
)
```

### Event ownership and outbound sync (Checkpoint 9.5, ADR-064)

`events.origin` (`local` | `external`, CHECKed, **DB default `external`**) makes ownership explicit.

- **`external`** — originated in a connected calendar and synced inward. **Read-only** through
  Personal OS: `PATCH /events/:id`, `/archive`, `/detach`, `/cancel-occurrence` and `/link-calendar`
  answer `409 event_not_owned`, and the client renders a read-only card. Inbound sync is the only
  writer of these rows. Personal OS never writes to a calendar it did not author an event into.
- **`local`** — authored in Personal OS (`POST /events`, capture `create_event`). Editable and
  cancellable here. It may be linked at creation to ONE **write-eligible** calendar
  (`sync_enabled`, connection `active`, and Google `access_role in (owner, writer)` — a NULL role is
  *unknown*, never writable; CalDAV carries no role and the PUT is the check). The calendar is
  create-only in 9.5: no move, no unlink.

The default is `external` on purpose: every pre-9.5 row was sync-ingested, a backfill `UPDATE` is
not reconcilable, and an insert path that forgets the column fails **safe** (read-only) rather than
editable. Every local writer sets `local` explicitly and a test pins each one.

**Outbound writes are durable intent, never request-scoped.** `POST /events` with a `calendar`
inserts the event, its occurrence window and an `event_external_links` row (`pending_push`) in one
transaction; every later mutation of a linked local event flips the link to `pending_push` in the
same transaction; the push job is enqueued only after commit, and a lost enqueue is re-driven by
the worker's five-minute calendar cron from the `pending_push` rows themselves. `client_uuid` on
`POST /events` makes a retried create return the existing row (200) instead of a second event.

**Provider idempotency.** The Google event id is derived from the link id (`link.id` without
dashes — base32hex-legal) and sent on insert; a retry after a lost response gets `409 duplicate`
and falls through to an update, so exactly one remote event exists. The CalDAV UID and resource
href are derived the same way and a `412` on `If-None-Match: *` is "already exists", not a
conflict. Inbound sync **adopts** a pending link whose derived id matches an incoming remote event
rather than importing it as a read-only twin. The job's final write is race-safe: ids/etag are
stored unconditionally, but `sync_status` flips to `synced` only if the link's `updated_at` still
equals the value read at job start — a mid-push edit leaves the row `pending_push` for its own job.

**Recurrence crosses the boundary through one conversion layer**: `localRecurrenceToGoogle` /
`googleRecurrenceToLocal` in `packages/calendar-providers/src/translate.ts` (RRULE with
UNTIL/COUNT appended from their columns, EXDATE lines, all-day as pure dates), round-trip-tested.
Series editing is whole-series only: "this event only" on a *linked* local series is refused
(`409 linked_series_detach_unsupported`) because Google does not create an exception from
`events.insert`; cancelling one occurrence (an EXDATE on the master) is supported.

**Failure semantics.** Transient provider failures retry through pg-boss and dead-letter to an
occurrence-scoped alert (`calendar.push-event.dead:<eventId>:<link updated_at>`); permanent
failures (`missing_scope`, `invalid_request`, `not_found`) mark the link `error` without retry and
surface on the event screen; an inactive connection leaves the link `pending_push` so reconnecting
resumes it. A remote deletion of a local event archives it locally (as before). A local archive of
a linked event pushes a remote delete and removes the link only after the provider acknowledges.

### Snooze is an occurrence property, never a rule edit (Checkpoint 9.4)

`occurrences.snoozed_until` defers ONE instance of a recurring task. `occurs_at` stays the row's identity (the nightly window job re-inserts on it), the parent's `due_at` stays the series anchor, and the rule is untouched. The effective instant every read model buckets on is `greatest(occurs_at, snoozed_until)` — a snooze may only defer; snoozing the reminder to an instant before the due instant moves the reminder, never the due. A one-off task snoozes by moving its own `due_at`/`remind_at`, as before.

### Occurrences

```sql
occurrences (
  id              uuid pk,
  parent_type     text not null,        -- task|event
  parent_id       uuid not null,
  occurs_at       timestamptz not null,
  occurs_local    timestamp not null,
  status          text not null,        -- scheduled|done|skipped
  lazy_generated  boolean default false, -- true = created on completion, not pre-expanded
  completed_at    timestamptz,
  unique (parent_type, parent_id, occurs_at)
)

-- completion-anchored tasks may have at most one open occurrence at a time
create unique index one_open_occurrence_per_lazy_parent
  on occurrences (parent_type, parent_id)
  where status = 'scheduled' and lazy_generated;
```

`lazy_generated` is a boolean column on `occurrences` marking rows created by completion rather than by window expansion. It keeps the two generation strategies from stepping on each other.

### Devices, projects, tags

```sql
projects (id, name, status, color, created_at)
tags (id, name)
item_tags (item_type, item_id, tag_id)

devices (
  id                          uuid pk,
  name                        text not null,
  platform                    text not null,     -- ios|android|web
  push_token                  text,
  token_hash                  text not null,     -- per-device bearer token
  is_primary_reminder_device  boolean default false,
  reminder_priority           smallint,          -- ordering for future failover; unused in MVP
  notifications_enabled       boolean default true,
  notify_reminders            boolean default false,
  notify_confirmations        boolean default true,
  notify_digests              boolean default false,
  notify_alerts               boolean default true,
  quiet_hours_start           time,
  quiet_hours_end             time,
  quiet_hours_timezone        text,
  last_seen_at                timestamptz,       -- diagnostic only, NOT a heartbeat
  revoked_at                  timestamptz,
  created_at                  timestamptz default now()
)

device_pairing_codes (
  id            uuid pk,
  code_hash     text not null unique,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz default now()
)

notification_dispatch_log (
  dedupe_key      text pk,
  status          text not null,       -- pending|accepted|failed
  attempted_at    timestamptz not null,
  accepted_at     timestamptz,
  last_error      text,
  expo_ticket_id  text
)

-- exactly one primary device, enforced by the database
create unique index one_primary_device
  on devices (is_primary_reminder_device)
  where is_primary_reminder_device;
```

---

## Recurrence design

Use **RFC 5545 RRULE strings**, expanded with the `rrule` npm package. Don't invent a recurrence DSL — you'll need RFC 5545 anyway the moment Phase 4 touches CalDAV or Google Calendar.

Three rules that prevent most recurrence bugs:

1. **The wall-clock time is the invariant, not the instant.** A 7am daily reminder must stay at 7am across a DST transition. Store `recurrence_timezone` and expand in that zone, then resolve each occurrence to a `timestamptz`. Expanding from a stored UTC instant drifts an hour twice a year.
2. **Never materialize infinite rows.** Expand a rolling 90-day window into `occurrences`. Query and schedule notifications against that table. Regenerate the window when the rule changes.
3. **Overrides are detached rows.** Moving one instance of a weekly meeting creates a new row with `parent_event_id` and `original_start_at` set, plus the original date pushed into `recurrence_exdates`.

### `recurrence_anchor` — two different generation strategies

"Water the plants every 3 days" means three days after you *last did it* (`completion_date`). "Rent due on the 1st" means the 1st regardless of when you paid (`due_date`). Most task apps pick one and quietly frustrate you forever.

These are not a display preference. They require fundamentally different generation, because a completion-anchored rule's future dates **do not exist yet** — they're a function of a timestamp that hasn't happened.

**`due_date` anchored → pre-expanded.**
The nightly window job expands these 90 days forward into `occurrences`. Deterministic, known in advance, safe to schedule notifications against. Full RRULE semantics apply, including `BYDAY` and `BYMONTHDAY`.

**`completion_date` anchored → generated lazily, one at a time.**
Exactly one open occurrence exists. When it's completed or skipped, the worker computes the next from the completion timestamp and inserts a single new row with `lazy_generated = true`. **The window expansion job must filter these out entirely** — `where recurrence_anchor = 'due_date'` — or you'll generate a phantom schedule based on a completion time you don't have.

Consequences worth accepting deliberately:

- **A never-completed task never spawns a successor.** That's correct. You get one open "water the plants," not fourteen overdue ones staring at you after a trip.
- **Only `FREQ` and `INTERVAL` are meaningful.** `BYDAY=MO,WE,FR` is incoherent relative to an arbitrary completion instant. Validate at write time and reject `BY*` parts on completion-anchored rules rather than silently ignoring them.
- **Skipping anchors from the skip timestamp**, same as completion. Marking "skip" on a plant-watering means the next one is three days from now, not three days from a due date you already blew past.
- **The successor keeps the previous occurrence's wall-clock time, and lands strictly after it (Checkpoint 9.4, ADR-063).** The next occurrence is `local date of the completion + INTERVAL`, at the completed row's own time-of-day in `recurrence_timezone`, by plain calendar arithmetic (months clamped to their length) — never at the instant the owner happened to tap Done. Because a completion INTERVAL days early would otherwise land on the completed row's own instant, the computed instant must be strictly after it; every writer (API complete/skip, worker re-check, nightly repair, rule edit, task reopen) computes it through one function, and a collision that leaves no open occurrence is a loud failure, never a silent "successor exists".
- **Editing the rule** regenerates only the single open occurrence; there's no window to rebuild.

The parser can infer the anchor from phrasing — "every 3 days after I…", "every N days" on a chore-shaped verb — and should default to `due_date` when ambiguous, since that's the reversible mistake.

---

## Today & agenda read models (frozen semantics, ADR-038/039/041)

These are product semantics, not implementation details. Every aggregate read model (`/today`, `/agenda`, the Daily Brief collector) MUST follow them:

1. **One `effectiveNow` per build.** Capture `now` once at the start of a request/read-model build; all categorization uses that single instant so sections cannot disagree mid-execution.
2. **Overdue is instant comparison, not end-of-day.** For a task with `due_at`: `overdue ⟺ due_at < effectiveNow`. For an open scheduled occurrence of a recurring item: `overdue ⟺ occurs_at < effectiveNow`. Do not use end-of-current-local-day as the overdue threshold.
3. **Due-today is a local calendar-day window.** `due_today ⟺ startOfLocalDay(tz) ≤ due_at < startOfNextLocalDay(tz)` (occurrences likewise on `occurs_at`), where `tz` is the timezone **requested by the client** for this Today view. DST-safe wall-clock math comes from `packages/core`.
4. **A task's own timezone affects display, never bucketing.** A task created in `America/Chicago` viewed from a `Pacific/Auckland` Today request is bucketed by its instant against Auckland's local day; its stored timezone formats timestamps only.
5. **Recurring dedupe — one representation per actionable instance.** Where a materialized actionable occurrence exists, the occurrence IS the actionable item (it carries id/completion target); the parent recurring task must NOT also appear as a separate row for that same due instance. The parent supplies metadata (title/project/recurrence context) to that occurrence's rendering. Skipped and completed occurrences are excluded. Upcoming lists exclude anything already shown as overdue or due-today.
6. **Priority convention: lower value = higher priority** (P1-style). The column is an unconstrained nullable smallint historically written only by AI capture; nothing else may assume ordering semantics without this rule.
7. **Project next action (computed, never stored):** the single active task of the project ordered by `due_at ASC NULLS LAST`, then `priority ASC NULLS LAST`, then `created_at DESC NULLS LAST`, then `id ASC`. A project whose active tasks have none of these set surfaces "no next action" honestly.
8. **Stalled project (computed, never stored):** `status='active'`, ≥1 open task, no child activity signal (task completion, note write, occurrence completion) within 14 days AND no linked event starting within the next 14 days.
9. **Brief identity:** one Daily Brief per `(brief_date, timezone)` — unique constraint and upsert/get identity alike.

---

## Content bounds and search (Checkpoint 9.6, ADR-065)

**Every user-authored or externally-authored text field is bounded at write.** The constants are in
`packages/schema/src/text-bounds.ts` and every client bounds against the same numbers: titles and
project names 512, task bodies 4000, note bodies 20 000, event descriptions 4000, event locations
512, project goals 2000, captures 4000 (unchanged). Two behaviours, never mixed:

- **User-typed text over a bound is rejected** (`400 validation_failed`, field path, "<field> must be
  at most N characters"). The server never cuts text a person typed.
- **Provider-, model- and STT-authored text is truncated at write**, surrogate-safely, with a
  counts-only log line: calendar sync ingest (Google and CalDAV), the PTT transcript, the parser's
  tool-call arguments (bounded before validation so an over-long model title becomes a truncated
  entity, not a failed capture), and calendar display names.

The bounds live on create/update/tool schemas only. Read schemas, the export and the stored
parse-result union stay unbounded so a legacy row always reads back. The DB columns remain `text`
with no CHECK — the contract is named, not severed by a varchar (the ADR-054 mail discipline).

**Search is lexical, query-time, index-free (ADR-056/059) and now tokenised, six-entity and
explainable.** `GET /search?q=&tz=&types=&order=&limit=&include_archived=`:

- Entities: tasks, notes, **events**, **projects**, captures, mail metadata. An event result carries
  `origin` (ADR-064); an external event's description is matched but never emitted — its preview
  is the location only. Nothing else joins without its own privacy argument.
- Tokens: NFKC + lowercase, punctuation split, ≥ 2 chars unless numeric/CJK, ≤ 8 (overflow echoed
  as `dropped`). Candidacy is AND across tokens (each an OR of `ILIKE … ESCAPE` over the entity's
  columns) with a fallback ladder echoed as `match_mode`: `all` → `all_without_date` → `any`.
- Dates: with the client's `tz`, one closed grammar (today/tomorrow/yesterday, ISO date or month,
  month name ± year, bare year) becomes an inclusive local-date window that matches `due_at`,
  `starts_at`/`start_date`, occurrences (all-day series by `occurs_local::date`, never an instant —
  ADR-045), `target_date`, `captured_at`, `internal_date` — or the same word as text. A month with
  no year is the current year in `tz`, and the applied window is echoed as `date_filter`.
- Ranking: integer points over a closed reason vocabulary, exposed on every result (`score`,
  `match.reasons`, `match.fields`). Exact title beats everything; match strength beats recency;
  recency reorders only equal-strength rows; captures then mail rank last at equal strength;
  done/archived/completed/external carry penalties. Total order ends in `id`, so identical
  requests are byte-identical. SQL selects up to 100 candidates per type with an honest
  `count(*) over()` total; TypeScript scores them. The client partitions ("Top matches", then per
  type) and never re-sorts.
- Privacy: one guarded `search.completed` log line per request carrying duration, mode, term
  count and per-type totals — never the query, tokens or any text. `q` is name-scrubbed from the
  access log. Nothing leaves the machine.
- Future lanes: `searchPersonalItems` and `getItemContext` in `apps/api/src/search/service.ts` are
  the bounded, id-cited interfaces a later READ-ONLY lane may call. No agent runtime exists and
  Cloud Ask is unchanged.

## Personal intelligence — read-only (Checkpoints 9.7–9.8, ADR-066/067)

Personal OS explains, summarizes and prioritizes the owner's own information without modifying it.
The shape is fixed and is NOT an agent:

```
Personal OS database  →  Bounded Context Builder  →  ONE model call  →  cited insight
                          (buildTodayContext)         (ask/generate.ts)   (validated [n] refs)
```

The model never touches the database, search, the filesystem or an integration. It receives exactly
two fenced blocks in the user role — `<today>` (the `TodayContext`) and, for free-text questions,
`<records>` (the 8.6B lexical selection) — and returns text.

- **`TodayContext`** (`packages/schema/src/intelligence-tools.ts`) is a closed `.strict()` allowlist
  built only from existing read models with one `effectiveNow`: overdue, due today, upcoming (7 d),
  events today, reminders (7 d), recently completed (7 d), projects touched, open loops (unfiled
  captures, stalled projects, projects with no next action, snoozed-within-horizon, review status).
  Items carry an ordinal `ref`, never an id; every time is a wall-clock string in the request `tz`;
  bodies, descriptions, `rrule`, `goal`, review prose, sync links, health, mail and monitor data are
  inexpressible. Both project lists carry an honest `total` alongside their items. Ceiling 12 000
  chars on the exact string sent — a contract, not a preference: a preset-aware drop ladder empties
  unprotected sections first and, if JSON escaping still leaves it over, trims protected ones too.
  Every dropped section keeps its honest `total`.
- **`POST /ask { question, tz?, scope? }`.** Without `tz` it is the 8.6B request and response,
  byte-shape-identical (the versionCode 18 client). `scope: "today"` — every preset chip — selects
  no note/task body at all; `scope: "both"` adds ≤ 4 lexically matched records (≤ 5 000 chars),
  whose refs continue after the HIGHEST Today ref assigned (never the surviving citation count — the
  drop ladder leaves gaps). `scope` without `tz` is `400 validation_failed`. The concatenated USER
  prompt is ≤ 18 000 chars (12 000 + 5 000 + 512 + 238 framing = 17 750; the static system prompt is
  not counted), 800 output tokens, one call, no retries, nothing stored.
- **Citations.** `sources[{ref, type, id, title, section, detail, occurs_at?}]` are zipped server-side
  after the call. Every `[n]` in the answer must resolve (`502 ask_uncited` otherwise); an answer with
  none is returned with `citations_present: false`; a malformed numeric group (`[0]`, `[3-1]`,
  `[1.5]`) counts as unresolved rather than vanishing. Section/detail labels are server-authored so a
  ranking claim can be checked on the row (`[1] Overdue · P1 · title` — the detail never repeats the
  section word). Ranking claims themselves are not machine-verified.
- **Consent.** The `ask` route row is the switch; its disclosure names every class that leaves. A row
  created before `ASK_TODAY_CONSENT_FROM` is refused `409 ask_consent_outdated` on a `tz` request until
  it is re-created under the new disclosure.
- **Future agent compatibility (designed, not built).** `READ_TOOL_NAMES` and their schemas define the
  read-only tools a later agent ADR would bind; `buildTodayContext(ReadContext)` is already the
  `get_today_context` implementation. No tool runtime, no write tool, no `posops_app` for any agent;
  Guard 4 in `ai-egress-guard.test.ts` enforces the no-write, no-`ai`-import rule under
  `apps/api/src/intelligence/`.

### Suggested Focus (Checkpoint 9.8, ADR-067)

A second, narrower lane on the same `TodayContext` substrate — not a second lineage. Where Ask is
open Q&A, Suggested Focus is a single fixed action: pick one task and say why.

```
buildTodayContext(preset: "focus")  →  ONE model call, ≤1 citation  →  {suggestion, source}
(the SAME context Ask's own "focus"    (apps/api/src/focus/generate.ts,
 preset chip already builds)            outside apps/api/src/intelligence/ —
                                         Guard 4 still applies unmodified)
```

- **`POST /focus/suggestion { tz }`.** Reuses the `ask` `ai_task_routes` row as its consent switch
  (no new row, no new disclosure surface — one sentence appended to the existing one) and
  `resolveModelForTask(db, "ask", …)` as its model resolver. Candidates are exactly the tasks in the
  built context's `overdue`/`due_today` sections. Below `FOCUS_MIN_CANDIDATES` (2), the route refuses
  (`409 focus_not_enough_candidates`) **before resolving any provider** — "avoid unnecessary AI calls"
  is a server-enforced precondition, not a prompt instruction.
- **A narrower citation contract than Ask's.** The model must cite **exactly one** ref, validated
  against the overdue/due-today ref set only — never the full `TodayContext` ref space, so a citation
  of an `upcoming` or `reminder` item is exactly as invalid as an invented one (`502 focus_uncited`).
- **Client-side gating, never a disabled state.** Below the candidate threshold, or when Cloud Ask is
  off, the affordance renders nothing at all — not a greyed-out button — mirroring the "Ask about
  today" chip's own `askEnabled ? (...) : null` idiom. The model call fires only on an explicit tap,
  never on mount, proven the same way 9.7's preset chips are (a source-regex guard,
  `today-suggested-focus.test.ts`, following `today-ask-chip.test.ts`'s precedent).
- **Never stored, never scheduled, no new notification channel.** Fully manual, matching D5's "gentle
  suggestion under a fully manual trigger" resolution — the suggestion's tone is a nudge, its
  mechanism is always an explicit tap.
- **A second call site in Guard 1's closed set.** `apps/api/src/focus/generate.ts` is added as the
  sixth pinned `generateText` caller, living outside `apps/api/src/intelligence/` exactly as
  `apps/api/src/ask/generate.ts` does, so Guard 4's per-directory import/write denylist needed no
  change to accommodate a second lane.

## The parse pipeline

1. `POST /capture` → insert `inbox_items` row, status `pending`, return 202.
2. Worker picks it up. LLM call with **strict tool-calling**, not freeform JSON:
   - `create_task(title, due_at?, remind_at?, priority?, project?, rrule?)`
   - `create_note(title, body, project?)`
   - `create_event(title, start, end, location?, rrule?)`
   - `unclear(reason)`
3. Compute confidence. Commit if high, notify for confirmation if low.
4. On confirm, log the correction — that's your future few-shot corpus.

### Computing "am I sure?"

Don't ask the model to self-report confidence; they're poorly calibrated and it'll say 0.9 to everything. Use signals:

- **Ambiguous type** — did the model waver between task and note? Sample twice at temperature 0.3; disagreement is your strongest signal.
- **Unresolved date phrase** — text contains "next Thursday" but no `due_at` came back. Hard flag.
- **Recurrence inferred at all** — always confirm the first time a rule is created. A wrong RRULE generates wrong occurrences indefinitely.
- **Empty or degenerate title** — under three characters, or just a verb.
- **Unknown project reference** — a proper noun matching no existing project or tag.
- **Low transcription confidence** — Groq returns segment logprobs on verbose output. A mumbled capture should always confirm.

Any hard flag, or two soft flags, routes to `needs_confirm` and fires a confirmation push. Start conservative — it's far less annoying to dismiss an extra prompt than to discover three weeks later that "call mom Sunday" quietly became a note with no reminder.

---

## Voice: the two paths

**Path A — Siri Shortcut / Google Assistant (build first, nearly free).**
Shortcuts app → Dictate Text → Get Contents of URL → POST to your Tailscale endpoint. Zero app code. Assign a phrase like "Hey Siri, capture." Works from a locked screen, CarPlay, or watch.

**Path B — in-app push-to-talk.**
`expo-audio` records → upload to `POST /transcribe` → server proxies to STT → text → same `/capture` pipeline.

Put an **OpenAI-compatible `/v1/audio/transcriptions` shape** in front of the STT from day one. Groq's `whisper-large-v3-turbo` runs about a second end-to-end and costs pennies. faster-whisper's server speaks that exact API, so migrating to the i5 later is an env var change, not a rewrite.

---

## Offline: outbox pattern only

```
-- expo-sqlite, on device
outbox (client_uuid, endpoint, payload, created_at, attempts, last_error,
        next_attempt_at, permanent)
```

Capture/quick-add writes go to the outbox first, before the first HTTP attempt. A flush loop drains pending rows on startup, foregrounding, connectivity changes, and a bounded interval. It does not treat public-internet reachability as authoritative because the API is deliberately private over Tailscale. Transient failures use persisted exponential backoff; permanent 4xx failures remain visible for attention. The server dedupes on `client_uuid`, so a replay after an ambiguous response or app restart returns the existing Inbox row instead of creating a duplicate.

Reads stay online-only for now. That's the deliberate scope cut — full bidirectional sync is genuinely hard and you don't need it to capture a thought on a bad cell connection.

---

## Notifications

Since your app owns reminders, notification reliability *is* the product.

**Routing rules:**

| Category | Delivery | Targets |
|---|---|---|
| Scheduled reminders | Local notification, scheduled on-device | Primary reminder device only |
| Capture confirmations | Expo Push | Devices with `notify_confirmations` |
| Service-down alerts | Expo Push | Devices with `notify_alerts` |
| Daily digests | Expo Push | Devices with `notify_digests` |

**Only the primary device schedules reminder notifications locally.** Every device syncs task data, but non-primary devices skip the `expo-notifications` scheduling step entirely. That's what prevents a reminder firing simultaneously on your phone, tablet, and an open browser tab.

**The primary device is chosen by you, explicitly, in settings.** No automatic promotion in the MVP.

The reason is that `last_seen_at` is not a heartbeat and can't be made into one. iOS and Android aggressively suspend backgrounded apps, background fetch is throttled on opaque schedules, and a phone that hasn't checked in for 30 hours is usually just a phone you didn't open. Auto-promotion built on that signal would silently move your reminders to a tablet in a drawer — a worse and much more confusing failure than the one it's trying to prevent.

What this costs: if your primary phone dies or is replaced, reminders stop until you switch primary manually. That's a narrower risk than it sounds, because reminder notifications are scheduled *locally on the device* — they fire with no network, no server, and no Tailscale. The only real failure mode is a phone that's off or gone, and in that case you already know something is wrong.

Make switching primary a one-tap action in settings so recovery takes seconds. `reminder_priority` sits unused in the schema for whenever you want to add a real failover chain — backed by an actual heartbeat, such as a silent push the device must acknowledge.

**Dismissal sync:** acting on an occurrence marks it `done` server-side, and the next sync cancels any pending local notification for it on other devices.

Local scheduling on the primary device is the important half — a reminder for a 6am flight must not depend on the i5 being awake.

On Android, Personal OS uses `expo-notifications`' built-in boot receiver and
stored-notification rescheduling. This mechanism was verified on the physical
Rabbit R1: after scheduling a reminder and rebooting, the same exact alarm was
restored after `BOOT_COMPLETED` and fired without opening the app. The planned
custom Headless JS receiver is therefore not part of the shipped design.

Reminders are scheduled only on the device the user has explicitly marked
primary, and are cancelled on any device that is revoked, has notifications
disabled, or is not primary. Because ADR-019 forbids automatic promotion, that
correct behaviour is otherwise silent: rebuilding the app wipes SecureStore,
which forces a re-pair, which mints a new device row and leaves primary status
stranded on the old one — after which the device in the user's hand schedules
nothing at all. Phase 3 Checkpoint 5 observed exactly this on the Rabbit R1 and
added a Settings banner naming the blocking reason. Revocation likewise does
not clear the primary flag, so a revoked row can continue to hold it.

Remote notification rows use `accepted`, not `sent`: an Expo ticket with
`status: "ok"` proves only that Expo accepted the delivery request. It does not
prove FCM or the device received it; receipt polling remains outside the MVP.

---

## Network & security

- Run `tailscale serve` on the i5 for **real HTTPS certs** on `https://hub.<tailnet>.ts.net`. iOS is increasingly hostile to plain HTTP and Shortcuts is picky; this makes the problem disappear.
- Enable **MagicDNS** so nothing hardcodes an IP.
- Enable **VPN On Demand** in the Tailscale iOS app so the tunnel is up before Shortcuts fires. Android: enable Always-on VPN in system settings.
- Tailscale ACLs remain the perimeter for the general API. Device registration requires a short-lived, atomically single-use pairing code generated via trusted server CLI access; the raw code and raw bearer token are never stored server-side. The bearer token in `expo-secure-store` protects only device/notification-specific endpoints. Revoking its row does **not** revoke `/tasks`, `/capture`, the web UI, or other Tailscale-perimeter routes; a lost device must also be removed from the tailnet for full access revocation.
- **PostgreSQL is never published.** No `ports:` entry in compose — it exists only on the internal Docker network. Admin access goes over Tailscale SSH or a tunnel, never a bound public port.
- The app connects as a **least-privilege role**, not `postgres`. No superuser, no `CREATE`, migrations run as a separate role.

If a Shortcut fires while the tunnel is genuinely down, it fails and you retry. The in-app outbox is the resilient path; the Shortcut is the convenient one. Don't build a second dead-drop system to paper over an edge case that VPN On Demand mostly eliminates.

---

## Deployment order (frozen, Checkpoint 5.7)

**Migrations execute from the release API image, not from the running one.**

The migration container is `docker compose run --rm --no-deps --entrypoint sh api`,
so it uses whatever `packages/db/drizzle` the **api image** contains. The image
currently serving production was built from the *previous* release and does not
contain the new migration files. Running the migration against it applies
**nothing** and still prints `migrations applied successfully` — a silent no-op
that leaves production at the old level while appearing to succeed. Checkpoint
5.7 hit exactly this and caught it only by listing the migrations inside the
running image before trusting the command.

The order is therefore:

1. Ship the release source to a **new per-release directory**
   (`/home/himallinux/personal-os-<checkpoint>-release`, via `git archive` so
   only tracked files transfer and no `.env`, `google-services.json`,
   generated `android/` or `node_modules` can leak). The previous release
   directory stays as a rollback source. `.env` lives at the stable path
   `/home/himallinux/personal-os/.env` and is never copied.
2. Tag the currently-serving images **by digest** as rollback targets. Never
   `docker commit` a live container.
3. **Build** the release images. Building does not touch running containers.
4. **Verify** the new api image actually contains the expected migrations.
5. **Migrate**, from the new image, with `--no-deps`.
6. **Roll out** application services with
   `up -d --no-deps --no-build --force-recreate <services>`, naming them
   explicitly.

Do **not** revert to "migrate first with the running image, then build".

Every production compose command pins `-p personal-os`, `--env-file
/home/himallinux/personal-os/.env`, and both compose files explicitly, and
carries `--no-deps`. `postgres` is never named as a target of `up`, `run`,
`restart`, `stop`, or `rm` — `api` and `worker` both declare
`depends_on: postgres`, so omitting `--no-deps` reconciles and can recreate the
database container. That is what happened in Phase 4 Checkpoint 4.7's Gate C
incident; the volume survived and no data was lost, but the rule exists because
of it.

Rebuild only what changed. Migrations are additive and forward-only, so the
previous release's images run correctly against the newer schema — that is what
makes an image rollback real. A schema rollback is never performed.

## Secrets

Personal OS has no backup system in the current architecture. PostgreSQL uses persistent Docker volume storage on the production server — this is durability against container restarts, not a backup. Backup infrastructure may be added in a future phase only if explicitly requested.

- `.env` files are gitignored; `.env.example` with dummy values is committed.
- Config that must live in the repo goes through SOPS + age.
- A `gitleaks` pre-commit hook. Assume you will paste an API key into a config file at 1am eventually.
- Docker secrets or env injection at runtime — never baked into an image layer.

---

## Gotchas that will bite

1. **Timezones.** Always send the device timezone with the capture and resolve relative dates in *that* zone. A UTC server will silently schedule "tomorrow at 8" five hours off. The single most common bug in this category of app.
2. **All-day events are dates, not timestamps.** Storing an all-day event as midnight-timestamptz makes it jump days for anyone crossing a zone, including you when you travel.
3. **DST and recurrence.** Covered above, and worth the discipline — it's the bug that erodes trust in the whole system.
4. **Apple Developer account.** $99/yr. Without it, iOS builds expire every 7 days. It gates the entire iOS path. It no longer gates Health: ADR-046 moved Phase 6 to a server-side Google Health cloud integration, so health data reaches every client through the Personal OS API rather than through HealthKit.
5. **EAS build times.** Native module changes require a real rebuild. Develop on the web target and batch native work.
6. **`expo-notifications` on Android 13+.** Needs runtime notification permission *and* exact-alarm permission for precise scheduling. Request both during onboarding. Both are now requested (Phase 3 Checkpoint 5). The exact-alarm half is easy to get wrong and expensive to miss: the app targets SDK 36 and declares `SCHEDULE_EXACT_ALARM` without `USE_EXACT_ALARM`, so Android 14+ does **not** auto-grant it, there is no in-app dialog for it (the only route is a deep link into system settings), and the grant **does not survive reinstall**. Without it Android silently schedules reminders with a one-hour delivery window — verified on the physical Rabbit R1 in `dumpsys alarm` as `window=+1h0m0s0ms` with no `exactAllowReason`, versus `window=0 exactAllowReason=permission` once granted. A short test reminder delivers promptly either way, so this cannot be verified with a two-minute alarm; inspect the scheduled alarm itself.
7. **Expo web is not Next.js.** No SSR, no file-based API routes, larger bundle. Fine for a single-user dashboard behind Tailscale; the tradeoff to accept knowingly.
8. **Don't let the AI layer write unattended** until the parser has earned trust over a few hundred captures.

---

## Phase plan

**Phase 0 — Foundation & hardening (1–2 weekends)**
Turborepo + pnpm monorepo. Docker Compose on the i5: Postgres (unpublished), Fastify API, **worker container with pg-boss and its heartbeat/staleness alert**. Tailscale Serve with HTTPS, MagicDNS, VPN On Demand. Drizzle migrations in `packages/db`. Shared `schema` package. SOPS available for secrets if needed, gitleaks hook, least-privilege DB role. No backup system (see "Secrets" above).

**Phase 1 — Capture core, headless (1–2 weekends)**
`/capture` and the inbox table on the API side. On the worker: LLM parser with tool-calling, confidence scoring, the nightly due-date window expansion, and lazy generation on completion. Tasks, notes, events, occurrences. Drive it entirely with curl against fifty real captures you type yourself. No UI. Get the parser good before you make it pretty.

Test both recurrence paths explicitly here — a monthly due-date rule across a DST boundary, and a completion-anchored rule completed late, skipped, and left open for a week. These are cheap to verify with curl and miserable to debug through three clients later.

**Phase 2 — Expo Router app, web target (1–2 weekends)**
Quick-add box, inbox triage, task list, notes, project view. Runs in the browser with instant refresh — this becomes your daily driver while native is still being built.

**Phase 3 — Native builds, voice, notifications (2–3 weekends)**
EAS dev build. Device registration and primary-device selection, per-device notification settings, local reminder scheduling, outbox queue, push-to-talk, Siri Shortcut, confirmation flow. **End of Phase 3 is your MVP.**

Live on Phases 0–3 for a month before continuing. Half of what you think you want in Phase 4 will change.

**Phase 4 — Calendar UI + external sync + recurrence UI.** Month/week views, RRULE editor, Google Calendar or CalDAV two-way sync using the `external_*` columns already in place.

**Phase 5 — Daily Command Center + Projects (revised 2026-08-21, ADR-038).** The original Phase 5 entry (Finance) is **deferred to a later phase**, still gated on the open finance-source-of-truth decision. Phase 5 as approved: a Today/Home command center computed from existing primitives, operational project management (lifecycle/goal/target date/computed next action), daily + weekly review workflows with durable review history, a unified tasks+events agenda read model, a manual on-demand AI Daily Brief over the existing provider-agnostic layer, mobile/Rabbit daily-use polish, and a gated production deployment. Integrates existing primitives; no new external integrations; no new worker jobs; no scheduled or autonomous agents. Checkpoints 5.1–5.7; see `docs/history/` for the checkpoint record and ADRs 038–041 for locked decisions.

**Phase 6 — Health (revised 2026-08-24, ADR-046).** The original Phase 6 entry (HealthKit via `@kingstinct/react-native-healthkit`, Health Connect via `react-native-health-connect`) is **removed from scope entirely** — no native health access, no device-local health sync, no Apple Developer dependency. Phase 6 as approved: a **read-only, server-side Google Health API integration** (`health.googleapis.com`, `/v4`) over OAuth 2.0 with exactly three read scopes, synchronised by `apps/worker` into PostgreSQL and rendered by the existing Expo client on web and the Rabbit R1. Because the API exposes no sync token, no `updateTime` filter and no tombstones — and its only change-detection mechanism is webhooks, which require public ingress this project will never add (ADR-018) — sync is a bounded trailing-window re-fetch with content hashing, carrying an accepted 35-day staleness contract. Health data is **passive**: displayed, never fed to the AI layer. Checkpoints 6.0–6.7; see `docs/history/` for the checkpoint record and ADRs 046–050 for locked decisions.

**Later — Finance.** Copilot Money has no public API — decide between scheduled CSV import, going direct to Plaid or SimpleFIN Bridge, or self-hosting Actual Budget as the ledger. Voice transaction entry drops into the same capture pipeline.

**Phase 7 — Email summaries + service monitoring (refined 2026-08-30, ADR-052).** Read-only **Gmail** polling with the `gmail.metadata` scope only, a bounded LLM digest over headers and labels, uptime checks with a full incident lifecycle, and alerting through the **existing** notification router. Three refinements to the original entry, all locked by ADR-052/053/054/055:

- **Gmail only; Microsoft Graph is deferred** to a later, separately approved phase. Graph needs a separate Entra ID app registration, a second consent surface and a per-folder delta cursor — a second credential lane and a different sync engine, not a variation on Gmail's.
- **Read-only, metadata-only, and the app may never act on mail.** No message body, snippet, payload part or attachment is fetched or stored; no send, reply, delete, archive, mark-read, move, label, or autonomous task/event creation. The digest describes what mail *is* — sender, subject, labels, thread shape — not what it says.
- **Polling, never push.** Gmail push requires Cloud Pub/Sub, and a webhook subscription requires a publicly accessible HTTPS endpoint, which ADR-018 forbids and ADR-046 already excluded permanently for the same reason. Unlike webhooks, a Pub/Sub *pull* subscription would need no public endpoint and is therefore not categorically excluded — but it is **not adopted**, because a GCP service dependency for a single-user workload needs its own approval.

Unlike the Google Health API, Gmail **does** offer a real incremental primitive: `history.list` keyed on an opaque `historyId`. That cursor expires — `history.list` returns HTTP 404 once `startHistoryId` falls outside a window documented only as "at least one week and often longer" — so cursor expiry is a first-class tested state transition (`needs_full_resync` → bounded full sync → new cursor), and ADR-046's trailing-window/content-hash/35-day-staleness architecture is deliberately **not** ported.

Monitoring is worker-owned, with one exception: the **`worker_heartbeat` staleness check belongs to the API process**, because a worker-hosted monitor cannot alert on its own death. That closes the unbuilt half of this document's own "Worker crashes must be loud… alert on staleness" requirement. Alert dedupe keys are **incident-scoped**, which is what makes a *second* outage notifiable — `notification_dispatch_log.dedupe_key` is a permanent primary key with no TTL.

Checkpoints 7.0–7.8; see `docs/history/` for the checkpoint record and ADRs 052–055 for locked decisions.

**Phase 8 — Consolidation & adoption (redefined 2026-09-02, ADR-056).** The original Phase 8 entry — *"AI layer. Semantic search over everything (pgvector), chat with tool access to all modules, proactive surfacing"* — is **superseded**. It assumed that by Phase 8 everything would be "uniformly structured and queryable". Everything is indeed uniformly structured; almost nothing is in it. Measured at Checkpoint 8.0: production holds 2 tasks, 3 notes, 6 inbox items, 0 projects and 0 events, while health, mail, calendar and monitoring all sync daily — and the repository is eighteen days old, having skipped this document's own instruction to live on Phases 0–3 for a month by zero days.

Phase 8 as approved: **make Personal OS a daily driver.** Make failures visible, reduce capture friction, make stored content findable, make project and source state durable, reduce agent context overhead, then run an instrumented adoption soak whose deliverable is evidence rather than a feature. **No semantic search, no embeddings, no retrieval layer and no write-capable agent** — read-only intelligence precedes write-capable intelligence, and at the observed corpus size the whole first-party corpus fits in a single model call. **pgvector is excluded from Phase 8 and the Postgres image stays frozen**; it is not permanently forbidden, but reconsidering it requires its own infrastructure ADR and explicit owner approval. Checkpoints 8.0–8.6; see `docs/history/` for the checkpoint record and ADR-056 for the locked decision.

---

## Open questions for later phases

- ~~Which email accounts, and is a summary enough or should the app act on mail?~~ **Answered for Phase 7 by ADR-052/053/054: Gmail accounts only, a summary is enough, and the app may never act on mail.** Scope is exactly `gmail.metadata`, so no message body is ever read or stored. Microsoft Graph remains genuinely open and is tracked in `docs/DECISIONS.md`.
- ~~Health: passive dashboard, or does it feed the AI layer proactively?~~ **Answered by ADR-046: passive.** Daily Brief integration is deferred to a separately approved checkpoint.
- Finance: is Copilot the source of truth forever, or a stepping stone to owning the ledger?
- Does the Pi 5 keep a wake-word role, or does capture become phone-only?
- At what point does a dedicated Next.js dashboard become worth building?
