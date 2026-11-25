import { useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const FOOTERS = ["default", "bare"] as const;
const CONFIRMS = ["destructive", "primary"] as const;

interface AskArgs {
  readonly footer: (typeof FOOTERS)[number];
  readonly confirm: (typeof CONFIRMS)[number];
  readonly title: string;
  readonly description: string;
  readonly action: string;
}

/** Its opener: an alert dialog opens only when the person asks for what it guards. */
function Ask({ footer, confirm, title, description, action }: AskArgs) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={confirm === "destructive" ? "destructive" : "secondary"}
      >
        {action}
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description === "" ? null : (
              <AlertDialogDescription>{description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter variant={footer}>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant={confirm === "destructive" ? "destructive" : "primary"} />}
            >
              {action}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

export default definePlayground({
  section: "alert-dialog",
  name: "AlertDialog",
  imports:
    'import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "~/components/ui/alert-dialog";',
  controls: {
    footer: { kind: "enum", options: FOOTERS, note: "default sets its presses on a tinted band" },
    confirm: {
      kind: "enum",
      options: CONFIRMS,
      note: "destructive for what cannot be undone",
    },
    title: { kind: "text", note: "the question, with the thing's name" },
    description: { kind: "text", note: "what goes with it; empty for none" },
    action: { kind: "text", note: "the press that does it, in the title's verb" },
  },
  initial: {
    footer: "default",
    confirm: "destructive",
    title: "Delete storefront?",
    description: "Its services, data and backups go with it. This cannot be undone.",
    action: "Delete project",
  },
  render: (args) => <Ask {...args} />,
  jsx: ({ footer, confirm, title, description, action }) =>
    jsxElement(
      "AlertDialog",
      { open: jsxCode("open"), onOpenChange: jsxCode("setOpen") },
      jsxElement(
        "AlertDialogPopup",
        {},
        [
          jsxElement(
            "AlertDialogHeader",
            {},
            [
              `<AlertDialogTitle>${title}</AlertDialogTitle>`,
              description === ""
                ? ""
                : `<AlertDialogDescription>${description}</AlertDialogDescription>`,
            ]
              .filter((part) => part !== "")
              .join("\n"),
          ),
          jsxElement(
            "AlertDialogFooter",
            { variant: footer },
            [
              '<AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>',
              confirm === "destructive"
                ? `<AlertDialogClose render={<Button variant="destructive" />}>${action}</AlertDialogClose>`
                : `<AlertDialogClose render={<Button />}>${action}</AlertDialogClose>`,
            ].join("\n"),
            { variant: "default" },
          ),
        ].join("\n"),
      ),
    ),
  usage: {
    do: [
      "Ask before something that cannot be undone, or that reaches Production.",
      "Title it with the question and the thing's name; end it with the press that does it, in the same verb.",
      "Press the opener to see it over this page.",
    ],
    dont: [
      "Ask for something the person can undo: do it, and offer Undo in a Toast.",
      "Put a form or a choice in it: that is a Dialog.",
      "Open one by itself: it answers the person's own press.",
    ],
  },
});
