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

/** The window's top edge — the inner apex the slots are cut from. */
const WINDOW_TOP = 8.62;

/**
 * Identity v1 §06 — the wordmark. "mate", Sora SemiBold, lowercase,
 * letter-spacing −0.015 em, shaped once (HarfBuzz, `kern` on) and outlined, so
 * no page ever waits on a webfont to show the logo. Held in the mark's units:
 * the x-height is the window's height, the baseline is the window's floor,
 * and the first stem's ink starts two strokes right of the mark. The `t`
 * rises 1.73 units above the mark's box; the lockup draws it with overflow.
 * Derivation: `scripts/brand/wordmark.py`.
 */
export const MATE_WORDMARK = {
  font: "Sora SemiBold",
  letterSpacingEm: -0.015,
  xHeight: round(WINDOW.yb - WINDOW_TOP),
  baseline: WINDOW.yb,
  gap: 2 * MARK_STROKE,
  ink: { left: 58.54, top: -1.73, right: 215.32, bottom: 43.96 },
  /** One outline per letter, m · a · t · e. */
  paths: [
    "M58.54 42.75V8.04H65.57V22.94H64.93Q64.93 17.7 66.27 14.15Q67.62 10.6 70.27 8.78Q72.92 6.96 76.88 6.96H77.27Q81.29 6.96 83.95 8.78Q86.6 10.6 87.91 14.15Q89.22 17.7 89.22 22.94H86.98Q86.98 17.7 88.36 14.15Q89.73 10.6 92.38 8.78Q95.03 6.96 99 6.96H99.38Q103.41 6.96 106.09 8.78Q108.78 10.6 110.15 14.15Q111.52 17.7 111.52 22.94V42.75H102.64V22.11Q102.64 18.85 100.98 16.9Q99.32 14.95 96.25 14.95Q93.18 14.95 91.33 16.96Q89.47 18.97 89.47 22.36V42.75H80.59V22.11Q80.59 18.85 78.93 16.9Q77.27 14.95 74.2 14.95Q71.13 14.95 69.28 16.96Q67.42 18.97 67.42 22.36V42.75Z",
    "M141.12 42.75V32.46H139.65V21.02Q139.65 18.02 138.18 16.55Q136.71 15.08 133.64 15.08Q132.04 15.08 129.8 15.14Q127.57 15.2 125.3 15.3Q123.03 15.39 121.24 15.52V7.98Q122.71 7.85 124.56 7.73Q126.42 7.6 128.37 7.57Q130.32 7.53 132.04 7.53Q137.41 7.53 140.96 8.94Q144.5 10.35 146.33 13.35Q148.15 16.35 148.15 21.21V42.75ZM129.93 43.64Q126.16 43.64 123.32 42.3Q120.47 40.96 118.91 38.47Q117.34 35.98 117.34 32.46Q117.34 28.63 119.23 26.2Q121.11 23.77 124.53 22.55Q127.95 21.34 132.55 21.34H140.61V26.64H132.42Q129.36 26.64 127.73 28.15Q126.1 29.65 126.1 32.01Q126.1 34.38 127.73 35.85Q129.36 37.32 132.42 37.32Q134.28 37.32 135.84 36.65Q137.41 35.98 138.46 34.35Q139.52 32.72 139.65 29.9L141.82 32.4Q141.5 36.04 140.06 38.53Q138.62 41.02 136.1 42.33Q133.57 43.64 129.93 43.64Z",
    "M171.8 43.2Q167 43.2 163.9 41.95Q160.8 40.7 159.27 37.73Q157.73 34.76 157.73 29.71L157.8 -1.73H166.11L166.04 30.29Q166.04 32.84 167.42 34.22Q168.79 35.59 171.35 35.59H176.78V43.2ZM152.24 14.56V8.04H176.78V14.56Z",
    "M198.64 43.96Q194.17 43.96 190.81 42.43Q187.45 40.9 185.25 38.31Q183.04 35.72 181.93 32.52Q180.81 29.33 180.81 26V24.79Q180.81 21.34 181.93 18.11Q183.04 14.88 185.25 12.36Q187.45 9.83 190.71 8.33Q193.97 6.83 198.26 6.83Q203.88 6.83 207.68 9.29Q211.49 11.75 213.4 15.75Q215.32 19.74 215.32 24.34V27.54H184.58V22.11H209.76L207.01 24.79Q207.01 21.47 206.05 19.1Q205.09 16.74 203.15 15.46Q201.2 14.18 198.26 14.18Q195.32 14.18 193.27 15.52Q191.23 16.86 190.17 19.39Q189.12 21.91 189.12 25.43Q189.12 28.69 190.14 31.21Q191.16 33.74 193.27 35.18Q195.38 36.61 198.64 36.61Q201.9 36.61 203.94 35.3Q205.99 33.99 206.56 32.08H214.75Q213.98 35.66 211.81 38.34Q209.63 41.02 206.28 42.49Q202.92 43.96 198.64 43.96Z",
  ],
} as const;

/**
 * The lockup: the still mark and the wordmark in one box. Its height is the
 * mark's own, so a lockup and a bare mark at the same CSS height draw the mark
 * at the same size; the right margin mirrors the mark's left one.
 */
export const MATE_LOCKUP = {
  viewBox: "0 0 216 52",
  width: 216,
  height: 52,
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
