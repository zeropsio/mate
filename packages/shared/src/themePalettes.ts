export const BUILT_IN_THEME_IDS = ["zerops"] as const;

export const MOBILE_DEFAULT_THEME_ID = "zerops";

/**
 * Every palette the mobile app can render. Declared here so host-side tooling
 * (the app-store screenshot harness) can validate a requested theme without
 * importing React Native application code.
 */
export const MOBILE_THEME_IDS = BUILT_IN_THEME_IDS;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export type MobileThemeId = (typeof MOBILE_THEME_IDS)[number];
export type ThemeAppearance = "light" | "dark";

/** Product roles shared by web CSS, React Native tokens, and native surfaces. */
export const THEME_COLOR_ROLES = [
  "canvas",
  "chrome",
  "toolbar",
  "toolbarForeground",
  "toolbarBorder",
  "toolbarControl",
  "toolbarControlForeground",
  "toolbarControlHover",
  "surface",
  "surfaceRaised",
  "surfaceOverlay",
  "text",
  "textMuted",
  "border",
  "input",
  "focus",
  "accent",
  "accentForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "placeholder",
  "secondaryLabel",
  "iconMuted",
  "error",
  "errorForeground",
  "errorSurface",
  "warning",
  "warningForeground",
  "warningSurface",
  "update",
  "updateForeground",
  "updateSurface",
  "accentSurface",
  "accentSurfaceForeground",
  "messageSurface",
  "messageForeground",
  "messageAction",
  "messageActionForeground",
  "messageActionHover",
  "codeBackground",
  "codeForeground",
  "sidebar",
  "sidebarForeground",
  "sidebarMutedForeground",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelection",
  "terminalScrollbar",
  "terminalScrollbarHover",
] as const;

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];

/**
 * The web stylesheet's custom properties each role paints, projected into `apps/web/src/styles/tokens.css`
 * by `scripts/generate-theme-tokens.ts`; a role with none is painted only by the native clients
 * and the boot frame.
 */
export const WEB_THEME_ROLE_TOKENS: Readonly<Record<ThemeColorRole, ReadonlyArray<string>>> = {
  canvas: ["--background"],
  chrome: ["--app-chrome-background"],
  toolbar: ["--toolbar-background"],
  toolbarForeground: ["--toolbar-foreground"],
  toolbarBorder: ["--toolbar-border"],
  toolbarControl: ["--toolbar-control"],
  toolbarControlForeground: ["--toolbar-control-foreground"],
  toolbarControlHover: ["--toolbar-control-hover"],
  surface: ["--card"],
  surfaceRaised: ["--surface-raised"],
  surfaceOverlay: ["--popover"],
  text: ["--foreground", "--card-foreground", "--popover-foreground"],
  textMuted: [],
  border: ["--border"],
  input: ["--input"],
  focus: ["--ring"],
  accent: [],
  accentForeground: [],
  secondary: ["--secondary"],
  secondaryForeground: ["--secondary-foreground"],
  muted: ["--muted"],
  mutedForeground: ["--muted-foreground"],
  placeholder: ["--placeholder"],
  secondaryLabel: ["--secondary-label"],
  iconMuted: ["--icon-muted"],
  error: ["--error"],
  errorForeground: ["--error-foreground"],
  errorSurface: ["--error-surface"],
  warning: ["--warning"],
  warningForeground: ["--warning-foreground"],
  warningSurface: ["--warning-surface"],
  update: ["--update"],
  updateForeground: ["--update-foreground"],
  updateSurface: ["--update-surface"],
  accentSurface: ["--accent"],
  accentSurfaceForeground: ["--accent-foreground"],
  messageSurface: ["--message-surface"],
  messageForeground: ["--message-foreground"],
  // Solid controls (CTAs, switches, the send button) share the message action's colour, so every
  // "act now" affordance reads the same; the accent surface drives selection and hover.
  messageAction: ["--primary", "--message-action"],
  messageActionForeground: ["--primary-foreground", "--message-action-foreground"],
  messageActionHover: ["--message-action-hover"],
  codeBackground: ["--code-background"],
  codeForeground: ["--code-foreground"],
  sidebar: ["--sidebar"],
  sidebarForeground: ["--sidebar-foreground"],
  sidebarMutedForeground: ["--sidebar-muted-foreground"],
  sidebarControlSurface: ["--sidebar-control-surface"],
  sidebarRowHover: ["--sidebar-row-hover"],
  sidebarRowActive: ["--sidebar-row-active"],
  sidebarRowSelected: ["--sidebar-row-selected"],
  sidebarBorder: ["--sidebar-border"],
  terminalBackground: ["--terminal-background"],
  terminalForeground: ["--terminal-foreground"],
  terminalCursor: ["--terminal-cursor"],
  terminalSelection: ["--terminal-selection-background"],
  terminalScrollbar: [],
  terminalScrollbarHover: [],
};
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>;
export type ThemeVariants = Readonly<Partial<Record<ThemeAppearance, ThemeColors>>>;
export type ThemeDefinition = Readonly<{
  id: string;
  label: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  variants?: ThemeVariants;
}>;

export const ZEROPS_THEME: ThemeDefinition = {
  id: "zerops",
  label: "Zerops",
  appearance: "light",
  colors: {
    canvas: "oklch(0.985 0.002 255)", // The page: near-white beside the menu's grey (the round-5 board).
    chrome: "oklch(0.985 0.002 255)",
    toolbar: "oklch(0.985 0.002 255)",
    toolbarForeground: "oklch(0.217787 0 0)",
    toolbarBorder: "oklch(0.898587 0.0192 248.042)",
    toolbarControl: "oklch(0.95504 0.001935 255)", // 4% black over the canvas.
    toolbarControlForeground: "oklch(0.217787 0 0)",
    toolbarControlHover: "oklch(0.924843 0.001869 255)", // 8% black over the canvas.
    surface: "oklch(1 0 0)",
    surfaceRaised: "oklch(1 0 0)",
    surfaceOverlay: "oklch(1 0 0)",
    text: "oklch(0.217787 0 0)",
    textMuted: "oklch(0.517771 0.01847 239.388)",
    border: "oklch(0.906701 0 0)",
    input: "oklch(0.898587 0.0192 248.042)",
    focus: "oklch(0.560114 0.15773 249.804)",
    accent: "oklch(0.560114 0.15773 249.804)",
    accentForeground: "oklch(1 0 0)",
    secondary: "oklch(0.969196 0.003426 247.858)",
    secondaryForeground: "oklch(0.217787 0 0)",
    muted: "oklch(0.968441 0.004181 236.497)",
    mutedForeground: "oklch(0.517771 0.01847 239.388)",
    placeholder: "oklch(0.492609 0 0)",
    secondaryLabel: "oklch(0.501005 0.017755 242.041)",
    iconMuted: "oklch(0.517771 0.01847 239.388)",
    error: "oklch(0.531406 0.216928 27.574)",
    errorForeground: "oklch(0.531406 0.216928 27.574)",
    errorSurface: "oklch(0.963138 0.01516 17.42)",
    warning: "oklch(0.797179 0.163777 69.616)",
    warningForeground: "oklch(0.557046 0.158291 45.359)",
    warningSurface: "oklch(0.976643 0.011959 67.686)",
    update: "oklch(0.683777 0.1203 184.922)",
    updateForeground: "oklch(0.474135 0.084101 183.733)",
    updateSurface: "oklch(0.959725 0.027239 191.09)", // 12.9% #00ccbb over #ffffff surface.
    accentSurface: "oklch(0.962441 0.004188 236.498)",
    accentSurfaceForeground: "oklch(0.217787 0 0)",
    messageSurface: "oklch(0.950987 0.006266 255.476)", // Neutral, one step darker than the canvas.
    messageForeground: "oklch(0.217787 0 0)",
    messageAction: "oklch(0.560114 0.15773 249.804)",
    messageActionForeground: "oklch(1 0 0)",
    messageActionHover: "oklch(0.476566 0.132387 249.275)",
    codeBackground: "oklch(0.968441 0.004181 236.497)",
    codeForeground: "oklch(0.217787 0 0)",
    sidebar: "oklch(0.962 0.004 255)", // The menu: its own grey, set off from the page.
    sidebarForeground: "oklch(0.217787 0 0)",
    sidebarMutedForeground: "oklch(0.362632 0.014881 240.327)",
    sidebarControlSurface: "oklch(0.932789 0.00387 255)", // 4% black over the sidebar.
    sidebarRowHover: "oklch(0.932789 0.00387 255)", // 4% black over the sidebar.
    // The open row is the page's own white, set into the grey: never the hover's grey a shade on.
    sidebarRowActive: "oklch(1 0 0)",
    sidebarRowSelected: "oklch(1 0 0)",
    sidebarBorder: "oklch(0.906701 0 0)",
    terminalBackground: "oklch(0.968441 0.004181 236.497)",
    terminalForeground: "oklch(0.217787 0 0)",
    terminalCursor: "oklch(0.532656 0.094683 183.341)",
    terminalSelection: "oklch(0.906438 0.034574 238.693)", // 20% #0077cc over #ffffff surface.
    terminalScrollbar: "oklch(0.880308 0.007019 247.905)",
    terminalScrollbarHover: "oklch(0.799069 0.008989 247.939)",
  },
  variants: {
    dark: {
      canvas: "oklch(0.164609 0.005276 173.621)",
      chrome: "oklch(0.164609 0.005276 173.621)",
      toolbar: "oklch(0.164609 0.005276 173.621)",
      toolbarForeground: "oklch(0.944756 0.005952 170.443)",
      toolbarBorder: "oklch(0.29592 0.012924 180.424)",
      toolbarControl: "oklch(0.244218 0.010816 176.214)",
      toolbarControlForeground: "oklch(0.944756 0.005952 170.443)",
      toolbarControlHover: "oklch(0.311898 0.012787 180.507)",
      surface: "oklch(0.207783 0.007827 182.122)",
      surfaceRaised: "oklch(0.244218 0.010816 176.214)",
      surfaceOverlay: "oklch(0.26005 0.011968 178.488)",
      text: "oklch(0.944756 0.005952 170.443)",
      textMuted: "oklch(0.737586 0.018219 173.85)",
      border: "oklch(0.29592 0.012924 180.424)",
      input: "oklch(0.311898 0.012787 180.507)",
      focus: "oklch(0.744234 0.139646 246.851)",
      accent: "oklch(0.715252 0.15181 253.306)",
      accentForeground: "oklch(0.164609 0.005276 173.621)",
      secondary: "oklch(0.280612 0.011784 178.616)",
      secondaryForeground: "oklch(0.944756 0.005952 170.443)",
      muted: "oklch(0.21557 0.009169 184.301)",
      mutedForeground: "oklch(0.737586 0.018219 173.85)",
      placeholder: "oklch(0.523335 0.020759 174.667)",
      secondaryLabel: "oklch(0.626728 0.018381 177.916)",
      iconMuted: "oklch(0.737586 0.018219 173.85)",
      // Dark enough that an action's white ink reads on the destructive fill (4.5:1).
      error: "oklch(0.56 0.141955 21.457)",
      errorForeground: "oklch(0.687547 0.141955 21.457)",
      errorSurface: "oklch(0.286951 0.013453 17.963)",
      warning: "oklch(0.797179 0.163777 69.616)",
      warningForeground: "oklch(0.828671 0.14524 73.542)",
      warningSurface: "oklch(0.37084 0.017057 78.071)",
      update: "oklch(0.823225 0.154794 175.318)",
      updateForeground: "oklch(0.865024 0.133145 178.864)",
      updateSurface: "oklch(0.304264 0.043442 180.881)", // 14% #00e5c0 over #141918 surface.
      accentSurface: "oklch(0.280612 0.011784 178.616)",
      accentSurfaceForeground: "oklch(0.944756 0.005952 170.443)",
      messageSurface: "oklch(0.26 0.009 178)", // Neutral, one step lighter than the canvas.
      messageForeground: "oklch(0.944756 0.005952 170.443)",
      messageAction: "oklch(0.560114 0.15773 249.804)",
      messageActionForeground: "oklch(1 0 0)",
      messageActionHover: "oklch(0.64065 0.1821 250.158)", // R5 hand value, not an alpha composite.
      codeBackground: "oklch(0.198946 0.007897 182.062)",
      codeForeground: "oklch(0.911927 0.009473 171.779)",
      sidebar: "oklch(0.207783 0.007827 182.122)", // The menu: one step lighter than the page.
      sidebarForeground: "oklch(0.944756 0.005952 170.443)",
      sidebarMutedForeground: "oklch(0.737586 0.018219 173.85)",
      sidebarControlSurface: "oklch(0.244218 0.010816 176.214)",
      sidebarRowHover: "oklch(0.244218 0.010816 176.214)",
      sidebarRowActive: "oklch(0.26005 0.011968 178.488)",
      sidebarRowSelected: "oklch(0.280612 0.011784 178.616)",
      sidebarBorder: "oklch(0.29592 0.012924 180.424)",
      terminalBackground: "oklch(0.164609 0.005276 173.621)",
      terminalForeground: "oklch(0.944756 0.005952 170.443)",
      terminalCursor: "oklch(0.823225 0.154794 175.318)",
      terminalSelection: "oklch(0.336701 0.052155 249.615)", // 28% #58a6ff over #0c0f0e terminal.
      terminalScrollbar: "oklch(0.311898 0.012787 180.507)",
      terminalScrollbarHover: "oklch(0.376903 0.01351 182.176)",
    },
  },
};

export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [ZEROPS_THEME];

export function getBuiltInTheme(id: string): ThemeDefinition | null {
  return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? null;
}

export function getThemeColorsForAppearance(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  if (theme.appearance === appearance) return theme.colors;
  return theme.variants?.[appearance] ?? null;
}
