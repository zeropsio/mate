import { Separator } from "~/components/ui/separator";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function SeparatorSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="A hairline between groups that spacing alone cannot part."
        title="Orientations"
      >
        <SpecimenGrid size="md">
          <Specimen label="<Separator>" note="Across">
            <div className="flex w-full max-w-64 flex-col gap-2 text-body">
              <span>Above</span>
              <Separator />
              <span>Below</span>
            </div>
          </Specimen>
          <Specimen label='<Separator orientation="vertical">' note="Upright">
            <div className="flex h-6 items-center gap-3 text-body">
              <span>Left</span>
              <Separator orientation="vertical" />
              <span>Right</span>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
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
