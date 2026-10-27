import { createShadcnGuardRule, UI_SOURCE_MARKER, WEB_SOURCE_MARKER } from "../shadcnGuard.ts";

/**
 * Appearance values come from the theme and Tailwind's scales: `p-[13px]` or `text-[11px]` is a
 * value the design system cannot see or change. Upstream's `shadcn/no-arbitrary-values` with the
 * options upstream configures, behind the design-system exception ledger.
 */

/**
 * Layout stays free (placement belongs to the parent); the other entries are values no scale
 * can hold.
 */
export const NO_ARBITRARY_VALUES_OPTIONS = {
  allow: [
    "layout",
    // Which properties an element animates is per-element behaviour, like layout, not a design
    // value; timing curves and durations still come from the theme.
    "transition",
    // Inline chips size in em so they scale with the text they sit in (the composer honours the
    // prompt font-size preference).
    "gap-[0.33em]",
    "px-[0.5em]",
    "rounded-[0.5em]",
    "text-[0.86em]",
    // Project icons render from 14px to 48px and keep one proportional corner.
    "rounded-[25%]",
    // The platform's own selection colour on a selected composer chip.
    "bg-[Highlight]",
    // Brand marks keep their brand colours (Cursor, Grok, Claude).
    "fill-[#26251E]",
    "fill-[#EDECEC]",
    "fill-[#0F0F0F]",
    "fill-[#F5F5F5]",
    "fill-[#d97757]",
    "text-[#d97757]",
  ],
};

export default createShadcnGuardRule({
  ruleName: "no-arbitrary-values",
  innerRuleName: "no-arbitrary-values",
  ledgerDirectoryEnv: "T3CODE_NO_ARBITRARY_VALUES_LEDGER_DIRECTORY",
  options: NO_ARBITRARY_VALUES_OPTIONS,
  inScope: (filename) =>
    filename.includes(WEB_SOURCE_MARKER) && !filename.includes(UI_SOURCE_MARKER),
  description:
    "Appearance values in web code come from the theme and Tailwind's scales, with fingerprinted exceptions for existing call sites.",
});
