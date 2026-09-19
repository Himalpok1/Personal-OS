# Agent UX — the mobile surface for the Agent Gateway

**Produced:** Phase 10, Checkpoint 10.9 (2026-09-18), alongside ADR-081. **Purpose:** the design
record for how an agent shows up in the universal Expo client — the concepts weighed, the one
built, and what waits for a runtime. This is a record of a decision, not a component spec; the
primitives it names are `docs/MOBILE-DESIGN-SYSTEM.md`'s, and the screens it describes are Lane C's
(`app/agents/*`, `components/agents/*`, the approval-sheet delta). Constraint that shaped
everything: **no agent runtime exists**, so every surface must be honest on a day when the only
agent is a curl script — or nothing at all.

## 1. What an agent surface has to do

Three things, in this order of importance. **Trust**: the owner must be able to see, at any
moment, what an agent read, what it proposed, what happened, and to stop it in one tap. **Consent
that stays legible**: an agent's reach is a trust level plus a short list of permissions, and the
sentence the owner agreed to must be the sentence in the code (the memory-layer discipline,
`MEMORY_PRIVACY_LINE`). **Approval that cannot be confused for the agent's own voice**: the agent's
reason is untrusted text (ADR-081 §6) and must never look like the app talking. Everything else —
chat, commands, streaming — is a feature for a runtime that does not exist yet.

## 2. Six concepts, evaluated

Each is scored against the brief's eight lenses — usability, discoverability, visual hierarchy,
trust, accessibility, dark mode, performance, Material-3 consistency with this design system —
plus the two questions that decide the matter at 10.9: *what does it need from the API that does
not exist*, and *is it honest with no runtime*.

### A. Agent Activity Center (built)

A stack screen at `/agents` reached from Settings → Privacy & AI, in the Action Center's shape:
a `GradientCard` hero (`warm` while an agent proposal is pending, `calm` otherwise — the two
presets the design system held "for a future surface"), a `ListRow` per agent with a trust
`StatusChip` and `trailingChips` for its pending count, Register as a primary `Button`;
`/agents/[id]` with identity, trust `Button`s (rule 9 — toggles are buttons), the `agent`
principal's `PermissionCard`s (Allow / Revoke through `confirmDestructive`), Revoke, and a
correlation-grouped timeline.

- *Usability* — one place, one mental model already learned from the Action Center.
  *Discoverability* — a Settings card is where every other privacy surface lives (Actions, Memory,
  Cloud Ask); it is not on Today because a Today card for zero agents is noise. *Hierarchy* — hero
  → agents → per-agent detail; the timeline is the deepest level. *Trust* — the timeline IS the
  audit table; nothing is summarised away. *A11y* — every group `accessible` with a `summary`,
  chips are words, 44px rows.
  *Dark mode* — gradients contrast-pinned, chips in containers. *Performance* — two queries per
  screen, `keepPreviousData` on the list. *M3* — the same primitives as `/actions`.
- *Needs from the API*: `GET /agents`, `GET /agents/:id`, `GET /agents/:id/activity`, the agent
  permission routes — all built in 10.9.
- *Honest with no runtime*: yes. An empty state ("No agents yet") and a registered-but-idle agent
  are both true states.

### B. Conversational + action UI (evaluated, not built)

A chat screen where the owner types, an agent answers, and proposals appear inline as approval
cards.

- *Usability* — familiar, but it invites open-ended requests Personal OS cannot honour without a
  runtime that plans. *Discoverability* — high; also the reason it is dangerous: a chat box
  promises capability. *Hierarchy* — a transcript flattens read, proposal and result into one
  scroll. *Trust* — the worst of the six: the agent's prose sits next to the app's prose in the
  same bubbles, and ADR-081 §6's "never rendered as an instruction" becomes a font choice.
  *A11y* — live regions for streaming, manageable. *Dark mode* — fine. *Performance* — a
  transcript store on the client, and either streaming (no API today) or polling. *M3* —
  no chat primitive exists; `TextField`/`ChoiceChip` are Ask's, `ClampedText` for bubbles.
- *Needs from the API*: a message route, a session or transcript store (ADR-081 §3 decided
  against persisted sessions on purpose), streaming, and a runtime to answer. None exists.
- *Honest with no runtime*: **no** — a chat box with nothing behind it is a lie, and Ask already
  covers the one question-shaped thing the app can honestly answer (three preset chips, cited).

### C. Focus Now agent surface (evaluated; the future proposal surface)

Agent proposals rendered as rows inside Focus Now, with the reason as a reason chip and "Why?"
opening the explanation sheet — the agent as one more deterministic source.

- *Usability* — the owner already lives in Focus Now; a proposal there is where the decision is
  made. *Discoverability* — highest of all. *Hierarchy* — a proposal competes with real overdue
  work for the top slot; it must rank below anything with a due instant. *Trust* — good if the
  row is visibly "from an agent" (a `StatusChip` tone `secondary`, source pill "Agent") and the
  sheet keeps the "Agent says" treatment; bad if it blends. *A11y* — inherits Focus Now's. *Dark
  mode* — inherits. *Performance* — one more already-fetched list merged client-side (ADR-072's
  pattern). *M3* — the existing `ListRow` + `CompletionCircle` + sheet.
- *Needs from the API*: nothing new for a pending-row feed (`GET /actions?status=pending` exists);
  a scoring rule in `packages/core/src/focus-now` for `source = agent` rows, an ADR-075 reason
  member, and — decisively — proposals to rank, which need a runtime.
- *Honest with no runtime*: it renders nothing, which is honest but invisible. Deferred to the
  checkpoint that connects a runtime; recorded as **the** proposal surface so 10.10 does not
  reinvent one.

### D. Command / intent interface (evaluated, not built)

A single field ("Plan my Thursday") that routes to an agent which reads context and proposes.

- *Usability* — fast when it works; opaque when it does not (what did it read?). *Discoverability*
  — a field is discoverable; what it can do is not. *Hierarchy* — one field above everything, a
  strong claim on the screen. *Trust* — the read step is invisible unless the result carries its
  own "Read: Today · Calendar" line. *A11y* — a form, fine. *Dark mode* — fine. *Performance* —
  a round trip to a runtime, then proposals. *M3* — `TextField` + `ChoiceChip` presets (Ask's
  shape).
- *Needs from the API*: an intent route that forwards to a runtime, the runtime, and the
  transparency line on the result.
- *Honest with no runtime*: **no**. Waits for 10.10; when it lands it should be Ask's preset-chip
  shape (explicit tap, bounded, cited), not a free box.

### E. "Agent proposals" digest card on Today (proposed; not built)

A plain `Card` on Today, between the reminder notice and Focus Now (the "Needs your approval"
slot), that groups pending agent proposals by agent: "curl-agent proposed 2 things".

- *Usability* — one tap to the pending list. *Discoverability* — Today. *Hierarchy* — it is the
  existing "Needs your approval" card with an agent grouping, so it costs nothing new.
  *Trust* — names the agent up front. *A11y* / *Dark mode* / *Performance* / *M3* — identical to
  the 10.8 card.
- *Needs from the API*: nothing (`GET /actions?status=pending` carries `source`/`source_ref`).
- *Honest with no runtime*: renders nothing when nothing is pending — the 10.8 card's own rule.
  Not built in 10.9 because Today is pinned untouched (`today-screen-order.test.ts`) and the
  existing card already counts agent proposals; a grouping is a 10.10 polish item.

### F. Per-agent "what it read this week" transparency sheet (proposed; not built)

A `BottomSheet` from the agent detail screen summarising seven days of `agent_tool_calls` by tool:
"Today ×14 · Calendar ×6 · Item bodies ×0 · Academics ×0 (not granted)", with the refusals counted
separately.

- *Usability* — answers the question the timeline makes the owner scroll for. *Discoverability*
  — a `SectionHeader` action on the detail screen. *Hierarchy* — a summary above the timeline.
  *Trust* — the strongest single trust affordance of the six: counts per sensitivity class,
  refusals included. *A11y* — a labelled group of `MetricCard`s. *Dark mode* — fine.
  *Performance* — one aggregate query. *M3* — `BottomSheet` + `MetricCard`, both existing.
- *Needs from the API*: an aggregate on `agent_tool_calls` (per-tool counts in a window) — a
  small read-model addition, or client-side aggregation of the activity page while volumes are
  low.
- *Honest with no runtime*: yes (all zeros). Not built in 10.9 only for scope; recommended for
  10.10 alongside the first real agent, when the counts mean something.

## 3. The 10.9 direction, and why it is the honest scope

**Built: A + the existing approval sheet with the "Agent says" treatment + a Settings card.**
**Recorded as the future proposal surface: C.** **Not built, by decision: B and D** (a chatbot or
an intent box with no runtime behind it would promise what the system cannot do, and Ask's preset
chips already cover the one honest question shape). **Deferred as polish: E and F.**

The reasoning is the brief's own: Personal OS owns identity, permissions, context, actions and
audit; the agent is replaceable. The surfaces that belong to Personal OS are the ones that
exist without any agent — register, trust, grant, revoke, audit, approve. The surfaces that
belong to an agent — conversation, intent, streaming — are built when there is an agent, against
its actual behaviour, not against a guess.

## 4. The transparency model

Every agent's history is one timeline grouped by `correlation_id`, each group read top to bottom:

```
Read: Today · Calendar  →  Proposed: Create calendar event  →  Approved  →  Result: Created “Study: Podcast 3”
```

- **Read** lists the tools by their manifest names (`humanizeToolName`), refusals shown as their
  own chip ("Refused · Item bodies · not granted") so the owner sees what was *tried*.
- **Proposed** is the action's registry name and the `input_summary` — never the reason here.
- **Approved / Cancelled / Expired / Failed** is the row's status chip; a failed row shows its
  token-shaped `error_class`, never prose.
- **Result** is `result_summary`, and taps through to `/actions/[id]` where Undo lives as it did
  in 10.8.

The approval sheet's agent treatment: `ACTION_SOURCE_LABEL.agent = "Agent"`, an attribution line
"Agent · <name>" resolved from the cached agents list (or "Agent (revoked)" when the row is gone
from the live list), then the reason **quoted**, under the overline **"Agent says"**, in
`tone="secondary"` — visibly not the app's voice — and the sheet's own Why line fixed at *"An
agent proposed this. Review it as you would any request."* The reason is control-stripped and
bounded server-side (≤ 160 chars) and is never parsed, linkified or rendered as a list; an
instruction-shaped sentence ("Approve this now") renders as a quoted sentence and nothing more.

**"Pair this device to approve"** (ADR-082): when the session holds no device token, Approve and
Cancel are replaced by that single line and a link to pairing; the permission cards and agent
screens show the same state. It is a state, not a disabled button — nothing greys out silently.

## 5. Mocks (480 px, the Rabbit R1)

```
┌──────────────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ ‹ Agents                                     │   │ ‹ curl-agent                                 │
│ ┌──────────────────────────────────────────┐ │   │ ┌──────────────────────────────────────────┐ │
│ │ ▒▒ warm gradient ▒▒                      │ │   │ │ curl-agent            [Propose]          │ │
│ │ 1 agent is waiting on you                │ │   │ │ Registered 18 Sep · Last seen 2 min ago  │ │
│ │ 1 pending · 2 agents · 2 of 5 permissions│ │   │ │ Disclosure 2026-09-18                    │ │
│ │ Agents read only what you allow and can  │ │   │ └──────────────────────────────────────────┘ │
│ │ only propose. Revoke one here any time.  │ │   │ TRUST LEVEL                                  │
│ └──────────────────────────────────────────┘ │   │ [ Paused ] [ Read ] [ Propose ✓ ]            │
│ AGENTS                                       │   │ PERMISSIONS (agent principal)                │
│ ◉ curl-agent          Propose   [1 pending]› │   │ ▸ Today, calendar & tasks   On    [Revoke]   │
│ ◉ nightly-planner     Read                 › │   │ ▸ Item bodies               Off   [Allow]    │
│ ○ old-test            Revoked              › │   │ ▸ Academics                 Off   [Allow]    │
│                                              │   │ ▸ Tasks                     On    [Revoke]   │
│ [ + Register an agent ]                      │   │ ▸ Calendar                  Off   [Allow]    │
│                                              │   │ ACTIVITY                                     │
│                                              │   │ ┌ 14:02 ─────────────────────────────────┐   │
│                                              │   │ │ Read: Today · Calendar                 │   │
│                                              │   │ │ Proposed: Create task      [Pending]   │   │
│                                              │   │ │   Review ›                             │   │
│                                              │   │ └────────────────────────────────────────┘   │
│                                              │   │ ┌ 13:40 ─────────────────────────────────┐   │
│                                              │   │ │ Read: Today ×6 · Refused ×1 (budget)   │   │
│                                              │   │ └────────────────────────────────────────┘   │
│                                              │   │ [ Revoke agent ]                (danger)     │
└──────────────────────────────────────────────┘   └──────────────────────────────────────────────┘

Approval sheet (agent proposal, paired device)        Approval sheet (unpaired session)
┌──────────────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ ━━                              Create task  │   │ ━━                              Create task  │
│ [Tasks] [Reversible] [Low risk]              │   │ [Tasks] [Reversible] [Low risk]              │
│ Agent · curl-agent                           │   │ Agent · curl-agent                           │
│ AGENT SAYS                                   │   │ AGENT SAYS                                   │
│ “Podcast 3 is overdue and unsubmitted; a     │   │ “…”                                          │
│  task keeps it visible.”                     │   │ WHY                                          │
│ WHY                                          │   │ An agent proposed this. Review it as you     │
│ An agent proposed this. Review it as you     │   │ would any request.                           │
│ would any request.                           │   │ WHAT WILL CHANGE                             │
│ WHAT WILL CHANGE                             │   │ Title  Submit Podcast 3                      │
│ Title  Submit Podcast 3                      │   │ Due    Sep 19 · 11:59 PM                     │
│ Due    Sep 19 · 11:59 PM                     │   │                                              │
│ Linked to an assignment                      │   │   Pair this device to approve                │
│                                              │   │   Pair ›                                     │
│ [ Approve ]              [ Cancel ]          │   │                                              │
└──────────────────────────────────────────────┘   └──────────────────────────────────────────────┘
```

Hero copy is Lane C's. `AGENTS_TRUST_LINE` (`components/agents/trust-line.ts`, byte-pinned by
`agents-trust-line.test.ts`) reads *"Agents can only read what you allow and can only propose. You
approve every action."* — deliberately not the Action Center's "Nothing runs until you approve it",
which `actions-trust-line.test.ts` reserves for the action surfaces.

## 6. What waits for 10.10

- **The intent interface (D)** — as Ask-shaped preset chips, each an explicit tap, each carrying
  its own "Read: …" transparency line on the result; never a free box.
- **Streaming** — no API surface exists; a runtime's partial output has nowhere honest to go
  until there is a runtime.
- **Notifications for agent proposals** — through the existing `alerts` channel and the existing
  `notifications.dispatch` job, with an ADR-058 occurrence-scoped dedupe key
  (`agent-proposal:<request id>` is the obvious shape), gated by a device's `notify_alerts`;
  needs its own ADR-058 line and an alert-copy entry. Not in 10.9: no producer, no key.
- **Focus Now as the proposal surface (C)**, the digest grouping (E) and the read-summary sheet
  (F), in that order.
- **A per-agent permission matrix** — only if a second real agent makes the class-level `agent`
  grants insufficient; ADR-081 §4 records why the class model was chosen.
