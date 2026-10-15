import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

function Opener({ footer }: { readonly footer: "default" | "bare" }) {
  const [open, setOpen] = useState(false);
  return (
    <Specimen label={`<AlertDialogFooter ${specimenLabel({ variant: footer })}>`}>
      <Button onClick={() => setOpen(true)} variant="destructive-outline">
        Delete project
      </Button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete storefront?</AlertDialogTitle>
            <AlertDialogDescription>
              Its services, data and backups go with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter variant={footer}>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" />}>Delete</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Specimen>
  );
}

export default defineKitSection({
  id: "alert-dialog",
  title: "AlertDialog",
  purpose: "A confirmation that stops everything until the person answers.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/alert-dialog.tsx",
  render: () => (
    <SpecimenGrid>
      <Opener footer="default" />
      <Opener footer="bare" />
    </SpecimenGrid>
  ),
});
