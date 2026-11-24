import { FileIcon, FolderIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Row } from "~/components/ui/row";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

function RowSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="A tree, a dense list: xs">
        <SpecimenGrid>
          <Specimen label='size="xs" pressable lead={<FolderIcon />} meta'>
            <div className="w-72">
              <Row
                lead={<FolderIcon className="size-4" />}
                meta="12"
                pressable
                render={<button type="button" />}
                size="xs"
                title="src"
              />
              <Row
                lead={<FileIcon className="size-4" />}
                meta="4 KB"
                pressable
                render={<button type="button" />}
                size="xs"
                title="index.ts"
              />
            </div>
          </Specimen>
          <Specimen label='size="xs" pressable badges'>
            <div className="w-72">
              <Row
                badges={<Badge tone="info">2</Badge>}
                pressable
                render={<button type="button" />}
                size="xs"
                title="Open changes"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="A setting, an address: sm">
        <SpecimenGrid>
          <Specimen label='size="sm" line'>
            <div className="w-96">
              <Row line="Light, dark, or the same as your system." size="sm" title="Appearance" />
            </div>
          </Specimen>
          <Specimen label='size="sm" pressable meta'>
            <div className="w-96">
              <Row
                meta="Primary"
                pressable
                render={<button type="button" />}
                size="sm"
                title="storefront.zerops.app"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "row",
  title: "Row",
  purpose:
    "One row for every list: a leading mark, its title with badges and meta on one line, at most one muted line under it. Sizes follow what it leads with, from a tree's 24 px xs to the menu's lg; pressable lights its own ground.",
  group: "Chosen",
  kind: "Data",
  source: "apps/web/src/components/ui/row.tsx",
  render: () => <RowSpecimens />,
});
