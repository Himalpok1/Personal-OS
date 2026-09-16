# Personal OS — Mobile App

The Expo + Expo Router client for Personal OS (iOS, Android, and web), part of the
[Personal OS monorepo](../../). See the root [README](../../README.md) and
[`docs/STATUS.md`](../../docs/STATUS.md) for the current project state.

## Setup

This workspace uses **pnpm**, not npm. From the repo root:

```bash
pnpm install
```

## Running

The app uses custom native modules (exact-alarm status, Google Calendar auth,
hardware input bridge), so it requires a **development build** — Expo Go is not
supported.

From `apps/mobile`:

```bash
pnpm start      # dev server
pnpm android    # run on Android
pnpm ios        # run on iOS
pnpm web        # run web
```

## Notes

- Production Android releases use EAS-managed app-signing (`production-internal`
  profile); see ADR-037 in `docs/DECISIONS.md`.
- The client reaches the Fastify API over the Tailscale network only.
