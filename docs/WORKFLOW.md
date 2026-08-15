# Claude + Codex Collaboration Workflow

Both Claude Code and Codex may work on this repository. Git is the source of truth.

## Canonical instructions

Both agents must follow:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/STATUS.md`

Claude additionally reads `CLAUDE.md`.

## Recommended local layout

```text
~/Developer/
  personal-os/           # clean/main checkout
  personal-os-claude/    # Claude worktree
  personal-os-codex/     # Codex worktree
```

This is optional at the very beginning, but strongly recommended once both agents are active.

## Worktree example

From the main checkout:

```bash
git worktree add ../personal-os-claude -b claude/current-task main
git worktree add ../personal-os-codex -b codex/current-task main
```

Do not have both agents edit the same working tree concurrently.

## Standard task cycle

### 1. Sync and inspect

Before work:

```bash
git status
git branch --show-current
git log --oneline -10
```

Read `docs/STATUS.md`.

### 2. Define scope

The agent states:

- task
- phase
- files/services expected to change
- verification plan
- user-only inputs needed

### 3. Implement

Stay within the requested scope.

### 4. Verify

Run the relevant checks. Never report a check as passed unless it was actually run.

### 5. Update status

Update `docs/STATUS.md` with:

- what completed
- blockers
- tests/commands run
- current work
- next action

### 6. Commit

Use focused commits, for example:

```text
chore: initialize pnpm turborepo workspace
feat(api): scaffold fastify service
feat(worker): add pg-boss worker bootstrap
chore(db): add drizzle and postgres development setup
docs: record phase 0 restore verification
```

## Reviewer pattern

A good two-agent workflow is:

1. Claude implements.
2. Commit.
3. Codex reviews that commit without editing.
4. User approves required corrections.
5. Claude or Codex fixes.
6. Verify.
7. Merge.

The reverse is equally valid.

## Review-only rule

When asked to review:

- do not modify files
- identify concrete issues
- cite files/lines where possible
- distinguish blockers from optional improvements
- verify against `ARCHITECTURE.md`
- do not propose a new architecture unless explicitly requested

## Conflict rule

If another agent has uncommitted changes, do not overwrite or reset them. Stop and tell the user what is present.

Never use destructive Git commands merely to get a clean workspace.

## Phase rule

Agents do not automatically continue into the next phase.

At each phase boundary:

1. verify exit criteria
2. update `STATUS.md`
3. report results
4. wait for user approval
