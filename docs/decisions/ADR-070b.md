# ADR-070b — Amendment to ADR-070: academic data may leave through the Agent Gateway, only under an owner-granted `academic.read` permission that ships OFF, as a narrow, link-free, third-party-flagged projection

**Status:** Locked

**Checkpoint 10.9 (2026-09-18, owner decision — "five + academic").** ADR-070 placed the
academic read model "structurally outside the AI lanes" and Guard 5 pins that no file under
`intelligence/`, `ask/`, `focus/` or `brief/` may import it or name a canvas table. That posture
is unchanged for every prompt lane: no model call sees academic data. This amendment records the
ONE new exit.

**1. THE EXIT.** `get_academic_context` is the sixth member of `READ_TOOL_NAMES` (ADR-081 §5),
bound by the gateway for an authenticated agent principal whose **`academic.read`** grant the
owner created from a paired device. The permission is its own member of `READ_PERMISSIONS` —
not folded into `context.read` — precisely so that an agent the owner trusts with the schedule
does not thereby see coursework: the owner grants it separately, in the Agent Center, under the
permission card's own label ("Academics") and description. It **ships OFF and is never lazily
materialised**: `grantIsLive("agent", undefined)` is `false`, the migration inserts nothing, and
there is no default row for the `agent` principal (ADR-081 §4). Without the grant the tool is
refused `permission_not_granted` and the refusal is audited; with it, the call is budgeted and
audited like every other.

**2. THE IMPLEMENTATION — ONE FILE, ONE IMPORTER, ONE GATE.** `apps/api/src/agent/academic-tool.ts`
is the single file Guard 8(a) permits to import `read-models/academic.js` and to name a canvas
table; it calls `buildAcademicTodayResponse(db, {tz})` — the same current-term read model
`GET /academic/today` serves (ADR-070/070a) — and projects it. Guard 8 pins that the only
importer of `academic-tool.ts` is `agent/tools.ts`, and that `tools.ts` names
`READ_TOOL_PERMISSION` and `isPermissionGranted(`, so the projection is reachable only behind the
permission check. Nothing under `intelligence/` touches academic data (Guard 5 unchanged): the
builder lives beside the gateway, not beside `buildTodayContext`, exactly so that the prompt
lanes' egress guard needed no exception.

**3. THE PROJECTION — NARROWER THAN THE READ MODEL IT COMES FROM.** `GetAcademicContextOutputSchema`
(`packages/schema/src/intelligence-tools.ts`) is `.strict()` and carries: `tz`, `local_date`,
`configured`, the `current_term` (`name`, `starts_at`), a four-count `summary` (overdue, due
today, due this week, missing), `courses` `{id, name, code}` capped at 20, and an `assignments`
section drawn from the read model's overdue / due-today / due-this-week buckets and its
priorities — per item `{id, course_id, title ≤ 120, due_at, points_possible, submission_status,
missing, late, urgency, priority_score, priority_reasons}` — capped at 40 with an honest `total`.
**Excluded by construction**, not by filtering: `html_url` and `source_base_url` (no link an agent
could follow or forward), announcements (instructor prose), descriptions (never stored, ADR-068),
`score` and `grade` (ADR-068a stored them for the owner's screens; the permission's own
description says "Never links, announcements or grades"), workload, course attention and the
grade summary (ADR-071's screen-facing sections). `intelligence-tools.test.ts` walks every tool's
JSON-Schema output for the keys `body`, `description`, `rrule`, `html_url` and `source_base_url`
and fails on any of them, in the ADR-068 structural-guard idiom; `score` and `grade` are absent
because `AcademicContextAssignmentSchema` is `.strict()` and never names them.

**4. THIRD-PARTY TEXT, FLAGGED.** Assignment titles and course names are instructor-authored —
third-party text in the ADR-054 sense, the first such class to reach a principal other than the
owner's own screens. The section therefore carries `provenance: "third_party"` and the tool is
published on the manifest with sensitivity `third_party_text` (ADR-081 §5), so a consumer that
feeds the output to a model knows to treat it as it would mail metadata. The gateway itself never
interprets, summarizes or filters the text: it is a boundary, not a prompt lane, and the ADR-058
shared output filter applies to model *output*, of which there is none here.

**5. WHAT IS STILL TRUE.** No model call in Personal OS sees academic data (Guard 5, byte-
unchanged and now also denying `agent/` imports to the prompt lanes through the widened "an AI
lane" alternation). Nothing Canvas-side is mutated; no announcement, description, link or grade
leaves; the Canvas connection, its credential and the sync are untouched (ADR-068). Revoking
`academic.read` takes effect on the next call. Widening the projection — a link, a grade, an
announcement — is a new amendment with a new disclosure sentence, never an edit to the schema
alone.

**Unchanged and reaffirmed:** ADR-018, ADR-024/080, ADR-054 (the text stays flagged as
third-party), ADR-056/066/067 (no new model call site), ADR-065 (Canvas rows stay outside
`GET /search` and `GET /export`), ADR-068/068a, ADR-070 and ADR-070a (the current-term rule
applies to the projection because it applies to the read model), ADR-071/072/075 (the screen
sections and Focus Now are unchanged), ADR-081.
