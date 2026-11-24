import { CheckIcon, FileIcon, FolderIcon, GitPullRequestIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Row } from "~/components/ui/row";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

function RowSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="A tree, a dense list: xs">
        <SpecimenGrid>
          <Specimen label='size="xs" pressable lead={<FolderIcon />} meta'>
            <div className="w-72">
              <Row
                lead={<FolderIcon className="size-4" />}
                meta="12"
                pressable
                render={<button type="button" />}
                size="xs"
                title="src"
              />
              <Row
                lead={<FileIcon className="size-4" />}
                meta="4 KB"
                pressable
                render={<button type="button" />}
                size="xs"
                title="index.ts"
              />
            </div>
          </Specimen>
          <Specimen label='size="xs" pressable badges'>
            <div className="w-72">
              <Row
                badges={<Badge tone="info">2</Badge>}
                pressable
                render={<button type="button" />}
                size="xs"
                title="Open changes"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="A setting, an address: sm">
        <SpecimenGrid>
          <Specimen label='size="sm" line'>
            <div className="w-96">
              <Row line="Light, dark, or the same as your system." size="sm" title="Appearance" />
            </div>
          </Specimen>
          <Specimen label='size="sm" pressable meta'>
            <div className="w-96">
              <Row
                meta="Primary"
                pressable
                render={<button type="button" />}
                size="sm"
                title="storefront.zerops.app"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="The run card's line: bar">
        <SpecimenGrid>
          <Specimen label='size="bar" lead meta'>
            <ul className="w-96">
              <Row
                lead={<Badge aria-label="Working" dot tone="info" />}
                meta="44s"
                render={<li />}
                size="bar"
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">2 helpers</span>
                    <span className="truncate text-muted-foreground">List the top-level files</span>
                  </span>
                }
              />
            </ul>
          </Specimen>
          <Specimen label='size="bar" pressable, no lead'>
            <div className="w-96">
              <Row
                meta="39s"
                pressable
                render={<button type="button" />}
                size="bar"
                title={
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="font-medium">Deploy · apistage</span>
                    <span className="text-muted-foreground">Deploying</span>
                  </span>
                }
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="A take among pictures: a thumbnail lead">
        <SpecimenGrid>
          <Specimen label='size="xs" thumbnail picked pressable'>
            <div className="flex w-80 flex-col gap-0.5">
              <Row
                aria-pressed
                lead={<span className="h-8 w-13 rounded-control border border-border bg-card" />}
                meta={<CheckIcon aria-hidden="true" className="size-3.5 text-status-ok" />}
                picked
                pressable
                render={<button type="button" />}
                size="xs"
                thumbnail
                title="Desktop · /status · 11s"
              />
              <Row
                aria-pressed={false}
                lead={<span className="h-8 w-4 rounded-mark border border-border bg-card" />}
                meta={<CheckIcon aria-hidden="true" className="size-3.5 text-status-ok" />}
                pressable
                render={<button type="button" />}
                size="xs"
                thumbnail
                title={<span className="text-muted-foreground">Phone · /status · 9s</span>}
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Facts in the list's columns: columns">
        <SpecimenGrid>
          <Specimen label="columns pressable, in a list of auto · 1fr · auto · auto">
            <ul className="grid w-md grid-cols-[auto_minmax(0,1fr)_auto_auto] [--row-pad-x:--spacing(2)] [--row-pad-y:--spacing(1.5)]">
              {COLUMN_ROWS.map((row) => (
                <li className="col-span-full grid grid-cols-subgrid" key={row.title}>
                  <Row columns pressable render={<button type="button" />}>
                    <GitPullRequestIcon aria-hidden="true" className="me-2.5 mt-0.5 size-4" />
                    <span className="truncate text-body">{row.title}</span>
                    <span className="ms-4 text-caption text-muted-foreground">{row.state}</span>
                    <span className="ms-4 text-caption text-muted-foreground tabular-nums">
                      {row.age}
                    </span>
                  </Row>
                </li>
              ))}
            </ul>
          </Specimen>
          <Specimen label='columns ground="tint" pressable="band"'>
            <div className="grid w-80 grid-cols-[minmax(0,1fr)_auto] bg-sidebar p-2">
              <Row
                className="h-15 items-center"
                columns
                ground="tint"
                pressable="band"
                render={<button type="button" />}
              >
                <span className="px-3 text-emphasis font-semibold">Ada's Chief Mate</span>
              </Row>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

const COLUMN_ROWS = [
  { title: "Add the status page", state: "Ready to merge", age: "9m" },
  { title: "Fix the cache key on deploys", state: "Waiting for you", age: "2d" },
];

export default defineKitSection({
  id: "row",
  title: "Row",
  purpose:
    "One row for every list: a leading mark, its title with badges and meta on one line, at most one muted line under it. Sizes follow what it leads with, from a tree's 24 px xs to the menu's lg, and bar for the run card's line; a thumbnail lead for a picture; columns puts its cells in its list's columns. Pressable lights its own ground.",
  group: "Chosen",
  kind: "Data",
  source: "apps/web/src/components/ui/row.tsx",
  render: () => <RowSpecimens />,
});
