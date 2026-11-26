import { ScrollArea } from "~/components/ui/scroll-area";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const ROWS = Array.from(
  { length: 24 },
  (_, index) => `Deploy ${24 - index}: built in ${30 + index}s`,
);

function Rows() {
  return (
    <div className="flex flex-col gap-1 p-3 text-body">
      {ROWS.map((row) => (
        <span key={row}>{row}</span>
      ))}
    </div>
  );
}

function ScrollAreaSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="Scroll each frame to see its bars." title="Bars and fades">
        <SpecimenGrid size="md">
          {[
            { label: "<ScrollArea>", props: {} },
            { label: "<ScrollArea scrollFade>", props: { scrollFade: true } },
            { label: "<ScrollArea hideScrollbars>", props: { hideScrollbars: true } },
            { label: "<ScrollArea scrollbarGutter>", props: { scrollbarGutter: true } },
          ].map(({ label, props }) => (
            <Specimen key={label} label={label}>
              <div className="h-48 w-full max-w-56 rounded-card border">
                <ScrollArea {...props}>
                  <Rows />
                </ScrollArea>
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Sideways">
        <SpecimenGrid size="md">
          <Specimen label="<ScrollArea>" note="A line wider than its frame">
            <div className="h-20 w-full max-w-56 rounded-card border">
              <ScrollArea>
                <div className="w-max p-3 font-mono text-body">
                  zcli push --service-id storefront --workspace-state all --verbose
                </div>
              </ScrollArea>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "scroll-area",
  title: "ScrollArea",
  purpose: "A region that scrolls inside a fixed frame, with the app's thin bars.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/scroll-area.tsx",
  render: () => <ScrollAreaSpecimens />,
});
