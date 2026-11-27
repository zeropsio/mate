import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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

const WIDTHS = ["auto", "sm", "md", "lg", "xl"] as const;
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

/**
 * A popover anchored to a point rather than a press: the picture's notes and the timeline map's
 * preview stand beside a mark this way, placed and kept on the frame by the popover itself.
 */
function PointAnchored() {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  return (
    <div className="relative w-full" ref={setFrame}>
      <Card
        aria-label="Place the popover"
        className="h-44 w-full"
        pressable
        variant="slot"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setPoint({ x: event.clientX - box.left, y: event.clientY - box.top });
        }}
      />
      {point === null ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-2 -translate-1/2 rounded-full bg-primary"
          style={{ left: point.x, top: point.y }}
        />
      )}
      <Popover open={point !== null} onOpenChange={(open) => open || setPoint(null)}>
        <PopoverPopup
          anchor={
            point === null || frame === null
              ? null
              : {
                  getBoundingClientRect: () => {
                    const box = frame.getBoundingClientRect();
                    return DOMRect.fromRect({ x: box.left + point.x, y: box.top + point.y });
                  },
                }
          }
          collisionBoundary={frame ?? undefined}
          collisionPadding={8}
          initialFocus={false}
          side="right"
          sideOffset={8}
          width="sm"
        >
          <p className="m-0 text-body">
            Press anywhere in the frame: the popover follows the point.
          </p>
        </PopoverPopup>
      </Popover>
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
      <SpecimenBlock
        note="Beside a point rather than a press, and kept inside its frame."
        title="Anchored to a point"
      >
        <SpecimenGrid size="lg">
          <Specimen label={specimenLabel({ anchor: "point", side: "right" })} span="row">
            <PointAnchored />
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
