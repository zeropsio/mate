import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
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
import type { RightPanelSurface } from "~/rightPanelStore";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";

import { CensusSpecimen, KitViewer } from "../census";
import { defineKitSection } from "../kitSection";
import { SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const noop = () => {};

const SURFACES: RightPanelSurface[] = [
  { id: "zerops", kind: "zerops" },
  { id: "git", kind: "git" },
  { id: "vault", kind: "vault" },
  { id: "data", kind: "data" },
];

function SidePanelStrip() {
  const [active, setActive] = useState("vault");
  return (
    <div className="flex h-56 w-[40rem] overflow-hidden border border-border bg-background">
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
        maximized={false}
        mode="inline"
        onActivate={(surface) => setActive(surface.id)}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={SURFACES}
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

function TabsAndStrips() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/RightPanelTabs.tsx", uses: 3, files: 2 }}
        label="<RightPanelTabs surfaces activeSurfaceId> (the side panel's tab strip)"
      >
        <SidePanelStrip />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/settings/providerSettingsTabs.ts",
          uses: 3,
          files: 2,
        }}
        label={`<ProviderInstanceCard ${specimenLabel({ mode: "editor" })}> (its Models / Configuration tabs)`}
      >
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
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/chat/ConversationStrip.tsx", uses: 1, files: 1 }}
        label="<ConversationStripView mate crew> (the Mate and its crewmates as tabs)"
      >
        <ConversationLine />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/projects/OverviewFilters.tsx",
          uses: 1,
          files: 1,
        }}
        label={`<OverviewFilters ${specimenLabel({ waiting: 3, mine: 2 })} onShow>`}
      >
        <Filters />
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
  title: "Home-made tabs",
  purpose:
    "6 home-made tab strips, switches that act as tabs and breadcrumbs in 12 files, most used first; the kit has no Tabs or Breadcrumb, and ToggleGroup is the nearest.",
  group: "Home-made",
  kind: "Navigation",
  source: "apps/web/src/components/RightPanelTabs.tsx",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-8">
        <SpecimenBlock title="Tabs and switches that act as tabs">
          <TabsAndStrips />
        </SpecimenBlock>
        <SpecimenBlock title="Breadcrumbs">
          <Breadcrumbs />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
