# Phase 6 — Google Health integration

> **Historical record — closed. Do not edit.**
> Server-side read-only Google Health cloud sync (ADR-046), daily aggregates and sessions, and the health dashboard.
>
> Archived from `docs/STATUS.md` by Checkpoint 8.0 (2026-09-02) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`.

Source line ranges in the pre-8.0 `docs/STATUS.md`: 2184–4196


> **Note on cross-references.** This file was extracted from a single 7,283-line `docs/STATUS.md`. Phrases like *"above"*, *"below"*, *"further down this file"* and *"see the 6.7A section"* refer to positions in that original document, not to this file. Where a target moved to a different phase file, follow the phase number. Nothing was rewritten to repair these — the text is verbatim.

<!-- ORIGINAL RECORD BEGINS — everything below this line is verbatim from docs/STATUS.md -->
## Phase 6 — Google Health Integration (plan approved 2026-08-24)

Phase 6 was redefined by explicit user direction (ADR-046): the original `ARCHITECTURE.md`
entry — HealthKit via `@kingstinct/react-native-healthkit`, Health Connect via
`react-native-health-connect` — is **removed from scope entirely**. No native health
access, no device-local health sync, no Apple Developer dependency. Phase 6 as approved is
a **read-only, server-side Google Health API integration**.

**Approved checkpoints:** 6.0 ADRs + repository verification + docs · 6.1 contracts +
additive migration `0013` + provider fake · **⛔ full stop** · 6.2 OAuth · 6.2P real-account
capability *and* identity-stability probe · **⛔ stop** · 6.3 sync engine · 6.4 dashboard
(web + Rabbit) · 6.5 hardening · 6.6 full live proof · 6.7 gated production deployment.

**Approved scope at this time is 6.0 and 6.1 only.**

### Planning record — what the research actually changed

Planning ran four parallel read-only investigation agents plus an independent adversarial
review. It went through three revisions, and the corrections are worth recording because
several were errors of fact that would have shipped:

1. **There is no incremental-sync primitive.** The API documents no sync token, no
   `updateTime` filter, no `showDeleted` and no tombstones, and `reconcile` is multi-source
   de-duplication — not change tracking. The only change-detection mechanism is webhooks,
   which require public ingress (excluded by ADR-018). Sync is therefore a bounded
   trailing-window re-fetch with content hashing, carrying an accepted **35-day staleness
   contract** (ADR-046).
2. **The documented OAuth client type is Web Server with a required `redirect_uri`** —
   directly contradicting Phase 4's proven native `AuthorizationClient` flow, which
   deliberately sends none. `packages/calendar-providers/src/google-oauth.ts` is therefore
   **not** reusable, and is deliberately near-duplicated rather than extended (that package
   is also the standing 57-test zero-drift canary).
3. **All Google Health scopes are Restricted**, but the documented personal-use exception
   (<100 users) applies, so no verification and no CASA security assessment is triggered.
   **Publishing status — not verification — governs the 7-day refresh-token expiry**, and
   "In production + Unverified" is a documented supported state.
4. **`dailyRollUp` documents `civilStartTime`/`civilEndTime` and supplies no physical
   instants or UTC offsets.** So `local_date` is taken verbatim from the API and no IANA
   timezone is stored (ADR-048) — but daily rows carry no physical bounds, so
   duration-normalized daily rates are not derivable and are not offered.
5. **Sleep is filtered by `sleep.interval.civil_end_time`**, a sleep-exclusive filter; the
   generic session-start filter explicitly excludes sleep. Attribution, fetch filter and
   deletion scope are therefore one axis (ADR-049), deleting a planned one-day widening.
6. **`list` does not accept `dataSourceFamily`** — only `reconcile`, `rollUp` and
   `dailyRollUp` do.
7. **`pairedDevices.list` requires `googlehealth.settings.readonly`** — a fourth scope. All
   paired-device functionality was cut rather than silently widening consent.
8. **`DataSource` documents no stable identifier** (only `recordingMethod`,
   `device.formFactor`, `application.platform`), and `ReconciledDataPoint` carries no
   `dataSource` at all. Raw-heart-rate identity is therefore a fully-specified deterministic
   key over every field the API actually returns, with an explicit collision strategy — and
   **raw-HR rows are never tombstoned** until a live probe proves identity stability, since
   `reconcile` recomputes off-wrist filtering per call and an omission is evidence of
   upstream recomputation, not deletion.

The adversarial review additionally caught three defects that would have reached
production: an **OAuth authorization code written to the request log** (Fastify logs the URL
at `lib/route.js:522`, before `onRequest` hooks at `:561`, and the default serializer emits
neither query nor body — so the proposed hook and redact paths were both ineffective); a
**bucket-count check that would have dead-lettered every backfill chunk** covering days the
watch was not worn; and a **hot-sync path that could blank real daily data with NULL** on a
single empty 200 response.

**Scope decisions recorded with the approval:** exactly three read scopes
(`activity_and_fitness`, `sleep`, `health_metrics_and_measurements`); raw heart-rate samples
included (the one selection carrying ongoing cost); web **and** Rabbit delivery, so Phase 6
ships an APK at versionCode 7; publishing status **In production, unverified**.

### Checkpoint 6.0 — ADRs and documentation reconciliation (COMPLETE, 2026-08-24)

No code. No migration. No dependency change. No credentials. No production access.

**Repository baseline verified directly** (not inferred from prose): branch `main`, HEAD
`e1effa4cadaca5440345841286bc06e846cd3203`, working tree clean, exactly **13** `.sql`
migrations and **13** journal entries with `0012_ai_daily_briefs` (`when` 1787466808983)
last, and ADR-045 the highest existing ADR.

**Added:** `docs/DECISIONS.md` ADR-046 (Phase 6 redefinition; trailing-window sync; 35-day
staleness contract; webhooks permanently excluded; densification restricted to
warm/manual/backfill and clamped) · ADR-047 (daily-aggregate storage; intraday for
`heart-rate` only; **no automatic health-data deletion**) · ADR-048 (`local_date` is the
API's civil date; no timezone stored; no physical bounds on daily rows; sync window
UTC-computed and widened one day each end; ADR-042/045 explicitly **not** reused) ·
ADR-049 (sleep attributed *and queried* on the civil-end axis) · ADR-050 (CHECK only
project-controlled closed vocabularies, citing the `0009` reconcile fallout).

**Reconciled seven documented conflicts:** `ARCHITECTURE.md` Phase 6 entry replaced (C1);
the Apple Developer gotcha narrowed — it still gates iOS builds, no longer Health (C2); the
HealthKit reference removed from the native-module note (C3); this file's header, current
work and next action updated (C4); the "passive vs proactive health" open question answered
as **passive** in both `ARCHITECTURE.md` and `DECISIONS.md` (C5); the `health` namespace
collision recorded — `GET /health` and `packages/schema/src/health.ts` are already the
liveness probe, so Phase 6 uses `health-*` siblings throughout (C7).

**Deliberately not yet changed (C6):** the three lines asserting "13 `.sql` files, 13
journal entries, **no 0013**" remain **accurate** until migration `0013` actually lands in
Checkpoint 6.1, and are updated then — not pre-emptively.

### Checkpoint 6.7B — Production deployment (server side COMPLETE, 2026-08-29)

Phase 6 is deployed to production. Migration `0013` is applied, api/worker/web serve the
6.7 release images, and the Google Health integration is live behind the Tailscale
perimeter. **Production migration level moved 0000–0012 = 13 → 0000–0013 = 14** for the
first time since Phase 5. `versionCode 7` was built and audited.

Branch `phase-6-production-deployment-6-7b`, cut from `main` at `c0dbff3`. Every production
command was issued by the integrator; sub-agents were read-only, made no production, network,
Google or database connection, and returned evidence only.

#### Starting state, verified before any production access

Branch `main`, HEAD `c0dbff3`, clean tree, linear history, **no remote**. The application
tree is byte-identical to frozen RC `bcf11fc`: `git diff --name-only bcf11fc c0dbff3`
returns exactly `docs/DECISIONS.md` and `docs/STATUS.md`, and the same diff excluding those
two paths is **empty**. 14 `.sql` / 14 journal entries, highest `0013_google_health_sync`,
**no `0014`**. F5 `capture-1.json` only. No repository process running; ports 3000/8081/8082/
5173/19000/19001 free. EAS remote `versionCode` **6**. ADR-051 present.

#### Four preflight findings, surfaced before the authorization gate

The owner's approval arrived mid-preflight, before this evidence existed. It was treated as
standing but **not** acted on until the findings below were put in front of them, because two
are conditions the checkpoint brief explicitly says to stop on.

1. **Production had no Google Health credentials.** `/home/himallinux/personal-os/.env` held
   11 keys; `GOOGLE_HEALTH_OAUTH_CLIENT_ID`, `_CLIENT_SECRET` and `_REDIRECT_URI` were all
   absent. Compose declares them `:-` (optional) precisely so a rollout cannot crash-loop
   before they exist, so migration and rollout were never blocked — only the production
   Health connection was.
2. **There is no backup procedure, by design.** ADR-024 is Locked. No backup infrastructure
   was built.
3. **The Rabbit R1 was not visible to `adb`.**
4. **The OAuth privacy-policy URL serves HTTP 404** — see the compliance-debt section below.

Owner decisions: silent credential copy + production callback · one-off pre-migration
snapshot · connect the Rabbit and proceed.

#### Credential provisioning — same client, no Console change

`GOOGLE_HEALTH_OAUTH_CLIENT_ID` and `_CLIENT_SECRET` were piped from the local `.env`
straight into the production `.env` over SSH by a **silent shell operation** — never printed,
never placed in a command line, never read with a model-facing file tool. This is the exact
Checkpoint 6.2 precedent. `GOOGLE_HEALTH_OAUTH_REDIRECT_URI` was written explicitly as the
**already-registered** production callback
`https://personal-os.tail62a68f.ts.net/health-connections/google/callback` — the local
development loopback callback was deliberately **not** copied.

Verified by name, length and structure only: prod lengths (72 / 35) equal the local source
lengths exactly; the client id ends in `.apps.googleusercontent.com`; exactly one occurrence
of each key; mode `600` and ownership preserved; the pre-change file was kept as
`.env.pre-6.7b`. **No new OAuth application, project, client, account or credential exists,
and no scope or callback changed.**

#### Release lineage

| Component | Source | Image digest |
|---|---|---|
| api | `c0dbff3` | `sha256:da08f150cd43357d06bed495bbf8af12a00ca8c7780b38aa9eaf5e89f13288ee` |
| worker | `c0dbff3` | `sha256:5e3318a0a41d070effc535bda0c812d9169403c80c6486542d567a7d91797942` |
| web | `c0dbff3` | `sha256:36153ab10ed13779b3ffb98a50646a0148bc9699fd74c772a728e10943407653` |
| postgres | unchanged | `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168` |
| Android | `c0dbff3` | EAS `9d05d31c-d322-4864-ae51-b51806cf0966`, versionCode **7** |

Rollback tags `personal-os-{api,worker,web}:pre-6.7` were created **by resolved digest**
before any build, and each was re-inspected to confirm it resolves to the original digest:
api `bf0f5ea0…`, worker `bb0f3ec4…`, web `93250778…`. Never `docker commit`.

**A transcription lesson worth recording.** The first tagging attempt failed with
`No such image` because the digest had been hand-copied from an earlier `docker inspect`
whose `\n` separators printed literally, and one character pair was transposed
(`…a99dbc9…` for `…a99bdc9…`). The fix was to stop transcribing entirely and resolve every
digest server-side into a variable. `docs/STATUS.md`'s recorded 5.7.1 api digest was then
checked against the live container and **matches exactly** — the error was in this session's
transcription, not in the document.

#### Release tree and snapshot

Shipped as `git archive` of `c0dbff3` into a **new** `/home/himallinux/personal-os-6.7-release`
(absent beforehand; the 4.7, 5.7 and 5.7.1 directories are preserved as rollback sources, and
the stale `/home/himallinux/personal-os` was never used as a build source). Archive sha256
**`2dbae6f789f915ab11cd992ffc400bb4e73f2f126a786e741a5918e00d7b74a8`**, byte-identical on
both ends of the transfer; 587 files extracted. Contains **no** `.env`, `google-services.json`,
`node_modules`, `.git`, keystore, or generated `apps/mobile/android/` prebuild tree. The two
`android` directories present are the tracked Expo module sources
(`google-calendar-auth`, `exact-alarm-status`), not generated output.

One-off pre-migration snapshot (ADR-024 unamended — a point-in-time artifact for this
deployment, not recurring infrastructure): `pre-6.7b-20260829T060033Z.sql.gz`, 1 638 384 B,
sha256 `7391d09f68b750ac1bf0c3552ede1aea9aed3aea8991a65c9a1b7662c92e579c`, mode 600, gzip
integrity verified, 34 `CREATE TABLE` / 32 `COPY` blocks. Contents never printed. Postgres
was not restarted by the dump.

#### Migration `0013` — the 5.7 silent-no-op trap cleared explicitly

Because the migration runs **from the api image**, the release image was built first and its
contents inspected before the migration ran: **14 `.sql` files, 14 journal entries, no
`0014`**, and `0013` inside the image hashing to
`21149ee97a2b1e146282d2201b0081fa05de543367e5c0189a815f4912df8a19` — identical to the local
file and to the release tree.

An independent read-only sub-agent re-derived the object inventory from the SQL alone and
**agreed with the 6.1 record on every count**: 7 `CREATE TABLE` · 12 CHECK · 6 FK · 14
`CREATE INDEX` · 39 statements · 38 breakpoints · **zero `DROP`/`ALTER COLUMN`/`RENAME`/
`TRUNCATE`** · zero DML · no pre-existing table referenced. It also supplied the
reconciliation that makes the live check unambiguous: the 7 inline `PRIMARY KEY`s create
implicit `_pkey` indexes, so `pg_indexes` shows **21**, not 14 — the two figures are
consistent, not contradictory.

Applied once, from the new api image, as `posops_migrator`, with `--no-deps`, pinned to
project `personal-os`, the production env file and both production compose files. `db:reconcile`
was **not** run.

| Check | Result |
|---|---|
| Journal rows | 13 → **14** |
| New row | exactly one: `id=14`, hash `21149ee9…` (= the file's sha256), `created_at` **1787591489044** (the journal `when`, not wall-clock) |
| Replay of 0000–0012 | none |
| Health tables | **7** |
| CHECK constraints | **12** |
| Foreign keys | **6** |
| Indexes | **21** = 14 explicit + 7 implicit `_pkey` |
| Total public tables | 21 → **28** |
| Existing data | byte-identical to baseline — tasks 2 · notes 3 · events 0 · inbox 6 · devices 2 · projects 0 · calendar_connections 1 · ai_task_routes 3 |
| New health tables | all **empty**, `health_observations` **0** |
| `posops_app` | DDL still denied (`permission denied for schema public`); DML on a health table succeeds (rolled back) |

**The Checkpoint 4.7 Gate C incident did not recur.** Postgres kept container
`404de24ef86b…`, image digest `d4bb0a8c…`, `restarts=0`, start time
`2026-08-24T09:35:33.938Z` and created time `2026-08-21T19:26:39.456Z` across the migration
and both rollout steps; `personal-os_postgres_data` kept its identity and its
`2026-08-15T17:32:00-05:00` creation timestamp. Postgres was never named as a target of
`up`, `run`, `restart`, `stop` or `rm`, and every command carried `--no-deps`.

#### Rollout

`up -d --no-deps --no-build --force-recreate api worker web`. All three recreated onto the new
digests with `restarts=0`; **postgres untouched and still reporting "Up 4 days"**.

| Check | Result |
|---|---|
| API health | `{"status":"ok","db":"connected","worker":{"stale":false}}` |
| Web | HTTP 200 locally and at `https://personal-os.tail62a68f.ts.net:8443` over the tailnet |
| Bindings | api `127.0.0.1:3000`, web `127.0.0.1:8081`, **Postgres publishes no host port** — identical to baseline |
| Tailscale Serve | both routes **tailnet only**; no Funnel; no public ingress introduced |
| Queues | 18 → **20**; `health.google.sync-connection` registered as **`stately` / `retry_limit 0` / no dead-letter**, exactly the ADR-recorded 6.3 design |
| Schedules | 5 → **6** (`health.google.sync-cron` hourly) |
| Jobs | all `completed`; zero failed, active or created |
| Worker | heartbeat fresh; startup line lists every queue including `health.google.sync-connection` |
| Log secret scan | api and worker: **0** matches for `ya29.` / `1//` / `refresh_token` / `client_secret` / `ciphertext` / `auth_tag` / `access_token`; **0** error-level lines |

#### Production API smoke

`/health-summary?tz=America/Chicago` returns **`configured: true`** — the direct proof that
the provisioned credentials are wired — with `connection: null`, empty `today`/`latest`/
`capabilities` and **not one fabricated zero**. `/health-connections` returns `{"items":[]}`.
Guard rails fire: `heart-rate-intraday` → **400 `metric_not_readable`**, unknown metric →
400, missing `tz` → 400 `validation_failed`. Phase 5 regression intact: `/today?tz=` returns
a full read model.

#### Android `versionCode 7` — built and audited, install pending

EAS build **`9d05d31c-d322-4864-ae51-b51806cf0966`**, profile `production-internal`,
`--freeze-credentials`, remote credentials (`Build Credentials 91FWKRpxFX`).
`gitCommitHash` **`c0dbff3be5366148974291120f88428a74a89cd2`** — the approved release commit.
APK sha256 **`5c400467905fbb042a9f4c83999f529674d64fd6eb6631b7fc923e15835f96a4`**, preserved
outside the repository under `checkpoint-6.7b/`.

| Audit | Result |
|---|---|
| Package | `com.himal.personalos` (**not** `.dev`) |
| versionCode / versionName | **7** / 1.0.0, targetSdk 36 |
| Signing certificate SHA-256 | **`4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`** — exact match to the production identity (SHA-1 `7eac1aa4…`) |
| Debuggable | absent |
| `usesCleartextTraffic` | **absent** (the UI-test-only plugin correctly not applied) |
| Scheme | `mobile` |
| Expo Updates | `ENABLED=false` |
| Bundle | Hermes bytecode |
| Production API URL | present |
| `localhost:3000` / `127.0.0.1` | **absent** — proving EAS supplied `EXPO_PUBLIC_API_URL` |
| UI-test markers | `personal-os-ui-test` **0**, `EXPO_PUBLIC_UI_TEST_MODE` **0** |
| `EXPO_TOKEN` / private keys | 0 |

**Fingerprint `5e208f678a90699d930e3cdf40c6431dc7d32857` is identical to versionCode 5 and 6**,
so the native dependency graph — and therefore the React Native version behind the Category A
adjudication — is unchanged. The single `http://localhost:8081` occurrence is that same
React Native `getDevServer.js` framework fallback; occurrence count (1), RN version and
provenance all match the recorded exception, but the exception remains bound to an APK hash
and this is a **new** hash, so it is adjudicated afresh here rather than inherited silently.

**One string-table false positive, adjudicated rather than waved through.** A naive grep for
`com.himal.personalos.dev` returned one hit. Hermes packs strings contiguously, and the hit
is `com.himal.personalos` immediately followed by `devDependencies`. The `.dev` is the head of
`devDependencies`, not a package suffix — the same artifact class the 5.7 Gate G record
adjudicated for its `sk-` match. Real UI-test markers are zero.

#### OAuth branding / compliance debt — recorded, deliberately not fixed

Checkpoint 6.7A set the OAuth homepage and privacy-policy URLs to
`https://personal-os.tail62a68f.ts.net` to satisfy the new Auth Platform console's publishing
requirement. That URL is the **Fastify API root**, and it returns
`{"message":"Route GET:/ not found"}` — **HTTP 404**. `/privacy` is likewise 404, and the web
app is on a different port (`:8443`) and contains no privacy text either. Because the host is
tailnet-only under ADR-018, Google cannot reach the URL at all.

So the privacy-policy URL serves **no privacy disclosure of any kind** — a stronger statement
than "the app root carries no disclosure". No policy was fabricated, the Console URLs were not
changed, and Google verification was not submitted; the application remains an unverified
personal-use production app. This is **branding/compliance debt only** and is explicitly
distinct from the OAuth functionality, which is verified working.

#### Host reboot survival — PASSED

The host was rebooted by the owner (`sudo` on `personal-os` requires their password, so the
integrator cannot issue it). Fresh boot confirmed at `2026-08-29 22:23:11` local, `up 0 min`.
Recovery was fully unattended.

| Check | Result |
|---|---|
| Containers | all four auto-started, no manual repair |
| Container IDs | **identical** to pre-reboot — api `608bf044a82e`, worker `2122152c78ce`, web `2eee2b4490e7`, postgres `404de24ef86b` |
| Image digests | **identical** on all four |
| Restart counts | 0 on all four |
| Volume identity | `personal-os_postgres_data` still created `2026-08-15T17:32:00-05:00` |
| Migration journal | still **14**, `0013` present exactly once |
| Health tables | 7 |
| Application data | tasks 2 · notes 3 · inbox 6 · devices 2 — unchanged |
| Queues / schedules | all jobs `completed`; **6** schedules |
| Worker heartbeat | fresh (43 s) |
| Advisory locks | 0 |
| API / web | `{"status":"ok","db":"connected"}` · web 200 |
| Tailscale Serve | both routes **tailnet only** |
| Bindings | api `127.0.0.1:3000`, web `127.0.0.1:8081`, **Postgres unpublished** — identical to baseline |

A transient SSH timeout occurred on the first attempt immediately after the reboot; the host
answered normally seconds later (ping 0% loss, 1.8 ms). It was the host still coming up, not a
fault.

#### Production Google Health connection — live

Consent was completed interactively in the browser against the owner's existing Google
session. **No credential was entered by the agent**; the account chooser was already signed
in, and the unverified-app interstitial independently confirmed the developer account is the
same one that owns the OAuth application. Google's own consent screen reported
*"tail62a68f.ts.net already has some access — see the 3 services"*, confirming the same
account already carries the three Health grants.

| Property | Value |
|---|---|
| Connection | `ac3d47ad-f5fb-4732-94b9-751dcb113f79`, provider `google_health`, status **active** |
| Identity | `health_user_id` matches the development connection's recorded identity — same account |
| Granted scope | **exactly the three** read-only Health scopes; none added |
| Credentials at rest | access **253 B** ciphertext · refresh **103 B** ciphertext · 12 B IV · 16 B auth tag — matching the 6.2P lengths |
| OAuth state | single-use honoured — 1 consumed of 3 minted; the two unused states expired rather than being consumed |
| Streams | **19 seeded, 18 enabled**; `heart-rate-intraday` **false** |
| `last_sync_error` | null, and **not projected** by the API at all |
| Exactly one connection row | yes |

**No new OAuth application, project, client, account or credential was created, and no scope
or callback changed.**

#### Bounded production synchronization — three passes

Every pass was `trigger: manual` through `POST /health-connections/:id/sync`, executed by the
deployed worker on the existing queue. **72 Google requests in total.**

| Pass | Runs | Succeeded | Inserted | Updated | Unchanged | Rejected |
|---|---|---|---|---|---|---|
| 1 | 24 | **24** | 137 | 0 | 0 | **0** |
| 2 | 24 | **24** | 0 | 1 | 136 | **0** |
| 3 | 24 | **24** | **0** | 1 | 136 | **0** |

Row count settled at **137** daily-metric rows and stayed there. Only four metrics returned
data — `steps`, `distance`, `floors`, `total-calories` — exactly the set 6.2P found on this
account; every other stream succeeded with zero rows, which is the honest empty path rather
than a failure. Sessions: 0. **`health_observations`: 0.** `heart-rate-intraday`: **zero sync
runs, ever.**

The single updated row in passes 2 and 3 is the current, still-accumulating civil day. That is
the same phenomenon 6.3L and 6.6 both recorded, and it is the content-hash change detection
working rather than a defect — an unchanged row produces no heap tuple and leaves `updated_at`
untouched, which is why 136 of 137 rows were byte-identical each time.

**A staleness observation worth recording, because it looked wrong and was not.** After pass 1
the summary reported `days_behind: 27`, `is_stale: true` despite every run succeeding. The
cause is that `verified_through_date` on the summary is the **minimum across enabled streams**,
and the four chunked metrics (`sleep`, `exercise`, `heart-rate`, `total-calories` — smaller
`maxRangeDays`, hence 2–3 runs each) were still catching up at Aug 2–4 while the other 14
streams were already at Aug 29. Pass 2 advanced the minimum to Aug 18; pass 3 brought **every
enabled stream to 2026-08-29**, and the summary settled to `days_behind: 0`, `is_stale: false`,
`last_attempt_status: succeeded`. The first-pass banner was honest, not a bug, and it
self-resolved exactly as the bounded-window design predicts.

Missing-versus-zero holds in production: of 16 today tiles, 15 are `state: "unknown"` with
`value: null` and one carries a real value for the live day. **Zero tiles carry a non-null
value in a non-`value` state** — not one fabricated zero. A leak scan across
`/health-summary`, `/health-connections`, `/health-metrics`, `/health-sleep` and
`/health-workouts` returned **0 matches** for `ya29.`, `1//`, `refresh_token`, `access_token`,
`ciphertext`, `auth_tag`, `client_secret` or a populated `last_sync_error`.

No health measurement appears in this record, in any commit, or in the deployment report.

#### Rabbit `versionCode 7` — installed and verified (2026-08-30)

The device was reconnected by the owner and the lane resumed under the existing 6.7B
authorization. The earlier `blocked_external` diagnosis was correct and physical: once
connected, `ioreg` enumerated `rabbit r1@02110000` and `adb` listed the device as
`device` (authorized) immediately, with no adb-server or authorization work needed.

**Device identity confirmed before anything was installed:** serial `919109A4M16001324668`,
manufacturer `rabbit`, model `rabbit r1`, device `r1`, product `cipher_r1`, build
`BP2A.250605.031.A2`, **Android 16 / SDK 36**, 480×640 at physical density 320 with override
190 — the expected unit and OS.

**Pre-install gate — every check passed:**

| Check | Result |
|---|---|
| Installed package | `com.himal.personalos` only; no `.dev` present |
| Installed versionCode | **6** |
| `firstInstallTime` / `lastUpdateTime` | `2026-08-19 16:26:10` / `2026-08-24 05:17:43` — matching the recorded values |
| New APK sha256 | **`5c400467905fbb042a9f4c83999f529674d64fd6eb6631b7fc923e15835f96a4`** — matches the audited artifact |
| Signature compatibility | the **installed v6 APK was pulled from the device** and its certificate compared directly against the new one: both `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`, and both equal the recorded production identity |
| New APK | package `com.himal.personalos`, **versionCode 7**, non-debuggable, **no `usesCleartextTraffic`**, scheme `mobile`, Expo Updates `false` |
| Bundle | production API URL present; `localhost:3000`, `127.0.0.1` and private-IP dev hosts all **0**; `personal-os-ui-test` and `EXPO_PUBLIC_UI_TEST_MODE` **0**; one `localhost:8081` (the adjudicated RN framework fallback) |
| Pairing / PRIMARY / session | device row `c6c0b43d-…` PRIMARY, notifications enabled, push token present, not revoked, exactly one PRIMARY, **0** live pairing codes |

Data preservation was **proved, not assumed**: signature equality is what makes Android treat
the install as an update rather than rejecting it `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and
versionCode 7 > 6 means no downgrade and therefore no `-d`.

**Installed with `adb install -r` only** — no uninstall, no data clear, no `-d`, no signing
change. Result `Success`.

| Post-install | Result |
|---|---|
| versionCode | 6 → **7** |
| `firstInstallTime` | **`2026-08-19 16:26:10` — unchanged** (proves update, not reinstall) |
| `lastUpdateTime` | advanced to `2026-08-29 22:40:57` |
| `dataDir` | `/data/user/0/com.himal.personalos`, unchanged and present |
| Signature | identical signature object before and after |
| Packages installed | production only |

#### Rabbit workflow pass (production identity)

Cold launch (`force-stop` then launcher intent) reached `MainActivity` with **zero crash-buffer
entries** and zero `FATAL`/ANR. **No pairing screen**, no new device row and **zero pairing
codes consumed** — the SecureStore credential survived the update — and the server saw
`last_seen_at` refresh within seconds.

| Area | Result |
|---|---|
| Five tabs | Today / Inbox / Notes / Projects / Calendar all render at y≈601, evenly spaced |
| Clipping | **zero** nodes exceeding 480×640 on every screen exercised |
| Today | date header, All tasks, Overdue, Due today, Inbox count, OVERDUE / DUE TODAY / TODAY'S EVENTS / INBOX NEEDS ATTENTION / ACTIVE PROJECTS, Health card, Daily Brief |
| Calendar | Month / Week / Agenda toggle plus Previous month, Next month, Jump to today |
| Settings | Devices, PRIMARY, notification toggles, Revoke, Forget this device, Connected Calendars showing **`Google Calendar · connected` with no raw provider error**, the Health card, and all five notification-diagnostics buttons |
| Settings gear | 51×52 with accessible name `Settings` |
| FAB / PTT | 58×58 each at `[397,482]`–`[455,540]` and `[25,482]`–`[83,540]`, both mounted on the production identity |
| Capture | one row created (`source: "web"`, the frozen entry-path value), parsed by production gpt-4.1 to a task, **no duplicate** |
| Capture buttons | Cancel **84×52** (`Cancel this capture`), Capture **94×52** (`Capture this note`) — both clear 44 px |
| Back navigation | returns correctly from the trends screen to the Health dashboard |
| Side button | kernel input layout reports **`KEY_POWER`** |
| Scroll wheel | kernel input layout reports **`KEY_VOLUMEUP` / `KEY_VOLUMEDOWN`** |
| Raw provider errors | none on any screen — no `API error`, `google_oauth_failed`, `invalid_grant`, `error_description` or token-shaped string |

**Health surfaces, live against production.** The dashboard reads *"Google Health · Connected ·
Data through Aug 29, 2026"* with no error string. **Missing-versus-zero is visible as two
structurally different sentences on one screen**: *"Today hasn't been synced yet…"* for metrics
that have history — printed **alongside** their last-recorded line, never instead of it — and
*"No data has reached Google Health for this yet…"* for metrics that have never had any.
**Not one fabricated zero.** ACTIVITY, VITALS, BODY, SLEEP and WORKOUTS all render, the two
session sections with honest empty states.

The trend screen is the strongest evidence, because it renders the three-state model **in
words**: its accessibility summary distinguishes days with a recorded value, days *"checked
with nothing recorded"* (verified-absent) and a day *"not synced"* (unknown). The 7/30/90 range
selector carries labels (`Show the last N days`), every chart mark has a per-day
`accessibilityLabel`, and `Navigate up` is named.

**Manual Sync deduplication proved.** Four rapid taps of *Sync now* produced **exactly one**
`health.google.sync-connection` job (3 → 4 total) — the `singletonKey` + `stately` policy
collapsing them. Afterwards `health_daily_metrics` was still **137** rows with **zero duplicate
`(connection, metric, local_date)` identities**, `health_sessions` 0, `health_observations` 0,
and **no failed job anywhere in pg-boss**.

**Offline / API-unavailable, tested device-side only.** Production services were never altered;
the device's own Wi-Fi was disabled instead. With `Active default network: none` the app
stayed alive with zero crash lines and leaked no raw network error; a capture made offline was
queued locally and **the server had 0 rows**. On restoring Wi-Fi the row **flushed exactly
once**, with the outbox badge reading `Pending captures: 0` and no duplicate.

#### Rabbit reboot proof — PASSED

`adb reboot`; `sys.boot_completed` in ~25 s, uptime 0 min.

| Check | Result |
|---|---|
| Tailscale | **auto-started with no manual action** — `tun0` up, `VPN CONNECTED extra: VPN:com.tailscale.ipn` |
| Production reachability | ping to the server 0% loss |
| versionCode | **7** |
| `firstInstallTime` / `lastUpdateTime` | **both unchanged** |
| Packages | production only |
| App process | self-started after boot (the `RECEIVE_BOOT_COMPLETED` path, ADR-031) |
| Pairing screen | **absent** |
| Device row | same row, **PRIMARY / notifications / push token / active all preserved**; device count still 2 (**no re-pair**); **0** pairing codes consumed |
| `POST_NOTIFICATIONS` | granted |
| Check-in | `last_seen_at` refreshed ~30 s after reboot |
| App traffic | push-token re-registration plus `/today`, `/tasks`, `/health-summary`, `/devices`, `/briefs/current` |
| Crash buffer | **empty** |
| Production Health | intact — 137 daily rows, 0 observations, connection `active` |

Two environmental interruptions are recorded because they cost time and could mislead a later
reader, and neither is an application fault. The device rebooted into a **locked** state, so
the app sat behind the keyguard and could not reach credential-encrypted storage or the network
until first unlock — normal Android behaviour, cleared with a swipe (**no PIN was entered by
the agent**). A CipherOS **system-update dialog** ("3.47 GB") then appeared; it was dismissed
with Back and **`Download & install now` was never tapped** — no OS update was performed.

#### Minor findings from the device pass — recorded, not fixed

- **Task-row `Start` buttons measure 59×38** on clickable nodes, under the app's own 44 px
  convention. `hitSlop` is not reflected in `uiautomator` bounds, so the effective target may
  still clear 44; it needs a hardware design pass to settle. Pre-existing, not a regression —
  this APK's application tree is byte-identical to the audited RC.
- Two measurement traps worth writing down so they are not re-litigated: a naive grep for a
  button's `text=` returns the inner `Text` node, which is much smaller than its touchable
  parent (Capture read 61×23 as text but **94×52** as the clickable node); and a substring
  search across a raw `uiautomator` dump matches **numbers inside `bounds=` coordinates**,
  which is what produced a spurious "422 on screen" reading.
- `uiautomator` captures only the rendered viewport of a virtualized list, so a single dump
  cannot prove a section absent. The Settings Health card and the lower Today sections both
  read as "absent" until the screen was walked viewport by viewport.

#### Smoke data

Both smoke captures and their committed entities were removed in one count-verified pass —
1 task, 1 note, 2 inbox rows — returning production to its exact pre-smoke baseline
(inbox 6, tasks 2, notes 3, occurrences 0) with **zero residue and zero orphan occurrences**.
Device-side UI dumps were deleted from `/data/local/tmp`; no `adb reverse` or `forward` mapping
remains; the pulled v6 APK was deleted locally while the audited v7 artifact is preserved.

**The pre-6.7B production snapshot is retained by explicit owner instruction** and was not
deleted.
#### Post-deployment monitoring milestone — registered

Per ADR-051 the seven-day refresh-token longevity is **not** a pre-deployment gate and is
**not claimed as passed**. It is post-deployment monitoring, and the nominal milestone is:

```text
2026-09-04T20:08:25Z
```

At or after that instant, perform the smallest harmless production-mode refresh/read on the
same token lineage. Any earlier `invalid_grant`, unexpected reauthorization prompt, credential
loss, refresh failure or scope loss on this connection is a **production incident**. No new
scheduler, cron or application feature was added to track this — it is an operational note.

One honesty note on the production credential: the bounded sync proves **authorization and
read** against the production access token. A *forced* refresh grant was **not** exercised in
production, because doing so would require running a temporary script inside the api container
and ADR-051 already assigns longevity to monitoring. The refresh token is stored (103 B
ciphertext) and will be exercised naturally by the hourly cron once the access token expires.
`pre-deployment wait: waived_by_owner` · `immediate production-mode authorization + read:
verified` · `production forced-refresh: not exercised` · `seven-day longevity:
deferred_post_deployment`.

#### Cleanup and final state

Removed from the production host: the release tar, the digest temp files, the build log, and
**`/home/himallinux/personal-os/.env.pre-6.7b`** (the temporary credential backup taken before
provisioning). The live `.env` retains its three Health keys, mode `600`, owner unchanged.
Removed locally: the release archive, the extracted APK working tree and the scratch files. No
repository api, worker, Metro, Expo, watch or test process is running; ports 3000/8081/8082/
5173/19000/19001 are free; no `adb reverse` mapping exists. The only non-project container on
the host is the pre-existing exited `hello-world` from Phase 0.

**One artifact deliberately retained, and flagged for an owner decision:**
`/home/himallinux/personal-os-deploy-snapshots/pre-6.7b-20260829T060033Z.sql.gz` (1.6 MB, mode
600). It is a plain `pg_dump` of production and therefore contains real data. It was kept as
rollback insurance while the Rabbit lane is still open. ADR-024 forbids a backup *system*, and
a lingering dump is drift in that direction, so it should be deleted once the checkpoint fully
closes unless the owner decides otherwise.

Final production state: four containers running — api `608bf044a82e`, worker `2122152c78ce`,
web `2eee2b4490e7`, postgres `404de24ef86b` — api bound `127.0.0.1:3000`, web
`127.0.0.1:8081`, Postgres publishing no host port, Tailscale Serve tailnet-only on both
routes, no Funnel, no public ingress.

#### Checkpoint 6.7B closure (2026-08-30)

Production deployment and Rabbit acceptance were approved by the owner. This section records
the closure actions; no application code was modified or redeployed.

**Rabbit `versionCode 7` — installation and reboot proof PASSED.** Installed in place with
`adb install -r` only: versionCode 6 → 7, `firstInstallTime` unchanged at
`2026-08-19 16:26:10`, `lastUpdateTime` advanced, signature identical, pairing/PRIMARY/push
token/session all preserved with no re-pair and zero pairing codes consumed. The reboot proof
passed with Tailscale auto-starting, both install timestamps unchanged, the session preserved
and an empty crash buffer. Full evidence is in the Rabbit sections above.

**The `Start`-button finding is CORRECTED as verified — the effective target meets 44×44 dp.**
The Today-screen `Start` control is the daily/weekly review entry banner's button
(`apps/mobile/src/app/(tabs)/index.tsx`, the `info.status === null` branch):

```jsx
<Pressable onPress={() => router.push(href)} hitSlop={8} accessibilityRole="button"
  className="rounded-lg bg-blue-600 px-3 py-2 active:bg-blue-700">
```

The device reports physical density 320 with **override density 190**, so the dp→px scale is
`190/160 = 1.1875`. The measured `uiautomator` bounds of 59×38 px are therefore
**49.7 × 32.0 dp of visible box**. `hitSlop={8}` expands the touch rectangle by 8 dp on every
side — **+16 dp per axis** — giving an effective target of **≈65.7 × 48.0 dp (78 × 57 px)**,
which clears 44×44 dp in both dimensions. The second instance (59×37 px) computes to 47.2 dp
tall and also clears.

The reason the raw measurement understated it is that **`uiautomator` reports the visible
bounds, never the hit rectangle**, so `hitSlop` is invisible to it. The 44 dp vertical margin
is thin (48 vs 44), and the visible box alone is below 44 dp, so this remains worth a
deliberate design decision later — but it is **not** an accessibility defect and is **not**
carried into Phase 7 as debt.

**The one-off pre-migration snapshot was deleted after final acceptance.** Exactly one matching
regular file existed at `/home/himallinux/personal-os-deploy-snapshots/`; its SHA-256
(`7391d09f…`), size (1 638 384 B) and mode (600) were each re-verified immediately before
removal, it was confirmed to be a regular file (not a symlink) outside any repository, and its
contents were never printed or inspected. It was removed with a single non-recursive `rm` on
that exact path — the directory and everything else were left alone — and its absence was
confirmed afterwards, with no temporary copy remaining anywhere on the host.

**ADR-024 is therefore restored in full: Personal OS retains no backup system.** The snapshot
was a point-in-time artifact for this one deployment and never became infrastructure; no
backup policy, schedule or tooling was added, and the (now empty) snapshot directory holds
nothing.

Production was untouched by the closure: all four container IDs, image digests and restart
counts are unchanged, `personal-os_postgres_data` retains its original identity, the migration
journal is **14** with `0013` present exactly once, application data is unchanged, there are
zero failed jobs, and the API, web and both tailnet-only Serve routes are healthy.

**Deferred and outstanding — unchanged by this closure:**

- **OAuth privacy-policy URL still serves HTTP 404** and remains deferred branding/compliance
  debt. Google's own consent screen corroborates it. No policy was fabricated and no Console
  URL was changed.
- **Post-deployment monitoring remains scheduled for `2026-09-04T20:08:25Z`** (ADR-051).
- **Seven-day refresh-token longevity is NOT claimed as passed.** Immediate production-mode
  authorization and read are verified; longevity is post-deployment monitoring, and any
  `invalid_grant`, unexpected reauthorization, credential loss, refresh failure or scope loss
  before then is a production incident. A *forced* refresh grant was never exercised in
  production; the hourly cron exercises refresh naturally.
- Raw intraday heart rate stays excluded (`heart-rate-intraday` disabled, zero runs ever),
  `health_observations` stays empty, and F5 capture 2 remains absent.

**Phase 7 has not begun.** No Phase 7 work was planned, scoped or started.

### Checkpoint 6.7A — Fable release audit + OAuth production transition (audit phase COMPLETE, 2026-08-28)

Split from Checkpoint 6.7 by explicit user direction: 6.7A is the full release-candidate
audit plus the OAuth Testing→Production publishing and the start of the mandatory seven-day
token-longevity observation. **Production deployment (migration `0013`, api/worker/web
rollout, Rabbit versionCode 7) stays blocked until the post-publishing token survives seven
complete days.** No migration — the level stays 14 `.sql` / 14 journal entries. No scope,
callback or credential change. `versionCode` untouched at **6**.

**Branches.** Work began on `phase-6-production-readiness-6-7a` from `main` at `c250fa2`.
Mid-checkpoint the user directed a commit-prefix independence verification (below), which
led to a repaired linear branch, **`phase-6-production-readiness-6-7a-linear`**, also from
`c250fa2` — that branch is the release candidate. The original branch is preserved
unmodified as the audit record and is never merged. Neither branch is merged to `main`.

#### The audit

Six parallel read-only sub-agent lanes (route/test inventory · accessibility/touch-target ·
health UX and missing-vs-zero · security/provider-boundary · error-state/navigation ·
restriction checklist), plus integrator-owned lanes: live browser pass (desktop + 480×640 +
dark), dev-database invariants, and the physical-device preflight. Inventory: 23 mobile
routes, ~90 API routes, 140 test files. The restriction sweep passed all seven items
(no `health_observations` write path; no `0014`; versionCode literals only in the two known
Expo-module gradle files; no credential values in committable files; the UI-test/production
build guard intact; the three read-only scopes exact in `google-health-catalog.ts`).

#### Findings and dispositions

**Fixed (all verified by focused tests, typecheck, and the full gate):**

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S1 | P1 | `capture.parse`/`ptt.transcribe` rethrew raw provider errors (AI SDK `responseBody`/`requestBodyValues` — the user's own capture text — and the STT vendor's response body) into pg-boss's durable `job.output`; the exact class 6.3 fixed for health and 6.5 for calendar, never extended to these two older jobs | `AiJobError` + `withAiJobErrorContainment`, applied in both factories, mutation-proven; the two tests pinning the raw rethrow corrected in the same commit |
| H1 | P2 | After a reconnect (which disables every stream by design) the dashboard said "Connected" with a Sync button whose queued job the worker silently skips — the 6.6-recorded trap, with no detectable state client-side | Additive `enabled_stream_count`/`stream_count` on `HealthConnectionSummarySchema`; new `no_streams_enabled` display state ranked after `needs_reconnect`, `canRequestSync` false; honest copy in the card and the Settings health line |
| H3/E2 | P2 | Health "Sync now" read only `isPending`/`isSuccess`; a failed request (offline, 409, 503) re-enabled the button silently | `errorNotice` on the connection card, latched until the next attempt |
| E1 | P2 | The three Settings calendar cards showed a permanent error line with no Retry (6.5's fix covered only the Devices list) | Devices-pattern Retry on all three |
| A1/A2 | P2 | Today's completion circle and the Agenda row's Complete/Skip/+1-day computed pending flags but never bound `disabled` — rapid taps fired concurrent mutations | `disabled` bound on all four controls |
| AY8 | P2 | "Cancel this occurrence" fired unconfirmed from the recurring-event action sheet, unlike Archive on the same screen | Same `Alert.alert` gate |
| AY1/AY2/AX6 | P2/P3 | Recurrence editor: the three Ends buttons and the replace-custom-rule button under 44px; Ends buttons missing role/selected state | `min-h-[44px]` + role + `accessibilityState.selected` |
| AY5 | P2 | Agenda project-filter chips conveyed selection by color alone with nothing in the accessibility tree | role + selected state, both chip shapes |
| AY6 | P2 | The calendar "today" marker was a blue circle only | ", today" in the month cell label; accessible week-header day nodes |
| AX5/AX7 | P3 | PTT's accessible name was static regardless of state; FAB/PTT had no explicit role | Status-driven label; `accessibilityRole="button"` on both |
| AY11 | P2 | Five Settings diagnostics buttons (Flush now, Register push, Remote test, both Schedule tests) had no busy guard — raw async calls with no mutation object | `useBusyPress` single-flight hook (ref-guarded re-entry) + harness tests |
| — | — | Full-gate flake: all 21 "Overdue pool" review fixtures shared one `dueAt`; the overdue sort breaks ties on a UUID key, so the 20-item slice dropped "pool 0" ~1 run in 10 (pre-existing since 5.3) | One-minute spacing; five consecutive green runs |

**Deferred with rationale:** H2 (backfill/disconnect/stream-toggle/connect have no client
UI — **ratified here as a deliberate scope decision through 6.7**, per 6.4's recorded
"deliberately NOT done"; server-side operation is the contract until a separately approved
checkpoint builds the UI). AX3/AX4 (month-grid chips ~24-26px, week-grid short blocks
~28px, 40px hour slots — density tradeoffs where larger hitSlop would overlap stacked
siblings; day-cell tap and Agenda provide alternate access; needs its own design pass on
hardware). A8/AY9/AY10 (list-row Archive/Drop unconfirmed — standing recorded debt awaiting
its own product decision). S2 (worker top-level `console.error` lacks serializer
discipline — informational; fires only on startup paths). Observation, not a defect:
Agenda's overdue section is range-bounded (its 5.4-audited contract); Today remains the
all-overdue surface.

#### A masked typecheck failure, and the commit-prefix verification it forced

During the H1 work a `pnpm typecheck | tail` pipe masked a real failure and the commit
landed anyway. The user directed a full commit-prefix independence verification. Result:
the masked failure had **never entered history** — it lived only at intermediate commit
`9efb96e` (TS2741/TS2366: `settings.tsx` missing the new union member, plus stale
`api-client` dist types) and was folded in by `--amend` before the next commit existed.
All five original prefixes passed build + typecheck + focused tests independently.

**But the sweep then surfaced a real entanglement of the 6.5 class:** the S1 containment
commit changed the throw contract while two existing worker tests still pinned the raw
rethrow, so prefixes from `ece935c` onward failed the full worker suite (2 of 159) until a
later test-correction commit. My earlier "all prefixes pass" had run only the new
containment test file — corrected here. Repaired by the 6.5 linearization pattern: the
containment fix and its test corrections were combined into one commit on
`phase-6-production-readiness-6-7a-linear`, every other commit cherry-picked in order with
**zero conflicts**, and the final trees proven **byte-identical**
(`73b24d45e173dd66a1c4b39597bb12858e8c2a4e` on both branches, empty diff). Every linear
prefix passes build + typecheck + its focused tests, including the full worker suite at
the combined commit.

#### Verification actually run (linear HEAD)

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build 9/9, typecheck 17/17, lint **0 warnings** (three pre-existing warnings at base fixed rather than tolerated), `format:check` clean, `git diff --check` clean |
| 2 | Full suite, uncached and serial | **2055 tests / 17 turbo tasks** (2038 → **+17**), zero failing |
| 3 | No baseline decreased | core 326 · db 21 · schema 174 · calendar-providers **74** · health-providers 311 · ai-providers 25 · api-client 93 · api **496** · worker **159** · mobile **376** |
| 4 | Web export | clean, exactly one `index.html` |
| 5 | Secret scans | `gitleaks git` **174 commits, no leaks**; working tree 80 findings in 5 files, **0 in any committable file**, classified with `git check-ignore` |
| 6 | Android | `assembleRelease` of the side-by-side UI-test identity: BUILD SUCCESSFUL (653 tasks) |
| 7 | Live browser pass | Paired a real web device against the dev API: Today, Health dashboard (honest per-tile missing-vs-never copy, wake-date sleep), Settings (health line, diagnostics, calendar cards), Calendar month + Agenda — at desktop, 480×640 and dark; console clean except the documented `GET /briefs/current` 404→null convention. Pass artifacts removed count-verified (5 Android device rows preserved, 0 pairing codes) |
| 8 | Dev-DB invariants | connection active · 18/19 streams enabled · `heart-rate-intraday` disabled, 0 runs ever · `health_observations` **0** · migrations tracked 14 · 0 advisory locks |
| 9 | Physical Rabbit (bounded) | Side-by-side `com.himal.personalos.dev` release UI-test APK built at the linear HEAD with the UI-test flag baked (the package-isolation assertion passed at launch); Today, Settings (health line, all five diagnostics buttons), the Health dashboard (live dev data through `adb reverse`, honest per-tile states) and the New Task recurrence editor (Daily preset -> Ends buttons) all rendered with **zero crash-buffer entries**; `.dev` uninstalled afterward, tunnel cleared, and production `com.himal.personalos` **never targeted** — versionCode 6, `firstInstallTime 2026-08-19 16:26:10`, `lastUpdateTime 2026-08-24 05:17:43` byte-identical before and after |

The browser-pass web device and all pairing codes were removed count-verified (5 Android
device rows preserved); the dev database's health tables were read, never written.

#### OAuth production transition — blocked_external at the Console step

The audit phase closed with the frozen RC, but the OAuth lane could not start: publishing
requires the user's authenticated Google Cloud Console session, the Claude-in-Chrome
extension was not connected, and the sandboxed browser pane has no Google session (signing
in there would mean handling the user's password, which is prohibited). Nothing was
published; the app remains in **Testing**, the local connection remains **active** on its
pre-publishing token lineage (re-minted 2026-08-27T06:51:49Z, Testing-mode expiry seven
days later), and no disconnect/reconnect was performed. The **seven-day clock has NOT
started.**

What resuming needs, in order: (1) the user connects Claude-in-Chrome (or performs the
Console steps themselves): project `personal-os-196cf` -> OAuth consent screen -> verify
status Testing, three read-only scopes and callbacks unchanged -> Publish app; (2) the
local reauthorization then runs the sanctioned disconnect->reconnect (the only path that
mints a post-publishing refresh token, since `needsForcedConsent` is false for an active
connection) against the loopback callback, reusing the same connection row; (3) streams
are re-enabled to 18 (reconnect deliberately does not restore them -- the state the new
`no_streams_enabled` card names); (4) one bounded manual sync pass proves the new token;
(5) the seven-day clock starts at the post-publishing token issuance instant. Production
migration `0013`, api/worker/web rollout and Rabbit versionCode 7 stay blocked until that
token survives seven complete days.

#### OWNER DECISION (2026-08-28) — seven-day pre-deployment gate superseded; OAuth published to Production

The project owner amended the Checkpoint 6.7 acceptance, superseding the mandatory
seven-day pre-deployment token-longevity gate recorded by 6.6 and above:

- **OAuth must be In Production before deployment** — done this session (below).
- **Immediate post-publishing authorization and a bounded synchronization remain
  mandatory** — done and verified this session (below).
- **Seven-day longevity is NOT claimed as passed.** Residual longevity verification is
  accepted for deployment and **moved to post-deployment monitoring**.
- Any later `invalid_grant`, unexpected reauthorization prompt or credential failure on
  this connection **must be treated as a production incident**.
- **No second development OAuth application, client, project, account or credential set
  exists or will be used.**

```text
pre-deployment wait: waived_by_owner
immediate production-mode proof: verified
seven-day longevity: deferred_post_deployment
```

**Publishing (2026-08-28, ~20:05Z).** The user signed the Claude browser pane into their
own Google session (credentials never handled by the agent); the agent then drove the
Console. Project `personal-os-196cf` verified; Data Access verified to hold **exactly the
three restricted Google Health read-only scopes** and nothing sensitive/non-sensitive;
the Clients page verified to hold only the five known clients, none created or deleted.
One new Google requirement surfaced: the new Auth Platform console **requires a homepage
URL and privacy-policy URL** before an external app may publish (revealed by the disabled
Publish button's tooltip). With explicit owner approval, both were set to
`https://personal-os.tail62a68f.ts.net` — display-only consent-screen links under the
**already-authorized** domain from 6.2; no logo, no terms link, no new domain, no scope,
callback, credential or client change. Branding saved, **Publish app -> Push to
production? -> Confirm**, and the status now reads **In production** (with the documented
"requires verification" advisory for an unverified production app; no verification was
submitted).

**Reauthorization (2026-08-28T20:08:25Z).** Disconnect -> reconnect on the retained row —
the only path that mints a post-publishing refresh token (`needsForcedConsent` is false
for an active connection). The authorize URL carried `prompt=consent`,
`access_type=offline`, the loopback redirect and the three scopes; the flow used the
existing "Personal OS Google Health Web" client and the same account; Google showed the
expected unverified-app interstitial (Advanced -> continue) and the consent screen listing
exactly the three scopes, all granted. The callback landed on the loopback and rebound
**the same connection row `cb1c90d4-…` with `created_at` still 2026-08-24T23:57:45.015Z**
— reused, not recreated, exactly one row; both credential triples complete (253B/103B
ciphertext); `identity_verified_at = 2026-08-28T20:08:25.239Z` is the post-publishing
authorization instant. History fully preserved: 188 daily rows, 1 session, 0 observations,
before and after.

**Live H1 evidence, in passing:** immediately after reconnect, `/health-summary` reported
`status: active, enabled_stream_count: 0, stream_count: 19` — the exact
connected-but-nothing-will-sync state this checkpoint's audit taught the dashboard to name.
The 6.6 stream-guard also fired live: enabling `heart-rate-intraday` was refused
`409 metric_out_of_scope`.

**Bounded synchronization (immediate production-mode proof).** With ONLY `steps` enabled,
one one-shot manual pass (`runHealthConnectionSync`, `boss: null` — the 6.6 process model;
no worker daemon, no cron, no fan-out) ran against the new credentials:
`skipped: null, streamsAttempted: 1, runsWritten: 1, streamsFailed: 0`; run row
`steps · manual · succeeded · 2 inserted · 33 unchanged · 0 rejected · 1 request`.

**Refresh path exercised for real (not simulated).** `resolveFreshHealthAccessToken` with
`force: true` — the existing 401-retry seam, no expiry metadata fabricated — performed a
genuine refresh grant with the stored post-publishing refresh token:
`access_token_expires_at` advanced 21:08:24Z -> 21:11:12Z, the refresh-token columns
byte-untouched (103B), status still active. Immediate authorization, read and refresh are
therefore **verified**; **longevity is unverified** and is post-deployment monitoring.
The nominal seven-day milestone for that monitoring is **2026-09-04T20:08:25Z**.

Afterward the remaining 17 streams were re-enabled: end state **18/19 enabled**,
`heart-rate-intraday` still false, summary `active, 18/19`. The two temporary one-shot
scripts were untracked and deleted; the frozen application tree (`bcf11fc`) is unmodified.
No token, authorization code (spent at exchange), provider payload, account email or
health value appears in any commit or this record.

### Checkpoint 6.6 — Bounded live Google Health proof (COMPLETE, local only, 2026-08-27)

Built on branch `phase-6-google-health-live-proof` from `4f90f9d` (main). **Not merged to `main`.**
No production access, no deployment, no OAuth publishing, **no scope change**, **no migration** — the
local level stays 14 `.sql` / 14 journal entries and production stays 0000–0012. `versionCode`
untouched at **6** — the *app's* versionCode is EAS-remote-derived (`appVersionSource: "remote"`,
`autoIncrement` on the production profile) and has no literal in tracked source. Two unrelated
`versionCode 1` literals do exist, in the `exact-alarm-status` and `google-calendar-auth` Expo
modules' own `android/build.gradle`; both are byte-unchanged by this checkpoint. `.env` unmodified and still on
the approved loopback callback. F5 capture 2 not run; raw intraday heart rate never enabled;
`health_observations` **0 rows throughout**.

Run against the **local development** database only: `127.0.0.1:5432/personalos`, Docker compose
project `personalosdashboard` whose working directory is this repository. Production is a remote host
under compose project `personal-os` with Postgres unpublished, so a loopback DSN cannot reach it.
The connected account is a development Google account, recorded here only as connection
`cb1c90d4-…` / `health_user_id` `236…00`.

Explicit user approval was obtained for the whole lane, for the 42-day range specifically, and for
the single revoke plus interactive consent the disconnect/reconnect lane required.

#### Process model — deliberately smaller than a running system

ONE short-lived built API (`node dist/index.js`, never `tsx watch`) served the routes. **No worker
daemon ran.** Each sync "pass" was a one-shot direct call to `runHealthConnectionSync(deps, data)` —
the exact function the pg-boss handler invokes — with `boss: null`, which is legal because the only
thing the pass uses `boss` for is a best-effort alert that returns immediately when it is null.

That removes a real hazard rather than merely being tidy: the worker's hourly cron fans out to every
active connection, and pg-boss fires a schedule once at boot if the process happens to start within
60 s after an hour boundary. A one-shot has no queue, no cron and no fan-out, so the number of Google
calls is exactly what the plan says it is.

#### The one range decision that needed its own approval

`total-calories` was chosen because its `maxRangeDays` is **14** — the smallest chunk in the catalog —
and because it is one of only four metrics that has ever returned data on this account, so a backfill
genuinely writes rows instead of proving the empty path. Its `earliest_verified_date` was `2026-07-21`,
which is the exclusive upper bound a backfill starts from.

`target_date = 2026-06-09` gives `[2026-06-09, 2026-07-21)` = 42 days = **exactly three chunks**.
Three is the minimum that can prove a cross-pass resume, because `BACKFILL_CHUNKS_PER_PASS = 2` would
consume a two-chunk range in a single pass. 3 × 14 = 42 is therefore the smallest range that can prove
it at all. That exceeds the session's 30-day default, which is why it was approved separately. Worth
recording precisely: **the 30-day limit is session policy, not a server rule** —
`HealthBackfillRequestSchema` is `{ target_date }` only and the API would not have rejected it.

#### Results

| Lane | Evidence |
|---|---|
| **Guard rails** | `backfill_already_running` (409), `backfill_target_not_in_past` (409) and `metric_out_of_scope` for `heart-rate-intraday` (409) all fired **and none mutated state** |
| **A — backfill** | Chunks exactly as predicted: `[07-07,07-21)`, `[06-23,07-07)`, `[06-09,06-23)`. 14 rows each, `rows_rejected = 0`, 14/14 buckets, 1 request and 1 page per chunk |
| **B — interruption / resume** | Cursor advanced to `2026-06-23` **in the same transaction as the chunk's rows** and survived a genuine process exit. Both committed chunks are **whole** (14/14); chunk 3's window held 0 rows — no partial commit exists |
| **C — cancellation** | Settles to `cancelled` with `backfillChunks: 0` and a run row carrying **`request_count = 0`** — no Google call was made after the cancel was accepted. All 28 already-imported rows intact. `backfill_not_running` 409s on an idle stream |
| **D — completed backfill** | Re-POSTing the same target resumed the cursor at **`2026-06-23`, not `2026-07-21`**, fetched only chunk 3, and settled `complete` with `cursor = target`. The run log shows chunks 1 and 2 **exactly once each** — never refetched |
| **E — incremental** | Ordinary warm pass, bounded window, watermark used, **zero** material writes against already-verified data |
| **F — idempotency** | Two identical cycles: **all 183 rows byte-identical** by `ctid`/`xmin`/`content_hash`/`updated_at` — **0 inserted, 0 updated, 0 tombstoned, 0 rejected, 141 unchanged, 0 duplicate identities** |
| **G — disconnect** | All six credential columns NULLed, `status = disconnected`, every stream disabled, identity retained. **Every health row byte-identical** (row counts, digests and backfill state all unchanged). A pass then skipped in 25 ms with `connection_not_active`, writing nothing; `POST /sync` 409'd |
| **G — reconnect** | Interactive consent by the user, same account. **Same connection row `cb1c90d4-…` with `created_at` still `2026-08-24T23:57:45.015Z`** — reused, not recreated; exactly one connection row. History neither duplicated nor lost. Post-reconnect, two more identical passes left **all 188 rows byte-identical** |

**One cycle mid-run updated exactly one row, and that is the mechanism working.** It was
`total-calories` on `2026-08-25` — the then-current, still-accumulating civil day — reported as
`rows_updated: 1, rows_unchanged: 12` in its chunk. The same phenomenon 6.3L recorded. The following
pair settled to a full zero across every row including that one.

#### A real defect, found only because the proof ran

`PATCH /health-connections/:id/streams` **accepted `{"metric":"heart-rate-intraday","sync_enabled":true}`
with HTTP 200 and flipped the column.** That contradicts the standing rule that raw intraday heart
rate stays disabled while F5 is unproven. The backfill route has refused reconcile-mode metrics
structurally since 6.3; this route simply had no equivalent guard.

The flag was **inert** — the worker selects streams through `isSyncableMetric`, which excludes
`sample_reconcile` **by mode**, so the stream is never fetched and `health_observations` was never at
risk. Confirmed on the live database: `heart-rate-intraday` has **zero sync runs, ever**, and
`health_observations` stayed at 0. But the endpoint still reported the stream as enabled to every
reader, which is a false statement about the system's own invariant. State was restored within
seconds and no pass ran in between.

Fixed by applying the **same mode-based guard** the backfill route uses, so a second reconcile-mode
metric added later is refused automatically rather than needing to be remembered. **Disabling is
deliberately left ungated**: a stream somehow enabled by an older build must always be switchable back
off, or the invariant would be unrecoverable through the API — which is precisely the call needed to
restore state during this proof.

**Both halves of the fix are mutation-proven, not asserted.** Disabling the mode guard fails exactly
two of the three new tests (the enable-refusal and the batch test) while the third — "still allows
disabling" — correctly keeps passing, which is what distinguishes this guard from a blanket rejection
that would have made the invariant unrecoverable. Separately, restoring the interleaved write while
leaving the guard intact fails exactly one test, the batch-atomicity one. Neither test can pass
against the pre-fix behaviour.

The fix also made the batch **validate-then-apply**. Previously each entry was checked and written in
the same pass, so a batch whose second entry was rejected had already committed its first, and the
caller received a 4xx describing a state the database had partly entered. That affected the
pre-existing `unknown_metric` and `scope_not_granted` guards too. Three regression tests cover the
refusal, the still-permitted disable, and the all-or-nothing batch; all three were then re-verified
against the **real running API**, not only under `inject`.

#### The adversarial review earned its place before a single call was made

An independent read-only reviewer attacked the execution plan against source and found **two defects
that would each have produced a false pass**:

1. **The post-reconnect idempotency step could not fail.** `disconnectHealthConnection` disables
   every stream, and `syncStreamsForGrantedScopes` deliberately does **not** restore `sync_enabled` on
   reconnect — it cannot distinguish a disconnect's blanket disable from a user's own choice. A pass
   with no enabled stream returns `skipped: "no_enabled_streams"` before any Google call and any write,
   so "0 material writes" would have been true because **nothing ran**. This was then **confirmed on
   live infrastructure**: after the real reconnect, `enabled = 0 of 19`, and a pass returned
   `skipped: "no_enabled_streams"` in 29 ms. The corrected plan re-enables the streams explicitly and
   asserts `skipped: null` with `streamsAttempted > 0` — which is what the recorded result shows.
2. **Every pass must be `trigger: "manual"`.** A 5-minute debounce skips a stream entirely when the
   kind is not manual, *before* the attempt counter increments and before a run row is opened. Passes
   E and F are back-to-back by design, so any other trigger would have made the idempotency proof
   vacuous.

It also confirmed by hand-trace the one genuinely subtle correctness property this checkpoint rests
on: `backfill_cursor_date` and `earliest_verified_date` advance **in lockstep**, because both are set
from the same `chunk.startDate` inside the same transaction, and both are gated on the same
`authoritative` check — so they cannot silently diverge. That is why the resume assertion is paired
with `rows_rejected = 0` on the earlier chunks; a non-authoritative chunk would have left the property
untested rather than proven.

#### A process failure worth recording: a sub-agent returned a fabricated report

One of the final read-only reconciliation agents returned a confident, well-formatted report that was
**almost entirely invented**. It made **zero tool calls** and claimed: that no Checkpoint 6.6 section
existed, that HEAD was `df08da8` (6.5's branch), that the branch was 16 commits ahead of `main`, that
`BriefInput` was `{ tz, now }`, that the OAuth scopes lived in
`packages/calendar-providers/src/google-health-catalog.ts` (a file that does not exist), and that a
user named `himallinux` — the *production server's* account, not this machine's — owned a running
process.

Every one of those was checked directly and refuted: HEAD `177980a`, 2 commits ahead, the 6.6 section
present, `BriefInput` carrying twelve fields and no health field, the scopes in
`packages/health-providers/src/google-health-catalog.ts`, and no repository process running.

The report is discarded in full and none of it informs this record. It is written down because the
failure mode is the dangerous one: a fabricated verification is worse than a missing one, since it
reads exactly like evidence. **The operative rule is that a sub-agent's claim is a hypothesis until
the integrator reproduces it** — which is why every repository-checkable number in this section was
re-derived first-hand rather than transcribed.

#### Privacy

No health measurement, token, ciphertext, authorization code, client secret or raw provider payload
appears in this record, in any commit, or in any terminal output that was retained. Evidence is
counts, dates, digests and state names only.

The genuine OAuth callback — carrying a real authorization code — was logged as
`?state=[redacted]&iss=…&code=[redacted]`. A scan of the complete live API log for `ya29.`, `1//`,
`refresh_token`, `client_secret`, `ciphertext`, `auth_tag` and `access_token` returned **0 hits**.
The disconnect response body carried **no** credential-bearing field.

#### The ≥7-day refresh-token requirement — `blocked_time`

Not met, and deliberately not manufactured. The token in the lineage was issued
`2026-08-24T23:57:45Z`; roughly two days have elapsed. The deeper point is structural: the OAuth app
is deliberately in **Testing**, where Google expires refresh tokens at exactly seven days, so
"seven complete days elapsed **and** the token still valid" is unreachable without a publishing-status
change — which this checkpoint forbids. The nominal earliest date, `2026-08-31T23:57:45Z`, **is** the
expiry instant.

The approved disconnect/reconnect additionally **supersedes that lineage**: reconnect always forces
`prompt=consent`, which mints a new refresh token and restarts the clock from
`2026-08-27T06:51:49Z`. That was disclosed before approval and accepted. No token was renewed merely
to restart the clock, and OAuth publishing status was not touched.

**Accepted and transferred (user decision, 2026-08-27).** Checkpoint 6.6's executable live-proof lanes
are **accepted as complete and merged to `main`**. This one requirement stays **`blocked_time`** and
moves to Checkpoint 6.7 as a **mandatory pre-deployment acceptance gate**. It does not block the merge
of the verified 6.6 work — it blocks deployment. The full gate definition is under "Carried into 6.7"
at the end of this file; the short form is that **production migration, production rollout and the
Rabbit `versionCode 7` installation must not begin until the gate passes.** Nothing about it is
claimed to have passed here.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build 9/9, typecheck 17/17, lint **0 warnings**, `format:check` clean, `git diff --check` clean |
| 2 | Full suite, uncached and serial | **2038 tests / 17 turbo tasks** (2035 → **+3**), zero failing |
| 3 | No baseline decreased | core 326 · db 21 · schema 174 · calendar-providers **74** · health-providers 311 · ai-providers 25 · api-client 93 · worker **152** · mobile 367 · api 492 → **495** |
| 4 | Zero-drift canaries | `calendar-providers` **74** and `worker` **152**, both unchanged |
| 5 | Migration invariant | 14 `.sql` / 14 journal entries; `packages/db/` diff vs `main` **empty**; no `0014` |
| 6 | Forbidden-area drift | **zero** across `app.config.ts`, `eas.json`, every compose file, every Dockerfile, `packages/db`, `apps/worker`, `packages/calendar-providers`, `apps/api/src/brief` |
| 7 | Web export | clean, single `index.html` |
| 8 | Secret scans | `gitleaks git` **153 commits, no leaks**; working tree 79 findings, **0 in any file git would commit** (74 in the gitignored generated `apps/mobile/android` tree, 5 in `.env`), classified with `git check-ignore`. The 153 is an **all-refs** count (`git rev-list --count --all`) taken at `11cd3bb`, before the two documentation commits — not the branch depth, which is why a later re-run reports 155 |
| 9 | Health invariants | `health_observations` **0**; `heart-rate-intraday` `sync_enabled = false` with **zero sync runs ever**; 18 of 19 streams enabled; scopes unchanged |
| 10 | Process / lock cleanup | no repository process running; ports 3000/8081/8082/5173/19000/19001 free; **zero advisory locks held** |

#### A pre-existing documentation defect, named but not fixed here

`docs/STATUS.md` has **two** `## Remaining warnings / technical debt` headings. The duplication
predates this checkpoint — it is already present at `4f90f9d` — and 6.6 added its bullets to the
second block, which is what every prior checkpoint did. Merging them is a whole-file documentation
edit with no bearing on the live proof, so it is recorded rather than done. A reader searching that
heading must check both blocks.

#### Deliberately NOT done

Not merged to `main`; no push (the repository has no remote); no branch deleted or rewritten. No
production Docker, SSH or migration command. No migration. No `versionCode` change, no EAS build, no
APK, no Rabbit install. No OAuth publishing and no callback change. No scope added or changed. F5
capture 2 not run; raw intraday heart rate never enabled; nothing written to `health_observations`. No
health data reaches the Daily Brief. Checkpoint 6.7 not begun.

### Checkpoint 6.5 — Full product audit, Rabbit verification and hardening (COMPLETE, local only, 2026-08-25)

Built on branch `phase-6-audit-hardening` from `d5e4cb5` (main, with 6.4 already fast-forwarded
in). HEAD `df08da8`, 16 commits, **not merged to `main`**. No production access, no deployment,
no OAuth publishing, **no live Google call**, **no migration** — the local level stays 14 `.sql` /
14 journal entries and production stays 0000–0012. `versionCode` untouched at **6**; `.env` still
on the loopback callback; `health_observations` still empty; `heart-rate-intraday` still
`sync_enabled = false`; F5 still holds `capture-1.json` only.

Nineteen sub-agents across three waves: nine read-only discovery/audit agents, five implementers
under strictly disjoint file ownership, and five adversarial/verification agents. The integrator
owned every shared file — schemas, route registration, navigation, dependencies, `pnpm-lock.yaml`,
Android config, docs — plus every commit and every database-backed test run.

#### The headline: Google's own prose was reaching the screen

`calendar_connections.last_sync_error` was a free-text column used two incompatible ways at once.
Three worker sites wrote `err.message` into it; for Google that message is
`parsedError.error_description`, lifted verbatim out of the token endpoint's JSON error body. The
API projected the column, and Settings interpolated it into the "Reconnect Google Calendar"
banner. `docs/STATUS.md` had recorded the render site as known debt; the audit found it was the
**terminal sink of a seven-hop chain**, not a display nit.

Two further hops were worse than the recorded one, and neither was known:

- **`POST /calendar-connections/google` and `/caldav` returned `message: err.message` outright** —
  a synchronous leak at connect time needing no database round trip at all.
- **pg-boss persists whatever a failing handler throws.** `mapCompletionDataArg` hands it to
  `serialize-error`, which copies every own-enumerable property, so an escaping `CalDavError`
  wrote its `responseBody` — the provider's full raw response body — into `pgboss.job.output`, a
  durable Postgres table. `HealthSyncJobError` has contained exactly this for the health pass
  since 6.3; the three calendar jobs predate that discipline and never got it.

The fix is structural rather than a review rule. `CalendarSyncErrorCode` is a closed enum of
twelve **actionable** states (never HTTP statuses — two failures a user would respond to
identically share a code). `CalendarConnectionSchema` types the wire field as that enum rather
than `z.string()`, so an accidental leak becomes a **parse failure at the API boundary** instead
of a silently-passing free-text field — the same trick `HealthMetricPointSchema`'s state refine
uses to make a fabricated zero inexpressible. `sanitizeCalendarSyncErrorCode` collapses anything
unrecognised to `provider_error`, which is what makes rows written by earlier builds safe **with
no data migration**. Classification reads the provider's *structured* fields — `googleErrorCode`,
`googleReason`, `isConflict` — never a human message, which is the check that breaks silently the
first time a vendor rewords an error; HTTP status is the last resort, because a Google 403 is
usually a scope problem while a CalDAV 403 is a plain refusal and CalDAV has no scope concept.

**One existing test asserted `expect(lastSyncError).toContain("revoked")` against a fixture whose
`error_description` is "Token has been revoked".** It was pinning the leak as correct behaviour.
Corrected, not loosened, and it now asserts the prose is absent.

#### The log was leaking too, and the first fix was breakable

`buildLoggerOptions` overrode only `req`. Fastify **merges** custom serializers over its own
defaults, so `err` silently kept `pino.stdSerializers.err` — which emits type/message/stack, then
copies every own-enumerable property of the error, then attaches the untouched original as `.raw`.
`GET /calendar-connections/:id/available-calendars` has no local catch and neither provider error
class exposes a numeric `statusCode`, so both miss the error handler's 4xx branch and reach
`request.log.error({ err })` carrying Google's message or CalDAV's raw body. A `pg` constraint
violation on the same line would carry `detail`, i.e. the user's own task titles and capture text.

The replacement emits exactly four allowlisted fields. **The adversarial review then broke it.**
The first version stripped the stack's header by keeping only lines starting with `at ` — but V8
puts `<name>: <message>` at the head of the stack, and a provider-controlled message containing
its own line shaped like `    at attacker (leak-<secret>.js:1:1)` passes that filter intact. It
was reproduced live against the real function. Provider-authored errors now have their stack
withheld outright, and for errors we author the header is removed **by length** — exactly
`${name}: ${message}`, however many lines that spans — with the frame filter as a second layer
rather than the only one. The test asserting the old behaviour encoded the disproved premise and
was corrected.

A Fastify subtlety worth recording: `SerializedError` must carry Fastify's index signature **and**
a non-optional `stack`. Without both, the options object stops matching Fastify's overload and
`Fastify()` silently resolves to its **HTTP/2** signature, breaking every downstream
`FastifyInstance` annotation in the app. That surfaced as ~20 unrelated-looking type errors.

#### Every other provider-connection surface got the same sweep

`POST /ai/providers/:id/test` returned `err.message` off a vendor SDK — the one route whose whole
job is to call a user-supplied endpoint with a user-supplied key. Now a bounded classification.
Health was **already** disciplined (`markHealthConnectionNeedsReauth` documents that Google's prose
must not reach a stored column), but the pre-6.4 connection-management routes still projected the
raw string, a wider contract than the architecture's own rule. Unlike calendar there is no closed
enum to freeze — the health failure-class set legitimately grows, and ADR-050 keeps it out of a
CHECK — so what is enforced is the **shape**: a lowercase machine token with an optional
`:`-qualifier. Prose cannot satisfy it, so a future writer that reaches for a message fails there
rather than on a user's screen.

#### The product audit found a P1 dead end nobody had noticed

The task, note and event **detail screens** gated on `isLoading || !item` and never read `isError`.
The query hooks retry, then settle to `isError: true, data: undefined` — so `!item` stays true
forever and the screen spins permanently with no message, no retry and no way out but Back. It
reproduces on any unreachable API **and on a deep link to a deleted id, which is exactly what a
stale reminder notification is.** Branch order is now loading → error → not-found → content.

Also fixed across 29 mobile files: no destructive action in the app had a confirmation (Revoke,
both Disconnects, Forget-this-device, and four Archives now confirm, with copy that is honest per
type — only projects have an Archived section to restore from, so only that dialog promises one);
a revoked device could not recover, because the auto-clear path lives on a device card that cannot
render once the device list itself 401s; six sites put `API error 422: google_oauth_failed` on
screen; five list screens had no Retry; ~28px selection chips in seven files, 36px recurrence
weekday circles, and 40px review/agenda rows all sat under the app's own 44px convention while
signalling selection by colour and weight alone; `text-neutral-400` with no dark variant is about
2.5:1 on white and was used for **empty-state copy**, often the only text on screen; and the
hour-gutter labels were 9px at that same ratio.

#### The adversarial wave earned its keep

Beyond the serializer escape, an independent review of the parallel UI work found seven real
defects that existed **because each lane could only see its own files**: Retry offered on a
terminal 404 in three screens (the same commit had already got it right in a fourth); fourteen
Retry buttons drifted into four shapes; Settings kept the one error state with no Retry, on the
file most heavily reworked; the FAB badge relied on `pointerEvents="none"` to stay out of the
accessibility tree, which it does not — that governs touch dispatch, and a bare `<Text>` stays
discoverable, so removing its label left a screen reader able to land on a context-free count; the
Settings gear, mounted on every tab, had no accessible name and sat in a file no lane owned; chips
got `min-h-` but not `min-w-`; and the Google Calendar link error still interpolated
`ApiClientError.message`.

**A regression the full suite caught, which review had not.** `usePlaceholderColor` reaches
`nativewind`, whose entry point the mobile vitest transform cannot parse — importing it throws
`SyntaxError: Unexpected token 'typeof'` and takes the **whole suite file** to zero tests.
`events-screen.test.tsx` and `recurrence-editor.test.tsx` both collapsed. Aliased to a mock, the
route already taken for `expo-router`, with a guard test that names the reason if the alias is
ever dropped.

#### Physical Rabbit R1 verification — the gap 6.4 left open

Run on the real device (Android 16 / SDK 36, 480×640, density override 190) through the
established side-by-side `com.himal.personalos.dev` UI-test identity. **Production
`com.himal.personalos` was never targeted by any install, uninstall, clear, force-stop or data
command**, and its evidence is identical before and after: versionCode `6`, versionName `1.0.0`,
`firstInstallTime 2026-08-19 16:26:10`, `lastUpdateTime 2026-08-24 05:17:43`, dataDir unchanged.
The dev package was uninstalled afterwards, the pushed APK and UI dumps removed, and the `adb
reverse` mapping cleared, leaving only the production package installed.

A release-mode UI-test APK was used rather than a debug build, so **no Metro or other watch server
was ever started** — the API ran as a single one-shot `node` process against the local dev
database, and **the worker was never started, so no scheduled fan-out and no Google call was
reachable**. Values are deliberately not reproduced here.

| Workflow | Result |
|---|---|
| Cold launch, existing session | Launches to Today with live dev-API data through `adb reverse`; zero crash-buffer entries |
| Five tabs | Today / Inbox / Notes / Projects / Calendar all render and switch |
| Health entry from Settings | Settings' Health card shows the safe copy and "View health data" links through |
| Health summary | Connection card reads "Connected" + "Data through <date>" — **no error string of any kind** |
| **Missing vs true zero** | Two DIFFERENT sentences on screen: "Today hasn't been synced yet" for a metric with history, "No data has reached Google Health for this yet" for one without. **Not one fabricated zero** |
| Last-recorded line | Rendered **alongside** the missing words, never instead of them |
| Health trends | Range selector labelled ("Show the last 7/30/90 days"); every chart mark carries its own per-day `accessibilityLabel` |
| Sleep | Honest empty state, "Last 30 days, **by wake date**" (ADR-049) |
| Workouts | Honest empty state plus the note attributing the missing stage/zone detail to Personal OS |
| **404 detail screen** | "This task couldn't be found." with **no Retry button** — the terminal-404 fix, live |
| **Offline / API unavailable** | API stopped → "Couldn't load the inbox." + a labelled 74×52 Retry → API restored → Retry tapped → real data loaded |
| Calendar direction buttons | "Previous month" / "Next month" / "Jump to today", 53×53 |
| FAB / PTT | 58×58 each, 314px apart, correctly labelled; PTT inert (`layoutOnly`, no `RECORD_AUDIO` in the manifest) |
| Back navigation, app resume | Both correct; resume returns to the same screen |
| Side button / scroll wheel | No workflow depends on either — the app is touch-only by construction (Checkpoint 3 proved both are claimed by the OS) |

**One defect was found only on the device**: the quick-capture modal's Cancel and Capture buttons
measured 84×39 and 94×39 — the last step of the app's most-used flow, in a modal no audit lane
owned. Fixed and committed.

**An honest limitation of this lane:** UI-test mode does not mount pairing, notifications or push,
so the Settings **device** rows, the revoked-session banner and the reminder paths could not be
exercised on-device. They are covered by unit tests and by the browser-equivalent evidence only.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build 9/9, typecheck 17/17, lint **0 warnings**, `format:check` clean, `git diff --check` clean |
| 2 | Full suite, uncached and serial | **2035 tests / 17 turbo tasks** (1965 → **+70**) |
| 3 | No baseline decreased | worker 145→**152**, schema 162→**174**, api 466→**492**, mobile 359→**367**, api-client **93**, core **326**, db **21**, ai-providers **25**, health-providers **311** |
| 4 | `calendar-providers` canary | 57→**74** — moved **deliberately**: this checkpoint's whole subject is the calendar error path. No test was removed |
| 5 | Migration invariant | 14 `.sql` / 14 journal entries; `packages/db/` diff **empty**; no `0014` |
| 6 | Forbidden-area drift | **zero** across `apps/mobile/app.config.ts`, `eas.json`, every compose file, every Dockerfile, `.github/`, `packages/db` |
| 7 | Brief / AI isolation | `apps/api/src/brief/**` diff **empty**; zero "health" hits in that directory; `BriefInput` carries no health field |
| 8 | Health invariants | No write to `health_observations` anywhere (one comment only); `heart-rate-intraday` still excluded by acquisition mode; **no OAuth scope added or changed** |
| 9 | Dependencies | Exactly one addition: the internal `@personal-os/schema` **workspace** edge on `calendar-providers` (server-only; mobile never reaches it). Lockfile +3 lines. **No new registry package** |
| 10 | Web export | Clean, single `index.html` |
| 11 | Android | Release UI-test APK built successfully via Gradle (JDK 17) |
| 12 | Secret scans | `gitleaks git` **130 commits, no leaks**. Working tree 76 findings, **0 in any file git would commit**, classified programmatically with `git check-ignore` |
| 13 | Process/port cleanup | No repository api, worker, Metro, Expo, watch or test process left running; ports 3000/8081/8082/5173/19000 free; `adb reverse` cleared |

#### A defect in this branch's HISTORY — found, then repaired without rewriting

The final independent audit found that commit `7c6ba30` **does not build in isolation**: it adds
`withCalendarJobErrorContainment` imports to the three calendar jobs, but the module they import is
not created until the next commit, `180b5b2`. The two commits are entangled — the wrapper CALLS live
in the earlier one — so ordering cannot separate them; only combining can. `git bisect`, a
cherry-pick, or a partial revert landing on `7c6ba30` hits a module-resolution failure.

**Resolved by linearization, not by rewriting.** `phase-6-audit-hardening` is left exactly as
audited at `189d954` and was never rebased, reset, force-updated or deleted. A separate branch,
**`phase-6-audit-hardening-linear`**, was built from `main` by replaying the audited history in its
original order, with `7c6ba30` and `180b5b2` applied together and committed once as
**`fix(calendar): sanitize and classify provider sync errors`**. Every other commit was cherry-picked
individually, in order, **with zero conflicts**. That repaired branch is what integrates to `main`;
the original audited branch is never merged.

**The application code is provably unchanged.** The replayed branch's tree object before the
documentation correction is `f93a07dd349d18b1f5110077861c4bc66ebbde28` — **identical to
`189d954`'s**, with an empty `git diff` between the two commits. Application, package, Android,
configuration and lockfile content are therefore byte-for-byte the audited tree, and the only
deliberate difference on the repaired branch is this documentation correction.

**Test counts and audit evidence below are unchanged and were NOT re-run.** The full 2035-test gate
recorded here was run against the audited tree, and the repaired tree is proven identical to it, so
re-running it would re-measure the same bytes. What WAS run, on the combined commit specifically and
before any further replay, is the focused proof that it now builds where `7c6ba30` did not: build
9/9, typecheck 17/17, `calendar-providers` **74**, `schema` **170** (the health token suite arrives
two commits later, at `5bec9bc`), and the four DB-backed worker calendar suites **41**.

Two narrower windows of the same kind existed on the original branch and are dissolved by the
replay only insofar as the combined commit removes the build break; they remain historical facts
about `phase-6-audit-hardening`: `events-screen.test.tsx` and `recurrence-editor.test.tsx` report
zero tests between `c2dbb81` and `6fa07e0` (the nativewind alias lands in `1e91c1b`), and the three
detail screens offer a Retry on a terminal 404 between `802a931` and `76d8073`. Neither survives to
HEAD on either branch.

One commit message still overstates its scope, on both branches: `76d8073` says it covers
`calendar_event_instances.last_sync_error`, but that column has no write site anywhere in the worker
and the diff only touches `event_external_links`.

#### Deliberately NOT done

The original `phase-6-audit-hardening` branch is never merged; integration to `main` is a
fast-forward from `phase-6-audit-hardening-linear`. No push (the repository has **no remote**),
no branch deleted, no history rewritten. No production
Docker or SSH command. No migration. No `versionCode` change and no EAS build. No OAuth publishing
and no callback change. F5 capture 2 not run; raw intraday heart rate not enabled.

### Checkpoint 6.3 — Google Health sync engine (COMPLETE, local only, 2026-08-25)

Built on branch `phase-6-google-health-sync` from `296380c`. **Not merged to `main`.** No
production access, no deployment, no OAuth publishing, no live Google call, **no migration** — the
local level stays 14 `.sql` / 14 journal entries and production stays 0000–0012.

**Two ADR amendments were required and were approved before implementation**, because 6.3 needs
behaviour the originals forbid and reading around a Locked decision is not permitted:

- **ADR-046a** — a fully fetched, rejection-free, non-hot daily window returning zero buckets may
  create verified-absence rows, **insert-only**, never downgrading an existing `has_data = true`
  row, still clamped by `first_data_date` and `lastGloballyCompleteDateExclusive`.
- **ADR-047a** — a soft, reversible `deleted_at` marker reflecting a provider-side deletion is
  reconciliation, not the automatic deletion ADR-047 forbids. Permitted only for
  `external_key_source = 'data_point_name'`, only on an authoritative warm/manual window, only with
  a non-empty seen-key set, never on hot, cleared on reappearance, row retained indefinitely.

#### What was built

One **connection-level** queue and job, `health.google.sync-connection`, `policy: "stately"`,
`singletonKey = connectionId`, hourly cron fan-out. A per-stream job would have let all eighteen
streams of one connection hit the provider concurrently; walking them sequentially inside one job
makes "no overlapping syncs for the same connection" true by construction rather than by
convention, and a namespaced `pg_try_advisory_lock` on a pinned pool client guards what pg-boss
cannot see.

**There is no dead-letter queue and no pg-boss retry, and that is the single most consequential
decision in the checkpoint.** pg-boss's own `manager.js:1293` documents that under `stately` a
retry insert can be dropped by `ON CONFLICT` and the job re-inserted as `failed` — straight to the
dead-letter queue, skipping its remaining retries. With an hourly cron and a persistent fault a
*first* transient failure could therefore reach a handler meant for terminal cleanup. `retryLimit: 0`
removes the interaction entirely: no `retry` rows exist, the depth bound becomes exactly one
`created` + one `active` per connection, and the hourly tick is the retry — a better one, because
it re-derives the window from current state instead of replaying a stale job. Verified empirically
by booting the worker against the test database: `policy=stately, retry_limit=0,
expire_seconds=900, dead_letter=null`.

**Error classification is reason-driven.** The 6.2P defect — any HTTP 400 mapped to
`not_supported`, which reported all eight rollup metrics as unsupported when the real cause was two
request-shape bugs of ours — is fixed by reading Google's structured `error.details[].reason`.
`missing_scope` and `not_supported` require an *evidenced* reason; the unsupported set starts
**empty**, so a genuinely unsupported metric currently reports `provider_error`. That is the safe
direction: it never disables a working stream.

**Extraction is declared and validated per metric**, never guessed. An unrecognised payload yields
a rejection carrying a key path and `typeof` only — never a value — which surfaces as
`rows_rejected` and a failed run. `breakdown` is assembled solely from an allowlist, so a
credential is structurally inexpressible.

**Idempotency** comes from a guarded upsert whose UPDATE branch is skipped on a content-hash match,
so an unchanged row produces no heap tuple and `updated_at` is untouched — proven by snapshotting
`ctid`/`xmin`/`updated_at` across a second identical sync (never `xmax`, which the `ON CONFLICT`
speculative row lock sets in place regardless). Provider timestamps are **included** in the hash
rather than excluded to buy idempotency.

#### Honest limitations, recorded rather than resolved

- **Fourteen of eighteen value specs are unverified against Google.** Only `steps`, `distance`,
  `total-calories` and `floors` have ever returned live data on this account, and the fixtures are
  transcribed from the same documentation as the specs — so a green extraction suite proves
  fixture/spec self-consistency, **not** correctness. A wrong spec fails loudly rather than storing
  a wrong number, and the circuit breaker stops it failing forever in silence.
- **Session interval offset field names are unknown.** No session payload has ever been observed on
  this account. Two plausible spellings are accepted and anything else is **rejected**, never
  defaulted to a zero offset — zero is a positive claim of UTC, not a neutral placeholder.
- **An authoritative window returning zero sessions can never tombstone the last remaining one**,
  because the sweep is gated on a non-empty seen-key set. That gate is load-bearing:
  `x <> ALL('{}'::text[])` is TRUE in Postgres, so an ungated sweep would tombstone the entire
  window. The detection gap is the deliberate cost.
- **Session tombstoning may be inert on this account.** F5 found `dataPointName` empty on all 307
  raw-HR records; if session records also carry no name, every row keys as derived and the sweep —
  restricted to `data_point_name` — never fires. A per-pass warning makes that observable rather
  than assumed.

#### The independent audit found two blockers, both real

1. **`${VAR:-}` renders an empty string, not an absent key**, and `z.string().min(1).optional()`
   throws on `""`. On a host with no Health credentials — which is production today — **both api
   and worker would have died at import**, taking capture, calendar, notifications and reminders
   with them. The api half predates 6.3 (it shipped in 6.2); the worker half was added by 6.3.
   Fixed in both with an `optionalNonEmpty()` preprocess and a five-test regression guard that pins
   the naive shape as failing.
2. **Densification keyed `insertOnly` off pass kind rather than off zero-buckets**, so a warm or
   manual chunk returning an empty array would overwrite real `has_data = true` rows — directly
   contrary to ADR-046a, and the test suite *codified* the violation. One HTTP 200 carrying
   `rollupDataPoints: []` is indistinguishable from a genuinely empty account, and `authoritative`
   proves only that *we* fetched completely, never that Google's answer was right. Fixed, and the
   incorrect assertion was rewritten rather than loosened; a companion test still pins deletion
   detection for the non-empty case.

Three further findings were fixed in the same pass: a backfill **cancel arriving during a chunk's
fetch was overwritten** by the pre-fetch snapshot when the chunk committed (the API having already
returned 200); **restarting a running backfill silently reverted** to the old target and made
`backfill_already_running` dead code; and a **Postgres error escaping the handler** would have put
`detail` — literally `Failing row contains (...)`, health value included — into `pgboss.job.output`,
now reduced to a SQLSTATE. Two minor ones: a raw NUL byte made `identity.test.ts` **binary to git**
and therefore undiffable, and the session attribution axis was re-decided by string comparison in
two places, now catalog-owned data.

**One audit premise was itself wrong and is corrected here:** it claimed nothing uses
`singletonSeconds`, so the new global `timestamp` type parser could not reach pg-boss's
`singleton_on`. `apps/api/src/routes/events.ts:84` does use it. The parser does reach that column;
pg-boss only reads the value and passes it straight back as a parameter, and a naive timestamp
string re-inserted into a `timestamp` column is byte-for-byte identical — strictly safer than the
old `Date` form, which round-tripped through a timezone-dependent serialization. Proven by a
regression test rather than argued.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build 9/9, typecheck 17/17, lint **0 warnings**, `format:check` clean |
| 2 | Full suite, serial (`--concurrency=1`) | **1693 tests / 17 turbo tasks**, uncached |
| 3 | Zero-drift canary | `calendar-providers` exactly **57** |
| 4 | Worker | **80 → 145** |
| 5 | Migration invariant | 14 `.sql`, 14 journal entries, last `0013_google_health_sync`; **6.3 adds none** |
| 6 | Worker boot | Booted against the **test** database (zero connections, so no provider call is reachable); queue persisted `stately / 0 / 900 / no dead-letter` |
| 7 | Web export | Clean, single `index.html` |
| 8 | Secret scans | `gitleaks git` 103 commits, no leaks. Working tree: 73 findings, **all in gitignored paths, 0 in any file git would commit** |
| 9 | Health invariants | `health_observations` = **0** in dev and test; zero advisory locks left held; `heart-rate-intraday` `sync_enabled = false` |

**A process failure worth recording, because the corrected procedure is not obvious.** The
preflight shutdown identified the port-3000 listener and walked *up* to its supervisor. There were
**three** `tsx watch` supervisors for this repo and only one was serving the port; stopping it freed
the port and looked correct, but a survivor later noticed an edit, respawned a child, and reclaimed
port 3000. Separately, a sub-agent ran its own vitest against the shared `personalos_test` database
while the integrator ran the suite, producing shifting pre-existing failures that were *measurement
artefacts, not regressions* — corroborated by the sub-agent independently, which traced its own
episode to piping vitest through `| head` (a SIGPIPE that can orphan a worker which keeps
truncating into the next run). **The corrected rules: enumerate every verified repository `tsx
watch` supervisor by command line and working directory, stop supervisors first, then re-identify
remaining children — port-listener traversal alone is insufficient; and only the integrator runs
database-backed suites, with sub-agents restricted to pure unit tests and required to hand off
first.**

### Checkpoint 6.3L — Bounded live acceptance proof (COMPLETE, 2026-08-25)

Explicit user approval for **local development Google Health calls only**. Development account and
local development database throughout. Production never contacted, nothing merged, no migration, no
F5 operation, `heart-rate-intraday` never enabled or queried, `.env` kept on the loopback callback.

Run as a **one-shot direct invocation** of the sync engine rather than by starting the API and
worker: no daemon, no pg-boss, no cron registration, and therefore no path by which a scheduled
fan-out could fire. Strictly fewer moving parts than the alternative, and bounded by construction.

#### The proof found two real shape defects — on exactly the data that exists

Both are the class the typed extractor was built to catch. **Every affected record was rejected
with a sanitized key path and nothing wrong was stored**, which is the containment working rather
than a near miss.

**1. Rollup leaves carry an aggregation suffix.** The specs derived the leaf from the catalog
`unit`, reasoning from ADR-047 that the API bakes units into field names. `dailyRollUp` returns a
ROLLUP, so it appends `Sum`/`Avg`/`Min`/`Max` — and the prefix is the bare unit noun, not the
catalog's unit string:

| metric | observed leaf | JSON type |
|---|---|---|
| `steps` | `steps.countSum` | string (int64) |
| `distance` | `distance.millimetersSum` | string (int64) |
| `floors` | `floors.countSum` | string (int64) |
| `total-calories` | `totalCalories.kcalSum` | number |
| `heart-rate` | `heartRate.beatsPerMinuteAvg` (+ `Min`, `Max`) | number |

`total-calories` is the case no derivation could have produced — unit `caloriesKcal`, leaf
`kcalSum`. A heart-rate rollup is an **average**, not a sum, so Min and Max go to the allowlisted
breakdown. The **container** derivation (camelCase of the dataType) was correct and is unchanged.
Run 1 rejected 35 + 35 + 35 + 32 records across the four metrics with data and wrote nothing.

**2. Sessions carry no civil times.** `SessionTimeInterval` sends `startTime`, `startUtcOffset`,
`endTime`, `endUtcOffset` and **no** `civilStartTime`/`civilEndTime`; requiring them rejected the
only sleep record this account has. The civil clock is now derived from the instant plus its
explicit offset when absent, taken verbatim when present. **This is not the conversion ADR-048
forbids** — that rule exists to stop a civil date being invented by guessing a timezone, which is
why daily rows take `civilStartTime.date` verbatim and no IANA zone is stored. Here the provider
supplies the instant AND its exact offset as independent facts, so the arithmetic is lossless, and
both inputs are stored on the row.

Also recovered: provider `createTime`/`updateTime` live on the **container**, not the data-point
root, so a root-only lookup silently stored nulls — and they are part of the hashed content, so
losing them would have blunted change detection.

Three test assertions encoded the disproved premises — one literally named *"derives the leaf from
the catalog unit for every metric"* — and were **corrected, not loosened**. One new test asserts the
pre-fix shape is still rejected, so the regression cannot return.

#### Live results, sanitized

| | Run 1 (pre-fix) | Run 2 (post-fix) | Run 3 (identical) | Run 4 (identical) |
|---|---|---|---|---|
| Runs succeeded | 20 / 24 | **24 / 24** | 24 / 24 | 24 / 24 |
| Daily rows inserted | 0 | **139** | 0 | 0 |
| Daily rows updated | 0 | 0 | 1 | **0** |
| Rows rejected | **137** | 0 | 0 | 0 |

The single update in run 3 was `total-calories` for local date **2026-08-24** — a day still
accumulating when run 2 executed at 22:17 local. Genuine upstream movement producing exactly one
UPDATE, which is the change-detection mechanism working; run 4 settled to zero.

**Zero-write proof (runs 3 → 4, settled pair):** `health_daily_metrics` 139 → 139, **0 inserts, 0
updates, 0 deletes, 139/139 rows byte-identical** by `ctid`, `xmin`, `content_hash` and
`updated_at`. `health_sessions` 0 tombstones. Only `health_sync_runs` changed (72 → 96), which is
operational metadata and is expected to.

**Sessions**, verified by a bounded backfill to the one historical window that holds a record: 1
sleep session inserted, then re-fetched twice — 1 update when the recovered provider timestamps
changed its content hash, then **0 inserts / 0 updates / 1 unchanged**.

#### Two standing debts closed by live evidence

- **Session UTC-offset field names are no longer unknown**: `interval.startUtcOffset` /
  `endUtcOffset`, exactly one of the two spellings the translator already accepted.
- **Session tombstoning is NOT inert.** The record carries a resource `name`, so it keys as
  `external_key_source = 'data_point_name'` — the only source the ADR-047a sweep acts on. The worry
  that F5's empty `dataPointName` on raw heart rate would generalise to sessions is disproved.

#### What remains unverified, and why that is not a defect

Twelve of the eighteen value specs are still declarations rather than observations, because **this
account has never produced data for those streams** — recorded as `unverified_no_account_data`, not
as a fault. No fixture was fabricated for any of them. `active-zone-minutes`, `active-energy-burned`
and `sedentary-period` now follow the observed rollup-suffix pattern but have never been seen; the
six precomputed daily vitals, `weight`, `body-fat` and `exercise` likewise. A wrong declaration
fails the run loudly and cannot store a wrong number, and the circuit breaker stops it failing
forever in silence.

#### Verification

Full gate green: build 9/9, typecheck 17/17, lint 0 warnings, `format:check` clean,
`git diff --check` clean. Full suite serial and uncached: **1714 tests / 17 turbo tasks**
(`calendar-providers` **57** canary held, worker **145**, health-providers **311**).

Safety after the proof: `health_observations` = **0** in dev and test; zero advisory locks held;
`heart-rate-intraday` `sync_enabled = false` with **zero** sync runs ever; no health job or schedule
in pg-boss; no health refresh queue or cron anywhere in source; migrations still **14 / 14**; F5
holds `capture-1.json` only; `.env` still on the loopback callback; no repository API, worker, watch
or test process left running and port 3000 free.

### Checkpoint 6.4 — Health dashboard, web (COMPLETE, local only, 2026-08-25)

Built on branch `phase-6-google-health-ui` from `0b9b436`. **Not merged to `main`.** No
production access, no deployment, no OAuth publishing, **no live Google call**, **no
migration** — the local level stays 14 `.sql` / 14 journal entries and production stays
0000–0012. `versionCode` untouched at 6; **no APK was built and no physical Rabbit pass was
run.**

Six commits, five lanes with non-overlapping file ownership plus an independent read-only
audit. The integrator owned every shared file — schema, route registration, the api-client
method bag, navigation, the Today mount, docs, and all database-backed test runs.

#### The read surface

Four perimeter-only routes, `/health-*` siblings because `/health` is the liveness probe:

| Route | Shape |
|---|---|
| `GET /health-summary?tz=` | connection + freshness + a tile per daily metric + `latest` + sleep/workout + capabilities |
| `GET /health-metrics?metric=&from=&to=&include_empty=` | bounded daily series, `to` INCLUSIVE, ≤366 days |
| `GET /health-sleep?from=&to=&limit=&offset=` | paginated, by WAKE date (ADR-049) |
| `GET /health-workouts?from=&to=&limit=&offset=` | paginated, by civil start date |

**Missing is never zero, structurally.** `HealthMetricPoint` carries
`state: "value" | "verified_absent" | "unknown"` with a Zod refine pinning `value` non-null
*exactly* when `state === "value"`. A zero-filled gap is unrepresentable rather than merely
discouraged, `"0"` stays a genuine recorded zero, and the client re-parses the same schema so
a server regression fails at the boundary instead of quietly rendering a fabricated 0.

**No secret and no provider error can cross.** `health_connections.last_sync_error` is
deliberately not projected — only its timestamp and a boolean — so "never show a raw provider
error" is a property of the shape, not a rule a screen must remember. (The column turns out to
hold our own failure *class*, not a Google message; the exclusion is belt-and-braces and costs
nothing.)

**`heart-rate-intraday` is excluded by acquisition MODE, not a name blocklist**, so it is
absent from tiles, capabilities and navigation, and `/health-metrics` rejects it with
`400 metric_not_readable`. `health_observations` is referenced nowhere.

#### What is honestly absent

Sleep stages, awake time, workout distance/calories/HR zones are modelled but **always null**.
The 6.3 sync engine stores an allowlisted `SessionDetail` of
`{source, sessionType, sessionSubtype}` and nothing more; capturing stages would mean changing
the sync engine and re-fetching from Google, which 6.4 is not authorised to do. Modelling them
keeps the client's "not available" a contract rather than a hardcoded string, and the copy
attributes the gap to Personal OS rather than to Google.

#### The UI

Four screens — dashboard, per-metric trend, sleep history, workout history — reached from a
Settings card rather than a sixth tab: the Rabbit's 480px bar already carries five labels, and
Health is a read-only view of one connection, not a daily driver. A small self-contained card
sits on Today owning its own query, so `/today`'s read model, schema and route are
**byte-unchanged** and Today can never wait on, or fail because of, a Google sync.

The dashboard shows a tile for **every** daily metric including the empty ones — a metric that
silently vanishes is an absence a user reads as zero, and twelve of eighteen streams have never
produced data on this account. Each missing tile says *which* kind of missing, and a
"last recorded on <date>" line appears **alongside** the missing words, never instead of them.

**No charting dependency was added** (none exists in this repo); charts are hand-built on
`View` over tested pure geometry, matching the `week-grid-layout.ts` precedent. A line breaks
at every gap rather than interpolating a value nobody recorded.

#### The audit found no broken invariant and seven real defects

An independent read-only auditor attacked 13 invariants: all CLEAR or CONCERN, none BROKEN.
Three findings mattered.

1. **A recorded zero and a data gap were pixel-identical.** `MIN_BAR_HEIGHT` and the
   component's own `GAP_MARKER_HEIGHT` had drifted to the same 2px in the same slot, leaving
   **colour as the sole difference** — unreadable in greyscale, at low contrast, or to a
   colour-blind reader, and precisely the distinction the whole surface exists to preserve.
   The constants now live together, because what makes a zero readable is a relationship
   *between* them; a gap is narrower AND shorter than the thinnest possible bar; and every
   mark gained a per-day `accessibilityLabel`, since the aggregate summary could say how many
   days had values but never what happened on one.
2. **The app-open refresh fired on a condition it could not clear.** It requests a `hot`
   window — correct, and unchanged, because hot is the one mode ADR-046a/047a forbid from
   densifying or tombstoning and therefore the only kind safe to fire unattended. But hot is
   by that same rule never authoritative, and `verified_through_date` is written only on an
   authoritative pass, so `is_stale` could never go false. Every app open spent a request and
   90 seconds of polling to leave the banner unchanged. The trigger is now "today is not
   covered yet", which hot *can* satisfy.
3. **Four credential canaries could not fire** — proven, not assumed. A Buffer serialises to
   `{"type":"Buffer","data":[...]}`, so a `"ya29."` seed never appears in the body, and
   lowercase `"ciphertext"` never matches the camelCase property. A total row leak passed all
   four. They now seed text canaries in adjacent columns, carry positive controls so absence
   cannot pass by nothing reaching the serializer, and the key-walk catches camelCase.

Also fixed: `slotEdge` was hand-copied into the component on the reasoning that exporting it
would mean editing a file it "does not own" — an authorship artifact, now one definition; the
trends screen printed its summary paragraph twice; the stale banner could read "0 days behind"
where ADR-048's widening legitimately puts coverage level with today; the 7-night sleep mean
divided by `count(*)` rather than distinct wake dates, making it a per-session average calling
itself nightly; the zero-substitution guard grepped only for `coalesce`, missing the likelier
`?? 0`; and the seven frozen 6.4 schemas had no direct tests at all.

#### Live local verification, against already-stored development data

API only — the worker was never started, so no scheduled fan-out and no Google call was
reachable. Values are deliberately not reproduced here.

| Check | Result |
|---|---|
| `/health-summary` on a morning with no sync yet | 16 tiles, **all `unknown`** — not one fabricated zero |
| `latest` | exactly the 4 metrics that have ever recorded a value, each with its own date |
| Freshness | verified through the prior day, `days_behind` 1, `is_stale` false at threshold 2 |
| Sleep | the one stored session, `stages`/`asleep_seconds`/`awake_seconds` all null |
| **ADR-049, live** | the session appears in its **wake**-date window and is **absent** from its start-date window |
| Series, a metric with data | `sum` metric prints **Total**; today counts as "not synced", never as a 0 in the total |
| Series, a metric with none | every aggregate renders **"No data"** as words |
| Guards | intraday → 400 · session metric → 400 · unknown metric → 400 · 367 days → 400 · 366 → 200 · bad/missing tz → 400 |
| Leak scan, all four routes + API log | zero matches for `ya29.` / `refresh_token` / `ciphertext` / `auth_tag` / `client_secret` / `last_sync_error` |

**Browser pass** (web export served locally, paired as a real device): Today renders the Health
card honestly; the dashboard distinguishes "today hasn't been synced yet" from "no data has
reached Google Health for this yet" in two different sentences; sleep shows its wake date with
bedtime/wake in the clock time it was lived and the stage-detail note; workouts show an honest
empty state; the Settings card links through. Verified at desktop width and at the Rabbit's
480×640.

Smoke cleanup was count-verified: the paired web device and the two pairing codes removed, the
five pre-existing Android device rows preserved, and the health tables **byte-identical** to
their pre-pass state. No repository process was left running and every port was released.

#### Deliberately NOT done

No physical Rabbit pass, no APK, no `versionCode` change. No OAuth connect/disconnect flow,
no per-stream toggles, no backfill control — 6.4 is read-only UI over the existing connection.
No health data reaches the Daily Brief: `apps/api/brief/**` is byte-unchanged and `BriefInput`
carries no health field.

#### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build 9/9, typecheck 17/17, lint **0 warnings**, `format:check` clean, `git diff --check` clean |
| 2 | Full suite, serial and uncached | **1965 tests / 17 turbo tasks** (1714 → **+251**) |
| 3 | Zero-drift canaries | `calendar-providers` exactly **57**, `worker` exactly **145** |
| 4 | Per package | schema 138→**162** · api 424→**466** · api-client 70→**93** · mobile 197→**359** |
| 5 | Migration invariant | 14 `.sql` / 14 journal entries — **6.4 adds none** |
| 6 | Forbidden-area drift | **zero** across `packages/db`, `apps/worker`, `packages/calendar-providers`, all compose files, `eas.json`, `app.config.ts`, `apps/mobile/android` |
| 7 | Today/Brief isolation | `read-models/today.ts`, `schema/today.ts`, `routes/today.ts`, `brief/**` all **byte-unchanged** |
| 8 | Web export | clean, single `index.html` |
| 9 | Typed routes | deleted the hand-patched generated artifact and **regenerated it with the real generator**, which emits all four `/health` routes; typecheck clean both with and without it |
| 10 | Secret scans | `gitleaks git` 112 commits, no leaks. Working tree: 77 findings, **all in gitignored paths, 0 in any file git would commit** |

**One pre-existing issue found and deliberately not fixed:** `apps/mobile/src/app/settings.tsx`
renders `connection.last_sync_error` verbatim for **Google Calendar** — a raw provider string
on screen. It is Checkpoint 4.5 code, untouched by this branch and outside 6.4's scope, but it
is exactly the pattern the new Health card avoids. Worth its own fix.

### Checkpoint 6.2P — Live development-account probe (CLOSED, 2026-08-25)

> **Status: core OAuth and capability proof PASSED. Raw-heart-rate reconciliation
> stability (F5) is DEFERRED ACCEPTANCE DEBT** — explicitly deferred by the user so the
> project can continue. **F5 is neither passed nor failed.**

Development account only. **Production untouched, the OAuth app remains in Testing, and
nothing was merged to `main`.** The local `.env` keeps the development loopback callback.

**Google Cloud state at closure:** project `personal-os-196cf`; publishing status
**Testing** (deliberately — M8 remains superseded); Audience External; exactly three read
scopes; separate Web Application client `Personal OS Google Health Web`; both the
production Tailscale callback and the development loopback callback
`http://127.0.0.1:3000/health-connections/google/callback` registered.

**A registration lesson worth recording:** the first two live attempts failed with
`Error 400: redirect_uri_mismatch`. The loopback URI had been entered in the Console but
not persisted — the Console keeps edits in the form until **Save** is pressed. A related
trap cost a third attempt: the local API was already running, and `--env-file` is read at
**process start**, not on `tsx watch` reload, so a hot-reloaded server was serving the new
routes while still holding the *old* redirect. It accepted the Tailscale callback and
rejected the loopback one. Always re-verify which redirect the running process actually
allows after changing `.env`.

#### OAuth proof — PASSED

| Property | Evidence |
|---|---|
| State single-use | Consumed exactly once at 23:57:44.567Z, bound to the loopback redirect |
| Replay rejected | Same state + dummy code → `400 invalid_state`; still exactly one connection |
| Code never spent on a bad state | The token endpoint was **not called** on the replay — validation precedes exchange |
| Identity binding | `getIdentity` returned a `healthUserId` (18 chars) plus a legacy Fitbit id; both stored |
| Encryption | access 253B / refresh 103B ciphertext, 12B IV, 16B auth tag; both decrypt; plaintext absent from ciphertext |
| No credential in responses | list / detail / streams contain no `access_token`, `refresh_token`, `ciphertext`, `auth_tag` or `client_secret` |
| **Log suppression, on a real code** | The genuine callback logged as `?state=[redacted]&iss=…&code=[redacted]`. Zero code-shaped strings, zero `ya29.`/`1//`, no client secret, and the `req` object carries no query/body/headers |
| Partial consent | All three scopes granted; 19 streams seeded, 18 enabled |
| Refresh token issued | `2026-08-24T23:57:45.015Z` → Testing-mode 7-day expiry **2026-08-31T23:57:45Z** |

#### Capability probe — PASSED (7-day bounded window, 19 metrics, read-only)

**Available with data (4):** `steps` 7 buckets · `distance` 7 · `total-calories` 7 ·
`floors` 6 — all 2026-08-18→24, single page, no `nextPageToken`.

**Supported but empty (15):** `active-energy-burned`, `active-zone-minutes`, `heart-rate`,
`sedentary-period`, `sleep`, `exercise`, `weight`, `body-fat`,
`daily-resting-heart-rate`, `daily-heart-rate-variability`, `daily-oxygen-saturation`,
`daily-respiratory-rate`, `daily-sleep-temperature-derivations`, `daily-vo2-max`,
`heart-rate-intraday`.

**Missing scope: 0 · Not supported: 0 · Provider error: 0.**

**Why 15 are empty — this is the account, not the integration.** The only source feeding
this Google Health account is `HEALTH_KIT / PHONE / Apple Inc. / PASSIVELY_MEASURED`. No
wearable is connected, so phone-derivable metrics carry data and wearable-derived ones do
not. Heart rate and sleep **do** exist historically: 6 distinct days with heart rate, all
**more than 30 days old**, and one sleep record in 120 days. **The Phase 6A metric set is
therefore NOT invalidated** — those streams are correct and will populate whenever a
wearable is paired.

**Behaviours verified live:**

- **Civil-window (ADR-048 confirmed against real data):** rollup buckets carry only
  `civilStartTime`/`civilEndTime` plus the value field — **no physical instants and no UTC
  offsets**, exactly as ADR-048 assumed. Buckets are returned newest-first.
- **Empty days are OMITTED:** `floors` returned 6 buckets for a 7-day range, day 24 absent.
  This confirms densification is required — and it is precisely the case that the
  originally-planned "bucket count must equal civil-day count" check would have
  hard-failed. The truncation-only check adopted in Revision 3 is correct.
- **True zero vs missing:** zero explicit zeros observed; in this account absence is
  represented purely by omission. True-zero remains structurally supported but unobserved.
- **Sleep wake-date axis (ADR-049 confirmed):** `sleep.interval.civil_end_time` → HTTP 200;
  `sleep.interval.start_time` → **HTTP 400 INVALID_ARGUMENT**. Live proof that sleep is
  genuinely excluded from the generic session-start filter, and that the attribution axis
  and the query axis are one and the same.
- **Pagination:** no `nextPageToken` on any rollup; all `list`/`reconcile` calls single-page
  at this data volume.

#### Two Google API deviations found live — both fixed and pinned (commit `244ec58`)

Both made **every** `dailyRollUp` call fail with HTTP 400, and the first probe run wrongly
reported all eight rollup metrics as `not_supported`. The probe was re-run after fixing.

1. **`CivilTimeInterval` uses `start`/`end`, not `startTime`/`endTime`.** A genuine
   asymmetry: the interval carried *on a record* (`ObservationTimeInterval` /
   `SessionTimeInterval`) does use `startTime`/`endTime`/`civilStartTime`/`civilEndTime`,
   but the `CivilTimeInterval` used as a rollup **request range** uses bare `start`/`end`.
   Google's error was precise: `Unknown name "startTime" at 'range': Cannot find field`.
2. **Sending `pageSize` on `dailyRollUp` fails outright.** The REST reference documents
   `pageSize` and `pageToken` as request fields, but including `pageSize` — at 100 or
   10000, over a 7-day range, well inside the documented 90-day cap — makes Google reject
   the call. Removing that one field turned the identical request into a 200 with data.
   The error is **actively misleading**: reason `INVALID_ROLLUP_QUERY_DURATION` with
   metadata `maxDurationDays: 90`, pointing at the range rather than at `pageSize`.
   `pageSize` is therefore removed from `DailyRollUpRequest` entirely, so it is
   unrepresentable rather than a trap.

Also confirmed: **`dataSourceFamily` must be the full resource name**
(`users/me/dataSourceFamilies/all-sources`); a bare `all-sources` is rejected with
`INVALID_DATA_POINT_DATA_SOURCE_FAMILY`. The catalog constants were already correct.

#### F5 — DEFERRED ACCEPTANCE DEBT

**Capture 1 is complete and preserved** at `~/.personal-os-phase6/f5/capture-1.json`
(outside the repository; hashes and counts only — no token, no BPM value, no raw payload).

| Field | Value |
|---|---|
| Window | **2026-04-29**, fully fetched, 1 page (chosen because recent days have no heart rate) |
| Records | 307 |
| Distinct external keys | **307 — zero collisions** |
| `dataPointName` non-empty | **0 of 307** |
| `externalKeySetHash` | `3a8401c9fca8b2b3cd597b51aea44921a9302cb4dfc452eb8ef3ba97d10cf5a6` |
| `contentSetHash` | `a11fdf311e0aeae6a3c1ff86f3207f5a12f6f31fc56bcfd84e323478a115fa7d` |

**One question is already answered:** `ReconciledDataPoint.dataPointName` is **empty on
every record**, so raw-heart-rate identity **must** be derived — the resource-name strategy
is unavailable in practice. The derived key produced 307 distinct keys with no collisions,
which is a good early signal for the collision strategy but says nothing about stability.

**What remains unproven:** whether `reconcile` returns the *same* identities across calls
separated by time. `reconcile` recomputes off-wrist filtering server-side per request, so
an omission is evidence of upstream recomputation rather than deletion. Two back-to-back
calls would prove nothing; only a capture ~24h later can. **That capture was explicitly
deferred by the user and has NOT been run.**

**Consequences, binding on 6.3:**

- **`heart-rate-intraday` stays `sync_enabled = false` by policy.** It is already seeded
  that way and must not be enabled.
- **Raw intraday heart-rate ingestion is EXCLUDED from Checkpoint 6.3.**
- All other approved streams may proceed.
- **ADR-047 is unchanged** — intraday storage remains heart-rate-only by design. This is a
  scheduling deferral, not a design change.

**Raw heart rate can be reconsidered later through either route:**

1. **Completing the delayed reconcile-stability proof.** Re-run the second capture and
   compare — the script has `first` / `second` / `compare` modes and capture 1 is
   preserved:
   `pnpm exec tsx --env-file=../../.env src/scripts/f5-capture.ts second 2026-04-29`
   then `… f5-capture.ts compare`. Any window with data works; 2026-04-29 has the most.
2. **The `list` + local multi-source de-duplication fallback**, keyed on
   `DataPoint.dataSource` (which `list` returns and `reconcile` does not), accepting that
   off-wrist filtering would then be ours to do or to omit.

### Checkpoint 6.2 — Google Health OAuth connection (COMPLETE, mocked, 2026-08-24)

**Local development only. Production untouched. The OAuth app remains in Testing, and no
live Google consent flow was run** — every outbound call in this checkpoint is either a
stubbed global `fetch` or the injected in-memory fake client. **No migration**: 6.2 uses the
tables `0013` already created, so the level stays at 14 locally and 0000–0012 in production.

**Google Cloud setup (performed by the user):** project `personal-os-196cf`;
`health.googleapis.com` enabled; Audience External; **publishing status Testing**; the
user's account added as a test user; exactly the three read scopes configured; a separate
Web Application client `Personal OS Google Health Web`; and Google accepted the exact
redirect URI `https://personal-os.tail62a68f.ts.net/health-connections/google/callback`.

> **The M4a risk recorded in the plan is resolved: Google accepted the `.ts.net` callback.**
> The plan's R3 ("`.ts.net` may be rejected as an Authorized Domain") did not materialise,
> so the shipped flow is the tailnet server callback and the loopback path is not needed.

> **M8 is deliberately NOT done and the prior instruction is superseded.** The app stays in
> Testing through 6.2, which means **refresh tokens expire after 7 days**. Publishing is
> reconsidered only after 6.2P proves authorization, encrypted refresh-token persistence,
> access-token refresh, partial consent and reconnection.

**Credential import.** The client id and secret were extracted from the user's Desktop
credentials JSON into the local `.env` by a silent shell operation — never read with a
model-facing file tool, never echoed, never placed in a command, and never copied into the
repository. `.env` was confirmed git-ignored (`.gitignore:18`) and untracked *before*
writing; it went from 13 to 16 keys with none lost and is mode 600. Verification was by
variable NAME only. The JSON's own `redirect_uris` was cross-checked to contain the exact
callback, which independently confirms the Console registration.

**What was built.**

- Configuration is a **separate OAuth client** from `GOOGLE_OAUTH_*` — a Calendar token is
  never reused as a Health token. All three vars are **optional**, unlike the Calendar pair,
  so the API still boots without them and Health routes degrade to `409
  health_not_configured`. `docker-compose.yml` passes them with `:-` for the same reason: a
  rollout must not hard-fail before the credentials exist. Both compose overlays validated.
- `GOOGLE_HEALTH_OAUTH_REDIRECT_URI` is an **exact-match allowlist, not a default**. A
  client may select among allowlisted redirects; it can never introduce one. No
  normalization, no prefix matching, no wildcards, no trailing-slash tolerance.
- **OAuth state**: 32 random bytes, stored only as a sha256 — never the raw value, mirroring
  `device_pairing_codes` — single-use via an atomic
  `UPDATE ... WHERE consumed_at IS NULL ... RETURNING`, expiry-checked, and bound to the
  exact redirect it was issued for. **The redirect and state are validated before the code
  is spent**, so a forged callback never causes a token exchange (pinned by a test).
- **One shared internal service** backs both the GET callback and the manual POST path. If
  each performed its own exchange, the allowlist, state check and account-mismatch guard
  would have two implementations that could drift.
- `prompt=consent` is now sent **only when a refresh token is genuinely required**.
  `access_type=offline` still goes every time. Google caps an account at 100 live refresh
  tokens per client and evicts the oldest beyond that, so prompting on every reconnect
  would slowly destroy older grants.
- **Identity comes from `users.getIdentity`, never a JWT** — the three read scopes carry no
  identity claim and Google returns no `id_token`. The connection binds to `healthUserId`,
  and a different account is rejected rather than silently rebound.
- **Partial consent is resolved at connect time** from the granted scope, turning what would
  be a storm of runtime 403s into one recorded fact. Intraday heart rate stays disabled even
  when granted — it is the only high-volume stream and its identity strategy is unproven
  until 6.2P. A reconnect deliberately does **not** re-enable a stream the user turned off.
- Tokens are encrypted with the existing AES-256-GCM system under an unchanged
  `CREDENTIALS_ENCRYPTION_KEY`. A refresh never overwrites the stored refresh token, since
  Google often omits one. `invalid_grant` marks `needs_reauth`; a transient 5xx does not.
  Disconnect best-effort revokes then unconditionally NULLs every secret column — including
  when decryption itself fails after a key rotation — while **keeping the row** as history.

**The security defect this checkpoint actually fixed.** The OAuth callback carries a live
authorization code and its CSRF state in the **query string**, and two plausible mitigations
were verified to be ineffective against the installed `fastify@5.12.0`:

| Mitigation | Why it fails |
|---|---|
| An `onRequest` hook rewriting `req.url` | `lib/route.js:522` calls `incomingRequest()` **39 lines before** `onRequestHookRunner` at `:561`. The code is on disk before any hook runs |
| `redact.paths` for `req.query.code` | The default serializer (`lib/logger-pino.js` `asReqValue`) emits only `{method, url, version, host, remoteAddress, remotePort}` — there is no `req.query` and no `req.body`, so those paths censor nothing |

A **custom `req` serializer** runs inside that first log call and is the only place that
covers it. **Corollary worth recording: the pre-existing `req.body.api_key` /
`req.body.auth_code` / `req.body.password` redact entries are also no-ops today** — bodies
are safe because the serializer never emits them, not because of the redact list. They are
retained as defence in depth for any future change that does log bodies. Scrubbing applies
on **every** route, not just the callback. It is verified against a **real captured log
stream**, not against the config — a config-level assertion is exactly what would have
passed while a code was still being written to disk — and covers percent-encoded parameter
names (`%63ode`), repeated parameters, values containing separator characters, and
malformed percent-escapes, which must never throw inside the logger.

**Verification actually run**

| # | Check | Result |
|---|---|---|
| 1 | Full gate | build / typecheck / lint / format:check clean; `git diff --check` clean; `expo export --platform web` clean with a single `index.html` |
| 2 | Full suite | **1382 tests across 17 turbo tasks** (1303 → **+79**); api 332 → 409 (41 route + 20 service + 16 logging) |
| 3 | Zero-drift canaries | `calendar-providers` exactly **57**, `worker` exactly **80** |
| 4 | Migration invariant | 14 `.sql` / 14 journal entries — **6.2 adds no migration** |
| 5 | Working-tree secret scan | `gitleaks --no-git` found 71 findings, **0 of them in any file git would commit**; all confined to gitignored paths (66 in the generated `apps/mobile/android/` tree, 5 in `.env`). Staged scans clean on every commit |
| 6 | Credential-value paranoia check | The real values in `.env` were compared against the staged diff directly (without printing them): **none present** |
| 7 | Boundaries | `apps/mobile`, `packages/api-client` and `packages/calendar-providers` are **byte-unchanged**; no worker source touched; no `versionCode` change; no production access |

**A test bug found and fixed rather than left passing for the wrong reason:** the
expired-state test originally filtered with `eq(consumedAt, consumedAt)`, which is
`NULL = NULL` and therefore matches nothing — so no row was ever backdated and the
assertion passed without exercising expiry at all.

**Deliberately NOT built** (6.3/6.4): the sync engine, worker jobs, queue registration, the
rate limiter, record-to-row translation, `packages/api-client` methods, and any UI. `POST
/health-connections/:id/sync` does not exist yet, and the connect path performs **zero job
enqueues** — pinned by a test so a future change cannot start shipping a credential through
pg-boss unnoticed.

### Checkpoint 6.1 — Contracts, migration 0013, provider fake (COMPLETE, 2026-08-24)

Single-writer, per the plan. **Local development only; production untouched.** No Google
credentials were needed or used, and none exist yet — 6.1 is deliberately buildable without
them.

**Migration `0013_google_health_sync`** — 39 statements in drizzle-kit style (7 `CREATE
TABLE`, 6 FKs, 12 CHECKs, 14 indexes; 38 `--> statement-breakpoint`s). Only statement
classes `reconcile-drizzle-tracking.ts` can process; **no `DROP CONSTRAINT`**, which is the
`0009` lesson. Journal entry idx 13 appended with a real authoring epoch, and
`0013_google_health_sync` added to `journal.test.ts`'s `HAND_WRITTEN_WITHOUT_SNAPSHOT` set
(an exact-equality assertion — the suite fails without it).

**Seven tables:** `health_connections` · `health_oauth_states` · `health_metric_streams` ·
`health_daily_metrics` · `health_observations` · `health_sessions` · `health_sync_runs`.

Design points worth recording because they were decided against an alternative:

- **`health_daily_metrics` carries no physical instants and no UTC offsets.** `dailyRollUp`
  documents `civilStartTime`/`civilEndTime` and supplies neither, so those columns could
  only have held invented values. The consequence, accepted in ADR-048: duration-normalized
  daily rates are not derivable and are not offered.
- **No per-row "we checked" timestamp.** Verification lives on the stream
  (`last_successful_sync_at`) and in `health_sync_runs`, so two identical consecutive syncs
  can write zero health-data rows.
- **`health_user_id` is `NOT NULL`.** A Postgres unique index permits unlimited NULLs, so a
  nullable identity would let a partially-failed connect bypass the account-mismatch guard.
- **All-or-nothing CHECKs on both encrypted credential triples** — a partially-populated
  triple is undecryptable and is now unrepresentable.
- **`provider`, `metric`, `source_family` and `failure_class` carry no CHECK** (ADR-050),
  so adding a metric never requires an unreconcilable `DROP CONSTRAINT`.

**`packages/core/src/health/`** — `civil-time.ts`, `day-attribution.ts` (the single home of
the ADR-049 wake-date rule) and `windows.ts`. `packages/core`'s `exports` map gained
`"./health/*"`, without which a mobile import would fail to resolve or would drag `rrule`
into the web bundle for the first time.

**A real defect its own tests caught, worth recording rather than quietly fixing:** the
first `trailingWindow` used `endDate = today + 1` in a half-open range, so the last covered
day was `today` — it never actually included the ahead-of-UTC local day the widening exists
for. Worse, `densifiableRange` excluded one day at *each* edge, which (a) was insufficient,
since at 19:00 UTC a user at −07:00 is still mid-way through their own current day, and
(b) would have punched a systematic hole at every backfill chunk seam, because chunks abut.
Corrected to: exclusive end `today + 2`; densification clamped by
`lastGloballyCompleteDateExclusive(now)` (a date is knowably empty only once it has ended at
−12:00, the maximum lag); and **no start-edge clamp at all**.

**`packages/schema/src/health-metrics.ts`** — named to avoid the existing `health.ts`
liveness schema. Response shapes are structurally credential-free, asserted by a test that
walks the schema keys rather than trusting review.

**`packages/health-providers`** (new package, 82 tests) — `google-health-catalog.ts` (the
single source of truth for capability metadata, in code rather than in columns),
`google-health-oauth.ts`, `google-health-client.ts` (injectable `fetchFn`, following the
CalDAV client rather than the Google Calendar one, which has no test file at all),
`google-health-client.fake.ts` (scripted queues that **throw on an unqueued call**, so an
unexpected request fails loudly instead of returning an empty page and a green test) and
`identity.ts`.

The catalog pins the facts that were got wrong during planning: **`list` never carries
`dataSourceFamily`**; **sleep filters on `sleep.interval.civil_end_time`, never
`start_time`**; the 14-day cap is marked `documented_rollup_cap` while every `list`/
`reconcile` window is marked `self_imposed`; and **`daily-vo2-max` sits under
`activity_and_fitness`, not `health_metrics`** — verified against the data-types table
after two research passes disagreed.

**Deliberately NOT built in 6.1** (they belong to 6.2/6.3): API routes, worker jobs, queue
registration, the rate limiter, record-to-row translation, and any client or UI. No
`apps/api`, `apps/worker` or `apps/mobile` source file was modified — only their two test
harnesses, to truncate the new tables in FK order.

**Documentation correction made during this checkpoint:** the plan asserted that three
`STATUS.md` lines claiming "13 `.sql` files, 13 journal entries, no 0013" would all become
stale. Two of them are **historical verification records** for Checkpoints 5.6 and 5.7.1
and were accurate when written; rewriting them would falsify the record. Only the live
statements were changed — the header's implementation status (now distinguishing local from
production migration level) and the "Last verification" section.

