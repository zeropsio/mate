// @effect-diagnostics nodeBuiltinImport:off -- This test measures generated theme colours.
import * as NodeFS from "node:fs";
import { SERVICE_STATUS_TONES } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  microLabelPresentation,
  statusTonePresentation,
  type ZeropsStatusTone,
} from "./presentation.ts";

const TONES = [undefined, "ok", "busy", "attention", "failed", "off"] as const;
const STATES = ["default", "muted"] as const;
const APPEARANCES = ["light", "dark"] as const;
const TONE_LABEL_CLASS_NAMES = {
  ok: "text-zerops-status-ok-text",
  busy: "text-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
  attention: "text-zerops-status-attention-text",
  failed: "text-[var(--color-zerops-status-failed-text,var(--color-foreground-muted))]",
  off: "text-foreground-muted",
} as const;
const generatedCss = NodeFS.readFileSync(
  new URL("../../../generated-uniwind-themes.css", import.meta.url),
  "utf8",
);
const globalCss = NodeFS.readFileSync(new URL("../../../global.css", import.meta.url), "utf8");

function variantBody(css: string, name: "light" | "dark") {
  const marker = `@variant ${name} {`;
  const markerIndex = css.indexOf(marker);
  const openingBraceIndex = css.indexOf("{", markerIndex);
  let depth = 0;

  for (let index = openingBraceIndex; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return css.slice(openingBraceIndex + 1, index);
  }
  throw new Error(`Missing ${marker}`);
}

function variable(body: string, name: string) {
  return new RegExp(`^\\s*${name}:\\s*([^;]+);`, "mu").exec(body)?.[1];
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value)?.slice(1);
    if (channels === undefined) throw new Error(`Expected an opaque hex colour, received ${value}`);
    const [red, green, blue] = channels.map((channel) => {
      const srgb = Number.parseInt(channel, 16) / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function statusLabelColor(generatedBody: string, themeBody: string, tone: ZeropsStatusTone) {
  const classNames = microLabelPresentation({ label: tone, tone }).textClassName;
  const neutral = variable(themeBody, "--color-foreground-muted");
  if (neutral === undefined) throw new Error("Missing --color-foreground-muted");
  if (classNames.split(/\s+/u).includes("text-foreground-muted")) return neutral;

  const brandText = variable(generatedBody, `--color-zerops-status-${tone}-text`);
  if (classNames.includes("var(--color-zerops-status-")) return brandText ?? neutral;
  if (brandText === undefined) throw new Error(`Missing ${tone} label colour`);
  return brandText;
}

describe("microLabelPresentation", () => {
  it.each(TONES.flatMap((tone) => STATES.map((state) => ({ tone, state }))))(
    "presents $tone/$state at the mobile micro-label scale",
    ({ tone, state }) => {
      const presentation = microLabelPresentation({ label: "Region", tone, state });

      expect(presentation.label).toBe("Region");
      expect(presentation.textClassName).toContain("text-3xs");
      expect(presentation.textClassName).toContain("font-t3-medium");
      expect(presentation.textClassName).toContain("uppercase");
      expect(presentation.textClassName).toContain("tracking-[0.66px]");
      expect(presentation.textClassName).toContain(
        tone === undefined
          ? state === "muted"
            ? "text-foreground-muted"
            : "text-foreground"
          : TONE_LABEL_CLASS_NAMES[tone],
      );
      expect(presentation.textClassName).not.toContain("opacity-");
    },
  );

  it("keeps every emitted status text variable consumed and only the brand absences neutral", () => {
    const absences: Array<string> = [];

    for (const appearance of APPEARANCES) {
      const body = variantBody(generatedCss, appearance);

      for (const toneId of Object.keys(SERVICE_STATUS_TONES) as ReadonlyArray<ZeropsStatusTone>) {
        const textVariable = variable(body, `--color-zerops-status-${toneId}-text`);
        const presentation = statusTonePresentation(toneId);
        const classNames = [presentation.labelClassName, presentation.iconTintClassName];

        if (textVariable === undefined) {
          absences.push(`${toneId}.${appearance}`);
          classNames.forEach((className) => expect(className).toContain("foreground-muted"));
        } else {
          classNames.forEach((className) =>
            expect(className).toContain(`zerops-status-${toneId}-text`),
          );
        }
      }
    }

    expect(absences).toEqual(["busy.light", "failed.light", "off.light", "off.dark"]);
  });

  it.each(
    APPEARANCES.flatMap((appearance) =>
      (Object.keys(SERVICE_STATUS_TONES) as ReadonlyArray<ZeropsStatusTone>).map((tone) => ({
        appearance,
        tone,
      })),
    ),
  )(
    "keeps the $appearance $tone label at 4.5:1 on its surface and card",
    ({ appearance, tone }) => {
      const generatedBody = variantBody(generatedCss, appearance);
      const themeBody = variantBody(globalCss, appearance);
      const foreground = statusLabelColor(generatedBody, themeBody, tone);
      const statusSurface = variable(generatedBody, `--color-zerops-status-${tone}-surface`);
      const card = variable(themeBody, "--color-card");
      if (statusSurface === undefined || card === undefined) throw new Error("Missing background");

      expect(contrastRatio(foreground, statusSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, card)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
