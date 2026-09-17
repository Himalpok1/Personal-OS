# Personal OS — Mobile Design System (Checkpoint 10.3)

The universal Expo client (iOS, Android, web) draws every screen from one set of tokens and one
set of primitives, both under `apps/mobile/src/components/ui/`. A screen composes primitives; it
does not write colour classes of its own. This document is the contract; the source files carry
the per-component detail in their header comments.

## Why

Before 10.3 every screen spelled its own palette (`bg-white dark:bg-black`, `text-neutral-500
dark:text-neutral-400`, a `CARD_CLASS` constant copied into four files), which is why the app read
as "default React Native": flat white cards, no hierarchy, emoji for icons, `Loading…` as a
loading state. The Rabbit R1 (480 × 640) is the daily driver, so every primitive is sized for a
480px viewport with a 16px gutter first, and a wider browser second. Settings' per-section
loading lines still read `Loading…`; everything with a first-load skeleton uses `Skeleton*`.

## Tokens (`tokens.js` → Tailwind + `theme.ts` → runtime)

`tokens.js` is CommonJS because `tailwind.config.js` must `require` it at build time; `theme.ts`
re-exports the same object with types and adds the scheme-aware lookup (`useTheme()`,
`useGradient()`, `colorsForScheme()`). `theme.test.ts` pins the two to each other.

**Colour roles** (Material 3 vocabulary, one dark sibling per role, applied as
`bg-surface dark:bg-surface-dark`). Contrast is a tested contract (`theme.test.ts`): every text
role — `on-surface-muted` and `placeholder` included, because they carry 11–13px captions, eyebrows
and tab labels — clears 4.5:1 on every surface, every semantic colour clears 4.5:1 as text on the
canvas and the surface, every on-container pair clears 4.5:1, and white / white-90 clear 4.5:1 on
every stop of every gradient that carries them:

| Role | Use |
|---|---|
| `canvas` | the screen background (cool light gray / near-black navy) |
| `surface` | a card |
| `surface-container` | an inset well inside a card (row well, chip, progress track) |
| `surface-raised` | a raised element on a card (segmented control's active pill) |
| `outline`, `outline-strong` | hairlines and control borders |
| `on-surface`, `on-surface-variant`, `on-surface-muted` | body / secondary / caption text (all ≥ 4.5:1) |
| `placeholder` | text-input placeholders (≥ 4.5:1 on the `surface-container` well; `usePlaceholderColor` reads it) |
| `primary`, `on-primary`, `primary-container`, `on-primary-container` | the brand action colour (indigo) |
| `secondary` / `accent` (+ containers) | teal and pink accents; used sparingly |
| `success` / `warning` / `danger` / `info` (+ `-container`, `on-…-container`) | semantic state |

**Type scale** (`AppText` variants): `display` 30/36 bold · `headline` 22/28 semibold · `title`
17/22 semibold · `body` 15/21 · `body-strong` · `label` 13/18 medium · `caption` 12/16 ·
`overline` 11/14 semibold uppercase. Tones: `default`, `secondary`, `muted`, `primary`,
`success`, `warning`, `danger`, `info`, `on-gradient`, `on-gradient-muted`, `inherit`.

**Radii**: `rounded-card` (20px) for cards, `rounded-inner` (12px) for buttons and wells,
`rounded-full` for chips and discs. **Elevation**: `shadow-card` / `shadow-card-raised` on the
light canvas and `shadow-fab` under the floating capture button; dark mode relies on
surface/outline contrast (`dark:shadow-none`).

**Gradients** (`GradientCard gradient=`): `hero` (Today), `academic`, `health`, `soft` (quiet
tinted panel, drawn under the ordinary on-surface tones), plus `warm` (needs attention) and `calm`
(all clear) held for a future surface — no consumer today. One per screen at most; every stop of
the white-text presets is contrast-pinned.

## Primitives

| Component | Purpose |
|---|---|
| `Screen`, `ScreenFrame`, `ScreenCentered`, `ScreenHeader` | canvas background, 16px gutter, floating-button clearance, pull-to-refresh (`refreshing`/`onRefresh`), `safeTop` for a tab that hides its navigator bar, in-flow title block (`variant="compact"` on a stack screen, whose navigator bar already shows the title) |
| `Card`, `GradientCard` | the surface every block sits on; pressable when given `onPress`; a labelled inert card is one accessible group (`accessible` + `summary`) |
| `SectionHeader` | overline title · count, tone, icon, trailing action; the heading role sits on the title Text, never the row |
| `ListRow` | icon disc, title / subtitle / meta, trailing chip or chevron, 52px min, hairline divider; `containsControl` drops the row's button role when it wraps its own control (no `<button>` inside a `<button>` on web) |
| `StatusChip` | a tinted WORD about state (never interactive) |
| `MetricCard` | a number with a name, for stat rows |
| `ProgressBar` | determinate progress, clamped, `onGradient` variant |
| `Button`, `IconButton` | primary / tonal / outline / ghost / danger; `busy` mirrors a pending mutation; primary fires a light haptic |
| `EmptyState`, `ErrorState` | one shape for "nothing here" and "couldn't load", `screen` or `section` size |
| `Skeleton`, `SkeletonCard`, `SkeletonList`, `SkeletonScreen` | pulsing placeholders where the element WILL appear |
| `Icon` | Material Community Icons by role colour; decorative unless labelled (`aria-hidden` on web, the two RN props on native) |
| `triggerHaptic` | safe haptics (no-op on web; swallowed errors) |
| `navigationTheme`, `useSyncWebColorSchemeClass` | navigator chrome from the palette; the web dark-mode fix (below) |

**Composites that live beside their first consumer** (promote into `ui/` when a fourth domain
needs them; moving them today would make the `ui` barrel import itself): `ChoiceChip`
(`components/ask/choice-chip.tsx` — a selectable small button carrying `accessibilityState.selected`),
`TextField` / `FieldLabel` / `textFieldClass` (`components/ask/text-field.tsx`), `SegmentedControl`
(`components/calendar/segmented-control.tsx`).

## Rules

1. **Compose, don't restyle.** A screen never writes `text-neutral-*`, `bg-white` or hex values;
   a token pair (`bg-surface-container dark:bg-surface-container-dark`) is written only inside a
   component that has no primitive to lean on (the calendar grids, the recurrence editor, the
   composites above). Layout classes (`mt-4`, `flex-row`, `gap-3`) are fine. Known exceptions:
   the two modal scrims (`bg-black/50` in `events/[id].tsx`, `bg-black/40` in `quick-add-fab.tsx`),
   the on-gradient pill (`bg-white/20 border-white/30`, drawn in Today's Ask chip and the course
   hero), and `app/hardware-debug.tsx`.
2. **One gradient per screen**, for the block that must lead it.
3. **Chips are information; buttons are affordances.** A coloured word is never tappable.
4. **Loading**: a skeleton where the element will appear; nothing where it may never appear (an
   optional Today card — see `health-today-card.tsx`).
5. **Errors never fall through to empty states** (`academic/index.tsx`'s rule).
6. **44px targets, a role and a label on every pressable**, `hitSlop` on small ones. Accepted
   exception: the calendar month/week grids' event pills and hour slots, whose size is the grid's.
7. **No clock reads in render** (`react-hooks/purity`): use a query's `dataUpdatedAt`.
8. **Haptics only on meaningful taps.** `Button variant="primary"` fires a light impact and a
   successful capture fires a success notification; a primary button that only navigates opts out
   with `haptic={false}` (the "New …" buttons do). Destructive confirms are silent today.
9. **Dark mode on web** needs two things `useSyncWebColorSchemeClass` does: once at boot it calls
   NativeWind's `colorScheme.set("system")` (on a static export the interop runtime otherwise pins
   the scheme to "light" because `<html>` carries no `dark` class when the stylesheet is already
   applied), then it keeps the `dark` class on `<html>` in step with the hook so the compiled
   `.dark` selectors match. Verified on a static `expo export` under `prefers-color-scheme: dark`;
   a preference change mid-session needs a reload.

## Testing

Component tests keep the tree-walking idiom (no render library): mock hooks with `vi.mock`, call
the component, walk the element tree. `expo-linear-gradient`, `expo-haptics`, `@expo/vector-icons`
and `react-native-safe-area-context` are aliased to `src/__mocks__/*` in `vitest.config.mts`, like
`expo-router` (whose mock also carries the navigation theme objects) and `nativewind` (whose mock
carries `colorScheme`). The haptic contract is exercised with `Platform.OS` stubbed to Android. Pure helpers (`textClass`, `cardClass`, `chipClasses`, `buttonClasses`,
`clampProgress`, `sectionTitleText`) exist so vocabulary can be pinned without rendering.
