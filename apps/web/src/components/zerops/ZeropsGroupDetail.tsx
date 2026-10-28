import { useEnvironmentDeployOffer } from "../../zerops/useChangeOffers";
import { Card } from "../ui/card";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { GitStopDetailPage } from "./GitStopDetail";
import { GitDeliveryStatus } from "./GitDeliveryStatus";
import { GitMirrorDialog } from "./GitMirrorDialog";
import { connectedRepos, GitRemoteLines } from "./GitRemoteSettings";
import { HqEnvironmentId, type ProjectId } from "@t3tools/contracts";
import { hqRefusalWords, unreadEnvironmentsWords } from "@t3tools/client-runtime/zerops/hq";
import {
  canonicalAppEnvironments,
  canonicalHqNavigation,
  environmentById,
  type CanonicalHqNavigationRead,
  type CanonicalAppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useAccountDataOptional, useProjection } from "~/zerops/accountData";
import { ReleaseAction, useReleaseOffer, type ReleaseOffer } from "./ZeropsReleaseVerb";
import { usePublicAccess } from "~/zerops/usePublicAccess";
import { StopVaultSide, StopVaultToggle, useStopVaultOpen } from "./vault/StopVault";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { RuntimeStopPublicAccess, StopPublicAccessStatus } from "./StopPublicAccess";
/**
 * A project group's page, and one stop's, in place of the thread.
 *
 * The left menu draws a project as a timeline of where work *is*. These are
 * the same drawing with room: the group's over *time*, a stop's around the one
 * commit it happens to be running. They mount under the chat layout and stand
 * in the frame /zerops stands in, so the menu stays put and only the pane changes —
 * "I imagine the group and the prod/stage detail to be in place of the chat"
 * (the owner, 2026-09-19).
 *
 * The flow is the application's, read while the page is drawn (`projectFlows`),
 * and history summaries use recorded domain rows. Commit comparisons are requested only after
 * the person expands a release (`useReleaseComparisons`).
 *
 * Structural only — what a row says is `projectFlow.ts`'s and
 * `groupHistory.ts`'s (rule R5).
 */
import { StopReadAgain } from "./StopReadAgain";
import { StopTierStops } from "./StopTierStops";
import {
  cannotTellWhatRuns,
  buildZeropsGroupTree,
  heldGroupLabel,
  flowVerbKey,
  flowVerbLabel,
  projectNameInApp,
  readZeropsMembership,
  environmentSlots,
  productionRunsOf,
  type EnvironmentSlotRow,
  releaseContentsSummary,
  carriedReads,
  movedCommits,
  movedCount,
  releaseTagsByCommit,
  type MovedCommits,
  shortCommit,
  type ZeropsPublicRoute,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type CompareRead,
  type FlowReleaseRow,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentTier,
  type GroupRowTone,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsProject,
  sameCommit,
  firstDeployLine,
  firstDeployTone,
  stageFirstDeploy,
  type FirstDeploy,
} from "@t3tools/client-runtime/zerops";
import {
  DEPLOYS_ASIDE,
  earlierReleasesLabel,
  NONE_YET,
  notInZerops,
  serviceRows,
  stopCardTitle,
  rowsRunningAgain,
  stopFailedDeploys,
  stopKeyGap,
  stopTierStops,
  stopVerdict,
  stopView,
  type Deployment,
  type StopFailedDeploy,
  type StopServiceRow,
  type StopTierStop,
  type StopVerdict,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Fragment, use, useCallback, useContext, useId, useMemo, useState } from "react";

import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useAddMate } from "~/zerops/newMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useFlowVerbs, type FlowVerbOutcome } from "~/zerops/flowVerbs";
import {
  useAppsEnvironments,
  useFlowNavigation,
  useMateNames,
  useProjectFlows,
  useStopDeploymentsShown,
  type ZeropsProjectFlow,
} from "~/zerops/projectFlows";
import { useKeepDeployKeyOffer } from "~/zerops/useChangeOffers";
import { useOpenReview } from "~/zerops/review";
import { useReleaseComparisons, type ComparedCommits } from "~/zerops/useReleaseComparisons";
import { useHqRecipeFailure } from "~/zerops/useHqAppDetail";
import {
  useAddEnvironment,
  useGroupPendingEnvironments,
  useEnvironmentOffers,
} from "~/zerops/useAddEnvironment";
import { useOpenPutLive } from "~/zerops/putLive";
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { useEnvironmentSetup } from "~/zerops/useEnvironmentSetup";
import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { type ZeropsHistoryState } from "~/zerops/useRepositoryHistory";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { ZeropsHostedFrame, type SidePlacement } from "./landing/ZeropsHostedFrame";
import { ProjectAccess, ProjectPeople } from "./projects/ProjectPeople";
import { ProjectCardStandIn } from "./projects/OverviewStandIn";
import { ProjectPageSpend } from "./projects/ProjectSpend";
import { ProjectPageHistory } from "./projects/ProjectHistory";
import { groupRepository } from "./projects/projectHistory.logic";
import { ZeropsProjectsContent } from "./ZeropsProjectsPage";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryChange, type HistoryNames } from "./ZeropsHistoryView";
import { ProjectAutomation } from "./projectAutomation/ProjectAutomation";
import { MicroLabel, STATUS_BADGE_TONE, VerdictPanel, VerdictPanelWaiting } from "./primitives";
import { ZeropsDeployAnswer } from "./ZeropsDeployAnswer";
import { deployAnswerSaid } from "@t3tools/client-runtime/zerops/hq";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";
import { RecordedStageHistory, type RecordedStageHistoryProps } from "./RecordedStageHistory";
import { ZeropsChangeReview } from "./review/ZeropsChangeReview";
import { ZeropsStopMenu } from "./ZeropsStopMenu";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import {
  findInventoryProjectRef,
  HeldInventoryContext,
  withheldProjectNotice,
} from "~/zerops/inventoryContext";
import { useStopServices } from "~/zerops/accountForge";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { unreadFlowWords } from "~/zerops/hqRead.logic";
import { EmptyState } from "../ui/empty";
import { Loading } from "../ui/loading";
import { Badge } from "~/components/ui/badge";
import { MiddleTruncate } from "../ui/middle-truncate";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import { PlaceServiceTable, type StopDeployAgain } from "./place/PlaceServices";
import { usePlaceServiceMap } from "./place/usePlaceServiceMap";
import {
  placeAddress,
  placeServiceRows,
  placeStatus,
  placeTitle,
  environmentTitle,
  rollBackTarget,
  stopRowSays,
} from "./place/place.logic";
import { environmentSlotWord } from "./projects/projectCard.logic";

/** A stop's tone as a dot's. Neutral wears none: nothing has been deployed. */
const STOP_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

/**
 * The group behind a route parameter, from the same derivation the menu names
 * it by (`buildZeropsGroupTree`).
 *
 * A page titled by its route parameter shows a raw id; a page that wants to
 * *rename* the project needs the group itself, the HQ application its name is
 * kept on.
 */
function useGroup(groupId: string): ZeropsGroup | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    // Order is irrelevant here — a lookup by groupId, not a listing.
    () =>
      buildZeropsGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group,
    [groupId, listing],
  );
}

/**
 * What a stop says in place of its content while the grant withholds its
 * project (DESIGN §3.4), and the stops whose content may be read — what the
 * attention panel is drawn from.
 */
function useWithheldStops(environments: ReadonlyArray<EnvironmentRow> | undefined): {
  readonly withheldNotice: (projectId: string) => string | null;
  readonly shown: ReadonlyArray<EnvironmentRow>;
} {
  const inventory = useZeropsInventory();
  const withheldNotice = useCallback(
    // A row of the project's page: a removal is its own route's to say (a rename proves one).
    (projectId: string) =>
      withheldProjectNotice(inventory, projectId, undefined, { removal: false }),
    [inventory],
  );
  const shown = useMemo(
    () =>
      environments === undefined
        ? EMPTY_STOPS
        : environments.filter(
            (environment) =>
              environment.target.kind !== "zerops" ||
              withheldNotice(environment.target.projectId) === null,
          ),
    [environments, withheldNotice],
  );
  return { withheldNotice, shown };
}

/**
 * The project's name: the listing's, else — the listing failed, lapsed, or withholds every member —
 * the name HQ places its members under; undefined only while neither knows it.
 */
function useGroupName(groupId: string): string | undefined {
  const held = useContext(HeldInventoryContext);
  const listed = useGroup(groupId)?.name;
  return listed ?? (held === null ? undefined : heldGroupLabel(held.projects, groupId));
}

/** Every environment of a group, by the sha it runs, whole or short as its version name spells it. */
function deployedShas(environments: ReadonlyArray<EnvironmentRow>): ReadonlyMap<string, string> {
  const deployed = new Map<string, string>();
  for (const environment of environments) {
    const sha = environment.version.sha;
    if (sha !== undefined) deployed.set(environment.name, sha);
  }
  return deployed;
}

/** What a history may call a Mate: its name rather than its bot login. */
function useHistoryNames(): HistoryNames {
  const mateNames = useMateNames();
  return useMemo(() => ({ mateNames }), [mateNames]);
}

/** Where a project with nothing set up goes: the screen that sets things up. */
function useOpenProjects(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/zerops" });
  }, [navigate]);
}

/**
 * Where each declared stage of the group that runs nothing stands on its first deploy
 * (`stageFirstDeploy`), as its cell on the projects page and the menu say it: from what the
 * platform runs, HQ's jobs of its deploys, and whether HQ is still bringing it up.
 */
function useStageFirstDeploys(
  flow: ZeropsProjectFlow | undefined,
): (projectId: string) => FirstDeploy | undefined {
  const { listing } = useZeropsCandidates();
  const deployments = useStopDeploymentsShown();
  return (projectId) => {
    const row = flow?.environments.find(
      (entry) =>
        entry.target.kind === "zerops" &&
        entry.target.projectId === projectId &&
        entry.tier === "stage",
    );
    const candidate = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    return stageFirstDeploy({
      birth: row?.birth,
      projectStatus: candidate?.project.status,
      services: candidate?.services === undefined ? undefined : candidate.services.statuses,
      deployment: deployments.get(projectId),
      deploys: row?.deploys,
      keyGap: row?.keyGap ?? false,
    });
  };
}

type RuntimeStopIdentity = {
  readonly projectId: string;
  readonly environmentId?: HqEnvironmentId;
  readonly name: string;
  readonly tier: "production" | "stage";
};
export function runtimeStopsOf(
  groupId: string,
  projects: ReadonlyArray<ZeropsProject>,
  declared:
    | ReadonlyArray<
        Pick<
          import("@t3tools/client-runtime/zerops/hq").CanonicalHqEnvironment,
          "id" | "target" | "name" | "tier"
        >
      >
    | undefined,
): ReadonlyArray<RuntimeStopIdentity> {
  const stops = new Map<string, RuntimeStopIdentity>();
  for (const project of projects) {
    const membership = readZeropsMembership(project);
    if (membership.groupId !== groupId) continue;
    if (membership.role !== "prod" && membership.role !== "stage" && membership.role !== "devstage")
      continue;
    stops.set(project.id, {
      projectId: project.id,
      name: projectNameInApp(project),
      tier: membership.role === "prod" ? "production" : "stage",
    });
  }
  if (declared !== undefined)
    for (const stop of declared) {
      if (stop.target.kind !== "zerops") continue;
      stops.set(stop.target.projectId, {
        projectId: stop.target.projectId,
        environmentId: stop.id,
        name: stop.name,
        tier: stop.tier,
      });
    }
  return [...stops.values()];
}

/**
 * The Mates of a group that are also its stage (`devstage`): HQ deploys nothing to them, their
 * agent does, and they stand for the stage in the *Environments* section.
 */
export function devstagesOf(
  groupId: string,
  projects: ReadonlyArray<ZeropsProject>,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  return projects.flatMap((project) => {
    const membership = readZeropsMembership(project);
    return membership.groupId === groupId && membership.role === "devstage"
      ? [{ id: project.id, name: projectNameInApp(project) }]
      : [];
  });
}

function useDevstages(
  groupId: string,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const projects = held?.projects ?? inventory.projects;
  return useMemo(() => devstagesOf(groupId, projects), [groupId, projects]);
}

function useRuntimeStops(groupId: string): ReadonlyArray<RuntimeStopIdentity> {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const declared = useAppsEnvironments(useMemo(() => [groupId], [groupId]))[groupId]?.environments;
  return runtimeStopsOf(groupId, held?.projects ?? inventory.projects, declared);
}

/** Runtime remains readable when HQ's changes/release detail has not answered. */
export function ZeropsRuntimeStops({
  stops,
  deployments,
  onOpen,
}: {
  readonly stops: ReadonlyArray<{
    readonly projectId: string;
    readonly environmentId?: HqEnvironmentId;
    readonly name: string;
    readonly tier: "production" | "stage";
  }>;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  readonly onOpen?: (projectId: string) => void;
}) {
  if (stops.length === 0) return null;
  return (
    <Section title="Environments">
      <ul className="flex flex-col gap-3">
        {stops.map((stop) => {
          const view = stopView({
            deployment: deployments?.get(stop.projectId) ?? UNREAD_DEPLOYMENT,
            row: undefined,
            nowMs: 0,
          });
          const says = stopRowSays(stop.tier, view);
          const words = (
            <>
              <span className="text-sm font-medium">{environmentTitle(stop.tier, stop.name)}</span>
              {says.version === undefined ? null : (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {says.version}
                </span>
              )}
              <Badge
                dot
                tone={
                  STATUS_BADGE_TONE[
                    says.tone === undefined ? "off" : (STOP_DOT_TONE[says.tone] ?? "off")
                  ]
                }
              >
                {says.word}
              </Badge>
            </>
          );
          return (
            <li className="flex min-w-0 flex-col gap-2" key={stop.projectId}>
              <div className="flex min-w-0 items-center gap-3">
                {onOpen === undefined ? (
                  <span className="flex min-w-0 items-center gap-3">{words}</span>
                ) : (
                  <button
                    className="flex min-w-0 items-center gap-3 text-left"
                    type="button"
                    onClick={() => onOpen(stop.environmentId ?? stop.projectId)}
                  >
                    {words}
                  </button>
                )}
                <StopReadAgain projectId={stop.projectId} />
              </div>
              <RuntimeStopPublicAccess projectId={stop.projectId} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * A project's own page: its card from the overview at the page's width — the same slots, so a
 * Mate's row, a place's panel and the release's door are one thing on both — and the column
 * beside it with what a card has no room for: the people on it, its environments, its
 * repositories and its history.
 */
export function ZeropsGroupDetailPage({ groupId }: { readonly groupId: string }) {
  const groupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: groupName });
  // The New Mate dialog over this page, as from every "Add a Mate" (`ZeropsNewMateHost`).
  const addMate = useAddMate();
  const project = useMemo(
    () => ({
      groupId,
      aside: <ZeropsGroupAside groupId={groupId} />,
      people: <ProjectPeople groupId={groupId} />,
      onAddMate: () => {
        addMate(groupId);
      },
      unread: <UnreadGroupDetail groupId={groupId} />,
    }),
    [addMate, groupId],
  );
  return (
    <ZeropsHostedFrame breadcrumb={<Crumbs crumbs={crumbs.slice(0, -1)} />} width="full">
      <ZeropsProjectsContent project={project} search={NO_SEARCH} />
    </ZeropsHostedFrame>
  );
}

const NO_SEARCH = {};

/** The page's column: what the project's card has no room for, once its flow is read. */
function ZeropsGroupAside({ groupId }: { readonly groupId: string }) {
  const recipeFailure = useHqRecipeFailure(groupId);
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const flow = flows.get(groupId);
  if (flow === undefined) return null;
  return <KnownGroupAside groupId={groupId} flow={flow} recipeFailure={recipeFailure} />;
}

function UnreadGroupDetail({ groupId }: { readonly groupId: string }) {
  const deployments = useStopDeploymentsShown();
  const runtimeStops = useRuntimeStops(groupId);
  const navigate = useNavigate();
  // The project's page in its own boxes: its card's place, and its column, where the environments
  // already read stand as the page's own Environments will.
  return (
    <div className="ov-page">
      <UnreadDetail
        groupId={groupId}
        standIn={
          <Loading label="This project">
            <ProjectCardStandIn page />
          </Loading>
        }
      />
      <div className="ov-page-aside">
        <ZeropsRuntimeStops
          stops={runtimeStops}
          deployments={deployments}
          onOpen={(projectId) => {
            void navigate({ to: "/group/$groupId/$projectId", params: { groupId, projectId } });
          }}
        />
      </div>
    </div>
  );
}

function KnownGroupAside({
  groupId,
  flow,
  recipeFailure,
}: {
  readonly groupId: string;
  readonly flow: ZeropsProjectFlow;
  readonly recipeFailure: ReturnType<typeof useHqRecipeFailure>;
}) {
  const deployments = useStopDeploymentsShown();
  const spend = use(ProjectPageSpend);
  const environments = flow.environments;
  const repo = groupRepository(environments);
  const history = use(ProjectPageHistory);
  const waiting = flow.release.summary ?? releaseContentsSummary(flow.release.contents, 20);
  const groupName = useGroupName(groupId);
  const openProjects = useOpenProjects();
  const release = useReleaseOffer(groupId, flow);
  const { withheldNotice } = useWithheldStops(environments);
  const firstDeployOf = useStageFirstDeploys(flow);
  // *Mirror code to GitHub or GitLab…* over this page, as from the overview card's ···.
  const [mirroring, setMirroring] = useState(false);
  const offered = useEnvironmentOffers()(groupId);
  const addEnvironment = useAddEnvironment();
  const openPutLive = useOpenPutLive();
  const devstages = useDevstages(groupId);
  const pendingEnvironments = useGroupPendingEnvironments(groupId);
  const { listing } = useZeropsCandidates();
  const { halfMade, finishing } = useEnvironmentSetup(
    useMemo(() => heldCandidates(listing).rows.map(({ project }) => project.id), [listing]),
  );

  const production = environments.find((entry) => entry.tier === "production");
  const halfMadeHere = halfMade.filter((entry) => entry.groupId === groupId);
  // Drawn once HQ has told the environments: before that, or where HQ refuses them to the reader,
  // nothing is known to be absent.
  const slots = !flow.declarationsRead
    ? []
    : environmentSlots({
        environments: environments.map((entry) => ({
          id: entry.id,
          target: entry.target,
          tier: entry.tier,
        })),
        devstages,
        pending: pendingEnvironments,
        halfMade: halfMadeHere.map((entry) => ({
          id: entry.projectId,
          tier: entry.tier,
          finish: entry.finish,
        })),
        recipeTiers: flow.recipeTiers,
        recipeRead: flow.recipeRead,
        offered: offered ?? { stage: false, production: false },
        productionRuns:
          production?.target.kind !== "zerops"
            ? "unknown"
            : productionRunsOf(deployments.get(production.target.projectId)),
        waiting: {
          count: waiting.total,
          atLeast: waiting.atLeast,
          changeCount: waiting.changeCount,
        },
        // Entries are what `main` would put in a release: none says it holds no code, once the
        // repositories and the recipe that names their services are both read.
        mainHasCode:
          flow.release.entries.length > 0
            ? true
            : flow.repos === undefined || !flow.recipeRead
              ? undefined
              : false,
        releaseOffered: release.offered,
        releasing: flow.release.inFlight,
      });
  return (
    <>
      <ZeropsGroupPane
        readFailures={
          <ProjectReadFailures recipe={recipeFailure} comparison={flow.release.comparisonFailure} />
        }
        environments={environments}
        repos={flow.repos}
        codeRepos={flow.codeRepos}
        slots={slots}
        onAdd={(tier) => {
          if (tier === "production") openPutLive(groupId);
          else addEnvironment(groupId, tier);
        }}
        onFinish={(projectId) => {
          const entry = halfMadeHere.find((candidate) => candidate.projectId === projectId);
          if (entry !== undefined) finishing.finish(entry);
        }}
        finishing={finishing.finishing.has(groupId)}
        history={history}
        groupId={groupId}
        name={groupName}
        onSetUp={openProjects}
        release={release}
        repo={repo}
        withheldNotice={withheldNotice}
        firstDeployOf={firstDeployOf}
        onMirror={() => {
          setMirroring(true);
        }}
        spend={spend}
        automation={
          <ProjectAutomation
            groupId={groupId}
            name={groupName}
            repos={flow.codeRepos ?? flow.repos}
          />
        }
      />
      {mirroring && groupName !== undefined ? (
        <GitMirrorDialog
          appId={groupId}
          appName={groupName}
          onClose={() => {
            setMirroring(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Production, then every stage — the order the project's card says them in. */
function productionFirst(
  slots: ReadonlyArray<EnvironmentSlotRow>,
): ReadonlyArray<EnvironmentSlotRow> {
  const production = (slot: EnvironmentSlotRow) => "tier" in slot && slot.tier === "production";
  return [...slots.filter(production), ...slots.filter((slot) => !production(slot))];
}

/**
 * A project's page column, drawn — every read already done and handed in: its environments, its
 * repositories and its history, each on the card's ground.
 *
 * Split from the page above for the same reason the change's pane is: a
 * harness and a test can then look at a project with nothing set up without an account behind it.
 */
export function ZeropsGroupPane({
  repos,
  codeRepos,
  readFailures,
  environments,
  slots,
  onAdd,
  onFinish,
  finishing,
  history,
  groupId,
  name,
  onSetUp,
  release,
  repo,
  withheldNotice,
  firstDeployOf,
  onMirror,
  spend,
  automation,
}: {
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  /** The repositories a Mate ships code to: the ones its Repositories section may name. */
  readonly codeRepos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly readFailures?: React.ReactNode;
  /** Its History, from the project page (`ProjectPageHistory`): its releases, each with its changes. */
  readonly history: React.ReactNode;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  /** The *Environments* section's rows: what exists, and a slot for each tier that does not. */
  readonly slots: ReadonlyArray<EnvironmentSlotRow>;
  /** *Finish setup*, pressed on a half-made environment, by its project. */
  readonly onFinish: (id: string) => void;
  /** An environment of this application is being finished now. */
  readonly finishing: boolean;
  /** *Add stage* or *Put it live*, pressed on a slot. */
  readonly onAdd: (tier: EnvironmentRow["tier"]) => void;
  readonly groupId: string;
  /** The project's name; undefined while the listing has not named it — never its id. */
  readonly name: string | undefined;
  /** Where a project with nothing set up goes to get something set up. */
  readonly onSetUp: () => void;
  readonly release: ReleaseOffer;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  /**
   * What a stop says in place of its content while the grant withholds its
   * project (DESIGN §3.4); `null` while it may be shown. Absent, every stop is.
   */
  readonly withheldNotice?: (projectId: string) => string | null;
  /** Where a stage that runs nothing stands on its first deploy (`useStageFirstDeploys`). */
  readonly firstDeployOf?: (projectId: string) => FirstDeploy | undefined;
  /** *Mirror code to GitHub or GitLab…*, as the overview card's ··· opens it. */
  readonly onMirror?: (() => void) | undefined;
  /** Its Spend section, from the project page (`ProjectPageSpend`), above its automation. */
  readonly spend?: React.ReactNode;
  /** Its Automation section (`ProjectAutomation`), above its repositories. */
  readonly automation?: React.ReactNode;
}) {
  return (
    <>
      {readFailures}
      {slots.length === 0 ? null : (
        <SideSection title="Environments">
          <ul className="flex flex-col">
            {productionFirst(slots).map((slot) => {
              if (slot.kind === "devstage")
                return (
                  <li className="flex min-w-0 items-center gap-3 px-2 py-2" key={slot.id}>
                    <span className="shrink-0 text-sm font-medium text-muted-foreground">
                      Stage
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {slot.line}
                    </span>
                  </li>
                );
              if (slot.kind === "creating")
                return (
                  <li className="flex min-w-0 items-center gap-3 px-2 py-2" key={slot.id}>
                    <span className="shrink-0 text-sm font-medium text-muted-foreground">
                      {slot.tier === "stage" ? "Stage" : "Production"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {slot.line}
                    </span>
                  </li>
                );
              if (slot.kind === "half-made")
                return (
                  <li className="flex min-w-0 items-center gap-3 px-2 py-2" key={slot.id}>
                    <span className="shrink-0 text-sm font-medium text-muted-foreground">
                      {slot.tier === "stage" ? "Stage" : "Production"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {slot.line}
                    </span>
                    {slot.finish ? (
                      <Button
                        disabled={finishing}
                        onClick={() => {
                          onFinish(slot.id);
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Finish setup
                      </Button>
                    ) : null}
                  </li>
                );
              if (slot.kind === "slot")
                return (
                  <li className="flex min-w-0 items-center gap-3 px-2 py-2" key={slot.tier}>
                    <span className="shrink-0 text-sm font-medium text-muted-foreground">
                      {slot.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {environmentSlotWord(slot.tier, slot.line)}
                    </span>
                    {slot.add ? (
                      <Button
                        onClick={() => {
                          onAdd(slot.tier);
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        {environmentDoorLabel(slot.tier, slot.name)}
                      </Button>
                    ) : null}
                  </li>
                );
              const environment = environments.find((entry) => entry.id === slot.id);
              if (environment === undefined) return null;
              if (environment.target.kind === "git")
                return (
                  <li key={slot.id}>
                    <StopLine environment={environment} groupId={groupId} notice={null} />
                    <GitDeliveryStatus
                      environment={{ target: environment.target, tier: environment.tier }}
                      delivery={environment.git}
                      repos={repos}
                      showExpiry={false}
                    />
                  </li>
                );
              return (
                <Fragment key={slot.id}>
                  <StopLine
                    environment={environment}
                    groupId={groupId}
                    notice={
                      environment.target.kind === "zerops"
                        ? (withheldNotice?.(environment.target.projectId) ?? null)
                        : null
                    }
                    firstDeploy={
                      environment.target.kind === "zerops"
                        ? firstDeployOf?.(environment.target.projectId)
                        : undefined
                    }
                  />
                  {slot.note === undefined ? null : (
                    <li className="flex min-w-0 items-center gap-3 px-2 pb-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {slot.note.text}
                      </span>
                      {slot.note.review ? (
                        <ReleaseAction release={release} variant="secondary" />
                      ) : null}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        </SideSection>
      )}

      {spend}
      {automation}
      {/* Where its code mirrors, and the way to mirror it: once it has a repository. */}
      {(codeRepos ?? repos ?? []).length === 0 ||
      (onMirror === undefined && connectedRepos(codeRepos ?? repos).length === 0) ? null : (
        <SideSection title="Repositories">
          {connectedRepos(codeRepos ?? repos).length === 0 ? null : (
            <div className="px-2">
              <GitRemoteLines repos={codeRepos ?? repos} />
            </div>
          )}
          {onMirror === undefined ? null : (
            <div className="px-2 py-1">
              <Button onClick={onMirror} size="sm" variant="secondary">
                Mirror code to GitHub or GitLab…
              </Button>
            </div>
          )}
        </SideSection>
      )}
      <SideSection title="History">
        {repo === undefined ? (
          <EmptyState
            action={
              <Button onClick={onSetUp} size="sm" variant="secondary">
                Set up an environment
              </Button>
            }
            size="row"
          >
            No repository is declared for this project’s services yet.
          </EmptyState>
        ) : (
          history
        )}
      </SideSection>
    </>
  );
}

const NO_ROUTE_ENVIRONMENT = Atom.make(undefined);
const NO_ROUTE_ENVIRONMENTS = Atom.make<CanonicalAppEnvironmentsRead>({
  environments: undefined,
  refused: null,
  unread: [],
});
const NO_ROUTE_NAVIGATION = Atom.make<CanonicalHqNavigationRead>({
  structure: null,
  organization: null,
  presses: {},
  people: {},
  read: "unread",
  refusal: null,
  capped: false,
  slow: false,
  updateRequired: false,
  coreBuild: undefined,
  live: false,
  reconnecting: false,
});
const decodeEnvironmentId = Schema.decodeUnknownOption(HqEnvironmentId);

/** The bookmark names an HQ environment; only its resolved Zerops target opens project readers. */
export function ZeropsStopDetailPage({
  groupId,
  environmentId,
}: {
  readonly groupId: string;
  readonly environmentId: string;
}) {
  const orgId = useAccountOrgId();
  const id = Option.getOrUndefined(decodeEnvironmentId(environmentId));
  const key = orgId === null ? null : { orgId, appId: groupId };
  const environment = useProjection(
    environmentById,
    key === null || id === undefined ? null : { ...key, id },
    NO_ROUTE_ENVIRONMENT,
  );
  const read = useProjection(canonicalAppEnvironments, key, NO_ROUTE_ENVIRONMENTS);
  const inventory = useZeropsInventory();
  const navigation = useProjection(canonicalHqNavigation, orgId, NO_ROUTE_NAVIGATION);
  const status = useFlowNavigation(orgId);
  const orgRole = useAccountDataOptional()?.viewer?.roleCode;
  const unread = unreadFlowWords({
    failure: status.readFailure,
    groupsRead: status.groupsRead,
    groupKnown: status.knownGroups.has(groupId),
    orgRole,
  });
  const crumbs = useCrumbs({
    groupId,
    name: navigation?.structure?.apps.find((app) => app.id === groupId)?.name,
  });
  if (environment?.target.kind === "zerops") {
    const notice = withheldProjectNotice(
      inventory,
      environment.target.projectId,
      environment.tier === "production" ? "Production" : "Stage",
    );
    if (notice !== null) {
      return (
        <DetailShell crumbs={crumbs} title={environmentTitle(environment.tier, environment.name)}>
          <Note>{notice}</Note>
        </DetailShell>
      );
    }
    return (
      <ZeropsProjectStopDetailPage groupId={groupId} projectId={environment.target.projectId} />
    );
  }
  const note =
    read.refused !== null
      ? hqRefusalWords({ code: "forbidden", reason: read.refused })
      : (unreadEnvironmentsWords(read.unread) ?? unread);
  if (environment === undefined) {
    return (
      <ZeropsUnresolvedStopDetailPage
        groupId={groupId}
        environmentId={environmentId}
        crumbs={crumbs}
        note={note}
      />
    );
  }
  return (
    <DetailShell crumbs={crumbs} title={environmentTitle(environment.tier, environment.name)}>
      <GitStopDetailPage
        appId={groupId}
        environment={{ ...environment, target: environment.target }}
        live={navigation?.live ?? false}
      />
      {note !== null ? <Note>{note}</Note> : null}
    </DetailShell>
  );
}

/** Legacy bookmarks still show placed runtime facts while HQ has no environment identity. */
function ZeropsUnresolvedStopDetailPage({
  groupId,
  environmentId,
  crumbs,
  note,
}: {
  readonly groupId: string;
  readonly environmentId: string;
  readonly crumbs: ReadonlyArray<Crumb>;
  readonly note: string | null;
}) {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const stops = runtimeStopsOf(groupId, held?.projects ?? inventory.projects, undefined).filter(
    (stop) => stop.projectId === environmentId,
  );
  const deployments = useStopDeploymentsShown(stops.map((stop) => stop.projectId));
  return (
    <DetailShell crumbs={crumbs} title={stops[0]?.name}>
      {note !== null ? <Note>{note}</Note> : <StopVerdictStandIn />}
      <ZeropsRuntimeStops stops={stops} deployments={deployments} />
    </DetailShell>
  );
}

/**
 * The repository a stop's page reads its history from: none where the grant withholds the stop,
 * so its page names no commit of it and links none into the Git browser.
 */
export function stopRepository(
  withheld: string | null,
  stop: { readonly versionRepository: string | undefined } | undefined,
): string | undefined {
  return withheld === null ? stop?.versionRepository : undefined;
}

function ZeropsProjectStopDetailPage({
  groupId,
  projectId,
}: {
  readonly groupId: string;
  readonly projectId: ProjectId;
}) {
  const recipeFailure = useHqRecipeFailure(groupId);
  // The environment's vault beside its page, where the account reads its organization.
  const orgId = useAccountOrgId();
  const [vaultOpen, toggleVault] = useStopVaultOpen();
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const flow = flows.get(groupId);
  const deployments = useStopDeploymentsShown();
  const verbs = useFlowVerbs();
  const runtimeStops = useRuntimeStops(groupId).filter((entry) => entry.projectId === projectId);
  const stop = flow?.environments.find(
    (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
  );
  const declared = flow?.environmentInputs.find(
    (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
  );
  // A stop whose project the grant withholds draws nothing of it (DESIGN §3.4),
  // nor marks what it runs in another stop's history, and reads nothing its
  // repository and commit address.
  const { withheldNotice, shown } = useWithheldStops(flow?.environments);
  const withheld = withheldNotice(projectId);
  const repo = stopRepository(withheld, stop);
  const deployed = useMemo(() => deployedShas(shown), [shown]);
  const stage = stop?.tier === "stage";
  const production = stop?.tier === "production";
  // Only a stage draws its deploys: a production moves by release, and its
  // releases are the list it is read by.
  const history: ZeropsHistoryState = { kind: "read", commits: [], total: 0 };
  const [expandedReleases, setExpandedReleases] = useState<ReadonlySet<string>>(() => new Set());
  const onReleaseExpanded = (tag: string, open: boolean) =>
    setExpandedReleases((current) => {
      const next = new Set(current);
      if (open) next.add(tag);
      else next.delete(tag);
      return next;
    });
  const mainHead =
    repo === undefined
      ? undefined
      : (flow?.repos?.find(({ name }) => name === repo)?.mainHead ?? undefined);
  const tags = useReleaseTags(flow?.releases);
  const openChange = useOpenChange(groupId, repo);
  const openCarried = useOpenCarriedChange(groupId);
  const carried = useStopCarried(
    groupId,
    flow?.releases,
    production && withheld === null ? declared?.services : undefined,
    expandedReleases,
  );
  const release = useReleaseOffer(groupId, flow);
  const openReview = useOpenReview();
  const stopGroupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: stopGroupName });
  const names = useHistoryNames();
  const publicAccess = usePublicAccess(projectId);
  const routes = publicAccess.routes;
  const offers = publicAccess.offers;
  const route = useEnableRoute();
  const inventory = useZeropsInventory();
  const platform = useStopServices(
    withheld === null ? findInventoryProjectRef(inventory, projectId) : null,
  );
  // Every service the place runs, with its use and its last day, for the services table.
  const serviceMap = usePlaceServiceMap(withheld === null ? projectId : undefined);
  // Only a countdown reads the clock, and nothing here counts down: the time
  // the page was first drawn is enough, as it is for the left menu's rows.
  const [nowMs] = useState(Date.now);
  // Where a stage that runs nothing stands on its first deploy, as its cell and the menu say it.
  const firstDeployOf = useStageFirstDeploys(flow);
  const firstDeploy = stop?.tier === "stage" ? firstDeployOf(projectId) : undefined;
  // A withheld stop lists no service, so no build of one is read either.
  const services =
    declared === undefined || withheld !== null
      ? NO_SERVICE_ROWS
      : serviceRows({
          environment: declared.environment,
          services: declared.services,
          platform,
          mainHead: stage ? mainHead : undefined,
          routes,
          offers,
          nowMs,
          age: formatRelativeTimeLabel,
          firstDeploy,
        });
  const failedDeploys =
    flow === undefined || stop === undefined
      ? NO_FAILED_DEPLOYS
      : stopFailedDeploys({ tier: stop.tier, rows: services, releases: flow.releases });
  // *Run again* asks HQ, by its rule for who develops the application.
  const mayRunAgain = useEnvironmentDeployOffer()(projectId);
  const mayKeepKey = useKeepDeployKeyOffer();
  // Why HQ refused the last *Run again*, until another is pressed.
  const [runAgainRefused, setRunAgainRefused] = useState<string | null>(null);
  // What HQ answered of the deploys the last verb pressed here asked for.
  const [deployAnswer, setDeployAnswer] = useState<HqDeployAnswer | undefined>(undefined);
  /** A verb pressed here, its refusal or its deploys said until the next. */
  const said = (asked: Promise<FlowVerbOutcome>) => {
    setRunAgainRefused(null);
    setDeployAnswer(undefined);
    void asked.then((outcome) => {
      setRunAgainRefused(outcome.ok ? null : outcome.reason);
      setDeployAnswer(outcome.ok ? outcome.deploys : undefined);
    });
  };

  if (flow === undefined || stop === undefined) {
    return (
      <DetailShell crumbs={crumbs} title={runtimeStops?.[0]?.name}>
        <UnreadDetail groupId={groupId} standIn={<StopVerdictStandIn />} />
        <ZeropsRuntimeStops stops={runtimeStops} deployments={deployments} />
      </DetailShell>
    );
  }
  if (withheld !== null) {
    return (
      <DetailShell crumbs={crumbs} title={environmentTitle(stop.tier, stop.tier)}>
        <Note>{withheld}</Note>
      </DetailShell>
    );
  }

  const deployment = deployments.get(projectId) ?? UNREAD_DEPLOYMENT;
  const view = stopView({ deployment, row: stop, nowMs });
  const live = flow.releases.find((entry) => entry.standing === "live");
  const releasedAge = live?.taggedAt === undefined ? "" : formatRelativeTimeLabel(live.taggedAt);
  // One failed part is asked again from the verdict; several, each from its own row.
  const redeploy = failedDeploys.length === 1 ? failedDeploys[0]?.redeploy : undefined;
  // How many changes production lacks, at least that many where HQ stopped counting.
  const notLive =
    flow.release.summary === undefined
      ? movedCount(flow.release.contents)
      : { count: flow.release.summary.total, atLeast: flow.release.summary.atLeast };
  const verdict = stopVerdict({
    tier: stop.tier,
    view,
    releasing: flow.release.inFlight ?? (release.releasing ? release.tag : undefined),
    failed: failedDeploys.map((entry) => ({ ...entry, mayRunAgain })),
    waiting: notLive.count,
    waitingAtLeast: notLive.atLeast,
    changeCount: flow.release.summary?.changeCount,
    waitingUnread: flow.release.summaryRead === "pending",
    untold: production ? flow.release.untold : NO_UNTOLD,
    release,
    releasedAge: releasedAge.length === 0 ? undefined : releasedAge,
    since: view.activatedAt === null ? undefined : formatRelativeTimeLabel(view.activatedAt),
    atMainHead: stage && sameCommit(view.version?.sha, mainHead),
    keyGap:
      declared === undefined
        ? undefined
        : stopKeyGap({ ...declared, mayKeep: mayKeepKey(projectId), project: stop.name }),
    firstDeploy,
  });

  return (
    <>
      <StopPublicAccessStatus access={publicAccess} />
      <ZeropsStopPane
        access={<ProjectAccess fold heading={false} kind={stop.tier} projectId={projectId} />}
        platformServices={serviceMap.rows}
        usageRead={serviceMap.usageRead}
        vault={orgId === null ? undefined : { orgId, open: vaultOpen, onToggle: toggleVault }}
        readAgain={<StopReadAgain projectId={projectId} />}
        readFailures={
          <ProjectReadFailures recipe={recipeFailure} comparison={flow.release.comparisonFailure} />
        }
        carried={carried}
        onReleaseExpanded={onReleaseExpanded}
        recordedHistory={
          stage && repo !== undefined
            ? {
                repo: { appId: groupId, repo },
                changes: flow.changesKnown
                  ? flow.merged.filter((change) => change.repository === repo)
                  : undefined,
                publication: flow.repos?.find((entry) => entry.name === repo),
              }
            : undefined
        }
        crumbs={crumbs}
        deployed={deployed}
        enablingServiceId={route.enablingServiceId}
        history={history}

        groupId={groupId}
        names={names}
        onEnableRoute={(serviceId) => {
          void route.enable(projectId, serviceId);
        }}
        onOpenCarriedChange={openCarried}
        onOpenChange={openChange}
        onRollBack={(tag, from) => {
          openReview({ kind: "rollback", groupId, tag }, { from });
        }}
        pending={verbs.pending}
        release={release}
        releases={production ? flow.releases : NO_RELEASES}
        repo={repo}
        routeTrouble={route.trouble}
        routes={routes}
        deployAgain={
          mayRunAgain
            ? {
                running: (service) =>
                  verbs.pending.has(flowVerbKey({ kind: "redeploy", groupId, projectId, service })),
                onDeployAgain: (again) => said(verbs.redeploy(flow, projectId, again)),
              }
            : undefined
        }
        addService={
          mayRunAgain
            ? {
                running: (service) =>
                  verbs.pending.has(
                    flowVerbKey({ kind: "add-service", groupId, projectId, service }),
                  ),
                onAdd: (service) => said(verbs.addService(flow, projectId, service)),
              }
            : undefined
        }
        notInZerops={
          declared === undefined || withheld !== null
            ? undefined
            : notInZerops({ recipeServices: declared.recipeServices, platform })
        }
        tierStops={
          declared === undefined || withheld !== null
            ? undefined
            : stopTierStops({ tierStops: declared.tierStops, platform })
        }
        deployAnswer={deployAnswer}
        runAgain={
          redeploy === undefined || !mayRunAgain
            ? undefined
            : {
                running: verbs.pending.has(
                  flowVerbKey({ kind: "redeploy", groupId, projectId, service: redeploy.service }),
                ),
                refused: runAgainRefused,
                onRunAgain: () => said(verbs.redeploy(flow, projectId, redeploy)),
              }
        }
        services={
          declared === undefined ||
          !flow.recipeRead ||
          platform.state !== "known" ||
          platform.coverage !== "complete"
            ? undefined
            : rowsRunningAgain(services, failedDeploys)
        }
        stop={stop}
        tags={tags}
        trouble={verbs.trouble}
        verdict={verdict}
        view={view}
        untold={production ? flow.release.untold : NO_UNTOLD}
        waiting={
          production
            ? {
                commits:
                  flow.release.summary?.changeCount !== undefined
                    ? flow.release.summary.subjects.map((subject) => ({ subject }))
                    : [],
                total: notLive.count,
                changeCount: flow.release.summary?.changeCount,
                atLeast: notLive.atLeast,
              }
            : NOTHING_WAITING
        }
      />
    </>
  );
}

/** A commit merged to `main` and not in front of people yet. */
interface WaitingCommit {
  readonly sha?: string;
  readonly subject: string;
}

/**
 * What `main` has that a production does not: the commits HQ listed, and how many there are in
 * all — at least that many where HQ stopped counting.
 */
interface StopWaiting {
  readonly changeCount?: number | undefined;
  readonly commits: ReadonlyArray<WaitingCommit>;
  readonly total: number;
  readonly atLeast: boolean;
}

/** *Run again* on the verdict: the failed deploy, asked again in HQ. */
interface StopRunAgain {
  readonly running: boolean;
  /** Why HQ refused the last one, until another is pressed. */
  readonly refused: string | null;
  readonly onRunAgain: () => void;
}

/**
 * *Add <service>* on a service the recipe declares and the project lacks (audit D2): imported and
 * deployed by HQ, asked by whoever may *Run again* — HQ never adds one by itself.
 */
interface StopAddService {
  /** Whether it is under way for the service. */
  readonly running: (service: string) => boolean;
  readonly onAdd: (service: string) => void;
}

const NOTHING_MISSING: ReadonlyArray<string> = [];
const NO_TIER_STOPS: ReadonlyArray<StopTierStop> = [];
const NO_FAILED_DEPLOYS: ReadonlyArray<StopFailedDeploy> = [];

/** A stop's role, as its tag reads beside its name. */
const ROLE_TAG: Record<GroupEnvironmentTier, ZeropsEnvironmentRole> = {
  stage: "stage",
  production: "prod",
};

/** `full sha → the releases that shipped it`, from HQ's records (`releaseTagsByCommit`). */
function useReleaseTags(
  releases: ReadonlyArray<FlowReleaseRow> | undefined,
): ReadonlyMap<string, ReadonlyArray<string>> {
  return useMemo(() => releaseTagsByCommit(releases ?? NO_RELEASES), [releases]);
}

/** Opens the review of the change that landed a commit of `repo`, from where it was pressed. */
function useOpenChange(
  groupId: string,
  repo: string | undefined,
): ((change: HistoryChange, from: HTMLElement) => void) | undefined {
  const openReview = useOpenReview();
  return useMemo(
    () =>
      repo === undefined
        ? undefined
        : (change: HistoryChange, from: HTMLElement) => {
            openReview(
              { kind: "change", groupId, repository: repo, number: change.number },
              { from },
            );
          },
    [groupId, openReview, repo],
  );
}

/** Opens the review of the change that landed a commit a release carried, in its repository. */
function useOpenCarriedChange(
  groupId: string,
): (repository: string, change: HistoryChange, from: HTMLElement) => void {
  const openReview = useOpenReview();
  return useCallback(
    (repository, change, from) => {
      openReview({ kind: "change", groupId, repository, number: change.number }, { from });
    },
    [groupId, openReview],
  );
}

/**
 * What each of a production's releases carried, by its tag, as HQ compares it (`carriedReads`):
 * only expanded rows ask for commit content. Recorded exact ranges outrank legacy tag comparisons.
 * `undefined` without the services — a stage, or a withheld stop.
 */
function useStopCarried(
  groupId: string,
  releases: ReadonlyArray<FlowReleaseRow> | undefined,
  services: GroupEnvironmentRowInput["services"] | undefined,
  expanded: ReadonlySet<string>,
): ReadonlyMap<string, ComparedCommits> | undefined {
  const reads = useMemo(() => {
    if (services === undefined || releases === undefined) return undefined;
    const repositoryOf = new Map(
      services.flatMap((entry) =>
        entry.repository === undefined ? [] : [[entry.hostname, entry.repository] as const],
      ),
    );
    const legacy = carriedReads({ releases, repositoryOf });
    return new Map(
      releases.map((release) => [
        release.tag,
        release.history?.ranges === undefined
          ? (legacy.get(release.tag) ?? [])
          : release.history.ranges.map((range) => ({
              repository: range.repo,
              query: { head: range.head, ...(range.base === null ? {} : { base: range.base }) },
              services: [...repositoryOf]
                .filter(([, repo]) => repo === range.repo)
                .map(([service]) => service),
            })),
      ]),
    );
  }, [releases, services]);
  const asks = useMemo(
    () =>
      reads === undefined
        ? NO_ASKS
        : new Map([
            [
              groupId,
              [...reads].filter(([tag]) => expanded.has(tag)).flatMap(([, entries]) => entries),
            ],
          ]),
    [groupId, reads, expanded],
  );
  const compares = useReleaseComparisons(asks);
  return useMemo(() => {
    if (reads === undefined) return undefined;
    const answered = compares.get(groupId);
    return new Map(
      [...reads].map(([tag, tagReads]) => [
        tag,
        answered === undefined
          ? CARRIED_READING
          : {
              ...movedCommits({ reads: tagReads, ...answered }),
              again: () => answered.again(tagReads),
            },
      ]),
    );
  }, [compares, groupId, reads]);
}

/** How many releases a production lists before the rest wait behind a quiet verb. */
const RELEASES_SHOWN = 5;

/**
 * One stop, drawn — every read already done and handed in.
 *
 * Split from the page for the same reason the others are: the states worth
 * looking at are a production twelve changes behind, a deploy that failed with
 * nothing running, and a stop nobody has ever deployed to, and none of them is
 * reachable by waiting for an account to be in that state.
 *
 * It opens with its verdict — one sentence, at most one verb — and says the
 * rest in one card: what waits for a release, each service and what it runs,
 * and how the stop got here (a production's releases, a stage's deploys).
 */
export function ZeropsStopPane({
  readFailures,
  readAgain,
  carried,
  onReleaseExpanded,
  recordedHistory,
  crumbs,
  deployed,
  enablingServiceId,
  groupId,
  history,
  names,
  onEnableRoute,
  onOpenCarriedChange,
  onOpenChange,
  onRollBack,
  pending,
  release,
  releases,
  repo,
  routeTrouble,
  routes,
  runAgain,
  deployAgain,
  addService,
  notInZerops = NOTHING_MISSING,
  tierStops = NO_TIER_STOPS,
  deployAnswer,
  services: readServices,
  stop,
  tags,
  trouble,
  untold,
  verdict,
  view,
  waiting,
  vault,
  access,
  platformServices,
  usageRead = false,
}: {
  /**
   * Every service the platform lists in the place, with its use and its last day (the service
   * map's rows); undefined while unread, when the table holds only the code services.
   */
  readonly platformServices?: ReadonlyArray<ZeropsServiceRow> | undefined;
  /** Whether the services' use has been read: until then their meters hold their room. */
  readonly usageRead?: boolean;
  /** Who reaches the environment's project, as people chips, under its card. */
  readonly access?: React.ReactNode;
  /** The environment's vault, where the account reads its organization: shown beside the page. */
  readonly vault?:
    | {
        readonly orgId: string;
        readonly open: boolean;
        readonly onToggle: () => void;
        /** What the vault column holds; the project's vault unless given (a harness's fixture). */
        readonly body?: React.ReactNode;
      }
    | undefined;
  readonly readFailures?: React.ReactNode;
  /** Runtime read recovery belongs beside the verdict that reports it. */
  readonly readAgain?: React.ReactNode;
  readonly crumbs: ReadonlyArray<Crumb>;
  readonly groupId: string;
  readonly stop: EnvironmentRow;
  /** What the stop runs, as the left menu reads it — its menu is that menu. */
  readonly view: StopView;
  readonly verdict: StopVerdict;
  /** One row per service, as `serviceRows` says it. */
  /** Undefined until the recipe and complete platform service listing have been read. */
  readonly services: ReadonlyArray<StopServiceRow> | undefined;
  /** Offered on a production that is behind — the one stop a release moves. */
  readonly release: ReleaseOffer;
  readonly runAgain?: StopRunAgain | undefined;
  /** Offered beside a service that runs what HQ did not deploy, to whoever may run it again. */
  readonly deployAgain?: StopDeployAgain | undefined;
  /** Offered beside a service the recipe declares and the project lacks, by the same rule. */
  readonly addService?: StopAddService | undefined;
  /** The services the stop's tier declares and its project lacks (`notInZerops`). */
  readonly notInZerops?: ReadonlyArray<string> | undefined;
  /** The services HQ stopped because the tier no longer declares them (`stopTierStops`). */
  readonly tierStops?: ReadonlyArray<StopTierStop> | undefined;
  /** What HQ answered of the deploys the last verb pressed here asked for. */
  readonly deployAnswer?: HqDeployAnswer | undefined;
  /** What `main` has that this production does not; nothing for a stage. */
  readonly waiting: StopWaiting;
  /** A production's services whose commit cannot be told, said beside what waits. */
  readonly untold: ReadonlyArray<string>;
  /** Every public address of the stop, for its menu; each service row lists its own. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** A production's releases, newest first; empty for a stage. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /**
   * What each of a production's releases carried, by its tag, as HQ compares it; `undefined` on a
   * stage, where the rows are their shas.
   */
  readonly carried?: ReadonlyMap<string, ComparedCommits> | undefined;
  readonly onReleaseExpanded?: ((tag: string, open: boolean) => void) | undefined;
  readonly recordedHistory?: RecordedStageHistoryProps | undefined;
  /** Opens the review of the change that landed a commit a release carried. */
  readonly onOpenCarriedChange?:
    | ((repository: string, change: HistoryChange, from: HTMLElement) => void)
    | undefined;
  /** The flow's verbs under way (`flowVerbKey`). */
  readonly pending: ReadonlySet<string>;
  /** Opens the roll back's review from the row pressed: nothing rolls back from a row (R1). */
  readonly onRollBack: (tag: string, from: HTMLElement) => void;
  /** What the last flow verb's refusal said — a *Roll back* refused says so here. */
  readonly trouble: string | null;
  /** A stage's deploys: what has landed on its repository, as HQ compares it. */
  readonly history: ZeropsHistoryState;
  /** `full sha → the release that shipped it`. */
  readonly tags: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Opens the review of the change that landed a commit of the stage's history. */
  readonly onOpenChange?: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
  /** `environment name → the whole sha it runs`, for the history's own marks. */
  readonly deployed: ReadonlyMap<string, string>;
  readonly names: HistoryNames;
  readonly repo: string | undefined;
  readonly onEnableRoute?: ((serviceId: string) => void) | undefined;
  /** Which one is being opened, so its row says so and takes no second press. */
  readonly enablingServiceId?: string | null;
  readonly routeTrouble?: string | null;
}) {
  const [allReleases, setAllReleases] = useState(false);
  const services = readServices ?? NO_SERVICE_ROWS;
  const title = stop.name;
  const production = stop.tier === "production";
  const earlier = Math.max(0, releases.length - RELEASES_SHOWN);
  const listed = allReleases ? releases : releases.slice(0, RELEASES_SHOWN);
  const verb = verdict.verb;
  const answer = deployAnswer === undefined ? undefined : deployAnswerSaid(deployAnswer);
  const answered = new Map(
    answer?.environments
      .find(({ environment }) => environment === stop.name)
      ?.jobs.map((job) => [job.service, job] as const),
  );
  // Jobs of services not listed yet (including a recipe import), and HQ's note, stay in Services.
  const otherDeploys =
    deployAnswer === undefined
      ? undefined
      : {
          ...deployAnswer,
          jobs: deployAnswer.jobs.filter(
            ({ environment, service }) =>
              environment !== stop.name ||
              (!services.some((row) => row.hostname === service) &&
                !notInZerops.includes(service ?? "")),
          ),
        };
  const projectId = stop.target.kind === "zerops" ? stop.target.projectId : undefined;
  const table = placeServiceRows(services, platformServices);
  const head = placeTitle(stop.name, stop.tier);
  const live = releases.find((entry) => entry.standing === "live");
  const status = placeStatus({
    tier: stop.tier,
    view,
    releasedAge: live === undefined ? undefined : formatRelativeTimeLabel(live.taggedAt),
    since: view.activatedAt === null ? undefined : formatRelativeTimeLabel(view.activatedAt),
    source: stop.source,
    services: readServices === undefined ? 0 : table.length,
  });
  const address = placeAddress(stop.tier, routes);
  const rollBackTo = production ? rollBackTarget(releases) : undefined;
  const statusDot = STOP_DOT_TONE[status.tone];
  return (
    <DetailShell
      actions={
        <>
          {vault === undefined ? null : (
            <StopVaultToggle onToggle={vault.onToggle} open={vault.open} />
          )}
          {stop.target.kind === "zerops" ? (
            <ZeropsStopMenu
              groupId={groupId}
              name={title}
              projectId={projectId!}
              onOpenStop={undefined}
              routes={routes}
              stop={view}
              {...(rollBackTo === undefined
                ? {}
                : {
                    rollBack: {
                      tag: rollBackTo,
                      onRollBack: (from: HTMLElement) => onRollBack(rollBackTo, from),
                    },
                  })}
              triggerClassName="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            />
          ) : null}
        </>
      }
      crumbs={[...crumbs, { label: head.title }]}
      side={
        vault?.open === true && stop.target.kind === "zerops"
          ? (placement) => (
              <StopVaultSide
                body={vault.body}
                name={head.title}
                orgId={vault.orgId}
                placement={placement}
                projectId={projectId!}
              />
            )
          : undefined
      }
      subtitle={
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <span data-zerops-place-status="">
            {statusDot === undefined ? (
              status.text
            ) : (
              <Badge dot tone={STATUS_BADGE_TONE[statusDot]}>
                <span className="text-foreground">{status.text}</span>
              </Badge>
            )}
          </span>
          {address === undefined ? null : (
            <a
              className="flex max-w-full min-w-0 items-center gap-1 text-foreground underline-offset-2 hover:underline"
              data-zerops-place-address=""
              href={address.url}
              rel="noreferrer"
              target="_blank"
            >
              <MiddleTruncate value={address.host} />
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </a>
          )}
        </span>
      }
      title={head.title}
      titleTag={head.tag === undefined ? undefined : <ZeropsRoleTag label={ROLE_TAG[stop.tier]} />}
    >
      {readFailures}
      <div>
        <VerdictPanel detail={verdict.detail} text={verdict.text} tone={verdict.tone}>
          {verb?.kind === "release" ? (
            <ReleaseAction release={release} size="sm" variant="secondary" />
          ) : verb?.kind === "run-again" && runAgain !== undefined ? (
            <Button
              data-zerops-primary-action="Run again"
              disabled={runAgain.running}
              onClick={runAgain.onRunAgain}
              size="sm"
              variant="secondary"
            >
              {flowVerbLabel("redeploy", runAgain.running)}
            </Button>
          ) : (
            readAgain
          )}
        </VerdictPanel>
        {runAgain?.refused === null || runAgain?.refused === undefined ? null : (
          <p className="mt-1.5 px-3 text-sm text-[var(--zerops-status-failed-text)]">
            {runAgain.refused}
          </p>
        )}
      </div>

      <Card variant="flat">
        <div className="flex flex-col divide-y divide-border px-4">
          {waiting.total === 0 && waiting.commits.length === 0 ? null : (
            <CardGroup
              title={stopCardTitle(
                "waiting",
                waiting.changeCount === undefined ? waiting.total : undefined,
                waiting.atLeast,
              )}
            >
              {waiting.changeCount === undefined ? null : (
                <p className="py-2 text-sm text-muted-foreground">
                  {waiting.changeCount} {waiting.changeCount === 1 ? "change" : "changes"} ·{" "}
                  {waiting.total}
                  {waiting.atLeast ? "+" : ""} {waiting.total === 1 ? "commit" : "commits"}
                </p>
              )}
              <ul className="flex flex-col">
                {waiting.commits.map((commit, index) => (
                  <li
                    className={cn(
                      CARD_ROW_CLASS,
                      commit.sha === undefined ? "grid-cols-1" : "grid-cols-[4.5rem_minmax(0,1fr)]",
                    )}
                    key={commit.sha ?? index}
                  >
                    {commit.sha === undefined ? null : (
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {shortCommit(commit.sha)}
                      </span>
                    )}
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {commit.subject}
                    </span>
                  </li>
                ))}
              </ul>
              {untold.length === 0 ? null : (
                <p className="py-2 text-sm text-muted-foreground">{cannotTellWhatRuns(untold)}.</p>
              )}
            </CardGroup>
          )}

          <CardGroup
            title={stopCardTitle("services", readServices === undefined ? undefined : table.length)}
          >
            {readServices === undefined ? (
              <p className="py-2 text-sm text-muted-foreground">Services aren&rsquo;t known yet.</p>
            ) : table.length === 0 ? (
              // Its code services and the platform's both: a place with a database alone has one.
              <p className="py-2 text-sm text-muted-foreground">{NONE_YET}</p>
            ) : stop.target.kind !== "zerops" ? null : (
              <PlaceServiceTable
                answered={answered}
                deployAgain={deployAgain}
                enablingServiceId={enablingServiceId ?? null}
                onEnableRoute={onEnableRoute}
                projectId={stop.target.projectId}
                rows={table}
                said={verdict.detail}
                usageRead={usageRead}
              />
            )}
            {notInZerops.length === 0 ? null : (
              <ul className="flex flex-col" data-zerops-surface="stop-not-in-zerops">
                {notInZerops.map((hostname) => (
                  <li
                    className={cn(CARD_ROW_CLASS, "grid-cols-[minmax(0,1fr)_auto]")}
                    key={hostname}
                  >
                    <span className="min-w-0 truncate text-sm text-muted-foreground">
                      {hostname} ·{" "}
                      {answered.get(hostname) === undefined ? (
                        "in its setup files, not in Zerops"
                      ) : (
                        <span data-zerops-job-state={answered.get(hostname)?.state}>
                          {answered.get(hostname)?.line}
                        </span>
                      )}
                    </span>
                    {addService === undefined ? (
                      <span />
                    ) : (
                      <Button
                        disabled={addService.running(hostname)}
                        onClick={() => addService.onAdd(hostname)}
                        size="sm"
                        variant="secondary"
                      >
                        {addService.running(hostname)
                          ? flowVerbLabel("add-service", true)
                          : `${flowVerbLabel("add-service", false)} ${hostname}`}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {stop.target.kind !== "zerops" || tierStops.length === 0 ? null : (
              <StopTierStops
                projectId={stop.target.projectId}
                rowClassName={cn(CARD_ROW_CLASS, "grid-cols-[minmax(0,1fr)_auto]")}
                rows={tierStops}
              />
            )}
            {otherDeploys === undefined ? null : (
              <ZeropsDeployAnswer
                answer={otherDeploys}
                showEnvironment={otherDeploys.jobs.some(
                  ({ environment }) => environment !== stop.name,
                )}
              />
            )}
            {routeTrouble === null || routeTrouble === undefined ? null : (
              <p className="py-2 text-sm text-[var(--zerops-status-failed-text)]">{routeTrouble}</p>
            )}
          </CardGroup>

          {!production || releases.length === 0 ? null : (
            <CardGroup title={stopCardTitle("releases", releases.length)}>
              <ul className="flex flex-col">
                <ZeropsReleaseRows
                  {...(carried === undefined
                    ? {}
                    : {
                        carried: {
                          carried,
                          names,
                          onOpenChange: onOpenCarriedChange,
                          onExpandedChange: onReleaseExpanded,
                        },
                      })}
                  groupId={groupId}
                  onRollBack={onRollBack}
                  pending={pending}
                  releases={listed}
                />
              </ul>
              {earlier === 0 || allReleases ? null : (
                <Button
                  className="my-1"
                  onClick={() => {
                    setAllReleases(true);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {earlierReleasesLabel(earlier)}
                </Button>
              )}
            </CardGroup>
          )}

          {production ? null : (
            <CardGroup
              {...(recordedHistory === undefined ? { aside: DEPLOYS_ASIDE } : {})}
              title={
                recordedHistory !== undefined
                  ? "History"
                  : stopCardTitle(
                      "deploys",
                      repo !== undefined && history.kind === "read" ? history.total : undefined,
                    )
              }
            >
              {recordedHistory !== undefined ? (
                <RecordedStageHistory {...recordedHistory} onOpenChange={onOpenChange} />
              ) : readServices === undefined ? (
                <p className="py-2 text-sm text-muted-foreground">Repository not known yet.</p>
              ) : repo === undefined ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No repository is declared for this environment&rsquo;s services, so its history
                  cannot be read.
                </p>
              ) : history.kind === "read" && history.commits.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{NONE_YET}</p>
              ) : (
                <ZeropsHistoryView
                  here={stop.name}
                  history={history}
                  names={names}
                  onOpenChange={onOpenChange}
                  request={{ appId: groupId, repo, deployed }}
                  tags={tags}
                />
              )}
            </CardGroup>
          )}

          {access === undefined ? null : <CardGroup title="Project access">{access}</CardGroup>}
        </div>
      </Card>
      {/* A verb that refused says so under the card it was pressed in. */}
      {trouble === null ? null : (
        <p className="mt-2 text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </DetailShell>
  );
}

/** One row of the stop's card: the hairline over it, and the height every row keeps. */
const CARD_ROW_CLASS = "grid min-h-11 items-center gap-x-4 border-t border-border/60 py-2";

/**
 * One group of the stop's card, under its label: the first 12px under the
 * card's edge, each later one 24px under the hairline between them.
 */
function CardGroup({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** Said beside the label, muted: what the group is read from. */
  readonly aside?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="pt-6 pb-2 first:pt-3">
      <h2 className="flex items-baseline gap-2 pb-1.5">
        <MicroLabel>{title}</MicroLabel>
        {aside === undefined ? null : (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/**
 * A change's own page: its review, at its own address (pass 17).
 *
 * The page and the dialog that opens over the conversation are one surface in two frames — the
 * same sections, in the same words, in a column the conversation's width. The page is the review:
 * nothing opens over it, and its one button is pinned in view.
 *
 * `#4` used to be a link into Gitea, which was a sign-in page for everybody. Everything a change is
 * — its description, files, conversation and commits — is read here from HQ, as the person.
 */
export function ZeropsChangeDetailPage({
  groupId,
  repository,
  number,
}: {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
}) {
  const groupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: groupName });
  const titleId = useId();
  return (
    <ZeropsHostedFrame breadcrumb={<Crumbs crumbs={crumbs} />} width="column">
      <ZeropsChangeReview
        frame="page"
        onClose={STAYS}
        target={{ kind: "change", groupId, repository, number }}
        titleId={titleId}
      />
    </ZeropsHostedFrame>
  );
}

/** The page has nothing to close: what would close a dialog leaves it where it is. */
const STAYS = () => {};

/** Nobody to name, before the flow is read. */
const EMPTY_STOPS: ReadonlyArray<EnvironmentRow> = [];

/** A stop whose project the flow has no listing for: not read, never "nothing". */
const UNREAD_DEPLOYMENT: Shown<Deployment> = { state: "unread", waitingFor: null };
/** A stop's parts before its flow has been read — the page says it is unread in their place. */
const NO_SERVICE_ROWS: ReadonlyArray<StopServiceRow> = [];
/** What a stage lists in a production's place: it has no releases and waits for none. */
const NO_RELEASES: ReadonlyArray<FlowReleaseRow> = [];
/** What a release carried while HQ is asked: nothing is known yet. */
const CARRIED_READING: MovedCommits = { state: "reading" };
const NO_ASKS: ReadonlyMap<string, ReadonlyArray<CompareRead>> = new Map();
const NOTHING_WAITING: StopWaiting = { commits: [], total: 0, atLeast: false };
/** A stage, whose verdict never speaks of what production runs. */
const NO_UNTOLD: ReadonlyArray<string> = [];

/**
 * Where a detail page sits, outermost first — a containment trail, not a way
 * back to wherever you came from.
 *
 * The first crumb said *Conversation* and went to `/`, which resolves to
 * whichever thread the router settles on: "this `conversation` link never
 * makes sense, it will just redirect to some random convo" (the owner,
 * 2026-09-19). A trail whose root is a guess is worse than no trail, because
 * it looks like it knows.
 *
 * So it is the hierarchy these pages actually sit in — every project, then the
 * project, then this page's own name in the title. Each step is the page of
 * the thing that contains this one, which is a claim the route can keep. The
 * conversations are not above these pages anyway: they hang off the Mates, and
 * a Mate's row on the project's page is the way into its own.
 */
function useCrumbs(
  inside?: { readonly groupId: string; readonly name: string | undefined } | undefined,
): ReadonlyArray<Crumb> {
  const navigate = useNavigate();
  const groupId = inside?.groupId;
  const name = inside?.name;
  return useMemo(
    () =>
      detailTrail(groupId === undefined ? undefined : { groupId, name }).map(({ label, to }) => ({
        label,
        onClick: () => {
          void (to.kind === "projects"
            ? navigate({ to: "/zerops" })
            : navigate({ to: "/group/$groupId/flow", params: { groupId: to.groupId } }));
        },
      })),
    [groupId, name, navigate],
  );
}

/** A detail page's trail as data: each crumb's words and the page it opens. */
export function detailTrail(
  inside: { readonly groupId: string; readonly name: string | undefined } | undefined,
): ReadonlyArray<{
  readonly label: string;
  readonly to: { readonly kind: "projects" } | { readonly kind: "group"; readonly groupId: string };
}> {
  const projects = { label: "Projects", to: { kind: "projects" } } as const;
  // A project's name not read yet: its crumb waits — its id is never a name.
  if (inside?.name === undefined) return [projects];
  return [projects, { label: inside.name, to: { kind: "group", groupId: inside.groupId } }];
}

/** A section with nothing in it yet, and the way to put something there. */
/** A stop's version column shares its page's runtime answer, including a failure or wait. */
function StopLine(props: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  readonly notice: string | null;
  readonly firstDeploy?: FirstDeploy | undefined;
}) {
  if (props.environment.target.kind === "git")
    return <GitStopLine environment={props.environment} groupId={props.groupId} />;
  return <ZeropsStopLine {...props} />;
}
function GitStopLine({
  environment,
  groupId,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      className="py-2 text-sm font-medium"
      data-zerops-environment-id={environment.id}
      type="button"
      onClick={() => {
        void navigate({
          to: "/group/$groupId/$projectId",
          params: { groupId, projectId: environment.id },
        });
      }}
    >
      {environmentTitle(environment.tier, environment.name)}
    </button>
  );
}
function ZeropsStopLine({
  environment,
  firstDeploy,
  groupId,
  notice,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  /**
   * Said in place of the stop while the grant withholds its project: its
   * tier stays, and its name, what it runs and its page do not (DESIGN §3.4).
   */
  readonly notice: string | null;
  /** A stage that runs nothing: where its first deploy stands, said as its cell says it. */
  readonly firstDeploy?: FirstDeploy | undefined;
}) {
  const navigate = useNavigate();
  const projectId = environment.target.kind === "zerops" ? environment.target.projectId : undefined;
  const deployments = useStopDeploymentsShown(
    useMemo(() => (projectId === undefined ? [] : [projectId]), [projectId]),
  );
  // The platform's answer, said in the words its card and Sites say a place in (`stopRowSays`).
  const deployment = projectId === undefined ? undefined : deployments.get(projectId);
  const says = stopRowSays(
    environment.tier,
    stopView({ deployment: deployment ?? UNREAD_DEPLOYMENT, row: environment, nowMs: 0 }),
  );
  // Nothing known to run and a first deploy asked for: the line its cell and its page say.
  const settled = says.tone === "good" || says.tone === "pending" || says.tone === "bad";
  const firstWord = settled ? undefined : firstDeployLine(firstDeploy);
  const word = firstWord ?? says.word;
  const dotTone =
    firstWord === undefined
      ? says.tone === undefined
        ? undefined
        : (STOP_DOT_TONE[says.tone] ?? "off")
      : firstDeployTone(firstDeploy);
  const title = environmentTitle(environment.tier, environment.name);
  const open = useCallback(() => {
    void navigate({
      to: "/group/$groupId/$projectId",
      params: { groupId, projectId: environment.id },
    });
  }, [environment.id, groupId, navigate]);
  if (notice !== null) {
    return (
      <li className="flex min-w-0 items-baseline gap-3 px-2 py-2">
        <span className="shrink-0 text-sm font-medium text-foreground">
          {environmentTitle(environment.tier, environment.tier)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{notice}</span>
        {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
      </li>
    );
  }
  return (
    <li>
      <button
        // Fixed tracks, not a right-ragged flex: a version and a state that
        // start at a different x on every row cannot be read down the column.
        // The state's track holds its longest word whole: the run's column said "Nothing depl…".
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_6rem_10.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        data-zerops-environment-id={environment.id}
        onClick={open}
        type="button"
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-end font-mono text-xs text-muted-foreground tabular-nums">
          {says.version}
        </span>
        {/* Never a wordless dot on its own: a colour that has to be learnt is
            a colour nobody reads, and a screen reader gets nothing from it. */}
        {/* The dot carries the state; the word supports it. Unsized, it
            inherited 16px and came out larger than the name it annotates. */}
        {dotTone === undefined ? (
          <span className="text-xs text-muted-foreground">{word}</span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            <Badge dot tone={STATUS_BADGE_TONE[dotTone]}>
              {word}
            </Badge>
          </span>
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      {/* An application of several parts: how many, and each that differs from the version. */}
      {environment.parts === undefined ? null : (
        <span className="block truncate px-2 pb-2 text-xs text-muted-foreground">
          {environment.parts}
        </span>
      )}
      {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
    </li>
  );
}

/** One step of the trail above a page's name. */
export interface Crumb {
  readonly label: string;
  /** Opens the page it names; none on the page itself, the trail's last step. */
  readonly onClick?: () => void;
}

/**
 * A detail page whose flow is not read yet: `standIn`, in the box of what the page opens with, while
 * the app reads it, and its own words where nothing will (`unreadFlowWords`) — HQ is unavailable,
 * a project not here any more or not the viewer's in Zerops, or reads that failed.
 */
function UnreadDetail({
  groupId,
  standIn,
}: {
  readonly groupId: string;
  readonly standIn: React.ReactNode;
}) {
  const flows = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const orgRole = useAccountDataOptional()?.viewer?.roleCode;
  const words = unreadFlowWords({
    failure: flows.readFailure,
    groupsRead: flows.groupsRead,
    groupKnown: flows.knownGroups.has(groupId),
    orgRole,
  });
  if (words !== null) return <Note>{words}</Note>;
  return standIn;
}

/** An environment's page opens with its verdict: its panel's box stands in while it is read. */
function StopVerdictStandIn() {
  return (
    <Loading label="This environment">
      <VerdictPanelWaiting />
    </Loading>
  );
}

function DetailShell({
  title,
  titleTag,
  subtitle,
  actions,
  crumbs,
  side,
  children,
}: {
  /** Undefined while the name is not read: its line is held, with no placeholder in it. */
  readonly title: string | undefined;
  /** What kind of thing the page is about, as a pill trailing its name. */
  readonly titleTag?: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  /** The verbs this page carries, beside its name rather than under it. */
  readonly actions?: React.ReactNode;
  /**
   * Where this page sits, outermost first. A stop used to offer only "back to
   * the conversation", so reaching its project meant leaving through the chat
   * and coming in again.
   */
  readonly crumbs: ReadonlyArray<Crumb>;
  /** A column beside the page, or under it where the frame is narrow: an environment's vault. */
  readonly side?: ((placement: SidePlacement) => React.ReactNode) | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <ZeropsHostedFrame
      side={side}
      // The trail is a way out, not the page's business: it sits in the bar,
      // where /zerops keeps its own, rather than competing with the verbs
      // beside the name.
      breadcrumb={crumbs.length === 0 ? undefined : <Crumbs crumbs={crumbs} />}
      width="expanded"
    >
      {/* The frame's page gap spaces the header and every block after it, as on /zerops. */}
      <header>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="min-w-0 text-2xl leading-8 font-semibold tracking-tight wrap-anywhere">
                {title ?? <span aria-hidden="true">{"\u00a0"}</span>}
              </h1>
              {titleTag}
            </div>
            {subtitle === undefined ? null : (
              <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      </header>
      {children}
    </ZeropsHostedFrame>
  );
}

/** Where a page sits, outermost first, each step the page of what contains it. */
function Crumbs({ crumbs }: { readonly crumbs: ReadonlyArray<Crumb> }) {
  return (
    <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.label}>
          {index === 0 ? null : <WorkspaceBreadcrumbSeparator />}
          <WorkspaceBreadcrumbItem className="min-w-0 shrink">
            {crumb.onClick === undefined ? (
              <span aria-current="page" className="min-w-0 truncate text-foreground">
                {crumb.label}
              </span>
            ) : (
              <button
                className="min-w-0 cursor-pointer truncate hover:text-foreground"
                onClick={crumb.onClick}
                type="button"
              >
                {crumb.label}
              </button>
            )}
          </WorkspaceBreadcrumbItem>
        </Fragment>
      ))}
    </WorkspaceBreadcrumb>
  );
}

function SideSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="ov-side">
      <h2 className="ov-side-name">{title}</h2>
      {children}
    </section>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      {/* A hairline under the heading: without one the page was four blocks of
          identical weight and a reader had to parse it to find the seams. */}
      <h2 className="mb-3 border-b border-border pb-1.5 text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ProjectReadFailures({
  recipe,
  comparison,
}: {
  readonly recipe: ReturnType<typeof useHqRecipeFailure>;
  readonly comparison: ZeropsProjectFlow["release"]["comparisonFailure"];
}) {
  return (
    <>
      {recipe === undefined ? null : <ZeropsReadFailure action="Read setup again" {...recipe} />}
      {comparison === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...comparison} />
      )}
    </>
  );
}
