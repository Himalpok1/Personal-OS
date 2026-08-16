# Phase 0 scaffold: correctness over image size. Copies the whole built
# workspace into the runtime stage rather than pruning devDependencies —
# revisit before real production use.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Turbo resolves the dependency graph itself (schema/db/core/ai-providers/
# api-client, in whatever order they actually depend on each other) rather
# than a hand-maintained chain that silently goes stale every time a new
# package dependency is added -- see the Phase 1 packages/core and
# packages/ai-providers additions that broke the old hardcoded chain.
RUN pnpm exec turbo run build --filter=api...

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
