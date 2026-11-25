import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const SIDES = ["right", "left", "top", "bottom"] as const;
const VARIANTS = ["default", "inset"] as const;

interface DrawerArgs {
  readonly side: (typeof SIDES)[number];
  readonly variant: (typeof VARIANTS)[number];
  readonly showCloseButton: boolean;
}

/** Its opener: a sheet opens only when the person asks for the work beside the page. */
function Drawer({ side, variant, showCloseButton }: DrawerArgs) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Manage addresses
      </Button>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetPopup showCloseButton={showCloseButton} side={side} variant={variant}>
          <SheetHeader>
            <SheetTitle>Addresses</SheetTitle>
            <SheetDescription>Where people reach storefront.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-6 pb-6 text-body">
            <span>shop.example.com</span>
            <span>storefront-1a2b.prg1.zerops.app</span>
          </div>
        </SheetPopup>
      </Sheet>
    </>
  );
}

export default definePlayground({
  section: "sheet",
  name: "Sheet",
  imports:
    'import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "~/components/ui/sheet";',
  controls: {
    side: { kind: "enum", options: SIDES, note: "the edge it slides from" },
    variant: { kind: "enum", options: VARIANTS, note: "inset floats it off the edge, rounded" },
    showCloseButton: { kind: "boolean" },
  },
  initial: { side: "right", variant: "default", showCloseButton: true },
  render: (args) => <Drawer {...args} />,
  jsx: ({ side, variant, showCloseButton }) =>
    jsxElement(
      "Sheet",
      { open: jsxCode("open"), onOpenChange: jsxCode("setOpen") },
      jsxElement(
        "SheetPopup",
        { side, variant, showCloseButton },
        [
          "<SheetHeader>",
          "  <SheetTitle>Addresses</SheetTitle>",
          "  <SheetDescription>Where people reach storefront.</SheetDescription>",
          "</SheetHeader>",
          '<div className="flex flex-col gap-2 px-6 pb-6 text-body">',
          "  <span>shop.example.com</span>",
          "  <span>storefront-1a2b.prg1.zerops.app</span>",
          "</div>",
        ].join("\n"),
        { side: "right", variant: "default", showCloseButton: true },
      ),
    ),
  usage: {
    do: [
      "Use it for work beside the page the person keeps in view: a vault, a list of addresses.",
      "Slide it from the end edge; a phone's bottom sheet comes from below.",
      "Press the opener to see it slide over this page.",
    ],
    dont: [
      "Ask a yes-or-no question in it: that is an AlertDialog.",
      "Open it for a short form sized to what it asks: that is a Dialog.",
    ],
  },
});
