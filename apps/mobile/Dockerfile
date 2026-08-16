# Phase 2: produces the "single" (SPA) web.output build described in
# docs/STATUS.md's Phase 2 entry -- one index.html, one JS bundle, no
# per-route static HTML, routed entirely client-side. The runtime stage's
# `serve -s` flag is what makes that work when deployed: it rewrites any
# unmatched path (e.g. a direct load of /tasks/<uuid>) to index.html
# instead of 404ing, so the client-side router can resolve the real route.
# Without -s, a plain static file server would serve "/" correctly but
# break every direct load or refresh on a dynamic route.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# apps/mobile imports @personal-os/api-client (and transitively
# @personal-os/schema/@personal-os/core) via their built dist/ output, same
# as apps/api and apps/worker -- build the dependency graph before
# exporting. mobile itself has no "build" script; expo export below is
# its own build step, not a turbo task.
RUN pnpm exec turbo run build --filter=mobile...
# Baked into the bundle at build time (Expo inlines EXPO_PUBLIC_* via
# Metro) -- changing the API's public URL later means rebuilding this
# image, not just restarting the container.
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
WORKDIR /repo/apps/mobile
RUN npx expo export --platform web

FROM base AS runtime
WORKDIR /app
COPY --from=build /repo/apps/mobile/dist ./dist
RUN npm install --global serve
EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
