import { describe, expect, it } from "vite-plus/test";

import { chipPresentation } from "./presentation.ts";

describe("chipPresentation", () => {
  it.each([
    ["access", "default", "rounded-[10px]", "bg-zerops-chip-access-surface", "opacity-100"],
    ["access", "muted", "rounded-[10px]", "bg-zerops-chip-access-surface", "opacity-45"],
    ["region", "default", "rounded-[10px]", "bg-zerops-chip-region-surface", "opacity-100"],
    ["region", "muted", "rounded-[10px]", "bg-zerops-chip-region-surface", "opacity-45"],
    ["info", "default", "rounded-[8px]", "bg-zerops-chip-info-surface", "opacity-100"],
    ["info", "muted", "rounded-[8px]", "bg-zerops-chip-info-surface", "opacity-45"],
  ] as const)(
    "presents %s/%s",
    (tone, state, radiusClassName, surfaceClassName, opacityClassName) => {
      const presentation = chipPresentation({ label: "Full access", variant: tone, state });

      expect(presentation.label).toBe("Full access");
      expect(presentation.containerClassName).toContain(radiusClassName);
      expect(presentation.containerClassName).toContain(surfaceClassName);
      expect(presentation.containerClassName).toContain(opacityClassName);
      expect(presentation.textClassName).toContain(`text-zerops-chip-${tone}-text`);
    },
  );
});
