import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIDES = ["right", "left", "top", "bottom"] as const;
const VARIANTS = ["default", "inset"] as const;

function Opener({
  side,
  variant,
}: {
  readonly side: (typeof SIDES)[number];
  readonly variant: (typeof VARIANTS)[number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Specimen label={specimenLabel({ side, variant })}>
      <Button onClick={() => setOpen(true)} variant="outline">
        Open {side}
      </Button>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetPopup side={side} variant={variant}>
          <SheetHeader>
            <SheetTitle>Addresses</SheetTitle>
            <SheetDescription>Where people reach the project.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-6 pb-6 text-sm">
            <span>shop.example.com</span>
            <span>storefront-1a2b.prg1.zerops.app</span>
          </div>
        </SheetPopup>
      </Sheet>
    </Specimen>
  );
}

export default defineKitSection({
  id: "sheet",
  title: "Sheet",
  purpose: "A panel that slides over the page from an edge, for work beside it.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/sheet.tsx",
  render: () => (
    <SpecimenGrid>
      {VARIANTS.flatMap((variant) =>
        SIDES.map((side) => <Opener key={`${side}-${variant}`} side={side} variant={variant} />),
      )}
    </SpecimenGrid>
  ),
});
