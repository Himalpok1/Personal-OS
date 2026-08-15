# Project Status

**Project:** Personal OS  
**Current phase:** Phase 0 — Foundation & hardening  
**Implementation status:** Not started  
**Next phase allowed:** No  
**Canonical architecture:** `docs/ARCHITECTURE.md`

## Current objective

Create the repository and infrastructure foundation exactly as described in the architecture without beginning Phase 1 capture logic.

## Completed

- [x] Architecture discussion completed.
- [x] Revision 3 architecture document accepted as the current plan.
- [x] Shared agent instructions created.
- [ ] Git repository initialized.
- [ ] pnpm/Turborepo workspace created.
- [ ] `apps/mobile` scaffolded.
- [ ] `apps/api` scaffolded.
- [ ] `apps/worker` scaffolded.
- [ ] shared packages scaffolded.
- [ ] PostgreSQL development container configured.
- [ ] Drizzle configured.
- [ ] pg-boss worker plumbing configured.
- [ ] Tailscale server configuration completed.
- [ ] least-privilege DB roles configured.
- [ ] secrets handling configured.
- [ ] encrypted backup automation configured.
- [ ] offsite backup destination configured.
- [ ] manual restore test successfully performed and documented.
- [ ] Phase 0 verification complete.

## Blockers / user-provided items

Not yet collected. Likely Phase 0 user-only inputs include:

- final Intel i5 server access details
- NAS backup destination
- Backblaze B2 account/bucket credentials if used
- Tailscale account/tailnet access
- age/SOPS key handling preference
- Apple Developer account is not required until native iOS work, but should be planned for later

Agents must not invent these values.

## Current work

None.

## Last verification

No implementation exists yet.

## Next action

Start Phase 0 with repository/workspace scaffolding and local development infrastructure. Stop and request user input before any hardware/account-specific configuration that cannot be completed safely without credentials or device access.

## Handoff rule

After each meaningful task, update:

- Completed
- Blockers / user-provided items
- Current work
- Last verification
- Next action

Do not replace this file with a generic progress report.
