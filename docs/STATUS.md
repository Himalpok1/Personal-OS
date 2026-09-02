# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 8 — Consolidation & adoption (ADR-056, approved 2026-09-02).** Checkpoint **8.0 — Foundation / Discovery Gate closure** is **COMPLETE**.
**Phase 7 is CLOSED** — Checkpoint 7.9 completed 2026-09-02; its record is in `docs/history/phase-7.md`.
**Checkpoint 8.1 — Failure visibility + AI input/output hardening — is COMPLETE and DEPLOYED.**
**Next checkpoint allowed:** **8.2**, on explicit approval only. It has not begun.
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
| `docs/history/phase-7.md` | Phase 7 | Gmail integration, mail digest, service monitoring — **7.0 through 7.9; Phase 7 is closed** |
| `docs/history/superseded-present-state.md` | — | Prior revisions of this file's present-state sections, archived verbatim by 8.0 |

## Production state at a glance

| | |
|---|---|
| Migration level | **16** (`0000`–`0015`); local and production agree |
| Serving commit | api/worker **`dc3983d`** (Checkpoint 8.1) · web `a5bbc48` |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active** |
| Monitoring | 5 targets seeded, including both Tailscale Serve routes |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Source durability | **`origin` = `https://github.com/Himalpok1/Personal-OS` — PRIVATE, established 2026-09-02.** `main` + `phase-8-consolidation` pushed and hash-verified. No CI, no Actions workflow, no repository secret. |
| Test baseline | **3,075 tests / 21 turbo tasks** (see *Last verification*) |

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
- ~~**Revoking a device does not clear its `is_primary_reminder_device` flag**~~ — **CLOSED by Checkpoint 8.1.** Revoke now clears the flag without auto-promoting (ADR-019/036 stand), which also unblocks the partial unique index that previously prevented promoting a real device.
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
- **The tailnet suffix is embedded in immutable commit metadata.** 117 of 249 commits carry an
  author email at the tailnet domain. Now that a remote exists this is replicated off-machine.
  Harmless in a private repository and **not** fixable without rewriting every SHA including
  `a5bbc48`, which production is pinned to. To stop it growing, set `git config user.email` to a
  public address. **This is the concrete reason the repository must never be made public without a
  separate deliberate decision.**

- **Alerts share the `reminders` notification channel (8.1).** It is the only Android channel the app
  creates, so a channelId Android does not know would be silently ignored. The consequence is real:
  muting Reminders also mutes integration alerts. A dedicated `alerts` channel needs a mobile change,
  therefore an APK and a `versionCode` bump.
- **The Brief lane emits no `ai.usage` event (8.1).** `apps/api` has no guarded structured logger —
  only Fastify's pino — and the worker's `LogFields`/denylist protection has no counterpart there.
  Instrumenting it through an unguarded path was refused; adding a guarded logger to `apps/api` is
  the real fix and was out of scope.
- ~~**Two obsolete burned `notification_dispatch_log` rows remain (8.1).**~~ — **CLOSED
  2026-09-02, owner-approved.** Deleted by exact full-key equality under a `ROW_COUNT` guard;
  9 → 7 rows with the survivor checksum byte-identical before and after.
- **The new occurrence-scoped keys have not been emitted in production (8.1).** Proving them live
  needs a genuine integration failure, and no safe deterministic trigger exists that does not break a
  real Google grant. The running containers are verified to carry the new code.


---

## Current objective

**Checkpoint 8.1 is COMPLETE and DEPLOYED.** Phase 7 is closed, source durability is established,
and the first Phase 8 runtime checkpoint has shipped: integration failure is now reportable
(occurrence-scoped alert dedupe on Calendar, Health and a new Gmail producer), and both live AI
lanes filter their output through one shared, structurally-hardened control.

The owner-gated cleanup of the two obsolete burned dispatch rows is **done** (2026-09-02): a
narrow, guarded DELETE of exactly 2 rows, with the 7 survivors proven byte-identical.

**No outstanding actions for 8.1. Checkpoint 8.2 has not begun and must not begin without explicit
approval.**

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
| **7** | Gmail `gmail.metadata` integration, incremental sync with cursor recovery, AI mail digest, service-monitoring platform with incident lifecycle. **Deployed 2026-09-01; CLOSED 2026-09-02.** |

**Production is at migration level 16** and serves images built from `a5bbc48`. All three Google
integrations are active. Monitoring runs against five seeded targets including both Tailscale Serve
routes.

## Current work

**None in progress.** Two closure tasks completed on 2026-09-02, both outside Checkpoint 8.1:

1. **Checkpoint 7.9 closed**, discharging the gate on Phase 8 runtime work. The scheduled
   mail-digest cron was proven to have fired by a structural discriminator rather than by timing,
   and same-key upsert was proven at the storage layer. Full record in `docs/history/phase-7.md`.
2. **Source durability established** — see *Source durability* above.

The only application-tree change in either task is `.gitignore` (`907cae3`). No runtime code, no
migration, no queue change, no deployment, no mobile build, no production configuration change and
no OAuth grant change was made. Exactly one production write occurred: the explicitly-authorized
same-date digest regeneration that proved the upsert.

## Last verification

**Phase 8 Checkpoint 8.0 (2026-09-02).** Branch `phase-8-consolidation`, cut from
`phase-7-mail-monitoring` at `533601c`. The application tree is byte-unchanged by this checkpoint,
so this measurement is a *reproduction* baseline, not a new one.

**Superseded by Checkpoint 8.1 (2026-09-02).** Measured first-hand, uncached and serial
(`turbo run test --force --concurrency=1`, **0 of 21 cached**): **3,075 tests across 21 turbo
tasks**, zero failing — up from 3,009, with **no package decreasing**. Per package — api **625**
(+16) · mobile 499 · worker **427** (+18) · core **407** (+32) · health-providers 315 · schema 255 ·
monitoring 132 · api-client 121 · mail-providers 116 · db 79 · **calendar-providers 74** (zero-drift
canary, held exactly) · ai-providers 25. Build **11/11**, typecheck **21/21**, `eslint .` clean,
`prettier --check .` clean, `git diff --check` clean, gitleaks clean.

**Mutation tests — 8 of 8 killed and restored**, covering every new load-bearing guard: the shared
filter's bare-domain layers (from the core suite AND, after a rebuild, from the mail lane's own
adversarial corpus — the first attempt SURVIVED because the worker consumes `packages/core/dist`,
which is a finding about the harness, not the guard); the Brief output filter; the Calendar, Health
and Gmail occurrence discriminators; and both mechanical guards.

> **This corrects a stale record.** The previous *Last verification* section reported Checkpoint
> 7.7's **3,001** tests, but Checkpoint 7.8A had already moved the baseline to **3,009** without
> that section being updated. The 7.7 text is retained verbatim in `docs/history/phase-7.md`.

Migration invariant: **16 `.sql` / 16 journal entries**, no `0016`; `packages/db` byte-unchanged.

## Next action

**Stop at readiness.** Checkpoint 8.1 is unblocked but **must not begin without explicit
approval.**

Gates now discharged:

1. ~~Checkpoint 7.9 must be formally closed~~ — **CLOSED 2026-09-02.**
2. ~~Source durability requires owner action~~ — **ESTABLISHED 2026-09-02**, private GitHub remote.

Remaining owner-only work, none of it blocking 8.1:

1. **Configuration / key durability is still open and is the sharpest risk in the system.**
   `CREDENTIALS_ENCRYPTION_KEY` has no key version, no KDF and no rotation path, and exists on
   exactly two hosts; losing it makes every stored OAuth credential permanently undecryptable across
   four tables and five integrations. Intended direction: SOPS + age, with the age private key held
   off both the development machine and the production server, and the encrypted configuration
   backup stored independently. **Nothing secret goes in GitHub.** ADR-024 is unchanged — this is
   not approval for a database backup system.
2. **Retention windows remain an owner decision** (ADR-024 makes deletion irreversible) and are a
   prerequisite for the mail prune ADR-054 requires and ADR-057 records as unimplemented.
3. **Optional GitHub hardening:** Actions is default-on at the repository setting although no
   workflow exists anywhere in history; disabling it is a one-click defence-in-depth step.
4. **Local hygiene:** delete `apps/mobile/.expo/dev/logs/export.log`, which holds a plaintext
   `EXPO_TOKEN` at mode 644.

Deliberately **not** started: Checkpoint 8.1, any notification-producer change, the burned-dedupe
`DELETE`, any Brief prompt/output-filter change, enabling the real Google Calendar, search, mobile
capture changes, any Phase 8 runtime deployment, and migration `0016`.
