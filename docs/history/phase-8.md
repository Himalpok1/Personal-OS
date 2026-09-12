# Phase 8 — Consolidation & adoption

> **Historical record — closed. Do not edit.**
> Checkpoints 8.0–8.6 (8.6A/B/C/D): foundation and record compaction, failure visibility and AI I/O hardening, the real Google Calendar, search and export, capture front doors, the owner-terminated adoption soak, the 8.6 decision gate, capture.parse DLQ, Cloud Ask, monitor target CRUD, and retention cleanup.
>
> Archived from `docs/STATUS.md` by the Phase 8 closeout (2026-09-12) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`;
> the closure record is `docs/PHASE-8-CLOSEOUT.md`.

Source line range in the pre-closeout `docs/STATUS.md` (commit `81662ff`): 84–1605.
SHA-256 of that range: `b72fe7f670316b8e25107dd67224afe4e17105254fc4bfb93e43f1133e0691af`.

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

### Checkpoint 8.0 — Foundation / Discovery Gate closure (COMPLETE, 2026-09-02)

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

**Lane D — source durability (PREPARED at 8.0; the remote was subsequently ESTABLISHED — see
*Source durability* below).** Design and prerequisites are
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

### Verification actually run

Measured first-hand, not transcribed. The application tree is byte-unchanged by this checkpoint, so
reproducing the baseline exactly **is** the evidence that nothing moved.

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **11/11** · typecheck **21/21** · `eslint .` **zero output** · `prettier --check .` clean · `git diff --check` clean · overall **exit 0** |
| 2 | Full suite, **uncached and serial** | **3,009 tests / 21 turbo tasks, 0 of 21 cached**, zero failing — reproducing the pre-checkpoint baseline exactly |
| 3 | No package decreased | api 609 · mobile 499 · worker 409 · core 375 · health-providers 315 · schema 255 · monitoring 132 · api-client 121 · mail-providers 116 · db 79 · **calendar-providers 74** · ai-providers 25 |
| 4 | Zero-drift canary | `calendar-providers` **74**, held exactly |
| 5 | Migration invariant | **16 `.sql` / 16 journal entries**, highest `0015_service_monitoring`, **no `0016`**; `packages/db` diff vs `533601c` **empty** |
| 6 | Runtime tree drift | `packages/` **0 files** · compose/Dockerfiles **0** · `eas.json`/`app.config.ts` **0** · `package.json`/lockfile **0**. The only file under `apps/` is `apps/mobile/.gitignore` — an ignore rule, not runtime code |
| 7 | Archival conservation | All **7,284** lines reassembled from the output files and hashed against the original. Sole difference across the whole file: a final newline added to a file that did not end with one |
| 8 | Secret scan | `gitleaks` clean on all four commits; `gitleaks git --log-opts=--all` clean across all **244** commits |
| 9 | Production | **Not contacted.** No SSH, no Docker, no psql, no OAuth, no `.env` change |

**Documentation auto-load, measured before and after:**

| | Bytes | ≈ tokens |
|---|---|---|
| Before | 795,997 | ~199k |
| After | 169,578 | ~42k |
| **Reduction** | **626,419** | **78.7%** |

`docs/history/` holds 674,050 bytes across 9 files and is **not** auto-loaded.

---

## Source durability — ESTABLISHED (2026-09-02, owner decision)

The hosted-remote question Checkpoint 8.0 left open as *"an owner judgement call"* is **CLOSED**.
The owner approved a private GitHub repository as the durable off-machine remote:

| | |
|---|---|
| `origin` | `https://github.com/Himalpok1/Personal-OS` |
| Visibility | **PRIVATE** — verified via the GitHub API immediately before **and** after the push |
| Pushed | `main` (`8b7a9eb`) · `phase-8-consolidation` (`907cae3`) |
| Tags pushed | **none** |
| Collaborators | owner only · repository secrets **0** · Pages **not configured** |
| Actions | repo setting is GitHub's default-on, but **no workflow file exists in the working tree or in any of the 249 commits**, so nothing can execute on push. Not enabled, not configured, not used. |

**Verified after the push, not assumed from the exit code:** for both branches the remote **commit
hash and tree hash both match local exactly**, the remote commit count for `phase-8-consolidation`
(217, read from the GitHub API) equals `git rev-list --count`, `git ls-remote` shows **exactly two
refs and no tags**, and the working tree is clean.

**Secret audit before pushing.** `gitleaks` (no custom config, so no allowlist could suppress a
finding): **249 commits across all refs — no leaks, exit 0**; scoped to the pushed refs, **240
commits — no leaks**. Independently corroborated rather than taken on the scanner's word: all 836
distinct paths that have ever existed were enumerated, and the only secret-shaped filenames ever
committed are `.env.example` and `apps/mobile/.env.example`, both intentional and both containing
only `changeme_*` placeholders. **No `.env`, keystore, credential JSON, `google-services.json` or
private key has ever been committed on any branch.** A raw-content scan of every blob reachable
from the pushed refs found zero real credential values — every `CREDENTIALS_ENCRYPTION_KEY`,
`*_CLIENT_SECRET`, `EXPO_TOKEN` and `*_API_KEY` assignment resolves to a placeholder, a `${VAR}`
interpolation or a code reference.

Ruled false positives, deliberately **not** rotated: `ya29.` / `sk-` / `GOCSPX` strings in tests are
redaction canaries (longest 42 chars against a real token's 100+, several literally reading
`not-a-real-token`), and ~463 occurrences in `docs/` are prose naming the search needle. One
`AKIA`-shaped string exists in an **unreachable orphan blob** (`fake-secret-test.txt`, a Phase 0
pre-commit-hook test the hook correctly blocked); it is in no commit tree, so `git push` cannot
transmit it.

**Ignore hardening, committed as `907cae3` before the push.** Checkpoint 8.0 closed the `.env.*`
suffix gap on the reasoning that a gap *"costs nothing while there is no remote; adding a remote is
precisely the event that arms it."* Adding the remote triggered the same audit over the rest of the
credential surface, and three further gaps were found and proven closed with `git check-ignore -v`:
key material and signing artifacts (`*.keystore`, `*.jks`, `*.p12`, `*.pfx`, `*.pem`, `*.p8`,
`key.txt`, `*.agekey`, `secrets/` — note `*.age` covered age-*encrypted* files but not an age
*private* key, which is exactly what the documented SOPS + age next step would produce); SSH keys
and credential JSON; and **nested `.claude/` directories**, since the existing rule is anchored
(`/.claude/`) and `.credentials.json` is the filename Claude Code uses for its own OAuth credential
store. Both `.env.example` files remain tracked and un-ignored and no tracked file is shadowed —
both proven, not assumed.

**Branch and tag classification — 2 of 13 branches pushed, 0 of 1 tags.** Eleven branches have
**zero** commits not already reachable from `phase-8-consolidation`. The two that do —
`phase-6-audit-hardening` (19) and `phase-6-production-readiness-6-7a` (9) — are pre-linearization
originals, and **nothing is lost by omitting them**: each branch's tree is *byte-identical* to a
commit that IS in the push set (`phase-6-audit-hardening-linear~1` and `bcf11fc` respectively,
`git diff` empty), so their full content, including the forensic "defect in this branch's HISTORY"
record, is retrievable from the pushed history. The sole tag `cp77-pre-linearize` is likewise
tree-identical to `6c52e2a`, which is in the push set, while the tag itself is reachable from **no
branch** — pushing it would drag 5 otherwise-unreachable commits whose only unique object restores
a known-broken bisect point. Its provenance is already named in `docs/history/phase-7.md`.
**What is not replicated is pre-linearization commit topology, not content.**

**Disclosure, accepted deliberately.** A reader with access learns operational topology, not
credentials: the tailnet DNS suffix, the production host account name, one CGNAT address, two Google
Cloud project ids and the Android application id. The tailnet suffix is embedded in **immutable
commit metadata** — 117 of 249 commits carry an author email at that domain — so it is unreachable
by `.gitignore` and cannot be reduced without rewriting every SHA including `a5bbc48`, which
production is pinned to. **This is acceptable for a private repository and is precisely why the
repository must not be made public without a separate, deliberate decision.**

**ADR-024 and ADR-018 remain untouched.** ADR-024 governs a *database backup system*; this
replicates already-plaintext source. ADR-018 governs *ingress to the production host*; `git push` is
egress from a development machine. No port was opened and no listener was added.

**Configuration and key durability is a SEPARATE, still-open owner task.** Nothing secret was placed
in GitHub and nothing secret may be. `CREDENTIALS_ENCRYPTION_KEY` remains the sharpest risk in the
system — no key version, no KDF, no rotation path, present on exactly two hosts — and a git remote
does not protect it. The intended direction remains SOPS + age with the age private key held off
both the development machine and the production server.

---

### Checkpoint 8.1 — Failure visibility + AI I/O hardening (COMPLETE, deployed 2026-09-02)

First Phase 8 runtime checkpoint. **No migration** — level stays 16, `packages/db` byte-unchanged.

**Alert dedupe is now occurrence-scoped (ADR-058).** `notification_dispatch_log.dedupe_key` is a
permanent PRIMARY KEY with no TTL, so the two integration producers ADR-057 flagged fired once and
were then permanently dead. Both are fixed and Gmail — which had **no alert producer at all** —
gains one:

| Producer | Key | Discriminator |
|---|---|---|
| Calendar | `calendar-needs-reauth:<connId>:<updated_at ISO>` | transition instant, from a `status='active'`-conditional UPDATE |
| Health `auth_permanent` | `health-sync-alert:<connId>:auth_permanent:<ISO>` | `last_sync_error_at`, episode-exact |
| Health breaker / all-failed | `…:<reason>:<UTC date>` | date bucket — these change nothing durable, so a per-pass key would alert hourly |
| Gmail | `mail-needs-reauth:<connId>:<ISO>` | `last_sync_error_at` |

Two companion fixes make that real: both calendar dead-letter handlers are now
`status='active'`-guarded (unguarded they could move `updated_at` mid-episode), and a **silent,
permanent alert loss** is closed — a retry after a committed transition used to hit a bare
`continue` and complete with nobody told. The calendar alert body no longer carries
`googleAccountEmail`.

**AI output safety is shared and the proven bare-domain leak is closed (ADR-058).** The filter moved
to `packages/core/src/ai/output-safety.ts` (`./ai/*` subpath) so `apps/api` can use it without
importing `apps/worker`. Bare domains are now removed by two structural layers — a syntactic
public-suffix set that excludes English-word suffixes, and a **provenance** layer that strips any
host-shaped echo of the untrusted input. **The Brief lane had no output filter at all** and asserted
the false premise ADR-054 required be rewritten; both fixed, with a regression test asserting the
premise's absence.

**Reliability:** alerts now use `priority: high` on the `reminders` channel (the only channel that
exists on the device — a dedicated one needs an APK); revoking a device clears
`is_primary_reminder_device` without auto-promoting; the API container has a healthcheck reusing
`GET /health` that asserts the body (it always returns 200) and deliberately ignores `worker.stale`.

**Two mechanical guards** added, both structural: a pg-boss containment ratchet that resolves each
handler factory to its definition, and a mobile bundle-boundary scan (living in `apps/worker`
because `apps/mobile` has no Node types — the boundary it enforces).

**AI usage accounting** (`ai.usage`) is emitted on the mail digest lane through the worker's guarded
logger. The Brief lane is deliberately **not** instrumented: `apps/api` has no equivalent guarded
logger, and adding one was out of scope.

**Deployment.** Rolled out per the frozen order to `personal-os-8.1-release`; rollback images tagged
by digest as `:rollback-pre-8.1`. **api and worker were recreated in SEPARATE `up` invocations** —
verified first-hand that `apps/api` omits `schedule: false`, so pg-boss defaults it to `true` and
BOTH processes run a timekeeper; recreating them together would leave a window with none.
Post-deploy: all containers `restarts=0`, API reports `(healthy)`, `/health` ok, all three
integrations `active`, migration level 16, `digestTimezone` correctly preserved. Monitoring recorded
exactly **one** `down` check during the API recreation and correctly opened **no incident**
(threshold is 3 consecutive; `incidents_ever = 0`).

**Obsolete burned dispatch rows — CLEANED UP (owner-approved, 2026-09-02).** The two rows left by
the old under-scoped keys are deleted:

- `calendar-needs-reauth:a0cc5563…:c6c0b43d…` — accepted 2026-08-25
- `health-sync-alert:ac3d47ad…:auth_permanent:c6c0b43d…` — accepted 2026-09-01

Both referenced the **live** connections — the Health row being exactly the one ADR-051b describes
being rebound with `created_at` preserved, which is why that key stayed burned.

**Deleted by EXACT full-key equality, never a prefix.** A `LIKE 'calendar-needs-reauth:%'` would have
matched the legacy row today *and every future occurrence-scoped key* — correct now, destructive
later. The statement was wrapped in a `ROW_COUNT` guard that raises (rolling the whole thing back)
unless exactly 2 rows are affected, so a surprise could not be half-applied.

Verified: **9 → 7 rows**, 0 legacy rows remaining, and the checksum over the 7 survivors is
**byte-identical before and after** (`5e00278a…`), proving no other row's key, status or timestamp
changed. The protected namespaces were untouched — 2 digest, 2 confirmation, 2 test and 1 legacy
smoke row all remain. No container restarted, no deployment, migration level unchanged at 16.

**This was hygiene, not a fix.** The corrected producers emit strictly longer keys, so they were
never blocked by these rows; removing them prevents a future reader mistaking a burned key for an
active one.

**Not proven in production:** the new keys have not been *emitted* live, because that requires a
genuine integration failure and no safe deterministic trigger exists that does not break a real
Google grant. What IS verified first-hand is that the **running containers** carry the new key
expressions, the new Gmail alert module, the shared filter and the corrected Brief prompt.

### Checkpoint 8.2 — Enable the real Google Calendar (COMPLETE, 2026-09-03)

**Zero runtime code changes, zero migrations, zero new routes, zero queue changes, no OAuth change.**
The application tree is byte-unchanged; the only commit is this record. Migration level stays **16**.

**What changed:** exactly one boolean. `PATCH /calendar-connections/<conn>/calendars` at
**2026-09-02T23:49:26.362Z** flipped `calendar_connection_calendars.sync_enabled` from `false` to
`true` for the owner's real primary Google Calendar. No direct DB write was used and no validation
was bypassed.

**Target chosen from Google metadata, not from a name.** `GET /calendar-connections/:id/available-calendars`
proxies Google's own `calendarList`; it returned exactly **one** row with `primary: true`, whose id
hashes to `efe3d33ae266` (local row `066404b2…`). Independently corroborated in the database: that is
the only calendar whose `google_calendar_id` equals the connection's `google_account_email`, which is
how Google identifies a primary calendar.

**Nothing else was touched.** The PATCH body carried one item; the route is a partial patch keyed by
calendar id, so unlisted calendars are untouched. The other four rows' `updated_at` values are
byte-identical to the pre-change snapshot, including the dedicated test calendar, which remains
enabled and unchanged.

| Measure | Before (23:49:07Z) | After |
|---|---|---|
| `events` | 0 | **98** |
| `event_external_links` | 0 | **98** |
| `occurrences` | 0 | **0** (correct — see below) |
| `calendar_event_instances` | 0 | 0 |
| Agenda event items, data-bearing window | 0 | **6 items / 5 distinct ids** |
| `ai_daily_briefs` | 0 | 1 |

**Sync proof.** Picked up by the **normal cron** (`*/15 * * * *` UTC), not a forced `sync-now`.
First full sync completed `00:00:29.483Z`; all 98 events share one `created_at`
(`00:00:28.698967Z`), i.e. one atomic transaction. Connection stayed `active`, `last_sync_error`
NULL, and `calendar_connections.updated_at` was **not** re-stamped — so no `needs_reauth` transition
and no dead-letter occurred. No new alert row: `notification_dispatch_log` still 7 rows, 0 of them
`calendar-needs-reauth`.

**Idempotency proof (second natural cycle, `00:15:24.946Z`).** Row counts unchanged at 98/98/0.
**Zero event rows and zero link rows were rewritten** — every `updated_at` still equals the original
`00:00:28.698967Z`. `last_full_sync_at` stayed at `00:00:29.483Z` while `last_successful_sync_at`
advanced, proving the replay ran incrementally off the stored sync token rather than repeating a full
sync. Duplicate external identities are structurally impossible anyway: `event_external_links` carries
a UNIQUE index on `(connection_id, google_calendar_id, google_event_id)` plus a UNIQUE on `event_id`.
Measured: 0 duplicates, 0 orphan links, 0 events without a link, 98 distinct linked events.

**Data integrity.** 0 ADR-042 violations — all 29 all-day events have `starts_at` NULL with
`start_date` set; all 69 timed events have `starts_at` set with `start_date` NULL. 0 events with a
NULL/empty timezone; 5 distinct timezones present. 0 `ends_at < starts_at`.

**Recurrence behaves per ADR-042/045, verified on real data.** The yearly all-day master anchored
2024-07-23 expanded on demand to `occurs_at = 2026-07-23T12:00:00Z` — **local noon**, ADR-042's
DST-safe anchor — with `start_date` correctly **re-pointed to the instance date** `2026-07-23` rather
than the template's 2024 date. A multi-day timed event fans out across two agenda days under one id,
which is fan-out, not duplication.

**`occurrences` staying 0 is correct, not a missing expansion.** Calendar sync never inserts
occurrences; the nightly `occurrences.expand-window` (`0 3 * * *` UTC) owns that, over a rolling
90-day window. Both recurring masters fall outside it deterministically: one is `FREQ=DAILY` with
`UNTIL 2020-12-31`, the other `FREQ=YEARLY` whose instances (2026-07-23, 2027-07-23) both sit outside
2026-09-03 → 2026-12-02. Read-path expansion is separate and does work, as above.

**Cancelled semantics are code-verified, not exercised.** Sync requests `showDeleted=true` and maps a
cancelled event to a **soft delete** (`events.archived_at` set, link row removed) — never a hard
delete. `events_archived = 0` because on a first full sync a cancelled event with no pre-existing
link is correctly ignored.

**Surfaces.** Agenda went 0 → 6 event items over a window containing real data, with ADR-042
invariants holding on the wire. **Today correctly shows 0 events**: every one of the 98 events is in
the past (latest 2026-07-30), so there is nothing today and nothing in the 7-day upcoming horizon.
That is honest emptiness, not a broken read path — the same read model returns real rows the moment
the window contains data. Note that Today/Agenda apply **no** `sync_enabled` filter and read `events`
unconditionally; enabling a calendar is therefore the *only* control over what these surfaces show.

**Brief-lane safety, verified inside the running containers.** The API image carries
`packages/core/dist/ai/output-safety.js`, and `apps/api/dist/brief/output.js` imports
`sanitizeModelText` from `@personal-os/core/ai/output-safety` — the same shared module the mail
digest uses. The corrected prompt premise (*"The data DOES sometimes contain sensitive strings"*) and
the stranger-authored-calendar framing are both present in `apps/api/dist/brief/prompt.js`; the false
premise survives **only inside a comment at line 14**, outside the `BRIEF_SYSTEM_PROMPT` literal
(lines 27–51). `generateText` is called with exactly `model`, `system`, `prompt`, `maxOutputTokens`,
`abortSignal` — **no `tools`**. Event text is bounded at the prompt boundary (title 120, location 80,
control characters stripped *before* truncation) and `description` reaches the model nowhere at all.

One manual Brief was generated on the live path (`POST /briefs`, HTTP 200, 2.7 s). It was served by
the expected `gpt-4.1` row `313633f4…`, persisted `content` with **exactly one key, `text`** (server
owns the shape, ADR-043), and its 362-character output contains 0 URLs, 0 emails, 0 bare domains,
0 UUIDs and 0 markdown. **Honest limitation: it did not exercise calendar text**, because Today had
no events to include. The calendar→Brief path remains verified structurally, not by live traversal.

**Privacy.** A content-free leak scan pulled all 192 event-derived needles (98 titles, 46 locations,
55 descriptions, 1 account email) from the database and searched both container logs: **0 matches**.
The only URLs in the API log are loopback health-check addresses. No event content, attendee address,
location or conference URL appears in any log.

**Production health after two sync cycles.** All three Google integrations `active` with no error;
containers `restarts=0`, API `(healthy)`; migration level 16; worker heartbeat fresh; monitoring 0
incidents and 0 open. Every pg-boss job created since the change completed — the only failed job in
the system remains the pre-deployment `calendar.google.sync-calendar` of 2026-08-31.

### Checkpoint 8.3 — Find what you stored: search + export (2026-09-03)

**API and web COMPLETE and DEPLOYED. Mobile lane BLOCKED on owner-only actions — see below.**
**No migration** — level stays 16, `packages/db` byte-unchanged, `0016` absent. Locked by **ADR-059**.

**Search contract.** `GET /search?q=&limit=&include_archived=` over exactly four entities —
`tasks` (title, body), `notes` (title, body), `inbox_items` (raw_text), `mail_messages` (subject,
from_display_name). Every other table is excluded by decision, `events` included: 8.2 put real
third-party text there and it is still unbounded at write. Each result member is a `.strict()` Zod
object, so a column not named in the contract is a parse failure rather than a leak. Mail results
carry a display name only — never `from_address` or `from_domain`.

**`limit` is PER TYPE (default 20, max 50), not per response.** ADR-054's anti-eviction rule applied
to a new surface: with one shared budget, 549 mail rows would decide how many of the owner's 3 notes
come back. Proven live — a query matching **298** mail rows still returned the single matching note,
with mail capped at 20. Order is `task, note, inbox_item, mail_message`, then recency desc, then
`id` asc.

**Wildcard escaping is the load-bearing control, and it is not SQL injection.** Every value already
binds as `$n` and there is no `sql.raw` anywhere — but a bound parameter is still read as a LIKE
*pattern*, so `%` would mean "match every row", silently and never as an error. Escaping is a single
pass over `\ % _`, and the predicate is written as `ilike $1 escape $2` rather than via drizzle's
`ilike()` helper, which emits no ESCAPE clause. **Proven in production: `%%` returns 0 results
against 549 mail rows.**

**Performance — measured, not assumed.** At **26,000 seeded rows** (~50x production) worst observed
p95 was **37 ms** (a pathological 128-char query) and typical p95 **16–19 ms**, over 8 query shapes
x 25 runs. Live production latency 18–35 ms. No index exists and none can: `reconcile-drizzle-tracking.ts`
aborts on any non-btree method and any non-identifier index column, so GIN, trigram and
`lower(title)` all fail **by the same code path that would reject HNSW**, and `posops_app` holds
USAGE not CREATE so `pg_trgm` is unavailable anyway.

**Export.** `GET /export`, no parameters, user-authored core only: `projects`, `tasks`, `notes`,
`inbox_items`. Calendar, mail and health are excluded by decision. Three of four shapes reuse the
already-audited frozen entity schemas; inbox items are narrowed to drop `client_uuid`, `confidence`
and `parse_result`. Archived rows are always included. **Not a backup — ADR-024 untouched:** it reads
four tables and returns JSON, creating no file and having no schedule. No CSV (four column sets
cannot share one flat table without an archive format). **No mobile download affordance** — saving a
file on device needs new native surface; the endpoint is reachable by `curl` or a browser from any
tailnet machine.

**Mobile.** Search is a **header action on every tab, not a sixth tab** — the 480px bar already
carries five labels, the same reasoning that put Health and Monitoring behind Settings cards.
Composing two header actions is new (Settings was the only one); the minimal divergence is a
flex-row wrapper. Navigation is derived from `type` + uuid only — the API returns **no href**, so a
subject that looks like a path cannot become one. A mail result has no destination and renders as a
plain `View`, not a dead `Pressable`.

**Search results are deliberately NOT put through `sanitizeModelText`.** That filter is for a
*model's* prose; a search result is the owner's own stored text quoted back on request. Rewriting a
note they wrote into "renew at [link removed]" would be lying about their content in the one feature
whose purpose is finding it. What defends the path is the renderer, and a new mechanical guard
(`apps/worker/src/mobile-inert-rendering.test.ts`) now enforces app-wide that nothing interprets its
input — no WebView, no markdown renderer, no `dataDetectorTypes`, and `Linking.openURL` from exactly
one justified file.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build **23/23** · typecheck **23/23** · `eslint .` clean · `prettier --check .` clean · `git diff --check` clean |
| 2 | Full suite, uncached and serial | **3,226 tests / 21 turbo tasks, 0 of 21 cached**, zero failing (baseline was **3,075**, re-measured first-hand, not assumed) |
| 3 | No package decreased | api **673** (+48) · mobile **529** (+30) · worker **431** (+4) · core **439** (+32) · health-providers 315 · schema **280** (+25) · monitoring 132 · api-client **133** (+12) · mail-providers 116 · db 79 · **calendar-providers 74** (zero-drift canary, held exactly) · ai-providers 25 |
| 4 | Mutation tests | **8 of 8 killed and restored** — per-type cap, LIKE escaping, query min-length, search result allowlist, export inbox narrowing, archived exclusion, mail tombstone exclusion, inert-rendering guard |
| 5 | Migration invariant | **16 `.sql` / 16 journal entries**, `0016` absent; `packages/db` diff vs `26cf910` **empty**; production tracking table **16** |
| 6 | Local performance | 26,000 seeded rows, 8 query shapes x 25 runs, worst p95 **37 ms**; seed data removed afterwards |
| 7 | Live search | 4 entity classes in one response; caps, `truncated`, ordering and all 5 validation 400s verified over real Tailscale HTTPS |
| 8 | Live export | 4,285 bytes, 9 top-level keys, `scope=user_authored_core`, counts matching production exactly, **0 of 22 forbidden substrings**; temp copies deleted |
| 9 | Log leak scan | **1,798 needles** pulled from the DB (mail subjects/display names/addresses, event titles/locations/descriptions, task/note titles, note bodies, inbox text), matched binary-safely against 40 min of api + worker logs: **0 found**, with a positive control proving the scanner works |
| 10 | Production health | 3 integrations `active` · migration 16 · restarts **0** · monitoring 5 targets, **0 incidents ever**, 0 down in 20 min · heartbeat 3 s old · 124 jobs in 20 min, all `completed` · no new failed jobs · Postgres publishes no host port |

**A test weakness was found by mutation testing, not by review.** Disabling `escapeLikePattern`
entirely left the literal-`%` test *passing*: with only one relevant row, the unescaped pattern
`%50%%` still matched exactly one row. A decoy row containing `50` but no percent sign was added; the
mutation is now killed. Recorded because the failure mode — a test that pins nothing while appearing
to pin a security control — is the one worth remembering.

**One incidental fix to the decision log.** Checkpoint 8.1 appended ADR-058 onto the END of
ADR-057's line (`… | Locked || ADR-058 | …`), so ADR-058 never rendered as its own table row — it
showed as trailing text inside ADR-057's last cell. A newline was inserted. The change is
**whitespace-only and proven so**: the SHA-256 of the file's entire non-whitespace content is
byte-identical before and after, so no Locked decision's text was altered. All 64 ADR rows now
render.

#### Deployment

Frozen order followed to `/home/himallinux/personal-os-8.3-release` (766 tracked files via
`git archive`; no `.env`, no `google-services.json`). Rollback images tagged **by resolved digest**
as `:rollback-pre-8.3` for api, web **and** worker. New api image verified to contain 16 migrations,
no `0016`, and the compiled search/export code before anything running was touched. Migration ran
from the new image with `--no-deps` and **applied nothing**, as expected.

**`api` and `web` recreated; `worker` deliberately NOT.** Its runtime is unchanged — the only worker
source change is a test file that no entrypoint imports — so rebuilding it would have been a
gratuitous restart. Verified after: the worker's serving image digest is byte-identical to before
(`012f981f…`), while api and web moved to new digests. All four containers `restarts=0`, API
`(healthy)` in 11 s, and monitoring recorded **zero** `down` checks through the recreation.

#### Mobile lane — CLOSED 2026-09-03

The blocker was a **charge-only USB cable**, not a device setting. `ioreg -p IOUSB` (not
`system_profiler`, which returns empty output here) showed the device absent from the bus entirely;
a data cable made it appear immediately as serial `919109A4M16001324668`, `model:rabbit_r1`, matching
the serial recorded at Checkpoint 6.7B.

**Build.** `eas build --platform android --profile production-internal --freeze-credentials`, EAS
cloud, build `4530b425-be99-49e9-bc62-30a4329a379e` from commit `d030fc1`. EAS incremented
**versionCode 7 → 8** and used remote keystore **`Build Credentials 91FWKRpxFX`** — the same named
credential as 6.7B. The EAS `production` environment supplied only `EXPO_PUBLIC_API_URL` and
`EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`; **`EXPO_PUBLIC_UI_TEST_MODE` was absent**, as required.

**Signing proof — three-way, before installing anything.** The installed v7 APK was pulled from the
device (sha256 `5c400467…f96a4`, an exact match to the recorded v7 artifact) and its certificate
compared against the new one. Both are `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`
/ SHA-1 `7eac1aa4…`, equal to the recorded production identity.

> `apksigner` needs a JVM and this machine has none, and the APKs carry no v1 block, so the
> fingerprint came from a purpose-written APK-Signing-Block parser. **Its first result was WRONG** —
> it read the v2 block's outer length-prefix as the first signer instead of the signers sequence,
> one nesting level off, and produced a plausible but incorrect digest. The recorded fingerprint is
> what caught it. That is the argument for comparing against a recorded value rather than trusting a
> fresh tool, and it is why the parser was only trusted on the new APK **after** it reproduced the
> known-good one exactly.

**Bundle contents verified pre-install** (Hermes bytecode, so `grep -a`): the five 8.3 search markers
— the placeholder, `search-result-`, `search-input`, the idle copy and `No matches.` — are present in
the new bundle and **absent from the installed v7 bundle**. The production tailnet API URL is baked
in and `localhost:3000` is absent. The one `personalos.dev` hit is `UI_TEST_ANDROID_PACKAGE`, the
constant in the isolation guard that refuses to start if production runs in the UI-test package —
the guard naming what it forbids.

**Install and preservation.** `adb install -r` only — no uninstall, no `-d`, no data clear. Result
`Success`.

| Check | Before | After |
|---|---|---|
| versionCode | 7 | **8** |
| `firstInstallTime` | 2026-08-19 16:26:10 | **2026-08-19 16:26:10 — unchanged** |
| `lastUpdateTime` | 2026-08-29 22:40:57 | advanced to 2026-09-02 23:58:38 |
| `dataDir` | `/data/user/0/com.himal.personalos` | unchanged |
| Packages | production only | production only |
| appop `SCHEDULE_EXACT_ALARM` | `allow` | **`allow` — preserved** |
| `POST_NOTIFICATIONS` | granted | granted |
| Device row | `c6c0b43d…` PRIMARY, push present | **same row**, PRIMARY, same push token (md5 `d0a7fdbf4119`) |
| Pairing codes consumed | 2 | **2 — no re-pairing** |
| Device count | 2 (1 active) | 2 (1 active) — no duplicate |

**No pairing screen on cold launch**, and `last_seen_at` refreshed immediately — the SecureStore
credential survived the update.

> **The ROM's exact-alarm inconsistency was reconfirmed first-hand**, exactly as Checkpoint 5.7
> recorded: `cmd appops get … SCHEDULE_EXACT_ALARM` reports **`allow`** while
> `dumpsys package … SCHEDULE_EXACT_ALARM` reports **`granted=false`**, both before and after. The
> appop is the authoritative gate on Android 14+. A live-alarm reading
> (`window=0 exactAllowReason=permission`) was **not available**: the app has no alarm scheduled,
> because this device has `notify_reminders = false`. The preservation claim therefore rests on the
> appop being identical before and after, not on a scheduled alarm.

**Physical acceptance at 480×640 — passed.** The 🔍 header action appears beside ⚙️ on every tab
(before/after screenshots confirm it was absent on v7), **still five tabs, no sixth**. The field
autofocuses with the keyboard up; the idle state reads "Type at least 2 characters to search."
Results render as grouped sections in the contract's type order — TASKS, NOTES, INBOX, then MAIL —
with previews and clamped long text, no overflow. Mail rows show subject plus sender display name
and **no address**; tapping one does not navigate, as designed. Task → Task detail, note → Note
detail, and a committed inbox capture → the Note it became, all verified.

**Live device search proof.** The API log shows the device's own queries arriving through Tailscale
Serve (`host: personal-os.tail62a68f.ts.net`) — including `/search?q=%25%25`, a query never issued
from any other client. With the field holding exactly `%%`, the device rendered **"No matches."**;
had escaping been absent, that pattern would have matched **every one of the ~560 searchable rows**.
All 13 `/search` responses in the window were `200`. A log scan of **1,708 content needles** from the
database found **0** in either the api or worker log, with a positive control proving the scanner
worked.

> Honest limitation: the app issues one request per keystroke (five requests while typing a
> six-character query). At single-user scale with 18–35 ms responses that is harmless, and it is
> recorded as debt rather than fixed. The error state was **not** exercised — reproducing it needs
> network disruption on the owner's daily driver.

**The deployed web bundle** was verified to carry the search screen but was **not visually
rendered**: the sandboxed browser fails `ERR_BLOCKED_BY_CLIENT` on `/_expo/static/*` at `:8443`, the
documented Phase 2 limitation. The device is the real acceptance and it passed.

### Checkpoint 8.4 — Low-friction capture (2026-09-03)

**Lane 0 (the mandatory reliability gate) PASSED. Lanes 1, 2, 4, 5 and 6 shipped. Lane 3
(notification-shade text capture) is DEFERRED on evidence — it is not viable on the installed
runtime without adding a background-task framework.** **No migration** — level stays 16,
`packages/db` byte-unchanged, `0016` absent.

#### Lane 0 — the `capture.parse` incident: root cause and fix

Checkpoint 8.3 closure recorded that two `needs_confirm` inbox items were confirmed, both parse jobs
failed all five retries, and both items stayed `needs_confirm` with the user told nothing. The cause
is **not** an AI outage and never was — **the confirm path calls no model at all.**

**Reconstructed first-hand against production, no user text printed:**

| Evidence | Value |
|---|---|
| Failed jobs | `378954c5…`, `bfd695be…` — both `mode: "confirm"`, `retry_count 5/5` |
| API requests | `04:38:07.729Z` and `04:38:10.779Z`; jobs enqueued 6 ms and 8 ms later |
| Stored tool call | **`unclear`** on both, `confidenceFlags: ["modelUnclear"]`, args `{reason}` |
| `job.output` | `AiJobError: capture.parse failed (Error)` — a bare `Error`, no SQLSTATE |
| Worker log | **3 lines in the whole 40-minute window**, all `mail.sync.finished`. Nothing about the failures. |

**Root cause.** `runAutoParse` stores an `unclear` tool call as a confirmable `parse_result`, but
`commitParsedEntity` ends `case "unclear": throw new Error(...)` — so confirming one is
*structurally impossible*, deterministically, forever. Nothing consulted that before enqueueing.

**Four defects, each silent on its own, compounding:**

1. `POST /inbox/:id/confirm` returned **202 for work that could only fail** — it never read
   `parse_result`.
2. `corrected_tool_call` was `z.unknown()`, so a correction was never validated.
3. The API stored a correction as a **bare tool call** while the worker reads `parse_result.toolCall`
   — so the documented escape hatch from an `unclear` parse was **itself broken**.
4. The mobile mutation had **no error path at all**: 404, 409 and 503 were all indistinguishable
   from success. The button simply returned to its idle label.

Compounding both: `capture.parse` is the **only retrying queue in the system with no dead-letter
queue** (`ptt.transcribe`, `notifications.dispatch` and all three calendar queues have one), and the
lane logged **nothing** on failure.

**Fix.** The API now computes the *effective* tool call — the correction if supplied, else the
stored one — and refuses an uncommittable confirm with **409 `parse_result_not_committable`** before
enqueueing anything. The refusal echoes the tool **enum only**; the `unclear` tool's own `reason` is
derived from capture text and is deliberately never returned. Corrections are validated against
`ParserToolCallSchema` and stored in the shape the worker reads. The worker treats an
uncommittable/unreadable confirm as **permanent, not retryable**, and every capture.parse failure is
now classified by **stage** (`load_row` / `confirm_commit` / `auto_parse` / `confirmation_push`)
through `errorToken`, which can carry neither provider prose nor capture text. Mobile surfaces the
refusal and no longer offers a button that cannot succeed.

#### Lane 0 live proof (production)

- **The exact defect, on the exact rows.** Confirming both stuck items now returns **409
  `parse_result_not_committable`** immediately. Verified non-mutating: both remain `needs_confirm`
  with `entity_id` null, and **zero new `capture.parse` jobs were created** — the newest job in the
  table is still the original 04:38 failure. The response body contains no `reason` and no capture text.
- **Happy path, end to end.** A synthetic capture ("water the office plants every 3 days") parsed to
  `needs_confirm` via the `recurrenceInferred` hard flag, was confirmed (202), and committed exactly
  one task — inbox `confirmed`, `entity_type: task`, tasks 2 → 3. Both jobs completed with
  `retry_count 0`.
- **Replay proves no duplicate.** Three confirm replays → `409 not_awaiting_confirmation`; a capture
  replay with the same `client_uuid` returned the **same** `inbox_id`. Totals unchanged.
- **Log scan.** 17 needles (every stored `raw_text`, task/note title, and every `unclear` reason)
  matched binary-safely against both container logs: **0 found**, with positive controls proving the
  scanner works. Repeated at closure across the whole checkpoint's activity with **420 needles**
  (adding every mail subject and sender display name) against 529 log lines: **0 found**.

The smoke task was **archived** afterwards (Today is clean, active tasks back to 2). Its inbox row
remains as lineage, matching the Gate H smoke-note precedent.

**The two original stuck items are unchanged and remain `needs_confirm`.** They are 1- and
2-character captures the model could not classify. They are now *honestly* unconfirmable rather than
silently so. **Owner action, if wanted:** supply a real classification with
`POST /inbox/<id>/confirm -d '{"corrected_tool_call":{"tool":"create_note","args":{...}}}'`, which
now works because defect 3 is fixed. Doing nothing is also fine.

#### Lanes 1 + 2 — share sheet and launcher shortcut

Both Android front doors mean the same thing, so both go through **one** local Expo module
(`modules/capture-intent`) and **one** composer. `source: "share"` and the `share` CHECK value
already existed — **no migration**.

- **Share sheet needs no config plugin**: `android.intentFilters` IS in `@expo/config-types`'
  ExpoConfig, verified against the installed package. (Contrast `android.usesCleartextTraffic`, which
  is *not* in the schema and cost this repo three checkpoints.)
- **The shortcut does**: there is no `android.shortcuts` key, so `plugins/withCaptureShortcut.ts`
  writes `res/xml/shortcuts.xml` plus the meta-data pointer — which must sit on the **launcher
  activity**, not on `<application>`.
- Verified by prebuild: both the `SEND`/`text/plain` filter and the shortcuts meta-data render on
  MainActivity under `applicationId com.himal.personalos`, and `share-intent` autolinks alongside the
  two existing local modules.

**Not turning one gesture into two Inbox rows** is the whole correctness story:

| Hazard | Defence |
|---|---|
| The launch intent is **sticky** and re-delivered after process death + Recents restore | Native **consumes and neuters** it (`removeExtra` + action reset), never a plain getter |
| `activity.intent` stays the ORIGINAL launch intent forever (RN never calls `setIntent()`) | The warm path uses the Intent handed to `OnNewIntent` |
| A fresh `randomUUID()` per submit defeats the server's dedupe | The **native intent id becomes the `client_uuid`** |
| Remount (identity gate, Activity recreation) resets component state | The claimed-id set is **module scope** |

A share **pre-fills** the composer rather than submitting: the text came from another app, so the
owner sees it and can edit or cancel, and nothing is posted without a tap. Text is
control-character-stripped **before** truncation (the 8.1 ordering) and bounded by the same constant
the server enforces. Nothing interprets it — no HTML, no Markdown, no autolink, no derived route.

#### Lane 3 — notification-shade text capture: DEFERRED, not shipped

`textInput` **is** genuinely implemented on Android in the installed `expo-notifications@57.0.12` —
traced through the native source: `TextInputNotificationAction` → `RemoteInput.Builder` →
`RemoteInput.getResultsFromIntent` → `userText`. So the type is not iOS-only.

**It is nonetheless not viable here, and the evidence is specific.** When the app process is dead —
the normal state for a shade affordance — the reply is parked in a static in-process collection
(`ExpoHandlingDelegate.kt:172`), replayed only if JS later registers; if the process dies first, the
captured text is **lost**. The durable path is `runTaskManagerTasks`, which needs
**`expo-task-manager` — verified ABSENT** from both `node_modules` and `package.json`. The
alternatives are (a) add a background-task framework, which this checkpoint was told not to do, or
(b) `opensAppToForeground: true`, which defeats the point and which the launcher shortcut already
does better. Silently losing captures is the one failure this architecture exists to prevent.

Two further costs, recorded rather than discovered later: it needs a **new notification channel**
(APK-level), and `use-notification-lifecycle.ts` dedupes by notification identifier, so a persistent
notification with a stable id would **swallow every reply after the first**.

#### Lanes 4 + 5 + 6 — pickers, creation reminders, eligibility

- **Pickers.** Every date field has been a hand-typed ISO-8601 `TextInput` since Phase 2. Now a real
  Material 3 date + time dialog, using **`@expo/ui` — already installed and already autolinked with
  zero import sites**, so no new package and no new native surface. `formatInstantWithOffset`
  (`packages/core`) carries the zone's real offset for that instant: a bare local string would be
  silently ambiguous, and UTC would discard the wall clock the user chose. **Web keeps the text
  input** via a `.web.tsx` fallback — verified in the deployed bundle: `ISO 8601` present,
  `DatePickerDialog` / `jetpack-compose` **absent**.
- **`remind_at` at creation.** Previously writable only by AI capture and by PATCH, so setting a
  reminder on a new task meant create-then-patch. **No migration** — the column has existed since
  Phase 1. Verified live: `14:00:00-06:00` → stored `20:00:00Z`, cleared via PATCH, task archived.
- **Reminder eligibility on Today.** `describeReminderEligibility` has existed since Checkpoint 5 but
  rendered **only on Settings**, so the failure it was written for — a re-pair strands primary on the
  old device row and the device in your hand schedules nothing — was invisible unless you opened
  Settings. Renders **nothing** when reminders will fire. **Informational only**: never promotes a
  device, never flips a setting. ADR-019 and ADR-036 stand.


#### Physical acceptance on the Rabbit R1 (480x640)

**Signing proof — three-way, before installing anything.** The installed v8 APK was pulled from the
device and its certificate compared with the new one. Both are
`4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea` / SHA-1 `7eac1aa4…`, equal to the
recorded production identity.

> This machine has no JVM, so `apksigner` is unavailable and the fingerprint came from a
> purpose-written APK-Signing-Block parser — the same constraint Checkpoint 8.3 hit. Following that
> checkpoint's own lesson, the parser was **validated against the installed v8 first** and only
> trusted on the new APK after reproducing the known-good value exactly.

**Verified in the shipped APK before install:** `package com.himal.personalos` (not `.dev`),
`versionCode 9`, the `SEND`/`text/plain` intent filter, the `android.app.shortcuts` meta-data, and
the compiled `xml/shortcuts` resource carrying action `com.himal.personalos.action.CAPTURE` with
`targetClass com.himal.personalos.MainActivity`. Bundle markers: all five 8.4 strings present;
`localhost:3000` absent; the production tailnet URL present; `EXPO_PUBLIC_UI_TEST_MODE` absent. The
one `personalos.dev` hit is the isolation guard naming what it forbids, as at 8.3.

**TWO builds were needed.** versionCode **9** (`7b7acca`) shipped the defect below; versionCode
**10** (`6788b8d`) fixed it. EAS incremented the code itself both times — it was read from the build,
never assumed. Both used remote keystore **`Build Credentials 91FWKRpxFX`**, the same named
credential as 6.7B and 8.3, and the EAS `production` environment supplied only
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` and the secret file var
`GOOGLE_SERVICES_JSON` — `EXPO_PUBLIC_UI_TEST_MODE` absent, as required.

**Install and preservation** — `adb install -r` only; no uninstall, no `-d`, no data clear.

| Check | Before | After |
|---|---|---|
| versionCode | 8 | **10** (via 9) |
| `firstInstallTime` | 2026-08-19 16:26:10 | **unchanged** |
| `dataDir` | `/data/user/0/com.himal.personalos` | unchanged |
| Packages | production only | production only |
| appop `SCHEDULE_EXACT_ALARM` | `allow` | **`allow` — preserved** |
| Device row | `c6c0b43d…` PRIMARY, push md5 `d0a7fdbf4119` | **same row**, PRIMARY, same token |
| Pairing codes consumed | 2 | **2 — no re-pairing** |

**No pairing screen on cold launch** — the SecureStore credential survived the update.

**Front doors, exercised on the device:**

- **Share sheet.** Personal OS is a registered `SEND`/`text/plain` target. **Warm** (`onNewIntent`)
  and **cold** (force-stopped, launched by the share) both opened Quick Capture pre-filled, wrapping
  cleanly with no overflow. Submitting produced the **first `source: "share"` row in this system**,
  auto-parsed.
- **Consume-once, proven on the real device.** After the cold share was captured, force-stopping and
  relaunching normally showed a clean Today with **no composer** — the sticky launch intent did not
  resurrect — and the inbox still held **exactly one** share row.
- **Launcher shortcut.** Registered as a manifest shortcut (`id=capture`, label "Capture") and fires
  the custom action. **Warm and cold** both open the composer **empty**, correct for `kind:
  "compose"`.
- **Five tabs unchanged**, header search + settings actions intact, no layout regression.
- **Date/time pickers** (on versionCode 10). Tapping "Due date" opens a real Material 3 calendar
  dialog, which hands off to a 24-hour clock dialog; the field then reads **"Sep 14, 2026, 2:12 AM"**
  — proving `combineDateAndTime` takes the date from one dialog and the wall clock from the other. A
  **Clear** control appears only when a value is set and returns the field to "Not set". Both dialogs
  fit 480x640 with no clipping.
- **Reminder round-trip, device to database.** A task created on the device with the reminder picker
  showing "Sep 19, 2026, 2:13 AM" is stored as **`2026-09-19T07:13:00.000Z`** — 02:13 CDT is 07:13
  UTC, so the offset the picker serialized is exactly right — with `due_at` independently null. Task
  archived afterwards; active tasks back to 2.
- **Today shows no reminder banner**, which is correct: this device is PRIMARY, notifications are
  enabled, it is not revoked, and the exact-alarm appop is `allow`, so reminders will fire.

#### A real defect found by physical acceptance, and only by it

The first v9 build shipped date/time fields that **did nothing when tapped**. No crash, no error, no
failing test — the only evidence anywhere was one logcat line:

> `ExpoComposeView: MissingHostException: A Jetpack Compose view "DatePickerDialogView" must be
> rendered as a direct child of a <Host> component.`

`@expo/ui`'s Compose views require `<Host>` as their **direct** parent; the field's own `<View>`
between them breaks the Compose composition boundary. Fixed by hosting both dialogs in a zero-size,
absolutely-positioned `Host` (they are dialogs — they overlay the screen and must take no layout
space in the form), and **`compose-host.test.ts` now enforces the rule mechanically** for every
`@expo/ui/jetpack-compose` view in the app, walking back from each usage to the nearest enclosing JSX
tag. Mutation-verified against the exact defect that shipped.

Recorded because the failure mode is the point: a native view that silently renders nothing is
invisible to every check that does not run on a device.

### Checkpoint 8.5 — Instrumented daily-driver soak (TERMINATED BY OWNER 2026-09-04)

A 3–4 week **feature freeze** whose deliverable is evidence, not features. It answers one question:
does Personal OS become genuinely useful when development stops? The Rabbit R1 is the owner's
primary daily driver for the duration.

**The full record — window, baseline, health-check readings and the observation ledger — is
`docs/SOAK-8.5.md`.** Only the summary lives here, deliberately, so this file does not grow the way
it did through Phase 7.

| | |
|---|---|
| SOAK_START | **2026-09-03 15:07 CDT** (`2026-09-03T20:07:40Z`), recorded first-hand |
| Milestones | DAY_7 2026-09-10 · DAY_14 2026-09-17 · **DAY_21 2026-09-24 (minimum close)** · DAY_28 2026-10-01 (preferred) |
| Entry state | HEAD `9538f66`, tree clean, local ≡ `origin`, migration **16**, Rabbit **versionCode 10** |

**Baseline at 2026-09-03T20:07Z**, collected from existing observability only — no analytics code
added, no telemetry introduced, no user-authored content read:

- **Core:** 0 projects · 5 tasks (2 active) · 4 notes · 8 inbox items · 98 events · 1 occurrence · 1 review
- **Capture by source:** `web` 4 · `ptt` 3 · `share` 1. Parser 5 completed, 2 failed (the known 8.4 `unclear` pair)
- **Reminders:** 3 tasks carry `remind_at` but **0 are live and future**; 0 alarms scheduled, correctly
- **Integrations:** Calendar `active` (2 of 5 calendars, 98 events) · Gmail `active` (567 messages, 200/200 syncs, 0 cursor expirations, 3 digests) · Health `active` (19 streams, 161 daily rows, 1,854 succeeded / 1 known failure)
- **Monitoring:** 5 targets · 7,577 checks, 7,576 up · **0 incidents ever**
- **System:** migration 16 · all containers `restarts=0` · API `(healthy)` · Postgres publishes no host port · 3 non-completed pg-boss jobs all time, all known

**Two measurability limits are stated rather than engineered around.** Launcher-shortcut captures are
indistinguishable from Quick Capture — both are `source: "web"`, and splitting them needs a
CHECK-constraint migration the freeze forbids; **share is measurable, launcher is not.** Search
frequency *is* countable from the request log without retaining query text, but the count resets on
any API recreation, so it is per-log-epoch and each check records the container start time.

**Two alarming baseline readings were checked and cleared**, recorded so they are not
re-investigated: `notify_reminders = false` on the primary device does not block local scheduling
(the column is intentionally unwired), and the archived 8.4 smoke task's open past-dated occurrence
does **not** surface on Today (`overdue_total = 0`).

**One real friction item is deferred, not fixed:** Today permanently shows `inbox_attention_total = 2`
from the two captures that can never be confirmed in-app. A counter that never clears trains the
owner to ignore it and will bias the soak; the owner can clear it with a `corrected_tool_call`, and
there is no in-app route. P2 — recorded, not absorbed.

**Freeze exceptions: 0.** No code was written, no deployment occurred, no production write was made,
and no migration was created during the soak.

#### Termination — owner decision, 2026-09-04 00:04 CDT

The owner elected to continue normal development rather than hold a 3-4 week freeze. **This is an
intentional product-management decision, not a failed checkpoint and not a technical failure** --
every health signal was green at termination.

The soak ran **9.1 hours of a 21-day minimum, or 1.8%**, and reached **no milestone**: DAY_7, DAY_14,
DAY_21 and DAY_28 were all unreached.

**What may never be claimed from it.** No capture-first conclusion. No integration-first conclusion.
No inference about any feature's usefulness presented as soak evidence. **The strategic fork is
UNRESOLVED** -- not "leaning", not "probably". The zero organic usage observed means nothing: it is
what nine mostly-overnight hours look like on any system, and reading it as disengagement would be a
fabrication in the opposite direction. **The phrase "the soak showed" is prohibited**, because it
did not show anything.

**What survives.** The baseline is real, first-hand, privacy-safe measurement of production on
2026-09-03 and remains valid as dated historical data -- a snapshot, never adoption evidence. So do
the two negative results it forced (`notify_reminders` does not gate local scheduling; the archived
smoke task's occurrence does not leak onto Today) and the two measurability limits it found
(launcher captures are indistinguishable from Quick Capture; search frequency is per-log-epoch).
Those are properties of the system, so they outlive the experiment.

**The feature freeze is LIFTED.** Development continues normally across all modules. Ongoing
development will contaminate any future adoption measurement, and the owner accepts this: **Phase 8
does not use soak evidence as a gating dependency.** Every later decision must separate **VERIFIED
TECHNICAL EVIDENCE** from **UNVERIFIED PRODUCT HYPOTHESIS**. A fresh soak against a future stable
release would be a new checkpoint with a new baseline, not a resumption of this one.

Full record: `docs/SOAK-8.5.md`.

---

### Checkpoint 8.6 — Intelligence & Operations Decision Gate (2026-09-04)

Replaces the originally soak-dependent 8.6. **No adoption evidence exists**, so every claim in the
report is labelled **FACT** (verified first-hand) or **HYPOTHESIS**. Full report:
**`docs/CHECKPOINT-8.6-DECISION.md`**. Six read-only sub-agents ran; **every load-bearing claim was
re-verified by the integrator**, and an adversarial critic refuted several of the integrator's own
conclusions, which are corrected in §17b of the report rather than defended.

**Measured, not estimated.** User-authored corpus **1,082 bytes (~270 tokens)**; everything including
events, mail headers and health ~50 KB (~12,500 tokens). **pgvector is NOT available** in the image
(`pg_available_extensions` returns 0; only `plpgsql` installed) and `posops_app` **cannot CREATE** in
`public` — so Option C is blocked by infrastructure, not only by ADR-056. `posops_app` holds
SELECT/INSERT/UPDATE/DELETE on **all 37 tables** including all six credential tables, so a read-only
AI lane is read-only **because it holds no tools**, never because the grant stops it.

**Present-state corrections found by this gate** (recorded in the report and §17b): the ledger's
"`capture.parse` is the only retrying queue without a DLQ" is **false** — `occurrences.expand-window`
and `occurrences.generate-lazy` also lack one, and the latter's failure means **a completed recurring
task silently never spawns its successor**, with all three recovery paths verified closed. The
zero-length all-day event was **not** "harmless" — it is invisible on Today. ADR-050's
reconcile-script claim is **stale**. `credential-crypto.ts` has **no AAD**. And the `/search?q=` fix
was far cheaper than recorded.

#### Checkpoint 8.6A — reliability & data-integrity hardening (COMPLETE, committed 2026-09-04)

Owner-scoped to four items; all four shipped. **No migration** — level stays 16, `packages/db`
byte-unchanged, `0016` absent.

`capture.parse` gains a dead-letter queue and a durable terminal state: retry exhaustion now writes
`status: "failed"` with a **closed scalar failure record** (no provider prose, no capture text)
instead of leaving the row `pending`/`needs_confirm` forever with the only evidence in pg-boss's
`job.output`, which self-deletes after 7 days on a default nobody chose. A `needs_confirm` row's
stored tool call is **preserved**, so ADR-060's `corrected_tool_call` route survives. Zero-length
all-day events are floored at their start date. `q` is scrubbed from the request log.

**The DLQ change would have silently done nothing.** `createQueue` is `ON CONFLICT DO NOTHING` and
`capture.parse` has existed since Phase 1, so the option is discarded on every deployed database —
while every suite runs against a fresh one where the INSERT fires. Both processes therefore also call
`boss.updateQueue`, and a source-scanning guard pins that call, the FK creation order, and the
handler being bound to the **dead** queue rather than the primary.

Verification: build **11/11** · typecheck **21/21** · eslint clean · prettier clean · gitleaks clean ·
full suite **uncached and serial 3,340 tests / 21 tasks, 0 cached, zero failing** (baseline 3,322;
worker **452**, api **689**, calendar-providers **76** — the zero-drift canary moved deliberately;
no package decreased) · **mutation tests 9 of 9 killed and restored**.

#### 8.6A deployment and acceptance — 2026-09-11 (PASSED)

Frozen order to `/home/himallinux/personal-os-8.6a-release` (797 tracked files via `git archive`;
no `.env`, no `google-services.json`). Rollback images tagged **by resolved digest** as
`:rollback-pre-8.6a` for api, worker and web, each verified equal to the serving digest before any
build. Only `api` and `worker` were built. The new api image was inspected **before anything running
was touched**: 16 migrations, no `0016`, and every 8.6A marker present in compiled output. Migration
ran as `posops_migrator` from the new image with `--no-deps` and **applied nothing** (16 → 16);
`MIGRATIONS_DATABASE_URL` is not in the api `environment:` block, so it was forwarded from the stable
`.env` with `-e`, never printed. **`api` recreated alone**, healthy in ~8 s; **`worker` recreated
alone** 44 s later, `worker.started` reporting **queues: 26** (25 + the new dead queue, counted not
hardcoded) with `digestTimezone` preserved. **`web` and `postgres` untouched** — `web` still started
2026-09-03, `postgres` 2026-08-30. Monitoring recorded **zero** `down` checks through both
recreations.

**The critical criterion, with provenance rather than inference.** `pgboss.queue` for `capture.parse`
now reads `dead_letter = 'capture.parse.dead'`, on a row whose `created_on` is **2026-08-16** (Phase
1) and whose `updated_on` is **2026-09-11 21:56:17** — the worker's `pgboss.started` instant to the
second. A 26-day-old row modified today can only be `updateQueue`; `createQueue` on it is a no-op by
construction. An intermediate read taken after the API alone had been recreated already showed the
value set, so **both processes executed the path** and the worker's call was idempotent. The dead
queue exists (26 → 27 queues, FK valid) and the retry options are byte-identical to before.

**Acceptance, each with direct evidence:**

| | Evidence |
|---|---|
| **B1 normal parse** | Smoke capture → `202` → `parsed\|note` in ~9 s, job `completed retries=0` on the new worker |
| **B2 DLQ consumer** | A job sent straight to `capture.parse.dead` for a **nonexistent** id completed at 21:59:07.270, and the worker log at 21:59:07.269 shows `capture.parse.dead_letter_row_missing` — an event that exists **only** in the 8.6A handler. No real row touched. |
| **B — not exercised live** | A real job exhausting five retries and being routed `capture.parse → .dead` by pg-boss. Manufacturing that failure is unsafe; the routing is pg-boss's own mechanism on the verified `dead_letter` column, and the handler's behaviour on a real row is pinned by 8 DB-backed tests and 9 mutations. |
| **C search-log privacy** | `GET /search?q=<sentinel>` → the full structured `req` object reads `"url":"/search?q=[redacted]"` with exactly `method/url/host/remoteAddress/remotePort`, no body field; sentinel appears **0 times** in either container log |
| **D all-day floor** | Present at `translate.js:55` in the running worker (the sync write path) and in the api |

**Legacy row `e2b9a5f7` repaired, after acceptance passed.** Before: `2021-12-16 → 2021-12-15`,
unarchived, untouched since the 8.2 ingest. The `UPDATE` ran inside a transaction under a `ROW_COUNT`
guard that raises unless exactly one row matches; it matched exactly one. After: `2021-12-16 →
2021-12-16`, **zero** inverted all-day rows remain anywhere, `events` still 98, and the range read
model now returns it as a valid single-day span. Today is anchored to now, so a 2021 event cannot
appear there and no such claim is made; the before-state evidence is that `end_date < start_date`
made the classifier's containment predicate an empty range, and it is now satisfiable.

**Content-count changes caused by this deployment, all deliberate:** one smoke capture (inbox 8 → 9,
row remains as lineage per the 8.4 precedent) and the note it committed (notes 4 → 5, **archived**
afterwards, 3 archived total), plus the one-row event repair. Tasks, projects, events and
`notification_dispatch_log` unchanged.

One process note: the first two migrate attempts failed harmlessly — a wrong dist path, then an empty
URL because compose never forwards `MIGRATIONS_DATABASE_URL` into the container. Migration level was
16 before, between and after; nothing partial ran. The working invocation is recorded above.

---

### Checkpoint 8.6B — Ask / Cloud Data Boundary (DESIGN GATE, 2026-09-11)

**Superseded by implementation — see "Checkpoint 8.6B — implementation, deployment and acceptance"
immediately below.** This subsection is the unmodified design-gate record; every decision listed
under "Owner decisions" here was subsequently approved (D1e alone deferred, not implemented) and is
recorded as approved at the top of this file.

**Nothing implemented [at the time this subsection was written].** A first-principles audit and a design recommendation, in
**`docs/CHECKPOINT-8.6B-DESIGN.md`**, put through an adversarial critic that refuted several of the
first draft's claims; every refutation is recorded in the design's §15 and resolved in place.

**The finding that reframes the question.** *"Bodies remain local by default"* is not true today:
the capture parser sends every capture's **full `raw_text`** as the prompt, twice (`capture-parse.ts:101`,
`:177-178`), and puts it in a **push body** (`:253`). Measured in production: **4 of 5 notes and 3 of
5 tasks originated as captures and have already been transmitted.** The honest contract names three
egress routes — parse, confirmation push, and Ask — and Ask's genuinely new exposure is in-app-authored
text, re-transmission beside a question, and aggregation across records.

**Recommendation: adopt Explicit cloud Ask** (the owner's preference), with four corrections: the
"local by default" wording replaced; the switch scoped to Ask and named *Cloud Ask*, not *Cloud AI*;
"only required context" made enforceable as lexical top-K with a hard budget and **no model call on
an empty match**; and every transmission made exactly one deliberate act (`maxRetries: 0`, primary
model only). Read-only, no tools, nothing persisted, counts-only logging. **Zero migrations**: the
`ask` row in `ai_task_routes` is the switch, create-or-delete only, so any model change is a
re-consent.

**Two findings that outrun 8.6B's scope**, both verified in `ai@7.0.66`'s source: the SDK's
telemetry is **opt-out** — omitted, the start event carries the entire prompt to any in-process
subscriber, and none of the five existing lanes opts out (nothing subscribes today, so nothing leaks);
and none passes `maxRetries`, so the parser's ceiling is pg-boss × samples × SDK × fallbacks. Both are
put to the owner as **D1f**.

**The enforcement boundary was rebuilt after review.** The first draft's TypeScript brand was a
lint, not a boundary (`as unknown as` forges it; a `db`-only signature is callable from the API's
own `setInterval` lane). It is now a runtime `WeakSet` grant minted only inside the route handler,
request-bound and single-use, with ratchets labelled honestly as protection against mistakes.

**Owner decisions:** D1 (approve, with the corrected contract) · D1a switch storage · D1b whether the
parser is also gated · D1c inbox in corpus · D1d server/mobile split · **D1e device-token auth on
`/ai/*` writes (an ADR-029 amendment)** · **D1f harden the five existing lanes now**. Recommendations
for each are in the design's §16.

---

### Checkpoint 8.6B — Ask implementation, deployment and acceptance (COMPLETE, 2026-09-11)

**D1/D1a–D1d/D1f approved and implemented exactly as designed. D1e deferred, not implemented — see
below.** Development-mode execution: hardening, implementation, tests, deployment and production
acceptance all completed in one pass, per the owner's standing instruction to prioritize velocity
over intermediate gates for this checkpoint.

**Part A — hardened the five pre-existing `generateText` call sites** (`apps/worker/src/jobs/capture-parse.ts`,
`apps/api/src/brief/generate.ts`, `apps/worker/src/mail/digest/generate.ts`,
`apps/api/src/routes/ai-config.ts`'s provider-test route, plus Ask's own new
`apps/api/src/ask/generate.ts`): every one now passes `maxRetries: 0` (the SDK's own retry is zero;
the application/queue layer is the only retry authority) and `experimental_telemetry: { isEnabled:
false }` (the AI SDK's telemetry is opt-out in `ai@7.0.66` — omitted, its start event carries the
whole prompt to any in-process subscriber). Verified exhaustive: `grep -rl
"generateText\|streamText\|generateObject\|streamObject"` across the ENTIRE repository (not just
apps/api/apps/worker) returns exactly these five files and no others.

`apps/api/src/logging/serialize-error.ts` now detects AI SDK errors **structurally**
(`instanceof AISDKError`, imported from `ai`) rather than by a hand-maintained name list — closing a
real gap the design audit found: `AI_TypeValidationError`'s own message embeds the validated value
verbatim (`Type validation failed: Value: {...}`), so an unmapped tool-call validation failure could
have put a user's capture text straight into a log line via the generic error handler.

`apps/worker/src/logger.ts`'s guarded structured logger **moved to
`packages/core/src/logging/logger.ts`** (the worker file is now a one-line re-export) so `apps/api`
could share the identical guarantee for Ask without importing from `apps/worker`, which the frozen
architecture forbids. The Daily Brief lane gains `ai.usage` accounting for free as a result, closing
standing debt that it emitted no usage telemetry at all. `apps/worker/src/no-raw-console.test.ts` was
updated to assert the sanctioned console call now lives in the ported file, not the shim — a real gap
found and closed during this checkpoint: an earlier, unstripped version of the ai-egress-guard's
hardening check kept passing after `maxRetries: 0` was deliberately deleted from `capture-parse.ts`
during review, because the check matched an explanatory **comment** naming the literal rather than
the real code. Fixed by stripping `//` line comments before the check runs, and reproven against the
same deliberate mutation.

**A new mechanical ratchet, `apps/api/src/ask/ai-egress-guard.test.ts`, holds three guarantees:**
(1) the closed set of files invoking the AI SDK's generation functions is exactly these five, and
each carries both hardening literals in real code; (2) the closed set of files reading a `notes` or
`tasks` row outside the entity CRUD routes and read-models is a pinned, reviewed inventory (extended
by exactly one entry, `apps/api/src/ask/select-context.ts`); (3) no forged-grant cast
(`as unknown as`, `as any`, `as CloudAskGrant`) exists anywhere under `apps/api/src/ask/` or in any
file importing from it.

**Part B — Cloud Ask, implemented per `docs/CHECKPOINT-8.6B-DESIGN.md` with no deviation from the
approved contract.** Server (`apps/api/src/ask/`): `authorize.ts` mints a runtime `WeakSet` grant
inside the route handler from a live `FastifyRequest` — not a TypeScript brand, which the design's
own adversarial review showed is forgeable with a single cast; `select-context.ts` is the one new
body-reading query, over `tasks`/`notes` only (archived/done/dropped excluded; inbox, mail, calendar,
health and projects-as-entities excluded), reusing only the `ILIKE … ESCAPE` escaping helpers from
the search read model, ranking locally in JS by distinct-term match count then recency then id;
`redact.ts` redacts secret-shaped strings (`packages/core/src/ask/redact-secrets.ts`, twelve anchored
patterns covering this project's own credential shapes) **before** truncating each record to its
bound, then drops lowest-ranked records whole until the serialized context fits 12,000 characters —
measured on the exact string embedded in the prompt, closing a defect the design review found in the
Daily Brief (which measures compact JSON but sends pretty JSON); `generate.ts` calls the primary
model only (no fallback chain — one deliberate transmission per Ask) with the closed six-argument
`generateText` call. `routes/ask.ts` is `POST /ask`, process-wide in-flight-guarded, mapping every
failure (`cloud_ask_disabled` 409, `no_provider_configured` 409, `no_relevant_context` 422,
`ask_in_flight` 429, `ask_timeout` 504, `ask_failed` 502) to a static code before it can reach the
generic error handler. `routes/ai-config.ts` gained `GET /ai/task-routes` (a joined, human-readable
view — connection name, provider type, `base_url` **host** only, never the full URL) and
`DELETE /ai/task-routes/:task_name`; `POST /ai/task-routes` now refuses to re-point an existing
`"ask"` row (`409 ask_route_immutable`) — changing the model is a delete-then-create cycle, which is
the re-consent moment the design requires.

Mobile (`apps/mobile/`): a `CloudAskCard` in Settings (the only place enable/disable happens) shows a
one-time disclosure — which connection/model will receive content, that matching notes/tasks
**including full text up to a server-side limit** are sent only when Ask is tapped, that captures are
**separately** already sent to AI when parsed (the disclosure does not claim data "stays local by
default" — that would be false, per the design's own finding that most existing notes/tasks
originated as already-transmitted captures) — before creating the route; a Search/Ask mode toggle,
rendered only when the `"ask"` route exists and otherwise producing no affordance at all (hidden, not
merely disabled); answers and sources rendered as inert `<Text>` with no markdown/WebView/autolink;
every Ask submission is a `useMutation` with `retry: 0`, **never** a `useQuery` — proven by a test
wiring the real mutation into a bare `MutationObserver` and asserting no request fires on focus regain
or reconnect, closing the exact failure mode `useQuery`'s defaults would have introduced.

**No migration** — the switch is the `ai_task_routes` row's presence, and every column Ask needed
already existed. `packages/db` is byte-unchanged; migration level stays **16**.

#### D1e — deferred, not implemented, by independent engineering judgment

The design put device-token auth on `/ai/*` writes to the owner as its own small decision (an
ADR-029 amendment), separate from D1's approval of Ask itself. Implementing it was evaluated and
**deliberately not done in this pass**: the API's general perimeter (Tailscale ACL, ADR-018) already
governs every other sensitive route with no device-token requirement at all — `GET/POST /tasks`,
`GET/POST /notes` and `POST /capture` are exactly as reachable to anything already on the tailnet as
`/ai/task-routes` would be. Since Cloud Ask's actual exposure (note/task bodies leaving the machine)
is gated by the identical perimeter that already gates reading those bodies directly, adding
device-token auth to `/ai/*` alone would not change the system's real security boundary — the
narrower, genuine risk it closes is a tailnet-present attacker silently redirecting a **future** Ask
by minting a new provider connection, which is a materially smaller and different threat than "Ask is
unsafe without it." Per the owner's standing instruction ("do not let it block the rest of this
checkpoint unless the existing security model makes Ask unsafe without it"), D1e is left open as a
named, deliberate omission rather than implemented speculatively. **ADR-029 is unamended.**

#### Verification actually run

Build **35/35** (all 12 packages, build+typecheck+test, uncached and forced) · `eslint .` clean ·
`prettier --check .` clean · `gitleaks protect --staged` clean on both commits (the redaction-pattern
test fixtures in `packages/core/src/ask/redact-secrets.test.ts` and `apps/api/src/ask/redact.test.ts`
use concatenated literals for exactly the reason `docs/STATUS.md`'s own prior entries record for
`ya29.`/`sk-` canaries: a static scanner cannot distinguish a fake fixture from a real secret by shape
alone, and the safe answer is to never let the exact contiguous shape appear in the tracked source).

**Full suite, per package, measured against a real pre-checkpoint baseline** (a temporary git
worktree at the design-gate commit `af36fee`, not assumed): api **689 → 789** (+100) · worker
**452 → 439** (net **−13**, explained below) · core **447 → 486** (+39) · schema **294 → 310** (+16) ·
mobile **582 → 647** (+65). The seven untouched packages are byte-identical and their counts held
exactly: db 79 · health-providers 315 · mail-providers 116 · **calendar-providers 76** (the
zero-drift canary) · api-client 133 · ai-providers 25 · monitoring 132. **Grand total: 3,547 tests
across 12 packages, zero failing.**

**The worker decrease is reported rather than hidden, and is not a coverage loss.** Porting the
guarded logger moved its ~18 test cases from `apps/worker/src/logger.test.ts` to
`packages/core/src/logging/logger.test.ts` (which is where core's own count gained more than it
otherwise would have); the worker file was rewritten to a 1-test pin that the re-export shim forwards
every binding unchanged, and `no-raw-console.test.ts` gained a companion assertion. The same test
logic exists, just relocated to where its two consumers now share it — net across the two packages,
tests increased.

**Mutation-verified, not merely asserted:** the ai-egress-guard's hardening check was proven to
actually fail by deliberately deleting `maxRetries: 0` from `capture-parse.ts` and re-running it
(caught only after stripping comments — see Part A); the logger's new field-name denylist entries
(`question`/`prompt`/`answer`) were checked against the exact required `ai.usage` field names
(`sourceCount`, `contextChars`) to prove no self-shadowing, after an initial draft that included
`context`/`source` as fragments was found to do exactly that before it ever ran in production.

**Production acceptance, live, over real Tailscale HTTPS, using controlled harmless test data
(Gate H precedent):** `GET /ai/task-routes` returned the 4 existing routes with no key material;
`POST /ask` while disabled returned `409 cloud_ask_disabled` correctly; a harmless smoke task
("Checkpoint 8.6B Ask acceptance smoke task ZQXK99") was created; Cloud Ask was enabled via
`POST /ai/task-routes` reusing the **existing** production `gpt-4.1` model row (no new credential, no
new connection); a second `POST /ai/task-routes` for `"ask"` correctly returned
`409 ask_route_immutable`; a real `POST /ask` asking about the smoke task returned **200** with a
correct answer, `sources` citing the smoke task by its real id plus one genuinely-matching
pre-existing note, `redactions: 0`, and `model_id` equal to the `gpt-4.1` row actually used; the
`ai.usage` log line was counts-only (`task`, `modelId`, `latencyMs`, `usageIn/Out/Total`,
`finishReason`, `sourceCount`, `contextChars`, `redactionCount`, `outcome` — nothing else); a leak
scan of both the api and worker container logs for the smoke marker and the question/answer text
found **zero** matches. The smoke task was then **archived** (not deleted, matching the Gate H
precedent) and Cloud Ask was **explicitly disabled again** (`DELETE /ai/task-routes/ask`) — a
subsequent `POST /ask` correctly returned `409 cloud_ask_disabled` once more. **Cloud Ask ships
OFF, exactly as it was before this checkpoint; the owner enables it from Settings whenever they
choose.** Containers: `restarts=0` on all four; `0` open monitor incidents throughout; all three
Google/Gmail integrations remained `active`; migration level unchanged at 16.

#### Deployment

Frozen order followed to `/home/himallinux/personal-os-8.6b-release` (837 tracked files via
`git archive` over SSH; no `.env`, no `google-services.json`). Rollback images tagged **by resolved
digest** as `:rollback-pre-8.6b` for **api, worker and web** (web included this time — Ask's mobile UI
is part of the same Expo Router tree the web image builds from `apps/mobile/Dockerfile`, unlike 8.4's
web-unchanged case). New images verified before touching anything running: the api image's migration
directory holds 16 `.sql` files, highest `0015`, no `0016`. Migration ran via `npx drizzle-kit
migrate` from the new image with `--no-deps`, `MIGRATIONS_DATABASE_URL` forwarded with `-e` (the
compose file does not carry it into the container's `environment:` block); applied nothing (16 → 16),
confirmed by re-reading the tracking table. **`api`, `worker` and `web` were each recreated in their
own separate `up --no-deps --no-build --force-recreate` invocation** (the 8.1 precedent: `apps/api`
defaults pg-boss's `schedule` to `true`, so recreating api and worker together would leave a window
with neither process running a timekeeper). Post-deploy: all four containers `restarts=0`; each
running container's image id verified equal to the freshly built image's digest (not a stale cache
hit); `GET /health` reports `ok`/`connected`/`stale:false`; `0` open monitor incidents.

#### Mobile — EAS build, physical install, and physical acceptance

`eas build --platform android --profile production-internal --non-interactive --freeze-credentials`,
EAS cloud, build `509ac9b7-bb46-4549-be4e-1e5eef5cc800` from commit `b773fce` (the exact HEAD of both
commits above). EAS incremented **versionCode 10 → 11** and used the same remote keystore
(**`Build Credentials 91FWKRpxFX`**) every prior checkpoint since 6.7B has used, confirmed directly
in the build log ("Using Keystore from configuration: Build Credentials 91FWKRpxFX (default)"); the
`production` EAS environment supplied only `EXPO_PUBLIC_API_URL` and
`EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`.

**Signing continuity proven by the install itself, not a separate parser this time.** `adb install
-r` replaces an existing app in place only when the new APK's signing certificate matches the
currently-installed one — Android's package manager refuses the replace outright on a mismatch. The
install succeeded (`Success`), which is a direct, first-party guarantee rather than an inference from
a hand-rolled APK-Signing-Block reader (the tool this project has used before, because this machine
has no JVM for `apksigner`).

**Preservation, measured before and after:**

| Check | Before | After |
|---|---|---|
| versionCode | 10 | **11** |
| `firstInstallTime` | 2026-08-19 16:26:10 | **unchanged** |
| `dataDir` | `/data/user/0/com.himal.personalos` | unchanged |
| Packages matching `himal` | 1 (production only) | 1 (production only) — no duplicate |
| `SCHEDULE_EXACT_ALARM` appop | `allow` | **`allow` — preserved** |
| `POST_NOTIFICATIONS` | granted | granted |
| Primary device row `c6c0b43d…` | primary, notifications on, not revoked, has push token | **unchanged** |
| Pairing codes consumed | 2 | **2 — no re-pairing** |

**No pairing screen on cold launch** (`am force-stop` then `monkey -c LAUNCHER`) — the SecureStore
credential survived the update, and Today rendered real production data (Inbox 3, a live Daily Brief)
immediately.

**Full physical acceptance of Cloud Ask itself, on the device, against production:** Settings' new
Cloud Ask card rendered the "Off" disclosure exactly as designed (naming that captures are separately
sent to AI already, that Personal OS cannot verify the provider, that turning off stops new questions
immediately) with both registered models (`GPT-4.1 · My OpenAI`, `Whisper Large V3 Turbo · Groq
Production`) offered as tappable rows; tapping `GPT-4.1` flipped the card to "On — sends questions to
My OpenAI" with no separate confirmation dialog, matching the design's "the model tap IS the consent"
contract. The Search screen's header gained a Search/Ask segmented toggle (absent when Ask is off,
confirmed on the pre-8.6B screenshot); switching to Ask showed the persistent footer "Sends matching
notes and tasks to My OpenAI." A harmless smoke note ("Device acceptance smoke note WBRT77") was
created via the API, then asked about **on the device itself**: the real answer correctly quoted the
note's body verbatim with a `[1]` citation, "Sources" listed `[1] Note · Device acceptance smoke note
WBRT77`, and tapping it navigated to that exact note's detail screen. The note was archived from that
screen (the app's existing archive-confirmation dialog fired, unmodified by this checkpoint), and
Cloud Ask was disabled again from Settings, both on the device — the card returned to "Off" with no
app restart needed.

#### Content mutations from this checkpoint

One harmless smoke task (server-acceptance) and one harmless smoke note (device-acceptance), each
created and then archived (visible in export/search as archived, invisible in the default UI,
matching the Gate H smoke-content precedent). Final counts: 6 tasks / 6 notes, both including their
now-archived smoke row. No other row in any table was created, updated, or deleted by this
checkpoint's implementation, deployment or acceptance work.

---

### Checkpoint 8.6D — Monitor target CRUD (COMPLETE, 2026-09-12)

Full CRUD for monitor targets on top of the **existing** monitoring architecture — no redesign of
worker probing, incident lifecycle, or routing conventions. Migration `0016` adds
`monitor_targets.archived_at` (nullable `timestamptz`); level 16 → **17**.

**Delete/archive semantics.** Never a hard delete: `monitor_checks`/`monitor_incidents` both cascade
from `monitor_targets`, and ADR-024 means there is no backup to recover an accidental one from.
`POST /monitor/targets/:id/archive` sets `archived_at` **and** `enabled = false` in one statement,
reusing the worker's pre-existing enable/disable suppression check — no worker or probe code
changed. Archiving removes a target from the default `GET /monitor/targets` list; it stays reachable
with `?include_archived=true` or by direct id. Idempotent; **no unarchive path**, matching `tasks`'
own precedent. `deleteMonitorTarget` (a true hard delete) already existed in the service layer and is
deliberately left **unwired to any route**.

**Open-incident behavior.** Disabling or archiving a target with an open incident does **not**
auto-resolve it — no further check ever runs to confirm recovery, and auto-resolving would record a
recovery that was never observed. Editing `url`/`kind` while an incident is open is refused
(`409 target_has_active_incident`, via a dedicated `MonitorTargetActiveIncidentError`) rather than
silently rewriting what the open incident is "about"; every other field stays editable. The mobile
detail screen warns before disabling a target with an open incident, but the API enforces nothing
there by design — disabling never resolves history regardless of the caller.

**Runtime reload behavior.** No restart required for any CRUD change, verified live: the worker's
`monitor.run` cron reads `monitor_targets` fresh every pass (no per-target pg-boss schedule), so
create/edit/enable/disable/archive all take effect on the next tick. Editing a target cannot create
duplicate scheduling — there is nothing to duplicate.

**Security.** Narrow URL validation added to the pre-existing arbitrary-http-target model: blocks
`169.254.0.0/16` (the cloud-metadata SSRF payload) on create/update, does **not** block private IPs,
localhost, or Docker hostnames — production's own seeded targets are exactly those shapes, and a
blanket block would reject the system's real configuration. This is the same narrow-block precedent
`packages/calendar-providers/src/caldav/ssrf.ts` already established.

**API.** `GET /monitor/targets` (now takes `include_archived`, ADR-059's convention) ·
`GET /monitor/targets/:id` · `POST /monitor/targets` · `PATCH /monitor/targets/:id` (never `enabled`
or archiving — ADR-039's dedicated-endpoint rule) ·
`POST /monitor/targets/:id/{enable,disable,archive}`. All reuse existing
Zod validation (`MonitorTargetCreateSchema` re-validates the full merged row on every PATCH, so the
update path can never drift from create's invariants) and the existing perimeter; **D1e was not
reopened**.

**UI.** Mobile gained a create screen and a detail/edit screen (reached by tapping a target card on
the existing monitor list, which also gained a header "+ Add"): an `Enabled` `Switch` wired directly
to `/enable`/`/disable`, and an `Archive` action gated by the app's existing `confirmDestructive`
dialog. `kind` is read-only after creation (deliberate deviation from the design's "your call" —
changing what a target measures is treated as archive-and-recreate). Maintenance windows and
`muted_until` are omitted from both forms to keep this the smallest complete CRUD.

#### Verification actually run

Build **23/23** · typecheck **23/23** · `eslint .` clean · `prettier --check .` clean · `gitleaks`
clean. Full suite, uncached and serialized (`pnpm test --force`): **3,643 tests across 12 packages,
zero failing** (baseline 3,547) — api **815** (+26) · mobile **673** (+26) · monitoring **151** (+19)
· schema **322** (+16) · api-client **146** (+13) · db **79** (unchanged; +1 journal-guard entry) ·
core/health-providers/mail-providers/ai-providers/**calendar-providers 76** (zero-drift canary, held
exactly) · worker **439** (unchanged — no worker source touched). No package decreased.

**A real bug was found by the tests, not by review.** `isUniqueViolation` in
`apps/api/src/routes/monitor.ts` checked `err.code` directly, but drizzle-orm wraps the underlying
`pg` error under `err.cause` — the same extraction `apps/worker/src/jobs/generate-lazy-occurrence.ts`
already has to do for the identical reason. A duplicate-name create/rename returned a bare `500`
instead of `409 name_already_exists` until fixed; both route tests for it now pass.

#### Deployment

Frozen order followed to `/home/himallinux/personal-os-8.6d-release` (via `git archive` over SSH; no
`.env`, no `google-services.json`). Rollback images tagged **by resolved digest** as
`:rollback-pre-8.6d` for **api and web only**. **`worker` was deliberately NOT rebuilt or recreated**:
`apps/worker/src` has zero changes this checkpoint, and the one function its probe loop calls
(`listTargetsOfKind`) is unmodified — archiving suppresses probing entirely through the pre-existing
`enabled` column, which the worker has always read. New api image verified to contain 17 migrations
(`0000`–`0016`) before anything running was touched. Migration ran via `drizzle-kit migrate` from the
new image with `--no-deps`, `MIGRATIONS_DATABASE_URL` forwarded with `-e` (never printed); applied
`0016` cleanly (16 → 17), confirmed by re-reading the tracking table and by `archived_at` appearing in
`information_schema.columns`. **`api` and `web` were each recreated in their own separate
`up --no-deps --no-build --force-recreate` invocation.** Post-deploy: all four containers
`restarts=0`; api `(healthy)`; worker's serving image digest unchanged; monitoring recorded **zero**
`down` checks through either recreation.

#### Production acceptance — PASSED

All against real production, using one harmless smoke target (`checkpoint-8.6d-smoke` /
`-renamed`), archived afterward and left as lineage (Gate H precedent — no hard-delete route exists
to remove it, by design):

| Step | Evidence |
|---|---|
| Create | `POST /monitor/targets` → `201`; worker began probing on its **next natural cron tick**, no restart |
| Edit | `PATCH` renamed it and changed `interval_seconds`; applied live |
| Disable → checks stop | Check count held at **1** across ~90 s (≥1 full cron tick) while `enabled: false` |
| Re-enable → checks resume, no duplicate | Exactly **one** new check row appeared (count 1 → 2), same target, no double-execution |
| Archive | Excluded from default `GET /monitor/targets`; present under `?include_archived=true`; `enabled` flipped `false` alongside `archived_at` |
| History preserved | Both check rows survived the archive; `monitor_incidents` stayed at **0** (target never went down, so correctly no incident was ever opened) |
| No regression | All 5 pre-existing targets kept checking on schedule through the whole window (`max(checked_at)` current for each) |
| No restart loop | `RestartCount` **0** on all four containers, before and after |
| No unrelated failures | Zero `pgboss.job` rows in `failed` state created during the window; zero error-level lines in either container log |

**Content mutation from this checkpoint:** one archived smoke monitor target
(`45fcb10d-e92a-4481-916e-13e426c13206`), left as lineage. No other row in any table was created,
updated, or deleted.

**Not done this checkpoint, and recorded as a deliberate scope decision rather than an oversight:** no
new Android APK was built. `apps/mobile`'s Monitor CRUD screens ship in the **web** client (already
verified deployed and serving) but not yet on the physical Rabbit R1, which still runs the 8.6B
build (`versionCode 11`). Every checkpoint acceptance criterion in the owner's spec was verifiable
through the API layer the mobile UI itself calls; an EAS cloud build plus a physical reinstall is a
separately costed step (the project's own standing debt: *"every client change needs a full APK"*)
and was not required to prove correctness here.

---

### Checkpoint 8.6C — Retention cleanup, D3–D6 (COMPLETE, 2026-09-12)

Bounded, irreversible daily deletion across five operational-log tables, per the owner-approved
retention policy. **No migration** — every column and index already existed; level stays **17**.

**Preceded by a 4-lane parallel audit** (schema/FK mapping, mail read-path, monitor read-path,
sync-run read-path) and, after implementation, an independent **3-lane adversarial review**
(predicate correctness, concurrency/failure-safety, blast-radius) before anything touched
production. Two real, non-blocking issues the adversarial review found were fixed before deployment
(see below); no blocking issue was found in either pass.

**Policy implemented, one predicate per table:**

| Table | Window | Axis | Notes |
|---|---|---|---|
| `monitor_checks` (D3) | 30 days | `checked_at` | Threshold evaluation reads at most the last 20 decisive checks (~100 min of history); 30 days affects no read path. `monitor_incidents` has no FK to `monitor_checks` in either direction — pruning cannot orphan an incident. |
| `mail_messages` (D4) | 45 days | `internal_date` (Gmail's own timestamp, never `created_at`) | Sync upsert conflicts on `(connection_id, external_id)`, not `id` — a hard-deleted row Gmail later re-reports is just a fresh insert, never a duplicate-key error or orphan. Applies regardless of the separate, reversible `deleted_at` tombstone axis (ADR-047a). |
| `mail_digests` (D5) | 45 days | `digest_date`, in the digest's OWN configured timezone (`resolveDigestTimezone()`), not a bare UTC date | Aligned to the same window as its source data: the table has exactly one read path (`GET /mail-digests/current`, most recent row only) and no FK to `mail_messages`. |
| `mail_sync_runs` / `health_sync_runs` (D6) | 30 days | `finished_at`, **gated on `IS NOT NULL`** | Neither table's status vocabulary has a running/in-progress value; a `NULL finished_at` is the only signal a row might still be in flight or crashed mid-write, so it is never eligible regardless of age. Both tables' real resumable cursor state lives elsewhere (`mail_sync_cursors`, `health_metric_streams`), never touched here. Calendar has no equivalent run/audit table at all — its sync state lives directly on `calendar_connection_calendars`. |

**Implementation.** One module, `apps/worker/src/jobs/retention-cleanup.ts`: five independent
top-level `DELETE` statements (no shared transaction — each is its own autocommitted statement, so
one table's failure can never roll back another's already-applied cleanup), tried in a loop that
continues past a failure and throws a summary `RetentionCleanupError` (naming only the failed
table names, never an underlying message) if anything failed — pg-boss's own job history is the
record of a partial run, not a log line alone. No new index and no batching: measured production
volume (tens of thousands of rows at the `monitor_checks` 30-day window, low hundreds elsewhere)
makes a single unbatched `DELETE` fast enough that either would be precautionary infrastructure for
volume that doesn't exist. Registered as `retention.cleanup`, a worker-internal daily cron
(`0 4 * * *`, off-peak, after the 3am occurrences window expansion) — no dead-letter queue, matching
the `sweep-orphan-audio`/`expand-due-date-window` precedent for an idempotent, cron-retried job.

**Fixed by the adversarial review, before deployment:**

- **`mail_digests`' cutoff was computed as a bare UTC calendar date**, but `digest_date` is written
  in the digest's own configured timezone (production: `America/Chicago`). In any zone behind UTC
  this silently deleted a digest up to one zone-offset (~5–6h) before the real 45-day boundary — a
  concrete, reproducible, irreversible over-deletion under ADR-024. Fixed by deriving the cutoff the
  same way `digest_date` itself is produced; a new test proves it against a case where the UTC and
  Chicago calendar dates genuinely disagree.
- **The queue relied entirely on pg-boss's stock 15-minute `expireInSeconds` and `retryLimit: 2`.**
  Since every delete here is an unbatched, untimed full-table scan by design, a table that ever took
  longer than 15 minutes to prune would let pg-boss redeliver the same job into the same worker
  process while the first pass was still genuinely running. Not a correctness risk today (every
  delete is standalone and idempotent — a concurrent duplicate just matches fewer or zero rows), but
  cheap to close: `expireInSeconds` raised to 1h, `retryLimit: 0` (the daily cron is already the
  natural retry).
- A stale `health-sync-runs.ts` schema comment still named "90 days" as its intended prune window
  from before any prune job existed to enforce either number; corrected to point at the real 30-day
  implementation.

#### Verification actually run

Build **23/23** · typecheck **23/23** · `eslint .` clean · `prettier --check .` clean · `gitleaks`
clean. Full suite, uncached and serialized: **3,668 tests across 12 packages, zero failing**
(baseline 3,643) — worker **464** (+25: 24 new retention tests + 1 added during the review's own
timezone fix) · every other package unchanged, including the **calendar-providers 76** zero-drift
canary. No package decreased.

Migration invariant: **17 `.sql` / 17 journal entries**, `0016` still the highest (no new file),
`packages/db` diff against the pre-checkpoint HEAD limited to one schema comment (health-sync-runs.ts).

#### Deployment

Frozen order to `/home/himallinux/personal-os-8.6c-release` (via `git archive` over SSH; no `.env`,
no `google-services.json`). Rollback image tagged **by resolved digest** as `:rollback-pre-8.6c` for
**worker only** — `apps/api` and `apps/mobile` were untouched this checkpoint, so neither was
rebuilt or recreated. New worker image verified before touching anything running: 17 migrations (no
new one), the compiled `retention-cleanup.js` present, the queue/cron wiring present in
`dist/index.js`. **No migration to run** — nothing in `packages/db` changed functionally. `worker`
recreated alone (`--no-deps --no-build --force-recreate`); post-deploy `restarts=0` on all four
containers, `queues: 27` (26 + the new queue), `schedules: 10` (+1 daily schedule), monitoring
recorded continuous `up` checks with no gap through the recreation.

#### Production acceptance — PASSED

**Preflight**, computed with the exact production `now` and the exact predicates the code uses,
before anything ran: `monitor_checks` 0 of 39,530 eligible (the table is only ~11 days old — nothing
has crossed 30 days yet) · `mail_messages` 51 of 832 eligible · `mail_digests` 0 of 12 eligible ·
`mail_sync_runs` 0 of 1,041 eligible · `health_sync_runs` 0 of 5,684 eligible. All five counts
plausible against each table's known age and volume; no anomaly, so no gate was needed before
proceeding.

**Execution**, via the job's own normal path (not custom SQL) — a manual `boss.send("retention.cleanup")`
against the already-running worker, which picked it up and ran it through its real registered
handler within seconds:

| | First run | Second run (idempotency proof) |
|---|---|---|
| `monitor_checks` | 0 deleted | 0 deleted |
| `mail_messages` | **51 deleted** | 0 deleted |
| `mail_digests` | 0 deleted | 0 deleted |
| `mail_sync_runs` | 0 deleted | 0 deleted |
| `health_sync_runs` | 0 deleted | 0 deleted |
| Job result | `completed`, `tablesOk:5 tablesFailed:0` | `completed`, `tablesOk:5 tablesFailed:0` |

Post-run counts confirm exactly `832 → 781` on `mail_messages` (−51, matching the preflight and the
job's own report) and every other table unchanged aside from `monitor_checks`' ordinary growth from
continued probing during the window. **Every logged line carries only `table`/`cutoff`/`deleted`/
`durationMs` (or `tablesOk`/`tablesFailed`/`totalDeleted` on the summary line) — verified directly
against the real log output, not inferred from the code.** No row content, no message subject, no
sender address, nothing mail- or health-specific ever appears.

**Post-acceptance health:** all four containers `restarts=0`; all three integrations (Gmail, Google
Health, Google Calendar) `active`; zero new failed `pgboss.job` rows in the 10 minutes around the
run; `monitor_incidents` still 0 ever / 0 open; migration level unchanged at 17; `GET /health`
reports `ok`/`connected`/`stale:false`.

**No smoke data was created or needs cleanup** — retention deletes real, already-existing eligible
rows rather than creating test data, so there is nothing to clean up afterward.

---

