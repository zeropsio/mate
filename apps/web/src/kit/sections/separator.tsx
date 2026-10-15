import { Separator } from "~/components/ui/separator";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function SeparatorSpecimens() {
  return (
    <SpecimenGrid>
      <Specimen label='<Separator> (orientation="horizontal")'>
        <div className="flex w-64 flex-col gap-2 text-sm">
          <span>Above</span>
          <Separator />
          <span>Below</span>
        </div>
      </Specimen>
      <Specimen label='<Separator orientation="vertical">'>
        <div className="flex h-6 items-center gap-3 text-sm">
          <span>Left</span>
          <Separator orientation="vertical" />
          <span>Right</span>
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "separator",
  title: "Separator",
  purpose: "A hairline between groups that spacing alone cannot part.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/separator.tsx",
  render: () => <SeparatorSpecimens />,
});
