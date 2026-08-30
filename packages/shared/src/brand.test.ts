import { describe, expect, it } from "vite-plus/test";

import {
  CHIP_TINTS,
  ICON_MAP,
  IDENTITY,
  MINT_PANEL,
  RADII,
  SERVICE_STATUS_TONES,
  TYPE_SCALE,
  ZEROPS_MARK,
} from "./brand.ts";
import { contrastRatio } from "./themePreview.ts";

describe("Zerops brand tokens", () => {
  it.each([
    ["ok light text pair 4.63", SERVICE_STATUS_TONES.ok.light, 4.5],
    ["attention dark text pair 6.01", SERVICE_STATUS_TONES.attention.dark, 4.5],
    ["busy dark text pair 5.51", SERVICE_STATUS_TONES.busy.dark, 4.5],
    ["failed dark text pair 5.02", SERVICE_STATUS_TONES.failed.dark, 4.5],
  ])("keeps %s readable", (_name, tone, threshold) => {
    expect(tone.text).toBeDefined();
    expect(contrastRatio(tone.text!, tone.surface)).toBeGreaterThanOrEqual(threshold);
  });

  it("pins the exact ok dark surface and its 7.030395873026908 AA contrast", () => {
    const tone = SERVICE_STATUS_TONES.ok.dark;
    expect(tone.text).toBe("#56d364");
    expect(tone.surface).toBe("#1d3323");
    expect(contrastRatio(tone.text, tone.surface)).toBeCloseTo(7.030395873026908, 12);
    expect(contrastRatio(tone.text, tone.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("records attention light at 3.89 as an indicator pair", () => {
    const tone = SERVICE_STATUS_TONES.attention.light;
    expect(contrastRatio(tone.text!, tone.surface)).toBeCloseTo(3.89, 2);
    expect(contrastRatio(tone.text!, tone.surface)).toBeLessThan(4.5);
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
    });
  });

  it("pins the documented type scale", () => {
    expect(TYPE_SCALE).toEqual({
      body: { fontSize: 14, fontWeight: 400 },
      rowHostname: { fontSize: 14, fontWeight: 500, portOpacity: 0.6 },
      cardTitle: { fontSize: 14, fontWeight: 500 },
      projectName: { fontSize: 20, fontWeight: 500 },
      description: { fontSize: 13, fontWeight: 400, lineHeight: 1.6, opacity: 0.7 },
      microLabel: { fontSize: 10, fontWeight: 600 },
      draftHero: { fontSize: 32, fontWeight: 400 },
    });
  });
});
