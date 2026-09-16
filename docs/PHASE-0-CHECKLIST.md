> **Closed artifact.** Phase 0 finished long ago — the project is in Phase 10.
> This checklist is preserved verbatim as a historical record; per-phase records
> live in `docs/history/`. Unchecked boxes do **not** represent current work.

# Phase 0 Checklist — Foundation & Hardening

Phase 0 is a gate. **Do not start Phase 1 until every blocking item is complete.**

## A. Repository foundation

- [ ] Initialize Git repository if one does not already exist.
- [ ] Configure pnpm workspace.
- [ ] Configure Turborepo.
- [ ] Enable strict TypeScript configuration.
- [ ] Create root scripts for lint, typecheck, test, build, and dev.
- [ ] Add appropriate `.gitignore`.
- [ ] Add `.env.example` with dummy values only.
- [ ] Configure formatting/linting.
- [ ] Configure gitleaks/pre-commit secret scanning.

## B. Monorepo skeleton

Create:

```text
apps/
  mobile/
  api/
  worker/

packages/
  schema/
  db/
  api-client/
  core/
```

- [ ] `apps/mobile` uses Expo + Expo Router.
- [ ] `apps/api` is Fastify and contains HTTP concerns only.
- [ ] `apps/worker` is a separate process.
- [ ] `packages/schema` contains shared Zod schema foundations.
- [ ] `packages/db` owns Drizzle config/schema/migrations/connection setup.
- [ ] `packages/api-client` is framework-agnostic.
- [ ] `packages/core` contains shared domain logic only.

Do not implement Phase 1 capture entities/pipeline beyond what is necessary to prove scaffolding.

## C. PostgreSQL and database security

- [ ] Docker Compose development PostgreSQL configured.
- [ ] PostgreSQL is not published to a public interface.
- [ ] Application DB role created with least privilege.
- [ ] Migration role separated from runtime app role.
- [ ] Drizzle can connect and run a trivial/safe migration.
- [ ] API and worker can connect using intended roles.
- [ ] Production/server database plan matches `ARCHITECTURE.md`.

## D. Worker and queue foundation

- [ ] pg-boss dependency/configuration established.
- [ ] Worker starts independently from API.
- [ ] API and worker have separate processes/containers.
- [ ] Basic worker health/heartbeat mechanism established.
- [ ] Worker failure is observable.
- [ ] Job idempotency conventions documented in code.

Do not implement Phase 1 parser jobs yet.

## E. Tailscale/network foundation

On the target i5 server:

- [ ] Tailscale installed and authenticated.
- [ ] MagicDNS enabled/verified.
- [ ] Tailscale Serve HTTPS endpoint configured for the API.
- [ ] PostgreSQL remains inaccessible as a public service.
- [ ] iOS VPN On Demand plan documented for later mobile setup.
- [ ] Android Always-on VPN plan documented for later mobile setup.

If target server access is not yet available, mark these as blocked rather than pretending they are complete.

## F. Secrets

- [ ] `.env` files excluded from Git.
- [ ] `.env.example` uses placeholders only.
- [ ] Decide SOPS + age key location.
- [ ] Repository-stored encrypted configuration, if any, uses SOPS + age.
- [ ] Secrets are injected at runtime, not baked into images.
- [ ] gitleaks check passes.

## G. Phase 0 verification

Before declaring Phase 0 complete:

- [ ] dependency install succeeds
- [ ] lint succeeds
- [ ] formatting check succeeds
- [ ] TypeScript typecheck succeeds
- [ ] tests relevant to Phase 0 pass
- [ ] API starts
- [ ] worker starts
- [ ] Postgres connectivity works
- [ ] migration path works
- [ ] no secrets are committed
- [ ] `docs/STATUS.md` updated with exact results

## Exit criteria

Phase 0 is complete only when the foundation is reproducible, security boundaries are in place, and the status file documents the evidence. There is no backup or restore requirement — see `docs/DECISIONS.md` ADR-024.

Then and only then may Phase 1 begin.
