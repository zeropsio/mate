import { describe, expect, it } from "vite-plus/test";

import { flatCardPresentation } from "./presentation.ts";

const TONES = [undefined, "ok", "busy", "attention", "failed", "off"] as const;
const STATES = ["default", "emphasized"] as const;

describe("flatCardPresentation", () => {
  it.each(TONES.flatMap((tone) => STATES.map((state) => ({ tone, state }))))(
    "presents $tone/$state without a shadow",
    ({ tone, state }) => {
      const presentation = flatCardPresentation({ tone, state });

      expect(presentation.containerClassName).toContain("rounded-[10px]");
      expect(presentation.containerClassName).toContain(
        tone === undefined ? "bg-card" : `bg-zerops-status-${tone}-surface`,
      );
      expect(presentation.containerClassName).toContain(
        state === "emphasized" ? "border-primary" : "border-zerops-flat-card-border",
      );
      expect(presentation.containerClassName).not.toContain("shadow");
    },
  );
});
