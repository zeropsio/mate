import { Button } from "~/components/ui/button";
import { PictureFrame } from "~/components/ui/picture-frame";
import { Skeleton } from "~/components/ui/skeleton";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A page's screenshot as the frame holds one: a white page whose own edge would vanish. */
function SamplePage() {
  return (
    <span aria-hidden="true" className="flex size-full flex-col gap-1.5 bg-card p-3">
      <Skeleton className="h-2 w-2/5 shrink-0" surface="card" />
      <Skeleton className="h-1.5 w-4/5 shrink-0" surface="card" />
      <Skeleton className="h-1.5 w-3/5 shrink-0" surface="card" />
      <Skeleton className="mt-1 min-h-0 w-full flex-1" surface="card" />
    </span>
  );
}

function PictureFrameSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Its corners clip the picture; its hairline is drawn over it, so a white page meets the ground."
        title="Sizes"
      >
        <SpecimenGrid size="md">
          <Specimen label='size="card"' note="A picture in a conversation or a report">
            <PictureFrame className="h-32 w-56">
              <SamplePage />
            </PictureFrame>
          </Specimen>
          <Specimen label='size="control"' note="A thumbnail in a strip or a row">
            <PictureFrame className="h-20 w-32" size="control">
              <SamplePage />
            </PictureFrame>
          </Specimen>
          <Specimen label="(empty)" note="Its ground, until its picture is there">
            <PictureFrame className="h-20 w-32" size="control" />
          </Specimen>
          <Specimen label="waiting" note="Its room held, nothing painted">
            <span className="rounded-control outline-1 outline-dashed outline-border/60">
              <PictureFrame className="h-20 w-32" size="control" waiting />
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="The edge's ink says what became of the check it shows." title="Tones">
        <SpecimenGrid size="md">
          {(["default", "attention", "failed"] as const).map((tone) => (
            <Specimen key={tone} label={`size="control" tone="${tone}"`}>
              <PictureFrame className="h-20 w-32" size="control" tone={tone}>
                <SamplePage />
              </PictureFrame>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Inside a press that opens the viewer, its hairline firms on hover."
        title="Pressed"
      >
        <SpecimenGrid size="md">
          <Specimen label='<Button variant="bare"> · <PictureFrame size="control">'>
            <Button
              aria-label="Open the picture"
              className="h-20 w-32 cursor-zoom-in"
              variant="bare"
            >
              <PictureFrame className="size-full" size="control">
                <SamplePage />
              </PictureFrame>
            </Button>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "picture-frame",
  title: "PictureFrame",
  purpose: "A picture or a page shown in a frame of its own.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/picture-frame.tsx",
  render: () => <PictureFrameSpecimens />,
});
