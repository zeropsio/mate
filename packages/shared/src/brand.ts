export type BrandAppearance = "light" | "dark";

export type ServiceStatusTone = Readonly<{
  dot: string;
  text?: string;
  surface: string;
}>;

// Exact 14% #56d364 over the #141918 dark surface.
const DARK_MINT_SURFACE = "#1d3323";

export const PROVIDER_ACCENT_SWATCHES = [
  "#0077cc",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

export const FALLBACK_PROVIDER_ACCENT = "#5f6a72";

export const SEMANTIC_INDICATORS = {
  success: { light: "#00cc55", dark: "#56d364" },
  successForeground: { light: "#0f7a38", dark: "#56d364" },
  info: { light: "#0077cc", dark: "#58a6ff" },
  infoForeground: { light: "var(--color-blue-700)", dark: "var(--color-blue-400)" },
} as const;

/**
 * Service and agent-auth presentations consume these fixed platform tones.
 * Thread-status tone ids are mapped by the later primitives slice, not here.
 */
export const SERVICE_STATUS_TONES = {
  ok: {
    light: { dot: "#66bb6a", text: "#2e7d32", surface: "#e8f7ec" },
    dark: { dot: "#56d364", text: "#56d364", surface: DARK_MINT_SURFACE },
  },
  busy: {
    light: { dot: "#42a5f5", surface: "#eff9fd" },
    dark: { dot: "#58a6ff", text: "#58a6ff", surface: "#1e2e3b" },
  },
  attention: {
    light: { dot: "#ffa726", text: "#a26000", surface: "#fff4e0" },
    dark: { dot: "#e8a33d", text: "#ffb74d", surface: "#453f36" },
  },
  failed: {
    light: { dot: "#ef5350", surface: "#fdefef" },
    dark: { dot: "#f47067", text: "#f47067", surface: "#312828" },
  },
  off: {
    light: { dot: "#bdbdbd", surface: "#f3f5f7" },
    dark: { dot: "#5e6e69", surface: "#151b1a" },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<BrandAppearance, ServiceStatusTone>>>>;

export type ServiceStatusToneId = keyof typeof SERVICE_STATUS_TONES;

export const IDENTITY = {
  mark: { main: "#3cbdb2", secondary: "#00b1a3" },
  mint: { light: "#00b1a3", dark: "#00e5c0" },
  pillTint: { light: "rgba(0,204,187,.13)", dark: "rgba(0,229,192,.13)" },
} as const;

export const CHIP_TINTS = {
  "access-green": {
    light: { surface: "rgba(76,175,80,.15)", text: "#388e3c" },
    dark: { surface: "rgba(76,175,80,.1)", text: "#56d364" },
  },
  "region-purple": {
    light: { surface: "rgba(156,39,176,.15)", text: "#7b1fa2" },
    dark: { surface: "rgba(156,39,176,.15)", text: "#ba68c8" },
  },
  "info-chip": {
    light: { surface: "rgba(255,255,255,.9)", text: "#424242" },
    dark: { surface: "#151b1a", text: "#c9d4d1" },
  },
} as const;

/** The unverified #bcfffa SCSS token is not carried into the client palette. */
export const MINT_PANEL = {
  light: "#e8f7ec",
  dark: DARK_MINT_SURFACE,
} as const;

export const FLAT_CARD_BORDER = {
  light: "transparent",
  dark: "rgba(255,255,255,.06)",
} as const;

export const PROCESS_STEPS = {
  glyphColumn: 30,
  glyphSize: 17,
  glyphBorderWidth: 2,
} as const;

export const ZEROPS_MARK = {
  viewBox: "0 0 42.27 50.48",
  paths: [
    {
      d: "M20.19.7L3 7.27A4 4 0 0 0 .46 11v16.54L8.36 23v-9.3L21.6 8.62V.44a4 4 0 0 0-1.41.26z",
      fill: IDENTITY.mark.main,
    },
    {
      d: "M8.5 37.74l13.1-7.55v-9.12L1.36 32.74a1.82 1.82 0 0 0-.9 1.56v6.11A4 4 0 0 0 3 44.1l17.19 6.57a4 4 0 0 0 1.41.26v-8.18z",
      fill: IDENTITY.mark.main,
    },
    {
      d: "M41.9 18.47a1.67 1.67 0 0 0 .84-1.47v-6a4 4 0 0 0-2.54-3.73L23 .7a4 4 0 0 0-1.4-.26v8.18l13 5-13 7.49v9.12z",
      fill: IDENTITY.mark.secondary,
    },
    {
      d: "M23 50.67l17.2-6.57a4 4 0 0 0 2.54-3.69V23.7l-7.9 4.56v9.43L21.6 42.75v8.18a4 4 0 0 0 1.4-.26z",
      fill: IDENTITY.mark.secondary,
    },
  ],
} as const;

/** Cross-platform intent names; each client resolves these through its native icon library. */
export const ICON_MAP = {
  project: "Folder",
  cloudIde: "Cloud",
  serviceMap: "LayoutGrid",
  webTerminal: "Terminal",
  sshTerminal: "SquareTerminal",
  desktopIde: "Monitor",
  externalLink: "ExternalLink",
  refresh: "RotateCcw",
  settings: "Settings",
  database: "Database",
  logs: "ScrollText",
  add: "Plus",
  deploy: "Rocket",
  authorized: "CircleCheck",
  warning: "TriangleAlert",
  queued: "Clock",
  running: "Play",
  done: "Check",
  failed: "CircleAlert",
} as const satisfies Record<string, string>;

export const RADII = {
  card: 10,
  control: 8,
  dialog: 16,
  chip: 10,
  infoChip: 8,
  keyChip: 3,
  composer: 22,
  pill: 80,
} as const;

export const TYPE_SCALE = {
  body: { fontSize: 14, fontWeight: 400 },
  rowHostname: { fontSize: 14, fontWeight: 500, portOpacity: 0.6 },
  cardTitle: { fontSize: 14, fontWeight: 500 },
  projectName: { fontSize: 20, fontWeight: 500 },
  description: { fontSize: 13, fontWeight: 400, lineHeight: 1.6, opacity: 0.7 },
  microLabel: { fontSize: 10, fontWeight: 600, letterSpacingEm: 0.06, opacity: 0.45 },
  draftHero: { fontSize: 32, fontWeight: 400 },
} as const;
