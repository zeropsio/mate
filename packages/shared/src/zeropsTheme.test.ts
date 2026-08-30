import { describe, expect, it } from "vite-plus/test";

import {
  BUILT_IN_THEMES,
  THEME_COLOR_ROLES,
  ZEROPS_THEME,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
} from "./themePalettes.ts";
import { contrastRatio, parseThemeColor, projectThemePreviewColors } from "./themePreview.ts";

const appearances = ["light", "dark"] as const;

function colorsFor(appearance: ThemeAppearance): ThemeColors {
  return appearance === "light" ? ZEROPS_THEME.colors : ZEROPS_THEME.variants!.dark!;
}

function canonicalThemeColor(value: string): string | null {
  const match = /^oklch\(([\d.]+) ([\d.]+) (-?[\d.]+)(?: \/ ([\d.]+))?\)$/u.exec(value);
  if (!match) return null;
  const number = (input: string, precision: number) => {
    const parsed = Number(input);
    const rounded = Math.abs(parsed) < 10 ** -precision / 2 ? 0 : parsed;
    return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/u, "$1");
  };
  const lightness = number(match[1]!, 6);
  const chroma = number(match[2]!, 6);
  const hue = Number(match[2]) < 0.0000005 ? "0" : number(match[3]!, 3);
  const alpha = match[4] === undefined ? "" : ` / ${number(match[4], 4)}`;
  return `oklch(${lightness} ${chroma} ${hue}${alpha})`;
}

function themeColorToSrgb(value: string): readonly [number, number, number] {
  const color = parseThemeColor(value);
  if (!color) throw new Error(`Expected a theme color, received ${value}`);
  const lPrime = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mPrime = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const sPrime = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const linearToSrgb = (channel: number) => {
    const converted = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, converted));
  };
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hexToSrgb(value: string): readonly [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
  if (!match) throw new Error(`Expected an sRGB hex color, received ${value}`);
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ];
}

function flattenSrgb(foreground: string, background: string, alpha: number) {
  const foregroundChannels = hexToSrgb(foreground);
  const backgroundChannels = hexToSrgb(background);
  return foregroundChannels.map(
    (channel, index) =>
      Math.round((channel * alpha + backgroundChannels[index]! * (1 - alpha)) * 255) / 255,
  );
}

describe("ZEROPS_THEME", () => {
  it.each(
    BUILT_IN_THEMES.flatMap((theme) => appearances.map((appearance) => ({ appearance, theme }))),
  )(
    "projects $theme.id $appearance preview colors from exact palette roles",
    ({ appearance, theme }) => {
      const colors =
        appearance === theme.appearance
          ? theme.colors
          : (theme.variants?.[appearance] ?? theme.colors);
      expect(projectThemePreviewColors(colors)).toEqual({
        sidebar: colors.sidebar,
        canvas: colors.canvas,
        surface: colors.surface,
        accentSurface: colors.accentSurface,
        accent: colors.accent,
        messageSurface: colors.messageSurface,
        messageAction: colors.messageAction,
      });
    },
  );

  it("defines all 57 roles in canonical order for both appearances", () => {
    expect(Object.keys(ZEROPS_THEME.colors)).toEqual(THEME_COLOR_ROLES);
    expect(Object.keys(ZEROPS_THEME.variants!.dark!)).toEqual(THEME_COLOR_ROLES);
  });

  it.each(appearances)("stores every %s role as opaque canonical OKLCH", (appearance) => {
    for (const [role, value] of Object.entries(colorsFor(appearance))) {
      const parsed = parseThemeColor(value);
      expect(parsed, `${appearance}/${role}`).not.toBeNull();
      expect(parsed?.alpha, `${appearance}/${role}`).toBe(1);
      expect(canonicalThemeColor(value), `${appearance}/${role}`).toBe(value);
    }
  });

  const textPairs = [
    ["text", "canvas"],
    ["text", "surface"],
    ["text", "surfaceRaised"],
    ["messageActionForeground", "messageAction"],
    ["accentForeground", "accent"],
    ["accentSurfaceForeground", "accentSurface"],
    ["errorForeground", "errorSurface"],
    ["warningForeground", "warningSurface"],
    ["updateForeground", "updateSurface"],
    ["messageForeground", "messageSurface"],
    ["secondaryForeground", "secondary"],
    ["mutedForeground", "muted"],
    ["toolbarForeground", "toolbar"],
    ["toolbarControlForeground", "toolbarControl"],
    ["sidebarForeground", "sidebar"],
    ["sidebarMutedForeground", "sidebar"],
    ["codeForeground", "codeBackground"],
    ["terminalForeground", "terminalBackground"],
    ["textMuted", "canvas"],
    ["textMuted", "surface"],
    ["secondaryLabel", "canvas"],
    ["secondaryLabel", "surface"],
  ] as const satisfies ReadonlyArray<readonly [ThemeColorRole, ThemeColorRole]>;

  it.each(appearances)("keeps every named %s text pair at WCAG AA", (appearance) => {
    const colors = colorsFor(appearance);
    for (const [foreground, background] of textPairs) {
      expect(
        contrastRatio(colors[foreground], colors[background]),
        `${appearance}/${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the light placeholder readable on its input", () => {
    expect(
      contrastRatio(ZEROPS_THEME.colors.placeholder, ZEROPS_THEME.colors.input),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(appearances)(
    "keeps %s focus and terminal cursor indicators discernible",
    (appearance) => {
      const colors = colorsFor(appearance);
      expect(contrastRatio(colors.focus, colors.canvas)).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(colors.terminalCursor, colors.terminalBackground),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(appearances)("keeps the 60% mixed %s sidebar icon discernible", (appearance) => {
    const colors = colorsFor(appearance);
    const foreground = themeColorToSrgb(colors.sidebarMutedForeground);
    const background = themeColorToSrgb(colors.sidebar);
    const mixed = foreground.map((channel, index) => channel * 0.6 + background[index]! * 0.4);
    const mixedHex = `#${mixed
      .map((channel) =>
        Math.round(channel * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    expect(contrastRatio(mixedHex, colors.sidebar)).toBeGreaterThanOrEqual(3);
  });

  it("documents dark placeholder/input at 2.42 as the Zerops exclusion", () => {
    const colors = colorsFor("dark");
    const ratio = contrastRatio(colors.placeholder, colors.input);
    expect(ratio).toBeCloseTo(2.42, 2);
    expect(ratio).toBeLessThan(4.5);
  });

  it.each(["#02b1a3", "#00ccbb", "#3cbdb2"])(
    "rejects brand teal %s as light-surface foreground",
    (teal) => {
      expect(contrastRatio(teal, ZEROPS_THEME.colors.surface)).toBeLessThan(4.5);
      expect(contrastRatio(teal, ZEROPS_THEME.colors.canvas)).toBeLessThan(4.5);
    },
  );

  const flattenedRoles = [
    [
      "light toolbarControl: 4% black over canvas",
      "light",
      "toolbarControl",
      "#000000",
      "#eceff3",
      0.04,
    ],
    [
      "light toolbarControlHover: 8% black over canvas",
      "light",
      "toolbarControlHover",
      "#000000",
      "#eceff3",
      0.08,
    ],
    [
      "light updateSurface: 12.9% identity teal over surface",
      "light",
      "updateSurface",
      "#00ccbb",
      "#ffffff",
      0.129,
    ],
    [
      "dark updateSurface: 14% mint over surface",
      "dark",
      "updateSurface",
      "#00e5c0",
      "#141918",
      0.14,
    ],
    [
      "dark messageSurface: 15% core blue over surface",
      "dark",
      "messageSurface",
      "#58a6ff",
      "#141918",
      0.15,
    ],
    [
      "light terminalSelection: 20% blue over surface",
      "light",
      "terminalSelection",
      "#0077cc",
      "#ffffff",
      0.2,
    ],
    [
      "dark terminalSelection: 28% blue over terminal",
      "dark",
      "terminalSelection",
      "#58a6ff",
      "#0c0f0e",
      0.28,
    ],
    [
      "light sidebarControlSurface: 4% black over sidebar",
      "light",
      "sidebarControlSurface",
      "#000000",
      "#eceff3",
      0.04,
    ],
    [
      "light sidebarRowHover: 4% black over sidebar",
      "light",
      "sidebarRowHover",
      "#000000",
      "#eceff3",
      0.04,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, ThemeAppearance, ThemeColorRole, string, string, number]
  >;

  it.each(flattenedRoles)(
    "recomputes %s",
    (_name, appearance, role, foreground, background, alpha) => {
      const actual = themeColorToSrgb(colorsFor(appearance)[role]);
      const expected = flattenSrgb(foreground, background, alpha);
      for (const [index, channel] of actual.entries()) {
        expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(1 / 255);
      }
    },
  );
});
