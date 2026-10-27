import { describe, expect, it } from "vite-plus/test";
import {
  BUILT_IN_THEMES,
  getThemeColorsForAppearance,
  ZEROPS_THEME,
} from "@t3tools/shared/themePalettes";

import { themeColorToNativeColor } from "../../lib/mobileTheme";

import {
  buildGhosttyThemeConfig,
  getMobileTerminalTheme,
  type TerminalAppearanceScheme,
} from "./terminalTheme";

describe("getMobileTerminalTheme", () => {
  it("applies the Zerops terminal roles without replacing ANSI status colors", () => {
    for (const scheme of ["light", "dark"] satisfies ReadonlyArray<TerminalAppearanceScheme>) {
      const colors = getThemeColorsForAppearance(ZEROPS_THEME, scheme) ?? ZEROPS_THEME.colors;
      const terminal = getMobileTerminalTheme("zerops", scheme);

      expect(terminal.background).toBe(themeColorToNativeColor(colors.terminalBackground));
      expect(terminal.foreground).toBe(themeColorToNativeColor(colors.terminalForeground));
      expect(terminal.cursorForeground).toBe(themeColorToNativeColor(colors.terminalCursor));
      expect(terminal.cursorBackground).toBe(terminal.background);
    }
  });

  it("keeps the Pierre ANSI palette under every theme", () => {
    const dark = getMobileTerminalTheme("zerops", "dark");
    expect(dark.palette[0]).toBe("#141415");
    expect(dark.palette[15]).toBe("#c6c6c8");
    for (const themeId of ["t3-chat", "grove", "ocean", "ember", "iris"] as const) {
      expect(getMobileTerminalTheme(themeId, "dark").palette).toEqual(dark.palette);
    }
  });

  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("zerops", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(standard.palette);
  });

  it("uses the canonical desktop terminal roles for built-in themes", () => {
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === "ocean")!;
    const colors = getThemeColorsForAppearance(theme, "dark")!;
    const terminal = getMobileTerminalTheme("ocean", "dark");

    expect(terminal.background).toBe(themeColorToNativeColor(colors.terminalBackground));
    expect(terminal.foreground).toBe(themeColorToNativeColor(colors.terminalForeground));
    expect(terminal.cursorForeground).toBe(themeColorToNativeColor(colors.terminalCursor));
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const terminal = getMobileTerminalTheme("zerops", "dark");
    const config = buildGhosttyThemeConfig(terminal);

    expect(config).toContain(`background = ${terminal.background}`);
    expect(config).toContain(`foreground = ${terminal.foreground}`);
    expect(config).toContain(`cursor-color = ${terminal.cursorForeground}`);
    expect(config).toContain("palette = 0=#141415");
    expect(config).toContain("palette = 15=#c6c6c8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
