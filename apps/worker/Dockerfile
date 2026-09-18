# Phase 0 scaffold: correctness over image size. Copies the whole built
# workspace into the runtime stage rather than pruning devDependencies —
# revisit before real production use.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Turbo resolves the dependency graph itself (schema/db/core/ai-providers)
# rather than a hand-maintained chain that silently goes stale every time a
# new package dependency is added -- see the Phase 1 packages/core and
# packages/ai-providers additions that broke the old hardcoded chain.
RUN pnpm exec turbo run build --filter=worker...

FROM base AS runtime
WORKDIR /repo
# Cooperative prune guard (Checkpoint 10.8.5, ADR-079): any cleanup on the
# shared production host must exclude this label —
#   docker image prune -a --filter "label!=io.personal-os.protected=true"
# It is a marker, not an enforcement; the keeper containers and the saved
# tarballs in ~/personal-os-images are what actually survive a bare prune.
LABEL io.personal-os.protected="true"
ENV NODE_ENV=production
COPY --from=build /repo ./
CMD ["node", "apps/worker/dist/index.js"]
