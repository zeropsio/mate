import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useZeropsUpgradeRestart, type UpgradeRecovery } from "~/zerops/useZeropsUpgradeRestart";
/**
 * `/zerops` — the project picker for a signed-in Zerops account: an existing
 * candidate to connect to or wait on, and a way to `/zerops/new` (also where
 * an exhausted pool falls back to, since that phase has nothing ready-made to
 * pick). Creating a project happens at that route, not here.
 */

import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  ZeropsServiceId,
  type OrganizationRef,
  type ServiceAuthorizedAgentsResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MateMarkState } from "@t3tools/shared/brand";
import { ArrowDownUpIcon, PlayIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useProjectOrderPreference } from "~/zerops/projectOrderPreference";
import {
  applyProjectCreationVerdict,
  normalizeOrigin,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  resolveMateOwnerName,
  resolveMateVerbs,
  resolveMateVisibility,
  type MateVerbs,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { NOTHING_DEPLOYED } from "@t3tools/client-runtime/zerops/flow";
import {
  knownPresentation,
  type KnownAffordance,
  type KnownMessage,
  type KnownPresentation,
  type KnownSurface,
  type Shown,
} from "@t3tools/client-runtime/zerops/knowledge";
import {
  heldCandidates,
  listsNoProject,
  takenBotNames,
  type TakenBotNames,
} from "@t3tools/client-runtime/zerops/projections";
import { deriveProvisioningStart } from "@t3tools/client-runtime/zerops/registrationHandoff";
import { useAddMateIntent } from "~/zerops/addMateIntent";
import { useConnectMate, type MateConnectTarget } from "~/zerops/accountEnvironments";
import { intendContainer, useZeropsContainers } from "~/zerops/zeropsContainers";
import {
  beginBirth,
  birthEnabled,
  birthWithoutContainer,
  bornOnAccept,
  forgetBirth,
  importedContainer,
  retryBirth,
  useZeropsBirths,
  type BirthsSnapshot,
} from "~/zerops/zeropsBirths";
import {
  useZeropsCandidates,
  type ZeropsCandidatePresentation,
} from "~/zerops/useZeropsCandidates";
import {
  integrationTokensFromGrantMetadata,
  useZeropsGroupReach,
} from "~/zerops/useZeropsGroupReach";
import { useZeropsThrowawaySweep } from "~/zerops/useZeropsThrowawaySweep";
import { useZeropsOrganizationMembers } from "~/zerops/useZeropsMateOwners";
import { useZeropsSession, type ZeropsSessionStatus } from "~/zerops/ZeropsSessionProvider";
import { withheldProjectNotices } from "~/zerops/inventoryContext";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { useZeropsCreationVerdicts } from "~/zerops/useZeropsCreationVerdicts";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsDeployTokenGaps } from "~/zerops/useZeropsDeployTokenGaps";
import { runZeropsCommand, useZeropsData } from "~/zerops/zeropsDataContext";
import type { AuthGateState } from "~/environments/primary/auth";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { ZeropsRowPresentation } from "./ZeropsProjectRow.logic";

import {
  changeState,
  environmentNameUnderGroup,
  halfMadeGroupEnvironments,
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  toolProjectName,
  flowVerbKey,
  flowVerbLabel,
  deployWord,
  rankZeropsCandidateForListing,
  readZeropsToolKind,
  defaultAgentForRole,
  generateBotName,
  hasBotName,
  keptOrGeneratedBotName,
  type RandomBytes,
  GROUP_BEING_SET_UP_LINE,
  hasMate,
  planEnvironmentCreation,
  canWriteRegistry,
  canCreateProjectsInOrganization,
  groupFlow,
  pullRequestLineWith,
  PRODUCTION_ADDED_HERE,
  type FlowPullRequest,
  readZeropsGroupTags,
  resolveGroupGitea,
  runEnvironmentCreation,
  unionAgents,
  type EnvironmentCreationStepProgress,
  type EnvironmentRow,
  type GroupEnvironmentTier,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsGroupTags,
  type ZeropsProjectOrder,
  type ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";
import { invalidateZerops } from "~/zerops/accountInvalidations";

import { MateFace, MicroLabel, StatusDot } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { ZeropsMateBirthLine } from "./ZeropsBirthProgress";
import { ZeropsMateCard, ZeropsMateVerb } from "./ZeropsMateCard";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useZeropsAgentActivity } from "~/zerops/useZeropsAgentActivity";
import { ZeropsEnvironmentCreation } from "./ZeropsEnvironmentCreation";
import {
  ZeropsEnvironmentCreationDialog,
  type EnvironmentCreationChoice,
} from "./ZeropsEnvironmentCreationDialog";
import { proposedEnvironmentName } from "./ZeropsEnvironmentCreationDialog.logic";
import { ZeropsProjectMenu, type ZeropsMenuAction } from "./ZeropsProjectMenu";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";
import { useRenameGroup } from "~/zerops/useRenameGroup";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useZeropsGroupRecipe } from "~/zerops/useZeropsGroupRecipe";
import { useAccountGitea, useAccountHoldsGitea } from "~/zerops/giteaProject";
import { useZeropsGroupEnvironmentReconcile } from "~/zerops/useZeropsGroupEnvironmentReconcile";
import { useZeropsGroupOrganizations } from "~/zerops/useZeropsGroupOrganizations";
import { registryGroupSlug, useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsProjectFlow } from "~/zerops/projectFlowContext";
import { readZeropsResourceOnce } from "~/zerops/useZeropsDeployedVersion";
import { deployRowTone, releaseRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsReleaseVerb } from "./ZeropsGroupDetail";
import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";
import {
  creatableRoles,
  environmentRoleLabel,
  environmentRoleTag,
  groupNameIsPlaceholder,
} from "./ZeropsGroupTree.logic";
import {
  ZeropsProjectsFlow,
  type NextStepPlacement,
  type ProjectsFlowGroup,
} from "./projects/ZeropsProjectsFlow";
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  lastMergedCode,
  parseProjectsSearch,
  productionAddable,
  TOOL_LABEL,
  type ProjectsSearch,
} from "./projects/projectsView.logic";
import {
  type ZeropsRowAction,
  type ZeropsRowInput,
  connectFailureLine,
  deriveZeropsRowAction,
  setUpMateVerb,
  deriveZeropsRowPresentation,
  environmentSummaryLine,
  giteaToolLine,
  groupAddsOffered,
  isZeropsToolCandidate,
} from "./ZeropsProjectRow.logic";
import { ZeropsOrganizationScope, ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";

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

/** The birth's connect retry cadence: 2s, 4s, 8s, then every 15s. */
const ZEROPS_BIRTH_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
const ZEROPS_BIRTH_RETRY_STEADY_MS = 15_000;

/**
 * B-2: "overdue is not a state." A retryable failure inside a birth never
 * dead-ends — it loops, slowing down until it settles at once every 15s,
 * for as long as the hand-off stays pending.
 */
export function nextZeropsBirthRetryDelayMs(attempt: number): number {
  return ZEROPS_BIRTH_RETRY_DELAYS_MS[attempt] ?? ZEROPS_BIRTH_RETRY_STEADY_MS;
}

/**
 * Whether a connect attempt is a birth's own: the container one of the
 * account's births found (`zeropsBirths.ts`). Only there does a retryable
 * identity-exchange failure loop silently instead of landing on the card as an
 * error — a click-triggered connect on a Mate that exists (Open, Enable, the
 * same-origin bootstrap) keeps today's one-shot behavior.
 */
export function isZeropsBirthConnectTarget(input: {
  readonly containerOrigin: string;
  readonly births: ReadonlyArray<{ readonly origin: string | null }>;
}): boolean {
  const origin = normalizeOrigin(input.containerOrigin);
  return input.births.some(
    (birth) => birth.origin !== null && normalizeOrigin(birth.origin) === origin,
  );
}

/**
 * Whether a Mate's card shows its birth checklist: only while it is being born
 * — a birth of this account for its project. Opening a Mate that exists also
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
    (candidate) => readZeropsToolKind(candidate.project.tagList) === undefined,
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

/**
 * The name *Set up Mate* gives a half-made Mate: the one it already has, or a fresh one once every
 * Mate's name on the account is read. Until then a fresh name may already be somebody's (M5), so
 * there is none yet — `undefined`, and the setup waits for the listing.
 */
export function setUpMateBotName(
  existing: string | undefined,
  taken: TakenBotNames,
  randomBytes: RandomBytes,
): string | undefined {
  return hasBotName(existing) || taken.complete
    ? keptOrGeneratedBotName(existing, taken.names, randomBytes)
    : undefined;
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
 * complete one, nor over one a lapse withholds, which the app's one banner
 * names. Copy, delay and affordance are `knownPresentation`'s.
 */
export function projectsListingNotice(
  listing: Shown<ReadonlyArray<ZeropsCandidate>>,
  nowMs: number,
): ProjectsListingNotice | null {
  if (listing.state === "known" && listing.coverage === "complete") return null;
  const presentation = knownPresentation(listing, PROJECTS_SURFACE, {
    nowMs,
    updateOffered: false,
  });
  if (presentation.message === null) return null;
  return {
    region: presentation.region,
    message: presentation.message,
    affordance: presentation.affordance,
  };
}

/**
 * The page's own alert, beside the listing's notice. A failure covers its own
 * region once (R-K2, R-K3): when the listing already says its read failed,
 * the inventory's failure over that same read is not said again. A connect
 * failure is another region's and always stands.
 */
export function projectsPageError(input: {
  readonly connectError: string | null;
  readonly inventoryError: string | null;
  readonly listingNotice: ProjectsListingNotice | null;
}): string | null {
  if (input.connectError !== null) return input.connectError;
  return input.listingNotice?.region === "message" ? null : input.inventoryError;
}

/**
 * What a declared stage or production says in its row's middle. With
 * something deployed that is its source and version (`main · e014b0e`); with
 * nothing yet, a bare source (`release`) reads as a stray word, so the row
 * says it runs nothing. A first deploy on its way keeps its source: the
 * status beside it already says *Deploying*.
 */
export function declaredEnvironmentSummary(
  row: Pick<EnvironmentRow, "line" | "tone" | "version">,
): string {
  return row.version.label === undefined && row.tone === "neutral" ? NOTHING_DEPLOYED : row.line;
}

/**
 * The one line a group says about itself, in its own row: that it has no name
 * yet, that a stage or production the page repaired in the background is not
 * finished, or that the broker's Gitea side is still being set up. A repair's
 * failure is the group's to show, in the page's words — the platform's own
 * message is not the person's to read, and a line under the page is nobody's.
 */
export function projectsGroupLine(input: {
  readonly placeholder: boolean;
  readonly unfinished: GroupEnvironmentTier | undefined;
  readonly gitea: string;
}): string | undefined {
  if (input.placeholder) return "This project has no name yet";
  if (input.unfinished !== undefined) return `Couldn't finish setting up ${input.unfinished}`;
  return input.gitea.length > 0 ? input.gitea : undefined;
}

function SignedOutNotice({ message }: { readonly message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/**
 * The page's title row: the title, the two views of one flow beside it, the
 * sort and the reload as a glyph. No creating action here — the left menu's
 * "New project" is the entry, and a filled pill beside the title was the
 * loudest thing on a page whose loud thing should be the Mate. No sentence
 * under the title either: the projects below say what the page is.
 */

const PROJECT_ORDER_OPTIONS: ReadonlyArray<{
  readonly value: ZeropsProjectOrder;
  readonly label: string;
}> = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name" },
];

/**
 * How the page and the left sidebar tree (`SidebarZeropsTree.tsx`) order
 * their projects — a per-browser preference, not project state
 * (`projectOrderPreference.ts`), read and written live so both surfaces turn
 * around together the moment it changes.
 */
function ZeropsProjectOrderControl() {
  const [order, setOrder] = useProjectOrderPreference();
  return (
    <Select
      onValueChange={(value) => {
        const option = PROJECT_ORDER_OPTIONS.find((entry) => entry.value === value);
        if (option !== undefined) setOrder(option.value);
      }}
      value={order}
    >
      <SelectTrigger
        aria-label="Sort projects"
        className="w-auto min-w-0"
        size="sm"
        variant="ghost"
      >
        <ArrowDownUpIcon className="size-3.5" />
        <SelectValue>
          {PROJECT_ORDER_OPTIONS.find((option) => option.value === order)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        {PROJECT_ORDER_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

type ProjectsView = "overview" | "projects";

const PROJECTS_VIEWS: ReadonlyArray<{ readonly value: ProjectsView; readonly label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "projects", label: "Projects" },
];

/** The two views of the same flow: the Overview across projects, and every project as a card. */
function ZeropsProjectsViewSwitch({
  view,
  onView,
}: {
  readonly view: ProjectsView;
  readonly onView: (view: ProjectsView) => void;
}) {
  return (
    <nav aria-label="View" className="flex rounded-lg bg-muted p-0.5">
      {PROJECTS_VIEWS.map((option) => (
        <button
          aria-current={option.value === view ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            option.value === view && "bg-card font-medium text-foreground shadow-xs",
          )}
          key={option.value}
          onClick={() => onView(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}

export function ZeropsProjectsHeader({
  onRefresh,
  refreshing = false,
  view = "overview",
  onView,
}: {
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean;
  readonly view?: ProjectsView;
  readonly onView?: ((view: ProjectsView) => void) | undefined;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      data-zerops-project-scope="true"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-medium text-foreground">Projects</h1>
        {onView === undefined ? null : <ZeropsProjectsViewSwitch onView={onView} view={view} />}
      </div>
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
 * container answers ready, and the account's births (`zeropsBirths.ts`), each connected once its
 * wait in this tab answers ready. Either lands the person in the conversation. A birth another
 * tab drives is connected by auto-connect once its harden is done, and that late success ends it
 * here all the same.
 */
export function useZeropsProjectConnection(): {
  readonly births: BirthsSnapshot;
  readonly opening: OpeningTarget | null;
  /** Opens a Mate that exists; a Mate still being born is connected by its birth. */
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
   * hook's own `connectContainer`, or a late success this page only observed (auto-connect
   * reached the door first). The organization it was made in is read again, and the person lands
   * in the conversation — exactly what a successful `connectContainer` always does.
   */
  readonly finishBirth: (
    environmentId: EnvironmentId,
    organizationId: string | null,
  ) => Promise<void>;
} {
  const births = useZeropsBirths();
  const { health } = useZeropsContainers();
  const { organizationRef } = useZeropsData();
  const exchangeZeropsIdentity = useConnectMate("user");
  const navigate = useNavigate();
  const [opening, setOpening] = useState<OpeningTarget | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | undefined>();
  const [upgradeOrigin, setUpgradeOrigin] = useState<string | null>(null);
  const [connectingOrigin, setConnectingOrigin] = useState<string | null>(null);
  /** The container whose connect failed: "Try again" connects it again. */
  const [failedOrigin, setFailedOrigin] = useState<string | null>(null);
  // What the connect reads without re-creating itself on every birth write.
  const birthsRef = useRef(births.births);
  const openingRef = useRef(opening);
  useEffect(() => {
    birthsRef.current = births.births;
    openingRef.current = opening;
  }, [births.births, opening]);
  // One connect per wait that answered ready, however many renders that takes.
  const connectedForRef = useRef(new Set<string>());
  const openedRef = useRef<OpeningTarget | null>(null);
  // The birth's own retry loop: a timer plus how many attempts it has made,
  // so the backoff (`nextZeropsBirthRetryDelayMs`) is read once per schedule
  // and not restarted by an unrelated render. Kept in refs, not state — a
  // scheduled retry is not something any render needs to show; the birth's
  // own line already carries it.
  const birthRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const birthRetryAttemptRef = useRef(0);

  const clearBirthRetry = useCallback(() => {
    if (birthRetryTimerRef.current !== null) {
      clearTimeout(birthRetryTimerRef.current);
      birthRetryTimerRef.current = null;
    }
    birthRetryAttemptRef.current = 0;
  }, []);

  // Every scheduled retry unmounts through this, whatever ended it first —
  // the tab closing, the component unmounting mid-birth, or (via the effect
  // below) the last birth ending.
  useEffect(() => clearBirthRetry, [clearBirthRetry]);

  const finishBirth = useCallback(
    async (environmentId: EnvironmentId, organizationId: string | null) => {
      clearBirthRetry();
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
    [clearBirthRetry, navigate, organizationRef],
  );

  /** The organization the connected container's birth or opening was in. */
  const organizationOf = useCallback((containerOrigin: string): string | null => {
    const origin = normalizeOrigin(containerOrigin);
    const birth = birthsRef.current.find(
      (entry) => entry.origin !== null && normalizeOrigin(entry.origin) === origin,
    );
    if (birth !== undefined) return birth.organizationId;
    const target = openingRef.current;
    return target !== null && normalizeOrigin(target.origin) === origin
      ? target.organizationId
      : null;
  }, []);

  /**
   * What a connect of this container names: its birth's target once harden found the service —
   * the birth worker read it from REST, and the inventory may not list it yet — else the origin,
   * with the organization of the birth or opening it belongs to.
   */
  const targetOf = useCallback(
    (containerOrigin: string): MateConnectTarget => {
      const origin = normalizeOrigin(containerOrigin);
      const birth = birthsRef.current.find(
        (entry) => entry.origin !== null && normalizeOrigin(entry.origin) === origin,
      );
      if (birth !== undefined && birth.serviceId !== null) {
        return { key: `${birth.projectId}:${birth.serviceId}` };
      }
      const organizationId = organizationOf(containerOrigin);
      return {
        origin: containerOrigin,
        organization: organizationId === null ? null : organizationRef(organizationId),
      };
    },
    [organizationOf, organizationRef],
  );

  // Fed by `scheduleBirthRetry` below and read by the timer it sets — a ref
  // so the timer always calls this hook's latest `connectContainer`.
  const connectContainerRef = useRef<(containerOrigin: string) => Promise<void>>(() =>
    Promise.resolve(),
  );

  const scheduleBirthRetry = useCallback(
    (containerOrigin: string) => {
      // Until the birth's Mate is listed its connect waits on presence, and nothing else reads
      // the birth's organization again: a project still NEW at the last read, or a missed push,
      // would keep it unlisted. One read per rung of the ladder.
      const organizationId = organizationOf(containerOrigin);
      if (organizationId !== null) {
        invalidateZerops({ topic: "inventory", organization: organizationRef(organizationId) });
      }
      if (birthRetryTimerRef.current !== null) clearTimeout(birthRetryTimerRef.current);
      const attempt = birthRetryAttemptRef.current;
      birthRetryAttemptRef.current = attempt + 1;
      birthRetryTimerRef.current = setTimeout(() => {
        birthRetryTimerRef.current = null;
        void connectContainerRef.current(containerOrigin);
      }, nextZeropsBirthRetryDelayMs(attempt));
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
          if (
            result.retryable &&
            isZeropsBirthConnectTarget({ containerOrigin, births: birthsRef.current })
          ) {
            // B-2: "overdue is not a state." A fault a retry might clear on
            // its own never dead-ends a birth's card — no `connectError`, so
            // the card stays on its progress and this loops until it settles
            // or the birth ends.
            scheduleBirthRetry(containerOrigin);
            return;
          }
          clearBirthRetry();
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
    [
      clearBirthRetry,
      exchangeZeropsIdentity,
      finishBirth,
      organizationOf,
      scheduleBirthRetry,
      targetOf,
    ],
  );

  useEffect(() => {
    connectContainerRef.current = connectContainer;
  }, [connectContainer]);

  // A birth this tab drives connects the moment its Mate answers ready.
  useEffect(() => {
    for (const [projectId, wait] of births.waits) {
      if (wait.phase !== "ready" || wait.containerOrigin === null) continue;
      const key = `${projectId}@${wait.phaseStartedAtMs}`;
      if (connectedForRef.current.has(key)) continue;
      connectedForRef.current.add(key);
      void connectContainer(wait.containerOrigin);
    }
  }, [births.waits, connectContainer]);

  // A Mate being opened connects the moment its container answers ready.
  const openingReady = opening !== null && health.get(opening.key) === "ready";
  useEffect(() => {
    if (opening === null || !openingReady || openedRef.current === opening) return;
    openedRef.current = opening;
    void connectContainer(opening.origin);
  }, [connectContainer, opening, openingReady]);

  // The last birth ending always cancels a birth retry along with it: nothing
  // should still be reaching for a container nobody is waiting on.
  useEffect(() => {
    if (births.births.length === 0) clearBirthRetry();
  }, [births.births, clearBirthRetry]);

  const open = useCallback(
    (candidate: ZeropsCandidate) => {
      if (candidate.containerOrigin === undefined) return;
      // A Mate still being born is connected by its birth, once it is closed off.
      if (birthsRef.current.some((birth) => birth.projectId === candidate.project.id)) return;
      setConnectError(null);
      clearBirthRetry();
      setOpening({
        key: candidate.key,
        projectId: candidate.project.id,
        origin: candidate.containerOrigin,
        organizationId: candidate.project.clientId ?? null,
      });
    },
    [clearBirthRetry],
  );

  const waits = births.waits;
  const retryProjectConnection = useCallback(() => {
    retryZeropsProjectConnection({
      connectError,
      readyOrigin: failedOrigin,
      retryIdentity: (containerOrigin) => {
        void connectContainer(containerOrigin);
      },
      retryProvisioning: () => {
        for (const projectId of waits.keys()) retryBirth(projectId);
      },
    });
  }, [connectContainer, connectError, failedOrigin, waits]);

  const upgradeRecovery = useZeropsUpgradeRestart(
    connectError ? upgradeOrigin : null,
    retryProjectConnection,
  );

  return {
    births,
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
  const { organizationRef, projectRef, runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);
  const { listing, isLoading, error, refresh: refreshCandidates } = useZeropsCandidates();
  // The rows read so far; `listing` says whether they are all there are, and
  // the page's notice says so while they are not (`projectsListingNotice`).
  const observedCandidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  // An agent's name must be new on the account, not just in the group: it is
  // what the left menu calls the row, and two Adas is two of nothing.
  const taken = useMemo(() => takenBotNames(listing), [listing]);
  const nowMs = useNowMs();
  const {
    births,
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
  const birthProjectIds = useMemo(
    () => new Set(births.births.map((birth) => birth.projectId)),
    [births.births],
  );
  // A project on its way up is read against the platform's verdict on its
  // creation: one whose `project.create` failed is not coming up, however
  // long the page waits, and its row says so instead. H20: also re-asked
  // periodically for a birth of the organization on show that is not closed
  // off yet, so a creation that fails late still turns "Coming up." into
  // "Could not be created." on its own.
  const creationVerdicts = useZeropsCreationVerdicts(
    observedCandidates,
    births.births.find(
      (birth) => birth.organizationId === activeOrganization?.id && birth.step !== "health",
    )?.projectId ?? null,
  );
  const candidates = useMemo(
    () =>
      observedCandidates.map((candidate) =>
        applyProjectCreationVerdict(candidate, creationVerdicts.get(candidate.project.id)),
      ),
    [creationVerdicts, observedCandidates],
  );
  // A late success still ends the birth. Auto-connect (the account runtime's)
  // can reach the door before this page's own connect does — it never
  // navigates by design — so this watches for a project this page saw being
  // born, or one it is opening, turning up connected, and finishes from here
  // instead. Gated strictly on those: an ordinary auto-connected environment
  // must never pull anyone into a thread. A birth is remembered for as long as
  // the page is mounted, because the exchange that connects it promotes it
  // (`promoteBirth`) as its very first write, which would otherwise take it out
  // of the ledger before this check ever got to run.
  const seenBirthsRef = useRef(new Set<string>());
  const finishedBirthProjectsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const birth of births.births) seenBirthsRef.current.add(birth.projectId);
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
  }, [births.births, candidates, connectingOrigin, finishBirth, opening]);
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
  const [removingCandidateKey, setRemovingCandidateKey] = useState<string | null>(null);
  const navigate = useNavigate();
  // The server that served this page gets one automatic identity exchange.
  // A failed exchange stays manual so rerenders cannot hammer the door.
  const autoConnectingRef = useRef(false);
  // One-shot resource reads (readZeropsResourceOnce) hold their lease under
  // this signal, so a component unmounted mid-read releases immediately.
  const unmountRef = useRef<AbortController>(undefined);
  if (unmountRef.current === undefined) unmountRef.current = new AbortController();
  useEffect(() => () => unmountRef.current?.abort(), []);

  const [toolError, setToolError] = useState<string | null>(null);
  /** The groups whose background repair of a stage or production did not finish. */
  const [unfinished, setUnfinished] = useState<ReadonlyMap<string, GroupEnvironmentTier>>(
    () => new Map(),
  );
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
  const [projectOrder] = useProjectOrderPreference();
  const groupTree = buildZeropsGroupTree(candidates, {
    rank: rankZeropsCandidateForListing,
    order: projectOrder,
  });
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  const activity = useZeropsAgentActivity();
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
  // Guide 0.8: a verb this person cannot finish is not offered. Every one of
  // them is a platform write the platform would refuse from the wrong role.
  const verbsOf = (candidate: ZeropsCandidate): MateVerbs =>
    viewer === null
      ? { open: true, rename: true, tag: true, move: true, assign: false }
      : resolveMateVerbs({ project: candidate.project, viewer });
  // The member list is read when a row would use a name — a Mate this person
  // may see and not open — and when they may hand a Mate over and so need
  // somebody to hand it to. Never otherwise.
  const anyListed = candidates.some((candidate) => visibilityOf(candidate) === "listed");
  const anyAssignable = candidates.some((candidate) => verbsOf(candidate).assign);
  const assignableMembers = useZeropsOrganizationMembers({
    clientId: activeOrganization?.id,
    enabled: anyListed || anyAssignable,
  });
  const members = assignableMembers;

  /** A birth of the organization on show: the page is not empty while one is on its way. */
  const activeBirths = births.births.some(
    (birth) => birth.organizationId === activeOrganization?.id,
  );

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

  const rowInput = (
    candidate: ZeropsCandidatePresentation,
    role?: ZeropsEnvironmentRole | undefined,
  ): ZeropsRowInput => {
    const visibility = visibilityOf(candidate);
    const openable = visibility !== "listed";
    const ownerName =
      visibility === "listed"
        ? resolveMateOwnerName({ project: candidate.project, members })
        : undefined;
    const waiting = candidate.group !== "connected" && waitedOn(candidate);
    const mateFlag = candidateMateFlags.get(candidate.key);
    return {
      candidate,
      health: candidateHealth.get(candidate.key),
      ...(mateFlag === undefined ? {} : { mateFlag }),
      waiting,
      can: {
        open: openable,
        enable: openable,
        setUpMate: openable,
        start: openable,
        restart: openable,
        remove: openable,
      },
      ...(role === undefined ? {} : { role }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(ownerName === undefined ? {} : { ownerName }),
    };
  };

  const [settingUpKey, setSettingUpKey] = useState<string | null>(null);

  /**
   * The agents a group's existing environments are signed in with, so a Mate
   * born into that group offers the same ones instead of the platform's whole
   * menu (`agentSelection.ts`).
   *
   * Read per environment and unioned. A read that fails is not a reason to
   * refuse a creation: the empty answer omits `ZCP_AGENTS` from the import,
   * and the container falls back to offering every agent — which is exactly
   * what it did before this existed.
   */
  const readGroupAgents = useCallback(
    async (
      environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>,
    ): Promise<ReadonlyArray<ZeropsAgentType>> =>
      unionAgents(
        await Promise.all(
          environments.flatMap(({ item }) => {
            if (item.service === undefined || activeOrganization === null) return [];
            const request: ServiceAuthorizedAgentsResourceRequest = {
              kind: "service-authorized-agents",
              account: runtime.scope,
              service: {
                kind: "service",
                project: projectRef(activeOrganization.id, item.project.id),
                serviceId: ZeropsServiceId.make(item.service.id),
              },
            };
            return [
              readZeropsResourceOnce(runtime.resources, request, unmountRef.current?.signal).then(
                (agents): ReadonlyArray<ZeropsAgentType> => agents ?? [],
              ),
            ];
          }),
        ),
      ),
    [activeOrganization, projectRef, runtime.resources, runtime.scope],
  );

  const setUpMate = useCallback(
    async (candidate: ZeropsCandidate) => {
      if (!activeOrganization || settingUpKey !== null) return;
      // A recovery keeps the name the Mate already has: the project is named
      // after it, and a fresh name leaves the two disagreeing.
      const botName = setUpMateBotName(
        readZeropsGroupTags(candidate.project.tagList).bot,
        taken,
        (bytes) => crypto.getRandomValues(bytes),
      );
      if (botName === undefined) {
        setConnectError(
          "Still reading which names your Mates go by. Try Set up Mate again in a moment.",
        );
        return;
      }
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
        const project = projectRef(activeOrganization.id, projectId);
        await runZeropsCommand(runtime.commands.importDevelopmentContainer({ project, agents }));
        // The container is accepted: its birth closes the project off before
        // anyone is let in, whatever happens to the rest of this.
        beginBirth({
          projectId,
          organizationId: activeOrganization.id,
          registration: null,
          container: true,
        });
        if (!isCurrent()) return;
        await runZeropsCommand(
          runtime.commands.updateProjectTags(project, { kind: "agent-name", name: botName }),
        );
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
      activeOrganization,
      groupTree.groups,
      projectRef,
      readGroupAgents,
      setConnectError,
      settingUpKey,
      runtime.commands,
      taken,
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

  // The quiet actions: rename an agent, move a project, rename a group. Each
  // runs through the account-scoped command layer; observations update the model.
  const [rowDialog, setRowDialog] = useState<
    | { readonly kind: "rename-agent"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "move"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "assign"; readonly candidate: ZeropsCandidate }
    | { readonly kind: "rename-group"; readonly group: ZeropsGroup }
    | null
  >(null);
  // The same write the project's own page uses, so one rename means one
  // thing wherever it is offered.
  const renameGroup = useRenameGroup();
  // The same write an environment's own page uses, so one way to open a
  // service to the internet means one thing wherever it is offered.
  const route = useEnableRoute();

  /**
   * The face a Mate wears: the state of its conversation when its socket is
   * up, else asleep — a container that is not connected is the Zerops mark.
   */
  const mateFace = (candidate: ZeropsCandidatePresentation): MateMarkState =>
    mateFaceFor(
      candidate.group === "connected" && candidate.environmentId !== undefined,
      candidate.environmentId === undefined ? undefined : activity.get(candidate.environmentId),
    );

  /** Writes the group's registry entry for a Mate, as the owner. */

  /**
   * The quiet actions of a card or a row: the environment's public access,
   * the Mate's name when there is a Mate, and where the environment sits in
   * its project.
   */
  const renderEnvironmentMenu = (
    candidate: ZeropsCandidatePresentation,
    tags: ZeropsGroupTags,
    mate: boolean,
    action?: ZeropsRowAction,
    updateMenuActions?: ReadonlyArray<ZeropsMenuAction>,
  ): React.ReactNode => {
    if (isZeropsToolCandidate(candidate)) return undefined;
    return (
      <ZeropsProjectMenu
        actions={mate ? mateActions.actionsFor(candidate, tags, updateMenuActions ?? []) : []}
        enablingServiceId={route.enablingServiceId}
        label={`More for ${candidate.project.name}`}
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
                {quiet("Restarting interrupts work running in it.")}
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
    const wait = births.waits.get(candidate.project.id);
    if (wait === undefined) return undefined;
    const keepWaiting = (
      <ZeropsMateVerb
        disabled={busy}
        label="Keep waiting"
        onClick={() => {
          retryBirth(candidate.project.id);
        }}
      />
    );
    if (wait.phase === "not-yet-available") {
      // H4/H5: no wait dead-ends. "Keep waiting" asks the platform again —
      // the container it was about survives the ask. A settled verdict, not
      // a cap: `overdue` cannot be true here.
      return (
        <>
          {quiet("This container's release does not carry Mate yet.")}
          {keepWaiting}
        </>
      );
    }
    // B-2: a cap running out is words, never a stop — the birth stays on its
    // step (a missed push still resumes it) and only grows this line's
    // "Taking longer than usual." and "Keep waiting", which restarts the
    // step's own clock. A birth is never stopped from here: nobody is let into
    // its Mate before it is closed off.
    if (wait.overdue) {
      return (
        <>
          {quiet("Taking longer than usual.")}
          {keepWaiting}
        </>
      );
    }
    return undefined;
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
    if (candidate.group === "connected") {
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
      const waited = births.waits.get(candidate.project.id) ?? null;
      return (
        <ZeropsMateBirthLine
          input={{
            candidate,
            health: candidateHealth.get(candidate.key),
            provisioningPhase: waited?.phase ?? null,
            hardenError: waited?.phase === "hardening" ? (waited.detail ?? undefined) : undefined,
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
      case "set-up-mate":
        void setUpMate(candidate);
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
        const project = projectRef(activeOrganization.id, candidate.project.id);
        void runZeropsCommand(
          runtime.commands.enableZeropsMate({
            kind: "service",
            project,
            serviceId: ZeropsServiceId.make(serviceId),
          }),
        )
          .then(() => {
            intendContainer(candidate.key, { kind: "enable" });
            // A birth follows the restart it asked for; a Mate that exists
            // is opened once it answers.
            if (birthProjectIds.has(candidate.project.id)) birthEnabled(candidate.project.id);
            else open(candidate);
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
        const project = projectRef(activeOrganization.id, candidate.project.id);
        // A STOPPED project starts every service in it; a STOPPED zcp
        // service while the project is ACTIVE starts only that service.
        const serviceId = candidate.service?.id;
        const write =
          candidate.project.status === "STOPPED"
            ? runZeropsCommand(runtime.commands.startProject(project))
            : serviceId
              ? runZeropsCommand(
                  runtime.commands.startService({
                    kind: "service",
                    project,
                    serviceId: ZeropsServiceId.make(serviceId),
                  }),
                )
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
        const project = projectRef(activeOrganization.id, candidate.project.id);
        void readContainerAfter(
          candidate,
          runZeropsCommand(
            runtime.commands.restartService({
              kind: "service",
              project,
              serviceId: ZeropsServiceId.make(serviceId),
            }),
          ).then(() => {
            intendContainer(candidate.key, { kind: "restart" });
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
          deleteProject: (projectId) =>
            runZeropsCommand(runtime.commands.deleteProject({ organization, projectId })),
          forgetCreation: forgetBirth,
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
  // Shared by the project's menu, its card's add verbs and whether
  // production is offered.
  const addsOfferedFor = useCallback(
    (group: ZeropsGroup) =>
      groupAddsOffered(
        groupTree.groups.find((entry) => entry.group.groupId === group.groupId)?.environments ?? [],
        candidateHealth,
      ),
    [candidateHealth, groupTree.groups],
  );

  // "Add stage" opens the form; the form's answer is what gets created.
  const [creationRequest, setCreationRequest] = useState<{
    readonly groupId: string;
    readonly role: ZeropsEnvironmentRole;
    readonly botName: string;
  } | null>(null);
  const requestedGroup = useMemo(
    () =>
      creationRequest === null
        ? undefined
        : groupTree.groups.find((entry) => entry.group.groupId === creationRequest.groupId),
    [creationRequest, groupTree.groups],
  );
  const accountGitea = useAccountGitea(activeOrganization?.id);
  const holdsGitea = useAccountHoldsGitea(activeOrganization?.id);
  const giteaProjectId = accountGitea?.projectId;
  // Read exactly as the account's Gitea project states it: an account on a
  // devel region or behind a custom domain is read, never guessed.
  const giteaOrigin = accountGitea?.state.url;
  // The registry — which groups exist, and what each one's Gitea org is called
  // (guide 4.1). One project read, on the one screen that sees the account.
  const registryState = useZeropsRegistry({
    giteaProjectId: giteaProjectId,
    enabled: status === "signed-in",
  });

  // A birth's group writes change the registry: it is read again as each
  // birth moves on, so the tree is not left one version behind.
  const birthSteps = births.births.map((birth) => `${birth.projectId}:${birth.step}`).join(",");
  const readBirthStepsRef = useRef(birthSteps);
  const refreshRegistry = registryState.refresh;
  useEffect(() => {
    if (readBirthStepsRef.current === birthSteps) return;
    readBirthStepsRef.current = birthSteps;
    refreshRegistry();
  }, [birthSteps, refreshRegistry]);

  // Every verb a Mate has, from the one place that defines them — shared with
  // a project's own page, which listed its Mates and could do nothing to them.
  const mateActions = useMateActions({ registry: registryState, serverVersions });

  // The recipe is the group repo's, read as the person (guide 4.3) — never a
  // sibling's export, which carried service shapes without their build setup
  // and produced environments that could not build.
  const groupRecipe = useZeropsGroupRecipe({
    giteaOrigin,
    slug: registryGroupSlug(registryState.registry, creationRequest?.groupId),
    tier:
      creationRequest?.role === "prod"
        ? "production"
        : creationRequest?.role === "stage"
          ? "stage"
          : "mate",
    enabled: creationRequest !== null,
  });

  // The registry says which groups were asked for; `GET /orgs/{slug}` says
  // which the broker has actually made (guide 4.5).
  const giteaOrganizations = useZeropsGroupOrganizations({
    giteaOrigin,
    slugs: registryState.registry.groups.map((group) => group.slug),
    enabled: status === "signed-in",
  });

  // Every group's flow — its declared environments and what they run, what
  // is waiting to land, what was released — is read once for the account
  // (`ZeropsProjectFlowProvider`, D26); the page draws its share of it.
  const projectFlow = useZeropsProjectFlow();
  const groupDeploys = projectFlow.flows;

  /**
   * The environment row of one Zerops project, when some group declares it.
   * A project no `environments.yaml` names is not a group environment and
   * keeps the row it always had.
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

  /** Each Mate's name, for a pull request's line — the bot's, the project's when it has none. */
  const mateNames = useMemo(
    () =>
      new Map(
        groupTree.groups.flatMap(({ environments }) =>
          environments.map(({ item }) => {
            const tags = readZeropsGroupTags(item.project.tagList);
            return [
              item.project.id,
              botDisplayName({ bot: tags.bot, projectName: item.project.name }),
            ] as const;
          }),
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
    const commits = flow.release.contents.flatMap((entry) => entry.commits);
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
   * One pull request's row, wherever it is drawn. `withMerge` is false where
   * the project's next step already offers *Merge* on it: one verb, once.
   * `compact` stacks title, state and verb for a flow step's narrow column.
   */
  const pullRequestRowOf = (
    group: ZeropsGroup,
    pull: FlowPullRequest,
    { withMerge, compact }: { readonly withMerge: boolean; readonly compact: boolean },
  ) => {
    const slug = groupDeploys.get(group.groupId)?.slug;
    // One vocabulary down the column, the same one the project's own page and
    // the left menu use: `changeState` answers a rebase and a passing check in
    // the same register. `checkDotTone` alone said nothing at all about a
    // change that no longer merges, which is the one a person needs to see.
    const state = changeState(pull);
    const merging =
      slug !== undefined &&
      projectFlow.pending.has(
        flowVerbKey({ kind: "merge", slug, repository: pull.repository, number: pull.number }),
      );
    const action =
      withMerge && pull.mergeability === "mergeable" && slug !== undefined ? (
        <ZeropsMateVerb
          disabled={merging}
          label={flowVerbLabel("merge", merging)}
          onClick={() => {
            void projectFlow.mergePullRequest(slug, pull);
          }}
        />
      ) : undefined;
    const key = `pull-${group.groupId}-${pull.repository}-${pull.number}`;
    const line = pullRequestLineWith(pull, mateNames.get(pull.mateProjectId ?? ""));
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
        tag={pull.kind === "recipe" ? "recipe" : "pr"}
        title={pull.title}
      />
    );
  };

  /**
   * The one line a group says about itself: that the broker has not finished
   * its Gitea side yet (`groupRows.ts`). A group whose org has not been asked
   * about says nothing, so the heading never grows a line and then loses it.
   */
  const groupLines = useMemo(() => {
    const lines = new Map<string, string>();
    for (const entry of registryState.registry.groups) {
      const state = resolveGroupGitea({ organizationExists: giteaOrganizations.get(entry.slug) });
      lines.set(entry.groupId, state === "being-set-up" ? GROUP_BEING_SET_UP_LINE : "");
    }
    return lines;
  }, [giteaOrganizations, registryState.registry.groups]);

  /**
   * Publish a service on its `*.zerops.app` subdomain.
   *
   * First class rather than a recovery step: a production environment cloned
   * from dev comes up unpublished whatever its recipe said, so without this the
   * first deploy lands and the page answers 502 with nothing saying why
   * (`verified.md`, 2026-09-07).
   */
  const requestEnvironment = useCallback(
    (groupId: string, role: ZeropsEnvironmentRole) => {
      if (creationRunning) return;
      setCreationRequest({
        groupId,
        role,
        // A proposal only: the dialog refuses it until every Mate's name is
        // read, and names the clash if one turns up (`validateBotName`).
        botName: generateBotName(taken.names, (bytes) => crypto.getRandomValues(bytes)),
      });
    },
    [creationRunning, taken],
  );

  // An add asked for from the left menu, which has the project's name and the
  // verb but not the dialog. Answered once, and only for a group still here.
  const takeAddMateIntent = useAddMateIntent((state) => state.take);
  useEffect(() => {
    const groupId = takeAddMateIntent();
    if (groupId === null) return;
    if (!groupTree.groups.some((entry) => entry.group.groupId === groupId)) return;
    requestEnvironment(groupId, "dev");
  }, [groupTree.groups, requestEnvironment, takeAddMateIntent]);

  const createEnvironment = useCallback(
    async (groupId: string, role: ZeropsEnvironmentRole, choice: EnvironmentCreationChoice) => {
      if (!activeOrganization || creationRunning) return;
      const isCurrent = captureAccountLifetime();
      const entry = groupTree.groups.find((candidate) => candidate.group.groupId === groupId);
      if (entry === undefined) return;
      const { group } = entry;
      const { name } = choice;

      const plan = planEnvironmentCreation({
        clientId: activeOrganization.id,
        groupId,
        // A group named by its id has no name to mirror.
        ...(group.nameSource === "id" ? {} : { groupName: group.name }),
        role,
        name,
        agents: await readGroupAgents(entry.environments),
        recipe: choice.recipe,
        withAgent: choice.withAgent,
        ...(choice.botName === undefined ? {} : { botName: choice.botName }),
      });
      if (!isCurrent()) return;
      if (!plan.ok) {
        setToolError(plan.reason);
        return;
      }

      // The project is a birth from the moment the platform accepts it
      // (`zeropsBirths.ts`, DESIGN §4.5), which the account's worker finishes
      // whatever this page does next — a reload or a closed tab during the
      // steps below included. It carries the group writes this person makes:
      //
      // - A Mate an owner or an admin makes is registered as soon as its
      //   project exists, the way *New project* registers the first — a
      //   creation that failed past that point included (Fen, 2026-09-17).
      //   Without the entry the broker gives it no bot. A member cannot write
      //   the registry; their Mate waits on the card's *Register in {group}*
      //   (guide 4.2).
      // - A stage or a production is a **group environment**: it goes in the
      //   registry, the broker's token has to reach it, and its sources are
      //   declared on the group repo before the broker deploys anything
      //   (guide 5.2).
      const tier = role === "prod" ? "production" : role === "stage" ? "stage" : null;
      const registers = tier !== null || canWriteRegistry(activeOrganization);
      const withAgent = plan.steps.some((step) => step.kind === "import-container");
      const organizationId = activeOrganization.id;
      const accepted = (projectId: string) => {
        if (!isCurrent()) return;
        beginBirth({
          projectId,
          organizationId,
          registration:
            registers && giteaProjectId !== undefined
              ? {
                  giteaProjectId,
                  giteaOrigin: tier === null ? null : (giteaOrigin ?? null),
                  groupId,
                  kind: tier ?? "mate",
                  displayName: name,
                }
              : null,
          container: withAgent,
        });
      };

      setToolError(
        tier !== null && giteaProjectId === undefined
          ? "Your account's Gitea is still being set up."
          : null,
      );
      setCreationNowMs(Date.now());
      setCreation({
        name,
        tier: tier ?? "mate",
        progress: plan.steps.map((step) => ({ step, state: "queued" })),
      });
      const outcome = await runEnvironmentCreation({
        clientId: activeOrganization.id,
        steps: plan.steps,
        isCurrent,
        platform: bornOnAccept(
          {
            createProject: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.createProject({
                  organization: organizationRef(activeOrganization.id),
                  ...input,
                }),
              ),
            // A read, not a write: the platform's verdict on the project the
            // command above made, waited on by the executor.
            readProjectCreation: (input) =>
              client.readProjectCreation(input, unmountRef.current?.signal),
            importDevelopmentContainer: ({ projectId, ...input }) =>
              runZeropsCommand(
                runtime.commands.importDevelopmentContainer({
                  project: projectRef(activeOrganization.id, projectId),
                  ...input,
                }),
              ),
            importServices: (projectId, yaml) =>
              runZeropsCommand(
                runtime.commands.importServices(projectRef(activeOrganization.id, projectId), yaml),
              ),
            listIntegrationTokenGrants: async ({ clientId: _clientId }) =>
              integrationTokensFromGrantMetadata(
                await runZeropsCommand(
                  runtime.commands.listIntegrationTokenGrants(
                    organizationRef(activeOrganization.id),
                  ),
                ),
              ),
            setIntegrationTokenProjects: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.setIntegrationTokenProjects({
                  organization: organizationRef(activeOrganization.id),
                  ...input,
                }),
              ),
            listTokenDelegations: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.listTokenDelegations({
                  organization: organizationRef(activeOrganization.id),
                  ...input,
                }),
              ),
            deleteTokenDelegation: ({ clientId: _clientId, ...input }) =>
              runZeropsCommand(
                runtime.commands.deleteTokenDelegation({
                  organization: organizationRef(activeOrganization.id),
                  ...input,
                }),
              ),
            importProject: ({ clientId: _clientId, yaml }) =>
              runZeropsCommand(
                runtime.commands.importProject(organizationRef(activeOrganization.id), yaml),
              ),
            readObservedServices: async (projectId) => {
              const outcome = inventoryRef.current.services.get(projectId);
              return outcome?.status === "resolved"
                ? outcome.services.map((service) => ({
                    name: service.name,
                    status: service.status,
                  }))
                : [];
            },
          },
          accepted,
        ),
        describeError: zeropsErrorMessage,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          }),
        onProgress: (progress) => {
          if (!isCurrent()) return;
          setCreation((current) => (current === null ? current : { ...current, progress }));
        },
      });

      if (!isCurrent()) return;

      // A container import that never went through leaves the birth nothing to bring up.
      if (outcome.projectId !== undefined && withAgent && !importedContainer(plan.steps, outcome)) {
        birthWithoutContainer(outcome.projectId);
      }

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
    },
    [
      activeOrganization,
      creationRequest?.groupId,
      creationRunning,
      groupTree.groups,
      readGroupAgents,
      organizationRef,
      projectRef,
      setConnectError,
      runtime.commands,
      client,
      giteaOrigin,
      giteaProjectId,
    ],
  );

  /**
   * Stands Gitea up as its own tagged project. Two platform calls with the
   * user's own token and no container is read — the same shape every other
   * creation in this model has.
   */
  const createTool = useCallback(async () => {
    if (!activeOrganization) return;
    setToolError(null);
    try {
      await runZeropsCommand(
        runtime.commands.createToolProject({
          organization: organizationRef(activeOrganization.id),
          toolKind: "gitea",
          name: toolProjectName("gitea"),
          appUrl: window.location.origin,
        }),
      );
    } catch (cause) {
      setToolError(zeropsErrorMessage(cause));
    }
  }, [activeOrganization, organizationRef, runtime.commands]);

  // A Mate's group is its token: every environment in the group readable,
  // its own writable. Reconciled off the list this screen already has, on
  // every read — a grant write restarts nothing, and a group that has not
  // moved is not written (`groupReach.ts`).
  useZeropsGroupReach({
    clientId: activeOrganization?.id,
    enabled: status === "signed-in" && !isLoading,
    groups: useMemo(
      () =>
        groupTree.groups.map((entry) => ({
          projectIds: entry.environments.map(({ item }) => item.project.id),
          mateProjectIds: entry.environments
            .filter(({ item }) => hasMate(item))
            .map(({ item }) => item.project.id),
        })),
      [groupTree.groups],
    ),
  });

  // A stage or a production whose creation lost its last writes — the
  // registry, the broker's grant, the declaration — is finished here, off the
  // same list, once no creation is on its way in this tab
  // (`useZeropsGroupEnvironmentReconcile`).
  const declaredByGroup = useMemo(
    () =>
      new Map(
        [...groupDeploys].map(([groupId, state]) => [
          groupId,
          new Set(state.environments.map((entry) => entry.projectId)),
        ]),
      ),
    [groupDeploys],
  );
  // An environment made before a job deployed (D27) has no deploy token on
  // the broker; a person who may mint one finishes it here like any other
  // write a creation lost.
  const declaredProjects = useMemo(
    () => [...declaredByGroup.values()].flatMap((projects) => [...projects]),
    [declaredByGroup],
  );
  const [deployTokenGeneration, setDeployTokenGeneration] = useState(0);
  const withoutDeployToken = useZeropsDeployTokenGaps({
    client,
    giteaProjectId,
    declaredProjects,
    enabled:
      status === "signed-in" &&
      (activeOrganization?.roleCode === "ADMIN" || activeOrganization?.roleCode === "OWNER"),
    generation: deployTokenGeneration,
  });
  const halfMade = useMemo(
    () =>
      halfMadeGroupEnvironments({
        projects: candidates.map((candidate) => candidate.project),
        registry: registryState.registry,
        declared: declaredByGroup,
        withoutDeployToken,
      }),
    [candidates, declaredByGroup, registryState.registry, withoutDeployToken],
  );
  useZeropsGroupEnvironmentReconcile({
    enabled: status === "signed-in" && projectFlow.readable && !isLoading && !creationRunning,
    client,
    data: { runtime, projectRef },
    clientId: activeOrganization?.id,
    giteaOrigin,
    giteaProjectId,
    refreshRegistry: registryState.refresh,
    halfMade,
    // Not a failed creation: the project runs, and what is outstanding is
    // said on its group's row (`projectsGroupLine`), not under the page.
    onOutcome: (entry, outcome) => {
      setDeployTokenGeneration((current) => current + 1);
      setUnfinished((current) => {
        const next = new Map(current);
        if (outcome.failed === undefined) next.delete(entry.groupId);
        else next.set(entry.groupId, entry.tier);
        return next;
      });
    },
  });

  // The throwaways a crashed tab left on the account. Nothing a person did
  // asks for this; it is here because this is where an account is read.
  useZeropsThrowawaySweep({
    clientId: activeOrganization?.id,
    // Not on sign-in alone: deleting a token is a `project-write`, and the api
    // admits one only through the epoch's grant (`admitWritesThrough`), which
    // refuses it once its wait for the first grant ran out. The sweep ran on
    // mount, was refused, and gave up for the life of that mount — so four
    // door tokens from deleted projects were still on the account hours later
    // (measured 2026-09-19). The account having been read is the grant admitted.
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
        forgetBirth(candidate.project.id);
      }
    }
  }, [birthProjectIds, candidates]);

  // The two-hop registration flow: the platform's own word on what it claimed
  // for the new account, preferred over inferring it from a candidate's
  // status. A returning account never infers a new setup flow from an
  // unrelated provisioning project in the inventory. The claimed project is
  // born like any other once the inventory lists it: a claim hands over a
  // brand-new project, so the newest one of its organization is it.
  const claimRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRegistration) {
      const { clientId, zcpClaimed } = deriveProvisioningStart(lastRegistration);
      clearLastRegistration();
      if (!clientId) return;
      // No ready-made project to wait on: the only way forward is to create one.
      if (zcpClaimed === false) {
        void navigate({ to: "/zerops/new" });
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
    beginBirth({
      projectId: claimed.id,
      organizationId: claimIn,
      registration: null,
      container: true,
    });
  }, [clearLastRegistration, inventory.projects, lastRegistration, navigate]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking your Zerops session…
      </div>
    );
  }
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
  const listingNotice = projectsListingNotice(listing, nowMs);
  const pageError = projectsPageError({
    connectError: connectErrorOnRow ? null : connectError,
    inventoryError: error,
    listingNotice,
  });
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
    const tags = readZeropsGroupTags(candidate.project.tagList);
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
    const declared = declaredEnvironment(candidate.project.id);
    const deployTone = declared === undefined ? undefined : deployRowTone(declared.tone);
    const deployLabel = declared === undefined ? undefined : deployWord(declared.tone);
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
        menu={renderEnvironmentMenu(candidate, tags, false)}
        // `Links - stage` under a heading that says `Links`: the group's
        // own page calls it `stage`, and so does the left menu.
        name={environmentNameUnderGroup(tags.label, candidate.project.name)}
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
              : declaredEnvironmentSummary(declared)
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
    const tags = readZeropsGroupTags(candidate.project.tagList);
    const connected = candidate.group === "connected";
    const busy = busyKeys.has(candidate.key);
    const live =
      connected && candidate.environmentId !== undefined
        ? activity.get(candidate.environmentId)
        : undefined;
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
    const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
    const tint = tints.get(candidate.project.id) ?? "slate";

    if (connected && candidate.environmentId !== undefined) {
      const environmentId = candidate.environmentId;
      // The update control's line ("Server x.y.z · x.y.z+1 available")
      // stays off the card: the version is in the menu, and so is the
      // update verb the control supplies.
      return (
        <ZeropsMateUpdateControl environmentId={environmentId} key={candidate.key}>
          {({ menuActions }) => (
            <ZeropsMateCard
              action={startAction ?? removeAction}
              busy={busy}
              face={mateFace(candidate)}
              layout={layout}
              line={renderMateLine(candidate, presentation, action, live, busy)}
              menu={renderEnvironmentMenu(candidate, tags, true, action, menuActions)}
              name={name}
              onSelect={select}
              preview={preview}
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
        line={renderMateLine(candidate, presentation, action, live, busy)}
        menu={renderEnvironmentMenu(candidate, tags, true, action, [])}
        name={name}
        onSelect={select}
        preview={preview}
        tint={tint}
      />
    );
  };

  /**
   * A tool, in the page's last quiet line: its name as the way to it, and its
   * menu. The project's own name, not the tool's — it is deliberately not
   * called "Gitea" (it holds the broker and the groups' runners too,
   * `tools.ts`), and a line that says "Gitea" sends somebody to Zerops looking
   * for a project by that name.
   */
  const renderTool = (candidate: ZeropsCandidatePresentation, kind: ZeropsToolKind) => {
    // A tool has no Mate and never will: Gitea's own state (`deriveGiteaState`,
    // read once for the account) says whether it is up and where it is; the
    // platform's project status covers the minutes before its services exist.
    const gitea = accountGitea?.projectId === candidate.project.id ? accountGitea.state : undefined;
    const line = giteaToolLine({
      projectStatus: candidate.project.status,
      phase: gitea?.phase,
      url: gitea?.url,
    });
    const name = candidate.project.name || TOOL_LABEL[kind];
    return (
      <span className="group/tool inline-flex items-center gap-1" data-zerops-surface="tool">
        {line.kind === "link" ? (
          <a
            className="underline-offset-2 hover:text-foreground hover:underline"
            data-zerops-surface="tool-link"
            href={line.url}
            rel="noreferrer"
            target="_blank"
          >
            {name}
          </a>
        ) : (
          <span>
            {name}
            {line.kind === "setting-up"
              ? " · Setting up."
              : line.kind === "unavailable"
                ? " · Not available."
                : ""}
          </span>
        )}
        <ZeropsProjectMenu
          actions={[]}
          enablingServiceId={route.enablingServiceId}
          label={`More for ${name}`}
          offers={candidate.routeOffers}
          onEnableRoute={(offer) => {
            void route.enable(candidate.project.id, offer.serviceId);
          }}
          routes={candidate.routes}
        />
      </span>
    );
  };

  /**
   * A project's own quiet actions: its name, the environments a person adds
   * to it — another Mate, a stage, which is optional and never a step before
   * production (D16, D28) — and, where the recipe still has room for one, a
   * production.
   *
   * The flow's own `add-production` next step stays the usual way there: it
   * needs `main` to have code, which today is read only from a merged code
   * pull request still in the recent list (`groupFlowInputOf`'s own
   * `mainHasCode`/`mainHead` go unread for every group). That misses the code
   * a recipe planted at birth and any merge that has since scrolled off, so
   * the menu offers the same verb on the one thing this account can always
   * answer — whether the role is still there to take (`creatableRoles`) and
   * whether this person may create one at all — rather than only on a signal
   * that is silent for most groups.
   */
  const renderGroupMenu = (group: ZeropsGroup) => (
    <ZeropsProjectMenu
      actions={[
        {
          id: "rename-group",
          label: groupNameIsPlaceholder(group) ? "Name this project" : "Rename project",
          onSelect: () => {
            setRowDialog({ kind: "rename-group", group });
          },
        },
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
              {
                id: "add-stage",
                label: "Add stage — optional",
                disabled: creationRunning,
                onSelect: () => {
                  requestEnvironment(group.groupId, "stage");
                },
              },
            ]
          : []),
        ...(mayCreate && creatableRoles(group).includes("prod")
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
      ]}
      label={`More for ${group.name}`}
    />
  );

  /**
   * The rows of a project that are not one of its four steps: why *Release*
   * is not offered, what it would carry, the releases (each with the way back
   * to it) and the changes waiting on its recipe. `null` where it has none.
   */
  const renderGroupRows = (group: ZeropsGroup): React.ReactNode => {
    const gate = releaseGateLine(group);
    const contents = releaseContentLines(group);
    // The releases, newest first, each with the broker's word and, on an
    // earlier approved one, the way back to it.
    const releases = (groupDeploys.get(group.groupId)?.releases ?? []).map((release) => {
      const tone = releaseRowTone(release.verdict);
      const rollingBack = projectFlow.pending.has(
        flowVerbKey({ kind: "roll-back", groupId: group.groupId, tag: release.tag }),
      );
      return (
        <ZeropsEnvironmentRow
          action={
            release.rollBack ? (
              <ZeropsMateVerb
                disabled={rollingBack}
                label={flowVerbLabel("roll-back", rollingBack)}
                onClick={() => {
                  void projectFlow.rollBack(group.groupId, release.tag);
                }}
              />
            ) : undefined
          }
          key={`release-${group.groupId}-${release.tag}`}
          name={release.tag}
          status={
            tone === undefined || release.word === undefined ? undefined : (
              <StatusDot label={release.word} sentence tone={tone} />
            )
          }
          summary={release.line}
          tag="release"
        />
      );
    });
    // The recipe changes waiting on somebody: last, under the environments
    // they would change.
    const recipes = (groupDeploys.get(group.groupId)?.pullRequests ?? [])
      .filter((pull) => pull.kind === "recipe")
      .map((pull) => pullRequestRowOf(group, pull, { withMerge: true, compact: false }));
    if (gate === null && contents === null && releases.length === 0 && recipes.length === 0) {
      return null;
    }
    return (
      <>
        {gate}
        {contents}
        {releases}
        {recipes}
      </>
    );
  };

  /**
   * The verb of a project's next step, where the step says one (`groupFlow`).
   * Each acts on the thing it names: a Mate opens, a failed deploy's build
   * and a blocked change open their pages, a merge merges as the person, a
   * release asks first, and production is added here — not by the Mate.
   */
  const renderNextStep = (
    entry: ProjectsFlowGroup<ZeropsCandidatePresentation>,
    placement: NextStepPlacement,
  ): React.ReactNode => {
    const { group, flow } = entry;
    const step = flow.nextStep;
    const target = step.target;
    if (step.verb === undefined || target === undefined) return null;
    const verb = (onClick: () => void, disabled = false, label = step.verb) => (
      <Button
        data-zerops-next-step-verb={step.kind}
        disabled={disabled}
        onClick={onClick}
        size="compact"
        variant="outline"
      >
        {label}
      </Button>
    );
    switch (target.kind) {
      case "release":
        // In its cell the version is line 2 (`v0.1.0 ready`) and the verb
        // beside it is the one word, so the line stays readable; the strip has
        // no such line, so there the verb names the version itself.
        return (
          <ZeropsReleaseVerb
            groupId={group.groupId}
            label={placement === "strip" ? step.verb : flowVerbLabel("release", false)}
          />
        );
      case "add-production": {
        // Whose production is — the person's to add, not the Mate's — is the
        // verb's to say where it is pressed; its cell stays one line. Beside
        // the button, not in it, so its name stays "+ Add production".
        const hintId = `add-production-hint-${group.groupId}`;
        return (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-describedby={hintId}
                    data-zerops-next-step-verb={step.kind}
                    disabled={creationRunning}
                    onClick={() => {
                      requestEnvironment(group.groupId, "prod");
                    }}
                    size="compact"
                    variant="outline"
                  />
                }
              >
                {`+ ${step.verb}`}
              </TooltipTrigger>
              <TooltipPopup>{PRODUCTION_ADDED_HERE}</TooltipPopup>
            </Tooltip>
            <span className="sr-only" id={hintId}>
              {PRODUCTION_ADDED_HERE}
            </span>
          </>
        );
      }
      case "mate": {
        const mate = entry.mates.find((item) => item.project.id === target.projectId);
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
      case "change": {
        const slug = groupDeploys.get(group.groupId)?.slug;
        const pull = flow.pullRequests.find(
          (entry_) =>
            entry_.pull.repository === target.repository && entry_.pull.number === target.number,
        )?.pull;
        if (step.kind === "merge" && slug !== undefined && pull !== undefined) {
          const merging = projectFlow.pending.has(
            flowVerbKey({ kind: "merge", slug, repository: pull.repository, number: pull.number }),
          );
          return verb(
            () => {
              void projectFlow.mergePullRequest(slug, pull);
            },
            merging,
            flowVerbLabel("merge", merging),
          );
        }
        return verb(() => {
          void navigate({
            to: "/change/$groupId/$repository/$number",
            params: {
              groupId: group.groupId,
              repository: target.repository,
              number: String(target.number),
            },
          });
        });
      }
    }
  };

  // Every group's flow, from the one derivation the thread and the left menu
  // read too (`groupFlow`): what each step holds and the one next step.
  const mayCreate = canCreateProjectsInOrganization(activeOrganization);
  const flowGroups = groupTree.groups.map(
    ({ group, environments }): ProjectsFlowGroup<ZeropsCandidatePresentation> => {
      const reads = groupDeploys.get(group.groupId);
      const members = groupMemberFactsOf(environments, (item) =>
        item.environmentId === undefined ? undefined : activity.get(item.environmentId),
      );
      const isStop = (role: ZeropsEnvironmentRole | undefined) =>
        role === "stage" || role === "prod";
      const placeholder = groupNameIsPlaceholder(group);
      return {
        group,
        flow: groupFlow(
          groupFlowInputOf({
            groupId: group.groupId,
            members,
            flow: reads,
            deployments: projectFlow.deployments,
            productionAddable: productionAddable({
              group,
              mayCreate,
              addsOffered: addsOfferedFor(group),
            }),
          }),
        ),
        read: reads !== undefined,
        // Out and expected back: a Gitea session is held or coming, and the
        // group has an org to read (or the registry has not answered yet).
        awaiting:
          reads === undefined &&
          projectFlow.signInTrouble === null &&
          (projectFlow.slugs.size === 0 || projectFlow.slugs.has(group.groupId)),
        mates: environments.filter(({ item }) => hasMate(item)).map(({ item }) => item),
        stops: new Map(
          environments
            .filter(({ role }) => isStop(role))
            .map((entry) => [entry.item.project.id, entry] as const),
        ),
        others: environments.filter(({ item, role }) => !hasMate(item) && !isStop(role)),
        lastMerged: reads === undefined ? undefined : lastMergedCode(reads.merged),
        // Visible rather than a tooltip: it is an invitation to name the
        // project, and it disappears the moment one does.
        line: projectsGroupLine({
          placeholder,
          unfinished: unfinished.get(group.groupId),
          gitea: groupLines.get(group.groupId) ?? "",
        }),
        placeholder,
      };
    },
  );
  const ungroupedRows = groupTree.ungrouped.map((candidate) => ({
    item: candidate,
    action: deriveZeropsRowAction(rowInput(candidate)).kind,
  }));

  return (
    // The page's end clears the app's fixed "Open main sidebar" control, so
    // the last row is never under it with the menu closed.
    <div className="space-y-6 pb-12">
      {listingNotice === null ? null : listingNotice.region === "message" ? (
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
          <Spinner className="size-3.5" />
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
      {/* A project the grant withholds says why in place of its rows: its name,
          tags and Mates are its content, so none of them is drawn (DESIGN §3.4). */}
      {withheldProjectNotices(inventory).map((notice) => (
        <p className="text-xs text-muted-foreground" key={notice} role="status">
          {notice}
        </p>
      ))}
      <ZeropsProjectsFlow
        // A group is offered more once its first Mate is up — connected, or
        // its container answering ready — and not a minute before.
        addsOffered={addsOfferedFor}
        creating={creationRunning}
        focusGroup={search.group}
        getKey={(candidate: ZeropsCandidatePresentation) => candidate.key}
        groups={flowGroups}
        isMate={hasMate}
        onCreateEnvironment={requestEnvironment}
        onCreateProject={
          hasNoZeropsProject({ listing, creationPending: activeBirths })
            ? () => {
                void navigate({ to: "/zerops/new" });
              }
            : undefined
        }
        // A Gitea the grant withholds is still the account's: never offered a second.
        {...(holdsGitea
          ? {}
          : {
              onCreateTool: () => {
                void createTool();
              },
            })}
        openMate={mateOpenerOf}
        onRetryContainers={(items) => {
          for (const candidate of items) runRowAction(candidate, "retry-probe");
        }}
        renderEnvironment={renderEnvironment}
        renderGroupMenu={renderGroupMenu}
        renderGroupRows={renderGroupRows}
        renderMate={renderMate}
        renderMateFace={(candidate: ZeropsCandidatePresentation, size) => (
          <MateFace
            size={size}
            state={mateFace(candidate)}
            tint={tints.get(candidate.project.id) ?? "slate"}
          />
        )}
        renderNextStep={renderNextStep}
        renderPullRequest={pullRequestRowOf}
        renderReleaseVerb={({ group, flow }) => {
          const { production } = flow;
          const candidate =
            production.kind === "ready-to-release" || production.kind === "deploy-failed"
              ? production.candidate
              : undefined;
          if (candidate === undefined) return null;
          return (
            <ZeropsReleaseVerb
              groupId={group.groupId}
              label={`${flowVerbLabel("release", false)} ${candidate.tag}`}
            />
          );
        }}
        renderStopMenu={(candidate: ZeropsCandidatePresentation) =>
          renderEnvironmentMenu(candidate, readZeropsGroupTags(candidate.project.tagList), false)
        }
        renderTool={renderTool}
        tools={groupTree.tools}
        ungrouped={ungroupedRows}
        view={search.view ?? "overview"}
      />
      {mateActions.dialogs}
      {rowDialog?.kind === "rename-group" ? (
        <ZeropsRenameDialog
          description="The name is written onto every environment in the project."
          initialValue={rowDialog.group.nameSource === "id" ? "" : rowDialog.group.name}
          key={`rename-group:${rowDialog.group.groupId}`}
          label="Project name"
          onCancel={() => {
            setRowDialog(null);
          }}
          onOpenChange={(open) => {
            if (!open) setRowDialog(null);
          }}
          onSubmit={(name) => {
            const { group } = rowDialog;
            setRowDialog(null);
            void renameGroup.rename(group, name);
          }}
          open
          submitLabel="Rename"
          title={rowDialog.group.nameSource === "id" ? "Name this project" : "Rename the project"}
          validate={(value) => (value.trim().length === 0 ? "Give the project a name." : undefined)}
        />
      ) : null}
      {creationRequest === null || requestedGroup === undefined ? null : (
        <ZeropsEnvironmentCreationDialog
          tier={groupRecipe.tier}
          tierServices={groupRecipe.services}
          tierLoading={groupRecipe.loading}
          defaultBotName={creationRequest.botName}
          defaultName={proposedEnvironmentName({
            groupName: requestedGroup.group.name,
            roleLabel:
              environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
            botName: creationRequest.role === "dev" ? creationRequest.botName : undefined,
            taken: requestedGroup.environments.map(({ item }) => item.project.name),
          })}
          proposeName={(botName) =>
            proposedEnvironmentName({
              groupName: requestedGroup.group.name,
              roleLabel:
                environmentRoleLabel(creationRequest.role)?.toLowerCase() ?? creationRequest.role,
              botName: creationRequest.role === "dev" ? botName : undefined,
              taken: requestedGroup.environments.map(({ item }) => item.project.name),
            })
          }
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
      {toolError === null &&
      births.outstanding === null &&
      renameGroup.trouble === null &&
      route.trouble === null ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">
          {toolError ?? births.outstanding ?? renameGroup.trouble ?? route.trouble}
        </p>
      )}
    </div>
  );
}

export function ZeropsProjectsPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const navigate = useNavigate();
  // The same page is the signed-in door at `/`, so the search is read loosely
  // and through the route's own parser: anything but `/zerops?view=projects`
  // is the Overview.
  const search = parseProjectsSearch(useSearch({ strict: false }));
  const { listing, isLoading, refresh } = useZeropsCandidates();
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  // First run owns the page: an account with nothing in it gets the
  // invitation and no title row over it — a "Projects" heading with a reload
  // over nothing frames emptiness as a failed list.
  const { births } = useZeropsBirths();
  const firstRun = hasNoZeropsProject({
    listing,
    creationPending: births.some((birth) => birth.organizationId === activeOrganization?.id),
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
        <ZeropsProjectsHeader
          onRefresh={refresh}
          onView={(view) => {
            void navigate({
              to: "/zerops",
              search: view === "projects" ? { view: "projects" } : {},
            });
          }}
          refreshing={isLoading}
          view={search.view ?? "overview"}
        />
      ) : null}
      <ZeropsProjectsContent search={search} />
    </ZeropsHostedFrame>
  );
}
