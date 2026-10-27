import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { useAddMateOffer } from "../../zerops/useHqOffers";
import { useNewMateGate } from "../../zerops/useNewMateGates";
import { placementNotice } from "./projects/placementNotice.logic";
import { overviewPaints, tiersAddable } from "./projects/projectsView.logic";
import { useGitEnvironmentFormInputs } from "~/zerops/useGitEnvironmentFormInputs";
import { isChief } from "~/zerops/chief";
import { roleOffers } from "@t3tools/client-runtime/data";
import { usePlatformCapabilities, useRoleOffers } from "~/zerops/usePlatformCapabilities";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useProjectsPageRows } from "~/zerops/projectsPageRows";
import { useProjectsInventory } from "~/zerops/projectsInventory";
import { removeFailedZeropsProject } from "./removeFailedZeropsProject";
import { creationHandoff } from "@t3tools/client-runtime/data";

import { RestartMateWarning } from "~/zerops/RestartMateConfirmation";
import { ZeropsDeletionRecovery } from "./ZeropsDeletionRecovery";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useMateUpgradeRecovery, type UpgradeRecovery } from "~/zerops/useMateUpgradeRecovery";
/**
 * `/zerops` — the project picker for a signed-in Zerops account: an existing
 * candidate to connect to or wait on, and a way to New project (also where an
 * exhausted pool falls back to, since that phase has nothing ready-made to
 * pick). Creating a project happens in its dialog over this page
 * (`ZeropsNewProjectHost`), not here.
 */

import { useAtomValue } from "@effect/atom-react";
import * as DateTime from "effect/DateTime";
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MateMarkState } from "@t3tools/shared/brand";
import { PlayIcon, PlusIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { shownHqPersonFactsAtom, shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { useSidebarWaiting } from "~/zerops/useSidebarWaiting";
import { useEnvironmentOffers } from "~/zerops/useAddEnvironment";
import { hqDown, hqPlacementsAtom, hqPlacementStatusAtom } from "~/state/zerops";
import { useProjectOrderOptions } from "~/zerops/projectOrderPreference";
import {
  applyFirstBuildVerdict,
  firstBuildOverdue,
  applyProjectCreationVerdict,
  normalizeOrigin,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  resolveMateVisibility,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  deployBuilding,
  deployRuns,
  NOTHING_DEPLOYED,
  stopTone,
  type Deployment,
} from "@t3tools/client-runtime/zerops/flow";
import {
  knownPresentation,
  type KnownAffordance,
  type KnownMessage,
  type KnownPresentation,
  type KnownSurface,
  type Shown,
} from "@t3tools/client-runtime/zerops/knowledge";
import { heldCandidates, listsNoProject } from "@t3tools/client-runtime/zerops/projections";
import { deriveProvisioningStart } from "@t3tools/client-runtime/zerops/registrationHandoff";
import { useAddMate } from "~/zerops/newMate";
import { useSetUpEnvironment } from "~/zerops/setUpEnvironment";
import {
  environmentDoorLabel,
  PUT_LIVE_AFTER_CREATION,
  putLiveHoldsRelease,
} from "~/zerops/putLive.logic";
import { useOpenPutLive, usePutLive } from "~/zerops/putLive";
import { askNewProject } from "~/zerops/newProjectAsk";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useConnectMate, type MateConnectTarget } from "~/zerops/accountEnvironments";
import { intendContainer, useZeropsContainers } from "~/zerops/zeropsContainers";
import { useDeleteProject } from "~/zerops/deleteProject";
import { useRestartMate } from "~/zerops/mateRestart";
import {
  birthPresses,
  beginPress,
  finishMateSetup,
  forgetPress,
  matePressPlacement,
  pressFailureLine,
  pressSince,
  placedPressesIn,
  mateFinishRegistration,
  readMatePress,
  useMatePresses,
  type MatePress,
} from "~/zerops/matePress";
import { useCreations } from "~/zerops/creations";
import { placedNewProjects } from "~/zerops/newProjectBirth";
import {
  useTakenBotNames,
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "~/zerops/useZeropsCandidates";
import { useZeropsSession, type ZeropsSessionStatus } from "~/zerops/ZeropsSessionProvider";
import { withheldProjectNotices } from "~/zerops/inventoryContext";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { useProjectCreations } from "~/zerops/useProjectCreations";
import { useZeropsFirstBuilds } from "~/zerops/useZeropsFirstBuilds";
import { drawnMateProjects, useVisibleProjectAccess } from "~/zerops/useVisibleProjectAccess";
import { useNowMs } from "~/zerops/useNowMs";
import { mateUpdateStatus } from "~/zerops/mateUpdate";
import { useMateUpdateStates } from "~/zerops/useMateUpdate";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useZeropsData } from "~/zerops/zeropsDataContext";
import { submitZeropsWrite } from "~/zerops/zeropsWrite";
import type { AuthGateState } from "~/environments/primary/auth";
import {
  activityOfNow,
  listedMateFace,
  mateReviewWaits,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { mateAutomation } from "./SidebarMateRow.logic";
import type { ZeropsRowPresentation } from "./ZeropsProjectRow.logic";

import {
  assignCandidateMateTints,
  mateShapeOf,
  newMateTint,
  deployWord,
  readZeropsToolKind,
  defaultAgentForRole,
  hasMate,
  type FlowPullRequest,
  type GroupFlowPreview,
  projectNameInApp,
  readZeropsMembership,
  type EnvironmentCreationStepProgress,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type GroupEnvironmentTier,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsMembership,
  firstDeployLine,
  type FirstDeploy,
  matePoseOf,
  zeropsProjectOf,
} from "@t3tools/client-runtime/zerops";
import { invalidateZerops } from "~/zerops/accountInvalidations";

import { MateFace, STATUS_BADGE_TONE } from "./primitives";
import { useOverviewSlots } from "./projects/overviewSlots";
import { ProductionRun } from "./ProductionRun";
import { putLiveHasChange } from "./projects/projectCard.logic";
import { OverviewCardMate } from "./projects/OverviewCardMate";
import { ArrivalWelcome } from "./projects/ArrivalWelcome";
import { signInSettled } from "./projects/arrival.logic";
import { stopLinkOf, ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsMateBirthLine } from "./ZeropsBirthProgress";
import { ZeropsHqCard } from "./ZeropsHqCard";
import { ZeropsMateCard, ZeropsMateVerb } from "./ZeropsMateCard";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { MateUpdateStatusText } from "./MateUpdateLine";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  useMateComingOf,
  useMateConversationsRead,
  useMateRowActivity,
  useMatesLinkedInHq,
} from "~/zerops/useMenuMateReadings";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import {
  creationNow,
  creationSettled,
  ZeropsEnvironmentCreation,
} from "./ZeropsEnvironmentCreation";
import { Failure } from "../ui/failure";
import {
  ZeropsEnvironmentCreationDialog,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import {
  creationRecipe,
  newMateRecipeChange,
  proposedEnvironmentName,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { ZeropsCreditForecast } from "./ZeropsCreditForecast";
import { ZeropsProjectMenu, type ZeropsMenuAction } from "./ZeropsProjectMenu";
import { GitMirrorDialog } from "./GitMirrorDialog";
import { ProjectAccessDraft, roleProjectKind, WithDraftPeople } from "./projects/ProjectPeople";
import { ZeropsDeleteProjectDialog } from "./ZeropsDeleteProjectDialog";
import { ZeropsProjectRenameMenu } from "./ZeropsProjectRenameMenu";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useHqOffers, useMateOffers, useOrgOffers } from "~/zerops/useHqOffers";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { officialHq, useAccountHq } from "~/zerops/accountHq";
import { useEnvironmentSetup } from "~/zerops/useEnvironmentSetup";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import {
  useCompactProjectFlows,
  useProjectFlows,
  useStopDeploymentsShown,
} from "~/zerops/projectFlows";
import { REVIEW_RELEASE_LABEL, useOpenReview } from "~/zerops/review";
import { useReadGroupAgents } from "~/zerops/groupAgents";
import { deployRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsSetUpMateDialog } from "./ZeropsSetUpMateDialog";

import { ZeropsReleaseVerb } from "./ZeropsReleaseVerb";

import { environmentRoleLabel, environmentRoleTag, groupNameUnread } from "./ZeropsGroupTree.logic";
import {
  ZeropsProjectsFlow,
  type ProjectPageSlot,
  type ProjectsFlowGroup,
} from "./projects/ZeropsProjectsFlow";
import {
  overviewKeeps,
  parseProjectsSearch,
  withoutOfficialHq,
  shownUngrouped,
  type OverviewShow,
  type ProjectsSearch,
} from "./projects/projectsView.logic";
import { OverviewFilterEmpty, OverviewFilters } from "./projects/OverviewFilters";
import { OverviewCardsStandIn, OverviewStandInBody } from "./projects/OverviewStandIn";
import { applicationContents, groupIsEmpty } from "./projects/emptyApps.logic";
import { projectDeleteActions } from "./projects/projectDelete";
import {
  type ZeropsRowAction,
  type ZeropsRowInput,
  connectFailureLine,
  deriveZeropsRowAction,
  setUpMateVerb,
  mateOutsideHq,
  deriveZeropsRowPresentation,
  environmentSummaryLine,
  groupAddsOffered,
  isZeropsToolCandidate,
  mateRowCan,
  plainEvidenceOf,
} from "./ZeropsProjectRow.logic";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { useMenuRows, usePaintStanding } from "~/zerops/useMenuRows";
import { Badge } from "~/components/ui/badge";

/** One creation in flight, or just finished, on this screen. */
interface EnvironmentCreationView {
  /** The project it is created in. */
  readonly groupId: string;
  readonly name: string;
  /** What was asked for, so the closing line knows where a first deploy comes from. */
  readonly tier: NonNullable<React.ComponentProps<typeof ZeropsEnvironmentCreation>["tier"]>;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly outcome?: NonNullable<React.ComponentProps<typeof ZeropsEnvironmentCreation>["outcome"]>;
}

/**
 * Whether the project a finished creation made runs or builds something now, as the platform says
 * it: its done card then leaves what runs there to the place's own line.
 */
/** The set-up card's place runs at its address: its line on the card says the rest. */
function creationRunsAtAddress(
  creation: EnvironmentCreationView,
  deployments: ReadonlyMap<string, Shown<Deployment>>,
  groups: ReadonlyArray<{
    readonly environments: ReadonlyArray<{
      readonly item?:
        | { readonly project: { readonly id: string }; readonly routes?: ReadonlyArray<unknown> }
        | undefined;
    }>;
  }>,
): boolean {
  const projectId = creation.outcome?.kind === "done" ? creation.outcome.projectId : undefined;
  if (projectId === undefined) return false;
  const item = groups
    .flatMap((group) => group.environments)
    .find((environment) => environment.item?.project.id === projectId)?.item;
  return creationSettled({
    outcome: creation.outcome?.kind,
    runs: deployRuns(deployments.get(projectId)),
    addressed: (item?.routes?.length ?? 0) > 0,
  });
}

function creationDeployed(
  creation: EnvironmentCreationView,
  deployments: ReadonlyMap<string, Shown<Deployment>>,
): boolean {
  if (creation.outcome?.kind !== "done" || creation.outcome.projectId === undefined) return false;
  const shown = deployments.get(creation.outcome.projectId);
  return deployRuns(shown) || deployBuilding(shown) !== undefined;
}

export function autoConnectServedZeropsEnvironment(input: {
  readonly attempted: { current: boolean };
  readonly status: ZeropsSessionStatus;
  readonly zeropsToken: string | null;
  readonly appOrigin: string;
  readonly authGate: AuthGateState;
  readonly candidates: ReadonlyArray<{
    readonly group: ZeropsCandidate["group"];
    readonly containerOrigin?: string;
    readonly connection?: { readonly phase: EnvironmentConnectionPhase };
  }>;
  readonly connect: (containerOrigin: string) => void;
}): void {
  if (
    input.attempted.current ||
    input.status !== "signed-in" ||
    !input.zeropsToken ||
    input.authGate.status !== "requires-auth" ||
    // The throwaway door, which is the only one this client presents at.
    !input.authGate.auth.bootstrapMethods.includes("zerops-throwaway")
  ) {
    return;
  }
  const appOrigin = normalizeOrigin(input.appOrigin);
  const servedCandidate = input.candidates.find(
    (candidate) =>
      candidate.containerOrigin !== undefined &&
      normalizeOrigin(candidate.containerOrigin) === appOrigin,
  );
  if (
    appOrigin === null ||
    servedCandidate === undefined ||
    servedCandidate.group === "connected" ||
    servedCandidate.connection !== undefined
  ) {
    return;
  }

  input.attempted.current = true;
  input.connect(appOrigin);
}

/**
 * A row's re-probe (DESIGN §6.2): its container is read again. The platform
 * pushes a status change itself; a row without a container has nothing to read.
 */
export function readContainerAgain(candidate: {
  readonly project: { readonly id: string };
  readonly service?: { readonly id: string } | undefined;
}): void {
  if (candidate.service === undefined) return;
  invalidateZerops({
    topic: "container",
    target: `${candidate.project.id}:${candidate.service.id}`,
  });
}

/** A row's start or restart: once the platform accepts the write, its container is read again. */
export function readContainerAfter(
  candidate: Parameters<typeof readContainerAgain>[0],
  write: Promise<unknown>,
): Promise<void> {
  return write.then(() => readContainerAgain(candidate));
}

export function retryZeropsProjectConnection(input: {
  readonly connectError: string | null;
  readonly readyOrigin: string | null;
  readonly retryIdentity: (containerOrigin: string) => void;
  readonly retryProvisioning: () => void;
}): void {
  if (input.connectError !== null && input.readyOrigin !== null) {
    input.retryIdentity(input.readyOrigin);
    return;
  }
  input.retryProvisioning();
}

/**
 * Whether a Mate's card shows its birth checklist: only while it is being born
 * — a press of this tab for its project. Opening a Mate that exists also
 * runs a wait and a connect, and the checklist then flashed on every click,
 * "Opening the Mate" with a clock counting from the project's creation (28 min
 * on a day-old Mate, 2026-09-22); there the face carries the boot.
 */
export function showsZeropsBirthLine(input: {
  readonly projectId: string;
  readonly birthProjectIds: ReadonlySet<string>;
}): boolean {
  return input.birthProjectIds.has(input.projectId);
}

/**
 * Whether this account has no project to show — the state the projects screen
 * answers with an invitation rather than a list.
 *
 * A tool is not a project (`tools.ts`), so an account holding nothing but
 * Gitea has still not started. Two readers ask: the header, which drops its
 * create button so the invitation is not said twice, and the flow views, which
 * carries the invitation. Both must agree, and neither may answer from a list
 * that is not known and complete (DESIGN M5) — an invitation that paints for a
 * second and is then replaced by the roster is a shift the reader has to undo.
 * A re-read is not that: the list already read answers while it runs.
 */
export function hasNoZeropsProject(input: {
  readonly listing: Shown<ReadonlyArray<ZeropsCandidate>>;
  /**
   * A birth of this account (`zeropsBirths.ts`). The wizard navigates here the
   * moment the project exists, before the inventory lists it — painting the
   * invitation in that gap is the flash the roster then takes back.
   */
  readonly creationPending?: boolean;
  /** The organization's official HQ's project (`withoutOfficialHq`), where the anchor names it. */
  readonly hqProjectId?: string | undefined;
}): boolean {
  if (input.creationPending === true) return false;
  // A tool is not a project: the tree lists it apart (`partitionZeropsToolProjects`). Nor is HQ's
  // own project: an organization holding only HQ has nothing of its own to start in yet.
  return listsNoProject(
    input.listing,
    (candidate) =>
      readZeropsToolKind(candidate.project) === undefined &&
      candidate.project.id !== input.hqProjectId,
  );
}

const PROJECTS_SURFACE: KnownSurface<ReadonlyArray<ZeropsCandidate>> = {
  subject: "your projects",
  entity: "project",
  source: "zerops",
  checking: "Reading your projects…",
  negative: null,
};

export interface ProjectsListingNotice {
  readonly region: KnownPresentation["region"];
  readonly message: KnownMessage;
  readonly affordance: KnownAffordance | null;
}

/**
 * What the page says about the projects it does not hold in full (DESIGN
 * §3.4): a placeholder while they are unread or being read, the cause when the
 * read failed, "Still reading…" over a partial list, and nothing over a
 * current complete one, nor over one a lapse withholds, which the app's one banner
 * names. Copy, delay and affordance are `knownPresentation`'s.
 */
export function projectsListingNotice(
  listing: Shown<ReadonlyArray<ZeropsCandidate>>,
  nowMs: number,
): ProjectsListingNotice | null {
  if (
    listing.state === "known" &&
    listing.coverage === "complete" &&
    (listing.freshness.kind === "live" || listing.freshness.kind === "settled")
  )
    return null;
  const presentation = knownPresentation(listing, PROJECTS_SURFACE, {
    nowMs,
    updateOffered: false,
    ...(listing.state === "known" &&
    listing.freshness.kind === "stale" &&
    listing.freshness.reason.kind === "source-recovering" &&
    listing.freshness.reason.coverageGap
      ? {
          asOfTime: DateTime.formatLocal(DateTime.makeUnsafe(listing.asOf.atMs), {
            timeStyle: "medium",
          }),
        }
      : {}),
  });
  if (presentation.message === null) return null;
  return {
    region: presentation.region,
    message: presentation.message,
    affordance: presentation.affordance,
  };
}

/**
 * What the title's row says of the list's freshness, where the list stands and is being read again,
 * not wholly read, or held from an earlier read: "Updating…" and its kin, with their retry. Syncing
 * is a small spinner on the title's row, never a line over the cards that pushes them down while it
 * stands and up when it goes (the cards jumped 40 px on every load). Nothing read yet, or a failed
 * read, is the page's own line (`projectsListingNotice`'s placeholder and message).
 */
export function projectsFreshnessNotice(
  listing: Shown<ReadonlyArray<ZeropsCandidate>>,
  nowMs: number,
): ProjectsListingNotice | null {
  const notice = projectsListingNotice(listing, nowMs);
  return notice?.region === "value" ? notice : null;
}

/**
 * What the page says of the account's trouble, in one voice (R-K2, R-K3): the
 * inventory's lasting trouble is the account line's at the menu's foot, with
 * its Try now, so the page repeats none of it. Rows it holds stand as they are;
 * with none to show while the trouble lasts, the page's own empty words take
 * the place of the listing's failed read, with no retry of their own. A
 * connect failure is another region's and always stands.
 */
export function projectsTroubleView(input: {
  readonly connectError: string | null;
  readonly inventoryError: string | null;
  readonly listingNotice: ProjectsListingNotice | null;
  readonly rows: number;
}): {
  readonly alert: string | null;
  readonly listingNotice: ProjectsListingNotice | null;
  readonly empty: string | null;
} {
  const spoken = input.inventoryError !== null;
  const failed = input.listingNotice?.region === "message";
  const empty = spoken && input.rows === 0;
  return {
    alert: input.connectError,
    // The empty words replace the listing's own line, its reading placeholder included: one says it.
    listingNotice: spoken && (failed || empty) ? null : input.listingNotice,
    empty: empty ? PROJECTS_WAIT_FOR_ZEROPS : null,
  };
}

const PROJECTS_WAIT_FOR_ZEROPS = "Your projects will show here once Zerops answers.";

/**
 * What a declared stage or production says in its row's middle. With
 * something deployed that is its source and version (`main · e014b0e`); with
 * nothing yet, a bare source (`release`) reads as a stray word, so the row
 * says it runs nothing. A first deploy on its way keeps its source: the
 * status beside it already says *Deploying*.
 */
export function declaredEnvironmentSummary(
  row: Pick<EnvironmentRow, "line" | "tone" | "version">,
  /** A stage that runs nothing: where its first deploy stands, as its cell says it. */
  firstDeploy?: FirstDeploy | undefined,
): string {
  if (row.version.label === undefined && firstDeploy !== undefined)
    return firstDeployLine(firstDeploy) ?? row.line;
  return row.version.label === undefined && row.tone === "neutral"
    ? (firstDeployLine(firstDeploy) ?? NOTHING_DEPLOYED)
    : row.line;
}

/**
 * The one line a group says about itself, in its own row: that its name could
 * not be read, or where a stage or production stands whose setup is not finished —
 * being finished, finished in vain, or waiting for the person's *Finish setting
 * up* (audit R2: the page never finishes one by itself). A finish's failure is
 * the group's to show, in the page's words — the platform's own message is not
 * the person's to read, and a line under the page is nobody's.
 */
export function projectsGroupLine(input: {
  readonly placeholder: boolean;
  /** Its environment whose last finish did not go through. */
  readonly unfinished: GroupEnvironmentTier | undefined;
  /** Its environment being finished now. */
  readonly finishing: GroupEnvironmentTier | undefined;
  /** Its environment whose setup is not finished. */
  readonly halfMade: GroupEnvironmentTier | undefined;
  /**
   * Its environment this page is setting up now: not finished because it is under way, which its
   * place on the card says (the onboarding run flashed "isn't finished" for 0.7 s at the press).
   */
  readonly creating?: GroupEnvironmentTier | undefined;
}): string | undefined {
  if (input.placeholder) return "Couldn't read this project's name";
  if (input.finishing !== undefined) return `Finishing ${input.finishing}…`;
  if (input.unfinished !== undefined) return `Couldn't finish setting up ${input.unfinished}`;
  if (input.halfMade !== undefined && input.halfMade !== input.creating)
    return `Setting up ${input.halfMade} isn't finished`;
  return undefined;
}

/**
 * The environment a creation on this page covers on its project's line: while it runs, and once it
 * went through until the setup read stops calling it half made (`settled`).
 */
export function creationCovers(
  creation: {
    readonly groupId: string;
    readonly tier: EnvironmentCreationView["tier"];
    readonly outcome?: EnvironmentCreationView["outcome"] | undefined;
  } | null,
  settled: { readonly groupId: string; readonly tier: GroupEnvironmentTier } | null,
  groupId: string,
): GroupEnvironmentTier | undefined {
  if (settled !== null && settled.groupId === groupId) return settled.tier;
  if (creation === null || creation.groupId !== groupId || creation.tier === "mate")
    return undefined;
  return creation.outcome === undefined ? creation.tier : undefined;
}

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/**
 * The overview's title row: "Overview", the list's freshness beside it while it is read again
 * (`projectsFreshnessNotice`), and New project on its end. The list keeps itself current.
 */
export function ZeropsProjectsHeader({
  newProject = true,
  notice = null,
  onRetry,
}: {
  /** New project, where the viewer's role creates projects (`roleOffers`). */
  readonly newProject?: boolean;
  readonly notice?: ProjectsListingNotice | null;
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    // Its row stands on the menu's logo row, centre to centre, not a bar's height below it.
    <div
      className="-mt-1.5 flex items-center justify-between gap-3"
      data-zerops-project-scope="true"
    >
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="text-xl font-medium text-foreground">Overview</h1>
        {notice === null ? null : <ProjectsFreshness notice={notice} onRetry={onRetry} />}
      </div>
      <div className="flex items-center gap-2">
        {newProject ? (
          <Button onClick={askNewProject} size="sm" variant="secondary">
            <PlusIcon />
            New project
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The list's freshness on the title's row: a small spinner, its words, and its retry. */
function ProjectsFreshness({
  notice,
  onRetry,
}: {
  readonly notice: ProjectsListingNotice;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        // It waits a beat before it says anything, so a quick answer never flickers it.
        notice.message.afterMs > 0 && "animate-zerops-appear",
      )}
      role="status"
      style={
        notice.message.afterMs > 0 ? { animationDelay: `${notice.message.afterMs}ms` } : undefined
      }
    >
      <Spinner size="sm" />
      <span>{notice.message.text}</span>
      {notice.affordance == null || onRetry === undefined ? null : (
        <Button onClick={onRetry} size="sm" variant="secondary">
          {notice.affordance.label}
        </Button>
      )}
    </div>
  );
}

/** A Mate that exists, which a person asked to open. */
interface OpeningTarget {
  readonly key: string;
  readonly projectId: string;
  readonly origin: string;
  readonly organizationId: string | null;
}

/**
 * The connect machinery of this page: the Mate a person asked to open, connected once its
 * container answers ready, landing the person in the conversation. A Mate this tab pressed is
 * connected by its coming view once it answers, and that success lands them there all the same.
 */
export function useZeropsProjectConnection(): {
  readonly presses: ReadonlyArray<MatePress>;
  readonly opening: OpeningTarget | null;
  /** Opens a Mate that exists. */
  readonly open: (candidate: ZeropsCandidate) => void;
  readonly upgradeRecovery: UpgradeRecovery | null;
  readonly serverVersion: string | undefined;
  readonly connectError: string | null;
  readonly setConnectError: (error: string | null) => void;
  readonly connectingOrigin: string | null;
  /** The container whose connect failed last; its row carries the failure. */
  readonly failedOrigin: string | null;
  readonly retryProjectConnection: () => void;
  readonly connectContainer: (containerOrigin: string) => Promise<void>;
  /**
   * Ends a birth or an opening on an admitted environment, from wherever it was admitted: this
   * hook's own `connectContainer`, or a late success this page only observed (another view's
   * Connect reached the door first). The organization it was made in is read again, and the person lands
   * in the conversation — exactly what a successful `connectContainer` always does.
   */
  readonly finishBirth: (
    environmentId: EnvironmentId,
    organizationId: string | null,
  ) => Promise<void>;
} {
  const presses = useMatePresses();
  const { health } = useZeropsContainers();
  const { organizationRef } = useZeropsData();
  const { activeOrganization } = useZeropsSession();
  const exchangeZeropsIdentity = useConnectMate("user");
  const navigate = useNavigate();
  const [opening, setOpening] = useState<OpeningTarget | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | undefined>();
  const [upgradeOrigin, setUpgradeOrigin] = useState<string | null>(null);
  const [connectingOrigin, setConnectingOrigin] = useState<string | null>(null);
  /** The container whose connect failed: "Try again" connects it again. */
  const [failedOrigin, setFailedOrigin] = useState<string | null>(null);
  // What the connect reads without re-creating itself on every render.
  const openingRef = useRef(opening);
  useEffect(() => {
    openingRef.current = opening;
  }, [opening]);
  const openedRef = useRef<OpeningTarget | null>(null);

  const finishBirth = useCallback(
    async (environmentId: EnvironmentId, organizationId: string | null) => {
      // The environment is real now. When the lists last read it — right
      // after the creation writes — the project was still NEW with no
      // container, which the left menu rightly leaves out; here it is ACTIVE
      // with a zcp, so its organization's inventory is read again and the row
      // appears.
      if (organizationId !== null) {
        invalidateZerops({ topic: "inventory", organization: organizationRef(organizationId) });
      }
      setOpening(null);
      setConnectError(null);
      await navigate({ to: "/", search: { environmentId: String(environmentId) } });
    },
    [navigate, organizationRef],
  );

  /** The organization the connected container's opening was in. */
  const organizationOf = useCallback((containerOrigin: string): string | null => {
    const origin = normalizeOrigin(containerOrigin);
    const target = openingRef.current;
    return target !== null && normalizeOrigin(target.origin) === origin
      ? target.organizationId
      : null;
  }, []);

  /** What a connect of this container names: its origin, with the organization of its opening. */
  const targetOf = useCallback(
    (containerOrigin: string): MateConnectTarget => {
      const organizationId = organizationOf(containerOrigin);
      return {
        origin: containerOrigin,
        organization: organizationId === null ? null : organizationRef(organizationId),
      };
    },
    [organizationOf, organizationRef],
  );

  const connectContainer = useCallback(
    async (containerOrigin: string) => {
      setConnectError(null);
      setUpgradeOrigin(null);
      setServerVersion(undefined);
      setConnectingOrigin(containerOrigin);
      try {
        const result = await exchangeZeropsIdentity(targetOf(containerOrigin));
        if (result._tag === "Failure") {
          setFailedOrigin(containerOrigin);
          setConnectError(result.error);
          setServerVersion(result.serverVersion);
          setUpgradeOrigin(result.upgradeRequired ? containerOrigin : null);
          return;
        }
        await finishBirth(result.environmentId, organizationOf(containerOrigin));
      } finally {
        setConnectingOrigin(null);
      }
    },
    [exchangeZeropsIdentity, finishBirth, organizationOf, targetOf],
  );

  // A Mate being opened connects the moment its container answers ready.
  const openingReady = opening !== null && health.get(opening.key) === "ready";
  useEffect(() => {
    if (opening === null || !openingReady || openedRef.current === opening) return;
    openedRef.current = opening;
    void connectContainer(opening.origin);
  }, [connectContainer, opening, openingReady]);

  const open = useCallback((candidate: ZeropsCandidate) => {
    if (candidate.containerOrigin === undefined) return;
    setConnectError(null);
    setOpening({
      key: candidate.key,
      projectId: candidate.project.id,
      origin: candidate.containerOrigin,
      organizationId: candidate.project.clientId ?? null,
    });
  }, []);

  const activeOrganizationId = activeOrganization?.id;
  const retryProjectConnection = useCallback(() => {
    retryZeropsProjectConnection({
      connectError,
      readyOrigin: failedOrigin,
      retryIdentity: (containerOrigin) => {
        void connectContainer(containerOrigin);
      },
      // Nothing to connect yet: the organization is read again, and what is ready is connected.
      retryProvisioning: () => {
        if (activeOrganizationId === undefined) return;
        invalidateZerops({
          topic: "inventory",
          organization: organizationRef(activeOrganizationId),
        });
      },
    });
  }, [activeOrganizationId, connectContainer, connectError, failedOrigin, organizationRef]);

  const upgradeRecovery = useMateUpgradeRecovery(
    connectError ? upgradeOrigin : null,
    retryProjectConnection,
  );

  return {
    presses,
    opening,
    open,
    connectError,
    upgradeRecovery,
    serverVersion,
    setConnectError,
    connectingOrigin,
    failedOrigin,
    retryProjectConnection,
    connectContainer,
    finishBirth,
  };
}

/** Every Mate counts toward what waits on the viewer: the overview's filter is not the menu's. */
const SHOWS_EVERY_MATE = () => true;
const NO_ROWS: ReadonlyArray<never> = [];

/**
 * The overview's body: every project's card, or — on a project's own page (`project`) — that one
 * project's card at the page's width with the page's column beside it, drawn through the same
 * slots, so a Mate's row, a place's panel and the release's door are one thing in both.
 */
export function ZeropsProjectsContent({
  search,
  onShow,
  project,
  painted = true,
}: {
  readonly search: ProjectsSearch;
  readonly onShow?: ((show: OverviewShow | undefined) => void) | undefined;
  readonly project?: ProjectPageSlot | undefined;
  /** The page shows it now, past the overview's one wait (`overviewPaints`). */
  readonly painted?: boolean;
}) {
  const openMate = useOpenMate();
  const authGate = useRouteContext({
    from: "__root__",
    select: (context) => context.authGateState,
  });
  const {
    activeOrganization,
    client,
    clearLastRegistration,
    lastRegistration,
    organizations,
    organizationStatus,
    selectOrganization,
    status,
  } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const operations = useAccountOperations();
  const inventory = useZeropsInventory();
  const { listing, error, refresh: refreshCandidates } = useZeropsCandidates();
  // The rows read so far; `listing` says whether they are all there are, and
  // the page's notice says so while they are not (`projectsListingNotice`).
  const observedCandidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  // An agent's name must be new on the account, not just in the group: it is
  // what the left menu calls the row, and two Adas is two of nothing.
  const taken = useTakenBotNames();
  const nowMs = useNowMs();
  const {
    presses,
    opening,
    open,
    connectError,
    upgradeRecovery,
    setConnectError,
    connectingOrigin,
    failedOrigin,
    retryProjectConnection,
    connectContainer,
    finishBirth,
  } = useZeropsProjectConnection();
  // The New projects this tab is making: drawn from the press, as the left menu draws them.
  const made = useCreations();
  const birthProjectIds = useMemo(
    () => new Set(presses.map((press) => press.projectId)),
    [presses],
  );
  // A project on its way up is read against the platform's verdict on its
  // creation: one whose `project.create` failed is not coming up, however
  // long the page waits, and its row says so instead — a creation that fails
  // late too (H20), as the process's own change arrives.
  const creationVerdicts = useProjectCreations(observedCandidates);
  // A first build whose process failed reads as the platform leaves it, with what removes it.
  const firstBuilds = useZeropsFirstBuilds(observedCandidates);
  // Each drawn Mate holds only the project detail that decides the viewer’s access.
  useVisibleProjectAccess(
    useMemo(() => drawnMateProjects(observedCandidates), [observedCandidates]),
  );
  const candidates = useMemo(
    () =>
      observedCandidates.map((candidate) =>
        applyFirstBuildVerdict(
          applyProjectCreationVerdict(candidate, creationVerdicts.get(candidate.project.id)),
          firstBuilds.get(candidate.key),
        ),
      ),
    [creationVerdicts, firstBuilds, observedCandidates],
  );
  // A Mate this tab pressed lands the person in its conversation once it is
  // connected. A lease (the account runtime's) reaches the door — it never
  // navigates by design — so this watches for a project this page saw being
  // pressed, or one it is opening, turning up connected, and finishes from
  // here. Gated strictly on those: an ordinary connected environment must
  // never pull anyone into a thread. A press is remembered for as long as the
  // page is mounted.
  const seenBirthsRef = useRef(new Set<string>());
  const finishedBirthProjectsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const projectId of birthPresses(presses)) seenBirthsRef.current.add(projectId);
    // A connect this page's own `connectContainer` is mid-flight on will
    // reach `finishBirth` itself; racing in here would only navigate twice.
    if (connectingOrigin !== null) return;
    const watched = new Set(seenBirthsRef.current);
    if (opening !== null) watched.add(opening.projectId);
    if (watched.size === 0) return;
    const admitted = candidates.find(
      (candidate) =>
        watched.has(candidate.project.id) &&
        candidate.group === "connected" &&
        candidate.environmentId !== undefined &&
        !finishedBirthProjectsRef.current.has(candidate.project.id),
    );
    if (admitted?.environmentId === undefined) return;
    finishedBirthProjectsRef.current.add(admitted.project.id);
    void finishBirth(admitted.environmentId, admitted.project.clientId ?? null);
  }, [presses, candidates, connectingOrigin, finishBirth, opening]);
  // Every row's container as the container store holds it (DESIGN §4.5): the
  // platform's processes hold a boot's cap (H7/R9), and the Mate flag is read
  // only for a container that predates Mate (H9).
  const {
    health: candidateHealth,
    serverVersions,
    mateFlags: candidateMateFlags,
  } = useZeropsContainers();
  const [enablingCandidateKey, setEnablingCandidateKey] = useState<string | null>(null);
  const [startingCandidateKey, setStartingCandidateKey] = useState<string | null>(null);
  const [restartingCandidateKey, setRestartingCandidateKey] = useState<string | null>(null);
  const restartMate = useRestartMate();
  const deleteProject = useDeleteProject();
  const [removingCandidateKey, setRemovingCandidateKey] = useState<string | null>(null);

  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);

  const [toolError, setToolError] = useState<string | null>(null);
  const [creation, setCreation] = useState<EnvironmentCreationView | null>(null);
  // A creation that went through, until the setup read catches up: it is not half made meanwhile.
  const [settled, setSettled] = useState<{
    readonly groupId: string;
    readonly tier: GroupEnvironmentTier;
  } | null>(null);
  // Ticks once a second while a creation runs, so the checklist's durations
  // move; stops the moment it settles.
  const [creationNowMs, setCreationNowMs] = useState(() => Date.now());
  const creationRunning = creation !== null && creation.outcome === undefined;
  useEffect(() => {
    if (!creationRunning) return;
    const timer = setInterval(() => {
      setCreationNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [creationRunning]);
  const projectOrder = useProjectOrderOptions();
  // A creation the platform accepted is drawn in its group before the
  // listing holds its project, and a New project this tab is making from the
  // press — the same placing the left menu reads.
  // An application HQ holds with no project is drawn too, empty, for a Mate to be added to it.
  const hqStructure = useAtomValue(shownCanonicalHqListNavigationAtom);
  const placementStatus = useAtomValue(hqPlacementStatusAtom);
  // Whether HQ's structure is known: only then does a Mate it places nowhere have no record.
  const hqKnown = useAtomValue(hqPlacementsAtom) !== null && hqStructure.live;
  const groupTree = useProjectsInventory(
    candidates,
    projectOrder,
    placedPressesIn(
      presses,
      activeOrganization?.id,
      placedNewProjects(made, activeOrganization?.id),
    ),
  );
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  // Each Mate as its menu row reads it: HQ's word of it, or its socket's.
  const activityOf = useMateRowActivity(useMatesActivity());
  // Whom HQ holds linked: a Mate's face is awake as its menu row's is (`listedMateFace`).
  const hqMates = useMatesLinkedInHq();
  // Whether a Mate's conversations are read: one with none says nothing was asked yet.
  const conversationsRead = useMateConversationsRead();
  // Whether a Mate is still coming up, or never came, as its menu row says it: its card says the same.
  const comingOf = useMateComingOf(observedCandidates);
  const updates = useMateUpdateStates();
  // What this person may do with each Mate, from the one role function the
  // door runs too (D5). A `listed` row is shown and never opened.
  const viewer =
    activeOrganization === null
      ? null
      : {
          id: activeOrganization.id,
          membershipId: activeOrganization.membershipId,
          roleCode: activeOrganization.roleCode,
          canCreateProjects: activeOrganization.canCreateProjects,
        };
  const visibilityOf = (candidate: ZeropsCandidate): RoleMateVisibility | undefined =>
    viewer === null ? undefined : resolveMateVisibility({ project: candidate.project, viewer });
  // What HQ offers of each row's project (`mateRowCan`), and of the organization.
  const mateOffersOf = useMateOffers();
  const orgOffer = useOrgOffers();
  // Whose a Mate this person may see and not open is, as HQ names its owner: no member list read.
  const projectPeople = useAtomValue(shownHqProjectPeopleAtom);

  /** A press of the organization on show: the page is not empty while one is on its way. */
  const activeBirths = presses.some((press) => press.organizationId === activeOrganization?.id);
  const accountHq = useAccountHq(activeOrganization?.id);
  const noProjectYet = hasNoZeropsProject({
    listing,
    creationPending: activeBirths,
    hqProjectId: accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined,
  });
  // What the viewer's role makes and reaches here: an empty first screen says it (`firstRunWords`).
  const capabilities = usePlatformCapabilities(null);
  const roleOffered = roleOffers(capabilities);

  /** The row whose connect failed: its line carries the failure and the retry. */
  const connectFailedOn = (candidate: ZeropsCandidate): boolean =>
    failedOrigin !== null &&
    candidate.containerOrigin !== undefined &&
    normalizeOrigin(candidate.containerOrigin) === normalizeOrigin(failedOrigin);

  /**
   * Whether this page waits on the row: its birth, the Mate a person asked to
   * open, or the identity exchange either ends in (`connectingOrigin`).
   */
  const waitedOn = (candidate: ZeropsCandidate): boolean => {
    if (birthProjectIds.has(candidate.project.id)) return true;
    if (opening !== null && opening.projectId === candidate.project.id) return true;
    return (
      candidate.containerOrigin !== undefined &&
      connectingOrigin !== null &&
      normalizeOrigin(connectingOrigin) === normalizeOrigin(candidate.containerOrigin)
    );
  };

  // The organization's HQ, where the registry lives: its project is no project of the page's.
  // What says a project is its person's own, for Set up Mate on it (`plainEvidenceOf`): HQ's
  // records of every kind, its presses, its anchor, and what this tab is making. None while HQ's
  // structure is not known, so nothing is plain then.
  const knownStructure = hqStructure.structure;
  const hqPresses = hqStructure.read === "unread" ? null : hqStructure.presses;
  const plainEvidence = useMemo(
    () =>
      plainEvidenceOf({
        hqKnown,
        structure: knownStructure,
        presses: hqPresses,
        hq: accountHq.hq,
        local: [
          ...presses.map((press) => press.projectId),
          ...made.flatMap((birth) => (birth.projectId === null ? [] : [birth.projectId])),
        ],
      }),
    [accountHq.hq, hqKnown, hqPresses, knownStructure, made, presses],
  );

  const rowInput = (
    candidate: ZeropsCandidatePresentation,
    role?: ZeropsEnvironmentRole | undefined,
  ): ZeropsRowInput => {
    const visibility = visibilityOf(candidate);
    const ownerName =
      visibility === "listed" ? projectPeople[candidate.project.id]?.owner?.name : undefined;
    const waiting = candidate.group !== "connected" && waitedOn(candidate);
    const mateFlag = candidateMateFlags.get(candidate.key);
    return {
      outsideHq:
        hasMate(candidate) &&
        mateOutsideHq(
          candidate.project,
          hqKnown,
          waiting || presses.some((press) => press.projectId === candidate.project.id),
        ),
      candidate,
      coming: comingOf(candidate),
      health: candidateHealth.get(candidate.key),
      // A first build past its grace is still on its way, taking longer.
      firstBuildOverdue: firstBuildOverdue(candidate, nowMs),
      ...(mateFlag === undefined ? {} : { mateFlag }),
      waiting,
      can: mateRowCan(mateOffersOf(candidate.project.id)),
      plainEvidence,
      ...(role === undefined ? {} : { role }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(ownerName === undefined ? {} : { ownerName }),
    };
  };

  const [settingUpKey, setSettingUpKey] = useState<string | null>(null);
  /** The project a Set up Mate waits on its confirm for (`ZeropsSetUpMateDialog`). */
  const [confirmingSetUp, setConfirmingSetUp] = useState<ZeropsCandidate | null>(null);

  const readGroupAgents = useReadGroupAgents();

  const setUpMate = useCallback(
    async (candidate: ZeropsCandidate) => {
      if (!activeOrganization || settingUpKey !== null) return;
      const isCurrent = captureAccountLifetime();
      setSettingUpKey(candidate.key);
      setConnectError(null);
      try {
        const projectId = candidate.project.id;
        const group = groupTree.groups.find((candidate) =>
          candidate.environments.some(({ item }) => item?.project.id === projectId),
        );
        const agents =
          group === undefined
            ? []
            : await readGroupAgents(
                group.environments.flatMap(({ item }) => (item === undefined ? [] : [{ item }])),
              );
        if (!isCurrent()) return;
        const hq = officialHq(accountHq);
        // What it registers, by the rule Finish setup registers by, before its container: in the
        // application HQ or the press this tab holds places it in, under that face (F6b);
        // a new Mate in no application only where neither does.
        const held = readMatePress(projectId);
        const registration = mateFinishRegistration({
          hq,
          hqKnown,
          structure: hqStructure.structure,
          project: candidate.project,
          press: held,

          mayCreateRecord: (() => {
            const offers = mateOffersOf(projectId);
            return offers?.held === false && offers.createRecord.kind === "allowed";
          })(),
          standUp: false,
          candidates,
        });
        // Already listed, the listing places it; still placed by the press it was made by.
        beginPress({
          projectId,
          organizationId: activeOrganization.id,
          startedAt: Date.now(),
          container: true,
          placement: matePressPlacement(held) ?? null,
        });
        // Its container with its own key, and its project closed off before anyone is let in.
        const pressed = await finishMateSetup({
          inputs: { client, operations, organizationId: activeOrganization.id },
          projectId,
          projectName: candidate.project.name,
          container: { agents },
          registration,
          hq,
          isCurrent,
        });
        if (!pressed.ok) throw new Error(pressed.error);
        if (!isCurrent()) return;
        // Declared a Mate.
        await submitZeropsWrite(operations, activeOrganization.id, {
          kind: "update-project-tags",
          projectId,
          patch: { kind: "mate" },
        });
      } catch (cause) {
        if (isCurrent()) setConnectError(zeropsErrorMessage(cause));
      } finally {
        // Unconditionally: a stale clear only unblocks a verb, while a clear
        // that does not happen leaves every "Set up Mate" on the account dead
        // for the rest of the session. `isCurrent()` goes false on any
        // sign-out or account reset, which is exactly when a setup is most
        // likely to be interrupted.
        setSettingUpKey(null);
      }
    },
    [
      accountHq,
      activeOrganization,
      mateOffersOf,
      candidates,
      client,
      groupTree.groups,
      hqKnown,
      hqStructure,
      operations,
      orgOffer,
      readGroupAgents,
      setConnectError,
      settingUpKey,
    ],
  );

  const busyKeys = useMemo(
    () =>
      new Set(
        [
          enablingCandidateKey,
          settingUpKey,
          startingCandidateKey,
          restartingCandidateKey,
          removingCandidateKey,
        ].filter((key) => key !== null),
      ),
    [
      enablingCandidateKey,
      settingUpKey,
      startingCandidateKey,
      restartingCandidateKey,
      removingCandidateKey,
    ],
  );

  // The quiet actions: rename an agent, move a project. Each
  // runs through the account-scoped command layer; observations update the model.
  const [rowDialog, setRowDialog] = useState<
    | { readonly kind: "rename-agent"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "move"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "assign"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "delete-group"; readonly group: Pick<ZeropsGroup, "groupId" | "name"> }
    | { readonly kind: "mirror-code"; readonly group: Pick<ZeropsGroup, "groupId" | "name"> }
    | null
  >(null);
  // The same write an environment's own page uses, so one way to open a
  // service to the internet means one thing wherever it is offered.
  const route = useEnableRoute();

  /** Writes the group's registry entry for a Mate, as the owner. */

  /**
   * The quiet actions of a card or a row: the environment's public access,
   * the Mate's name when there is a Mate, and where the environment sits in
   * its project.
   */
  const renderEnvironmentMenu = (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsMembership,
    mate: boolean,
    updateMenuActions?: ReadonlyArray<ZeropsMenuAction>,
  ): React.ReactNode => {
    if (isZeropsToolCandidate(candidate)) return undefined;
    return (
      <ZeropsProjectMenu
        actions={mate ? mateActions.actionsFor(candidate, tags, updateMenuActions ?? []) : []}
        enablingServiceId={route.enablingServiceId}
        label={`More for ${projectNameInApp(candidate.project)}`}
        projectId={tags.role === "prod" || tags.role === "stage" ? candidate.project.id : undefined}
        offers={candidate.routeOffers}
        onEnableRoute={(offer) => {
          void route.enable(candidate.project.id, offer.serviceId);
        }}
        routes={candidate.routes}
      />
    );
  };

  /**
   * The wait this page holds, as the waited-on Mate's own line: a connect
   * that failed, in the failed tone with the one verb that retries it; an
   * older server, with the restart that updates it; a birth that ran past its
   * cap. Nothing while the wait simply runs — the face is asleep and the row
   * logic's line says how long.
   */
  const renderWaitLine = (candidate: ZeropsCandidatePresentation): React.ReactNode => {
    if (!waitedOn(candidate)) return undefined;
    const failed = (text: string) => (
      <span
        className="min-w-0 truncate text-[var(--zerops-status-failed-text)]"
        data-zerops-surface="mate-subject"
      >
        {text}
      </span>
    );
    const quiet = (text: string) => (
      <span className="min-w-0 truncate" data-zerops-surface="mate-subject">
        {text}
      </span>
    );
    const busy = connectingOrigin !== null;
    if (connectError !== null && connectFailedOn(candidate)) {
      if (upgradeRecovery !== null) {
        switch (upgradeRecovery.state) {
          case "confirm":
            return (
              <>
                <span className="min-w-0 truncate" data-zerops-surface="mate-subject">
                  <RestartMateWarning
                    name={projectNameInApp(candidate.project)}
                    projectId={candidate.project.id}
                    environmentId={candidate.environmentId}
                  />
                </span>
                <ZeropsMateVerb disabled={busy} label="Restart" onClick={upgradeRecovery.confirm} />
                <ZeropsMateVerb label="Cancel" onClick={upgradeRecovery.cancel} />
              </>
            );
          case "waiting":
            return quiet("Restarting to update.");
          case "unresolved":
            return (
              <>
                {quiet(upgradeRecovery.error ?? "The restart is still unresolved.")}
                <ZeropsMateVerb
                  disabled={busy}
                  label="Check connection"
                  onClick={() => {
                    if (candidate.containerOrigin !== undefined)
                      void connectContainer(candidate.containerOrigin);
                  }}
                />
              </>
            );
          case "failed":
            return (
              <>
                {failed(upgradeRecovery.error ?? "Could not restart.")}
                <ZeropsMateVerb
                  disabled={busy}
                  label="Try again"
                  onClick={upgradeRecovery.request}
                />
              </>
            );
          case "idle":
            return (
              <>
                {failed("This Mate runs an older server. A restart updates it.")}
                <ZeropsMateVerb
                  disabled={busy}
                  label="Restart to update"
                  onClick={upgradeRecovery.request}
                />
              </>
            );
        }
      }
      return (
        <>
          {failed(connectFailureLine(connectError))}
          <ZeropsMateVerb disabled={busy} label="Try again" onClick={retryProjectConnection} />
        </>
      );
    }
    // A press this tab made that stopped: the step it stopped at, why, and — where that step is
    // safe to ask again — *Try again*, which resumes it on the same project.
    const press = presses.find((entry) => entry.projectId === candidate.project.id);
    const stopped = pressFailureLine(press);
    if (stopped === undefined || press?.state.kind !== "failed") return undefined;
    const retry = press.state.retry;
    return (
      <>
        {failed(stopped)}
        {retry === null ? null : (
          <ZeropsMateVerb disabled={busy} label="Try again" onClick={() => void retry()} />
        )}
      </>
    );
  };

  /**
   * The line under a Mate's name. Connected, it is what the Mate is on, or
   * was last on (`agentActivity`) — the state itself is the face's to show,
   * never a word's. Waited on, it is the wait's own line when the wait has
   * something to say (a failure and its retry). Otherwise it is the row
   * logic's one sentence — how long until the Mate is up, or what is wrong —
   * and, after it, the one verb that is a real decision ("Set up Mate",
   * "Enable Zerops Mate"). Never a status verb: connecting is what clicking
   * the card does, and the boot is the face's to carry.
   */
  // A Mate this tab pressed counts on its row's clock: from the first press.
  const birthSince = (projectId: string) => {
    const press = presses.find((entry) => entry.projectId === projectId);
    return press === undefined ? undefined : pressSince(press);
  };
  const renderMateLine = (
    candidate: ZeropsCandidatePresentation,
    presentation: ZeropsRowPresentation,
    action: ZeropsRowAction,
    live: ZeropsAgentActivity | undefined,
    busy: boolean,
  ): React.ReactNode => {
    if (action.kind === "not-in-hq") return presentation.detail;
    if (candidate.group === "connected" || live !== undefined) {
      return live?.subject === undefined ? null : (
        <span className="min-w-0 truncate" data-zerops-surface="mate-subject">
          {live.subject}
        </span>
      );
    }
    const waitLine = renderWaitLine(candidate);
    if (waitLine !== undefined) return waitLine;
    // A Mate on its way up shows how far it has come — the birth's own
    // checklist (`birthProgress.ts`), read off the platform's processes and
    // statuses — whenever the wait has nothing more pressing to say.
    if (
      showsZeropsBirthLine({
        projectId: candidate.project.id,
        birthProjectIds,
      })
    ) {
      return (
        <ZeropsMateBirthLine
          since={birthSince(candidate.project.id)}
          input={{
            candidate,
            health: candidateHealth.get(candidate.key),
            connecting:
              connectingOrigin !== null &&
              candidate.containerOrigin !== undefined &&
              normalizeOrigin(connectingOrigin) === normalizeOrigin(candidate.containerOrigin),
          }}
        />
      );
    }
    const detail =
      presentation.detail === undefined ? null : (
        <span
          className={cn(
            "min-w-0 truncate",
            presentation.detailIsError && "text-[var(--zerops-status-failed-text)]",
          )}
          data-zerops-surface="mate-subject"
        >
          {presentation.detail}
        </span>
      );
    switch (action.kind) {
      // "start" is a trailing button on the card, not a verb on this line —
      // the line only says the detail (e.g. "Stopped").
      case "enable":
      case "set-up-mate": {
        // A setup is serialised, so a row waiting its turn is unpressable
        // rather than pressable-and-ignored.
        const verb =
          action.kind === "set-up-mate"
            ? setUpMateVerb({ candidateKey: candidate.key, settingUpKey })
            : { disabled: busy, label: action.label };
        return (
          <>
            {detail}
            <ZeropsMateVerb
              disabled={verb.disabled}
              label={verb.label}
              onClick={() => {
                runRowAction(candidate, action.kind);
              }}
            />
          </>
        );
      }
      // A re-probe, nothing that writes (H9) — never disabled by any
      // in-flight platform write, since it starts none.
      case "retry-probe":
        return (
          <>
            {detail}
            <ZeropsMateVerb
              label={action.label}
              onClick={() => {
                runRowAction(candidate, action.kind);
              }}
            />
          </>
        );
      default:
        return detail;
    }
  };

  /** What an environment holds, phrased once for every row on the page. */
  const summaryOf = (candidate: ZeropsCandidatePresentation): React.ReactNode =>
    environmentSummaryLine(candidate.services, formatRelativeTimeLabel);

  /** Runs a row's one verb; the words come from `ZeropsProjectRow.logic`. */
  const runRowAction = (candidate: ZeropsCandidate, kind: ZeropsRowAction["kind"]): void => {
    switch (kind) {
      case "open":
        openMate(candidate);
        return;
      // On an existing project: what it adds and what restarts, confirmed first.
      case "set-up-mate":
        setConfirmingSetUp(candidate);
        return;
      // A harmless re-probe (H9) — `unreachable`/`stalled` cannot be told
      // apart from `predates-mate` by a browser, so nothing here writes;
      // this only asks for the container to be read again.
      case "retry-probe":
        readContainerAgain(candidate);
        return;
      case "enable": {
        const serviceId = candidate.service?.id;
        if (!serviceId || activeOrganization === null) return;
        setConnectError(null);
        setEnablingCandidateKey(candidate.key);
        // Write the flag, then restart: the install step re-runs on boot and
        // comes back with the current zcp, which only installs Zerops Mate
        // when it finds ZCP_MATE_ENABLED set. A restart on its own returns the
        // container to the identical state.
        void submitZeropsWrite(operations, activeOrganization.id, {
          kind: "enable-zerops-mate",
          projectId: candidate.project.id,
          serviceId,
        })
          .then(() => {
            intendContainer(candidate.key, { kind: "enable" });
            // A Mate this tab pressed is connected once it answers; one that exists is opened.
            if (!birthProjectIds.has(candidate.project.id)) open(candidate);
          })
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setEnablingCandidateKey(null);
          });
        return;
      }
      case "start": {
        if (activeOrganization === null) return;
        setConnectError(null);
        setStartingCandidateKey(candidate.key);
        const projectId = candidate.project.id;
        // A STOPPED project starts every service in it; a STOPPED zcp
        // service while the project is ACTIVE starts only that service.
        const serviceId = candidate.service?.id;
        const write =
          candidate.project.status === "STOPPED"
            ? submitZeropsWrite(operations, activeOrganization.id, {
                kind: "start-project",
                projectId,
              })
            : serviceId
              ? submitZeropsWrite(operations, activeOrganization.id, {
                  kind: "start-service",
                  projectId,
                  serviceId,
                })
              : null;
        if (write === null) {
          setStartingCandidateKey(null);
          return;
        }
        void readContainerAfter(candidate, write)
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setStartingCandidateKey(null);
          });
        return;
      }
      case "restart": {
        if (activeOrganization === null) return;
        const serviceId = candidate.service?.id;
        if (!serviceId) return;
        setConnectError(null);
        setRestartingCandidateKey(candidate.key);
        void readContainerAfter(
          candidate,
          restartMate({
            key: candidate.key,
            projectId: candidate.project.id,
            serviceId,
            status: candidate.service?.status,
          }),
        )
          .catch((cause: unknown) => {
            setConnectError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setRestartingCandidateKey(null);
          });
        return;
      }
      case "remove": {
        if (activeOrganization === null) return;
        setConnectError(null);
        setRemovingCandidateKey(candidate.key);
        const organization = organizationRef(activeOrganization.id);
        void removeFailedZeropsProject({
          projectId: candidate.project.id,
          organization,
          deleteProject,
          forgetCreation: forgetPress,
        })
          .then((outcome) => {
            if (!outcome.ok) setConnectError(outcome.error);
          })
          .finally(() => {
            setRemovingCandidateKey(null);
          });
        return;
      }
      case "pending":
      case "none":
        return;
    }
  };

  /**
   * Stands up one environment in a group: the plan is `planEnvironmentCreation`,
   * the calls are `runEnvironmentCreation`, and this only chooses the inputs —
   * the name, whether it gets an agent, and what that agent is called.
   */
  // A group is offered more once its first Mate is up (`groupAddsOffered`).
  // This gates another Mate; HQ's own offers decide stage and production.
  const addMateOffer = useAddMateOffer();
  const addsOfferedFor = useCallback(
    (group: Pick<ZeropsGroup, "groupId">) => {
      const entry = groupTree.groups.find((entry) => entry.group.groupId === group.groupId);
      return (
        entry !== undefined &&
        addMateOffer(group.groupId).kind === "allowed" &&
        groupAddsOffered(
          entry.environments.flatMap(({ item }) => (item === undefined ? [] : [{ item }])),
          candidateHealth,
        )
      );
    },
    [addMateOffer, candidateHealth, groupTree.groups],
  );

  // Which tiers HQ offers this person to add to the group (`add_stage` / `add_production`).
  const environmentOffers = useEnvironmentOffers();

  // "Add stage" opens the form; the form's answer is what gets created.
  const [creationRequest, setCreationRequest] = useState<{
    readonly groupId: string;
    readonly role: ZeropsEnvironmentRole;
  } | null>(null);
  const gitSetup = useGitEnvironmentFormInputs(
    activeOrganization?.id,
    creationRequest?.groupId ?? null,
  );
  const hqOffers = useHqOffers();
  // Why Add a Mate stands off, where that is known before the press (`newMateGate`): HQ refusing
  // the person a Mate here, or the project's setup files not ready for another.
  const addMateGate = useNewMateGate();
  const addMateWhy = (groupId: string): string | null => {
    const offer = addMateOffer(groupId);
    if (offer.kind === "refused" || offer.kind === "unavailable")
      return hqOffers.words(offer) ?? null;
    const entry = groupTree.groups.find((candidate) => candidate.group.groupId === groupId);
    if (entry === undefined) return null;
    return addMateGate({
      group: entry.group,
      environments: entry.environments.flatMap(({ item }) =>
        item === undefined ? [] : [{ item }],
      ),
    });
  };
  const requestedGroup = useMemo(
    () =>
      creationRequest === null
        ? undefined
        : groupTree.groups.find((entry) => entry.group.groupId === creationRequest.groupId),
    [creationRequest, groupTree.groups],
  );
  // The registry — which groups exist and which projects are in them (ADR 0002), read from HQ.
  const registryState = useZeropsRegistry();

  // Every verb a Mate has, from the one place that defines them — shared with
  // a project's own page, which listed its Mates and could do nothing to them.
  const mateActions = useMateActions({ registry: registryState, serverVersions });

  // The recipe is the application's, read as the person through its HQ (guide
  // 4.3) — never a sibling's export, which carried service shapes without their
  // build setup and produced environments that could not build.
  const groupRecipe = useZeropsGroupRecipe({
    appId: creationRequest?.groupId,
    tier:
      creationRequest?.role === "prod"
        ? "production"
        : creationRequest?.role === "stage"
          ? "stage"
          : "mate",
    enabled: creationRequest !== null,
  });

  // Every group's flow — its declared environments and what they run, what
  // is waiting to land, what was released — read while the page is drawn.
  // What a release would put live is compared on the project's own page.
  const projectFlow = useCompactProjectFlows("every");
  const verbs = useFlowVerbs();
  const deployments = useStopDeploymentsShown();
  // What HQ's rule shows this person of each project's changes: a project listed to them whose
  // changes it does not says so in their steps, never "None yet".

  /**
   * The face a Mate wears (`listedMateFace`): the state of its conversation while a word of now says
   * it — HQ's, or its socket's — else asleep, and needing you while its own change waits for your
   * review, as its row in the menu and its conversation's composer say.
   */
  const mateFace = (candidate: ZeropsCandidatePresentation): MateMarkState => {
    const groupId = readZeropsMembership(candidate.project).groupId;
    return listedMateFace({
      candidate,
      hqMates,
      activity: activityOf(candidate),
      reviewWaits: mateReviewWaits(
        groupId === undefined ? undefined : projectFlow.flows.get(groupId),
        candidate.project.id,
      ),
      mine: projectPeople[candidate.project.id]?.waitsOnViewer === true,
      // Waking while it comes up and arrives, as its row in the menu.
      pose: matePoseOf(candidate, nowMs),
      free: mateAutomation(candidate.project.hq?.mate)?.task === null,
    });
  };
  const openReview = useOpenReview();
  // The change that adds a project's setup files, where one waits: what moves on a stage or a
  // production held for want of them.
  const setupChangeOf = (groupId: string) => {
    const change = newMateRecipeChange({
      flow: projectFlow.flows.get(groupId),
      mateName: () => undefined,
    });
    return change === undefined
      ? undefined
      : () => {
          setCreationRequest(null);
          openReview({ kind: "change", groupId, repository: RECIPE_REPO, number: change.number });
        };
  };
  const groupDeploys = projectFlow.flows;
  // A production just added is the intent to release (P7): the application whose production came
  // up waits here until HQ holds it and the gate says whether its first release is the person's to
  // review, which then opens by itself (`creationHandoff`). The gate is the release offer's: nothing
  // is compared meanwhile.
  const [handoffTo, rememberReleaseIntent] = useState<{
    readonly orgId: string;
    readonly groupId: string;
    readonly projectId: string;
  } | null>(null);
  const handoffFlows = useProjectFlows(
    useMemo(() => (handoffTo === null ? [] : [handoffTo.groupId]), [handoffTo]),
  ).flows;
  useEffect(() => {
    if (handoffTo === null) return;
    if (handoffTo.orgId !== activeOrganization?.id) {
      rememberReleaseIntent(null);
      return;
    }
    const flow = handoffFlows.get(handoffTo.groupId);
    if (flow === undefined) return;
    const verdict = creationHandoff({
      // The project this press made, never another production that comes up later.
      hasProduction: flow.environments.some(
        (entry) => entry.tier === "production" && zeropsProjectOf(entry) === handoffTo.projectId,
      ),
      gate: flow.release.gate,
    });
    if (verdict === "wait") return;
    rememberReleaseIntent(null);
    if (verdict === "open") openReview({ kind: "release", groupId: handoffTo.groupId });
  }, [activeOrganization?.id, handoffFlows, handoffTo, openReview]);

  /**
   * The environment row of one Zerops project, when HQ records it as one of an
   * application's environments. A project HQ records as none is not a group
   * environment and keeps the row it always had.
   */
  const declaredEnvironment = useCallback(
    (projectId: string) => {
      for (const state of groupDeploys.values()) {
        const found = state.environments.find(
          (entry) => entry.target.kind === "zerops" && entry.target.projectId === projectId,
        );
        if (found !== undefined) return found;
      }
      return undefined;
    },
    [groupDeploys],
  );

  /**
   * Publish a service on its `*.zerops.app` subdomain.
   *
   * First class rather than a recovery step: a production environment cloned
   * from dev comes up unpublished whatever its recipe said, so without this the
   * first deploy lands and the page answers 502 with nothing saying why
   * (`verified.md`, 2026-09-07).
   */
  // A Mate is asked for over whatever is on screen (`ZeropsNewMateHost`), from here as from the
  // left menu, and the person lands on it; a stage or a production is this page's own form.
  const addMate = useAddMate();
  // Production is put live in one step, over this page (`PutLiveHost`).
  const openPutLive = useOpenPutLive();
  const putLiveRuns = usePutLive((state) => state.runs);
  const requestEnvironment = useCallback(
    (groupId: string, role: ZeropsEnvironmentRole) => {
      if (role === "dev") {
        addMate(groupId);
        return;
      }
      if (creationRunning) return;
      setCreationRequest({ groupId, role });
    },
    [addMate, creationRunning],
  );
  // A stage or a production asked for from the left menu (`setUpEnvironment.ts`): its form opens
  // here, as this page's own ⋯ opens it — taken once, so a later visit opens nothing.
  const setUpAsked = useSetUpEnvironment((state) => state.asked);
  const takeSetUp = useSetUpEnvironment((state) => state.take);
  useEffect(() => {
    if (setUpAsked === null) return;
    const ask = takeSetUp();
    if (ask !== null) requestEnvironment(ask.groupId, ask.role);
  }, [requestEnvironment, setUpAsked, takeSetUp]);

  // The creation itself is the account's (`useEnvironmentCreation`), shared with the New Mate
  // dialog; this page shows its checklist and what it came to.
  const runCreation = useEnvironmentCreation();
  const createEnvironment = useCallback(
    async (groupId: string, role: ZeropsEnvironmentRole, choice: EnvironmentCreationChoice) => {
      if (!activeOrganization || creationRunning) return;
      const entry = groupTree.groups.find((candidate) => candidate.group.groupId === groupId);
      if (entry === undefined) return;
      const tier = role === "prod" ? "production" : role === "stage" ? "stage" : null;
      // Under way from the click: every add verb is off (`creationRunning`)
      // before the group's agents are read, so none is pressed twice.
      setCreation({ groupId, name: choice.name, tier: tier ?? "mate", progress: [] });
      const run = await runCreation({
        group: entry.group,
        environments: entry.environments.flatMap(({ item }) =>
          item === undefined ? [] : [{ item }],
        ),
        role,
        choice,
        onPlanned: (steps) => {
          setToolError(null);
          setCreationNowMs(Date.now());
          setCreation((current) =>
            current === null
              ? current
              : { ...current, progress: steps.map((step) => ({ step, state: "queued" })) },
          );
        },
        onProgress: (progress) => {
          setCreation((current) => (current === null ? current : { ...current, progress }));
        },
      });
      if (run.kind === "refused") {
        setCreation(null);
        if (run.reason !== null) setToolError(run.reason);
        return;
      }
      const { outcome } = run;
      if (!outcome.ok) {
        setCreation((current) =>
          current === null
            ? current
            : {
                ...current,
                outcome: {
                  kind: "failed",
                  error: outcome.error,
                  projectExists: outcome.projectId !== undefined,
                },
              },
        );
        return;
      }
      if (tier !== null) setSettled({ groupId, tier });
      // A stage added is its card's Stage line from here: its own reading says the rest.
      if (role === "stage" && !outcome.awaitingAgent) {
        setCreation(null);
        return;
      }
      if (outcome.awaitingAgent) {
        // The imports were accepted; the rest is the birth's, which the Mate's
        // card shows and whose connect lands the person in the conversation.
        setCreation(null);
        setConnectError(null);
        return;
      }
      setCreation((current) =>
        current === null
          ? current
          : {
              ...current,
              outcome: {
                kind: "done",
                deployments: outcome.deployments,
                projectId: outcome.projectId,
              },
            },
      );
      if (role === "prod")
        rememberReleaseIntent({
          orgId: activeOrganization.id,
          groupId,
          projectId: outcome.projectId,
        });
    },
    [activeOrganization, creationRunning, groupTree.groups, runCreation, setConnectError],
  );

  // A stage or a production whose creation lost its last writes is said on its project's row and
  // finished from its menu, when the person asks (`useEnvironmentSetup`).
  const { halfMade, finishing } = useEnvironmentSetup(
    useMemo(() => candidates.map(({ project }) => project.id), [candidates]),
  );
  useEffect(() => {
    if (
      settled !== null &&
      !halfMade.some((entry) => entry.groupId === settled.groupId && entry.tier === settled.tier)
    )
      setSettled(null);
  }, [settled, halfMade]);

  useEffect(() => {
    autoConnectServedZeropsEnvironment({
      attempted: autoConnectingRef,
      status,
      zeropsToken: client.session?.accessToken ?? null,
      appOrigin: window.location.origin,
      authGate,
      candidates,
      connect: (containerOrigin) => {
        void connectContainer(containerOrigin);
      },
    });
  }, [authGate, candidates, client.session?.accessToken, connectContainer, status]);

  // A birth whose project the platform failed to create can never end: the
  // container it waits for will not be made. The moment the verdict is in, the
  // birth is forgotten and the row's own line takes over.
  useEffect(() => {
    for (const candidate of candidates) {
      if (candidate.creationFailed !== undefined && birthProjectIds.has(candidate.project.id)) {
        forgetPress(candidate.project.id);
      }
    }
  }, [birthProjectIds, candidates]);

  // The two-hop registration flow: the platform's own word on what it claimed
  // for the new account, preferred over inferring it from a candidate's
  // status. A returning account never infers a new setup flow from an
  // unrelated provisioning project in the inventory. The claimed project is
  // finished like any other once the inventory lists it — its key lowered and
  // its project closed off: a claim hands over a brand-new project, so the
  // newest one of its organization is it.
  const claimRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRegistration) {
      const { clientId, zcpClaimed } = deriveProvisioningStart(lastRegistration);
      clearLastRegistration();
      if (!clientId) return;
      // No ready-made project to wait on: the only way forward is to create one, in its dialog
      // over this page (`ZeropsNewProjectHost`).
      if (zcpClaimed === false) {
        askNewProject();
        return;
      }
      claimRef.current = clientId;
    }
    const claimIn = claimRef.current;
    if (claimIn === null) return;
    const claimed = inventory.projects
      .filter((project) => project.clientId === claimIn)
      .toSorted((left, right) => (right.created ?? "").localeCompare(left.created ?? ""))[0];
    if (claimed === undefined) return;
    claimRef.current = null;
    beginPress({
      projectId: claimed.id,
      organizationId: claimIn,
      startedAt: Date.now(),
      container: true,
      // A claimed project is already listed, in no group of this account's.
      placement: null,
    });
    void finishMateSetup({
      inputs: { client, operations, organizationId: claimIn },
      projectId: claimed.id,
      projectName: claimed.name,
      // The pool made its container.
      container: null,
      registration: null,
      hq: accountHq.hq.kind === "official" ? accountHq.hq : null,
      isCurrent: captureAccountLifetime(),
      // A container the pool made: its key at ADMIN, lowered.
      harden: true,
    });
  }, [accountHq, clearLastRegistration, client, inventory.projects, lastRegistration, operations]);

  // Every group's flow, from the one derivation the thread and the left menu
  // read too (`groupFlow`): what each step holds and the one next step.
  const groupLines = useMemo(
    () =>
      new Map(
        groupTree.groups.map(({ group }) => [
          group.groupId,
          projectsGroupLine({
            placeholder: groupNameUnread(group),
            unfinished: finishing.unfinished.get(group.groupId),
            finishing: finishing.finishing.get(group.groupId),
            halfMade: halfMade.find((entry) => entry.groupId === group.groupId)?.tier,
            creating: creationCovers(creation, settled, group.groupId),
          }),
        ]),
      ),
    [groupTree.groups, finishing.unfinished, finishing.finishing, halfMade, creation, settled],
  );
  // The cards' places as the menu's chips read them, their panels, and the people on each.
  const overview = useOverviewSlots<ZeropsCandidatePresentation>({
    onPage: project !== undefined,
    flows: groupDeploys,
    deployments,
    mateFace: (candidate) => {
      const tint = tints.get(candidate.project.id) ?? "slate";
      return (
        <MateFace
          shape={mateShapeOf(candidate.project, tint)}
          size={20}
          state={mateFace(candidate)}
          tint={tint}
        />
      );
    },
    fixerOf: (entry) => {
      const mine = [...entry.mates.values()].find(
        (candidate) => projectPeople[candidate.project.id]?.waitsOnViewer === true,
      );
      return mine === undefined
        ? undefined
        : { projectId: mine.project.id, name: projectNameInApp(mine.project) };
    },
    nowMs,
  });
  // The person's Chief is the organization's, not a project: no card of its own.
  const projectGroups = useMemo(
    () =>
      groupTree.groups.filter(
        ({ environments }) =>
          !environments.some(({ item }) => item !== undefined && isChief(item.project)),
      ),
    [groupTree.groups],
  );
  const flowGroups = useProjectsPageRows({
    groups: projectGroups,
    flows: projectFlow,
    deployments,
    lines: groupLines,
  });
  // The overview's filter (`overviewKeeps`): what waits on the viewer is the menu's own word —
  // a Mate of theirs that asks, a change for their review, a release they may make — and theirs is
  // what HQ records as theirs.
  const waitingReleases = useMemo(
    () =>
      flowGroups.flatMap((entry) => {
        const release = projectFlow.flows.get(entry.group.groupId)?.release;
        // Put it live releases the production it makes: no release waits on the viewer meanwhile.
        return release?.gate.allowed === true &&
          !putLiveHoldsRelease(putLiveRuns.get(entry.group.groupId))
          ? [
              {
                groupId: entry.group.groupId,
                name: entry.group.name,
                ahead: release.summary?.total,
                changeCount: release.summary?.changeCount,
              },
            ]
          : [];
      }),
    [flowGroups, projectFlow.flows, putLiveRuns],
  );
  const waiting = useSidebarWaiting({
    candidates,
    activityOf,
    shown: SHOWS_EVERY_MATE,
    activeProjectId: null,
    enabled: status === "signed-in",
    releases: waitingReleases,
  });
  const personFacts = useAtomValue(shownHqPersonFactsAtom);
  const filterFacts = useMemo(() => {
    const groupOf = new Map(
      candidates.map(
        (candidate) =>
          [candidate.project.id, readZeropsMembership(candidate.project).groupId] as const,
      ),
    );
    const waits = new Set(
      waiting.items.flatMap((item) => {
        const groupId =
          item.kind === "release" ? item.release.groupId : groupOf.get(item.mate.projectId);
        return groupId === undefined ? [] : [groupId];
      }),
    );
    const mine = new Set(
      candidates.flatMap((candidate) => {
        const groupId = groupOf.get(candidate.project.id);
        return groupId !== undefined &&
          hasMate(candidate) &&
          personFacts[candidate.project.id]?.mine === true
          ? [groupId]
          : [];
      }),
    );
    return { waits, mine };
  }, [candidates, personFacts, waiting.items]);
  // A first visit's welcome (`arrival.logic`): the projects as listed, which hold a Mate of the
  // viewer's own and which take one; decided once who started each Mate and HQ's offers are read.
  const arrivalApps = useMemo(
    () =>
      flowGroups.map((entry) => ({
        groupId: entry.group.groupId,
        name: entry.group.name,
        mine: filterFacts.mine.has(entry.group.groupId),
        addMate: addMateOffer(entry.group.groupId).kind === "allowed",
      })),
    [addMateOffer, filterFacts, flowGroups],
  );
  // HQ's record of the person's first sign-in (`arrival.logic`'s `firstVisit`) comes with the
  // organization's record: the welcome decides once that is read too.
  const hqOrganization = hqStructure.organization;
  const arrivalSettled =
    signInSettled({
      recordRead: hqOrganization !== null,
      hqUnavailable: hqStructure.refusal !== null || hqDown(hqStructure),
    }) &&
    candidates.every(
      (candidate) => !hasMate(candidate) || personFacts[candidate.project.id] !== undefined,
    ) &&
    flowGroups.every((entry) => addMateOffer(entry.group.groupId).kind !== "unknown");
  const keptGroups = flowGroups.filter((entry) =>
    overviewKeeps({
      show: search.show,
      waits: filterFacts.waits.has(entry.group.groupId),
      mine: filterFacts.mine.has(entry.group.groupId),
    }),
  );

  // The session is checked before this page can draw (`ZeropsHostedLanding`): nothing to say here.
  if (status === "loading") return null;
  if (status === "signed-out") {
    return <SignedOutNotice message="Sign in with your Zerops account to see your projects." />;
  }
  if (status === "totp-required") {
    return <SignedOutNotice message="Finish signing in with your two-factor code." />;
  }

  if (organizationStatus !== "selected" || !activeOrganization) {
    return (
      <ZeropsOrganizationScope
        organizations={organizations}
        status={organizationStatus}
        onSelect={(membershipId) => {
          void selectOrganization(membershipId);
        }}
      />
    );
  }

  // A wait is never a page of its own: the waited-on Mate's card carries it
  // — the face asleep, the line saying how long, a failure and its retry on
  // the same line — and the rest of the roster stays where it was.
  const connectErrorOnRow = connectError !== null && candidates.some(connectFailedOn);
  const troubleView = projectsTroubleView({
    connectError: connectErrorOnRow ? null : connectError,
    inventoryError: error,
    listingNotice: projectsListingNotice(listing, nowMs),
    rows: candidates.length,
  });
  const listingNotice = troubleView.listingNotice;
  const pageError = troubleView.alert;
  // Every affordance this region carries asks for the list again: a failed or
  // stale read offers a retry, and the page it would go to is this one.
  const listingAffordance =
    listingNotice?.affordance == null ? null : (
      <Button onClick={refreshCandidates} size="sm" variant="secondary">
        {listingNotice.affordance.label}
      </Button>
    );

  /** Each environment's role in its group, for the card and the row that draw it. */
  const roleOf = new Map(
    groupTree.groups.flatMap(({ environments }) =>
      environments.flatMap(({ item, role }) =>
        item === undefined ? [] : [[item.project.id, role] as const],
      ),
    ),
  );

  const mateOpenerOf = (candidate: ZeropsCandidatePresentation): (() => void) | undefined => {
    const input = rowInput(candidate, roleOf.get(candidate.project.id));
    return busyKeys.has(candidate.key) ||
      input.visibility === "listed" ||
      input.outsideHq ||
      !input.can.open
      ? undefined
      : () => openMate(candidate);
  };

  const renderEnvironment = (
    candidate: ZeropsCandidatePresentation,
    role: ZeropsEnvironmentRole | undefined,
  ): React.ReactNode => {
    const input = rowInput(candidate, role);
    const presentation = deriveZeropsRowPresentation(input);
    const action = deriveZeropsRowAction(input);
    const tags = readZeropsMembership(candidate.project);
    const busy = busyKeys.has(candidate.key);
    // The project itself is the row's concern. Only a project on its
    // way in, or out of reach, gets a word; one that is simply there
    // says nothing.
    const projectTrouble =
      candidate.group === "provisioning" ||
      (candidate.group === "unavailable" && candidate.missingContainer !== true);
    // A group environment says what it follows and what it runs — the
    // branch and the deployed commit, from the two parties that can
    // prove each (`groupDeploys.ts`). Anything else keeps the summary of
    // what it holds.
    // Coloured by the one rule every surface words a stop by (`stopTone`): the platform's build
    // is a deploy on its way, and a version it runs is deployed whatever a status read before said.
    const declared = declaredEnvironment(candidate.project.id);
    const stopDeployTone =
      declared === undefined
        ? undefined
        : stopTone(deployments.get(candidate.project.id), declared);
    const deployTone = stopDeployTone === undefined ? undefined : deployRowTone(stopDeployTone);
    const deployLabel = stopDeployTone === undefined ? undefined : deployWord(stopDeployTone);
    // *Release* is the project's next step, in production's cell beside
    // the fact it acts on — never a second copy on this row, which put the
    // same verb on the page twice with nothing beside it saying why (the
    // owner, 2026-09-19).
    return (
      <ZeropsEnvironmentRow
        action={
          // A row's verb is the page's verb: 28px, outline, like Merge beside it.
          action.kind === "set-up-mate" || action.kind === "remove" ? (
            <Button
              data-zerops-primary-action={action.label}
              disabled={busy}
              onClick={() => {
                runRowAction(candidate, action.kind);
              }}
              size="sm"
              variant="secondary"
            >
              {busy ? (action.kind === "remove" ? "Removing…" : "Setting up…") : action.label}
            </Button>
          ) : undefined
        }
        busy={busy}
        // A group's stage or production: its name opens the stop's page.
        link={stopLinkOf(tags.groupId, declared?.id ?? candidate.project.id, role)}
        menu={renderEnvironmentMenu(candidate, tags, false)}
        // By its own name under its application (`projectNameInApp`).
        name={projectNameInApp(candidate.project)}
        status={
          projectTrouble ? (
            <Badge
              dot
              {...(presentation.status.pulse === undefined
                ? {}
                : { pulse: presentation.status.pulse })}
              tone={STATUS_BADGE_TONE[presentation.status.tone]}
            >
              {presentation.status.label}
            </Badge>
          ) : deployTone !== undefined && deployLabel !== undefined ? (
            <Badge dot tone={STATUS_BADGE_TONE[deployTone]}>
              {deployLabel}
            </Badge>
          ) : undefined
        }
        // A project the platform failed to create holds nothing; its
        // line is what happened, not "No services yet".
        summary={
          candidate.creationFailed !== undefined
            ? presentation.detail
            : declared === undefined
              ? summaryOf(candidate)
              : declaredEnvironmentSummary(declared, firstDeployOf(declared.id))
        }
        tag={environmentRoleTag(role)}
      />
    );
  };

  const renderMate = (
    candidate: ZeropsCandidatePresentation,
    {
      layout,
      previews,
      review,
    }: {
      readonly layout: "card" | "row";
      readonly previews: ReadonlyArray<GroupFlowPreview>;
      readonly review?: FlowPullRequest | undefined;
    },
  ): React.ReactNode => {
    const role = roleOf.get(candidate.project.id);
    const input = rowInput(candidate, role);
    const presentation = deriveZeropsRowPresentation(input);
    const action = deriveZeropsRowAction(input);
    const tags = readZeropsMembership(candidate.project);
    const connected = candidate.group === "connected";
    const busy = busyKeys.has(candidate.key);
    const live = activityOfNow(activityOf(candidate));
    const select = mateOpenerOf(candidate);
    // Not a hover-only verb on the line: a real, always-visible button
    // at the card's trailing edge, next to where the menu sits.
    const startAction =
      action.kind === "start" ? (
        <Button
          disabled={busy}
          onClick={() => {
            runRowAction(candidate, "start");
          }}
          size="sm"
          variant="secondary"
        >
          <PlayIcon />
          {busy ? "Starting…" : "Start"}
        </Button>
      ) : undefined;
    // The platform failed to make this project and nothing will ever
    // run in it: the one verb takes it away, at the same edge Start sits.
    const removeAction =
      action.kind === "remove" ? (
        <Button
          disabled={busy}
          onClick={() => {
            runRowAction(candidate, "remove");
          }}
          size="sm"
          variant="secondary"
        >
          {busy ? "Removing…" : "Remove"}
        </Button>
      ) : undefined;
    const name = projectNameInApp(candidate.project);
    const tint = tints.get(candidate.project.id) ?? "slate";
    const shape = mateShapeOf(candidate.project, tint);
    // What the menu asked of this Mate's server — a check, an update — is
    // answered on its card, over its subject, until it settles: the menu
    // closes on the click, and the update restarts the Mate, so the card is
    // the one place that stays in view throughout.
    const updateStatus = mateUpdateStatus(updates.of(candidate));
    const line =
      updateStatus === null ? (
        renderMateLine(candidate, presentation, action, live, busy)
      ) : (
        <MateUpdateStatusText status={updateStatus} />
      );

    // On its project's card: read as its menu row reads it — one face, one line 2, one time.
    if (layout === "row") {
      return (
        <OverviewCardMate
          candidate={candidate}
          change={review}
          coming={comingOf(candidate)}
          // A Mate whose container has something to say first says it: coming up, a failed
          // connect and its retry, an update under way.
          containerActions={startAction ?? removeAction}
          containerLine={
            updateStatus !== null ? (
              <MateUpdateStatusText status={updateStatus} />
            ) : !connected && activityOf(candidate) === undefined ? (
              renderMateLine(candidate, presentation, action, live, busy)
            ) : undefined
          }
          conversationsRead={conversationsRead(candidate)}
          flow={tags.groupId === undefined ? undefined : projectFlow.flows.get(tags.groupId)}
          groupId={tags.groupId}
          previews={previews}
          key={candidate.key}
          name={name}
          onOpen={select}
          outsideHq={input.outsideHq === true}
          shape={shape}
          tint={tint}
        />
      );
    }

    if (connected && candidate.environmentId !== undefined) {
      const environmentId = candidate.environmentId;
      // The update control's line ("Server x.y.z · x.y.z+1 available")
      // stays off the card: the version is in the menu, and so is the
      // update verb the control supplies.
      return (
        <ZeropsMateUpdateControl environmentId={environmentId} key={candidate.key} mateName={name}>
          {({ menuActions }) => (
            <ZeropsMateCard
              action={startAction ?? removeAction}
              busy={busy}
              face={mateFace(candidate)}
              layout={layout}
              line={line}
              menu={renderEnvironmentMenu(candidate, tags, true, menuActions)}
              name={name}
              onSelect={select}
              shape={shape}
              snippet={live?.subject === undefined ? undefined : live.snippet}
              time={live?.subject === undefined ? undefined : formatRelativeTimeLabel(live.at)}
              tint={tint}
            />
          )}
        </ZeropsMateUpdateControl>
      );
    }
    return (
      <ZeropsMateCard
        action={startAction ?? removeAction}
        busy={busy}
        face={mateFace(candidate)}
        layout={layout}
        line={line}
        menu={renderEnvironmentMenu(candidate, tags, true, [])}
        name={name}
        onSelect={select}
        shape={shape}
        tint={tint}
      />
    );
  };

  const addableTiers = ({ groupId }: Pick<ZeropsGroup, "groupId">) => {
    const group = groupTree.groups.find((entry) => entry.group.groupId === groupId)?.group;
    if (group === undefined) return [];
    const flow = projectFlow.flows.get(groupId);
    if (flow === undefined) return [];
    return tiersAddable({
      offered: environmentOffers(groupId),
      group,
      hq: [...flow.environments.values()].map((row) => ({ id: row.id, tier: row.tier })),
      recipe: { read: flow.recipeRead, tiers: flow.recipeTiers },
    });
  };

  /**
   * A project's own quiet actions: its name, and the environments a person
   * adds to it — another Mate, and a stage and a production as equals: neither
   * is optional, neither comes before the other, and each is offered where the
   * role is still there to take (`creatableRoles`) and HQ offers it to this
   * person (`useEnvironmentOffers`).
   */
  const renderGroupMenu = ({ group, flow }: ProjectsFlowGroup<ZeropsCandidatePresentation>) => {
    // Each Mate's previews, one per service and named by it: links out, so the menu's, not the
    // row's. Its Mate is named where the project has more than one with a preview.
    const previews = flow.mates.flatMap((mate) =>
      mate.previews.map((preview) => ({ mate: mate.name, ...preview })),
    );
    const oneMate = new Set(previews.map((preview) => preview.mate)).size <= 1;
    const mateWhy = addMateWhy(group.groupId);
    return (
      <ZeropsProjectRenameMenu
        actions={[
          ...previews.map((preview) => ({
            id: `preview:${preview.mate}:${preview.service}`,
            label: oneMate
              ? `Open ${preview.service} preview`
              : `Open ${preview.mate}’s ${preview.service} preview`,
            onSelect: () => {
              window.open(preview.url, "_blank", "noopener,noreferrer");
            },
          })),
          ...(previews.length === 0 ? [] : [{ id: "previews-end", separator: true as const }]),
          // A project with nothing in it is offered its first Mate, and nothing more.
          ...(groupIsEmpty(group) && addMateOffer(group.groupId).kind === "allowed"
            ? [
                {
                  id: "add-mate",
                  label: "Add Mate",
                  disabled: creationRunning,
                  onSelect: () => {
                    requestEnvironment(group.groupId, "dev");
                  },
                },
              ]
            : []),
          ...(addsOfferedFor(group)
            ? [
                {
                  id: "add-mate",
                  label: "Add Mate",
                  disabled: creationRunning || mateWhy !== null,
                  ...(mateWhy === null ? {} : { why: mateWhy }),
                  onSelect: () => {
                    requestEnvironment(group.groupId, "dev");
                  },
                },
              ]
            : []),
          ...(addableTiers(group).includes("stage") && !groupIsEmpty(group)
            ? [
                {
                  id: "add-stage",
                  label: "Add stage",
                  disabled: creationRunning,
                  onSelect: () => {
                    requestEnvironment(group.groupId, "stage");
                  },
                },
              ]
            : []),
          ...(addableTiers(group).includes("production") && !groupIsEmpty(group)
            ? [
                {
                  id: "add-production",
                  label: environmentDoorLabel("production", "production"),
                  disabled: creationRunning,
                  ...(creationRunning ? { why: PUT_LIVE_AFTER_CREATION } : {}),
                  onSelect: () => {
                    openPutLive(group.groupId);
                  },
                },
              ]
            : []),
          // A stage or a production whose setup is not finished, finished as the person asks —
          // where HQ offers them finishing it (`can.finish`), as on the application's own page.
          ...halfMade
            .filter((entry) => entry.groupId === group.groupId && entry.finish)
            .map((entry) => ({
              id: `finish-${entry.tier}`,
              label: `Finish setting up ${entry.tier}`,
              disabled: creationRunning || finishing.finishing.has(group.groupId),
              onSelect: () => {
                finishing.finish(entry);
              },
            })),
          // Where its code mirrors to: each repository's remote, connected or changed in a dialog.
          ...(!groupIsEmpty(group)
            ? [
                {
                  id: "mirror-code",
                  label: "Mirror code to GitHub or GitLab…",
                  onSelect: () => {
                    setRowDialog({ kind: "mirror-code", group });
                  },
                },
              ]
            : []),
          // A project with no Mate goes, at whoever writes the structure's word.
          ...projectDeleteActions({
            group,
            offer: orgOffer("delete_app").kind,
            contents: applicationContents(hqStructure, activeOrganization?.id, group.groupId),
            openEmpty: () => {
              setRowDialog({ kind: "delete-group", group });
            },
          }),
        ]}
        group={group}
      />
    );
  };

  // Where each stage's first deploy stands, as its cell in the flow says it (`groupFlow`): the
  // expanded environment row says the same.
  const firstDeployOf = (projectId: string) =>
    flowGroups.flatMap(({ flow }) => flow.stages).find((stage) => stage.projectId === projectId)
      ?.firstDeploy;
  // The page's one line of trouble: a refusal of something done here — a
  // merge or a release the project flow refused included — one at a time.
  const trouble = toolError ?? route.trouble ?? verbs.trouble;
  const ungroupedRows = shownUngrouped(
    withoutOfficialHq(groupTree.ungrouped, accountHq.hq).map((candidate) => ({
      item: candidate,
      action: deriveZeropsRowAction(rowInput(candidate)).kind,
    })),
  );

  return (
    // The page's end clears the app's fixed "Open main sidebar" control, so
    // the last row is never under it with the menu closed.
    <div className="space-y-6 pb-12">
      {project === undefined &&
      status === "signed-in" &&
      activeOrganization !== null &&
      !inventory.isLoading ? (
        <ZeropsDeletionRecovery />
      ) : null}
      {listingNotice === null ? null : listingNotice.region === "placeholder" ? (
        // Nothing read yet: the cards' shape, where they will stand.
        <OverviewCardsStandIn />
      ) : listingNotice.region === "message" ? (
        <Failure action={listingAffordance} cause={listingNotice.message.text} />
      ) : // The list's freshness is the title's row's (`ZeropsProjectsHeader`), never a line here.
      null}
      {pageError === null ? null : <Failure cause={pageError} />}
      {/* Nothing to show while the account's line says Zerops isn't answering: the page's own
          words, and no retry — Try now is the line's (`projectsTroubleView`). */}
      {troubleView.empty === null ? null : (
        <p className="py-16 text-center text-sm text-muted-foreground" role="status">
          {troubleView.empty}
        </p>
      )}
      {/* A project the grant withholds says why in place of its rows: its name,
          tags and Mates are its content, so none of them is drawn (DESIGN §3.4). */}
      {withheldProjectNotices(inventory).map((notice) => (
        <p className="text-xs text-muted-foreground" key={notice} role="status">
          {notice}
        </p>
      ))}
      {project === undefined && activeOrganization !== null ? (
        <ArrivalWelcome
          apps={arrivalApps}
          signIn={hqOrganization?.viewer}
          onStart={addMate}
          gateOf={addMateWhy}
          orgId={activeOrganization.id}
          organizationName={activeOrganization.name}
          painted={painted}
          settled={arrivalSettled}
          viewer={activeOrganization}
        />
      ) : null}
      {project === undefined && flowGroups.some((entry) => entry.flow.mates.length > 0) ? (
        <OverviewFilters
          mine={flowGroups.filter((entry) => filterFacts.mine.has(entry.group.groupId)).length}
          onShow={onShow}
          ownsMates={roleOffered.newProject}
          show={search.show}
          waiting={flowGroups.filter((entry) => filterFacts.waits.has(entry.group.groupId)).length}
        />
      ) : null}
      {project === undefined && search.show !== undefined && keptGroups.length === 0 ? (
        <OverviewFilterEmpty onShow={onShow} show={search.show} />
      ) : null}
      <ZeropsProjectsFlow
        creating={creationRunning}
        focusGroup={search.group}
        getKey={(candidate: ZeropsCandidatePresentation) => candidate.key}
        groups={project === undefined ? keptGroups : flowGroups}
        page={
          project === undefined
            ? undefined
            : { ...project, addMateWhy: addMateWhy(project.groupId) }
        }
        isMate={hasMate}
        onCreateProject={noProjectYet && roleOffered.newProject ? askNewProject : undefined}
        noProjectYet={noProjectYet}
        reachesEveryProject={!capabilities.membershipKnown || capabilities.reachesEveryProject}
        hqCard={<ZeropsHqCard />}
        openMate={mateOpenerOf}
        onRetryContainers={(items) => {
          for (const candidate of items) runRowAction(candidate, "retry-probe");
        }}
        renderEnvironment={renderEnvironment}
        renderGroupMenu={renderGroupMenu}
        renderMate={renderMate}
        renderMateFace={(candidate: ZeropsCandidatePresentation, size) => {
          const tint = tints.get(candidate.project.id) ?? "slate";
          return (
            <MateFace
              shape={mateShapeOf(candidate.project, tint)}
              size={size}
              state={mateFace(candidate)}
              tint={tint}
            />
          );
        }}
        cardPlaces={(entry) => {
          // This tab's run, releasing: production's line says it once, counting from its step.
          const run = putLiveRuns.get(entry.group.groupId);
          return {
            ...overview.cardPlaces(entry),
            releaseSince: run?.phase === "releasing" ? run.stepAt : undefined,
          };
        }}
        renderPlacePanel={overview.renderPlacePanel}
        renderChanges={overview.renderChanges}
        renderHistory={overview.renderHistory}
        setUpProduction={({ group, flow }) =>
          !addableTiers(group).includes("production") ||
          groupIsEmpty(group) ||
          // Nothing to put live yet: production says so, and the press comes with a change.
          !putLiveHasChange(flow)
            ? undefined
            : creationRunning
              ? "busy"
              : () => {
                  openPutLive(group.groupId);
                }
        }
        // A stage being added says how far it has got on its card's Stage line, where it stands.
        stageSettingUp={({ group }) =>
          creation?.tier === "stage" &&
          creation.outcome === undefined &&
          creation.groupId === group.groupId
            ? creationNow(creation.progress, "stage")
            : undefined
        }
        setUpStage={({ group }) =>
          !addableTiers(group).includes("stage") || groupIsEmpty(group)
            ? undefined
            : creationRunning
              ? "busy"
              : () => {
                  requestEnvironment(group.groupId, "stage");
                }
        }
        // As the project's own page offers it: always there, standing off with why where HQ says
        // one — never coming and going with what the platform says of its Mates.
        addMate={({ group }) => ({
          onAdd: () => {
            requestEnvironment(group.groupId, "dev");
          },
          why: creationRunning ? PUT_LIVE_AFTER_CREATION : addMateWhy(group.groupId),
        })}
        renderCardPeople={overview.renderCardPeople}
        renderProductionRun={({ group }) => <ProductionRun groupId={group.groupId} />}
        renderReleaseVerb={({ group, flow }) => {
          const { production } = flow;
          const candidate =
            production.kind === "ready-to-release" || production.kind === "deploy-failed"
              ? production.candidate
              : undefined;
          if (candidate === undefined) return null;
          // Production being made by Put it live is released by it: nothing asks for a release.
          if (putLiveHoldsRelease(putLiveRuns.get(group.groupId))) return null;
          return <ZeropsReleaseVerb groupId={group.groupId} label={REVIEW_RELEASE_LABEL} offered />;
        }}
        placementNotice={placementNotice(
          placementStatus,
          hqStructure.capped || placementStatus.reconnecting,
        )}
        placementReading={
          !placementStatus.complete &&
          placementStatus.unavailableReason === undefined &&
          !hqStructure.capped &&
          !placementStatus.reconnecting
        }
        // Under a filter, the projects it keeps alone: no container outside them.
        ungrouped={project === undefined && search.show === undefined ? ungroupedRows : NO_ROWS}
      />
      {mateActions.dialogs}
      {confirmingSetUp === null ? null : (
        <ZeropsSetUpMateDialog
          name={projectNameInApp(confirmingSetUp.project)}
          onCancel={() => setConfirmingSetUp(null)}
          onConfirm={() => {
            const candidate = confirmingSetUp;
            setConfirmingSetUp(null);
            void setUpMate(candidate);
          }}
        />
      )}
      {rowDialog?.kind === "delete-group" ? (
        <ZeropsDeleteProjectDialog
          group={rowDialog.group}
          contents={applicationContents(
            hqStructure,
            activeOrganization?.id,
            rowDialog.group.groupId,
          )}
          key={`delete-group:${rowDialog.group.groupId}`}
          onClose={() => {
            setRowDialog(null);
          }}
        />
      ) : null}
      {rowDialog?.kind === "mirror-code" ? (
        <GitMirrorDialog
          appId={rowDialog.group.groupId}
          appName={rowDialog.group.name}
          key={`mirror-code:${rowDialog.group.groupId}`}
          onClose={() => {
            setRowDialog(null);
          }}
        />
      ) : null}
      {creationRequest === null || requestedGroup === undefined ? null : (
        <WithDraftPeople
          groupId={creationRequest.groupId}
          key={`${creationRequest.groupId}:${creationRequest.role}`}
          kind={roleProjectKind(creationRequest.role)}
        >
          {(people) => (
            <ZeropsEnvironmentCreationDialog
              people={people}
              onSetupChange={setupChangeOf(creationRequest.groupId)}
              access={(onChange) => (
                <ProjectAccessDraft
                  groupId={creationRequest.groupId}
                  kind={roleProjectKind(creationRequest.role)}
                  label="Project access"
                  onChange={onChange}
                />
              )}
              {...(activeOrganization == null
                ? {}
                : { forecast: <ZeropsCreditForecast organizationId={activeOrganization.id} /> })}
              fallbackFocus={() =>
                document
                  .getElementById(`project-${creationRequest.groupId}`)
                  ?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null
              }
              git={
                gitSetup === undefined
                  ? undefined
                  : {
                      ...gitSetup,
                      onAdded: () => {
                        setCreationRequest(null);
                      },
                    }
              }
              tier={groupRecipe.tier}
              tierServices={groupRecipe.services}
              recipe={creationRecipe(groupRecipe)}
              recipeRereading={groupRecipe.rereading}
              onRecipeRetry={groupRecipe.reread}
              defaultName={proposedEnvironmentName({
                groupName: requestedGroup.group.name,
                roleLabel:
                  environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
                taken: requestedGroup.environments.flatMap(({ item }) =>
                  item === undefined ? [] : [item.project.name],
                ),
              })}
              defaultTintFor={(name) => newMateTint(candidates, name)}
              defaultWithAgent={defaultAgentForRole(creationRequest.role)}
              groupName={requestedGroup.group.name}
              key={`${creationRequest.groupId}:${creationRequest.role}`}
              onCancel={() => {
                setCreationRequest(null);
              }}
              onCreate={(choice) => {
                const { groupId, role } = creationRequest;
                setCreationRequest(null);
                void createEnvironment(groupId, role, choice);
              }}
              onOpenChange={(open) => {
                if (!open) setCreationRequest(null);
              }}
              open
              role={creationRequest.role}
              takenBotNames={taken}
            />
          )}
        </WithDraftPeople>
      )}
      {/* A stage's adding is said on its card's Stage line; only its failure stands here. */}
      {creation === null ||
      (creation.tier === "stage" && creation.outcome?.kind !== "failed") ||
      creationRunsAtAddress(creation, deployments, groupTree.groups) ? null : (
        <ZeropsEnvironmentCreation
          name={creation.name}
          nowMs={creationNowMs}
          onDismiss={() => {
            setCreation(null);
          }}
          progress={creation.progress}
          tier={creation.tier}
          deployed={creationDeployed(creation, deployments)}
          {...(creation.outcome === undefined ? {} : { outcome: creation.outcome })}
        />
      )}
      {trouble === null ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </div>
  );
}

export function ZeropsProjectsPage({ inPanel = false }: { readonly inPanel?: boolean }) {
  const roleOffered = useRoleOffers();
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  // The same page is the signed-in door at `/`, so the search is read loosely
  // and through the route's own parser.
  const routeSearch = parseProjectsSearch(useSearch({ strict: false }));
  // In a conversation's panel the address is the conversation's: the filter is the panel's own
  // (the owner, 2026-10-12: "filtering here redirects me to the standalone page").
  const [panelShow, setPanelShow] = useState<OverviewShow | undefined>(undefined);
  const search: ProjectsSearch = !inPanel
    ? routeSearch
    : panelShow === undefined
      ? {}
      : { show: panelShow };
  const { listing, error, refresh } = useZeropsCandidates();
  const nowMs = useNowMs();
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  // One wait, then the page whole (`overviewPaints`): on the menu's own rule and patience, so the
  // menu and the overview land together. Content stays mounted under the wait: its reads go on.
  const sourcesSettled = useMenuRows(NO_ROWS).settled;
  const [standing, latchPainted] = usePaintStanding(activeOrganization?.id);
  const paints =
    !scoped ||
    overviewPaints({
      listing,
      sourcesSettled,
      waitedOut: standing.waitedOut,
      drawn: standing.drawn,
      troubled: error !== null,
    });
  latchPainted(scoped && paints);
  // First run owns the page: an account with nothing in it gets the
  // invitation and no title row over it — a "Projects" heading with a reload
  // over nothing frames emptiness as a failed list.
  const presses = useMatePresses();
  const made = useCreations();
  const accountHq = useAccountHq(activeOrganization?.id);
  const firstRun = hasNoZeropsProject({
    listing,
    creationPending: [...presses, ...made].some(
      (birth) => birth.organizationId === activeOrganization?.id,
    ),
    hqProjectId: accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined,
  });

  return (
    // The account and its organization are the menu's foot, and the list keeps itself current: the
    // overview's top carries neither a switcher nor a reload, nor an empty bar above its title (the
    // owner, 2026-10-11).
    <ZeropsHostedFrame bar={false} width="full">
      {paints ? null : <OverviewStandInBody />}
      {scoped && !firstRun && paints ? (
        <ZeropsProjectsHeader
          newProject={roleOffered.newProject}
          notice={projectsFreshnessNotice(listing, nowMs)}
          onRetry={refresh}
        />
      ) : null}
      <div className={paints ? "contents" : "hidden"} inert={!paints}>
        <ZeropsProjectsContent
          onShow={inPanel ? setPanelShow : undefined}
          painted={paints}
          search={search}
        />
      </div>
    </ZeropsHostedFrame>
  );
}
