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
 * height, the x-height band centred on the mark, and the first stem's ink half
 * the mark's height right of it (the owner's second correction, 2026-09-05:
 * "the name a bit closer"). Derivation: `scripts/brand/wordmark.py`.
 */
export const MATE_WORDMARK = {
  font: "Sora SemiBold",
  letterSpacingEm: -0.015,
  xHeight: round(MATE_LOCKUP_HEIGHT * 0.375),
  baseline: round(MATE_LOCKUP_HEIGHT / 2 + (MATE_LOCKUP_HEIGHT * 0.375) / 2),
  gap: round(MATE_LOCKUP_HEIGHT * 0.5),
  ink: { left: 68.74, top: 10.33, right: 158.32, bottom: 36.44 },
  /** One outline per letter, m · a · t · e. */
  paths: [
    "M68.74 35.75V15.92H72.76V24.43H72.39Q72.39 21.44 73.16 19.41Q73.93 17.38 75.44 16.34Q76.96 15.3 79.22 15.3H79.44Q81.74 15.3 83.26 16.34Q84.77 17.38 85.52 19.41Q86.27 21.44 86.27 24.43H84.99Q84.99 21.44 85.78 19.41Q86.56 17.38 88.08 16.34Q89.59 15.3 91.86 15.3H92.07Q94.37 15.3 95.91 16.34Q97.44 17.38 98.23 19.41Q99.01 21.44 99.01 24.43V35.75H93.94V23.96Q93.94 22.09 92.99 20.98Q92.04 19.87 90.28 19.87Q88.53 19.87 87.47 21.02Q86.41 22.17 86.41 24.1V35.75H81.34V23.96Q81.34 22.09 80.39 20.98Q79.44 19.87 77.69 19.87Q75.93 19.87 74.87 21.02Q73.82 22.17 73.82 24.1V35.75Z",
    "M115.92 35.75V29.87H115.08V23.33Q115.08 21.62 114.24 20.78Q113.4 19.94 111.65 19.94Q110.73 19.94 109.46 19.97Q108.18 20.01 106.88 20.07Q105.59 20.12 104.56 20.19V15.88Q105.4 15.81 106.46 15.74Q107.52 15.67 108.63 15.65Q109.75 15.63 110.73 15.63Q113.8 15.63 115.83 16.43Q117.86 17.24 118.9 18.95Q119.94 20.67 119.94 23.44V35.75ZM109.53 36.26Q107.37 36.26 105.75 35.49Q104.12 34.73 103.23 33.3Q102.34 31.88 102.34 29.87Q102.34 27.68 103.41 26.29Q104.49 24.9 106.44 24.21Q108.4 23.52 111.03 23.52H115.63V26.55H110.95Q109.2 26.55 108.27 27.41Q107.34 28.26 107.34 29.62Q107.34 30.97 108.27 31.81Q109.2 32.65 110.95 32.65Q112.01 32.65 112.91 32.26Q113.8 31.88 114.4 30.95Q115.01 30.02 115.08 28.41L116.32 29.83Q116.14 31.92 115.32 33.34Q114.5 34.76 113.05 35.51Q111.61 36.26 109.53 36.26Z",
    "M133.45 36.01Q130.71 36.01 128.94 35.29Q127.17 34.58 126.29 32.88Q125.41 31.19 125.41 28.3L125.45 10.33H130.2L130.16 28.63Q130.16 30.09 130.95 30.88Q131.73 31.66 133.19 31.66H136.3V36.01ZM122.27 19.65V15.92H136.3V19.65Z",
    "M148.78 36.44Q146.23 36.44 144.31 35.57Q142.39 34.69 141.13 33.21Q139.87 31.73 139.24 29.91Q138.6 28.08 138.6 26.18V25.49Q138.6 23.52 139.24 21.67Q139.87 19.83 141.13 18.39Q142.39 16.94 144.26 16.09Q146.12 15.23 148.57 15.23Q151.78 15.23 153.95 16.63Q156.12 18.04 157.22 20.32Q158.32 22.6 158.32 25.23V27.06H140.75V23.96H155.14L153.57 25.49Q153.57 23.59 153.02 22.24Q152.47 20.89 151.36 20.16Q150.25 19.43 148.57 19.43Q146.89 19.43 145.72 20.19Q144.55 20.96 143.95 22.4Q143.34 23.85 143.34 25.85Q143.34 27.72 143.93 29.16Q144.51 30.6 145.72 31.42Q146.92 32.24 148.78 32.24Q150.65 32.24 151.82 31.5Q152.98 30.75 153.31 29.65H157.99Q157.55 31.7 156.31 33.23Q155.07 34.76 153.15 35.6Q151.23 36.44 148.78 36.44Z",
  ],
} as const;

/** The mark's box width — `MATE_MARK.viewBox` is `0 0 44 52`. */
const MATE_MARK_WIDTH = 44;
const MATE_LOCKUP_WIDTH = 159;

/**
 * The lockup: the mark and the wordmark in one box. Its height is the mark's
 * own, so a lockup and a bare mark at the same CSS height draw the mark at the
 * same size; the right margin mirrors the mark's left one.
 *
 * The box is also drawn as two: the mark in its own `viewBox` (so it can be
 * the live mark, which turns and looks about on its own root) and the word in
 * the rest of the box, `word.viewBox`, which starts at the mark's right edge
 * and so carries the gap. Side by side at one height they are the one box.
 */
export const MATE_LOCKUP = {
  viewBox: `0 0 ${MATE_LOCKUP_WIDTH} ${MATE_LOCKUP_HEIGHT}`,
  width: MATE_LOCKUP_WIDTH,
  height: MATE_LOCKUP_HEIGHT,
  mark: { width: MATE_MARK_WIDTH },
  word: {
    viewBox: `${MATE_MARK_WIDTH} 0 ${MATE_LOCKUP_WIDTH - MATE_MARK_WIDTH} ${MATE_LOCKUP_HEIGHT}`,
    width: MATE_LOCKUP_WIDTH - MATE_MARK_WIDTH,
  },
} as const;

/**
 * A Mate's colour. Each agent on an account gets one of eight, so a menu of
 * six faces reads as six people rather than six copies of the logo. None of
 * them is the brand teal: teal identifies the product (design-system §2), and
 * a Mate is somebody in it. Light discs carry ink eyes, the deeper dark ones
 * paper eyes — the mark's own rule for eyes on a ground (`MATE_MARK.eyes`).
 * Which Mate gets which is `client-runtime/zerops/mateTints.ts`.
 */
export const MATE_TINT_IDS = [
  "coral",
  "amber",
  "olive",
  "sky",
  "violet",
  "rose",
  "sand",
  "slate",
] as const;

export type MateTintId = (typeof MATE_TINT_IDS)[number];

export const MATE_TINTS = {
  coral: { light: "#ef8f78", dark: "#b85f4b" },
  amber: { light: "#e9b645", dark: "#9c7420" },
  olive: { light: "#a9bf5a", dark: "#6f8436" },
  sky: { light: "#7fb7e6", dark: "#3f7fb3" },
  violet: { light: "#ab97e3", dark: "#6f5aab" },
  rose: { light: "#e98bb5", dark: "#ad5580" },
  sand: { light: "#d9a874", dark: "#9c6f42" },
  slate: { light: "#8ea3c2", dark: "#556b8d" },
} as const satisfies Record<MateTintId, Readonly<Record<BrandAppearance, string>>>;

/**
 * The face: a Mate's eyes on a disc of its colour, in a 100-box. The grid is
 * the mark's own (identity v1 §02) carried over — the window is five eye
 * units and spans 60 % of the mark's width, so here it spans 60 % of the disc:
 * `u` = 12. Eyes are `u × 2u` pills a quarter-unit above the centre; the
 * mouth, when a state has one, sits 2.08 u below the eye line, exactly where
 * the mark's does (60 % of the way to the window floor).
 *
 * Still, by design: a menu of faces must not blink at you. What moves is the
 * state, and `mateFaceParts` draws each state from `MATE_MARK_LIDS`, so the
 * face and the live mark can never disagree about what "working" looks like.
 */
const FACE_UNIT = 12;
const FACE_EYE_LINE = 50 - 0.25 * FACE_UNIT;

export const MATE_FACE = {
  viewBox: "0 0 100 100",
  radius: 50,
  eyeUnit: FACE_UNIT,
  eyeCentres: [50 - 1.25 * FACE_UNIT, 50 + 1.25 * FACE_UNIT] as const,
  eyeCentreY: FACE_EYE_LINE,
  mouth: {
    y: FACE_EYE_LINE + 2.08 * FACE_UNIT,
    r: 0.42 * FACE_UNIT,
    strokeWidth: 0.28 * FACE_UNIT,
  },
} as const;

export interface MateFaceEye {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
}

export interface MateFaceParts {
  /** The two eye pills, left then right — empty when the eyes are the happy arcs. */
  readonly eyes: ReadonlyArray<MateFaceEye>;
  /** The happy arcs' translations, left then right — only on `done`. */
  readonly arcs: ReadonlyArray<readonly [number, number]>;
  /** The mouth is an event: the "o" when the Mate needs you, the smile when it is done. */
  readonly mouth: "o" | "smile" | null;
}

/** The live mark's arc and smile, in eye units around their own origin. */
export const MATE_FACE_STROKES = {
  arc: `M${-FACE_UNIT / 2},0 Q0,${round(-0.85 * FACE_UNIT)} ${FACE_UNIT / 2},0`,
  smile: `M${round(-0.75 * FACE_UNIT)},${round(-0.05 * FACE_UNIT)} Q0,${round(1.22 * FACE_UNIT)} ${round(0.75 * FACE_UNIT)},${round(-0.05 * FACE_UNIT)}`,
} as const;

/**
 * Where the eyes and mouth sit for a state — the still frame of the live
 * mark's pose, from the same lid table. A shut eye keeps a hairline of height
 * (0.22 u, the driver's own floor) so an asleep face still has eyes.
 */
export function mateFaceParts(state: MateMarkState): MateFaceParts {
  const u = MATE_FACE.eyeUnit;
  if (state === "done") {
    const y = round(MATE_FACE.eyeCentreY + 0.05 * u);
    return {
      eyes: [],
      arcs: MATE_FACE.eyeCentres.map((cx) => [cx, y] as const),
      mouth: "smile",
    };
  }
  const [openness, width, lift] = MATE_MARK_LIDS[state];
  const w = round(u * width);
  const h = round(Math.max(0.22 * u, 2 * u * openness));
  const cy = MATE_FACE.eyeCentreY + lift * u;
  return {
    eyes: MATE_FACE.eyeCentres.map((cx) => ({
      x: round(cx - w / 2),
      y: round(cy - h / 2),
      width: w,
      height: h,
      rx: round(Math.min(w, h) / 2),
    })),
    arcs: [],
    mouth: state === "needs" || state === "surprise" ? "o" : null,
  };
}

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
