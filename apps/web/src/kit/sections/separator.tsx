import { Separator } from "~/components/ui/separator";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function SeparatorSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="A hairline between two parts that spacing alone cannot part, in the rule ink every divider shares."
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
      <SpecimenBlock
        note="Words on the line: a break in a sequence, or an or between two ways in."
        title="Labelled"
      >
        <SpecimenGrid size="md">
          <Specimen label="<Separator>Yesterday</Separator>" note="A day in a conversation">
            <div className="w-full max-w-64">
              <Separator>Yesterday</Separator>
            </div>
          </Specimen>
          <Specimen label='<Separator tone="info">' note="Where the unread part begins">
            <div className="w-full max-w-64">
              <Separator tone="info">New since 10:42</Separator>
            </div>
          </Specimen>
          <Specimen label="<Separator>or</Separator>" note="Between two ways in">
            <div className="w-full max-w-64">
              <Separator>or</Separator>
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
  purpose: "A hairline between two parts, upright between items on a line, or with words on it.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/separator.tsx",
  render: () => <SeparatorSpecimens />,
});
