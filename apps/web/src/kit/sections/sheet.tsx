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
  return (
    <Specimen label={specimenLabel({ side, variant })}>
      <Sheet>
        <SheetTrigger render={<Button variant="secondary" />}>Open {side}</SheetTrigger>
        <SheetPopup side={side} variant={variant}>
          <SheetHeader>
            <SheetTitle>Addresses</SheetTitle>
            <SheetDescription>Where people reach the project.</SheetDescription>
          </SheetHeader>
          <SheetPanel>
            <div className="flex flex-col gap-2 text-body">
              <span>shop.example.com</span>
              <span>storefront-1a2b.prg1.zerops.app</span>
            </div>
          </SheetPanel>
          <SheetFooter>
            <SheetClose render={<Button variant="ghost" />}>Close</SheetClose>
            <Button>Add an address</Button>
          </SheetFooter>
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
