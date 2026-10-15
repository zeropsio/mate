import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { reduceZeropsOperations } from "@t3tools/client-runtime/zerops/model";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";

import { DetailRow } from "~/components/chat/DetailRow";
import { ProviderInstanceCard } from "~/components/settings/ProviderInstanceCard";
import { DRIVER_OPTION_BY_VALUE } from "~/components/settings/providerDriverMeta";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { teamPeople } from "~/components/settings/teamSettings.logic";
import { STANDARD_THEME_CARDS } from "~/components/settings/ThemePreviewCircles";
import { ThemeLibraryCard } from "~/components/settings/ThemeSettings";
import { TeamList } from "~/components/settings/TeamSettings";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { PageHeader } from "~/components/ui/page-header";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";
import { SidebarContent, SidebarProvider } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import { Face, SheetRow, SheetSection } from "~/components/zerops/addresses/AddressesSheetBits";
import { MateFace, PersonAvatar, StatusDot } from "~/components/zerops/primitives";
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
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
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

/** The menu at the owner's 435 px, its rows the kit's Row at `lg`. */
function Menu() {
  return (
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
  );
}

function Chosen() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Chosen · Row: a mark, a title whose badges give way first, one-line meta, one muted line">
        <SpecimenGrid>
          <Specimen label='size="lg" (the menu at 435 px)'>
            <Menu />
          </Specimen>
          <Specimen label='size="md" lead={<PersonAvatar size={32} />} control (a person)'>
            <div className="w-[28rem]">
              <Row
                control={<MoreButton />}
                lead={<PersonAvatar name="Petra Malá" size={32} />}
                line="Owner · full access"
                title="Petra Malá"
              />
              <Row
                badges={<StatusDot label="Invited" sentence tone="attention" />}
                lead={<PersonAvatar name="Jan Svoboda" size={32} />}
                line="Developer · invited"
                title="Jan Svoboda, whose name is long enough to meet its badge"
              />
            </div>
          </Specimen>
          <Specimen label='size="md" pressable lead={<MateFace size={32} />} meta line'>
            <div className="w-[28rem]">
              <Row
                lead={<MateFace size={32} state="working" tint="olive" />}
                line="Reading the release notes since 1.0."
                meta="1m"
                pressable
                render={<button type="button" />}
                title="Fen"
              />
            </div>
          </Specimen>
          <Specimen label='<SettingsRow> = Row size="sm" lineWraps control'>
            <div className="w-[36rem]">
              <SettingsRow
                control={<Switch aria-label="Reduce motion" defaultChecked />}
                description="Rows and panels arrive without moving."
                title="Reduce motion"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Chosen · Card: flat, depth shown by tint; Section: a heading that hugs its rows, its one action at its edge">
        <SpecimenGrid>
          <Specimen label='<Card variant="flat"> of rows'>
            <div className="w-[32rem]">
              <Card variant="flat">
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
              </Card>
            </div>
          </Specimen>
          <Specimen label='<Card variant="flat" size="sm"> (a tool call in the conversation)'>
            <div className="w-[36rem]">
              {DEPLOY === undefined ? null : <ZeropsOperationCard operation={DEPLOY} />}
            </div>
          </Specimen>
          <Specimen label='<Card variant="flat" size="md"> holding <Card variant="inset" size="sm">'>
            <div className="w-[28rem]">
              <Card size="md" variant="flat">
                <p className="m-0 text-sm">A card on the page.</p>
                <Card size="sm" variant="inset">
                  <p className="m-0 text-muted-foreground text-sm">
                    A card inside it: a deeper tint, no second border.
                  </p>
                </Card>
              </Card>
            </div>
          </Specimen>
          <Specimen label='<SheetSection> = Section + Card variant="flat" of Rows'>
            <div className="w-[28rem]">
              <SheetSection
                action={
                  <Button size="xs" variant="ghost">
                    Add a domain
                  </Button>
                }
                part="domains"
                title="Your domains"
              >
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
              </SheetSection>
            </div>
          </Specimen>
          <Specimen label="<Section count action>">
            <div className="w-[28rem]">
              <Section
                action={
                  <Button size="xs" variant="ghost">
                    Add access
                  </Button>
                }
                count={3}
                title="People"
              >
                <Card variant="flat">
                  <Row
                    lead={<PersonAvatar name="Petra Malá" size={32} />}
                    line="Owner"
                    title="Petra Malá"
                  />
                </Card>
              </Section>
            </div>
          </Specimen>
          <Specimen label="<SettingsSection> = SectionHeader + rows">
            <div className="w-[36rem]">
              <SettingsSection
                headerAction={
                  <Button size="xs" variant="ghost">
                    Restore defaults
                  </Button>
                }
                title="Appearance"
              >
                <SettingsRow
                  control={<Switch aria-label="Reduce motion" defaultChecked />}
                  description="Rows and panels arrive without moving."
                  title="Reduce motion"
                />
              </SettingsSection>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Chosen · PageHeader: one piece on every page">
        <SpecimenGrid>
          <Specimen label="<PageHeader title count actions>">
            <div className="w-[44rem]">
              <PageHeader
                actions={<Button size="sm">Invite people</Button>}
                count={3}
                title="Team"
              />
            </div>
          </Specimen>
          <Specimen label="<PageHeader lead title line>">
            <div className="w-[44rem]">
              <PageHeader
                lead={<PersonAvatar name="Petra Malá" size={64} />}
                line="petra@example.com"
                title="Petra Malá"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

function CardsAndRows() {
  return (
    <SpecimenGrid>
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
              <Button size="sm" variant="outline">
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
    "The kit's Row, Card, Section and PageHeader first; then the card and row looks still home-made, most used first.",
  group: "Home-made",
  kind: "Containers",
  source: "apps/web/src/components",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-10">
        <Chosen />
        <SpecimenBlock title="Still home-made">
          <CardsAndRows />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
