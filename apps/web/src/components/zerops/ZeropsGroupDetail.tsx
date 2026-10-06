import { useStopPublicAccess } from "~/zerops/useStopPublicAccess";
import { useMatesInventory } from "~/zerops/useMatesInventory";
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
 * Nothing here is fetched twice: the flow is the account-wide read every
 * Zerops surface shares (`projectFlowContext`), and the history and what each
 * release carried are HQ's comparisons, asked once and held (`useZeropsCompares`).
 *
 * Structural only — what a row says is `projectFlow.ts`'s and
 * `groupHistory.ts`'s (rule R5).
 */
import { useAtomValue } from "@effect/atom-react";
import { hqEnvironmentsAtom, hqMatesAtom } from "~/state/zerops";
import { StopReadAgain } from "./StopReadAgain";
import {
  cannotTellWhatRuns,
  assignCandidateMateTints,
  buildZeropsGroupTree,
  heldGroupLabel,
  hasMate,
  mateShapeOf,
  changeState,
  deployWord,
  flowVerbKey,
  flowVerbLabel,
  projectNameInApp,
  readZeropsMembership,
  environmentSlots,
  productionRunsOf,
  type EnvironmentSlotRow,
  PROJECT_ALL_CLEAR,
  projectAttention,
  releaseContentsCommits,
  releaseContentsSummary,
  carriedReads,
  movedCommits,
  movedCount,
  releaseTagsByCommit,
  type MovedCommits,
  type ReleaseContentsSummary,
  shortCommit,
  sidebarChangeLabel,
  type ProjectAttentionItem,
  type ZeropsPublicRoute,
  type ProjectAttentionKind,
  type EnvironmentRow,
  type FlowPullRequest,
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
  matePoseOf,
} from "@t3tools/client-runtime/zerops";
import {
  DEPLOYS_ASIDE,
  earlierReleasesLabel,
  NONE_YET,
  NOT_PUBLIC_YET,
  notInZerops,
  serviceRows,
  stopCardTitle,
  stopFailedDeploy,
  stopKeyGap,
  stopMetaLine,
  stopTone,
  stopVerdict,
  stopView,
  type Deployment,
  type RunAgain,
  type StopServiceRow,
  type StopVerdict,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { KnownAffordance, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import {
  candidatesNotice,
  findCandidate,
  heldCandidates,
  type CandidatesNotice,
} from "@t3tools/client-runtime/zerops/projections";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { Fragment, useCallback, useContext, useId, useMemo, useState } from "react";

import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { MateLiveView } from "@t3tools/shared/hqMates";

import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  activityOfNow,
  mateAwake,
  mateFaceFor,
  mateFaceOf,
  mateReviewWaits,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { useMateRowActivity } from "~/zerops/useMenuMateReadings";
import { useAddMate } from "~/zerops/newMate";
import { useZeropsAgentActivity } from "~/zerops/useZeropsAgentActivity";
import { useListingPatience } from "~/zerops/useListingPatience";
import { useNowMs } from "~/zerops/useNowMs";
import { mateUpdateStatus, type MateUpdateStatus } from "~/zerops/mateUpdate";
import { useZeropsMateUpdateStates } from "~/zerops/useZeropsMateUpdate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import {
  type FlowVerbOutcome,
  type ZeropsProjectFlow,
  useZeropsProjectFlowOptional,
} from "~/zerops/projectFlowContext";
import { useChangeOffers, useKeepDeployKeyOffer } from "~/zerops/useChangeOffers";
import { REVIEW_RELEASE_LABEL, useOpenReview } from "~/zerops/review";
import { useZeropsCompares, type ComparedCommits } from "~/zerops/useZeropsCompares";
import { useZeropsRecipeFailure } from "~/zerops/useZeropsAppRecipes";
import {
  useAddEnvironment,
  useGroupPendingEnvironments,
  useMayAddEnvironment,
} from "~/zerops/useAddEnvironment";
import { useHalfMadeEnvironments } from "~/zerops/useHalfMadeEnvironments";
import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { useZeropsHistory, type ZeropsHistoryState } from "~/zerops/useZeropsHistory";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsHistoryView, type HistoryChange, type HistoryNames } from "./ZeropsHistoryView";
import {
  FlatCard,
  MateFace,
  MicroLabel,
  StatusDot,
  VERDICT_BORDER_CLASS,
  VerdictPanel,
} from "./primitives";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { MateUpdateStatusText } from "./MateUpdateLine";
import { ZeropsProjectMenu } from "./ZeropsProjectMenu";
import type { ZeropsMenuAction } from "./ZeropsProjectMenu";
import { ZeropsDeployAnswer } from "./ZeropsDeployAnswer";
import { ZeropsDeployLog } from "./ZeropsDeployLog";
import { deployAnswerSaid, type DeployAnswerJob } from "@t3tools/client-runtime/zerops/hq";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";
import { ZeropsChangeReview } from "./review/ZeropsChangeReview";
import { ZeropsProjectRenameMenu } from "./ZeropsProjectRenameMenu";
import { ZeropsStopMenu } from "./ZeropsStopMenu";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import {
  findInventoryProjectRef,
  HeldInventoryContext,
  withheldProjectNotice,
} from "~/zerops/inventoryContext";
import { useStopServices } from "~/zerops/accountForge";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { BOOT_WAIT_LINE_MS, READING_PROJECTS_LINE } from "~/zerops/waitLine.logic";
import { unreadFlowWords } from "~/zerops/hqRead.logic";
import { PageWaitLine } from "./WaitLine";

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
    (projectId: string) => withheldProjectNotice(inventory, projectId),
    [inventory],
  );
  const shown = useMemo(
    () =>
      environments === undefined
        ? EMPTY_STOPS
        : environments.filter((environment) => withheldNotice(environment.projectId) === null),
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

/**
 * Every Mate on this project, with everything that can be done to it.
 *
 * The same `useMateActions` the projects screen uses, so *Rename Mate*,
 * *Restart*, *Hand this Mate over* and the rest are one definition — this page
 * listed its Mates and could do nothing to any of them (the owner,
 * 2026-09-19). The registry and the health read are taken here and handed
 * over: both hold per-instance state, and a second reader is a second poll.
 *
 * The update verbs are not among them: they belong to the server a Mate runs,
 * and `ZeropsMateUpdateControl` is what holds that answer. It rides in as the
 * menu's extra entries, mounted once per Mate, exactly as the Mate card does
 * it — so the same *Check for updates* is offered on both.
 */
function useMateMenus(): {
  readonly menuForMate: (projectId: string) => React.ReactNode;
  readonly dialogs: React.ReactNode;
  readonly trouble: string | null;
} {
  const { listing } = useZeropsCandidates();
  const { serverVersions } = useZeropsContainers();
  const registry = useZeropsRegistry();
  const actions = useMateActions({ registry, serverVersions });
  const menuForMate = useCallback(
    (projectId: string) => {
      const found = findCandidate(listing, (entry) => entry.project.id === projectId);
      if (found.kind !== "found") return null;
      const candidate = found.row;
      const tags = readZeropsMembership(candidate.project);
      const menu = (extra: ReadonlyArray<ZeropsMenuAction>) => {
        const entries = actions.actionsFor(candidate, tags, extra);
        // A menu with nothing in it is a button that opens an empty box.
        if (entries.length === 0) return null;
        return (
          <ZeropsProjectMenu
            actions={entries}
            label={`More for ${projectNameInApp(candidate.project)}`}
            routes={candidate.routes}
          />
        );
      };
      // *Check for updates* and *Update to x.y.z* are the server's own verbs,
      // and the control that reads that server is a mount per Mate — the same
      // one the Mate card uses, so a check started here and a check started
      // there are the same check (`useZeropsMateUpdate` keys by environment).
      if (candidate.group !== "connected" || candidate.environmentId === undefined) return menu([]);
      return (
        <ZeropsMateUpdateControl
          environmentId={candidate.environmentId}
          mateName={projectNameInApp(candidate.project)}
        >
          {({ menuActions }) => menu(menuActions)}
        </ZeropsMateUpdateControl>
      );
    },
    [actions, listing],
  );
  return { menuForMate, dialogs: actions.dialogs, trouble: actions.trouble };
}

/** The project's own menu uses the same writer decision and rename form as its row. */
function useGroupActions(groupId: string): {
  readonly menu: React.ReactNode;
} {
  const group = useGroup(groupId);
  return { menu: group === undefined ? null : <ZeropsProjectRenameMenu group={group} /> };
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

/**
 * The repository a group's history is read from: the one its environments are
 * built from. Never guessed from a hostname — that address 404s.
 */
function groupRepository(environments: ReadonlyArray<EnvironmentRow>): string | undefined {
  for (const environment of environments) {
    if (environment.versionRepository !== undefined) return environment.versionRepository;
  }
  return undefined;
}

/** What a history may call a Mate: its name rather than its bot login. */
function useHistoryNames(): HistoryNames {
  const flowValue = useZeropsProjectFlowOptional();
  const mateNames = flowValue?.mateNames;
  return useMemo(() => ({ mateNames }), [mateNames]);
}

/** How "Who is on it" names the listing it is drawn from, while that listing cannot say "none". */
const GROUP_MATES_SURFACE = {
  subject: "who is on this project",
  entity: "project",
  source: "zerops",
  checking: "Checking who is on it…",
  negative: null,
} as const;

/**
 * Every Mate on a project, as its page shows them, and what the section says
 * in place of "no Mate" until the listing may say it (DESIGN §3.4): a
 * placeholder while it is unread, its cause while its read failed, "Still
 * reading…" over the Mates read of a listing known in part.
 *
 * Read from the same three places the menu reads: the group tree for who is in
 * the group, the activity feed for what each is on, and `mateTints` for the
 * colour its face wears — so a Mate is the same Mate on both surfaces.
 */
function useGroupMates(groupId: string): {
  readonly mates: ReadonlyArray<GroupMate>;
  readonly notice: CandidatesNotice | null;
  /** Reads the listing again: the notice's *Try again*. */
  readonly refresh: () => void;
} {
  const { listing, refresh } = useZeropsCandidates();
  // Each Mate as its menu row reads it: HQ's word, or its socket's.
  const activityOf = useMateRowActivity(useZeropsAgentActivity());
  // HQ's word of who is up, as the menu reads it (`mateAwake`).
  const hqView = useAtomValue(hqMatesAtom);
  const hqMates = hqView?.current === true ? hqView.mates : null;
  const updates = useZeropsMateUpdateStates();
  const nowMs = useNowMs();
  const flow = useZeropsProjectFlowOptional()?.flows.get(groupId);
  // Only the Mates HQ says wait on the viewer wait on them (`waitsOnViewer`).
  const waitsOnViewer = useWaitsOnViewer();
  const mates = useMemo(() => {
    const candidates = heldCandidates(listing).rows;
    const tints = assignCandidateMateTints(candidates);
    // Order is irrelevant here — a lookup by groupId, not a listing.
    const group = buildZeropsGroupTree(candidates, { order: "name" }).groups.find(
      (entry) => entry.group.groupId === groupId,
    );
    // A group's `environments` is every project in it — the stage and the
    // production included. `hasMate` is the predicate the menu has always used
    // to tell a Mate from a stop, and this listed the stops as Mates without it
    // (the owner, 2026-09-19).
    return (group?.environments ?? [])
      .filter(({ item }) => hasMate(item))
      .map(({ item }) =>
        groupMateOf({
          nowMs,
          item,
          read: activityOf(item),
          mates: hqMates,
          tint: tints.get(item.project.id) ?? "slate",
          reviewWaits: mateReviewWaits(flow, item.project.id),
          mine: waitsOnViewer(item.project.id),
          update: mateUpdateStatus(updates.of(item)),
        }),
      );
  }, [activityOf, flow, groupId, hqMates, listing, updates, waitsOnViewer, nowMs]);
  const patient = useListingPatience(listing);
  const notice = useMemo(
    () => candidatesNotice(listing, GROUP_MATES_SURFACE, nowMs, { patient }),
    [listing, nowMs, patient],
  );
  return { mates, notice, refresh };
}

/** Opens a Mate's own conversation, as selecting its row in the menu does (`useOpenMate`). */
function useOpenMateOf(): (projectId: string) => void {
  const openMate = useOpenMate();
  return useCallback((projectId: string) => openMate({ projectId }), [openMate]);
}

/**
 * What this project needs somebody for, and the one handler that deals with
 * whichever row they press.
 *
 * Each row already knows what it acts on, so this is a switch rather than four
 * callbacks threaded down: a Mate opens its conversation, a stop and a change
 * open their pages, and a release is the project's own verb.
 */
function useProjectAttention(
  groupId: string,
  mates: ReadonlyArray<GroupMate>,
  input: {
    readonly environments: ReadonlyArray<EnvironmentRow>;
    readonly pullRequests: ReadonlyArray<FlowPullRequest>;
    readonly notLive: number;
    readonly notLiveAtLeast: boolean;
    readonly canRelease: boolean;
  },
): {
  readonly items: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
} {
  const flowValue = useZeropsProjectFlowOptional();
  const mateNames = flowValue?.mateNames;
  const openMate = useOpenMateOf();
  const navigate = useNavigate();
  const { environments, pullRequests, notLive, notLiveAtLeast, canRelease } = input;

  const items = useMemo(
    () =>
      projectAttention({
        // A face wearing `needs` is a Mate that has stopped and asked
        // something: the one state where nothing moves until a person answers.
        waitingMates: mates
          .filter((mate) => mate.asks === true && mate.failed !== true)
          .map((mate) => ({ projectId: mate.projectId, name: mate.name })),
        // Stopped on an error, it wears the same face and asks nothing.
        failedMates: mates
          .filter((mate) => mate.failed === true)
          .map((mate) => ({ projectId: mate.projectId, name: mate.name })),
        failedStops: environments
          .filter((environment) => environment.tone === "bad")
          .map((environment) => ({
            projectId: environment.projectId,
            name: environment.name,
          })),
        pullRequests,
        notLive,
        notLiveAtLeast,
        canRelease,
        mateNames: mateNames ?? EMPTY_MATE_NAMES,
      }),
    [canRelease, environments, mateNames, mates, notLive, notLiveAtLeast, pullRequests],
  );

  const onAct = useCallback(
    (item: ProjectAttentionItem) => {
      const target = item.target;
      if (target === undefined) return;
      if (target.kind === "mate") {
        openMate(target.projectId);
        return;
      }
      if (target.kind === "stop") {
        void navigate({
          to: "/group/$groupId/$projectId",
          params: { groupId, projectId: target.projectId },
        });
        return;
      }
      void navigate({
        to: "/change/$groupId/$repository/$number",
        params: {
          groupId,
          repository: target.repository,
          number: String(target.number),
        },
      });
    },
    [groupId, navigate, openMate],
  );

  return { items, onAct };
}

/** Where a project with nothing set up goes: the screen that sets things up. */
function useOpenProjects(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/zerops" });
  }, [navigate]);
}

/** The release the flow offers on a group, read the way the menu row reads it. */
function useReleaseOffer(groupId: string): ReleaseOffer {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const openReview = useOpenReview();
  const onReview = useCallback(
    (from: HTMLElement) => {
      openReview({ kind: "release", groupId }, { from });
    },
    [groupId, openReview],
  );
  const gate = flow?.release.gate;
  return {
    offered: gate?.allowed ?? false,
    reason: gate === undefined || gate.allowed ? undefined : gate.reason,
    releasing:
      flow?.release.inFlight !== undefined ||
      (flowValue?.pending.has(flowVerbKey({ kind: "release", groupId })) ?? false),
    tag: flow?.release.suggestion,
    onReview,
  };
}

/**
 * The door to the next release's review where the projects page draws a project's next step:
 * the same review every other door opens (R1). `label` is the step's own words.
 */
export function ZeropsReleaseVerb({
  groupId,
  label,
}: {
  readonly groupId: string;
  readonly label: string;
}) {
  const release = useReleaseOffer(groupId);
  // The projects page's verbs are all one height; this one is theirs.
  return <ReleaseAction label={label} release={release} size="compact" />;
}

/**
 * Where each declared stage of the group that runs nothing stands on its first deploy
 * (`stageFirstDeploy`), as its cell on the projects page and the menu say it: from what the
 * platform runs, HQ's jobs of its deploys, and whether HQ is still bringing it up.
 */
function useStageFirstDeploys(groupId: string): (projectId: string) => FirstDeploy | undefined {
  const { listing } = useZeropsCandidates();
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  return (projectId) => {
    const row = flow?.environments.find(
      (entry) => entry.projectId === projectId && entry.tier === "stage",
    );
    const candidate = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    return stageFirstDeploy({
      birth: row?.birth,
      projectStatus: candidate?.project.status,
      services: candidate?.services === undefined ? undefined : candidate.services.statuses,
      deployment: flowValue?.deployments.get(projectId),
      deploys: row?.deploys,
      keyGap: row?.keyGap ?? false,
    });
  };
}

type RuntimeStopIdentity = {
  readonly projectId: string;
  readonly name: string;
  readonly tier: "production" | "stage";
};
export function runtimeStopsOf(
  groupId: string,
  projects: ReadonlyArray<ZeropsProject>,
  declared: ReadonlyArray<RuntimeStopIdentity> | undefined,
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
  if (declared !== undefined) for (const stop of declared) stops.set(stop.projectId, stop);
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
  const declared = useAtomValue(hqEnvironmentsAtom)?.get(groupId);
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
          const words = (
            <>
              <span className="text-sm font-medium">{stop.name}</span>
              <ZeropsRoleTag label={stop.tier === "production" ? "prod" : "stage"} />
              <StatusDot label={view.line} sentence tone={STOP_DOT_TONE[view.tone] ?? "off"} />
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
                    onClick={() => onOpen(stop.projectId)}
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

export function ZeropsGroupDetailPage({ groupId }: { readonly groupId: string }) {
  const recipeFailure = useZeropsRecipeFailure(groupId);
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const runtimeStops = useRuntimeStops(groupId);
  const navigate = useNavigate();
  const environments = flow?.environments ?? [];
  const repo = groupRepository(environments);
  const history = useZeropsHistory({ appId: groupId, repo, repos: flow?.repos });
  const tags = useReleaseTags(flow?.releases);
  const openChange = useOpenChange(groupId, repo);
  const waiting = releaseContentsSummary(flow?.release.contents ?? [], 20);
  const groupName = useGroupName(groupId);
  const openProjects = useOpenProjects();
  // The New Mate dialog over this page, as from every "Add a Mate" (`ZeropsNewMateHost`).
  const addMate = useAddMate();
  const actions = useGroupActions(groupId);
  const mates_ = useMateMenus();
  const release = useReleaseOffer(groupId);
  const crumbs = useCrumbs();
  const names = useHistoryNames();
  const { mates, notice: matesNotice, refresh: rereadMates } = useGroupMates(groupId);
  // Each Mate drawn here has its project read: its menu's Restart stands on its container.
  useMatesInventory(useMemo(() => mates.map((mate) => mate.projectId), [mates]));
  const openMate = useOpenMateOf();
  const { withheldNotice, shown } = useWithheldStops(environments);
  const firstDeployOf = useStageFirstDeploys(groupId);
  const attention = useProjectAttention(groupId, mates, {
    environments: shown,
    pullRequests: flow?.pullRequests ?? EMPTY_PULLS,
    notLive: waiting.total,
    notLiveAtLeast: waiting.atLeast,
    canRelease: release.offered,
  });
  const { mayAdd, writer } = useMayAddEnvironment()(groupId);
  const addEnvironment = useAddEnvironment();
  const devstages = useDevstages(groupId);
  const pendingEnvironments = useGroupPendingEnvironments(groupId);
  const { listing } = useZeropsCandidates();
  const { halfMade, finishing } = useHalfMadeEnvironments(heldCandidates(listing).rows);

  if (flow === undefined) {
    return (
      <DetailShell crumbs={crumbs} title={groupName}>
        <ZeropsRuntimeStops
          stops={runtimeStops}
          deployments={flowValue?.deployments}
          onOpen={(projectId) => {
            void navigate({ to: "/group/$groupId/$projectId", params: { groupId, projectId } });
          }}
        />
        <UnreadDetail groupId={groupId} />
      </DetailShell>
    );
  }

  const production = environments.find((entry) => entry.tier === "production");
  const halfMadeHere = halfMade.filter((entry) => entry.groupId === groupId);
  // Drawn once HQ has told the environments: before that, or where HQ refuses them to the reader,
  // nothing is known to be absent.
  const slots = !flow.declarationsRead
    ? []
    : environmentSlots({
        environments: environments.map((entry) => ({ id: entry.projectId, tier: entry.tier })),
        devstages,
        pending: pendingEnvironments,
        halfMade: halfMadeHere.map((entry) => ({ id: entry.projectId, tier: entry.tier })),
        recipeTiers: flow.recipeTiers,
        recipeRead: flow.recipeRead,
        mayAdd,
        writer,
        productionRuns:
          production === undefined
            ? "unknown"
            : productionRunsOf(flowValue?.deployments.get(production.projectId)),
        waiting: { count: waiting.total, atLeast: waiting.atLeast },
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
    <ZeropsGroupPane
      readFailures={
        <ProjectReadFailures recipe={recipeFailure} comparison={flow.release.comparisonFailure} />
      }
      environments={environments}
      slots={slots}
      onAdd={(tier) => {
        addEnvironment(groupId, tier);
      }}
      onFinish={(projectId) => {
        const entry = halfMadeHere.find((candidate) => candidate.projectId === projectId);
        if (entry !== undefined) finishing.finish(entry);
      }}
      finishing={finishing.finishing.has(groupId)}
      history={history}
      groupId={groupId}
      attention={attention.items}
      mates={mates}
      matesNotice={matesNotice}
      onMatesNoticeAct={(affordance) => {
        if (affordance.kind === "go-to-projects") openProjects();
        else rereadMates();
      }}
      name={groupName}
      onAct={attention.onAct}
      names={names}
      menu={
        <>
          {actions.menu}
          {mates_.dialogs}
        </>
      }
      menuForMate={mates_.menuForMate}
      onAddMate={() => {
        addMate(groupId);
      }}
      onOpenMate={openMate}
      crumbs={crumbs}

      onSetUp={openProjects}
      release={release}
      trouble={mates_.trouble}
      onOpenChange={openChange}
      pullRequests={flow.pullRequests}
      repo={repo}
      tags={tags}
      waiting={waiting}
      withheldNotice={withheldNotice}
      firstDeployOf={firstDeployOf}
    />
  );
}

/**
 * A project group, drawn — every read already done and handed in.
 *
 * Split from the page above for the same reason the change's pane is: a
 * harness and a test can then look at a project with nothing set up, or twelve
 * changes waiting, without an account behind it.
 */
export function ZeropsGroupPane({
  readFailures,
  environments,
  slots,
  onAdd,
  onFinish,
  finishing,
  history,
  attention,
  groupId,
  mates,
  matesNotice = null,
  onMatesNoticeAct,
  onAct,
  name,
  names,
  crumbs,
  menu,
  menuForMate,
  onAddMate,
  onOpenMate,
  onSetUp,
  trouble,
  onOpenChange,
  pullRequests,
  release,
  repo,
  tags,
  waiting,
  withheldNotice,
  firstDeployOf,
}: {
  readonly readFailures?: React.ReactNode;
  /** What has landed on the repository, as HQ compares it. */
  readonly history: ZeropsHistoryState;
  /** `full sha → the release that shipped it`. */
  readonly tags: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Opens the review of the change that landed a commit. */
  readonly onOpenChange?: ((change: HistoryChange, from: HTMLElement) => void) | undefined;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  /** The *Environments* section's rows: what exists, and a slot for each tier that does not. */
  readonly slots: ReadonlyArray<EnvironmentSlotRow>;
  /** *Finish setup*, pressed on a half-made environment, by its project. */
  readonly onFinish: (id: string) => void;
  /** An environment of this application is being finished now. */
  readonly finishing: boolean;
  /** *Add stage* or *Add production*, pressed on a slot. */
  readonly onAdd: (tier: EnvironmentRow["tier"]) => void;
  readonly groupId: string;
  /** The project's name; undefined while the listing has not named it — never its id. */
  readonly name: string | undefined;
  readonly crumbs: ReadonlyArray<Crumb>;
  /** Where a project with nothing set up goes to get something set up. */
  readonly onSetUp: () => void;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly release: ReleaseOffer;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  /** What needs somebody, worst first — the page's opening answer. */
  readonly attention: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
  /** Every Mate on this project read so far, in the order the menu lists them. */
  readonly mates: ReadonlyArray<GroupMate>;
  /**
   * What "Who is on it" says until the listing may say "no Mate" (DESIGN §3.4);
   * absent or `null` once it is complete.
   */
  readonly matesNotice?: CandidatesNotice | null;
  /** Its affordance, pressed: read the listing again, or go to the projects. */
  readonly onMatesNoticeAct?: ((affordance: KnownAffordance) => void) | undefined;
  readonly names: HistoryNames;
  readonly onAddMate: () => void;
  /** One Mate's own quiet actions, by its project id. */
  readonly menuForMate?: (projectId: string) => React.ReactNode;
  /** The project's own quiet actions — rename, above all. */
  readonly menu?: React.ReactNode;
  /** Why a write from that menu failed, said under the heading it came from. */
  readonly trouble?: string | null;
  readonly onOpenMate: (projectId: string) => void;
  readonly waiting: ReleaseContentsSummary;
  /**
   * What a stop says in place of its content while the grant withholds its
   * project (DESIGN §3.4); `null` while it may be shown. Absent, every stop is.
   */
  readonly withheldNotice?: (projectId: string) => string | null;
  /** Where a stage that runs nothing stands on its first deploy (`useStageFirstDeploys`). */
  readonly firstDeployOf?: (projectId: string) => FirstDeploy | undefined;
}) {
  const deployed = useMemo(
    () =>
      deployedShas(
        environments.filter(
          (environment) => (withheldNotice?.(environment.projectId) ?? null) === null,
        ),
      ),
    [environments, withheldNotice],
  );
  return (
    <DetailShell
      // *Release* left the header when the panel below got a working one: a
      // page says a thing once, and the place it says it is the place you act
      // on it. *Add a Mate* stays — it answers nothing the panel raised.
      actions={
        <>
          <Button onClick={onAddMate} size="sm" variant="outline">
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add a Mate
          </Button>
          {menu}
        </>
      }
      crumbs={crumbs}

      subtitle={groupSubtitle(environments.length, pullRequests.length)}
      title={name}
    >
      {trouble === null || trouble === undefined ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
      {readFailures}
      <AttentionPanel items={attention} onAct={onAct} release={release} />

      <Section title="Who is on it">
        {mates.length === 0 ? (
          matesNotice === null ? (
            <Empty
              action="Add a Mate"
              onAction={onAddMate}
              text="No Mate is working on this project yet."
            />
          ) : null
        ) : (
          <ul className="flex flex-col">
            {mates.map((mate) => (
              <MateLine
                key={mate.projectId}
                mate={mate}
                menu={menuForMate?.(mate.projectId)}
                onOpen={onOpenMate}
              />
            ))}
          </ul>
        )}
        {matesNotice === null ? null : (
          <ListingNotice notice={matesNotice} onAct={onMatesNoticeAct} />
        )}
      </Section>

      {slots.length === 0 ? null : (
        <Section title="Environments">
          <ul className="flex flex-col">
            {slots.map((slot) => {
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
                        variant="outline"
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
                        variant="outline"
                      >
                        {`Add ${slot.name.toLocaleLowerCase()}`}
                      </Button>
                    ) : null}
                  </li>
                );
              const environment = environments.find((entry) => entry.projectId === slot.id);
              if (environment === undefined) return null;
              return (
                <Fragment key={slot.id}>
                  <StopLine
                    environment={environment}
                    groupId={groupId}
                    notice={withheldNotice?.(environment.projectId) ?? null}
                    firstDeploy={firstDeployOf?.(environment.projectId)}
                  />
                  {slot.note === undefined ? null : (
                    <li className="flex min-w-0 items-center gap-3 px-2 pb-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {slot.note.text}
                      </span>
                      {slot.note.review ? (
                        <ReleaseAction release={release} variant="outline" />
                      ) : null}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="In flight">
        {pullRequests.length === 0 ? (
          <Note>Nothing open.</Note>
        ) : (
          <ul className="flex flex-col">
            {pullRequests.map((pull) => (
              <ChangeLine
                among={pullRequests}
                groupId={groupId}
                key={`${pull.repository}#${pull.number}`}
                pull={pull}
              />
            ))}
          </ul>
        )}
      </Section>

      {waiting.total === 0 || !environments.some((entry) => entry.tier === "production") ? null : (
        <Section
          title={`Merged, waiting for production · ${String(waiting.total)}${waiting.atLeast ? "+" : ""}`}
        >
          <ul className="mb-3 flex flex-col gap-1">
            {waiting.subjects.map((subject) => (
              <li className="truncate text-sm text-foreground" key={subject}>
                {subject}
              </li>
            ))}
            {waiting.more === 0 ? null : (
              <li className="text-sm text-muted-foreground">
                {`+${String(waiting.more)}${waiting.atLeast ? "+" : ""} more`}
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section title={repo === undefined ? "History" : `History · ${repo}`}>
        {repo === undefined ? (
          <Empty
            action="Set up an environment"
            onAction={onSetUp}
            text="No repository is declared for this project’s services yet."
          />
        ) : (
          <ZeropsHistoryView
            history={history}
            names={names}
            onOpenChange={onOpenChange}
            request={{ repo, deployed }}
            tags={tags}
          />
        )}
      </Section>
    </DetailShell>
  );
}

export function ZeropsStopDetailPage({
  groupId,
  projectId,
}: {
  readonly groupId: string;
  readonly projectId: string;
}) {
  const recipeFailure = useZeropsRecipeFailure(groupId);
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const runtimeStops = useRuntimeStops(groupId).filter((entry) => entry.projectId === projectId);
  const stop = flow?.environments.find((entry) => entry.projectId === projectId);
  const declared = flow?.environmentInputs.find((entry) => entry.projectId === projectId);
  // A stop whose project the grant withholds draws nothing of it (DESIGN §3.4),
  // nor marks what it runs in another stop's history, and reads nothing its
  // repository and commit address.
  const { withheldNotice, shown } = useWithheldStops(flow?.environments);
  const withheld = withheldNotice(projectId);
  const repo = withheld === null ? stop?.versionRepository : undefined;
  const deployed = useMemo(() => deployedShas(shown), [shown]);
  const stage = stop?.tier === "stage";
  const production = stop?.tier === "production";
  // Only a stage draws its deploys: a production moves by release, and its
  // releases are the list it is read by.
  const history = useZeropsHistory({
    appId: groupId,
    repo: stage ? repo : undefined,
    repos: flow?.repos,
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
  );
  const release = useReleaseOffer(groupId);
  const openReview = useOpenReview();
  const stopGroupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: stopGroupName });
  const names = useHistoryNames();
  const publicAccess = useStopPublicAccess(projectId);
  const routes = publicAccess.access.routes;
  const offers = publicAccess.access.offers;
  const route = useEnableRoute();
  const inventory = useZeropsInventory();
  const platform = useStopServices(
    withheld === null ? findInventoryProjectRef(inventory, projectId) : null,
  );
  // Only a countdown reads the clock, and nothing here counts down: the time
  // the page was first drawn is enough, as it is for the left menu's rows.
  const [nowMs] = useState(Date.now);
  // Where a stage that runs nothing stands on its first deploy, as its cell and the menu say it.
  const firstDeployOf = useStageFirstDeploys(groupId);
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
  const failedDeploy =
    flow === undefined || stop === undefined
      ? undefined
      : stopFailedDeploy({ tier: stop.tier, rows: services, releases: flow.releases });
  // *Run again* asks HQ, by its rule for who develops the application.
  const mayRunAgain = useChangeOffers()(groupId)?.redeploy ?? false;
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

  if (flowValue === null || flow === undefined || stop === undefined) {
    return (
      <DetailShell crumbs={crumbs} title={runtimeStops?.[0]?.name}>
        <ZeropsRuntimeStops stops={runtimeStops} deployments={flowValue?.deployments} />
        <UnreadDetail groupId={groupId} />
      </DetailShell>
    );
  }
  if (withheld !== null) {
    return (
      <DetailShell crumbs={crumbs} title={stop.tier}>
        <Note>{withheld}</Note>
      </DetailShell>
    );
  }

  const deployment = flowValue.deployments.get(projectId) ?? UNREAD_DEPLOYMENT;
  const view = stopView({ deployment, row: stop, nowMs });
  const live = flow.releases.find((entry) => entry.standing === "live");
  const releasedAge = live?.taggedAt === undefined ? "" : formatRelativeTimeLabel(live.taggedAt);
  const redeploy = failedDeploy?.redeploy;
  // How many changes production lacks, at least that many where HQ stopped counting.
  const notLive = movedCount(flow.release.contents);
  const verdict = stopVerdict({
    tier: stop.tier,
    view,
    releasing: flow.release.inFlight ?? (release.releasing ? release.tag : undefined),
    failed: failedDeploy === undefined ? undefined : { ...failedDeploy, mayRunAgain },
    waiting: notLive.count,
    waitingAtLeast: notLive.atLeast,
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
      <StopPublicAccessStatus shown={publicAccess.shown} again={publicAccess.again} />
      <ZeropsStopPane
        readAgain={<StopReadAgain projectId={projectId} />}
        readFailures={
          <ProjectReadFailures recipe={recipeFailure} comparison={flow.release.comparisonFailure} />
        }
        carried={carried}
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
        pending={flowValue.pending}
        release={release}
        releases={production ? flow.releases : NO_RELEASES}
        repo={repo}
        routeTrouble={route.trouble}
        routes={routes}
        deployAgain={
          mayRunAgain
            ? {
                running: (service) =>
                  flowValue.pending.has(
                    flowVerbKey({ kind: "redeploy", groupId, projectId, service }),
                  ),
                onDeployAgain: (again) => said(flowValue.redeploy(groupId, projectId, again)),
              }
            : undefined
        }
        addService={
          mayRunAgain
            ? {
                running: (service) =>
                  flowValue.pending.has(
                    flowVerbKey({ kind: "add-service", groupId, projectId, service }),
                  ),
                onAdd: (service) => said(flowValue.addService(groupId, projectId, service)),
              }
            : undefined
        }
        notInZerops={
          declared === undefined || withheld !== null
            ? undefined
            : notInZerops({ recipeServices: declared.recipeServices, platform })
        }
        deployAnswer={deployAnswer}
        runAgain={
          redeploy === undefined || !mayRunAgain
            ? undefined
            : {
                running: flowValue.pending.has(
                  flowVerbKey({ kind: "redeploy", groupId, projectId, service: redeploy.service }),
                ),
                refused: runAgainRefused,
                onRunAgain: () => said(flowValue.redeploy(groupId, projectId, redeploy)),
              }
        }
        services={services}
        stop={stop}
        tags={tags}
        trouble={flowValue.trouble}
        verdict={verdict}
        view={view}
        untold={production ? flow.release.untold : NO_UNTOLD}
        waiting={
          production
            ? {
                commits: releaseContentsCommits(flow.release.contents),
                total: notLive.count,
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
  readonly sha: string;
  readonly subject: string;
}

/**
 * What `main` has that a production does not: the commits HQ listed, and how many there are in
 * all — at least that many where HQ stopped counting.
 */
interface StopWaiting {
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
 * *Deploy … again* on a service that runs a version HQ did not make for it (`StopServiceDrift`):
 * HQ's live commit there, asked again by whoever may *Run again* (the deploy-jobs design).
 */
interface StopDeployAgain {
  /** Whether it is under way for the service. */
  readonly running: (service: string) => boolean;
  readonly onDeployAgain: (redeploy: RunAgain) => void;
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
 * every release against the one before it, read once and held. `undefined` without the services —
 * a stage, or a withheld stop.
 */
function useStopCarried(
  groupId: string,
  releases: ReadonlyArray<FlowReleaseRow> | undefined,
  services: GroupEnvironmentRowInput["services"] | undefined,
): ReadonlyMap<string, ComparedCommits> | undefined {
  const reads = useMemo(() => {
    if (services === undefined || releases === undefined) return undefined;
    const repositoryOf = new Map(
      services.flatMap((entry) =>
        entry.repository === undefined ? [] : [[entry.hostname, entry.repository] as const],
      ),
    );
    return carriedReads({ releases, repositoryOf });
  }, [releases, services]);
  const asks = useMemo(
    () => (reads === undefined ? NO_ASKS : new Map([[groupId, [...reads.values()].flat()]])),
    [groupId, reads],
  );
  const compares = useZeropsCompares(asks);
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
  deployAnswer,
  services,
  stop,
  tags,
  trouble,
  untold,
  verdict,
  view,
  waiting,
}: {
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
  readonly services: ReadonlyArray<StopServiceRow>;
  /** Offered on a production that is behind — the one stop a release moves. */
  readonly release: ReleaseOffer;
  readonly runAgain?: StopRunAgain | undefined;
  /** Offered beside a service that runs what HQ did not deploy, to whoever may run it again. */
  readonly deployAgain?: StopDeployAgain | undefined;
  /** Offered beside a service the recipe declares and the project lacks, by the same rule. */
  readonly addService?: StopAddService | undefined;
  /** The services the stop's tier declares and its project lacks (`notInZerops`). */
  readonly notInZerops?: ReadonlyArray<string> | undefined;
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
  return (
    <DetailShell
      actions={
        <ZeropsStopMenu
          name={title}
          projectId={stop.projectId}
          onOpenStop={undefined}
          routes={routes}
          stop={view}
          triggerClassName="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        />
      }
      crumbs={crumbs}

      subtitle={stopMetaLine({ tier: stop.tier, source: stop.source, services: services.length })}
      title={title}
      titleTag={<ZeropsRoleTag label={ROLE_TAG[stop.tier]} />}
    >
      {readFailures}
      <div>
        <VerdictPanel detail={verdict.detail} text={verdict.text} tone={verdict.tone}>
          {verb?.kind === "release" ? (
            <ReleaseAction release={release} size="compact" variant="outline" />
          ) : verb?.kind === "run-again" && runAgain !== undefined ? (
            <Button
              data-zerops-primary-action="Run again"
              disabled={runAgain.running}
              onClick={runAgain.onRunAgain}
              size="compact"
              variant="outline"
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

      <FlatCard className="flex flex-col divide-y divide-border px-4">
        {waiting.commits.length === 0 ? null : (
          <CardGroup title={stopCardTitle("waiting", waiting.total, waiting.atLeast)}>
            <ul className="flex flex-col">
              {waiting.commits.map((commit) => (
                <li
                  className={cn(CARD_ROW_CLASS, "grid-cols-[4.5rem_minmax(0,1fr)]")}
                  key={commit.sha}
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {shortCommit(commit.sha)}
                  </span>
                  <span className="min-w-0 truncate text-sm text-foreground">{commit.subject}</span>
                </li>
              ))}
            </ul>
            {untold.length === 0 ? null : (
              <p className="py-2 text-sm text-muted-foreground">{cannotTellWhatRuns(untold)}.</p>
            )}
          </CardGroup>
        )}

        <CardGroup title={stopCardTitle("services", services.length)}>
          {services.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{NONE_YET}</p>
          ) : (
            <ul className="flex flex-col">
              {services.map((row) => (
                <StopServiceLine
                  projectId={stop.projectId}
                  deployAgain={deployAgain}
                  answer={answered.get(row.hostname)}
                  enablingServiceId={enablingServiceId ?? null}
                  key={row.hostname}
                  onEnableRoute={onEnableRoute}
                  row={row}
                  said={verdict.detail}
                />
              ))}
            </ul>
          )}
          {notInZerops.length === 0 ? null : (
            <ul className="flex flex-col" data-zerops-surface="stop-not-in-zerops">
              {notInZerops.map((hostname) => (
                <li className={cn(CARD_ROW_CLASS, "grid-cols-[minmax(0,1fr)_auto]")} key={hostname}>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {hostname} ·{" "}
                    {answered.get(hostname) === undefined ? (
                      "declared in the recipe, not in Zerops"
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
                      size="compact"
                      variant="outline"
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
                  : { carried: { carried, names, onOpenChange: onOpenCarriedChange } })}
                groupId={groupId}
                onRollBack={onRollBack}
                pending={pending}
                releases={listed}
              />
            </ul>
            {earlier === 0 || allReleases ? null : (
              <Button
                className="my-1 text-muted-foreground"
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
            aside={DEPLOYS_ASIDE}
            title={stopCardTitle(
              "deploys",
              repo !== undefined && history.kind === "read" ? history.total : undefined,
            )}
          >
            {repo === undefined ? (
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
                request={{ repo, deployed }}
                tags={tags}
              />
            )}
          </CardGroup>
        )}
      </FlatCard>
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
 * A service's row: the same four places on every row, so the status dots run
 * down one column — collapsed to name and state over the rest on a phone.
 */
const SERVICE_ROW_CLASS = cn(
  CARD_ROW_CLASS,
  "grid-cols-[minmax(0,1fr)_auto] gap-y-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.4fr)]",
);

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
 * One service of a stop: what it is, what it runs, how that deploy went, and
 * where it answers.
 */
function StopServiceLine({
  projectId,
  row,
  onEnableRoute,
  enablingServiceId,
  deployAgain,
  answer,
  said,
}: {
  readonly projectId: string;
  readonly row: StopServiceRow;
  readonly answer: DeployAnswerJob | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
  readonly deployAgain: StopDeployAgain | undefined;
  /** What the verdict over the rows already says: HQ's words for a failure, never said twice. */
  readonly said: string | undefined;
}) {
  const publicAccess = useStopPublicAccess(projectId);
  const dot = STOP_DOT_TONE[row.tone];
  // HQ's live commit, asked again over a version HQ did not deploy, where HQ takes the ask.
  const again = row.drift?.redeploy;
  // Nothing to offer where the caller cannot act on it — a row with a button
  // that does nothing is worse than no row.
  const offers = onEnableRoute === undefined ? [] : row.offers;
  const deployLog =
    answer === undefined
      ? row.deployLog
      : answer.jobId === row.deployLog?.jobId
        ? row.deployLog
        : answer.deployLog;
  return (
    <li className="flex flex-col">
      <div className={SERVICE_ROW_CLASS}>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm leading-5 font-medium text-foreground">
            {row.hostname}
          </span>
          <span className="truncate text-xs leading-4 text-muted-foreground">{row.repository}</span>
        </span>
        <span className="col-span-2 col-start-1 flex min-w-0 flex-col sm:col-span-1 sm:col-start-2 sm:row-start-1">
          {/* No commit and a state: what runs is not stated yet, so nothing is claimed. */}
          {row.commit !== undefined ? (
            <span className="truncate font-mono text-[13px] leading-5 text-foreground tabular-nums">
              {row.commit}
            </span>
          ) : row.status === undefined ? (
            <span className="truncate text-sm leading-5 text-muted-foreground">{row.word}</span>
          ) : null}
          {row.line === undefined ? null : (
            <span className="truncate text-xs leading-4 text-muted-foreground">{row.line}</span>
          )}
        </span>
        <span className="col-start-2 row-start-1 flex min-w-0 text-line text-foreground sm:col-start-3">
          {row.status === undefined ||
          (answer !== undefined &&
            (row.runs === undefined || row.job !== undefined)) ? null : dot === undefined ? (
            <span className="min-w-0 break-words text-muted-foreground">{row.status}</span>
          ) : (
            <StatusDot label={row.status} sentence tone={dot} />
          )}
        </span>
        <span className="col-span-2 col-start-1 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-4 sm:row-start-1">
          {(!publicAccess.bound || publicAccess.access.state === "ready") &&
          row.routes.length === 0 &&
          offers.length === 0 ? (
            <span className="truncate text-[13px] text-muted-foreground">{NOT_PUBLIC_YET}</span>
          ) : null}
          <StopPublicAccessStatus shown={publicAccess.shown} again={publicAccess.again} />
          {row.routes.map((route) => (
            <a
              className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground underline-offset-2 hover:underline"
              href={route.url}
              key={route.host}
              rel="noreferrer"
              target="_blank"
            >
              <span className="min-w-0 truncate">{route.host}</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </a>
          ))}
          {/* A service that serves HTTP and answers to nobody: the row that
              would list its address is the row you add one from. */}
          {offers.map((offer) => {
            const opening = enablingServiceId === offer.serviceId;
            return (
              <span
                className="flex min-w-0 flex-col items-start gap-0.5"
                data-zerops-surface="stop-route-offer"
                key={offer.serviceId}
              >
                <Button
                  disabled={opening || enablingServiceId !== null}
                  onClick={() => onEnableRoute?.(offer.serviceId)}
                  size="compact"
                  variant="outline"
                >
                  {opening ? "Opening…" : "Open to the internet"}
                </Button>
                <span className="truncate text-xs text-muted-foreground">
                  {offer.service} answers on {offer.port}, but not from outside
                </span>
              </span>
            );
          })}
        </span>
      </div>
      {/* Its newest job, where it is not what the service runs: where it stands, and why. */}
      {answer !== undefined ? (
        <span
          className="pb-2 text-xs leading-4 text-muted-foreground"
          data-zerops-job-state={answer.state}
        >
          {answer.line}
        </span>
      ) : row.job === undefined ? null : (
        <span
          className="flex min-w-0 flex-col pb-2 text-xs leading-4 text-muted-foreground"
          data-zerops-surface="stop-service-job"
          data-zerops-job-state={row.job.state}
        >
          <span className="truncate">{row.job.line}</span>
          {row.job.redeploy === undefined || deployAgain === undefined ? null : (
            <Button
              disabled={deployAgain.running(row.job.redeploy.service)}
              onClick={() =>
                row.job?.redeploy !== undefined && deployAgain.onDeployAgain(row.job.redeploy)
              }
              size="compact"
              variant="outline"
            >
              {flowVerbLabel("redeploy", deployAgain.running(row.job.redeploy.service))}
            </Button>
          )}
          {row.job.reason === undefined || row.job.reason === said ? null : (
            <span>{row.job.reason}</span>
          )}
        </span>
      )}
      {deployLog === undefined ? null : (
        <ZeropsDeployLog
          key={deployLog.jobId}
          projectId={projectId}
          service={row.hostname}
          target={deployLog}
        />
      )}
      {/* What it runs, where HQ did not make it run that: never overwritten, said here. */}
      {row.drift === undefined ? null : (
        <span
          className="flex min-w-0 flex-wrap items-center gap-2 pb-2 text-xs leading-4"
          data-zerops-surface="stop-service-drift"
        >
          <span className="text-status-attention-text">{row.drift.line}</span>
          {deployAgain === undefined || again === undefined ? null : (
            <Button
              disabled={deployAgain.running(again.service)}
              onClick={() => deployAgain.onDeployAgain(again)}
              size="compact"
              variant="outline"
            >
              {deployAgain.running(again.service)
                ? flowVerbLabel("redeploy", true)
                : `Deploy ${shortCommit(again.sha)} again`}
            </Button>
          )}
          {row.drift.zerops === undefined ? null : (
            <a
              className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              href={row.drift.zerops}
              rel="noreferrer"
              target="_blank"
            >
              Open in Zerops
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </a>
          )}
        </span>
      )}
    </li>
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
const EMPTY_MATE_NAMES: ReadonlyMap<string, string> = new Map();
const EMPTY_PULLS: ReadonlyArray<FlowPullRequest> = [];
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

/**
 * A project's one line under its name.
 *
 * It was the Gitea org — `Shop` over `shop` — which reads as the name repeated
 * with a typo. What is actually worth knowing at a glance is how much there is.
 */
function groupSubtitle(stops: number, changes: number): string {
  const stopPart = stops === 1 ? "1 environment" : `${String(stops)} environments`;
  const changePart = changes === 1 ? "1 change open" : `${String(changes)} changes open`;
  return `${stopPart} · ${changePart}`;
}

/** What *Release* is offered on a page, or that it is not offered at all. */
export interface ReleaseOffer {
  /** False where the stage has nothing the production lacks, or there is no production. */
  readonly offered: boolean;
  /** A release is on its way: its review shows how far it got. */
  readonly releasing: boolean;
  /** The version it would cut, where the flow suggested one. */
  readonly tag: string | undefined;
  /** Why it is not offered, as the flow's gate says; `undefined` while it is. */
  readonly reason: string | undefined;
  /** Opens the release's review from what was pressed: nothing is tagged from a page (R1). */
  readonly onReview: (from: HTMLElement) => void;
}

/**
 * The door to the next release's review, on the page that shows what is waiting for it.
 *
 * The menu row offered *Release* and the page the row expands to did not, so the one screen
 * listing three changes merged and not live was the one screen that could not put them live.
 * Now every door to it says *Review release* and opens the same review, which carries *Release*
 * and says what it does (pass 16, R1); while one is on its way the door opens its progress.
 */
function ReleaseAction({
  release,
  label = REVIEW_RELEASE_LABEL,
  size = "sm",
  variant,
}: {
  readonly release: ReleaseOffer;
  /** The door's words where the caller has them; *Review release* otherwise. */
  readonly label?: string;
  /** `compact` where it stands among the projects page's verbs. */
  readonly size?: "sm" | "compact";
  /** `outline` in a stop's verdict, where a verb stands beside the sentence it acts on. */
  readonly variant?: "outline";
}) {
  if (!release.offered && !release.releasing) return null;
  return (
    <Button
      data-zerops-primary-action={REVIEW_RELEASE_LABEL}
      onClick={(event) => {
        release.onReview(event.currentTarget);
      }}
      size={size}
      {...(variant === undefined ? {} : { variant })}
    >
      {release.releasing ? flowVerbLabel("release", true) : label}
    </Button>
  );
}

/** A section with nothing in it yet, and the way to put something there. */
function Empty({
  text,
  action,
  onAction,
}: {
  readonly text: string;
  readonly action: string;
  readonly onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Note>{text}</Note>
      <Button onClick={onAction} size="sm" variant="outline">
        {action}
      </Button>
    </div>
  );
}

/**
 * What the project needs somebody for, before anything else on the page.
 *
 * Not a Section: it is the answer, and an answer that looks like the four
 * blocks under it is an answer nobody reads first. It sits in a panel, above
 * the heading rhythm, and every row is the way to deal with the thing it
 * names.
 */
function AttentionPanel({
  items,
  onAct,
  release,
}: {
  readonly items: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
  /**
   * What *Release* would do, for the one item whose verb is not a way
   * somewhere. Without it that row drew a button with no target, and `onAct`
   * returned on the spot: the panel's only completing verb did nothing.
   */
  readonly release: ReleaseOffer;
}) {
  const [first] = items;
  if (first === undefined) {
    return (
      <p
        className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
        data-zerops-surface="project-attention-clear"
      >
        {PROJECT_ALL_CLEAR}
      </p>
    );
  }
  const worst = ATTENTION_TONE[first.kind];
  return (
    <ul
      // The edge wears the worst thing inside it, and the list is ordered
      // worst first. It used to be amber whatever it held, so a panel whose
      // only row was a blue *Release* still had a blocked change's border.
      className={cn("flex flex-col overflow-hidden rounded-lg border", VERDICT_BORDER_CLASS[worst])}
      data-zerops-surface="project-attention"
    >
      {items.map((item) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          key={`${item.kind}:${item.text}`}
        >
          <StatusDot
            className="min-w-0 text-sm text-foreground"
            label={item.text}
            sentence
            tone={ATTENTION_TONE[item.kind]}
          />
          {/* One column for the verbs: three buttons stacked with only
              `justify-end` between them landed on three different edges.
              `min-w`, not `w`: `See the build` is wider than `Open`. */}
          <span className="flex min-w-28 shrink-0 justify-end">
            {item.kind === "not-live" ? (
              // The release asks before it goes, so it brings its own confirm
              // rather than being a button that reports to `onAct`.
              <ReleaseAction release={release} />
            ) : item.verb === undefined ? null : (
              <Button
                onClick={() => {
                  onAct(item);
                }}
                size="sm"
                variant="outline"
              >
                {item.verb}
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A halted Mate and a failed deploy are not the same kind of bad — and work
 * merged and waiting is not bad at all.
 *
 * The list is ordered worst first, so the tones run down it as a ladder: red
 * broken, amber blocked, blue moving. *Release* wears the same blue in the
 * left menu; one fact does not get two colours depending on which surface
 * reports it.
 */
const ATTENTION_TONE: Record<ProjectAttentionKind, ServiceStatusToneId> = {
  "mate-waiting": "attention",
  "mate-failed": "failed",
  "deploy-failed": "failed",
  "change-blocked": "attention",
  "not-live": "busy",
};

/**
 * A Mate on the project as its page draws it: what it is on while a word of now says it — HQ's
 * live word or its socket's reading — and saying nothing otherwise, awake at rest while it runs as
 * its menu row reads it (`mateAwake`), else asleep. Its face is its row's
 * (`mateFaceOf`): needing you while it asks, or while its own change waits for your review — your
 * own Mate only; another's waits on its owner.
 */
export function groupMateOf(input: {
  readonly nowMs?: number;
  readonly item: ZeropsCandidate;
  /** What its menu row reads (`useMateRowActivity`). */
  readonly read: ZeropsAgentActivity | undefined;
  /** HQ's Mates, where its view is current (`hqMatesAtom`). */
  readonly mates?: ReadonlyMap<string, Pick<MateLiveView, "presence">> | null;
  readonly tint: MateTintId;
  readonly reviewWaits: boolean;
  /** Its Mate waits on the viewer, as HQ says it (`waitsOnViewer`). */
  readonly mine: boolean;
  readonly update: MateUpdateStatus | null | undefined;
}): GroupMate {
  const { item, tint, mine } = input;
  const live = activityOfNow(input.read);
  const connected = mateAwake(item, input.mates) || live !== undefined;
  const subject = live?.subject;
  return {
    projectId: item.project.id,
    name: projectNameInApp(item.project),
    tint,
    shape: mateShapeOf(item.project, tint),
    face: mateFaceOf({
      connected,
      activity: live,
      reviewWaits: input.reviewWaits,
      mine,
      pose: input.nowMs === undefined ? undefined : matePoseOf(item, input.nowMs),
    }),
    asks: mine && mateFaceFor(connected, live) === "needs",
    ...(live?.kind === "failed" ? { failed: true } : {}),
    subject,
    snippet: subject === undefined ? undefined : live?.snippet,
    when:
      live === undefined || subject === undefined
        ? undefined
        : compactSidebarTimeLabel(formatRelativeTimeLabel(live.at)),
    update: input.update,
  };
}

export interface GroupMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  /**
   * Its conversation waits on an answer — what *waiting on an answer* lists. A change waiting
   * for review wears the same face and is the change's own item, never an answer.
   */
  readonly asks?: boolean;
  /** Its last run stopped on an error: its face reads `needs`, and it asks nothing. */
  readonly failed?: boolean;
  /** What it is on, or was last on; absent until somebody has spoken to it. */
  readonly subject: string | undefined;
  readonly snippet: string | undefined;
  readonly when: string | undefined;
  /** What its menu's check or update is doing, said over its subject until it settles. */
  readonly update?: MateUpdateStatus | null | undefined;
}

/**
 * Who is working on this project.
 *
 * The page listed environments, changes and commits and not one of the Mates
 * that made them — on a product whose whole proposition is that Mates do the
 * work (the owner, 2026-09-19: "it's basically a group dashboard and you
 * didn't think to show a preview of mates"). It is the first section because
 * it answers the first question anybody opens this page with.
 *
 * The same three lines the menu gives a Mate, at the page's size: the face
 * wearing its state, what it is on, and the last thing it said.
 */
function MateLine({
  mate,
  menu,
  onOpen,
}: {
  readonly mate: GroupMate;
  /** This Mate's own quiet actions — the same set the projects screen offers. */
  readonly menu?: React.ReactNode;
  readonly onOpen: (projectId: string) => void;
}) {
  return (
    // The row is a control and the menu is another: a button inside a button
    // is not a thing, so they sit side by side and the row keeps the hover.
    <li className="group/row flex min-w-0 items-center gap-1">
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={() => {
          onOpen(mate.projectId);
        }}
        type="button"
      >
        <MateFace shape={mate.shape} size="md" state={mate.face} tint={mate.tint} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">
              {mate.name}
            </span>
            {mate.when === undefined || mate.when.length === 0 ? null : (
              <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">
                {mate.when}
              </span>
            )}
          </span>
          {mate.update !== null && mate.update !== undefined ? (
            <MateUpdateStatusText
              className="text-xs leading-4 text-muted-foreground"
              status={mate.update}
            />
          ) : mate.subject === undefined ? (
            <span className="truncate text-xs leading-4 text-muted-foreground/70">
              Nothing asked of it yet
            </span>
          ) : (
            <span className="truncate text-xs leading-4 text-muted-foreground">{mate.subject}</span>
          )}
          {mate.snippet === undefined ? null : (
            <span className="truncate text-xs leading-4 text-muted-foreground/70">
              {mate.snippet}
            </span>
          )}
        </span>
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      {menu === undefined ? null : <span className="shrink-0">{menu}</span>}
    </li>
  );
}

/** A stop's version column shares its page's runtime answer, including a failure or wait. */
function stopLineVersion(deployment: Shown<Deployment> | undefined, row: EnvironmentRow): string {
  return stopView({ deployment: deployment ?? UNREAD_DEPLOYMENT, row, nowMs: 0 }).line;
}

function StopLine({
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
  const deployments = useZeropsProjectFlowOptional()?.deployments;
  // The one rule every surface words a stop by (`stopTone`), with the platform's answer beside it.
  const deployment = deployments?.get(environment.projectId);
  const tone = stopTone(deployment, environment);
  // No word for what runs and a first deploy asked for: the line its cell and its page say.
  const said = deployWord(tone);
  const firstWord = said === undefined ? firstDeployLine(firstDeploy) : undefined;
  const word = said ?? firstWord;
  const dotTone = firstWord === undefined ? STOP_DOT_TONE[tone] : firstDeployTone(firstDeploy);
  const open = useCallback(() => {
    void navigate({
      to: "/group/$groupId/$projectId",
      params: { groupId, projectId: environment.projectId },
    });
  }, [environment.projectId, groupId, navigate]);
  if (notice !== null) {
    return (
      <li className="flex min-w-0 items-baseline gap-3 px-2 py-2">
        <span className="shrink-0 text-sm font-medium text-foreground">{environment.tier}</span>
        <span className="truncate text-xs text-muted-foreground">{notice}</span>
        <StopReadAgain projectId={environment.projectId} />
      </li>
    );
  }
  return (
    <li>
      <button
        // Fixed tracks, not a right-ragged flex: a version and a state that
        // start at a different x on every row cannot be read down the column.
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_6rem_7.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {environment.name}
        </span>
        <span className="truncate text-end font-mono text-xs text-muted-foreground tabular-nums">
          {stopLineVersion(deployment, environment)}
        </span>
        {/* Never a wordless dot on its own: a colour that has to be learnt is
            a colour nobody reads, and a screen reader gets nothing from it. */}
        {/* The dot carries the state; the word supports it. Unsized, it
            inherited 16px and came out larger than the name it annotates. */}
        {word === undefined || dotTone === undefined ? null : (
          <StatusDot
            className="shrink-0 text-xs text-muted-foreground"
            label={word}
            sentence
            tone={dotTone}
          />
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      <StopReadAgain projectId={environment.projectId} />
    </li>
  );
}

function ChangeLine({
  groupId,
  pull,
  among,
}: {
  readonly groupId: string;
  /** The project's open changes: a Mate's in two repositories name theirs. */
  readonly among: ReadonlyArray<FlowPullRequest>;
  readonly pull: FlowPullRequest;
}) {
  const navigate = useNavigate();
  // One vocabulary down the column: `changeState` answers a rebase and a
  // passing check in the same register, which two sources did not.
  const state = changeState(pull);
  // The group page is where somebody comes looking for a change, so its rows
  // open one — a stop's row next to it has always been a door.
  const open = useCallback(() => {
    void navigate({
      to: "/change/$groupId/$repository/$number",
      params: { groupId, repository: pull.repository, number: String(pull.number) },
    });
  }, [groupId, navigate, pull.number, pull.repository]);
  return (
    <li>
      <button
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_7.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        <span className="min-w-0 truncate text-sm text-foreground">
          {sidebarChangeLabel(pull, among)}
        </span>
        {state === undefined ? null : (
          <StatusDot
            className="shrink-0 text-xs text-muted-foreground"
            label={state.word}
            sentence
            tone={state.tone}
          />
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

/** One step of the trail above a page's name. */
export interface Crumb {
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * A detail page whose flow is not read yet: the boot's wait line past its beat while the app reads
 * it, and its own words where nothing will (`unreadFlowWords`) — HQ is unavailable, a project not here any more, or reads that failed.
 */
function UnreadDetail({ groupId }: { readonly groupId: string }) {
  const flowValue = useZeropsProjectFlowOptional();
  const words =
    flowValue === null
      ? null
      : unreadFlowWords({
          failure: flowValue.readFailure,
          groupsRead: flowValue.groupsRead === true,
          groupKnown: flowValue.knownGroups?.has(groupId) === true,
        });
  if (words !== null) return <Note>{words}</Note>;
  return <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="mount" text={READING_PROJECTS_LINE} />;
}

function DetailShell({
  title,
  titleTag,
  subtitle,
  actions,
  crumbs,
  children,
}: {
  /** Undefined while the name is not read: its line is held, with no placeholder in it. */
  readonly title: string | undefined;
  /** What kind of thing the page is about, as a pill trailing its name. */
  readonly titleTag?: React.ReactNode;
  readonly subtitle?: string;
  /** The verbs this page carries, beside its name rather than under it. */
  readonly actions?: React.ReactNode;
  /**
   * Where this page sits, outermost first. A stop used to offer only "back to
   * the conversation", so reaching its project meant leaving through the chat
   * and coming in again.
   */
  readonly crumbs: ReadonlyArray<Crumb>;
  readonly children: React.ReactNode;
}) {
  return (
    <ZeropsHostedFrame
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
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
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
            <button
              className="min-w-0 cursor-pointer truncate hover:text-foreground"
              onClick={crumb.onClick}
              type="button"
            >
              {crumb.label}
            </button>
          </WorkspaceBreadcrumbItem>
        </Fragment>
      ))}
    </WorkspaceBreadcrumb>
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

/**
 * What a section drawn from the listing says in place of a "none" it may not
 * say yet: its message, after the delay that keeps a quick answer from
 * flickering it, and its one affordance.
 */
function ListingNotice({
  notice,
  onAct,
}: {
  readonly notice: CandidatesNotice;
  readonly onAct?: ((affordance: KnownAffordance) => void) | undefined;
}) {
  const { affordance, message } = notice;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3",
        message.afterMs > 0 && "animate-zerops-appear",
      )}
      role={notice.region === "message" ? "alert" : "status"}
      style={message.afterMs > 0 ? { animationDelay: `${message.afterMs}ms` } : undefined}
    >
      <p
        className={cn(
          "text-sm",
          message.tone === "alert"
            ? "text-[var(--zerops-status-failed-text)]"
            : "text-muted-foreground",
        )}
      >
        {message.text}
      </p>
      {affordance === null || onAct === undefined ? null : (
        <Button onClick={() => onAct(affordance)} size="sm" variant="outline">
          {affordance.label}
        </Button>
      )}
    </div>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ProjectReadFailures({
  recipe,
  comparison,
}: {
  readonly recipe: ReturnType<typeof useZeropsRecipeFailure>;
  readonly comparison: ZeropsProjectFlow["release"]["comparisonFailure"];
}) {
  return (
    <>
      {recipe === undefined ? null : <ZeropsReadFailure action="Read recipe again" {...recipe} />}
      {comparison === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...comparison} />
      )}
    </>
  );
}
