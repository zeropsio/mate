import { useEnvironmentDeployOffer } from "../../zerops/useChangeOffers";
import { GitStopDetailPage } from "./GitStopDetail";
import { HqEnvironmentId, type ProjectId } from "@t3tools/contracts";
import { unreadEnvironmentsWords } from "@t3tools/client-runtime/zerops/hq";
import {
  canonicalAppEnvironments,
  canonicalHqNavigation,
  environmentById,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { useAccountDataOptional, useProjection } from "~/zerops/accountData";
import { useReleaseOffer, type ReleaseOffer } from "./ZeropsReleaseVerb";
import { usePublicAccess } from "~/zerops/usePublicAccess";
import { StopVaultDrawer, StopVaultToggle } from "./vault/StopVault";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { StopPublicAccessStatus } from "./StopPublicAccess";
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
  changeState,
  type FlowPullRequest,
  flowVerbKey,
  flowVerbLabel,
  carriedReads,
  movedCommits,
  movedCount,
  releaseTagsByCommit,
  type MovedCommits,
  type ZeropsPublicRoute,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type CompareRead,
  type FlowReleaseRow,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentTier,
  type ZeropsEnvironmentRole,
  sameCommit,
} from "@t3tools/client-runtime/zerops";
import {
  DEPLOYS_ASIDE,
  earlierReleasesLabel,
  notInZerops,
  releaseNotCreated,
  releasesNotDeployed,
  serviceRows,
  rowsRunningAgain,
  stopFailedDeploys,
  stopKeyGap,
  stopTierStops,
  stopVerdict,
  stopView,
  type StopFailedDeploy,
  type StopServiceRow,
  type StopTierStop,
  type StopVerdict,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import { useCallback, useContext, useMemo, useState } from "react";

import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useFlowVerbs, type FlowVerbOutcome } from "~/zerops/flowVerbs";
import {
  useFlowNavigation,
  useMateNames,
  useProjectFlows,
  useStopDeploymentsShown,
} from "~/zerops/projectFlows";
import { useKeepDeployKeyOffer } from "~/zerops/useChangeOffers";
import { useOpenReview } from "~/zerops/review";
import { useReleaseComparisons, type ComparedCommits } from "~/zerops/useReleaseComparisons";
import { useHqAppDetail, useHqAppFailure } from "~/zerops/useHqAppDetail";
import { type ZeropsHistoryState } from "~/zerops/useRepositoryHistory";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { usePlaceAccessPeople } from "./projects/ProjectPeople";
import type { columnPeople } from "./projects/accessTable.logic";
import { possessive } from "./matePanels.logic";
import { Link } from "@tanstack/react-router";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryChange, type HistoryNames } from "./ZeropsHistoryView";
import { MateFace, VerdictPanel } from "./primitives";
import { ZeropsDeployAnswer } from "./ZeropsDeployAnswer";
import { deployAnswerSaid } from "@t3tools/client-runtime/zerops/hq";
import { ReleaseList, ReleaseRowsWaiting, ZeropsReleaseRows } from "./ZeropsReleaseRows";
import { RecordedStageHistory, type RecordedStageHistoryProps } from "./RecordedStageHistory";
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
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import {
  PlaceAddressCard,
  PlaceMissingService,
  PlaceServiceTable,
  PlaceServicesWaiting,
  type StopDeployAgain,
} from "./place/PlaceServices";
import { PlaceAccessCard } from "./place/PlaceAccess";
import { PlaceNextCard, PlaceNextRelease } from "./place/PlaceNext";
import { usePlaceServiceMap } from "./place/usePlaceServiceMap";
import {
  placeServiceRows,
  placeTitle,
  environmentTitle,
  rollBackTarget,
} from "./place/place.logic";

import type { CardReady, PlaceLine as PlaceLineData } from "./projects/projectCard.logic";
import {
  changesFrom,
  changesOfRelease,
  changesWaitingForRelease,
  changesWaitingForStage,
  createsFirstLine,
  laterChangesLine,
  placeFixProblem,
  placeHeaderLine,
  stageNextTitle,
} from "./place/placePage.logic";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useFixMates } from "~/zerops/fixMates";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import {
  ChangeList,
  ChangeRow,
  changeRowLine,
  PlaceLine,
  readyOfFlow,
  SectionLabel,
  useApplicationPlaces,
  usePageTrail,
  type Crumb,
} from "./system";
import {
  DetailShell,
  NO_ROUTE_ENVIRONMENTS,
  NO_ROUTE_NAVIGATION,
  Note,
  ProjectReadFailures,
  StopVerdictStandIn,
  UNREAD_DEPLOYMENT,
  UnreadDetail,
  ZeropsRuntimeStops,
  runtimeStopsOf,
  useGroupName,
  useRuntimeStops,
  useStageFirstDeploys,
  useWithheldStops,
} from "./ZeropsGroupDetail";

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

const NO_ROUTE_ENVIRONMENT = Atom.make(undefined);

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
  const trail = usePageTrail({
    project: { groupId, name: navigation?.structure?.apps.find((app) => app.id === groupId)?.name },
    here:
      environment === undefined ? undefined : environmentTitle(environment.tier, environment.name),
  });
  // A Git place's line, as every surface says it: production's one, or the stage of its name.
  const places = useApplicationPlaces(groupId).places;
  if (environment?.target.kind === "zerops") {
    const notice = withheldProjectNotice(
      inventory,
      environment.target.projectId,
      environment.tier === "production" ? "Production" : "Stage",
    );
    if (notice !== null) {
      return (
        <DetailShell title={environmentTitle(environment.tier, environment.name)} trail={trail}>
          <Note>{notice}</Note>
        </DetailShell>
      );
    }
    return (
      <ZeropsProjectStopDetailPage
        groupId={groupId}
        key={environment.target.projectId}
        projectId={environment.target.projectId}
      />
    );
  }
  const note = unreadEnvironmentsWords(read.unread) ?? unread;
  const gitPlaceLine =
    environment === undefined
      ? undefined
      : places.find(
          (line) =>
            line.projectId === environment.id ||
            (line.git !== undefined &&
              line.kind === environment.tier &&
              (environment.tier === "production" || line.name === environment.name)),
        );
  if (environment === undefined) {
    return (
      <ZeropsUnresolvedStopDetailPage
        groupId={groupId}
        environmentId={environmentId}
        groupName={navigation?.structure?.apps.find((app) => app.id === groupId)?.name}
        note={note}
      />
    );
  }
  return (
    <DetailShell
      summary={
        gitPlaceLine === undefined ? undefined : <PlaceLine density="header" line={gitPlaceLine} />
      }
      title={environmentTitle(environment.tier, environment.name)}
      trail={trail}
    >
      <GitStopDetailPage
        appId={groupId}
        environment={{ ...environment, target: environment.target }}
      />
      {note !== null ? <Note>{note}</Note> : null}
    </DetailShell>
  );
}

/** Legacy bookmarks still show placed runtime facts while HQ has no environment identity. */
function ZeropsUnresolvedStopDetailPage({
  groupId,
  environmentId,
  groupName,
  note,
}: {
  readonly groupId: string;
  readonly environmentId: string;
  readonly groupName: string | undefined;
  readonly note: string | null;
}) {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const stops = runtimeStopsOf(groupId, held?.projects ?? inventory.projects, undefined).filter(
    (stop) => stop.projectId === environmentId,
  );
  const deployments = useStopDeploymentsShown(stops.map((stop) => stop.projectId));
  const trail = usePageTrail({ project: { groupId, name: groupName }, here: stops[0]?.name });
  return (
    <DetailShell title={stops[0]?.name} trail={trail}>
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
  const recipeFailure = useHqAppFailure(groupId);
  // Whether HQ has answered the application's detail (its recipe, its releases), or said why not.
  const hqDetail = useHqAppDetail(groupId);
  const hqAnswered =
    hqDetail.read === "read" ||
    hqDetail.failure !== null ||
    hqDetail.reconnecting ||
    hqDetail.unavailableReason !== undefined;
  // The environment's vault beside its page, where the account reads its organization.
  const orgId = useAccountOrgId();
  // Closed on every place's page as it opens: the drawer is this page's, never carried across.
  const [vaultOpen, setVaultOpen] = useState(false);
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
  const pageTitle =
    stop === undefined ? runtimeStops[0]?.name : placeTitle(stop.name, stop.tier).title;
  const trail = usePageTrail({ project: { groupId, name: stopGroupName }, here: pageTitle });
  const names = useHistoryNames();
  // The place's line as the overview, the project page and the menu say it.
  const places = useApplicationPlaces(groupId).places;
  // Lines carry the HQ environment, as the place's route does: never its Zerops project.
  const placeLine =
    stop === undefined ? undefined : places.find((entry) => entry.projectId === stop.id);
  // Who the next changes are from: each Mate's name and face, as the left menu draws them.
  const mates = useZeropsReviewMates(groupId);
  const personName = usePersonNames(orgId ?? undefined);
  // Who a failure here is offered to: the person's own Mate in the project, used last first.
  const [fixer] = useFixMates({ projectId, groupId });
  const askMateToFix = useAskMateToFix();
  const publicAccess = usePublicAccess(projectId);
  // Who reaches the place, for the aside's card; its names are the project page's.
  const access = usePlaceAccessPeople({
    projectId,
    kind: stop?.tier ?? "production",
    name: stop?.name,
  });
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
  // The services its tier declares and Zerops does not have there.
  const missing =
    declared === undefined || withheld !== null
      ? NOTHING_MISSING
      : notInZerops({ recipeServices: declared.recipeServices, platform });
  // Production's release that put nothing live because a service it needs was not created.
  const notCreated =
    flow === undefined || stop === undefined || declared === undefined || withheld !== null
      ? undefined
      : releaseNotCreated({
          tier: stop.tier,
          releases: flow.releases,
          services: declared.services,
          creationFailures: declared.creationFailures,
          missing,
        });
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
          notCreated: notCreated?.tag,
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
      <DetailShell title={pageTitle} trail={trail}>
        <UnreadDetail groupId={groupId} standIn={<StopVerdictStandIn />} />
        <ZeropsRuntimeStops stops={runtimeStops} deployments={deployments} />
      </DetailShell>
    );
  }
  if (withheld !== null) {
    return (
      <DetailShell title={environmentTitle(stop.tier, stop.tier)} trail={trail}>
        <Note>{withheld}</Note>
      </DetailShell>
    );
  }

  const deployment = deployments.get(projectId) ?? UNREAD_DEPLOYMENT;
  const view = stopView({ deployment, row: stop, nowMs });
  const live = flow.releases.find((entry) => entry.standing === "live");
  const releasingTag = flow.release.inFlight ?? (release.releasing ? release.tag : undefined);
  const releasedAge = live?.taggedAt === undefined ? "" : formatRelativeTimeLabel(live.taggedAt);
  // One failed part is asked again from the verdict; several, each from its own row. None of a
  // release whose services were not created: HQ would deploy the part without them.
  const askedAgain = notCreated === undefined ? failedDeploys : NO_FAILED_DEPLOYS;
  const redeploy = askedAgain.length === 1 ? askedAgain[0]?.redeploy : undefined;
  // How many changes production lacks, at least that many where HQ stopped counting.
  const notLive =
    flow.release.summary === undefined
      ? movedCount(flow.release.contents)
      : { count: flow.release.summary.total, atLeast: flow.release.summary.atLeast };
  const verdict = stopVerdict({
    tier: stop.tier,
    view,
    releasing: releasingTag,
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
    notCreated,
  });
  // The changes that go next. While a release is on its way, the ones it carries; what merged
  // after it waits for the next and is only counted.
  const waitingChanges = !flow.changesKnown
    ? NO_CHANGES
    : production
      ? // Until HQ answers the releases, every merged change would read as waiting.
        flow.releasesKnown
        ? changesWaitingForRelease(flow.merged, flow.releases)
        : NO_CHANGES
      : stop.source === "main"
        ? changesWaitingForStage(flow.pullRequests)
        : NO_CHANGES;
  const onItsWay =
    !production || releasingTag === undefined
      ? undefined
      : changesOfRelease(
          waitingChanges,
          flow.releases.find((entry) => entry.tag === releasingTag),
        );

  return (
    <>
      <StopPublicAccessStatus access={publicAccess} />
      <ZeropsStopPane
        access={access}
        groupName={stopGroupName}
        platformServices={serviceMap.rows}
        usageRead={serviceMap.usageRead}
        vault={orgId === null ? undefined : { orgId, open: vaultOpen, onOpenChange: setVaultOpen }}
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
        trail={trail}
        line={placeLine}
        releasing={production ? releasingTag : undefined}
        deployFailed={failedDeploys.length > 0}
        ready={production ? readyOfFlow(flow) : undefined}
        releasesNotDeployed={
          production && declared !== undefined
            ? releasesNotDeployed({
                releases: flow.releases,
                failures: declared.releaseFailures,
                services: declared.services,
              })
            : undefined
        }
        nextChanges={onItsWay?.carried ?? waitingChanges}
        laterChanges={onItsWay?.later}
        releasesRead={flow.releasesKnown ? "known" : hqAnswered ? "unanswered" : "reading"}
        servicesRead={platform.state !== "unread" && platform.state !== "reading" && hqAnswered}
        faces={(mateProjectId) => {
          const mate = mates.get(mateProjectId);
          return mate === undefined ? undefined : (
            <MateFace shape={mate.shape} size={20} state="idle" tint={mate.tint} />
          );
        }}
        mateName={(mateProjectId) => mates.get(mateProjectId)?.name}
        onOpenPull={(pull, from) => {
          openReview(
            { kind: "change", groupId, repository: pull.repository, number: pull.number },
            { from },
          );
        }}
        liveBy={live?.by === undefined ? undefined : personName(live.by)}
        askToFix={
          fixer === undefined
            ? undefined
            : {
                mateName: fixer.name,
                onAsk: (problem) => {
                  askMateToFix(fixer.mateProjectId, problem);
                },
              }
        }
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
          // HQ adds a service to a production only by a release: never offered there.
          mayRunAgain && !production
            ? {
                running: (service) =>
                  verbs.pending.has(
                    flowVerbKey({ kind: "add-service", groupId, projectId, service }),
                  ),
                onAdd: (service) => said(verbs.addService(flow, projectId, service)),
              }
            : undefined
        }
        notInZerops={missing}
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
            : rowsRunningAgain(services, askedAgain)
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
                  onItsWay !== undefined
                    ? onItsWay.unlisted.map((subject) => ({ subject }))
                    : flow.release.summary?.changeCount !== undefined
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
  trail,
  line,
  releasing,
  deployFailed = false,
  ready,
  nextChanges = NO_CHANGES,
  laterChanges = 0,
  releasesNotDeployed,
  releasesRead = "known",
  servicesRead = true,
  faces,
  mateName,
  onOpenPull,
  liveBy,
  askToFix,
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
  groupName,
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
  /**
   * Who reaches the environment's project (`usePlaceAccessPeople`): its people with their level,
   * or what stands for them while read; the aside's card links to the project page's section.
   */
  readonly access?:
    | { readonly summary: ReturnType<typeof columnPeople>; readonly line: string | null }
    | undefined;
  /** The project's name, for the access card's link: "Manage on Tea Shop's page". */
  readonly groupName?: string | undefined;
  /** The environment's vault, where the account reads its organization: a drawer over the page. */
  readonly vault?:
    | {
        readonly orgId: string;
        readonly open: boolean;
        readonly onOpenChange: (open: boolean) => void;
        /** What the drawer holds; the project's vault unless given (a harness's fixture). */
        readonly body?: React.ReactNode;
      }
    | undefined;
  readonly readFailures?: React.ReactNode;
  /** Runtime read recovery belongs beside the verdict that reports it. */
  readonly readAgain?: React.ReactNode;
  /** Where the page sits, outermost first, ending at this place (`usePageTrail`). */
  readonly trail: ReadonlyArray<Crumb>;
  /**
   * The place's line as every surface says it (`useApplicationPlaces`); undefined while unread,
   * when the page says it from its own reads (`placeHeaderLine`).
   */
  readonly line?: PlaceLineData | undefined;
  /** The release on its way to production; production only. */
  readonly releasing?: string | undefined;
  /** A deploy of the place failed: production's release, or a stage's deploy. */
  readonly deployFailed?: boolean;
  /** What waits for production's next release (`readyOfFlow`); production only. */
  readonly ready?: CardReady | undefined;
  /**
   * The changes that go next: on production, the Mates' merged changes no release put live yet;
   * on a stage, the open changes that merge to it.
   */
  readonly nextChanges?: ReadonlyArray<FlowPullRequest> | undefined;
  /** While a release is on its way: how many changes merged after it and wait for the next. */
  readonly laterChanges?: number | undefined;
  /** The releases HQ refused before anything of them deployed (`releasesNotDeployed`). */
  readonly releasesNotDeployed?: ReadonlySet<string> | undefined;
  /**
   * Where HQ's answer of the releases stands: until it is in (`reading`) their slot holds its
   * shape; `unanswered` where HQ said why not or is away, which the page says elsewhere.
   */
  readonly releasesRead?: "known" | "reading" | "unanswered" | undefined;
  /**
   * Whether the reads the services wait on have answered — the platform's listing and HQ's
   * detail. Until then the slot holds its cards' shape; once they have and `services` is still
   * undefined, HQ declares nothing here and the platform's own services are listed.
   */
  readonly servicesRead?: boolean | undefined;
  /** A change's Mate's face, by the Mate's project. */
  readonly faces?: ((mateProjectId: string) => React.ReactNode) | undefined;
  /** A change's Mate's name, by the Mate's project. */
  readonly mateName?: ((mateProjectId: string) => string | undefined) | undefined;
  /** Opens a change's review from the row pressed. */
  readonly onOpenPull?: ((pull: FlowPullRequest, from: HTMLElement) => void) | undefined;
  /** Who made the live release, by name; undefined where the person is not known. */
  readonly liveBy?: string | undefined;
  /**
   * "Ask <Mate> to fix it" on a failure: the person's own Mate in the project (`useFixMates`);
   * undefined where they have none.
   */
  readonly askToFix?:
    | { readonly mateName: string; readonly onAsk: (problem: FixProblem) => void }
    | undefined;
  readonly groupId: string;
  readonly stop: EnvironmentRow;
  /** What the stop runs, as the left menu reads it — its menu is that menu. */
  readonly view: StopView;
  readonly verdict: StopVerdict;
  /**
   * The code services as HQ deploys them; undefined until the recipe and the complete platform
   * listing are read, or for good where HQ declares none (`servicesRead`).
   */
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
  // Still being read: the slot holds its cards' shape. Read, with nothing declared by HQ: the
  // platform's own services stand in the same cards.
  const servicesWaiting =
    readServices === undefined && (!servicesRead || platformServices === undefined);
  const head = placeTitle(stop.name, stop.tier);
  const live = releases.find((entry) => entry.standing === "live");
  const releasedAge = live === undefined ? undefined : formatRelativeTimeLabel(live.taggedAt);
  const headerLine =
    line ??
    placeHeaderLine({
      tier: stop.tier,
      name: stop.name,
      projectId,
      view,
      releasing,
      failed: deployFailed,
      releasedAge,
      since: view.activatedAt === null ? undefined : formatRelativeTimeLabel(view.activatedAt),
      source: stop.source,
      routes,
    });
  const rollBackTo = production ? rollBackTarget(releases) : undefined;
  // The verdict speaks only where no section says it: a failure, or a place that runs nothing
  // and has more to say than the header's "Not released yet" — what deploys it, or its first
  // deploy under way. What waits for a release is Next release's, a release on its way is the
  // header's, calm is the header's dot.
  // A place the platform says is down, where no deploy failed: the header's Down, said as a failure.
  const down = headerLine.dot === "down" && verdict.tone !== "failed";
  // A release that created nothing it needed: the panel says it once, and its way out is the
  // next release's card in its ordinary form — no pill, no verb, saying it again.
  const reviewNext = !down && verdict.reviewNext === true;
  const nextReady = reviewNext && ready?.failed === true ? { ...ready, failed: false } : ready;
  const releasingNow = production && (releasing !== undefined || release.releasing);
  const laterLine = releasingNow ? laterChangesLine(laterChanges) : undefined;
  const runs = view.version?.label;
  const panel = down
    ? {
        tone: "failed" as const,
        text: `${head.title} is down.`,
        detail: headerLine.words.slice(1).join(" · ") || undefined,
      }
    : verdict;
  const verdictShown =
    down ||
    verdict.tone === "failed" ||
    (view.version === undefined &&
      (verdict.detail !== undefined || verdict.tone === "busy") &&
      verb?.kind !== "release" &&
      !(production && releasing !== undefined));
  const changeRows = nextChanges.map((pull) => {
    const open = !pull.merged;
    // A merged change waiting for a release is calm: its row says no word. An open one says
    // where it stands.
    const words = open ? (changeState(pull)?.word ?? "Open") : undefined;
    return (
      <ChangeRow
        at={open ? pull.updatedAt : pull.mergedAt}
        face={faces?.(pull.mateProjectId)}
        key={`${pull.repository}#${String(pull.number)}`}
        line={
          words === undefined ? undefined : changeRowLine(mateName?.(pull.mateProjectId), words)
        }
        onOpen={onOpenPull === undefined ? undefined : (from) => onOpenPull(pull, from)}
        open={open}
        pull={pull}
      />
    );
  });
  // Where HQ listed only the subjects (commits outside a Mate's change), they stand as rows.
  const subjectRows =
    changeRows.length > 0
      ? []
      : waiting.commits.map((commit, index) => (
          <ChangeRow key={commit.sha ?? index} title={commit.subject} />
        ));
  const nextRows =
    changeRows.length + subjectRows.length === 0 && untold.length === 0 ? undefined : (
      <>
        <ChangeList label={production ? "Changes in the next release" : "Changes to approve"}>
          {changeRows}
          {subjectRows}
        </ChangeList>
        {untold.length === 0 ? null : (
          <p className="pt-1 pb-2 text-body text-muted-foreground">{cannotTellWhatRuns(untold)}.</p>
        )}
      </>
    );
  const nextShown = production
    ? release.offered || release.releasing || nextRows !== undefined
    : nextChanges.length > 0;
  const from = changesFrom(nextChanges.map((pull) => mateName?.(pull.mateProjectId)));
  // Where a code service answers to nobody, the Addresses card offers to open it.
  const offers = services.flatMap((row) => row.offers);
  return (
    <DetailShell
      actions={
        <>
          {vault === undefined ? null : (
            <StopVaultToggle onOpenChange={vault.onOpenChange} open={vault.open} />
          )}
          {projectId === undefined ? null : (
            <ZeropsStopMenu
              groupId={groupId}
              name={head.title}
              projectId={projectId}
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
          )}
        </>
      }
      summary={<PlaceLine density="header" line={headerLine} />}
      title={head.title}
      titleTag={head.tag === undefined ? undefined : <ZeropsRoleTag label={ROLE_TAG[stop.tier]} />}
      trail={trail}
    >
      {readFailures}
      {!verdictShown ? null : (
        <div>
          <VerdictPanel detail={panel.detail} text={panel.text} tone={panel.tone}>
            {askToFix === undefined || panel.tone !== "failed" || reviewNext ? null : (
              <Button
                onClick={() => {
                  askToFix.onAsk(
                    placeFixProblem({
                      tier: stop.tier,
                      title: head.title,
                      text: panel.text,
                      detail: panel.detail,
                      down,
                      serving: production ? live?.tag : undefined,
                    }),
                  );
                }}
                size="sm"
                variant="secondary"
              >
                {`Ask ${askToFix.mateName} to fix it`}
              </Button>
            )}
            {!down && verb?.kind === "run-again" && runAgain !== undefined ? (
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
            <p className="mt-1.5 px-3 text-sm text-status-failed-text">{runAgain.refused}</p>
          )}
          {down || verdict.why === undefined ? null : (
            // HQ's own words for the cause, under the sentence that names it.
            <p
              className="mt-1.5 px-3 text-body text-muted-foreground"
              data-zerops-surface="place-why"
            >
              {verdict.why}
            </p>
          )}
        </div>
      )}

      {/* What happens on the left, what is set up on the right: the aside drops under the main
          column where the page is too narrow for both. */}
      <div className="@container/place min-w-0" data-zerops-surface="place-sections">
        <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-9 @4xl/place:grid-cols-[minmax(0,1fr)_24.5rem]">
          <div className="flex min-w-0 flex-col gap-9">
            {!nextShown ? null : production ? (
              <PlaceSection
                label={
                  <SectionLabel>{releasingNow ? "Releasing now" : "Next release"}</SectionLabel>
                }
              >
                <PlaceNextRelease
                  creates={releasingNow ? undefined : createsFirstLine(notInZerops)}
                  from={from}
                  ready={nextReady}
                  release={release}
                >
                  {nextRows}
                </PlaceNextRelease>
                {laterLine === undefined ? null : (
                  <p
                    className="px-1 text-body text-muted-foreground"
                    data-zerops-surface="place-later-changes"
                  >
                    {laterLine}
                  </p>
                )}
              </PlaceSection>
            ) : (
              <PlaceSection label={<SectionLabel>Next on {head.title}</SectionLabel>}>
                <PlaceNextCard state="stage" title={stageNextTitle(nextChanges, head.title)}>
                  {nextRows}
                </PlaceNextCard>
              </PlaceSection>
            )}

            {!production || releases.length > 0 ? null : releasesRead === "reading" ? (
              // Its releases are not answered yet: a place that runs something has some, so the
              // slot holds their rows' shape; one that runs nothing says so once they are.
              runs === undefined ? null : (
                <PlaceSection label={<SectionLabel>Releases</SectionLabel>}>
                  <div className={cn(PLACE_CARD_CLASS, "p-1.5")}>
                    <ReleaseRowsWaiting />
                  </div>
                </PlaceSection>
              )
            ) : releasesRead === "unanswered" ? null : runs !== undefined ? (
              <PlaceSection label={<SectionLabel>Releases</SectionLabel>}>
                <p
                  className="rounded-xl border border-dashed border-border px-4 py-3.5 text-body text-muted-foreground"
                  data-zerops-surface="place-releases-unrecorded"
                >
                  {`No releases are recorded for this production; it runs ${runs}.`}
                </p>
              </PlaceSection>
            ) : nextShown ? null : (
              <PlaceSection label={<SectionLabel>Releases</SectionLabel>}>
                <p
                  className="rounded-xl border border-dashed border-border px-4 py-3.5 text-body text-muted-foreground"
                  data-zerops-surface="place-releases-empty"
                >
                  No releases yet. A release puts what is merged on main live here, and each one is
                  listed with the way back to it.
                </p>
              </PlaceSection>
            )}

            {!production || releases.length === 0 ? null : (
              <PlaceSection label={<SectionLabel count={releases.length}>Releases</SectionLabel>}>
                <div className={cn(PLACE_CARD_CLASS, "@container/releases p-1.5")}>
                  <ReleaseList>
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
                      liveBy={liveBy}
                      onRollBack={onRollBack}
                      pending={pending}
                      notDeployed={releasesNotDeployed}
                      releases={listed}
                      releasing={releasing}
                    />
                  </ReleaseList>
                  {earlier === 0 || allReleases ? null : (
                    <span className="flex px-2 pt-1 pb-1.5">
                      <Button
                        onClick={() => {
                          setAllReleases(true);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        {earlierReleasesLabel(earlier)}
                      </Button>
                    </span>
                  )}
                </div>
              </PlaceSection>
            )}

            {production ? null : (
              <PlaceSection
                label={
                  <SectionLabel
                    count={
                      recordedHistory === undefined
                        ? repo !== undefined && history.kind === "read"
                          ? `${String(history.total)} ${DEPLOYS_ASIDE}`
                          : DEPLOYS_ASIDE
                        : undefined
                    }
                  >
                    Deploys
                  </SectionLabel>
                }
              >
                <div className={cn(PLACE_CARD_CLASS, "px-4 py-3")}>
                  {recordedHistory !== undefined ? (
                    <RecordedStageHistory {...recordedHistory} onOpenChange={onOpenChange} />
                  ) : servicesWaiting ? (
                    <div aria-hidden="true" className="flex flex-col gap-2.5 py-1">
                      <Skeleton className="h-3 w-2/3" surface="card" />
                      <Skeleton className="h-3 w-1/2" surface="card" />
                    </div>
                  ) : repo === undefined ? (
                    <p className="text-body text-muted-foreground">
                      No repository is declared for this environment&rsquo;s services, so its
                      history cannot be read.
                    </p>
                  ) : history.kind === "read" && history.commits.length === 0 ? (
                    <p className="text-body text-muted-foreground">
                      No deploys yet. Each merge to main lands here.
                    </p>
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
                </div>
              </PlaceSection>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-8" aria-label={`${head.title} setup`}>
            <PlaceSection
              label={
                <SectionLabel count={servicesWaiting ? undefined : table.length}>
                  Services
                </SectionLabel>
              }
            >
              {servicesWaiting ? (
                <PlaceServicesWaiting />
              ) : projectId === undefined ? null : (
                <PlaceServiceTable
                  answered={answered}
                  deployAgain={deployAgain}
                  projectId={projectId}
                  rows={table}
                  said={verdict.detail}
                  usageRead={usageRead}
                >
                  {notInZerops.map((hostname) => (
                    <PlaceMissingService
                      answer={answered.get(hostname)}
                      byRelease={production}
                      hostname={hostname}
                      key={hostname}
                      verb={
                        // A production gets a service only by a release: HQ refuses the verb.
                        addService === undefined || production ? null : (
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
                        )
                      }
                    />
                  ))}
                </PlaceServiceTable>
              )}
              {servicesWaiting || table.length > 0 || notInZerops.length > 0 ? null : (
                // Its code services and the platform's both: a place with a database alone has one.
                <p
                  className="rounded-xl border border-dashed border-border px-4 py-3.5 text-body text-muted-foreground"
                  data-zerops-surface="place-services-empty"
                >
                  Nothing runs here yet. Its services appear as its first deploy lands.
                </p>
              )}
              {projectId === undefined || tierStops.length === 0 ? null : (
                <StopTierStops
                  projectId={projectId}
                  rowClassName="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-border/60 py-2 first:border-t-0"
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
            </PlaceSection>

            {projectId === undefined ? null : (
              <PlaceSection label={<SectionLabel>Addresses</SectionLabel>}>
                <PlaceAddressCard
                  enablingServiceId={enablingServiceId ?? null}
                  offers={offers}
                  onEnableRoute={onEnableRoute}
                  projectId={projectId}
                  routes={routes}
                />
                {routeTrouble === null || routeTrouble === undefined ? null : (
                  <p className="text-sm text-status-failed-text">{routeTrouble}</p>
                )}
              </PlaceSection>
            )}

            {access === undefined || projectId === undefined ? null : (
              <PlaceSection
                label={
                  <SectionLabel
                    action={
                      <Button
                        render={
                          <Link
                            hash={`access-${projectId}`}
                            params={{ groupId }}
                            to="/group/$groupId/flow"
                          />
                        }
                        size="sm"
                        variant="link"
                      >
                        {groupName === undefined
                          ? "Manage on the project’s page"
                          : `Manage on ${possessive(groupName, "page")}`}
                      </Button>
                    }
                  >
                    Who has access
                  </SectionLabel>
                }
              >
                <PlaceAccessCard line={access.line} summary={access.summary} />
              </PlaceSection>
            )}
          </aside>
        </div>
      </div>
      {/* A verb that refused says so under the card it was pressed in. */}
      {trouble === null ? null : <p className="mt-2 text-sm text-status-failed-text">{trouble}</p>}
      {vault === undefined || projectId === undefined ? null : (
        <StopVaultDrawer
          body={vault.body}
          name={head.title}
          onOpenChange={vault.onOpenChange}
          open={vault.open}
          orgId={vault.orgId}
          projectId={projectId}
        />
      )}
    </DetailShell>
  );
}

/** A card of the place's page: a hairline and the card ground. */
const PLACE_CARD_CLASS = "min-w-0 rounded-xl border border-border/70 bg-card";

/**
 * One section of the place's page: its label hugging its card, every section well apart from the
 * next — spacing is grouping.
 */
function PlaceSection({
  label,
  children,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      {label}
      {children}
    </section>
  );
}

const NO_CHANGES: ReadonlyArray<FlowPullRequest> = [];

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
