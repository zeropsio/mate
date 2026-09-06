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
 * at the proportion the owner set from the reference lockup (2026-09-05) and
 * tightened on 2026-09-06 ("a little smaller and a little closer to the
 * logo"): the word reads small beside a large mark — x-height 0.35 of the
 * mark's height, the x-height band centred on the mark, and the first stem's
 * ink two fifths of the mark's height right of it. Derivation:
 * `scripts/brand/wordmark.py`; this cut is the 2026-09-05 one scaled about the
 * baseline at its first stem, which is the same layout the script re-derives.
 */
export const MATE_WORDMARK = {
  font: "Sora SemiBold",
  letterSpacingEm: -0.015,
  xHeight: round(MATE_LOCKUP_HEIGHT * 0.35),
  baseline: round(MATE_LOCKUP_HEIGHT / 2 + (MATE_LOCKUP_HEIGHT * 0.35) / 2),
  gap: round(MATE_LOCKUP_HEIGHT * 0.4),
  ink: { left: 63.54, top: 11.37, right: 147.15, bottom: 35.74 },
  /** One outline per letter, m · a · t · e. */
  paths: [
    "M63.54 35.1V16.59H67.29V24.53H66.95Q66.95 21.74 67.67 19.85Q68.38 17.95 69.79 16.98Q71.21 16.01 73.32 16.01H73.53Q75.67 16.01 77.09 16.98Q78.5 17.95 79.2 19.85Q79.9 21.74 79.9 24.53H78.71Q78.71 21.74 79.44 19.85Q80.17 17.95 81.59 16.98Q83 16.01 85.12 16.01H85.31Q87.46 16.01 88.9 16.98Q90.33 17.95 91.06 19.85Q91.79 21.74 91.79 24.53V35.1H87.06V24.1Q87.06 22.35 86.17 21.31Q85.29 20.28 83.64 20.28Q82.01 20.28 81.02 21.35Q80.03 22.43 80.03 24.23V35.1H75.3V24.1Q75.3 22.35 74.41 21.31Q73.53 20.28 71.89 20.28Q70.25 20.28 69.26 21.35Q68.28 22.43 68.28 24.23V35.1Z",
    "M107.57 35.1V29.61H106.79V23.51Q106.79 21.91 106.01 21.13Q105.22 20.34 103.59 20.34Q102.73 20.34 101.55 20.37Q100.35 20.41 99.14 20.47Q97.93 20.51 96.97 20.58V16.55Q97.76 16.49 98.75 16.42Q99.73 16.36 100.77 16.34Q101.82 16.32 102.73 16.32Q105.6 16.32 107.49 17.07Q109.39 17.82 110.36 19.42Q111.33 21.03 111.33 23.61V35.1ZM101.61 35.58Q99.59 35.58 98.08 34.86Q96.56 34.15 95.73 32.81Q94.9 31.49 94.9 29.61Q94.9 27.57 95.9 26.27Q96.91 24.97 98.73 24.33Q100.56 23.69 103.01 23.69H107.3V26.51H102.94Q101.3 26.51 100.43 27.32Q99.57 28.11 99.57 29.38Q99.57 30.64 100.43 31.42Q101.3 32.21 102.94 32.21Q103.93 32.21 104.77 31.84Q105.6 31.49 106.16 30.62Q106.73 29.75 106.79 28.25L107.95 29.57Q107.78 31.53 107.01 32.85Q106.25 34.18 104.9 34.88Q103.55 35.58 101.61 35.58Z",
    "M123.94 35.34Q121.38 35.34 119.73 34.67Q118.07 34.01 117.25 32.42Q116.43 30.84 116.43 28.15L116.47 11.37H120.9L120.87 28.45Q120.87 29.82 121.6 30.55Q122.33 31.28 123.69 31.28H126.6V35.34ZM113.5 20.07V16.59H126.6V20.07Z",
    "M138.24 35.74Q135.86 35.74 134.07 34.93Q132.28 34.11 131.1 32.73Q129.93 31.35 129.34 29.65Q128.74 27.94 128.74 26.17V25.52Q128.74 23.69 129.34 21.96Q129.93 20.24 131.1 18.9Q132.28 17.54 134.03 16.75Q135.76 15.95 138.05 15.95Q141.04 15.95 143.07 17.25Q145.09 18.57 146.12 20.7Q147.15 22.83 147.15 25.28V26.99H130.75V24.1H144.18L142.71 25.52Q142.71 23.75 142.2 22.49Q141.69 21.23 140.65 20.55Q139.62 19.87 138.05 19.87Q136.48 19.87 135.39 20.58Q134.3 21.3 133.74 22.64Q133.17 23.99 133.17 25.86Q133.17 27.61 133.72 28.95Q134.26 30.29 135.39 31.06Q136.51 31.82 138.24 31.82Q139.99 31.82 141.08 31.13Q142.16 30.43 142.47 29.41H146.84Q146.43 31.32 145.27 32.75Q144.11 34.18 142.32 34.96Q140.53 35.74 138.24 35.74Z",
  ],
} as const;

/** The mark's box width — `MATE_MARK.viewBox` is `0 0 44 52`. */
const MATE_MARK_WIDTH = 44;
const MATE_LOCKUP_WIDTH = 148;

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
