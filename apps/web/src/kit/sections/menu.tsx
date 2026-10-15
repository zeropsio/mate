import { CopyIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";
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

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

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

function MenuSpecimens() {
  return (
    <SpecimenGrid>
      <Specimen label="<MenuTrigger render={<Button />}> · every item kind">
        <Menu>
          <MenuTrigger render={<Button aria-label="Project menu" size="icon-md" variant="ghost" />}>
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup>
            <EveryItem />
          </MenuPopup>
        </Menu>
      </Specimen>
      <Specimen label="<MenuTrigger render={<SelectButton />}>">
        <Menu>
          <MenuTrigger render={<SelectButton />}>Sort by name</MenuTrigger>
          <MenuPopup align="start">
            <MenuItem>Name</MenuItem>
            <MenuItem>Creation date</MenuItem>
          </MenuPopup>
        </Menu>
      </Specimen>
      <Specimen label='<MenuPopup side="right">'>
        <Menu>
          <MenuTrigger render={<Button variant="outline" />}>Open to the right</MenuTrigger>
          <MenuPopup side="right">
            <MenuItem>Rename</MenuItem>
            <MenuItem variant="destructive">Delete</MenuItem>
          </MenuPopup>
        </Menu>
      </Specimen>
    </SpecimenGrid>
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
