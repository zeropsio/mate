import { describe, expect, it } from "vite-plus/test";

import { ZEROPS_THEME } from "./themePalettes.ts";
import {
  createMobileThemeVariables,
  MOBILE_THEME_VARIABLE_NAMES,
  themeColorToNativeColor,
} from "./mobileThemeVariables.ts";

const EXPECTED_MOBILE_THEME_VARIABLE_NAMES = [
  "--color-screen",
  "--color-sheet",
  "--color-sheet-solid",
  "--color-card",
  "--color-card-alt",
  "--color-card-translucent",
  "--color-foreground",
  "--color-foreground-secondary",
  "--color-foreground-muted",
  "--color-foreground-tertiary",
  "--color-border",
  "--color-border-subtle",
  "--color-separator",
  "--color-subtle",
  "--color-subtle-strong",
  "--color-inline-skill-background",
  "--color-inline-skill-border",
  "--color-inline-skill-foreground",
  "--color-primary",
  "--color-primary-foreground",
  "--color-primary-shadow",
  "--color-secondary",
  "--color-secondary-foreground",
  "--color-secondary-border",
  "--color-switch-active-track",
  "--color-switch-active-thumb",
  "--color-switch-inactive-track",
  "--color-switch-inactive-thumb",
  "--color-danger",
  "--color-danger-border",
  "--color-danger-foreground",
  "--color-input",
  "--color-input-border",
  "--color-sidebar-search",
  "--color-placeholder",
  "--color-icon",
  "--color-icon-muted",
  "--color-icon-subtle",
  "--color-header",
  "--color-header-border",
  "--color-glass-surface",
  "--color-glass-tint",
  "--color-status-bar",
  "--color-md-body",
  "--color-md-strong",
  "--color-md-link",
  "--color-md-blockquote-border",
  "--color-md-blockquote-bg",
  "--color-md-code-bg",
  "--color-md-code-text",
  "--color-md-user-code-bg",
  "--color-md-user-code-text",
  "--color-md-user-fence-bg",
  "--color-md-user-fence-text",
  "--color-md-hr",
  "--color-user-bubble",
  "--color-user-bubble-foreground",
  "--color-user-bubble-foreground-muted",
  "--color-user-bubble-skill-foreground",
  "--color-backdrop",
  "--color-drawer",
  "--color-drawer-shadow",
  "--color-dot-separator",
  "--color-wordmark",
  "--color-chevron",
] as const;

describe("mobile theme variables", () => {
  it("keeps the 65-variable projection in its fixed order", () => {
    expect(MOBILE_THEME_VARIABLE_NAMES).toEqual(EXPECTED_MOBILE_THEME_VARIABLE_NAMES);
    expect(Object.keys(createMobileThemeVariables(ZEROPS_THEME.colors, "light"))).toEqual(
      EXPECTED_MOBILE_THEME_VARIABLE_NAMES,
    );
  });

  it("converts canonical OKLCH colors to native sRGB values", () => {
    expect(themeColorToNativeColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(themeColorToNativeColor("oklch(0 0 0)")).toBe("#000000");
    expect(themeColorToNativeColor("#123456")).toBe("#123456");
  });

  it("projects Zerops roles and appearance-specific fixed values", () => {
    const light = createMobileThemeVariables(ZEROPS_THEME.colors, "light");
    const dark = createMobileThemeVariables(ZEROPS_THEME.variants!.dark!, "dark");

    expect(light["--color-screen"]).toBe(themeColorToNativeColor(ZEROPS_THEME.colors.canvas));
    expect(light["--color-sheet-solid"]).toBe(themeColorToNativeColor(ZEROPS_THEME.colors.chrome));
    expect(light["--color-primary"]).toBe(themeColorToNativeColor(ZEROPS_THEME.colors.accent));
    expect(light["--color-user-bubble-foreground"]).toMatch(/^#/);
    expect(light["--color-primary-shadow"]).toBe("#000000");
    expect(light["--color-backdrop"]).toBe("rgba(0, 0, 0, 0.22)");
    expect(light["--color-drawer-shadow"]).toBe("rgba(0, 0, 0, 0.12)");
    expect(dark["--color-backdrop"]).toBe("rgba(0, 0, 0, 0.48)");
    expect(dark["--color-drawer-shadow"]).toBe("rgba(0, 0, 0, 0.32)");
  });
});
