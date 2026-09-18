# Agent Readiness Inventory

**Produced:** Phase 10, Checkpoint 10.0 (2026-09-15). **Amended 2026-09-16** with §1a (the Canvas
boundary added by Checkpoint 10.1) and **2026-09-17** with §6 (the Action Framework added by
Checkpoint 10.8, ADR-078 — the write-side counterpart of §2); §1–§5 are otherwise as produced at
10.0 and their file:line references were not re-derived. **Purpose:** inventory the Personal OS
service boundaries that a future read-only or write-capable agent (Hermes/OpenClaw or otherwise)
would call, and name which of today's exports are canonical versus incidental. This is not a tool
design document and does not authorize building an agent — no agent runtime, tool loop, or
`posops_readonly` role exists yet. ADR-056's sequencing (read-only intelligence before
write-capable intelligence) and every locked privacy/egress decision (ADR-018, ADR-024, ADR-046,
ADR-052/053/054, ADR-058, ADR-066) are unchanged by this document.

Evidence for every row below was gathered by direct code inspection during Checkpoint 10.0's
canonical-boundary audit; file:line references point at the current tree.

---

## 1. Domain boundaries

| Capability | Canonical boundary | Read/write | Auth/consent boundary | Idempotency | Input schema | Output schema | Privacy sensitivity | Future-agent exposure |
|---|---|---|---|---|---|---|---|---|
| **Search** | `searchPersonalItems(db, input)` — `apps/api/src/search/service.ts:489` | Read | Tailscale perimeter only; no Cloud Ask grant needed | Pure/deterministic — identical request ⇒ byte-identical response | `SearchServiceInput` (route validates via `SearchQuerySchema`, `packages/schema/src/search.ts`) | `SearchResponseSchema` (`packages/schema/src/search.ts:381`) | Six entity types incl. mail (subject/display-name only) and external events (description scored, never emitted) | **Safe candidate** — already the designed `search_personal_items` tool binding (ADR-066 §4) |
| **Item context** | `getItemContext(db, ref, { includeBody })` — same file, line 670 | Read, body-bearing | Same as search | Pure | ref-based lookup | `ItemContextSchema` (`packages/schema/src/search.ts:425`) | Body is control-stripped, truncated, null for external events/mail | **Wrapper required** — body-bearing; a future exposure needs the same consent gating `buildTodayContext`/Ask already apply to bodies, not a bare pass-through |
| **Today intelligence** | `buildTodayContext(ctx: ReadContext, options?)` — `apps/api/src/intelligence/today-context.ts:169` | Read | `assertGrant(ctx.grant)` — a request-scoped `CloudAskGrant` minted only inside a live `POST /ask`/`POST /focus/suggestion` request (`apps/api/src/ask/authorize.ts:74`); no job/timer can mint one | Pure, but not time-deterministic (embeds wall-clock "now") | `ReadContext` + `{ preset? }` (no Zod input) | `TodayContextSchema` (`packages/schema/src/intelligence-tools.ts:116`), `.strict()`, id-free, ordinal-`ref`-only | Id-free and body-free by construction; capture text redacted before truncation; 12k-char ceiling with a drop ladder | **Safe candidate** — already written to become the `get_today_context` tool binding unchanged (ADR-066 §4) |
| **Today read model (first-party)** | `buildTodayResponse(db, query, { now })` — `apps/api/src/read-models/today.ts:205` | Read | Route-level only (no Cloud Ask grant — this serves the trusted client, not a prompt) | Pure | `TodayQuerySchema` | `TodayResponseSchema` | Full ids/instants/bodies as needed by the app UI | **Not for direct agent exposure** — use `buildTodayContext` instead, which wraps this with the redaction/id-stripping an agent needs |
| **Tasks — create** | `POST /tasks` — `apps/api/src/routes/tasks.ts:307` | Write | Tailscale perimeter | `client_uuid`-keyed dedupe; rule validated before insert | `TaskCreateSchema` | `TaskSchema` | Title/body bounded at write since 9.6; never sent to a model except via the redacted intelligence projection | **Approval required** — any write path needs its own ADR before an agent can call it |
| **Tasks — update** | `PATCH /tasks/:id` — `apps/api/src/routes/tasks.ts:408` | Write | Tailscale perimeter | Re-validates only fields set; re-seeds lazy occurrence on anchor change | `TaskUpdateSchema` | `TaskSchema` | same | **Approval required** |
| **Tasks — complete (non-recurring)** | `POST /tasks/:id/complete` — `apps/api/src/routes/tasks.ts:804` | Write | Tailscale perimeter | Idempotent only for non-recurring tasks; a recurring task with an open occurrence returns `409 recurring_task_use_occurrence` instead of completing | — | — | — | **Approval required** |
| **Occurrence complete/skip (the actual recurring-instance write)** | `POST /occurrences/:id/complete` \| `/skip` — `apps/api/src/routes/occurrences.ts:358`/`366` | Write | Tailscale perimeter | True idempotency: row `SELECT...FOR UPDATE` inside one transaction; a second call on a terminal row writes nothing (`transitioned: false`); successor insert is in the same transaction | `OccurrenceCompleteSchema`/`OccurrenceSkipSchema` | `OccurrenceSchema` | — | **Approval required + idempotency already proven** — the safest write candidate in this domain if an agent write lane is ever approved, precisely because its idempotency is transactionally real rather than best-effort |
| **Occurrence snooze/reopen** | `POST /occurrences/:id/snooze` \| `/reopen` — `apps/api/src/routes/occurrences.ts:384`/`461` | Write | Tailscale perimeter | Snooze only defers (`greatest(occurs_at, snoozed_until)`); reopen is latest-terminal-only, withdraws a completion-anchored parent's open successor in the same transaction | `OccurrenceSnoozeSchema` | `OccurrenceReopenResponseSchema` | — | **Approval required** |
| **Recurrence computation** | `computeNextLazyOccurrence` / `wallTimeOfNaiveTimestamp` — `packages/core/src/recurrence/lazy-next-occurrence.ts:233`/`61`; `resolveSeriesAnchor` — `packages/core/src/recurrence/series-anchor.ts:38` | Pure compute (no I/O) | N/A | Pure function; the *caller's* transaction + `occurrences_parent_occurs_at_key` unique index is what prevents a double-successor | Plain TS interfaces (`CompletionAnchoredRule`, options) | — | Operates on data already in the DB; no external egress | **Prohibited as a direct call** — must only be reached through the task/occurrence routes above, which thread validation → transaction → insertion correctly; calling it standalone is how "collision leaves no open occurrence" happens |
| **Events — create/edit** | `POST /events` — `apps/api/src/routes/events.ts:362`; `PATCH /events/:id`, `/detach`, `/cancel-occurrence`, `/archive`, `/link-calendar` — same file, lines 506/766/952/1038/1171 | Write (`origin='local'` only — `external` is hard-refused `409 event_not_owned`) | Tailscale perimeter | `client_uuid` on create (200 on retry); provider-side idempotency via link-derived remote ids; race-safe final write | `EventCreateSchema`/`EventUpdateSchema` | `EventSchema` | Title/description/location bounded at write since 9.6, but **do reach an external calendar provider (Google/CalDAV) on push** — the one domain where local data leaves the machine to a non-AI third party by design | **Approval + idempotency required** — an agent must check `origin` before any write attempt, exactly as the route does |
| **Calendar reads** | `GET /events/range` (→ `apps/api/src/read-models/event-range.ts`); `GET /agenda` (→ `apps/api/src/read-models/agenda.ts:240`) | Read | Tailscale perimeter | Pure | query schemas | `EventRangeItemSchema`/`AgendaResponseSchema` | `GET /events/range` includes external-event `description` verbatim (unlike search, which excludes it) — an asymmetry, not a bug, since this route serves the trusted first-party client | **Wrapper required if ever exposed to a model** — the raw route leaks more than `searchPersonalItems` does by design; an agent-facing wrapper would need the same description-stripping search already applies |
| **Notifications — dispatch** | `createNotificationsDispatchHandler(db)` — `apps/worker/src/jobs/notifications-dispatch.ts:166` (dead-letter at 293) | Write (enqueue-only from the caller's side; the handler is what actually calls Expo/FCM) | Internal (pg-boss job, no external caller) | `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY (ADR-058) — every producer must build an occurrence-scoped key (date/incident-id/occurrence-id), never a bare entity id | `NotificationsDispatchJobData` (plain TS interface) | — | Alert bodies scrubbed of personal identifiers; titles control-stripped/capped | **Prohibited as a direct call; enqueue-only if ever exposed** — a future agent tool must never construct a new device-push path, and any producer it triggers must carry a correctly-scoped dedupe key or it silently fires once ever |
| **Reminders — read** | `GET /reminders` → `buildRemindersResponse` — `apps/api/src/read-models/reminders.ts:98` | Read | Tailscale perimeter | Pure | `RemindersQuerySchema` | `RemindersResponseSchema` | Title only, strict shape (already in the intelligence egress-guard's body-reader inventory) | **Safe candidate** |
| **AI — provider resolution** | `resolveModelForTask(db, taskName, encryptionKey)` — `packages/ai-providers/src/resolve-model.ts:100` | Read (of config) | Throws `NoProviderConfiguredError` if no `ai_task_routes` row for `taskName` | Pure lookup | `taskName: string` | `ResolvedModel` | Reads encrypted credentials, decrypts in-process | **Never expose directly** — this is what a lane calls internally, not a capability an agent invokes |
| **AI — consent boundary** | `ai_task_routes` table + `POST/GET/DELETE /ai/task-routes` — `apps/api/src/routes/ai-config.ts:196/241/273`; Cloud Ask specific: `askRouteEnabled`/`askRouteConsentedAt`/`authorizeCloudAsk`/`assertGrant` — `apps/api/src/ask/authorize.ts` | Write (route creation is the on/off switch) | The row's presence **is** the consent — create-or-delete only, no boolean flag; `ask` ships absent (OFF) in production | Re-pointing an existing task's route is idempotent by upsert; a row created before `ASK_TODAY_CONSENT_FROM` is refused `409 ask_consent_outdated` | `AiTaskRouteCreateSchema` | `AiTaskRouteSchema` | Governs whether ANY model call for a task can happen at all | **Never expose to an agent as a callable tool** — this is the human consent gate itself; an agent that could create/delete its own consent row would be self-authorizing |
| **AI — hardened generation call sites (Guard 1, six pinned)** | `apps/api/src/ask/generate.ts`, `apps/api/src/brief/generate.ts`, `apps/api/src/focus/generate.ts`, `apps/api/src/routes/ai-config.ts` (connection-test), `apps/worker/src/jobs/capture-parse.ts`, `apps/worker/src/mail/digest/generate.ts` | Write (external API call) | Each requires its own `ai_task_routes` row; each is pinned to `maxRetries: 0` + `experimental_telemetry: { isEnabled: false }`, test-enforced | N/A (a call, not a stored write) | lane-specific | lane-specific | Each lane's context is independently bounded (see `buildTodayContext`/`selectAskContext`/`sanitizeModelText`) | **Never called directly by a tool** — a future agent composes through `POST /ask` (or a new lane with its own ADR), never `generateText` itself |
| **AI — context building / output filtering** | `buildTodayContext` (read-side, see above); `selectAskContext(...)` — `apps/api/src/ask/select-context.ts:153` (body-reading lexical selection, gated to `scope !== "today"`); `sanitizeModelText`/`containsLinkShapedContent` — `packages/core/src/ai/output-safety.ts:334/398` (shared by the Brief lane and the mail digest) | Read (context) / output transform | Same as the lane calling it | Pure | lane-specific | lane-specific | `selectAskContext` is the one path that reads note/task bodies — gated behind explicit non-preset questions only | **`buildTodayContext` safe; `selectAskContext` needs a wrapper** — any future exposure of body-reading context must reuse the SAME redaction/budget contract, not re-derive it |

---

### 1a. Canvas LMS (added by Checkpoint 10.1 / 10.1C, after this inventory was produced)

Read-only, Personal-Access-Token-authenticated (ADR-068). **Canvas data reaches no AI surface today**:
nothing under `apps/api/src/intelligence`, `brief`, `search`, `focus` or `read-models` references it,
so assignment descriptions and announcements — third-party-authored text in exactly the ADR-054 sense —
are never in a prompt. A future tool that exposes them must treat them as attacker-authored input and
go through the shared output filter (ADR-058), like mail.

| Capability | Canonical boundary | Read/write | Auth/consent boundary | Idempotency | Input schema | Output schema | Privacy sensitivity | Future-agent exposure |
|---|---|---|---|---|---|---|---|---|
| **Canvas — connect** | `connectCanvasConnection(db, input)` — `apps/api/src/services/canvas-connection.ts` (`POST /canvas-connections`, `apps/api/src/routes/canvas-connections.ts`) | Write (credential) | Tailscale perimeter only; the PAT is pasted by the owner | Since 10.1C: SELECT-then-write keyed on `canvas_base_url` — 201 creates, 200 reactivates the same row in place, `409 canvas_already_connected` if active, `409 canvas_account_mismatch` if the prior row belongs to another `canvas_user_id` | `CanvasConnectRequestSchema` (`packages/schema/src/canvas.ts`) | `CanvasConnectionSchema` — never the token, ciphertext, IV or tag | **Highest** — a live PAT; encrypted triple at rest, structurally all-or-nothing, never logged | **Never.** A credential write is an owner action, not a tool |
| **Canvas — disconnect** | `disconnectCanvasConnection(db, id)` — same file (`POST /canvas-connections/:id/disconnect`) | Write | Tailscale perimeter | Idempotent — NULLs the credential triple and sets `disconnected`; history rows retained | id | `CanvasConnectionSchema` | As above | Never |
| **Canvas — connections list / detail** | `GET /canvas-connections`, `GET /canvas-connections/:id` | Read | Tailscale perimeter | Pure | — | `CanvasConnectionsListResponseSchema` / `CanvasConnectionSchema`; `last_sync_error` is a machine-shaped class, never provider prose | Low (base URL, display name, status) | Read-only status is safe to expose |
| **Canvas — sync trigger / runs** | `POST /canvas-connections/:id/sync` (enqueues `canvas.sync-connection`, `apps/api/src/queue-names.ts`), `GET /canvas-connections/:id/sync-runs` | Write (enqueue) / Read | Tailscale perimeter | Trigger is `singletonKey`-deduped; the hourly `canvas.sync-cron` in `apps/worker/src/index.ts` is the normal path | — | `CanvasSyncTriggerResponseSchema` / `CanvasSyncRunsResponseSchema` | Low | A tool should never trigger sync; read `sync-runs` if freshness matters |
| **Canvas — upcoming assignments** | `listUpcomingCanvasAssignments(db, withinDays, now)` — `apps/api/src/routes/canvas-assignments.ts` (`GET /canvas-assignments/upcoming?within_days=`) | Read | Tailscale perimeter | Pure/deterministic for a fixed `now` | `CanvasUpcomingAssignmentsQuerySchema` | `CanvasUpcomingAssignmentsResponseSchema` (denormalized with course name) | Medium — coursework titles, due instants and a same-origin-checked `html_url` | The natural read boundary for a future `get_canvas_context`; **descriptions are third-party text** and must be filtered before any prompt |
| **Canvas — sync engine** | `apps/worker/src/canvas/orchestrate.ts` + `persist.ts`, client in `packages/canvas-providers` (SSRF guard `ssrf.ts`, ported from CalDAV) | Worker-owned | n/a | Content-hash upserts; six tables (migration `0020`) | — | — | Sync errors are recorded as a class in `last_sync_error`; `invalid_token` is a CHECK-vocabulary status that no worker path writes yet (10.1C, recorded debt) | Never called directly |

## 2. Future-agent tool contract as currently shipped (ADR-066 §4)

`packages/schema/src/intelligence-tools.ts:227` (`READ_TOOL_NAMES`) — schemas exist for all five;
implementations exist for three:

| Tool name | Implementation | Evidence |
|---|---|---|
| `search_personal_items` | **Bound** — `searchPersonalItems` | route + service live |
| `get_item_context` | **Bound** — `getItemContext` | same file |
| `get_today_context` | **Bound** — `buildTodayContext` unchanged | ADR-066 §4 |
| `get_calendar_context` | **Schema only** | zero production references; exercised only by `intelligence-tools.test.ts` |
| `get_task_context` | **Schema only** | same |

No tool runtime, no binding loop, and no `posops_readonly` role exist (`posops_readonly` has zero
references anywhere in the repo — only `posops_app`, the full-DML role, exists today).
`READ_TOOL_MAX_CALLS_PER_REQUEST` / `READ_TOOL_MAX_CHARS_PER_REQUEST` / `READ_TOOL_SEARCH_LIMIT_MAX`
/ `READ_TOOL_CALENDAR_SPAN_DAYS_MAX` are defined budget constants with **zero enforcement sites** —
a future tool loop must start honoring them, they are not already wired in.

---

## 3. Known duplication, deliberately not extracted

`isAbortLikeError` is copied verbatim into **four** files: `apps/api/src/ask/generate.ts`,
`apps/api/src/focus/generate.ts`, `apps/api/src/brief/generate.ts`,
`apps/worker/src/mail/digest/generate.ts`. Tracked as accepted debt in `docs/STATUS.md` since
Checkpoint 9.8 and intentionally left alone in 10.0 (extracting it is not proven-dead cleanup, it's
a refactor). Worth extracting into `packages/core/src/ai/` as a natural prerequisite the next time a
fifth AI lane (e.g. an agent tool loop) is added — recorded here rather than acted on.

Two same-package name pairs were investigated and confirmed to be genuine siblings, not
duplicates: `selectNextOccurrence` (`packages/core/src/recurrence/next-occurrence.ts`, client-side
"which occurrence is current") vs. `computeNextLazyOccurrence` (server-side successor generation);
and `resolveModelForTask` vs. `loadModelForConnection` (task-routed resolution vs. one-off
connection-test lookup, `packages/ai-providers/src/resolve-model.ts`).

---

## 4. Schema classification carried forward from this checkpoint (not acted on)

`tags` / `item_tags` (`packages/db/src/schema/tags.ts`, `item-tags.ts`) — classified
**safe-to-drop** by a dedicated Checkpoint 10.0 audit: zero rows in production after a month of
live use, zero code references anywhere in the 12-package monorepo, unmodified since the single
Phase 1 commit that created them, and absent from both ADR-059's and ADR-065's explicit
enumerations of every table holding user data. **Not dropped** — dropping a table is irreversible
under ADR-024's no-backup posture and is an owner decision, not a cleanup action. If the owner ever
wants lightweight tagging on notes/tasks/events, this schema shape (polymorphic `item_type`/
`item_id`, cascade-delete FK to a dedupe'd `tags.name`) is a reasonable starting point already in
place at zero cost.

---

## 5. One-line answers — "what should a future tool call?"

| Domain | Call this |
|---|---|
| Search | `searchPersonalItems` (+ `getItemContext` for a bounded follow-up read) |
| Today | `buildTodayContext` (already the `get_today_context` binding) |
| Tasks | The task/occurrence HTTP routes — never the DB tables or core recurrence functions directly |
| Recurrence | Only indirectly, through the task/occurrence routes |
| Events | `POST /events` / `PATCH /events/:id`, checking `origin` first |
| Calendar reads | `GET /events/range` or `GET /agenda` |
| Notifications | Enqueue via the existing dispatch job with an occurrence-scoped `dedupeKey` — never a new push path |
| Canvas | `GET /canvas-assignments/upcoming` (read-only); never the connection or sync routes, never the tables |
| AI | `POST /ask` (already composes context building + provider resolution + citation validation) — no write-capable AI path exists, and building one needs its own ADR plus a `posops_readonly` role |

---

## 6. The Action Framework — the WRITE surface a future agent goes through (Checkpoint 10.8, ADR-078)

§2 is the read-only tool contract. Writes have their own, disjoint contract: an **action** is a
registered, permission-gated, owner-approved, audited mutation. A future agent may *call* a read
tool; it may only *request* an action, and the owner approves or cancels it. Nothing in 10.8 lets
an agent exist — the `agent` principal is a reserved CHECK member with no write path and no grant.

| Piece | Where | What a future agent binding must honour |
|---|---|---|
| Registry | `packages/schema/src/actions.ts` — `ACTION_IDS` (six: `create_calendar_event` ↔ `archive_calendar_event`, `create_task` ↔ `archive_task`, `complete_task` ↔ `reopen_task`), `ACTION_REGISTRY` (name, description, category, permission, risk, reversibility, `requires_approval: true` literal), `ACTION_INPUT_SCHEMAS` / `ACTION_OUTPUT_SCHEMAS` | Verbs are pinned `^(create\|archive\|complete\|reopen)_` and tested disjoint from `READ_TOOL_NAMES`. Inputs are `.strict()` and narrower than the direct routes' create schemas (no recurrence, no all-day). |
| Permissions | `ACTION_PERMISSIONS` = `tasks.write`, `calendar.write` — the only members with an enforcement site; `permission_grants` table (principal `app\|agent`, `revoked_at` soft-revoke, stored `disclosure_version`); `GET /permissions`, `PATCH /permissions/:permission` (`app` only) | A grant gates whether a principal may **request**; it never permits execution without approval. No write member will ever exist for health, mail, academic or memory; no member of any kind for AI config, devices or credentials. An agent's grants are `agent`-principal rows the owner must create explicitly — none ship. |
| Request lifecycle | `apps/api/src/actions/service.ts` — `createActionRequest` (grant check → handler `prepare` → `pending` row with the validated input frozen as jsonb), `approveActionRequest` (single-use conditional claim → handler `execute` in a savepoint inside one transaction → `completed\|failed`, `afterCommit` after commit), `cancelActionRequest`, `setPermissionGrant`; routes `apps/api/src/routes/actions.ts`, `permissions.ts`; read model `apps/api/src/read-models/actions.ts` | Synchronous in the API request, never pg-boss. A replayed approval is `409 action_not_pending`; a pending row expires after `ACTION_REQUEST_TTL_HOURS` (24). The **stored** input is what executes, re-parsed through its own schema. A failure is recorded (`error_class`, token-shaped), never retried. |
| Handlers | `apps/api/src/actions/handlers.ts` (`ACTION_HANDLERS: ActionHandlerMap`, completeness type- and test-checked) over `apps/api/src/services/events.ts` / `services/tasks.ts` — the same functions the direct routes now call | The only way an action mutates anything. `prepare` is read-only (existence checks + the bounded `input_summary`); `execute` re-checks its target under `FOR UPDATE`. |
| Audit trail | The `action_requests` row itself: `principal`, `source` (`focus_now\|briefing\|academic\|manual`) + bounded client-authored `reason`, `input_summary`, `result_summary`, `target_type/target_id`, `error_class`, `reverses_request_id`, per-state timestamps. Never swept by retention; summary columns in `GET /export`. | "Who" is `app` — the owner through a client; the API has no principal abstraction beyond `/devices/*` device tokens (ADR-029). Binding approval to a device token is deferred with the agent ADR. |
| Guard 7 | `apps/api/src/ask/ai-egress-guard.test.ts` | No AI lane, AI route file, other read model or worker file may name the action tables or registry; the action modules import no `ai`, provider, memory module or AI lane, name no credential/consent/device table, and carry no enqueue token. |

**What an agent ADR would still have to add:** the `agent` principal's own consent surface and
disclosure; a `posops_readonly` role (§2); enforcement of the `READ_TOOL_MAX_*` budgets; a device- or
token-bound approval if approval by an unverified perimeter caller is judged insufficient; and any
read permissions, which 10.8 deliberately did not define because nothing reads through the
framework yet.
