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

The app uses custom native modules (`modules/capture-intent`,
`modules/exact-alarm-status`, `modules/google-calendar-auth`) and config plugins
(`plugins/withCaptureShortcut.ts`, `plugins/withHardwareInputBridge.ts`), so it
requires a **development build** — Expo Go is not supported.

From `apps/mobile`:

```bash
pnpm start      # dev server
pnpm android    # run on Android
pnpm ios        # run on iOS
pnpm web        # run web
pnpm android:ui-test   # side-by-side com.himal.personalos.dev UI-test build (never targets production)
```

## Notes

- Production Android releases use EAS-managed app-signing (`production-internal`
  profile); see ADR-037 in `docs/DECISIONS.md`.
- The client reaches the Fastify API over the Tailscale network only.
