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
import { Specimen, SpecimenGrid } from "../Specimen";

const LONG = Array.from(
  { length: 30 },
  (_, index) => `Line ${index + 1} of a long body that scrolls inside the dialog's panel.`,
);

function Opener({
  label,
  footer = "default",
  showCloseButton = true,
  long = false,
}: {
  readonly label: string;
  readonly footer?: "default" | "bare";
  readonly showCloseButton?: boolean;
  readonly long?: boolean;
}) {
  return (
    <Specimen label={label}>
      <Dialog>
        <DialogTrigger render={<Button variant="secondary" />}>Open</DialogTrigger>
        <DialogPopup showCloseButton={showCloseButton}>
          <DialogHeader>
            <DialogTitle>Rename the project</DialogTitle>
            <DialogDescription>Its address stays the same.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {long ? (
              <div className="flex flex-col gap-2 text-sm">
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

export default defineKitSection({
  id: "dialog",
  title: "Dialog",
  purpose: "A focused task over the page that the person finishes or cancels.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/dialog.tsx",
  render: () => (
    <SpecimenGrid>
      <Opener label='<DialogPopup> · <DialogFooter variant="default">' />
      <Opener footer="bare" label='<DialogFooter variant="bare">' />
      <Opener label="<DialogPopup showCloseButton={false}>" showCloseButton={false} />
      <Opener label="long body in <DialogPanel>" long />
    </SpecimenGrid>
  ),
});
