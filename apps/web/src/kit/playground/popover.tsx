import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type PopoverProps = ComponentProps<typeof PopoverPopup>;
type PopoverVariant = NonNullable<PopoverProps["variant"]>;
type PopoverWidth = NonNullable<PopoverProps["width"]>;
type PopoverPadding = NonNullable<PopoverProps["padding"]>;

const VARIANTS = variantsOf<PopoverVariant>({ default: true, tooltip: true });
const WIDTHS = variantsOf<PopoverWidth>({ auto: true, sm: true, md: true, lg: true, xl: true });
const PADDINGS = variantsOf<PopoverPadding>({ default: true, compact: true, none: true });
const SIDES = ["bottom", "top", "right", "left"] as const;
const ALIGNS = ["start", "center", "end"] as const;

const LINE = "Saved to the project's vault.";
const PROSE = "Everyone on the team sees the preview; the public does not.";

export default definePlayground({
  section: "popover",
  name: "Popover",
  imports:
    'import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";',
  controls: {
    variant: {
      kind: "enum",
      options: VARIANTS,
      note: "tooltip: one line that answers a press; it fits its words, so no width or padding",
    },
    width: {
      kind: "enum",
      options: WIDTHS,
      note: "fixed for prose and forms, capped to the screen",
    },
    padding: {
      kind: "enum",
      options: PADDINGS,
      note: "compact for a list, none for content with its own edge",
    },
    side: { kind: "enum", options: SIDES },
    align: { kind: "enum", options: ALIGNS },
  },
  initial: {
    variant: "default",
    width: "md",
    padding: "default",
    side: "bottom",
    align: "center",
  },
  render: ({ variant, width, padding, side, align }) => (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary" />}>Who can open it</PopoverTrigger>
      {variant === "tooltip" ? (
        <PopoverPopup align={align} side={side} variant="tooltip">
          {LINE}
        </PopoverPopup>
      ) : (
        <PopoverPopup align={align} padding={padding} side={side} width={width}>
          <div className="flex flex-col gap-2">
            <PopoverTitle>Who can open it</PopoverTitle>
            <p className="m-0 text-body">{PROSE}</p>
            <div className="flex justify-end">
              <PopoverClose render={<Button size="sm" variant="secondary" />}>Done</PopoverClose>
            </div>
          </div>
        </PopoverPopup>
      )}
    </Popover>
  ),
  jsx: ({ variant, width, padding, side, align }) =>
    jsxElement(
      "Popover",
      {},
      [
        '<PopoverTrigger render={<Button variant="secondary" />}>Who can open it</PopoverTrigger>',
        jsxElement(
          "PopoverPopup",
          variant === "tooltip" ? { variant, side, align } : { width, padding, side, align },
          variant === "tooltip"
            ? LINE
            : [
                "<PopoverTitle>Who can open it</PopoverTitle>",
                `<p>${PROSE}</p>`,
                '<PopoverClose render={<Button size="sm" variant="secondary" />}>Done</PopoverClose>',
              ].join("\n"),
          {
            width: "auto",
            padding: "default",
            side: "bottom",
            align: "center",
          },
        ),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Tie a little prose or a short form to the press that opened it.",
      "Close it with a press of its own when it holds a form, or by pressing outside.",
      "Press the trigger to open it here.",
    ],
    dont: [
      "List actions in it: that is a Menu.",
      "Name an icon-only press with it: that is a Tooltip.",
      "Hold a flow with several steps or a long form: that is a Dialog or a Sheet.",
    ],
  },
});
