// @effect-diagnostics nodeBuiltinImport:off -- This test reads the CSS projection it verifies.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  type BrandAppearance,
  CHIP_TINTS,
  FALLBACK_PROVIDER_ACCENT,
  FLAT_CARD_BORDER,
  ICON_MAP,
  IDENTITY,
  MINT_PANEL,
  PROVIDER_ACCENT_SWATCHES,
  PROCESS_STEPS,
  RADII,
  SEMANTIC_INDICATORS,
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

  it("keeps index.css --success/--info equal to SEMANTIC_INDICATORS", () => {
    const indexCss = NodeFS.readFileSync(
      new URL("../../../apps/web/src/index.css", import.meta.url),
      "utf8",
    );
    const valuesFor = (property: string) =>
      [...indexCss.matchAll(new RegExp(`${property}:\\s*([^;]+);`, "gu"))].map((match) => match[1]);

    expect(valuesFor("--success")).toEqual([
      SEMANTIC_INDICATORS.success.light,
      SEMANTIC_INDICATORS.success.dark,
    ]);
    expect(valuesFor("--success-foreground")).toEqual([
      SEMANTIC_INDICATORS.successForeground.light,
      SEMANTIC_INDICATORS.successForeground.dark,
    ]);
    expect(valuesFor("--info")).toEqual([
      SEMANTIC_INDICATORS.info.light,
      SEMANTIC_INDICATORS.info.dark,
    ]);
    expect(valuesFor("--info-foreground")).toEqual([
      SEMANTIC_INDICATORS.infoForeground.light,
      SEMANTIC_INDICATORS.infoForeground.dark,
    ]);
  });

  it("projects every service status and primitive token into both web palettes", () => {
    const indexCss = NodeFS.readFileSync(
      new URL("../../../apps/web/src/index.css", import.meta.url),
      "utf8",
    );
    const rootStart = indexCss.indexOf(":root {\n  color-scheme: light;");
    const darkStart = indexCss.indexOf("\n  @variant dark {", rootStart);
    const darkEnd = indexCss.indexOf("\n  }\n}", darkStart);
    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(darkStart).toBeGreaterThan(rootStart);
    expect(darkEnd).toBeGreaterThan(darkStart);

    const palettes: Record<BrandAppearance, string> = {
      light: indexCss.slice(rootStart, darkStart),
      dark: indexCss.slice(darkStart, darkEnd),
    };
    const valuesFor = (source: string, property: string) =>
      [...source.matchAll(new RegExp(`${property}:\\s*([^;]+);`, "gu"))].map((match) => match[1]);
    const allValuesFor = (property: string) => valuesFor(indexCss, property);

    for (const [tone, appearances] of Object.entries(SERVICE_STATUS_TONES)) {
      for (const appearance of ["light", "dark"] as const) {
        const status = appearances[appearance] as ServiceStatusTone;
        for (const field of ["dot", "surface", "text"] as const) {
          const suffix = field === "dot" ? "" : `-${field}`;
          const expected = status[field];
          expect(valuesFor(palettes[appearance], `--zerops-status-${tone}${suffix}`)).toEqual(
            expected === undefined ? [] : [expected],
          );
        }
      }
    }

    expect(allValuesFor("--zerops-micro-label-font-size")).toEqual([
      `${TYPE_SCALE.microLabel.fontSize}px`,
      `${TYPE_SCALE.microLabel.fontSize}px`,
    ]);
    expect(allValuesFor("--zerops-micro-label-font-weight")).toEqual([
      `${TYPE_SCALE.microLabel.fontWeight}`,
      `${TYPE_SCALE.microLabel.fontWeight}`,
    ]);
    expect(allValuesFor("--zerops-micro-label-tracking")).toEqual([
      `${TYPE_SCALE.microLabel.letterSpacingEm}em`,
      `${TYPE_SCALE.microLabel.letterSpacingEm}em`,
    ]);
    expect(allValuesFor("--zerops-micro-label-opacity")).toEqual([
      `${TYPE_SCALE.microLabel.opacity}`,
      `${TYPE_SCALE.microLabel.opacity}`,
    ]);
    expect(allValuesFor("--zerops-pill-radius")).toEqual([`${RADII.pill}px`, `${RADII.pill}px`]);
    expect(allValuesFor("--zerops-chip-radius")).toEqual([`${RADII.chip}px`, `${RADII.chip}px`]);
    expect(allValuesFor("--zerops-info-chip-radius")).toEqual([]);
    expect(allValuesFor("--zerops-card-radius")).toEqual([`${RADII.card}px`, `${RADII.card}px`]);
    expect(allValuesFor("--zerops-key-chip-radius")).toEqual([
      `${RADII.keyChip}px`,
      `${RADII.keyChip}px`,
    ]);
    expect(
      allValuesFor("--zerops-flat-card-border").map((value) =>
        (value ?? "").replaceAll(" ", "").replace("0.06", ".06"),
      ),
    ).toEqual([FLAT_CARD_BORDER.light, FLAT_CARD_BORDER.dark]);
    expect(allValuesFor("--zerops-mint-panel")).toEqual([MINT_PANEL.light, MINT_PANEL.dark]);
    expect(allValuesFor("--zerops-process-step-column")).toEqual([
      `${PROCESS_STEPS.glyphColumn}px`,
      `${PROCESS_STEPS.glyphColumn}px`,
    ]);
    expect(allValuesFor("--zerops-process-step-glyph-size")).toEqual([
      `${PROCESS_STEPS.glyphSize}px`,
      `${PROCESS_STEPS.glyphSize}px`,
    ]);
    expect(allValuesFor("--zerops-process-step-border-width")).toEqual([
      `${PROCESS_STEPS.glyphBorderWidth}px`,
      `${PROCESS_STEPS.glyphBorderWidth}px`,
    ]);
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

    expect(withheld).toEqual(["busy.light", "failed.light", "off.light", "off.dark"]);
  });

  it("pins the exact ok dark surface and its 7.030395873026908 AA contrast", () => {
    const tone = SERVICE_STATUS_TONES.ok.dark;
    expect(tone.text).toBe("#56d364");
    expect(tone.surface).toBe("#1d3323");
    expect(contrastRatio(tone.text, tone.surface)).toBeCloseTo(7.030395873026908, 12);
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
    expect(MINT_PANEL).toEqual({ light: "#e8f7ec", dark: "#1d3323" });
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
