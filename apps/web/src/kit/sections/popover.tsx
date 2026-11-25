import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const WIDTHS = ["auto", "sm", "md", "lg"] as const;
const PADDINGS = ["default", "compact", "none"] as const;

function Body() {
  return (
    <div className="flex flex-col gap-2">
      <PopoverTitle>Who can open it</PopoverTitle>
      <p className="m-0 text-body">Everyone on the team sees the preview; the public does not.</p>
      <div className="flex justify-end">
        <PopoverClose render={<Button size="sm" variant="secondary" />}>Done</PopoverClose>
      </div>
    </div>
  );
}

function PopoverSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="Each press opens its popover." title="Widths">
        <SpecimenGrid>
          {WIDTHS.map((width) => (
            <Specimen key={width} label={specimenLabel({ width })}>
              <Popover>
                <PopoverTrigger render={<Button variant="secondary" />}>Open</PopoverTrigger>
                <PopoverPopup width={width}>
                  <Body />
                </PopoverPopup>
              </Popover>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="The room inside it, and the tooltip's look."
        title="Paddings and variants"
      >
        <SpecimenGrid>
          {PADDINGS.map((padding) => (
            <Specimen key={padding} label={specimenLabel({ padding, width: "md" })}>
              <Popover>
                <PopoverTrigger render={<Button variant="secondary" />}>Open</PopoverTrigger>
                <PopoverPopup padding={padding} width="md">
                  <Body />
                </PopoverPopup>
              </Popover>
            </Specimen>
          ))}
          <Specimen label={specimenLabel({ variant: "tooltip" })}>
            <Popover>
              <PopoverTrigger render={<Button variant="secondary" />}>Open</PopoverTrigger>
              <PopoverPopup variant="tooltip">Saved to the project's vault.</PopoverPopup>
            </Popover>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "popover",
  title: "Popover",
  purpose: "A small panel tied to its trigger, for prose or a short form.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/popover.tsx",
  render: () => <PopoverSpecimens />,
});
