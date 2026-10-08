// @effect-diagnostics nodeBuiltinImport:off -- This test reads the CSS projection it verifies.

import { describe, expect, it } from "vite-plus/test";

import {
  CHIP_TINTS,
  FALLBACK_PROVIDER_ACCENT,
  FLAT_CARD_BORDER,
  ICON_MAP,
  MATE_FACE,
  MATE_MARK,
  MATE_MARK_LIDS,
  MATE_MARK_LIVE,
  MATE_LOCKUP,
  MATE_SHAPE_IDS,
  MATE_SHAPE_OF_TINT,
  MATE_SHAPES,
  MATE_TINT_IDS,
  MATE_TINTS,
  MATE_WORDMARK,
  mateFaceParts,
  mateShapePoints,
  polygonArea,
  IDENTITY,
  MINT_PANEL,
  PROVIDER_ACCENT_SWATCHES,
  PROCESS_STEPS,
  RADII,
  type ServiceStatusTone,
  SERVICE_STATUS_TONES,
  TYPE_SCALE,
  ZEROPS_MARK,
} from "./brand.ts";
import { contrastRatio } from "./themePreview.ts";

describe("Zerops brand tokens", () => {
  it("publishes the product provider accents with a neutral fallback", () => {
    expect(PROVIDER_ACCENT_SWATCHES).toEqual([
      "#0077cc",
      "#16a34a",
      "#ea580c",
      "#dc2626",
      "#7c3aed",
      "#0891b2",
    ]);
    expect(FALLBACK_PROVIDER_ACCENT).toBe("#5f6a72");
  });

  it("keeps every chip label at AA contrast, including neutral --foreground fallbacks", () => {
    const neutralForeground = { light: "#27272a", dark: "#f5f5f5" } as const;
    const withheld: Array<string> = [];

    for (const [tone, appearances] of Object.entries(SERVICE_STATUS_TONES)) {
      for (const appearance of ["light", "dark"] as const) {
        const status = appearances[appearance] as ServiceStatusTone;
        if (status.text === undefined) withheld.push(`${tone}.${appearance}`);
        expect(
          contrastRatio(status.text ?? neutralForeground[appearance], status.surface),
          `${tone}.${appearance}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    // Only `off` withholds a text colour now, and it means it: grey is the
    // absence of a signal, so its word is the body's. `busy` and `failed` used
    // to withhold theirs by accident, which put black words on a blue chip
    // beside amber words on an amber one (2026-09-19).
    expect(withheld).toEqual(["off.light", "off.dark"]);
  });

  it("pins the exact ok dark surface and its 8.154783240726806 AA contrast", () => {
    const tone = SERVICE_STATUS_TONES.ok.dark;
    expect(tone.text).toBe("#56d364");
    expect(tone.surface).toBe("#19261d");
    expect(contrastRatio(tone.text, tone.surface)).toBeCloseTo(8.154783240726806, 12);
    expect(contrastRatio(tone.text, tone.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("pins the corrected attention light label above AA contrast", () => {
    const tone = SERVICE_STATUS_TONES.attention.light;
    expect(tone.text).toBe("#a26000");
    expect(contrastRatio(tone.text, tone.surface)).toBeCloseTo(4.577498770334955, 12);
    expect(contrastRatio(tone.text, tone.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps fixed identity, chip, and mint-panel tokens outside the theme library", () => {
    expect(IDENTITY.mark).toEqual({ main: "#3cbdb2", secondary: "#00b1a3" });
    expect(IDENTITY.mint.dark).toBe("#00e5c0");
    expect(CHIP_TINTS["access-green"].light.surface).toBe("rgba(76,175,80,.15)");
    expect(CHIP_TINTS["region-purple"].light.surface).toBe("rgba(156,39,176,.15)");
    expect(CHIP_TINTS["info-chip"].light.surface).toBe("rgba(255,255,255,.9)");
    expect(MINT_PANEL).toEqual({ light: "#e8f7ec", dark: "#19261d" });
  });

  it("pins the five service statuses for both appearances", () => {
    expect(
      Object.fromEntries(
        Object.entries(SERVICE_STATUS_TONES).map(([status, tones]) => [status, Object.keys(tones)]),
      ),
    ).toEqual({
      ok: ["light", "dark"],
      busy: ["light", "dark"],
      attention: ["light", "dark"],
      failed: ["light", "dark"],
      off: ["light", "dark"],
    });
  });

  it("publishes the four-path Zerops mark without a platform dependency", () => {
    expect(ZEROPS_MARK.viewBox).toBe("0 0 42.27 50.48");
    expect(ZEROPS_MARK.paths).toHaveLength(4);
    expect(ZEROPS_MARK.paths.map((path) => path.fill)).toEqual([
      "#3cbdb2",
      "#3cbdb2",
      "#00b1a3",
      "#00b1a3",
    ]);
    expect(ZEROPS_MARK.paths.map((path) => path.d)).toEqual([
      "M20.19.7L3 7.27A4 4 0 0 0 .46 11v16.54L8.36 23v-9.3L21.6 8.62V.44a4 4 0 0 0-1.41.26z",
      "M8.5 37.74l13.1-7.55v-9.12L1.36 32.74a1.82 1.82 0 0 0-.9 1.56v6.11A4 4 0 0 0 3 44.1l17.19 6.57a4 4 0 0 0 1.41.26v-8.18z",
      "M41.9 18.47a1.67 1.67 0 0 0 .84-1.47v-6a4 4 0 0 0-2.54-3.73L23 .7a4 4 0 0 0-1.4-.26v8.18l13 5-13 7.49v9.12z",
      "M23 50.67l17.2-6.57a4 4 0 0 0 2.54-3.69V23.7l-7.9 4.56v9.43L21.6 42.75v8.18a4 4 0 0 0 1.4-.26z",
    ]);
  });

  it("pins every cross-platform icon intent", () => {
    expect(ICON_MAP).toEqual({
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
    });
  });

  it("pins the documented radius scale", () => {
    expect(RADII).toEqual({
      card: 10,
      control: 8,
      dialog: 16,
      chip: 10,
      infoChip: 8,
      keyChip: 3,
      composer: 22,
      pill: 80,
    });
  });

  it("pins the flat-card border and process-step geometry", () => {
    expect(FLAT_CARD_BORDER).toEqual({
      light: "transparent",
      dark: "rgba(255,255,255,.06)",
    });
    expect(PROCESS_STEPS).toEqual({
      glyphColumn: 30,
      glyphSize: 17,
      glyphBorderWidth: 2,
    });
  });

  it("pins the documented type scale", () => {
    expect(TYPE_SCALE).toEqual({
      body: { fontSize: 14, fontWeight: 400 },
      rowHostname: { fontSize: 14, fontWeight: 500, portOpacity: 0.6 },
      cardTitle: { fontSize: 14, fontWeight: 500 },
      projectName: { fontSize: 20, fontWeight: 500 },
      description: { fontSize: 13, fontWeight: 400, lineHeight: 1.6, opacity: 0.7 },
      microLabel: {
        fontSize: 10,
        fontWeight: 600,
        letterSpacingEm: 0.06,
        opacity: 0.45,
      },
      draftHero: { fontSize: 32, fontWeight: 400 },
    });
  });
});

/**
 * The live mark and the still favicon are two renderings of one grid. These
 * pin the derived geometry against `MATE_MARK`'s hand-written constants, so a
 * change to either side that moves an eye fails here rather than shipping a
 * mark whose animated and static forms disagree.
 */
describe("MATE_MARK_LIVE", () => {
  it("derives the eye unit that MATE_MARK's rectangles are drawn from", () => {
    expect(MATE_MARK_LIVE.eyeUnit).toBeCloseTo(MATE_MARK.eyeWidth, 3);
    expect(MATE_MARK.eyeHeight).toBeCloseTo(2 * MATE_MARK_LIVE.eyeUnit, 3);
  });

  it("puts its eye centres on MATE_MARK's rectangles", () => {
    const [left, right] = MATE_MARK_LIVE.eyeCentres;
    expect(left - MATE_MARK.eyeWidth / 2).toBeCloseTo(MATE_MARK.eyeXs[0], 3);
    expect(right - MATE_MARK.eyeWidth / 2).toBeCloseTo(MATE_MARK.eyeXs[1], 3);
  });

  it("puts the eye line on MATE_MARK's rectangle top", () => {
    expect(MATE_MARK_LIVE.eyeCentreY - MATE_MARK.eyeHeight / 2).toBeCloseTo(MATE_MARK.eyeY, 3);
  });

  it("keeps the mouth inside the window, below the eyes", () => {
    expect(MATE_MARK_LIVE.mouth.y).toBeGreaterThan(MATE_MARK_LIVE.eyeCentreY);
    expect(MATE_MARK_LIVE.mouth.y).toBeLessThan(42.75);
  });

  it("draws both band halves as closed quads that overlap at rest", () => {
    for (const half of [MATE_MARK_LIVE.band.left, MATE_MARK_LIVE.band.right]) {
      expect(half.startsWith("M")).toBe(true);
      expect(half.endsWith(" Z")).toBe(true);
      expect(half.split(" L")).toHaveLength(4);
    }
    expect(MATE_MARK_LIVE.band.left).not.toBe(MATE_MARK_LIVE.band.right);
  });

  it("gives every lid state an openness, a width and a lift", () => {
    for (const [state, lid] of Object.entries(MATE_MARK_LIDS)) {
      expect(lid, state).toHaveLength(3);
    }
    expect(MATE_MARK_LIDS.sleep[0]).toBe(0);
    expect(MATE_MARK_LIDS.idle[0]).toBe(1);
    expect(MATE_MARK_LIDS.surprise[0]).toBeGreaterThan(1);
  });
});

describe("the wordmark and lockup (identity v1 §06)", () => {
  // Every coordinate the outlines touch, control points included; `H`/`V`
  // carry one axis, the rest carry pairs.
  const coordinates = (d: string) => {
    const xs: Array<number> = [];
    const ys: Array<number> = [];
    for (const [, command, rest] of d.matchAll(/([MLQCHVZ])([^MLQCHVZ]*)/gu)) {
      const values = (rest!.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
      if (command === "H") xs.push(...values);
      else if (command === "V") ys.push(...values);
      else values.forEach((value, index) => (index % 2 === 0 ? xs : ys).push(value));
    }
    return { xs, ys };
  };
  const xs = MATE_WORDMARK.paths.flatMap((d) => coordinates(d).xs);
  const ys = MATE_WORDMARK.paths.flatMap((d) => coordinates(d).ys);

  it("starts two fifths of the mark's height right of it, measured to the ink", () => {
    const markRight = 42.74;
    expect(MATE_WORDMARK.gap).toBe(20.8);
    expect(MATE_WORDMARK.ink.left).toBeCloseTo(markRight + MATE_WORDMARK.gap, 2);
    expect(Math.min(...xs)).toBeCloseTo(MATE_WORDMARK.ink.left, 1);
  });

  it("reads at 0.35 of the mark's height, its x-height band centred on the mark", () => {
    expect(MATE_WORDMARK.xHeight).toBe(18.2);
    expect(MATE_WORDMARK.baseline).toBe(35.1);
    expect(MATE_WORDMARK.baseline - MATE_WORDMARK.xHeight / 2).toBeCloseTo(
      MATE_LOCKUP.height / 2,
      2,
    );
    // The flat stems of the m end exactly on the baseline.
    expect(MATE_WORDMARK.paths[0]).toContain("35.1");
    // Round letters overshoot the baseline by about a unit and never more.
    expect(Math.max(...ys)).toBeLessThan(MATE_WORDMARK.baseline + 1.5);
  });

  it("is one letter per path, m · a · t · e, and fits the lockup's box", () => {
    expect(MATE_WORDMARK.paths).toHaveLength(4);
    // Control points may lie a hair outside the ink; the box leaves room.
    expect(Math.max(...xs)).toBeLessThan(MATE_LOCKUP.width);
    expect(MATE_LOCKUP.width).toBeGreaterThanOrEqual(MATE_WORDMARK.ink.right + 0.46);
    expect(MATE_LOCKUP.height).toBe(52);
    expect(MATE_LOCKUP.viewBox).toBe(`0 0 ${MATE_LOCKUP.width} ${MATE_LOCKUP.height}`);
    // Even the t's ascender stays inside the mark's box.
    expect(Math.min(...ys)).toBeGreaterThan(0);
  });

  it("splits into the mark's box and the word's, which meet at the mark's right edge", () => {
    expect(MATE_LOCKUP.mark.width).toBe(44);
    expect(MATE_MARK.viewBox).toBe(`0 0 ${MATE_LOCKUP.mark.width} ${MATE_LOCKUP.height}`);
    expect(MATE_LOCKUP.word.viewBox).toBe(
      `${MATE_LOCKUP.mark.width} 0 ${MATE_LOCKUP.word.width} ${MATE_LOCKUP.height}`,
    );
    expect(MATE_LOCKUP.mark.width + MATE_LOCKUP.word.width).toBe(MATE_LOCKUP.width);
    // The whole word, gap included, lives in the word's box.
    expect(MATE_WORDMARK.ink.left).toBeGreaterThan(MATE_LOCKUP.mark.width);
  });
});

describe("a Mate's colour (MATE_TINTS)", () => {
  const luminance = (hex: string) => {
    const channel = (at: number) => {
      const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };

  it("offers eight, in a fixed order, and none of them the brand teal", () => {
    expect(MATE_TINT_IDS).toHaveLength(8);
    expect(Object.keys(MATE_TINTS)).toEqual([...MATE_TINT_IDS]);
    for (const tint of Object.values(MATE_TINTS)) {
      expect(tint.light).not.toBe(MATE_MARK.color);
      expect(tint.dark).not.toBe(MATE_MARK.color);
    }
  });

  it("goes deeper in the dark appearance, so paper eyes read on it as ink does on the light disc", () => {
    for (const tint of Object.values(MATE_TINTS)) {
      expect(luminance(tint.dark)).toBeLessThan(luminance(tint.light));
      expect(contrastRatio(MATE_MARK.eyes.light, tint.light)).toBeGreaterThan(3);
      expect(contrastRatio(MATE_MARK.eyes.dark, tint.dark)).toBeGreaterThan(3);
    }
  });
});

describe("the face (MATE_FACE)", () => {
  it("carries the mark's window over: five eye units across 60 % of the disc, eyes a quarter-unit up", () => {
    const u = MATE_FACE.eyeUnit;
    expect(5 * u).toBe(0.6 * 2 * MATE_FACE.radius);
    expect(MATE_FACE.eyeCentres).toEqual([50 - 1.25 * u, 50 + 1.25 * u]);
    expect(MATE_FACE.eyeCentreY).toBe(50 - 0.25 * u);
    // The mark's mouth sits 2.08 eye units under its eye line; so does the face's.
    const markMouthUnits =
      (MATE_MARK_LIVE.mouth.y - MATE_MARK_LIVE.eyeCentreY) / MATE_MARK_LIVE.eyeUnit;
    expect((MATE_FACE.mouth.y - MATE_FACE.eyeCentreY) / u).toBeCloseTo(markMouthUnits, 1);
  });

  it.each([
    { state: "idle", height: 24, dy: 0, mouth: null },
    { state: "working", height: 12, dy: 2.4, mouth: null },
    { state: "needs", height: 26.88, dy: -1.56, mouth: "o" },
    { state: "sleep", height: 2.64, dy: 0, mouth: null },
    { state: "closed", height: 2.64, dy: 0, mouth: null },
  ] as const)("draws $state from the lid table", ({ state, height, dy, mouth }) => {
    const parts = mateFaceParts(state);
    expect(parts.arcs).toEqual([]);
    expect(parts.mouth).toBe(mouth);
    expect(parts.eyes).toHaveLength(2);
    for (const [index, eye] of parts.eyes.entries()) {
      expect(eye.height).toBeCloseTo(height, 2);
      expect(eye.y + eye.height / 2).toBeCloseTo(MATE_FACE.eyeCentreY + dy, 2);
      expect(eye.x + eye.width / 2).toBeCloseTo(MATE_FACE.eyeCentres[index]!, 2);
      // A pill: fully rounded on its shorter side.
      expect(eye.rx).toBeCloseTo(Math.min(eye.width, eye.height) / 2, 2);
    }
  });

  it("smiles with happy arcs and no pills when done", () => {
    const parts = mateFaceParts("done");
    expect(parts.eyes).toEqual([]);
    expect(parts.mouth).toBe("smile");
    expect(parts.arcs.map(([x]) => x)).toEqual([...MATE_FACE.eyeCentres]);
  });

  it("has a pose for every lid state", () => {
    for (const state of Object.keys(MATE_MARK_LIDS) as Array<keyof typeof MATE_MARK_LIDS>) {
      const parts = mateFaceParts(state);
      expect(parts.eyes.length + parts.arcs.length).toBe(2);
    }
  });
});

describe("a Mate's shape (MATE_SHAPES)", () => {
  type Point = readonly [number, number];
  const inside = (points: ReadonlyArray<Point>, [x, y]: Point) => {
    let odd = false;
    for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
      const [xi, yi] = points[index]!;
      const [xj, yj] = points[prev]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  const radiusAt = (points: ReadonlyArray<Point>, [ox, oy]: Point, angle: number) => {
    // The outline's distance from its origin along one ray, by bisection on the inside test.
    let lo = 0;
    let hi = 60;
    for (let step = 0; step < 30; step += 1) {
      const mid = (lo + hi) / 2;
      if (inside(points, [ox + mid * Math.cos(angle), oy + mid * Math.sin(angle)])) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  it("gives each of the eight tints its own shape", () => {
    expect(MATE_SHAPE_IDS).toHaveLength(8);
    expect(Object.keys(MATE_SHAPE_OF_TINT)).toEqual([...MATE_TINT_IDS]);
    expect(new Set(Object.values(MATE_SHAPE_OF_TINT)).size).toBe(MATE_SHAPE_IDS.length);
  });

  it.each(MATE_SHAPE_IDS)("draws the %s at one weight, inside its box", (id) => {
    const points = mateShapePoints(id);
    // Every shape holds the same area within a few percent, so none reads as bigger.
    expect(polygonArea(points)).toBeGreaterThan(6300 * 0.97);
    expect(polygonArea(points)).toBeLessThan(6300 * 1.03);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(99);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(99);
    }
    expect(MATE_SHAPES[id].d).toMatch(/^M[\d.,]+(C[\d., ]+)+Z$/u);
  });

  it.each(MATE_SHAPE_IDS)("holds the widest eyes and the mouth of every pose: %s", (id) => {
    const points = mateShapePoints(id);
    const margin = 4;
    const corners: Point[] = [];
    for (const state of Object.keys(MATE_MARK_LIDS) as Array<keyof typeof MATE_MARK_LIDS>) {
      for (const eye of mateFaceParts(state).eyes) {
        corners.push(
          [eye.x - margin, eye.y - margin],
          [eye.x + eye.width + margin, eye.y - margin],
          [eye.x - margin, eye.y + eye.height + margin],
          [eye.x + eye.width + margin, eye.y + eye.height + margin],
        );
      }
    }
    const mouthReach = MATE_FACE.mouth.r + margin;
    corners.push(
      [50 - mouthReach, MATE_FACE.mouth.y + mouthReach],
      [50 + mouthReach, MATE_FACE.mouth.y + mouthReach],
    );
    for (const corner of corners) expect(inside(points, corner)).toBe(true);
  });

  it.each(MATE_SHAPE_IDS)("turns onto itself by its step, about its own centre: %s", (id) => {
    const points = mateShapePoints(id);
    const { origin } = MATE_SHAPES[id];
    const step = (MATE_SHAPES[id].step * Math.PI) / 180;
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * 2 * Math.PI;
      expect(radiusAt(points, origin, angle + step)).toBeCloseTo(
        radiusAt(points, origin, angle),
        0,
      );
    }
  });
});
