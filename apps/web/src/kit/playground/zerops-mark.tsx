import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { ZeropsMark } from "~/components/ZeropsMark";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<NonNullable<ComponentProps<typeof ZeropsMark>["tone"]>>({
  brand: true,
  current: true,
});
const VARIANTS = variantsOf<NonNullable<ComponentProps<typeof ZeropsMark>["variant"]>>({
  platform: true,
  company: true,
});

/** Its holder's box: the mark takes the size of whatever holds it. */
const SIZE_CLASS = { "16": "size-4", "24": "size-6", "32": "size-8", "48": "size-12" } as const;
const SIZES = Object.keys(SIZE_CLASS) as (keyof typeof SIZE_CLASS)[];
const PLACES = ["page", "press"] as const;

export default definePlayground({
  section: "zerops-mark",
  name: "ZeropsMark",
  imports: 'import { ZeropsMark } from "~/components/ZeropsMark";',
  controls: {
    variant: {
      kind: "enum",
      options: VARIANTS,
      note: "company: Zerops the company, not the platform",
    },
    tone: { kind: "enum", options: TONES, note: "current: the ink of a place that has a colour" },
    size: { kind: "enum", options: SIZES, note: "its holder's box, in px" },
    place: { kind: "enum", options: PLACES, note: "press: inside a primary Button" },
  },
  initial: { variant: "platform", tone: "brand", size: "32", place: "page" },
  render: ({ variant, tone, size, place }) =>
    place === "press" ? (
      <Button>
        <ZeropsMark tone={tone} variant={variant} />
        {variant === "company" ? "Continue with your Zerops account" : "Open in Platform"}
      </Button>
    ) : (
      <ZeropsMark className={SIZE_CLASS[size]} tone={tone} variant={variant} />
    ),
  jsx: ({ variant, tone, size, place }) =>
    place === "press"
      ? jsxElement(
          "Button",
          {},
          `${jsxElement("ZeropsMark", { tone, variant }, undefined, { tone: "brand", variant: "platform" })}\n${variant === "company" ? "Continue with your Zerops account" : "Open in Platform"}`,
        )
      : jsxElement("ZeropsMark", { className: SIZE_CLASS[size], tone, variant }, undefined, {
          tone: "brand",
          variant: "platform",
        }),
  usage: {
    do: [
      "Use it where the platform itself is meant: Platform (app.zerops.io), its projects, its services.",
      'Use variant="company", the ring, only where Zerops the company is meant: "Mate by Zerops" and signing in with a Zerops account.',
      "Draw it current on a filled press or a coloured ground, where the two tones would fight.",
    ],
    dont: [
      "Use it for Mate or HQ: Mate has its own mark (MateMark).",
      'Name the platform "Zerops" as a place beside it: it is Platform.',
      "Recolour its tones.",
    ],
  },
});
