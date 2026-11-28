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
      options: ["default", "rich", "glass", "code"],
      note: "rich for a paragraph, code for paths and commands",
    },
    shortcut: { kind: "text", note: "the key that does the same" },
    side: { kind: "enum", options: ["top", "right", "bottom", "left"] },
    text: { kind: "text" },
    open: { kind: "boolean", note: "held open to read it" },
  },
  initial: { variant: "default", side: "top", text: "Deploy main", shortcut: "", open: true },
  render: ({ variant, side, text, shortcut, open }) => (
    <Tooltip open={open ? true : undefined}>
      <TooltipTrigger render={<Button aria-label="About deploys" size="icon-md" variant="ghost" />}>
        <InfoIcon />
      </TooltipTrigger>
      <TooltipPopup shortcut={shortcut === "" ? undefined : shortcut} side={side} variant={variant}>
        {text}
      </TooltipPopup>
    </Tooltip>
  ),
  jsx: ({ variant, side, text, shortcut }) =>
    jsxElement(
      "Tooltip",
      {},
      [
        '<TooltipTrigger render={<Button aria-label="About deploys" size="icon-md" variant="ghost" />}>',
        "  <InfoIcon />",
        "</TooltipTrigger>",
        jsxElement("TooltipPopup", { side, variant, shortcut }, text, {
          side: "top",
          variant: "default",
          shortcut: "",
        }),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Name an icon-only press in the same words as its aria-label.",
      "Keep it to a label: verb and object, sentence case, no period.",
      "Put the press's key in `shortcut`, never in the words.",
    ],
    dont: [
      "Hide something the person needs to act in a tooltip.",
      "Write a paragraph in a label; when the paragraph is the point, use `rich`.",
      "Use the browser's title attribute instead.",
    ],
  },
});
