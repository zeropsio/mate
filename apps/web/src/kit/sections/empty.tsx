import type { ComponentProps } from "react";
import { BoxIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { ChosenEmpty } from "../states/Chosen";
import { specimenLabel, variantsOf } from "../specimenLabel";

type EmptySize = NonNullable<ComponentProps<typeof Empty>["size"]>;
type EmptyMediaVariant = NonNullable<ComponentProps<typeof EmptyMedia>["variant"]>;

const SIZES = variantsOf<EmptySize>({ compact: true, default: true, hero: true });
const MEDIA = variantsOf<EmptyMediaVariant>({ default: true, icon: true });

function EmptySpecimens() {
  return (
    <SpecimenGrid>
      {SIZES.flatMap((size) =>
        MEDIA.map((media) => (
          <Specimen
            key={`${size}-${media}`}
            label={`${specimenLabel({ size })} · <EmptyMedia ${specimenLabel({ variant: media })}>`}
          >
            <div className="flex w-96 rounded-card border">
              <Empty size={size}>
                <EmptyHeader>
                  <EmptyMedia variant={media}>
                    <BoxIcon />
                  </EmptyMedia>
                  <EmptyTitle>No services yet</EmptyTitle>
                  <EmptyDescription>Add one and Mate deploys it here.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm">Add a service</Button>
                </EmptyContent>
              </Empty>
            </div>
          </Specimen>
        )),
      )}
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "empty",
  title: "Empty",
  purpose:
    "A place that holds nothing yet: EmptyState says what will be here and at most one way to fill it, as a row, a section or a page; Empty's parts build a bespoke one.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/ui/empty.tsx",
  render: () => (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="EmptyState: a row, a section, a page">
        <ChosenEmpty />
      </SpecimenBlock>
      <SpecimenBlock title="Empty's parts">
        <EmptySpecimens />
      </SpecimenBlock>
    </div>
  ),
});
