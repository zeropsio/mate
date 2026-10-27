import { useLayoutEffect } from "react";

import { useTheme } from "~/hooks/useTheme";
import { applyThemePalette, resolveThemeHalf, type ThemeAppearance } from "~/themePalette";

/** How the kit page shows its sections: one appearance, or both side by side. */
export type KitView = ThemeAppearance | "both";

export interface KitSearch {
  readonly appearance?: KitView;
  /** Set on the two frames of the "both" view: the sections alone, without the index. */
  readonly pane?: true;
}

export function validateKitSearch(raw: Readonly<Record<string, unknown>>): KitSearch {
  const appearance =
    raw.appearance === "light" || raw.appearance === "dark" || raw.appearance === "both"
      ? raw.appearance
      : undefined;
  const pane = raw.pane === true || raw.pane === "true";
  return {
    ...(appearance === undefined ? {} : { appearance }),
    ...(pane ? { pane: true } : {}),
  };
}

/**
 * Paints the page in one appearance of the person's own theme, the way the app paints itself
 * (`applyThemePalette` and the root `dark` class), without writing their preference: leaving the
 * page puts their own appearance back.
 */
export function useKitAppearance(appearance: ThemeAppearance | null): void {
  const { theme, themeHalves, refreshTheme } = useTheme();
  useLayoutEffect(() => {
    if (appearance === null) return;
    applyThemePalette(resolveThemeHalf(theme, themeHalves, appearance), appearance);
    document.documentElement.classList.toggle("dark", appearance === "dark");
    return refreshTheme;
  }, [appearance, refreshTheme, theme, themeHalves]);
}
