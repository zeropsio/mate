import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { reduceZeropsOperations } from "@t3tools/client-runtime/zerops/model";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";

import { DetailRow } from "~/components/chat/DetailRow";
import { ProviderInstanceCard } from "~/components/settings/ProviderInstanceCard";
import { DRIVER_OPTION_BY_VALUE } from "~/components/settings/providerDriverMeta";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { teamPeople } from "~/components/settings/teamSettings.logic";
import { STANDARD_THEME_CARDS } from "~/components/settings/ThemePreviewCircles";
import { ThemeLibraryCard } from "~/components/settings/ThemeSettings";
import { TeamList } from "~/components/settings/TeamSettings";
import { Button } from "~/components/ui/button";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import { Face, SheetRow } from "~/components/zerops/addresses/AddressesSheetBits";
import { FlatCard } from "~/components/zerops/primitives/FlatCard";
import { StatusDot } from "~/components/zerops/primitives";
import { ProjectCards } from "~/components/zerops/projects/ProjectCards";
import { SidebarZeropsTree } from "~/components/zerops/SidebarZeropsTree";
import { ZeropsEnvironmentRow } from "~/components/zerops/ZeropsEnvironmentRow";
import { ZeropsGitChangeRow } from "~/components/zerops/ZeropsGitChangeRow";
import { ZeropsMateCard } from "~/components/zerops/ZeropsMateCard";
import { ZeropsOperationCard } from "~/components/zerops/ZeropsOperationCard";

import { CensusSpecimen, KitViewer } from "../census";
import { KIT_OVERVIEW_GROUPS, KIT_OVERVIEW_PROPS } from "../fixtures/overview";
import {
  KIT_MENU_ACTIVE,
  KIT_MENU_ACTIVITY,
  KIT_MENU_MATES,
  KIT_NO_CREW,
  kitMateActions,
} from "../fixtures/menuTree";
import { defineKitSection } from "../kitSection";
import { SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const noop = () => {};
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function change(number: number, title: string, line: string) {
  return {
    pull: {
      repository: "app",
      number,
      title,
      kind: "code" as const,
      mateProjectId: "kit-docs-fen",
      url: undefined,
      mergeability: "mergeable" as const,
      behind: false,
      merged: false,
      mergedAt: undefined,
      headSha: "3f9c1b2",
      baseBranch: "main",
      line: `app #${String(number)}`,
      updatedAt: minutesAgo(90),
    },
    line,
    status: { word: "Ready to merge", tone: "ok" as const },
  };
}

function member(id: string, fullName: string, roleCode: string): ZeropsOrganizationMember {
  return {
    id: `cu-${id}`,
    status: "ACTIVE",
    roleCode,
    user: { id, fullName, email: `${id}@example.com` },
  };
}

const TEAM = teamPeople({
  members: {
    known: true,
    status: "ready",
    refused: false,
    list: [
      member("petra", "Petra Malá", "OWNER"),
      member("karel", "Karel Novák", "ADMIN"),
      member("jan", "Jan Svoboda", "BASIC_USER"),
    ],
  },
  grants: {},
  places: {},
  pictures: {},
  viewerUserId: "petra",
  viewer: { roleCode: "OWNER", membershipId: "cu-petra" },
});

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CLAUDE_INSTANCE = ProviderInstanceId.make("claudeAgent");
const CLAUDE_LIVE: ServerProvider = {
  instanceId: CLAUDE_INSTANCE,
  driver: CLAUDE,
  enabled: true,
  installed: true,
  version: "2.1.0",
  status: "ready",
  auth: { status: "authenticated", email: "petra@example.com" },
  checkedAt: "2026-10-08T10:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

/** A deploy the Mate started and Zerops took: one tool call, folded as the conversation folds it. */
const DEPLOY = reduceZeropsOperations(
  [
    {
      id: "kit-deploy",
      turnId: "kit-turn",
      toolName: "zerops_deploy",
      input: { targetService: "storefront" },
      status: "completed",
      startedAt: "2026-10-15T09:00:00.000Z",
      settledAt: "2026-10-15T09:00:42.000Z",
      resultText: JSON.stringify({ status: "BUILD_TRIGGERED", targetService: "storefront" }),
      truncated: false,
      anchorActivityId: "kit-deploy",
      rowIds: new Set(["kit-deploy"]),
      agentInternal: false,
    },
  ],
  { projectId: undefined, builds: () => "running" as const },
).operations[0];

function MoreButton() {
  return (
    <Button aria-label="More" size="icon-xs" variant="ghost">
      <MoreHorizontalIcon />
    </Button>
  );
}

function CardsAndRows() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/settings/settingsLayout.tsx",
          uses: 55,
          files: 8,
        }}
        label={`<SettingsRow ${specimenLabel({ title: "Reduce motion" })} description control>`}
      >
        <div className="w-[36rem]">
          <SettingsRow
            control={<Switch aria-label="Reduce motion" defaultChecked />}
            description="Rows and panels arrive without moving."
            title="Reduce motion"
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/primitives/FlatCard.tsx",
          uses: 17,
          files: 12,
        }}
        label="<FlatCard> holding <ZeropsGitChangeRow> ×2 (ZeropsGitChangeRow: 2 uses in 2 files)"
      >
        <div className="w-[32rem]">
          <FlatCard>
            <div className="divide-y divide-border px-4 py-1">
              <ZeropsGitChangeRow
                change={change(4, "Add the changelog page", "#4 · Fen")}
                onOpen={noop}
                project="Acme Docs"
                repo="app"
              />
              <ZeropsGitChangeRow
                change={change(5, "Index the docs for search", "#5 · Quinn")}
                onOpen={noop}
                project="Acme Docs"
                repo="app"
              />
            </div>
          </FlatCard>
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx",
          uses: 7,
          files: 3,
        }}
        label="<SheetRow name sub end more> (in its <SheetSection> box)"
      >
        <div className="w-[28rem] rounded-xl border border-border/70 bg-card px-3.5">
          <SheetRow
            end={<Face tone="ok" word="Live" />}
            more={<MoreButton />}
            name="shop.example.com"
            sub="Points at storefront"
          />
          <SheetRow
            end={<Face tone="busy" word="Checking" />}
            more={<MoreButton />}
            name="www.example.com"
            sub="Waiting for its DNS record"
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/chat/DetailRow.tsx", uses: 5, files: 3 }}
        label="<DetailRow tone title time> (the working card's detail)"
      >
        <ul className="m-0 grid w-[28rem] list-none gap-px p-0">
          <DetailRow onOpen={noop} time="1m 12s" title="Read the release notes" tone="ok" />
          <DetailRow time="18s" title="Build the changelog page" tone="busy" word="Building" />
        </ul>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/ZeropsEnvironmentRow.tsx",
          uses: 3,
          files: 2,
        }}
        label="<ZeropsEnvironmentRow name tag summary status action menu>"
      >
        <ul className="m-0 w-[44rem] list-none p-0">
          <ZeropsEnvironmentRow
            action={
              <Button size="xs" variant="outline">
                Release
              </Button>
            }
            menu={<MoreButton />}
            name="production"
            status={<StatusDot label="Running v1.4.0" sentence tone="ok" />}
            summary="2 changes since v1.4.0"
            tag="production"
          />
          <ZeropsEnvironmentRow
            name="stage"
            status={<StatusDot label="Deploying" sentence tone="busy" />}
            summary="Building main"
            tag="stage"
          />
        </ul>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/ZeropsOperationCard.tsx",
          uses: 3,
          files: 2,
        }}
        label="<ZeropsOperationCard operation> (a deploy in the conversation)"
      >
        <div className="w-[36rem]">
          {DEPLOY === undefined ? null : <ZeropsOperationCard operation={DEPLOY} />}
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/settings/ThemeSettings.tsx", uses: 3, files: 1 }}
        label="<ThemeLibraryCard theme isActive activeModes>"
      >
        <div className="w-64">
          <ThemeLibraryCard
            activeModes={["light"]}
            isActive
            onUse={noop}
            onUseMode={noop}
            theme={STANDARD_THEME_CARDS[0]!}
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/SidebarZeropsTree.tsx",
          uses: 2,
          files: 2,
        }}
        label="<SidebarZeropsTree> (the menu's project row and Mate rows)"
      >
        <SidebarProvider className="block min-h-0">
          <aside
            className="w-[435px] border border-border bg-sidebar text-sidebar-foreground"
            data-sidebar="sidebar"
          >
            <SidebarContent>
              <div className="ps-2.25 pe-2 pt-3 pb-1">
                <SidebarZeropsTree
                  activeProjectId={KIT_MENU_ACTIVE}
                  candidates={KIT_MENU_MATES}
                  complete
                  getActivity={(entry) => KIT_MENU_ACTIVITY.get(entry.project.id)}
                  getCrew={() => KIT_NO_CREW}
                  getMateActions={kitMateActions}
                  onBrowseProjects={noop}
                  onSelect={noop}
                  timestampFormat="24-hour"
                />
              </div>
            </SidebarContent>
          </aside>
        </SidebarProvider>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/zerops/ZeropsMateCard.tsx", uses: 2, files: 1 }}
        label={`<ZeropsMateCard ${specimenLabel({ layout: "card" })}> · ${specimenLabel({ layout: "row" })}`}
      >
        <div className="flex w-[32rem] flex-col gap-3">
          <ZeropsMateCard
            face="working"
            line="Add the changelog page"
            menu={<MoreButton />}
            name="Fen"
            onSelect={noop}
            snippet="Reading the release notes since 1.0."
            time="1m"
            tint="olive"
          />
          <ZeropsMateCard
            face="idle"
            layout="row"
            line="Fix the broken links in the guides"
            name="Ada"
            onSelect={noop}
            time="18m"
            tint="violet"
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/projects/ProjectCards.tsx",
          uses: 2,
          files: 1,
        }}
        label="<ProjectCards> (an overview project card with its <CardMate> rows)"
      >
        <div className="w-[56rem] max-w-full">
          <ProjectCards
            focusGroup={undefined}
            groups={KIT_OVERVIEW_GROUPS}
            props={KIT_OVERVIEW_PROPS}
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/settings/ProviderInstanceCard.tsx",
          uses: 1,
          files: 1,
        }}
        label={`<ProviderInstanceCard ${specimenLabel({ mode: "list" })}>`}
      >
        <div className="w-[40rem]">
          <ProviderInstanceCard
            driverOption={DRIVER_OPTION_BY_VALUE[CLAUDE]}
            favoriteModels={[]}
            hiddenModels={[]}
            instance={{ driver: CLAUDE }}
            instanceId={CLAUDE_INSTANCE}
            liveProvider={CLAUDE_LIVE}
            mode="list"
            modelOrder={[]}
            onFavoriteModelsChange={noop}
            onHiddenModelsChange={noop}
            onModelOrderChange={noop}
            onUpdate={noop}
          />
        </div>
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/settings/TeamSettings.tsx", uses: 1, files: 1 }}
        label="<TeamList view> (a person's card)"
      >
        <div className="w-[48rem]">
          <TeamList view={TEAM} />
        </div>
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "home-made-cards-rows",
  title: "Home-made cards and rows",
  purpose:
    "13 home-made card and row looks in 35 files, most used first; the kit's Card, and its Sidebar's menu rows, stand for them.",
  group: "Home-made",
  kind: "Containers",
  source: "apps/web/src/components",
  render: () => (
    <KitViewer>
      <CardsAndRows />
    </KitViewer>
  ),
});
