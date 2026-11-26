import { useState } from "react";

import { DraftInput } from "~/components/ui/draft-input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function Sample() {
  const [committed, setCommitted] = useState("storefront");
  return (
    <div className="flex w-full max-w-64 flex-col gap-2">
      <DraftInput aria-label="Name" onCommit={setCommitted} value={committed} />
      <span className="text-muted-foreground text-caption">Committed: {committed}</span>
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
    <Specimens>
      <SpecimenBlock
        note="Type, then leave the field or press Enter: the line under it changes then."
        title="Committing"
      >
        <SpecimenGrid size="md">
          <Specimen label='value="storefront" onCommit={…}'>
            <Sample />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
