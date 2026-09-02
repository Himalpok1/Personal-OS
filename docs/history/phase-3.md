# Phase 3 — Native builds, voice, notifications

> **Historical record — closed. Do not edit.**
> Device pairing, local reminders, PTT, the offline outbox, Expo Push, and the Rabbit R1 hardware spike. End of Phase 3 was the MVP.
>
> Archived from `docs/STATUS.md` by Checkpoint 8.0 (2026-09-02) to reduce agent auto-load context.
> Content is **verbatim and unaltered**; only this header was added. Present state lives in `docs/STATUS.md`.

Source line ranges in the pre-8.0 `docs/STATUS.md`: 5160–5221, 5422–5449, 5450–5482, 5483–5537, 5538–5779, 5780–6088


> **Note on cross-references.** This file was extracted from a single 7,283-line `docs/STATUS.md`. Phrases like *"above"*, *"below"*, *"further down this file"* and *"see the 6.7A section"* refer to positions in that original document, not to this file. Where a target moved to a different phase file, follow the phase number. Nothing was rewritten to repair these — the text is verbatim.

<!-- ORIGINAL RECORD BEGINS — everything below this line is verbatim from docs/STATUS.md -->
## Phase 3 Checkpoint 6 — Stage 2A artifact gate (2026-08-19)

Stage 2A's corrective build preparation and EAS retry completed successfully at release commit `59aa29326329509f4bb286b2d731220e470c15b9`. The narrow `apps/mobile` lifecycle fix is recorded in that commit: `postinstall` runs `pnpm --filter '@personal-os/api-client...' build`, which rebuilds only the dependency closure required by the mobile app (`@personal-os/core`, `@personal-os/schema`, and `@personal-os/api-client`) before EAS's eager JavaScript bundle. A clean archived checkout with a frozen install rebuilt those outputs and bundled the Android app successfully; the complete local release gate passed, including 214 tests and gitleaks. Normal root/local workflows remained passing.

The successful EAS build is `79aed729-77ef-4102-a98a-f0aa00d02ea1`, profile `production-internal`, status `FINISHED`, package `com.himal.personalos`, version `1.0.0`, and Android `versionCode` `3`. The exact APK is preserved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/79aed729-77ef-4102-a98a-f0aa00d02ea1/personal-os-production-v1.0.0-3.apk` with SHA-256 `f2a2009dd67ea800ac0d2e9736aab62d8a4ff6ccd5d6943a6e70288d1a0fb1dc`. Its signer matches the approved EAS-managed production certificate SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`; the existing remote credential was reused with `--freeze-credentials`. Firebase project/package identity and FCM V1 assignment were verified separately through EAS metadata.

### Narrow Category A localhost exception

The APK verification rule is amended only for this exact artifact and provenance. The single embedded `http://localhost:8081` occurrence (bundle byte offset `503098`) is a React Native `0.86.2` framework fallback from `Libraries/Core/Devtools/getDevServer.js`, proven by deterministic source-map mapping from an analysis-only release export at the exact commit and production URL. Release evidence is `__DEV__ === false`, an embedded Hermes bundle, no Expo dev client/menu/launcher, Expo Updates disabled, and no Metro requirement for app launch. The Personal OS API URL is `https://personal-os.tail62a68f.ts.net`; the application fallback `http://localhost:3000` is absent from the release bundle.

This exception does not carry forward to another React Native version, bundle, APK hash, occurrence count, or source provenance. Application-reachable localhost, loopback, private-IP, development-host, and configuration-derived endpoints remain forbidden. Any new local/development endpoint is an immediate hard stop pending separate provenance analysis and approval. No application code was changed to remove this inert framework literal.

Stage 2A is an artifact-only gate. No Rabbit uninstall/install, rsync, migration, production Compose recreation, production AI configuration, database mutation, or other production mutation has occurred. The next authorized action is the read-only Stage 2B deletion-manifest gate; its exact list still requires explicit approval before any real transfer.

### Stage 2B read-only deletion-manifest hard stop (2026-08-19)

The first hardened `rsync --delete` dry run was read-only and was saved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/stage-2b-20260819T161846Z/`. Its exact would-delete manifest has SHA-256 `45da86d850f3f12c651b747eed7b9a06907dbbb6ec453f322ca2b095134abf83`. The manifest contains the expected stale tracked-source path `apps/mobile/app.json`, but also 18 generated/server-only `.husky/_/**` paths and generated `apps/mobile/expo-env.d.ts`; those paths are not deleted tracked source between deployed baseline `0c6112e` and release `59aa293`. The `.env` file remained protected and excluded; its remote owner, mode, size, mtime, and digest were captured without exposing its value.

This is a mandatory hard stop under the Checkpoint 6 deletion gate. No exclusion was added, no manifest was approved, and no real rsync transfer was run. The generated/server-only paths require explicit classification and an amended read-only dry run before any transfer can be considered. Production services, database, AI configuration, Rabbit state, and the production `.env` remain untouched.

The approved amended read-only rerun used current deployment HEAD `398ad515a19891b84f69477bdda205565c7db944` and added protect/exclude rules only for `/.husky/_/***` and `/apps/mobile/expo-env.d.ts` (the existing protections for `.env`, mobile env files, `google-services.json`, and `.claude` remained unchanged). The Git-derived expected deletion set from `0c6112e` to `398ad51` is exactly `apps/mobile/app.json`; the new itemized rsync manifest is exactly that one path with SHA-256 `0d8e40c9a006eb8bdf693bf3bd04b312cd9784fb3fde977b3777acecabf757d9`. The full audit is saved outside the repository at `/Users/himalpokhrel/.codex/deployment-artifacts/personal-os/checkpoint-6/stage-2b-20260819T162710Z-head-398ad51/`. No `.env`, mobile env file, `google-services.json`, `.claude`, `.husky/_/***`, `apps/mobile/expo-env.d.ts`, runtime/generated state, logs, credentials, or other unexpected path is proposed for deletion; `.env` owner, mode, size, mtime, and SHA-256 are unchanged before and after the dry run.

The approved APK remains provenance-bound to application-code commit `59aa29326329509f4bb286b2d731220e470c15b9`. Current deployment HEAD `398ad51` differs only by Checkpoint 6 documentation/evidence commits and does not invalidate the APK build provenance. The real rsync transfer remains pending explicit approval of this exact one-path manifest.

### Stage 3B migration and accepted Compose volume side effect (2026-08-19)

Migration `0004_eminent_moondragon.sql` was applied once with `posops_migrator` using the reviewed two-file Compose `run --rm --no-deps` command. Its SHA-256 is `6fb71f0de872a0a220119d0000058be16c5d418cfd331cf1c7a009b08a022fd4`; the journal now contains only migrations 0000–0004, the three Phase 3 tables/index are present, and `inbox_items.raw_text` is nullable.

Expected Compose side effect discovered during Stage 3B: the one-off API migration container materialized the API service's declared `personal-os_audio_data` named volume. This did not start dependencies, restart services, alter PostgreSQL, or mount the volume into any persistent service. The volume is accepted as the Stage 4 shared audio volume and has identity `personal-os_audio_data`, local driver, Compose project `personal-os`, Compose volume `audio_data`, created `2026-08-19T15:50:54-05:00`, and was empty at verification.

For the remainder of Checkpoint 6, creation of this exact declared `personal-os_audio_data` volume during the completed Stage 3B migration is accepted. Any different or newly unexpected volume remains a hard stop; replacement or identity change of `personal-os_audio_data` is a hard stop; any change to `personal-os_postgres_data` remains an immediate hard stop.

### Checkpoint 6 final production evidence (COMPLETE, 2026-08-20)

The tracked production source is frozen at `398ad515a19891b84f69477bdda205565c7db944`; later commits are deployment-evidence documentation only and were not synced back to the server. The hardened `rsync --delete` transfer used the approved one-path deletion manifest (`apps/mobile/app.json`, SHA-256 `0d8e40c9a006eb8bdf693bf3bd04b312cd9784fb3fde977b3777acecabf757d9`) and preserved production-only/generated state. Production `.env` remained `himallinux:himallinux`, mode `600`, size `577`, mtime epoch `1786863203`, and SHA-256 `66ff0e2a5327d620309bcdf55c744851b38819bf24606e224256796de4df5cb9` through final verification.

Migration `0004_eminent_moondragon.sql` (SHA-256 `6fb71f0de872a0a220119d0000058be16c5d418cfd331cf1c7a009b08a022fd4`) was applied exactly once by `posops_migrator` with the reviewed two-file Compose `run --rm --no-deps` command. The journal contains only 0000–0004. The three additive Phase 3 tables/indexes exist, `inbox_items.raw_text` is nullable, existing data was preserved, and `posops_app` passed rolled-back DML while direct `CREATE`, `ALTER`, and `DROP` attempts remained denied.

The targeted rollout recreated only API/worker and then web. Final identities are: PostgreSQL container `bf484f07d7efebdf6958d7047c7d8b4837bb8dfe145330d7b0db936aa6ff08de`, image `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168`; API container `5f7e6965a10b890058343aeda77b722bf34f57b7289dfa8f9f57c76bdef7c3a0`, image `sha256:f686eca7189c9a2ef3d2bc74cad59b5fa9e266d2642448e4bdd5547d760d6d65`; worker container `f4457a1ee42143c083f65158e790f2219282e4f9252cdb616e15313dda4e2786`, image `sha256:7333ce956719952f5408a170dd45435c91d71d5f3e703138829b0ab2e7c09a07`; web container `9cdcfd76a9c6539e8727b1d260985176763e620b84e5ff7013b638d54fe7a209`, image `sha256:8e5ff0b45118e5716864a412e29d3f1f9dd7a98ed2ab41cc1bd28f2fb3b8e3fb`. PostgreSQL retained its original start time (`2026-08-16T06:57:20.115181374Z`) and zero restarts throughout deployment and the final application restart test.

Persistent volume identities remained `personal-os_postgres_data` (local driver, created `2026-08-15T17:32:00-05:00`) and `personal-os_audio_data` (local driver, created `2026-08-19T15:50:54-05:00`). API and worker mount the same audio volume at `/data/audio`. Final queues include `ptt.transcribe`, `notifications.dispatch`, their DLQs, and the existing capture/occurrence queues; zero failed/active jobs remained. The heartbeat, nightly occurrence expansion, and hourly orphan-audio schedules each had exactly one row after restart.

Production remains private: API `https://personal-os.tail62a68f.ts.net` maps to loopback `127.0.0.1:3000`; web `https://personal-os.tail62a68f.ts.net:8443` maps to loopback `127.0.0.1:8081`; PostgreSQL publishes no host port; both Serve routes report `tailnet only`; no Funnel/public listener exists. Both URLs were confirmed unreachable from cellular with Tailscale disabled. The production URL is embedded in the web and Rabbit artifacts; no application-reachable local/development API endpoint was found.

The Android release uses the EAS-managed remote keystore under project `@himal_pok/mobile` (`b704be80-5b01-411e-9239-fa0cea642783`) with profile `production-internal`, internal APK distribution, `credentialsSource: remote`, and `--freeze-credentials`. Build `79aed729-77ef-4102-a98a-f0aa00d02ea1` finished successfully from application-code commit `59aa29326329509f4bb286b2d731220e470c15b9`: package `com.himal.personalos`, version `1.0.0`, versionCode `3`, APK SHA-256 `f2a2009dd67ea800ac0d2e9736aab62d8a4ff6ccd5d6943a6e70288d1a0fb1dc`, signing-certificate SHA-256 `4601e3a2c4ecfe791b0bf6d960871c017fe1f3bc56087389f7ccc3a3f6cc23ea`. Firebase project/package and the FCM V1 credential assignment were verified independently in EAS metadata. Future releases must reuse this EAS project/profile/remote credential, freeze credentials, use a higher versionCode, and compare the signer fingerprint before installation.

The exact APK retains the narrowly approved Category A React Native `0.86.2` framework literal: one `http://localhost:8081` occurrence from `Libraries/Core/Devtools/getDevServer.js`, deterministically source-map-proven unreachable in this release (`__DEV__ === false`, embedded bundle, no dev client/menu/launcher, Expo Updates disabled, no Metro launch dependency). The exception is bound to this APK hash, React Native version, occurrence count, and provenance and does not carry forward. The application fallback `http://localhost:3000` is absent.

The physical Rabbit R1 completed the one-time debug-to-production signing transition only after its old APK was preserved and hashed and the new artifact was reverified. The installed APK is byte-identical to the approved artifact and has the approved signer. Production device `c6c0b43d-2eed-41f4-8ee1-4c1aff65bc61` paired once, stores only a token hash server-side and the raw token in SecureStore, retained identity across app/process and production-service restarts, registered a push token, and is the sole active primary device. Notifications, microphone, and exact-alarm authorization were verified. An earlier code expired unused naturally; consumed codes could not be reused. A disposable security-probe device was revoked and returned `401 device_revoked`; the general API remained governed by the separate Tailscale perimeter exactly as ADR-029 specifies.

The physical reminder smoke created one production Inbox/task reminder for 02:55 America/Chicago. Android reported an exact zero-window alarm with the permission-based exact scheduling reason; it fired once while the app was backgrounded, and tapping it opened the correct task. No development endpoint, Metro session, or ADB reverse mapping participated.

The physical PTT smoke produced one Inbox item and one task from the user's actual speech: transcript `Checkpoint 6. Voice Smoke. Remind me to verify Grok transcription at 3 a.m. today.`, real average log probability `-0.395417`, and a 03:00 America/Chicago reminder. Production processed Rabbit microphone → `/transcribe` → shared audio volume → `Groq Production` / `whisper-large-v3-turbo` / `voice_transcribe` → transcript → the protected `My OpenAI` / `gpt-4.1` / `capture_parser` route → task. Both routes had zero fallbacks, no duplicate entity was created, `audio_path` was cleared, and the shared volume was empty afterward. The 03:00 physical reminder fired and opened the correct task. The transcript's “Grok” spelling reflects the spoken proper name and is non-blocking.

Both production push cases passed with Expo acceptance recorded separately from physical delivery. The diagnostic dispatch was accepted with ticket `01a01e31-c902-72a9-954a-d82733841236`, physically arrived, and opened correctly. A real `needs_confirm` Inbox item (`0cd123a1-7dfa-4fde-bf0d-1915168fdd90`) produced one dispatch accepted with ticket `01a01e37-094f-73dc-90cb-457de5599b57`; it physically arrived in the background and tapping it opened that exact Inbox item. An earlier intentionally ambiguous sentence legitimately parsed as a note and therefore did not dispatch; this was not treated as a push failure.

The protected production AI topology remained byte-for-byte stable for the existing parser: `My OpenAI` provider `ffa90bb6-1656-4bf6-8c91-007ba4b86b08` → `gpt-4.1` model `313633f4-2c52-4a06-a696-4f7740a95f28` → `capture_parser` route `bda49ae5-2ab6-406e-9c9e-f327867f37da`, no fallback. The only new production AI path is `Groq Production` provider `b0afa568-47a9-4942-aa86-3a65c5aaecde` → `whisper-large-v3-turbo` model `a5e3dc4d-db8f-434b-a780-13477fbf886d` → `voice_transcribe` route `7c0ef9c1-a751-40ef-80de-427d764f2770`, no fallback. No Groq parser model/route exists, and credential values were absent from repository, images, output, and final log scans.

Final targeted recovery restarted API/worker and then web without recreating any container. Their IDs/images remained identical and only their start timestamps advanced; PostgreSQL was not restarted. API health/DB connectivity, fresh worker heartbeat, zero-failure queues, singleton schedules, local and Tailscale web/API HTTP 200 responses, Rabbit SecureStore reconnection, primary/push settings, and both AI routes all recovered. No full host reboot, backup infrastructure, Google Play publication, public exposure, production-source resync, or Phase 4 work occurred.

Known non-blocking evidence retained intentionally: pairing-code and notification dispatch history were not destructively erased; the revoked disposable security-probe row remains as audit evidence; labeled smoke-test Inbox/task/note rows remain identifiable in the otherwise minimal production dataset. The reserved server-side `notify_reminders` flag remains false because MVP reminders are locally scheduled on the primary Rabbit, as designed.

## Phase 3 Checkpoint 1: schema + auth foundation (2026-08-16)

Plan approved via plan mode after three revisions. The target native device is a Rabbit R1 running CipherOS (community AOSP-based Android 16/SDK 36), inspected directly via `adb` during planning (screen 480x640px/density-override 190, live input-event capture of the scroll wheel and side button) rather than trusting public hardware reports — the side-button driver was found to fire real interrupts on this exact unit, contradicting a public "zero interrupts" report, though the button fires as `KEY_POWER`, which Android conventionally intercepts before app dispatch (an open question deferred to a Checkpoint 3 spike). Plan review also caught and corrected: an ineffective `POST /devices` access control (any tailnet peer could re-register a revoked device), an unclassified push-retry design, an ambiguous nullable-`raw_text` UI fallback, and an under-specified reboot-survival requirement for local reminders (the MVP's core property).

**What was built (this checkpoint):**

1. **Schema** (`packages/db`) — new tables `devices` (bearer-token auth, hash-only storage, one-primary-device partial unique index), `device_pairing_codes` (one-time registration gate), `notification_dispatch_log` (crash-safe dispatch state: `pending`/`accepted`/`failed` — deliberately not `sent`, since a successful Expo ticket only means Expo accepted the request, not that FCM or the device received it). Existing-table change: `inbox_items.raw_text` made nullable (a PTT capture writes its row before a transcript exists). One migration (`0004_eminent_moondragon.sql`), purely additive/loosening — no drops, no data-touching statements.
2. **`packages/core`** — `device-auth.ts`: `generateDeviceToken`/`hashDeviceToken` (256-bit random token, SHA-256 hash-only storage — deliberately not the AES-256-GCM scheme `credential-crypto.ts` uses for AI keys, since a device token is never decrypted, only compared) and `generatePairingCode`/`hashPairingCode` (8-char Crockford-Base32 codes, same one-way-hash pattern, case/hyphen-insensitive comparison).
3. **`apps/api`** — `plugins/device-auth.ts` (a `preHandler`, attached per-route-file via `addHook` so it can never leak onto the existing tasks/notes/projects/capture/inbox/occurrences routes, which remain Tailscale-perimeter-only, unchanged — this scoping is stated explicitly as a security-boundary comment in the plugin itself, not just implied); `routes/devices.ts` (two Fastify sub-contexts in one file — an unauthenticated, pairing-gated `POST /devices`, and everything else behind the auth hook: `GET/PATCH /devices/:id`, `/primary` two-statement transaction, `/push-token` self-only, `/revoke` idempotent); `scripts/generate-pairing-code.ts` (a CLI script, deliberately **not** a network endpoint — generating a code requires shell access to the box running the API, a materially stronger trust boundary than "somewhere on the tailnet," which is the exact trust level that made `POST /devices` insufficiently protected before this existed). `server.ts`'s logger redaction gained `req.headers.authorization`.
4. **`apps/worker`** — `capture-parse.ts` gained an explicit invariant check (`row.rawText === null` throws loudly) rather than silently accepting a null now that the type allows it; enforces that `capture.parse` must never run against a still-transcribing PTT row (a future bug, not a current one — `ptt.transcribe` doesn't exist until Checkpoint 2).
5. **`packages/schema`/`packages/api-client`** — `devices.ts` schemas (`.strict()` throughout, the registration response is the only shape that ever includes the raw token, returned exactly once) and matching typed client functions; `inbox.ts`'s `raw_text` changed to `z.string().nullable()`.
6. **`apps/mobile`** — the Inbox screen's transcript rendering is now three-way: transcript present → show it; `raw_text: null` + `status: "pending"` → "Transcribing…"; `raw_text: null` + `status: "failed"` → "Transcription failed" (this maps cleanly onto the existing state machine with no new column, since a PTT row can only have null `raw_text` in exactly those two statuses).

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing two real lint errors (`require-await` on the two-context route registration and a throwaway test route) and one TS4111 (bracket-notation-required index-signature access) surfaced during this pass |
| 2 | Migration applies cleanly as `posops_migrator`, in both the dev and dedicated test databases | `\d devices`/`\d device_pairing_codes`/`\d notification_dispatch_log`/`\d inbox_items` all match the schema exactly, including the `one_primary_device` partial unique index and the `notification_dispatch_log_status`/`devices_platform` CHECK constraints |
| 3 | `posops_app` still cannot DDL, and can read/write the new tables | Direct `CREATE TABLE should_fail` as `posops_app` → `permission denied for schema public`; a direct `INSERT`/`DELETE` against `devices` as `posops_app` succeeds |
| 4 | Automated tests | 129 tests total across the workspace, all passing: `packages/core` 44 (+8 new, `device-auth.test.ts`), `packages/schema` 11, `packages/ai-providers` 14, `packages/api-client` 10 (+2 new), `apps/worker` 3, `apps/api` 42 across 7 files (+2 new files: `routes/devices.test.ts` and `plugins/device-auth.test.ts`) — covering pairing-code rejection (missing/unknown/expired/already-consumed), **atomic single-use under real concurrency** (`Promise.all` of two simultaneous registration attempts against the same code — exactly one succeeds), every auth rejection path (missing header, malformed header, unknown token, revoked device), primary-swap atomicity (exactly one `is_primary_reminder_device = true` after two swaps), self-only push-token `403`, idempotent revoke, and `last_seen_at` bumping |
| 5 | `apps/api` boots and serves real traffic | `tsx` against local dev Postgres; `GET /health` → `db: "connected"` |
| 6 | **Full live pairing → registration → auth → revoke cycle, real curl against a real running server, not just `.inject()`** | `pnpm --filter api pairing:generate` printed a real code → `POST /devices` with it → `201` + one-time token → **reusing the same code** → `401 invalid_or_expired_pairing_code` → `GET /devices` with the token → `200`, `last_seen_at` populated → `POST /devices/:id/revoke` → `200` → same token on `GET /devices` → `401 device_revoked` → **`GET /tasks` with no Authorization header at all** → `200`, confirming the security-boundary claim live: revoking a device blocks the device-specific routes but has zero effect on the existing Tailscale-only API surface |

All test data (the one real device row and pairing code created during step 6) deleted from the dev database afterward.

**Not yet done (deferred to later checkpoints, per the approved plan):** `notifications.dispatch`/`ptt.transcribe`/orphan-audio-sweep worker jobs, the Groq transcription client, `POST /transcribe`, the shared audio Docker volume (Checkpoint 2); all native/Expo work including the `KEY_POWER` app-deliverability spike, the exact-alarm strategy spike, and reboot-survival verification (Checkpoints 3–5); production deployment (Checkpoint 6).

## Phase 3 Checkpoint 2: API + worker behavior (2026-08-16)

Continues directly from Checkpoint 1, per the approved plan. No new database tables or migrations this checkpoint — everything below is new code against Checkpoint 1's existing schema.

**What was built:**

1. **`packages/core`** — `quiet-hours.ts`: `isWithinQuietHours(now, start, end, timezone)`, a pure function handling the overnight-wraparound case (e.g. 22:00→06:00) via `toWallClockComponents`. Used by `notifications.dispatch` to suppress `confirmation`/`digest` categories during a device's quiet hours — `alert` is never suppressed.
2. **`packages/ai-providers`** — `transcription-client.ts`: `transcribeAudio()` speaks the raw OpenAI-compatible multipart `/audio/transcriptions` contract directly (Node's global `FormData`/`Blob`, no new dependency), parsing `verbose_json`'s per-segment `avg_logprob` into a mean confidence signal. `resolve-transcription-connection.ts`: `resolveTranscriptionConnectionForTask()`, structurally parallel to `resolve-model.ts` but returns raw connection details (`baseUrl`/`apiKey`/`modelId`) instead of a Vercel AI SDK `LanguageModel` — reuses `ai_provider_connections`/`ai_models`/`ai_task_routes` and `credential-crypto.ts` exactly as-is, **zero schema changes**, no new `provider_type`. Deliberately **not** an extension of the chat-oriented abstraction: `TranscriptionModel` is a structurally different SDK type from `LanguageModel`, and `@ai-sdk/openai-compatible` (the adapter every non-native vendor in this codebase goes through) has no transcription support at all — confirmed by reading `adapter-registry.ts` directly, not assumed. No fallback chain (Phase 3 only ever configures one STT provider). No dedicated unit test file for the resolver itself — matches `resolve-model.ts`'s own established precedent of zero dedicated tests for DB-querying resolution logic; its behavior (including the `NoProviderConfiguredError` path) is instead covered by `apps/worker`'s real-Postgres-backed `ptt-transcribe.test.ts`.
3. **`apps/api`** — new dependency `@fastify/multipart`. `routes/transcribe.ts`: `POST /transcribe`, Tailscale-only (matching `/capture`'s auth posture, not folded into the device-token scope), multipart parsing via `request.parts()`, `client_uuid` dedupe reusing the exact `onConflictDoNothing` pattern already in `capture.ts`, write-before-processing (`raw_text: null`, `audio_path` set, before any transcription work happens). `queue-names.ts` gained `PTT_TRANSCRIBE_QUEUE`; `plugins/boss.ts` now creates it. New `AUDIO_STORAGE_PATH` env var (shared with `apps/worker`), defaulting to `/tmp/personal-os-audio` locally.
4. **`apps/worker`** — new dependency `expo-server-sdk`. `jobs/notifications-dispatch.ts`: an explicit `pending`/`accepted`/`failed` state machine on `notification_dispatch_log`, with **per-target Expo ticket error classification verified against the actual installed `expo-server-sdk@7.1.0` type definitions** (not assumed) — `DeviceNotRegistered`/`MessageTooBig`/`MessageRateExceeded`/`InvalidCredentials` are treated as permanent (finalized `failed` immediately, never retried; `DeviceNotRegistered` additionally clears that device's `push_token`), everything else (network failures, unrecognized error codes) is transient and left `pending` for pg-boss's own retry. A `deadLetter`-registered dead-letter queue (`notifications.dispatch.dead`) finalizes any row still `pending` once retries are genuinely exhausted, so a row can never linger forever with no terminal state. `jobs/ptt-transcribe.ts`: idempotency via presence of `audio_path` (not attempt count), commits the transcript *before* deleting the source file, hands off to the **existing, unchanged** `capture.parse` job on success, and uses the identical `deadLetter`-driven terminal-cleanup pattern for exhausted transient retries. `jobs/sweep-orphan-audio.ts`: hourly cron, deletes any file in `AUDIO_STORAGE_PATH` older than 2 hours with no matching `inbox_items.audio_path` — the required backstop for the crash window between committing a transcript/failure and this project's own subsequent file delete. `index.ts` wiring: **both dead-letter queues are created via `createQueue()` before their primary queues** — verified by reading pg-boss's actual installed source (`dead_letter` is a foreign-key column against `queue.name`, not an auto-created convenience) rather than assumed, and confirmed correct in practice by booting the worker for real with zero FK errors.
5. **Docker** — `docker-compose.yml` gained a shared `audio_data` named volume mounted into both `api` and `worker` at `/data/audio`, matching `AUDIO_STORAGE_PATH`.

**A real bug caught only by running the actual test suite and inspecting the filesystem afterward, not by any automated assertion:** `POST /transcribe`'s route handler writes real files to disk, and neither `apps/api`'s nor `apps/worker`'s test suites isolated or cleaned up `AUDIO_STORAGE_PATH` — both silently used the same real default path (`/tmp/personal-os-audio`) a genuine local dev run also uses, and `apps/api`'s tests left real files behind indefinitely (no cleanup at all). Fixed by giving each package its own dedicated test-only `AUDIO_STORAGE_PATH` override in `vitest.config.ts`, plus explicit `afterAll` cleanup in `transcribe.test.ts`. Verified by a fresh full-suite run producing zero leftover files under `/tmp/` afterward.

**A second real bug, caught by the automated suite itself:** the first draft of `notifications-dispatch.test.ts` mocked `expo-server-sdk`'s `Expo` class as an arrow function (`vi.fn().mockImplementation(() => ({...}))`) — arrow functions have no `[[Construct]]` internal method, so `new Expo()` inside `notifications-dispatch.ts` threw `TypeError: ... is not a constructor` at module-load time. This crashed the whole test file and produced a confusing, unrelated-looking cascading failure in a separately-scheduled test file (`ptt-transcribe.test.ts`) within the same worker test run — resolved by re-running that file in isolation first (it passed cleanly on its own, proving the fault was elsewhere) before finding the actual cause. Fixed by using a named `function` expression in the mock instead.

**Verification actually run:**

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after fixing the two bugs above plus two ESLint issues (`no-restricted-syntax`-style inline `typeof import()` type annotations, and `unbound-method` false positives on `boss.send` property access — fixed by referencing a local `vi.fn()` directly instead of a property path) |
| 2 | Automated tests | **165 tests total across the workspace, all passing (41 new)**: `packages/core` 49 (+5, `quiet-hours.test.ts`), `packages/ai-providers` 20 (+6, `transcription-client.test.ts`), `packages/schema` 11, `packages/api-client` 10, `apps/worker` 27 (+24: 13 `notifications-dispatch.test.ts`, 7 `ptt-transcribe.test.ts`, 4 `sweep-orphan-audio.test.ts`), `apps/api` 48 (+6, `transcribe.test.ts`) — covering the full `pending`→`accepted`/`pending`→`failed`(permanent, no retry)/`pending`→rethrow(transient)/dead-letter-finalizes-still-pending state machine, `DeviceNotRegistered` clearing `push_token`, quiet-hours suppression (confirmation suppressed, alert never suppressed, verified with `vi.useFakeTimers`), `ptt.transcribe`'s audio-path idempotency and commit-before-delete ordering, and the orphan sweep's age-threshold/still-referenced-file/missing-directory behavior |
| 3 | `apps/api`/`apps/worker` boot and serve real traffic | Both booted via `tsx` against local dev Postgres; worker log confirmed `notifications.dispatch.dead`/`ptt.transcribe.dead` created before their primary queues with **zero foreign-key errors** — the dead-letter ordering requirement, verified correct in practice, not just in the source |
| 4 | **Full live `POST /transcribe` → worker → graceful-degradation cycle, real curl against a real running server with a real (small, synthetic) audio file, not just `.inject()`** | `POST /transcribe` with a real multipart upload → `202` + `inbox_items` row (`raw_text: null`, `source: "ptt"`, `audio_path` set, `status: "pending"`) → the running worker's `ptt.transcribe` job picked it up and, since no `voice_transcribe` provider is configured in this environment (confirmed empty `ai_provider_connections`/`ai_task_routes` tables), gracefully finalized it `status: "failed"` with `audio_path` cleared **and the uploaded file actually deleted from disk** — the same graceful `NoProviderConfiguredError` degradation pattern already proven for `capture.parse` in Phase 1, now proven for `ptt.transcribe` too. A second identical `POST /transcribe` (same `client_uuid`) confirmed live dedupe: same `inbox_id` returned, exactly one row in the database |

All test data (the one real `inbox_items` row and its audio file from step 4) deleted afterward; both servers stopped.

**Not yet verified — explicitly, because the required real credentials don't exist in this environment:**

- **No real `voice_transcribe` provider is configured** (confirmed via a direct query: zero rows in `ai_provider_connections` and `ai_task_routes` in the dev database). The actual Groq (or any real STT vendor) transcription happy path — a real audio file producing a real transcript, and the `avgLogprob` confidence signal it feeds — has **not** been verified end-to-end. What **is** verified: the multipart request/response contract itself against a mocked `fetch` (`transcription-client.test.ts`), and the full pipeline's graceful behavior with no provider configured, both as an automated test and live over real curl (table row 4 above).
- **No device has a real Expo push token registered** in this environment. `notifications.dispatch`'s actual delivery to a real device via the real Expo Push API has **not** been verified end-to-end — only against a mocked Expo SDK. Registering a real device with a real push token isn't possible until Checkpoint 3's native build exists.
- Both gaps require the user to supply real credentials directly (a Groq/STT API key via the existing, unchanged `POST /ai/providers` routes; a physical device with a real push token, starting at Checkpoint 3) — neither is something this session can supply itself, per this project's standing rule that Claude doesn't handle raw API keys.

## Phase 3 Checkpoint 3: native app foundation (2026-08-17)

Opened with the planned Rabbit R1 hardware spike, per explicit instruction, before any UI work began. Everything below was verified on the actual physical unit — not a simulator, not `.inject()`.

### Hardware spike — conclusive, empirical, and negative for both inputs

Environment: the R1 reconnected via `adb` (it had disconnected between sessions). Local native build tooling had to be assembled from scratch — the Android SDK's build-tools/platforms/cmdline-tools were already present (from earlier `adb`-only setup), but no JDK was linked; a Homebrew-installed `openjdk@17` (already present, just unlinked from `PATH`/`JAVA_HOME`) was wired up directly rather than reinstalling anything.

**First native build surfaced two real, previously-latent bugs** — neither is a regression from this checkpoint's own code; both existed since earlier phases and were simply never exercised, because Phase 2's verification only ever used Expo's web bundler, never Metro's native transform pipeline:

1. **`apps/mobile/package.json`'s `babel-preset-expo` was pinned to a stale `~13.0.0`** (a pre-SDK-57-alignment version scheme), pulling in `@react-native/codegen@0.79.0-rc.4` alongside the correct `0.86.2` used elsewhere in the dependency tree. The mismatch broke Metro's codegen parser on react-native's *own* `VirtualViewNativeComponent.js`, crashing the JS bundle load entirely. Fixed via `npx expo install babel-preset-expo`, which correctly resolved `~57.0.7`.
2. **`packages/core/src/timezone.ts`'s `isValidTimezone` used `Intl.supportedValuesOf("timeZone")`** — an ES2022 addition Hermes (React Native's JS engine) does not implement, even though Node and every browser do. Every screen that imports `packages/schema` (which imports this function) blanked silently with `[TypeError: undefined is not a function]`, visible only via a hidden LogBox overlay (itself rendered black-on-black, invisible in a screenshot — found via a raw UI-hierarchy dump, not the screen itself). Fixed to use the portable `new Intl.DateTimeFormat(undefined, {timeZone: tz})`-throws-on-invalid pattern instead, which works identically across Node, browsers, and Hermes. Rebuilt `packages/core` and re-ran its 49 tests clean.
3. A third, environmental (not code) issue: **the R1's WiFi is disabled** (USB-only) — Metro's own port (8081) already worked via an `adb reverse` tunnel Expo's CLI sets up automatically, but reaching the locally-running API server (port 3000) for functional testing needed the same treatment added manually (`adb reverse tcp:3000 tcp:3000`).

**KEY_POWER spike result: negative, conclusive.** A native `dispatchKeyEvent` override (`apps/mobile/plugins/withHardwareInputBridge.ts`, an Expo config plugin patching the generated `MainActivity.kt` so the bridge survives every future `expo prebuild`) bridges `KEYCODE_POWER` into a `HardwareSideButtonEvent` DeviceEventEmitter event. During a live 90-second capture with the debug screen confirmed in foreground throughout, the user pressed the side button (short and long) — `adb logcat` showed `PowerManagerService: Going to sleep due to power_button` firing four times; **zero** `HardwareSideButtonEvent`s and **zero** `ReactNativeJS` log lines appeared. The button is handled as a literal system power button before Android ever queues the event for app dispatch.

**Scroll-wheel spike result: negative, conclusive.** The same bridge forwards `KEYCODE_DPAD_UP`/`DOWN` as `HardwareScrollWheelEvent`. During the same capture, rotating the wheel produced rapid, repeated `SystemUI` `VolumeDialogImpl: showH r=volume_changed` log lines (matching the previously-confirmed 8-12-events-per-rotation burst cadence) — the system intercepts these exact key codes as literal volume control. Again, zero app-level events, zero `ReactNativeJS` lines.

**Both results directly correct the optimistic reading of the raw `adb getevent` kernel-level capture from Phase 3 planning** — that capture proved the kernel driver fires real interrupts, but could not and did not prove anything about Android's higher policy layer, which on this ROM claims both key codes for system-level semantics before any app ever sees them. This is exactly the distinction the plan review's explicit instruction ("do not assume either behavior from the raw getevent results alone") anticipated. The native bridge and JS-side debounce/coalescing logic are correctly implemented and harmless to keep — they would start working immediately if a future CipherOS update changes this interception policy — but neither is currently usable as an app-level input. **Touch is not a fallback on this hardware; it is currently the only working interaction mechanism**, exactly as the checkpoint's own constraints already required regardless of the spike's outcome.

### What was built

1. **`packages/core`** — the Hermes-compatibility fix to `isValidTimezone` described above (a real bug fix, not new functionality).
2. **`apps/mobile/plugins/withHardwareInputBridge.ts`** — new Expo config plugin (new devDependency `@expo/config-plugins`), patches `MainActivity.kt`'s `dispatchKeyEvent` to bridge the two Rabbit-specific key codes into `DeviceEventEmitter`. Verified to survive `expo prebuild` regeneration (re-ran prebuild, confirmed the patch reapplied).
3. **`apps/mobile/src/hardware-input/`** — the isolated hardware-input abstraction: `useScrollWheel()`, a debounced hook coalescing the confirmed multi-event burst into one logical scroll call within a 200ms trailing window, direction-reversal-aware. Exported through a single barrel (`index.ts`). No screen anywhere checks `Platform`/device model directly for Rabbit-specific purposes — this directory is the only place that concept exists, satisfying the "don't scatter vendor checks" constraint. Currently inert per the spike, by design not a required dependency for anything.
4. **`apps/mobile/src/app/hardware-debug.tsx`** — a diagnostic screen (reachable via deep link only, `mobile://hardware-debug`, not primary navigation) built for the spike and kept as a standing tool for future hardware-input work.
5. **`apps/mobile/src/device-identity/`** — `storage.ts` (`expo-secure-store` wrapper for the device token + id — new dependencies `expo-secure-store`, `expo-application`), `provider.tsx` (a React context loading credentials once from SecureStore on mount, the single source of truth every device-authenticated query hook reads from), `pairing-screen.tsx` (device name — defaulted from `expo-device`'s real device-name detection — + pairing-code form, calling the existing, unchanged `POST /devices`).
6. **`apps/mobile/src/app/_layout.tsx`** — restructured into a whole-app gate: no stored credentials → `PairingScreen` renders in place of everything else; credentials present → the existing `Stack`, now also registering `settings` and `hardware-debug` routes.
7. **`apps/mobile/src/app/(tabs)/_layout.tsx`** — a shared settings header icon (⚙️, via `screenOptions.headerRight`) across all four tabs rather than a 6th tab — the small-screen decision from the Phase 3 plan, given the R1's 480px-wide display.
8. **`apps/mobile/src/app/settings.tsx`** — device list, primary-device selection (`POST /devices/:id/primary`), per-device notification toggles (`PATCH /devices/:id` for `notify_confirmations`/`notify_alerts`/`notify_digests`), revoke, and a local "forget this device" sign-out (clears SecureStore only, does not itself revoke server-side).
9. **`apps/mobile/src/queries/devices.ts`** — TanStack Query hooks wrapping the existing `packages/api-client` device functions, reading the bearer token from `DeviceIdentityProvider` rather than SecureStore directly on every call.
10. **`apps/mobile/eas.json`** — `development`/`preview`/`production` build profiles (APK build type for internal distribution). Written but not yet exercised — no `eas build` was run this checkpoint; every verification below used a local `expo run:android` build, which needs neither an EAS account nor a final package name.

**Rabbit-R1-optimized responsive layout**: achieved via NativeWind's existing mobile-first styling applied uniformly to every new screen (large touch targets, single-column vertical layouts) rather than any Rabbit-specific conditional logic — this benefits any small screen generically and keeps normal Android phones equally usable, satisfying the "no scattered vendor checks" / "normal phones must remain usable" constraints simultaneously rather than in tension.

### Verification actually run

| # | Check | Result |
|---|---|---|
| 1 | `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check` | All clean, workspace-wide, after the two real bugs above |
| 2 | Automated tests | 165 tests, all passing (unchanged count — no new automated tests this checkpoint; device-identity/pairing/settings code has no automated coverage yet, matching this project's established minimal-mobile-testing philosophy from Phase 2 — verified via the real device instead, not skipped) |
| 3 | **Fresh registration, live on the real R1** | Generated a real pairing code via `pnpm --filter api pairing:generate`, typed it into the actual device, submitted → `POST /devices` → `201` in the API log → app transitioned from `PairingScreen` to the main Tasks screen |
| 4 | **Token persistence across a real app restart** | Force-stopped and relaunched the app via `adb`; it went straight to the Tasks screen with no re-pairing prompt, confirming `expo-secure-store` correctly persisted and was read back on cold start |
| 5 | **Primary-device selection, live** | Tapped "Set as primary reminder device" in Settings; the `PRIMARY` badge appeared and the button correctly disappeared, backed by a real `POST /devices/:id/primary` → `200` in the API log |
| 6 | **Device notification settings, live** | Toggled the Digests switch; confirmed a real `PATCH /devices/:id` → `200` in the API log and the toggle visually reflecting the new state after TanStack Query's invalidation refetch |
| 7 | KEY_POWER / scroll-wheel spikes | See above — both conclusively negative, recorded honestly rather than assumed |

The registered device (`rabbit r1`, this session's real pairing) was left in place — it is the actual working credential for continued Phase 3 work on this unit, not disposable test data, matching how the user's real AI-provider configuration was left in place after Phase 1's verification.

### Known items / not yet resolved

- The current local Android package is **`com.himal.personalos`**. No EAS build or store-distribution decision has been made; local verification continues through `expo run:android`.
- **No Expo/EAS account is logged in** (`eas-cli whoami` → "Not logged in", checked read-only, no login attempted). Neither this nor the package-name gate blocked anything this checkpoint; both remain open items for whenever an EAS-based build actually becomes necessary.
- A minor, non-blocking React warning ("Can't perform a React state update on a component that hasn't mounted yet") appears once during the pairing → main-app transition — functionally harmless (every subsequent action verified working correctly); most likely `PairingScreen` unmounting immediately after its mutation resolves. Not chased down further — doesn't affect any required behavior.

## Phase 3 Checkpoint 4: PTT + notifications + reboot survival (COMPLETE, 2026-08-18)

Implementation began only after explicit user approval. Production was not accessed or modified. No migration was added or changed.

### What is implemented

1. **Local reminder reconciliation:** the primary Android device pages through all inbox/active tasks, schedules future `remind_at` values locally, and diffs against the OS-owned schedule. Task edits replace stale alarms; done, dropped, archived, or absent tasks cancel them. Reconciliation is serialized, refreshes on foreground and polling, preserves already-scheduled alarms during ordinary API/Tailscale outages, and cancels Personal-OS-owned alarms on authoritative revocation, lost identity, disabled notifications, or loss of primary status. Exact-alarm capability is stored with each schedule so a permission change forces replacement rather than leaving an inexact alarm in place.
2. **Notification lifecycle:** Android channel and permission setup are platform-guarded; foreground notifications use an explicit handler; notification taps route task payloads to the task detail screen; TanStack Query follows native foreground/background focus. Settings include exact-alarm, local-delivery, reboot, push-token, remote-test, and outbox diagnostics. The API adds a self-only `POST /devices/:id/test-notification` endpoint targeting exactly that device.
3. **Reboot survival:** the planned early physical-device test passed with Expo Notifications' built-in mechanism. A two-minute reminder was scheduled, the Rabbit rebooted, Personal OS was not opened, `BOOT_COMPLETED` caused the stored exact alarm to be restored, and the notification fired. The conditional custom BroadcastReceiver/Headless JS fallback was therefore correctly not added.
4. **Capture outbox:** quick-add now persists to SQLite before the first HTTP attempt, retains the same `client_uuid` across retries/restarts, applies persisted exponential backoff, separates permanent client failures from retryable failures, and exposes pending/needs-attention counts. Startup, connectivity changes, foregrounding, and a bounded interval trigger flushing; public-internet reachability is deliberately not treated as authoritative for the private Tailscale API. A web localStorage implementation preserves the universal Expo web build.
5. **PTT state machine:** touch-driven `expo-audio` recording has guarded start/stop transitions, a two-minute cap, AppState/unmount cleanup, stable retry identity/audio, non-overlapping bounded polling, and distinct preparing/recording/stopping/uploading/transcribing/done/failed states. Expo SDK 57 requires an `expo-file-system` `File`/Blob multipart part; its fetch implementation intentionally rejects the older React Native `{uri,name,type}` shape, and the real-device upload now uses the supported path.
6. **Transcription confidence and confirmation push:** `ptt.transcribe` persists mean `avg_logprob`; low-confidence PTT transcripts join the existing parse-confidence signals. A durable `needs_confirm` row enqueues `notifications.dispatch` with an Inbox payload and stable dedupe key, including on retry after a crash between the row update and enqueue.
7. **Dispatch correctness:** queue definitions are identical in API and worker startup (including dead-letter linkage), terminal failed targets are not resent, `MessageRateExceeded` is retryable, missing Expo tickets remain pending, and diagnostics can target one device. Expo Push tokens receive structural validation. Automatic token registration runs at startup/foreground and awaits server persistence.
8. **Rabbit small-screen fix:** quick capture now respects keyboard and bottom safe-area insets. Before the fix, CipherOS rendered the Capture button inside the untappable system area; afterward it moved into the reachable 480×640 content area and the offline capture succeeded physically.
9. **Web/native compatibility:** SecureStore and SQLite have web storage adapters, notification APIs are web-guarded, and the exact-alarm module has an iOS stub. A production-mode Expo web export succeeds.

### Verification actually run so far

| Check | Result |
|---|---|
| Android debug native build | Successful on the physical Rabbit R1, including `expo-crypto` and `expo-file-system` native modules |
| Foreground local notification | Fired as an exact `RTC_WAKEUP`; visible while Personal OS remained foregrounded |
| Reboot protocol | Passed without reopening Personal OS; Expo's built-in boot restoration rescheduled and delivered the alarm |
| PTT record/upload/poll | Physical touch start/stop and retry states worked; SDK-57 multipart upload reached `/transcribe`; with no local STT route, the worker's deliberate terminal failure rendered “Transcription failed” rather than a network error or indefinite spinner |
| Offline outbox restart/replay | With API reachability removed: saved offline → force-stop/restart → Settings showed one pending capture. Restoring reachability flushed to zero and Inbox showed “Offline outbox checkpoint” exactly once |
| Exact-alarm bridge | The ROM's package/app-op reports are internally inconsistent, but actual scheduled alarms carry Android's exact-permission reason and deliver exactly; runtime behavior is the deciding evidence |
| Automated workspace gate | Build, typecheck, and lint pass. 200 tests pass when DB-backed API and worker packages are serialized; the root test command now enforces this because both suites intentionally share `personalos_test` |
| Formatting | `pnpm format:check` passes |
| Web regression | `expo export --platform web` succeeds |

### Checkpoint 4 hardening follow-up (2026-08-17)

Implemented only the four post-audit hardening items approved after commit
`76b314c`: the PTT lifecycle effect now explicitly restores its mounted ref
when mounted (including StrictMode development effect re-invocation); direct
deferred-promise concurrency tests prove reminder reconciliation and capture
outbox operations remain serialized, preserve call order, execute exactly once,
and continue after an earlier operation fails; reminder reconciliation now
self-heals duplicate Personal OS alarms by retaining exactly one matching alarm
and cancelling only the owned extras; and the temporary
`inbox_items.confidence` PTT `avg_logprob` handoff semantics plus the future
dedicated-field cleanup are documented without a migration or routing change.

Verification for this follow-up: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, and the full serialized `pnpm test` suite all pass (200
tests total, including 22 mobile tests). `pnpm --filter mobile exec expo export
--platform web` succeeds. The touched native PTT/notification paths warranted
an Android check, and `./gradlew assembleDebug` succeeds with JDK 17 (489 tasks;
only existing Gradle deprecation notices and cross-volume hard-link fallbacks).
No credentials were configured, no migration was added, production was not
accessed, and no later checkpoint work began.

### Real `voice_transcribe` STT gate — CLOSED (2026-08-17)

Verified against a real Groq account on **local development only** (production
untouched, nothing deployed, no migration). The user enabled
`whisper-large-v3-turbo` and `openai/gpt-oss-20b` on the Groq project
mid-session after both were initially blocked at the project level.

Configured through the existing `/ai/providers` → `/ai/models` →
`/ai/task-routes` endpoints and the existing AES-256-GCM credential
encryption — no direct database writes, no key in `.env`, the repository, or
any log. Non-secret identifiers: provider `09016fd3-081c-46e6-8c61-8a74bb84693c`
(`openai_compatible`, `https://api.groq.com/openai/v1`); models
`496bf3e9-52ff-4c89-a6f4-164c69d294f3` (`whisper-large-v3-turbo`) and
`153271de-b227-4a87-bc57-6209d27ffed2` (`openai/gpt-oss-20b`); routes
`1020f76b-ce2d-46a7-a876-91ac40bd3767` (`voice_transcribe`) and
`cd2d8104-10d6-415e-9e19-e772f2558c51` (`capture_parser`), both with no
fallback. Credential-safety re-checked after configuration: the stored row is
real AES-256-GCM (56B ciphertext / 12B IV / 16B auth tag) and does not contain
the plaintext in any encoding; `GET /ai/providers` exposes no key material; no
local log, tracked file, or untracked repo file contains the key.

**Five real captures were run on the physical Rabbit R1**, driven through the
device's actual microphone (speech played acoustically into the unit), not by
injecting an audio file. The complete path was exercised: R1 mic → `expo-audio`
→ multipart `POST /transcribe` → persisted temporary audio → `ptt.transcribe` →
real Groq `whisper-large-v3-turbo` → transcript + `avg_logprob` → `capture.parse`
→ real `openai/gpt-oss-20b` → entity or `needs_confirm`.

| Capture | Transcript (real) | `avg_logprob` | Outcome |
|---|---|---|---|
| clear task | " Remind me to call the insurance company tomorrow at 3 p.m." | **-0.1592956** | `parsed` → task "Call insurance company", `remind_at` 2026-08-18T20:00Z (3pm CDT — DST-correct) |
| note-shaped | " . Idea, build a weekly review dashboard for the home server." | (overwritten) | `needs_confirm`, flag `typeAmbiguous` — the two temperature-0.3 samples genuinely disagreed; parsed as `create_note` |
| gibberish | " The Farris Quandary Bramblewick 16 Thistle Apparatus Mumble…" | (overwritten) | `needs_confirm`, flag `modelUnclear` (`unclear` tool) |
| near-silent | " ." | (overwritten) | `needs_confirm`, flag `modelUnclear` |
| quiet task | " Remind me to buy printer paper on Thursday afternoon." | **-0.21939197** | `parsed` → task "Buy printer paper" |

`avg_logprob` **is** returned by `whisper-large-v3-turbo` and is genuinely
propagated: on the last capture the raw value was observed in
`inbox_items.confidence` while the row was still `pending` (before
`capture.parse` ran) and survived unchanged into `parsed`, which is exactly the
temporary-overload behaviour documented for that column. Rows routed to
`needs_confirm` have it overwritten with `0`, also as documented.

Also verified per capture: audio cleanup succeeded (`audio_path` cleared and
`/tmp/personal-os-audio` empty after every capture), no duplicate Inbox row was
produced (zero `client_uuid` collisions across all PTT captures), and a
confirmation `notifications.dispatch` job was enqueued and completed for a
`needs_confirm` capture — writing no `notification_dispatch_log` rows because
the device still has no push token, which is the correct no-eligible-target
behaviour rather than a failure.

**Observed MIME chain** (the previously identified residual risk, resolved by
observation rather than by a speculative change):

| Stage | Observed value |
|---|---|
| Rabbit recording | `.m4a` (expo-audio `RecordingPresets.HIGH_QUALITY`, Android `mpeg4`/`aac`) |
| `expo-file-system` `File.type` | a MIME the API maps to `.mp3`, i.e. `audio/mpeg` (Android `MimeTypeMap`'s mapping for `.m4a`); `audio/mpeg` and `audio/mp3` are indistinguishable from the stored extension alone |
| multipart file MIME | as above |
| multipart original filename | `"audio"` — expo's `File` implements `Blob` but exposes no `name`, so `transcribe.ts`'s `file.name ?? "audio"` fallback applies |
| API-selected storage extension | `.mp3` |
| stored temporary filename | e.g. `daaa840f-da00-486c-9ef0-c6bea2639da9.mp3` |
| worker-derived MIME | `audio/mpeg` (from `.mp3`) |
| filename/MIME sent to Groq | `<uuid>.mp3` + `audio/mpeg` |

The feared `.bin` outcome did **not** occur. The bytes are MPEG-4/AAC but are
labelled `.mp3`/`audio/mpeg` end to end, and Groq's Whisper endpoint accepted
and transcribed them correctly on every capture — it decodes by content, not by
the declared extension. No MIME/extension fallback was implemented, because
nothing failed; per the standing instruction, a speculative change was not made.
This remains a latent fragility worth revisiting only if a future STT provider
validates by extension.

Two further real observations, neither requiring a code change:

- The first capture's Groq request hit a transient IPv6 connect timeout
  (`UND_ERR_CONNECT_TIMEOUT` against `2a06:98c1:...:443`) on a dual-stack path.
  pg-boss retried and the second attempt succeeded, which incidentally proved
  the transcription retry path, the fact that source audio is preserved across a
  failed attempt, and that the retry produced no duplicate Inbox row.
- Because that retry pushed end-to-end latency past 60s, the PTT button's
  bounded polling reported "Transcription is taking longer than expected" for a
  capture that had in fact succeeded server-side. The row was durable and
  correct throughout; this is the implemented bounded-polling policy behaving as
  designed, not data loss, but the wording can read as failure.

The parser leg was also exercised for real: `openai/gpt-oss-20b` produced
correct tool calls and DST-correct datetimes. One accuracy miss worth recording
honestly — "Thursday afternoon" resolved to Wednesday 2026-08-19 rather than
Thursday 2026-08-20. That is model quality, not a pipeline defect, and no
confidence signal flags it because a date *was* resolved.

Not exercised, reported honestly: the `lowTranscriptionConfidence` routing
threshold (`avg_logprob < -0.8`) was never reached across five real captures.
`whisper-large-v3-turbo` stayed confident even on deliberately quiet, fast and
nonsense audio (worst observed `-0.219`), and audio degraded far enough to score
worse instead produced text the parser terminated as `unclear` first — a branch
that returns before the transcription-confidence signal is computed. The signal
itself is verified by `packages/core`'s unit tests; with this provider the
`-0.8` threshold appears effectively unreachable in practice.

### Real Expo Push gate — CLOSED (2026-08-18)

Verified on the physical Rabbit R1 against real Firebase/FCM V1 credentials.
Local development only: production was never accessed, nothing was deployed, no
migration was added, and no unrelated secret was rotated.

**Configuration.** Firebase project `personal-os-196cf` (project number
`868049601968`); Android app registered against the confirmed permanent package
`com.himal.personalos` (mobilesdk app id
`1:868049601968:android:bbaaedd77bfc0417a10275`). `google-services.json` is
placed at `apps/mobile/google-services.json`, referenced by
`android.googleServicesFile`, and **git-ignored** — Google formally treats it as
non-secret since it ships inside the APK, but it embeds a Google API key, so it
is excluded as defense in depth consistent with this repo's posture. Prebuild
copies it to `android/app/` and applies `com.google.gms.google-services`.

The FCM V1 **service-account key** was uploaded by the user directly from their
own terminal via `eas credentials` → Android → Google Service Account → *Manage
your Google Service Account Key for Push Notifications (FCM V1)*, so the private
key never passed through this session, the repository, or any log. EAS reported
`Google Service Account Key assigned to com.himal.personalos for FCM V1`. The
EAS project is `@himal_pok/mobile` (`b704be80-5b01-411e-9239-fa0cea642783`).
No Android upload keystore was created: the browser wizard demands one, but the
CLI path does not, and local `expo run:android` builds are signed with Android's
own debug keystore, so a keystore would have been an unnecessary credential.

**Rebuild was mandatory and performed.** `google-services.json` is compile-time
native configuration, so the previously installed build could not acquire FCM
under any runtime action. Full `expo prebuild --clean` + local native build +
install on the R1. After it, logcat shows `FirebaseApp initialization
successful` — the previous blocker (`Default FirebaseApp is not initialized`)
is gone.

**A real, non-obvious failure was diagnosed rather than misattributed.** The
first token attempt after the correct rebuild still failed, with
`FirebaseMessaging: Failed to get FIS auth token` /
`java.io.IOException: SERVICE_NOT_AVAILABLE`. This was **not** an FCM or
CipherOS limitation: `dumpsys connectivity` reported `Active default network:
none` and `ping` returned `Network is unreachable`. The R1's Wi-Fi had been left
disabled since the Checkpoint 3 hardware spike, so the device reached the API
only through `adb reverse` port tunnels and had no route to
`firebaseinstallations.googleapis.com`. Enabling Wi-Fi (it auto-joined a saved
network; 9.7 ms to 8.8.8.8) resolved it immediately.

**CipherOS GMS support is confirmed, not assumed:** `com.google.android.gms`
(Play Services **26.30.32**), `com.android.vending` and
`com.google.android.gsf` are all installed and enabled. The earlier open
question about whether this community ROM could support FCM is answered
affirmatively by real delivery.

**Real ExpoPushToken acquired and persisted.** Device row
`15017e8f-ddc0-4aa0-aa57-67ad808482b1` holds a token matching
`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$` (41 chars), written through the
existing self-only `POST /devices/:id/push-token` endpoint. The full token is
deliberately not recorded here.

| # | Test | Expo request | Ticket | `notification_dispatch_log` | Physically received | Presentation |
|---|---|---|---|---|---|---|
| 1 | Self-targeted diagnostic (`POST /devices/:id/test-notification`, `deviceId` targeting) | attempted | `01a0133c-532e-71ec-a43a-8f6c33b4f05c` | `accepted` | **yes** — "Personal OS test / Remote notifications are configured for this device." | **foreground** (app open on Settings; presented via `setNotificationHandler`) |
| 2 | Real `notifications.dispatch` worker path | exercised by both rows below/above — test 1 via explicit `deviceId`, test 3 via category fan-out with no `deviceId` | — | — | — | — |
| 3 | Real capture → `needs_confirm` → confirmation push | attempted | `01a0133d-a3ad-7798-…` | `accepted` | **yes** — "Capture needs confirmation / asdf qwerty zzz" | **background** (app backgrounded via HOME) |

Dispatch health across the session: 7 `notifications.dispatch` jobs, all
`completed`, zero retries and zero failures; 2 dispatch-log rows, both
`accepted` with a ticket and no `last_error` — per-device dedupe produced no
duplicate sends. Per ADR-030 the ticket only proves Expo accepted the request;
the physical receipt above is the actual happy-path evidence, and it was
obtained for both foreground and background.

**Honest gaps recorded, not fixed in this gate:**

- **Confirmation notifications are inert on tap.** `capture-parse.ts` publishes
  `data: { inboxId }`, but `use-notification-lifecycle.ts` routes only on
  `data.taskId`. Tapping a confirmation notification brings the app forward but
  navigates nowhere. Local *reminder* notifications do carry `taskId` and route
  correctly, so this affects the confirmation category only. Deliberately not
  changed here: choosing the destination is a product decision, and there is no
  `inbox/[id]` route today — only the Inbox tab.
- Logcat notes `Missing Default Notification Channel metadata in
  AndroidManifest. Default value will be used.` Delivery is unaffected;
  `expo-notifications`' `defaultChannel` plugin option would silence it.

### Still open before Checkpoint 4 can be called complete

Nothing. Both credential-dependent gates are now closed. Checkpoint 5 still owns
the complete lifecycle matrix (foreground/background/swiped-away/Force-Stop),
revoke/security-boundary recheck, and any fixes that matrix finds — that is
Checkpoint 5 scope, not an open Checkpoint 4 item.

## Phase 3 Checkpoint 5: real-device lifecycle verification (COMPLETE, 2026-08-18)

Checkpoint 5 is a verification-and-defect-fixing checkpoint, not feature
development. Everything below was run against the **physical Rabbit R1** on
**local development only** — production was never accessed, nothing was
deployed, and no migration was added. Where a result is automated, mocked, or
inferred rather than physically observed, it says so.

The session began from a **fresh install** (`adb uninstall` → clean local
`expo run:android`), so every result reflects first-run state rather than
accumulated device state from Checkpoint 4.

### Documentation drift repaired first

`926ac3f` marked Checkpoint 4 complete in this file's header and in its
"Still open … Nothing" section, but four other places still described it as
in progress: the "Current objective" paragraph, the unchecked Checkpoint 4
box in "Completed", the Checkpoint 4 section heading, and both "Current work"
and "Next action". Those were documentation drift, not missing work — the
items they described as pending are documented as done, with device-level
evidence, further down the same file. All four were corrected.

### Defects found and fixed

Five findings. Four are fixed and re-verified on the device; one is recorded
as debt.

**1. Confirmation notifications were inert on tap.** `capture-parse.ts`
publishes `data: { inboxId }`, but `use-notification-lifecycle.ts` routed only
on `data.taskId`, so tapping a confirmation foregrounded the app and navigated
nowhere. Routing now goes through a pure `resolveNotificationRoute` helper and
sends confirmations to the Inbox tab (there is no `inbox/[id]` route; `taskId`
keeps priority). Fixed and verified live.

**2. Notification taps did nothing while a pushed screen was on top.** Found
while verifying fix 1: with Settings (or a task detail) on the root stack,
navigating to a tab route switched the tab *underneath* the pushed screen, so
the tap appeared to do nothing. This affected reminder taps too, not only
confirmations. The handler now dismisses to the root first
(`router.canDismiss()` → `dismissAll()`) and then navigates. Reproduced and
re-verified with Settings deliberately on top.

**3. Primary-device drift silently disabled all local reminders.** The live
state at the start of this checkpoint: three device rows all named
`rabbit r1`, the running install (`15017e8f`, holder of the real push token)
**not** primary, and the primary flag stranded on `f93e5ef9`, dead since
2026-08-17 13:45. Observed consequence: two eligible tasks with future
`remind_at`, app running, and **zero** Personal OS alarms registered with
Android. Root cause is not a logic bug — `use-reminder-reconciliation.ts`
correctly cancels owned alarms on a non-primary device, and ADR-019 forbids
auto-promotion — it is that rebuilding wipes SecureStore, which forces a
re-pair, which mints a new device row and strands primary status on the old
one, with nothing surfacing it. Settings now renders a banner naming the exact
blocking reason, driven by a pure `describeReminderEligibility`.

A related observation, recorded rather than changed: **revoking a device does
not clear its primary flag**, so a revoked row can continue to hold primary
and no device schedules reminders until primary is reassigned. The new banner
surfaces this on whichever device the user is holding.

**4. Exact-alarm permission was never requested, so a fresh install scheduled
reminders with a one-hour delivery window.** `targetSdk` is 36 and the app
declares `SCHEDULE_EXACT_ALARM` without `USE_EXACT_ALARM`, so Android 14+ does
not auto-grant it, and the grant does not survive reinstall. Observed directly
in `dumpsys alarm`: `window=+1h0m0s0ms` with **no** `exactAllowReason`, versus
`window=0 exactAllowReason=permission` after granting — other apps' alarms on
the same device showed the granted form throughout, which is what made the
difference legible. The app's own diagnostic reported "NOT granted".

This closes the exact-alarm half of `ARCHITECTURE.md`'s gotcha #6 ("Needs
runtime notification permission *and* exact-alarm permission for precise
scheduling. Request both during onboarding"), which had never been
implemented. Onboarding now prompts once per app run and deep-links to the
system page; the banner reports this degraded state distinctly from a blocked
one, since reminders *are* scheduled, just imprecisely.

Capability detection and alarm replacement needed no changes — both were
already correct. Granting the permission mid-session was observed replacing
the inexact alarms with exact ones on the next reconciliation pass, and
revoking it replaced them in the other direction.

This also **corrects a Checkpoint 4 claim**. That checkpoint recorded
"actual scheduled alarms carry Android's exact-permission reason and deliver
exactly". That is not true on a fresh install. Checkpoint 4 verified with a
two-minute test reminder, which Android delivers promptly regardless of
exactness, and was most likely running with the permission already granted by
hand.

**5. On the 480×640 screen the Quick capture modal was unusable with the
keyboard open.** `KeyboardAvoidingView`'s `behavior="height"` does not work
inside an Android `Modal` (the modal gets its own window, so the activity's
`adjustResize` never applies), which pushed the entire sheet — text field
included — off the bottom of the display. The user could not see what they
were typing and could not reach Capture or Cancel without first hiding the
keyboard by hand; pressing Back to do so dismisses the whole modal and
discards the draft. Checkpoint 4's safe-area fix addressed the navigation-bar
inset, not the keyboard inset. Replaced with explicit padding by the measured
keyboard height, which works on Android and iOS and is inert on web
(`react-native-web` exports `Keyboard.addListener`). Verified by typing and
tapping Capture with the keyboard still open — previously impossible.

### Recorded as debt, not fixed

- **`remind_at` has no create/update API path.** Neither `TaskCreateSchema`
  nor `TaskUpdateSchema` accepts it, so a reminder time can only be set by AI
  capture — there is no manual way to add or change one. This is why the
  Checkpoint 5 brief hedges "reminder-time change *where supported*". Building
  it is feature work, deliberately not done inside a verification checkpoint.
  This checkpoint drove `remind_at` via SQL, which is what capture writes
  anyway.
- **`quick-add-fab.tsx:30` hardcodes `source: "web"`**, so captures made from
  the Android app are recorded with `source = "web"`.
- A dev-build LogBox toast (a `SafeAreaView` deprecation warning from
  `react-native-safe-area-context`) overlays the bottom of the screen and
  covered the Quick capture buttons during testing. Development-only, absent
  from a production build, but it made the small-screen defect above harder to
  see.

### Lifecycle matrix — all five states, physical Rabbit R1

| State | Result |
|---|---|
| **Foreground** | Fired on time with the app focused; exactly one notification posted; tap routed to the task detail screen |
| **Background** | Fired with the launcher focused; exactly one notification |
| **Swiped from Recents** | Performed as the real gesture in the Recents UI (`am task remove` no longer exists on Android 16). Confirmed true swipe-away state — process killed, `stopped=false`, distinct from Force Stop — alarms survived and the reminder fired; expo's broadcast receiver woke the process to post it |
| **Reboot** | Schedule → `adb reboot` → **app never manually opened** (focus stayed on the lock screen throughout) → alarms restored as **exact** and the reminder fired. Re-confirms ADR-031 on a fresh install, and additionally shows restoration preserves exactness |
| **Force Stop** | Android cancels every Personal OS alarm (`stopped=true`, zero registered) and the reminder does **not** fire. This is expected Android platform semantics, **not** a Personal OS defect. Manual relaunch restores `stopped=false` and reschedules every still-eligible alarm |

An alarm whose time elapses **while the device is powered off** does not fire
on boot — observed once when a reboot window straddled the target time. This is
Android behaviour plus the deliberate `isEligible` rule excluding past
`remind_at` (which exists so a device that was off does not fire a burst of
stale reminders on next launch).

### Primary-device, notification-settings and revocation matrix

| Check | Result |
|---|---|
| Demotion (another device claims primary) | Owned alarms cancelled |
| Re-promotion | Alarms restored as exact, ~60s (the device query's refetch interval) |
| `notifications_enabled` false | Alarms cancelled |
| `notifications_enabled` true again | Alarms restored |
| Authoritative revocation (`revoked_at` set server-side) | App noticed via 401 and cancelled every owned alarm; Settings showed "Couldn't load devices." |
| Device-scoped route with a dead/bogus token | `401 invalid_token` |
| **ADR-029 boundary** | With the device revoked, `GET /tasks` → 200, `GET /inbox` → 200, `POST /capture` → 202, **with no `Authorization` header at all**. The documented boundary is accurate, not merely asserted: device-token revocation does not revoke the Tailscale-perimeter API, and a lost device still requires tailnet removal |
| Revoke → re-pair recovery (previously never exercised) | "Forget this device" → new pairing code → paired as a new device row → push token re-registered automatically → promoted to primary → reminders scheduling again as exact alarms |
| Stale device rows | Five rows now exist, all named `rabbit r1`; exactly one primary throughout, and no duplicate alarms were ever observed. Rows were **not** deleted to simplify testing |

### Task/reminder eligibility

Three tasks with future `remind_at` were created, confirmed scheduled, then
completed / dropped / archived respectively: alarm count went 6 → 3 and each
task reached the correct state. No stale reminder fired for an ineligible task
at any point in the session. Reminder-time changes were observed replacing the
alarm cleanly (tracked across three successive `remind_at` values, always
exactly one alarm for the task). Duplicate-repair remains covered by
`reconcile.test.ts` rather than physically injected; the "exactly one alarm per
task" invariant held across every reconciliation pass observed today.

### Foreground/background synchronization

Verified through the matrices above rather than as a separate pass: primary
changes, `notifications_enabled` changes, exact-alarm capability changes,
revocation, and server-side task state changes (complete/drop/archive) were
each noticed and acted on, via the foreground `AppState` trigger and the 60s
poll. Reconciliation continued to preserve already-scheduled alarms while the
API was unreachable.

### Offline capture matrix

Run with the **API process stopped** rather than by removing the `adb reverse`
tunnel. Removing the tunnel proved unreliable: an established keep-alive
socket survived it and captures still reached the server, so that method does
not actually simulate an unreachable API. Throughout the real test the device
kept Wi-Fi and public internet (18 ms to 8.8.8.8) — this is exactly the
"public internet available but Personal OS API unavailable" case.

| Step | Result |
|---|---|
| Capture with API down | "Saved offline — This will be sent automatically once you're back online."; `Pending captures: 1` |
| Force-stop and relaunch | Still `Pending captures: 1` — durable across real process death |
| API restored, **no connectivity transition** | Flushed automatically ~75s later on persisted-backoff expiry, with no manual action and no network change. This is the designed behaviour: the HTTP attempt is authoritative, not a reachability probe |
| Server rows | Exactly **1** |
| Manual "Flush now" + two foreground cycles afterwards | Still exactly 1 — no duplicate; `Pending captures: 0` |

### Real remote push

| Check | Result |
|---|---|
| Foreground push (self-targeted diagnostic) | Physically received; `notification_dispatch_log` `accepted` with a ticket and no error |
| Background push | Physically received with the launcher focused (count 0 → 1) |
| Real confirmation push | A real `needs_confirm` capture produced a confirmation push, physically received |
| Confirmation tap → Inbox tab | Verified, including from a pushed screen after fix 2 |
| Duplicates | None across the session |

Per ADR-030 an `accepted` ticket proves only that Expo accepted the request;
the physical receipts above are the delivery evidence.

### Network transitions

Distinguished explicitly: Wi-Fi up and validated (`dumpsys connectivity`
showed the network `VALIDATED`); API unreachable with internet up; API
restored without any connectivity transition. No failure in this session was
attributed to FCM or GMS without first checking the device's default network.

### Small-screen UX (480×640)

Exercised throughout via real taps driven from `uiautomator` bounds. Quick
capture's keyboard defect is fix 5 above. Otherwise: the pairing form, the
settings screen and its diagnostics, the device cards, the Inbox list with
long parse-result text, the task detail screen, the tab bar, notification
navigation, and the new eligibility banner all rendered within the 480×640
content area with no clipped primary controls.

### Web regression

`expo export --platform web` succeeds and emits SPA output (exactly one
`index.html`). Served with `serve -s dist`: `/`, `/tasks`, `/notes`,
`/projects` and a UUID deep link (`/tasks/<uuid>`) all return 200. Loaded in a
real browser: the app boots with **zero console errors** and renders the
pairing screen, confirming the SecureStore and SQLite web adapters work and
that no native notification API is reached on web. `react-native-web` exports
`Keyboard.addListener`, so fix 5's hook is web-safe.

### Stage H — PTT lifecycle (COMPLETE, 2026-08-18)

Run with the user physically at the Rabbit R1's microphone, driving every
touch and speech action themselves; this session drove the API/worker/DB
side and read back real evidence after each one. Real Groq
`voice_transcribe`/`capture_parser`, no mocking. **Zero application defects
found** — every scenario behaved as designed. The one issue encountered was
in this session's own test method for H6 (below), not in the app.

| Sub-stage | What was exercised | Result |
|---|---|---|
| H1 — normal happy path | "Remind me to water the plants tomorrow." | Real transcript, `avg_logprob -0.43343338`, `parsed` → task "Water the plants", `remind_at` correctly resolved to 9am America/Chicago the next day, audio cleaned, exactly 1 row |
| H2 — consecutive recordings | Two independent recordings back-to-back | Distinct `client_uuid`s, no state leak between them (each transcript contains only what was spoken in that recording); recording 1 → task "Send money and call Karan"; recording 2 (two intents in one utterance, "coffee shop" + "Meeting with Sarah") → correctly flagged `typeAmbiguous`, routed to `needs_confirm` |
| H3 — rapid/double-tap | Double-tap start, double-tap stop, then start→stop→start in quick succession | No crash, no duplicate upload — four short/near-silent recordings each got a distinct `client_uuid` and exactly one row; PTT remained fully usable afterward (idle icon, no stuck state) |
| H4 — background during recording | Start recording, background the app mid-speech via Home | The `AppState` listener (`use-ptt-recorder.ts`) stops recording the instant the app leaves `active` — confirmed by design read and by the near-silent transcript, since the user's speech continued only *after* backgrounding. Correctly classified `unclear`/`modelUnclear`, no orphaned recorder, no duplicate, audio cleaned, app returned usable |
| H5 — upload failure + retry | API process killed outright (not just `adb reverse` removal — Checkpoint 5's offline-outbox stage already found a removed tunnel alone can leave an established socket usable) | "Upload Failed — check your connection (tap to retry)"; confirmed **zero** server-side row while the API was down; API restored; retry reused the same `client_uuid`, succeeded, exactly one row and zero phantom rows across the whole failure window, task created |
| H6 — polling timeout while server work eventually succeeds | Worker paused before recording, held past the client's 60s polling bound, then resumed | See below — genuine reproduction, including a real methodology bug this session found and fixed mid-test |
| H7 — cleanup/audio lifecycle | Consolidated check across all 11 distinct captures from the session | Every row's `audio_path` cleared, `/tmp/personal-os-audio` fully empty at every checkpoint, including through the failure/retry and timeout/resume paths |
| H8 — idempotency | Consolidated check across all 11 captures | 11 distinct `client_uuid`s, each with exactly 1 `inbox_items` row and exactly 1 `ptt.transcribe` job (verified directly against `pgboss.job`, zero `inboxId`s with more than one job) |
| H9 — confidence sanity | Real `avg_logprob` observed across the session: `-0.43343338`, `-0.12421312`, `-0.5018217`, `-0.23860362` | Consistent with Checkpoint 4's finding — Whisper stays confident even on short/degraded audio, so `-0.8` was not reached. Real `typeAmbiguous` and `modelUnclear` confirmation flags both exercised for real ambiguous/unclear speech. Threshold left untouched, per the brief — `packages/core`'s unit tests remain authoritative for it |
| H10 — final usability sanity | One clean recording ("Buy milk tomorrow") after every stress scenario above | Parsed cleanly, PTT fully usable, no stale timers/poll generations, small-screen layout intact |

**H6 in detail, including a real test-methodology bug this session found and
fixed before the test was valid.** The worker runs under `tsx watch`, which
spawns a separate child process to execute the actual script — the first
attempt at "pause the worker" sent `SIGSTOP` to the `tsx watch` supervisor
PID, which does **not** propagate to its child; the child kept running
completely unaffected, and the job processed normally in under a second
despite the supervisor showing `T` (stopped) in `ps`. This was caught by
checking `pgboss.job`'s `started_on`/`completed_on` timestamps against when
`SIGSTOP` was actually sent, then confirmed by inspecting the process tree
(`pgrep -P`) and finding the unaffected child PID. Corrected by resuming the
supervisors and instead pausing the actual child processes. With the real
worker processes confirmed `T` and the pg-boss job confirmed `created` with
no `started_on`, a new recording was made and left untouched for 65+ seconds
— past the client's `TRANSCRIBING_TIMEOUT_MS = 60_000` bound. The UI showed
"Transcription is taking longer than expected. (tap to dismiss)", the audio
file remained on disk untouched, and the pg-boss job stayed `created`,
confirming the server-side work is genuinely durable while the client gives
up polling. The workers were then resumed; the job completed within seconds
into a real note, the Notes tab reflected the eventual result on refetch with
zero duplication, and PTT was immediately usable again after dismiss.

The wording itself ("Transcription is taking longer than expected") does not
claim failure, so per the brief it was left unchanged — it shares red/`!`
styling with genuine failures, but "tap to dismiss" (this path always has
`canRetry: false`) simply returns to idle rather than retrying, and the
result still lands correctly once the relevant screen next refetches. This is
the same behaviour Checkpoint 4 first observed with a real Groq retry; Stage
H reproduces it deliberately and confirms no data loss and no duplication
across it.

Stage H found **zero application defects** — no code changes were made as a
result, so no regression test was added and the automated suite is unchanged
at 214 tests (confirmed by a fresh `pnpm test` run after Stage H, same
count as before it). All Stage H test tasks/notes/events/inbox rows were
deleted from the dev database afterward; the pre-existing Checkpoint 4 STT
captures ("Call insurance company", "Buy printer paper") and the
"Checkpoint 4 local-reminder test" task were left in place, unchanged.

### Automated verification

| Check | Result |
|---|---|
| `pnpm build` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm lint` | Clean |
| `pnpm format:check` | Clean |
| `pnpm test` | **214 tests pass**, 12/12 turbo tasks — `packages/core` 53, `packages/ai-providers` 20, `packages/schema` 11, `packages/api-client` 11, `apps/api` 50, `apps/worker` 33, `apps/mobile` **36** (+14: `resolve-notification-route.test.ts` 5, `reminder-eligibility.test.ts` 9) |
| `expo export --platform web` | Succeeds |
| `./gradlew assembleDebug` (JDK 17) | Succeeds, 490 tasks |

One process note worth recording: an intermediate "gate green" reading during
this checkpoint was wrong. The command grepped only the passing-count line and
hid a failing suite — `scheduler.test.ts` was failing with
`ReferenceError: __DEV__ is not defined` because a new `requireNativeModule()`
import had been added to `channel.ts`, which `scheduler.ts` imports. Fixed by
moving the exact-alarm prompt into its own leaf module
(`notifications/exact-alarm.ts`), preserving the plain-vitest testability the
rest of that directory depends on. Gate commands afterwards surfaced the
overall task status, not just the passing count.

All Checkpoint 5 test tasks and inbox items were deleted from the dev database
afterward. Device rows were deliberately left in place.

