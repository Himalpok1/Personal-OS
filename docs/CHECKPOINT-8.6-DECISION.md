# Checkpoint 8.6 — Intelligence & Operations Decision Gate

**Status: DECISION GATE. Analysis only — nothing was implemented.** No migration was created, no
production write was made, no deployment occurred, and no client build was produced.

This checkpoint replaces the originally soak-dependent version of 8.6. Checkpoint 8.5 was terminated
by the owner after 9.1 hours, so **there is no adoption evidence and none is used here.** Every
claim below is labelled either **FACT** (verified first-hand against the repository or production)
or **HYPOTHESIS** (a product belief that no evidence in this system supports yet).

---

## 1. Starting branch / HEAD

| | |
|---|---|
| Branch | `phase-8-consolidation` |
| HEAD at gate start | `3bf03db` (the value the owner's brief expected) |
| HEAD at gate close | see §30 |
| Working tree | clean throughout; local ≡ `origin` (hash and tree both verified) |

## 2. Checkpoint 8.5 termination record

**CHECKPOINT 8.5 TERMINATED BY OWNER — ADOPTION SOAK DEFERRED.** Started 2026-09-03 15:07 CDT,
terminated 2026-09-04 00:04 CDT: **9.1 hours of a 21-day minimum, 1.8%, no milestone reached.**
An intentional product decision, not a failed checkpoint — every health signal was green and freeze
exceptions were 0.

**No capture-first, integration-first or mixed conclusion may be claimed. The strategic fork is
UNRESOLVED.** The zero organic usage observed means nothing; it is what nine mostly-overnight hours
look like. The phrase "the soak showed" is prohibited. Full record: `docs/SOAK-8.5.md`.

## 3. Current production state (FACT)

| | |
|---|---|
| Containers | api `(healthy)`, web, worker, postgres — **all `restarts=0`** |
| `GET /health` | `ok` · db connected · `worker.stale false` |
| Migration level | **16** local and production; `0016` absent; `packages/db` byte-unchanged |
| Postgres | `postgres:17-alpine`, no host port published; extensions = `{plpgsql}` only |
| **pgvector** | **NOT available** — `pg_available_extensions` matching `vector` returns **0** |
| `posops_app` | SELECT/INSERT/UPDATE/DELETE on **all 37 tables** incl. 6 credential tables; **no CREATE** on `public` |
| Integrations | Calendar, Gmail, Health all `active`, no errors |
| Monitoring | 5 targets, 0 incidents ever |
| Rabbit R1 | versionCode 10, exact-alarm appop `allow` |
| DB size | 30 MB total |

## 4. Sub-agents used

Six, all read-only and forbidden from running DB-backed suites or contacting production: Ask-lane
architecture & AI security · retention/lifecycle audit · worker liveness & monitor management ·
technical-debt prioritisation · capture-correction & mobile integration · **adversarial critic** over
the conclusions. **Every load-bearing claim below was re-verified first-hand by the integrator**,
and several agent claims were corrected or sharpened in the process (§17).

## 5. Corpus measurements (FACT — measured, not estimated)

Byte lengths summed in SQL; **no content was read or printed**.

| Corpus | Rows | Bytes | ≈ tokens |
|---|---:|---:|---:|
| **User-authored core** (tasks + notes + inbox + projects) | 17 | **1,082** | **~270** |
| `events` (title + description + location) | 98 | 19,468 | ~4,900 |
| `mail_messages` (subject + display name) | 585 | 29,873 | ~7,500 |
| `health_daily_metrics` | 162 | numeric | small |
| **Everything** | — | **~50 KB** | **~12,500** |

Against the Brief lane's already-proven `MAX_BRIEF_INPUT_CHARS = 12000`: **the entire user-authored
corpus is under one tenth of one existing Brief payload.** ADR-056's estimate is confirmed and, for
first-party content, was conservative.

## 6. Current AI architecture (FACT)

Four routes, all present with a primary model and **zero fallbacks**: `capture_parser`,
`daily_brief`, `mail_digest` → `gpt-4.1` on connection *My OpenAI*; `voice_transcribe` →
`whisper-large-v3-turbo` on *Groq Production*. `ai_models` holds 2 rows.

Two shipped lanes bracket the design space. **Brief** (`apps/api/src/brief/`): synchronous in the
API, closed scalar allowlist `BriefInput`, static system prompt with zero interpolation, 4-rung drop
ladder that drops whole items never sliced JSON, 30 s attempt / 45 s chain, 800 output tokens,
`sanitizeModelText` with a `containsLinkShapedContent` post-condition, server-owned persisted shape,
explicit 409/504/502 taxonomy with static messages. **Mail digest** (`apps/worker/src/mail/digest/`):
the same five stages in the worker behind a 202, tighter caps, and the untrusted section on the first
rung of the drop ladder.

`collectUntrustedBriefInputs` already implements provenance. `packages/core` exposes `./ai/*` and
`./search/*` deep subpaths. **`apps/api` imports nothing from `apps/worker`** — verified; the shared
queue constants are deliberately duplicated.

## 7. Ask Personal OS — Options A / B / C

**A — whole bounded corpus.** Serialize the user-authored core into a closed allowlist, cap it, send
it. **B — deterministic lexical preselection** using the existing `packages/core/src/search/`
helpers, then send the excerpt. **C — embeddings / retrieval.**

**Recommendation: A now, B as the growth path, C not justified and not proposed.**

The reason is arithmetic, not preference. At 1,082 bytes the whole corpus is ~9% of a ceiling this
system has already proven in production. B is *strictly more code* for *strictly less context* at
this size, and its preselection would discard content that fits anyway. B becomes correct when the
corpus approaches the payload ceiling — a threshold that is measurable and should trigger the switch,
rather than a date.

C remains excluded. Beyond ADR-056, three independent facts block it: pgvector is **not present in
the image**, `posops_app` **cannot CREATE** in `public`, and `reconcile-drizzle-tracking.ts` aborts
on any non-btree index method — so HNSW, IVFFlat, GIN and a trigram index all fail by the **same code
path**. Nothing here is a workaround away.

## 8. Privacy / security analysis

**The tool-less property is the only real guarantee, and the database role provides none of it.**
`posops_app` holds full DML on all 37 tables including `ai_provider_connections`, `ai_task_routes`,
`devices` and every `*_connections` table. A read-only Ask lane is therefore read-only **because it
holds no tools and has no write path in code** — never because the grant stops it. ADR-056 already
names this; it is now verified rather than assumed. Any future tool-holding lane needs a separate
role, a second pool and a new secret, and that is its own decision.

**The safety components an Ask lane needs already shipped.** The shared output filter with its
provenance layer (8.1), the corrected prompt premise (8.1), bounded caps and control-strip-before-
truncate ordering (8.1), LIKE-escaping (8.3), and the app-wide inert-rendering guard (8.3). **If the
corpus is the four user-authored entities, this lane introduces no new untrusted-text class at all.**

**One genuinely new risk.** The question is an arbitrary user-authored string reaching a prompt.
Every existing lane is deterministically collected, so the "static system prompt, zero interpolation"
invariant must be restated: system prompt stays static, and the question travels in the `prompt` role
fenced separately from the snapshot. It is first-party text, so this is a contract change, not an
injection exposure.

## 9. Token-budget analysis

User-authored corpus ~270 tokens against a 12,000-character (~3,000-token) proven ceiling — **a
factor of roughly eleven of headroom.** Adding events would reach ~5,200 tokens and still fit; adding
mail would reach ~12,700 and would exceed the Brief's ceiling, which is itself an argument for
keeping mail out of v1 rather than merely a policy one. No retrieval layer is needed at any of these
sizes.

## 10. API vs worker placement

**`apps/api`, synchronous, sibling of `apps/api/src/brief/`.** ADR-056's principle is that a
read-only lane answering a user synchronously belongs in the API; the digest's 202 exists only because
its pipeline already lived in the worker, which ADR-056 correctly calls circular reasoning. The
boundary is clean in both directions and must stay so.

**Transport must be `POST /ask`, not `GET /ask?q=` — decided on evidence.** The Fastify request
serializer emits `url` and **never `body`**, and `SENSITIVE_QUERY_PARAMS` is only
`["code","state","access_token"]`. A GET would put every question the owner ever asks into the
container log — knowingly reproducing the 8.3 `/search?q=` debt on a surface where the text is longer
and more personal.

## 11. Retention analysis

**Zero migrations required for every candidate**; every prune predicate uses an already-indexed
column, and `posops_app` already holds DELETE.

| Table | Growth | Deepest reader | Notes |
|---|---:|---|---|
| **`monitor_checks`** | **~3,632/day → ~1.3 M/yr** | **20 rows per target** | ~97% of all row growth. **No check-history endpoint exists at all.** |
| `health_sync_runs` | ~398/day | 5 (breaker), 200 (one route) | schema comment already *names* a 90-day window that was never built |
| `mail_sync_runs` | ~96/day (= the 15-min cron exactly) | 6 (breaker) | ADR-054 permits a prune |
| `mail_messages` | user-paced | **unbounded, via `/search`** | the **only** candidate whose prune destroys user-visible capability |
| `*_oauth_states` | a few/yr | one row | consumed, never deleted — grows monotonically |

**pg-boss is bounded and needs nothing** — `retention_seconds` 14 d / `deletion_seconds` 7 d, both
**defaults nobody chose**, and `pgboss.archive` does not exist in v12. But one consequence is a real
finding: **terminally failed jobs are deleted on the same 7-day clock as successes.** For a queue
with no dead-letter queue, `job.output` *is* the entire durable failure record. Verified in
production: the two 8.4 `capture.parse` failures vanish **2026-09-10**; the calendar failure
**2026-09-07**. (No evidence is lost in practice — Checkpoint 8.4's record already preserves the job
ids, timestamps, retry counts and output string.)

**ADR-057 finding #1 is confirmed and sharpened:** `sweepExpiredMailOAuthStates` has **zero
references anywhere in the repository, not even a test**. Both sweeps are written, exported, correct,
and unreachable.

## 12. Worker-liveness analysis

**The under-sampling recorded at 7.9 is a real defect with a measured cause.** `isDueForCheck`
anchors on the **previous row's observed `checked_at`** with a 1-second tolerance, so it is a
**ratchet**: any downward phase step greater than 1 s permanently costs one check and the lost phase
is never reclaimed.

Measured over 24 h in production — and the control case is what makes it conclusive:

| Target | n | avg Δ | min Δ | max Δ | doubled |
|---|---:|---:|---:|---:|---:|
| `api-internal-health` — 60 s, via pg-boss | 1,344 | **64.23 s** | 60.0 | 148.1 | **114** |
| `worker-heartbeat` — 60 s, plain `setInterval` | 1,438 | **60.04 s** | 60.0 | 115.2 | **1** |
| the three 300 s targets | 277 ea. | 311.22 s | 300.0 | 388.2 | 56 ea. |

Two targets at the **same interval** differing only in scheduling path: the pg-boss one loses 114
checks to the other's 1. **Minimum delta is exactly 60.0 / 300.0 and never below** — the interval can
only stretch, never compress. That is the ratchet, measured rather than argued. The fix is a pure
function change in `packages/monitoring`, no migration.

**Three further reliability facts.** A stalled monitor is completely silent — the incident machine
only runs *inside* a pass, and `monitor.run` has `retryLimit: 0` and no DLQ, so **the monitor has no
monitor.** ADR-055's three-state uptime model exists **only as a Zod type with zero non-test
consumers**, which is precisely why a 5% sampling shortfall was invisible: `count(up)/count(*)` still
reads 100%. And the API watchdog destructures `[target]`, so a second `worker_heartbeat` target would
be silently ignored.

## 13. Monitor-management analysis

The write half exists as a tested library; above it there are **zero write routes, zero client
methods, zero UI**. Seeding is create-only by design, so today a wrong URL or threshold is
correctable only by SQL — that is the real pain.

**`monitor_targets` already has every column an editor would set, so CRUD needs no migration.** The
`monitor_targets_kind` CHECK is closed to `http` / `worker_heartbeat`, so a *new probe kind* needs a
CHECK widen — now a single ordinary migration (§17, ADR-050 correction).

**One security finding gates this candidate:** `url` is `z.string().url()` with **no scheme allowlist
and no host restriction**, and `/monitor` routes carry no device-token auth. Exposing create/update
over HTTP turns the prober into an **SSRF primitive** — a low-bandwidth up/down/status/latency oracle
over the internal Docker network and the tailnet. A narrow `PATCH` that cannot change `url` or `kind`
delivers most of the value with **no SSRF surface at all**.

## 14. Correction-logging analysis

**The learning signal was never built, and production data shows it currently cannot be built.**

`docs/ARCHITECTURE.md`'s parse pipeline step 4 — *"On confirm, log the correction — that's your
future few-shot corpus"* — is the **only one of its four steps never implemented**. Worse, two facts
make parser accuracy unmeasurable today:

- **All five auto-filed (`parsed`) production rows have `parse_result` NULL.** The three
  `parseResult` writes are on the failed and needs-confirm branches only, so the *common* path
  records nothing about what the model decided.
- **`corrected_tool_call` has zero non-test call sites** in the app or client — the only confirm is
  `confirm.mutate({ id })` with no body. **ADR-060's correction path is reachable only by curl.**

And a correction **overwrites** the original: `parse_result` is replaced wholesale, so the model's
original tool and args are destroyed at that instant. With no `updated_at` on `inbox_items`, a plain
confirm and a corrected confirm are structurally indistinguishable afterwards.

The honest split: **accuracy telemetry needs no content; a few-shot corpus needs content by
definition** and would be a durable private-content archive under ADR-024's no-backup, no-prune
posture — and re-sending examples on every parse is prompt-content expansion ADR-056 does not
authorize. The cheap, high-value half is **persisting the chosen tool and flags on the auto-commit
path**, plus keeping the original beside a correction: one jsonb key each, **no migration**, because
`StoredParseResultSchema` is non-strict and read through `safeParse`.

## 15. Technical-debt ranking

Verified item by item. **Nothing on the debt board blocks a four-entity Ask lane** — that is the
headline, and it is a fact rather than an opinion.

| Rank | Item | Sev | Migration | Blocks Ask? |
|---|---|---|---|---|
| 1 | `CREDENTIALS_ENCRYPTION_KEY`: no version, no KDF, no rotation, **no AAD** | **P1** | only if versioned | No |
| 2 | **Three** retrying queues with no DLQ; `capture.parse` writes `failed` only for `NoProviderConfigured` | **P1** | No | No |
| 3 | Event text unbounded at write | **P1** | No | **Only if `events` enters the corpus** |
| 4 | In-progress multi-day timed event appears on **no** Today day | **P1** | No | Corrupts answers, not safety |
| 5 | Zero-length all-day event is **invisible on Today** | **P2** | No | No |
| 6 | Brief lane emits no `ai.usage`; `apps/api` has no guarded logger | P2 | No | No — but build it *with* the lane |
| 7 | `/search?q=` logged verbatim | P2 | No | Design constraint only |
| 8 | `done` occurrence still renders on Today/Agenda | P2 | No | No |
| 9 | `available-calendars` writes to the DB; refresh failure → 500 | P2 | No | No |
| 10 | Alerts share the `reminders` channel | P2 | No (needs APK) | No |
| 11 | `events`/`projects` not searchable | P2 | No | No |
| 12 | `calendar_connection_calendars.summary` stores the ID | P3 | No | No |
| 13 | No client export affordance | P3 | No (needs APK) | No |

## 16. Candidate prioritisation matrix

No "adoption evidence" column exists, deliberately — there is none.

| Candidate | User value | Complexity | Sec/privacy risk | Dependency | Technical evidence |
|---|---|---|---|---|---|
| **F — reliability/correctness fixes** | High | **Low** | **Low** | Independent | **STRONG** — measured defects |
| **A — Ask Personal OS (server-side)** | **Very High** *(hypothesis)* | Medium | Medium | Independent | **WEAK** — no usage evidence |
| **B — retention/lifecycle** | Medium | Low | Low | Independent | **STRONG** — measured growth |
| **C — worker liveness** | High | Medium | Low | Important | **STRONG** — measured blind spot |
| **D — monitor CRUD** | Medium | Low–Med | **High if `url` writable** | Independent | Moderate |
| **E — correction signal** | Medium | Low (telemetry half) | Low (structural only) | Independent | **STRONG** — accuracy is unmeasurable today |

**A is the only candidate whose user value is a hypothesis.** That is not an argument against it —
ADR-056 anticipated it — but it must be labelled, because 8.5 was terminated precisely so that
development could proceed *without* waiting for evidence. Building A is choosing to act on a belief,
deliberately.

## 17. Present-state corrections found by this gate

Recorded because a future reader would otherwise trust a stale statement.

1. **The debt ledger's "capture.parse is the only retrying queue without a dead-letter queue" is
   FALSE.** `occurrences.expand-window` (retry 3) and `occurrences.generate-lazy` (retry 5) also
   lack one and are unmentioned. `occurrences.generate-lazy` is the ADR-013 completion-anchored
   generator: exhausting retries means a completed recurring task **silently never spawns its
   successor**.
2. **"Unbounded at write" is not calendar-specific.** `tasks.title/body` and `notes.title/body` are
   equally unbounded. **`inbox_items.raw_text` (4000) is the only user-text column in the entire
   system with a write-side bound.**
3. **The zero-length all-day event is not "harmless today".** `classifyEventIntoWindows` computes an
   empty range when `end_date < start_date`, so that production row matches **no Today window at
   all** — silent disappearance, the same class as the multi-day bug tracked separately.
4. **ADR-050's reconcile-script claim is STALE.** `reconcile-drizzle-tracking.ts` now accepts
   `DROP CONSTRAINT IF EXISTS` when a matching `ADD CONSTRAINT` re-creates the name **in the same
   migration**, so widening a CHECK is one ordinary file. ADR-050's *conclusion* stands; its stated
   mechanical penalty does not. The binding constraint is now `ADD COLUMN`, whose type allowlist is
   exactly `{text, bytea, date, timestamptz, timestamp}`.
5. **ADR-057 finding #1 is sharper than recorded:** `sweepExpiredMailOAuthStates` has zero
   references anywhere, not even a test.
6. **The `/search?q=` fix is far cheaper than the ledger claims** — `scrub-url.ts` is explicitly
   route-agnostic and already runs on every request, so it is a one-element array change, not a
   mechanism the API lacks.
7. **`credential-crypto.ts` has no AAD**, so a ciphertext/IV/tag triple is not bound to its row or
   column: a triple copied between columns decrypts cleanly. GCM protects the bytes, not their
   placement.

## 17b. Adversarial review — claims of mine that were REFUTED

An adversarial critic was run over these conclusions with instructions to refute them. It found
real errors. They are corrected here rather than defended, because a decision gate that launders its
own mistakes is worse than no gate.

**REFUTED — "`inbox_items.raw_text` is the only user-text column with a write-side bound."** False.
`reviews.summary` is `z.string().max(2000)` on a live write path. Worse, my own example was wrong in
detail: the 4000 cap lives on `CaptureRequestSchema.text`, not on the column, and
`ptt-transcribe.ts:115` writes the Whisper transcript into that same `raw_text` with **no bound at
all**. The correct statement is narrower: **most user-text columns are unbounded, bounds are applied
inconsistently at request schemas rather than at the column, and `raw_text` has one bounded and one
unbounded writer.**

**REFUTED — "`isDueForCheck` is a phase RATCHET."** Wrong word, and the causal attribution was wrong.
After a skip the anchor stays put and the next tick lands ~120 s later, comfortably due — so it
*recovers* rather than accumulating, which my own data shows (max delta 148.1 s, not growing). It is
an **asymmetric per-occurrence penalty**: a late pass is free, an early one costs exactly one check.
More importantly, `heartbeat-watchdog.ts:161` calls the **same `isDueForCheck` with the same 1 s
tolerance**, so my "control" isolates the **scheduler**, not the function. The measured 64.23 vs
60.04 proves **pg-boss polling jitter** (a 5 s timekeeper poll plus two 2 s work polls, up to ~9 s
against a 1 s tolerance). `isDueForCheck` is the **amplifier, not the cause** — which matters,
because "fix isDueForCheck" alone treats the symptom. Grid alignment still works, and still needs no
migration; the *diagnosis* was overstated, not the remedy.

**OVERSTATED — the corpus headroom.** "~9% of the ceiling" compared raw content bytes to a
**serialized** budget. In the export shape the repo already uses, those 17 rows measure ~43% compact
/ ~57% pretty-printed — real headroom nearer **1.7x, not 11x**. The conclusion (Option A now,
B later, C excluded) survives, but the margin does not, and the crossover is far closer than stated:
roughly 19 export-shaped tasks, **or one 12,001-character note**, which is expressible today because
`notes.body` has no `.max()`.

**REFUTED as framed — the Ask corpus axis.** I presented the decision as *which entities*. ADR-056
names **"whole note bodies"** first among the things requiring an explicit owner decision, so the
load-bearing axis is **which FIELDS**. `BriefInput` has never carried a `body` at all — the most
body-like thing the AI layer has ever sent is five 160-character inbox snippets. An Ask lane over
titles only is within existing precedent **and nearly useless**, since `/search` already covers
titles. **D1 is therefore the whole decision, not a side condition.** Relatedly, excluding `events`
is *prudent* but not strictly *necessary*: the Brief already sends third-party event titles and
locations under the same prompt-boundary truncation, so applying that treatment to Ask creates no new
exposure.

**PARTLY WRONG — the ADR-050 correction.** The staleness finding stands, but three conditions I
stated do not: `IF EXISTS` is optional, same-table is **not** required, and ordering is **not**
enforced despite both the comment and the abort text saying "later". That last is a genuine
fail-open hole in a fail-closed script — a `DROP CONSTRAINT foo` on table `a` paired with an
`ADD CONSTRAINT foo` on table `b` is accepted with no verification.

### Further findings from the review, none of them mine

- **`basic404` logs the raw URL outside the scrubbing serializer.** There is no `setNotFoundHandler`,
  so a mistyped OAuth callback carrying a live `?code=` is logged unscrubbed **and echoed in the
  response body**. Verified: the handler is absent. This is a real hole in the protection that
  `scrub-url.ts` exists to provide, and it is adjacent to — but distinct from — the `/search` leak
  fixed in 8.6A.
- **ADR-054's mail `.max()` constraints never execute.** `MailMessageMetadataSchema` carries every
  bound the ADR claims, and is `.parse()`d nowhere; enforcement is entirely the truncation at write.
  There are zero `varchar` and zero length CHECKs in all 16 migrations.
- **`classifyEventIntoWindows` is duplicated** across `today.ts` and `review-contexts.ts`, with a
  third deliberate divergence in `agenda.ts`. Any fix to event bucketing is at least two edits, or it
  breaks `docs/ARCHITECTURE.md`'s own "sections cannot disagree" invariant.
- **`occurrences.generate-lazy` has no containment wrapper and no structured logging at all** — only
  raw `console.warn` on skip paths. It is strictly less observable than `capture.parse` was *before*
  8.4, and the review verified all three plausible recovery paths are closed: the nightly job filters
  completion-anchored rules out, the only enqueue sites key on an existing occurrence, and PATCH does
  not re-seed. A completion-anchored chore whose successor job fails five times is **permanently and
  silently dead.**
- **A monitor pass can approach its own cron interval** (~50 s of timeouts against a 60 s cron during
  a multi-target outage), and an overlapping `stately` send with `retryLimit: 0` is **dropped and
  gone** — so sampling degrades exactly when something is broken.

## 18–26. Plans (conditional on §27 owner decisions)

**DB / migration plan.** **Target: zero migrations, and it is achievable for every recommended
item.** `0016` is created only if a `job_liveness` monitor kind is approved (a CHECK widen, reusing
`heartbeat_max_age_seconds` and `interval_seconds`, **zero new columns**). Any future `ADD COLUMN`
must be one of the five allowlisted types or `reconcile` aborts.

**API plan.** `POST /ask` (body-borne question) beside `apps/api/src/brief/`; an `ask` row in
`ai_task_routes` pointing at the **existing** `gpt-4.1` model — no new credential, no new env var, no
new `ai_models` row. Note there is **no DELETE endpoint for task routes**, so reverting means another
upsert or direct SQL. Optionally a narrow `PATCH /monitor/targets/:id` excluding `url` and `kind`.

**Worker plan.** Dead-letter queues for the three retrying queues, with terminal handlers that write
durable state (`capture.parse` must set `status: 'failed'` on exhaustion, not only for
`NoProviderConfigured`). `isDueForCheck` grid-alignment in `packages/monitoring`. Optionally wire the
two dead OAuth sweeps into the existing hourly sweep cadence.

**Mobile plan.** **Defer.** Every client change costs a full EAS cloud build plus a physical install,
and 8.4 needed *two* builds because a Compose defect was invisible to every test. If a client surface
is later approved, prefer a **Today card** (sibling of `BriefCard`, reusing its 6-line clamp) or a
**mode inside the existing search screen** — never a sixth tab, and a third header glyph on a 480 px
bar is a real layout risk. Server-side first is both cheaper and reversible.

**AI plan.** Reuse verbatim: `resolveModelForTask`, `callWithFallbackTracked`, the 30 s/45 s budget,
the static-message 409/504/502 taxonomy, `sanitizeModelText` plus the `containsLinkShapedContent`
post-condition, and the server-owned output shape. **No tools, no `tool()` import, no write path.**
Persist nothing in v1 — an Ask answer has no natural `(date, tz)` identity, and not persisting also
removes any laundering-into-storage path.

**Security plan.** A closed `.strict()` `AskInput` allowlist so a credential column is inexpressible;
a mechanical guard that the Ask module imports no `tool` and no write helper (the existing containment
ratchet pattern); a test asserting the question never appears in the request log; scheme/host
allowlist before any monitor `url` becomes writable.

**Testing plan.** Contract closure, prompt-fence separation (a question containing `</snapshot>` must
not terminate the fence), payload ceiling and drop-ladder determinism, output post-condition refusal,
budget exhaustion, error taxonomy, the log-absence regression, plus **mutation tests on every
load-bearing guard** per the 8.3/8.4 precedent. For the reliability lane: a ratchet regression test
feeding late-then-early latencies and asserting **no check is lost**. All DB-backed suites are
**integrator-only and serial** — `apps/api` and `apps/worker` share one `personalos_test` database.

**Production rollout plan.** The frozen order in `docs/ARCHITECTURE.md`, unchanged: ship via
`git archive` to a new `personal-os-8.6-release`, tag rollback images **by resolved digest**, build,
verify the new image's migration contents, migrate from the new image with `--no-deps`, then
`up -d --no-deps --no-build --force-recreate` naming services explicitly. **Never name `postgres`.**
Recreate `api` and `worker` in **separate invocations** — both run a pg-boss timekeeper, so a combined
recreate leaves a window with none. Do not rebuild a service whose runtime did not change.

## 27. Owner decisions required

Nothing below is invented; each is a genuine choice only the owner can make.

| # | Decision | Why it is yours |
|---|---|---|
| **D1** | **May note and task BODIES leave the machine to a cloud model?** Today only titles and capped inbox snippets ever have. ADR-056 approves bounded reasoning over a selected excerpt and explicitly withholds unrestricted full-content egress. | This is the Ask lane's central privacy question and it is a widening, not an extension. |
| **D2** | **Ask corpus scope.** v1 recommended as the four user-authored entities. `events` requires bounding event text at write first; `mail_messages` needs an ADR-054 amendment; health needs an ADR-046 amendment. | Each is a new egress class. |
| **D3** | **`monitor_checks` retention window.** Floor is ≥20 rows per target. ~1.3 M rows/yr today. | Irreversible under ADR-024. |
| **D4** | **`mail_messages` retention window AND axis** (`internal_date` vs `created_at`), plus whether tombstoned rows prune sooner. | The only prune that destroys user-visible capability; unrecoverable, and re-fetching is not a recovery path. |
| **D5** | `health_sync_runs` / `mail_sync_runs` windows (floors: 5 and 6 rows per group). | ADR-054 requires the window be explicit and recorded. |
| **D6** | **Accept that terminal `capture.parse` failures self-delete after 7 days, or add the DLQ.** | A retention policy currently set by a library default nobody chose. |
| **D7** | **Is target CRUD exposed over HTTP at all**, given the SSRF surface? | Recommend: narrow `PATCH` excluding `url`/`kind`, or nothing. |
| **D8** | **Accept a production read of pg-boss's internal schema from `apps/api`** for derived liveness? | First such coupling; pg-boss internals can move on a minor upgrade. |
| **D9** | May capture content ever be persisted as parser training data? | Recommend **no** for now — structural telemetry only. |

## 28. Recommended checkpoint breakdown after 8.6

**8.6A — Reliability & correctness.** `isDueForCheck` grid-alignment; dead-letter queues for the
three retrying queues with terminal handlers that write durable state; the two Today
event-invisibility bugs; the `[target]` watchdog fix; `q` added to `SENSITIVE_QUERY_PARAMS`.
**No migration, no owner decision, no new capability — every item is a measured defect.**

**8.6B — Ask Personal OS foundation, server-side only.** Gated on **D1** and **D2**. `POST /ask`, the
four user-authored entities, a new `ask` task route on the existing model, no tools, no persistence,
no client surface. Ships with a guarded logger for `apps/api` so the most expensive AI surface is not
unmeasured from day one.

**8.6C — Retention & lifecycle.** Gated on **D3–D6**. Wire the two dead OAuth sweeps first (no window
decision needed), then `monitor_checks`, then the sync-run tables, and treat `mail_messages`
separately and last. **CLI dry-run → owner review → `ROW_COUNT`-guarded apply**, following the 8.1
burned-row precedent exactly.

**Deferred beyond 8.6:** derived job liveness (D8), monitor CRUD (D7), the correction *editor* and any
mobile surface, a few-shot corpus, and key rotation — the last being an owner-track item about where
an age private key lives, not engineering work.

## 29. Explicit exclusions

No embeddings, no retrieval layer, **no pgvector**, no Postgres image change, no vector/HNSW/IVFFlat/
GIN/trigram index, no new external integration, no write-capable or tool-holding agent, no finance,
no Phase 9 planning, no new notification producer without an occurrence-scoped dedupe key, no mobile
build in 8.6, and **no migration `0016`** during this gate.

## 28b. Checkpoint 8.6A — IMPLEMENTED (owner-scoped, 2026-09-04)

The owner scoped 8.6A to four items and they are complete. **No migration** — level stays 16,
`packages/db` byte-unchanged, `0016` absent.

| Item | What shipped |
|---|---|
| `capture.parse` durable terminal state | Dead-letter handler writes `status: "failed"` on retry exhaustion, instead of leaving the row `pending`/`needs_confirm` forever |
| `capture.parse` DLQ / durable failure record | New `capture.parse.dead` queue; a closed scalar failure record that can carry neither provider prose nor capture text; the stored tool call is **preserved** so ADR-060's correction route survives |
| Zero-length all-day event | `googleAllDayToLocal` floors the inclusive end at the start date |
| Scrub `/search` query from logs | `q` added to `SENSITIVE_QUERY_PARAMS` |

**The DLQ change would have silently done nothing without a second call.** `createQueue` ends in
`ON CONFLICT DO NOTHING`, and `capture.parse` has existed since Phase 1 — so the `deadLetter` option
is discarded on every deployed database, while every test suite runs against a fresh one where the
INSERT *does* fire. It would have typechecked, passed, deployed and changed nothing: the same shape
as the Checkpoint 5.7 migration no-op the frozen deployment order exists because of. Both processes
therefore also call `boss.updateQueue`, and a source-scanning guard now pins that call, the
foreign-key creation order, and the handler being bound to the **dead** queue rather than the
primary.

**Three mistakes were caught by the repo's own guards or by mutation testing while writing this**, and
each is now pinned: a raw `console.warn` (caught by `no-raw-console`), an unregistered queue in the
containment map (caught by `queue-containment`), and the dead-letter handler bound to the *primary*
queue (my error, now pinned by a test).

**Verification.** Build **11/11** · typecheck **21/21** · `eslint .` clean · `prettier --check .`
clean · `git diff --check` clean · gitleaks clean. Full suite **uncached and serial: 3,340 tests /
21 turbo tasks, 0 of 21 cached, zero failing** (baseline 3,322). No package decreased — worker
**452** (+13), api **689** (+3), calendar-providers **76** (+2, the zero-drift canary moved
deliberately by this checkpoint), all others held exactly. **Mutation tests: 9 of 9 killed and
restored**, covering the terminal-status guard, the tool-call preservation, the status transition,
the all-day floor, the `q` scrub, both `updateQueue` calls, the handler binding, and the FK ordering.

**Two honest limitations.**

1. **The fix is write-path only and does NOT repair the existing production row.** `e2b9a5f7` still
   holds `start_date 2021-12-16 / end_date 2021-12-15` and remains invisible on Today, because
   calendar sync is incremental and will not re-translate an unchanged event. Repairing it is a
   one-row `UPDATE events SET end_date = start_date` — a production write, reversible, and **an owner
   decision** rather than something to slip into a deployment.
2. **Not yet deployed.** Nothing has been rolled out; production still runs the previous images.

## 30. Git status / final HEAD

See the closing section of `docs/STATUS.md`.
