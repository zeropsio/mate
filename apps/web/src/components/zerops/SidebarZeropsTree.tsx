import { mateStatus } from "../../zerops/mateStatus.logic";
import { MateStatusMarker } from "./MateStatusMarker";
/**
 * The left menu's projects: each a heading, then its Mates, each with its
 * crew and its open changes.
 *
 * A project's heading is its name and its chips — one for its stage or
 * stages, one for production, each its word alone, turning amber or red when
 * something is wrong — and, while the project is folded, the faces of its
 * Mates that are busy.
 * Folding or unfolding it never moves the heading.
 *
 * Under it, its Mates: the menu's own kind of row, the way a messenger lists
 * people. The face in its colour wears the conversation's state on the name's
 * line; the owner's picture comes before the name; at the right edge, when
 * the Mate last did something, or the run's clock; under the name, what the
 * person last asked, then the Mate's last words — or the step it is on, the
 * question it waits on, the error it stopped on (`mateRowView`). No word says
 * the state: the face, a dot and the words do. One band, the list's own,
 * lights the open Mate and slides to the next one opened
 * (`SidebarSelectedBand`).
 *
 * A Mate's crew stands one line under it (`SidebarCrewLine`), lit with it as
 * one (`MateUnit`), then its open pull requests, a line each — the mark,
 * `#N title` and *Review*, the one door to merging — folded behind a count
 * past three (`pullRequestsFolded`).
 * After the Mates come those being created, and the ones untouched for a week
 * folded behind their count. *New project* stands at the menu's foot, under the
 * list's scroll (`SidebarNewProject`).
 *
 * A project collapses to its heading, the usual sidebar gesture, and the menu
 * remembers it; opening one of its Mates' conversations opens it again. A
 * reload paints what the sources say as they answer: nothing of them is kept.
 *
 * Membership is `hasMate` — the project declares a Mate or a container backs
 * one, and never stage or production — not the live connection, so a
 * container going to sleep changes a face rather than rearranging the menu.
 * Grouping is `buildZeropsGroupTree`, the same derivation the projects screen
 * uses, so the two surfaces can never disagree about which project an
 * environment is in; the colours are `assignCandidateMateTints`, likewise
 * shared. Which pull requests are a Mate's to answer for, and what the
 * chips say, are read from `groupFlow` — the same derivation the projects
 * page draws from, including recipe changes, so a chip never says what the
 * page would not.
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import { RunShimmer } from "../chat/RunShimmer";
import { useWarmIntent } from "../chat/warmTimeline";
import {
  assignCandidateMateTints,
  buildZeropsGroupTree,
  groupFlow,
  hasMate,
  mateEnvironmentsEmptyReason,
  mateShapeOf,
  pullRequestsByMate,
  pullRequestsFolded,
  rankZeropsCandidateForListing,
  readZeropsMembership,
  selectMateEnvironments,
  sidebarChangeLabel,
  changeAsksForReview,
  changeShowsReview,
  listedStopComing,
  matePoseOf,
  projectNameInApp,
  stopServes,
  type EnvironmentRow,
  type FlowPullRequest,
  type MateRunFacts,
  type Moved,
  type GroupFlow,
  type GroupEnvironmentTier,
  type GroupFlowStop,
  type ListedStop,
  type MissingEnvironmentRow,
  missingEnvironmentRows,
  type StopComing,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGroup,
  type ZeropsGroupPendingMember,
  type ZeropsPlacedBirth,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { useAtomValue } from "@effect/atom-react";
import {
  shownHqMateIdentitiesAtom,
  shownHqPersonFactsAtom,
  hqMatePresenceAtom,
  shownAttentionProjectsAtom,
  shownHqMenuNavigationAtom,
} from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { mateOwnerRecords } from "@t3tools/client-runtime/zerops/mateAccess";
import { deployActivatedAt } from "@t3tools/client-runtime/zerops/flow";
import type { KnownAffordance } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  BellOffIcon,
  CircleAlertIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  GitPullRequestIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { Atom } from "effect/unstable/reactivity";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { cn } from "~/lib/utils";
import { formatShortTimestamp, formatUpcomingTimestamp } from "~/timestampFormat";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarComingEnds } from "./SidebarComingEnds";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  activityOfNow,
  mateRunOf,
  mateAwake,
  mateBirthFace,
  mateReviewWaits,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { useBuildsUnderWay } from "~/zerops/ZeropsAccountData";
import { HQ_LAST_KNOWN, type HqOutage } from "~/zerops/hqNavigation";
import type { MateComing } from "~/zerops/mateComing";
import { mateRowCues } from "~/zerops/mateMoments.logic";
import { useStopDeploymentsShown } from "~/zerops/projectFlows";
import { useStopDeploymentDemand } from "~/zerops/accountForge";
import { findInventoryProjectRef, InventoryContext } from "~/zerops/inventoryContext";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useMateLinkedInHq } from "~/zerops/useMenuMateReadings";
import type { FixProblem } from "~/zerops/fixRequest";
import { useOpenReview } from "~/zerops/review";
import { usePendingSentAsk } from "~/zerops/sentAsk";
import { hqDown, hqPlacementsAtom, hqNavigationAtom } from "~/state/zerops";
import { useMateCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { mayBearHq } from "@t3tools/shared/zeropsRoles";
import { useAccountHq, useCarriedCoreBuild } from "~/zerops/accountHq";
import { ZeropsHqUpdate } from "./ZeropsHqUpdate";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { readCollapsedProjects, writeCollapsedProjects } from "~/zerops/collapsedProjects";
import {
  movedBefore,
  rememberProjectsOnScreen,
  useProjectOrder,
} from "~/zerops/projectOrderPreference";
import { useEnvironmentOffers } from "~/zerops/useAddEnvironment";
import {
  useHqProjectPerson,
  zeropsMateOwnerOf,
  useWaitsOnViewer,
  type ZeropsMateOwner,
} from "~/zerops/useZeropsMateOwners";
import { SidebarMateAge } from "./SidebarMateAge";
import { SidebarCrewLine, type SidebarCrewRead } from "./crew/SidebarCrewLine";
import { SidebarSelectedBand } from "./SidebarSelectedBand";
import { KeyChip, MateFace } from "./primitives";
import { groupNameUnread } from "./ZeropsGroupTree.logic";
import { STOP_ARM_MS, stopArmStep, type StopArm, type StopArmEvent } from "./SidebarStopArm.logic";
import { formatWorkingTime, isQuietMate, sidebarMateKey } from "./SidebarZeropsTree.logic";
import { MateMenu, MateRenameField, type MateRowActions, type MenuPoint } from "./SidebarMateMenu";
import {
  SidebarProjectFold,
  SidebarProjectFoldedRoom,
  type ProjectFoldMotion,
} from "./SidebarProjectFold";
import {
  headingFaces,
  landingAfterDraw,
  projectRoom,
  slackAfterScroll,
  slackForFold,
  type HeadingFace,
  type HeadingFaceDot,
  type PendingLanding,
} from "./SidebarProjects.logic";
import { SidebarProductionChip } from "./SidebarProductionChip";
import {
  buildingOf,
  asLastKnown,
  chipDot,
  chipFace,
  drawnChip,
  productionMenu,
  projectChips,
  stageMenu,
  stageStopChip,
  STOP_DOT,
  stopServing,
  type ChipView,
  type ReleasesAnswer,
  type ReleaseFailure,
  type StopServing,
} from "./SidebarProductionChip.logic";
import {
  changeMarkTone,
  mateBornLine,
  mateBornLineText,
  mateComingRowView,
  mateLifeOf,
  mateRowOffersMenu,
  mateCrewItem,
  mateDeletingView,
  mateFinishingView,
  mateNotYours,
  mateOwnerView,
  mateRowAskLine,
  mateRowDraft,
  mateRowPropsEqual,
  mateRowReading,
  pendingBornLine,
  type MateBornLine,
  type MateRowAskLine,
  type MateRowReply,
  type MateRowSlot,
  ownerBadge,
  type BadgeSeat,
} from "./SidebarMateRow.logic";
import { MATE_DELETING_WORD } from "./ZeropsDeleteMateDialog.logic";
import { finishSetupRowLine, useMatePress } from "~/zerops/matePress";
import { mateDeleting, useDeletingMates } from "~/zerops/deletingMates";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarReveal, type SidebarRevealTarget } from "~/zerops/sidebarReveal";
import {
  EMPTY_JUMP_INDEX,
  jumpMateOf,
  type JumpChange,
  type JumpMate,
  type JumpProject,
  type JumpStop,
  type SidebarJumpIndex,
} from "./JumpBox.logic";
import {
  keyboardTarget,
  movedAnnouncement,
  ProjectGrip,
  useProjectReorder,
} from "./SidebarProjectReorder";
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  tiersAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import {
  HeadingReleaseMark,
  HeadingSubLine,
  headingPillMotion,
  useHeadingLine,
} from "./SidebarHeadingLine";
import { headingMark, type HeadingLineInput } from "./SidebarHeadingLine.logic";

const menuPlacementKnownAtom = Atom.make((get) => get(hqPlacementsAtom) !== null);
const menuPersonFactsAtom = Atom.make((get) =>
  Object.fromEntries(
    Object.entries(get(shownHqPersonFactsAtom)).map(([id, fact]) => [id, { mine: fact.mine }]),
  ),
).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));
const menuHqPresenceAtom = Atom.make((get) => {
  const mates = new Map<
    string,
    { readonly presence: import("@t3tools/shared/hqMates").MatePresence }
  >();
  for (const id of get(shownAttentionProjectsAtom)) {
    const fact = get(hqMatePresenceAtom(id));
    if (fact.live && fact.presence !== null) mates.set(id, { presence: fact.presence });
  }
  return mates;
}).pipe(
  Atom.withEquality(
    (
      a: ReadonlyMap<string, { readonly presence: import("@t3tools/shared/hqMates").MatePresence }>,
      b,
    ) =>
      a.size === b.size &&
      [...a].every(([id, mate]) => b.get(id)?.presence.online === mate.presence.online),
  ),
);
/** What the client holds per environment, when it holds anything. */
type RosterCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly services?: ZeropsEnvironmentServices;
};

type Entry<T> = { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined };

/** The set with the group collapsed or not; the same set where nothing changed. */
function withCollapsed(
  current: ReadonlySet<string>,
  groupId: string,
  collapse: boolean,
): ReadonlySet<string> {
  if (current.has(groupId) === collapse) return current;
  const next = new Set(current);
  if (collapse) next.add(groupId);
  else next.delete(groupId);
  return next;
}

/** Whether this menu holds what a reveal asks to show: another menu's ask is not its to answer. */
function holdsRevealTarget(
  candidates: ReadonlyArray<RosterCandidate>,
  target: SidebarRevealTarget,
): boolean {
  if (target.kind === "mate") {
    return candidates.some((candidate) => candidate.project.id === target.projectId);
  }
  return candidates.some(
    (candidate) => readZeropsMembership(candidate.project).groupId === target.groupId,
  );
}

/** The group of the project whose conversation is open, when it has one. */
function groupIdOf(
  candidates: ReadonlyArray<RosterCandidate>,
  projectId: string | null | undefined,
): string | undefined {
  if (projectId === undefined || projectId === null) return undefined;
  const open = candidates.find((candidate) => candidate.project.id === projectId);
  return open === undefined ? undefined : readZeropsMembership(open.project).groupId;
}

/**
 * One project's flow as `groupFlowInputOf` reads it — the projects page's
 * own input — from what the menu holds. Only whether a release is offered
 * reaches this menu, not the gate's reason; `groupFlow` decides on the
 * former alone. The release on its way does, so production says it.
 */
function groupFlowReadsOf(flow: SidebarProjectFlow): GroupFlowReads {
  return {
    environments: [...flow.environments.values()],
    pullRequests: flow.pullRequests,
    merged: flow.merged ?? [],
    release: {
      gate: flow.releaseOffered ? { allowed: true } : { allowed: false, reason: "" },
      suggestion: flow.releaseTag ?? "",
      inFlight: flow.releaseInFlight,
      contents: flow.releaseContents ?? [],
      summary: flow.releaseSummary,
      untold: flow.releaseUntold ?? [],
    },
  };
}

/** No production service whose commit cannot be told. */
const NO_UNTOLD: ReadonlyArray<string> = [];
const NO_BIRTHS: ReadonlyArray<ZeropsPlacedBirth> = [];

/**
 * One project's flow, as the menu needs it: the open pull requests, each
 * declared environment's row by its Zerops project, and what production runs
 * and has waiting — as HQ tells it to the person. Nothing here merges or
 * releases: that is the review's (R1).
 */
export interface SidebarProjectFlow {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /**
   * Whether HQ told the project's changes; absent reads as told. Until it
   * does, `pullRequests` is empty for want of an answer, and the menu draws
   * no change row.
   */
  readonly changesKnown?: boolean | undefined;
  readonly environments: ReadonlyMap<string, EnvironmentRow>;
  readonly releaseOffered: boolean;
  /**
   * The pull requests that have landed on `main`, for `groupFlow`'s own next
   * step — a Mate nobody has spoken to still reads as fresh once something of
   * its has already merged. Absent where the caller has not wired it yet;
   * `groupFlow` then falls back to a merged *code* pull request as its only
   * proof that `main` has code.
   */
  readonly merged?: ReadonlyArray<FlowPullRequest> | undefined;
  /**
   * What a release would carry, per production service: how many changes wait
   * for production, the count the production chip wears.
   */
  readonly releaseSummary?: { readonly total: number; readonly atLeast: boolean } | undefined;
  readonly releaseContents?: ReadonlyArray<Moved> | undefined;
  /** Production's services whose commit cannot be told: nothing is said to wait on them. */
  readonly releaseUntold?: ReadonlyArray<string> | undefined;
  /**
   * Whether HQ answered the application's releases; absent reads as answered.
   * Until it does, production's chip says only what the platform says.
   */
  readonly releasesKnown?: boolean | undefined;
  /**
   * The newest release that did not go through, newer than the one production
   * runs (`releaseFailureOf`): the production chip turns amber, and its menu
   * says what failed, when and in whose words.
   */
  readonly releaseFailure?: ReleaseFailure | undefined;
  /**
   * Opens the stop's own page, in place of the thread.
   *
   * What is running, what is in it, what is not in it yet and where it is —
   * the questions a 256px row cannot answer. *History* used to be a link into
   * Gitea, and so did the version beside it; neither worked, because the app
   * held the only Gitea token and a person's browser had no session there, so
   * both arrived at a sign-in page (measured 2026-09-19).
   */
  readonly onOpenStop?: ((row: EnvironmentRow) => void) | undefined;
  /**
   * Opens a change's own page — what it carries, what is stopping it, and the
   * verb that moves it.
   *
   * `#4` used to be a link into Gitea, and Gitea was a sign-in page for
   * everybody: the app held the only token. "This links to gitea as well, no
   * built in interface for PR" (the owner, 2026-09-19).
   */
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** Whether the group's recipe is read, and the tiers it holds: the project menu's *Add* offers. */
  readonly recipeRead?: boolean | undefined;
  readonly recipeTiers?: ReadonlyArray<GroupEnvironmentTier> | undefined;
  /** The version a release would tag. */
  readonly releaseTag?: string | undefined;
  /** The release tag on its way to production (`releaseInFlight`), which the chip says. */
  readonly releaseInFlight?: string | undefined;
}

export interface SidebarZeropsTreeProps<T extends RosterCandidate> {
  readonly candidates: ReadonlyArray<T>;
  readonly keyedReadings?: boolean;
  readonly onSelect: (candidate: T) => void;
  /**
   * Asks for a Mate in a project: the New Mate dialog opens over whatever is on screen
   * (`useAddMate`). Absent — a harness — the heading's + does nothing.
   */
  readonly onAddMate?: ((groupId: string) => void) | undefined;
  /** Opens the form that sets a stage or a production up; absent, its item opens the projects page. */
  readonly onSetUp?: ((groupId: string, tier: GroupEnvironmentTier) => void) | undefined;
  /**
   * A Mate in its first minutes (`mateComing`): still coming up, or never came. Its row says so
   * in the projects page's words, asleep, with no menu, and a press opens its own view. Absent,
   * a listed Mate is up as far as the tree knows.
   */
  readonly getComing?: ((candidate: T) => MateComing | undefined) | undefined;
  /**
   * Opens the view of a Mate being created that the listing does not hold yet — its row is its
   * birth's (`group.pending`) — by the project the platform made for it.
   */
  readonly onOpenComing?: ((projectId: string) => void) | undefined;
  /** Opens the projects screen — the way out of a menu whose projects have no Mate. */
  readonly onBrowseProjects: () => void;
  /**
   * "Ask <your Mate> to fix it" (S6): writes the problem into the Mate's
   * composer, not sent (`useAskMateToFix`). Absent, the chip's menu offers no
   * fix.
   */
  readonly onAskToFix?: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  readonly activeProjectId?: string | null;
  /**
   * What this agent is doing right now.
   *
   * Injected because the answer is a thread's status through the one resolver
   * (`agentActivity.ts`, R5) — this tree must not grow a second opinion about
   * whether an agent is working. Absent for an environment mate is not
   * connected to, because then nobody knows.
   */
  readonly getActivity?: (candidate: T) => ZeropsAgentActivity | undefined;
  /**
   * Its conversations have been read — its environment's shell arrived — so a Mate with none has
   * nothing asked yet. Absent, nobody knows, and its row says nothing of it.
   */
  readonly getConversationsRead?: ((candidate: T) => boolean) | undefined;
  /**
   * Whose this Mate is — the person its project names as `OWNER`, or who
   * signed its agent in, once the org's member list has been read. Absent,
   * the seat before the name is what the Mate's own records say
   * (`mateOwnerView`): a plain disc where they name somebody not named yet,
   * an empty seat where they name nobody — the name starts on one edge either
   * way.
   */
  readonly getOwner?: ((candidate: T) => ZeropsMateOwner | undefined) | undefined;
  /**
   * The project's flow, when the menu has read it (`useProjectFlows`).
   * Absent — no HQ open, nothing read yet — the menu keeps its
   * shape and simply carries none of what the flow says: no change row.
   */
  readonly getFlow?: ((groupId: string) => SidebarProjectFlow | undefined) | undefined;
  readonly className?: string;
  /**
   * The listing is known and complete, and every row's presence is read
   * (`candidatesComplete`). Until then the tree says its notice rather than
   * "none". A re-read is not that — the list already read stays up.
   */
  readonly complete: boolean;
  /**
   * What the tree says while the listing may not say "none" yet
   * (`candidatesNotice`, DESIGN §3.4) — in place of the empty state when it has
   * nothing to draw, under the rows when it holds some: a placeholder while it
   * is unread, the read's cause when it failed, "Still reading…" while a
   * project's presence is unread. Absent or `null`, it says nothing.
   */
  readonly notice?: CandidatesNotice | null;
  /**
   * The listing is still being read: with no row and no notice yet, the tree holds the rows' room
   * with a skeleton rather than drawing nothing.
   */
  readonly reading?: boolean;
  /** The notice's one affordance, pressed. */
  readonly onNoticeAct?: ((affordance: KnownAffordance) => void) | undefined;
  /** Opens the group's own page, in place of the thread. */
  readonly onOpenGroup?: ((groupId: string) => void) | undefined;
  /**
   * The creations under way in the organization in view (`placedBirthsIn`),
   * drawn in their groups before the listing holds them — the projects page
   * reads the same ones.
   */
  readonly births?: ReadonlyArray<ZeropsPlacedBirth> | undefined;
  /** How clock times read — the paused Mate's "picks up at" — per the viewer's setting. */
  readonly timestampFormat?: TimestampFormat;
  /**
   * What each Mate's own menu can do (`useSidebarMateMenus`). Absent — a
   * harness, a test — the rows carry no menu.
   */
  readonly getMateActions?:
    | ((candidate: T, activity: ZeropsAgentActivity | undefined) => MateRowActions | undefined)
    | undefined;
  /**
   * Opens a Mate's conversation on its Crew tab, with the setup sheet over it
   * for *Set up a crew* — its menu's crew item (`mateCrewItem`). Absent, the
   * menu offers none.
   */
  readonly onOpenCrew?: ((candidate: T, setUp: boolean) => void) | undefined;
  /**
   * Whether the menu lists this Mate — the account menu's Mine / Everyone
   * (`shownInScope`). Absent, every Mate.
   */
  readonly shown?: ((candidate: T) => boolean) | undefined;
  /**
   * A Mate's crew as a fixture draws it (a harness): its crew line, and
   * whether its menu offers *Set up a crew* or *Crew*. Absent, each Mate's
   * crew line and menu read its crew from HQ (`useMateCrew`).
   */
  readonly getCrew?: ((candidate: T) => SidebarCrewRead | undefined) | undefined;
}

/** What a change row acts with: the project's flow. */
type ChangeRows = Pick<SidebarProjectFlow, "onOpenChange">;

const ignoreUpdateState = (_state: boolean) => {};

/**
 * Memoised: the menu above it redraws on every event of a streaming Mate's chat, and its props —
 * the Mates, their activity, the verbs — stand while what they say does.
 */
export const SidebarZeropsTree = memo(SidebarZeropsTreeView) as typeof SidebarZeropsTreeView;

function SidebarZeropsTreeView<T extends RosterCandidate>({
  candidates,
  onSelect,
  onAddMate,
  onSetUp,
  getComing,
  onOpenComing,
  onBrowseProjects,
  onAskToFix,
  onOpenGroup,
  activeProjectId,
  getActivity,
  keyedReadings = false,
  getConversationsRead,
  getOwner,
  getFlow,
  complete,
  notice = null,
  reading = false,
  onNoticeAct,
  className,
  births = NO_BIRTHS,
  timestampFormat = "locale",
  getMateActions,
  onOpenCrew,
  shown,
  getCrew,
}: SidebarZeropsTreeProps<T>) {
  const structureView = useAtomValue(shownHqMenuNavigationAtom);
  const identities = useAtomValue(shownHqMateIdentitiesAtom);
  const session = useZeropsSessionOptional();
  const accountHq = useAccountHq(structureView.orgId ?? undefined);
  const carried = useCarriedCoreBuild();
  const [followingHqUpdate, setFollowingHqUpdate] = useState(false);
  const hqStale = structureView.structure !== null && hqDown(structureView);
  // Whose each Mate is, as HQ says it (invariant 11).
  const personFacts = useAtomValue(menuPersonFactsAtom);
  const placements = useAtomValue(hqPlacementsAtom);
  const appsWithWork =
    placements === null || structureView.structure === null
      ? []
      : structureView.structure.apps.filter(
          (app) => (getFlow?.(app.id)?.pullRequests.length ?? 0) > 0,
        );
  const emptyReason = candidates.some((candidate) => candidate.project.hq !== undefined)
    ? undefined
    : mateEnvironmentsEmptyReason(candidates);
  const openReleaseReview = useOpenReview();
  const hqMates = useAtomValue(menuHqPresenceAtom);
  // Which projects a build or deploy runs on now, as Zerops says: the headings' indicator.
  const building = useBuildsUnderWay(
    useMemo(() => candidates.map((candidate) => candidate.project.id), [candidates]),
  );
  const [openLists, setOpenLists] = useState<ReadonlySet<string>>(() => new Set());
  // Collapsed projects survive a reload: a person who collapsed one had a
  // reason, and a menu that expands everything on every boot makes them do it
  // again (the owner, 2026-09-19). Per account, so it never leaves the device.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsedProjects);
  useEffect(() => {
    writeCollapsedProjects(collapsed);
  }, [collapsed]);
  // Opening a Mate's conversation opens its project: the row lit as the one
  // open may not be hidden under a heading. Only when the open conversation
  // changes — a person may collapse the project again afterwards, and a menu
  // that forced it open on every render would not let them. Nothing seen yet
  // at mount: a reload on a Mate's conversation opens its project too.
  const activeGroupId = groupIdOf(candidates, activeProjectId);
  const [seenGroupId, setSeenGroupId] = useState<string | undefined>(undefined);
  if (seenGroupId !== activeGroupId) {
    setSeenGroupId(activeGroupId);
    if (activeGroupId !== undefined) setCollapsed(withCollapsed(collapsed, activeGroupId, false));
  }
  // Same preference the projects screen's sort control and the account menu
  // write (`projectOrderPreference.ts`) — read here too so the surfaces stay
  // in step without either one owning the other. In *Custom* the headings
  // take a grip, and every heading's menu moves its project up or down.
  const projectOrder = useProjectOrder();
  // Only the Mates HQ says wait on the viewer wait on them (`waitsOnViewer`).
  const waitsOnViewer = useWaitsOnViewer();
  // Whether *Add stage* and *Add production* stand in a project's menu: HQ's offer of each.
  const environmentOffers = useEnvironmentOffers();
  const treeRef = useRef<HTMLElement>(null);
  const reorder = useProjectReorder(treeRef);
  // A Mate opened from elsewhere — Add landing on the new Mate, a link, a
  // page — stands in view in the menu: its row scrolled to the nearest edge
  // once it is drawn (a new Mate's row comes a moment after its view, so every
  // draw looks until it is there). Not the one open at mount: a reload leaves
  // the menu where it was.
  const shownActiveRef = useRef(activeProjectId);
  useEffect(() => {
    if (activeProjectId == null || shownActiveRef.current === activeProjectId) return;
    const row = treeRef.current?.querySelector<HTMLElement>(
      `[data-zerops-mate-row="${CSS.escape(activeProjectId)}"]`,
    );
    if (row == null) return;
    shownActiveRef.current = activeProjectId;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  });
  // What "a week untouched" is measured from: the moment the menu was drawn.
  const [nowMs] = useState(Date.now);
  // What closes a stage's coming-up and first-deploy windows: the shared minute clock, so the
  // menu and the projects page close them together (no request of its own).
  const minuteMs = useNowMs();
  // The projects whose quiet Mates somebody unfolded; not remembered.
  const [openQuiet, setOpenQuiet] = useState<ReadonlySet<string>>(() => new Set());
  // The projects a heading's press set unfolding or folding, until they settle:
  // a folding project keeps its rows drawn until they have folded away.
  const [folds, setFolds] = useState<ReadonlyMap<string, ProjectFoldMotion>>(() => new Map());
  // The room a fold leaves at the list's end (`slackForFold`): scrolled to
  // the end, the rows folding away would slide everything down under the
  // view, the heading just pressed too. It stays until a scroll up no longer
  // needs it.
  const [slack, setSlack] = useState(0);
  const holdingSlack = slack > 0;
  useEffect(() => {
    if (!holdingSlack) return;
    const scroller = scrollingAncestor(treeRef.current);
    if (scroller === null) return;
    const onScroll = () => {
      setSlack((current) =>
        slackAfterScroll({
          scrollTop: scroller.scrollTop,
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          slack: current,
        }),
      );
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [holdingSlack]);
  const settleFold = (groupId: string) => {
    setFolds((current) => {
      if (!current.has(groupId)) return current;
      const next = new Map(current);
      next.delete(groupId);
      return next;
    });
  };
  // Option held: each Mate row's time slot shows its number, and ⌥1–9 opens it.
  const [altHeld, setAltHeld] = useState(false);
  // A surface's ask to show something (`sidebarReveal.ts`): the header's
  // waiting faces a Mate, the jump box a Mate, a project, a stop or a change.
  // Its project opens — and the quiet Mates or the list of changes it is
  // folded into — then, on the draw that sets off, the row takes the focus
  // and flashes once where it stands (`landingAfterDraw`). A stop is its
  // chip, on the heading folded or not: its project stays as it is.
  const revealing = useSidebarReveal((state) => state.revealing);
  const focusAfterDraw = useRef<PendingLanding<SidebarRevealTarget> | null>(null);
  // The Mates in the order drawn — collapsed projects included — for the
  // header's "next one that waits", and everything the jump box finds here;
  // written after each render, not during it.
  const mateOrder = useRef<ReadonlyArray<string>>([]);
  const jumpIndex = useRef<SidebarJumpIndex>(EMPTY_JUMP_INDEX);
  useEffect(() => {
    useSidebarReveal.getState().setMateOrder(mateOrder.current);
    useSidebarJump.getState().publish(jumpIndex.current);
  });
  const [, setRevealDraw] = useState(0);
  useEffect(() => {
    if (revealing === null || !holdsRevealTarget(candidates, revealing.target)) return;
    const { target, seq } = revealing;
    useSidebarReveal.getState().answerReveal(seq);
    const groupId =
      target.kind === "mate" ? groupIdOf(candidates, target.projectId) : target.groupId;
    const mateId =
      target.kind === "mate"
        ? target.projectId
        : target.kind === "change"
          ? target.mateProjectId
          : undefined;
    if (groupId !== undefined && target.kind !== "stop") {
      setCollapsed((current) => withCollapsed(current, groupId, false));
      // A Mate may be folded among its project's quiet ones.
      if (mateId !== undefined) setOpenQuiet((current) => withCollapsed(current, groupId, true));
      if (target.kind === "change" && mateId !== undefined) {
        const listKey = `${groupId}:${mateId}`;
        setOpenLists((current) => (current.has(listKey) ? current : new Set(current).add(listKey)));
      }
    }
    focusAfterDraw.current = { target, drawn: false };
    setRevealDraw((draws) => draws + 1);
  }, [candidates, revealing]);
  useEffect(() => {
    const { land, next } = landingAfterDraw(focusAfterDraw.current);
    focusAfterDraw.current = next;
    if (land === undefined) return;
    const landing = revealLanding(treeRef.current, land);
    if (landing === null) return;
    focusOnceFree(landing.focus, () => {
      landing.flash.scrollIntoView({ block: "nearest" });
      flashOnce(landing.flash);
      landing.press?.click();
    });
  });
  // The list's keys that belong to no one row: Option shows the numbers and
  // ⌥1–9 opens that Mate; j or k with nothing focused starts at the Mate in
  // view. Never while somebody types into a field.
  const mateRows = () =>
    Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]') ?? [],
    );
  // j and k, the same object from draw to draw: every memoised row is handed it.
  const [mateKeys] = useState<MateRowKeys>(() => ({
    move: (from, direction) => {
      const rows = mateRows();
      const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(from) + direction))];
      if (next === undefined || next === from) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
    },
  }));
  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setAltHeld(true);
        return;
      }
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        typedIntoField(event.target)
      ) {
        return;
      }
      if (event.altKey && /^Digit[1-9]$/u.test(event.code)) {
        const row = mateRows()[Number(event.code.slice(5)) - 1];
        if (row === undefined) return;
        event.preventDefault();
        row.click();
        return;
      }
      if (event.altKey || event.target !== document.body) return;
      if (event.key !== "j" && event.key !== "k") return;
      const rows = mateRows();
      const cursor = useSidebarReveal.getState().cursor ?? activeProjectId;
      const row =
        rows.find(
          (entry) =>
            entry.closest("[data-zerops-mate-row]")?.getAttribute("data-zerops-mate-row") ===
            cursor,
        ) ?? rows[0];
      if (row === undefined) return;
      event.preventDefault();
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => {
      setAltHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [activeProjectId]);
  // What each stop runs, read once per render and handed to `groupFlow`, so
  // the chip and the page never read two different answers for one project.
  const deployments = useStopDeploymentsShown();

  // Until the rows below are drawn, the jump box finds nothing here.
  jumpIndex.current = EMPTY_JUMP_INDEX;

  // A Mate being created is one to draw, whatever the listing holds yet.
  const nothing =
    appsWithWork.length > 0 || births.some((birth) => birth.placement.kind === "mate")
      ? undefined
      : emptyReason;

  // Nothing to draw, and the listing may not say "none" yet: its notice, at
  // the menu's own left edge, never an empty state it has not earned.
  if (nothing !== undefined && !complete) {
    if (notice !== null)
      return <ListingNotice className={className} notice={notice} onAct={onNoticeAct} />;
    return reading ? <MenuSkeleton className={className} /> : null;
  }

  // No project at all: nothing to list, and nothing to say — the one thing to
  // do is *New project*, at the menu's foot (`SidebarNewProject`).
  if (nothing === "no-projects") return null;

  // Projects, but none with a Mate: one quiet line on the menu's own left
  // edge, where every other row starts, and the way to the projects screen —
  // once the list is complete, above.
  if (nothing !== undefined) {
    return (
      <div
        className={cn("flex flex-col items-start gap-1.5 px-2.5 py-2", className)}
        data-zerops-surface="sidebar-environments-empty"
      >
        <span className="text-xs text-sidebar-muted-foreground">No Mate yet</span>
        <button
          className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border px-2.5 py-1 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={onBrowseProjects}
          type="button"
        >
          Set up Mate
        </button>
      </div>
    );
  }

  // One carrier per project — a project's Mate candidate wins over a bare one
  // — so every row agrees on which container is the environment's.
  const mates = selectMateEnvironments(candidates);
  const mateByProject = new Map(mates.map((mate) => [mate.project.id, mate]));
  const everyEnvironment = [
    ...candidates.filter((candidate) => !mateByProject.has(candidate.project.id)),
    ...mates,
  ];
  const view = buildZeropsGroupTree(everyEnvironment, {
    apps: appsWithWork,
    rank: rankZeropsCandidateForListing,
    order: projectOrder.order,
    ...(projectOrder.customOrder === undefined ? {} : { customOrder: projectOrder.customOrder }),
    births,
  });
  // Every project the order holds, drawn or not: what a move is written into,
  // and what choosing *Custom* elsewhere starts from.
  const onScreen = view.groups.map(({ group }) => group.groupId);
  rememberProjectsOnScreen(onScreen);
  const tints = assignCandidateMateTints(candidates);
  /** A Mate's face: its tint, and the shape its person picked or that tint's own. */
  const faceOf = (project: ZeropsCandidate["project"]) => {
    const identity = identities[project.id];
    if (identity !== undefined) return { tint: identity.tint, shape: identity.shape };
    const tint = tints.get(project.id) ?? "slate";
    return { tint, shape: mateShapeOf(project, tint) };
  };

  const toggle = (key: string) => {
    setOpenLists((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Each drawn Mate's number, top to bottom, for the ⌥ chips.
  let numbered = 0;

  // What the jump box finds, gathered as each project is read (`indexSection`):
  // data only, in the menu's own order — what the box does with a find is its
  // own.
  const jumpMates: JumpMate[] = [];
  const jumpProjects: JumpProject[] = [];
  const jumpChanges: JumpChange[] = [];
  const jumpStops: JumpStop[] = [];
  const indexSection = (input: {
    readonly id: string;
    readonly group: ZeropsGroup | undefined;
    readonly groupName: string | undefined;
    readonly flow: SidebarProjectFlow | undefined;
    /** Its Mates as the menu draws them: the ones at work or lately, then the quiet ones. */
    readonly mateEntries: ReadonlyArray<Entry<T>>;
    readonly grouped: ReturnType<typeof pullRequestsByMate>;
    /** Whether change rows are drawn: HQ told them. */
    readonly changesDrawn: boolean;
    /** Its production and stages, each as the chip and its menu say it. */
    readonly stops: ReadonlyArray<JumpStop>;
  }) => {
    const { id, group, groupName, mateEntries, grouped } = input;
    if (group !== undefined) {
      jumpProjects.push({ groupId: id, name: group.name, mates: mateEntries.length });
    }
    const names = new Map<string, string>();
    for (const { item } of mateEntries) {
      const name = projectNameInApp(item.project);
      names.set(item.project.id, name);
      jumpMates.push(
        jumpMateOf({
          projectId: item.project.id,
          name,
          ...faceOf(item.project),
          projectName: groupName,
          environmentId: item.environmentId,
          owner: getOwner?.(item),
          connected: mateAwake(item, hqMates),
          activity: getActivity?.(item),
          reviewWaits: mateReviewWaits(input.flow, item.project.id),
          mine: waitsOnViewer(item.project.id),
          pose: matePoseOf(item, minuteMs, mateLifeOf(getComing?.(item))),
        }),
      );
    }
    if (input.changesDrawn) {
      // Every open change of the project's, so a Mate's in two repositories name theirs.
      const among = input.flow?.pullRequests;
      // A hidden Mate's changes are drawn nowhere, so they are found nowhere.
      for (const { item } of mateEntries) {
        const mateProjectId = item.project.id;
        for (const pull of grouped.byMate.get(mateProjectId) ?? []) {
          jumpChanges.push({
            key: changeRowKey(pull),
            groupId: id,
            repository: pull.repository,
            number: pull.number,
            projectName: groupName,
            label: sidebarChangeLabel(pull, among),
            mateProjectId,
            whose: names.get(mateProjectId),
          });
        }
      }
    }
    if (input.changesDrawn) {
      for (const pull of grouped.others) {
        jumpChanges.push({
          key: changeRowKey(pull),
          groupId: id,
          repository: pull.repository,
          number: pull.number,
          projectName: groupName,
          label: sidebarChangeLabel(pull, grouped.others),
          mateProjectId: pull.mateProjectId,
          whose: pull.mateProjectId,
        });
      }
    }
    jumpStops.push(...input.stops);
  };

  /**
   * A project: its heading, then its Mates, each with its crew and what it
   * has waiting, those being created, and the quiet ones folded behind their
   * count. Nothing when nobody lives in it.
   */
  const section = (
    id: string,
    entries: ReadonlyArray<Entry<T>>,
    renderHeader: (heading: {
      /** Its chips: the stages' and production's, each where the project has it. */
      readonly chips: ReactNode;
      /** Its busy Mates' faces, while it is folded. */
      readonly faces: ReactNode;
      /** What its second line reads (D′, `headingLine`); none for the ungrouped section. */
      readonly line: HeadingLineInput | undefined;
      /** A stop's own page, where one opens: the line's Details. */
      readonly openStop: (projectId: string) => (() => void) | undefined;
    }) => ReactNode,
    flow: SidebarProjectFlow | undefined,
    groupName: string | undefined,
    // `undefined` for the ungrouped section, which has no production to add.
    group: ZeropsGroup | undefined,
    // The list's last project, which keeps less room below its rows.
    last: boolean,
  ) => {
    const everyMate = entries.filter(({ item }) => hasMate(item));
    // Whose Mates the viewer asked to see (Mine / Everyone).
    const mateEntries = everyMate.filter(({ item }) => shown?.(item) ?? true);
    // Its Mates being created, after the listed ones: the listing holds none of them yet.
    const coming = group?.pending.filter((member) => member.kind === "mate") ?? [];
    const mateCount = mateEntries.length + coming.length;
    if (mateCount === 0 && (group === undefined || everyMate.length > 0)) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    // The one derivation the projects page draws from too (`groupFlow.ts`),
    // fed through the page's own input (`groupFlowInputOf`): read once here, so the pull requests this tree
    // hangs under a Mate and the production
    // chip can never disagree with what the page says about the same project.
    //
    // Read whether or not HQ is: what a stop runs, and whether it serves,
    // is the platform's answer, and the chip says that much either way
    // (`productionChip`).
    const projectFlow: GroupFlow = groupFlow(
      groupFlowInputOf({
        groupId: id,
        // Whether a Mate's conversations arrived is not asked here: unknown
        // reads as not spoken to, as it always did in this menu.
        members: groupMemberFactsOf(
          entries,
          (item) => getActivity?.(item),
          () => false,
          waitsOnViewer,
        ),
        flow: flow === undefined ? undefined : groupFlowReadsOf(flow),
        deployments,
        pending: group?.pending ?? [],
      }),
    );
    // Production and its stages are the chips on the heading (M2), never rows:
    // a row would make them peers of the Mates, whom you talk to, and a row
    // disappears when the project folds. One chip for production, one for
    // the stage or stages (the owner, 2026-09-29).
    const stopItem = (projectId: string | undefined) =>
      projectId === undefined
        ? undefined
        : others.find(({ item }) => item.project.id === projectId)?.item;
    const productionStop =
      "stop" in projectFlow.production ? projectFlow.production.stop : undefined;
    const productionItem = stopItem(productionStop?.projectId);
    const servingOf = (item: T | undefined): StopServing =>
      item === undefined
        ? { kind: "unknown" }
        : stopServing({
            projectStatus: item.project.status,
            services: item.services?.statuses,
            routes: item.routes ?? [],
          });
    const downOf = (serving: StopServing) => (serving.kind === "down" ? serving.services : []);
    // Until HQ's releases are read, a chip is only what the platform alone says: partial.
    const releases: ReleasesAnswer =
      flow !== undefined && flow.releasesKnown !== false
        ? { kind: "answered", failure: flow.releaseFailure }
        : { kind: "waiting" };
    const stopName = (stop: GroupFlowStop) =>
      projectNameInApp(stopItem(stop.projectId)?.project) || stop.name;
    const stages = projectFlow.stages.map((stop) => ({
      name: stopName(stop),
      stop,
      serving: servingOf(stopItem(stop.projectId)),
    }));
    const productionServing = servingOf(productionItem);
    const chipsRead = projectChips({
      production: projectFlow.production,
      building:
        productionStop === undefined
          ? undefined
          : buildingOf(deployments?.get(productionStop.projectId)),
      waiting: projectFlow.main.notLive,
      waitingAtLeast: projectFlow.main.notLiveAtLeast,
      untold: flow?.releaseUntold ?? NO_UNTOLD,
      serving: productionServing,
      stages,
      stagesBeingCreated: projectFlow.creatingStages.length > 0,
      releases,
    });
    // Where each stop is and how its releases went is HQ's word: while its link is paused, last known.
    const shownChip = (view: ChipView) => {
      const chip = drawnChip(view);
      return chip !== undefined && hqStale ? asLastKnown(chip) : chip;
    };
    const prodChip = group === undefined ? undefined : shownChip(chipsRead.prod);
    const stageChipDrawn = group === undefined ? undefined : shownChip(chipsRead.stage);
    // Each stage as a chip of its own says it: its dot and words in the jump
    // box, its row in the stages' menu.
    const stageChips = stages.map(({ stop, serving }) =>
      shownChip(stageStopChip({ stop, serving, releases })),
    );
    const stopDeployedAt = (projectId: string) => {
      const activated = deployActivatedAt(deployments?.get(projectId));
      return activated ?? stopItem(projectId)?.services?.deployedAt;
    };
    const openStop = (projectId: string) => {
      const declared = flow?.environments.get(projectId);
      return declared === undefined || flow?.onOpenStop === undefined
        ? undefined
        : () => {
            flow.onOpenStop?.(declared);
          };
    };
    const chipMates = mateEntries.map(({ item }) => ({
      candidate: item,
      ...faceOf(item.project),
      mine: personFacts[item.project.id]?.mine,
      threadKey: getActivity?.(item)?.threadKey,
    }));
    const projectName = groupName ?? group?.name ?? "";
    const chips =
      group === undefined || (prodChip === undefined && stageChipDrawn === undefined) ? null : (
        // The stage first, production on the heading's end edge: the order a
        // change travels in, and production's chip never moves for a stage's.
        <>
          {stageChipDrawn === undefined ? null : (
            <SidebarProductionChip
              chip={stageChipDrawn}
              groupId={id}
              mates={chipMates}
              menu={(openedAt) =>
                stageMenu({
                  stages: stages.map(({ name, stop, serving }, index) => ({
                    projectId: stop.projectId,
                    name,
                    stop,
                    chip: stageChips[index],
                    deployedAt: stopDeployedAt(stop.projectId),
                    down: downOf(serving),
                    routes: stopItem(stop.projectId)?.routes ?? [],
                  })),
                  creating: projectFlow.creatingStages.map((creation) => ({
                    projectId: creation.projectId,
                    name: creation.name,
                  })),
                  nowMs: openedAt,
                })
              }
              onAskToFix={onAskToFix}
              onOpenStop={openStop}
              projectName={projectName}
              stops={stages.map(({ stop }) => stop.projectId)}
            />
          )}
          {prodChip === undefined ? null : (
            <SidebarProductionChip
              chip={prodChip}
              groupId={id}
              mates={chipMates}
              menu={(openedAt) =>
                productionMenu({
                  chip: prodChip,
                  projectId: productionItem?.project.id,
                  failure: releases.kind === "answered" ? releases.failure : undefined,
                  down: downOf(productionServing),
                  routes: productionItem?.routes ?? [],
                  nowMs: openedAt,
                })
              }
              onAskToFix={onAskToFix}
              onOpenStop={openStop}
              onReviewRelease={
                flow?.releaseOffered === true
                  ? () => openReleaseReview({ kind: "release", groupId: id })
                  : undefined
              }
              projectName={projectName}
              stops={productionStop === undefined ? [] : [productionStop.projectId]}
            />
          )}
        </>
      );
    // The jump box finds each of them, by its name under its project and by the project's, with the dot and words
    // its chip's menu gives it — only where the heading draws its chip: a find lands on it.
    const jumpStopsHere: ReadonlyArray<JumpStop> = [
      ...(stageChipDrawn === undefined
        ? []
        : stages.map(({ stop, name }, index) => {
            const own = stageChips[index];
            return {
              projectId: stop.projectId,
              groupId: id,
              title: name,
              projectName,
              line: stop.version?.label ?? "",
              dot: own === undefined ? STOP_DOT[stop.state] : chipDot(own),
              word:
                own === undefined
                  ? `Stage ${stop.version?.label ?? ""}`.trim()
                  : chipFace(own).words,
            };
          })),
      ...(productionStop === undefined || prodChip === undefined
        ? []
        : [
            {
              projectId: productionStop.projectId,
              groupId: id,
              title: stopName(productionStop),
              projectName,
              line: productionStop.version?.label ?? "",
              dot: chipDot(prodChip),
              word: chipFace(prodChip).words,
            },
          ]),
    ];
    // Whether a Mate's own change waits on the person's review — the
    // composer's top's own rule (`mateNextStep`), on the flow HQ told:
    // its row and its face on the folded heading wear needs-you for it.
    const reviewWaits = (item: T) => mateReviewWaits(flow, item.project.id);
    // Folded, the heading shows who is busy in it (M15): its Mates that need
    // you, work, stopped on an error or finished unseen, each as its row draws
    // it (`mateRowView`) — once its rows have folded away.
    const folded = collapsed.has(id) && folds.get(id) !== "closing";
    const busy = folded
      ? headingFaces(
          mateEntries.map(({ item }) => {
            const live = getActivity?.(item);
            const coming = getComing?.(item);
            const read = mateRowReading({
              name: projectNameInApp(item.project),
              connected: mateAwake(item, hqMates),
              activity: live,
              reviewWaits: reviewWaits(item),
              mine: waitsOnViewer(item.project.id),
              pose: matePoseOf(item, minuteMs, mateLifeOf(coming)),
            });
            const view = coming === undefined ? read : mateComingRowView(read, coming);
            return {
              projectId: item.project.id,
              name: projectNameInApp(item.project),
              ...faceOf(item.project),
              state: view.state,
              face: view.face,
              dot: view.dot,
              known: live !== undefined && live.remembered !== true,
            };
          }),
        )
      : [];
    // The heading's second line (D′): the release, and each environment coming up step by
    // step, from what the platform says of it (`stopComing`).
    const listedOf = (stop: GroupFlowStop): ListedStop => {
      const item = stopItem(stop.projectId);
      return {
        stop,
        projectStatus: item?.project.status,
        services: item?.services?.statuses,
        building: buildingOf(deployments?.get(stop.projectId)) !== undefined,
        routes: item?.routes?.length ?? 0,
      };
    };
    const comingOf = (tier: "stage" | "production", stop: GroupFlowStop): StopComing | undefined =>
      listedStopComing(tier, listedOf(stop));
    const PENDING: StopComing = { kind: "coming", step: "project" };
    const line: HeadingLineInput | undefined =
      group === undefined
        ? undefined
        : {
            production:
              projectFlow.production.kind === "absent"
                ? undefined
                : {
                    projectId: productionStop?.projectId,
                    chip: prodChip,
                    coming:
                      projectFlow.production.kind === "creating"
                        ? PENDING
                        : productionStop === undefined
                          ? undefined
                          : comingOf("production", productionStop),
                    failure: releases.kind === "answered" ? releases.failure : undefined,
                    building:
                      productionStop !== undefined && building.has(productionStop.projectId),
                  },
            stages: [
              ...stages.map(({ name, stop }) => ({
                projectId: stop.projectId,
                name,
                coming: comingOf("stage", stop),
                serves: stopServes(listedOf(stop)),
                building: building.has(stop.projectId),
              })),
              ...projectFlow.creatingStages.map((creation) => ({
                projectId: creation.projectId,
                name: creation.name,
                coming: PENDING,
                serves: false,
                building: false,
              })),
            ],
            waiting: projectFlow.main.notLive,
            waitingAtLeast: projectFlow.main.notLiveAtLeast,
            allOnStage:
              projectFlow.main.head !== undefined &&
              stages.some(({ stop }) => stop.version?.commit === projectFlow.main.head),
          };
    // The heading holds its stops' demand itself: a chip draws only once they are read, so a
    // demand held by the chip alone would never come on a cold load with nothing remembered.
    const header = (
      <>
        {renderHeader({
          chips,
          faces: busy.length === 0 ? null : <HeadingFaces faces={busy} />,
          line,
          openStop,
        })}
        {group === undefined
          ? null
          : [
              ...stages.map(({ stop }) => stop.projectId),
              ...(productionStop === undefined ? [] : [productionStop.projectId]),
            ].map((projectId) => <StopDemand key={projectId} projectId={projectId} />)}
      </>
    );
    // The change rows: HQ's once it told them.
    const changesKnown = flow !== undefined && flow.changesKnown !== false;
    const changeRows: ChangeRows | undefined = changesKnown ? flow : undefined;
    const flowPulls = changesKnown ? projectFlow.pullRequests.map((entry) => entry.pull) : [];
    // By every Mate, shown or not: a hidden Mate's change is still its own.
    const grouped = pullRequestsByMate(
      flowPulls,
      everyMate.map(({ item }) => item.project.id),
    );
    // Its Mates in the order drawn: the ones at work or lately at it, those
    // being created, then — folded behind their count at the end — the ones
    // untouched for a week (`isQuietMate`), open only when asked.
    const quietOf = (item: T) =>
      getComing?.(item) === undefined &&
      isQuietMate(getActivity?.(item), nowMs, item.project.id === activeProjectId);
    const loud = mateEntries.filter(({ item }) => !quietOf(item));
    const quiet = mateEntries.filter(({ item }) => quietOf(item));
    // What the jump box finds here, drawn or folded: a jump opens the project.
    indexSection({
      id,
      group,
      groupName,
      flow,
      mateEntries: [...loud, ...quiet],
      grouped,
      changesDrawn: changeRows !== undefined,
      stops: jumpStopsHere,
    });
    // Collapsed, a project is its heading and nothing else — its production
    // chip and its busy Mates' faces on it, never a second, smaller design of
    // the same rows, which the owner turned down (2026-09-25).
    const fold = folds.get(id);
    // A fragment either way, so the heading keeps its node — and the focus of
    // the press that folded it — whether its rows are drawn or not. Folded, it
    // keeps its few px of room under it, which its rows unfold from.
    if (group !== undefined && collapsed.has(id) && fold !== "closing") {
      return (
        <>
          {header}
          <SidebarProjectFoldedRoom last={last} />
        </>
      );
    }
    const quietOpen = openQuiet.has(id);
    const slots: ReadonlyArray<MateSlot<T>> = [
      ...loud.map(({ item }) => ({ kind: "mate" as const, item })),
      ...coming.map((member) => ({ kind: "coming" as const, member })),
      ...(quiet.length === 0 ? [] : [{ kind: "fold" as const, count: quiet.length }]),
      ...(quietOpen ? quiet.map(({ item }) => ({ kind: "mate" as const, item })) : []),
    ];
    // Each block — a Mate with its crew and its changes, one being created,
    // the quiet fold — stands apart from the next by air alone: 10 px, which
    // with a row's own 10 px above and below its words puts 30 px between one
    // Mate's words and the next's, whatever hangs under the first (M16). The
    // heading stands on the first.
    const blocks: ReadonlyArray<{ readonly key: string; readonly node: ReactNode }> = slots.map(
      (slot) => {
        if (slot.kind === "coming") {
          const active = slot.member.projectId === activeProjectId;
          return {
            key: `coming:${slot.member.projectId}`,
            node: (
              <MateUnit active={active} projectId={slot.member.projectId}>
                <ComingMateRow
                  active={active}
                  coming={slot.member}
                  name={slot.member.name}
                  onOpen={onOpenComing}
                />
              </MateUnit>
            ),
          };
        }
        if (slot.kind === "fold") {
          return {
            key: "quiet",
            node: (
              <QuietMatesRow
                count={slot.count}
                onToggle={() => {
                  setOpenQuiet((current) => withCollapsed(current, id, !current.has(id)));
                }}
                open={quietOpen}
              />
            ),
          };
        }
        const { item } = slot;
        const pulls = grouped.byMate.get(item.project.id) ?? [];
        const listKey = `${id}:${item.project.id}`;
        const appUrl = projectFlow.mates.find(
          (mate) => mate.projectId === item.project.id,
        )?.preview;
        numbered += 1;
        const active = item.project.id === activeProjectId;
        return {
          key: item.key,
          node: (
            <div className="flex flex-col">
              <MateUnit active={active} projectId={item.project.id}>
                <MateRow
                  keyedReadings={keyedReadings}
                  actions={getMateActions?.(item, getActivity?.(item))}
                  active={active}
                  activity={keyedReadings ? undefined : getActivity?.(item)}
                  up={mateAwake(item, hqMates)}
                  appUrl={appUrl}
                  candidate={item}
                  coming={getComing?.(item)}
                  conversationsRead={getConversationsRead?.(item) === true}
                  crew={getCrew?.(item)}
                  onOpenCrew={onOpenCrew}
                  keys={mateKeys}
                  number={numbered <= 9 ? numbered : undefined}
                  numbers={altHeld}
                  onSelect={onSelect}
                  owner={keyedReadings ? undefined : getOwner?.(item)}
                  reviewWaits={reviewWaits(item)}
                  timestampFormat={timestampFormat}
                  {...faceOf(item.project)}
                />
                {/* Its crew, one line right under it, before its changes — as HQ
                    holds it, at rest while HQ's answer is not now. */}
                <SidebarCrewLine
                  mine={waitsOnViewer(item.project.id)}
                  projectId={item.project.id}
                  read={getCrew?.(item)}
                />
              </MateUnit>
              {pulls.length === 0 || changeRows === undefined ? null : (
                <PullRequestList
                  groupId={id}
                  onToggle={() => {
                    toggle(listKey);
                  }}
                  open={openLists.has(listKey)}
                  onOpenChange={changeRows.onOpenChange}
                  pulls={pulls}
                  run={mateRunOf(activityOfNow(getActivity?.(item)))}
                />
              )}
            </div>
          ),
        };
      },
    );
    const otherChanges =
      grouped.others.length === 0 || changeRows === undefined ? null : (
        <ul className="flex flex-col" data-zerops-surface="sidebar-other-pull-requests">
          {grouped.others.map((pull) => (
            <PullRequestRow
              among={grouped.others}
              asks={changeAsksForReview(pull)}
              groupId={id}
              key={changeRowKey(pull)}
              onOpenChange={changeRows.onOpenChange}
              pull={pull}
              whose={pull.mateProjectId}
            />
          ))}
        </ul>
      );
    return (
      <>
        {header}
        <SidebarProjectFold
          last={last}
          motion={fold}
          onSettled={() => {
            settleFold(id);
          }}
          open={!collapsed.has(id)}
        >
          {blocks.map((block, index) => (
            <div className={cn("flex flex-col", index > 0 && "mt-2.5")} key={block.key}>
              {block.node}
            </div>
          ))}
          {otherChanges === null ? null : <div className="mt-2.5">{otherChanges}</div>}
        </SidebarProjectFold>
      </>
    );
  };

  // HQ applications remain visible when they hold only stage/production placements.
  // The viewer's Mate filter still hides applications whose Mates are all filtered out.
  const groups = view.groups.filter(
    ({ group, environments }) =>
      !environments.some(({ item }) => hasMate(item)) ||
      environments.some(({ item }) => hasMate(item) && (shown?.(item) ?? true)) ||
      group.pending.some((member) => member.kind === "mate"),
  );
  const ungrouped = view.ungrouped.map((item) => ({ item, role: undefined }));
  const ungroupedMates = ungrouped.some(({ item }) => hasMate(item) && (shown?.(item) ?? true));
  mateOrder.current = [
    ...groups.flatMap(({ environments }) =>
      environments
        .filter(({ item }) => hasMate(item) && (shown?.(item) ?? true))
        .map(({ item }) => item.project.id),
    ),
    ...(ungroupedMates
      ? ungrouped
          .filter(({ item }) => hasMate(item) && (shown?.(item) ?? true))
          .map(({ item }) => item.project.id)
      : []),
  ];

  // The projects drawn, in order: a move by keyboard or by drag names its
  // place by these neighbours, and the order it writes still holds the rest.
  const drawn = groups.map(({ group }) => group.groupId);
  const moveProject = (groupId: string, before: string | null, name: string) => {
    const next = movedBefore(onScreen, groupId, before).filter((id) => drawn.includes(id));
    projectOrder.move(groupId, before, onScreen);
    reorder.announce(movedAnnouncement(name, next.indexOf(groupId) + 1, next.length));
  };
  const moveByKey = (groupId: string, name: string, direction: "up" | "down", refocus: boolean) => {
    const before = keyboardTarget(drawn, groupId, direction);
    if (before === undefined) return;
    moveProject(groupId, before, name);
    if (!refocus) return;
    // The section moves in the DOM, and a moved node can drop its focus.
    requestAnimationFrame(() => {
      treeRef.current?.querySelector<HTMLElement>(`[data-zerops-grip="${groupId}"]`)?.focus();
    });
  };

  // The list's last project keeps less room below it, open or folded.
  const lastProject = (index: number) => index === groups.length - 1 && !ungroupedMates;
  const groupSections = groups.map(({ group, environments }, index) => (
    <section
      className={cn(
        "flex flex-col transition-opacity",
        reorder.dragging === group.groupId && "opacity-40",
      )}
      data-zerops-group={group.groupId}
      key={group.groupId}
    >
      {section(
        group.groupId,
        environments,
        ({ chips, faces, line, openStop }) => (
          <ProjectHeader
            chips={chips}
            collapsed={collapsed.has(group.groupId)}
            faces={faces}
            line={line}
            openStop={openStop}
            group={group}
            missing={missingEnvironmentRows({
              tiersOnMain: tiersAddable({
                offered: environmentOffers(group.groupId),
                group,
                hq: [...(getFlow?.(group.groupId)?.environments.values() ?? [])].map((row) => ({
                  id: row.projectId,
                  tier: row.tier,
                })),
                recipe: {
                  read: getFlow?.(group.groupId)?.recipeRead === true,
                  tiers: getFlow?.(group.groupId)?.recipeTiers ?? [],
                },
              }),
              declarations: [],
            })}
            onAddMate={onAddMate}
            onSetUp={onSetUp}
            onBrowseProjects={onBrowseProjects}
            onOpen={
              onOpenGroup === undefined
                ? undefined
                : () => {
                    onOpenGroup(group.groupId);
                  }
            }
            onToggle={() => {
              const { groupId } = group;
              const folding = !collapsed.has(groupId);
              if (folding) {
                const scroller = scrollingAncestor(treeRef.current);
                const rows = treeRef.current?.querySelector<HTMLElement>(
                  `[data-zerops-group="${CSS.escape(groupId)}"] [data-zerops-surface="sidebar-project-rows"]`,
                );
                if (scroller !== null && rows !== null && rows !== undefined) {
                  setSlack(
                    slackForFold(
                      {
                        scrollTop: scroller.scrollTop,
                        clientHeight: scroller.clientHeight,
                        scrollHeight: scroller.scrollHeight,
                        slack,
                      },
                      // Less the room the folded heading keeps under it.
                      rows.getBoundingClientRect().height -
                        projectRoom({ open: false, last: lastProject(index) }),
                    ),
                  );
                }
              }
              setCollapsed((current) => withCollapsed(current, groupId, folding));
              setFolds((current) => new Map(current).set(groupId, folding ? "closing" : "opening"));
            }}
            reorder={{
              custom: projectOrder.order === "custom",
              canMoveUp: index > 0,
              canMoveDown: index < groups.length - 1,
              onMove: (direction, fromGrip) => {
                moveByKey(group.groupId, group.name, direction, fromGrip);
              },
              onGripPointerDown: (event) => {
                reorder.startDrag(
                  { groupId: group.groupId, name: group.name },
                  event,
                  (groupId, before) => {
                    moveProject(groupId, before, group.name);
                  },
                );
              },
            }}
          />
        ),
        getFlow?.(group.groupId),
        groupNameUnread(group) ? undefined : group.name,
        group,
        lastProject(index),
      )}
    </section>
  ));
  const ungroupedSection = ungroupedMates ? (
    <section className="flex flex-col" data-zerops-ungrouped="true">
      {section(
        "ungrouped",
        ungrouped,
        () =>
          groups.length > 0 ? (
            <ProjectHeader muted name="Ungrouped" onBrowseProjects={onBrowseProjects} />
          ) : null,
        undefined,
        // Nothing groups these, so nothing above a row repeats its name.
        undefined,
        undefined,
        true,
      )}
    </section>
  ) : null;
  jumpIndex.current = {
    mates: jumpMates,
    projects: jumpProjects,
    changes: jumpChanges,
    stops: jumpStops,
  };

  return (
    <nav
      aria-label="Mates"
      // The list stands 16 px under the logo row: the row and the projects
      // are two groups, and the first project's name reads as the start of
      // another, 43 px under the mark's foot (the owner, 2026-09-29: "first
      // project is too close to logo"). Its own stacking context, so the
      // selected band stands behind every row.
      className={cn("relative isolate flex flex-col pt-4", className)}
      data-zerops-surface="sidebar-environments"
      ref={treeRef}
    >
      {structureView.updateRequired || followingHqUpdate ? (
        <div className="px-4 pb-3 text-xs text-sidebar-muted-foreground" role="status">
          {structureView.updateRequired ? "HQ needs an update to show all navigation facts." : null}
          {session !== null &&
          session !== undefined &&
          mayBearHq(session.activeOrganization ?? undefined) &&
          accountHq.hq.kind === "official" &&
          carried !== undefined ? (
            <ZeropsHqUpdate
              projectId={accountHq.hq.projectId}
              carried={carried}
              answering={structureView.coreBuild}
              trigger="Update HQ"
              onBusy={ignoreUpdateState}
              onFollowing={setFollowingHqUpdate}
            />
          ) : null}
        </div>
      ) : null}
      <SidebarSelectedBand current={activeProjectId} />
      {groupSections}
      {ungroupedSection}

      {/* Rows already held, and the listing not all read: they may not be all
          the Mates there are, so the notice stays under them (§3.4). */}
      {notice === null ? null : (
        <ListingNotice className="mt-6" notice={notice} onAct={onNoticeAct} />
      )}
      {slack === 0 ? null : (
        <div
          aria-hidden="true"
          className="shrink-0"
          data-zerops-surface="sidebar-fold-slack"
          style={{ height: slack }}
        />
      )}
      {reorder.overlay}
    </nav>
  );
}

/**
 * *New project* at the menu's foot (D11), pinned just above the account's
 * row: the same place whatever the list's length (the owner, 2026-09-29: "not
 * sure if this shouldn't be stuck to the bottom somehow"). It stands right
 * after the list's scroll, outside it, so a long list scrolls under it: the
 * list fades into the canvas above it and a hairline parts them, only while
 * something is scrolled under it (`.zerops-new-project-slot`). On the list's
 * own inset: a + in the faces' 28 px column at 16 px and the words at 56,
 * 13 px and muted until pointed at — a row like the others. The menu draws it
 * where `newProjectOffered` says, from the first paint.
 */
export function SidebarNewProject({ onNewProject }: { readonly onNewProject: () => void }) {
  return (
    <div className="zerops-new-project-slot relative shrink-0 ps-2.25 pe-2 py-1">
      <button
        className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg ps-1.75 pe-2 text-left text-line text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        data-zerops-surface="sidebar-new-project"
        onClick={onNewProject}
        type="button"
      >
        <span className="flex w-7 shrink-0 justify-center">
          <PlusIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="min-w-0 truncate">New project</span>
      </button>
    </div>
  );
}

/**
 * What the account says (`accountFootLine`) — its lapse, or its inventory's lasting trouble — as
 * one quiet line pinned at the menu's foot: what is true and what happens, with its actions. The
 * rows above keep what they have; nothing is covered or frozen.
 */
export function SidebarAccountLine({
  sentence,
  title,
  actions,
}: {
  readonly sentence: string;
  /** What isn't answering, named under the sentence. */
  readonly title?: string | null | undefined;
  readonly actions: ReadonlyArray<{
    readonly label: string;
    readonly run: () => void;
    readonly busy?: boolean;
  }>;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 ps-4 pe-2 py-1.5 text-xs text-sidebar-muted-foreground"
      data-zerops-surface="sidebar-account-line"
      role="status"
    >
      <span className="me-1 flex min-w-0 flex-col">
        <span className="truncate">{sentence}</span>
        {/* What isn't answering, named where a screenshot of the report carries it. */}
        {title == null ? null : <span className="truncate opacity-75">{title}</span>}
      </span>
      {actions.map(({ label, run, busy = false }) => (
        <button
          className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-sidebar-muted-foreground disabled:hover:bg-transparent"
          disabled={busy}
          key={label}
          onClick={run}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * What scrolls the menu: the sidebar's viewport, or the page where nothing
 * inside does. Nothing where the menu is not drawn (a test's renderer).
 */
function scrollingAncestor(element: HTMLElement | null): HTMLElement | null {
  if (element === null) return null;
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  const page = element.ownerDocument.scrollingElement;
  return page instanceof HTMLElement ? page : null;
}

/** The listing's notice (`candidatesNotice`) with its one affordance, at the menu's left edge. */
/**
 * HQ not answering (SPEC §6.2.3): the structure under it is the last one read. A status, not an
 * alert — the Mates' conversations go on without HQ.
 */
/**
 * How current the menu is while HQ is not answering it (`hqOutage`, SPEC §6.2.3), in the header
 * row: a spinner while HQ's first read catches up; in words once what HQ said is no longer current
 * ("HQ is not reachable — showing what it last said") or it never answered ("HQ unavailable") —
 * the whole line in its tooltip, and *Try again* on a press where it is offered. Never a line above
 * the list: the owner, 2026-10-05, of one that pushed the menu down and back on every reconnect.
 */
export function SidebarHqStatus({
  kind,
  line,
  onAgain,
}: {
  readonly kind: HqOutage["kind"];
  readonly line: string;
  readonly onAgain?: (() => void) | undefined;
}) {
  const again = kind === "syncing" ? undefined : onAgain;
  // Words give way to the header's other members and wrap; the spinner keeps its size.
  const fit = kind === "syncing" ? "shrink-0" : "min-w-0";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          again === undefined ? (
            <span
              className={cn("inline-flex items-center", fit)}
              data-zerops-surface="sidebar-hq-outage"
              role="status"
            />
          ) : (
            <button
              className={cn("inline-flex cursor-pointer items-center", fit)}
              data-zerops-surface="sidebar-hq-outage"
              onClick={again}
              type="button"
            />
          )
        }
      >
        {kind === "syncing" ? (
          <span aria-hidden="true" className="zerops-envdot" data-dot="spinner" />
        ) : (
          <span
            aria-hidden="true"
            className="line-clamp-2 text-left text-xs leading-tight text-sidebar-muted-foreground"
          >
            {kind === "refused" ? line : kind === "last-known" ? HQ_LAST_KNOWN : "HQ unavailable"}
          </span>
        )}
        <span className="sr-only">{again === undefined ? line : `${line} Try again.`}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {again === undefined ? line : `${line} Press to try again.`}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Rows the menu does not know yet, standing in their room: a face and its line, three times. */
function MenuSkeleton({ className }: { readonly className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex flex-col gap-2 px-2.5 py-2", className)}
      data-zerops-surface="sidebar-environments-skeleton"
    >
      {["first", "second", "third"].map((row) => (
        <div className="flex h-7 items-center gap-3" key={row}>
          <span className="size-5 shrink-0 rounded-full bg-sidebar-row-hover" />
          <span className="h-2 w-2/3 rounded-full bg-sidebar-row-hover" />
        </div>
      ))}
    </div>
  );
}

function ListingNotice({
  notice,
  onAct,
  className,
}: {
  readonly notice: CandidatesNotice;
  readonly onAct: ((affordance: KnownAffordance) => void) | undefined;
  readonly className?: string | undefined;
}) {
  const { affordance, message } = notice;
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1.5 px-2.5 py-2",
        message.afterMs > 0 && "animate-zerops-appear",
        className,
      )}
      data-zerops-surface="sidebar-environments-notice"
      role={notice.region === "message" ? "alert" : "status"}
      style={message.afterMs > 0 ? { animationDelay: `${message.afterMs}ms` } : undefined}
    >
      <span
        className={cn(
          "text-xs",
          message.tone === "alert" ? "text-status-failed-text" : "text-sidebar-muted-foreground",
        )}
      >
        {message.text}
      </span>
      {affordance === null || onAct === undefined ? null : (
        <button
          className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border px-2.5 py-1 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={() => onAct(affordance)}
          type="button"
        >
          {affordance.label}
        </button>
      )}
    </div>
  );
}

/**
 * The project's header: the name that everything under it belongs to, and the
 * two things a person does to the project itself.
 *
 * It is set apart from the rows rather than merely bolder than them — a
 * section heading that looks like a row is a row. The verbs appear on hover
 * and focus in a slot that is always there, so nothing moves when they do.
 *
 * Its name collapses the project to this one line and opens it again, the
 * gesture every sidebar's section heading makes (the owner, 2026-09-25); the
 * project's own page is *Open project* in its menu. The chevron after the
 * name says which way it will go — on hover, and always while collapsed, when
 * nothing else says there is more under it.
 *
 * Setting a stage or a production up lives in the menu rather than as a row of
 * its own: not every project wants one, and a permanent row asking for
 * something optional reads as a fault (the owner, 2026-09-19).
 */
export function ProjectHeader({
  group,
  name,
  muted = false,
  missing = NO_MISSING_TIERS,
  onAddMate,
  onSetUp,
  onBrowseProjects,
  onOpen,
  collapsed = false,
  onToggle,
  reorder,
  chips,
  faces,
  line,
  openStop,
}: {
  readonly group?: ZeropsGroup;
  readonly name?: string;
  readonly muted?: boolean;
  readonly missing?: ReadonlyArray<MissingEnvironmentRow>;
  /** Asks for the New Mate dialog over the view on screen; absent in the harness. */
  readonly onAddMate?: ((groupId: string) => void) | undefined;
  /** Opens the form that sets a stage or a production up; absent, its item opens the projects page. */
  readonly onSetUp?: ((groupId: string, tier: GroupEnvironmentTier) => void) | undefined;
  readonly onBrowseProjects: () => void;
  /** Absent for the ungrouped heading, which is not a group and has no page. */
  readonly onOpen?: (() => void) | undefined;
  /** Whether only this heading is drawn of the project. */
  readonly collapsed?: boolean;
  /** Collapses or expands the project. Absent for the ungrouped heading, which is not a project. */
  readonly onToggle?: (() => void) | undefined;
  /**
   * Moving the project among the others: *Move up* and *Move down* in its
   * menu from any order, and in *Custom* a grip to drag it by, first of the
   * heading's verbs. Absent for the ungrouped heading, which always stands
   * last.
   */
  readonly reorder?: ProjectHeaderReorder | undefined;
  /**
   * The project's chips (`SidebarProductionChip`) — the stages', then
   * production's — on the heading's end edge whether it is open or folded.
   */
  readonly chips?: ReactNode;
  /** Its busy Mates' faces (`HeadingFaces`), after the title while it is folded. */
  readonly faces?: ReactNode;
  /** What its second line reads (D′), drawn while it is open. */
  readonly line?: HeadingLineInput | undefined;
  /** A stop's own page, where one opens: the line's Details. */
  readonly openStop?: ((projectId: string) => (() => void) | undefined) | undefined;
}) {
  const placeholder = group !== undefined && groupNameUnread(group);
  const { line: secondLine, landing } = useHeadingLine(line);
  const pillMotion = headingPillMotion(line, landing);
  const openReview = useOpenReview();
  const title = group?.name ?? name ?? "";
  // The New Mate dialog opens over whatever is on screen: the person stays where they were (the
  // owner, 2026-09-29, of a + that took them to the projects screen).
  const addMate = () => {
    if (group !== undefined) onAddMate?.(group.groupId);
  };
  return (
    // The heading is its band: 32 px tall, 10 px from the window and 10 from
    // the divider — the list's own 9 and 8, and 1 and 2 more — its title 6 px
    // in, on the menu's mark edge (x = 16), and its chips' end 6 px short of
    // its own, on the menu's end edge (16 px short of the divider), where a
    // Mate row's time ends. The chips stand 6 px from its top and bottom too,
    // so its corners run parallel to theirs (S4).
    // A heading that folds lights under the pointer, a band fainter than a
    // Mate row's (`.zerops-project-heading`); open, its second line (D′) sits
    // under the name and the band grows over it.
    <div className="zerops-heading-stack">
      <div
        className={cn(
          "group/project relative flex h-8 min-w-0 items-center gap-1 ms-px me-0.5 ps-1.5 pe-1.5",
          onToggle !== undefined && "zerops-project-heading",
        )}
        data-collapsed={collapsed ? "true" : undefined}
        data-zerops-surface="sidebar-project"
      >
        {/* A name, not a label: no uppercase and no `MicroLabel`. The weight
          comes from size and room instead — at 13px it was *smaller* than the
          Mate names beneath it, which is a heading losing to its own contents
          (the owner, 2026-09-19: "shouldn't be uppercased, yet it should have
          bigger visual impact"). 15px, and the only thing in the column set
          that large. */}
        {onToggle === undefined ? (
          <span
            className={cn(
              HEADING_CLASS,
              "flex-1",
              muted && HEADING_MUTED,
              placeholder && HEADING_UNNAMED,
            )}
          >
            {title}
          </span>
        ) : (
          // The whole heading opens and folds the project — its hit area is the
          // heading's (`after:inset-0`) — and only its verbs and its production
          // stand above that, each its own control.
          <button
            aria-expanded={!collapsed}
            className="flex min-w-0 cursor-pointer items-center gap-1 rounded-sm text-left after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            data-zerops-surface="sidebar-project-toggle"
            onClick={onToggle}
            type="button"
          >
            <span
              className={cn(HEADING_CLASS, muted && HEADING_MUTED, placeholder && HEADING_UNNAMED)}
            >
              {title}
            </span>
            {/* After the words, not before them: before, it pushed the title
              18px right of the rail's own left edge, where every heading had
              started (the owner, 2026-09-25: "everything jumps around
              differently"). The title hugs its text, so the chevron follows
              it. */}
            <DisclosureGlyph />
            {faces}
            {collapsed ? (
              <HeadingReleaseMark
                line={secondLine}
                mark={line === undefined ? undefined : headingMark(line, landing)}
              />
            ) : null}
          </button>
        )}
        {/* The room between the title and the heading's end takes what the
          title leaves — the faces too, which arrive once the rows have folded
          away, under a pointer still on the heading: + and ⋯ stand past it,
          so they never move. */}
        <span aria-hidden="true" className="min-w-0 flex-1" />
        {/* Hidden until hover keeps a list of five projects calm, but a finger
          never hovers — so a coarse pointer gets them at rest. A slot that is
          always there: nothing moves when they show. */}
        {muted ? null : (
          <span className="relative z-1 flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100">
            {/* In the Custom order the grip leads the verbs: inside the band,
              clear of its rounded ends, and the name keeps the mark edge. */}
            {reorder?.custom === true && group !== undefined ? (
              <ProjectGrip
                groupId={group.groupId}
                name={title}
                onMove={(direction) => {
                  reorder.onMove(direction, true);
                }}
                onPointerDown={reorder.onGripPointerDown}
              />
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label={`Add a Mate to ${title}`}
                    className={HEADING_ACTION_CLASS}
                    data-zerops-surface="sidebar-project-add-mate"
                    onClick={addMate}
                    type="button"
                  />
                }
              >
                <PlusIcon aria-hidden="true" className="size-3.75" />
              </TooltipTrigger>
              <TooltipPopup side="right">Add a Mate</TooltipPopup>
            </Tooltip>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    aria-label={`More for ${title}`}
                    className={HEADING_ACTION_CLASS}
                    data-zerops-surface="sidebar-project-more"
                    type="button"
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" className="size-3.75" />
              </MenuTrigger>
              <MenuPopup align="start" className="w-56" side="right">
                {/* The project's own page. It went to the projects screen once,
                  so the one item named after the project was the one that did
                  not open it (the owner, 2026-09-19); now that the heading's
                  name collapses the project, this is the way in. */}
                <MenuItem onClick={onOpen ?? onBrowseProjects}>Open project</MenuItem>
                {/* The + beside this menu, which a narrow menu drops to keep the
                  project's name: here either way. */}
                <MenuItem onClick={addMate}>Add a Mate</MenuItem>
                {reorder === undefined ? null : (
                  <>
                    <MenuSeparator />
                    {/* The keyboard's way to arrange the list, and the pointer's
                      where the grip is not offered: from *Name* or *Creation
                      date* a move makes the order *Custom*, starting from the
                      one on screen. */}
                    <MenuItem
                      disabled={!reorder.canMoveUp}
                      onClick={() => {
                        reorder.onMove("up", false);
                      }}
                    >
                      Move up
                    </MenuItem>
                    <MenuItem
                      disabled={!reorder.canMoveDown}
                      onClick={() => {
                        reorder.onMove("down", false);
                      }}
                    >
                      Move down
                    </MenuItem>
                    <MenuSeparator />
                  </>
                )}
                {/* Each opens the form the projects page's own ⋯ opens for it. */}
                {missing.map((row) => (
                  <MenuItem
                    key={row.tier}
                    onClick={
                      group === undefined || onSetUp === undefined
                        ? onBrowseProjects
                        : () => {
                            onSetUp(group.groupId, row.tier);
                          }
                    }
                  >
                    {`Add ${row.name.toLocaleLowerCase()}`}
                  </MenuItem>
                ))}
                {/* Where a project is added. */}
                <MenuItem onClick={onBrowseProjects}>All projects</MenuItem>
              </MenuPopup>
            </Menu>
          </span>
        )}
        {chips === undefined || chips === null ? null : (
          <span
            className="flex shrink-0 items-center gap-1"
            data-coming={pillMotion.coming}
            data-landed={pillMotion.landed}
          >
            {chips}
          </span>
        )}
      </div>
      {group === undefined ? null : (
        <HeadingSubLine
          line={collapsed ? undefined : secondLine}
          onDetails={(projectId) => {
            const open = projectId === undefined ? undefined : openStop?.(projectId);
            if (open !== undefined) open();
            else (onOpen ?? onBrowseProjects)();
          }}
          onReview={(from) => {
            openReview({ kind: "release", groupId: group.groupId }, { from });
          }}
        />
      )}
    </div>
  );
}

const NO_MISSING_TIERS: ReadonlyArray<MissingEnvironmentRow> = [];

/** A folded heading's face, in words: who, and why it is shown. */
const HEADING_FACE_WORDS: Record<HeadingFaceDot | "working", string> = {
  attention: "needs you",
  failed: "stopped on an error",
  unread: "finished",
  working: "is working",
};

/** A stop's deployment demand, held for as long as its project's heading is drawn. */
function StopDemand({ projectId }: { readonly projectId: string }) {
  const inventory = useContext(InventoryContext);
  useStopDeploymentDemand(
    inventory === null ? null : findInventoryProjectRef(inventory, projectId),
  );
  return null;
}

/**
 * The faces of a folded project's busy Mates (M15), after its title: 18 px,
 * each its row's face in its row's pose — turning while it works, hopping when
 * it needs you, still where it stopped on an error — with a 7 px dot at its
 * corner for what is not work, cut out of the menu's ground: amber needs you,
 * blue finished unseen, red stopped on an error.
 */
function HeadingFaces({ faces }: { readonly faces: ReadonlyArray<HeadingFace> }) {
  return (
    <span
      className="ms-1 flex shrink-0 items-center gap-0.75"
      data-zerops-surface="sidebar-project-faces"
    >
      {faces.map((face) => (
        <HeadingFaceMark face={face} key={face.projectId} />
      ))}
      <span className="sr-only">
        {faces
          .map((face) => `${face.name} ${HEADING_FACE_WORDS[face.dot ?? "working"]}`)
          .join(", ")}
      </span>
    </span>
  );
}

/**
 * One face on a folded heading. Like its row's, it greets only an arrival it
 * watches, and its dot scales in only when it arrives while watched (T6) —
 * what a reload or a fold opened onto, or what this browser remembered, is
 * simply there.
 */
function HeadingFaceMark({ face }: { readonly face: HeadingFace }) {
  const arrived = useChangedSinceShown(face.dot, face.known);
  return (
    <span className="relative flex">
      <MateFace
        className="size-4.5"
        greets
        known={face.known}
        shape={face.shape}
        size="sm"
        state={face.face}
        tint={face.tint}
      />
      {face.dot === undefined ? null : (
        <span
          aria-hidden="true"
          className="zerops-heading-dot"
          data-arrived={arrived ? "" : undefined}
          data-dot={face.dot}
          key={face.dot}
        />
      )}
    </span>
  );
}

/** One place in a project's run of Mates: a Mate, one being created, or the quiet ones' fold. */
type MateSlot<T> =
  | { readonly kind: "mate"; readonly item: T }
  | { readonly kind: "coming"; readonly member: ZeropsGroupPendingMember }
  | { readonly kind: "fold"; readonly count: number };

/** The list's keys a row hands back to the tree: j and k move between the Mates. */
export interface MateRowKeys {
  readonly move: (from: HTMLElement, direction: 1 | -1) => void;
}

/** A key typed into a field is the field's, whatever the list would make of it. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Where a reveal lands: the control a person would have pressed there takes
 * the focus, and the row that was asked for flashes once — a Mate's own row,
 * a project's heading, a stop's chip, a change's row with its *Review*.
 */
interface RevealLanding {
  readonly focus: HTMLElement;
  readonly flash: HTMLElement;
  /** Pressed once it has the focus: a stop's chip opens its menu. */
  readonly press?: HTMLElement;
}

function revealLanding(
  root: HTMLElement | null,
  target: SidebarRevealTarget,
): RevealLanding | null {
  if (root === null) return null;
  const find = (selector: string) => root.querySelector<HTMLElement>(selector);
  switch (target.kind) {
    case "mate": {
      const row = find(
        `[data-zerops-mate-row="${target.projectId}"] [data-zerops-surface="sidebar-mate"]`,
      );
      return row === null ? null : { focus: row, flash: row };
    }
    case "project": {
      const heading = find(
        `[data-zerops-group="${target.groupId}"] [data-zerops-surface="sidebar-project"]`,
      );
      const toggle = heading?.querySelector<HTMLElement>(
        '[data-zerops-surface="sidebar-project-toggle"]',
      );
      return heading === null || heading === undefined
        ? null
        : { focus: toggle ?? heading, flash: heading };
    }
    case "stop": {
      // A stop is no row of its own: its chip on the heading carries it —
      // production's, or the stages' — and its menu says the rest, so that
      // chip is focused, flashed and opened.
      const chip = find(
        `[data-zerops-group="${target.groupId}"] [data-zerops-surface="sidebar-production-chip"][data-zerops-stops~="${CSS.escape(target.projectId)}"]`,
      );
      return chip === null ? null : { focus: chip, flash: chip, press: chip };
    }
    case "change": {
      const row = find(
        `[data-zerops-group="${target.groupId}"] [data-zerops-change="${target.key}"]`,
      );
      if (row === null) return null;
      // Its *Review*, the one door to it: Enter opens the review.
      const review = row.querySelector<HTMLElement>(
        '[data-zerops-surface="sidebar-pull-request-review"]',
      );
      return { focus: review ?? row, flash: row };
    }
  }
}

/**
 * One flash of the row a reveal landed on (`zerops-reveal-flash` in
 * `index.css`): while it rings, the focus ring of the control in it waits,
 * and takes over once it is done — one mark at a time.
 */
function flashOnce(element: HTMLElement): void {
  element.removeAttribute("data-zerops-flash");
  // A reveal of the same row twice flashes it twice: the animation restarts.
  void element.offsetWidth;
  element.setAttribute("data-zerops-flash", "");
  element.addEventListener(
    "animationend",
    () => {
      element.removeAttribute("data-zerops-flash");
    },
    { once: true },
  );
}

/**
 * Focus a revealed row once nothing modal holds the focus: the jump box
 * closing hands the focus back as it goes, and a row focused before that
 * would lose it at once.
 */
function focusOnceFree(element: HTMLElement, then: () => void, frames = 0): void {
  if (isCommandPaletteOpen() && frames < 30) {
    requestAnimationFrame(() => {
      focusOnceFree(element, then, frames + 1);
    });
    return;
  }
  if (!element.isConnected) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest" });
  then();
}

/**
 * A row that stands in for rows folded away — a project's quiet Mates, a
 * Mate's pull requests past three: the fold's own glyph in the faces'
 * column, the count on the words' edge, 13/18 and 28 px tall like a change.
 */
const FOLD_ROW_CLASS =
  "menu-line grid h-7 w-full min-w-0 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 ps-1.75 pe-1 text-left text-line leading-4.5 text-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A project's Mates untouched for a week, folded behind their count at the
 * end of its Mates — the words on the Mates' text column — and opened with a
 * press, under the fold, which stays where it is.
 */
function QuietMatesRow({
  count,
  open,
  onToggle,
}: {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      className={FOLD_ROW_CLASS}
      data-zerops-surface="sidebar-quiet-mates"
      onClick={onToggle}
      type="button"
    >
      <span className="flex justify-center">
        <FoldGlyph open={open} />
      </span>
      <span className="truncate">{`${String(count)} quiet ${count === 1 ? "Mate" : "Mates"}`}</span>
    </button>
  );
}

/** What a heading needs to move its project; see {@link ProjectHeader}'s `reorder`. */
export interface ProjectHeaderReorder {
  /** The *Custom* order is on, so the heading wears a grip. */
  readonly custom: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  /** `fromGrip`: the grip keeps the focus through the move. */
  readonly onMove: (direction: "up" | "down", fromGrip: boolean) => void;
  readonly onGripPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** A project's name: 16 · 600, the only 16 px words in the menu (S1). */
const HEADING_CLASS =
  "zerops-project-name min-w-0 truncate text-base leading-6 font-semibold text-sidebar-foreground";
const HEADING_MUTED = "text-line font-medium text-sidebar-muted-foreground";
const HEADING_UNNAMED = "font-normal text-sidebar-muted-foreground italic";

/** The row's stop, armed: its confirm in red words, as tall as the ■ it replaces. */
const ROW_STOP_ARMED_CLASS =
  "inline-flex h-5 cursor-pointer items-center rounded px-1 text-line leading-5 font-semibold text-status-failed-text outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

/** A heading's verbs, + and ⋯: 28 px, a row's hover behind them, muted until pointed at. */
const HEADING_ACTION_CLASS =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover data-popup-open:text-sidebar-foreground";

/**
 * A Mate and its crew's line, one thing in the menu (the owner, 2026-09-29:
 * "why isn't crew included in the hover?"): one surface in the row's inset
 * and corners, lit under the pointer anywhere on it and while a menu of its
 * is open — its row's hover, so its menu takes the time's slot there too —
 * and, open, by the list's one band, which measures it
 * (`SidebarSelectedBand`). Its changes stand after it, rows of their own
 * with their own hover. With no crew it is its row alone, to the pixel.
 */
function MateUnit({
  projectId,
  active,
  children,
}: {
  readonly projectId: string;
  /** Open: the selected band lights it, so it paints nothing of its own. */
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "menu-unit group/mate flex flex-col transition-colors",
        !active && "hover:bg-sidebar-row-hover has-[[data-popup-open]]:bg-sidebar-row-hover",
      )}
      data-zerops-mate-unit={projectId}
    >
      {children}
    </div>
  );
}

import { mateOutsideHq, NOT_IN_HQ_LINE } from "./ZeropsProjectRow.logic";

/** Memoised (`mateRowPropsEqual`): only the rows whose own props changed redraw with the tree. */
function MateRowRead<T extends RosterCandidate>(
  props: Parameters<typeof MateRowView<T>>[0] & { readonly keyedReadings?: boolean },
) {
  return props.keyedReadings ? <KeyedMateRow {...props} /> : <MateRowView {...props} />;
}
const MateRow = memo(MateRowRead, mateRowPropsEqual) as typeof MateRowRead;
function KeyedMateRow<T extends RosterCandidate>(props: Parameters<typeof MateRowView<T>>[0]) {
  const activity = useProjectMateActivity(props.candidate.project.id);
  const person = useHqProjectPerson(props.candidate.project.id);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const linked = useMateLinkedInHq(props.candidate.project.id);
  return (
    <MateRowView
      {...props}
      activity={activity}
      up={props.up || linked}
      owner={zeropsMateOwnerOf(person?.owner, viewer)}
    />
  );
}

function MateRowView<T extends RosterCandidate>({
  candidate,
  tint,
  shape,
  active,
  activity,
  up,
  coming,
  conversationsRead = false,
  onSelect,
  owner,
  timestampFormat,
  actions: offered,
  crew,
  onOpenCrew,
  appUrl,
  keys,
  number,
  numbers = false,
  reviewWaits = false,
}: {
  readonly candidate: T;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  /** It is up, its face awake (`mateAwake`): its container runs, or its link to HQ is open. */
  readonly up: boolean;
  /** Still coming up, or never came (`mateComing`): its one line says so. */
  readonly coming?: MateComing | undefined;
  /** Its conversations are read: none there says nothing was asked (`mateRowAskLine`). */
  readonly conversationsRead?: boolean;
  readonly onSelect: (candidate: T) => void;
  readonly owner: ZeropsMateOwner | undefined;
  readonly timestampFormat: TimestampFormat;
  /** Its menu's verbs; absent, the row carries no menu (a harness, a test). */
  readonly actions?: MateRowActions | undefined;
  /** Its crew as a fixture draws it (a harness); absent, its feed once connected. */
  readonly crew?: SidebarCrewRead | undefined;
  /** Opens it on its Crew tab; absent, its menu offers no crew. */
  readonly onOpenCrew?: ((candidate: T, setUp: boolean) => void) | undefined;
  /** Its app — its pair's stage route — where it has one. */
  readonly appUrl?: string | undefined;
  /** j and k, handed back to the tree. */
  readonly keys?: MateRowKeys | undefined;
  /** Its place among the drawn Mates, 1–9, for ⌥ and its number. */
  readonly number?: number | undefined;
  /** Option is held: the time slot shows the number instead. */
  readonly numbers?: boolean;
  /** Its own change waits on the person's review (`mateNextStep`): it wears needs-you. */
  readonly reviewWaits?: boolean;
}) {
  const tags = readZeropsMembership(candidate.project);
  const name = projectNameInApp(candidate.project);
  // On its way off Zerops (`deletingMates.ts`): it says so in its last line,
  // offers no menu and does not open, until the listing lets it go.
  const deletingIds = useDeletingMates();
  const deleting = mateDeleting(candidate.project, deletingIds);
  // *Finish setup* running on it, from whichever screen it was pressed (`finishSetupRowLine`):
  // its own view draws the steps only while its container is missing, so its row says so. A stop
  // is said for a moment, and never over a Mate that is connected: this tab's socket to it, or its
  // link to HQ — not a container that only runs, whose stop is what the row says.
  const press = useMatePress(candidate.project.id);
  const linkedInHq = useMateLinkedInHq(candidate.project.id);
  const linkedNow = candidate.group === "connected" || linkedInHq;
  const placedKnown = useAtomValue(menuPlacementKnownAtom);
  const outsideHq = mateOutsideHq(
    candidate.project,
    placedKnown,
    coming !== undefined || press !== undefined,
  );
  const finishing =
    deleting || coming !== undefined ? undefined : finishSetupRowLine(press, { up: linkedNow });
  // What the row says in its state (`mateRowView`, M7): the face, the right of
  // the name, what was asked and the third line — the face and the words from
  // the one reading of it (`mateRowReading`): what it is on, or was last on,
  // read through its socket, or until the socket opens what this browser
  // remembers the row saying. A Mate still coming up says only that
  // (`mateComingRowView`).
  const viewer = useZeropsSessionOptional()?.user?.id;
  const hqPeople = useHqProjectPerson(candidate.project.id);
  const nowMs = useNowMs();
  const read = mateRowReading({
    name: projectNameInApp(candidate.project),
    connected: up,
    activity,
    reviewWaits,
    mine: hqPeople?.waitsOnViewer === true,
    // Waking while it comes up and arrives (`mateFaceFor`).
    pose: matePoseOf(candidate, nowMs, deleting ? "deleting" : mateLifeOf(coming)),
  });
  const view = deleting
    ? mateDeletingView(read)
    : coming !== undefined
      ? mateComingRowView(read, coming)
      : finishing !== undefined
        ? mateFinishingView(read)
        : read;
  // Nothing on its menu is about a Mate still being made, or one going: it
  // offers none — until its setup stopped, when *Finish setup* is on it.
  const actions = !outsideHq && mateRowOffersMenu({ deleting, coming }) ? offered : undefined;
  // Its project access detail is held while the row is drawn with its menu (`useDrawnProjectAccess`).
  const drawn = actions?.drawn;
  useEffect(() => drawn?.(), [drawn]);
  // Whose seat it is, and whether anybody has signed its agent in — read off
  // its own records, so from the first paint (`mateOwnerView`).
  const records = mateOwnerRecords(candidate.project, hqPeople?.owned);
  const signers = hqPeople?.everSignedIn;
  const seated = mateOwnerView({
    owner,
    records,
    asked: view.ask !== undefined,
    hqSigners:
      signers === undefined ? undefined : Object.keys(signers).length > 0 ? "some" : "none",
    standUpBy: tags.standUp?.by,
    madeBy: tags.madeBy,
    viewer,
    // It waits on the viewer once its page can show the sign-in: its link made.
    linked: candidate.group === "connected",
  });
  // A Mate with no container the listing has read — none in its project, or its services not
  // read yet — has nothing to sign in, and says nothing of it: no sign-in line, no empty seat.
  const containerless = candidate.service === undefined;
  // The sign-in line stands where nothing else is said of a Mate that is up: to the person who
  // added it, that it waits on them — with the amber dot of what needs them.
  const signIn =
    outsideHq || deleting || finishing !== undefined || view.coming !== undefined || containerless
      ? undefined
      : seated.signInLine;
  const status =
    deleting || view.coming !== undefined ? null : mateStatus(activity, signIn !== undefined);
  const dot =
    (status?.severity === "attention" &&
    (status.kind === "limit" ||
      (status.kind === "sign-in" ? seated.waitsOnViewer : hqPeople?.waitsOnViewer === true))
      ? "attention"
      : view.dot) ?? (signIn !== undefined && seated.waitsOnViewer ? "attention" : undefined);
  // What its face's corner wears (`ownerBadge`), and whether its face is paler: not the viewer's.
  const badge =
    outsideHq || (containerless && seated.seat.kind === "nobody")
      ? null
      : ownerBadge(seated.seat, owner?.isViewer === true);
  const notYours = mateNotYours({
    seat: seated.seat,
    isViewer: owner?.isViewer === true,
    signer: records.person,
    viewer,
  });
  const known = activity !== undefined && activity.remembered !== true;
  // What the person is about to send it, waiting in its composer: the row's second line says it,
  // read from this browser whether or not its socket is open (`mateRowDraft`).
  const draft = useComposerDraftStore((state) =>
    mateRowDraft(state, {
      environmentId: candidate.environmentId,
      threadId: activity?.threadId,
      threadKey: activity?.threadKey,
    }),
  );
  // What this browser just sent it, until its conversation says it (`mateRowSentAsk`).
  const sentAsk = usePendingSentAsk(candidate.environmentId);
  // The person's line (`mateRowAskLine`): what they asked, or are about to, or that nothing was.
  const askLine = mateRowAskLine({
    view,
    signIn:
      signIn === undefined ? undefined : { text: signIn, waitsOnViewer: seated.waitsOnViewer },
    draft,
    sent:
      sentAsk !== undefined && (activity === undefined || activity.threadId === sentAsk.threadId)
        ? sentAsk.text
        : undefined,
    deleting,
    finishing: finishing !== undefined,
    read: conversationsRead,
  });
  const warmIntent = useWarmIntent(activity?.threadKey);
  // Its menu's door to its crew (`mateCrewItem`): crew mode off, on with no crew yet, or a crew
  // applied, as HQ holds it of any Mate — or a fixture's.
  const liveCrewStatus = useMateCrew(
    onOpenCrew !== undefined && crew === undefined ? candidate.project.id : null,
  ).status;
  const crewStatus = crew === undefined ? liveCrewStatus : crew.status;
  // Setting a crew up is the viewer's only on a login they may run (D6): read where it is offered.
  const setUpAccess = useCrewAccess(
    onOpenCrew !== undefined &&
      crew === undefined &&
      crewStatus === "none" &&
      owner?.isViewer === true &&
      candidate.group === "connected"
      ? (candidate.environmentId ?? null)
      : null,
    null,
  );
  const crewItem =
    onOpenCrew === undefined
      ? null
      : mateCrewItem({ status: crewStatus, owner, mayChange: setUpAccess.crew === null });
  // A new ask rises into the row's second line as the person sets it; the
  // ask this browser remembered gives way to the one read without a rise.
  const askChanged = useChangedSinceShown(view.ask, known);
  const unread = activity?.unread === true;
  // Stopping from the row is two presses (`stopArmStep`): the ■ or x arms it, a second press
  // within 3 s stops; leaving, Esc, blur, the time or the run ending by itself let it go.
  const [stopArm, setStopArm] = useState<StopArm>(null);
  if (stopArm !== null && actions?.stop === undefined) {
    setStopArm(stopArmStep(stopArm, { kind: "run-ended" }).state);
  }
  const armed = stopArm !== null;
  const stepStop = (event: StopArmEvent) => {
    const next = stopArmStep(stopArm, event);
    setStopArm(next.state);
    if (next.stop) actions?.stop?.();
  };
  useEffect(() => {
    if (stopArm === null) return;
    const timer = setTimeout(
      () => {
        setStopArm((current) => stopArmStep(current, { kind: "tick", at: Date.now() }).state);
      },
      STOP_ARM_MS - (Date.now() - stopArm.armedAt),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [stopArm]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  const rowButton = useRef<HTMLButtonElement>(null);
  const openMenu = (at?: MenuPoint) => {
    setMenuAt(at);
    setMenuOpen(true);
  };
  // A finger held on the row opens its menu, as a right-click does: a phone
  // has neither that nor a hover to show the menu's trigger. The click that
  // ends the hold is the menu's, not an open.
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });
  const cancelLongPress = () => {
    if (longPress.current.timer !== null) clearTimeout(longPress.current.timer);
    longPress.current.timer = null;
  };

  return (
    // The row is the container, not the button: the menu's trigger sits in
    // the row beside the button, never inside it. Both are lit as the row's
    // unit (`MateUnit`), wherever on it the pointer is.
    <div
      className="relative"
      data-zerops-mate-row={candidate.project.id}
      data-zerops-surface="sidebar-mate-row"
      onContextMenu={
        actions === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              if (longPress.current.fired) return;
              openMenu({ x: event.clientX, y: event.clientY });
            }
      }
      onPointerCancel={cancelLongPress}
      onPointerDown={(event) => {
        if (actions === undefined || event.pointerType !== "touch") return;
        longPress.current.fired = false;
        cancelLongPress();
        longPress.current.timer = setTimeout(() => {
          longPress.current.fired = true;
          openMenu();
        }, 480);
      }}
      onBlur={(event) => {
        if (armed && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          stepStop({ kind: "blur" });
        }
      }}
      onKeyDown={(event) => {
        // Esc lets an armed stop go wherever in the row the focus stands: its main button or
        // the Stop? itself.
        if (armed && event.key === "Escape") {
          event.preventDefault();
          stepStop({ kind: "escape" });
        }
      }}
      onPointerLeave={(event) => {
        cancelLongPress();
        // Only a mouse leaves: a tap fires pointerleave before its click, and a second tap on
        // Stop? must still stop.
        if (armed && event.pointerType === "mouse") stepStop({ kind: "leave" });
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "touch" && event.movementY !== 0) cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
    >
      <button
        aria-current={active ? "true" : undefined}
        // Two columns: the face's 28 px, then the words. The face stands at
        // the top, on the name's line, whatever number of lines follow it —
        // centred on the row it sat beside the question in a three-line row
        // and beside the name in a one-line one. Faces stand at 16 px from
        // the menu's edge and every word at 56 (the list starts at 9). It
        // paints nothing of its own: its unit is lit, under the pointer or
        // by the list's one band, which slides to it (`SidebarSelectedBand`).
        aria-label={
          dot === undefined
            ? undefined
            : `${name}, ${status?.kind === "limit" ? "Provider limit" : mateDotLabel(dot)}`
        }
        aria-disabled={deleting || outsideHq || undefined}
        className="menu-row grid w-full min-w-0 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 py-2.5 ps-1.75 pe-2 text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default"
        data-zerops-surface="sidebar-mate"
        // Resting on it, focusing or touching it warms its conversation, so
        // a press finds its rows already placed (`KeptTimelines`).
        {...warmIntent}
        onClick={() => {
          if (longPress.current.fired) {
            longPress.current.fired = false;
            return;
          }
          if (deleting || outsideHq) return;
          onSelect(candidate);
        }}
        onKeyDown={(event) => {
          // Esc while armed is the row's own (`onKeyDown` on the row, above).
          if (armed && event.key === "Escape") return;
          // The list's keys: j and k move, x arms a working Mate's stop and x again stops it,
          // e marks it read or unread.
          const action = sidebarMateKey({
            key: event.key,
            modified: event.metaKey || event.ctrlKey || event.altKey,
          });
          if (action === "next" || action === "previous") {
            event.preventDefault();
            keys?.move(event.currentTarget, action === "next" ? 1 : -1);
            return;
          }
          if (action === "stop" && actions?.stop !== undefined) {
            event.preventDefault();
            stepStop({ kind: "press", at: Date.now() });
            return;
          }
          if (action === "unread" && actions?.toggleUnread !== undefined) {
            event.preventDefault();
            actions.toggleUnread();
            return;
          }
          // The keyboard's right-click: the menu key, or Shift+F10.
          if (actions === undefined) return;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openMenu();
          }
        }}
        onFocus={(event) => {
          // The eye is on this Mate now: "the next one that waits" starts here.
          useSidebarReveal.getState().setCursor(candidate.project.id);
          warmIntent.onFocus(event);
        }}
        ref={rowButton}
        type="button"
      >
        <span className="relative flex size-7">
          {/* The Mate wears the card's face, and a colleague's Mate its
              owner's picture on the face's corner, cut out of it, over a paler
              face (the owner, 2026-09-30: a face before the name read as the
              name's; "the not yours should have the avatar bigger"). Your own
              carry nothing; nobody's shows the empty seat there. Nothing
              rings it — the step it is on is its row's third line. */}
          <span
            className={cn(
              "relative flex",
              badge !== null && "menu-face-cut",
              notYours && "menu-face-pale",
            )}
          >
            {/* Until its socket answers the face stands in idle or asleep, the
                row's words as this browser remembered them: a Mate found
                waiting then is not arriving at it. */}
            <MateFace
              cues={mateRowCues(activity)}
              greets
              known={known}
              shape={shape}
              size="md"
              state={view.face}
              tint={tint}
            />
          </span>
          {badge === null ? null : <MateOwnerMark seat={badge} />}
        </span>
        {/* One even leading, three lines of one thing: the name 14/20, what
            was asked 13/18, the answer 13/18, and no gap between them — the
            name used to float over a paragraph on a 22 px line and 2 px of
            air. The ask is the words' second ink, the answer muted. Every
            row keeps the three lines' height, whatever it says yet: a Mate
            nobody has asked anything does not float its name in a short
            row, and its first message grows nothing. */}
        <span className="flex min-h-14 min-w-0 flex-col">
          <span className="flex h-5 min-w-0 items-center gap-2">
            <span
              className={cn("flex min-w-0 flex-1 items-center gap-1.5", renaming && "invisible")}
            >
              <span
                className={cn(
                  "min-w-0 truncate text-sm leading-5",
                  view.strongName ? "font-semibold" : "font-medium",
                )}
                data-zerops-surface="sidebar-mate-name"
              >
                {name}
              </span>
              {actions?.muted === true ? (
                <BellOffIcon
                  aria-label="Notifications muted"
                  className="size-3 shrink-0 text-sidebar-muted-foreground/70"
                  data-zerops-surface="sidebar-mate-muted"
                  role="img"
                />
              ) : null}
            </span>
            {/* A slot that is always there: the time, which gives way to the
                row's menu on hover and focus without anything moving. */}
            <span
              className={cn(
                "relative flex h-5 min-w-11 shrink-0 justify-end",
                actions !== undefined &&
                  "transition-opacity group-hover/mate:opacity-0 group-has-[:focus-visible]/mate:opacity-0 group-has-[[data-popup-open]]/mate:opacity-0",
                armed && "opacity-0",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.75",
                  numbers && number !== undefined && "opacity-0",
                )}
              >
                <MateDot known={known} tone={dot} />
                <MateSlot
                  at={activity?.at}
                  slot={view.slot}
                  timestampFormat={timestampFormat}
                  tint={tint}
                />
              </span>
              {numbers && number !== undefined ? (
                <KeyChip className="absolute end-0 top-0" data-zerops-surface="sidebar-mate-number">
                  {String(number)}
                </KeyChip>
              ) : null}
            </span>
          </span>
          {view.coming !== undefined ? <MateComingLine line={mateBornLine(view.coming)} /> : null}
          {outsideHq ? (
            <span className="truncate text-line leading-4.5 text-muted-foreground">
              {NOT_IN_HQ_LINE}
            </span>
          ) : askLine === undefined ? null : askLine.kind === "sign-in" ? (
            <MateSignInLine waitsOnViewer={askLine.waitsOnViewer} words={askLine.text} />
          ) : (
            <MateAskLine line={askLine} rises={askChanged} />
          )}
          {outsideHq ? null : status !== null ? (
            <span className="flex min-w-0 items-center gap-2">
              <MateStatusMarker mateName={name} status={status} timestampFormat={timestampFormat} />
              {status.kind === "limit" || view.reply === undefined ? null : (
                <MateReply known={known} reply={view.reply} />
              )}
            </span>
          ) : view.reply === undefined ? null : (
            <MateReply known={known} reply={view.reply} />
          )}
          {deleting ? <MateDeletingLine /> : null}
          {finishing === undefined ? null : <MateFinishingLine words={finishing} />}
        </span>
      </button>
      {actions === undefined ? null : (
        <span
          className={cn(
            "absolute end-2 top-2.5 flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100",
            armed && "opacity-100",
          )}
          data-zerops-surface="sidebar-mate-actions"
        >
          {actions.stop === undefined ? null : (
            // While it works, the time's slot is also its stop: armed by a first press, a red
            // "Stop?" stands where the ■ stood, and only it stops (`stopArmStep`).
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label={armed ? `Confirm stop ${name}` : `Stop ${name}`}
                    className={armed ? ROW_STOP_ARMED_CLASS : ROW_ACTION_CLASS}
                    data-armed={armed ? "" : undefined}
                    data-zerops-surface="sidebar-mate-stop"
                    onClick={() => {
                      stepStop({ kind: "press", at: Date.now() });
                    }}
                    type="button"
                  />
                }
              >
                {armed ? (
                  <span className="menu-stop-armed">Stop?</span>
                ) : (
                  <SquareIcon aria-hidden="true" className="size-2.5 fill-current" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="right">
                {armed ? "Press again to stop" : "Stop the run"}
              </TooltipPopup>
            </Tooltip>
          )}
          <MateMenu
            actions={actions}
            appUrl={appUrl}
            at={menuAt}
            crew={
              crewItem === null || onOpenCrew === undefined
                ? undefined
                : {
                    label: crewItem.label,
                    onSelect: () => {
                      setMenuOpen(false);
                      onOpenCrew(candidate, crewItem.setUp);
                    },
                  }
            }
            name={name}
            onOpenChange={(next) => {
              setMenuOpen(next);
              if (!next) setMenuAt(undefined);
            }}
            onOpenMate={() => {
              setMenuOpen(false);
              onSelect(candidate);
            }}
            onRename={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
            open={menuOpen}
            shortcuts
            unread={unread}
          />
        </span>
      )}
      {renaming && actions?.rename !== undefined ? (
        <MateRenameField
          onDone={() => {
            setRenaming(false);
            rowButton.current?.focus();
          }}
          rename={actions.rename}
        />
      ) : null}
    </div>
  );
}

/**
 * Whose Mate it is, on the corner of its face (`OwnerSeat`): a colleague's
 * picture, 12 px round and cut out of the face rather than laid over it, or
 * their initial on a colour of their own (`ownerMark`) — never before the
 * name, where "(face) Cleo" read as a person called Cleo (the owner,
 * 2026-09-30). A Mate whose records name nobody sits on an empty seat there:
 * a dashed ring in the muted ink, the "no assignee" convention — never a
 * person without a picture, never a spinner — said in words on hover. The
 * badge stands in the face's box, so nothing moves when it arrives.
 *
 * The initial is part of a mark, not text: 7 px inside the 12 px disc, as a
 * picture would be.
 */
function MateOwnerMark({ seat }: { readonly seat: BadgeSeat }) {
  const [failed, setFailed] = useState(false);
  if (seat.kind === "nobody") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="menu-owner"
              data-zerops-avatar="nobody"
              data-zerops-surface="sidebar-mate-owner"
            />
          }
        >
          {/* Twelve even dashes: `pathLength` makes the ring's length 24, so
              the pattern closes on itself with no short dash at the seam. */}
          <svg aria-hidden="true" className="size-full" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              fill="none"
              pathLength="24"
              r="7.25"
              stroke="currentColor"
              strokeDasharray="1.25 0.75"
              strokeWidth="1.25"
            />
          </svg>
          <span className="sr-only">{seat.label}</span>
        </TooltipTrigger>
        <TooltipPopup side="right">{seat.label}</TooltipPopup>
      </Tooltip>
    );
  }
  const { mark } = seat;
  const picture = failed ? null : mark.picture;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="menu-owner"
            data-zerops-avatar={picture === null ? "initials" : "picture"}
            data-zerops-surface="sidebar-mate-owner"
            style={{ "--menu-owner-hue": mark.hue } as CSSProperties}
          />
        }
      >
        {picture === null ? (
          <span aria-hidden="true">{mark.initial}</span>
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            onError={() => {
              setFailed(true);
            }}
            src={picture}
          />
        )}
        <span className="sr-only">{mark.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{mark.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The row's right edge: when the Mate last did something, as a messenger
 * dates its rows — or, while it works, its work left running in the
 * background included, the run's clock counting up in ink (S3: blue is for
 * what clicks, and a running clock is not that); or, paused at a usage
 * limit, when it picks up again. Nothing at all for a Mate nobody has
 * spoken to yet.
 */
function MateSlot({
  slot,
  at,
  timestampFormat,
  tint,
}: {
  readonly slot: MateRowSlot;
  /** When it last did something, for the age. */
  readonly at: string | undefined;
  readonly timestampFormat: TimestampFormat;
  /** Its Mate's colour: the working clock wears it. */
  readonly tint: MateTintId;
}) {
  // A run ending hands its clock over to the age in place, and a run starting the age to its
  // clock: the newcomer fades in (220 ms). What the row opened onto is simply there.
  const [shown, setShown] = useState(slot.kind);
  const [handedOver, setHandedOver] = useState(false);
  if (shown !== slot.kind) {
    setShown(slot.kind);
    setHandedOver(
      (shown === "clock" && slot.kind === "age") || (shown === "age" && slot.kind === "clock"),
    );
  }
  const fadeIn = handedOver ? "animate-zerops-appear motion-reduce:animate-none" : undefined;
  switch (slot.kind) {
    case "none":
      return null;
    case "clock":
      return <MateWorkingTime className={fadeIn} since={slot.since} tint={tint} />;
    case "paused": {
      const upcoming = formatUpcomingTimestamp(slot.until, timestampFormat);
      return (
        <Tooltip>
          <TooltipTrigger
            render={<span className={TIME_CLASS} data-zerops-surface="sidebar-mate-time" />}
          >
            <span
              className="inline-flex items-center gap-1"
              data-zerops-surface="sidebar-mate-paused"
            >
              <PauseIcon aria-hidden="true" className="size-2.5" />
              {formatShortTimestamp(slot.until, timestampFormat)}
            </span>
            <span className="sr-only">{`Paused at a usage limit, available again ${upcoming}`}</span>
          </TooltipTrigger>
          <TooltipPopup side="right">{`Paused at a usage limit. Available again ${upcoming}.`}</TooltipPopup>
        </Tooltip>
      );
    }
    case "age":
      return <SidebarMateAge at={at} className={cn(TIME_CLASS, fadeIn)} />;
  }
}

const TIME_CLASS = "shrink-0 text-line leading-5 text-muted-foreground tabular-nums";

/**
 * The working clock, ticking once a second — a step, never a continuous repaint (R6) — read as a
 * live clock, not a timestamp (the owner, 2026-09-30): 600 and tabular in its Mate's own hue,
 * after a small dot of the same hue breathing slowly. The dot stands outside the clock's box, in
 * the gap before it, so nothing beside it moves; reduced motion holds it still.
 */
function MateWorkingTime({
  since,
  tint,
  className,
}: {
  readonly since: string;
  readonly tint: MateTintId;
  readonly className?: string | undefined;
}) {
  const nowMs = useSecondsNowMs(true);
  return (
    <span
      className={cn("menu-clock shrink-0 text-line leading-5 tabular-nums", className)}
      data-tint={tint}
      data-zerops-surface="sidebar-mate-time"
    >
      <span aria-hidden="true" className="menu-clock-mark" />
      {formatWorkingTime(nowMs - Date.parse(since))}
    </span>
  );
}

/**
 * The dot before the age: amber where the Mate needs you, blue where it
 * finished something you have not seen, red where it stopped on an error
 * (S3) — never a word. A dot that arrives while you watch scales in, once
 * (T6); what the menu opened onto, or what this browser remembered, is
 * simply there.
 */
const mateDotLabel = (tone: "attention" | "unread" | "failed"): string =>
  tone === "unread"
    ? "Unseen reply"
    : tone === "failed"
      ? "Stopped on an error"
      : "Waiting for you";

function MateDot({
  tone,
  known,
}: {
  readonly tone: "attention" | "unread" | "failed" | undefined;
  /** The Mate's state is read, not what this browser remembered. */
  readonly known: boolean;
}) {
  const arrived = useChangedSinceShown(tone, known);
  if (tone === undefined) return null;
  return (
    <span
      aria-hidden="true"
      className="menu-dot"
      data-arrived={arrived ? "" : undefined}
      data-tone={tone}
      data-zerops-surface="sidebar-mate-dot"
      key={tone}
    />
  );
}

/** The third line's inks: the answer muted, unread in the second ink, a question in ink, an error red. */
const REPLY_TONE_CLASS: Record<"muted" | "ink-2" | "ink" | "failed" | "attention", string> = {
  muted: "text-muted-foreground",
  "ink-2": "menu-ink-2",
  ink: "text-sidebar-foreground",
  failed: "text-status-failed-text",
  attention: "text-status-attention-text",
};

/**
 * The row's second line, the person's (`mateRowAskLine`): what they last asked, rising in as they
 * set it; or what they are about to send, led by *Draft:* the way a messenger leads an unsent
 * message — the ask kept under it in the same cell, so clearing the draft replays no rise; or,
 * its conversation read and nobody having asked it anything, that fact in the muted ink.
 */
function MateAskLine({
  line,
  rises,
}: {
  readonly line: Exclude<MateRowAskLine, { readonly kind: "sign-in" } | undefined>;
  /** The ask is new since the row was shown: it rises in. */
  readonly rises: boolean;
}) {
  if (line.kind === "nothing-asked") {
    return (
      <span
        className="truncate text-line leading-4.5 text-muted-foreground"
        data-zerops-surface="sidebar-mate-nothing-asked"
      >
        {NOTHING_ASKED_YET}
      </span>
    );
  }
  const ask = line.kind === "ask" ? line.text : line.ask;
  const drafting = line.kind === "draft";
  return (
    <span className="grid min-w-0 text-line leading-4.5">
      {ask === undefined ? null : (
        <span
          aria-hidden={drafting ? true : undefined}
          className={cn(
            "menu-ink-2 col-start-1 row-start-1 truncate",
            drafting && "invisible",
            rises && "animate-words-in motion-reduce:animate-none",
          )}
          data-zerops-surface={drafting ? undefined : "sidebar-mate-subject"}
          key={ask}
        >
          {ask}
        </span>
      )}
      {drafting ? (
        <span
          className="col-start-1 row-start-1 truncate text-muted-foreground"
          data-zerops-surface="sidebar-mate-draft"
        >
          <span className="font-medium text-sidebar-foreground">Draft:</span> {line.text}
        </span>
      ) : null}
    </span>
  );
}

const NOTHING_ASKED_YET = "Nothing asked yet";

/**
 * The row's third line, the Mate's (`mateRowView`): its last words in its state's ink — the
 * question it waits on, the error it stopped on — or, while it works, the step it is on, its
 * command in mono under a sweep of light (D5); or the dots holding the line while words are
 * still to come. An unsent draft never stands here: it is the person's, on the line above.
 */
function MateReply({
  reply,
  known,
}: {
  readonly reply: NonNullable<MateRowReply>;
  /** The words are the Mate's as read, not what this browser remembered them saying. */
  readonly known: boolean;
}) {
  // The Mate's newest words rise into their line when they arrive, as its
  // status line's do in the chat; what the menu opened onto is simply there,
  // and remembered words give way to the read ones without a rise.
  const words = reply.kind === "words" ? reply.text : reply.kind === "live" ? reply.words : null;
  const wordsChanged = useChangedSinceShown(words, known);
  if (reply.kind === "pending") return <MateReplyPending />;
  // Remembered as holding words to come: its place kept, empty — words on their way are only
  // true now, and an asleep face over them said the opposite.
  if (reply.kind === "held") {
    return <span aria-hidden="true" className="h-4.5" data-zerops-surface="sidebar-mate-held" />;
  }
  if (reply.kind === "live") {
    return (
      // The line rises as a new step arrives, and the sweep runs over its
      // words inside it: two animations, two elements — on one, the sweep's
      // took the rise's place and a new step never rose.
      <span
        className={cn(
          "truncate text-line leading-4.5 text-muted-foreground",
          wordsChanged && "animate-words-in motion-reduce:animate-none",
        )}
        data-zerops-surface="sidebar-mate-live-step"
        key={`live:${reply.words}`}
      >
        <RunShimmer inline sweeps>
          {reply.words}
        </RunShimmer>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "truncate text-line leading-4.5",
        REPLY_TONE_CLASS[reply.tone],
        wordsChanged && "animate-words-in motion-reduce:animate-none",
      )}
      data-zerops-reply-tone={reply.tone}
      data-zerops-surface="sidebar-mate-snippet"
      key={`words:${reply.text}`}
    >
      {reply.text}
    </span>
  );
}

/**
 * The last line while the Mate's words are still to come — sent, or being
 * worked on: the messenger's "is typing", held still (R6). The row keeps its
 * height from the message sent to the first words back, where it used to lose
 * its last line and grow it again, moving every row under it twice (Nova,
 * 2026-09-28: 76 → 58 → 76 px, the first dip in the second before the run
 * started).
 */
function MateReplyPending() {
  return (
    <span className="flex h-4.5 items-center gap-1" data-zerops-surface="sidebar-mate-pending">
      <span aria-hidden="true" className="size-1 rounded-full bg-sidebar-muted-foreground/45" />
      <span aria-hidden="true" className="size-1 rounded-full bg-sidebar-muted-foreground/45" />
      <span aria-hidden="true" className="size-1 rounded-full bg-sidebar-muted-foreground/45" />
      <span className="sr-only">Working on a reply</span>
    </span>
  );
}

/**
 * The row's second line where nobody has signed its agent in and nothing was
 * asked (`mateOwnerView`): the fact, in the muted ink, as one line of the
 * row's leading on the words' edge — in ink where the sign-in is the viewer's
 * to make, as a question waiting on them is. Nothing on it to press: the
 * row's own press opens the Mate, whose conversation holds the sign-in.
 */
function MateSignInLine({
  words,
  waitsOnViewer,
}: {
  readonly words: string;
  readonly waitsOnViewer: boolean;
}) {
  return (
    <span
      className={cn(
        "truncate text-line leading-4.5",
        waitsOnViewer ? "text-sidebar-foreground" : "text-muted-foreground",
      )}
      data-zerops-sign-in={waitsOnViewer ? "yours" : "nobody"}
      data-zerops-surface="sidebar-mate-sign-in"
    >
      {words}
    </span>
  );
}

/**
 * The row's last line while its Mate is on its way off Zerops
 * (`mateDeletingView`): the fact, in the muted ink, where its words stood.
 */
function MateDeletingLine() {
  return (
    <span
      className="truncate text-line leading-4.5 text-muted-foreground"
      data-zerops-surface="sidebar-mate-deleting"
    >
      {MATE_DELETING_WORD}
    </span>
  );
}

/**
 * The row's last line while *Finish setup* runs on its Mate (`mateFinishingView`): what is being
 * done, in the muted ink, where its words stood.
 */
function MateFinishingLine({ words }: { readonly words: string }) {
  return (
    <span
      className="truncate text-line leading-4.5 text-muted-foreground"
      data-zerops-surface="sidebar-mate-finishing"
    >
      {words}
    </span>
  );
}

/**
 * The row's one line while its Mate is being born (`mateBornLine`): "Coming
 * up" on a clock counting from the press — muted, in tabular figures so its
 * ticks move nothing — or that setting it up stopped, in red. It stands where
 * the sign-in line will, and new words rise into it as the person watches;
 * the clock's ticks never do.
 */
function MateComingLine({ line }: { readonly line: MateBornLine }) {
  const risen = useChangedSinceShown(line.words, true);
  const nowMs = useSecondTick(line.since !== undefined);
  return (
    <span
      className={cn(
        "truncate text-line leading-4.5 tabular-nums",
        line.tone === "attention" ? "text-status-attention-text" : "text-muted-foreground",
        risen && "animate-words-in motion-reduce:animate-none",
      )}
      data-zerops-coming-tone={line.tone}
      data-zerops-surface="sidebar-mate-coming-line"
      key={line.words}
    >
      {line.tone === "attention" ? (
        <CircleAlertIcon aria-hidden="true" className="mr-1 inline size-3" />
      ) : null}
      {mateBornLineText(line, nowMs)}
    </span>
  );
}

/** Now, stepping once a second while `ticking`: a step, never a continuous repaint (R6). */
function useSecondTick(ticking: boolean): number {
  return useSecondsNowMs(ticking);
}

/**
 * A Mate being created that the listing does not hold yet, drawn from its
 * birth as the row it will be: its face waking, as every Mate's is while it
 * comes up (`mateBirthFace`) — asleep once its birth stopped — in the colours its person picked (slate where it picked none); the
 * empty seat before its name — nobody has signed its agent in yet — and how far
 * its birth has got in the projects page's words. A press opens its own view,
 * where it comes up; its listed row stands in its place with the same face,
 * seat and words.
 */
function ComingMateRow({
  name,
  coming,
  active,
  onOpen,
}: {
  readonly name: string;
  readonly coming: ZeropsGroupPendingMember;
  readonly active: boolean;
  readonly onOpen: ((projectId: string) => void) | undefined;
}) {
  const tint = coming.face?.tint ?? "slate";
  const row = (
    <button
      aria-current={active ? "true" : undefined}
      className="menu-row grid w-full min-w-0 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 py-2.5 ps-1.75 pe-2 text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      data-zerops-mate-row={coming.projectId}
      data-zerops-surface="sidebar-mate-coming"
      onClick={() => {
        onOpen?.(coming.projectId);
      }}
      type="button"
    >
      <span className="relative flex size-7">
        <span className="menu-face-cut menu-face-pale relative flex">
          <MateFace
            shape={coming.face?.shape ?? mateShapeOf(undefined, tint)}
            size="md"
            state={mateBirthFace(coming.failed === true)}
            tint={tint}
          />
        </span>
        {COMING_SEAT === null ? null : <MateOwnerMark seat={COMING_SEAT} />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex h-5 min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm leading-5 font-medium">{name}</span>
        </span>
        <MateComingLine line={pendingBornLine(coming)} />
      </span>
    </button>
  );
  // A creation that stopped before Zerops took it: its ⋯ ends it, or starts it over.
  return (
    <SidebarComingEnds birthId={coming.projectId} name={name}>
      {row}
    </SidebarComingEnds>
  );
}

/** Nobody has signed a Mate's agent in while it is being made: the empty seat, in words. */
const COMING_SEAT: BadgeSeat | null = ownerBadge(
  mateOwnerView({
    owner: undefined,
    records: { named: false, signedIn: false },
    asked: true,
    hqSigners: "none",
  }).seat,
  false,
);

/**
 * A Mate's open pull requests: the rows themselves while there are a few, a
 * count that opens to them once there are more (`pullRequestsFolded`).
 */
function PullRequestList({
  groupId,
  pulls,
  open,
  onToggle,
  onOpenChange,
  run,
}: {
  /** The project whose repository they are open against, for *Review*. */
  readonly groupId: string;
  readonly pulls: ReadonlyArray<FlowPullRequest>;
  /** Their Mate's run: the changes it still writes ask for no review until it rests. */
  readonly run?: MateRunFacts | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
}) {
  const folded = pullRequestsFolded(pulls.length);
  return (
    // 2 px under its Mate's row: the changes are that Mate's, so they hang
    // on it rather than standing apart as the next Mate does.
    <div className="mt-0.5 flex flex-col" data-zerops-surface="sidebar-pull-requests">
      {folded ? (
        <button
          aria-expanded={open}
          className={FOLD_ROW_CLASS}
          data-zerops-surface="sidebar-pull-request-fold"
          onClick={onToggle}
          type="button"
        >
          <span className="flex justify-center">
            <FoldGlyph open={open} />
          </span>
          <span className="truncate">{`${String(pulls.length)} changes`}</span>
        </button>
      ) : null}
      {!folded || open ? (
        <ul className="flex flex-col">
          {pulls.map((pull) => (
            <PullRequestRow
              among={pulls}
              asks={changeShowsReview(pull, run)}
              groupId={groupId}
              key={`${pull.repository}#${pull.number}`}
              onOpenChange={onOpenChange}
              pull={pull}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One pull request: the pull-request mark in the faces' column, the number
 * and title on the words' edge — the way to the change's own page — and
 * *Review* in blue at the right edge, the one door to merging it (R1). No
 * *Merge*, no *Ask* and no check dot on the row: the outlined pill repeated
 * on every change as the menu's only outlined control, and the verdict lives
 * in the review. The mark alone may say that something is wrong (S3): amber
 * where it fell behind `main` and no longer merges (`changeMarkTone`). A person's own
 * pull request names them after the title — there is no room for a line.
 * A draft, or a change its Mate still works on, asks nothing: the row stays,
 * its title still opens it, and *Review* waits until it is described and the
 * Mate rests.
 */
function PullRequestRow({
  pull,
  among,
  asks,
  groupId,
  onOpenChange,
  whose,
}: {
  readonly whose?: string;
  readonly pull: FlowPullRequest;
  /** It asks for review: described at its head, its Mate at rest. Only then is *Review* here. */
  readonly asks: boolean;
  /** The rows drawn with it: where its opener's span repositories, each names its own. */
  readonly among: ReadonlyArray<FlowPullRequest>;
  /** The project whose repository it is open against, for *Review*. */
  readonly groupId: string;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
}) {
  const openReview = useOpenReview();
  const name = sidebarChangeLabel(pull, among);
  const label = whose === undefined ? name : `${name} · ${whose}`;
  const tone = changeMarkTone(pull);
  return (
    <li
      className="menu-line grid h-7 min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 ps-1.75 pe-1 text-line leading-4.5 transition-colors hover:bg-sidebar-row-hover"
      data-zerops-change={changeRowKey(pull)}
      data-zerops-change-tone={tone}
      data-zerops-surface="sidebar-pull-request"
    >
      <span
        className={cn(
          "flex justify-center",
          tone === "attention" ? "text-status-attention-text" : "text-muted-foreground",
        )}
      >
        <GitPullRequestIcon aria-hidden="true" className="size-3.5" />
      </span>
      {onOpenChange === undefined ? (
        <span className="min-w-0 truncate text-sidebar-foreground">{label}</span>
      ) : (
        <button
          className="min-w-0 cursor-pointer truncate rounded-sm text-left text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-zerops-surface="sidebar-pull-request-open"
          onClick={() => {
            onOpenChange(pull);
          }}
          type="button"
        >
          {label}
        </button>
      )}
      {asks ? (
        <button
          className="menu-textbtn outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-zerops-surface="sidebar-pull-request-review"
          onClick={(event) => {
            openReview(
              { kind: "change", groupId, repository: pull.repository, number: pull.number },
              { from: event.currentTarget },
            );
          }}
          type="button"
        >
          Review
        </button>
      ) : null}
    </li>
  );
}

/** A change's row, as the menu keys it and the jump box finds it: `repository#number`. */
function changeRowKey(pull: Pick<FlowPullRequest, "repository" | "number">): string {
  return `${pull.repository}#${String(pull.number)}`;
}

/**
 * A project heading's disclosure chevron: pointing right while collapsed,
 * turned a quarter down while open — a tree's own gesture, since a project
 * heading does have a level below it. Shown on hover and focus, and always
 * while collapsed, when it is the only thing saying there is more. One glyph
 * that turns (`.zerops-project-chevron`), so opening reads as one movement.
 */
function DisclosureGlyph() {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className="zerops-project-chevron size-3.5 shrink-0 text-sidebar-muted-foreground"
      data-zerops-surface="sidebar-project-chevron"
    />
  );
}

/**
 * The glyph on a row that folds a list away.
 *
 * A rotating right-chevron is a tree's disclosure triangle — it says "there is
 * a level below this". These rows have no level below them: they stand in
 * place of the rows themselves, which is a different gesture, so they wear the
 * gesture's own pair. Arrows meeting fold the list shut; arrows parting open
 * it. Nothing animates: this is pressed dozens of times a day, and a
 * transition on it only ever reads as lag.
 */
function FoldGlyph({ open }: { readonly open: boolean }) {
  const Glyph = open ? ChevronsDownUpIcon : ChevronsUpDownIcon;
  return <Glyph aria-hidden="true" className="size-3 shrink-0 text-sidebar-muted-foreground" />;
}
