import { useState } from "react";

import { DraftInput } from "~/components/ui/draft-input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function Sample() {
  const [committed, setCommitted] = useState("storefront");
  return (
    <div className="flex w-64 flex-col gap-2">
      <DraftInput aria-label="Name" onCommit={setCommitted} value={committed} />
      <span className="text-muted-foreground text-xs">Committed: {committed}</span>
    </div>
  );
}

export default defineKitSection({
  id: "draft-input",
  title: "DraftInput",
  purpose: "An input that commits on blur or Enter, not on every key.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/draft-input.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label='value="storefront" onCommit={…}'>
        <Sample />
      </Specimen>
    </SpecimenGrid>
  ),
});
