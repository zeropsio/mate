import { unreadEnvironmentsWords } from "@t3tools/client-runtime/zerops/hq";
import { canonicalAppEnvironments, canonicalHqNavigation } from "@t3tools/client-runtime/data";
import {
  environmentSlots,
  productionRunsOf,
  releaseContentsSummary,
  releaseFailureOf,
  type GroupFlow,
} from "@t3tools/client-runtime/zerops";
import { useAskMateToFix } from "~/zerops/fixRequest";
import { useFixMates } from "~/zerops/fixMates";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useProjection } from "~/zerops/accountData";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useAddMate } from "~/zerops/newMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import {
  useFlowNavigation,
  useProjectFlows,
  useStopDeploymentsShown,
  type ZeropsProjectFlow,
} from "~/zerops/projectFlows";
import { useHqAppDetail, useHqAppFailure } from "~/zerops/useHqAppDetail";
import { useAddEnvironment, useApplicationEnvironmentFacts } from "~/zerops/useAddEnvironment";
import { useOpenPutLive } from "~/zerops/putLive";
import { useEnvironmentSetup } from "~/zerops/useEnvironmentSetup";
import { Button } from "../ui/button";
import { Loading } from "../ui/loading";
import { Skeleton } from "../ui/skeleton";
import { GitMirrorDialog } from "./GitMirrorDialog";
import { ProjectRepositories } from "./github/GithubRepoRows";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ProjectPeople, ProjectPeopleRow } from "./projects/ProjectPeople";
import {
  ProjectPageBody,
  type ProjectPageFacts,
  type ProjectPageSetup,
} from "./project/ProjectPageBody";
import { SetupRow } from "./project/SetupCard";
import { liveBrought, pageChanges } from "./project/projectPage.logic";
import type {
  ProjectPageSlot,
  ProjectsFlowGroup,
  ZeropsProjectsFlowProps,
} from "./projects/ZeropsProjectsFlow";
import { ProjectSpendRow } from "./projects/ProjectSpend";
import { spendProjectIds } from "./projects/projectSpend.logic";
import { groupRepository } from "./projects/projectHistory.logic";
import { ProjectAutomation, ProjectAutomationRow } from "./projectAutomation/ProjectAutomation";
import { useReleaseOffer } from "./ZeropsReleaseVerb";
import { fixProblemOf, type ProductionChip } from "./SidebarProductionChip.logic";
import { placeLabel } from "./projects/projectCard.logic";
import { ZeropsProjectsContent } from "./ZeropsProjectsPage";
import { PageHeader, usePageTrail } from "./system";
import {
  NO_ROUTE_ENVIRONMENTS,
  NO_ROUTE_NAVIGATION,
  Note,
  ProjectReadFailures,
  UnreadDetail,
  useGroupName,
  useRuntimeStops,
  useStageFirstDeploys,
  useWithheldStops,
  ZeropsRuntimeStops,
} from "./ZeropsGroupDetail";

/**
 * A project's own page: its header, then what changes day to day — what waits on the person, its
 * places, its Mates, its changes — beside the cards of what is set up once (`ProjectPageBody`). It
 * draws through the overview's flow (`ZeropsProjectsContent`), so a Mate's row, a place and a change
 * are one thing on both, and its dialogs (rename, delete, connect) are the overview's own.
 */
export function ZeropsGroupDetailPage({
  groupId,
  connectReturned = null,
}: {
  readonly groupId: string;
  /**
   * Back from GitHub's install page, which the connect dialog left for: it opens again, for the
   * code repository it was open for (`repo`; absent: asked first).
   */
  readonly connectReturned?: { readonly repo?: string | undefined } | null;
}) {
  const groupName = useGroupName(groupId);
  const [mirroring, setMirroring] = useState(connectReturned !== null);
  // The New Mate dialog over this page, as from every "Add a Mate" (`ZeropsNewMateHost`).
  const addMate = useAddMate();
  const project = useMemo(
    (): ProjectPageSlot => ({
      groupId,
      render: ({ entry, props, addMateWhy }) => (
        <ProjectPage
          addMateWhy={addMateWhy}
          entry={entry}
          groupId={groupId}
          onAddMate={() => {
            addMate(groupId);
          }}
          props={props}
        />
      ),
      unread: (undrawn: boolean) => <UnreadGroupDetail groupId={groupId} undrawn={undrawn} />,
    }),
    [addMate, groupId],
  );
  return (
    <ZeropsHostedFrame bar={false} width="full">
      <ZeropsProjectsContent project={project} search={NO_SEARCH} />
      {mirroring && groupName !== undefined ? (
        <GitMirrorDialog
          appId={groupId}
          appName={groupName}
          onClose={() => {
            setMirroring(false);
          }}
          repo={connectReturned?.repo}
        />
      ) : null}
    </ZeropsHostedFrame>
  );
}

const NO_SEARCH = {};

/** The page once the overview's flow holds the project: its own reads, then its body. */
function ProjectPage<T>({
  groupId,
  entry,
  props,
  addMateWhy,
  onAddMate,
}: {
  readonly groupId: string;
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly addMateWhy: string | null;
  readonly onAddMate: () => void;
}) {
  const recipeFailure = useHqAppFailure(groupId);
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const flow = flows.get(groupId);
  const facts = {
    ...useProjectPageFacts(groupId, flow, recipeFailure, entry.flow),
    fixOf: usePlaceFix(groupId, flow, props.cardPlaces?.(entry)),
  };
  const groupName = useGroupName(groupId);
  const spendIds = useMemo(() => spendProjectIds(entry.flow), [entry.flow]);
  const repos = flow?.codeRepos ?? flow?.repos;
  const setup: ProjectPageSetup = {
    rows: (open) => (
      <>
        {/* Each code repository and where its code goes: once it has one. */}
        {groupName === undefined || flow === undefined || (repos ?? []).length === 0 ? null : (
          <SetupRow label="Code" rows surface="project-repositories">
            <ProjectRepositories
              environments={flow.environments}
              groupId={groupId}
              groupName={groupName}
              repos={repos}
            />
          </SetupRow>
        )}
        <ProjectAutomationRow groupId={groupId} onManage={open.automation} />
        <ProjectPeopleRow groupId={groupId} onManage={open.access} />
        <ProjectSpendRow appId={groupId} projectIds={spendIds} />
      </>
    ),
    access: <ProjectPeople groupId={groupId} />,
    automation: <ProjectAutomation groupId={groupId} name={groupName} repos={repos} />,
  };
  return (
    <ProjectPageBody
      addMateWhy={addMateWhy}
      entry={entry}
      facts={facts}
      onAddMate={onAddMate}
      props={props}
      setup={setup}
    />
  );
}

/**
 * "Ask <Mate> to fix it" on a place that is not well: the person's own Mate in the project they
 * last talked to (`useFixMates`), its composer written with the problem as the menu's chip words it
 * (`fixProblemOf`) — none where the person has no Mate here.
 */
function usePlaceFix(
  groupId: string,
  flow: ZeropsProjectFlow | undefined,
  places:
    | {
        readonly chip?: ProductionChip | undefined;
        readonly stageChips?: ReadonlyMap<string, ProductionChip | undefined> | undefined;
        readonly down?: ReadonlyMap<string, ReadonlyArray<string>> | undefined;
      }
    | undefined,
): ProjectPageFacts["fixOf"] {
  const fixer = useFixMates({ projectId: groupId, groupId })[0];
  const askToFix = useAskMateToFix();
  if (fixer === undefined) return undefined;
  const failure =
    flow === undefined || !flow.releasesKnown
      ? undefined
      : releaseFailureOf({
          releases: flow.releases,
          environmentInputs: flow.environmentInputs,
          stalled: flow.release.stalled,
        });
  return (line) => {
    const projectId = line.projectId ?? "";
    const chip = line.kind === "production" ? places?.chip : places?.stageChips?.get(projectId);
    const problem = (chip === undefined
      ? undefined
      : fixProblemOf({
          chip,
          failure,
          down: places?.down?.get(projectId) ?? [],
          ...(line.kind === "stage" ? { name: line.name } : {}),
        })) ?? {
      what: `${placeLabel(line)}: ${line.words.join(", ")}`,
      ask: "Find out why and fix it.",
    };
    return {
      name: fixer.name,
      onAsk: () => {
        askToFix(fixer.mateProjectId, problem);
      },
    };
  };
}

/**
 * What the page reads of the project beyond the overview's group: its environments as places, a
 * slot for each tier it lacks (drawn once HQ has told them: before that, or where HQ refuses them,
 * nothing is known to be absent), its release offer, and the verbs on its places.
 */
function useProjectPageFacts(
  groupId: string,
  flow: ZeropsProjectFlow | undefined,
  recipeFailure: ReturnType<typeof useHqAppFailure>,
  groupFlow: GroupFlow,
): ProjectPageFacts {
  const deployments = useStopDeploymentsShown();
  const environments = flow?.environments ?? NO_ENVIRONMENTS;
  const release = useReleaseOffer(groupId, flow);
  const { withheldNotice } = useWithheldStops(environments);
  const firstDeployOf = useStageFirstDeploys(flow);
  const environmentFacts = useApplicationEnvironmentFacts();
  const addEnvironment = useAddEnvironment();
  const openPutLive = useOpenPutLive();
  const { listing } = useZeropsCandidates();
  const { halfMade, finishing } = useEnvironmentSetup(
    useMemo(() => heldCandidates(listing).rows.map(({ project }) => project.id), [listing]),
  );
  const halfMadeHere = halfMade.filter((entry) => entry.groupId === groupId);
  const production = environments.find((entry) => entry.tier === "production");
  const slots =
    flow === undefined || !flow.declarationsRead
      ? []
      : environmentSlots({
          ...environmentFacts(groupId, flow),
          halfMade: halfMadeHere.map((entry) => ({
            id: entry.projectId,
            tier: entry.tier,
            finish: entry.finish,
          })),
          productionRuns:
            production?.target.kind !== "zerops"
              ? "unknown"
              : productionRunsOf(deployments.get(production.target.projectId)),
          waiting: (() => {
            const waiting =
              flow.release.summary ?? releaseContentsSummary(flow.release.contents, 20);
            return {
              count: waiting.total,
              atLeast: waiting.atLeast,
              changeCount: waiting.changeCount,
            };
          })(),
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
  return {
    brought: liveBrought(flow),
    changes: pageChanges({ flow: groupFlow, read: flow }),
    changesUnknown:
      flow === undefined || !flow.changesKnown
        ? (flow?.changesFailure ?? "Reading its changes…")
        : undefined,
    repos: flow?.repos,
    environments,
    slots,
    release,
    onAdd: (tier) => {
      if (tier === "production") openPutLive(groupId);
      else addEnvironment(groupId, tier);
    },
    onFinish: (projectId) => {
      const entry = halfMadeHere.find((candidate) => candidate.projectId === projectId);
      if (entry !== undefined) finishing.finish(entry);
    },
    finishing: finishing.finishing.has(groupId),
    withheldNotice,
    firstDeployOf,
    repo: groupRepository(environments),
    declared: flow?.declarationsRead === true,
    readFailures:
      flow === undefined ? null : (
        <ProjectReadFailures recipe={recipeFailure} comparison={flow.release.comparisonFailure} />
      ),
  };
}

const NO_ENVIRONMENTS: ProjectPageFacts["environments"] = [];

function UnreadGroupDetail({
  groupId,
  undrawn,
}: {
  readonly groupId: string;
  /** The tree leaves the project out for good (`ProjectPageSlot.unread`). */
  readonly undrawn: boolean;
}) {
  const deployments = useStopDeploymentsShown();
  const runtimeStops = useRuntimeStops(groupId);
  const navigate = useNavigate();
  const groupName = useGroupName(groupId);
  const trail = usePageTrail({ project: { groupId, name: groupName } });
  // The page in its own boxes: its header, its main column's place, and its side column, where the
  // environments already read stand.
  return (
    <div className="pp" data-zerops-surface="project-page">
      <PageHeader title={groupName} trail={trail} />
      <div className="pp-cols">
        <div className="pp-main">
          {undrawn ? (
            <UndrawnGroupDetail groupId={groupId} />
          ) : (
            <UnreadDetail
              groupId={groupId}
              standIn={
                <Loading label="This project">
                  <div className="pp-main">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </Loading>
              }
            />
          )}
        </div>
        <div className="pp-side">
          <ZeropsRuntimeStops
            stops={runtimeStops}
            deployments={deployments}
            onOpen={(projectId) => {
              void navigate({ to: "/group/$groupId/$projectId", params: { groupId, projectId } });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A project HQ knows that the tree draws nothing of: it says why, with the way to its repositories
 * where it has some. HQ unanswered says so first: what it last told may be out of date. Untold
 * environments are not an empty list, so they never read as "no environment".
 */
function UndrawnGroupDetail({ groupId }: { readonly groupId: string }) {
  const orgId = useAccountOrgId();
  const navigate = useNavigate();
  const failure = useFlowNavigation(orgId).readFailure;
  const navigation = useProjection(canonicalHqNavigation, orgId, NO_ROUTE_NAVIGATION);
  const read = useProjection(
    canonicalAppEnvironments,
    orgId === null ? null : { orgId, appId: groupId },
    NO_ROUTE_ENVIRONMENTS,
  );
  const repos = useHqAppDetail(groupId).repos;
  if (failure !== undefined) return <Note>{failure}</Note>;
  const name =
    navigation?.structure?.apps.find((app) => app.id === groupId)?.name ?? "This project";
  return (
    <div className="flex flex-col items-start gap-2">
      <Note>
        {unreadEnvironmentsWords(read.unread) ??
          (read.environments === undefined
            ? `${name}'s environments could not be read. Reload to update them.`
            : `${name} has no environment of yours yet.`)}
      </Note>
      {repos !== undefined && repos.length > 0 ? (
        <Button
          onClick={() => {
            // The Git page opens one repository by app and name; with several, its overview.
            const only = repos.length === 1 ? repos[0] : undefined;
            void navigate({
              to: "/git",
              search: only === undefined ? {} : { appId: groupId, repo: only.name },
            });
          }}
          size="sm"
          variant="secondary"
        >
          See its repositories
        </Button>
      ) : null}
    </div>
  );
}
