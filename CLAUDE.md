# Claude Code Project Instructions

@AGENTS.md
@docs/ARCHITECTURE.md
@docs/DECISIONS.md
@docs/STATUS.md
@docs/WORKFLOW.md

## Documentation that is NOT auto-loaded

Load these on demand only — they are deliberately outside the import set above so that agent
context stays workable:

- `docs/history/phase-0.md` … `docs/history/phase-7.md` — the verbatim record of every closed
  checkpoint. Open the relevant phase file when you need detail behind completed work.
- `docs/history/superseded-present-state.md` — prior revisions of `docs/STATUS.md`'s present-state
  sections.
- `docs/PHASE-0-CHECKLIST.md` — a closed Phase 0 artifact, retained for the record.

**Never edit anything under `docs/history/`.** It is closed and verbatim.

## Claude-specific operating rule

Before editing anything, summarize:

1. the current phase,
2. the exact task you intend to perform,
3. the files/services you expect to touch,
4. any user-only prerequisites you need.

Then proceed only within the approved phase and task scope.

At the end of a meaningful task:

- run the applicable verification,
- update `docs/STATUS.md` (present state only — never a file under `docs/history/`),
- summarize exactly what changed,
- list commands/tests run,
- identify anything still requiring the user,
- do not automatically begin the next phase.
