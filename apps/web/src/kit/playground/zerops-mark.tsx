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
/** Named, the holder gives it a height and its width follows. */
const NAMED_SIZE_CLASS = {
  "16": "h-4 w-auto text-foreground",
  "24": "h-6 w-auto text-foreground",
  "32": "h-8 w-auto text-foreground",
  "48": "h-12 w-auto text-foreground",
} as const;
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
    named: { kind: "boolean", note: "the word after it: the logo in a page's corner" },
    place: { kind: "enum", options: PLACES, note: "press: inside a primary Button" },
  },
  initial: { variant: "platform", tone: "brand", size: "32", place: "page", named: false },
  render: ({ variant, tone, size, place, named }) =>
    place === "press" ? (
      <Button>
        <ZeropsMark tone={tone} variant={variant} />
        {variant === "company" ? "Continue with your Zerops account" : "Open in Platform"}
      </Button>
    ) : (
      <ZeropsMark
        className={(named ? NAMED_SIZE_CLASS : SIZE_CLASS)[size]}
        named={named}
        tone={tone}
        variant={variant}
      />
    ),
  jsx: ({ variant, tone, size, place, named }) =>
    place === "press"
      ? jsxElement(
          "Button",
          {},
          `${jsxElement("ZeropsMark", { tone, variant }, undefined, { tone: "brand", variant: "platform" })}\n${variant === "company" ? "Continue with your Zerops account" : "Open in Platform"}`,
        )
      : jsxElement(
          "ZeropsMark",
          { className: (named ? NAMED_SIZE_CLASS : SIZE_CLASS)[size], named, tone, variant },
          undefined,
          { named: false, tone: "brand", variant: "platform" },
        ),
  usage: {
    do: [
      "Use it where the platform itself is meant: Platform (app.zerops.io), its projects, its services.",
      'Use variant="company", the ring, only where Zerops the company is meant: "Mate by Zerops" and signing in with a Zerops account.',
      "Draw it current on a filled press or a coloured ground, where the two tones would fight.",
      "Name it (named) as the logo in the corner of a page that stands without the menu, such as the first run.",
    ],
    dont: [
      "Use it for Mate or HQ: Mate has its own mark (MateMark).",
      'Name the platform "Zerops" as a place beside it: it is Platform.',
      "Recolour its tones.",
    ],
  },
});
