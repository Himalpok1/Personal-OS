// The design tokens (Checkpoint 10.3), in plain CommonJS so tailwind.config.js
// can `require` them at build time. theme.ts re-exports the same object with
// types for runtime consumers; nothing else imports this file directly.
//
// Colour roles follow Material 3's vocabulary (surface / on-surface / primary /
// primary-container / outline) without adopting its full tonal-palette
// machinery: this is a single-user app on a 480px Android device and a
// browser, and a role-based palette with one dark sibling per role is all the
// primitives need. Contrast is a TESTED contract (theme.test.ts): every text
// role clears 4.5:1 on every surface it is drawn on -- `on-surface-muted`
// included, because it carries 11-13px captions, eyebrows and tab labels,
// which are never "large text" -- and white / white-90 clear 4.5:1 on every
// stop of every gradient that carries them (the 10.3 review measured the
// first cut of this palette at 2.3:1 on the light health gradient).

const colors = {
  // ---- surfaces -------------------------------------------------------
  /** The screen background. Cool, very light gray so white cards read as raised. */
  canvas: { DEFAULT: "#F4F5F9", dark: "#0B0D14" },
  /** A card. */
  surface: { DEFAULT: "#FFFFFF", dark: "#151827" },
  /** An inset area inside a card (a row well, a chip background, a progress track). */
  "surface-container": { DEFAULT: "#EEF0F6", dark: "#1E2235" },
  /** A slightly raised element on a card (a segmented control's active pill). */
  "surface-raised": { DEFAULT: "#FFFFFF", dark: "#232841" },
  outline: { DEFAULT: "#E3E6EE", dark: "#2A3049" },
  "outline-strong": { DEFAULT: "#C9CEDC", dark: "#3B4260" },

  // ---- text on surfaces ----------------------------------------------
  "on-surface": { DEFAULT: "#0F1222", dark: "#F3F4F9" },
  "on-surface-variant": { DEFAULT: "#5B6175", dark: "#A6ACC2" },
  "on-surface-muted": { DEFAULT: "#646A7F", dark: "#8E95AD" },
  /** Text-input placeholders: the muted role, restated so inputs on a surface-container well clear 4.5:1. */
  placeholder: { DEFAULT: "#646A7F", dark: "#8E95AD" },

  // ---- brand -----------------------------------------------------------
  primary: { DEFAULT: "#4F46E5", dark: "#8B87F5" },
  "on-primary": { DEFAULT: "#FFFFFF", dark: "#0B0D14" },
  "primary-container": { DEFAULT: "#E4E5FB", dark: "#2B2A6B" },
  "on-primary-container": { DEFAULT: "#2E2A9E", dark: "#D9DAFE" },
  secondary: { DEFAULT: "#0F766E", dark: "#5EEAD4" },
  "secondary-container": { DEFAULT: "#D8F5F0", dark: "#134E48" },
  "on-secondary-container": { DEFAULT: "#0B5A54", dark: "#B9F2E8" },
  accent: { DEFAULT: "#DB2777", dark: "#F472B6" },
  "accent-container": { DEFAULT: "#FCE7F3", dark: "#5B1A3E" },

  // ---- semantic ------------------------------------------------------
  success: { DEFAULT: "#15803D", dark: "#4ADE80" },
  "success-container": { DEFAULT: "#DCFCE7", dark: "#14402A" },
  "on-success-container": { DEFAULT: "#14532D", dark: "#BBF7D0" },
  warning: { DEFAULT: "#B45309", dark: "#FBBF24" },
  "warning-container": { DEFAULT: "#FEF3C7", dark: "#4A3308" },
  "on-warning-container": { DEFAULT: "#78350F", dark: "#FDE68A" },
  danger: { DEFAULT: "#D12222", dark: "#F87171" },
  "danger-container": { DEFAULT: "#FEE2E2", dark: "#4C1D1D" },
  "on-danger-container": { DEFAULT: "#991B1B", dark: "#FECACA" },
  info: { DEFAULT: "#2563EB", dark: "#60A5FA" },
  "info-container": { DEFAULT: "#DBEAFE", dark: "#1E3A6E" },
  "on-info-container": { DEFAULT: "#1E40AF", dark: "#BFDBFE" },
};

// Type scale: name → [size, { lineHeight, fontWeight? }]. Weights are set by
// the primitives (Text variants), not the size token, so `text-title` alone
// never changes weight -- the same discipline Tailwind's own sizes follow.
const fontSize = {
  display: ["30px", { lineHeight: "36px", letterSpacing: "-0.5px" }],
  headline: ["22px", { lineHeight: "28px", letterSpacing: "-0.3px" }],
  title: ["17px", { lineHeight: "22px" }],
  body: ["15px", { lineHeight: "21px" }],
  label: ["13px", { lineHeight: "18px" }],
  caption: ["12px", { lineHeight: "16px" }],
  overline: ["11px", { lineHeight: "14px", letterSpacing: "0.6px" }],
};

const borderRadius = {
  /** A card. */
  card: "20px",
  /** An inner element on a card (a row well, a button). */
  inner: "12px",
};

// Card elevation. Deliberately soft and short: a tinted, low-alpha shadow
// reads as depth on a light canvas without the "floating paper" look of
// Tailwind's default `shadow-md`. Dark mode relies on the surface/outline
// contrast instead -- a shadow on a near-black canvas is invisible anyway.
const boxShadow = {
  card: "0px 1px 2px rgba(15, 18, 34, 0.05), 0px 6px 16px rgba(15, 18, 34, 0.06)",
  "card-raised": "0px 2px 4px rgba(15, 18, 34, 0.06), 0px 12px 28px rgba(15, 18, 34, 0.10)",
  fab: "0px 6px 18px rgba(79, 70, 229, 0.35)",
};

// Gradient presets: [start, end] pairs, light and dark. Read at runtime by
// GradientCard through theme.ts; listed here so the palette lives in one file.
// Every preset except `soft` is drawn under white / white-90 text and each
// stop must clear 4.5:1 for both (pinned in theme.test.ts); `soft` is a pale
// panel drawn under the ordinary on-surface tones and is pinned the other way.
const gradients = {
  /** The Today hero. */
  hero: { light: ["#4F46E5", "#6D28D9"], dark: ["#3B36B8", "#5B21B6"] },
  /** Academic surfaces. */
  academic: { light: ["#0369A1", "#4338CA"], dark: ["#075985", "#4338CA"] },
  /** Health surfaces. */
  health: { light: ["#047857", "#0369A1"], dark: ["#065F46", "#0C5A85"] },
  /** Something needs attention (at risk / behind). Available to a future surface; no consumer today. */
  warm: { light: ["#A63A0B", "#B91C1C"], dark: ["#9A3412", "#991B1B"] },
  /** All clear. Available to a future surface; no consumer today. */
  calm: { light: ["#0D6B63", "#166534"], dark: ["#115E59", "#166534"] },
  /** A quiet tinted panel (an empty state, a profile section). */
  soft: { light: ["#EEF0FF", "#F5F3FF"], dark: ["#1B1F3A", "#221B44"] },
};

module.exports = { tokens: { colors, fontSize, borderRadius, boxShadow, gradients } };
