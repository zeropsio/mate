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
import { SpecimenBlock, SpecimenMatrix, Specimens } from "../Specimen";

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
    <Specimens>
      <SpecimenBlock
        note="Each press slides its sheet in from the edge it names."
        title="Variants and sides"
      >
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="side"
          columns={SIDES}
          render={(variant, side) => <Opener side={side} variant={variant} />}
        />
      </SpecimenBlock>
    </Specimens>
  ),
});
