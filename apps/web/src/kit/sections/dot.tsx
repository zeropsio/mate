import { FileTextIcon, GitPullRequestIcon } from "lucide-react";

import { Dot, type DotTone } from "~/components/ui/dot";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix, Specimens } from "../Specimen";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<DotTone>({
  neutral: true,
  info: true,
  success: true,
  warning: true,
  danger: true,
  current: true,
});

function DotSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="6 px in a dense line or on a corner, 8 px before words." title="Tones">
        <SpecimenMatrix
          rowProp="tone"
          rows={TONES}
          columnProp="size"
          columns={["sm", "md", "hollow"] as const}
          columnLabel={(column) => (column === "hollow" ? "hollow" : `size="${column}"`)}
          render={(tone, column) =>
            column === "hollow" ? <Dot hollow tone={tone} /> : <Dot size={column} tone={tone} />
          }
        />
      </SpecimenBlock>
      <SpecimenBlock title="In place">
        <SpecimenGrid size="md">
          <Specimen label='size="sm" tone="success" · "info" · "neutral"' note="A plan's steps">
            <ol className="m-0 flex list-none flex-col gap-1 p-0 text-body">
              <li className="flex items-center gap-2.5">
                <Dot size="sm" tone="success" />
                <span className="text-muted-foreground">Read the logs</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Dot size="sm" tone="info" />
                Fix the build
              </li>
              <li className="flex items-center gap-2.5">
                <Dot size="sm" />
                Deploy to stage
              </li>
            </ol>
          </Specimen>
          <Specimen label='tone="info" pulse' note="Work running now">
            <span className="flex items-center gap-2 text-body">
              <Dot pulse tone="info" />
              Deploying
            </span>
          </Specimen>
          <Specimen label='size="sm" tone="info" corner="top-end"' note="Something new on an icon">
            <span className="relative inline-flex">
              <GitPullRequestIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <Dot corner="top-end" size="sm" tone="info" />
            </span>
          </Specimen>
          <Specimen label='size="sm" tone="current" corner="bottom-end"' note="Unsaved changes">
            <span className="relative inline-flex text-foreground">
              <FileTextIcon aria-hidden="true" className="size-4" />
              <Dot corner="bottom-end" size="sm" tone="current" />
            </span>
          </Specimen>
          <Specimen
            label='tone="danger" corner="top-start" aria-label="Unavailable"'
            note="A mark that is the only word for it"
          >
            <span className="relative inline-flex size-6 items-center justify-center rounded-control bg-muted">
              <GitPullRequestIcon aria-hidden="true" className="size-4" />
              <Dot aria-label="Unavailable" corner="top-start" tone="danger" />
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "dot",
  title: "Dot",
  purpose:
    "The one dot: a state said as a colour, before a line it marks or on a corner of what it marks. Badge's tones and meanings, 6 or 8 px, a pulse for work running now.",
  group: "Chosen",
  kind: "Labels",
  source: "apps/web/src/components/ui/dot.tsx",
  render: () => <DotSpecimens />,
});
