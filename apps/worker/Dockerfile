# Phase 0 scaffold: correctness over image size. Copies the whole built
# workspace into the runtime stage rather than pruning devDependencies —
# revisit before real production use.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @personal-os/schema build \
 && pnpm --filter @personal-os/db build \
 && pnpm --filter worker build

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
CMD ["node", "apps/worker/dist/index.js"]
