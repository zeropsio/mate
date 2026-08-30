import { describe, expect, it } from "vite-plus/test";

import { keyChipPresentation } from "./presentation.ts";

describe("keyChipPresentation", () => {
  it.each([
    ["default", "default", "bg-subtle", "text-foreground", "opacity-100"],
    ["default", "pressed", "bg-subtle", "text-foreground", "opacity-70"],
    ["accent", "default", "bg-primary", "text-primary-foreground", "opacity-100"],
    ["accent", "pressed", "bg-primary", "text-primary-foreground", "opacity-70"],
  ] as const)(
    "presents %s/%s",
    (tone, state, backgroundClassName, textClassName, opacityClassName) => {
      const presentation = keyChipPresentation({ label: "K", variant: tone, state });

      expect(presentation.label).toBe("K");
      expect(presentation.containerClassName).toContain("rounded-[3px]");
      expect(presentation.containerClassName).toContain(backgroundClassName);
      expect(presentation.containerClassName).toContain(opacityClassName);
      expect(presentation.textClassName).toContain(textClassName);
    },
  );
});
