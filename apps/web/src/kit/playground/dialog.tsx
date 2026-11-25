import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "dialog",
  name: "Dialog",
  imports:
    'import { Dialog, DialogClose, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from "~/components/ui/dialog";',
  controls: {
    size: { kind: "enum", options: ["default", "sm"] },
    placement: {
      kind: "enum",
      options: ["top", "center"],
      note: "center for a form sized to what it asks",
    },
    backdrop: { kind: "enum", options: ["blur", "plain"] },
    footer: { kind: "enum", options: ["default", "bare"] },
    showCloseButton: { kind: "boolean" },
    title: { kind: "text" },
  },
  initial: {
    size: "default",
    placement: "top",
    backdrop: "blur",
    footer: "default",
    showCloseButton: true,
    title: "Rename the project",
  },
  render: ({ size, placement, backdrop, footer, showCloseButton, title }) => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>Open the dialog</DialogTrigger>
      <DialogPopup
        backdrop={backdrop}
        placement={placement}
        showCloseButton={showCloseButton}
        size={size}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Its address stays the same.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input aria-label="Name" defaultValue="storefront" />
        </DialogPanel>
        <DialogFooter variant={footer}>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose render={<Button />}>Rename</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  ),
  jsx: ({ size, placement, backdrop, footer, showCloseButton, title }) =>
    jsxElement(
      "Dialog",
      {},
      [
        '<DialogTrigger render={<Button variant="secondary" />}>Open the dialog</DialogTrigger>',
        jsxElement(
          "DialogPopup",
          { size, placement, backdrop, showCloseButton },
          [
            `<DialogHeader>\n  <DialogTitle>${title}</DialogTitle>\n</DialogHeader>`,
            "<DialogPanel>…</DialogPanel>",
            jsxElement(
              "DialogFooter",
              { variant: footer },
              '<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>\n<DialogClose render={<Button />}>Rename</DialogClose>',
              { variant: "default" },
            ),
          ].join("\n"),
          { size: "default", placement: "top", backdrop: "blur", showCloseButton: true },
        ),
      ].join("\n"),
    ),
  usage: {
    do: [
      "Title it with what it does, and end its footer with the press that does it.",
      "Press Open the dialog to see it over this page.",
    ],
    dont: ["Open one by itself: a view opens when the person asks."],
  },
});
