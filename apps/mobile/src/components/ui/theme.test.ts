import { describe, expect, it } from "vitest";
import { DARK_COLORS, LIGHT_COLORS, colorsForScheme, gradientForScheme, tokens } from "./theme";

// The palette is stated once in tokens.js and consumed twice -- by Tailwind
// at build time and by theme.ts at runtime. These tests pin the shape both
// consumers rely on, so a role added to one side without the other fails
// here rather than as an invisible icon on a device.

const HEX = /^#[0-9A-F]{6}$/;

// WCAG 2.x relative luminance / contrast ratio, alpha-composited for the
// white-90 gradient text. Kept in the test rather than the runtime: nothing
// in the app computes contrast, it only has to keep clearing it.
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const composite = (fg: string, alpha: number, bg: string) => {
  const f = channels(fg);
  const b = channels(bg);
  return `#${f
    .map((c, i) => Math.round((c * alpha + (b[i] as number) * (1 - alpha)) * 255))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
};

const TEXT_ROLES = ["on-surface", "on-surface-variant", "on-surface-muted", "placeholder"] as const;
const TEXT_SURFACES = ["canvas", "surface", "surface-container", "surface-raised"] as const;
const SEMANTIC_ON_CANVAS = ["primary", "success", "warning", "danger", "info"] as const;
const CONTAINER_PAIRS = [
  ["on-primary", "primary"],
  ["on-primary-container", "primary-container"],
  ["on-secondary-container", "secondary-container"],
  ["on-success-container", "success-container"],
  ["on-warning-container", "warning-container"],
  ["on-danger-container", "danger-container"],
  ["on-info-container", "info-container"],
] as const;

describe("contrast contract", () => {
  it("every text role clears 4.5:1 on every surface, in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      const c = colorsForScheme(scheme);
      for (const role of TEXT_ROLES) {
        for (const surface of TEXT_SURFACES) {
          expect(
            contrast(c[role], c[surface]),
            `${scheme} ${role} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("semantic colours clear 4.5:1 as text on the canvas and every on-container pair clears 4.5:1", () => {
    for (const scheme of ["light", "dark"] as const) {
      const c = colorsForScheme(scheme);
      for (const role of SEMANTIC_ON_CANVAS) {
        expect(contrast(c[role], c.canvas), `${scheme} ${role} on canvas`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrast(c[role], c.surface), `${scheme} ${role} on surface`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      for (const [fg, bg] of CONTAINER_PAIRS) {
        expect(contrast(c[fg], c[bg]), `${scheme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("white and white-90 clear 4.5:1 on every stop of every gradient that carries them; soft carries on-surface", () => {
    for (const [name, preset] of Object.entries(tokens.gradients)) {
      for (const scheme of ["light", "dark"] as const) {
        for (const stop of preset[scheme]) {
          if (name === "soft") {
            const c = colorsForScheme(scheme);
            expect(
              contrast(c["on-surface"], stop),
              `${scheme} soft ${stop}`,
            ).toBeGreaterThanOrEqual(4.5);
            expect(
              contrast(c["on-surface-variant"], stop),
              `${scheme} soft ${stop}`,
            ).toBeGreaterThanOrEqual(4.5);
            continue;
          }
          expect(
            contrast("#FFFFFF", stop),
            `${scheme} ${name} ${stop} white`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(composite("#FFFFFF", 0.9, stop), stop),
            `${scheme} ${name} ${stop} white-90`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("design tokens", () => {
  it("every colour role has a light and a dark six-digit hex value", () => {
    for (const [role, pair] of Object.entries(tokens.colors)) {
      expect(pair.DEFAULT, role).toMatch(HEX);
      expect(pair.dark, role).toMatch(HEX);
    }
  });

  it("resolves the same role set for both schemes", () => {
    expect(Object.keys(LIGHT_COLORS).sort()).toEqual(Object.keys(tokens.colors).sort());
    expect(Object.keys(DARK_COLORS).sort()).toEqual(Object.keys(tokens.colors).sort());
    expect(colorsForScheme("light")).toBe(LIGHT_COLORS);
    expect(colorsForScheme("dark")).toBe(DARK_COLORS);
  });

  it("light and dark values differ for every role except pure white/black anchors", () => {
    for (const [role, pair] of Object.entries(tokens.colors)) {
      if (role === "on-primary") continue; // white on the light primary, near-black on the pale dark one -- both stated explicitly
      expect(pair.DEFAULT, role).not.toBe(pair.dark);
    }
  });

  it("every gradient preset has two stops per scheme", () => {
    for (const [name, preset] of Object.entries(tokens.gradients)) {
      expect(preset.light, name).toHaveLength(2);
      expect(preset.dark, name).toHaveLength(2);
      for (const stop of [...preset.light, ...preset.dark]) expect(stop, name).toMatch(HEX);
    }
    expect(gradientForScheme("hero", "light")).toEqual(tokens.gradients.hero.light);
    expect(gradientForScheme("hero", "dark")).toEqual(tokens.gradients.hero.dark);
  });

  it("the type scale carries every AppText size variant", () => {
    expect(Object.keys(tokens.fontSize).sort()).toEqual(
      ["body", "caption", "display", "headline", "label", "overline", "title"].sort(),
    );
  });

  it("tailwind.config.js extends its theme from the one token object", async () => {
    // The config requires nativewind's preset, which is plain JS and loads
    // under vitest; if that ever changes, this test should be replaced by a
    // source-text check rather than dropped.
    const config = (await import("../../../tailwind.config.js")).default as {
      theme: {
        extend: { colors: unknown; fontSize: unknown; borderRadius: unknown; boxShadow: unknown };
      };
      darkMode: string;
    };
    expect(config.theme.extend.colors).toEqual(tokens.colors);
    expect(config.theme.extend.fontSize).toEqual(tokens.fontSize);
    expect(config.theme.extend.borderRadius).toEqual(tokens.borderRadius);
    expect(config.theme.extend.boxShadow).toEqual(tokens.boxShadow);
    expect(config.darkMode).toBe("class");
  });
});
