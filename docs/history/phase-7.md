# Phase 7 — Email summaries + service monitoring

> **Historical record — closed. Do not edit.**
> Gmail `gmail.metadata` integration, the incremental sync engine, the mail digest pipeline, and the service-monitoring platform.

**Checkpoint 7.9 is OPEN and lives in `docs/STATUS.md`, not here.**
>
> Archived from `docs/STATUS.md` by Checkpoint 8.0 (2026-09-02) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`.

Source line ranges in the pre-8.0 `docs/STATUS.md`: 9–22, 23–103, 104–188, 189–377, 378–443, 444–702, 855–1021, 1022–1284, 1285–1491, 1492–1709, 1710–1865, 1866–2031, 2032–2183, 6770–6804, 6805–6839, 6840–6866, 6867–6894, 6895–6919, 6920–6945, 6946–6981, 6982–7084


> **Note on cross-references.** This file was extracted from a single 7,283-line `docs/STATUS.md`. Phrases like *"above"*, *"below"*, *"further down this file"* and *"see the 6.7A section"* refer to positions in that original document, not to this file. Where a target moved to a different phase file, follow the phase number. Nothing was rewritten to repair these — the text is verbatim.

<!-- ORIGINAL RECORD BEGINS — everything below this line is verbatim from docs/STATUS.md -->
## Phase 7 — Email summaries + service monitoring (planning gate approved 2026-08-30)

Phase 7 is the `docs/ARCHITECTURE.md` phase-plan entry *"Email summaries + service monitoring"*,
refined and made operative by **ADR-052**. A read-only Planning & Discovery Gate ran first — four
parallel read-only investigation lanes plus integrator-owned first-hand verification — and its
conclusions are the specification these ADRs record.

**Approved checkpoints:** 7.0 ADRs + documentation reconciliation · 7.1 contracts + migration `0014`
+ provider fake · **⛔ stop** · 7.2 Gmail OAuth · 7.2P live capability probe · **⛔ stop** · 7.3 sync
engine · 7.4 digest · 7.5 monitoring + migration `0015` · 7.6 UI · 7.7 hardening + live proof · 7.8
gated production deployment.

**Approved scope at this time is 7.0 only.**

### Checkpoint 7.0 — ADR gate, documentation reconciliation, baseline correction (COMPLETE, 2026-08-30)

Documentation only. No code, no migration, no dependency, no test change, no credential, no Google
Cloud action, no production access. Branch `main`, HEAD `8b7a9eb` at start, clean tree.

**Added `docs/DECISIONS.md` ADR-052** (Phase 7 scope: Gmail-first, read-only, Graph deferred,
polling-only under ADR-018, checkpoint structure, and the deployment gate on Phase 6's monitoring
milestone) · **ADR-053** (mail integration: `gmail.metadata` only, opaque `historyId` cursor
deliberately inverting the health date-cursor rule, 404 → full resync as a first-class state, a third
OAuth client in the existing project, `Retry-After` honoured, closed `MailSyncErrorCode` enum) ·
**ADR-054** (header-only storage, no bodies, bounded prune permitted, and the prompt-injection
posture for the first attacker-authored input to reach the AI layer) · **ADR-055** (monitoring
worker-owned, heartbeat watchdog API-owned, derived failure counting, incident-scoped alert dedupe,
three-state uptime).

**Closed the open Phase 7 decision.** `docs/DECISIONS.md`'s *"Email account scope and whether the app
may act on mail"* is struck through and answered, following the ADR-046 precedent, and a new
genuinely-open decision is recorded in its place for Microsoft Graph.

#### The five amendments approved with the planning gate

- **A — Phase 6 longevity and Phase 7 development are independent.** The seven-day refresh-token
  longevity observation (ADR-051) remains open and is **not** claimed as passed. **Phase 7
  development may begin**, and may run through Checkpoint 7.7. **Production deployment (7.8) may not
  occur before the `2026-09-04T20:08:25Z` monitoring milestone completes** — so a genuine Phase 6
  production incident can never be confounded with a Phase 7 change.
- **B — Mail digests are global across all active connected mailboxes.** One digest per
  `(digest_date, timezone)` covering every connection, never one per mailbox: the product question is
  "what needs my attention today", which is not per-account.
- **C — Worker-heartbeat monitoring belongs to the API watchdog; general monitoring stays
  worker-owned.** A worker-hosted monitor cannot alert on its own death, so the `worker_heartbeat`
  staleness check — the unbuilt half of `ARCHITECTURE.md`'s "alert on staleness" mandate — lives in
  the API process. The residual blind spot (a hung or crash-looping worker behind a healthy API) is
  documented, not papered over.
- **D — `Retry-After` behaviour is proven by deterministic testing.** Injected responses against the
  limiter's already-injected `now`/`sleep`/`random` seams, asserting exact millisecond values. **A
  real Gmail 429 is NOT required for acceptance**, because provoking one would mean deliberately
  abusing the quota.
- **E — Digest generation and notification are separate.** Generation always occurs on schedule and
  always persists. **Quiet hours delay the notification rather than suppressing it forever** — the
  existing router drops a quiet-hours notification with no log row, which for a recurring digest
  would mean silently sending nothing, permanently.

#### Stale present-state documentation corrected

| Correction | Was | Now |
|---|---|---|
| `Last verification` baseline | Checkpoint 6.6 — 2038 tests, worker 152, api 495, mobile 367 | **Re-measured first-hand: 2055 tests / 17 turbo tasks**, worker **159**, api **496**, mobile **376**, canaries 74/159 |
| Header `Current phase` | Phase 6 closed | Phase 7, Checkpoint 7.0 complete |
| Header `Next phase allowed` | "Checkpoint 6.7 … Phases 7/8 have not been approved or planned" | Checkpoint 7.1, on separate approval; Phase 7 approved and scoped |
| Release-directory debt bullet | live build context `personal-os-5.7-release` | `personal-os-6.7-release`; 4.7/5.7/5.7.1 retained as rollback sources |
| Duplicated `Remaining warnings / technical debt` heading | two identical headings; a reader could silently read half the ledger | numbered **part 1 of 2** / **part 2 of 2**, cross-referenced, entries left in their recorded order |
| `Next action` | "The unmerged The unmerged"; claimed 6.7B "not merged to `main`" while the next paragraph said it was | duplication removed; merge state stated once, correctly |
| `AGENTS.md` scope | "Current starting scope: Phase 0 only." | Phase 7, with `docs/STATUS.md` named as canonical |
| `AGENTS.md` repository layout | omitted `ai-providers`, `calendar-providers`, `health-providers` | all seven packages listed |

**Historical records were not rewritten.** Only present-state assertions were corrected. The
Checkpoint 5.7 narrative still names `personal-os-5.7-release` because that was the live context when
it was written, and every prior verification record keeps its own numbers.

#### Verification actually run

Integrator-owned, first-hand — not transcribed from the 6.7A record. Build **9/9** · typecheck
**17/17** · `eslint .` **zero output (0 errors, 0 warnings)** · `prettier --check .` clean ·
`git diff --check` clean · full suite **uncached and serial, 0 of 17 cached: 2055 tests / 17 turbo
tasks, zero failing** (core 326 · db 21 · schema 174 · calendar-providers 74 · health-providers 311 ·
ai-providers 25 · api-client 93 · api 496 · worker 159 · mobile 376) · `gitleaks git` **182 commits,
no leaks** · migrations **14 / 14, no `0014`** · `packages/db/` untouched · `versionCode` unchanged
at 7.

The four files this checkpoint edited are all `.prettierignore`d and none is compiled or tested, so
the gate measures the **unchanged application tree** — which is exactly why the re-measurement was
expected to, and did, reproduce 6.7A's numbers.

#### Deliberately NOT done

No migration `0014`. No `packages/mail-providers`. No routes, jobs, queues, or `exports` edits. No
OAuth client, no Google Cloud change, no `.env` change. No mobile UI. No new or modified test. No
commit (commits require explicit request). No production access. Checkpoint 7.1 had not begun at
that point; it is recorded below.

### Checkpoint 7.1 — Contracts, mail provider foundation, migration `0014` (COMPLETE, 2026-08-30)

Local development only. No production access, no OAuth flow, no credential, no Google Cloud change,
no worker job, no queue, no route, no UI. Branch `phase-7-mail-monitoring`, cut from `main` at
`8b7a9eb`; Checkpoint 7.0 was committed first as `7a2a6e7`, its committed tree proven byte-identical
to the accepted working tree (`0573522…`).

**Migration `0014_mail_integration`** — hand-written, additive, forward-only, drizzle-kit-styled with
`--> statement-breakpoint`. **`CREATE TABLE` only; no existing table is altered.** 39 statements: 6
tables, 5 foreign keys, 7 CHECK constraints, 9 explicit indexes. **Local migration level moved
0000–0013 = 14 → 0000–0014 = 15**; production is untouched and remains at 14.

| Table | Shape and why |
|---|---|
| `mail_connections` | Identity is **`(provider, external_account_id)`**, deliberately unlike `health_connections`, which is unique on the account id alone — two mailboxes are legitimate and a second provider could mint a colliding id. `provider` carries **no CHECK** (ADR-050). Both encrypted triples are **all-or-nothing** CHECKed, copying health rather than calendar, which lacks them. `status` CHECKed to the four-state lifecycle |
| `mail_oauth_states` | Near-copy of `health_oauth_states`. Persistence contract only; the routes are 7.2's |
| `mail_sync_cursors` | Stores an **opaque provider cursor**, inverting `backfill_cursor_date`'s "a date, never a page token" rule. `needs_full_resync` defaults **true**, because a cursorless row genuinely needs a full pass |
| `mail_messages` | Metadata only. **No body, snippet or attachment column.** Named **`provider_labels`**, not `label_ids` |
| `mail_digests` | `(digest_date, timezone)` unique with **no `connection_id`** — global across mailboxes (ADR-053). `model_id` → `ai_models` `ON DELETE SET NULL` |
| `mail_sync_runs` | `timestamptz` ranges, not health's civil dates, because Gmail supplies real instants. `cursor_expired` makes ADR-053's transition visible in the audit trail |

**One deviation from the plan, forced by repository evidence.** The recent-mail index is
`(connection_id, internal_date)` **ascending**, not `DESC` as the planning gate proposed:
`deriveIndexProbe` in `packages/db/scripts/reconcile-drizzle-tracking.ts` requires every indexed
column to match `/^[a-z_][a-z0-9_]*$/`, so a `DESC` modifier **aborts `db:reconcile` outright**. It
costs nothing — a btree is scanned in either direction, so the index serves
`ORDER BY internal_date DESC` identically.

**`packages/mail-providers`** (new, server-only, 57 tests) — `gmail-catalog.ts`, `mail-client.ts`
(the interface), `gmail-client.ts`, `gmail-client.fake.ts`, `gmail-oauth.ts`, `identity.ts`. The
interface is **read-only by construction**: no send, reply, modify, trash or label-mutation method
exists, so ADR-052's rule is a type rather than a policy. Two Gmail traps are made unrepresentable —
`ListMessagesRequest` has no `q` field and `GetMessageMetadataRequest` has no `format` field, because
Gmail rejects both under `gmail.metadata`. `GmailApiError` **destroys the provider's message**,
keeping only status, status token, deduped reason/domain tokens and `Retry-After`.

**`packages/core/src/mail/provider-strings.ts`**, behind a new `./mail/*` exports subpath and
**deliberately not in the core barrel**, which pulls in `node:module` and `node:crypto`. Two
primitives: `truncateProviderString` (never splits a surrogate pair — a lone surrogate is invalid
UTF-8 and Postgres rejects it, which one emoji in a subject line is enough to trigger) and
`extractEmailDomain` (returns null rather than guessing).

**`packages/schema`** uses **both** established error patterns, each where it belongs: a **closed
`MailSyncErrorCode` enum** for `mail_connections.last_sync_error`, because "what should the user do
about this mailbox" has finitely many answers, typed onto the wire so provider prose is a parse
failure; and a **shape-constrained `MailSyncFailureClass` token** for `mail_sync_runs.failure_class`,
because that diagnostic set grows. `MailSyncErrorCode` is not a copy of `CalendarSyncErrorCode`:
calendar has `conflict` and no cursor, mail has `cursor_expired` and no ETag.

#### Two real defects found by the new tests rather than by review

1. **`Date.parse` accepted `"12.5"` and `"-5"` as dates.** Both land in the past, so
   `parseRetryAfterSeconds` clamped them to `0` — telling a caller "retry now" on a value it should
   have rejected. The date branch now requires an `h:mm:ss` time, which all three RFC 7231 formats
   carry and neither of those strings does.
2. **The scripted fake threw synchronously out of a Promise-returning method**, so an unqueued call
   raised where every caller written against the real client expects a rejection. Now settled.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **10/10**, typecheck **18/18**, `eslint .` **0 errors 0 warnings**, `format:check` clean, `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2202 tests / 18 turbo tasks** (2055 → **+147**), zero failing |
| 3 | No package decreased | core 326→**339** · db 21→**56** · schema 174→**216** · **mail-providers 57 (new)** · health-providers 311 · ai-providers 25 · api-client 93 · api 496 · mobile 376 |
| 4 | Zero-drift canaries | `calendar-providers` **74** and `worker` **159**, both unchanged |
| 5 | Migration applied | Once each to dev and `personalos_test` as `posops_migrator`: 14 → **15** tracked rows, 28 → **34** public tables, 6 tables / 7 CHECKs / 5 FKs / 15 indexes (9 explicit + 6 implicit `_pkey`) in both |
| 6 | Fresh lineage | A disposable database migrated **`0000` → `0014`** produced a `public` schema **byte-identical to dev** — 632 lines, matching sha256 — then was dropped |
| 7 | Reconcile | `db:reconcile --check` consistent; and against the disposable database with `0014`'s tracking row removed, reconcile **derived and confirmed 27/27 probes** without aborting on any statement class |
| 8 | DB constraints | 35 new proofs in `packages/db/test/mail-constraints.test.ts`, including all six partial credential triples, both unique keys, both FK directions, and role separation (`posops_app` denied `CREATE TABLE` and denied dropping a mail CHECK, `42501`) |
| 9 | Bundle safety | `expo export --platform web` clean, exactly one `index.html`; core barrel does not re-export mail; no Node builtin under `core/src/mail`; `packages/schema` imports the deep subpath; `mail-providers` is not a mobile dependency |
| 10 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker/src/{health,jobs}`, `packages/health-providers`, `packages/calendar-providers`, `packages/core/src/recurrence`, `apps/mobile`, all three compose files, `apps/api/src/{routes,plugins}`, and migrations `0000`–`0013` |
| 11 | Health invariants | `health_observations` **0** in dev and test; `heart-rate-intraday` `sync_enabled = false` with **zero sync runs ever** |
| 12 | Dependencies | **Zero new registry packages.** The lockfile gains 6 lines: the workspace entry and its existing vitest devDependency |
| 13 | Secret scans | `gitleaks` clean on every commit via the pre-commit hook |

#### Deliberately NOT done

No OAuth route, no Google Console change, no credential, no `.env` change, no real Gmail connection
lifecycle. No worker job, no pg-boss queue, no cron. No digest generation and no AI integration — the
digest **input** allowlist is deliberately undefined, because it is a security contract that belongs
with the code that must honour it (7.4). No monitoring, no migration `0015`. No notifications, no
mobile UI, no api-client method. No merge to `main`, no rebase, no push (the repository has no
remote). No production access. **Checkpoint 7.2 not begun.**

### Checkpoint 7.2 — Gmail OAuth + connection lifecycle (repository work COMPLETE; live proof BLOCKED AT USER ACTION GATE, 2026-08-30)

Local development only. **No production access, no Google Console change, no credential, no live
OAuth call, no migration** — the level stays 15 `.sql` / 15 journal entries and there is no `0015`.
No worker job, no queue, no synchronisation, no message persistence, no digest, no monitoring, no
mobile UI. Branch `phase-7-mail-monitoring`, **seven** commits from `70e2c89` (`9f3c93e` … `3132544`).

**Every deterministic repository deliverable is finished and verified. The live OAuth proof is not,
and is not claimed to be** — see the user-action gate at the end of this section.

#### Redirect URIs, derived from repository evidence rather than invented

| Environment | URI | Derived from |
|---|---|---|
| Development | `http://127.0.0.1:3000/mail-connections/gmail/callback` | `PORT=3000` and the Health development callback, which is the loopback form `http://127.0.0.1:3000/health-connections/google/callback` |
| Production | `https://personal-os.tail62a68f.ts.net/mail-connections/gmail/callback` | the Health production callback recorded in 6.7B, on the already-authorized tailnet domain |

Google redirects the **user's browser** to these; Google's servers never call them. That is why a
tailnet-only host works as a redirect target at all, and why this needs **no public ingress**
(ADR-018 untouched).

#### What was built

`GMAIL_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI`, optional via `optionalNonEmpty()` and
passed as `${VAR:-}` — the load-bearing pairing, because `z.string().min(1).optional()` throws on the
empty string `${VAR:-}` actually produces, which the 6.3 audit found would kill api **and** worker at
import. **api only**: the worker has no mail code yet, so 7.3 adds its passthrough alongside the sync
engine that needs it.

Routes: `GET /mail-connections/gmail/authorize-url` · `GET /mail-connections/gmail/callback` ·
`POST /mail-connections/gmail` (manual fallback, same service and same checks) ·
`GET /mail-connections` · `GET /mail-connections/:id` ·
`POST /mail-connections/:id/disconnect`. Error taxonomy: `409 mail_not_configured` ·
`409 missing_refresh_token` · `400 invalid_redirect_uri` · `400 invalid_state` ·
`400 gmail_consent_failed` · `400 missing_code_or_state` · `404 not_found` ·
`422 gmail_oauth_failed` · `422 gmail_api_failed`. All static; no provider message is ever forwarded.

`services/mail-connection.ts` is a deliberate near-copy of `services/health-connection.ts` wherever
the semantics match — 32-byte state stored **only** as sha256, atomic single-use
`UPDATE … WHERE consumed_at IS NULL … RETURNING`, expiry, constant-time redirect binding,
exact-match allowlist with no normalization, revoke-then-unconditionally-clear disconnect.

#### The one structural divergence from Health, and everything downstream of it

Health is single-account and finds its prior row with `.limit(1)` **before** spending the code. Mail
permits multiple mailboxes, identity is `(provider, external_account_id)`, and **which** mailbox is
being connected is unknowable until `users.getProfile` has run — which requires the exchange to have
happened. The order is therefore **exchange → identify → look up scoped to that mailbox**, which is
what makes it impossible for a callback for mailbox B to overwrite mailbox A's connection. Tested
directly.

Three consequences, each deliberate and tested:

- **The refresh-token decision Health makes up front is made after identity.** Google omits
  `refresh_token` on most re-authorizations; that is fine when we already hold one for *this* mailbox
  and fatal when we do not, so a first connection without one is refused `409` rather than persisted
  as `active` and unable to refresh.
- **A stored refresh token is only overwritten when Google actually issued one**, so a reconnect
  cannot destroy a valid one.
- **Nothing is written until identity is verified**, so a failed exchange or a failed profile call
  persists no unverified connection.

**Reconnect restores everything, and the Phase 6 defect class is unrepresentable rather than merely
avoided.** Health's disconnect disables every stream and its reconnect deliberately does not restore
them, leaving a connection that reads "active" while syncing nothing. Mail has **no per-mailbox
enable flag at all**, so there is nothing to leave disabled. Tested for the `disconnected` and
`needs_reauth` cases, including that a successful reconnect clears the error that sent the user
there, and that the resulting row carries everything 7.3 needs to synchronize.

Identity comes from `users.getProfile`, **not** an `id_token`: `gmail.metadata` authorises it, so no
`openid`/`email` scope is added to a consent screen already carrying restricted Calendar and Health
grants.

#### One real defect, found by the tests rather than by review

**The scripted fake's queues leaked between tests.** A suite that builds its app once and injects one
fake — the established `buildTestApp` shape — shares those queues across every test in the file. A
test that queued a response and failed before consuming it left it at the head of the queue, and the
next test drained it. That produced eight failures attributed to the wrong tests and, worse, a
"failed identity lookup → 422" case that **passed with 201** because it drained a stale profile. Fixed
by adding `reset()` to the fake, with its own regression test.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0 warnings** · `format:check` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2272 tests / 19 turbo tasks** (2202 → **+70**), zero failing |
| 3 | No package decreased | api 496→**555** · api-client 93→**103** · mail-providers 57→**58** · core 339 · db 56 · schema 216 · health-providers 311 · ai-providers 25 · mobile 376 |
| 4 | Zero-drift canaries | `calendar-providers` **74** and `worker` **159**, both held |
| 5 | Migration invariant | **15 `.sql` / 15 journal entries, no `0015`**; `packages/db` byte-unchanged |
| 6 | Web export | `expo export --platform web` clean, exactly one `index.html` — relevant because the schema barrel now reaches `@personal-os/core/mail/provider-strings`, which is pure and Node-free |
| 7 | Secret scans | `gitleaks git` **194 commits, no leaks**; `gitleaks protect` clean on every commit |
| 8 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker`, `packages/health-providers`, `packages/calendar-providers`, `packages/core`, `packages/db`, `apps/mobile`, both production/dev compose files, and the Health and Calendar route/service modules |
| 9 | Health invariants | `health_observations` **0** in dev and test; `heart-rate-intraday` `sync_enabled = false` with **zero runs ever** |
| 10 | Mail state | every `mail_*` table **empty** in dev and test — no connection, no state, no message, no cursor, no run, no digest |

#### Google Cloud Console gate — SATISFIED (2026-08-31)

The user-only Console actions were completed interactively in the browser against the owner's own
signed-in Google session, in the existing project `personal-os-196cf` (ADR-051 — never a second
project). **No credential value was handled by the agent at any point.**

| Action | Result |
|---|---|
| Gmail API | **enabled** (`gmail.googleapis.com`) — it was not enabled before, which is why `gmail.metadata` did not appear in the scope picker at all |
| Scope | `gmail.metadata` added; restricted scopes are now **Gmail (1) + Google Health (3)**, sensitive and non-sensitive both still **empty** — no `openid`, `email`, `profile`, `gmail.readonly` or mutation scope |
| OAuth client | **`Personal OS Gmail Web`** created, type Web application, 2 redirect URIs, **0** JavaScript origins. Six clients now exist; none was deleted or modified |
| Verification | **not submitted.** The app stays In production / unverified under the personal-use exception; the Console reports **1 of 100** OAuth users |

**Two Console traps are recorded because either would have produced a false pass.** First, the scope
picker's **"Update" button only stages** — it closes the dialog showing the new group, but a reload
discards it; only the page-level **Save** persists. Second, **clearing the scope filter silently
drops the selection** (the picker paginates, 94 scopes at 10/page), so ticking a filtered row and
then clearing the filter leaves only the previously-saved scopes checked, and saving there is a
silent no-op that still looks successful. The reliable path is the console's own **"Manually add
scopes"** box, followed by asserting the full selected set before pressing Save.

**The privacy-policy debt did NOT block the scope addition** — an open question now answered
empirically. It blocked *publishing* in 6.7A; the app is already In production, so no re-publish was
required. The debt itself is **unchanged and unfixed**: the registered homepage/privacy URLs still
point at `https://personal-os.tail62a68f.ts.net`, which is the Fastify API root and returns HTTP 404
on a tailnet-only host Google cannot reach. Google's own consent screen corroborates it, showing
*"Learn why you're not seeing links to Personal OS's Privacy Policy or Terms of Service"*. Tailscale
Funnel, public Fastify ingress, webhooks and Pub/Sub all remain excluded.

#### Credential provisioning — done by the user, verified by name/length/shape only

The client id and secret were entered by the **user in their own terminal** through a hidden prompt,
so no value entered chat, argv, shell history, the repository or any log — the Checkpoint 6.2 /
6.7B silent-shell precedent. Google's new Console offers **no JSON download for Web clients**, so
this hand-off was mandatory rather than merely preferred.

Local `.env` moved **16 → 19 keys**, mode `600`, gitignored and untracked. Verified without reading
any value: id shape `…apps.googleusercontent.com`, secret shape `GOCSPX-…`, redirect exact, no stray
whitespace, and — the decisive check — **distinct from both the Google Health and Google Calendar
client credentials**, proving a genuinely new client rather than a mis-paste. The 72/35 character
lengths coincide with 6.7B's recorded Health lengths simply because Google's formats are uniform.
`gitleaks git`: **196 commits, no leaks.**

**One hazard was created and closed during provisioning.** The helper script wrote a backup to
`.env.pre-7.2`, but `.gitignore` line 18 is literally `.env`, **not** `.env*`, so that plaintext copy
of every secret was visible to `git add -A`. The pre-commit gitleaks hook would probably have caught
it, but that is a net rather than a design. The backup was deleted once verification passed, matching
6.7B's cleanup of `.env.pre-6.7b`; `.env` and `.env.example` are the only `.env*` files present.

#### Live OAuth proof — PASSED (2026-08-31)

Run against the **real Gmail API** on the owner's development Google account and the local
development database. Production was never contacted; production `.env` still holds no
`GMAIL_OAUTH_*` key. One short-lived built API (`node dist/index.js`, never `tsx watch`) served the
routes; **no worker ran**, so no sync, no queue and no message fetch was reachable.

**The first attempt failed, and that failure is the more valuable evidence.** The owner completed
consent, Google redirected a real authorization code to the loopback callback at `20:29:22.309Z`, and
the state had expired at `20:28:22.851Z` — so it was rejected `400 invalid_state` in 11 ms. That
proved, against genuine provider traffic rather than a fixture:

| Property | Evidence |
|---|---|
| Log scrubbing works on a **real** authorization code | Logged as `?state=[redacted]&iss=…&code=[redacted]&scope=…`. The Checkpoint 6.2 defect class (Fastify logs the URL at `lib/route.js:522`, before `onRequest` hooks at `:561`) is closed for the mail callback |
| State expiry is enforced | `mailOauthError: "invalid_state"` → `400` |
| **The code was never spent** | Validation precedes exchange by construction, so a stale or forged state cannot cause a token request |
| A rejected attempt still burns its state | The expired state is recorded `consumed`, so it cannot be replayed |

**The retry with a fresh state passed every lane.**

| Lane | Result |
|---|---|
| Connect | `201`, connection `82d3d976-…`, status **active** |
| Identity | Bound to the real mailbox via `users.getProfile` — **no `openid`/`email` scope was added**, exactly as ADR-053 requires |
| Granted scope | Google echoed **exactly** `https://www.googleapis.com/auth/gmail.metadata` |
| Credentials at rest | access **253 B** ciphertext · refresh **103 B** · 12 B IV · 16 B auth tag — **identical lengths to the 6.2P/6.7B Health record**, same AES-256-GCM path. Zero token-shaped plaintext inside either ciphertext |
| Wire safety | `GET /mail-connections` returns no credential field at all — not filtered out, never read |
| Disconnect | `revoked: true` (Google accepted the revocation), **all six credential columns NULL**, row/identity/scope/`created_at` retained |
| Disconnect idempotence | Repeat call → `disconnected`, `revoked: false`, no error |
| Reconnect | **Same row `82d3d976-…` with `created_at` still `2026-08-31T23:03:02.563Z`** — reused, not recreated; exactly one connection row throughout; all six credential columns repopulated; status back to `active` |
| OAuth states | 3 minted, **3 consumed**, none left unused |
| Blast radius | `mail_messages`, `mail_sync_cursors`, `mail_sync_runs`, `mail_digests` all **0** — 7.2 connects, it does not synchronise |
| Leak scan | Whole API log: **0** matches for `GOCSPX`, `ya29.`, `1//`, `refresh_token`, `client_secret` or an authorization-code prefix; **0** error-level lines |

**Deliberately NOT exercised, and reserved for 7.2P:** message enumeration, `history.list`, the `q`
rejection under metadata scope, `format=FULL`/`RAW` rejection, label inventory, and any forced 429.
No Gmail data request of any kind was made — only the token exchange and `users.getProfile`.

The development connection is **left active** for Checkpoint 7.3, matching the Phase 6 precedent. No
mailbox address, subject, header or message identifier appears in any commit or in this record beyond
the account label already required to identify the connection.

### Checkpoint 7.2P — Gmail live capability probe (COMPLETE, local only, 2026-08-31)

Evidence collection only. **No feature, migration, table, schema, worker job, queue, digest,
notification, UI or production change.** Read-only against Gmail: **15 live requests**, all GET, no
mutation endpoint touched. Nothing was written to the database — the before/after invariant snapshots
are byte-identical. The probe ran from a throwaway script that was deleted immediately; the working
tree never left `dd52696` clean.

Development Google account and development database only (`127.0.0.1:5432/personalos`). Production is
a remote host under compose project `personal-os` with Postgres unpublished, so a loopback DSN cannot
reach it. Scope stayed exactly `gmail.metadata`; no scope was requested, added or widened.

#### The four findings that change how 7.3 must be written

1. **Gmail's default message format is FULL, and it is rejected.** A `messages.get` with **no
   `format` parameter at all** returns `403 Metadata scope doesn't allow format FULL`. The shipped
   client hardcodes `format=metadata` and offers no `format` field, so this is already correct — but
   it is now proven **load-bearing rather than decorative**: a client that merely omitted the
   parameter would 403 on every single message fetch.
2. **Error `details` is EMPTY on every failure observed.** All three restriction 403s and the cursor
   404 returned `details: []` — no `reason`, no `domain`, no structured token of any kind. **This is
   the opposite of the Google Health API**, where Checkpoint 6.3's fix was precisely to stop
   classifying on HTTP status and read `error.details[].reason` instead. For Gmail that signal does
   not exist, so 7.3 must classify on **HTTP status plus endpoint context**, and must not port 6.3's
   reason-driven classifier expecting a reason to be there.
3. **An empty history delta omits the `history` key entirely** — it does not return an empty array.
   `startHistoryId` = current `historyId` yielded a body whose only key is `historyId`. Code that
   reads `response.history.length` crashes; it must treat the key as optional.
4. **Omitting `metadataHeaders` returns every header.** The unfiltered response carried **28**
   headers including `Received` chains, `DKIM-Signature`, `Authentication-Results`, `Return-Path`,
   `List-Unsubscribe`, `Feedback-ID` and several `X-*` vendor headers. The shipped client always
   sends the four-header allowlist, and the interface documents the hazard; this confirms the default
   is genuinely wide.

#### Probe results

| Probe | Result | Assumption |
|---|---|---|
| `users.getProfile` | `200`. Keys: `emailAddress`, `historyId`, `messagesTotal`, `threadsTotal`. `historyId` is a numeric **string**, 7 digits | **Confirmed** — bootstraps the cursor and yields identity under `gmail.metadata` alone, so no `openid`/`email` scope is needed (ADR-053) |
| `history.list`, cursor = current | `200`, body carries **only** `historyId`; no `history` key, no `nextPageToken` | Confirmed, with the shape caveat above |
| `history.list`, cursor in the recent past | `200`, **100 records** in one page, `nextPageToken` present. Record keys `id`, `messages`, `messagesAdded`; `messagesAdded[].message` carries `id`, `threadId`, `labelIds` | Confirmed. Note the extra `messages` field alongside the typed change arrays |
| `history.list`, `startHistoryId=1` | **`404 NOT_FOUND`**, `"Requested entity was not found."`, `details: []` | **Confirmed exactly as ADR-053 predicted.** Cursor expiry is a 404 and must drive `needs_full_resync` |
| `messages.list?q=` | **`403 PERMISSION_DENIED`** — `"Metadata scope does not support 'q' parameter"` | Confirmed; `q` is already unrepresentable in `ListMessagesRequest` |
| `messages.get?format=full` | **`403`** — `"Metadata scope doesn't allow format FULL"` | Confirmed |
| `messages.get?format=raw` | **`403`** — `"Metadata scope doesn't allow format RAW"` | Confirmed |
| `messages.get` with **no** `format` | **`403`** — same FULL message | **New.** See finding 1 |
| `messages.get?format=metadata` | `200`. Top-level keys `id`, `threadId`, `labelIds`, `internalDate`, `sizeEstimate`, `historyId`, `payload`; `payload` carries only `partId` and `headers` | Confirmed — every field `mail_messages` stores is available, and nothing else is |
| **Snippet** | **ABSENT.** The `snippet` key is not present at all under `format=metadata`; `payload.body` and `payload.parts` are likewise absent | **ADR-054's header-only guarantee is structural at the provider, not merely a policy we enforce.** Nothing was stored, and ADR-053 is unchanged |
| `labels.list` | `200`, 18 labels (15 system, 3 user). Keys `id`, `name`, `type`, `labelListVisibility`, `messageListVisibility` | Confirmed. `INBOX`, `UNREAD`, `IMPORTANT`, `STARRED` all present, and all five `CATEGORY_*` (`PERSONAL`, `SOCIAL`, `PROMOTIONS`, `UPDATES`, `FORUMS`). Also `CHAT`, `DRAFT`, `SENT`, `SPAM`, `TRASH`, `YELLOW_STAR`. User label **names deliberately not recorded** |
| Pagination | `nextPageToken` present, token ~20 chars; page 2 had **zero overlap** with page 1; `resultSizeEstimate` is a number; message refs carry **only** `id` and `threadId` | Confirmed. The single-page primitive is **not** sufficient: listing gives refs only, so metadata needs a second call per message — an N+1 shape 7.3 must budget against the 6,000 units/min quota |
| `labelIds` filtering | `[INBOX]` and `[INBOX, UNREAD]` both accepted and returned refs | Confirmed — label scoping substitutes for the rejected `q`, exactly as ADR-053 planned |
| Rate limiting | **0** HTTP 429 across 15 requests; **no** `Retry-After` header observed | As instructed, no 429 was provoked. `parseRetryAfterSeconds` remains covered by deterministic tests only (ADR-053 amendment D), which is the accepted position |

#### Privacy

No address, message id, thread id, subject, header **value**, snippet, body, attachment, user label
name or token appears in this record, in the probe output that was retained, or in any commit.
Evidence is HTTP statuses, key names, counts and shapes only. The one `emailAddress` returned by
`getProfile` was redacted to a character count at the point of logging.

#### Deliberately NOT done

No message was persisted. No `mail_sync_runs`, `mail_sync_cursors`, `mail_messages` or `mail_digests`
row was created. No sync logic, no cursor-advancement code, no classification of messages, no label
storage. No ADR was modified. No scope was widened. Checkpoint 7.3 has not begun.

### Checkpoint 7.8B — Production deployment (SERVER SIDE COMPLETE, 2026-09-01)

Phase 7 is deployed. **Production migration level moved 0000–0013 = 14 → 0000–0015 = 16** for the
first time since Phase 6, and api/worker/web now serve images built from `a5bbc48` — the commit that
carries both halves of the ADR-053a consent repair. Deployed under ADR-051a's owner waiver of the
`2026-09-04T20:08:25Z` milestone, with **no snapshot taken** (ADR-024 unamended).

**The three integrations are NOT yet reconnected.** That is owner-only interactive work and is the
one remaining step; see the reconnection order below, which is load-bearing.

#### All three integrations connected, monitoring seeded, digest route registered

| Integration | State | Notes |
|---|---|---|
| **Google Health** | `active` | new project `personal-os-health`; 24/24 streams synced; **0 days behind** |
| **Google Calendar** | `active` | never disconnected; 33 jobs/hour, 0 failures throughout |
| **Gmail** | `active` | connected `2026-09-01T18:01:28Z`, mailbox bound, `gmail.metadata` |

**Gmail credentials were copied from the proven local `.env`, not re-fetched from the Console**, and
the reason is a finding: the Console flags that the `Personal OS Gmail Web` client carries **more
than one client secret**, and it cannot say which one is live. The local values completed a real
OAuth cycle in Checkpoint 7.2, so copying them removes the ambiguity entirely. Transferred by a
silent shell pipe — never printed, never in argv, never read by a model-facing tool — the 6.7B
precedent. Verified afterwards by name, length and shape only: id prefix `868049601968-80oihcri…`
matches the Console client, redirect is the **production** callback, and the id is hash-distinct
from the Health client. Production `.env` moved **14 → 18 keys**, mode `600`, no duplicates.

**`MAIL_DIGEST_TIMEZONE=America/Chicago` was set**, and the worker re-registered
`mail.digest.cron` from `0 7 * * * tz=UTC` to **`0 7 * * * tz=America/Chicago`** — confirmed in
`pgboss.schedule` after the restart, not assumed.

**Monitoring is live for the first time in the project's history.** `monitor:seed` created **five**
targets and the cron began probing immediately: `api-internal-health`, `web-internal`,
`worker-heartbeat`, and — the notable pair — **`api-tailnet-health` and `web-tailnet`**. First
probes: **7 checks, all `up`, 0 incidents**, with both tailnet routes returning **HTTP 200** at
~230–250 ms. **ADR-055's recorded blind spot is now not merely resolved but actively monitored.**

Two details worth keeping. The seed script's `monitor:seed` npm script hardcodes
`--env-file=../../.env`, which **does not exist inside the image** — correctly, since secrets are
never baked into image layers (`docs/ARCHITECTURE.md`). It was run as
`npx tsx src/scripts/seed-monitor-targets.ts` with the environment supplied by compose instead; the
npm script is only usable from a working tree. And `worker-heartbeat` records **`latency_ms = null`**,
which is exactly the missing-versus-measured distinction Checkpoint 7.7's defect fix introduced — a
non-HTTP probe measures no round trip and must not invent one.

**`mail_digest` registered** on the existing `gpt-4.1` model row
(`313633f4-2c52-4a06-a696-4f7740a95f28`), primary-only, no fallback — the ADR-044 precedent.
Providers and models stayed at **2 / 2**: no new connection, no new model row, **no new credential
surface**. Production now routes `capture_parser`, `daily_brief`, `mail_digest` and
`voice_transcribe`.

#### First production Gmail sync — 500 messages, zero duplicates

The `*/15` cron fired at `18:15:12Z` and ran a **full** sync, because a new connection starts with
`needs_full_resync = true` and no cursor:

| | |
|---|---|
| Kind / status | `full` / **succeeded** |
| Requests / pages | **506** / 5 |
| Rows inserted / rejected | **500** / **0** |
| Cursor minted | 7-digit `historyId` |
| `needs_full_resync` after | **false** |
| Duplicate `(connection, external_id)` identities | **0** |

Those numbers match Checkpoint 7.7's live proof almost exactly (500 messages in 506 requests),
which is the N+1 shape 7.2P predicted: listing returns references only, so metadata costs one request
per message.

**A reading trap worth recording.** Mid-flight the run row reads `status = failed` with
`request_count = 0`, and the pg-boss job is still `active`. That is not a failure — the run row is
opened pessimistically and updated on completion, so a crashed pass is correctly left recorded as
failed. Under the rate limiter a 500-message full sync takes minutes, and reading the row before the
job completes will show a failure that is not one. Check `pgboss.job.state` before believing it.

**Header-only is structural, not a policy.** `mail_messages` has **zero** columns matching body,
snippet, payload or attachment content — verified against `information_schema`, not against the
migration text.

#### ⚠️ The Gmail token now carries the vestigial Health scopes

The mail connection's stored `granted_scope` is **eight** scopes, not one:

```
calendar.calendarlist.readonly  calendar.events  gmail.metadata  openid  userinfo.email
googlehealth.activity_and_fitness.readonly  googlehealth.sleep.readonly
googlehealth.health_metrics_and_measurements.readonly
```

That is `include_granted_scopes=true` behaving exactly as ADR-053a said it would — the token
inherits everything the *app* has been granted — and it is the "honest cost" that ADR records. It is
harmless in practice for three reasons: `MailClient` exposes no send, reply, modify, trash or label
method, so mail cannot act; the mail lane calls only Gmail endpoints; and Health authenticates
through a **different** client in a different project entirely, so this token is not the one Health
uses.

But it is a real widening, and it is only this wide because the three Health scopes granted to the
old app during the failed 7.8B attempts are still there. **Cleaning them up** — revoking the old
app's grant and re-consenting Gmail and Calendar without Health — would reduce this token to five
scopes. That is deliberately deferred rather than done while Calendar is working, and it is the one
outstanding hygiene item from this checkpoint.

#### Health OAuth recovery — the second project (ADR-051b), and it is WORKING

The 7.8A consent repair was necessary but not sufficient. It fixed grant destruction, and Gmail and
Calendar survived correctly — but **Google Health then refused the resulting token**, three times,
with the same structured error each time:

```
403  PERMISSION_DENIED  DISALLOWED_OAUTH_SCOPES  health.googleapis.com
```

**Google Health rejects any token carrying scopes beyond its own.** That is not a bug in our code;
it is almost certainly a deliberate Restricted-API rule stopping one token from bridging health data
with mail and calendar data. The evidence is symmetric: when Health last worked its stored
`granted_scope` was **exactly** the three Health scopes and nothing else, while Google Calendar ran
throughout on a grant containing calendar scopes **plus** `openid`, `userinfo.email` and
`gmail.metadata`, at 30+ successful syncs an hour. Only Health is restrictive.

So the two constraints are mutually exclusive while Gmail and Health share a consent screen: `false`
destroys the other grants, `true` produces a token Health refuses. **The owner chose the separate
project (ADR-051b)**, which supersedes ADR-051's single-project rule for Health alone.

**The diagnosis was only possible because the log was fixed first.** Two attempts produced nothing
but the static `google_health_api_failed`, because the callback logged the response code and
discarded `httpStatus`, `googleStatus` and `error.details[].reason` — the fields
`GoogleHealthApiError` parses for exactly this purpose. That is the trap Checkpoint 6.2P recorded
verbatim ("three live attempts misread a `pageSize` defect as an unsupported metric precisely
because the reason was thrown away"). A diagnosis-only change added the structured tokens to the log
line — never the provider's prose `message`, and the response contract is unchanged — and the third
attempt named the cause immediately.

**What was built**, in the owner's browser with the owner clicking the two consent-bearing steps:

| | |
|---|---|
| Project | **`personal-os-health`**, number `1000412593065` |
| Google Health API | enabled |
| Consent screen | `Personal OS Health`, External, **In production**, unverified under the personal-use exception (0 of 100) |
| Scopes | exactly the **three** Health `.readonly` scopes as *restricted*; sensitive and non-sensitive both empty |
| Client | `Personal OS Health Web`, one redirect URI, **no** JavaScript origins |

**`personal-os-196cf` is unchanged** and keeps Gmail and Calendar. One Google account throughout, one
credential per integration, no token reused across integrations — ADR-051's security intent is
preserved; only its single-project mechanism is superseded.

**Verified live, and it works:**

| Check | Result |
|---|---|
| Consent | succeeded on the first attempt against the new project |
| `granted_scope` returned | **exactly the three Health scopes**, nothing else — the isolated grant `DISALLOWED_OAUTH_SCOPES` was demanding |
| Connection row | **rebound, not recreated** — `created_at` still `2026-08-30T03:26:14.534Z` |
| Credentials at rest | access **253 B** ct / refresh **103 B** ct / 12 B IV / 16 B tag — identical lengths to the 6.2P/6.7B record |
| Credential identity | hash-compared against the previous values: **different**; project number in the client id matches `1000412593065`; **distinct** from the Calendar/Gmail client |
| Streams | **18 of 19** enabled, `heart-rate-intraday` still `false` (F5 debt unchanged) |
| Manual sync | **24 of 24 streams succeeded, 0 failed** |
| Data gap | closed — daily rows 145 → **149**, newest `local_date` **2026-09-01**, **0 days behind** |
| `health_observations` | **0**, unchanged |
| All three integrations | health `active` · calendar `active` (33 jobs/hour, 0 failed) · mail not yet connected by design |
| Log secret scan | `ya29.`, `GOCSPX`, `refresh_token`, `client_secret` — **0 each** |

**One operator error is recorded because the guard it produced is now permanent.** The first
credential-write command used `read -rsp`, which is bash; the owner's shell is zsh, where `-p` means
"read from a coprocess". Both reads failed, `"$ID"` expanded to empty, and the script **substituted
empty values and reported `id=1 secret=1`** — a replacement count read as success. Caught immediately
by the length check (`len=0`), restored from a backup taken first, and the reissued command now
refuses to write unless both values are non-empty and shaped like Google credentials. The lesson is
that a substitution count is not a validity check.

**Two costs accepted rather than hidden.** The privacy-policy URL debt from 6.7A is now reproduced
in a second project and is still unfixed. And the three Health scopes granted to the OLD app during
the failed attempts are **vestigial** — authorized but unused, since Health now authenticates through
a different client. Removing them means revoking that app's entire grant and re-consenting Gmail and
Calendar, which is deliberately deferred rather than done while Calendar is working.

#### Release lineage

| Component | Source | Image |
|---|---|---|
| api | `a5bbc48` | `sha256:08f1e395b32401a1…` |
| worker | `a5bbc48` | `sha256:79c18373dfbe529f…` |
| web | `a5bbc48` | `sha256:3215679bc0b9d658…` |
| postgres | unchanged | `sha256:d4bb0a8c1b7bb2e2…` |

Rollback tags `personal-os-{api,worker,web}:pre-phase7` were created **by digest resolved
server-side into a variable** before any build — never `docker commit`, never a transcribed digest
(the 6.7B transposition lesson) — and each was re-inspected to confirm it still resolves to the
original: api `da08f150cd43…`, worker `5e3318a0a41d…`, web `36153ab10ed1…`.

Shipped as `git archive` of `a5bbc48` into a **new** `/home/himallinux/personal-os-7.8-release`; the
4.7, 5.7, 5.7.1 and 6.7 trees are all retained. Archive sha256
`d446b7d025f071937b245a5795b3f4f3619a8f3eb7a5971f8fb08541506f0b35`, **byte-identical on both ends**,
840 tracked files, containing **zero** `.env`, `google-services.json`, `node_modules`, `.git` or
keystore entries.

#### The 5.7 silent-no-op trap was cleared explicitly, not assumed

The migration runs **from the api image**, so the release image was built first and its contents
inspected before the migration was trusted: **16 `.sql` / 16 journal entries** inside the image, with
`0014` hashing `0a4213ff8ad47d30…` and `0015` hashing `a7ea1d38667da79a…` — identical to the local
files and to the release tree. The OAuth repair was verified **inside the built images** too: api
carries `include_granted_scopes "true"` for both Gmail and Health, and worker for Gmail.

**One real obstacle, and it is worth recording.** The first migrate attempt failed with
`url: ''` — compose passes `DATABASE_URL` to the api service but **not** `MIGRATIONS_DATABASE_URL`,
so drizzle-kit had no migrator DSN. Nothing was applied and the level stayed 14; the failure was
before any connection. Resolved by sourcing the production `.env` server-side and passing the
variable through with `-e`, never printing it — the 6.7B pattern. Worth knowing because the failure
message names the config file rather than the missing variable.

#### Migration result

| Check | Result |
|---|---|
| Tracked rows | 14 → **16** |
| New rows | `15` = `0a4213ff…` @ `1788120327047`, `16` = `a7ea1d38…` @ `1788236141589` — the **journal `when` values, not wall-clock** |
| Replay of 0000–0013 | none |
| Public tables | 28 → **37**; all nine `mail_*` / `monitor_*` present |
| Existing data | byte-identical to baseline — tasks 2 · notes 3 · inbox 6 · devices 2 · health_daily 145 · health_observations **0** |

**The Checkpoint 4.7 Gate C incident did not recur.** Postgres kept container `404de24ef86b`, image
`d4bb0a8c1b7b…`, `restarts=0` and start time `2026-08-30T03:23:21` across the migration and the
rollout; `personal-os_postgres_data` kept its `2026-08-15T17:32:00-05:00` creation timestamp. Every
command pinned `-p personal-os`, the production env file and both compose files, carried `--no-deps`,
and **never named `postgres`**.

#### Rollout and smoke

`up -d --no-deps --no-build --force-recreate api worker web`. All three recreated onto the new
digests with `restarts=0`; postgres untouched.

| Check | Result |
|---|---|
| API health | `{"status":"ok","db":"connected","worker":{"stale":false}}` |
| Phase 7 routes | `/mail-connections`, `/mail-digests/current`, `/monitor/targets`, `/monitor/incidents` all **200**, each honestly reporting `configured: false` |
| Phase 5/6 regression | `/today` 200 · `/health-summary` 200 · web 200 |
| Queues / schedules | 20 → **26** / 6 → **9**. `mail.gmail.sync-connection`, `mail.digest.generate` and `monitor.run` all persisted **`stately` / `retry_limit 0`** |
| Crons | `mail.gmail.sync-cron` `*/15`, `monitor.cron` `* * * * *`, `mail.digest.cron` `0 7 * * *` **tz=UTC** — see the note below |
| Heartbeat | fresh |
| Log secret scan | `ya29.`, `1//`, `refresh_token`, `client_secret`, `GOCSPX`, `access_token`, `ciphertext`, `auth_tag`, `Failing row contains` — **0 each** |
| Error-level lines | api **0**, worker **0** |
| Bindings / Serve | api `127.0.0.1:3000`, web `127.0.0.1:8081`, **Postgres unpublished**, both Serve routes **tailnet only**, no Funnel — identical to baseline |

**The consent repair is proven LIVE, not merely shipped.** The production Health authorize URL now
emits `include_granted_scopes=true`, `access_type=offline`, `prompt=consent` (forced, because the
connection is `needs_reauth`) and **exactly** the three `.readonly` Health scopes.

**`mail.digest.cron` is registered at 07:00 UTC**, because `MAIL_DIGEST_TIMEZONE` is not yet set.
Setting it requires a worker restart to re-register the schedule.

#### Still outstanding — all owner-interactive

No `GMAIL_OAUTH_*` credentials in production `.env` yet (0 keys), so mail routes correctly report
`configured: false`. No monitor target seeded, so monitoring reports **"No services are being
monitored yet"** rather than a clean bill of health. No `mail_digest` AI route registered. The Health
and Calendar connections remain `needs_reauth`. **No digest has ever been generated by a real
model.**

### Checkpoint 7.8A — OAuth consent model repair (COMPLETE, local only, 2026-09-01)

Repair of the defect Checkpoint 7.8's readiness review discovered, applied to **both** Google
integrations that build an authorization URL. **No deployment, no production change, no Google
Console action, no account reauthorization, no migration** — the level stays 16 `.sql` / 16 journal
entries, there is no `0016`, and `packages/db` is byte-unchanged. Branch `phase-7-mail-monitoring`,
four commits from `c779b58`.

#### The change is one line in each of two files, and both are mutation-proven

`packages/mail-providers/src/gmail-oauth.ts` and
`packages/health-providers/src/google-health-oauth.ts` now both send
**`include_granted_scopes=true`**. Nothing else about either authorization request changed, and a
test in each pins the exact parameter set so a stray addition fails rather than ships.

**Health was fixed in the same checkpoint because a one-sided fix is not a fix.** With Gmail
additive and Health not, reauthorizing Health would revoke Gmail and Calendar — the same incident,
during the recovery meant to end it. Health's fix covers **both** paths: forced consent and the
reconnect path an unattended refresh failure actually leads to.

`false` did not merely decline to widen the new TOKEN — it made the consent **non-additive**, so the
grant it produced *defined* the app's authority and everything previously granted was dropped.
Consent in Google's linked-app model is per **app**, and all three of this project's OAuth clients
share one Google Cloud project, therefore one consent screen, therefore **one grant set**. Separate
clients give separate tokens; they do not give separate grants.

**Two tests were CORRECTED rather than loosened**, because both pinned the defect as correct
behaviour and both carried a comment arguing for it:

| File | Was |
|---|---|
| `packages/mail-providers/src/gmail-oauth.test.ts` | `expect(…).toBe("false")` under *"Inheriting would silently widen the grant using the Calendar and Health scopes already held by the same Google account."* |
| `apps/api/src/routes/mail-connections.test.ts` | `expect(…).toBe("false")` under *"Never inherit the Calendar/Health grants held by the same account."* |

The route-level assertion is kept as well as the provider-level one, because that is the string a
real browser is actually sent.

**Mutation testing, both integrations.** A protection whose removal breaks nothing is not a
protection, so each line was reverted, the suite re-run, and the line restored.

| Mutation | Result |
|---|---|
| Gmail `include_granted_scopes` → `"false"` | 1 fails in `mail-providers`, 1 in the api route suite |
| Health `include_granted_scopes` → `"false"` | **2** fail in `health-providers` (forced **and** non-forced paths), 1 in the api route suite |

All green on restore.

#### What did NOT change

**Health still requests exactly ADR-046's three `.readonly` scopes** — activity_and_fitness, sleep,
health_metrics_and_measurements — and still never the fourth, `googlehealth.settings.readonly`, that
ADR-046 cut along with paired-device support. A test asserts all three end in `.readonly`, that
there are exactly three, and names the forbidden neighbours individually. Health's token lifecycle
is untouched: exchange, refresh, revoke and the `invalid_grant` → `needs_reauth` classification all
pass unchanged.

`gmail.metadata` remains the only scope requested, and a test now names every forbidden scope
individually — `gmail.readonly`, `gmail.modify`, `gmail.compose`, `gmail.send`, `gmail.insert`,
`gmail.labels`, `gmail.settings`, `mail.google.com`, `openid`, `userinfo.email`, `calendar`,
`fitness`, `googlehealth` — so a future edit that adds one fails in the suite rather than at a
consent screen. Token storage, AES-256-GCM encryption, the hash-only single-use OAuth state, its
expiry and its constant-time redirect binding are all untouched: **twelve** state-validation tests
still pass unchanged, including single-use consumption, replay rejection, expiry, the
different-redirect rejection, and *"does NOT spend the authorization code when the state is bad"*.

No Graph. No mutation capability. No route, schema, migration or storage change.

#### The honest cost, stated rather than discovered

The access token Google returns may now carry previously granted scopes as well, so **Checkpoint
7.2's assertion that Google echoed *exactly* `gmail.metadata` no longer holds.** That is accepted
because breadth of scope on a token is not capability exercised — `MailClient` exposes no send,
reply, modify, trash or label method to call, so ADR-052's rule is a type rather than a policy — and
because the alternative destroys two working integrations, which is a strictly larger loss of the
user's own access.

#### ⚠️ Google Calendar is a different case, and is deliberately NOT changed

| Integration | State |
|---|---|
| Gmail | **fixed** — `include_granted_scopes=true` |
| Google Health | **fixed** — `include_granted_scopes=true`, forced and reconnect paths |
| **Google Calendar** | **unchanged, and the knob does not exist to set** |

Calendar's Phase 4 flow is the native Play Services `AuthorizationRequest`
(`apps/mobile/modules/google-calendar-auth`). It builds **no OAuth URL** — it calls
`.setRequestedScopes(...).requestOfflineAccess(webClientId)` and hands back a `serverAuthCode` — so
there is no `include_granted_scopes` parameter to change. The API has no
`/calendar-connections/google/authorize-url` route at all; the only entry point is
`POST /calendar-connections/google`, which accepts a code the **Rabbit** obtained.

**Whether that flow is additive is UNVERIFIED, and the evidence does not settle it.** What the
incident shows is that Calendar's grant can be destroyed BY another consent — not that Calendar's
own consent destroys others. Proving or fixing it means a native-module change, therefore a new APK
and a `versionCode` bump, which is out of scope for a consent repair.

**The unknown is handled by ORDERING rather than by code**, and this is the operational rule that
falls out of it:

> **Reconnect Calendar FIRST, then Health, then Gmail.**

Calendar goes first precisely because it is the unknown: if its consent turns out to be
non-additive, whatever it drops is re-added by the two additive consents that follow. Reversed, the
last non-additive consent wins and the others die. **Any future Calendar reconnect must be followed
by re-consenting Health and Gmail**, until Calendar's behaviour is proven or changed.

#### Owner decisions recorded (2026-09-01, ADR-051a)

Both were taken after the OAuth root cause was established, not before it.

| Decision | Ruling | Effect |
|---|---|---|
| Production snapshot | **NO** | ADR-024 stays Locked and unamended. Refused on the merits: `0014`/`0015` are `CREATE TABLE`-only and alter no existing table, so the serving images stay forward-compatible and rollback is image-only — a dump protects against nothing a rollback does not already cover |
| `2026-09-04T20:08:25Z` milestone | **`waived_by_owner`** | ADR-052's gate existed so a Phase 6 incident could never be confounded with a Phase 7 change. That purpose is **discharged rather than skipped**: the incident occurred, was isolated in the owner's own Google Account, traced to one parameter, remediated and mutation-proven, with no data lost. Precedent: ADR-051's own pre-deployment wait was waived the same way in 6.7A |

**The waiver removes the waiting period and nothing else.** Every technical gate stands unchanged —
the consent repair must be verified before deployment, migrations still run from the newly built api
image with `--no-deps`, rollback images are still tagged by resolved digest first, and
`docs/ARCHITECTURE.md`'s frozen deployment order is untouched.

#### ⚠️ The owner's post-fix reconnection order must be reversed

The approving instruction lists the recovery as **Health → Calendar → Gmail**. That order can still
end with Health dead, and the reason is the one thing this checkpoint could not fix in code.

Calendar's additivity is **unverified** — its native Play Services flow exposes no
`include_granted_scopes` equivalent — so it must be treated as possibly non-additive. Walking the
owner's order from today's actual account state (`gmail.metadata` only):

| Step | Consent | Resulting grant |
|---|---|---|
| 1 | Health (additive) | `gmail.metadata` + health ✅ |
| 2 | **Calendar (unknown)** | if non-additive → **calendar only** — health destroyed ❌ |
| 3 | Gmail (additive) | calendar + gmail — **health still missing** ❌ |

Reversed, the unknown goes first and every later consent only adds:

| Step | Consent | Resulting grant |
|---|---|---|
| 1 | **Calendar (unknown)** | calendar (whatever it drops is not yet needed) |
| 2 | Health (additive) | calendar + health ✅ |
| 3 | Gmail (additive) | calendar + health + gmail ✅ |

**Reconnect Calendar FIRST, then Health, then Gmail.** This is not a preference; it is the only
ordering that is correct under the unverified case, and it costs nothing if Calendar turns out to be
additive after all. The same rule binds every future Calendar reconnect until that flow is proven or
changed.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **3009 tests / 21 turbo tasks** (3001 → **+8**), 0 of 21 cached, zero failing |
| 3 | No package decreased | mail-providers 113→**116** · health-providers 311→**315** · api 608→**609**; core 375 · db 79 · schema 255 · monitoring 132 · ai-providers 25 · api-client 121 · worker 409 · mobile 499 all unchanged |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly |
| 5 | Migration invariant | **16 `.sql` / 16 journal entries**, no `0016`; `packages/db` byte-unchanged |
| 6 | Mutation test | Gmail: 1 + 1 failures. Health: **2 + 1** failures. All green on restore |
| 7 | State validation | **12** mail OAuth state/redirect tests and the full health-connections route suite (**60**) pass unchanged — single-use consumption, replay rejection, expiry, redirect binding, and "does NOT spend the authorization code when the state is bad" |
| 8 | Token lifecycle | Health exchange / refresh / revoke and the `invalid_grant` → `needs_reauth` classification all unchanged |
| 9 | Production | **not contacted** |

#### Deliberately NOT done

No production reconnect, deploy, migration, Console action or account-permission change. No change
to the Calendar native flow (above). No Graph, no new scope, no new capability.

### Checkpoint 7.8 — Production readiness (READINESS COMPLETE; DEPLOYMENT **BLOCKED**, 2026-09-01)

Read-only throughout. **No production write of any kind**: no migration, no image build, no rollout,
no `.env` change, no target seeded, no AI route registered. Branch `phase-7-mail-monitoring`, HEAD
`79b6459`, clean tree, 44 commits ahead of `main`, no remote.

**Deployment did not begin, and must not, on two independent grounds. The second is the more
serious and was discovered by this checkpoint's own first-hand verification.**

#### Blocker 1 — ADR-052's deployment gate has not elapsed

ADR-052 (Locked) states production deployment "must not begin before the `2026-09-04T20:08:25Z`
monitoring milestone completes, so that a genuine Phase 6 production incident can never be
confounded with a Phase 7 change." Measured first-hand at the start of this checkpoint: now
`2026-09-01T14:46Z`, gate `2026-09-04T20:08:25Z` — **3 days 5 hours 22 minutes remaining.**

#### Blocker 2 — there IS a live Phase 6 production incident, and it is unresolved

The gate's stated purpose is no longer hypothetical. **Both Google OAuth connections in production
are dead.**

| Connection | State | Since |
|---|---|---|
| Google **Health** (`ac3d47ad-…`) | `status = needs_reauth`, `last_sync_error = oauth_invalid_grant`, failure class `auth_permanent`, `request_count = 0` | **2026-09-01T00:00:06Z** |
| Google **Calendar** (`a0cc5563-…`) | `status = needs_reauth`, `last_sync_error = auth_expired`, job retried 3× then failed | job failed **2026-08-31T23:15Z**; alert last sent **2026-08-25T21:55Z** |

**ADR-051 names this exactly:** "any later `invalid_grant`, unexpected reauthorization or credential
failure on this connection is a **production incident**." It happened, and it is recorded here rather
than absorbed.

**The deferred seven-day longevity observation has FAILED, and by a wide margin.** The production
Health connection was created and identity-verified at `2026-08-30T03:26:14Z` (Checkpoint 6.7B) and
its refresh grant was rejected at `2026-09-01T00:00:06Z` — a lifetime of **1 day 20 hours 34
minutes**. Measured instead from ADR-051's `2026-08-28T20:08:25Z` reauthorization anchor it is 3
days 4 hours. Either way it is far short of seven days, and ADR-051's instruction never to report
that observation as passed now resolves to a definite negative.

`request_count = 0` is the decisive detail: the pass failed **before any Google API call**, at the
refresh grant itself. The stored refresh token is present (ciphertext intact) and rejected — so this
is a dead grant, not an expired access token, and no amount of retrying fixes it. The access token's
own nominal expiry was `2026-09-01T00:00:32Z`, 26 seconds *after* the failure, which is consistent
with a proactive refresh being refused.

**Consequences, measured rather than assumed:**

- **Health sync has been stopped for 14+ hours.** Zero `health_sync_runs` since `00:30Z`; the pass
  now skips with `connection_not_active`. Newest `health_daily_metrics.local_date` is frozen at
  **2026-08-31**.
- **Calendar sync has been stopped for 7 days**, since 2026-08-25. The 15-minute cron still runs and
  still reports `completed` — because a skip is not a failure — so the queue looks healthy while
  nothing syncs.
- **No health data was lost.** 145 daily-metric rows (up from 6.7B's 137), 0 sessions, 0
  observations, 18 streams still enabled. The failure is a stopped integration, not data damage.
- **Nothing escaped as an error.** Zero API error-level log lines and zero worker error lines in the
  window; both failures were classified into durable columns exactly as designed.

**A real latent defect is now CONFIRMED live, not merely predicted.** ADR-055 was written against
the `calendar-needs-reauth:${connectionId}` dedupe key having no time or incident discriminator, on
a `notification_dispatch_log.dedupe_key` that is a permanent primary key with no TTL. Production
proves the consequence: that key was `accepted` on **2026-08-25T21:55:22Z**, and when the calendar
connection failed again on **2026-08-31T23:15Z the owner was never told**, because the key was
already burned. Health's key carries a failure-class discriminator
(`health-sync-alert:…:auth_permanent:…`) and did fire correctly — 2 seconds after its failure. So
one integration alerted and the other could not, for exactly the reason ADR-055 records.

#### ROOT CAUSE — ESTABLISHED, and it is ours

Read first-hand from the owner's signed-in Google Account (read-only; nothing was revoked, removed
or changed). **Checkpoint 7.2's Gmail consent REPLACED the entire "Personal OS" grant.**

The account's *Linked apps → Personal OS → Access you've given* panel reads:

| Field | Value |
|---|---|
| Access given on | **2026-08-31, 6:04 PM local = 2026-08-31T23:04Z** |
| Web address | `https://personal-os.tail62a68f.ts.net` |
| Personal OS can | **`gmail.metadata` only** — *"View your email message metadata, such as labels and email headers (From, To, Subject, etc.), but not the email body"* and *"Search your email messages based on message metadata"* |

**The three Google Health scopes and the two Google Calendar scopes are gone from the account
grant.** That was falsified rather than assumed: filtering the linked-apps list by **Calendar (9)**
returns nine apps and **Personal OS is not one of them**.

The timeline is then exact, and each failure is simply the next token refresh after the grant set
changed:

| Time (UTC) | Event |
|---|---|
| **2026-08-31 23:04** | Gmail consent granted — app grant redefined to `gmail.metadata` alone |
| 2026-08-31 23:15 | Calendar sync fails `auth_expired` (**+11 min**) |
| 2026-09-01 00:00:06 | Health refresh grant rejected `invalid_grant` (**+56 min**) |

**The mechanism is one line, and the intent behind it was good.**
`packages/mail-providers/src/gmail-oauth.ts:97`:

```ts
// Never silently widen a grant by inheriting scopes from another client.
url.searchParams.set("include_granted_scopes", "false");
```

That is a least-privilege instinct, and in isolation the reasoning is sound: do not let a Gmail
token quietly acquire Calendar or Health authority. But `include_granted_scopes=false` does not
merely decline to widen *this token* — it makes the consent **non-additive**, so the resulting grant
*defines* what the app may do and everything previously granted is dropped.

**The separation ADR-053 relies on is real at the token level and absent at the consent level.**
ADR-053 reasoned that a third OAuth client in the existing project preserves the precedent that "a
token minted for one integration is never reused for another". Tokens are indeed separate. But all
three clients live in one Google Cloud project, which means **one consent screen, one linked app,
and one grant set** — so consenting for one client redefines the authority of all three.

The near miss makes this sharper rather than softer: the same file already guards the *adjacent*
hazard, documenting that `prompt=consent` on every reconnect "would slowly destroy older grants --
including, in this project, the Calendar and Health ones, which share the same Google account." The
shared-account risk was understood; it was closed on one door and left open on another.

**This is reproducible and it WILL happen to production.** The moment the owner grants Gmail consent
against the production callback, the production Health and Calendar connections die exactly as the
development ones did. That converts Checkpoint 7.8 from "blocked on a date" into "blocked on a
defect", and it must be fixed before any Gmail consent is granted in production.

**The fix is `include_granted_scopes=true`** — Google's documented incremental authorization, which
makes the consent additive so Gmail is granted *alongside* Health and Calendar. The honest cost is
the very thing the comment was defending against: the token Google returns may then carry the
previously granted scopes as well. That trade is worth taking, because the alternative is destroying
two working integrations, and because breadth of scope on a token is not capability exercised — the
Gmail client can only call Gmail endpoints. Two consequences must be handled deliberately rather
than discovered: Checkpoint 7.2's assertion that "Google echoed **exactly** `gmail.metadata`" stops
being true, and **ADR-053 needs an amendment**, because its client-separation reasoning is what this
finding corrects.

The alternative fix — a separate Google Cloud project for Gmail, giving a genuinely independent
consent screen — is **forbidden by ADR-051** ("no second development OAuth application, client,
project, account or credential set exists or may be used") and is not adopted here.

**Neither fix is applied in this checkpoint.** 7.8 is a release checkpoint, and changing OAuth
consent semantics is an owner decision with an ADR amendment attached, not a quiet edit during a
deployment. **Recovery of the two dead connections additionally requires interactive consent in the
owner's browser and cannot be performed by an agent.**

#### Production baseline, verified first-hand (the 7.8 rollback anchor)

| | Value |
|---|---|
| Containers | api `608bf044a82e` · worker `2122152c78ce` · web `2eee2b4490e7` · postgres `404de24ef86b` — **all `restarts=0`**, up 2 days |
| Image digests | api `sha256:da08f150cd43…` · worker `sha256:5e3318a0a41d…` · web `sha256:36153ab10ed1…` · postgres `sha256:d4bb0a8c1b7b…` — **identical to the 6.7B record** |
| Migration level | **14** (`0013_google_health_sync`, hash `21149ee9…`), 28 public tables, **zero** `mail_*` or `monitor_*` tables |
| Volumes | `personal-os_postgres_data` (created 2026-08-15) · `personal-os_audio_data` (2026-08-19) — identities unchanged |
| Queues / schedules | 20 / 6 — **zero** Phase 7 queues, as expected |
| Jobs | 30 216 `completed`, **1 `failed`** — the calendar `auth_expired` above, no other failure |
| Health endpoint | `{"status":"ok","db":"connected","worker":{"stale":false}}` |
| Bindings | api `127.0.0.1:3000` · web `127.0.0.1:8081` · **Postgres publishes no host port**; Tailscale listens only on the tailnet interface (`100.117.78.19`, `fd7a:…`), never `0.0.0.0` |
| Serve | both routes **tailnet only**, no Funnel |
| Log secret scan | `ya29.`, `1//`, `refresh_token`, `client_secret`, `GOCSPX`, `access_token`, `ciphertext`, `auth_tag`, `Failing row contains` — **0 hits each** across api and worker |

#### Production configuration review — three gaps identified, none surprising

Verified by **name, length and shape only**; no value was read, printed or logged.

`/home/himallinux/personal-os/.env` is mode `600`, owner `himallinux`, **14 keys**.
`CREDENTIALS_ENCRYPTION_KEY` is present at 43 characters — base64 of 32 bytes, the AES-256-GCM key
Phase 7 credential storage requires — so **no new encryption key is needed.**

| Gap | Detail |
|---|---|
| **`GMAIL_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` are absent** | Expected. Provisioning them is an **owner action** through the silent-shell precedent (6.2 / 6.7B). The redirect must be the **production** callback `https://personal-os.tail62a68f.ts.net/mail-connections/gmail/callback` that Checkpoint 7.2 registered — never the development loopback |
| **`MAIL_DIGEST_TIMEZONE` is absent** | Defaults to **UTC**. The digest's identity is `(digest_date, timezone)`, so this is a product decision the owner should make deliberately rather than inherit |
| **No `mail_digest` AI task route exists** | Production has exactly `capture_parser`, `daily_brief`, `voice_transcribe`. Without it `POST /mail-digests` returns `409 no_provider_configured` and the cron persists nothing |

**A credential-less deployment is safe, and that is proven rather than assumed.** All three Gmail
variables are declared in `docker-compose.yml` as `${VAR:-}` — api at lines 61–63, worker at 98–99
plus `MAIL_DIGEST_TIMEZONE` at 104 — and both `env.ts` files read them through `optionalNonEmpty()`,
which is the pairing that stops the empty string `${VAR:-}` actually produces from throwing at
import and killing both processes. Five api tests assert the `409 mail_not_configured` degradation.
The worker deliberately receives the id and secret but **not** the redirect URI, because it only
refreshes tokens and never serves the callback.

**Monitoring:** the `monitor:seed` CLI is real — `apps/api` script `seed-monitor-targets.ts`. It
seeds `http://api:3000` and `http://web:8080` by default and is idempotent (reports created vs
already-present). The two tailnet targets stay **env-gated** behind `MONITOR_TAILNET_API_ORIGIN` /
`MONITOR_TAILNET_WEB_ORIGIN`; Checkpoint 7.7 proved the worker container can reach those routes, so
7.8 may set them — but seeding remains an explicit operator action, not a deployment side effect.
The heartbeat watchdog is registered in `apps/api/src/server.ts` and needs no configuration.

#### Migration review — additive, forward-only, and safe to roll back around

Production would move **14 → 16**. Both migrations were re-read rather than trusted:

| | `0014_mail_integration` | `0015_service_monitoring` |
|---|---|---|
| sha256 | `0a4213ff8ad47d30…` | `a7ea1d38667da79a…` |
| Creates | 6 tables | 3 tables |
| Indexes / constraints | 9 / 12 | 4 / 12 |
| `DROP` / `TRUNCATE` / `DELETE` / `UPDATE` / `ALTER COLUMN` / `RENAME` | **none** | **none** |
| Pre-existing table altered | **none** | **none** |

Every `ALTER TABLE` targets a table created in the same file, and the only apparent destructive
matches are `ON DELETE cascade` / `ON UPDATE no action` clauses inside `ADD CONSTRAINT` — checked
verbatim rather than by count. **The single point of contact with the existing schema is
`mail_digests.model_id → ai_models(id) ON DELETE SET NULL`**, which nulls a reference rather than
cascading a delete.

Because both are purely additive, **the currently-serving images run correctly against the level-16
schema** — they simply never query the new tables. That is what makes an image rollback real
without a schema rollback, exactly as `docs/ARCHITECTURE.md`'s frozen deployment order requires. A
schema rollback is never performed.

`db:reconcile --check` on dev: **tracking table consistent with the journal**, 16 skipped
below-watermark, 0 reconciled.

#### Rollback readiness

| | |
|---|---|
| **Currently-serving commit** | `c0dbff3` (Checkpoint 6.7B), source tree `/home/himallinux/personal-os-6.7-release` — **retained**, along with the 4.7, 5.7 and 5.7.1 trees |
| **Rollback images** | api `sha256:da08f150cd43…` · worker `sha256:5e3318a0a41d…` · web `sha256:36153ab10ed1…`. 7.8 must tag these **by resolved digest** as `pre-phase7` *before* building — never `docker commit`, and never a hand-copied digest (the 6.7B transposition lesson) |
| **Migration state** | 14 now; 16 after. Rollback is **image-only**; the schema stays at 16 |
| **Backup** | **There is none, by design.** ADR-024 is Locked and `/home/himallinux/personal-os-deploy-snapshots/` is **empty** — 6.7B's one-off snapshot was deleted at closure. Any pre-migration snapshot for 7.8 is a fresh, explicitly-approved owner decision |
| **Recovery** | `up -d --no-deps --no-build --force-recreate api worker web` against the `pre-phase7` tags. Every command pins `-p personal-os`, `--env-file /home/himallinux/personal-os/.env`, both compose files, and `--no-deps`; `postgres` is **never** named as a target (the Checkpoint 4.7 Gate C incident) |
| **Mobile** | Forward-only. No `versionCode` was built or installed; the Rabbit stays on **7** |

#### Security audit

`gitleaks git`: **231 commits, no leaks.** Working tree: 16 findings, **all in git-ignored files, 0
in any file git would commit**, classified with `git check-ignore` rather than asserted.

Production web bundle, read from **inside the running container**: the tailnet API URL appears once
and `localhost:3000` / `127.0.0.1` **zero** times. A local `expo export` does show `localhost:3000`,
because the developer's own git-ignored `apps/mobile/.env` supplies the dev URL — that file is
untracked, so `git archive` never ships it and the image is built from the compose build arg sourced
from `PUBLIC_API_URL`. Verified on the deployed artifact rather than reasoned about.

Freshly built bundle scan — `gmail.googleapis.com`, `GmailApiError`, `mail_sync_cursors`,
`monitor_checks`, `monitor_targets`, `drizzle-orm`, `pg-boss`, `encryptSecret`, `GOCSPX`, `ya29.`,
`client_secret`, `refresh_token`, `node:tls`, `node:fs`, `node:module` and **"worker healthy"** all
**absent**.

#### Local gate at `79b6459`

build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0 warnings** · `prettier --check .`
clean · `git diff --check` clean · full suite **uncached and serial, 0 of 21 cached: 3001 tests / 21
turbo tasks**, zero failing · `calendar-providers` canary **74**, held · **16 `.sql` / 16 journal
entries**, no `0016`.

#### What 7.8 still needs, in order

1. **Resolve the Phase 6 incident first.** Owner-only: reauthorize Google Health and Google Calendar
   in their browser, and check the Google Account security page for what revoked the grants. Phase 7
   must not be deployed on top of an unresolved Phase 6 failure — that is the confounding ADR-052's
   gate exists to prevent, and it is now a live condition rather than a precaution.
2. **Wait for `2026-09-04T20:08:25Z`.**
3. Owner provisions the three `GMAIL_OAUTH_*` values and decides `MAIL_DIGEST_TIMEZONE`.
4. Owner decides whether a pre-migration snapshot is taken (ADR-024 says no by default).
5. Then the mechanical deployment: tag rollback images by digest → ship `git archive` to a new
   `personal-os-7.8-release` → build → **verify the new api image actually contains `0014`/`0015`**
   (the 5.7 silent-no-op trap) → migrate from the new image with `--no-deps` → roll out → smoke →
   seed monitor targets → register the `mail_digest` route → owner grants Gmail consent.

#### Deliberately NOT done

No feature, no redesign, no Graph, no scope change, no migration. No production mutation of any
kind — every command this checkpoint ran against production was a read. Checkpoint 7.8's deployment
has not begun.

### Checkpoint 7.7 — Hardening + full live proof (COMPLETE, local only, 2026-09-01)

Validation and hardening. **No redesign, no new integration, no new UI feature, no new table and
no migration** — the level stays 16 `.sql` / 16 journal entries, there is no `0016`, and
`packages/db` is byte-unchanged. Branch `phase-7-mail-monitoring`, **four** commits from `069477b`
(`1d58e33` … `6c52e2a`) after the linearization recorded below.

**Production was read only, never written.** Four containers up 2 days, migration level **14**,
unchanged before and after.

#### Live proofs actually run

Every one against real code and real Postgres. Throwaway scripts, deleted immediately, matching the
7.2P precedent; evidence below is counts, statuses and shapes only.

| Proof | How | Result |
|---|---|---|
| **Service monitoring** | `runMonitorPass` — the exact function the pg-boss handler calls — against a **real local HTTP server** | **33/33**, 10 real requests |
| **Worker heartbeat + TLS** | the API's `runHeartbeatWatchdog`, and `probeTls` against a **real TLS handshake** on a self-signed 40-day cert | **20/20** |
| **Mail sync** | `runMailConnectionSync` against the **real Gmail API** | **1019 live requests**, all GET |
| **Digest + adversarial corpus** | the real pipeline against a **local fake OpenAI-compatible server** | **39/39** |
| **Notifications** | real **pg-boss**, reading `pgboss.job.start_after` | **18/18** |
| **Security audit** | canaries through logs, rows, errors, job output, payloads | **8/8** |

**Mail lifecycle, in detail.** First sync persisted **500 messages in 506 requests** and minted a
7-digit `historyId` cursor. An incremental pass then picked up a genuinely new message in **3**
requests — which is the cursor earning its place, and is why the pass that "failed" an assertion
expecting a quiet mailbox was better evidence than a quiet one. Two consecutive replays inserted
**0** with **1 request each**. An empty delta (Gmail omits the `history` key entirely) was handled
as "nothing changed" rather than crashing.

**Cursor expiry is proven end to end against real Gmail.** Setting the cursor to `1` produced a real
HTTP 404, and the audit trail shows the transition in order: `incremental:failed` →
`full:succeeded`, with `cursor_expired = true` on the failed run, a new cursor minted, and — the
decisive part — **zero duplicate `(connection, external_id)` identities** after a full resync over
500 already-known messages.

**Adversarial corpus.** Ten hostile subjects and display names — instruction injection, fake
authority, role-play, a fake `<tool_call>`, URL injection, a JSON-escape attempt, a literal
`</snapshot>`, unicode direction marks, and both credential- and token-shaped text. Against the
exact prompt bytes the fake model received: untrusted text **never reached the system role**, the
request carried **exactly two message roles and no `tools`/`functions` key**, the fenced payload
**parsed as valid JSON**, no forged `"role":"system"` appeared, and the persisted output carried no
scheme URL, no `www.` host and no address.

Two things are worth stating precisely because they are stronger than expected. The literal
`</snapshot>` **does** appear in the prompt — `JSON.stringify` escapes quotes, backslashes and
control characters but not `<` or `>` — and it is inert, exactly as Checkpoint 7.4 recorded; parsing
is what proves the structure held. And an attacker's newlines do not survive to be escaped at all:
`stripUnsummarizableCharacters` turns every whitespace control into a space **before** serialization,
so three lines arrive as one and `SYSTEM:` can never begin a physical line of the prompt.

The payload's top-level keys are exactly `generated_at, tz, local_date, window_hours, summary,
categories, senders, highlights` — **no `from_address`, no `from_domain`, no ids, no uuids**. Under a
60-message flood of 5000-character subjects the payload stayed at **5988 characters** against the
12000 ceiling while `total_count` still reported the true **60**.

**Notifications.** With one awake device and one inside `22:00–06:00 America/Chicago`, the digest
enqueued one job per device; the sleeping device's `pgboss.job.start_after` was **exactly 420 minutes
out** — 23:00 to 06:00 — and the awake device's was immediate. An **alert** to the same sleeping
device was **not** deferred. Dedupe keys carry the date, differ across days, and an `accepted` row
blocks a re-send while tomorrow's key stays claimable despite today's permanent failure.

#### One real defect, found by the live proof rather than by review

**`probeHttp` recorded the timeout duration as a latency.** A real 1000 ms timeout against a real
hanging server stored `latency_ms: 1006`. That number describes OUR timeout, not the service — the
service answered nothing — and it would put a fictional point in any latency view. It is the same
missing-versus-measured collapse the rest of the schema is built to prevent: the column is nullable
precisely so "no response" can be expressed, and `read-models.test.ts` already asserted a null
latency is legal, but the writer never produced one, so the distinction could not occur in practice.
Both transport failures now record null; a response that ARRIVED and was judged unhealthy still
records a real latency, which is what makes the null meaningful.

#### The five known issues, audited

1. **`Alert.alert` on web — CONFIRMED, and now fixed.** `react-native-web@0.21.2` ships
   `class Alert { static alert() {} }`. The confirm callback never fires, so a destructive button is
   not "unconfirmed" — it is **inert**. 7.6 fixed the two sites it added; **7.7 swept the remaining
   nine** (Revoke, both calendar Disconnects, Forget-this-device, the four 6.5 Archive gates, the
   recurring-occurrence Cancel). **Two remain and neither is a defect**: `exact-alarm.ts` returns
   early unless `Platform.OS === "android"`, and `quick-add-fab.tsx` is a one-button informational
   notice with no action to lose. A `confirmation-hygiene` guard now prevents a tenth, and checks
   the allowlist itself for drift.
2. **Gmail callback UX — fixed.** The callback now content-negotiates: a browser gets a static
   readable page, and an API client (including a wildcard-only `Accept`, which is what curl sends)
   still gets JSON. Both pages are static and carry no address, token, uuid or authorization code;
   the failure page carries the static error code only, validated against `/^[a-z_]+$/`.
3. **Worker-to-Tailscale reachability — RESOLVED. ADR-055's recorded blind spot is closed.**
   Probed read-only from inside the running production worker container: `wget` returned **HTTP 200**
   on both Serve routes, Node's own `fetch` — which is what `probeHttp` uses — returned **HTTP 200**,
   and a `node:tls` handshake from the same container read the peer certificate with **73 days**
   remaining. The two tailnet targets are therefore genuinely seedable; actually seeding them is a
   production action and belongs to 7.8.
4. **Typecheck of every changed surface — clean.** build 11/11, typecheck 21/21.
5. **vitest/typecheck mismatch — audited, and the repository is fine.** A canary type error planted
   in a test file is caught in **all four** package types, so `pnpm typecheck` genuinely covers
   tests. The gap is real only in transpile-only `tsx` scratch scripts — and it bit twice during
   this checkpoint, which is recorded below because the lesson is about method, not code.

#### Mutation testing: 9 of 9 protections are load-bearing

Each guard was broken, the suite re-run, and the guard restored. A protection whose removal breaks
nothing is not a protection.

| Mutation | Result |
|---|---|
| Stop stripping unsummarizable characters | 5 tests fail |
| Digest dedupe key loses its date | 2 fail |
| `nextQuietHoursEnd` never defers | 6 fail |
| A Gmail 404 no longer classifies as `cursor_expired` | 1 fail |
| Skipped checks reach threshold evaluation | 1 fail |
| Monitor dedupe key becomes target-scoped | 2 fail |
| Transport failure records elapsed time as latency | 2 fail |
| `not_checked` collapses into `up` | 1 fail |
| Heartbeat says "worker healthy" | 2 fail |

#### Security audit: nothing crosses

Seven canaries — a secret in a target URL, an access token, a refresh token, a client secret, a
subject line, an address, and a Postgres `Failing row contains` detail — were pushed through a
failing monitoring pass and a contained job error, then hunted for in: **worker logs**, **durable
`monitor_checks` rows**, **`MonitorJobError`/`MailJobError` serialization**, **`pgboss.job.output`**
(the table `serialize-error` writes into), and **notification payloads**. **Zero hits in all five.**
API responses are covered by the route tests' own credential-shaped assertions.

#### The history was linearized, and the repaired tree is provably the audited one

The commit-prefix independence check — the discipline Checkpoints 6.5 and 6.7A established — **failed
on the first attempt, for three of five prefixes.** The probe latency fix and the union narrowing its
own test needs had been split across two commits, so every prefix between them failed `tsc`:
`ProbeOutcome`'s `up` variant carries no `failureClass`, and reaching through the union without
narrowing is a type error vitest runs straight past.

That is exactly the 6.5 entanglement class, and ordering cannot fix it — the reaching-through test
lives in the earlier commit, so only combining works. Repaired the same way 6.5 was: the original tip
was preserved as tag `cp77-pre-linearize` (`0d8caf0`) and never rewritten, the two entangled commits
were **committed together**, and the other three were re-applied in their original order.

**The repaired tree is byte-identical to the audited one.** `git rev-parse HEAD^{tree}` at `6c52e2a`
equals the preserved tag's tree, `15528636bb2cb153d92e4956c022c6f85269b6cb`, and
`git diff cp77-pre-linearize 6c52e2a` is **empty** — so the 3001-test gate recorded below measures
the same bytes either way, and this documentation paragraph is the only deliberate difference on the
branch afterwards.

All four prefixes now build and typecheck independently, and `@personal-os/monitoring`'s **132** tests
pass at the previously-failing one.

#### Two method lessons, recorded because they nearly produced false evidence

**`tsx` does not typecheck.** A proof script used `.cursor` where the Drizzle field is `.cursorValue`.
It compiled, the update silently set nothing, and the cursor-expiry assertion **passed against an
unexpired cursor** — a green result proving nothing. Caught by noticing the pass made 1 request where
a resync needs ~500. Every suspicious PASS in this checkpoint was re-derived rather than accepted.

**A closed server still serves pooled connections.** `server.close()` stops new connections but keeps
established keep-alive sockets, and undici pools them — so a probe against a "closed" port succeeded.
The harness now calls `closeAllConnections()` and awaits the close. The isolated probe was correct
all along; the harness was not.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **3001 tests / 21 turbo tasks** (2987 → **+14**), 0 of 21 cached, zero failing |
| 3 | No package decreased | monitoring 128→**132** · api 603→**608** · mobile 494→**499** · core 375 · db 79 · schema 255 · mail-providers 113 · api-client 121 · health-providers 311 · ai-providers 25 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly |
| 5 | Migration invariant | **16 `.sql` / 16 journal entries**, no `0016`; `packages/db` byte-unchanged |
| 6 | Bundle safety | `expo export --platform web` clean, exactly one `index.html`; `node:tls`, `node:module`, `node:fs`, `drizzle-orm`, `pg-boss`, `monitor_checks`, `mail_digests`, `probeHttp`, `gmail.googleapis.com`, `GOCSPX`, `ya29.` and **"worker healthy"** all **absent** |
| 7 | The one `node:crypto` in the bundle | **vendor, not ours.** It is inside expo's own uuid module, behind `typeof window` and an `eval('require')`, dead on web. `apps/mobile` imports **no** `@personal-os/core` barrel — only `@personal-os/core/recurrence/editor`, `@personal-os/api-client` and `@personal-os/schema` |
| 8 | Production | read-only; 4 containers **up 2 days**, migration level **14**, unchanged |
| 9 | Secret scans | `gitleaks git` clean |
| 10 | Cleanup | every probe script deleted; test database fully cleared; no repository process running |

#### State left behind, stated precisely

The **dev** database holds the live-proof end state: 1 active mail connection, **501 header-only
message rows**, 1 cursor, 7 sync runs. That is the integration in its working condition and is useful
to 7.8; there are no body, snippet or payload columns for it to be more than metadata. **No digest
row exists in dev** — the digest proof ran entirely in the test database against a fake model and
cleaned up after itself, so **no digest has ever been generated by a real model**. The **test**
database is empty of every proof artifact. `health_observations` is **0** in both.

#### Deliberately NOT done, and what is gated on the owner

No migration, no `0016`. No production write of any kind. No monitor target seeded — `monitor:seed`
is an operator action, and the now-proven tailnet targets belong to 7.8. No `mail_digest` AI route
registered against a real provider. No Graph, no new integration, no new UI feature.

**Four things could not be proven without the owner and are NOT claimed:**

- **OAuth connect / reconnect** needs interactive consent in the owner's browser. Checkpoint 7.2
  proved it live and that evidence stands; 7.7 did not repeat it, and deliberately did not
  disconnect the working connection to re-prove a flow it could not then restore.
- **Revoked-token behaviour** would mean actually revoking the grant, which would break the
  connection 7.8 needs. The classifier path is covered by tests; a live revocation is not claimed.
- **Physical push delivery** needs the Rabbit and a real Expo push token. Everything up to the Expo
  call is proven live; delivery is not.
- **A real (paid) model call** for the digest. The local fake follows Checkpoint 5.5's precedent and
  is the stronger choice for the adversarial corpus, because it records the exact prompt bytes.

**Gmail `history.list` PAGINATION is partially proven.** The full-sync path genuinely paginated —
500 messages across its page bound, with `truncated: true`. `history.list`'s own `nextPageToken` was
not exercised, because the live deltas were one message; 7.2P confirmed the token exists and the
scripted fake covers the multi-page path.

### Checkpoint 7.6 — UI + notification integration (COMPLETE, local only, 2026-09-01)

Local development only. **No production access, no deployment, no migration** — the level stays
16 `.sql` / 16 journal entries, there is no `0016`, and `packages/db` is byte-unchanged. No Graph,
no new mail capability, no hardening pass, no adversarial-testing checkpoint work. Branch
`phase-7-mail-monitoring`, six commits from `986521d` (`184c6f5` … `3a74241`).

**Nothing has been monitored and no digest has been generated.** `monitor_targets`,
`monitor_checks`, `monitor_incidents` and `mail_digests` are empty in every database; the only mail
row anywhere is the development connection 7.2 deliberately left active. Every surface below is
proven against fixtures, injected clocks and real Postgres.

#### What shipped

| Surface | What it does |
|---|---|
| Settings → **Mail** | connection state, the mailbox address, connect/reconnect, disconnect, refresh |
| Settings → **Service monitoring** | a summary line and a way through to the screen |
| **`/monitor`** | every target with its newest check, plus incident history and acknowledgement |
| **Today** | ONE new card: the mail digest |
| **Notifications** | monitoring alerts already dispatched (7.5); the digest notification is new |

Five API routes, five api-client methods, two query-hook files, six pure modules. **No new tab, no
new notification category, no new device column, no new dependency** — `apps/mobile` still declares
exactly three `@personal-os/*` dependencies, which is the only thing keeping
`@personal-os/monitoring` (and its `node:tls` import) out of the web bundle.

#### The three things the UI is not allowed to say

Each is enforced by a test rather than by a review note.

- **"worker healthy" appears nowhere.** A test asserts the word *healthy* is absent from every
  heartbeat state, and the web bundle was grepped for the phrase. The heartbeat proves a process
  wrote a row on its beat cron; ADR-055 records that a hung or fast-crash-looping worker still looks
  alive to the watchdog. The wording is **"Heartbeat received."**
- **There is no uptime percentage.** The honest version of that number has three states, which is
  exactly why `MonitorUptimePointSchema` carries a refine making `not_checked` with a ratio
  unrepresentable. Shipping a percentage before a read model can express the third state would walk
  into the `0%`-for-a-gap failure that schema exists to prevent. A never-checked target reports
  *"No check has run yet"* — not up, not down.
- **No provider text reaches a screen.** `last_sync_error` arrives as a closed enum and is mapped to
  words by `mailSyncErrorCopy`; a test asserts the copy for every member never contains the raw
  code, so a bare token like `cursor_expired` cannot face the user.

`configured: false` renders as *"No services are being monitored yet"*, never as a clean bill of
health — and that is not an edge case. **No target has ever been seeded in any environment**, so it
is the state every reader sees today.

A load error reports *"Can't reach Personal OS"* rather than *"not connected"*, for both mail and
monitoring. Falling through to "not connected" would tell someone their Gmail link is gone when the
tunnel is down, inviting them to mint a new grant to fix a network problem.

#### Quiet hours now DELAY the digest notification instead of dropping it

ADR-053 amendment E names a defect that was live. `notifications.dispatch` drops a non-`alert`
notification for any device inside its quiet hours, and the drop is total: the device never enters
`targets`, so `claimTarget` is never called, so **no `notification_dispatch_log` row is written** —
and the handler then returns normally, so pg-boss marks the job completed and never retries. For a
capture confirmation that is survivable. For a digest generated by a fixed-hour cron it means a user
whose quiet hours span that hour is **never told, every day, permanently, with no row and no log
line**.

The fix is scheduling, not exemption. A new `nextQuietHoursEnd` in `packages/core` answers when a
device's window ends, and each device's job is enqueued with pg-boss's `startAfter` set to that
instant — so it simply *arrives* later and the router's own unchanged check passes.
**`notifications-dispatch.ts` is byte-untouched**; its quiet-hours test becomes a safety net rather
than the dropper. Exempting digests was rejected because quiet hours exist precisely so a 07:00
digest does not wake someone at 03:00 in their own zone; a `deferred` column was rejected as a
schema change to solve a scheduling problem the queue already solves.

**The no-loop property was proven exhaustively, not argued.** A scratch harness ran
`nextQuietHoursEnd` over **53,372 deferral instants** — 9 timezones including half-hour and
45-minute offsets and Lord Howe's 30-minute DST, 6 window shapes, 40 days spanning both DST
transitions — asserting that the returned instant is never itself inside quiet hours, never in the
past, and never null while inside. **All three bug classes: zero.** The only outliers were 7 waits
longer than 24 hours, every one a 23h59m quiet window on a 25-hour fall-back day, which is the
correct answer rather than a defect.

**Digest pushes are opt-in and need no new column.** `devices.notify_digests` already defaults to
`false` and already has a Settings toggle, so a digest notification reaches only devices where the
user turned Digests on — which matches `ARCHITECTURE.md`'s routing table exactly.

The dedupe key is `mail-digest:${digestDate}:${timezone}`. The date is load-bearing:
`notification_dispatch_log.dedupe_key` is a permanent primary key with no TTL and no cleanup job, so
a key without a per-occurrence discriminator burns itself on its first success and the digest can
never notify again — the defect the pre-existing `calendar-needs-reauth` producer has. The push body
is a fixed literal plus the date and carries **no** subject, sender, address or URL (ADR-054): the
digest text is model prose derived from attacker-authored subject lines, and a push renders on a
lock screen.

#### Two decisions worth recording because the obvious choice was wrong

**The digest read takes no `tz`.** A digest's identity is `(digest_date, timezone)` where the zone is
the *worker's* configuration, for the reason `resolveDigestTimezone` records: a cron has nobody to
ask. A client passing its own zone against a server configured for UTC — the default — would find no
row and see an empty digest forever while one sat in the table, generated an hour earlier under a
different key. The route returns the digest the server actually has, and the row carries its own
date and zone so the card can say what it covers.

**`POST /mail-digests` enqueues and returns 202; it does not generate.** The Daily Brief generates
synchronously in the API, but the digest pipeline lives in `apps/worker` and the API must never
import from it. So the manual path enqueues the same job the cron enqueues — and a 202 means the
work was accepted, **never** that a digest exists, which the card's copy says in as many words. What
keeps that honest is that every synchronously-decidable precondition is checked first, in
most-fundamental-first order: telling someone "no AI provider" when the real problem is that no
mailbox is connected sends them to configure the wrong thing.

#### The acknowledge route exists because the naive one would be wrong

`acknowledgeIncident` is idempotent **by exclusion** — its WHERE carries `ne(status,
"acknowledged")` and `isNull(resolvedAt)` — so it returns `undefined` for three genuinely different
situations: the incident does not exist, it is already acknowledged, or it already resolved. Mapping
all three to 404 would 404 on a double-tap of a button that had just succeeded, which is the most
likely thing a user does. The row is read first, an already-resolved incident gets its own `409
incident_already_resolved`, and a repeat acknowledge succeeds with the original timestamp preserved.

Acknowledgement is presented as what it is: the confirmation says the target stays marked down until
it recovers on its own. Treating an Ack button as "make it go away" is how an outage stops being
tracked while it is still happening.

#### Two real defects, both found by a test rather than by review

1. **`nextQuietHoursEnd` skipped a calendar date across a spring-forward.** The first version
   advanced to "tomorrow" by adding 24 hours of elapsed time. From 23:00 on the day before a
   spring-forward that lands at 00:00 the day *after* the intended one, because the intervening local
   day is only 23 hours long. It now advances by calendar date and resolves back through the zone, so
   a 06:00 boundary stays 06:00 local whether the day is 23, 24 or 25 hours.
2. **`resolveMonitorTargetState` read `Date.now()` internally**, making a pure module
   non-deterministic and its mute-expiry boundary untestable — the test failed against the real
   clock. `now` is injected, matching `describeLastCheck` beside it and every dated helper in
   `packages/core`.

A third, smaller correction is worth recording because of *how* it was missed: several
`resolveMonitorTargetState` call sites in the test file still passed one argument after that change,
and **vitest was green** — vitest does not typecheck. `tsc` caught it. The gate is the gate.

#### An adversarial audit, its findings, and what it could not finish

Six independent read-only lenses were run over the 7.6 diff, each followed by a
skeptic whose job was to REFUTE its findings. **The verification half never
ran** — three of the six lenses and every one of the skeptics died on a session
usage limit. So the workflow's `confirmed: []` is **not** evidence of
correctness; it is evidence that nothing was verified. The three lanes that did
finish (bundle safety, honesty, interaction) returned **eleven candidate
findings**, which the integrator then verified by hand rather than trusting or
dismissing.

**Eight were real and are fixed** (see the `fix(mobile)` commit). The most
consequential was not a 7.6 defect at all:

> **`Alert.alert` is an empty no-op on react-native-web.** The installed
> `react-native-web@0.21.2` ships `class Alert { static alert() {} }`. It accepts
> the arguments and does nothing, so the confirm callback never fires and the
> guarded action silently does not happen. On the web target such a button is not
> "unconfirmed" — it is **inert**.
>
> This app ships web, and there are **thirteen** `Alert.alert` call sites.
> Checkpoint 7.6 added two of them and routes both through a new
> `confirmDestructive` helper. **The other eleven are pre-existing and are NOT
> fixed here**: Settings' Revoke, both calendar Disconnects, Forget-this-device,
> the four Archive gates Checkpoint 6.5 added, the quick-add discard and the
> exact-alarm prompt. Rewriting eleven call sites across seven files is a
> cross-cutting change and this checkpoint is scoped to mail and monitoring, so
> the finding is recorded rather than half-fixed. **It is carried into 7.7.**

The other seven, each with a concrete failure: an open incident rendered as
neutral maintenance copy on the screen a user opens to find outages; "Checks are
still running" claimed for a muted target that is not probed at all; "In a
maintenance window" asserted from any stale skip row, including one left by an
expired mute; "No incidents have been recorded" rendered while the query was
still loading; the mail card's headline taken from `connections[0]`, so the
oldest mailbox spoke for a card that might also contain a broken one;
acknowledge failures completely silent; and the digest's "generating" state
lasting only the HTTP round trip, because `isPending` ends at the 202 rather than
when the worker finishes.

**Three were judged not defects** and are recorded rather than actioned: the
digest `unavailable` state having no action (fixed anyway — it was a dead end),
and two overlapping reports of the same `connections[0]` problem.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2987 tests / 21 turbo tasks** (2748 → **+239**), 0 of 21 cached, zero failing |
| 3 | No package decreased | core 366→**375** · schema 235→**255** · monitoring 109→**128** · api-client 103→**121** · api 569→**603** · worker 388→**409** · mobile 376→**494** · db 79 · mail-providers 113 · health-providers 311 · ai-providers 25 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly |
| 5 | Migration invariant | **16 `.sql` / 16 journal entries**, highest `0015_service_monitoring`, **no `0016`**; `packages/db` diff vs `986521d` **empty** |
| 6 | Bundle safety | `expo export --platform web` clean, exactly one `index.html`; `node:tls`, `monitor_checks`, `monitor_targets`, `probeHttp`, `probeTls`, `connectForTlsCertificate`, `gmail.googleapis.com`, `sanitizeDigestText`, `mail_digests`, `drizzle-orm`, `pg-boss` and **"worker healthy"** all **absent**; `apps/mobile` still declares exactly three `@personal-os/*` deps |
| 7 | Quiet-hours deferral | **53,372 instants**, 9 zones, 6 window shapes, both DST transitions: **0** still-inside, **0** in-the-past, **0** null-while-inside |
| 8 | Router untouched | `apps/worker/src/jobs/notifications-dispatch.ts` byte-unchanged; queue-parity **6/6**; no new category, no `devices` column |
| 9 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker/src/{health,monitor}`, `packages/{health,calendar,mail}-providers`, `packages/core/src/recurrence`, all three compose files, `eas.json`, `app.config.ts` |
| 10 | Routes hygiene | no test file under `apps/mobile/src/app`; guard test green |
| 11 | Health invariants | `health_observations` **0** in dev and test |
| 12 | Monitor / digest state | all three `monitor_*` tables **empty** in every database; `mail_digests` **empty** — **no digest has ever been generated** |
| 13 | Secret scans | `gitleaks git` **218 commits, no leaks** |
| 14 | Dependencies | **zero new packages**; `pnpm-lock.yaml` unchanged |
| 15 | Expo SDK | `expo-linking`'s SDK 57 `openURL` signature checked against the versioned docs, per `apps/mobile/AGENTS.md` |

#### Deliberately NOT done, and one rough edge recorded

No migration, no `0016`. No production access, no deployment. No live Gmail call and **no digest
generated** — the pipeline still has no `mail_digest` AI route registered anywhere. No monitor target
seeded: `monitor:seed` is an operator action, not a deployment side effect, and the two tailnet
targets remain opt-in because worker-to-Tailscale reachability is still **UNVERIFIED** (ADR-055).
No hardening or adversarial-testing pass (7.7's). No Microsoft Graph. No new mail capability — in
particular no "sync now" control, which the brief did not ask for. No merge to `main`, no push.

**Two rough edges, recorded rather than hidden.** First, `Alert.alert` is inert on web at eleven
pre-existing call sites (above) — the two this checkpoint added are fixed, the rest are 7.7's.
Second, the Gmail OAuth callback answers with a plain JSON
confirmation instead of redirecting back into the app, so a user who taps Connect completes consent
and lands on a raw JSON body in their browser. The connection *is* created and the card's copy says
exactly what to do ("Approve access in the browser, then come back and tap Refresh"), but it is an
unpolished ending to the most important flow on the card. Closing it means either an HTML response or
a deep-link redirect from the callback, which is a route change rather than a UI one.

### Checkpoint 7.5 — Service monitoring engine, migration `0015` (COMPLETE, local only, 2026-08-31)

Local development only. **No production access, no deployment, no UI, no settings screen, no
notification frontend, no Graph, and no change to any mail module.** Branch
`phase-7-mail-monitoring`, five commits from `db1cdc5` (`2a32688` … `ba68e42`), clean tree, not
merged to `main`; the repository has no remote.

**Nothing has ever been monitored.** No target was seeded, no probe ran against a real endpoint, and
`monitor_targets`, `monitor_checks` and `monitor_incidents` are empty in dev and test alike. The
engine is proven against injected fetch/TLS seams, injected clocks and real Postgres.

#### Migration `0015_service_monitoring`

Hand-written, additive, forward-only, drizzle-kit-styled. **`CREATE TABLE` only; no existing table is
altered**, so migrations `0000`–`0014` are byte-unchanged. **Local level moved 0000–0014 = 15 →
0000–0015 = 16; production is untouched and remains at 14.**

| Table | Shape and why |
|---|---|
| `monitor_targets` | What to watch and how: thresholds, interval, timeout, TLS warning window, maintenance window, mute. `kind` is CHECKed (two members, closed by design); `failure_class` is **not** CHECKed anywhere (ADR-050). The maintenance triple is all-or-nothing CHECKed and reuses the **exact shape of `devices.quiet_hours_*`**, so `isWithinQuietHours` applies unchanged and DST and overnight wraparound are already solved |
| `monitor_checks` | One row per probe execution, `skipped` included. Recent-checks index is **ascending** — `deriveIndexProbe` requires every indexed column to match `/^[a-z_][a-z0-9_]*$/`, so a `DESC` modifier aborts `db:reconcile`; a btree scans either direction, so it costs nothing |
| `monitor_incidents` | Durable outage state, `open`/`acknowledged`/`resolved`. **Partial unique index on `resolved_at is null`** is what enforces one active incident per target |

**There is no failure-counter column, and the schema file says so in words.** ADR-055 and
`apps/worker/src/health/breaker.ts` make the same argument: a counter is a second source of truth
that must be reset correctly on every success path, whereas reading the last N check rows cannot
drift. An **incident** is legitimate durable state, because it carries acknowledgement and is the
anchor that makes a *second* outage notifiable.

The partial index predicate is `resolved_at is null` rather than `status <> 'resolved'` for a
concrete reason rather than taste: `reconcile-drizzle-tracking.ts` provably derives a probe for the
`is null` form and cannot parse the other.

#### `packages/monitoring` — a package, not code in either app

The **incident state machine had to be identical in both processes**, because the worker owns every
`http` target while the API owns the `worker_heartbeat` one — and two copies of "when does an
incident open" would eventually disagree about the one thing every alert depends on. The plumbing
around it (queue handles, logging, alert bodies) stays per-process, since **the API must never import
from `apps/worker`**: they are separate processes whose only interface is Postgres and pg-boss.

`thresholds.ts` (pure, derived counting) · `suppression.ts` · `probe.ts` (HTTP + health-payload
parsing + TLS via `node:tls`) · `incidents.ts` · `targets.ts` · `heartbeat.ts`. **109 tests.**

Three decisions worth recording because each had a plausible alternative:

- **A `skipped` check is WRITTEN, not omitted.** "We deliberately did not look" is a fact, and it is
  what lets the uptime read model render `not_checked`. Threshold evaluation excludes those rows **in
  the query**, so a nightly maintenance window cannot reset a failure streak that was one check from
  opening — otherwise an outage beginning before the window would never be reported at all. A
  **disabled** target is the one exception and writes nothing, because a target nobody watches should
  not accumulate rows forever.
- **TLS is consulted only after the HTTP probe says the endpoint answered.** A certificate expiring
  next week on a service that is currently down is not the headline, and letting the TLS result
  overwrite a transport failure would hide the outage behind the warning. A TLS problem on a
  *reachable* endpoint does mark the check down, because an expired certificate is an outage for
  every client that validates — which is every client except this probe, which deliberately does not.
- **`fetch` cannot expose a peer certificate**, so expiry needs a second `node:tls` connection. That
  is a real cost (one extra handshake per TLS-bearing target per interval) and is why `tls_warn_days`
  is opt-in per target rather than implied by an `https://` URL.

#### The API owns the heartbeat watchdog, and the blind spots are stated

`docs/ARCHITECTURE.md` has required this since Phase 0 — *"Worker crashes must be loud… add a
heartbeat row it updates each cycle and alert on staleness."* The heartbeat row shipped then and
`GET /health` has reported `worker.stale` ever since, but **nothing ever alerted on it**. Reporting a
fact on an endpoint nobody polls is not alerting.

It runs on an interval in the HTTP process rather than piggybacking on inbound requests: a
single-user system behind Tailscale gets no traffic overnight, which is exactly when a worker is most
likely to die unnoticed. The honest cost is that it competes with request handling, which is why the
evaluation returns rather than throws on every path, the timer is `unref`'d and cleared on close, and
an escaping error is logged and swallowed — **a monitoring feature must not cause the outage it
exists to detect.**

**Residual blind spots, documented rather than papered over:**

1. **A worker that is HUNG, or crash-looping fast enough to keep writing heartbeats, looks alive.**
   The heartbeat proves a process is running its beat cron, not that it is completing jobs. Closing
   this needs a liveness signal derived from actual job completion — a different design, not part of
   this checkpoint.
2. **If the API is down, nothing evaluates the heartbeat.** Strictly better than the worker watching
   itself, because an API outage is what the other targets exist to catch.
3. **Worker-to-Tailscale reachability is UNVERIFIED.** ADR-055 required this be proven here and it
   was not: the worker container sits on a plain Docker bridge network while the Serve routes
   terminate on the host's `tailscaled`. **The two tailnet targets are therefore opt-in** (env-gated
   in `monitor:seed`) and were deliberately not seeded. Seeding them blindly would manufacture a
   permanent false outage and teach whoever is on call to ignore the alerts. **The Serve/TLS layer is
   an explicit blind spot, not assumed covered.** Proving it needs production access, which 7.5 does
   not have.

A **missing** heartbeat row counts as stale with its own `worker_never_started` class. Treating
"never recorded" as healthy would report green on a first deploy where the worker never started,
which is the worst possible moment to be reassuring; and a deployment problem sends an operator
somewhere different from a worker that died.

#### Alerting reuses the existing router unchanged

`category: "alert"` is already wired end to end, already defaults `notify_alerts = true`, and is
already exempt from quiet hours — correct for "a service is down". **No new notification category and
no `devices` column** (ADR-055).

Dedupe keys are **incident-scoped** — `monitor:${incidentId}:opened` / `:resolved`. This is the fix
for a real latent defect: `notification_dispatch_log.dedupe_key` is a permanent primary key with no
TTL, and the existing `calendar-needs-reauth:${connectionId}` producer carries no discriminator, so
once that key is `accepted` the connection can never alert again. A target-scoped key would burn
itself on the first outage.

An alert body carries the target **name** and a failure **class** and never the URL — a push renders
on a lock screen, and a target URL may legitimately carry a token.

#### Both load-bearing guards are MUTATION-PROVEN, not asserted

| Mutation | Result |
|---|---|
| Let `skipped` rows reach threshold evaluation | **Exactly one test fails** — "a maintenance window does NOT reset a failure streak" |
| Make dedupe keys target-scoped instead of incident-scoped | **Exactly one test fails** — "a SECOND outage can alert" |

#### A pre-existing defect found and fixed in passing

**The worker's startup line was reporting counts that were already wrong.** It claimed
`queues: 10, schedules: 8` against a real boot that registers **25 and 9** — the literals had been
bumped by hand each checkpoint and had drifted. That is worse than carrying no number: an operator
comparing the log against `pgboss.queue` would go looking for a registration failure that never
happened. Both are now **derived** by counting the registrations, verified against a real boot
(`queues: 25, schedules: 9`, matching `pgboss.schedule` exactly).

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2748 tests / 21 turbo tasks** (2559 → **+189**), 0 of 21 cached, zero failing |
| 3 | No package decreased | db 56→**79** · schema 216→**235** · **monitoring 109 (new)** · api 555→**569** · worker 364→**388** · core 366 · mail-providers 113 · health-providers 311 · ai-providers 25 · api-client 103 · mobile 376 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly |
| 5 | Migration applied | Once each to dev and `personalos_test` as `posops_migrator`: 15 → **16** tracked rows in both |
| 6 | Fresh lineage | A disposable database migrated **`0000` → `0015`** produced a `public` schema **byte-identical to dev** — 1308 lines, sha256 `854bfd76365ff1ae83497fb902b95b28ae0c1725d3760dd5a0f6ad58c9a3d30c` on both — then was dropped |
| 7 | Reconcile | Against the disposable database with `0015`'s tracking row removed, `db:reconcile` **derived and confirmed 19/19 probes** without aborting on any statement class, including the partial unique index and the compound resolved-consistency CHECK |
| 8 | DB constraints | **23 proofs** in `packages/db/test/monitor-constraints.test.ts`, including all six partial maintenance triples, the active-incident slot (`open` AND `acknowledged` both occupy it), unlimited `resolved` rows per target, cascade cleanup, and role separation (`posops_app` denied `CREATE TABLE` and denied dropping a monitor CHECK, `42501`) |
| 9 | Queue registration | Verified against a **real pg-boss boot** on the test database: `monitor.run` persisted `stately` / `retry_limit 0` / `expire_seconds 300` / **no dead-letter**, and `monitor.cron` on `* * * * *` |
| 10 | Commit-prefix independence | **All five prefixes** build, typecheck AND pass their focused package suite independently — the 6.5/6.7A entanglement class, checked rather than assumed |
| 11 | Bundle safety | `expo export --platform web` clean, exactly one `index.html`; `apps/mobile` does not depend on `@personal-os/monitoring`; `packages/schema/src/monitor.ts` reaches no Node builtin |
| 12 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker/src/{health,mail}`, `packages/{health,calendar,mail}-providers`, `packages/core/src/recurrence`, `apps/mobile`, all three compose files, `eas.json`, `app.config.ts`, and migrations `0000`–`0014` |
| 13 | Health invariants | `health_observations` **0** in dev and test; `heart-rate-intraday` `sync_enabled = false` |
| 14 | Mail invariants | Every `mail_*` table still empty; **no digest has ever been generated** |
| 15 | Secret scans | `gitleaks git` **206 commits, no leaks**; working-tree scan classified with `git check-ignore` — 11 findings, **0 in any file git would commit**; pre-commit hook clean on all five commits |
| 16 | Cleanup | No repository api/worker/Metro/Expo/watch/test process left running; ports 3000/8081/8082/5173/19000/19001 free; the disposable probe database dropped; zero failed pg-boss jobs |

#### Deliberately NOT done

No UI, no settings screen, no notification frontend, no api-client method, no route. No production
access, no deployment, no migration `0016`. No target seeded and no probe run against a real
endpoint — including no probe of the Tailscale Serve routes, which is the recorded blind spot above.
No Microsoft Graph. No change to any mail or health module. No merge to `main`, no rebase, no push.
**Checkpoint 7.6 has not begun.**

### Checkpoint 7.4 — Mail digest pipeline (COMPLETE, local only, 2026-08-31)

Local development only. **No production access, no live Gmail call, no provider call, no
migration** — the level stays 15 `.sql` / 15 journal entries, there is no `0015`, and
`packages/db` is byte-unchanged. No monitoring, no UI, no notification, no API route, no Graph,
no mail action. Branch `phase-7-mail-monitoring`, two commits from `eb557d8`
(`23653a2`, `5e383b7`).

**No digest has ever been generated.** `mail_digests` is empty in every database and no
`mail_digest` route is registered anywhere, so nothing has reached a model. The pipeline is proven
against a stub generator, a partial-mocked SDK and real Postgres.

#### Where it lives, and why the worker rather than the API

ADR-053 says digest generation "always occurs on schedule and always persists", so the worker owns
it: one queue `mail.digest.generate` plus a worker-local `mail.digest.cron` at **07:00 in the
configured digest zone**. The Daily Brief's precedent (ADR-041, manual-only, no cron) is
deliberately *not* followed here, because ADR-053 explicitly separates the two.

There is **no API route**. Reading a digest is Checkpoint 7.6's; `apps/api` creates the queue
identically only so a boot-order race cannot discard the worker's options. **No notification is
dispatched** — ADR-055 assigns alerting to 7.5 and the brief for this checkpoint excludes it — so a
digest is written and nobody is told, deliberately.

The scheduled timezone is explicit configuration (`MAIL_DIGEST_TIMEZONE`, default **UTC**).
`mail_digests` is keyed on `(digest_date, timezone)` and a cron has nobody to ask. Deriving it from
the newest capture or the primary reminder device was considered and rejected: it would make the
digest's **identity** drift as devices come and go, and a key that moves on its own produces
duplicate rows nobody asked for.

#### The input contract

`MailDigestInput` is a closed scalar allowlist with **exactly two attacker-controlled fields**,
`subject` and `from_display_name` — a contract, not an observation. There is deliberately **no
`from_address` and no `from_domain`**: ADR-054 says "no addresses", a domain is the half of an
address a sender picks, and admitting one would quietly make it three and widen the surface every
other decision here is measured against.

Both are capped at **140 / 60 characters against the columns' 512 / 256**. A storage contract and a
prompt contract answer different questions, and ADR-054 requires the mail section to be "capped
hardest". The arithmetic that makes it meaningful: 12 highlights × (140+60) plus 10 senders × 60 is
~3k of untrusted text against a 9k ceiling, so an attacker cannot fill the payload however long
their subjects are.

**Counts come from Postgres over the whole window; only item lists are capped.** Not an
optimisation: counts derived from whatever rows were fetched would understate a flooded mailbox in
exactly the situation where stating its true size matters most. `thread_id` and `connection_id` are
read — they are the only way to count distinct threads and mailboxes — but only inside SQL
aggregates, and never reach the payload.

Scope is **active connections, INBOX only, not tombstoned, inside a 24-hour trailing window**.
`history.list` reports every mailbox change, so SENT and DRAFT rows are stored too; neither needs
attention.

#### The prompt, rewritten rather than inherited

ADR-054 requires it by name: the brief's system prompt claims "the data you receive does not contain
any [credentials, API keys, tokens]", and that claim **becomes false** for mail — subject lines
routinely carry one-time codes and magic links. A prompt asserting something false about its own
input trains the model to disbelieve what it is looking at. The mail prompt says the opposite: the
data **does** sometimes contain codes and links, and they must never be repeated.

It also names the two untrusted fields explicitly, forbids emitting any URL, domain, address or
code, and states the lane has no tools and cannot act on mail.

**What the tests assert, and what they deliberately do not.** They assert STRUCTURE — that untrusted
text never reaches the system role, that the JSON structure cannot be broken, that no forged key
appears. They do **not** assert that a model resists any particular phrase; that would be testing
the provider, and a green result would mean nothing about the next model version.

**One test was written wrong and the correction is the interesting part.** The first version asserted
a subject containing `</snapshot>` could not put those characters in the prompt. That is FALSE:
`JSON.stringify` escapes quotes, backslashes and control characters but **not `<` or `>`**, so the
literal text does appear. What is actually true — and what ADR-054's "the fence holds" rests on — is
that JSON escaping is lexical and content-independent, so the payload cannot change the structure
around it, and its newlines are escaped so it can never present itself as a new line-level block. The
test now asserts that. Claiming the stronger property would have been exactly the false assurance
ADR-054 warns against.

#### The drop ladder

Rung 1 **highlights** (both untrusted fields, once per item), rung 2 **senders**, rung 3
**categories** (closed vocabulary, no attacker text). **Never dropped: the deterministic counts.**
Whole items, never sliced JSON, and `total` is never touched, so a trimmed section still states how
much exists.

The threat is specific and is ADR-054's: an attacker chooses how long their own subjects are, so
without an ordering rule a flood would push first-party content out of a bounded payload — "a third
party could evict the user's own agenda from their own digest".

**Scope note, stated rather than implied.** This payload carries no tasks, projects or events, so
"email volume must not hide tasks/projects" cannot be violated here — there is nothing of the user's
own to evict. That risk becomes real only in a future `BriefInput` carrying mail, which ADR-054 makes
a **separately-approved decision** and which this checkpoint deliberately does not make. The ladder
is ordered so that decision inherits one already yielding mail first.

#### The output filter — an ADR-054 requirement, not a nicety

ADR-054 names the realistic exploit as **content laundering**: attacker text paraphrased into
first-party prose, persisted, and rendered in the system's own voice carrying a live link. It
requires "a server-side output constraint that strips link-shaped content from persisted digest
text". Scheme URLs (every scheme, including `javascript:` and `data:`), `www.` hosts, markdown link
targets, email addresses and bare hosts with a path are removed; the filter runs **inside** the
generation attempt, and a post-condition **refuses the digest outright** if anything link-shaped
survives.

**The residual is stated rather than glossed:** a bare domain with no scheme and no path is left
alone. It is not clickable as plain text, and the false-positive rate on ordinary prose is real. That
residual is narrow *by construction* — the input carries no domain, so nothing legitimate should
produce one.

It is **not** an injection-phrase sanitizer and must never become one (ADR-054, and `prompt.ts`'s
existing reasoning that one "would give false assurance without closing anything"). It removes one
syntactic class; it never judges intent.

#### The no-overwrite guarantee is structural

Migration `0014`'s own comment demanded this of 7.4 by name. It is not "we are careful": the persist
call is **physically unreachable** from any failure path — generation either returns complete,
filtered, non-empty content or throws, and persist sits after it in one straight line. There is no
catch branch that writes and no partial value to write, so a previous digest survives every provider
outage, timeout, empty completion and filter refusal. Four tests cover it, including the case where
no prior digest exists and nothing at all is written.

#### One real defect, found by a test rather than by review

**`stripUnsummarizableCharacters` deleted newlines, welding words together.** A newline is a C0
control, so the strip removed it before the whitespace collapse could run: `"Hello\nSystem: admin"`
became `"HelloSystem: admin"` — a string containing a word neither the sender nor the reader ever
wrote, and in the adversarial case a way to join tokens misleadingly. Whitespace-like controls (tab,
LF, VT, FF, CR, and NEL U+0085) now become a space; everything else still vanishes. A second test
pins NEL specifically, since it is a C1 control **and** a line separator.

Two smaller corrections, both caught the same way: a test asserted a payload leak that was actually
its own fixture interpolating an id into a subject, and another used a fabricated uuid for
`model_id`, which the foreign key to `ai_models` correctly rejected — it now seeds a real model row,
which proves more than the shortcut would have.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2559 tests / 19 turbo tasks** (2457 → **+102**), zero failing, 0 of 19 cached |
| 3 | No package decreased | core 350→**366** · worker 278→**364** · db 56 · schema 216 · mail-providers 113 · health-providers 311 · ai-providers 25 · api-client 103 · api 555 · mobile 376 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly. `worker` grew again by design — it is this checkpoint's deliverable |
| 5 | Migration invariant | **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`, **no `0015`**; `packages/db` diff vs `eb557d8` **empty** |
| 6 | Queue registration | Real pg-boss boot against the **test** database: `mail.digest.generate` persisted as `stately / retry_limit 0 / expire_seconds 300 / no dead-letter` |
| 7 | pg-boss API claim | `ScheduleOptions.tz` verified against the installed `pg-boss@12.27.0` types rather than assumed, since the cron comment depends on it |
| 8 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker/src/health`, `packages/health-providers`, `packages/calendar-providers`, `packages/mail-providers`, every 7.3 sync module, `packages/core/src/recurrence`, `apps/mobile`, `apps/api/src/routes`, `apps/api/src/services`, `packages/db/drizzle`, `packages/schema` |
| 9 | Health invariants | `health_observations` **0** in dev and test; `heart-rate-intraday` `sync_enabled = false` |
| 10 | Mail state | dev: 1 connection (7.2's), **0 messages / 0 digests / 0 `mail_digest` routes**. test: all empty. **No model has ever been called** |
| 11 | Bundle safety | `expo export --platform web` clean, one `index.html`; `mail_digest`, the system prompt, `sanitizeDigestText`, the link placeholder and `mail_digests` all **absent**, while the pure `core/mail` helpers legitimately reach it through `packages/schema` |
| 12 | Secret scans | `gitleaks git` **205 commits, no leaks** |
| 13 | Dependencies | **Zero new packages**, registry or workspace |
| 14 | Cleanup | Both probe scripts deleted; no repository process running; ports 3000/8081/8082/5173/19000/19001 free; working tree clean |

#### Deliberately NOT done

No migration and no `0015`. No live Gmail call and no provider call of any kind — no digest has been
generated. No production `mail_digest` route registration (a deployment concern, 7.8's). No API
route and no api-client method (7.6's). No notification or alert (7.5's, ADR-055). No monitoring, no
`monitor_*` tables. No mobile UI. No extension of `BriefInput` with mail — ADR-054 makes that a
separately-approved decision. No prune job. No merge to `main`, no rebase, no push (the repository
has no remote). No production access. **Checkpoint 7.5 not begun.**

### Checkpoint 7.3 — Incremental mail sync engine (COMPLETE, local only, 2026-08-31)

Local development only. **No production access, no live Gmail call, no migration** — the level stays
15 `.sql` / 15 journal entries and there is no `0015`; `packages/db` is byte-unchanged. No digest, no
monitoring, no notification dispatch, no mobile UI, no API route. Branch `phase-7-mail-monitoring`,
four commits from `ea52144` (`c211c20` … `8f2b4ed`).

**Nothing was synchronised.** The development mail connection 7.2 left active is still the only mail
row in dev: `mail_messages`, `mail_sync_cursors`, `mail_sync_runs` and `mail_digests` are all **0**.
The engine is proven against the scripted fake and real Postgres; a live pass is 7.7's.

#### The three mandated deliverables

**1. Worker structured logger** (`apps/worker/src/logger.ts`). `docs/STATUS.md` recorded "worker
top-level `console.error` lacks serializer discipline" as standing debt. That was survivable while a
worker log line could at worst carry a health value; mail metadata is the **first attacker-authored
input to reach this process**, and ADR-054 forbids a subject, address or display name appearing in a
log line — which `console.error("failed", err)` would violate in one call.

The guarantee is three layers and is **stated honestly in the module rather than overclaimed**:
`LogFields` accepts scalars only, so `{ err }` is a **compile error** rather than a review catch; a
field-name denylist drops anything named `subject`/`from`/`address`/`token` whatever it holds; and a
value-shape filter rejects whitespace, `@`, quotes and angle brackets. **The residual is written
down**: a one-word subject is indistinguishable from a machine token, so layers 1 and 2 carry the
guarantee and layer 3 is defence in depth. `errorToken()` is the only route from an error to a log —
a `pg` `DatabaseError`'s `detail` is literally `Failing row contains (...)`, subject line included.

`no-raw-console.test.ts` pins **every pre-existing `console.*` site by count** so the debt cannot
grow, and requires **zero in the mail lane**. `index.ts` was converted (5 → 0); health and the three
older jobs are left alone, being outside this checkpoint.

**2. Queue parity test** (`apps/worker/src/queue-parity.test.ts`). The two `queue-names.ts` files
have never been compared, and pg-boss's `create_queue` is `INSERT ... ON CONFLICT DO NOTHING` —
**whichever process boots first wins the options, silently**. A one-character name typo yields a
queue nobody listens to; a missing `policy: "stately"` drops the per-connection depth bound. The test
reads both files as **text** (apps/api is not a worker dependency and must not become one to be
tested) and was **mutation-proven** against both failure shapes: a `retryLimit` divergence and a name
typo each fail it.

**3. Mail queues.** One queue, `mail.gmail.sync-connection`, plus a worker-local
`mail.gmail.sync-cron` at `*/15`. **No dead-letter queue and no pg-boss retry**, following the health
precedent for its documented reason rather than by analogy: pg-boss's own `manager.js:1293` states
that under `policy: "stately"` a retry insert can be dropped by `ON CONFLICT` and the job re-inserted
as `failed` straight to the dead-letter queue, skipping its remaining retries. **Verified against a
real pg-boss boot** rather than trusting the options object: the persisted row reads
`policy=stately · retry_limit=0 · expire_seconds=900 · dead_letter=null`, identical to health's.

#### Four divergences from the health engine, each forced by evidence

| Area | Health does | Mail does | Why |
|---|---|---|---|
| Advisory lock | namespace 6003 | **7001, near-copy not a call** | `hashtext` is 32-bit, so a mail and a health connection uuid can collide. Sharing the namespace would let a health pass block a mail pass, intermittently, with no way to tell from either side |
| Breaker action | disables the stream (`sync_enabled=false`) | **open/closed derived on read, six-hour re-probe** | `mail_sync_cursors` has no enable flag and adding one is migration `0015`, i.e. Checkpoint 7.5. Deriving it also self-heals: a re-granted scope recovers with nobody intervening |
| Tombstoning | absence sweep over a fetched window | **explicit `messagesDeleted` events** | No window, no seen-key set, no authority model — and **no way for an empty response to mean anything but "nothing was deleted"**, so none of ADR-047a's machinery is needed here |
| Backoff | blind full jitter | **honours `Retry-After`** | Health's comment is explicit that its API "documents no `Retry-After` header ... so there is no server hint to honour". Gmail sends one (ADR-053) |

#### The 7.2P findings, encoded rather than remembered

1. **`format=metadata` is always sent.** Gmail's default is FULL and FULL is rejected under this
   scope, so a client that merely omitted the parameter would 403 on **every** message fetch. The
   shipped client hardcodes it and offers no `format` field.
2. **Classification is HTTP status + `error.status` + THE OPERATION**, never `details[].reason`.
   Checkpoint 6.3's central fix for Health was to *start* reading that reason; 7.2P found Gmail
   returns `details: []` on every failure, so porting the health classifier would produce a function
   reading an always-empty field. The operation is indispensable: a 404 is "resync your cursor" on
   `history.list` and "that message is gone" on `messages.get`, and only the caller knows which.
3. **An empty delta omits the `history` key entirely.** Every read goes through `?? []`; a test
   asserts the bare-`historyId` response, which is the commonest response in a quiet mailbox.
4. **Listing returns references only**, so metadata is one request per message. Every bound exists
   because of that N+1: 10 history pages, 5 full-sync pages, 100 per page, **500 messages per pass**,
   and a limiter whose serialized gate makes concurrency provably 1. Default QPS is **derived** from
   the published quota (6000 units/min ÷ 20 per metadata get ÷ 60s, minus headroom = 4), not picked.

#### Two design points the tests turned into requirements

**Cursor advancement under truncation.** When a bound stops the walk, the cursor becomes the id of
the **last history record processed in full** — never the response's `historyId` (which skips the
unread remainder) and never left unmoved (which replays the same prefix every tick and never reaches
the tail: a **livelock**, not inefficiency). A record's `id` is itself a cursor value, so resuming
re-delivers at most one record, which persistence absorbs. A single record larger than the cap is
always processed, or it would stall the cursor permanently.

**The full resync captures its cursor BEFORE enumerating.** `users.getProfile` runs first and its
`historyId` is what the pass stores. Capturing it after listing would open a window in which a
message arriving during enumeration is older than the stored cursor and newer than the listing —
invisible to every later pass, **forever**. Capturing first only replays, which is idempotent. The
test asserts the call ORDER, not just the outcome.

"Bounded" is used honestly: the resync scopes to INBOX, stops after five pages, recovers **forward
incremental capability**, and explicitly does **not** guarantee complete history. Gmail lists
newest-first, so what is dropped is the older tail — a `backfill`, which ADR-053 makes a distinct
kind for and which no checkpoint has built.

#### Three real defects, each found by a test rather than by review

1. **The limiter's cooldown overrode the provider's own `Retry-After`.** Arming
   `max(hint, cooldownFloor)` meant a provider that said "7 seconds" gated the pass for 30 — the
   retry slept its 7s and then sat at the gate for the remaining 23. That is not honouring a hint; it
   is overriding it with the default only ever wanted as a floor under **our own** jitter. The floor
   now applies to jitter only, with a test for each half.
2. **The breaker's edge trigger fired forever.** `justOpened` was derived only from "is there a sixth
   failure older than the streak?" — false for a connection whose first five passes fail, and it
   **stays** false, because an open breaker skips instead of writing another failed run and freezes
   the window at exactly five. It would have announced the same episode every tick: precisely the
   alert fatigue the edge trigger exists to prevent. The skip rows are now read back as the record of
   having announced.
3. **An escalating pass wrote two run rows sharing one `started_at`.** A pass captures one
   effectiveNow and stamps both with it, so ordering fell back to a random uuid and the audit trail
   reported the recovery **before** the failure about half the time — in the one place whose whole
   job is to make the cursor-expiry transition visible. Stamped one millisecond later, the same
   monotonic floor `apps/api` applies to `projects.updated_at`. Verified stable over three runs.

A fourth was caught in the test harness itself and is worth recording: **every orchestrator test was
making a real network call to Google's token endpoint.** The fixture set the token expiry from the
system clock while the tests inject their own, so the stored token read as expired, the pass took the
refresh path, and `refreshGmailAccessToken`'s default `fetchFn` is the global fetch. Every test
failed with `auth_permanent` for a reason unrelated to what it tested. Fixed at both ends: the
fixture anchors far in the future, and the tests inject a refresh function that **throws**, so an
accidental network call is now impossible rather than merely unlikely. `vitest.config.ts` also
overrides `GMAIL_OAUTH_*` with dummy values, so the suite never reads the owner's real credentials
out of `.env`.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0 warnings** · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, **uncached and serial** | **2457 tests / 19 turbo tasks** (2272 → **+185**), zero failing, 0 of 19 cached |
| 3 | No package decreased | core 339→**350** · schema 216 · db 56 · mail-providers 58→**113** · health-providers 311 · ai-providers 25 · api-client 103 · api 555 · worker 159→**278** · mobile 376 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly. `worker` moved 159→278 **by design** — it is this checkpoint's deliverable — and nothing decreased anywhere |
| 5 | Migration invariant | **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`, **no `0015`**; `packages/db` diff vs `ea52144` **empty**; dev tracking table **15 rows**, newest `1788120327047` |
| 6 | Queue registration | Real pg-boss boot against the **test** database (zero mail connections, so no provider call is reachable): `mail.gmail.sync-connection` persisted as `stately / 0 / 900 / no dead-letter` |
| 7 | Queue parity | Mutation-proven: a `retryLimit` divergence and a one-character name typo in `apps/api` each fail the test; restored, green |
| 8 | Forbidden-area drift | **zero** across `apps/api/src/brief`, `apps/worker/src/health`, `packages/health-providers`, `packages/calendar-providers`, all three calendar jobs, `packages/core/src/recurrence`, `apps/mobile`, `apps/api/src/routes`, `apps/api/src/services`, `packages/db/drizzle` |
| 9 | Health invariants | `health_observations` **0** in dev and test; `heart-rate-intraday` `sync_enabled = false` with **zero sync runs ever** |
| 10 | Mail state | dev: 1 connection (7.2's, deliberately retained), **0 messages / 0 cursors / 0 runs / 0 digests**. test: all mail tables empty |
| 11 | Bundle safety | `expo export --platform web` clean, exactly one `index.html`; `gmail.googleapis.com`, `GmailApiError`, `createMailLimiter` and `mail_sync_cursors` all **absent** from the bundle, while the pure `core/mail` helper legitimately reaches it through `packages/schema` |
| 12 | Secret scans | `gitleaks git` **202 commits, no leaks**; working tree 9 findings across 4 files, **0 in any file git would commit** (classified with `git check-ignore`) |
| 13 | Dependencies | **Zero new registry packages.** Two internal workspace edges: `mail-providers → core, schema`, and `worker → mail-providers` |
| 14 | Cleanup | Both probe scripts deleted; no repository process running; ports 3000/8081/8082/5173/19000/19001 free; working tree clean |

#### Deliberately NOT done

No migration and no `0015`. No live Gmail call of any kind — the engine has never run against the
real API. **No notification dispatch**: ADR-055 assigns alerting to the monitoring checkpoint, and
"notifications" is explicitly outside 7.3, so the breaker records durable state and logs rather than
enqueuing. No digest, no `MailDigestInput`, no AI integration. No monitoring, no `monitor_*` tables.
No API route — `POST /mail-connections/:id/sync` is Checkpoint 7.6's; apps/api creates the queue
identically only so a boot-order race cannot discard the worker's options. No mobile UI. No prune job
(ADR-054 permits one; its window is a separate explicit decision). No merge to `main`, no rebase, no
push (the repository has no remote). No production access. **Checkpoint 7.4 not begun.**

## Superseded verification (Checkpoint 7.6)

**Phase 7 Checkpoint 7.6 — UI + notification integration (2026-09-01).** Branch
`phase-7-mail-monitoring`, six commits from `986521d`; clean tree; not merged to `main`; no remote.

Full gate, integrator-run: build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 21 cached): **2987 tests across 21 turbo tasks**
(2748 → **+239**), zero failing. Per package — core **375** · db 79 · schema **255** ·
**monitoring 128** · mail-providers 113 · **calendar-providers 74** · health-providers 311 ·
ai-providers 25 · api-client **121** · api **603** · worker **409** · mobile **494**. **No package
decreased.** The `calendar-providers` canary held at exactly **74**.

Migrations **16 `.sql` / 16 journal entries**, highest `0015_service_monitoring`, **no `0016`**;
`packages/db` diff vs `986521d` **empty**. Zero new dependencies; `pnpm-lock.yaml` unchanged, and
`apps/mobile` still declares exactly three `@personal-os/*` deps.

Bundle safety: `node:tls`, `monitor_checks`, `monitor_targets`, `probeHttp`, `probeTls`,
`connectForTlsCertificate`, `gmail.googleapis.com`, `sanitizeDigestText`, `mail_digests`,
`drizzle-orm`, `pg-boss` and the phrase **"worker healthy"** are all **absent** from the web export.

Quiet-hours deferral proven over **53,372 instants** (9 zones, 6 window shapes, both DST
transitions): **0** still-inside, **0** in-the-past, **0** null-while-inside.
`notifications-dispatch.ts` byte-unchanged; queue-parity **6/6**.

`gitleaks git` **218 commits, no leaks**. `health_observations` **0** in dev and test. All three
`monitor_*` tables **empty in every database** and `mail_digests` **empty** — **no target has ever
been seeded, no probe has run against a real endpoint, and no digest has ever been generated**.
Forbidden-area drift **zero**.

*Previous verification — Phase 7 Checkpoint 7.5 (2026-08-31): 2748 tests across 21 turbo tasks,
calendar-providers 74, worker 388, api 569, mobile 376, 16 migrations.*

## Superseded verification (Checkpoint 7.5)

**Phase 7 Checkpoint 7.5 — service monitoring engine, migration `0015` (2026-08-31).** Branch
`phase-7-mail-monitoring`, HEAD `ba68e42` after five commits from `db1cdc5`; clean tree; not merged to
`main`; no remote.

Full gate, integrator-run: build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 21 cached): **2748 tests across 21 turbo tasks**
(2559 → **+189**), zero failing. Per package — core 366 · db **79** · schema **235** ·
**monitoring 109 (new)** · mail-providers 113 · **calendar-providers 74** · health-providers 311 ·
ai-providers 25 · api-client 103 · api **569** · worker **388** · mobile 376. **No package
decreased.** The `calendar-providers` canary held at exactly **74**. Turbo task count moved 19 → 21
because `packages/monitoring` adds its own build and test tasks.

Migrations **16 `.sql` / 16 journal entries**, highest `0015_service_monitoring`, **no `0016`**;
migrations `0000`–`0014` byte-unchanged. A disposable database migrated `0000` → `0015` produced a
`public` schema **byte-identical to dev**, and `db:reconcile` **derived and confirmed 19/19 probes**
for `0015` including the partial unique index. **23 constraint proofs** against a real Postgres.

Queue registration verified against a **real pg-boss boot**: `monitor.run` persisted
`stately / retry_limit 0 / expire_seconds 300 / no dead-letter`; `monitor.cron` on `* * * * *`.
**All five commit prefixes** build, typecheck and pass their focused suite independently.

`gitleaks git` **206 commits, no leaks**; working tree **0 findings in any committable file**.
`health_observations` **0** in dev and test; `heart-rate-intraday` disabled. Every `mail_*` table
still empty and **no digest has ever been generated**. All three `monitor_*` tables **empty in every
database** — **no target seeded and no probe run against a real endpoint**, including none against
the Tailscale Serve routes, which is the recorded blind spot. Forbidden-area drift **zero**.

*Previous verification — Phase 7 Checkpoint 7.4 (2026-08-31): 2559 tests across 19 turbo tasks,
calendar-providers 74, worker 364, api 555, 15 migrations.*

## Superseded verification (Checkpoint 7.4)

**Phase 7 Checkpoint 7.4 — mail digest pipeline (2026-08-31).** Branch
`phase-7-mail-monitoring`, HEAD after two commits from `eb557d8`; clean tree; not merged to `main`;
no remote.

Full gate, integrator-run: build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 19 cached, 1m8s): **2559 tests across 19 turbo tasks**
(2457 → **+102**), zero failing. Per package — core **366** · db 56 · schema 216 · mail-providers
113 · **calendar-providers 74** · health-providers 311 · ai-providers 25 · api-client 103 · api 555 ·
worker **364** · mobile 376. **No package decreased.** The `calendar-providers` canary held at
exactly **74**.

Migrations **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`, **no `0015`**;
`packages/db` byte-unchanged. `gitleaks git` **205 commits, no leaks**. `health_observations` **0** in
dev and test; `heart-rate-intraday` disabled. `mail_digests` **empty in every database** and **no
`mail_digest` route registered** — **no model has ever been called and no digest generated**.
Forbidden-area drift **zero**, including every Checkpoint 7.3 sync module. Queue registration proven
against a real pg-boss boot (`stately / 0 / 300 / no dead-letter`), and `ScheduleOptions.tz` verified
against the installed `pg-boss@12.27.0` types rather than assumed.

*Previous verification — Phase 7 Checkpoint 7.3 (2026-08-31): 2457 tests across 19 turbo tasks,
calendar-providers 74, worker 278, api 555, 15 migrations.*

## Superseded verification (Checkpoint 7.3)

**Phase 7 Checkpoint 7.3 — incremental mail sync engine (2026-08-31).** Branch
`phase-7-mail-monitoring`, HEAD after four commits from `ea52144`; clean tree; not merged to `main`;
no remote.

Full gate, integrator-run: build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 19 cached, 1m6s): **2457 tests across 19 turbo tasks**
(2272 → **+185**), zero failing. Per package — core **350** · db 56 · schema 216 · mail-providers
**113** · calendar-providers **74** · health-providers 311 · ai-providers 25 · api-client 103 · api
555 · worker **278** · mobile 376. **No package decreased.** The `calendar-providers` canary held at
exactly **74**; the `worker` canary moved 159 → **278** because worker code IS this checkpoint's
deliverable, which is growth rather than the silent decrease the canary guards against.

Migrations **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`, **no `0015`**;
`packages/db` byte-unchanged. `gitleaks git` **202 commits, no leaks**; working-tree findings **0 in
any committable file**. `health_observations` **0** in dev and test; `heart-rate-intraday` disabled
with zero runs ever. Every mail data table **empty** — **no live Gmail call was made and none is
claimed**. Forbidden-area drift **zero**. Queue registration proven against a real pg-boss boot
(`stately / 0 / 900 / no dead-letter`), and queue parity mutation-proven against both a retry-option
divergence and a one-character name typo.

*Previous verification — Phase 7 Checkpoint 7.2 (2026-08-30): 2272 tests across 19 turbo tasks,
calendar-providers 74, worker 159, api 555, 15 migrations.*

## Superseded verification (Checkpoint 7.2)

**Phase 7 Checkpoint 7.2 — Gmail OAuth + connection lifecycle (2026-08-30).** Branch
`phase-7-mail-monitoring`, clean tree; not merged to `main`; no remote.

Full gate, integrator-run: build **10/10** · typecheck **19/19** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 19 cached): **2272 tests across 19 turbo tasks**
(2202 → **+70**), zero failing. Per package — core 339 · db 56 · schema 216 · mail-providers **58** ·
calendar-providers **74** · health-providers 311 · ai-providers 25 · api-client **103** · api
**555** · worker **159** · mobile 376. **No package decreased**, and both zero-drift canaries
(`calendar-providers` 74, `worker` 159) held exactly. Turbo task count moved 18 → 19 because
`apps/api` now depends on `@personal-os/mail-providers`, adding its build into api's test chain.

Migrations **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`, **no `0015`**;
`packages/db` byte-unchanged. `gitleaks git` **194 commits, no leaks**. `health_observations` **0**;
`heart-rate-intraday` disabled with zero runs ever. Every `mail_*` table empty. Forbidden-area drift
**zero**. **No live OAuth call was made and none is claimed** — `.env` holds zero `GMAIL_OAUTH_*`
keys.

*Previous verification — Phase 7 Checkpoint 7.1 (2026-08-30): 2202 tests across 18 turbo tasks,
calendar-providers 74, worker 159, api 496, api-client 93, mail-providers 57, 15 migrations.*

## Superseded verification (Checkpoint 7.1)

**Phase 7 Checkpoint 7.1 — contracts, mail provider foundation, migration `0014` (2026-08-30).**
Branch `phase-7-mail-monitoring`, HEAD `211d41e`, clean tree; not merged to `main`; no remote.

Full gate, integrator-run: build **10/10** · typecheck **18/18** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (`turbo run test --force --concurrency=1`, 0 of 18 cached):
**2202 tests across 18 turbo tasks** (2055 → **+147**), zero failing. Per package — core **339** ·
db **56** · schema **216** · **mail-providers 57 (new)** · calendar-providers **74** ·
health-providers 311 · ai-providers 25 · api-client 93 · api 496 · worker **159** · mobile 376.
**No package decreased**, and both zero-drift canaries (`calendar-providers` 74, `worker` 159) held
exactly.

Migrations **15 `.sql` / 15 journal entries**, highest `0014_mail_integration`. Applied once each to
dev and `personalos_test`; a disposable database migrated `0000` → `0014` produced a `public` schema
**byte-identical to dev** (632 lines, matching sha256); `db:reconcile` derived and confirmed
**27/27 probes** for `0014` without aborting. `health_observations` **0**; `heart-rate-intraday`
disabled with zero runs ever. Forbidden-area drift **zero**. **Zero new registry dependencies.**

*Previous verification — Phase 7 Checkpoint 7.0 (2026-08-30): 2055 tests across 17 turbo tasks,
calendar-providers 74, worker 159, 14 migrations. Before it, Checkpoint 6.7A (2026-08-28): the same
2055 / 17.*

## Superseded verification (Checkpoint 7.0)

**Phase 7 Checkpoint 7.0 — ADR gate and documentation reconciliation (2026-08-30).** Branch `main`,
HEAD `8b7a9eb`, clean tree before the documentation edits; the repository has no remote. This
checkpoint changed **documentation only** — `docs/DECISIONS.md`, `docs/STATUS.md`,
`docs/ARCHITECTURE.md`, `AGENTS.md` — all of which are `.prettierignore`d and none of which is
compiled or tested, so the gate below measures the **unchanged application tree**.

Full gate, run first-hand by the integrator: build **9/9**, typecheck **17/17**, `eslint .`
**zero output — 0 errors, 0 warnings**, `prettier --check .` *"All matched files use Prettier code
style!"*, `git diff --check` clean.

Full suite, **uncached and serial** (`turbo run test --force --concurrency=1`, 0 of 17 cached,
56.1 s): **2055 tests across 17 turbo tasks**, zero failing. Per package — core 326 · db 21 ·
schema 174 · **calendar-providers 74** · health-providers 311 · ai-providers 25 · api-client 93 ·
api **496** · **worker 159** · mobile 376. Both zero-drift canaries (`calendar-providers` **74**,
`worker` **159**) held exactly.

**This corrects a stale record rather than reporting a change.** The previous `Last verification`
section recorded Checkpoint 6.6's **2038 / worker 152 / api 495 / mobile 367** and was never updated
for Checkpoint 6.7A, whose later run of **2055** is the tree that reached `main`. Checkpoint 7.0
re-measured it directly rather than transcribing 6.7A's numbers, and the measurement agrees with
6.7A exactly. That agreement is the expected result, not a coincidence: at `8b7a9eb`,
`git diff bcf11fc HEAD` excluding documentation paths is **empty**, so `main`'s application tree is
byte-identical to the frozen 6.7A release candidate that produced the 2055 figure. **The
authoritative baseline for Phase 7 is therefore 2055 / 17 turbo tasks, with canaries 74 and 159.**

`gitleaks git`: **182 commits scanned, no leaks.** Migrations **14 `.sql` / 14 journal entries**,
highest `0013_google_health_sync`, **no `0014`**. `packages/db/` untouched. Forbidden-area drift
**zero** — no code, dependency, compose, `eas.json`, `app.config.ts` or test file was modified.
`versionCode` unchanged at **7**. Production untouched; no Google Cloud, OAuth or credential action.

*Previous verification — Phase 6 Checkpoint 6.7A (2026-08-28): 2055 tests across 17 turbo tasks,
calendar-providers 74, worker 159, api 496, mobile 376, 14 migrations. Before it, Checkpoint 6.6
(2026-08-27): 2038 tests, worker 152, api 495, mobile 367.*

## Superseded verification

**Phase 6 Checkpoint 6.5 — full product audit, Rabbit verification and hardening (2026-08-25).**
Local development only; production untouched; branch `phase-6-audit-hardening`, HEAD `df08da8`,
unmerged; the repository has no remote.

Full gate: build 9/9, typecheck 17/17, lint **0 warnings**, `format:check` clean,
`git diff --check` clean, `expo export --platform web` clean with a single `index.html`, and a
release Android APK built successfully via Gradle under JDK 17.

Full suite, **uncached and serial** (`turbo run test --force`, root script pins
`--concurrency=1`): **2035 tests across 17 turbo tasks** (1965 → **+70**). Per package — core 326 ·
db 21 · schema **174** · **calendar-providers 74** · health-providers 311 · ai-providers 25 ·
api-client 93 · api **492** · worker **152** · mobile **367**. **No package decreased.**

The `calendar-providers` zero-drift canary moved from 57 to 74 for the first time since Phase 4.
That is deliberate and is the point of the checkpoint: 6.5's subject is the calendar provider-error
path, so the package legitimately gained a classifier and its tests. No test was removed or
weakened; two assertions were **corrected** because they pinned disproved premises — one literally
asserted that Google's prose survived into a stored column.

`gitleaks git`: **130 commits, no leaks**. Working tree: 76 findings, **every one in a gitignored
path** and **zero in any file git would commit**, classified programmatically with
`git check-ignore` rather than asserted.

Migration invariant: **14 `.sql`, 14 journal entries** — 6.5 adds none, and `packages/db/` has an
empty diff against `d5e4cb5`. Forbidden-area drift **zero** across `app.config.ts`, `eas.json`,
every compose file and Dockerfile, `.github/`, and `packages/db`. `apps/api/src/brief/**` is
byte-unchanged and `BriefInput` still carries no health field. No OAuth scope was added or changed;
nothing writes `health_observations`; `heart-rate-intraday` remains excluded by acquisition mode.

Physical device: Rabbit R1, Android 16 / SDK 36, 480×640, via the side-by-side
`com.himal.personalos.dev` UI-test identity. Production `com.himal.personalos` evidence is
identical before and after (versionCode 6, versionName 1.0.0, `firstInstallTime`, `lastUpdateTime`,
dataDir), and only the production package remained installed at the end. A release APK was used so
**no Metro or watch server ran**; the API ran as one short-lived process and **the worker was never
started**, so no Google call was reachable. Every repository process was stopped and every port
released.

*Previous verification — Phase 6 Checkpoint 6.4 (2026-08-25): 1965 tests across 17 turbo tasks,
calendar-providers 57, worker 145, 14 migrations.*

### Earlier — Phase 6 Checkpoint 6.1

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



<!-- Relocated by Checkpoint 8.0 from docs/STATUS.md lines 6738-6769 -->
<!-- This was the '## Last verification' section; it recorded Checkpoint 7.7 and was already stale (7.8A moved the baseline to 3,009 tests). Retained verbatim. -->

## Last verification

**Phase 7 Checkpoint 7.7 — hardening + full live proof (2026-09-01).** Branch
`phase-7-mail-monitoring`, five commits from `069477b`; clean tree; not merged to `main`; no remote.

Full gate, integrator-run: build **11/11** · typecheck **21/21** · `eslint .` **0 errors, 0
warnings** · `prettier --check .` clean · `git diff --check` clean · `expo export --platform web`
clean with exactly one `index.html`.

Full suite, **uncached and serial** (0 of 21 cached): **3001 tests across 21 turbo tasks**
(2987 → **+14**), zero failing. Per package — core 375 · db 79 · schema 255 · **monitoring 132** ·
mail-providers 113 · **calendar-providers 74** · health-providers 311 · ai-providers 25 ·
api-client 121 · api **608** · worker 409 · mobile **499**. **No package decreased.**

Live proofs: monitoring **33/33** (real local HTTP server, 10 real requests) · heartbeat + real TLS
handshake **20/20** · mail sync against the **real Gmail API** (**1019 read-only requests**, 500
messages, cursor expiry → bounded full resync, **zero duplicate identities**) · digest + adversarial
corpus **39/39** · notifications through real pg-boss **18/18** (deferral read from
`pgboss.job.start_after`: exactly 420 minutes) · security audit **8/8**.

Mutation testing: **9 of 9** protections load-bearing. Migrations **16 `.sql` / 16 journal
entries**, no `0016`, `packages/db` byte-unchanged. `gitleaks git` clean.

Bundle: every server-only symbol and Node builtin absent except one `node:crypto`, which is **inside
expo's own uuid module** behind a `typeof window` guard — vendor dead code, not ours; `apps/mobile`
imports no `@personal-os/core` barrel.

Production: **read only**, 4 containers up 2 days, migration level **14**, unchanged.

*Previous verification — Phase 7 Checkpoint 7.6 (2026-09-01): 2987 tests across 21 turbo tasks,
calendar-providers 74, mobile 494, api 603, monitoring 128, 16 migrations.*


---

## Checkpoint 7.9 — Post-deployment observation (CLOSED 2026-09-02)

Moved here from `docs/STATUS.md` at closure. **The record below is verbatim as it stood while the
checkpoint was open** — its heading still says OPEN and its "Still open" list still names the first
digest, because nothing recorded during an observation is rewritten afterwards. The closure evidence
gathered on 2026-09-02 follows it.

### Checkpoint 7.9 — Post-deployment observation (OPEN; digest lane time-gated, opened 2026-09-01)

Observation only. **No feature, no code change, no migration, no OAuth grant change, no credential
rotation, no scope change.** Production was read.

**This checkpoint CANNOT close today and is not claimed complete.** The mail digest fires at
`0 7 * * *` in `America/Chicago` — **12:00 UTC** — and the deployment landed at ~17:45 UTC, so the
first scheduled execution is the morning of **2026-09-02**. `mail_digests` is empty and **no digest
has ever been generated by a real model.** Everything else is observed below.

#### 1. Gmail — the cursor is doing its job

Eight runs in the first ~2 hours, **8 succeeded, 0 failed**:

| Time (UTC) | Kind | Req | Inserted | Rejected | Tombstoned | Cursor expired |
|---|---|---|---|---|---|---|
| 18:15:12 | **full** | 506 | 500 | 0 | 0 | false |
| 18:30:13 | incremental | 1 | 0 | 0 | 0 | false |
| 18:45:13 | incremental | 2 | 1 | 0 | 0 | false |
| 19:00:14 | incremental | 2 | 1 | 0 | 0 | false |
| 19:15:44 | incremental | 2 | 1 | 0 | 0 | false |
| 19:30:15 | incremental | 2 | 1 | 0 | 0 | false |
| 19:45:15 | incremental | 1 | 0 | 0 | 0 | false |
| 20:00:14 | incremental | 4 | 3 | 0 | 0 | false |

**This is the shape the design predicts, observed rather than argued.** A quiet tick costs **one**
request — `history.list` alone. A tick with new mail costs one more request per message, which is
7.2P's N+1 finding: listing returns references only, so metadata needs a second call each. The full
sync's 506 requests for 500 messages is the same arithmetic at scale.

| Invariant | Result |
|---|---|
| Cursor advancement | `6709265` → **`6709471`**, `needs_full_resync = false` throughout |
| Duplicate `(connection, external_id)` identities | **0** |
| `cursor_expired` runs | **0** |
| Full resyncs after the first | **0** |
| Rows rejected / tombstoned | **0 / 0** |
| Provider errors | none — `last_sync_error` null the whole window |
| Messages | 500 → **507** |
| Header-only invariant | **0** body/snippet/payload/attachment columns exist (checked against `information_schema`, not the migration text) |

#### 2a. Mail digest — MANUAL PIPELINE VALIDATION **PASSED** (2026-09-01T20:14Z)

Triggered through the designed manual path — `POST /mail-digests`, which enqueues **the same job the
cron enqueues**. pg-boss was not bypassed, the worker was not called directly, no test-only data was
created, and this ran against the real deployed production environment. **The first digest ever
generated by a real model.**

| Lane | Result |
|---|---|
| HTTP | `202 {"accepted":true}` — accepted, never "a digest exists" |
| Job | `mail.digest.generate`, `singleton_key=mail-digest`, created `20:14:40`, started `20:14:40`, **completed `20:14:44`**, `retry_count=0` |
| Failed digest jobs | **0**; `pgboss.job.output` **null** |
| Route resolution | `mail_digest` → `gpt-4.1` via connection *My OpenAI* |
| **Model provenance** | `mail_digests.model_id = ai_task_routes.primary_model_id` → **true**. `callWithFallbackTracked` recorded the model that actually served, not the assumed primary |
| Row | exactly **1**; `digest_date = 2026-09-01`, `timezone = America/Chicago` |
| Identity | matches the machine's own `America/Chicago` local date — the date came from the zone, not a UTC slice |
| Unique key | 1 row / **1 distinct `(digest_date, timezone)`** |
| Persisted shape | content top-level keys are **exactly `text`** — ADR-043's "the server owns the persisted output shape", despite `BriefContentSchema` being `.passthrough()` |

**Output safety — every ADR-054 control verified against the real generated text:**

| Check | Count |
|---|---|
| Scheme URLs (`http/https/javascript/data`) | **0** |
| `www.` hosts | **0** |
| Email addresses | **0** |
| Markdown link targets | **0** |
| **Stored subjects appearing verbatim** (content laundering) | **0** |
| Stored `from_address` appearing | **0** |
| Stored `from_domain` appearing | **0** |

The last three are the strongest result: they compare the generated prose against **every stored
message row**, so this is not a pattern guess — no subject, address or domain from the mailbox
survived into the persisted text.

The prose describes what the mail **is**, not what it says — counts, unread totals and category
breakdown — which is exactly the capability reduction ADR-054 specifies.

**Log scan since the trigger:** `ya29.`, `GOCSPX`, `refresh_token`, `client_secret`,
`Failing row contains`, `subject`, `from_address` — **0 each**; log lines containing an `@` address
— **0**; digest-related log lines — **0**. Nothing to leak because nothing was logged.

**Data integrity:** `mail_messages` column count unchanged at **16**. Row count moved 507 → 509 and
that was **the `*/15` sync cron at 20:15**, not the digest — confirmed by one mail sync run in the
window with `rows_inserted = 2`. The digest lane has no write path to `mail_messages` at all.

**System health after:** health `active`, calendar `active`, mail `active`, monitoring **344 checks /
344 up / 0 incidents**, migration level 16, all containers `restarts=0`.

#### 2b. Mail digest — SCHEDULED CRON VALIDATION still PENDING (2026-09-02T12:00Z)

The manual run proves the **pipeline**. It deliberately does not prove the **schedule**, and that
distinction matters here because `MAIL_DIGEST_TIMEZONE` was set and the worker restarted to
re-register `mail.digest.cron` during this very deployment. What remains to observe:

- a **cron-created** `mail.digest.generate` job exists at `2026-09-02T12:00:00Z`
- it executes automatically with no manual trigger
- it **upserts the same `(digest_date, timezone)` row** rather than inserting a second
- **no duplicate digest rows** result

`mail_digests` must still contain exactly one row per `(digest_date, timezone)` afterwards.

#### 2. Mail digest — superseded by 2a/2b above

Everything upstream is in place and verified: `mail.digest.cron` registered `0 7 * * *`
**tz=`America/Chicago`**, the `mail_digest` route resolves to `gpt-4.1`, and an active mailbox with
507 messages exists for it to describe. `mail_digests` is **empty**. Nothing about generation,
model resolution, output safety or persistence can be claimed until it runs.

#### 3. Monitoring — clean, and no false positives

**314 checks across 5 targets: 314 `up`, 0 `down`, 0 `skipped`, 0 incidents.** Every target was
checked within 30 seconds of the observation. The incident lifecycle has had no opportunity to fire,
which is the correct outcome for healthy infrastructure and is recorded as *untested-in-production*
rather than as *proven*.

Both tailnet targets stayed `up` for the whole window at ~230–250 ms, so ADR-055's former blind spot
is now continuously observed. `worker-heartbeat` continues to record `latency_ms = null`.

#### 4. Integrations — all three stable

| | |
|---|---|
| Google Health | `active`, **54 sync runs since deployment, 54 succeeded, 0 failed**, newest data `2026-09-01` |
| Google Calendar | `active`, ~32 jobs/hour, no errors |
| Gmail | `active`, above |

#### 5. Security — nothing crossed

Logs since deployment scanned for `ya29.`, `GOCSPX`, `refresh_token`, `client_secret`, `1//` and
`Failing row contains`: **0 hits each**. And the stronger result for ADR-054: the worker has emitted
**zero log lines mentioning mail at all**, so no subject, sender or address could have leaked —
absence by construction rather than by filtering.

Migration level **16**, all four containers `restarts=0`, both Serve routes tailnet-only.

**The single `failed` pg-boss job is PRE-deployment** — `calendar.google.sync-calendar`, created
`08-31 23:15`, which is the original incident's own failure. No job has failed since deployment.

#### Still open

1. **The first digest**, `2026-09-02T12:00Z`. The one genuinely unproven lane.
2. **Incident lifecycle unexercised in production** — nothing has gone down. Verified by test and by
   7.7's live proof, not by production.
3. **Vestigial Health scopes on the old app**, so the Gmail token carries eight scopes rather than
   five. Harmless (no mutation method exists, the lane calls only Gmail, Health uses a different
   client) but a real widening.
4. **Two client secrets** on the Gmail client — Google flags it; delete the unused one.
5. **Privacy-policy URL debt**, now in two projects.
6. **F5 / raw intraday heart rate** still excluded, `health_observations` still 0.


---

### 7.9 closure evidence — the scheduled cron lane (2026-09-02)

Gathered first-hand against production over read-only SSH + `psql`. One write was made, and only
one: the same-date digest regeneration that section 3 describes, which was explicitly authorized for
the upsert proof.

#### 1. The cron fired, and the proof is structural rather than circumstantial

The discriminator is architectural, not inferred from timing. `apps/worker/src/index.ts` schedules
**`mail.digest.cron`** at `0 7 * * *` tz `America/Chicago`, and that queue's *handler* then sends
`mail.digest.generate`. `POST /mail-digests` sends `mail.digest.generate` **directly and never
creates a `mail.digest.cron` job at all**. So a completed `mail.digest.cron` row is something a
manual request cannot produce.

`pgboss.job`, all four digest jobs that have ever existed:

| name | state | retry | created (UTC) | started (UTC) | completed (UTC) |
|---|---|---|---|---|---|
| `mail.digest.generate` | completed | 0 | 09-01 20:14:40.406964 | 20:14:40.518300 | 20:14:44.582602 |
| **`mail.digest.cron`** | completed | 0 | **09-02 12:00:14.061437** | 12:00:16.014785 | 12:00:16.030474 |
| `mail.digest.generate` | completed | 0 | **09-02 12:00:16.022845** | 12:00:18.015439 | 12:00:22.340121 |
| `mail.digest.generate` | completed | 0 | 09-02 19:11:48.086588 | 19:11:49.121048 | 19:11:52.300699 |

**The causal nesting is strict at microsecond resolution.** The scheduled generate job was created
`12:00:16.022845` — **8.06 ms after** the cron handler started and **7.63 ms before** it completed,
i.e. strictly inside the handler's 15.7 ms execution window. That is the handler's own `boss.send()`.

Four independent corroborations, each of which could have falsified the claim:

- **Schedule matches.** `pgboss.schedule` holds `mail.digest.cron` = `0 7 * * *`, tz
  `America/Chicago`. On 2026-09-02 Chicago is CDT (UTC−5), so 07:00 local **is** 12:00 UTC.
- **No POST exists at that time.** The entire API container log contains exactly **three**
  `POST /mail-digests` — 09-01T20:14:40Z and the 09-02T19:11:41Z/19:11:48Z pair from the upsert
  proof. **None at or near 12:00Z.** The event class is demonstrably logged, so the absence is
  informative rather than a logging gap.
- **The worker logged the generation**, `12:00:22.339Z`, 1 ms before the job's `completed_on`.
- **The notification followed**, `notification_dispatch_log` accepted at `12:00:24.030568`.

Each of the three `generate` jobs has exactly one accounted-for producer. There is no unexplained
job, **zero failed digest jobs**, and `retry_count = 0` and `output IS NULL` on all four.

The **only** failed pg-boss job anywhere in the system remains the pre-deployment
`calendar.google.sync-calendar` of 2026-08-31 23:15 — the original ADR-053a incident. Nothing has
failed since deployment. (Caveat of reach: pg-boss retains ~7 days and this version has no
`pgboss.archive`, so that is provably true of current contents, not an all-time statement.)

#### 2. AI execution and model provenance

`ai_task_routes.mail_digest` → `gpt-4.1` via connection *My OpenAI*, `fallback_model_ids` **empty**
(primary-only, ADR-044). For **both** digest rows,
`mail_digests.model_id = ai_task_routes.primary_model_id` — `callWithFallbackTracked` recorded the
model that actually served, and with no fallback configured the primary is the only thing it could
have been.

The worker's own line, which is the whole of what it logged about the digest:

```
{"event":"mail.digest.generated","localDate":"2026-09-02","tz":"America/Chicago",
 "messages":22,"unread":17,"mailboxes":"[forbidden-field]","highlights":12,
 "linksRemoved":0,"modelId":"313633f4-…"}
```

`localDate` came from the configured zone, not a UTC slice. `[forbidden-field]` is the log
redactor **actively firing** on a field the logger refuses to emit — a control working, though it is
also a logging defect nobody had recorded (see below).

#### 3. Same-key upsert — proven, and proven at the storage layer

`(digest_date, timezone) = (2026-09-02, America/Chicago)` was regenerated once through
`POST /mail-digests` — the designed path, enqueuing the same job the cron enqueues. pg-boss was not
bypassed, worker code was not invoked directly, and no test-only data was created.

| | before | after |
|---|---|---|
| row id | `e9a60134-…` | **`e9a60134-…` (unchanged)** |
| `generated_at` | 12:00:18.023Z | 19:11:49.135Z |
| content md5 | `b4f40401…` | `f7b5113a…` |
| text length | 1143 | 733 |

**2 rows / 2 distinct `(digest_date, timezone)` / 1 row for the target key.** The 2026-09-01 row was
untouched (same id, same md5, same `generated_at`). A second row for a *different* date is correct
and is not a duplicate.

Two independent proofs that this was an UPDATE and not a delete+insert:

- **`created_at` survived.** The row still carries `created_at = 2026-09-02 12:00:22.313242+00`, the
  cron insert's stamp, while `updated_at` moved to 19:11:49. A delete+insert would have minted a new
  uuid and a new `created_at`.
- **`pg_stat_user_tables`** for `mail_digests`: `n_tup_ins = 2`, `n_tup_upd = 1`,
  `n_tup_hot_upd = 1`, **`n_tup_del = 0`**, with `pg_stat_database.stats_reset` NULL, so the counters
  span the table's entire lifetime. **No tuple has ever been deleted from this table.**

Identity is structurally guaranteed, not merely observed: `mail_digests_date_timezone_unique` is a
non-partial UNIQUE index on `(digest_date, timezone)`.

The manual regeneration produced **no `mail.digest.cron` job**, which re-confirms the section-1
discriminator as a controlled experiment: both paths were exercised on the same day and differ
exactly as predicted.

#### 4. Output safety — seven checks pass, and one new defect was found

Every check below runs in SQL against the persisted `content->>'text'`, compared where relevant
against **all 536 stored `mail_messages` rows**. No mailbox content was printed.

| Check | 2026-09-01 | 2026-09-02 |
|---|---|---|
| scheme URLs (`http/https/javascript/data/ftp/file/mailto`) | 0 | 0 |
| `www.` hosts | 0 | 0 |
| markdown link targets | 0 | 0 |
| email addresses | 0 | 0 |
| credential-shaped values | 0 | 0 |
| stored subjects appearing verbatim | 0 | 0 |
| stored `from_address` appearing | 0 | 0 |
| stored `from_domain` appearing (equality) | 0 | 0 |

The persisted row's existence is itself proof the output filter accepted the result:
`containsLinkShapedContent` is asserted **inside** the generation attempt (`generate.ts:149`) and a
digest that fails it is refused rather than persisted. `linksRemoved = 0`, so the model emitted no
link-shaped content for the filter to strip.

**NEW DEFECT — bare-domain laundering through `from_display_name`.** An adversarial re-check with a
*shape*-based regex rather than an equality test found the 2026-09-02 digest contains exactly **one**
bare-domain token (`md5(lower) = ed8ece8947697e8ed72f1acee78c97c8`; the 2026-09-01 digest has none).
Its provenance is closed, not guessed:

| test | result |
|---|---|
| equals a stored `from_domain` | **0** ← why an equality check returned 0 |
| substring of a stored `from_domain` | 6 |
| substring of a stored `from_display_name` | 6, carried by **1** distinct display name |
| substring of any stored `subject` | **0** ← rules out the subject hypothesis |
| stored display names that are domain-shaped | 6 |

It was neither invented nor lifted from a subject line: it arrived inside a **sender display name**
and was carried verbatim into persisted first-party prose. This matters for three reasons:

1. It violates the system prompt twice (`prompt.ts:48`, `:50` — *"Never output a URL, a link, a
   domain name…"*). The model disobeyed and nothing downstream caught it.
2. **The written justification in `output.ts:43-48` is factually false.** It argues the un-stripped
   bare-domain residual is *"narrow BY CONSTRUCTION rather than by luck: `MailDigestInput` carries no
   `from_address` and no `from_domain` … Anything domain-shaped in the output was either invented or
   lifted out of a subject line."* But `from_display_name` **is** in the model's input allowlist and
   is one of exactly two attacker-chosen fields (ADR-054). Production has falsified both disjuncts.
   The comment is arguably the more dangerous artifact, because it will stop the next reviewer
   looking.
3. It is deterministic and available today: any sender who sets their display name to a domain gets
   it laundered into persisted Personal OS prose. This is precisely ADR-054's named *content
   laundering* risk, realized.

**Severity, bounded honestly rather than inflated.** It is **not clickable**: `apps/mobile/src`
contains zero autolink sinks (no `dataDetectorTypes`, `autoLink`, `Linkify`, or
`dangerouslySetInnerHTML`), and push copy is fixed and carries no mail content. ADR-054's actual
guarantee — that the digest lane has no tools, writes only text, and reaches no other table — is
**intact**. So this is disclosure plus a falsified structural claim plus a prompt violation, not a
working link. It becomes one the moment any renderer enables autolinking, which is a one-line change
nobody would flag as security-relevant. Filtering the bare-domain case is the deliberate, documented
design choice; only its stated *reason* is wrong.

**A limitation of this record, stated rather than glossed.** The cron-generated text was checked
against the eight categories above and passed all eight, but the bare-domain shape check did not
exist yet, and the authorized regeneration then overwrote that text. **The 12:00 run is proven to
have happened and to have persisted; its output was never bare-domain-checked before being
replaced.** The next unmolested cron firing closes that.

**Log scan since the cron window.** Worker and API, patterns `ya29.`, `GOCSPX`, `refresh_token`,
`client_secret`, `1//`, `sk-`, `gsk_`, `BEGIN…PRIVATE KEY`, `Failing row contains`, `subject`,
`from_address`, `from_domain`, `from_display_name`, and any email-address shape: **0 each, both
containers.** The worker emitted exactly one digest line (above); the API emitted **zero** lines
mentioning mail at all across 2,746 lines. `pgboss` `output` is NULL on every digest job.

**Header-only invariant** re-checked against `information_schema` rather than migration text:
`mail_messages` has **16** columns and **zero** body / snippet / payload / attachment-content
columns. (`content_hash` is a hash, not content.)

#### 5. Production state

| | |
|---|---|
| Google Health / Google Calendar / Gmail | all `active`, `last_sync_error` NULL on all three |
| Gmail sync | 96 incremental runs in 24 h, **96 succeeded, 0 failed**, **0 cursor expirations**, `needs_full_resync` false throughout; 536 messages |
| Monitoring | 5 targets, **3,879 checks, 3,879 up, 0 down, 0 incidents**; both Tailscale Serve routes continuously observed |
| Containers | api / worker / web / postgres all `restarts=0`, all running |
| `/health` | `status: ok`, `db: connected`, `worker.stale: false` |
| Migration level | **16**; `drizzle.__drizzle_migrations` count = 16 |
| Postgres exposure | `Ports = {"5432/tcp": null}`, no host binding, no listener |

#### 6. Findings recorded by this closure

**Positive, previously unrecorded:**

- The **mail-digest notification producer is correctly per-occurrence scoped** —
  `mail-digest:<date>:<tz>:<deviceId>`. It satisfies ADR-056's dedupe-discriminator rule, unlike the
  two integration producers ADR-057 flags.
- The **stale `health.google.sync-connection` job** that `docs/STATUS.md` recorded as stuck in state
  `created` is **gone** — consumed. That debt entry is retired.

**New defects, all assigned to Checkpoint 8.1:**

- **Bare-domain laundering via `from_display_name`**, and the false "narrow by construction" comment
  in `output.ts`. Same defect class as ADR-057's already-assigned Brief-lane output-filter and
  prompt-premise backport.
- **Monitoring under-samples on every probing target.** Since deployment: `api-internal-health`
  1,463 checks against 1,538 due (95.1%); the three 300 s targets 301 against 307 each (98.0%);
  `worker-heartbeat`, which performs no probe, 1,536/1,538 (99.9%). Every check is `up`, so this is
  `monitor.run` beat-skew rather than an outage — but "5/5 up, 0 incidents" masks a sampling
  shortfall and lengthens worst-case detection latency.
- **The log redactor fires on an intentionally-logged field** (`"mailboxes":"[forbidden-field]"`).
  Defensive rather than a leak, but a logging defect.

**Confirmed still armed (ADR-057, unchanged):** `health-sync-alert:<connId>:auth_permanent` is
present and `accepted` (2026-09-01) and `calendar-needs-reauth:<connId>` likewise (2026-08-25).
Neither can be proven fixed until 8.1 ships corrected producers.

**Still genuinely unproven in production:** the incident lifecycle (nothing has gone down — 3,879
checks, 0 down), Gmail cursor-expiry recovery (0 expirations across all runs), the hung-worker blind
spot behind a healthy API, and F5 / raw intraday heart rate (`health_observations` still 0).

**Carried forward unchanged from the open record:** vestigial Health scopes on the old OAuth app,
two client secrets on the Gmail client, and privacy-policy URL debt in two Google projects.

**Checkpoint 7.9 is COMPLETE. Phase 7 is CLOSED.**
