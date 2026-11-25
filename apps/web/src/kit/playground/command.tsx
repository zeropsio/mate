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

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

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
const PLACES = ["dialog", "inline"] as const;

interface PaletteArgs {
  readonly shortcuts: boolean;
  readonly footer: boolean;
}

function Results({ shortcuts }: { readonly shortcuts: boolean }) {
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
                  {shortcuts && item.shortcut ? (
                    <CommandShortcut>{item.shortcut}</CommandShortcut>
                  ) : null}
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

/** The palette over the page, opened by its press as ⌘K opens it in the app. */
function Palette({ shortcuts, footer }: PaletteArgs) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Open the palette
      </Button>
      <CommandDialog onOpenChange={setOpen} open={open}>
        <CommandDialogPopup aria-label="Command palette">
          <Command items={GROUPS}>
            <CommandInput placeholder="Search projects and actions" />
            <CommandPanel>
              <Results shortcuts={shortcuts} />
            </CommandPanel>
            {footer ? <Footer /> : null}
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}

const RESULTS_CODE = (shortcuts: boolean) =>
  [
    "<CommandList>",
    "  {(group) => (",
    "    <CommandGroup items={group.items} key={group.value}>",
    "      <CommandGroupLabel>{group.label}</CommandGroupLabel>",
    "      <CommandCollection>",
    "        {(item) => (",
    "          <CommandItem key={item.value} value={item}>",
    "            {item.label}",
    ...(shortcuts ? ["            <CommandShortcut>{item.shortcut}</CommandShortcut>"] : []),
    "          </CommandItem>",
    "        )}",
    "      </CommandCollection>",
    "    </CommandGroup>",
    "  )}",
    "</CommandList>",
  ].join("\n");

const FOOTER_CODE = [
  "<CommandFooter>",
  "  <KbdGroup><Kbd>↵</Kbd> Open</KbdGroup>",
  "  <KbdGroup><Kbd>Esc</Kbd> Close</KbdGroup>",
  "</CommandFooter>",
].join("\n");

export default definePlayground({
  section: "command",
  name: "Command",
  imports:
    'import { Command, CommandCollection, CommandDialog, CommandDialogPopup, CommandFooter, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList, CommandPanel, CommandShortcut } from "~/components/ui/command";',
  controls: {
    place: {
      kind: "enum",
      options: PLACES,
      note: "inline, its field waits to be pressed; in the dialog it takes focus",
    },
    shortcuts: { kind: "boolean", note: "an action's keys at its row's end" },
    footer: { kind: "boolean", note: "the keys that work in it" },
  },
  initial: { place: "dialog", shortcuts: true, footer: true },
  render: ({ place, shortcuts, footer }) =>
    place === "dialog" ? (
      <Palette footer={footer} shortcuts={shortcuts} />
    ) : (
      <div className="w-96 rounded-sheet border">
        <Command items={GROUPS}>
          <CommandInput placeholder="Search projects and actions" />
          <CommandPanel>
            <Results shortcuts={shortcuts} />
          </CommandPanel>
          {footer ? <Footer /> : null}
        </Command>
      </div>
    ),
  jsx: ({ place, shortcuts, footer }) => {
    const command = jsxElement(
      "Command",
      { items: jsxCode("groups") },
      [
        '<CommandInput placeholder="Search projects and actions" />',
        jsxElement("CommandPanel", {}, RESULTS_CODE(shortcuts)),
        footer ? FOOTER_CODE : "",
      ]
        .filter((part) => part !== "")
        .join("\n"),
    );
    return place === "dialog"
      ? jsxElement(
          "CommandDialog",
          { open: jsxCode("open"), onOpenChange: jsxCode("setOpen") },
          jsxElement("CommandDialogPopup", { "aria-label": "Command palette" }, command),
        )
      : command;
  },
  usage: {
    do: [
      "Search actions and places in one list, picked from the keyboard.",
      "Group the results under labels and show an action's keys at its row's end.",
      "Press Open the palette, type, and walk the rows with the arrow keys.",
    ],
    dont: [
      "Use it as the only way to an action: each also lives where it acts.",
      "Use it to pick a value in a form: that is a Combobox.",
    ],
  },
});
