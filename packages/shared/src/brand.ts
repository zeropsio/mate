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

/** The mark's box height, which is also the lockup's. */
const MATE_LOCKUP_HEIGHT = 52;

/**
 * Identity v1 §06 — the wordmark. "mate", Sora SemiBold, lowercase,
 * letter-spacing −0.015 em, shaped once (HarfBuzz, `kern` on) and outlined, so
 * no page ever waits on a webfont to show the logo. Held in the mark's units,
 * at the proportion the owner set from the reference lockup (2026-09-05): the
 * word reads small beside a large mark — x-height three eighths of the mark's
 * height, the x-height band centred on the mark, and the first stem's ink six
 * tenths of the mark's height right of it. Derivation: `scripts/brand/wordmark.py`.
 */
export const MATE_WORDMARK = {
  font: "Sora SemiBold",
  letterSpacingEm: -0.015,
  xHeight: round(MATE_LOCKUP_HEIGHT * 0.375),
  baseline: round(MATE_LOCKUP_HEIGHT / 2 + (MATE_LOCKUP_HEIGHT * 0.375) / 2),
  gap: round(MATE_LOCKUP_HEIGHT * 0.6),
  ink: { left: 73.94, top: 10.33, right: 163.52, bottom: 36.44 },
  /** One outline per letter, m · a · t · e. */
  paths: [
    "M73.94 35.75V15.92H77.96V24.43H77.59Q77.59 21.44 78.36 19.41Q79.13 17.38 80.64 16.34Q82.16 15.3 84.42 15.3H84.64Q86.94 15.3 88.46 16.34Q89.97 17.38 90.72 19.41Q91.47 21.44 91.47 24.43H90.19Q90.19 21.44 90.98 19.41Q91.76 17.38 93.28 16.34Q94.79 15.3 97.06 15.3H97.27Q99.57 15.3 101.11 16.34Q102.64 17.38 103.43 19.41Q104.21 21.44 104.21 24.43V35.75H99.14V23.96Q99.14 22.09 98.19 20.98Q97.24 19.87 95.48 19.87Q93.73 19.87 92.67 21.02Q91.61 22.17 91.61 24.1V35.75H86.54V23.96Q86.54 22.09 85.59 20.98Q84.64 19.87 82.89 19.87Q81.13 19.87 80.07 21.02Q79.02 22.17 79.02 24.1V35.75Z",
    "M121.12 35.75V29.87H120.28V23.33Q120.28 21.62 119.44 20.78Q118.6 19.94 116.85 19.94Q115.93 19.94 114.66 19.97Q113.38 20.01 112.08 20.07Q110.79 20.12 109.76 20.19V15.88Q110.6 15.81 111.66 15.74Q112.72 15.67 113.83 15.65Q114.95 15.63 115.93 15.63Q119 15.63 121.03 16.43Q123.06 17.24 124.1 18.95Q125.14 20.67 125.14 23.44V35.75ZM114.73 36.26Q112.57 36.26 110.95 35.49Q109.32 34.73 108.43 33.3Q107.54 31.88 107.54 29.87Q107.54 27.68 108.61 26.29Q109.69 24.9 111.64 24.21Q113.6 23.52 116.23 23.52H120.83V26.55H116.15Q114.4 26.55 113.47 27.41Q112.54 28.26 112.54 29.62Q112.54 30.97 113.47 31.81Q114.4 32.65 116.15 32.65Q117.21 32.65 118.11 32.26Q119 31.88 119.6 30.95Q120.21 30.02 120.28 28.41L121.52 29.83Q121.34 31.92 120.52 33.34Q119.7 34.76 118.25 35.51Q116.81 36.26 114.73 36.26Z",
    "M138.65 36.01Q135.91 36.01 134.14 35.29Q132.37 34.58 131.49 32.88Q130.61 31.19 130.61 28.3L130.65 10.33H135.4L135.36 28.63Q135.36 30.09 136.15 30.88Q136.93 31.66 138.39 31.66H141.5V36.01ZM127.47 19.65V15.92H141.5V19.65Z",
    "M153.98 36.44Q151.43 36.44 149.51 35.57Q147.59 34.69 146.33 33.21Q145.07 31.73 144.44 29.91Q143.8 28.08 143.8 26.18V25.49Q143.8 23.52 144.44 21.67Q145.07 19.83 146.33 18.39Q147.59 16.94 149.46 16.09Q151.32 15.23 153.77 15.23Q156.98 15.23 159.15 16.63Q161.32 18.04 162.42 20.32Q163.52 22.6 163.52 25.23V27.06H145.95V23.96H160.34L158.77 25.49Q158.77 23.59 158.22 22.24Q157.67 20.89 156.56 20.16Q155.45 19.43 153.77 19.43Q152.09 19.43 150.92 20.19Q149.75 20.96 149.15 22.4Q148.54 23.85 148.54 25.85Q148.54 27.72 149.13 29.16Q149.71 30.6 150.92 31.42Q152.12 32.24 153.98 32.24Q155.85 32.24 157.02 31.5Q158.18 30.75 158.51 29.65H163.19Q162.75 31.7 161.51 33.23Q160.27 34.76 158.35 35.6Q156.43 36.44 153.98 36.44Z",
  ],
} as const;

/**
 * The lockup: the still mark and the wordmark in one box. Its height is the
 * mark's own, so a lockup and a bare mark at the same CSS height draw the mark
 * at the same size; the right margin mirrors the mark's left one.
 */
export const MATE_LOCKUP = {
  viewBox: `0 0 164 ${MATE_LOCKUP_HEIGHT}`,
  width: 164,
  height: MATE_LOCKUP_HEIGHT,
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
