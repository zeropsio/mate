import { describe, expect, it } from "vite-plus/test";

import { pillPresentation } from "./presentation.ts";

describe("pillPresentation", () => {
  it.each([
    ["primary", "enabled", "bg-primary", "text-primary-foreground", false, "opacity-100"],
    ["primary", "disabled", "bg-primary", "text-primary-foreground", true, "opacity-45"],
    ["secondary", "enabled", "bg-secondary", "text-secondary-foreground", false, "opacity-100"],
    ["secondary", "disabled", "bg-secondary", "text-secondary-foreground", true, "opacity-45"],
  ] as const)(
    "presents %s/%s",
    (tone, state, backgroundClassName, textClassName, disabled, opacityClassName) => {
      const presentation = pillPresentation({ label: "Deploy", variant: tone, state });

      expect(presentation).toMatchObject({ label: "Deploy", disabled });
      expect(presentation.containerClassName).toContain("rounded-full");
      expect(presentation.containerClassName).toContain(backgroundClassName);
      expect(presentation.containerClassName).toContain(opacityClassName);
      expect(presentation.textClassName).toContain(textClassName);
    },
  );
});
