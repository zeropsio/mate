import { CopyIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuSwitch,
  MenuTrigger,
} from "~/components/ui/menu";
import { SelectButton } from "~/components/ui/select";
import { Text } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** Every item kind the kit's menu has, in one popup. */
function EveryItem() {
  const [wrap, setWrap] = useState(true);
  const [notify, setNotify] = useState(false);
  const [sort, setSort] = useState("name");
  const [density, setDensity] = useState("comfortable");
  const [view, setView] = useState("list");
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>Project</MenuGroupLabel>
        <MenuItem>
          <PencilIcon />
          Rename
          <MenuShortcut>⌘R</MenuShortcut>
        </MenuItem>
        <MenuItem>
          <CopyIcon />
          Copy link
        </MenuItem>
        <MenuItem disabled>Move (disabled)</MenuItem>
        <MenuItem inset>Inset item</MenuItem>
        <MenuItem density="touch">density="touch"</MenuItem>
        <MenuItem variant="ghost">variant="ghost"</MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
        Wrap long lines
      </MenuCheckboxItem>
      <MenuCheckboxItem checked={notify} onCheckedChange={setNotify} variant="switch">
        Notify me (variant="switch")
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuRadioGroup onValueChange={(value: string) => setSort(value)} value={sort}>
        <MenuGroupLabel>Sort (variant="fill")</MenuGroupLabel>
        <MenuRadioItem value="name">Name</MenuRadioItem>
        <MenuRadioItem value="date">Creation date</MenuRadioItem>
      </MenuRadioGroup>
      <MenuRadioGroup onValueChange={(value: string) => setDensity(value)} value={density}>
        <MenuGroupLabel>Density (variant="check")</MenuGroupLabel>
        <MenuRadioItem value="comfortable" variant="check">
          Comfortable
        </MenuRadioItem>
        <MenuRadioItem value="compact" variant="check">
          Compact
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuSwitch label="View" onValueChange={(value: string) => setView(value)} value={view}>
        <MenuRadioItem value="list" variant="segment">
          List
        </MenuRadioItem>
        <MenuRadioItem value="board" variant="segment">
          Board
        </MenuRadioItem>
      </MenuSwitch>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger>Move to</MenuSubTrigger>
        <MenuSubPopup>
          <MenuItem>Personal</MenuItem>
          <MenuItem>Team</MenuItem>
        </MenuSubPopup>
      </MenuSub>
      <MenuSeparator />
      <MenuItem variant="destructive">
        <TrashIcon />
        Delete
      </MenuItem>
    </>
  );
}

/** A secondary press that opens a menu of the given width. */
function WidthMenu({
  width,
  children,
}: {
  readonly width: NonNullable<React.ComponentProps<typeof MenuPopup>["width"]>;
  readonly children: React.ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="secondary" />}>Open</MenuTrigger>
      <MenuPopup align="start" width={width}>
        {children}
      </MenuPopup>
    </Menu>
  );
}

function MenuSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="Each press opens its menu." title="Triggers and sides">
        <SpecimenGrid size="md">
          <Specimen
            label='<MenuTrigger render={<Button size="icon-md" variant="ghost" />}>'
            note="Every item kind in one menu"
          >
            <Menu>
              <MenuTrigger
                render={<Button aria-label="Project menu" size="icon-md" variant="ghost" />}
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup>
                <EveryItem />
              </MenuPopup>
            </Menu>
          </Specimen>
          <Specimen
            label="<MenuTrigger render={<SelectButton />}>"
            note="A field's look, opening a menu"
          >
            <Menu>
              <MenuTrigger render={<SelectButton />}>Sort by name</MenuTrigger>
              <MenuPopup align="start">
                <MenuItem>Name</MenuItem>
                <MenuItem>Creation date</MenuItem>
              </MenuPopup>
            </Menu>
          </Specimen>
          <Specimen label='<MenuPopup side="right">' note="Opening to the right">
            <Menu>
              <MenuTrigger render={<Button variant="secondary" />}>Open to the right</MenuTrigger>
              <MenuPopup side="right">
                <MenuItem>Rename</MenuItem>
                <MenuItem variant="destructive">Delete</MenuItem>
              </MenuPopup>
            </Menu>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A menu of verbs is as wide as its words; one that holds names keeps one width and cuts a long one at its edge."
        title="Widths"
      >
        <SpecimenGrid size="md">
          <Specimen label="(default)" note="A few verbs, as wide as their words">
            <WidthMenu width="auto">
              <MenuItem>Rename</MenuItem>
              <MenuItem>Copy link</MenuItem>
            </WidthMenu>
          </Specimen>
          <Specimen label='width="fit"' note="Lines that run long wrap at 25rem">
            <WidthMenu width="fit">
              <MenuItem>Open this environment</MenuItem>
              <MenuItem disabled>
                Roll back to v1.4.2 — the release before is still building
              </MenuItem>
            </WidthMenu>
          </Specimen>
          <Specimen label='width="sm"' note="A list of names">
            <WidthMenu width="sm">
              <MenuItem>Fen</MenuItem>
              <MenuItem>
                <span className="min-w-0 truncate">a-mate-with-a-name-long-enough-to-cut</span>
              </MenuItem>
            </WidthMenu>
          </Specimen>
          <Specimen label='width="md"' note="Rows with a second word">
            <WidthMenu width="md">
              <MenuItem>Fix the flaky login test</MenuItem>
              <MenuItem>
                <span className="min-w-0 truncate">
                  Build the game server and its tests for the load run
                </span>
              </MenuItem>
            </WidthMenu>
          </Specimen>
          <Specimen label='width="lg"' note="Rows that say what they do">
            <WidthMenu width="lg">
              <MenuItem>
                <span className="flex min-w-0 flex-col py-0.5">
                  <span>Try its work</span>
                  <Text variant="note">Opens its copy of the app.</Text>
                </span>
              </MenuItem>
            </WidthMenu>
          </Specimen>
          <Specimen label='width="anchor"' note="As wide as the press that opens it">
            <Menu>
              <MenuTrigger render={<SelectButton className="w-56" />}>All projects</MenuTrigger>
              <MenuPopup align="start" width="anchor">
                <MenuItem>All projects</MenuItem>
                <MenuItem>storefront</MenuItem>
              </MenuPopup>
            </Menu>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "menu",
  title: "Menu",
  purpose: "Actions and settings behind one trigger, one row each.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/menu.tsx",
  render: () => <MenuSpecimens />,
});
