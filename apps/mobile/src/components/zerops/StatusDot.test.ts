import { describe, expect, it } from "vite-plus/test";

import { statusDotPresentation } from "./presentation.ts";

const TONES = ["ok", "busy", "attention", "failed", "off"] as const;
const STATES = ["steady", "pulsing"] as const;

describe("statusDotPresentation", () => {
  it.each(TONES.flatMap((tone) => STATES.map((state) => ({ tone, state }))))(
    "presents $tone/$state with a phrase and stepped motion",
    ({ tone, state }) => {
      const presentation = statusDotPresentation({ label: "Service active", tone, state });

      expect(presentation).toMatchObject({
        label: "Service active",
        dotClassName: expect.stringContaining(`bg-zerops-status-${tone}-dot`),
        labelTone: tone,
        motion: {
          active: state === "pulsing",
          duration: 1_200,
          frameCount: 3,
          reducedMotionValue: 1,
          minimumOpacity: 0.55,
          opacityRange: 0.45,
        },
      });
      expect(presentation).not.toHaveProperty("labelState");
    },
  );

  it.each(TONES)("keeps %s impossible to render without a phrase", (tone) => {
    expect(() => statusDotPresentation({ label: "", tone, state: "steady" })).toThrow(
      "StatusDot requires a phrase",
    );
  });
});
