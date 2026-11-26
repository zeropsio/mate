import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Tab, TabStrip } from "~/components/ui/tab-strip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const PAGES = [
  "Zerops",
  "Code",
  "Vault",
  "Data",
  "Files",
  "Terminal",
  "Browser",
  "Agents",
] as const;

/** Eight pages in a 30rem strip: the ones its edges cut off are "N more", the + stays in reach. */
function ManyTabs() {
  const [active, setActive] = useState<string>("Vault");
  return (
    <div className="flex h-10 w-full max-w-[30rem] items-center rounded-control border border-border bg-background px-2">
      <TabStrip
        action={
          <Button aria-label="Add a page" size="icon-sm" variant="ghost">
            <PlusIcon />
          </Button>
        }
        activeId={active}
        items={PAGES.map((page) => ({ id: page, label: page }))}
        onSelect={setActive}
      >
        {PAGES.map((page) => (
          <Tab
            active={page === active}
            key={page}
            onClick={() => setActive(page)}
            render={<button type="button" />}
            tabId={page}
          >
            {page}
          </Tab>
        ))}
      </TabStrip>
    </div>
  );
}

const VIEWS = ["Everything", "Mine", "Waiting on you"] as const;

/** A page's own views: three, all in reach. */
function PageViews() {
  const [active, setActive] = useState<string>("Everything");
  return (
    <div className="flex h-10 w-full max-w-[30rem] items-center">
      <TabStrip
        activeId={active}
        items={VIEWS.map((view) => ({ id: view, label: view }))}
        onSelect={setActive}
      >
        {VIEWS.map((view) => (
          <Tab
            active={view === active}
            key={view}
            onClick={() => setActive(view)}
            render={<button type="button" />}
            size="md"
            tabId={view}
          >
            {view}
          </Tab>
        ))}
      </TabStrip>
    </div>
  );
}

export default defineKitSection({
  id: "tab-strip",
  title: "TabStrip",
  purpose:
    "Tabs: the open one filled; past the strip's room the others fold to icons and the cut-off ones go to an N more menu, the action never scrolling away.",
  group: "Chosen",
  kind: "Navigation",
  source: "apps/web/src/components/ui/tab-strip.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Past the strip's room the cut-off tabs fold into an N more menu; the + stays in reach."
        title="Sizes and overflow"
      >
        <SpecimenGrid size="xl">
          <Specimen
            label='<TabStrip action items> · <Tab size="sm">'
            note="A panel's eight pages in 30 rem"
          >
            <ManyTabs />
          </Specimen>
          <Specimen label='<TabStrip> · <Tab size="md">' note="A page's own views">
            <PageViews />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
