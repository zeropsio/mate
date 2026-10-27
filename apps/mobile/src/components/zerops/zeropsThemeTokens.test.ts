// @effect-diagnostics nodeBuiltinImport:off -- This test reads the generated CSS it verifies.
import * as NodeFS from "node:fs";
import { CHIP_TINTS, SERVICE_STATUS_TONES } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

const generatedCss = NodeFS.readFileSync(
  new URL("../../../generated-uniwind-themes.css", import.meta.url),
  "utf8",
);
const APPEARANCES = ["light", "dark"] as const;

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

function formatCssColor(value: string) {
  const rgba = /^rgba\((\d+),(\d+),(\d+),(\.\d+)\)$/u.exec(value);
  return rgba ? `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, 0${rgba[4]})` : value;
}

describe("mobile Zerops primitive tokens", () => {
  it.each(APPEARANCES)(
    "keeps the %s status variables equal to SERVICE_STATUS_TONES",
    (appearance) => {
      const body = variantBody(generatedCss, appearance);

      for (const [toneId, appearances] of Object.entries(SERVICE_STATUS_TONES)) {
        const tone = appearances[appearance];
        expect(variable(body, `--color-zerops-status-${toneId}-dot`)).toBe(tone.dot);
        if ("text" in tone) {
          expect(variable(body, `--color-zerops-status-${toneId}-text`)).toBe(tone.text);
        } else {
          expect(variable(body, `--color-zerops-status-${toneId}-text`)).toBeUndefined();
        }
        expect(variable(body, `--color-zerops-status-${toneId}-surface`)).toBe(tone.surface);
      }
    },
  );

  it.each(APPEARANCES)("keeps the %s chip variables equal to CHIP_TINTS", (appearance) => {
    const body = variantBody(generatedCss, appearance);
    const toneIds = {
      access: "access-green",
      region: "region-purple",
      info: "info-chip",
    } as const;

    for (const [toneId, sourceId] of Object.entries(toneIds)) {
      const tint = CHIP_TINTS[sourceId][appearance];
      expect(variable(body, `--color-zerops-chip-${toneId}-surface`)).toBe(
        formatCssColor(tint.surface),
      );
      expect(variable(body, `--color-zerops-chip-${toneId}-text`)).toBe(formatCssColor(tint.text));
    }
  });

  it.each([
    ["light", "transparent"],
    ["dark", "rgba(255, 255, 255, 0.06)"],
  ] as const)("pins the %s flat-card border to brand FLAT_CARD_BORDER", (appearance, expected) => {
    expect(variable(variantBody(generatedCss, appearance), "--color-zerops-flat-card-border")).toBe(
      expected,
    );
  });
});
