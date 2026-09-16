# Claude Code Project Instructions

@AGENTS.md
@docs/ARCHITECTURE.md
@docs/DECISIONS.md
@docs/STATUS.md
@docs/WORKFLOW.md

## Documentation that is NOT auto-loaded

Load these on demand only — they are deliberately outside the import set above so that agent
context stays workable:

- `docs/decisions/ADR-NNN.md` — the full, verbatim text of each decision. `docs/DECISIONS.md`
  (imported above) is only the one-line-per-ADR index; open a decision file when the line is not
  enough.
- `docs/history/phase-0.md` … `docs/history/phase-9.md` — the verbatim record of every closed
  checkpoint. Open the relevant phase file when you need detail behind completed work.
- `docs/history/superseded-present-state.md` and
  `docs/history/superseded-present-state-2026-09-16.md` — prior revisions of `docs/STATUS.md`'s
  present-state sections, including closed debt-ledger entries and earlier verification records.
- `docs/AGENT-READINESS.md` — the canonical service-boundary inventory (Checkpoint 10.0); read it
  before designing anything an agent would call.
- `docs/SOURCE-DURABILITY.md`, `docs/SOAK-9.2.md`, `docs/PHASE-8-CLOSEOUT.md`,
  `docs/CHECKPOINT-8.6-DECISION.md`, `docs/CHECKPOINT-8.6B-DESIGN.md`, `docs/SOAK-8.5.md`,
  `docs/PHASE-0-CHECKLIST.md` — companion and closed records, retained at their paths because code
  comments and history files reference them.

**Never edit anything under `docs/history/`.** It is closed and verbatim. **Never edit the text of an
ADR in `docs/decisions/`** — amend by adding a new ADR.

## Claude-specific operating rule

Before editing anything, summarize:

1. the current phase,
2. the exact task you intend to perform,
3. the files/services you expect to touch,
4. any user-only prerequisites you need.

Then proceed only within the approved phase and task scope.

At the end of a meaningful task:

- run the applicable verification,
- update `docs/STATUS.md` (present state only — never a file under `docs/history/`; a new decision
  is a new `docs/decisions/ADR-NNN.md` plus one index line in `docs/DECISIONS.md`),
- summarize exactly what changed,
- list commands/tests run,
- identify anything still requiring the user,
- do not automatically begin the next phase.
