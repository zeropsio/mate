import { ChevronRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function Sample({ defaultOpen }: { readonly defaultOpen: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
        <ChevronRightIcon />
        Build log
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-1 px-3 py-2 font-mono text-caption">
          <span>Installing dependencies</span>
          <span>Building the storefront</span>
          <span>Done in 41s</span>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function CollapsibleSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="Press the trigger to open or close it in place." title="Closed and open">
        <SpecimenGrid size="md">
          <Specimen align="start" label="<Collapsible>" note="Closed">
            <div className="w-full max-w-64">
              <Sample defaultOpen={false} />
            </div>
          </Specimen>
          <Specimen align="start" label="<Collapsible defaultOpen>" note="Open">
            <div className="w-full max-w-64">
              <Sample defaultOpen />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "collapsible",
  title: "Collapsible",
  purpose: "Detail that opens in place under its trigger.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/collapsible.tsx",
  render: () => <CollapsibleSpecimens />,
});
