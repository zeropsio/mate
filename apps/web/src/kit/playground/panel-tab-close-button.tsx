import { FileIcon, TerminalIcon } from "lucide-react";

import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";

import { definePlayground, jsxElement } from "../kitPlayground";

/** The tab's own mark, which the close press stands in for under the pointer. */
const ICONS = ["file", "terminal"] as const;

export default definePlayground({
  section: "panel-tab-close-button",
  name: "PanelTabCloseButton",
  imports: 'import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";',
  controls: {
    name: { kind: "text", note: "the tab's name; the label closes it by name" },
    icon: { kind: "enum", options: ICONS, note: "its mark until the pointer is on the tab" },
    tooltip: { kind: "text", note: "a tooltip of its own; empty: none" },
  },
  initial: { name: "index.ts", icon: "file", tooltip: "" },
  render: ({ name, icon, tooltip }) => (
    // Its parent is the tab: a `group/tab` row, as a panel's tabs are.
    <div className="group/tab flex h-8 items-center gap-2 rounded-control border px-2 text-body">
      <PanelTabCloseButton
        label={`Close ${name}`}
        onClick={() => {}}
        {...(tooltip === "" ? {} : { tooltip })}
      >
        {icon === "terminal" ? <TerminalIcon /> : <FileIcon />}
      </PanelTabCloseButton>
      {name}
    </div>
  ),
  jsx: ({ name, icon, tooltip }) =>
    jsxElement(
      "PanelTabCloseButton",
      {
        label: `Close ${name}`,
        "onClick={close}": true,
        tooltip: tooltip === "" ? undefined : tooltip,
      },
      icon === "terminal" ? "<TerminalIcon />" : "<FileIcon />",
    ),
  usage: {
    do: [
      "Put it first in a closable tab whose row is a group/tab: hover the tab to see it turn into its ×.",
      "Label it Close and the tab's name.",
    ],
    dont: [
      "Use it outside a group/tab parent: nothing turns it into its close press.",
      "Close a tab that holds unsaved work without asking.",
    ],
  },
});
