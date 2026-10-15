import { MiddleTruncate } from "~/components/ui/middle-truncate";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const BRANCH = "fix/cache-main-20260918-180825";
const PATH = "apps/web/src/components/zerops/addresses/AddressesSheetContainer.tsx";

function MiddleTruncateSpecimens() {
  return (
    <SpecimenGrid>
      {[
        { value: BRANCH, tail: undefined, width: "w-40" },
        { value: PATH, tail: undefined, width: "w-56" },
        { value: PATH, tail: 12, width: "w-56" },
        { value: "main", tail: undefined, width: "w-40" },
      ].map(({ value, tail, width }) => (
        <Specimen
          key={`${value}-${tail}`}
          label={`${specimenLabel({ value, tail })} · ${width === "w-40" ? "160" : "224"}px box`}
        >
          <div className={width === "w-40" ? "flex w-40 text-sm" : "flex w-56 text-sm"}>
            <MiddleTruncate value={value} {...(tail === undefined ? {} : { tail })} />
          </div>
        </Specimen>
      ))}
    </SpecimenGrid>
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
