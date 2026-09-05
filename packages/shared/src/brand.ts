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

/** Mate identity v1: the Zerops loop with its band retracted. Shared with the favicon. */
export const MATE_MARK = {
  viewBox: "0 0 44 52",
  color: "#45a29a",
  eyes: { light: "#17130f", dark: "#f4efe6" },
  paths: [
    "M0.46,27.54 V11 A4,4 0 0 1 3,7.27 L20.19,0.7 A4,4 0 0 1 23,0.7 L40.2,7.27 A4,4 0 0 1 42.74,11 V17.99 L34.84,22.54 V13.71 L21.6,8.62 L8.36,13.7 V23 Z",
    "M42.74,23.7 V40.41 A4,4 0 0 1 40.2,44.1 L23,50.67 A4,4 0 0 1 20.19,50.67 L3,44.1 A4,4 0 0 1 0.46,40.41 V33.26 L8.5,28.62 V37.74 L21.6,42.75 L34.84,37.69 V28.26 Z",
  ],
  silhouette:
    "M0.46,11 A4,4 0 0 1 3,7.27 L20.19,0.7 A4,4 0 0 1 23,0.7 L40.2,7.27 A4,4 0 0 1 42.74,11 V40.41 A4,4 0 0 1 40.2,44.1 L23,50.67 A4,4 0 0 1 20.19,50.67 L3,44.1 A4,4 0 0 1 0.46,40.41 Z",
  eyeXs: [12.332, 25.572],
  eyeY: 19.06,
  eyeWidth: 5.296,
  eyeHeight: 10.592,
} as const;

/**
 * The live mark's grid — identity v1's own derivation, in the logo's units.
 *
 * Every number below is measured from the logo rather than chosen: the stroke
 * `S` is the wall thickness, the window `XL..XR` is five columns wide
 * (¾ margin · eye · 1½ gap · eye · ¾ margin), and the eye unit `U` is one of
 * those columns. `MATE_MARK`'s flat eye rectangles fall out of the same
 * arithmetic, which `brand.test.ts` pins — so the still favicon and the live
 * mark can never drift apart.
 *
 * Held in logo units, not identity v1's 100-box: the mark already renders in
 * a `0 0 44 52` viewBox here, and rescaling would have moved the favicon.
 */
const MARK_STROKE = 7.9;
const WINDOW = { xl: 8.36, xr: 34.84, yb: 42.75 } as const;
/** The mark's centre in path space (`logo.svg` carries a translate(-.46,-.44)). */
const MARK_CENTRE = { x: 21.59, y: 25.68 } as const;
const EYE_UNIT = (WINDOW.xr - WINDOW.xl) / 5;
const EYE_CENTRE_Y = MARK_CENTRE.y - 0.25 * EYE_UNIT;

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
/** Where the left slot's lower edge meets the inner wall: the band's upper edge. */
const BAND_ANCHOR = { x: 8.5, y: 28.62 } as const;
/** Axis distance from the anchor to the centre cut. */
const BAND_CENTRE = (MARK_CENTRE.x - BAND_ANCHOR.x) / COS30;

/** A point `t` along the band's axis and `k` across it. */
function bandPoint(t: number, k: number): readonly [number, number] {
  return [BAND_ANCHOR.x + t * COS30 + k * SIN30, BAND_ANCHOR.y - t * SIN30 + k * COS30];
}

function bandQuad(t0: number, t1: number): string {
  const points = [
    bandPoint(t0, 0),
    bandPoint(t1, 0),
    bandPoint(t1, MARK_STROKE),
    bandPoint(t0, MARK_STROKE),
  ];
  return `M${points.map(([x, y]) => `${round(x)},${round(y)}`).join(" L")} Z`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * How far each lid travels, as `[openness, width, lift in eye units]`.
 * `sleep`/`blink`/`closed` shut the eye; `needs`/`surprise` widen and lift it.
 */
export const MATE_MARK_LIDS = {
  idle: [1, 1, 0],
  working: [0.5, 1, 0.2],
  needs: [1.12, 1.12, -0.13],
  surprise: [1.12, 1.12, -0.13],
  done: [1, 1, 0],
  blink: [0, 1, 0],
  sleep: [0, 1, 0],
  closed: [0, 1, 0],
} as const;

export type MateMarkState = keyof typeof MATE_MARK_LIDS;

export const MATE_MARK_LIVE = {
  /** The extruded side wall is one stroke deep; the turn is capped at 5°. */
  depth: MARK_STROKE,
  tilt: 5,
  /** Side-wall fill, so the extrusion reads as a turn rather than a shadow. */
  side: { light: "#2d716b", dark: "#8ad4cb" },
  eyeUnit: EYE_UNIT,
  /** Eye centres, unlike `MATE_MARK.eyeXs` which are the rectangles' left edges. */
  eyeCentres: [WINDOW.xl + 1.25 * EYE_UNIT, WINDOW.xr - 1.25 * EYE_UNIT] as const,
  eyeCentreY: EYE_CENTRE_Y,
  /** The mouth sits 60% of the way from the eye line to the window floor. */
  mouth: {
    y: EYE_CENTRE_Y + 0.6 * (WINDOW.yb - EYE_CENTRE_Y),
    r: 0.42 * EYE_UNIT,
    strokeWidth: 0.28 * EYE_UNIT,
  },
  /**
   * The band the Zerops mark has pulled out, drawn back in as the one moving
   * part: at rest it sits in place and the mark IS the Zerops logo; awake it
   * retracts into the walls along its own 30° and the eyes open behind it.
   * The halves overlap by 1.2 at rest so the seam never shows.
   */
  band: {
    left: bandQuad(-16, BAND_CENTRE + 0.6),
    right: bandQuad(BAND_CENTRE - 0.6, 46),
    travel: 20,
    cos30: COS30,
    sin30: SIN30,
  },
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
