import type { TYPE_SCALE } from "@t3tools/shared/brand";

type TypeStep = keyof typeof TYPE_SCALE;

/** The type steps as utilities; static, so the class guard can read them. */
export const TYPE_CLASS: Readonly<Record<TypeStep, string>> = {
  "5xs": "text-5xs",
  "4xs": "text-4xs",
  "3xs": "text-3xs",
  "2xs": "text-2xs",
  caption: "text-caption",
  line: "text-line",
  body: "text-body",
  prose: "text-prose",
  emphasis: "text-emphasis",
  typed: "text-typed",
  title: "text-title",
  display: "text-display",
};

/** What each step is for (brand.ts TYPE_SCALE). */
export const TYPE_USE: Readonly<Record<TypeStep, string>> = {
  "5xs": "The smallest badge on a provider's icon",
  "4xs": "A badge on a provider's icon",
  "3xs": "The densest metadata: diagnostics tables, tiny counters",
  "2xs": "Dense metadata: badges, counters, key hints",
  caption: "Meta, counts, a row's second line",
  line: "The conversation's quiet voice: a work line, an event, a log step",
  body: "Every control and most text",
  prose: "The conversation's prose: what the person wrote, the Mate's answer",
  emphasis: "A section's or a card's heading",
  typed: "What a phone's field types at: iOS zooms under 16 px",
  title: "A page's title",
  display: "A figure, a hero's one line",
};
