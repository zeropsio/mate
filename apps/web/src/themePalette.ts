import {
  ZEROPS_THEME,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
} from "@t3tools/shared/themePalettes";

export type { ThemeAppearance };

export const ZEROPS_THEME_ID = "zerops" as const;
export const THEME_APPEARANCE_MODE_STORAGE_KEY = "t3code:theme-appearance-mode";

export type ThemePreferenceMode = ThemeAppearance | "system";

export const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
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

/** Paints one appearance of the Zerops palette onto the document's theme variables. */
export function applyThemePalette(
  theme: typeof ZEROPS_THEME_ID,
  appearance: ThemeAppearance,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root?.style) return;

  root.dataset.themeId = theme;
  const colors: ThemeColors =
    appearance === ZEROPS_THEME.appearance
      ? ZEROPS_THEME.colors
      : (ZEROPS_THEME.variants?.[appearance] ?? ZEROPS_THEME.colors);
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
}
