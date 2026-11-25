import { DiffStat } from "~/components/ui/diff-stat";
import { Text } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "diff-stat",
  title: "DiffStat",
  purpose: "How much a change changed: lines added and removed, each in its ink.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/diff-stat.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="A side at zero is left out; it takes the words' step." title="Counts">
        <SpecimenGrid>
          <Specimen label="additions={42} deletions={3}">
            <DiffStat additions={42} deletions={3} />
          </Specimen>
          <Specimen label="additions={18} deletions={0}" note="Only added">
            <DiffStat additions={18} deletions={0} />
          </Specimen>
          <Specimen label="compact" note="A menu row's room">
            <DiffStat additions={12480} compact deletions={1730} />
          </Specimen>
          <Specimen label='inside <Text variant="meta">' note="Beside a count of files">
            <Text variant="meta">
              4 files changed · <DiffStat additions={42} deletions={3} />
            </Text>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Counts in columns of their own, reading down one edge." title="Aligned">
        <SpecimenGrid>
          <Specimen label="aligned">
            <div className="grid gap-1 text-caption">
              <DiffStat additions={42} aligned deletions={3} />
              <DiffStat additions={7} aligned deletions={120} />
              <DiffStat additions={0} aligned deletions={9} />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
