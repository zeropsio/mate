import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

import { definePlayground, jsxElement } from "../kitPlayground";

const SIDES = ["right", "left", "top", "bottom"] as const;
const VARIANTS = ["default", "inset"] as const;
const FOOTERS = ["default", "bare"] as const;

export default definePlayground({
  section: "sheet",
  name: "Sheet",
  imports:
    'import { Sheet, SheetClose, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle, SheetTrigger } from "~/components/ui/sheet";',
  controls: {
    side: { kind: "enum", options: SIDES, note: "the edge it slides from" },
    variant: { kind: "enum", options: VARIANTS, note: "inset floats it off the edge, rounded" },
    footer: { kind: "enum", options: FOOTERS },
    showCloseButton: { kind: "boolean" },
  },
  initial: { side: "right", variant: "default", footer: "default", showCloseButton: true },
  // Its opener: a sheet opens only when the person asks for the work beside the page.
  render: ({ side, variant, footer, showCloseButton }) => (
    <Sheet>
      <SheetTrigger render={<Button variant="secondary" />}>Manage addresses</SheetTrigger>
      <SheetPopup showCloseButton={showCloseButton} side={side} variant={variant}>
        <SheetHeader>
          <SheetTitle>Addresses</SheetTitle>
          <SheetDescription>Where people reach storefront.</SheetDescription>
        </SheetHeader>
        <SheetPanel>
          <div className="flex flex-col gap-2 text-body">
            <span>shop.example.com</span>
            <span>storefront-1a2b.prg1.zerops.app</span>
          </div>
        </SheetPanel>
        <SheetFooter variant={footer}>
          <SheetClose render={<Button variant="ghost" />}>Close</SheetClose>
          <Button>Add an address</Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  ),
  jsx: ({ side, variant, footer, showCloseButton }) =>
    jsxElement(
      "Sheet",
      {},
      [
        '<SheetTrigger render={<Button variant="secondary" />}>Manage addresses</SheetTrigger>',
        jsxElement(
          "SheetPopup",
          { side, variant, showCloseButton },
          [
            "<SheetHeader>",
            "  <SheetTitle>Addresses</SheetTitle>",
            "  <SheetDescription>Where people reach storefront.</SheetDescription>",
            "</SheetHeader>",
            "<SheetPanel>…</SheetPanel>",
            jsxElement(
              "SheetFooter",
              { variant: footer },
              '<SheetClose render={<Button variant="ghost" />}>Close</SheetClose>\n<Button>Add an address</Button>',
              { variant: "default" },
            ),
          ].join("\n"),
          { side: "right", variant: "default", showCloseButton: true },
        ),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Use it for work beside the page the person keeps in view: a vault, a list of addresses.",
      "Put its body in SheetPanel and its actions in SheetFooter: they carry the sheet's padding.",
      "Slide it from the end edge; a phone's bottom sheet comes from below.",
      "Press the opener to see it slide over this page.",
    ],
    dont: [
      "Ask a yes-or-no question in it: that is an AlertDialog.",
      "Open it for a short form sized to what it asks: that is a Dialog.",
    ],
  },
});
