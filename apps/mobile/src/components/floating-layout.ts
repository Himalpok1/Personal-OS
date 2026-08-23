// Geometry for the two globally-mounted floating controls (QuickAddFab, right;
// PttButton, left), frozen in one place so the buttons and every scroll
// container agree.
//
// Checkpoint 5.6 background: both buttons sat at `bottom-40` (160px). That
// offset was chosen in Phase 2/3 to clear the Tasks tab's own in-flow "New
// task" button -- but Checkpoint 5.1 moved the Tasks list to a /tasks stack
// route, so the justification went away while the offset stayed. On the Rabbit
// R1's 640px-tall screen each 56px circle therefore floated in the band
// 160-216px above the bottom (a third of the way up the viewport), and the
// left PTT circle sat directly on top of the task-completion-checkbox column.
// Meanwhile no screen padded enough to clear it: pb-24 (96px) on Today/Agenda/
// Reviews, and nothing at all on the four FlatList tabs.
//
// These strings are Tailwind class names, written as literals so NativeWind's
// content scanner (./src/**/*.{js,jsx,ts,tsx}) still sees them.

/**
 * Vertical offset of both floating buttons.
 *
 * 96px, not 80px: measured on the physical Rabbit R1 (480x640) during
 * Checkpoint 5.6, an 80px offset put the buttons' lower edge at y=557 while the
 * tab bar's touch area starts at y=554 -- a 3px band where a tab tap was stolen
 * by the floating button. 96px lands the lower edge at y=544, genuinely clear.
 */
export const FLOATING_BUTTON_BOTTOM = "bottom-24"; // 96px

/** Diameter of both floating buttons. */
export const FLOATING_BUTTON_SIZE = "h-14 w-14"; // 56px

/**
 * Bottom padding every scrollable container needs so its last row can be
 * scrolled clear of the floating buttons. 96 (offset) + 56 (button) + 8 slack.
 */
export const FLOATING_CLEARANCE = "pb-40"; // 160px

// Numeric equivalents, for the few places that need real arithmetic rather
// than a class name (e.g. positioning a badge against the button's corner).
// Keep these in sync with the class names above.
export const FLOATING_BUTTON_BOTTOM_PX = 96;
export const FLOATING_BUTTON_SIZE_PX = 56;
export const FLOATING_BUTTON_SIDE_INSET_PX = 24; // right-6 / left-6

/**
 * Bottom margin an IN-FLOW bottom-of-screen CTA ("New note"/"New project")
 * needs on a TAB screen so the floating buttons do not sit on top of it.
 *
 * FLOATING_CLEARANCE does not help these: it pads a scroll container's CONTENT,
 * while the CTA is a sibling rendered after the list, pinned near the screen
 * bottom. Measured on the physical Rabbit R1 (480x640) during Checkpoint 5.6 --
 * with no margin the "New project" button occupied y 488-536 while the floating
 * buttons occupy y 482-540, so both circles sat directly on top of it.
 *
 * The buttons' top edge is 72px above a tab screen's own bottom (the tab bar
 * top), so 80px clears it with slack.
 */
export const FLOATING_CTA_CLEARANCE = "mb-20"; // 80px

/**
 * Same idea for a CTA on a pushed STACK screen (e.g. /tasks), which has no tab
 * bar underneath it. There the screen's bottom IS the window's bottom, so the
 * CTA must clear the buttons' full offset rather than only the part that pokes
 * above the tab bar: 96 (offset) + 56 (button) + slack. Verified on-device --
 * with the tab-screen value the "New task" button still landed at y 509-557
 * under buttons occupying y 482-540.
 */
export const FLOATING_CTA_CLEARANCE_NO_TABBAR = "mb-40"; // 160px

/**
 * Numeric form of FLOATING_CLEARANCE, for scroll containers that must ALSO add
 * the measured keyboard height (see components/use-keyboard-height.ts).
 *
 * Those containers deliberately express their padding entirely through
 * `contentContainerStyle` and pass NO `contentContainerClassName`. NativeWind
 * remaps `contentContainerClassName` onto the very same `contentContainerStyle`
 * prop (react-native-css-interop's `remapProps`, merged `toArray`), so passing
 * both makes the effective paddingBottom depend on array order -- and if the
 * class won, paddingBottom would collapse to the keyboard height, i.e. 0 with
 * the keyboard closed, silently undoing the floating-button clearance. One
 * mechanism, explicit arithmetic, no precedence to reason about.
 */
export const FLOATING_CLEARANCE_PX = 160;
