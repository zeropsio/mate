import { RestartMateWarning } from "~/zerops/RestartMateConfirmation";
import { ZeropsThrowawayCleanup } from "./ZeropsThrowawayCleanup";
import { ZeropsDeletionRecovery } from "./ZeropsDeletionRecovery";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useZeropsUpgradeRestart, type UpgradeRecovery } from "~/zerops/useZeropsUpgradeRestart";
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
import { type OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MateMarkState } from "@t3tools/shared/brand";
import { ArrowDownUpIcon, PlayIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { environmentsWithSnapshotAtom } from "~/state/shell";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import { useEnvironmentOffers } from "~/zerops/useAddEnvironment";
import { hqPlacementsAtom, hqNavigationAtom } from "~/state/zerops";
import {
  PROJECT_ORDER_CHOICES,
  readProjectsOnScreen,
  useProjectOrder,
  useProjectOrderOptions,
} from "~/zerops/projectOrderPreference";
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
import { NOTHING_DEPLOYED, stopTone } from "@t3tools/client-runtime/zerops/flow";
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
import { askNewProject } from "~/zerops/newProjectAsk";
import { useEnvironmentCreation } from "~/zerops/useEnvironmentCreation";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
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
import { useZeropsThrowawaySweep } from "~/zerops/useZeropsThrowawaySweep";
import { useZeropsSession, type ZeropsSessionStatus } from "~/zerops/ZeropsSessionProvider";
import { withheldProjectNotices } from "~/zerops/inventoryContext";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { useProjectCreations } from "~/zerops/useProjectCreations";
import { useZeropsFirstBuilds } from "~/zerops/useZeropsFirstBuilds";
import { drawnMateProjects, useVisibleProjectAccess } from "~/zerops/useVisibleProjectAccess";
import { useNowMs } from "~/zerops/useNowMs";
import { mateUpdateStatus } from "~/zerops/mateUpdate";
import { useZeropsMateUpdateStates } from "~/zerops/useZeropsMateUpdate";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useZeropsData } from "~/zerops/zeropsDataContext";
import { submitZeropsWrite } from "~/zerops/zeropsWrite";
import type { AuthGateState } from "~/environments/primary/auth";
import {
  activityOfNow,
  mateFaceOf,
  mateReviewWaits,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import type { ZeropsRowPresentation } from "./ZeropsProjectRow.logic";

import {
  changeKindTag,
  changeState,
  firstReleaseHandoff,
  assignCandidateMateTints,
  buildZeropsGroupTree,
  mateShapeOf,
  newMateTint,
  deployWord,
  rankZeropsCandidateForListing,
  readZeropsToolKind,
  defaultAgentForRole,
  hasMate,
  groupFlow,
  pullRequestLineWith,
  releaseContentsCommits,
  type FlowPullRequest,
  projectNameInApp,
  readZeropsMembership,
  type EnvironmentCreationStepProgress,
  type EnvironmentRow,
  type GroupEnvironmentTier,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsMembership,
  firstDeployLine,
  type FirstDeploy,
  matePoseOf,
} from "@t3tools/client-runtime/zerops";
import { invalidateZerops } from "~/zerops/accountInvalidations";

import { MateFace, MicroLabel, StatusDot } from "./primitives";
import { stopLinkOf, ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsMateBirthLine } from "./ZeropsBirthProgress";
import { ZeropsHqCard } from "./ZeropsHqCard";
import { ZeropsMateCard, ZeropsMateVerb } from "./ZeropsMateCard";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { MateUpdateStatusText } from "./MateUpdateLine";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useMateRowActivity } from "~/zerops/useMenuMateReadings";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import { ZeropsEnvironmentCreation } from "./ZeropsEnvironmentCreation";
import {
  ZeropsEnvironmentCreationDialog,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import { creationRecipe, proposedEnvironmentName } from "./ZeropsEnvironmentCreationDialog.logic";
import { ZeropsProjectMenu, type ZeropsMenuAction } from "./ZeropsProjectMenu";
import { ZeropsDeleteProjectDialog } from "./ZeropsDeleteProjectDialog";
import { ZeropsProjectRenameMenu } from "./ZeropsProjectRenameMenu";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useMateOffers, useOrgOffers } from "~/zerops/useHqOffers";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { officialHq, useAccountHq } from "~/zerops/accountHq";
import { useEnvironmentSetup } from "~/zerops/useEnvironmentSetup";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useProjectFlows, useStopDeploymentsShown } from "~/zerops/projectFlows";
import { REVIEW_LABEL, REVIEW_RELEASE_LABEL, useOpenReview } from "~/zerops/review";
import { useReadGroupAgents } from "~/zerops/groupAgents";
import { deployRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsSetUpMateDialog } from "./ZeropsSetUpMateDialog";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";
import { ZeropsReleaseVerb } from "./ZeropsGroupDetail";
import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";
import {
  creatableRoles,
  environmentRoleLabel,
  environmentRoleTag,
  groupNameUnread,
} from "./ZeropsGroupTree.logic";
import { ZeropsProjectsFlow, type ProjectsFlowGroup } from "./projects/ZeropsProjectsFlow";
import {
  changeRowVerb,
  changesUnknownOf,
  flowStepsAwaiting,
  groupFlowInputOf,
  groupMemberFactsOf,
  lastMergedCode,
  parseProjectsSearch,
  rowMateActivitiesOf,
  withoutOfficialHq,
  shownUngrouped,
  type ProjectsSearch,
} from "./projects/projectsView.logic";
import {
  applicationContents,
  deleteOffered,
  emptyApplications,
  groupIsEmpty,
} from "./projects/emptyApps.logic";
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
import { ZeropsOrganizationScope, ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { PageWaitLine } from "./WaitLine";
import { BOOT_WAIT_LINE_MS } from "~/zerops/waitLine.logic";

/** One creation in flight, or just finished, on this screen. */
interface EnvironmentCreationView {
  readonly name: string;
  /** What was asked for, so the closing line knows where a first deploy comes from. */
  readonly tier: NonNullable<React.ComponentProps<typeof ZeropsEnvironmentCreation>["tier"]>;
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly outcome?: NonNullable<React.ComponentProps<typeof ZeropsEnvironmentCreation>["outcome"]>;
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

/**
 * Takes a project the platform failed to create off the account. The delete
 * comes first; only once the platform has accepted it is the project's birth
 * forgotten (nothing will ever connect to this project) and the list re-read.
 * A refused delete leaves both as they were, so the row keeps offering the
 * verb and says why it did not work.
 */
export async function removeFailedZeropsProject(input: {
  readonly projectId: string;
  /** The organization the project was in, whose inventory is read again. */
  readonly organization: OrganizationRef;
  readonly deleteProject: (projectId: string) => Promise<unknown>;
  readonly forgetCreation: (projectId: string) => void;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  try {
    await input.deleteProject(input.projectId);
  } catch (cause) {
    return { ok: false, error: zeropsErrorMessage(cause) };
  }
  input.forgetCreation(input.projectId);
  invalidateZerops({ topic: "inventory", organization: input.organization });
  return { ok: true };
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
}): boolean {
  if (input.creationPending === true) return false;
  // A tool is not a project: the tree lists it apart (`partitionZeropsToolProjects`).
  return listsNoProject(
    input.listing,
    (candidate) => readZeropsToolKind(candidate.project) === undefined,
  );
}

/**
 * Whether a Mate opens where the page draws it — its card, its name in a
 * project's row, its tile — and how. A ready one opens (connecting first when
 * it is not connected yet); one coming up and one whose verb is already
 * running are still: nothing a click could do that the page is not already
 * doing.
 */
export function mateOpener(input: {
  readonly busy: boolean;
  readonly action: ZeropsRowAction["kind"];
  readonly open: () => void;
}): (() => void) | undefined {
  return !input.busy && input.action === "open" ? input.open : undefined;
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
}): string | undefined {
  if (input.placeholder) return "Couldn't read this project's name";
  if (input.finishing !== undefined) return `Finishing ${input.finishing}…`;
  if (input.unfinished !== undefined) return `Couldn't finish setting up ${input.unfinished}`;
  if (input.halfMade !== undefined) return `Setting up ${input.halfMade} isn't finished`;
  return undefined;
}

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/**
 * The page's title row: the title, then the sort and the reload as a glyph.
 * No creating action here — the left menu's
 * "New project" is the entry, and a filled pill beside the title was the
 * loudest thing on a page whose loud thing should be the Mate. No sentence
 * under the title either: the projects below say what the page is.
 */

/**
 * How the page and the left sidebar tree (`SidebarZeropsTree.tsx`) order
 * their projects — a per-browser preference, not project state
 * (`projectOrderPreference.ts`), read and written live so both surfaces turn
 * around together the moment it changes. *Custom* starts from the order on
 * screen; the account menu offers the same three.
 */
function ZeropsProjectOrderControl() {
  const control = useProjectOrder();
  return (
    <Select
      onValueChange={(value) => {
        const choice = PROJECT_ORDER_CHOICES.find((entry) => entry.value === value);
        if (choice !== undefined) control.choose(choice.value, readProjectsOnScreen());
      }}
      value={control.order}
    >
      <SelectTrigger
        aria-label="Sort projects"
        className="w-auto min-w-0"
        size="sm"
        variant="ghost"
      >
        <ArrowDownUpIcon className="size-3.5" />
        <SelectValue>
          {PROJECT_ORDER_CHOICES.find((choice) => choice.value === control.order)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        {PROJECT_ORDER_CHOICES.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function ZeropsProjectsHeader({
  onRefresh,
  refreshing = false,
}: {
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      data-zerops-project-scope="true"
    >
      <h1 className="text-xl font-medium text-foreground">Projects</h1>
      <div className="flex items-center gap-2">
        <ZeropsProjectOrderControl />
        {onRefresh === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Refresh"
                  className="text-muted-foreground"
                  disabled={refreshing}
                  onClick={onRefresh}
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <RotateCcwIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Refresh</TooltipPopup>
          </Tooltip>
        )}
      </div>
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

  const upgradeRecovery = useZeropsUpgradeRestart(
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

function ZeropsProjectsContent({ search }: { readonly search: ProjectsSearch }) {
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
  const navigate = useNavigate();
  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);

  const [toolError, setToolError] = useState<string | null>(null);
  const [creation, setCreation] = useState<EnvironmentCreationView | null>(null);
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
  const hqStructure = useAtomValue(hqNavigationAtom);
  // Whether HQ's structure is known: only then does a Mate it places nowhere have no record.
  const hqKnown = useAtomValue(hqPlacementsAtom) !== null && hqStructure.live;
  const groupTree = buildZeropsGroupTree(candidates, {
    rank: rankZeropsCandidateForListing,
    ...projectOrder,
    births: placedPressesIn(
      presses,
      activeOrganization?.id,
      placedNewProjects(made, activeOrganization?.id),
    ),
    apps: emptyApplications(hqStructure, activeOrganization?.id),
  });
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  // Each Mate as its menu row reads it: HQ's word of it, or its socket's.
  const activityOf = useMateRowActivity(useMatesActivity());
  const updates = useZeropsMateUpdateStates();
  const withConversations = useAtomValue(environmentsWithSnapshotAtom);
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
  const accountHq = useAccountHq(activeOrganization?.id);
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
          candidate.environments.some(({ item }) => item.project.id === projectId),
        );
        const agents = group === undefined ? [] : await readGroupAgents(group.environments);
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
    | { readonly kind: "delete-group"; readonly group: ZeropsGroup }
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
      // Opening a Mate that is not connected yet connects first: the wait
      // lands in the conversation when the container answers.
      case "open":
        if (candidate.environmentId) {
          void navigate({ to: "/", search: { environmentId: String(candidate.environmentId) } });
          return;
        }
        open(candidate);
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
  const addsOfferedFor = useCallback(
    (group: ZeropsGroup) =>
      groupAddsOffered(
        groupTree.groups.find((entry) => entry.group.groupId === group.groupId)?.environments ?? [],
        candidateHealth,
      ),
    [candidateHealth, groupTree.groups],
  );

  // Which tiers HQ offers this person to add to the group (`add_stage` / `add_production`).
  const environmentOffers = useEnvironmentOffers();

  // "Add stage" opens the form; the form's answer is what gets created.
  const [creationRequest, setCreationRequest] = useState<{
    readonly groupId: string;
    readonly role: ZeropsEnvironmentRole;
  } | null>(null);
  const requestedGroup = useMemo(
    () =>
      creationRequest === null
        ? undefined
        : groupTree.groups.find((entry) => entry.group.groupId === creationRequest.groupId),
    [creationRequest, groupTree.groups],
  );
  // The registry — which groups exist and which projects are in them (ADR 0002), read from HQ.
  const registryState = useZeropsRegistry();
  // What each application released and landed is its detail: held while the page draws it.
  useHqAppDetailHold(registryState.registry.groups.map(({ groupId }) => groupId));

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
  const projectFlow = useProjectFlows("every");
  const verbs = useFlowVerbs();
  const deployments = useStopDeploymentsShown();
  // What HQ's rule shows this person of each project's changes: a project listed to them whose
  // changes it does not says so in their steps, never "None yet".
  const changeOffersOf = useChangeOffers();

  /**
   * The face a Mate wears (`mateFaceOf`): the state of its conversation while a word of now says
   * it — HQ's, or its socket's — else asleep, and needing you while its own change waits for your
   * review, as its row in the menu and its conversation's composer say.
   */
  const mateFace = (candidate: ZeropsCandidatePresentation): MateMarkState => {
    const groupId = readZeropsMembership(candidate.project).groupId;
    return mateFaceOf({
      connected: candidate.group === "connected" && candidate.environmentId !== undefined,
      activity: activityOf(candidate),
      reviewWaits: mateReviewWaits(
        groupId === undefined ? undefined : projectFlow.flows.get(groupId),
        candidate.project.id,
      ),
      mine: projectPeople[candidate.project.id]?.waitsOnViewer === true,
      // Waking while it comes up and arrives, as its row in the menu.
      pose: matePoseOf(candidate, nowMs),
    });
  };
  const openReview = useOpenReview();
  const groupDeploys = projectFlow.flows;
  // A production just added is the intent to release (P7): the application whose production came
  // up waits here until HQ holds it and the gate says whether its first release is the person's to
  // review, which then opens by itself (`firstReleaseHandoff`). Its release is compared meanwhile.
  const [handoffTo, setHandoffTo] = useState<{
    readonly groupId: string;
    readonly projectId: string;
  } | null>(null);
  const handoffFlows = useProjectFlows(
    useMemo(() => (handoffTo === null ? [] : [handoffTo.groupId]), [handoffTo]),
    { compare: true },
  ).flows;
  useEffect(() => {
    if (handoffTo === null) return;
    const flow = handoffFlows.get(handoffTo.groupId);
    if (flow === undefined) return;
    const verdict = firstReleaseHandoff({
      // The project this press made, never another production that comes up later.
      hasProduction: flow.environments.some(
        (entry) => entry.tier === "production" && entry.projectId === handoffTo.projectId,
      ),
      gate: flow.release.gate,
    });
    if (verdict === "wait") return;
    setHandoffTo(null);
    if (verdict === "open") openReview({ kind: "release", groupId: handoffTo.groupId });
  }, [handoffFlows, handoffTo, openReview]);

  /**
   * The environment row of one Zerops project, when HQ records it as one of an
   * application's environments. A project HQ records as none is not a group
   * environment and keeps the row it always had.
   */
  const declaredEnvironment = useCallback(
    (projectId: string) => {
      for (const state of groupDeploys.values()) {
        const found = state.environments.find((entry) => entry.projectId === projectId);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    [groupDeploys],
  );

  /** Each Mate's name, for a pull request's line: its project's name under its application. */
  const mateNames = useMemo(
    () =>
      new Map(
        groupTree.groups.flatMap(({ environments }) =>
          environments.map(
            ({ item }) => [item.project.id, projectNameInApp(item.project)] as const,
          ),
        ),
      ),
    [groupTree.groups],
  );

  /**
   * Why *Release* is not offered, when a production is declared and it is
   * not: a verb that is missing says nothing (`release.ts`).
   */
  const releaseGateLine = (group: ZeropsGroup) => {
    const flow = groupDeploys.get(group.groupId);
    if (flow === undefined || flow.release.gate.allowed) return null;
    if (!flow.environments.some((entry) => entry.tier === "production")) return null;
    return (
      <li
        className="py-1.5 text-xs text-muted-foreground"
        data-zerops-surface="release-gate"
        key={`release-gate-${group.groupId}`}
      >
        {flow.release.gate.reason}
      </li>
    );
  };

  /**
   * What pressing *Release* would carry, under the row that offers it: one
   * line per commit `main` has that the production is not running, which with
   * squash merges is one line per task delivered (the owner, 2026-09-18 — "it
   * would be great if you could show like what is it going to release, the PRs
   * that it contains"). Nothing is drawn where a release would move nothing.
   */
  const releaseContentLines = (group: ZeropsGroup) => {
    const flow = groupDeploys.get(group.groupId);
    if (flow === undefined || !flow.release.gate.allowed) return null;
    // One commit several services take is one change (`releaseContentsCommits`).
    const commits = releaseContentsCommits(flow.release.contents);
    if (commits.length === 0) return null;
    // Led in by what they are, one entry of the list: a sha and a subject
    // alone read as a stray commit.
    return (
      <li className="flex min-w-0 flex-col gap-0.5 py-1.5" key={`release-content-${group.groupId}`}>
        <MicroLabel className="text-muted-foreground">Release carries</MicroLabel>
        {commits.map((commit) => (
          <span
            className="flex min-w-0 gap-2 text-xs text-muted-foreground"
            data-zerops-surface="release-content"
            key={commit.sha}
          >
            <span className="font-mono tabular-nums">{commit.sha.slice(0, 7)}</span>
            <span className="truncate">{commit.subject}</span>
          </span>
        ))}
      </li>
    );
  };

  /**
   * One pull request's row, wherever it is drawn. Its verb is *Review*, the one
   * door to merging (pass 16, R1): the review reads the change, says whether it
   * is safe and carries *Merge* — nothing merges from a row, which says
   * "Merging…" while the review's merge is under way. `withMerge` is false where
   * the project's next step already offers that door on it: one verb, once.
   * `compact` stacks title, state and verb for a flow step's narrow column.
   */
  const pullRequestRowOf = (
    group: ZeropsGroup,
    pull: FlowPullRequest,
    {
      withMerge,
      review,
      compact,
    }: { readonly withMerge: boolean; readonly review: boolean; readonly compact: boolean },
  ) => {
    // One vocabulary down the column, the same one the project's own page and
    // the left menu use (`changeState`): a change that no longer merges is the
    // one a person needs to see.
    const state = changeState(pull);
    // A draft, or a change the Mate's working run still writes, stays listed and opens from its
    // title; it asks for no review (`changeShowsReview`).
    const action =
      withMerge && review ? (
        <ZeropsMateVerb
          label={changeRowVerb(verbs.pending, group.groupId, pull)}
          onClick={(event) => {
            openReview(
              {
                kind: "change",
                groupId: group.groupId,
                repository: pull.repository,
                number: pull.number,
              },
              { from: event.currentTarget },
            );
          }}
        />
      ) : undefined;
    const key = `pull-${group.groupId}-${pull.repository}-${pull.number}`;
    const line = pullRequestLineWith(pull, mateNames.get(pull.mateProjectId));
    const open = () => {
      void navigate({
        to: "/change/$groupId/$repository/$number",
        params: {
          groupId: group.groupId,
          repository: pull.repository,
          number: String(pull.number),
        },
      });
    };
    const status =
      state === undefined ? undefined : <StatusDot label={state.word} sentence tone={state.tone} />;
    if (compact) {
      return (
        <li className="flex min-w-0 flex-col items-start gap-0.5 py-1.5" key={key}>
          <button
            className="min-w-0 max-w-full truncate rounded-sm text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-surface="pull-request-title"
            onClick={open}
            type="button"
          >
            <span className="text-muted-foreground">#{pull.number}</span> {pull.title}
          </button>
          {/* The check's word is never cut; only what the change is gives way. */}
          <span className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
            {status === undefined ? null : <span className="flex shrink-0">{status}</span>}
            <span className="min-w-0 truncate">{line}</span>
          </span>
          {action}
        </li>
      );
    }
    return (
      <ZeropsPullRequestRow
        action={action}
        key={key}
        line={line}
        onOpen={open}
        status={status}
        tag={changeKindTag(pull)}
        title={pull.title}
      />
    );
  };

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
      setCreation({ name: choice.name, tier: tier ?? "mate", progress: [] });
      const run = await runCreation({
        group: entry.group,
        environments: entry.environments,
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
          : { ...current, outcome: { kind: "done", deployments: outcome.deployments } },
      );
      if (role === "prod") setHandoffTo({ groupId, projectId: outcome.projectId });
    },
    [activeOrganization, creationRunning, groupTree.groups, runCreation, setConnectError],
  );

  // A stage or a production whose creation lost its last writes is said on its project's row and
  // finished from its menu, when the person asks (`useEnvironmentSetup`).
  const { halfMade, finishing } = useEnvironmentSetup(
    useMemo(() => candidates.map(({ project }) => project.id), [candidates]),
  );

  // Persisted cleanup debt is restored after a crash, once inventory admits the account.
  const throwawayCleanup = useZeropsThrowawaySweep({
    clientId: activeOrganization?.id,
    // Cleanup waits for the account inventory; its operation fences every write on sign-in.
    enabled: status === "signed-in" && !inventory.isLoading,
  });

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
      <Button onClick={refreshCandidates} size="sm" variant="outline">
        {listingNotice.affordance.label}
      </Button>
    );

  /** Each environment's role in its group, for the card and the row that draw it. */
  const roleOf = new Map(
    groupTree.groups.flatMap(({ environments }) =>
      environments.map(({ item, role }) => [item.project.id, role] as const),
    ),
  );

  const mateOpenerOf = (candidate: ZeropsCandidatePresentation): (() => void) | undefined =>
    mateOpener({
      busy: busyKeys.has(candidate.key),
      action: deriveZeropsRowAction(rowInput(candidate, roleOf.get(candidate.project.id))).kind,
      open: () => {
        runRowAction(candidate, "open");
      },
    });

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
              size="compact"
              variant="outline"
            >
              {busy ? (action.kind === "remove" ? "Removing…" : "Setting up…") : action.label}
            </Button>
          ) : undefined
        }
        busy={busy}
        // A group's stage or production: its name opens the stop's page.
        link={stopLinkOf(tags.groupId, candidate.project.id, role)}
        menu={renderEnvironmentMenu(candidate, tags, false)}
        // By its own name under its application (`projectNameInApp`).
        name={projectNameInApp(candidate.project)}
        status={
          projectTrouble ? (
            <StatusDot
              label={presentation.status.label}
              sentence
              tone={presentation.status.tone}
              {...(presentation.status.pulse === undefined
                ? {}
                : { pulse: presentation.status.pulse })}
            />
          ) : deployTone !== undefined && deployLabel !== undefined ? (
            <StatusDot label={deployLabel} sentence tone={deployTone} />
          ) : undefined
        }
        // A project the platform failed to create holds nothing; its
        // line is what happened, not "No services yet".
        summary={
          candidate.creationFailed !== undefined
            ? presentation.detail
            : declared === undefined
              ? summaryOf(candidate)
              : declaredEnvironmentSummary(declared, firstDeployOf(candidate.project.id))
        }
        tag={environmentRoleTag(role)}
      />
    );
  };

  const renderMate = (
    candidate: ZeropsCandidatePresentation,
    { layout, preview }: { readonly layout: "card" | "row"; readonly preview: string | undefined },
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
          size="compact"
          variant="outline"
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
          size="compact"
          variant="outline"
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
              preview={preview}
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
        preview={preview}
        shape={shape}
        tint={tint}
      />
    );
  };

  /**
   * A project's own quiet actions: its name, and the environments a person
   * adds to it — another Mate, and a stage and a production as equals: neither
   * is optional, neither comes before the other, and each is offered where the
   * role is still there to take (`creatableRoles`) and HQ offers it to this
   * person (`useEnvironmentOffers`).
   */
  const renderGroupMenu = ({ group, flow }: ProjectsFlowGroup<ZeropsCandidatePresentation>) => {
    // Each Mate's preview, where its pair has one: a link out, so the menu's, not the row's.
    const previews = flow.mates.flatMap((mate) =>
      mate.preview === undefined ? [] : [{ name: mate.name, url: mate.preview }],
    );
    return (
      <ZeropsProjectRenameMenu
        actions={[
          ...previews.map((preview) => ({
            id: `preview:${preview.name}`,
            label: previews.length === 1 ? "Open preview" : `Open ${preview.name}’s preview`,
            onSelect: () => {
              window.open(preview.url, "_blank", "noopener,noreferrer");
            },
          })),
          ...(previews.length === 0 ? [] : [{ id: "previews-end", separator: true as const }]),
          // A project with nothing in it is offered its first Mate, and nothing more.
          ...(groupIsEmpty(group)
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
                  disabled: creationRunning,
                  onSelect: () => {
                    requestEnvironment(group.groupId, "dev");
                  },
                },
              ]
            : []),
          ...(environmentOffers(group.groupId)?.stage === true &&
          !groupIsEmpty(group) &&
          creatableRoles(group).includes("stage")
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
          ...(environmentOffers(group.groupId)?.production === true &&
          !groupIsEmpty(group) &&
          creatableRoles(group).includes("prod")
            ? [
                {
                  id: "add-production",
                  label: "Add production",
                  disabled: creationRunning,
                  onSelect: () => {
                    requestEnvironment(group.groupId, "prod");
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
          // A project with nothing in it goes, at whoever writes the structure's word.
          ...(deleteOffered(
            group,
            orgOffer("delete_app").kind !== "refused",
            applicationContents(hqStructure, activeOrganization?.id, group.groupId),
          )
            ? [
                {
                  id: "delete-group",
                  label: `Delete ${group.name}…`,
                  variant: "destructive" as const,
                  // While HQ has not said or does not answer, drawn and not pressable.
                  disabled: orgOffer("delete_app").kind !== "allowed",
                  onSelect: () => {
                    setRowDialog({ kind: "delete-group", group });
                  },
                },
              ]
            : []),
        ]}
        group={group}
      />
    );
  };

  /**
   * The rows of a project that are not one of its four steps: why *Release*
   * is not offered, what it would carry and the releases (each with the way back
   * to it). `null` where it has none.
   */
  const renderGroupRows = (group: ZeropsGroup): React.ReactNode => {
    const gate = releaseGateLine(group);
    const contents = releaseContentLines(group);
    const releases = groupDeploys.get(group.groupId)?.releases ?? [];
    if (gate === null && contents === null && releases.length === 0) return null;
    return (
      <>
        {gate}
        {contents}
        <ZeropsReleaseRows
          groupId={group.groupId}
          onRollBack={(tag, from) => {
            openReview({ kind: "rollback", groupId: group.groupId, tag }, { from });
          }}
          pending={verbs.pending}
          releases={releases}
        />
      </>
    );
  };

  /**
   * The verb of a project's next step, where the step says one (`groupFlow`).
   * Each acts on the thing it names: a Mate opens, a failed deploy's build opens
   * its page, a change — one to merge or one that cannot land — and a release
   * open their review (pass 16, R1).
   */
  const renderNextStep = (
    entry: ProjectsFlowGroup<ZeropsCandidatePresentation>,
  ): React.ReactNode => {
    const { group, flow } = entry;
    const step = flow.nextStep;
    const target = step.target;
    if (step.verb === undefined || target === undefined) return null;
    const verb = (onClick: (from: HTMLElement) => void, disabled = false, label = step.verb) => (
      <Button
        data-zerops-next-step-verb={step.kind}
        disabled={disabled}
        onClick={(event) => {
          onClick(event.currentTarget);
        }}
        size="compact"
        variant="outline"
      >
        {label}
      </Button>
    );
    switch (target.kind) {
      case "release":
        // The door to the release's review, which names the version and tags it.
        return <ZeropsReleaseVerb groupId={group.groupId} label={step.verb} />;
      case "mate": {
        const mate = entry.mates.get(target.projectId);
        if (mate === undefined) return null;
        return verb(() => {
          runRowAction(mate, "open");
        }, busyKeys.has(mate.key));
      }
      case "stop":
        return verb(() => {
          void navigate({
            to: "/group/$groupId/$projectId",
            params: { groupId: group.groupId, projectId: target.projectId },
          });
        });
      case "change":
        // One to merge and one that cannot land open the same review: it says
        // what blocks it and hands the fix to the Mate that wrote it.
        return verb(
          (from) => {
            openReview(
              {
                kind: "change",
                groupId: group.groupId,
                repository: target.repository,
                number: target.number,
              },
              { from },
            );
          },
          false,
          REVIEW_LABEL,
        );
    }
  };

  // Every group's flow, from the one derivation the thread and the left menu
  // read too (`groupFlow`): what each step holds and the one next step.
  const flowGroups = groupTree.groups.map(
    ({ group, environments }): ProjectsFlowGroup<ZeropsCandidatePresentation> => {
      const reads = groupDeploys.get(group.groupId);
      const changesUnknown = changesUnknownOf({
        offers: changeOffersOf(group.groupId),
        changesFailure: reads?.changesFailure,
      });
      const awaiting = flowStepsAwaiting({
        read: reads !== undefined,
        changesKnown: reads?.changesKnown === true,
        changesUnknown,
        // Out and expected back: an HQ is open, whose stream tells its changes.
        readOut: projectFlow.hqAddress !== undefined,
      });
      const conversationsRead = (item: ZeropsCandidatePresentation) =>
        item.environmentId !== undefined && withConversations.has(item.environmentId);
      const members = groupMemberFactsOf(
        environments,
        activityOf,
        conversationsRead,
        (projectId) => projectPeople[projectId]?.waitsOnViewer === true,
      );
      const isStop = (role: ZeropsEnvironmentRole | undefined) =>
        role === "stage" || role === "prod";
      const placeholder = groupNameUnread(group);
      return {
        group,
        contents: applicationContents(hqStructure, activeOrganization?.id, group.groupId),
        flow: groupFlow(
          groupFlowInputOf({
            groupId: group.groupId,
            members,
            flow: reads,
            deployments,
            pending: group.pending,
          }),
        ),
        activities: rowMateActivitiesOf(
          environments.flatMap(({ item }, index) => {
            const name = members[index]?.mate?.name;
            return name === undefined ? [] : [{ item, name }];
          }),
          activityOf,
        ),
        awaiting: awaiting.steps,
        changesAwaiting: awaiting.changes,
        changesUnknown,
        mates: new Map(
          environments
            .filter(({ item }) => hasMate(item))
            .map(({ item }) => [item.project.id, item] as const),
        ),
        stops: new Map(
          environments
            .filter(({ role }) => isStop(role))
            .map((entry) => [entry.item.project.id, entry] as const),
        ),
        others: environments.filter(({ item, role }) => !hasMate(item) && !isStop(role)),
        lastMerged: reads === undefined ? undefined : lastMergedCode(reads.merged),
        // Visible rather than a tooltip: a name HQ holds that could not be
        // read is a read problem, said where the name would be.
        line: projectsGroupLine({
          placeholder,
          unfinished: finishing.unfinished.get(group.groupId),
          finishing: finishing.finishing.get(group.groupId),
          halfMade: halfMade.find((entry) => entry.groupId === group.groupId)?.tier,
        }),
        placeholder,
      };
    },
  );
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
      {status === "signed-in" && activeOrganization !== null && !inventory.isLoading ? (
        <>
          <ZeropsThrowawayCleanup view={throwawayCleanup} />
          <ZeropsDeletionRecovery />
        </>
      ) : null}
      {listingNotice === null ? null : listingNotice.region === "placeholder" ? (
        // Nothing read yet: the one wait line at the page's centre, where the boot frame said it.
        <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="mount" text={listingNotice.message.text} />
      ) : listingNotice.region === "message" ? (
        <div
          className="flex items-center gap-3 rounded-md border border-[var(--zerops-status-failed)]/40 bg-[var(--zerops-status-failed-surface)] px-3 py-2 text-sm text-[var(--zerops-status-failed-text)]"
          role="alert"
        >
          <span>{listingNotice.message.text}</span>
          {listingAffordance}
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center gap-2 text-xs text-muted-foreground",
            // A placeholder waits a beat before it says anything, so a quick
            // answer never flickers it.
            listingNotice.message.afterMs > 0 && "animate-zerops-appear",
          )}
          role="status"
          style={
            listingNotice.message.afterMs > 0
              ? { animationDelay: `${listingNotice.message.afterMs}ms` }
              : undefined
          }
        >
          <Spinner size="sm" />
          <span>{listingNotice.message.text}</span>
          {listingAffordance}
        </div>
      )}
      {pageError === null ? null : (
        <div
          className="rounded-md border border-[var(--zerops-status-failed)]/40 bg-[var(--zerops-status-failed-surface)] px-3 py-2 text-sm text-[var(--zerops-status-failed-text)]"
          role="alert"
        >
          {pageError}
        </div>
      )}
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
      <ZeropsProjectsFlow
        creating={creationRunning}
        focusGroup={search.group}
        getKey={(candidate: ZeropsCandidatePresentation) => candidate.key}
        groups={flowGroups}
        isMate={hasMate}
        onCreateProject={
          hasNoZeropsProject({ listing, creationPending: activeBirths }) ? askNewProject : undefined
        }
        hqCard={<ZeropsHqCard />}
        openMate={mateOpenerOf}
        onRetryContainers={(items) => {
          for (const candidate of items) runRowAction(candidate, "retry-probe");
        }}
        renderEnvironment={renderEnvironment}
        renderGroupMenu={renderGroupMenu}
        renderGroupRows={renderGroupRows}
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
        renderNextStep={renderNextStep}
        renderPullRequest={pullRequestRowOf}
        renderReleaseVerb={({ group, flow }) => {
          const { production } = flow;
          const candidate =
            production.kind === "ready-to-release" || production.kind === "deploy-failed"
              ? production.candidate
              : undefined;
          if (candidate === undefined) return null;
          return <ZeropsReleaseVerb groupId={group.groupId} label={REVIEW_RELEASE_LABEL} />;
        }}
        ungrouped={ungroupedRows}
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
      {creationRequest === null || requestedGroup === undefined ? null : (
        <ZeropsEnvironmentCreationDialog
          tier={groupRecipe.tier}
          tierServices={groupRecipe.services}
          recipe={creationRecipe(groupRecipe)}
          recipeRereading={groupRecipe.rereading}
          onRecipeRetry={groupRecipe.reread}
          defaultName={proposedEnvironmentName({
            groupName: requestedGroup.group.name,
            roleLabel:
              environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
            taken: requestedGroup.environments.map(({ item }) => item.project.name),
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
      {creation === null ? null : (
        <ZeropsEnvironmentCreation
          name={creation.name}
          nowMs={creationNowMs}
          onDismiss={() => {
            setCreation(null);
          }}
          progress={creation.progress}
          tier={creation.tier}
          {...(creation.outcome === undefined ? {} : { outcome: creation.outcome })}
        />
      )}
      {trouble === null ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </div>
  );
}

export function ZeropsProjectsPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  // The same page is the signed-in door at `/`, so the search is read loosely
  // and through the route's own parser.
  const search = parseProjectsSearch(useSearch({ strict: false }));
  const { listing, isLoading, refresh } = useZeropsCandidates();
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  // First run owns the page: an account with nothing in it gets the
  // invitation and no title row over it — a "Projects" heading with a reload
  // over nothing frames emptiness as a failed list.
  const presses = useMatePresses();
  const made = useCreations();
  const firstRun = hasNoZeropsProject({
    listing,
    creationPending: [...presses, ...made].some(
      (birth) => birth.organizationId === activeOrganization?.id,
    ),
  });

  return (
    <ZeropsHostedFrame
      width="expanded"
      actions={
        <>
          {scoped ? (
            <ZeropsOrganizationSwitcher
              activeOrganization={activeOrganization}
              organizations={organizations}
              onSelect={(membershipId) => {
                void selectOrganization(membershipId);
              }}
            />
          ) : null}
          <ZeropsSessionAccountControl />
        </>
      }
    >
      {scoped && !firstRun ? (
        <ZeropsProjectsHeader onRefresh={refresh} refreshing={isLoading} />
      ) : null}
      <ZeropsProjectsContent search={search} />
    </ZeropsHostedFrame>
  );
}
