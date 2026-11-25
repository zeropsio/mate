import { RefreshCwIcon, RotateCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { PanelBar } from "~/components/ui/panel-bar";
import { Tab, TabStrip } from "~/components/ui/tab-strip";
import { Text } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A side panel's top as it stands at the panel's default width: the bar, then what it heads. */
export function PanelStage({
  inline = false,
  children,
}: {
  readonly inline?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="flex h-36 w-full max-w-[33.75rem] flex-col overflow-hidden rounded-card border border-border bg-background"
      data-preview-panel-mode={inline ? "inline" : "sheet"}
    >
      {children}
      <div className="flex-1 px-3 py-2">
        <Text variant="note">What the bar heads</Text>
      </div>
    </div>
  );
}

/** A files pane's bar: its search, and its reload at the end. */
export function FilesBar() {
  return (
    <PanelBar>
      <InputGroup className="h-7 min-w-0 flex-1" variant="ghost">
        <InputGroupInput
          aria-label="Search files"
          placeholder="Search files"
          size="sm"
          type="search"
        />
      </InputGroup>
      <Button aria-label="Refresh files" size="icon-sm" variant="ghost">
        <RefreshCwIcon />
      </Button>
    </PanelBar>
  );
}

const TABS = [
  { id: "models", label: "Models" },
  { id: "configuration", label: "Configuration" },
];

export default defineKitSection({
  id: "panel-bar",
  title: "PanelBar",
  purpose:
    "The strip across a panel or a pane that holds its tools: a search, where it is, its reload, its tabs; a rule parts it from what it heads.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/ui/panel-bar.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="One row, 12 px in, 8 px between its parts, a rule under it."
        title="Heading a pane"
      >
        <SpecimenGrid size="lg">
          <Specimen align="start" label="<PanelBar>" note="A files pane: its search and its reload">
            <PanelStage>
              <FilesBar />
            </PanelStage>
          </Specimen>
          <Specimen align="start" label="<PanelBar>" note="A site's preview: where it is">
            <PanelStage>
              <PanelBar>
                <Text className="min-w-0 flex-1" variant="note">
                  tea-shop.example/menu
                </Text>
                <Button aria-label="Reload" size="icon-sm" variant="ghost">
                  <RotateCwIcon />
                </Button>
              </PanelBar>
            </PanelStage>
          </Specimen>
          <Specimen align="start" label='<PanelBar size="lg"> · <TabStrip>' note="A row of tabs">
            <PanelStage>
              <PanelBar size="lg">
                <TabStrip activeId="models" items={TABS} onSelect={() => {}}>
                  <Tab active tabId="models">
                    Models
                  </Tab>
                  <Tab active={false} tabId="configuration">
                    Configuration
                  </Tab>
                </TabStrip>
              </PanelBar>
            </PanelStage>
          </Specimen>
          <Specimen
            align="start"
            label="<PanelBar> beside the conversation"
            note="Under its side-panel page's head: no rule, 36 px"
          >
            <PanelStage inline>
              <FilesBar />
            </PanelStage>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
