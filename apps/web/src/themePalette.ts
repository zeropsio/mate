import * as Schema from "effect/Schema";
import {
  BUILT_IN_THEMES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "@t3tools/shared/themePalettes";

export type { ThemeAppearance };

const T3_CHAT_THEME_ID = "t3-chat" as const;
const GROVE_THEME_ID = "grove" as const;
const OCEAN_THEME_ID = "ocean" as const;
const EMBER_THEME_ID = "ember" as const;
const IRIS_THEME_ID = "iris" as const;
export const ZEROPS_THEME_ID = "zerops" as const;
export const THEME_FOLLOW_SYSTEM_STORAGE_KEY = "t3code:theme-follow-system";
export const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";

const LEGACY_T3_CHAT_DARK_THEME_ID = "t3-chat-dark";

export const ThemePreference = Schema.String;
export type ThemePreference = typeof ThemePreference.Type;
export type ThemePreferenceMode = ThemeAppearance | "system";

// Earlier builds shipped every maintainer theme under a t3- prefix; only the
// genuinely T3-branded palette keeps it. Stored preferences with the old ids
// stay readable through this alias table.
const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  [LEGACY_T3_CHAT_DARK_THEME_ID]: T3_CHAT_THEME_ID,
  "t3-grove": GROVE_THEME_ID,
  "t3-ocean": OCEAN_THEME_ID,
  "t3-ember": EMBER_THEME_ID,
  "t3-iris": IRIS_THEME_ID,
};

function normalizeThemeId(themeId: string): string {
  return LEGACY_THEME_ID_ALIASES[themeId] ?? themeId;
}

/**
 * Map a stored preference onto the id the runtime applies. The legacy
 * dark-variant id stays as-is because it still carries the appearance hint
 * getThemePreferenceMode reads.
 */
export function canonicalThemePreference(theme: string): string {
  return theme === LEGACY_T3_CHAT_DARK_THEME_ID ? theme : normalizeThemeId(theme);
}

// Older builds stored the dark T3 Chat palette as a separate theme. Keep
// those preferences readable while mapping them to the dark variant.
function legacyThemeMode(theme: ThemePreference): ThemeAppearance | null {
  return theme === LEGACY_T3_CHAT_DARK_THEME_ID ? "dark" : null;
}

function getThemeDefinition(theme: ThemePreference): ThemeDefinition | null {
  const themeId = normalizeThemeId(theme);
  return BUILT_IN_THEMES.find((definition) => definition.id === themeId) ?? null;
}

function getThemeColorsForMode(theme: ThemeDefinition, mode: ThemeAppearance): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors;
  return theme.variants?.[mode] ?? null;
}

export function getThemePreferenceMode(theme: ThemePreference): ThemeAppearance | null {
  if (theme === "system") return null;
  if (theme === "light" || theme === "dark") return theme;
  const legacyMode = legacyThemeMode(theme);
  if (legacyMode) return legacyMode;
  return getThemeDefinition(theme)?.appearance ?? null;
}

const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: "--app-theme-canvas",
  chrome: "--app-theme-chrome",
  toolbar: "--app-theme-toolbar",
  toolbarForeground: "--app-theme-toolbar-foreground",
  toolbarBorder: "--app-theme-toolbar-border",
  toolbarControl: "--app-theme-toolbar-control",
  toolbarControlForeground: "--app-theme-toolbar-control-foreground",
  toolbarControlHover: "--app-theme-toolbar-control-hover",
  surface: "--app-theme-surface",
  surfaceRaised: "--app-theme-surface-raised",
  surfaceOverlay: "--app-theme-surface-overlay",
  text: "--app-theme-text",
  textMuted: "--app-theme-text-muted",
  border: "--app-theme-border",
  input: "--app-theme-input",
  focus: "--app-theme-focus",
  accent: "--app-theme-accent",
  accentForeground: "--app-theme-accent-foreground",
  secondary: "--app-theme-secondary",
  secondaryForeground: "--app-theme-secondary-foreground",
  muted: "--app-theme-muted",
  mutedForeground: "--app-theme-muted-foreground",
  placeholder: "--app-theme-placeholder",
  secondaryLabel: "--app-theme-secondary-label",
  iconMuted: "--app-theme-icon-muted",
  error: "--app-theme-error",
  errorForeground: "--app-theme-error-foreground",
  errorSurface: "--app-theme-error-surface",
  warning: "--app-theme-warning",
  warningForeground: "--app-theme-warning-foreground",
  warningSurface: "--app-theme-warning-surface",
  update: "--app-theme-update",
  updateForeground: "--app-theme-update-foreground",
  updateSurface: "--app-theme-update-surface",
  accentSurface: "--app-theme-accent-surface",
  accentSurfaceForeground: "--app-theme-accent-surface-foreground",
  messageSurface: "--app-theme-message-surface",
  messageForeground: "--app-theme-message-foreground",
  messageAction: "--app-theme-message-action",
  messageActionForeground: "--app-theme-message-action-foreground",
  messageActionHover: "--app-theme-message-action-hover",
  codeBackground: "--app-theme-code-background",
  codeForeground: "--app-theme-code-foreground",
  sidebar: "--app-theme-sidebar",
  sidebarForeground: "--app-theme-sidebar-foreground",
  sidebarMutedForeground: "--app-theme-sidebar-muted-foreground",
  sidebarControlSurface: "--app-theme-sidebar-control-surface",
  sidebarRowHover: "--app-theme-sidebar-row-hover",
  sidebarRowActive: "--app-theme-sidebar-row-active",
  sidebarRowSelected: "--app-theme-sidebar-row-selected",
  sidebarBorder: "--app-theme-sidebar-border",
  terminalBackground: "--app-theme-terminal-background",
  terminalForeground: "--app-theme-terminal-foreground",
  terminalCursor: "--app-theme-terminal-cursor",
  terminalSelection: "--app-theme-terminal-selection-background",
  terminalScrollbar: "--app-theme-terminal-scrollbar",
  terminalScrollbarHover: "--app-theme-terminal-scrollbar-hover",
};

export function applyThemePalette(theme: ThemePreference, appearance?: ThemeAppearance): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root?.style) return;

  const palette = getThemeDefinition(theme);

  if (palette) {
    root.dataset.themeId = palette.id;
    const mode = appearance ?? legacyThemeMode(theme) ?? palette.appearance;
    const colors = getThemeColorsForMode(palette, mode) ?? palette.colors;
    for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
      root.style.setProperty(APP_THEME_VARIABLES[role], value);
    }
    return;
  }

  delete root.dataset.themeId;
  for (const variable of Object.values(APP_THEME_VARIABLES)) {
    root.style.removeProperty(variable);
  }
}

export function resolveThemeAppearance(
  theme: ThemePreference,
  systemDark: boolean,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): "light" | "dark" {
  const systemAppearance = systemDark ? "dark" : "light";
  const mode = appearanceMode ?? ((followSystem ?? theme === "system") ? "system" : null);
  if (mode === "system" || mode === "light" || mode === "dark") {
    const wanted = mode === "system" ? systemAppearance : mode;
    const definition = getThemeDefinition(theme);
    return definition && getThemeColorsForMode(definition, wanted) === null
      ? definition.appearance
      : wanted;
  }
  return getThemePreferenceMode(theme) ?? "light";
}

export function resolveDesktopTheme(
  theme: ThemePreference,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
): "light" | "dark" | "system" {
  const mode = appearanceMode ?? ((followSystem ?? theme === "system") ? "system" : null);
  if (mode === "system") {
    const definition = getThemeDefinition(theme);
    const hasLightMode = definition !== null && getThemeColorsForMode(definition, "light") !== null;
    const hasDarkMode = definition !== null && getThemeColorsForMode(definition, "dark") !== null;
    return definition && (!hasLightMode || !hasDarkMode) ? definition.appearance : "system";
  }
  if (mode === "light" || mode === "dark") {
    const definition = getThemeDefinition(theme);
    return definition && getThemeColorsForMode(definition, mode) === null
      ? definition.appearance
      : mode;
  }
  return getThemePreferenceMode(theme) ?? "system";
}

export function isKnownThemePreference(theme: string): boolean {
  if (theme === "light" || theme === "dark" || theme === "system") return true;
  return getThemeDefinition(theme) !== null;
}
