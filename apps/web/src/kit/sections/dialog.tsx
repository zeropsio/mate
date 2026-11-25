import { useState } from "react";

import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
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

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const LONG = Array.from(
  { length: 30 },
  (_, index) => `Line ${index + 1} of a long body that scrolls inside the dialog's panel.`,
);

function Opener({
  label,
  note,
  footer = "default",
  showCloseButton = true,
  long = false,
  size = "default",
}: {
  readonly size?: "default" | "sm";
  readonly label: string;
  readonly note: string;
  readonly footer?: "default" | "bare";
  readonly showCloseButton?: boolean;
  readonly long?: boolean;
}) {
  return (
    <Specimen label={label} note={note}>
      <Dialog>
        <DialogTrigger render={<Button variant="secondary" />}>Open</DialogTrigger>
        <DialogPopup showCloseButton={showCloseButton} size={size}>
          <DialogHeader>
            <DialogTitle>Rename the project</DialogTitle>
            <DialogDescription>Its address stays the same.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {long ? (
              <div className="flex flex-col gap-2 text-body">
                {LONG.map((line) => (
                  <p className="m-0" key={line}>
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <Input aria-label="Name" defaultValue="storefront" />
            )}
          </DialogPanel>
          <DialogFooter variant={footer}>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <DialogClose render={<Button />}>Rename</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </Specimen>
  );
}

/** A made-up screenshot: a page with a header, a card and a button, drawn as SVG. */
const PICTURE_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#f4f6f8"/>
    <rect width="1200" height="72" fill="#1f2937"/>
    <rect x="40" y="24" width="160" height="24" rx="6" fill="#3cbdb2"/>
    <rect x="80" y="140" width="640" height="420" rx="20" fill="#ffffff" stroke="#d6dbe1"/>
    <rect x="120" y="190" width="420" height="28" rx="6" fill="#1f2937"/>
    <rect x="120" y="240" width="520" height="16" rx="5" fill="#9aa4b1"/>
    <rect x="120" y="470" width="180" height="48" rx="10" fill="#0a84ff"/>
    <rect x="780" y="140" width="340" height="420" rx="20" fill="#e3f4f2"/>
  </svg>`,
)}`;

/** A picture over everything (`DialogMediaPopup`), as a conversation's picture opens. */
function MediaOpener() {
  const [open, setOpen] = useState(false);
  return (
    <Specimen
      label="<DialogMediaPopup>"
      note="A conversation's picture, opened"
      source="apps/web/src/components/chat/ExpandedImageDialog.tsx"
    >
      <Button onClick={() => setOpen(true)} variant="secondary">
        Open the picture
      </Button>
      {open ? (
        <ExpandedImageDialog
          onClose={() => setOpen(false)}
          preview={{ images: [{ src: PICTURE_SRC, name: "Checkout page" }], index: 0 }}
        />
      ) : null}
    </Specimen>
  );
}

/**
 * A dialog whose step says less than the one before: it stays the height it was and where it was
 * (top-anchored, never re-centred), its button where the person saw it.
 */
function SteppingOpener() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Specimen label="<DialogPopup>" note="A next step that says less: it keeps its height">
      <Dialog
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDone(false);
        }}
        open={open}
      >
        <Button onClick={() => setOpen(true)} variant="secondary">
          Open
        </Button>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{done ? "Claude is signed in" : "Sign in Claude"}</DialogTitle>
            <DialogDescription>
              {done
                ? "Fen can work now."
                : "Open the sign-in page, approve Mate there, and paste the code it shows you back here. The code is good for ten minutes."}
            </DialogDescription>
          </DialogHeader>
          {done ? null : (
            <DialogPanel>
              <p className="m-0 text-muted-foreground text-body">
                The sign-in page opens in a new tab; this dialog waits for its code.
              </p>
            </DialogPanel>
          )}
          <DialogFooter>
            {done ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <Button onClick={() => setDone(true)}>Paste the code</Button>
            )}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </Specimen>
  );
}

export default defineKitSection({
  id: "dialog",
  title: "Dialog",
  purpose:
    "A focused task over the page that the person finishes or cancels: top-anchored, it never shrinks or re-centres while open; DialogMediaPopup holds a picture.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/dialog.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="Each press opens the dialog it names." title="Footers and closing">
        <SpecimenGrid size="md">
          <Opener label='<DialogFooter variant="default">' note="A footer on its own band" />
          <Opener
            footer="bare"
            label='<DialogFooter variant="bare">'
            note="A footer on the body's ground"
          />
          <Opener
            label="<DialogPopup showCloseButton={false}>"
            note="Closed only by its footer"
            showCloseButton={false}
          />
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Sizes and bodies">
        <SpecimenGrid size="md">
          <Opener label='<DialogPopup size="sm">' note="A small dialog" size="sm" />
          <Opener label="<DialogPanel>" long note="A long body that scrolls inside its panel" />
          <SteppingOpener />
          <MediaOpener />
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
