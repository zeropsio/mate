import { describe, expect, it } from "vite-plus/test";

import { APP_BASE_NAME } from "../../branding";
import { ZEROPS_THEME } from "../../themePalette";
import { STANDARD_THEME_CARDS, previewColorsOf } from "./ThemePreviewCircles";

describe("standard theme preview", () => {
  it("derives the Zerops Code card from the default palette", () => {
    const card = STANDARD_THEME_CARDS[0]!;
    expect(card.label).toBe(APP_BASE_NAME);
    expect(previewColorsOf(card, "light")).toEqual({
      sidebar: ZEROPS_THEME.colors.sidebar,
      canvas: ZEROPS_THEME.colors.canvas,
      surface: ZEROPS_THEME.colors.surface,
      accentSurface: ZEROPS_THEME.colors.accentSurface,
      accent: ZEROPS_THEME.colors.accent,
      messageSurface: ZEROPS_THEME.colors.messageSurface,
      messageAction: ZEROPS_THEME.colors.messageAction,
    });
    expect(previewColorsOf(card, "dark")).toEqual({
      sidebar: ZEROPS_THEME.variants!.dark!.sidebar,
      canvas: ZEROPS_THEME.variants!.dark!.canvas,
      surface: ZEROPS_THEME.variants!.dark!.surface,
      accentSurface: ZEROPS_THEME.variants!.dark!.accentSurface,
      accent: ZEROPS_THEME.variants!.dark!.accent,
      messageSurface: ZEROPS_THEME.variants!.dark!.messageSurface,
      messageAction: ZEROPS_THEME.variants!.dark!.messageAction,
    });
  });
});
