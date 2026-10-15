import { ChevronRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function Sample({ defaultOpen }: { readonly defaultOpen: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger render={<Button size="md" variant="ghost" />}>
        <ChevronRightIcon />
        Build log
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-1 px-3 py-2 font-mono text-xs">
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
    <SpecimenGrid>
      <Specimen label="<Collapsible> (closed)">
        <div className="w-64">
          <Sample defaultOpen={false} />
        </div>
      </Specimen>
      <Specimen label="<Collapsible defaultOpen>">
        <div className="w-64">
          <Sample defaultOpen />
        </div>
      </Specimen>
    </SpecimenGrid>
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
