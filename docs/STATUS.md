# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 8 — Consolidation & adoption (ADR-056, approved 2026-09-02).** Checkpoint **8.0 — Foundation / Discovery Gate closure** is **COMPLETE**.
**Phase 7 is CLOSED** — Checkpoint 7.9 completed 2026-09-02; its record is in `docs/history/phase-7.md`.
**Checkpoint 8.1 — Failure visibility + AI input/output hardening — is COMPLETE and DEPLOYED.**
**Checkpoint 8.2 — Enable the real Google Calendar — is COMPLETE (2026-09-03). No code, no migration.**
**Checkpoint 8.3 — Find what you stored (search + export) — is COMPLETE (2026-09-03).**
**Checkpoint 8.4 — Low-friction capture — is COMPLETE (2026-09-03).** Its mandatory Lane 0
reliability gate (the `capture.parse` confirm failure) passed; Lane 3 is deferred on evidence.
API, web and the Rabbit R1 APK (**versionCode 10**) are all deployed and physically accepted.
**Checkpoint 8.5 — TERMINATED BY OWNER 2026-09-04 — adoption soak DEFERRED.** It ran **9.1 hours of
a 21-day minimum (1.8%)**; no milestone was reached. The owner chose continued development over a
3–4 week freeze — an intentional product decision, **not a failed checkpoint and not a technical
failure**. **The feature freeze is LIFTED.** **No adoption conclusion — capture-first,
integration-first or mixed — may be drawn from it, and the phrase "the soak showed" is
prohibited.** Its baseline survives as dated historical measurement. Record: **`docs/SOAK-8.5.md`**.
**Checkpoint 8.6 — Intelligence & Operations Decision Gate — DECISION REPORT COMPLETE**
(`docs/CHECKPOINT-8.6-DECISION.md`). Owner approved the breakdown **8.6A / 8.6B / 8.6C / 8.6D**.
**8.6A — reliability & data-integrity hardening — is COMPLETE and DEPLOYED (2026-09-11); acceptance PASSED.**
8.6B (read-only Ask) is **gated on one owner decision**; 8.6C on retention windows; 8.6D on evidence.
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
| Serving commit | api **`41f00cd`** · worker **`41f00cd`** (Checkpoint 8.6A, 2026-09-11) · web **`7b7acca`** (8.4; deliberately not rebuilt — runtime unchanged) |
| Rabbit R1 | `com.himal.personalos` **versionCode 10**, built from `6788b8d`, installed in place 2026-09-03 |
| Capture front doors | Quick Capture · PTT · Siri/Assistant · **Android share sheet (8.4)** · **launcher shortcut (8.4)**. Notification-shade capture **deferred** — see 8.4 Lane 3. |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active** |
| Calendar sync | **2 of 5 calendars enabled** — the owner's real primary (enabled at 8.2) and the dedicated test calendar. **98 events** ingested, all from the primary. |
| Monitoring | 5 targets seeded, including both Tailscale Serve routes |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Source durability | **`origin` = `https://github.com/Himalpok1/Personal-OS` — PRIVATE, established 2026-09-02.** `main` + `phase-8-consolidation` pushed and hash-verified. No CI, no Actions workflow, no repository secret. |
| Test baseline | **3,340 tests / 21 turbo tasks** (8.6A; see *Last verification*) |
| `capture.parse` DLQ | **`capture.parse.dead`, live in production** — attached to the pre-existing queue via `updateQueue`, consumer bound (8.6A) |
| Search / export | `GET /search` and `GET /export` live, perimeter-only, no migration (ADR-059) |
| Confirm contract | An uncommittable confirm is refused **409** before enqueueing; corrections are validated and stored in the shape the worker reads (8.4) |

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

- **The API logs the search query string (8.3).** Fastify's request logger records `req.url`, so
  `/search?q=<term>` puts the owner's own search text in the container log. It is first-party text
  on a single-user system, not third-party content — the 1,798-needle scan found no stored content
  in the logs — but it is user content in a log and is recorded rather than glossed. Closing it
  would mean a route-specific log redaction the API has no mechanism for today.
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

- **Notification-shade text capture is not shipped (8.4 Lane 3, deferred on evidence).** Android
  direct reply IS natively implemented in the installed `expo-notifications@57.0.12`, but with the
  process dead the reply is parked in a static in-process collection and lost if the process dies
  before JS boots. The durable path needs `expo-task-manager`, which is **absent** from the
  dependency set. Revisiting it means accepting a background-task framework, a new notification
  channel, and a fix to the identifier-based dedupe in `use-notification-lifecycle.ts` that would
  otherwise swallow every reply after the first.
- **`capture.parse` still has no dead-letter queue (8.4).** It remains the only retrying queue
  without one — `ptt.transcribe`, `notifications.dispatch` and all three calendar queues have one,
  and `ptt.transcribe`'s handler finalizes the inbox row. 8.4 made failures *visible* (classified
  `capture.parse.failed` with a stage) and made the known permanent case unreachable, but a future
  permanent failure from another cause still exhausts five retries into a job nobody reads. Adding
  one is a queue-config change and wants its own decision.
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

## Current objective

**Checkpoint 8.6A is deployed and accepted.** Production runs `41f00cd` on api and worker with the
`capture.parse` dead-letter queue live and consumed. Nothing further is in progress. The next
checkpoint — 8.6B, 8.6C or 8.6D — begins only on explicit approval, and 8.6B is gated on **D1**.

---

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

**None in progress.** 8.6A deployed 2026-09-11 (api + worker recreated separately; web untouched).
**Production writes made by this deployment, all deliberate:** one smoke capture and its note
(archived), the `UPDATE` on `e2b9a5f7`, and pg-boss's own `updateQueue` on `capture.parse`.

---

## Last verification

**Phase 8 Checkpoint 8.4 (2026-09-03).** Branch `phase-8-consolidation`, from `1d50f92`.

Baseline **re-measured first-hand, not assumed**: `turbo run test --force --concurrency=1`
reproduced **3,226 tests / 21 tasks, 0 of 21 cached** exactly, matching the recorded 8.3 figure
per-package. After the checkpoint, the same uncached serial run gives **3,322 tests across 21 turbo
tasks, zero failing** — api **686** (+13) · mobile **582** (+53) · worker **439** (+8) · core
**447** (+8) · health-providers 315 · schema **294** (+14) · monitoring 132 · api-client 133 ·
mail-providers 116 · db 79 · **calendar-providers 74** (zero-drift canary, held exactly) ·
ai-providers 25. **No package decreased.**

Build **23/23**, typecheck **23/23**, `eslint .` clean, `prettier --check .` clean,
`git diff --check` clean, gitleaks clean on every commit.

**Mutation tests — 21 of 21 killed and restored**, covering every load-bearing guard added:
the committability guard, the correction storage shape, the unreadable-parse guard, the worker's
permanent-vs-retryable split, the confirm idempotency guard, failure classification, the client's
refusal surface, `isCommittableToolCall`, `readStoredParseResult`, the `corrected_tool_call` type,
share-intent dedupe, control-strip-before-truncate ordering, the length bound, the Kotlin/TS action
pairing, the warm-path intent source, the sticky-intent neutering, picker date/time combination,
offset serialization, the Today notice's silence when healthy, `remind_at` on create, and the
Compose `<Host>` rule — that last one verified against the exact defect that reached the device.

**A process mistake worth recording**: the mutation harness restores each mutated file with
`git checkout --`, which silently reverted an **uncommitted** fix to a file it had just mutated. It
was caught on the next `git status`, reapplied and committed before the rebuild. The rule is to
commit before mutating the same file.

**Two failures were found by the suite rather than by review**, and both were real:
`worker#build` rejected an index-signature property access that `typecheck` had allowed (different
tsconfig scopes), and `packages/schema`'s `tasks.test.ts` correctly failed on a test that
*deliberately pinned* the old "creation rejects `remind_at`" contract. The second was updated rather
than deleted, and the replacement says what it reversed and why.

A third real gap surfaced while writing tests: the worker's `truncateTestTables` **never deleted
`notes`**, so every note `commitParsedEntity` created in a worker test had been accumulating in the
shared `personalos_test` database. Closed.

Migration invariant: **16 `.sql` / 16 journal entries**, `0016` absent, `packages/db` byte-unchanged,
production tracking table **16** before and after both deployments.

## Next action

**Stop. Nothing proceeds without approval.** 8.6A is deployed and accepted; the next checkpoint is
yours to choose.

**Owner decisions, in the order they block work:**

1. **D1 — may note and task BODIES leave the machine to a cloud model?** This is the whole of 8.6B:
   `BriefInput` has never carried a body, ADR-056 names "whole note bodies" first among things
   needing an explicit decision, and an Ask lane over titles alone is nearly useless because
   `/search` already covers titles.
2. **D3–D6 — retention windows** (`monitor_checks`, `mail_messages` and its axis, the two sync-run
   tables, and whether terminal `capture.parse` failures may keep self-deleting after 7 days).
   Irreversible under ADR-024; 8.6C cannot start without them.
3. **D7 — is monitor target CRUD exposed over HTTP at all?** `url` is `z.string().url()` with no
   scheme or host allowlist. A `PATCH` excluding `url` and `kind` gets most of the value with none of
   the SSRF surface.

**Recommended before 8.6B, newly evidenced rather than inherited, and still not absorbed:**
`occurrences.generate-lazy` has the same missing-DLQ defect with a worse outcome — a completed
recurring task silently never spawns its successor — and **no containment wrapper and no structured
logging at all**. All three recovery paths were verified closed. Now that the `capture.parse` pattern
is proven in production, it is a direct template.

**Also newly found, not fixed:** there is no `setNotFoundHandler`, so Fastify's `basic404` logs the
raw URL outside the scrubbing serializer — a mistyped OAuth callback carrying a live `?code=` would be
logged unscrubbed and echoed in the response body.

Deliberately **not** started: 8.6B, 8.6C, 8.6D, migration `0016`, any mobile build, any new
notification producer, any embeddings or retrieval work, and Phase 9.

The 8.2/8.3 findings remain open and unchanged: the calendar `summary` display-name bug, Today
multi-day timed bucketing, `done` occurrence presentation, events/projects search, export UI, and
calendar write-side bounds.
