import {
  BotIcon,
  CodeIcon,
  DatabaseIcon,
  FolderIcon,
  GlobeIcon,
  KeyRoundIcon,
  PlusIcon,
  ServerIcon,
  TerminalIcon,
} from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tab, TabLabel, TabPress, TabStrip } from "~/components/ui/tab-strip";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const SIZES = variantsOf<NonNullable<ComponentProps<typeof Tab>["size"]>>({ sm: true, md: true });
/** A panel's pages, in the order the panel opens them. */
const PAGES: ReadonlyArray<{ readonly id: string; readonly icon: ReactNode }> = [
  { id: "Zerops", icon: <ServerIcon /> },
  { id: "Code", icon: <CodeIcon /> },
  { id: "Vault", icon: <KeyRoundIcon /> },
  { id: "Data", icon: <DatabaseIcon /> },
  { id: "Files", icon: <FolderIcon /> },
  { id: "Terminal", icon: <TerminalIcon /> },
  { id: "Browser", icon: <GlobeIcon /> },
  { id: "Agents", icon: <BotIcon /> },
];
const COUNTS = ["3", "5", "8"] as const;
/** The strip's room, in rem: past what its names fit, the other tabs fold to their icons. */
const WIDTHS = {
  "20": "flex h-10 w-80 items-center border border-border bg-background px-2",
  "30": "flex h-10 w-[30rem] items-center border border-border bg-background px-2",
  "44": "flex h-10 w-[44rem] items-center border border-border bg-background px-2",
} as const;
const WIDTH_IDS = Object.keys(WIDTHS) as (keyof typeof WIDTHS)[];

function Strip({
  size,
  count,
  width,
  action,
}: {
  readonly size: (typeof SIZES)[number];
  readonly count: (typeof COUNTS)[number];
  readonly width: keyof typeof WIDTHS;
  readonly action: boolean;
}) {
  const pages = PAGES.slice(0, Number(count));
  const [active, setActive] = useState<string>("Vault");
  return (
    <div className={WIDTHS[width]}>
      <TabStrip
        action={
          action ? (
            <Button aria-label="Add a page" size="icon-sm" variant="ghost">
              <PlusIcon />
            </Button>
          ) : undefined
        }
        activeId={active}
        items={pages.map(({ id, icon }) => ({ id, label: id, icon }))}
        onSelect={setActive}
      >
        {pages.map(({ id, icon }) => (
          <Tab active={id === active} key={id} size={size} tabId={id}>
            <TabPress onClick={() => setActive(id)}>
              {icon}
              <TabLabel>{id}</TabLabel>
            </TabPress>
          </Tab>
        ))}
      </TabStrip>
    </div>
  );
}

export default definePlayground({
  section: "tab-strip",
  name: "TabStrip",
  imports: 'import { Tab, TabLabel, TabPress, TabStrip } from "~/components/ui/tab-strip";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "sm: a panel's pages; md: a page's own views" },
    count: { kind: "enum", options: COUNTS, note: "how many tabs are open" },
    width: { kind: "enum", options: WIDTH_IDS, note: "the strip's room, in rem" },
    action: { kind: "boolean", note: "a press after the tabs that never scrolls away" },
  },
  initial: { size: "sm", count: "8", width: "30", action: true },
  render: ({ size, count, width, action }) => (
    <Strip action={action} count={count} key={count} size={size} width={width} />
  ),
  jsx: ({ size, action }) =>
    jsxElement(
      "TabStrip",
      {
        activeId: "Vault",
        items: jsxCode("pages"),
        onSelect: jsxCode("setActive"),
        action: action
          ? jsxCode('<Button aria-label="Add a page" size="icon-sm" variant="ghost">…</Button>')
          : undefined,
      },
      jsxElement(
        "Tab",
        { active: jsxCode("page.id === active"), tabId: jsxCode("page.id"), size },
        "<TabPress>\n  {page.icon}\n  <TabLabel>{page.label}</TabLabel>\n</TabPress>",
        { size: "sm" },
      ),
    ),
  usage: {
    do: [
      "Use sm for a panel's pages and md for a page's own views.",
      "Give every tab an icon and its name in TabLabel: past the strip's room the others fold to their icons by themselves.",
      "Put the add press in action: it stays in reach however many tabs are open.",
    ],
    dont: [
      "Wrap the strip to a second line: it scrolls, and the cut-off ones go to N more.",
      "Use tabs for a choice that filters one list: that is a ToggleGroup.",
    ],
  },
});
