import { FolderIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "~/components/ui/command";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

interface Item {
  readonly value: string;
  readonly label: string;
  readonly shortcut?: string;
}

const GROUPS: ReadonlyArray<{ value: string; label: string; items: readonly Item[] }> = [
  {
    value: "actions",
    label: "Actions",
    items: [
      { value: "new", label: "New project", shortcut: "⌘N" },
      { value: "settings", label: "Open settings", shortcut: "⌘," },
    ],
  },
  {
    value: "projects",
    label: "Projects",
    items: [
      { value: "storefront", label: "storefront" },
      { value: "backoffice", label: "backoffice" },
    ],
  },
];

const ICONS: Record<string, typeof FolderIcon> = { new: PlusIcon, settings: SettingsIcon };

function Results() {
  return (
    <CommandList>
      {GROUPS.map((group) => (
        <CommandGroup items={[...group.items]} key={group.value}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          <CommandCollection>
            {(item: Item) => {
              const Icon = ICONS[item.value] ?? FolderIcon;
              return (
                <CommandItem key={item.value} value={item}>
                  <Icon />
                  {item.label}
                  {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                </CommandItem>
              );
            }}
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function Footer() {
  return (
    <CommandFooter>
      <KbdGroup>
        <Kbd>↵</Kbd> Open
      </KbdGroup>
      <KbdGroup>
        <Kbd>Esc</Kbd> Close
      </KbdGroup>
    </CommandFooter>
  );
}

function CommandSpecimens() {
  const [open, setOpen] = useState(false);
  return (
    <SpecimenGrid>
      <Specimen label="<CommandDialog> · <CommandDialogPopup>">
        <Button onClick={() => setOpen(true)} variant="secondary">
          Open the palette
        </Button>
        <CommandDialog onOpenChange={setOpen} open={open}>
          <CommandDialogPopup aria-label="Command palette">
            <Command items={GROUPS}>
              <CommandInput placeholder="Search projects and actions" />
              <CommandPanel>
                <Results />
              </CommandPanel>
              <Footer />
            </Command>
          </CommandDialogPopup>
        </CommandDialog>
      </Specimen>
      <Specimen label="<Command> inline, without <CommandInput> (it takes focus on mount)">
        <div className="w-96 rounded-2xl border">
          <Command items={GROUPS}>
            <CommandPanel>
              <Results />
            </CommandPanel>
            <Footer />
          </Command>
        </div>
      </Specimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "command",
  title: "Command",
  purpose: "Search over actions and places, picked from the keyboard.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/command.tsx",
  render: () => <CommandSpecimens />,
});
