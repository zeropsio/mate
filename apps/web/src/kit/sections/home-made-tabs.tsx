import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { ConversationStripView } from "~/components/chat/ConversationStrip";
import type { LineCrewmate, LineMate } from "~/components/chat/ConversationStrip.logic";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { ProviderInstanceCard } from "~/components/settings/ProviderInstanceCard";
import { DRIVER_OPTION_BY_VALUE } from "~/components/settings/providerDriverMeta";
import { SettingsBreadcrumb } from "~/components/settings/SettingsBreadcrumb";
import type { OverviewShow } from "~/components/zerops/projects/projectsView.logic";
import { OverviewFilters } from "~/components/zerops/projects/OverviewFilters";
import { ZeropsDataBreadcrumbs } from "~/components/zerops/ZeropsDataBreadcrumbs";
import { Button } from "~/components/ui/button";
import { Tab, TabStrip } from "~/components/ui/tab-strip";
import type { RightPanelSurface } from "~/rightPanelStore";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";

import { CensusSpecimen, KitViewer } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const noop = () => {};

const SURFACES: RightPanelSurface[] = [
  { id: "zerops", kind: "zerops" },
  { id: "git", kind: "git" },
  { id: "vault", kind: "vault" },
  { id: "data", kind: "data" },
];

/** At the reference viewport's panel width: picking a page opens it, or goes to it when open. */
function SidePanelStrip() {
  const [surfaces, setSurfaces] = useState<RightPanelSurface[]>(SURFACES);
  const [active, setActive] = useState("vault");
  const open = (kind: string) => {
    setSurfaces((current) =>
      current.some((surface) => surface.id === kind)
        ? current
        : [...current, { id: kind, kind } as RightPanelSurface],
    );
    setActive(kind);
  };
  return (
    <div className="flex h-56 w-[33.75rem] overflow-hidden border border-border bg-background">
      <RightPanelTabs
        activeSurfaceId={active}
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
        })}
        defaultWidth={640}
        liveAgentCount={0}
        layoutControls={<span className="w-20 shrink-0" />}
        maximized
        mode="inline"
        onActivate={(surface) => setActive(surface.id)}
        onAdd={(kind) => open(kind)}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={(surface) =>
          setSurfaces((current) => current.filter((entry) => entry.id !== surface.id))
        }
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={surfaces}
        terminalLabelsById={new Map()}
      >
        <p className="m-0 p-4 text-muted-foreground text-sm">The open tab's panel.</p>
      </RightPanelTabs>
    </div>
  );
}

const thread = (id: string) => ThreadId.make(`kit-thread-${id}`);

const crewmate = (
  handle: string,
  name: string,
  tint: LineCrewmate["tint"],
  over: Partial<LineCrewmate> = {},
): LineCrewmate => ({
  handle,
  name,
  tint,
  face: "idle",
  lead: false,
  open: false,
  known: true,
  threadId: thread(handle),
  role: "Crewmate",
  job: null,
  status: null,
  ...over,
});

function ConversationLine() {
  const [open, setOpen] = useState<string | null>("ada");
  const mate: LineMate = {
    name: "Fen",
    tint: "olive",
    face: "idle",
    open: open === null,
    threadId: thread("fen"),
    tooltip: null,
  };
  const crew = [
    crewmate("ada", "Ada", "violet", { lead: true, face: "working", job: "Builds the API" }),
    crewmate("bo", "Bo", "sky", { job: "Writes the tests" }),
    crewmate("cy", "Cy", "coral", { face: "needs", job: "Reviews the changes" }),
  ].map((each) => ({ ...each, open: each.handle === open }));
  return (
    <div className="flex h-12 w-[40rem] items-center border-b border-border bg-background px-4">
      <ConversationStripView
        chats={{
          chats: [{ threadId: thread("fen"), title: "Fen", main: true, open: open === null }],
          close: null,
        }}
        crew={crew}
        mate={mate}
        onCloseChat={noop}
        onOpen={(threadId) => {
          const pressed = crew.find((each) => each.threadId === threadId);
          setOpen(pressed?.handle ?? null);
        }}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
    </div>
  );
}

function Filters() {
  const [show, setShow] = useState<OverviewShow | undefined>(undefined);
  return <OverviewFilters mine={2} onShow={setShow} show={show} waiting={3} />;
}

const CLAUDE = ProviderDriverKind.make("claudeAgent");

const PAGES = ["Zerops", "Git", "Vault", "Data", "Files", "Terminal", "Browser", "Agents"] as const;

/** Eight pages in a 30rem strip: the ones its edges cut off are "N more", the + stays in reach. */
function ManyTabs() {
  const [active, setActive] = useState<string>("Vault");
  return (
    <div className="flex h-10 w-[30rem] items-center border border-border bg-background px-2">
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

function Chosen() {
  return (
    <SpecimenBlock title="Chosen · TabStrip and Tab: filled while open; past its room the others fold to icons, the cut-off tabs in an N more menu; the action never scrolls away">
      <SpecimenGrid>
        <Specimen label={'<TabStrip action items> of <Tab size="sm"> (a panel\'s pages)'}>
          <ManyTabs />
        </Specimen>
        <Specimen label="the side panel's strip (RightPanelTabs on TabStrip)">
          <SidePanelStrip />
        </Specimen>
        <Specimen label={"<Tab size=\"md\"> (a page's own views: the overview's filters)"}>
          <Filters />
        </Specimen>
        <Specimen label={'<TabStrip> of <Tab size="md"> (a provider\'s Models / Configuration)'}>
          <div className="h-72 w-[40rem] overflow-hidden border border-border">
            <ProviderInstanceCard
              driverOption={DRIVER_OPTION_BY_VALUE[CLAUDE]}
              favoriteModels={[]}
              hiddenModels={[]}
              instance={{ driver: CLAUDE }}
              instanceId={ProviderInstanceId.make("claudeAgent")}
              liveProvider={undefined}
              mode="editor"
              modelOrder={[]}
              onFavoriteModelsChange={noop}
              onHiddenModelsChange={noop}
              onModelOrderChange={noop}
              onUpdate={noop}
            />
          </div>
        </Specimen>
      </SpecimenGrid>
    </SpecimenBlock>
  );
}

function TabsAndStrips() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/chat/ConversationStrip.tsx", uses: 1, files: 1 }}
        label="<ConversationStripView mate crew> (the Mate and its crewmates as tabs)"
      >
        <ConversationLine />
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

function Breadcrumbs() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/WorkspaceBreadcrumb.tsx", uses: 13, files: 5 }}
        label={`<SettingsBreadcrumb ${specimenLabel({ pathname: "/settings/team/cu-jan" })}>`}
      >
        <SettingsBreadcrumb pathname="/settings/team/cu-jan" />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/ZeropsDataBreadcrumbs.tsx",
          uses: 1,
          files: 1,
        }}
        label="<ZeropsDataBreadcrumbs path> (the Data panel's path)"
      >
        <ZeropsDataBreadcrumbs
          onNavigate={noop}
          path={{ service: "db", segments: ["public", "orders"] }}
        />
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "home-made-tabs",
  title: "Tabs",
  purpose:
    "The kit's TabStrip and Tab first; then the crew's seat strip and the breadcrumbs, still home-made.",
  group: "Home-made",
  kind: "Navigation",
  source: "apps/web/src/components/RightPanelTabs.tsx",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-8">
        <Chosen />
        <SpecimenBlock title="Still home-made: the crew's seats">
          <TabsAndStrips />
        </SpecimenBlock>
        <SpecimenBlock title="Breadcrumbs">
          <Breadcrumbs />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
