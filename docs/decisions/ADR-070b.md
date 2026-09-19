# ADR-070b — Amendment to ADR-070: academic data may leave through the Agent Gateway, only under an owner-granted `academic.read` permission that ships OFF, as a narrow, link-free, third-party-flagged projection

**Status:** Locked

**Checkpoint 10.9 (2026-09-18, owner decision — "five + academic").** ADR-070 placed the
academic read model "structurally outside the AI lanes" and Guard 5 pins that no file under
`intelligence/`, `ask/`, `focus/` or `brief/` may import it or name a canvas table. That posture
is unchanged for every prompt lane: no model call sees academic data. This amendment records the
ONE new exit: *(Lane D fills — `get_academic_context` bound by the gateway for an authenticated
agent principal whose `academic.read` grant the owner created (OFF by default, never lazily
materialised); implemented in `apps/api/src/agent/academic-tool.ts`, the single file Guard 8
permits to import `read-models/academic.js`, reachable only behind the permission check in
`agent/tools.ts`; the projection — current term, courses {id,name,code}, assignments from
overdue/due-today/due-this-week + priorities with due/points/submission/urgency/score, capped
with honest totals; no `html_url`, no `source_base_url`, no announcements, no descriptions, no
grades; `provenance: "third_party"` because titles are instructor-authored text in the ADR-054
sense and the gateway never interprets them; sensitivity `third_party_text` on the manifest.)*

**Unchanged and reaffirmed:** *(Lane D fills.)*
