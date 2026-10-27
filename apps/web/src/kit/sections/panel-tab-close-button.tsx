import { FileIcon } from "lucide-react";

import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function Tab({ tooltip }: { readonly tooltip?: string }) {
  return (
    <div className="group/tab flex h-8 items-center gap-2 rounded-md border px-2 text-sm">
      <PanelTabCloseButton
        label="Close index.ts"
        onClick={() => {}}
        {...(tooltip === undefined ? {} : { tooltip })}
      >
        <FileIcon />
      </PanelTabCloseButton>
      index.ts
    </div>
  );
}

export default defineKitSection({
  id: "panel-tab-close-button",
  title: "PanelTabCloseButton",
  purpose: "A tab's icon that turns into its close button on hover or focus.",
  group: "Kit",
  kind: "Actions",
  source: "apps/web/src/components/ui/panel-tab-close-button.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label='label="Close index.ts" (hover the tab)'>
        <Tab />
      </Specimen>
      <Specimen label='tooltip="Close"'>
        <Tab tooltip="Close" />
      </Specimen>
    </SpecimenGrid>
  ),
});
