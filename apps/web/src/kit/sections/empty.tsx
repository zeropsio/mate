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
import { Specimen, SpecimenGrid } from "../Specimen";
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
            <div className="flex w-96 rounded-xl border">
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
  purpose: "What a place holds when it holds nothing, and the way to fill it.",
  group: "Kit",
  kind: "Feedback",
  source: "apps/web/src/components/ui/empty.tsx",
  render: () => <EmptySpecimens />,
});
