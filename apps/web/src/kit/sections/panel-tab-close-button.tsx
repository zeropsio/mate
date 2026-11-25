import { FileIcon } from "lucide-react";

import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function Tab({ tooltip }: { readonly tooltip?: string }) {
  return (
    <div className="group/tab flex h-8 items-center gap-2 rounded-control border px-2 text-body">
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
    <Specimens>
      <SpecimenBlock title="On hover and focus">
        <SpecimenGrid size="md">
          <Specimen label='label="Close index.ts"' note="Hover the tab: its icon turns to close">
            <Tab />
          </Specimen>
          <Specimen label='tooltip="Close"' note="With a tooltip on its close">
            <Tab tooltip="Close" />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
