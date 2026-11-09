import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { unreadEnvironmentsWords } from "@t3tools/client-runtime/zerops/hq";
import { canonicalAppEnvironments, canonicalHqNavigation } from "@t3tools/client-runtime/data";
import {
  environmentSlots,
  productionRunsOf,
  releaseContentsSummary,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type EnvironmentSlotRow,
  type FirstDeploy,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, use, useCallback, useMemo, useState } from "react";
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
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { useEnvironmentSetup } from "~/zerops/useEnvironmentSetup";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty";
import { Loading } from "../ui/loading";
import { GitDeliveryStatus } from "./GitDeliveryStatus";
import { GitMirrorDialog } from "./GitMirrorDialog";
import { ProjectRepositories } from "./github/GithubRepoRows";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ProjectPeople } from "./projects/ProjectPeople";
import { ProjectPageBody } from "./project/ProjectPageBody";
import type { ProjectPageSlot } from "./projects/ZeropsProjectsFlow";
import { ProjectCardStandIn } from "./projects/OverviewStandIn";
import { ProjectPageSpend } from "./projects/ProjectSpend";
import { ProjectPageHistory } from "./projects/ProjectHistory";
import { groupRepository } from "./projects/projectHistory.logic";
import { ProjectAutomation } from "./projectAutomation/ProjectAutomation";
import { ReleaseAction, useReleaseOffer, type ReleaseOffer } from "./ZeropsReleaseVerb";
import { ZeropsProjectsContent } from "./ZeropsProjectsPage";
import { Crumbs, usePageTrail } from "./system";
import {
  NO_ROUTE_ENVIRONMENTS,
  NO_ROUTE_NAVIGATION,
  Note,
  ProjectReadFailures,
  SideSection,
  StopLine,
  UnreadDetail,
  useGroupName,
  useRuntimeStops,
  useStageFirstDeploys,
  useWithheldStops,
  ZeropsRuntimeStops,
} from "./ZeropsGroupDetail";

/** Where a project with nothing set up goes: the screen that sets things up. */
function useOpenProjects(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/zerops" });
  }, [navigate]);
}

/**
 * A project's own page: its card from the overview at the page's width — the same slots, so a
 * Mate's row, a place's panel and the release's door are one thing on both — and the column
 * beside it with what a card has no room for: the people on it, its environments, its
 * repositories and its history.
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
  const trail = usePageTrail({ project: { groupId, name: groupName } });
  // The New Mate dialog over this page, as from every "Add a Mate" (`ZeropsNewMateHost`).
  const addMate = useAddMate();
  const project = useMemo(
    (): ProjectPageSlot => ({
      groupId,
      render: ({ entry, props, addMateWhy }) => (
        <ProjectPageBody
          addMateWhy={addMateWhy}
          entry={entry}
          onAddMate={() => {
            addMate(groupId);
          }}
          props={props}
          side={
            <>
              <ZeropsGroupAside groupId={groupId} />
              <ProjectPeople groupId={groupId} />
            </>
          }
        />
      ),
      unread: (undrawn: boolean) => <UnreadGroupDetail groupId={groupId} undrawn={undrawn} />,
    }),
    [addMate, groupId],
  );
  return (
    <ZeropsHostedFrame breadcrumb={<Crumbs trail={trail} />} width="full">
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

/** The page's column: what the project's card has no room for, once its flow is read. */
function ZeropsGroupAside({ groupId }: { readonly groupId: string }) {
  const recipeFailure = useHqAppFailure(groupId);
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const flow = flows.get(groupId);
  if (flow === undefined) return null;
  return <KnownGroupAside groupId={groupId} flow={flow} recipeFailure={recipeFailure} />;
}

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
  // The project's page in its own boxes: its card's place, and its column, where the environments
  // already read stand as the page's own Environments will.
  return (
    <div className="ov-page">
      {undrawn ? (
        <UndrawnGroupDetail groupId={groupId} />
      ) : (
        <UnreadDetail
          groupId={groupId}
          standIn={
            <Loading label="This project">
              <ProjectCardStandIn page />
            </Loading>
          }
        />
      )}
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

function KnownGroupAside({
  groupId,
  flow,
  recipeFailure,
}: {
  readonly groupId: string;
  readonly flow: ZeropsProjectFlow;
  readonly recipeFailure: ReturnType<typeof useHqAppFailure>;
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
  const environmentFacts = useApplicationEnvironmentFacts();
  const addEnvironment = useAddEnvironment();
  const openPutLive = useOpenPutLive();
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
        repositories={
          groupName === undefined ? undefined : (
            <ProjectRepositories
              environments={environments}
              groupId={groupId}
              groupName={groupName}
              repos={flow.codeRepos ?? flow.repos}
            />
          )
        }
        spend={spend}
        automation={
          <ProjectAutomation
            groupId={groupId}
            name={groupName}
            repos={flow.codeRepos ?? flow.repos}
          />
        }
      />
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
  repositories,
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
  /** Its Repositories rows (`ProjectRepositories`), once it has a code repository. */
  readonly repositories?: React.ReactNode;
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
                      {slot.line}
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
      {/* Each code repository and where its code goes: once it has one. */}
      {repositories === undefined || (codeRepos ?? repos ?? []).length === 0 ? null : (
        <SideSection title="Repositories">{repositories}</SideSection>
      )}
      <SideSection title="History">
        {repo === undefined ? (
          <EmptyState
            action={
              // Offered only where the Environments section offers adding a tier to this person.
              slots.some((slot) => slot.kind === "slot" && slot.add) ? (
                <Button onClick={onSetUp} size="sm" variant="secondary">
                  Set up an environment
                </Button>
              ) : null
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
