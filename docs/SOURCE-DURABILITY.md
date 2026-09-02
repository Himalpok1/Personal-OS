# Source durability — design and owner actions

> **Status: PARTIALLY EXECUTED (2026-09-02).** Option A — a **private** hosted remote — was chosen
> by the owner and is **DONE**. Option 2, the encrypted configuration copy, is **still open and is
> now the sharpest remaining risk.** No secret value was read, printed, or handled by an agent at
> any point, before or during execution.

## Executed — Option A, private hosted remote (2026-09-02)

The owner closed the hosted-remote question and approved a **private** GitHub repository.

| | |
|---|---|
| `origin` | `https://github.com/Himalpok1/Personal-OS` |
| Visibility | **PRIVATE**, verified via the GitHub API immediately before *and* after the push |
| Refs pushed | `main` (`8b7a9eb`) and `phase-8-consolidation` (`907cae3`) — nothing else |
| Tags pushed | **none** |
| Access | owner only · 0 repository secrets · Pages not configured |
| Actions | default-on at the repo setting, but **no workflow file exists in any of the 249 commits**, so nothing can execute. Not enabled, not configured, not used. |

**Verified after the push rather than inferred from its exit code:** remote **commit hash and tree
hash both match local exactly** on both branches; the remote commit count for
`phase-8-consolidation` read back from the GitHub API (217) equals `git rev-list --count`;
`git ls-remote` returns exactly two refs and no tags; the working tree is clean.

**Pre-push secret audit.** `gitleaks` with no custom config (so no allowlist could suppress a
finding): **249 commits across all refs, no leaks, exit 0**; scoped to the pushed refs, 240 commits,
no leaks. Corroborated independently rather than trusted: all **836** distinct paths that have ever
existed were enumerated, and the only secret-shaped filenames ever committed are the two intentional
`.env.example` files, both containing only `changeme_*` placeholders. A raw-content scan of every
blob reachable from the pushed refs found **zero** real credential values. The `.env.pre-7.2` file
Checkpoint 7.2 created — a plaintext copy of every secret — was stageable at the time but **was
never staged**, confirmed across all 249 commits.

**Ignore hardening committed first** (`907cae3`), on Checkpoint 8.0's own reasoning that a gap
"costs nothing while there is no remote; adding a remote is precisely the event that arms it":
key material and signing artifacts (`*.keystore`, `*.jks`, `*.p12`, `*.pfx`, `*.pem`, `*.p8`,
`key.txt`, `*.agekey`, `secrets/`), SSH keys and credential JSON, and nested `.claude/` directories.
Note the first of these matters directly for step 2 below — `*.age` covered age-*encrypted* files,
but an age **private** key is conventionally `key.txt` or `*.agekey` and was uncovered, which is
exactly the artifact the SOPS + age step produces.

**Branches deliberately not pushed.** Eleven of thirteen have zero commits not already reachable
from `phase-8-consolidation`. The two that do — `phase-6-audit-hardening` (19) and
`phase-6-production-readiness-6-7a` (9) — are pre-linearization originals whose trees are
*byte-identical* to commits that ARE in the push set, so their content is fully retrievable from the
pushed history; only pre-linearization commit topology is unreplicated. The sole tag
`cp77-pre-linearize` is tree-identical to a pushed commit while being reachable from no branch, so
pushing it would add 5 dead commits and restore a known-broken bisect point.

**Option B (bare repo on the production host) remains available and is not superseded** — it is an
additional copy, not a substitute for the off-site private remote.

## The risk, measured

| Fact | Value |
|---|---|
| Git remotes configured | **0** |
| Commits (all refs) | **244** |
| Branches containing the commit production is serving (`a5bbc48`) | **exactly one** — `phase-7-mail-monitoring` |
| Is `a5bbc48` an ancestor of `main`? | **No** — `main` is 57 commits behind |
| CI | **None.** `.github/` does not exist |
| Repository location | An **external USB SSD**, mounted `noowners` |
| `.git` size | ~32 MB, **3,487 loose objects, 0 packs** (`git gc` has never run) |
| Second copy of history anywhere | **None** |

**The production host does not hold a second copy.** Releases ship as `git archive` of tracked
files, which by design contains no `.git` — so production has a *flat file tree* of the commit it
serves, not the commit. It cannot reconstruct history, or even that one commit as a commit.

> **The 244-commit history exists in exactly one place: one USB SSD, on one branch, with no remote
> and no CI.**

### The sharper risk, which is not the repository

`CREDENTIALS_ENCRYPTION_KEY` protects every stored OAuth credential — Google Calendar, CalDAV,
Google Health, Gmail, and the AI provider keys — across four tables. There is **no key version
column, no KDF, and no rotation path anywhere in the codebase**; rotation appears only as a failure
mode to degrade from. It exists on exactly two hosts.

Losing the drive costs history and effort. **Losing that key makes every stored credential in
production Postgres permanently undecryptable**, and recovery means hand-NULLing every credential
and re-consenting three Google integrations across two Cloud projects, in ADR-053a's mandated
Calendar → Health → Gmail order.

## What this is not

**ADR-024 is not implicated and is not reopened.** ADR-024 forbids a *database backup system*, and
every operative invocation of it in the record is about database state — a `pg_dump`, a snapshot, a
retention policy. This document proposes:

- **replication of source control** — already-plaintext, already-versioned files containing no
  production data; and
- **an encrypted copy of ~18 configuration scalars** — provisioning material, not data.

Neither creates a restore path for the database, a schedule, or a retention policy.
`docs/ARCHITECTURE.md` independently *already mandates* the second one ("Config that must live in
the repo goes through SOPS + age"), and `docs/PHASE-0-CHECKLIST.md` section F has required deciding
the age key location since Phase 0. That requirement was never triggered because no config has ever
needed to live in the repo.

**ADR-018 is not implicated either.** It governs *ingress to the production host*. `git push` is
egress from a development machine. No option below opens a port, adds a listener, or creates a
publicly reachable endpoint.

**Guardrail:** one-time, manual, owner-executed, owner-held and recorded stays outside ADR-024.
Anything scheduled, rotated, or retained by policy becomes infrastructure and needs its own ADR.

## Options

### B — bare repo on the production host over Tailscale · RECOMMENDED FIRST

Highest risk-closed per unit of effort. The transport already exists and is already trusted; no new
ingress, no new account, no new dependency, ~5 minutes.

- **Closes:** drive failure, drive loss, accidental deletion — the likeliest events by a wide margin.
- **Does not close:** fire, flood, burglary. Both copies would be in the same building.
- **One posture change to make deliberately:** production currently has **no `.git` at all**, and
  that was a considered choice. A bare repo puts 244 commits of history onto that host for the first
  time. Keep it **outside the deploy tree and outside any container bind mount**, or it silently
  becomes part of the served surface.

### A — private repo on a hosted service · the only option that survives the house

- **Closes:** everything B closes, **plus** loss of the building. The only option with geographic
  diversity. Also unlocks CI, which does not exist today.
- **The real decision is disclosure, not security.** `gitleaks git --log-opts=--all` scans all 244
  commits clean, and that was verified independently rather than taken from the record — no
  credential, keystore or `google-services.json` has ever been committed. But `docs/history/` now
  contains the full operational record, which collectively is a **precise map of the owner's home
  network and Google project**: tailnet hostname and IP, the production Linux username and home
  paths, the GCP project name, an OAuth client-id prefix, exact bind topology, and a candid history
  of every defect found. None of that is a credential; together it is reconnaissance.
- Worth noting the project's own precedent cuts both ways here: ADR-052 declined a GCP dependency
  for a single-user workload on the grounds that it "needs its own approval." The same reasoning
  applies to a code-hosting dependency — which is an argument for deciding it deliberately, not for
  declining it.

### C — `git bundle` on a second physical disk · weakest, but trivial

A second external volume is mounted with ~82 GiB free. It is **exFAT**, which has no POSIX modes,
no symlinks and no hardlinks — a poor host for a live object store. **Prefer a single
`git bundle --all` file** (one artifact, checksummable, format-agnostic) over a clone.

- **Closes:** drive failure only. Same building, and the least reliable medium in the set.

**B and A are complements, not substitutes: B closes the drive, A closes the house.** C is a
strictly weaker B.

## Owner actions

Everything below requires the owner. An agent must not create accounts, generate private keys, or
read secret values.

### 1. Second copy of history — pick B, or A, or both · **DONE via A on 2026-09-02; B still optional**

**Option B**, on the production host over Tailscale (adjust the path; keep it outside the deploy
tree):

```bash
ssh personal-os 'git init --bare ~/personal-os-mirror.git'
git remote add origin ssh://personal-os/~/personal-os-mirror.git
git push origin --all && git push origin --tags
```

**Option A**, after creating an empty **private** repository:

```bash
git remote add backup <your-private-remote-url>
git push backup --all && git push backup --tags
```

Verify either with `git ls-remote --heads <remote>` and confirm `phase-7-mail-monitoring` is listed
— that is the branch carrying the commit production serves.

**Option C**, as a stopgap that needs no account and no network:

```bash
git bundle create "/Volumes/<second-disk>/personal-os-$(date +%Y%m%d).bundle" --all
git bundle verify "/Volumes/<second-disk>/personal-os-$(date +%Y%m%d).bundle"
```

### 2. Encrypted configuration copy — **STILL OPEN, and now the sharpest remaining risk**

Neither `sops` nor `age` is installed on this machine, and no age key exists. The design:

1. Owner installs the toolchain (`brew install sops age`).
2. Owner generates the keypair with `age-keygen`. **The private key must live off both the
   development drive and the production host** — a password manager is the natural home. An agent
   must never generate, read, or hold it.
3. Owner encrypts the real `.env` **to the public key only**, producing `secrets.production.yaml`
   or an `.age` file. `.gitignore` already anticipates exactly this shape (`*.age`,
   `secrets.*.yaml`, `!secrets.*.example.yaml`) — those three rules have existed since Phase 0 and
   have never matched a file.
4. Store the encrypted artifact wherever the repository goes. It is inert without the private key.

**The single value that matters most is `CREDENTIALS_ENCRYPTION_KEY`.** If only one thing gets a
second copy, make it that.

### 3. Decide whether to record an ADR clarifying ADR-024's scope

ADR-024 is cited often. An explicit note distinguishing *backup of database state* (forbidden) from
*replication of source control* and *encrypted config provisioning material* (permitted) would stop
a future agent refusing a remote on ADR-024 grounds. This document is the argument; an ADR would
make it Locked.

## Recommended sequence

1. **Done in Checkpoint 8.0:** close the `.gitignore` suffix gap. `.env` alone left
   `.env.production`, `.env.backup` and `.env.pre-<checkpoint>` fully visible to `git add -A` —
   and Checkpoint 7.2 created exactly such a file, a plaintext copy of every secret, and deleted it
   by hand afterwards. **This had to precede any remote:** without a remote such a mistake is local
   and removable; with one it is published permanently and forces credential rotation.
2. **Owner:** option B. Highest ratio, no new decisions.
3. **Owner:** the `CREDENTIALS_ENCRYPTION_KEY` copy — the smallest action with the largest downside
   avoided.
4. **Owner:** decide option A on disclosure grounds.
5. **After a second copy exists:** run `git gc`. The object store has 3,487 loose objects and has
   never been packed. It is safe maintenance, but it rewrites the object store, and doing that
   while exactly one copy exists is the wrong order.

## Deliberately not done in Checkpoint 8.0

No remote was created or configured. No key was generated. No secret was read, copied or encrypted.
No `git gc`, no repack, no history rewrite. No third-party account was chosen or created.
