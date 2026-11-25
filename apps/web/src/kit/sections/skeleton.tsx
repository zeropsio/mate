import { Skeleton } from "~/components/ui/skeleton";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function SkeletonSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="A stand-in at the size of what it holds the place of." title="Shapes">
        <SpecimenGrid size="md">
          <Specimen label='shape="block"' note="The default">
            <Skeleton className="h-4 w-48" />
          </Specimen>
          <Specimen label='shape="pill"'>
            <Skeleton className="h-6 w-20" shape="pill" />
          </Specimen>
          <Specimen label='shape="card"'>
            <Skeleton className="h-24 w-48" shape="card" />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="In place">
        <SpecimenGrid size="md">
          <Specimen label='shape="pill" · shape="block"' note="A row standing in for a menu entry">
            <div className="flex w-full max-w-64 items-center gap-3">
              <Skeleton className="size-8" shape="pill" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "skeleton",
  title: "Skeleton",
  purpose: "Holds the place of content that is on its way, at its size.",
  group: "Kit",
  kind: "Feedback",
  source: "apps/web/src/components/ui/skeleton.tsx",
  render: () => <SkeletonSpecimens />,
});
