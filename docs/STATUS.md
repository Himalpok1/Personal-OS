# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 8 — Consolidation & adoption (ADR-056, approved 2026-09-02).** Checkpoint **8.0 — Foundation / Discovery Gate closure** is the current work.
**Next checkpoint allowed:** **8.1**, and only after Checkpoint **7.9 is formally closed**. No Phase 8 runtime, API, worker or mobile deployment may occur before then.
**Canonical architecture:** `docs/ARCHITECTURE.md` · **Canonical decisions:** `docs/DECISIONS.md` · **Historical record:** `docs/history/`

---

## How to read this file

This file is **present state only**. It was 7,283 lines and 689,163 bytes before Checkpoint 8.0,
which auto-loaded ~172k tokens into every agent context through `CLAUDE.md`. Closed-phase material
now lives in `docs/history/`, **verbatim and unaltered** — nothing was deleted, shortened or
rewritten, only relocated.

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
| `docs/history/phase-7.md` | Phase 7 | Gmail integration, mail digest, service monitoring — **7.0–7.8B only; 7.9 is open and lives below** |
| `docs/history/superseded-present-state.md` | — | Prior revisions of this file's present-state sections, archived verbatim by 8.0 |

## Production state at a glance

| | |
|---|---|
| Migration level | **16** (`0000`–`0015`); local and production agree |
| Serving commit | `a5bbc48` — api/worker/web images built from it |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active** |
| Monitoring | 5 targets seeded, including both Tailscale Serve routes |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Test baseline | **3,009 tests / 21 turbo tasks** (see *Last verification*) |

---

## Phase 8 — Consolidation & adoption (approved 2026-09-02, ADR-056)

Phase 8 supersedes the `docs/ARCHITECTURE.md` Phase 8 entry. It is **not** an AI capability phase.

**Objective: make Personal OS a daily driver.** Make failures visible, reduce capture friction,
make stored content findable, make project and source state durable, reduce agent context overhead,
then run an instrumented adoption soak whose deliverable is evidence rather than a feature.

**Approved checkpoints:** 8.0 foundation · 8.1 make failure visible · 8.2 enable the real calendar ·
8.3 query-time search and export · 8.4 capture front doors · 8.5 instrumented adoption soak ·
8.6 decide on evidence.

**Approved scope at this time is 8.0 only.**

### Why Phase 8 is consolidation — the measurement that decided it

Taken first-hand at Checkpoint 8.0, not inferred:

- The repository is **eighteen days old**: first commit `fba85f1` 2026-08-15, HEAD `533601c`
  2026-09-01, **244 commits**, eight phases.
- Production holds **2 tasks, 3 notes, 6 inbox items, 0 projects, 0 events, 0 occurrences** — while
  health syncs hourly, mail and calendar every fifteen minutes, and monitoring every minute. The
  integrations have data; the user-authored core does not.
- `docs/ARCHITECTURE.md` gives exactly one explicit product instruction — *"Live on Phases 0–3 for a
  month before continuing. Half of what you think you want in Phase 4 will change"* — and it was
  skipped by **zero days**: Phase 3 Checkpoint 6 closed 2026-08-20 and Checkpoint 4.1 is recorded
  complete the same day.

The near-empty core is therefore treated as the **forecast consequence of a skipped soak**, not as a
falsified product thesis. Phase 8 reinstates the soak rather than building over the emptiness.

### Checkpoint 8.0 — Foundation / Discovery Gate closure (IN PROGRESS, 2026-09-02)

Documentation, source durability and project-record maintenance **only**. No application code, no
test, no migration, no queue, no deploy, no production write, no mobile build. Branch
`phase-8-consolidation`, cut from `phase-7-mail-monitoring` at `533601c`.

**Lane A — ADR-056 / Phase 8 definition (COMPLETE).** ADR-056 added to `docs/DECISIONS.md`;
`docs/ARCHITECTURE.md`'s Phase 8 entry and its "Embedding generation" worker-job row superseded.
Recorded: read-only intelligence before write-capable intelligence; the hybrid AI privacy posture
(local retrieval and corpus selection when needed, bounded cloud reasoning) with **unrestricted
full-content cloud egress explicitly not approved**; that no retrieval layer is necessary at the
observed corpus size; that **pgvector is excluded from Phase 8 and is not permanently forbidden**,
with the Postgres image frozen and any future image change requiring its own infrastructure ADR and
explicit owner approval; the migration posture (prefer new tables over widening existing ones); AI
lane-placement principles; and the per-occurrence dedupe-discriminator rule. ADR-018, ADR-024 and
ADR-046 are explicitly preserved unchanged.

**Lane B — documentation / context compaction (COMPLETE).** See *Context compaction* below.

**Lane C — ADR / ledger reconciliation (COMPLETE).** An independent read-only audit checked every
ADR making a verifiable claim about the *current* system. Three inaccuracies were suspected; **eight
were found**. `ADR-057` records all eight with evidence, and each affected ADR now carries an inline
`**[Present state corrected by ADR-057.]**` pointer. **No decision was reversed and no historical
rationale was rewritten** — editing a Locked cell's text would itself be a change to a Locked
decision, so the originals stand and the correction lives beside them.

| # | ADR | Claim | Reality |
|---|---|---|---|
| 1 | ADR-047 | "only operational metadata (`health_sync_runs`, expired OAuth states) is swept" | **Neither is swept.** Both sweep functions exist, are exported, and have **zero production callers**. OAuth states are *consumed*, never deleted, so both state tables grow monotonically. The one deletion that *does* run — the hourly orphan-audio file sweep — is not named by the clause. ADR-047's health-data prohibition is unaffected and stands. |
| 2 | ADR-054 | a mail prune is "permitted and required", window "recorded in `docs/STATUS.md`" | **No prune, no queue, no cron, no window, nothing recorded.** The decision stands; the present state does not match it. |
| 3 | ADR-054 | email is "the first attacker-authored input to reach the AI layer" | **False as capability, true as occurrence.** Calendar `title`/`description`/`location` arrive verbatim from Google and CalDAV, are stored **unbounded** (no Zod `.max()`, no truncation at write), and reach the Brief prompt — a path shipped at Checkpoint 5.5, a week before ADR-054 was written. It has **never been exercised**: `events` is 0 and only an empty test calendar is sync-enabled. |
| 4 | ADR-055 | alert dedupe keys are "incident-scoped" | **True for the 3 monitoring producers, false for both integration producers.** See below — one of them is a live, currently-armed silent failure. |
| 5 | ADR-034 | Firebase/FCM and Groq are "local development only. Production has neither" | **Stale since Phase 3 Checkpoint 6.** Both are provisioned in production. |
| 6 | ADR-055 | worker-to-Tailscale reachability "must be proven in Checkpoint 7.5" | **Not proven in 7.5; proven in 7.7** from inside the running production worker. |
| 7 | ADR-051 | "No second … project … exists or may be used" | **Superseded for Health only by ADR-051b**; `personal-os-health` is live. ADR-051's own text was never updated. |
| 8 | ADR-052 | deployment gated on `2026-09-04T20:08:25Z` | **Waived by ADR-051a**; Phase 7 deployment completed at 7.8B. |

#### ⚠️ A live, currently-armed silent failure found by this lane

Finding 4 is not only a documentation defect. There are five `category: "alert"` producers. The
three monitoring ones are correctly incident-scoped. The two integration ones are not:

- `calendar-needs-reauth:<connectionId>` (`apps/worker/src/jobs/calendar-refresh-token.ts:144`) —
  **no discriminator at all.** Already burned on 2026-08-25, which is why the 2026-08-31 calendar
  failure notified nobody. Known.
- `health-sync-alert:<connectionId>:<reason>` (`apps/worker/src/health/orchestrate.ts:819`) —
  **newly identified at Checkpoint 8.0.** Scoped only by a failure class from the closed set
  `breaker:<metric>`, `auth_permanent`, `all_streams_failed`. Against a permanent PRIMARY KEY with
  no TTL, written with `onConflictDoNothing`, each connection-plus-reason pair burns permanently on
  first use. That key **was dispatched and accepted for `auth_permanent` on 2026-09-01**, and
  ADR-051b records that the recovery **rebound the same connection row with `created_at`
  preserved** — so the connection id is unchanged and **the next `auth_permanent` failure on the
  production Health connection will alert nobody.**

Earlier records framed Health as the *safe counter-example* to Calendar. That is accurate only about
the first occurrence. **Both keys need re-arming, and that is Checkpoint 8.1 work.**

#### Deferred by this lane — nothing was implemented to satisfy any correction

| Item | State | Assigned to |
|---|---|---|
| Re-arm the Calendar and Health alert dedupe keys | Not implemented; both burned | **8.1** |
| Clean up the obsolete burned `notification_dispatch_log` rows | Not done; **deliberately not done in 8.0** | After 8.1 deploys corrected producers and new occurrence-scoped keys are verified, then **owner-approved** |
| Backport the output filter, corrected prompt premise and bounded event text to the Brief lane | Not implemented | **8.1** — and a precondition for **8.2** |
| Wire the two OAuth-state sweep functions (or delete them) | Not implemented; dead exported code | Later checkpoint, with retention |
| Mail prune job and its window | Not implemented; window unset | Later checkpoint; **window is an owner decision** (ADR-024 makes deletion irreversible) |

Wiring any of these in 8.0 would have been implementing missing jobs, which this checkpoint forbids.

**Lane D — source durability (PREPARED; owner action required).** Design and prerequisites are
complete in **`docs/SOURCE-DURABILITY.md`**; the actions that would actually create a second copy
are owner-only and were **not** performed.

The risk, measured first-hand: **zero git remotes**, **no CI** (`.github/` does not exist), 244
commits, and the commit production is serving (`a5bbc48`) is contained by **exactly one branch**
(`phase-7-mail-monitoring`, 57 ahead of `main`) on **one external USB SSD**. Production holds no
second copy — releases ship as `git archive` of tracked files, which by design contains no `.git`,
so the host has a flat file tree of that commit and not the commit itself.

**Closed in this checkpoint (agent-doable, and it had to precede any remote):** `.gitignore`
line 18 was literally `.env`, which left `.env.production`, `.env.backup` and
`.env.pre-<checkpoint>` **fully visible to `git add -A`** — and Checkpoint 7.2 created exactly such
a file, a plaintext copy of every secret, and deleted it by hand afterwards. Both root and
`apps/mobile` ignore files now cover `.env.*` with `!.env.example`, proven by `git check-ignore`
before and after, with both example files confirmed still tracked. Without a remote such a mistake
is local and removable; **with one it is published permanently and forces credential rotation**, so
this gap had to close first. Separately, `apps/mobile/.env` — which holds an `EXPO_TOKEN` absent
from its `.env.example` — was mode 644 while the root `.env` was 600; it is now 600.

**The sharpest durability risk is not the repository.** `CREDENTIALS_ENCRYPTION_KEY` protects every
stored OAuth credential across four tables and five integrations, with **no key version, no KDF and
no rotation path anywhere in the codebase**, and it exists on exactly two hosts. Losing the drive
costs history; losing that key makes every stored credential permanently undecryptable and forces
re-consenting three Google integrations across two Cloud projects.

**Verified while assessing a hosted remote:** `gitleaks git --log-opts=--all` scans all 244 commits
clean — no credential, keystore or `google-services.json` has ever been committed on any branch.
The open question for a hosted remote is therefore **disclosure, not secrets**: `docs/history/` now
carries the full operational record, which collectively maps the tailnet, the production host
account and the Google project. That is an owner judgement call and is documented rather than
decided.

**ADR-024 and ADR-018 are both untouched.** ADR-024 governs a *database backup system*; a git
remote replicates already-plaintext source, and an encrypted config file is provisioning material.
ADR-018 governs *ingress to the production host*; `git push` is egress from a development machine.
Neither option opens a port or adds a listener.

### Context compaction — measured before and after

`CLAUDE.md` `@`-imports its documentation set into every agent context before any work begins. That
set was **795,997 bytes**, of which `docs/STATUS.md` alone was **689,163 bytes (87%)**, and it had
grown from 2 KB on 2026-08-15 to 689 KB on 2026-09-01 — roughly +25k tokens per week. A Phase 8 the
size of Phase 7 would have pushed the auto-loaded set past 250k tokens.

**Nothing was deleted and no historical claim was rewritten.** `docs/STATUS.md` was partitioned into
`docs/history/phase-0.md` … `phase-7.md` plus `superseded-present-state.md`, and the partition was
**proven byte-exact**: every one of the 7,284 original lines was reassembled from the output files
and hashed against the original, producing an identical SHA-256
(`ada88b04cbc897e77c1c6eee919872d75cda527f8c73c3fb852d31751d0d920c`). Zero gaps, zero overlaps, zero
loss.

---

## Phase 7 — Email summaries + service monitoring (CLOSED except 7.9)

Checkpoints 7.0 through 7.8B are complete and archived in **`docs/history/phase-7.md`**. Phase 7 is
deployed: production moved to migration level 16, api/worker/web serve images built from `a5bbc48`,
and all three Google integrations are active.

**Checkpoint 7.9 remains OPEN and is a Phase 7 closure requirement.** It is reproduced in full
below, unaltered.

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
  The live build context is `/home/himallinux/personal-os-6.7-release` (Checkpoint 6.7B);
  `personal-os-4.7-release`, `personal-os-5.7-release` and `personal-os-5.7.1-release` are retained
  as rollback sources. A Phase 7 deployment would ship into its own new `personal-os-7.8-release`.
- **There is no DELETE endpoint for AI task routes.** Undoing the production `daily_brief`
  registration requires another upsert repointing `primary_model_id`, or direct SQL.
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
- **One pre-existing pg-boss `health.google.sync-connection` job sits in state `created`** from an
  earlier session and was left untouched by 6.6 (no worker ran, so nothing consumed it). It is inert
  and `singletonKey`-deduped, but it will be the first job a worker picks up whenever one next starts.
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


---

## Current objective

**Phase 8 Checkpoint 8.0 — Foundation / Discovery Gate closure.** Documentation, source durability
and project-record maintenance only. Four lanes: ADR-056 and the Phase 8 definition; documentation
and context compaction; ADR/ledger reconciliation; source durability.

Nothing in Checkpoint 8.0 changes application behaviour. The application tree is byte-unchanged and
the standing gate must reproduce **3,009 tests / 21 turbo tasks** exactly — reproducing that number
is the evidence that nothing moved.

## Completed

Phases 0 through 7 are implemented and production-deployed. Detail for each is in `docs/history/`;
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
| **7** | Gmail `gmail.metadata` integration, incremental sync with cursor recovery, AI mail digest, service-monitoring platform with incident lifecycle. **Deployed 2026-09-01; 7.9 still open.** |

**Production is at migration level 16** and serves images built from `a5bbc48`. All three Google
integrations are active. Monitoring runs against five seeded targets including both Tailscale Serve
routes.

## Current work

**Checkpoint 8.0 is in progress.** See the Phase 8 section above for the lane-by-lane record.

Phase 7 is complete except for **Checkpoint 7.9**, whose scheduled mail-digest cron validation is
reproduced verbatim above. That observation is a Phase 7 closure requirement and **gates every
Phase 8 runtime change** — shipping any worker change re-registers pg-boss schedules, which is
precisely what 7.9 measures.

## Last verification

**Phase 8 Checkpoint 8.0 (2026-09-02).** Branch `phase-8-consolidation`, cut from
`phase-7-mail-monitoring` at `533601c`. The application tree is byte-unchanged by this checkpoint,
so this measurement is a *reproduction* baseline, not a new one.

Measured first-hand, uncached and serial (`turbo run test --force --concurrency=1`, **0 of 21
cached**): **3,009 tests across 21 turbo tasks**, zero failing. Per package — api **609** ·
mobile **499** · worker **409** · core 375 · health-providers 315 · schema 255 · monitoring 132 ·
api-client 121 · mail-providers 116 · db 79 · **calendar-providers 74** (zero-drift canary, held
exactly) · ai-providers 25. Build **11/11**, typecheck **21/21**.

> **This corrects a stale record.** The previous *Last verification* section reported Checkpoint
> 7.7's **3,001** tests, but Checkpoint 7.8A had already moved the baseline to **3,009** without
> that section being updated. The 7.7 text is retained verbatim in `docs/history/phase-7.md`.

Migration invariant: **16 `.sql` / 16 journal entries**, no `0016`; `packages/db` byte-unchanged.

## Next action

**Complete Checkpoint 8.0, then stop.** Checkpoint 8.1 must not begin.

Blockers and gates, in order:

1. **Checkpoint 7.9 must be formally closed** before any Phase 8 runtime, API, worker or mobile
   change is deployed. Its scheduled-cron validation fires at `2026-09-02T12:00Z`.
2. **Source durability requires owner action** — see the Checkpoint 8.0 record. A git remote cannot
   be created by an agent, and neither can an age keypair.
3. **Retention windows remain an owner decision** (ADR-024 makes deletion irreversible), and are a
   prerequisite for any prune job.

Deliberately **not** started: Checkpoint 8.1, any application code change, any migration, any
production write, any deployment, any mobile build.
