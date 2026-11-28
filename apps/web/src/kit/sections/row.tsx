import {
  CheckIcon,
  FileIcon,
  FolderIcon,
  GitPullRequestIcon,
  MoreHorizontalIcon,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Row } from "~/components/ui/row";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function RowSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="24 px rows for a tree or a dense list." title="Extra small">
        <SpecimenGrid size="lg">
          <Specimen label='size="xs" pressable lead={<FolderIcon />} meta' note="A file tree">
            <div className="w-full max-w-72">
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
          <Specimen label='size="xs" pressable badges' note="A count beside its title">
            <div className="w-full max-w-72">
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
      <SpecimenBlock note="A setting with its line, an address with its role." title="Small">
        <SpecimenGrid size="lg">
          <Specimen label='size="sm" line' note="A setting">
            <div className="w-full max-w-96">
              <Row line="Light, dark, or the same as your system." size="sm" title="Appearance" />
            </div>
          </Specimen>
          <Specimen label='size="sm" pressable meta' note="An address">
            <div className="w-full max-w-96">
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
      <SpecimenBlock note="The run card's one line." title="Bar">
        <SpecimenGrid size="lg">
          <Specimen label='size="bar" lead meta' note="Helpers at work">
            <ul className="w-full max-w-96">
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
          <Specimen label='size="bar" pressable' note="A deploy, without a lead">
            <div className="w-full max-w-96">
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
      <SpecimenBlock note="A person in a list, a Mate in the menu." title="Medium and large">
        <SpecimenGrid size="xl">
          <Specimen
            label='size="md" lead={<PersonAvatar size={32} />} control badges'
            note="People, one with a name long enough to meet its badge"
          >
            <div className="w-full max-w-[28rem]">
              <Row
                control={
                  <Button aria-label="More" size="icon-sm" variant="ghost">
                    <MoreHorizontalIcon />
                  </Button>
                }
                lead={<PersonAvatar name="Petra Malá" size={32} />}
                line="Owner · full access"
                title="Petra Malá"
              />
              <Row
                badges={
                  <Badge dot tone="warning">
                    Invited
                  </Badge>
                }
                lead={<PersonAvatar name="Jan Svoboda" size={32} />}
                line="Developer · invited"
                title="Jan Svoboda, whose name is long enough to meet its badge"
              />
            </div>
          </Specimen>
          <Specimen
            label='size="lg" pressable lead={<MateFace size={32} />} meta line'
            note="A Mate in the menu"
          >
            <div className="w-full max-w-[25rem]">
              <Row
                lead={<MateFace size={32} state="working" tint="olive" />}
                line="Reading the release notes since 1.0."
                meta="1m"
                pressable
                render={<button type="button" />}
                size="lg"
                title="Fen"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Every pressable item's two grounds: lit under the pointer or the keyboard's cursor, and picked while its list shows it. Both are a step of the ink, alike on every surface."
        title="Lit and picked"
      >
        <SpecimenGrid size="lg">
          <Specimen label="pressable · data-highlighted · picked" note="At rest, lit, picked">
            <div className="flex w-full max-w-80 flex-col gap-0.5">
              <Row pressable render={<button type="button" />} size="sm" title="Overview" />
              <Row
                data-highlighted=""
                pressable
                render={<button type="button" />}
                size="sm"
                title="Vault"
              />
              <Row
                aria-current="page"
                picked
                pressable
                render={<button type="button" />}
                size="sm"
                title="Settings"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A take among pictures, the picked one lit." title="Thumbnail lead">
        <SpecimenGrid size="lg">
          <Specimen label='size="xs" thumbnail picked pressable' note="Two takes, the first picked">
            <div className="flex w-full max-w-80 flex-col gap-0.5">
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
      <SpecimenBlock note="Cells that line up with their list's columns." title="Columns">
        <SpecimenGrid size="xl">
          <Specimen
            label="columns pressable · picked"
            note="In a list of auto · 1fr · auto · auto, the second picked"
          >
            <ul className="grid w-full max-w-md grid-cols-[auto_minmax(0,1fr)_auto_auto] [--row-pad-x:--spacing(2)] [--row-pad-y:--spacing(1.5)]">
              {COLUMN_ROWS.map((row, at) => (
                <li className="col-span-full grid grid-cols-subgrid" key={row.title}>
                  <Row columns pressable picked={at === 1} render={<button type="button" />}>
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
          <Specimen
            label='columns ground="menu" pressable="band"'
            note="A band on the menu's ground"
          >
            <div className="grid w-full max-w-80 grid-cols-[minmax(0,1fr)_auto] bg-sidebar p-2">
              <Row
                className="h-15 items-center"
                columns
                ground="menu"
                pressable="band"
                render={<button type="button" />}
              >
                <span className="px-3 text-emphasis font-semibold">Ada's Chief Mate</span>
              </Row>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
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
