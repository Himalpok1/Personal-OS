# Personal OS — Mobile Design System (Checkpoint 10.3; motion and gestures added at 10.6)

The universal Expo client (iOS, Android, web) draws every screen from one set of tokens and one
set of primitives, both under `apps/mobile/src/components/ui/`. A screen composes primitives; it
does not write colour classes of its own. This document is the contract; the source files carry
the per-component detail in their header comments. Checkpoint 10.6 added a motion vocabulary
(`motion.ts`), press/complete/swipe/toast/sheet/counter primitives on `react-native-reanimated`
and `react-native-gesture-handler`, and the rules under **Motion** and **Gestures** below.

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
| `Card`, `GradientCard` | the surface every block sits on; pressable when given `onPress` (through `PressableScale`); a labelled inert card is one accessible group (`accessible` + `summary`); `Card variant="soft"` is the quiet tinted panel on the `soft` gradient |
| `SectionHeader` | overline title · count, tone, icon, trailing action (`action.icon` replaces the default chevron); the heading role sits on the title Text, never the row |
| `ListRow` | icon disc, title / subtitle / meta, trailing chip or chevron, 52px min, hairline divider; `containsControl` drops the row's button role when it wraps its own control (no `<button>` inside a `<button>` on web); `trailingChips` (≤ 2, then `+N`), `onLongPress`, `entering` (10.6) |
| `StatusChip` | a tinted WORD about state (never interactive); `size="sm"` (default) or `"md"` |
| `MetricCard` | a number with a name, for stat rows; `delta` adds a toned change caption, `animate` counts a plain integer value up through `AnimatedNumber` |
| `SegmentedControl` | two or three labelled segments on a well, the active one lifted (promoted into `ui/` at 10.4) |
| `ProgressBar` | determinate progress, clamped, `onGradient` variant |
| `Button`, `IconButton` | primary / tonal / outline / ghost / danger; `busy`/`disabled` on both mirror a pending mutation; primary fires a light haptic; both settle to 97% under the finger through `PressableScale` |
| `EmptyState`, `ErrorState` | one shape for "nothing here" and "couldn't load", `screen` or `section` size; `EmptyState size="compact"` is one 44px row for use inside a card |
| `Skeleton`, `SkeletonCard`, `SkeletonList`, `SkeletonScreen` | pulsing placeholders where the element WILL appear |
| `Icon` | Material Community Icons by role colour; decorative unless labelled (`aria-hidden` on web, the two RN props on native) |
| `triggerHaptic` | safe haptics (no-op on web; swallowed errors) |
| `navigationTheme`, `useSyncWebColorSchemeClass` | navigator chrome from the palette; the web dark-mode fix (below) |
| `useRefreshControl(refreshing, onRefresh)` | the palette-tinted `RefreshControl` `Screen` wires for itself, for a FlatList tab's `refreshControl` (10.6) |
| `PressableScale` | the one press animation: springs the node to 97% on press-in (`SPRING.press`), back on release; plain Pressable + `active:opacity-80` on web and under reduced motion; `activeClassName={null}` when the caller's classes already carry an active state |
| `CompletionCircle` | the task/occurrence completion control: `open` ring / `pending` slice / `done` filled check, 44px, `hitSlop`, stops propagation so it sits inside a `ListRow` (`containsControl`), success haptic on the completing tap, spring-bounce into `done` |
| `SwipeableRow` | left/right action panels on `ReanimatedSwipeable` (`SwipeAction`: key, label, icon, tone, onPress, haptic); children only on web |
| `ToastHost`, `showToast` | a root-mounted, single-slot toast (`message`, `tone`, `action`, `durationMs`) callable from any hookless code; slides up above the floating buttons, polite live region, 44px action, auto-dismisses, latest wins |
| `AnimatedNumber` | counts to `value` through `useAnimatedProps` on a non-editable TextInput; label = the final formatted value; plain `AppText` on web / reduced motion; `format` must be a worklet (default: comma-grouped integers) |
| `ClampedText` | hookless class component: prose clamped to `lines` with a measured Show more / Show less toggle (drop-in for `ClampedBriefText` / `ClampedDigestText`, incl. their `textClassName`/`containerClassName`), expand eased by a `layout` transition |
| `BottomSheet`, `SheetFrame`, `SheetRow` | a transparent, status-bar-translucent Modal with a fading `bg-black/40` scrim and a sliding sheet (handle, title, Close, safe-bottom / keyboard padding, `accessibilityViewIsModal`); the Modal stays up until the exit finishes; `SheetRow` is a 52px action row |
| `AnimatedPressable`, `AnimatedView` | the interop-wrapped animated hosts the primitives above build on (see **Motion → className on animated nodes**) |

**Composites that live beside their first consumer** (promote into `ui/` when a fourth domain
needs them; moving them today would make the `ui` barrel import itself): `ChoiceChip`
(`components/ask/choice-chip.tsx` — a selectable small button carrying `accessibilityState.selected`),
`TextField` / `FieldLabel` / `textFieldClass` (`components/ask/text-field.tsx`). `SegmentedControl`
was promoted into `ui/` at Checkpoint 10.4.

## Motion (Checkpoint 10.6)

`motion.ts` is the whole vocabulary: `DURATION = { fast: 150, base: 220, slow: 320 }` ms,
`SPRING = { press: { damping 18, stiffness 260 }, settle: { damping 14, stiffness 180 } }`,
`PRESS_SCALE = 0.97`, and the entering/layout presets `enterFade`, `enterRise` (the built-in
`FadeInDown` — never `.withInitialValues`, which would turn it into a custom keyframe that Reanimated's
web manager pins `position: absolute` after it ends, collapsing list rows), `exitFade`, `layoutSettle` (a linear layout transition). Feedback uses `fast`,
enter/exit uses `base`, a sheet uses `slow`; a press uses `SPRING.press`, a landing (the completion
bounce) uses `SPRING.settle`. Nothing outside `ui/` writes its own duration or spring.

**Motion never blocks.** A user who has asked the OS for reduced motion gets the same END STATE,
instantly — the circle is filled, the toast is on screen, the sheet is open — and the same handlers
fire at the same moments. Reanimated's own animations honour the setting by default
(`ReduceMotion.System`); `useMotionEnabled(cost)` (pure core: `motionEnabled`) is how a primitive
makes the JS-side choice — which component to render. `cost` is `"rich"` for a per-frame JS-driven
animation (the press spring, the counting number: OFF on web and under reduced motion) and
`"cheap"` for an entering fade or a sheet slide (OFF only under reduced motion).

**className on animated nodes.** NativeWind's interop wraps `View`/`Text`/`Pressable` at JSX time;
`Animated.View`, `LinearGradient` and vector icons are not wrapped, so a `className` on them is
SILENTLY DROPPED — style those through `style` and read colours from `useTheme().colors`. When one
node needs both a class string and an animated style (a card that keeps `flex-1`/`absolute`/
`flex-row` AND scales), use `AnimatedPressable`/`AnimatedView` from `animated.ts`: Reanimated's
`createAnimatedComponent` applied to the INTEROP-WRAPPED component (resolved through NativeWind's
public `createInteropElement`). The reverse — `cssInterop(Animated.createAnimatedComponent(...))` —
is wrong on native: the interop spreads the animated style into a plain object and Reanimated's
props filter then drops every class-derived style.

**Shared values** are read and written through `.get()` / `.set()` (React's immutability lint
forbids assigning to a hook result's property; Reanimated ships the methods for that reason).

**Pressables.** Every pressable primitive (`Card`, `GradientCard`, `MetricCard`, `Button`,
`IconButton`) renders through `PressableScale`; a screen never adds a second press animation.
Haptics stay on meaningful taps (rule 8) — `CompletionCircle` fires success on the tap that
completes, a `SwipeAction` fires the haptic it declares, a toast fires none.

**Toasts.** One slot, root-mounted (`ToastHost` in `app/_layout.tsx`). `showToast()` is a plain
function backed by a module store (`useSyncExternalStore`) so a mutation's `onSuccess` can call it
from a query hook or a hookless component; the latest toast replaces the visible one; an action
makes it stay 6 s instead of 4 s. Use it for what just happened ("Archived" + Undo), never for an
error that needs reading — those keep their inline `ErrorState`/alert text.

## Gestures (Checkpoint 10.6)

`GestureHandlerRootView` is the outermost node of `app/_layout.tsx` (style, not className).
`SwipeableRow` is the one gesture primitive: drag a row to reveal toned action panels
(`swipeActionPanelClass(tone)` over the container tokens) that close after an action fires. **Web
gets no swipe** — `Platform.OS === "web"` renders the children alone, and every action a panel
offers must also be reachable through the row's own controls (its completion circle, its detail
screen, a long-press sheet). A swipe is a shortcut, never the only route; that is also what keeps
it honest for a screen-reader user on a device. The gesture is user-driven, so it works under
reduced motion. `BottomSheet` has no swipe-to-dismiss: the scrim tap, the Close button and the
Android back button dismiss it.

## Rules

1. **Compose, don't restyle.** A screen never writes `text-neutral-*`, `bg-white` or hex values;
   a token pair (`bg-surface-container dark:bg-surface-container-dark`) is written only inside a
   component that has no primitive to lean on (the calendar grids, the recurrence editor, the
   composites above). Layout classes (`mt-4`, `flex-row`, `gap-3`) are fine. Known exceptions:
   the modal scrims (`bg-black/50` in `events/[id].tsx`, `bg-black/40` in `quick-add-fab.tsx` and
   in `BottomSheet`),
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
the component, walk the element tree. `expo-linear-gradient`, `expo-haptics`, `@expo/vector-icons`,
`react-native-safe-area-context`, `react-native-reanimated` and `react-native-gesture-handler`
(both the package and its `/ReanimatedSwipeable` subpath — the subpath alias is listed first, since
aliases match as prefixes in order) are aliased to `src/__mocks__/*` in `vitest.config.mts`, like
`expo-router` (whose mock also carries the navigation theme objects) and `nativewind` (whose mock
carries `colorScheme` and `createInteropElement`). The haptic contract is exercised with
`Platform.OS` stubbed to Android. Pure helpers (`textClass`, `cardClass`, `softCardClass`,
`chipClasses`, `buttonClasses`, `clampProgress`, `sectionTitleText`, `motionEnabled`,
`pressScaleConfig`, `completionCircleIcon`/`completionHaptic`, `swipeActionPanelClass`,
`toastClasses`/`toastDuration`, `formatGroupedInteger`/`numberTextStyle`, `clampedTextClass`,
`sheetTranslateY`/`sheetDurations`, `trailingChipsVisible`, `metricAnimatedValue`) exist so
vocabulary can be pinned without rendering.

**The leaf-wrapper rule (10.6).** Under the reanimated mock every Reanimated hook is a plain
function (`useSharedValue` is a box with `.get()`/`.set()`, `useAnimatedStyle` calls its worklet
once, `withSpring`/`withTiming` return their target), so a component that uses ONLY Reanimated
hooks can still be invoked directly by the walk, and the animated hosts resolve to `Pressable`/
`View`. A component that also needs a React hook (a ref, an effect, `useSyncExternalStore`) is
kept a thin LEAF — `CompletionGlyph`, `AnimatedNumberCounter`, `ToastHost`, `BottomSheet` — with
its decisions in pure helpers and its hookless surface (`CompletionCircle`, `AnimatedNumber`'s
plain branch, `ToastCard`, `SheetFrame`/`SheetRow`) exported separately; a test lists the leaf in
its `HOST_TYPES` and asserts on the leaf's props. `ClampedText` stays a class component for the
same reason `ClampedBriefText` was one: instance state needs no dispatcher.
