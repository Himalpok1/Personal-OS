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

- **Develop on the web target first.** The browser gives instant refresh with no EAS build in the loop. Only native-module work — notifications, audio, HealthKit — requires a dev build. Batch that work rather than interleaving it.
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

The honest cost of this choice: when the finance and health dashboards arrive in Phases 5–6, dense data views in RN Web will be more friction than they'd be in Next.js. The monorepo boundary above is what makes that a contained, deferrable problem rather than a rewrite.

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
| Email polling and digests | Cron (Phase 7) |
| Uptime / service monitoring | Cron (Phase 7) |
| Embedding generation | Enqueued on write (Phase 8) |

**Rules for the split:**

- The API **never** performs the work inline, only enqueues. `/capture` writes the inbox row and enqueues, then returns 202 — that's already the design, this makes ownership explicit.
- **Every job must be idempotent.** pg-boss retries on failure and can deliver twice under crash conditions. Key on `client_uuid`, `inbox_id`, or `(parent_id, occurs_at)` and make a second run a no-op.
- Both processes import `packages/db` and connect to the same Postgres. No API-to-worker HTTP calls; the database and queue are the entire interface.
- Separate containers in the same compose file, separate health endpoints, `restart: unless-stopped` on both.
- Worker crashes must be loud. A silently dead worker means captures sit unparsed and reminders never dispatch, and you won't notice for days. Add a heartbeat row it updates each cycle and alert on staleness.

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
- **Editing the rule** regenerates only the single open occurrence; there's no window to rebuild.

The parser can infer the anchor from phrasing — "every 3 days after I…", "every N days" on a chore-shaped verb — and should default to `due_date` when ambiguous, since that's the reversible mistake.

---

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
4. **Apple Developer account.** $99/yr. Without it, iOS builds expire every 7 days. It gates the entire iOS path including Health in Phase 6.
5. **EAS build times.** Native module changes require a real rebuild. Develop on the web target and batch native work.
6. **`expo-notifications` on Android 13+.** Needs runtime notification permission *and* exact-alarm permission for precise scheduling. Request both during onboarding.
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

**Phase 5 — Finance.** Copilot Money has no public API — decide between scheduled CSV import, going direct to Plaid or SimpleFIN Bridge, or self-hosting Actual Budget as the ledger. Voice transaction entry drops into the same capture pipeline.

**Phase 6 — Health.** HealthKit via `@kingstinct/react-native-healthkit`, Health Connect via `react-native-health-connect`. Requires the paid Apple account and a dev build. Read-only to start.

**Phase 7 — Email summaries + service monitoring.** Gmail/Graph polling, LLM digest, uptime checks against your live projects with alerting through the notification router.

**Phase 8 — AI layer.** Semantic search over everything (pgvector), chat with tool access to all modules, proactive surfacing. This is why inbox-first matters — by now everything is uniformly structured and queryable.

---

## Open questions for later phases

- Which email accounts, and is a summary enough or should the app act on mail?
- Health: passive dashboard, or does it feed the AI layer proactively?
- Finance: is Copilot the source of truth forever, or a stepping stone to owning the ledger?
- Does the Pi 5 keep a wake-word role, or does capture become phone-only?
- At what point does a dedicated Next.js dashboard become worth building?
