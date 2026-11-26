import { MiddleTruncate } from "~/components/ui/middle-truncate";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const BRANCH = "fix/cache-main-20260918-180825";
const PATH = "apps/web/src/components/zerops/addresses/AddressesSheetContainer.tsx";

function MiddleTruncateSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Both meaningful ends kept; a name that fits is left whole."
        title="Widths and tails"
      >
        <SpecimenGrid size="md">
          {[
            { value: BRANCH, tail: undefined, width: "w-40" },
            { value: PATH, tail: undefined, width: "w-56" },
            { value: PATH, tail: 12, width: "w-56" },
            { value: "main", tail: undefined, width: "w-40" },
          ].map(({ value, tail, width }) => (
            <Specimen
              key={`${value}-${tail}`}
              label={specimenLabel({ value, tail })}
              note={`In a ${width === "w-40" ? "160" : "224"} px box`}
            >
              <div className={width === "w-40" ? "flex w-40 text-body" : "flex w-56 text-body"}>
                <MiddleTruncate value={value} {...(tail === undefined ? {} : { tail })} />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "middle-truncate",
  title: "MiddleTruncate",
  purpose: "Cuts a long name in its middle, keeping both meaningful ends.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/middle-truncate.tsx",
  render: () => <MiddleTruncateSpecimens />,
});
