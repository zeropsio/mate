import { InfoIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "tooltip",
  name: "Tooltip",
  imports: 'import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";',
  controls: {
    variant: {
      kind: "enum",
      options: ["default", "glass", "code"],
      note: "code for paths and commands",
    },
    side: { kind: "enum", options: ["top", "right", "bottom", "left"] },
    text: { kind: "text" },
    open: { kind: "boolean", note: "held open to read it" },
  },
  initial: { variant: "default", side: "top", text: "Deploys main", open: true },
  render: ({ variant, side, text, open }) => (
    <Tooltip open={open ? true : undefined}>
      <TooltipTrigger render={<Button aria-label="About deploys" size="icon-md" variant="ghost" />}>
        <InfoIcon />
      </TooltipTrigger>
      <TooltipPopup side={side} variant={variant}>
        {text}
      </TooltipPopup>
    </Tooltip>
  ),
  jsx: ({ variant, side, text }) =>
    jsxElement(
      "Tooltip",
      {},
      [
        '<TooltipTrigger render={<Button aria-label="About deploys" size="icon-md" variant="ghost" />}>',
        "  <InfoIcon />",
        "</TooltipTrigger>",
        jsxElement("TooltipPopup", { side, variant }, text, { side: "top", variant: "default" }),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Name an icon-only press in the same words as its aria-label.",
      "Keep it to a line; the press's label already says the action.",
    ],
    dont: [
      "Hide something the person needs to act in a tooltip.",
      "Use the browser's title attribute instead.",
    ],
  },
});
