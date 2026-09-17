// Types for tokens.js (see that file for why the palette is CommonJS).

export type ColorPair = { DEFAULT: string; dark: string };
export type GradientPair = { light: [string, string]; dark: [string, string] };

export type ColorRole =
  | "canvas"
  | "surface"
  | "surface-container"
  | "surface-raised"
  | "outline"
  | "outline-strong"
  | "on-surface"
  | "on-surface-variant"
  | "on-surface-muted"
  | "placeholder"
  | "primary"
  | "on-primary"
  | "primary-container"
  | "on-primary-container"
  | "secondary"
  | "secondary-container"
  | "on-secondary-container"
  | "accent"
  | "accent-container"
  | "success"
  | "success-container"
  | "on-success-container"
  | "warning"
  | "warning-container"
  | "on-warning-container"
  | "danger"
  | "danger-container"
  | "on-danger-container"
  | "info"
  | "info-container"
  | "on-info-container";

export type GradientName = "hero" | "academic" | "health" | "warm" | "calm" | "soft";

export interface Tokens {
  colors: Record<ColorRole, ColorPair>;
  fontSize: Record<string, [string, { lineHeight: string; letterSpacing?: string }]>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  gradients: Record<GradientName, GradientPair>;
}

export const tokens: Tokens;
