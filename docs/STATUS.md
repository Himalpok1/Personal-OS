# Project Status

**Project:** Personal OS — single-user, self-hosted life dashboard.
**Current phase:** **Phase 8 — Consolidation & adoption (ADR-056, approved 2026-09-02).** Checkpoint **8.0 — Foundation / Discovery Gate closure** is **COMPLETE**.
**Phase 7 is CLOSED** — Checkpoint 7.9 completed 2026-09-02; its record is in `docs/history/phase-7.md`.
**Checkpoint 8.1 — Failure visibility + AI input/output hardening — is COMPLETE and DEPLOYED.**
**Checkpoint 8.2 — Enable the real Google Calendar — is COMPLETE (2026-09-03). No code, no migration.**
**Checkpoint 8.3 — Find what you stored (search + export) — is COMPLETE (2026-09-03).**
API, web and the Rabbit R1 APK (**versionCode 8**) are all deployed and physically accepted.
**Next checkpoint allowed:** **8.4**, on explicit approval only. It has not begun.
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
| Serving commit | api **`b06b0ca`** · web **`b06b0ca`** (Checkpoint 8.3) · worker **`dc3983d`** (8.1 — deliberately not rebuilt; runtime unchanged) |
| Rabbit R1 | `com.himal.personalos` **versionCode 8**, built from `d030fc1`, installed in place 2026-09-03 |
| Integrations | Google Health **active** · Google Calendar **active** · Gmail **active** |
| Calendar sync | **2 of 5 calendars enabled** — the owner's real primary (enabled at 8.2) and the dedicated test calendar. **98 events** ingested, all from the primary. |
| Monitoring | 5 targets seeded, including both Tailscale Serve routes |
| AI task routes | `capture_parser`, `daily_brief`, `mail_digest`, `voice_transcribe` — all on the existing `gpt-4.1` row |
| Network | Tailscale-only; Postgres publishes no host port; no Funnel, no public ingress |
| Backups | **None, by design** (ADR-024) |
| Source durability | **`origin` = `https://github.com/Himalpok1/Personal-OS` — PRIVATE, established 2026-09-02.** `main` + `phase-8-consolidation` pushed and hash-verified. No CI, no Actions workflow, no repository secret. |
| Test baseline | **3,226 tests / 21 turbo tasks** (see *Last verification*) |
| Search / export | `GET /search` and `GET /export` live, perimeter-only, no migration (ADR-059) |

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
- **⚠️ Confirming a `needs_confirm` inbox item fails, silently (found at 8.3 closure; NOT caused by
  8.3).** At 2026-09-03 04:38 UTC the app sent `POST /inbox/851d3455…/confirm` and
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

## Current objective

**Checkpoint 8.3 is COMPLETE.** Search and export are live on the API, in the web bundle, and — as
of 2026-09-03 — on the Rabbit R1 itself at **versionCode 8**, installed in place with
`firstInstallTime`, pairing, PRIMARY status, push token and the exact-alarm appop all preserved.

Stored content is findable from the device the owner actually carries: one query returns matching
tasks, notes, inbox captures and mail metadata together, grouped by type, with each type capped
independently so hundreds of mail rows cannot evict a matching note.

**8.3 leaves one thing genuinely unproven and one thing newly found.** The search error state was
never exercised on-device, because reproducing it means disrupting the daily driver. And the closure
surfaced a defect that is *not* 8.3's: confirming a `needs_confirm` inbox item enqueues a
`capture.parse` that fails, leaving the item unconfirmed with no error shown. Both are in the ledger.

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

**None in progress.** Checkpoint 8.3 closed 2026-09-03. Seven commits across the checkpoint:
contracts, API, mobile, the inert-rendering guard, a mutation-driven test fix, and two documentation
corrections. Two production deployments (api + web; worker deliberately untouched) and one in-place
APK install. **No production data was written by this work** — every live check was a `GET`, and the
only writes on the system were the owner's own app activity.

## Last verification

**Phase 8 Checkpoint 8.3 (2026-09-03).** Branch `phase-8-consolidation`, from `26cf910`.

Baseline **re-measured first-hand rather than assumed**: `turbo run test --force --concurrency=1`
reproduced **3,075 tests / 21 tasks, 0 of 21 cached** exactly, matching the recorded 8.1 figure
per-package. After the checkpoint, the same uncached serial run gives **3,226 tests across 21 turbo
tasks, zero failing** — api **673** · mobile **529** · worker **431** · core **439** ·
health-providers 315 · schema **280** · monitoring 132 · api-client **133** · mail-providers 116 ·
db 79 · **calendar-providers 74** (zero-drift canary, held exactly) · ai-providers 25. **No package
decreased.**

Build **23/23**, typecheck **23/23**, `eslint .` clean, `prettier --check .` clean,
`git diff --check` clean, gitleaks clean on every commit.

**Mutation tests — 8 of 8 killed and restored**, covering every load-bearing guard: the per-type
result cap, LIKE wildcard escaping, query minimum-length validation, the search result allowlist,
the export inbox narrowing, the archived-row exclusion, the mail tombstone exclusion, and the
inert-rendering guard. One of them (escaping) **survived on the first attempt** and exposed a real
weakness in the test rather than in the control; the test was strengthened with a decoy row.

Migration invariant: **16 `.sql` / 16 journal entries**, `0016` absent, `packages/db` byte-unchanged,
production tracking table **16**.

**The mobile lane required NO source change**, so this baseline stands unchanged and the suite was
deliberately not re-run for the APK install. The APK was built from `d030fc1`, which is the same
application tree the 3,226-test run covered — the only commits after it are documentation.

## Next action

**Stop at readiness. Checkpoint 8.4 must not begin without explicit approval.**

Nothing blocks it. The items below are open work, not gates:

1. **Investigate the inbox-confirm failure** (ledger, above). It is the sharpest of these: a user
   action that appears to succeed and silently does nothing. Worth its own checkpoint, and it needs
   the AI error containment to surface *something* diagnosable without leaking provider text.
2. **Configuration / key durability remains the sharpest systemic risk.**
   `CREDENTIALS_ENCRYPTION_KEY` has no key version, no KDF and no rotation path and exists on exactly
   two hosts. Intended direction: SOPS + age with the private key held off both machines. **Nothing
   secret goes in GitHub.** ADR-024 is unchanged.
3. **Retention windows remain an owner decision** and gate the mail prune ADR-054 requires.
4. **Optional GitHub hardening:** Actions is default-on although no workflow exists in history.
5. **Local hygiene:** delete `apps/mobile/.expo/dev/logs/export.log`, which holds a plaintext
   `EXPO_TOKEN` at mode 644. Separately, `/sdcard` on the Rabbit holds ~157 stray `.xml` uiautomator
   dumps from earlier checkpoints' UI testing; this checkpoint removed only its own ten.

Deliberately **not** started: Checkpoint 8.4 and any capture-front-door work, adding `events` or
`projects` to search, bounding event text at write, any notification-producer change, any Brief
prompt or output-filter change, enabling any further calendar, and migration `0016`.
