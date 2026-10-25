import { KeptGitQuestions } from "./KeptGitQuestions";
import { shownCanonicalHqListNavigationAtom } from "@t3tools/client-runtime/data";
import { useAutomatedKey } from "~/zerops/useAutomationSettings";
import { useAddMateOffer, useOrgOffers } from "../../zerops/useHqOffers";
import { useDeleteApplicationDialog } from "../../zerops/deleteApplicationDialog";
import { applicationDeletionTarget } from "./ZeropsDeleteApplicationDialog.logic";
import { useNewMateGate } from "../../zerops/useNewMateGates";
import { showProjectParts } from "~/zerops/projectPartsShown";
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import { mateAdmissionSummary, type AgentAdmissionAttention } from "@t3tools/client-runtime/data";
import { useAccountOrgId, useProjection } from "../../zerops/ZeropsAccountData";
import { mateStatus } from "../../zerops/mateStatus.logic";
/**
 * The left menu's projects: each a heading, then its Mates, each with its
 * crew and its open changes.
 *
 * A project's heading is its name and its chips — one for its stage or
 * stages, one for production, each its word alone, turning amber or red when
 * something is wrong — and, while the project is folded, the faces of its
 * Mates, each in its state.
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
 * one (`MateUnit`). Its open change rides its own row: the change's mark and
 * title on its line, and *Review* — the one door to merging — in its time's
 * place where the change waits on the viewer.
 * After the Mates come those being created, and the ones untouched for a week
 * folded behind their count; the projects with no work lately fold behind
 * theirs at the list's end.
 *
 * A project collapses to its heading, the usual sidebar gesture, and the menu
 * remembers it; opening one of its Mates' conversations opens it again. A
 * reload paints what the sources say as they answer: nothing of them is kept.
 *
 * Membership is `hasMate` — the project declares a Mate or a container backs
 * one, and never stage or production — not the live connection, so a
 * container going to sleep changes a face rather than rearranging the menu.
 * Grouping is `buildCanonicalGroupTree`, the same derivation the projects screen
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
  addressOffered,
  assignCandidateMateTints,
  buildCanonicalGroupTree,
  groupFlow,
  hasMate,
  mateEnvironmentsEmptyReason,
  mateShapeOf,
  pullRequestsByMate,
  rankZeropsCandidateForListing,
  readZeropsMembership,
  selectMateEnvironments,
  sidebarChangeLabel,
  changeAsksForReview,
  changeShowsReview,
  listedStopComing,
  mateArrivingUntil,
  matePoseOf,
  projectNameInApp,
  stopServes,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type FlowPullRequest,
  type GroupFlowPreview,
  type Moved,
  type GroupFlow,
  type GroupEnvironmentTier,
  type GroupFlowStop,
  type ListedStop,
  missingEnvironmentRows,
  type StopComing,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type CanonicalGroup,
  type ZeropsGroupPendingMember,
  type ZeropsPlacedBirth,
  type ZeropsPublicRoute,
  formatRunClock,
} from "@t3tools/client-runtime/zerops";
import { birthFaceOf, hqZeropsProject } from "@t3tools/client-runtime/zerops/hq";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateIdentitiesAtom, shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { mateOwnerRecords } from "@t3tools/client-runtime/zerops/mateAccess";
import { deployActivatedAt } from "@t3tools/client-runtime/zerops/flow";
import type { KnownAffordance } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  BellOffIcon,
  BoxIcon,
  CircleAlertIcon,
  CloudOffIcon,
  EyeIcon,
  GitPullRequestIcon,
  PauseIcon,
  SquareIcon,
} from "lucide-react";
import { Atom } from "effect/reactivity";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { cn } from "~/lib/utils";
import { formatShortTimestamp, formatUpcomingTimestamp } from "~/timestampFormat";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { SidebarComingEnds } from "./SidebarComingEnds";
import { Row } from "../ui/row";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateAutomatedMark } from "./MateAutomatedMark";
import { MateOwnerMark } from "./MateOwnerMark";
import {
  activityOfNow,
  mateRunOf,
  mateAwake,
  mateBirthFace,
  mateReviewCount,
  mateReviewWaits,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { useBuildsUnderWay } from "~/zerops/ZeropsAccountData";
import { type HqOutage } from "~/zerops/hqNavigation";
import type { MateComing } from "@t3tools/client-runtime/data";
import { mateFace } from "~/zerops/mateFace.logic";
import { useMateFaceWatch } from "~/zerops/useMateMoments";
import { useStopDeploymentsShown } from "~/zerops/projectFlows";
import { useStopDeploymentDemand } from "~/zerops/accountForge";
import { findInventoryProjectRef, InventoryContext } from "~/zerops/inventoryContext";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import {
  useMateAwayNow,
  useMateOfflineSince,
  useMateLinkedInHq,
  useMateOverviewInHq,
  useMatesLinkedInHq,
} from "~/zerops/useMenuMateReadings";
import type { FixProblem } from "~/zerops/fixRequest";
import { usePendingSentAsk } from "~/zerops/sentAsk";
import { appTasksWaitingAtom, hqDown, hqPlacementsAtom } from "~/state/zerops";
import { useMateCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { mayBearHq } from "@t3tools/shared/zeropsRoles";
import { useAccountHq, useCarriedCoreBuild } from "~/zerops/accountHq";
import { ZeropsHqUpdate } from "./ZeropsHqUpdate";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import {
  projectFolded,
  readCollapsedProjects,
  readOpenedProjects,
  withProjectFold,
  writeCollapsedProjects,
  writeOpenedProjects,
  type ProjectFolds,
} from "~/zerops/collapsedProjects";
import { useMenuFolds } from "~/zerops/menuFolds";
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
import {
  SidebarCrewMinis,
  useCrewRows,
  type CrewRowFacts,
  type SidebarCrewRead,
} from "./crew/SidebarCrewMinis";
import { ProjectSites, type ProjectSitesInput, type SitesMate } from "./SidebarProjectSites";
import {
  ProjectReviewMarks,
  type ProjectReviewTags,
  changeReviewItem,
  changeRowKey,
  crewTaskReviewItem,
  type ProjectReviewItem,
} from "./SidebarProjectReview";
import { SidebarSelectedBand, slideSelectedBandTo } from "./SidebarSelectedBand";
import { Kbd } from "../ui/kbd";
import { MateFace } from "./primitives";
import { groupNameUnread } from "./ZeropsGroupTree.logic";
import { STOP_ARM_MS, stopArmStep, type StopArm, type StopArmEvent } from "./SidebarStopArm.logic";
import { useStopPress } from "~/zerops/conversationStop";
import { withStopPress } from "~/zerops/conversationStop.logic";
import {
  addressesPlace,
  projectHeadingMenu,
  sidebarMateKey,
  type HeadingMenuEntry,
} from "./SidebarZeropsTree.logic";
import {
  clusterFaces,
  groupHoldsCurrent,
  groupLead,
  groupMateOrder,
  groupRowPress,
  projectRowKey,
  projectRowKind,
} from "./SidebarProjectRow.logic";
import {
  MateMenu,
  MateRenameField,
  ProjectMenu,
  type MateRowActions,
  type MenuPoint,
} from "./SidebarMateMenu";
import { SidebarProjectFold, type ProjectFoldMotion } from "./SidebarProjectFold";
import { ProjectCluster, type ClusterFace } from "./SidebarProjectCluster";
import {
  landingAfterDraw,
  openMateReveal,
  type MateReveal,
  menuDrawsLoadingRows,
  slackAfterScroll,
  slackForFold,
  type PendingLanding,
} from "./SidebarProjects.logic";
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
  type ChipMenuModel,
  type ChipView,
  type ProductionChip,
  type ReleasesAnswer,
  type ReleaseFailure,
  type StopServing,
} from "./SidebarProductionChip.logic";
import {
  mateBornLine,
  mateBornLineText,
  mateComingRowView,
  mateLifeOf,
  mateRowOffersMenu,
  mateCrewItem,
  mateDeletingView,
  mateFinishingView,
  mateDotLabel,
  mateNotYours,
  mateOwnerView,
  mateRowAskLine,
  mateRowDraft,
  mateRowPropsEqual,
  mateRowReading,
  mateRowHeldLines,
  mateAsker,
  mateRowSecond,
  mateRowTime,
  mateAutomation,
  changeLineWords,
  tasksWaitingWords,
  pendingBornLine,
  type MateBornLine,
  type MateRowAskLine,
  type MateRowReply,
  type MateRowSecond,
  type MateRowState,
  type MateRowView as MateRowReading,
  type MateRowSlot,
  ownerBadge,
  ownerMark,
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
import { keyboardTarget, movedAnnouncement, useProjectReorder } from "./SidebarProjectReorder";
import {
  groupFlowInputOf,
  groupMemberFactsOf,
  tiersAddable,
  withoutOfficialHq,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import type { HeadingLineInput } from "./SidebarHeadingLine.logic";

const NO_ADMISSION = Atom.make<AgentAdmissionAttention | null>(null);

const menuPlacementKnownAtom = Atom.make((get) => get(hqPlacementsAtom) !== null);
const menuPersonFactsAtom = Atom.make((get) =>
  Object.fromEntries(
    Object.entries(get(shownHqPersonFactsAtom)).map(([id, fact]) => [id, { mine: fact.mine }]),
  ),
).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));
/** What the client holds per environment, when it holds anything. */
type RosterCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  /** Ports its public address would open that are not on yet; absent while its services are unread. */
  readonly routeOffers?: ReadonlyArray<unknown>;
  readonly services?: ZeropsEnvironmentServices;
};

type Entry<T> = { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined };

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

/**
 * The group of the project whose conversation is open, when it has one — a Mate still being made
 * by its birth's placement, so a new Mate's group opens around it as the listed one's does.
 */
function groupIdOf(
  candidates: ReadonlyArray<RosterCandidate>,
  projectId: string | null | undefined,
  births: ReadonlyArray<ZeropsPlacedBirth>,
): string | undefined {
  if (projectId === undefined || projectId === null) return undefined;
  const open = candidates.find((candidate) => candidate.project.id === projectId);
  if (open !== undefined) return readZeropsMembership(open.project).groupId;
  return births.find((birth) => birth.projectId === projectId)?.placement.groupId;
}

/**
 * One project's flow as `groupFlowInputOf` reads it — the projects page's
 * own input — from what the menu holds. Only whether a release is offered
 * reaches this menu, not the gate's reason; `groupFlow` decides on the
 * former alone. The release on its way does, so production says it.
 */
function groupFlowReadsOf(flow: SidebarProjectFlow): GroupFlowReads {
  return {
    mateTier: flow.mateTier,
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
  readonly repos?: ReadonlyArray<import("@t3tools/shared/hqChanges").RepoListEntry> | undefined;
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
  /** The Mate tier as `main` holds it, which pairs each Mate's previews (`servicePairs`). */
  readonly mateTier?: string | undefined;
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
  /** HQ's roll backs, by the tag each made: the release it goes back to (`rollbacksOf`). */
  readonly releaseRollbacks?: ReadonlyMap<string, string> | undefined;
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
  /** Asks for automated Mates in a project (`useAddAutomatedMates`); absent where HQ makes none. */
  readonly onAddAutomatedMates?: ((groupId: string) => void) | undefined;
  /** Opens the invitation with this project picked; absent for someone who may not invite. */
  readonly onInvite?: ((groupId: string) => void) | undefined;
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
   * The route names a Mate whose row is not found yet (its listing still read): the open Mate is
   * unknown, not none. A reload's open Mate found late is still the one it opened on.
   */
  readonly activeProjectResolving?: boolean | undefined;
  /**
   * The open conversation as the route names it, whether or not its Mate is found: what a reload
   * opened on is never scrolled to; one opened afterwards is, once (`openMateReveal`).
   */
  readonly activeConversation?: string | null | undefined;
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
  /**
   * The menu holds the rows in the loading rows' place until what waits on the viewer is read
   * with them, so the Waiting on you row and the rows come in one frame (`Sidebar`).
   */
  readonly hold?: boolean;
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
   * Lists every Mate again — the account menu's *Everyone* — from the line that says how many
   * *Mine* hides. Absent, the line is not drawn.
   */
  readonly onShowEveryone?: (() => void) | undefined;
  /**
   * A Mate's crew as a fixture draws it (a harness): its crew line, and
   * whether its menu offers *Set up a crew* or *Crew*. Absent, each Mate's
   * crew line and menu read its crew from HQ (`useMateCrew`).
   */
  readonly getCrew?: ((candidate: T) => SidebarCrewRead | undefined) | undefined;
}

const ignoreUpdateState = (_state: boolean) => {};

/**
 * Memoised: the menu above it redraws on every event of a streaming Mate's chat, and its props —
 * the Mates, their activity, the verbs — stand while what they say does.
 */
/** A Mate without an app: one list, so its row keeps its identity across renders. */
const NO_APPS: ReadonlyArray<GroupFlowPreview> = [];
/** A project whose ··· has nothing of its own yet. */
const NO_MENU: ReadonlyArray<HeadingMenuEntry> = [];
/** A place's menu where the project has lost the place since its row was drawn. */
const NO_PLACES: ChipMenuModel = { stops: [] };

/**
 * One project as the menu plans it before drawing: the Mates it draws as rows, top to bottom (for
 * ⌥1–9), every Mate of its in its rows' order (for "the next one that waits"), whether it folds
 * (a group), and its rows.
 */
interface ProjectPlan {
  readonly drawn: ReadonlyArray<string>;
  readonly order: ReadonlyArray<string>;
  readonly folds: boolean;
  readonly render: () => ReactNode;
}

/** A project's verbs and readings as the newest draw made them. */
interface ProjectLatest {
  readonly out: () => void;
  readonly drag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly menu: () => ReadonlyArray<HeadingMenuEntry>;
  readonly production: ((nowMs: number) => ChipMenuModel) | undefined;
  readonly stages: ((nowMs: number) => ChipMenuModel) | undefined;
  readonly openStop: (projectId: string) => (() => void) | undefined;
  /** The project's own page. */
  readonly openPage: () => void;
}

/** A project's verbs as its rows hold them: one function each, for as long as it is drawn. */
interface ProjectRefs {
  readonly out: () => void;
  readonly drag: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly menu: () => ReadonlyArray<HeadingMenuEntry>;
  readonly production: (nowMs: number) => ChipMenuModel;
  readonly stages: (nowMs: number) => ChipMenuModel;
  readonly openStop: (projectId: string) => (() => void) | undefined;
  /** The project's own page. */
  readonly openPage: () => void;
}

/** What a project's rows were last handed, kept while it reads the same. */
interface ProjectShared {
  /** Its Mates' Zerops projects, which the conversation's header finds its parts by. */
  readonly mateIds: ReadonlyArray<string>;
  readonly review: ProjectReviewData | undefined;
  readonly sitesRead:
    | {
        readonly projectName: string;
        readonly mates: ReadonlyArray<SitesMate>;
        readonly prodChip: ProductionChip | undefined;
        readonly stageChip: ProductionChip | undefined;
        readonly line: HeadingLineInput | undefined;
        readonly production: boolean;
        readonly stages: boolean;
      }
    | undefined;
  readonly sites: ProjectSitesInput | undefined;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
}

export const SidebarZeropsTree = memo(SidebarZeropsTreeView) as typeof SidebarZeropsTreeView;

function SidebarZeropsTreeView<T extends RosterCandidate>({
  candidates,
  onSelect,
  onAddMate,
  onAddAutomatedMates,
  onInvite,
  onSetUp,
  getComing,
  onOpenComing,
  onBrowseProjects,
  onAskToFix,
  onOpenGroup,
  activeProjectId,
  activeProjectResolving = false,
  activeConversation,
  getActivity,
  keyedReadings = false,
  getConversationsRead,
  getOwner,
  getFlow,
  complete,
  notice = null,
  reading = false,
  hold = false,
  onNoticeAct,
  className,
  births = NO_BIRTHS,
  timestampFormat = "locale",
  getMateActions,
  onOpenCrew,
  shown,
  onShowEveryone,
  getCrew,
}: SidebarZeropsTreeProps<T>) {
  const structureView = useAtomValue(shownCanonicalHqListNavigationAtom);
  const identities = useAtomValue(shownHqMateIdentitiesAtom);
  const session = useZeropsSessionOptional();
  const accountHq = useAccountHq(structureView.orgId ?? undefined);
  const accountOrgId = useAccountOrgId();
  const carried = useCarriedCoreBuild();
  // HQ's update deploys to its own Zerops project; an HQ every organization shares has none here.
  const hqProject = hqZeropsProject(accountHq.hq);
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
  // HQ's own project is never a project to set a Mate up in: an organization holding only HQ has
  // no project yet, and its one way on is New project, not "Set up Mate".
  const emptyReason = candidates.some((candidate) => candidate.project.hq !== undefined)
    ? undefined
    : mateEnvironmentsEmptyReason(withoutOfficialHq(candidates, accountHq.hq));
  const hqMates = useMatesLinkedInHq();
  // Which projects a build or deploy runs on now, as Zerops says: the headings' indicator.
  const building = useBuildsUnderWay(
    useMemo(() => candidates.map((candidate) => candidate.project.id), [candidates]),
  );
  // Collapsed projects survive a reload: a person who collapsed one had a
  // reason, and a menu that expands everything on every boot makes them do it
  // again (the owner, 2026-09-19). Per account, so it never leaves the device.
  // Past five projects each starts folded, its one line, until its person opens it
  // (`projectFolded`, the owner, 2026-10-11): what they opened or folded is kept.
  const [projectFolds, setProjectFolds] = useState<ProjectFolds>(() => ({
    closed: readCollapsedProjects(),
    opened: readOpenedProjects(),
  }));
  useEffect(() => {
    writeCollapsedProjects(projectFolds.closed);
    writeOpenedProjects(projectFolds.opened);
  }, [projectFolds]);
  // The closed menu's rail stands its groups as these do, and folds them through this
  // (`menuFolds.ts`): before the frame paints, so the rail never shows a fold the menu left.
  const foldFromRail = useCallback((groupId: string, open: boolean) => {
    setProjectFolds((current) => withProjectFold(current, groupId, !open));
  }, []);
  useLayoutEffect(() => {
    useMenuFolds.getState().lend(projectFolds, foldFromRail);
  }, [foldFromRail, projectFolds]);
  useLayoutEffect(() => () => useMenuFolds.getState().withdraw(), []);
  // Opening a Mate's conversation opens its project: the row lit as the one
  // open may not be hidden under a heading. Only when the open conversation
  // changes — a person may collapse the project again afterwards, and a menu
  // that forced it open on every render would not let them. Nothing seen yet
  // at mount: a reload on a Mate's conversation opens its project too.
  const activeGroupId = groupIdOf(candidates, activeProjectId, births);
  const [seenGroupId, setSeenGroupId] = useState<string | undefined>(undefined);
  if (seenGroupId !== activeGroupId) {
    setSeenGroupId(activeGroupId);
    if (activeGroupId !== undefined) {
      setProjectFolds(withProjectFold(projectFolds, activeGroupId, false));
    }
  }
  // Same preference the projects screen's sort control and the account menu
  // write (`projectOrderPreference.ts`) — read here too so the surfaces stay
  // in step without either one owning the other. In *Custom* the headings
  // take a grip, and every heading's menu moves its project up or down.
  const projectOrder = useProjectOrder();
  // Only the Mates HQ says wait on the viewer wait on them (`waitsOnViewer`).
  const waitsOnViewer = useWaitsOnViewer();
  // Every listed Mate's crew, read once for the whole menu (`useCrewRows`): its mini Mates, what
  // it needs of the viewer, and the work it has ready for their Land.
  const crewMates = useMemo(
    () =>
      candidates.filter(hasMate).map((item) => ({
        projectId: item.project.id,
        mine: waitsOnViewer(item.project.id),
        read: getCrew?.(item),
      })),
    [candidates, waitsOnViewer, getCrew],
  );
  const crewRows = useCrewRows(crewMates);
  // What each project's rows are handed (`ProjectRefs`): the same functions from draw to draw,
  // reading the newest draw's closures, and the same review and places while what they say holds.
  const projectLatest = useRef(new Map<string, ProjectLatest>()).current;
  const projectRefs = useRef(new Map<string, ProjectRefs>()).current;
  const projectShared = useRef(new Map<string, ProjectShared>()).current;
  // The header's Sites and Review open what a row's globe and Review tag open (`projectPartsShown`):
  // handed over before paint, so the header gains them in the frame the menu draws them.
  useLayoutEffect(() => {
    showProjectParts(projectShared.values());
  });
  const projectRefsOf = (id: string): ProjectRefs => {
    const kept = projectRefs.get(id);
    if (kept !== undefined) return kept;
    const latest = () => projectLatest.get(id);
    const made: ProjectRefs = {
      out: () => {
        latest()?.out();
      },
      drag: (event) => {
        latest()?.drag(event);
      },
      menu: () => latest()?.menu() ?? NO_MENU,
      production: (nowMs) => latest()?.production?.(nowMs) ?? NO_PLACES,
      stages: (nowMs) => latest()?.stages?.(nowMs) ?? NO_PLACES,
      openStop: (projectId) => latest()?.openStop(projectId),
      openPage: () => {
        latest()?.openPage();
      },
    };
    projectRefs.set(id, made);
    return made;
  };
  // Whether *Add stage* and *Put it live* stand in a project's menu: HQ's offer of each.
  const environmentOffers = useEnvironmentOffers();
  const addMateOffer = useAddMateOffer();
  const orgOffer = useOrgOffers();
  const addMateGate = useNewMateGate();
  const treeRef = useRef<HTMLElement>(null);
  const reorder = useProjectReorder(treeRef);
  // A Mate opened from elsewhere — Add landing on the new Mate, a link, a
  // page — stands in view in the menu: its row scrolled to the nearest edge
  // once it is drawn (a new Mate's row comes a moment after its view, so every
  // draw looks until it is there), once. Not the conversation open at mount,
  // even found late: a reload leaves the menu where it was (`openMateReveal`).
  const shownActiveRef = useRef<MateReveal | undefined>(undefined);
  useEffect(() => {
    const conversation = activeConversation ?? null;
    const next = openMateReveal({
      seen: shownActiveRef.current,
      conversation,
      open: activeProjectId ?? null,
      resolving: activeProjectResolving,
    });
    shownActiveRef.current = next.seen;
    if (next.reveal === undefined) return;
    const row = treeRef.current?.querySelector<HTMLElement>(
      `[data-zerops-mate-row="${CSS.escape(next.reveal)}"]`,
    );
    if (row == null) return;
    shownActiveRef.current = { conversation, shown: next.reveal, owed: false };
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  });
  // What closes a stage's coming-up and first-deploy windows: the shared minute clock, so the
  // menu and the projects page close them together (no request of its own).
  const minuteMs = useNowMs();
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
      target.kind === "mate" ? groupIdOf(candidates, target.projectId, births) : target.groupId;
    if (groupId !== undefined && target.kind !== "stop") {
      setProjectFolds((current) => withProjectFold(current, groupId, false));
    }
    focusAfterDraw.current = { target, drawn: false };
    setRevealDraw((draws) => draws + 1);
  }, [births, candidates, revealing]);
  useEffect(() => {
    const { land, next } = landingAfterDraw(focusAfterDraw.current);
    focusAfterDraw.current = next;
    if (land === undefined) return;
    const landing = revealLanding(treeRef.current, land);
    if (landing === null) {
      // A change no row holds — a draft, one its Mate still works on: its own page.
      if (land.kind !== "change") return;
      const flow = getFlow?.(land.groupId);
      const pull = flow?.pullRequests.find((entry) => changeRowKey(entry) === land.key);
      if (pull !== undefined) flow?.onOpenChange?.(pull);
      return;
    }
    focusOnceFree(landing.focus, () => {
      landing.flash.scrollIntoView({ block: "nearest" });
      flashOnce(landing.flash);
      landing.press?.click();
      if (landing.within !== undefined) landWithin(landing.within);
    });
  });
  // The list's keys that belong to no one row: Option shows the numbers and
  // ⌥1–9 opens that Mate; j or k with nothing focused starts at the Mate in
  // view. Never while somebody types into a field.
  const mateRows = () =>
    Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]') ?? [],
    );
  // ↓ j and ↑ k over every row drawn — projects' and the Mates' under them — the same object from
  // draw to draw: every memoised row is handed it.
  const [mateKeys] = useState<MateRowKeys>(() => ({
    move: (from, direction) => {
      const rows = Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>("[data-zerops-row]") ?? [],
      );
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
        typedIntoField(event.target) ||
        // Waiting under the closed menu's rail, the rows are not the keyboard's.
        !sidebarMenuShown()
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

  // A Mate being created is one to draw, whatever the listing holds yet. A project's open
  // changes alone are drawn only once the listing is complete: before, its Mates are still read,
  // and a reload would paint them as "Review" rows the Mates' menu then replaces.
  const nothing =
    (complete && appsWithWork.length > 0) || births.some((birth) => birth.placement.kind === "mate")
      ? undefined
      : emptyReason;

  // Nothing to draw, and the listing may not say "none" yet: its notice, at
  // the menu's own left edge, never an empty state it has not earned.
  if (menuDrawsLoadingRows({ candidates, births, complete, reading, notice })) {
    return <MenuSkeleton className={className} />;
  }
  if (nothing !== undefined && !complete) {
    if (notice !== null)
      return <ListingNotice className={className} notice={notice} onAct={onNoticeAct} />;
    return null;
  }
  // Its rows wait in the loading rows' place while the menu holds them (`hold`).
  if (hold) return <MenuSkeleton className={className} />;

  // No project at all: nothing to list, and nothing to say — the one thing to
  // do is *New project*, the top row's +.
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
  const view = buildCanonicalGroupTree(everyEnvironment, {
    apps: appsWithWork,
    rank: rankZeropsCandidateForListing,
    order: projectOrder.order,
    ...(projectOrder.customOrder === undefined ? {} : { customOrder: projectOrder.customOrder }),
    births,
  });
  // One list in the person's order (Name, Creation date or Custom): no project moves for its work,
  // and none rests apart as an "other" (the owner, 2026-10-11, of the "other projects" fold: "I'd
  // get rid of" it). The overview's cards stand in the same order.
  const orderedGroups = view.groups.map((entry) => ({
    ...entry,
    environments: entry.environments.flatMap(({ item, role }) =>
      item === undefined ? [] : [{ item, role }],
    ),
  }));
  // Every project the order holds, drawn or not: what a move is written into,
  // and what choosing *Custom* elsewhere starts from.
  const onScreen = orderedGroups.map(({ group }) => group.groupId);
  rememberProjectsOnScreen(onScreen);
  const tints = assignCandidateMateTints(candidates);
  /** A Mate's face: its tint, and the shape its person picked or that tint's own. */
  const faceOf = (project: ZeropsCandidate["project"]) => {
    const identity = identities[project.id];
    if (identity !== undefined) return { tint: identity.tint, shape: identity.shape };
    // Before HQ records it: the face picked at its Add — this tab's press, else its open birth.
    const picked =
      births.find((birth) => birth.projectId === project.id)?.placement.face ??
      birthFaceOf(structureView.structure, project.id);
    if (picked !== undefined) return picked;
    const tint = tints.get(project.id) ?? "slate";
    return { tint, shape: mateShapeOf(project, tint) };
  };

  // What the jump box finds, gathered as each project is read (`indexSection`):
  // data only, in the menu's own order — what the box does with a find is its
  // own.
  const jumpMates: JumpMate[] = [];
  const jumpProjects: JumpProject[] = [];
  const jumpChanges: JumpChange[] = [];
  const jumpStops: JumpStop[] = [];
  const indexSection = (input: {
    readonly id: string;
    readonly group: CanonicalGroup | undefined;
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
   * A project as the menu's unit (the owner, 2026-10-12: "the unit would be project, but one mate =
   * project would look like a mate named with project and name and when more it would be project
   * and it would expand instead of going to detail"): one Mate is its row, "Project · Mate";
   * several are one row with their faces together, open under it once pressed; none, the project
   * alone. Its places, its changes and its release ride its row. Nothing when nobody lives in it.
   */
  const section = (
    id: string,
    entries: ReadonlyArray<Entry<T>>,
    flow: SidebarProjectFlow | undefined,
    groupName: string | undefined,
    // `undefined` for Mates in no project, each its own row.
    group: CanonicalGroup | undefined,
  ): ProjectPlan | null => {
    const everyMate = entries.filter(({ item }) => hasMate(item));
    // Whose Mates the viewer asked to see (Mine / Everyone).
    const mateEntries = everyMate.filter(({ item }) => shown?.(item) ?? true);
    // Its Mates being created — the viewer's own — after their listed ones: the listing holds none yet.
    const coming = group?.pending.filter((member) => member.kind === "mate") ?? [];
    const mateCount = mateEntries.length + coming.length;
    if (mateCount === 0 && (group === undefined || everyMate.length > 0)) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    // The one derivation the projects page draws from too (`groupFlow.ts`), fed through the page's
    // own input (`groupFlowInputOf`): read once here, so what this row says of the project's
    // changes and places can never disagree with what the page says of the same project.
    //
    // Read whether or not HQ is: what a stop runs, and whether it serves, is the platform's
    // answer, and the places say that much either way.
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
    // Production and its stages are the project's places: its globe opens them, with every
    // address its Mates have, and what goes wrong with them rises to its row (`ProjectSites`).
    const targetProjectId = (id: string) => {
      const row = flow?.environments.get(id);
      return row === undefined
        ? others.find(({ item }) => item.project.id === id)?.item.project.id
        : row.target.kind === "zerops"
          ? row.target.projectId
          : undefined;
    };
    const stopDeployments = (id: string) => {
      const projectId = targetProjectId(id);
      return projectId === undefined ? undefined : deployments?.get(projectId);
    };
    const stopItem = (projectId: string | undefined) =>
      projectId === undefined
        ? undefined
        : others.find(({ item }) => item.project.id === targetProjectId(projectId))?.item;
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
    // Until HQ's releases are read, a place is only what the platform alone says: partial.
    const releases: ReleasesAnswer =
      flow !== undefined && flow.releasesKnown !== false
        ? { kind: "answered", failure: flow.releaseFailure, rollbacks: flow.releaseRollbacks }
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
          : buildingOf(stopDeployments(productionStop.projectId)),
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
    // Each stage as a place of its own says it: its dot and words in the jump box, its section in
    // the globe's popover.
    const stageChips = stages.map(({ stop, serving }) =>
      shownChip(stageStopChip({ stop, serving, releases })),
    );
    const stopDeployedAt = (projectId: string) => {
      const activated = deployActivatedAt(stopDeployments(projectId));
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
    const projectName = groupName ?? group?.name ?? "";
    // The jump box finds each place, by its name under its project and by the project's, with the
    // dot and words its section gives it: a find lands on the project's globe.
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
    // Whether a Mate's own change waits on the person's review — the composer's top's own rule
    // (`mateNextStep`), on the flow HQ told: its face wears needs-you for it.
    const reviewWaits = (item: T) => mateReviewWaits(flow, item.project.id);
    // How many of its changes wait so: an automated Mate's line says how many where several do.
    const inReview = (item: T) => mateReviewCount(flow, item.project.id);
    // What its places are doing, as the globe's tag says it (D′): an environment coming up step by
    // step, what landed, a deploy under way — from what the platform says of it (`stopComing`).
    const listedOf = (stop: GroupFlowStop): ListedStop => {
      const item = stopItem(stop.projectId);
      return {
        stop,
        projectStatus: item?.project.status,
        services: item?.services?.statuses,
        building: buildingOf(stopDeployments(stop.projectId)) !== undefined,
        routes: item?.routes?.length ?? 0,
        addressOffered: item === undefined ? undefined : addressOffered(item),
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
                    git: productionStop?.git,
                    coming:
                      projectFlow.production.kind === "creating"
                        ? PENDING
                        : productionStop === undefined
                          ? undefined
                          : productionStop.git === undefined
                            ? comingOf("production", productionStop)
                            : undefined,
                    building:
                      productionStop !== undefined &&
                      building.has(targetProjectId(productionStop.projectId) ?? ""),
                  },
            stages: [
              ...stages.map(({ name, stop }) => ({
                projectId: stop.projectId,
                name,
                git: stop.git,
                coming: stop.git === undefined ? comingOf("stage", stop) : undefined,
                serves: stopServes(listedOf(stop)),
                building: building.has(targetProjectId(stop.projectId) ?? ""),
              })),
              ...projectFlow.creatingStages.map((creation) => ({
                projectId: creation.projectId,
                name: creation.name,
                coming: PENDING,
                serves: false,
                building: false,
              })),
            ],
          };
    // The open changes: HQ's once it told them.
    const changesKnown = flow !== undefined && flow.changesKnown !== false;
    const flowPulls = changesKnown ? projectFlow.pullRequests.map((entry) => entry.pull) : [];
    // By every Mate, shown or not: a hidden Mate's change is still its own.
    const grouped = pullRequestsByMate(
      flowPulls,
      everyMate.map(({ item }) => item.project.id),
    );
    // What the jump box finds here, drawn or folded: a jump opens the project.
    indexSection({
      id,
      group,
      groupName,
      flow,
      mateEntries,
      grouped,
      changesDrawn: changesKnown,
      stops: jumpStopsHere,
    });
    // Its Mates in the order its open rows stand (`groupMateOrder`): the viewer's first, then
    // colleagues', each in the order made — never by what they did.
    const mine = (item: T) =>
      personFacts[item.project.id]?.mine ?? getOwner?.(item)?.isViewer ?? true;
    const ordered = groupMateOrder(
      mateEntries.map(({ item }) => ({
        projectId: item.project.id,
        mine: mine(item),
        createdAt: item.project.created,
        name: projectNameInApp(item.project),
        item,
      })),
    );
    const kind = projectRowKind({ mates: mateCount });
    // A group's fold, from its row's press, its keys or its menu: its Mates unfold under it or
    // fold away.
    const toggle = (opening: boolean) => {
      if (!opening) {
        const scroller = scrollingAncestor(treeRef.current);
        const rows = treeRef.current?.querySelector<HTMLElement>(
          `[data-zerops-group="${CSS.escape(id)}"] [data-zerops-surface="sidebar-project-rows"]`,
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
              rows.getBoundingClientRect().height,
            ),
          );
        }
      }
      setProjectFolds((folded) => withProjectFold(folded, id, !opening));
      setFolds((moving) => new Map(moving).set(id, opening ? "opening" : "closing"));
    };
    // The project's own verbs, on its row's ··· — first in a single Mate's, read as it draws. A
    // group's Fold or Unfold folds alone: it opens no Mate, as the row's press may.
    const projectMenu = () =>
      group === undefined
        ? NO_MENU
        : projectMenuOf(
            group,
            kind === "group"
              ? {
                  open: !collapsed.has(id),
                  toggle: () => {
                    toggle(collapsed.has(id));
                  },
                }
              : undefined,
            addressesPlace({
              production: productionItem?.project.id,
              stages: stages.map(({ stop }) => targetProjectId(stop.projectId)),
              mates: ordered.map(({ item }) => item.project.id),
            }),
            kind === "bare",
          );
    const demand =
      group === undefined
        ? null
        : [
            ...stages.map(({ stop }) => stop.projectId),
            ...(productionStop === undefined ? [] : [productionStop.projectId]),
          ].map((projectId) => <StopDemand key={projectId} projectId={projectId} />);
    // What waits for the viewer's review, oldest first as the flow lists it: each shown Mate's
    // change that asks, each change of no Mate here that asks, then the work its crews have ready
    // for the viewer's Land. A change whose Mate still works asks for no review yet
    // (`changeShowsReview`) but stays marked, in progress, so it is always findable (Eli,
    // 2026-10-14: "why is MR not showing up anywhere"). A hidden Mate's change is drawn nowhere,
    // as the jump box finds it nowhere.
    const inProgress = new Set<FlowPullRequest>();
    const asking = new Set([
      ...ordered.flatMap(({ item }) => {
        const run = mateRunOf(activityOfNow(getActivity?.(item)));
        return (grouped.byMate.get(item.project.id) ?? []).filter((pull) => {
          if (!changeAsksForReview(pull)) return false;
          if (!changeShowsReview(pull, run)) inProgress.add(pull);
          return true;
        });
      }),
      ...grouped.others.filter((pull) => changeAsksForReview(pull)),
    ]);
    const byOf = (item: T): ProjectReviewItem["by"] => {
      const owner = getOwner?.(item);
      const colleague = owner !== undefined && !owner.isViewer ? owner : undefined;
      return {
        name: projectNameInApp(item.project),
        ...faceOf(item.project),
        ownerFirstName: colleague?.name.split(" ")[0],
        owner: colleague === undefined ? undefined : ownerMark(colleague),
      };
    };
    const reviewItems: ReadonlyArray<ProjectReviewItem> = [
      ...flowPulls
        .filter((pull) => asking.has(pull))
        .map((pull) => {
          const entry = ordered.find((candidate) => candidate.projectId === pull.mateProjectId);
          const change = changeReviewItem({
            pull,
            among: flowPulls,
            groupId: id,
            by: entry === undefined ? undefined : byOf(entry.item),
            // Whose review it waits on, as the menu's Mine holds it: unknown reads as theirs.
            mine: entry === undefined || entry.mine,
          });
          return inProgress.has(pull) ? { ...change, inProgress: true as const } : change;
        }),
      ...ordered.flatMap(({ item, projectId, mine: own }) =>
        (crewRows.get(projectId)?.reviews ?? []).map((review) =>
          crewTaskReviewItem({
            environmentId: review.target.environmentId,
            taskId: review.target.taskId,
            title: review.title,
            by: {
              name: review.crewmate.name,
              tint: review.crewmate.tint,
              shape: review.crewmate.shape,
              crewOf: projectNameInApp(item.project),
            },
            mine: own,
            mateProjectId: projectId,
          }),
        ),
      ),
    ];
    // Its places — production, its stages, and every address each of its Mates has — behind the
    // globe; what goes wrong with them, or comes up, as the tag beside its changes (`ProjectSites`).
    const everyOrdered = groupMateOrder(
      everyMate.map(({ item }) => ({
        projectId: item.project.id,
        mine: mine(item),
        createdAt: item.project.created,
        name: projectNameInApp(item.project),
        item,
      })),
    );
    const production =
      prodChip === undefined
        ? undefined
        : (nowMs: number) =>
            productionMenu({
              chip: prodChip,
              projectId: productionItem?.project.id,
              environmentId: productionStop?.projectId,
              git:
                productionStop?.git === undefined
                  ? undefined
                  : {
                      delivery: productionStop.git,
                      environment: (() => {
                        const row = flow?.environments.get(productionStop.projectId);
                        return row?.target.kind === "git"
                          ? { target: row.target, tier: row.tier }
                          : undefined;
                      })(),
                      repos: flow?.repos,
                    },
              failure: releases.kind === "answered" ? releases.failure : undefined,
              down: downOf(productionServing),
              routes: productionItem?.routes ?? [],
              nowMs,
            });
    const stagesMenu =
      stages.length === 0 && projectFlow.creatingStages.length === 0
        ? undefined
        : (nowMs: number) =>
            stageMenu({
              stages: stages.map(({ name, stop, serving }, index) => ({
                projectId: stop.projectId,
                name,
                stop,
                git:
                  stop.git === undefined
                    ? undefined
                    : {
                        delivery: stop.git,
                        environment: (() => {
                          const row = flow?.environments.get(stop.projectId);
                          return row?.target.kind === "git"
                            ? { target: row.target, tier: row.tier }
                            : undefined;
                        })(),
                        repos: flow?.repos,
                      },
                chip: stageChips[index],
                deployedAt: stopDeployedAt(stop.projectId),
                down: downOf(serving),
                routes: stopItem(stop.projectId)?.routes ?? [],
              })),
              creating: projectFlow.creatingStages.map((creation) => ({
                projectId: creation.projectId,
                name: creation.name,
              })),
              nowMs,
            });
    const dragOf =
      group === undefined || projectOrder.order !== "custom"
        ? undefined
        : (event: ReactPointerEvent<HTMLElement>) => {
            reorder.startDrag({ groupId: id, name: group.name }, event, (groupId, before) => {
              moveProject(groupId, before, group.name);
            });
          };
    // What the project's rows are handed: the same functions from draw to draw, reading this
    // draw's closures, and the same review and places while what they say holds — a memoised
    // row redraws for its own news alone.
    const refs = projectRefsOf(id);
    projectLatest.set(id, {
      out: () => {
        focusProjectRow(id);
      },
      drag: (event) => {
        dragOf?.(event);
      },
      menu: projectMenu,
      production,
      stages: stagesMenu,
      openStop,
      openPage: () => {
        (onOpenGroup === undefined ? onBrowseProjects : () => onOpenGroup(id))();
      },
    });
    const held = projectShared.get(id);
    const review: ProjectReviewData | undefined =
      group === undefined
        ? undefined
        : shareEqual(held?.review, {
            groupId: id,
            projectName,
            items: reviewItems,
            release:
              flow?.releaseOffered === true
                ? {
                    waiting: projectFlow.main.notLive,
                    atLeast: projectFlow.main.notLiveAtLeast,
                  }
                : undefined,
          });
    const sitesRead =
      group === undefined
        ? undefined
        : shareEqual(held?.sitesRead, {
            projectName,
            mates: everyOrdered.map(({ item, name }) => ({
              candidate: item,
              ...faceOf(item.project),
              mine: personFacts[item.project.id]?.mine,
              threadKey: getActivity?.(item)?.threadKey,
              name,
              owner: getOwner?.(item),
            })),
            prodChip,
            stageChip: stageChipDrawn,
            line,
            production: production !== undefined,
            stages: stagesMenu !== undefined,
          });
    const sites: ProjectSitesInput | undefined =
      sitesRead === undefined
        ? undefined
        : held?.sites !== undefined &&
            held.sitesRead === sitesRead &&
            held.onAskToFix === onAskToFix
          ? held.sites
          : {
              groupId: id,
              projectName: sitesRead.projectName,
              production: sitesRead.production ? refs.production : undefined,
              stages: sitesRead.stages ? refs.stages : undefined,
              mates: sitesRead.mates,
              prodChip: sitesRead.prodChip,
              stageChip: sitesRead.stageChip,
              line: sitesRead.line,
              onAskToFix,
              onOpenStop: refs.openStop,
              onOpenPage: refs.openPage,
            };
    const mateIds = everyOrdered.map(({ item }) => item.project.id);
    projectShared.set(id, {
      mateIds: shareEqual(held?.mateIds, mateIds) ?? mateIds,
      review,
      sitesRead,
      sites,
      onAskToFix,
    });
    // One Mate's row, as its project's (solo), under its open group (kid), or in no project.
    const mateRow = (item: T, at: "solo" | "kid" | "alone") => {
      const active = item.project.id === activeProjectId;
      const apps =
        projectFlow.mates.find((mate) => mate.projectId === item.project.id)?.previews ?? NO_APPS;
      const number = numbers.get(item.project.id);
      return (
        <MateUnit active={active} key={item.key} projectId={item.project.id}>
          <MateRow
            keyedReadings={keyedReadings}
            actions={getMateActions?.(item, getActivity?.(item))}
            active={active}
            activity={keyedReadings ? undefined : getActivity?.(item)}
            up={mateAwake(item, hqMates)}
            apps={apps}
            candidate={item}
            coming={getComing?.(item)}
            conversationsRead={getConversationsRead?.(item) === true}
            crew={getCrew?.(item)}
            crewFacts={crewRows.get(item.project.id)}
            onOpenCrew={onOpenCrew}
            keys={mateKeys}
            kid={at === "kid"}
            number={number !== undefined && number <= 9 ? number : undefined}
            numbers={altHeld}
            onDragStart={at === "solo" && dragOf !== undefined ? refs.drag : undefined}
            onOut={at === "kid" ? refs.out : undefined}
            onSelect={onSelect}
            owner={keyedReadings ? undefined : getOwner?.(item)}
            project={at === "solo" ? projectName : undefined}
            projectMenu={at === "solo" ? refs.menu : undefined}
            review={at === "solo" ? review : undefined}
            reviewWaits={reviewWaits(item)}
            inReview={inReview(item)}
            sites={at === "solo" ? sites : undefined}
            timestampFormat={timestampFormat}
            {...faceOf(item.project)}
          />
        </MateUnit>
      );
    };
    const comingRow = (member: ZeropsGroupPendingMember, at: "solo" | "kid") => {
      const active = member.projectId === activeProjectId;
      return (
        <MateUnit active={active} key={`coming:${member.projectId}`} projectId={member.projectId}>
          <ComingMateRow
            active={active}
            coming={member}
            kid={at === "kid"}
            name={member.name}
            onOpen={onOpenComing}
            project={at === "solo" ? projectName : undefined}
          />
        </MateUnit>
      );
    };
    // Every Mate of its, as "the next one that waits" walks them: in its rows' order.
    const order = ordered.map((entry) => entry.projectId);

    if (group === undefined) {
      // Mates in no project: each its own row, its name alone.
      return {
        drawn: order,
        order,
        folds: false,
        render: () => <>{ordered.map(({ item }) => mateRow(item, "alone"))}</>,
      };
    }
    if (kind === "solo") {
      const only = ordered[0];
      return {
        drawn: only === undefined ? [] : [only.projectId],
        order,
        folds: false,
        render: () => (
          <RowMarks.Provider
            value={{
              review,
              mates: only === undefined ? NO_MATES : new Set([only.projectId]),
            }}
          >
            {demand}
            {only === undefined
              ? coming[0] === undefined
                ? null
                : comingRow(coming[0], "solo")
              : mateRow(only.item, "solo")}
          </RowMarks.Provider>
        ),
      };
    }
    if (kind === "bare") {
      return {
        drawn: [],
        order,
        folds: false,
        render: () => (
          <RowMarks.Provider value={{ review, mates: NO_MATES }}>
            {demand}
            <ProjectBareRow
              groupId={id}
              keys={mateKeys}
              menu={projectMenu()}
              name={projectName}
              onDragStart={dragOf}
              onOpen={() => {
                (onOpenGroup === undefined ? onBrowseProjects : () => onOpenGroup(id))();
              }}
              review={review}
              sites={sites}
            />
          </RowMarks.Provider>
        ),
      };
    }
    // A group: its row, then its Mates under it while it stands open.
    const open = !collapsed.has(id);
    const fold = folds.get(id);
    const readings = ordered.map(({ item }) => {
      const live = getActivity?.(item);
      const asks =
        live !== undefined &&
        (live.kind === "approval" || live.kind === "input" || live.kind === "planReady") &&
        waitsOnViewer(item.project.id);
      return {
        projectId: item.project.id,
        // Its own question, or its crew's — never work waiting to land, which Review holds.
        asksViewer: asks || crewRows.get(item.project.id)?.need?.kind === "ask",
        at: live?.at,
        working: live?.kind === "working",
        runSince: live?.runSince,
        // An automated Mate waiting for a task never outranks another Mate's news.
        waitsForTask:
          live?.kind !== "working" && mateAutomation(item.project.hq?.mate)?.task === null,
      };
    });
    const { lead, asks } = groupLead(readings);
    const leadEntry = ordered.find((entry) => entry.projectId === lead);
    const cluster = clusterFaces(
      [...ordered.map((entry) => entry.projectId), ...coming.map((member) => member.projectId)],
      lead,
    );
    const faces: ReadonlyArray<ClusterFace> = cluster.shown.flatMap((projectId) => {
      const entry = ordered.find((candidate) => candidate.projectId === projectId);
      if (entry === undefined) {
        const member = coming.find((candidate) => candidate.projectId === projectId);
        if (member === undefined) return [];
        const tint = member.face?.tint ?? "slate";
        return [
          {
            projectId,
            name: member.name,
            tint,
            shape: member.face?.shape ?? mateShapeOf(undefined, tint),
            state: mateBirthFace(member.failed === true),
            known: true,
            badge: null,
          },
        ];
      }
      const { item } = entry;
      const live = getActivity?.(item);
      const read = mateRowReading({
        name: entry.name,
        connected: mateAwake(item, hqMates),
        activity: live,
        reviewWaits: reviewWaits(item),
        mine: waitsOnViewer(item.project.id),
        pose: matePoseOf(item, minuteMs, mateLifeOf(getComing?.(item))),
        free: mateAutomation(item.project.hq?.mate)?.task === null,
      });
      const comingNow = getComing?.(item);
      const view = comingNow === undefined ? read : mateComingRowView(read, comingNow);
      const owner = getOwner?.(item);
      return [
        {
          projectId,
          name: entry.name,
          ...faceOf(item.project),
          state: view.face,
          known: live !== undefined && live.remembered !== true,
          badge:
            owner === undefined || owner.isViewer
              ? null
              : ownerBadge({ kind: "person", mark: ownerMark(owner) }, false),
        },
      ];
    });
    const current = groupHoldsCurrent({
      open,
      mates: [...ordered.map((entry) => entry.projectId), ...coming.map((m) => m.projectId)],
      active: activeProjectId ?? undefined,
    });
    if (current) bandKey = `group:${id}`;
    // The viewer's Mates in it, those they are making included: a press opens the one where it is
    // exactly one.
    const mineIds = [
      ...ordered.filter((entry) => entry.mine).map((entry) => entry.projectId),
      ...coming.map((member) => member.projectId),
    ];
    const row = (
      <ProjectGroupRow
        asksMore={Math.max(0, asks.length - 1)}
        current={current}
        faces={faces}
        groupId={id}
        keyedReadings={keyedReadings}
        keys={mateKeys}
        lead={
          leadEntry === undefined
            ? undefined
            : {
                candidate: leadEntry.item,
                activity: keyedReadings ? undefined : getActivity?.(leadEntry.item),
                up: mateAwake(leadEntry.item, hqMates),
                coming: getComing?.(leadEntry.item),
                conversationsRead: getConversationsRead?.(leadEntry.item) === true,
                owner: keyedReadings ? undefined : getOwner?.(leadEntry.item),
                reviewWaits: reviewWaits(leadEntry.item),
                tint: faceOf(leadEntry.item.project).tint,
                asks: asks.length > 0,
                crew: crewRows.get(leadEntry.projectId),
              }
        }
        mates={mateCount}
        menu={projectMenu()}
        more={cluster.more}
        name={projectName}
        onDragStart={dragOf}
        onInto={() => {
          treeRef.current
            ?.querySelector<HTMLElement>(
              `[data-zerops-group="${CSS.escape(id)}"] [data-zerops-kids] [data-zerops-row]`,
            )
            ?.focus();
        }}
        onPress={() => {
          const press = groupRowPress({ open, mine: mineIds, current });
          toggle(press.open);
          if (press.select === undefined) return;
          const chosen = ordered.find((entry) => entry.projectId === press.select);
          if (chosen === undefined) return;
          slideSelectedBandTo(chosen.projectId);
          onSelect(chosen.item);
        }}
        onToggle={() => {
          toggle(!open);
        }}
        open={open}
        review={review}
        sites={sites}
        timestampFormat={timestampFormat}
      />
    );
    // Folded, the group is its row alone; a fold under way keeps its Mates drawn until they have
    // folded away. A fragment either way, so the row keeps its node — and the focus of the press
    // that folded it.
    const kidsDrawn = open || fold === "closing";
    return {
      drawn: open ? order : [],
      order,
      folds: true,
      render: () =>
        !kidsDrawn ? (
          <RowMarks.Provider value={{ review, mates: NO_MATES }}>
            {demand}
            {row}
          </RowMarks.Provider>
        ) : (
          <RowMarks.Provider
            value={{
              review,
              mates: open ? new Set(ordered.map((entry) => entry.projectId)) : NO_MATES,
            }}
          >
            {demand}
            {row}
            <SidebarProjectFold
              motion={fold}
              onSettled={() => {
                settleFold(id);
              }}
              open={open}
            >
              {/* The viewer's Mates first, those they are making after their listed ones and
                  before colleagues': a Mate made here is the viewer's from its press, so its row
                  stands where its listed row will, and never leaps over the others. */}
              {ordered.filter((entry) => entry.mine).map(({ item }) => mateRow(item, "kid"))}
              {coming.map((member) => comingRow(member, "kid"))}
              {ordered.filter((entry) => !entry.mine).map(({ item }) => mateRow(item, "kid"))}
            </SidebarProjectFold>
          </RowMarks.Provider>
        ),
    };
  };

  /**
   * A project's ···: its own verbs — fold, add a Mate, open it, its addresses (at `place`, its
   * production or first place), move it, set a place up; `withoutMate`, Start a Mate and, to whoever
   * may delete it, its Delete (app-lifecycle.md).
   */
  const projectMenuOf = (
    group: CanonicalGroup,
    fold: { readonly open: boolean; readonly toggle: () => void } | undefined,
    place: string | undefined,
    withoutMate = false,
  ): ReadonlyArray<HeadingMenuEntry> => {
    const missing = missingEnvironmentRows({
      tiersOnMain: tiersAddable({
        offered: environmentOffers(group.groupId),
        group,
        hq: [...(getFlow?.(group.groupId)?.environments.values() ?? [])].map((row) => ({
          id: row.id,
          tier: row.tier,
        })),
        recipe: {
          read: getFlow?.(group.groupId)?.recipeRead === true,
          tiers: getFlow?.(group.groupId)?.recipeTiers ?? [],
        },
      }),
      declarations: [],
    });
    return projectHeadingMenu({
      collapsed: fold?.open === false,
      onToggle: fold?.toggle,
      startMate: withoutMate,
      onDelete:
        withoutMate && orgOffer("delete_app").kind === "allowed"
          ? {
              name: group.name,
              act: () => {
                useDeleteApplicationDialog
                  .getState()
                  .open({ target: applicationDeletionTarget(group) });
              },
            }
          : undefined,
      onAddMate:
        addMateOffer(group.groupId).kind === "allowed"
          ? () => {
              onAddMate?.(group.groupId);
            }
          : undefined,
      onAddAutomatedMates:
        onAddAutomatedMates !== undefined && addMateOffer(group.groupId).kind === "allowed"
          ? () => {
              onAddAutomatedMates(group.groupId);
            }
          : undefined,
      addMateWhy: addMateGate({
        group,
        environments:
          orderedGroups.find((entry) => entry.group.groupId === group.groupId)?.environments ?? [],
      }),
      onOpen:
        onOpenGroup === undefined
          ? onBrowseProjects
          : () => {
              onOpenGroup(group.groupId);
            },
      onAddresses:
        place === undefined || accountOrgId === null
          ? undefined
          : () => {
              useAddressesSheet
                .getState()
                .open({ orgId: accountOrgId, projectId: place, groupId: group.groupId });
            },
      onInvite:
        onInvite === undefined
          ? undefined
          : () => {
              onInvite(group.groupId);
            },
      reorder: {
        canMoveUp: neighbours(group.groupId).indexOf(group.groupId) > 0,
        canMoveDown: neighbours(group.groupId).at(-1) !== group.groupId,
        onMove: (direction) => {
          moveByKey(group.groupId, group.name, direction);
        },
      },
      setUp: missing.map((row) => ({
        label: environmentDoorLabel(row.tier, row.name),
        act:
          onSetUp === undefined
            ? onBrowseProjects
            : () => {
                onSetUp(group.groupId, row.tier);
              },
      })),
      onBrowseProjects,
    });
  };

  /** A project's own row takes the focus: its group's, or its one Mate's. */
  const focusProjectRow = (groupId: string) => {
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-zerops-group="${CSS.escape(groupId)}"] [data-zerops-row]`)
      ?.focus();
  };

  // HQ applications remain visible when they hold only stage/production placements.
  // The viewer's Mate filter still hides applications whose Mates are all filtered out.
  const groups = orderedGroups.filter(
    ({ group, environments }) =>
      !environments.some(({ item }) => hasMate(item)) ||
      environments.some(({ item }) => hasMate(item) && (shown?.(item) ?? true)) ||
      group.pending.some((member) => member.kind === "mate"),
  );
  // A group of Mates is one row until its person opens it (`projectFolded`): what they opened or
  // folded is kept.
  const collapsed: ReadonlySet<string> = new Set(
    groups
      .map(({ group }) => group.groupId)
      .filter((groupId) => projectFolded(projectFolds, groupId)),
  );
  const ungrouped = view.ungrouped.map((item) => ({ item, role: undefined }));
  const ungroupedMates = ungrouped.some(({ item }) => hasMate(item) && (shown?.(item) ?? true));

  // The projects drawn, in order: a move by keyboard or by drag names its
  // place by these neighbours, and the order it writes still holds the rest.
  const drawn = new Set(groups.map(({ group }) => group.groupId));
  const neighbours = (_id: string) => onScreen.filter((entry) => drawn.has(entry));
  const moveProject = (groupId: string, before: string | null, name: string) => {
    if (before !== null && !onScreen.includes(before)) return;
    const next = movedBefore(onScreen, groupId, before);
    projectOrder.choose("custom", next);
    reorder.announce(movedAnnouncement(name, next.indexOf(groupId) + 1, next.length));
  };
  const moveByKey = (groupId: string, name: string, direction: "up" | "down") => {
    const before = keyboardTarget(neighbours(groupId), groupId, direction);
    if (before === undefined) return;
    moveProject(groupId, before, name);
    // The project moves in the DOM, and a moved node can drop its focus.
    requestAnimationFrame(() => {
      focusProjectRow(groupId);
    });
  };

  // The open conversation's row wears the band — or, folded around it, its group's row.
  let bandKey: string | null | undefined = activeProjectId;
  // Every project planned first — which of its Mates it draws as rows, and in what order — so the
  // Mates drawn are numbered top to bottom (⌥1–9) before any row is drawn.
  const numbers = new Map<string, number>();
  const plans = groups.map(({ group, environments }) => ({
    group,
    plan: section(
      group.groupId,
      environments,
      getFlow?.(group.groupId),
      groupNameUnread(group) ? undefined : group.name,
      group,
    ),
  }));
  const ungroupedPlan = ungroupedMates
    ? section("ungrouped", ungrouped, undefined, undefined, undefined)
    : null;
  for (const plan of [...plans.map((entry) => entry.plan), ungroupedPlan]) {
    for (const projectId of plan?.drawn ?? []) numbers.set(projectId, numbers.size + 1);
  }
  mateOrder.current = [
    ...plans.flatMap((entry) => entry.plan?.order ?? []),
    ...(ungroupedPlan?.order ?? []),
  ];
  // What no project drawn here holds any more lets go of what its rows were handed.
  for (const id of [...projectShared.keys()]) {
    if (drawn.has(id)) continue;
    projectShared.delete(id);
    projectLatest.delete(id);
    projectRefs.delete(id);
  }
  const groupSections = plans.map(({ group, plan }) => (
    <section
      className={cn(
        "flex flex-col gap-1.5 transition-opacity",
        reorder.dragging === group.groupId && "opacity-40",
      )}
      data-zerops-group={group.groupId}
      key={group.groupId}
    >
      {plan?.render()}
    </section>
  ));
  // Under *Mine*, how many Mates the list leaves out.
  const hiddenMates =
    shown === undefined ? 0 : candidates.filter((item) => hasMate(item) && !shown(item)).length;
  const ungroupedSection =
    ungroupedPlan === null ? null : (
      <section className="flex flex-col gap-1.5" data-zerops-ungrouped="true">
        {/* Nothing groups these: a quiet word sets them apart where there are projects above. */}
        {groups.length > 0 ? (
          <span className="menu-ungrouped" data-zerops-surface="sidebar-ungrouped-label">
            Ungrouped
          </span>
        ) : null}
        {ungroupedPlan.render()}
      </section>
    );
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
      className={cn("relative isolate flex flex-col gap-1.5 pt-4", className)}
      data-zerops-surface="sidebar-environments"
      ref={treeRef}
    >
      {structureView.updateRequired || followingHqUpdate ? (
        <div className="px-4 pb-3 text-xs text-sidebar-muted-foreground" role="status">
          {structureView.updateRequired ? "HQ needs an update to show all navigation facts." : null}
          {session !== null &&
          session !== undefined &&
          mayBearHq(session.activeOrganization ?? undefined) &&
          hqProject !== undefined &&
          carried !== undefined ? (
            <ZeropsHqUpdate
              projectId={hqProject}
              carried={carried}
              answering={structureView.coreBuild}
              trigger="Update HQ"
              onBusy={ignoreUpdateState}
              onFollowing={setFollowingHqUpdate}
            />
          ) : null}
        </div>
      ) : null}
      <KeptGitQuestions />
      <SidebarSelectedBand current={bandKey} />
      {/* Every project, one list: none folds behind "N other projects" (the owner, 2026-10-11). */}
      {groupSections}
      {ungroupedSection}
      {hiddenMates === 0 || onShowEveryone === undefined ? null : (
        <div
          className="menu-fold mt-5 text-muted-foreground"
          data-zerops-surface="sidebar-hidden-mates"
        >
          <span className="flex justify-center">
            <EyeIcon aria-hidden="true" className="size-3.75" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{`${String(hiddenMates)} ${hiddenMates === 1 ? "Mate" : "Mates"} hidden`}</span>
            <span aria-hidden="true">·</span>
            <button
              className="menu-show-everyone"
              data-zerops-surface="sidebar-show-everyone"
              onClick={onShowEveryone}
              type="button"
            >
              Show everyone
            </button>
          </span>
        </div>
      )}

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
      className="flex h-10 shrink-0 items-center gap-1 ps-4 pe-2 py-1 text-xs text-sidebar-muted-foreground"
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
 * row: a spinner while HQ's first read catches up; a spinner and its words while HQ is slow on a
 * connection that holds, with nothing to try again; in words once what HQ said is no longer current
 * ("HQ is not reachable — showing what it last said") or it never answered ("HQ unavailable") —
 * the whole line in its tooltip, and *Try again* on a press where it is offered. Never a line above
 * the list: the owner, 2026-10-05, of one that pushed the menu down and back on every reconnect.
 */
export function SidebarHqStatus({
  kind,
  line,
  onAgain,
  serviceUrl,
  compact = false,
}: {
  readonly serviceUrl?: string | undefined;
  readonly kind: HqOutage["kind"];
  readonly line: string;
  readonly onAgain?: (() => void) | undefined;
  /** Beside the Chief Mate's row the bar has room for a square, not words: a sign, its words in
   *  its tooltip (the owner, 2026-10-12, of the line drawn over the Chief's mark). */
  readonly compact?: boolean;
}) {
  // Catching up or slow, HQ is working: nothing to try again.
  const working = kind === "syncing" || kind === "slow";
  const again = working ? undefined : onAgain;
  const spinner = <span aria-hidden="true" className="zerops-envdot" data-dot="spinner" />;
  if (compact && kind !== "syncing") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            again === undefined ? (
              <span
                className="menu-round-button"
                data-zerops-surface="sidebar-hq-outage"
                role="status"
              />
            ) : (
              <button
                className="menu-round-button"
                data-zerops-surface="sidebar-hq-outage"
                onClick={again}
                type="button"
              />
            )
          }
        >
          {kind === "slow" ? spinner : <CloudOffIcon aria-hidden="true" className="size-4" />}
          <span className="sr-only">{again === undefined ? line : `${line} Try again.`}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {again === undefined ? line : `${line} Press to try again.`}
        </TooltipPopup>
      </Tooltip>
    );
  }
  // Words give way to the header's other members and wrap; the spinner keeps its size.
  const fit = kind === "syncing" ? "shrink-0" : "min-w-0";
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            again === undefined ? (
              <span
                className={cn("inline-flex items-center gap-1.5", fit)}
                data-zerops-surface="sidebar-hq-outage"
                role="status"
              />
            ) : (
              <button
                className={cn("inline-flex cursor-pointer items-center gap-1.5", fit)}
                data-zerops-surface="sidebar-hq-outage"
                onClick={again}
                type="button"
              />
            )
          }
        >
          {working ? spinner : null}
          {kind === "syncing" ? null : (
            <span
              aria-hidden="true"
              className="line-clamp-2 text-left text-xs leading-tight text-sidebar-muted-foreground"
            >
              {line}
            </span>
          )}
          <span className="sr-only">{again === undefined ? line : `${line} Try again.`}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {again === undefined ? line : `${line} Press to try again.`}
        </TooltipPopup>
      </Tooltip>
      {working || serviceUrl === undefined ? null : (
        <a
          className="text-xs text-sidebar-muted-foreground underline"
          href={serviceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in Zerops
        </a>
      )}
    </span>
  );
}

/**
 * Rows the menu does not know yet, standing in the first row's room: a face and its line, once —
 * how many there are is not known until they are read, and a row the menu paints is never taken
 * back. The boot frame (index.html) paints the same row in the same place.
 */
export function MenuSkeleton({ className }: { readonly className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      data-zerops-surface="sidebar-environments-skeleton"
    >
      <div>
        <span className="bg-sidebar-row-hover" />
        <span className="bg-sidebar-row-hover" />
      </div>
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

/** A stop's deployment demand, held for as long as its project's row is drawn. */
function StopDemand({ projectId }: { readonly projectId: string }) {
  const inventory = useContext(InventoryContext);
  useStopDeploymentDemand(
    inventory === null ? null : findInventoryProjectRef(inventory, projectId),
  );
  return null;
}

/** Who leads a group, as its row reads them: whose time, whose line. */
interface GroupLeadInput<T extends RosterCandidate> {
  readonly candidate: T;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly up: boolean;
  readonly coming: MateComing | undefined;
  readonly conversationsRead: boolean;
  readonly owner: ZeropsMateOwner | undefined;
  readonly reviewWaits: boolean;
  readonly tint: MateTintId;
  /** It asks the viewer something they can answer: the line says the ask. */
  readonly asks: boolean;
  /** Its crew, where it has one: what the crew needs of the viewer leads where it asks nothing. */
  readonly crew?: CrewRowFacts | undefined;
}

/** A group's own first-line words and second line: its name, its lead's time, its lead's words. */
function GroupRowWords<T extends RosterCandidate>({
  name,
  mates,
  lead,
  mark,
  render,
  asksMore,
  timestampFormat,
}: {
  /** Its Mates' faces together, on the row's mark. */
  readonly mark: ReactNode;
  /** The row's button, with its presses and keys. */
  readonly render: ReactElement;
  readonly name: string;
  /** How many Mates it holds: said after its name to whoever cannot see the faces. */
  readonly mates: number;
  readonly lead: GroupLeadInput<T>;
  /** Asks of the viewer behind the lead's: " · 1 more". */
  readonly asksMore: number;
  readonly timestampFormat: TimestampFormat;
}) {
  const state = useMateRowState({
    candidate: lead.candidate,
    activity: lead.activity,
    up: lead.up,
    coming: lead.coming,
    conversationsRead: lead.conversationsRead,
    owner: lead.owner,
    timestampFormat,
    reviewWaits: lead.reviewWaits,
  });
  // What its crew needs of the viewer, where the lead itself asks them nothing.
  const crewNeed = state.asksViewer ? undefined : lead.crew?.need;
  // Whose words the line says, as a group chat's preview leads a message with its sender: an ask
  // of the viewer, its crew's need, the person's own words to it, or its own.
  const prefix = state.asksViewer
    ? `${state.name} asks: `
    : crewNeed !== undefined
      ? `${state.name}'s crew: `
      : state.second.kind === "ask"
        ? `${state.name} · `
        : `${state.name}: `;
  const asking = state.asksViewer || crewNeed !== undefined;
  return (
    <Row
      lead={mark}
      pressable="band"
      render={render}
      size="lg"
      title={
        <span data-zerops-surface="sidebar-project-name">
          {name}
          <span className="sr-only">{`, ${String(mates)} Mates`}</span>
        </span>
      }
      badges={<ProjectNameMarks />}
      meta={
        <span
          className="relative flex h-5.5 min-w-16 items-center justify-end transition-opacity group-any-hover/mate:opacity-0 group-has-[:focus-visible]/mate:opacity-0 group-has-[[data-popup-open]]/mate:opacity-0 pointer-coarse:opacity-0"
          data-menu-time-box=""
        >
          <span className="flex items-center" data-menu-time="">
            <MateSlot
              at={state.time.at}
              slot={state.time.slot}
              unseen={state.view.unseen}
              timestampFormat={timestampFormat}
              tint={lead.tint}
            />
          </span>
        </span>
      }
      line={
        state.second.kind === "none" && crewNeed === undefined ? undefined : (
          <span className="menu-line2 flex min-w-0" data-zerops-surface="sidebar-project-line">
            <span
              className={cn(
                "shrink-0 whitespace-pre text-sidebar-foreground",
                !asking && "font-medium",
              )}
              data-zerops-surface="sidebar-project-lead"
            >
              {prefix}
            </span>
            <span className="min-w-0 flex-1">
              {crewNeed === undefined ? (
                <MateSecondLine
                  askChanged={state.askChanged}
                  askLine={state.askLine}
                  finishing={state.finishing}
                  known={state.known}
                  second={state.second}
                  timestampFormat={timestampFormat}
                  view={state.view}
                />
              ) : (
                <span className="menu-line2 truncate text-sidebar-foreground">
                  {crewNeed.words}
                </span>
              )}
            </span>
            {asksMore > 0 ? (
              <span className="shrink-0 whitespace-pre text-muted-foreground">{` · ${String(asksMore)} more`}</span>
            ) : null}
          </span>
        )
      }
    />
  );
}

/** A group's lead read by its own key (`keyedReadings`): its words without the tree redrawing. */
function KeyedGroupRowWords<T extends RosterCandidate>(
  props: Parameters<typeof GroupRowWords<T>>[0],
) {
  const { lead } = props;
  const activity = useProjectMateActivity(lead.candidate.project.id);
  const person = useHqProjectPerson(lead.candidate.project.id);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const linked = useMateLinkedInHq(lead.candidate.project.id);
  return (
    <GroupRowWords
      {...props}
      lead={{
        ...lead,
        activity,
        up: lead.up || linked,
        owner: zeropsMateOwnerOf(person?.owner, viewer),
      }}
    />
  );
}

/**
 * A project of several Mates (the owner, 2026-10-12: "when more it would be project and it would
 * expand instead of going to detail (or expanding and going to detail if only one of the mates is
 * yours)"): one row — its Mates' faces together, the project's name, its tags, and its lead's line
 * — whose press opens its Mates under it, and the viewer's one Mate with them where exactly one is
 * theirs; another press folds them, the conversation staying open. Folded around the open
 * conversation it wears the list's band. Its verbs — the globe, the project's ··· — take the
 * time's place under the pointer, as a Mate's do.
 */
function ProjectGroupRow<T extends RosterCandidate>({
  groupId,
  name,
  open,
  current,
  faces,
  more,
  mates,
  lead,
  asksMore,
  keyedReadings,
  timestampFormat,
  review,
  sites,
  menu,
  keys,
  onPress,
  onToggle,
  onInto,
  onDragStart,
}: {
  readonly groupId: string;
  readonly name: string;
  readonly open: boolean;
  /** Folded around the open conversation: the list's band stands on it. */
  readonly current: boolean;
  readonly faces: ReadonlyArray<ClusterFace>;
  readonly more: number;
  /** How many Mates it holds, for its name in words. */
  readonly mates: number;
  /** Its lead, where one of its Mates is listed; none while all of them are still being made. */
  readonly lead: GroupLeadInput<T> | undefined;
  readonly asksMore: number;
  readonly keyedReadings: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly review: ProjectReviewData | undefined;
  readonly sites: ProjectSitesInput | undefined;
  readonly menu: ReadonlyArray<HeadingMenuEntry>;
  readonly keys: MateRowKeys;
  /** A press: opens it — and the viewer's one Mate in it — or folds it (`groupRowPress`). */
  readonly onPress: () => void;
  /** → and ←: open or fold it alone; a key walking the list never opens a conversation. */
  readonly onToggle: () => void;
  /** → on its open row: its first Mate takes the focus. */
  readonly onInto: () => void;
  readonly onDragStart?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | undefined>(undefined);
  const rowBox = useRef<HTMLDivElement>(null);
  const tagsBox = useRef<HTMLSpanElement>(null);
  const hasTags = sites !== undefined;
  useTagsRoom(rowBox, tagsBox, hasTags);
  const drag = useRowDrag(onDragStart);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });
  const cancelLongPress = () => {
    if (longPress.current.timer !== null) clearTimeout(longPress.current.timer);
    longPress.current.timer = null;
  };
  const openMenu = (at?: MenuPoint) => {
    setMenuAt(at);
    setMenuOpen(true);
  };
  const body = (tags: ReactNode, globe: ReactNode) => (
    <MateUnit active={current} projectId={`group:${groupId}`}>
      <div
        className="menu-row-box relative"
        data-zerops-project-row={groupId}
        data-zerops-surface="sidebar-project-row"
        onContextMenu={(event) => {
          event.preventDefault();
          if (longPress.current.fired) return;
          openMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerCancel={cancelLongPress}
        onPointerDown={(event) => {
          drag.handlers.onPointerDown?.(event);
          if (event.pointerType !== "touch") return;
          longPress.current.fired = false;
          cancelLongPress();
          longPress.current.timer = setTimeout(() => {
            longPress.current.fired = true;
            openMenu();
          }, 480);
        }}
        onPointerLeave={cancelLongPress}
        onPointerMove={(event) => {
          drag.handlers.onPointerMove?.(event);
          if (event.pointerType === "touch" && event.movementY !== 0) cancelLongPress();
        }}
        onPointerUp={() => {
          drag.handlers.onPointerUp?.();
          cancelLongPress();
        }}
        ref={rowBox}
      >
        {(() => {
          const button = (
            <button
              aria-current={current ? "true" : undefined}
              aria-expanded={open}
              data-zerops-row=""
              data-zerops-surface="sidebar-project"
              onClick={() => {
                if (drag.swallowClick()) return;
                if (longPress.current.fired) {
                  longPress.current.fired = false;
                  return;
                }
                onPress();
              }}
              onKeyDown={(event) => {
                const step = projectRowKey({
                  key: event.key,
                  modified: event.metaKey || event.ctrlKey || event.altKey,
                  kind: "group",
                  open,
                });
                if (step === "next" || step === "previous") {
                  event.preventDefault();
                  keys.move(event.currentTarget, step === "next" ? 1 : -1);
                  return;
                }
                if (step === "open" || step === "fold") {
                  event.preventDefault();
                  onToggle();
                  return;
                }
                if (step === "into") {
                  event.preventDefault();
                  onInto();
                  return;
                }
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  openMenu();
                }
              }}
              type="button"
            />
          );
          const cluster = <ProjectCluster faces={faces} more={more} />;
          return lead === undefined ? (
            <Row
              line={`${String(mates)} Mates coming up`}
              lead={cluster}
              meta={<span className="min-w-16" />}
              pressable="band"
              render={button}
              size="lg"
              badges={<ProjectNameMarks />}
              title={<span data-zerops-surface="sidebar-project-name">{name}</span>}
            />
          ) : keyedReadings ? (
            <KeyedGroupRowWords
              asksMore={asksMore}
              key={lead.candidate.project.id}
              lead={lead}
              mark={cluster}
              mates={mates}
              name={name}
              render={button}
              timestampFormat={timestampFormat}
            />
          ) : (
            <GroupRowWords
              asksMore={asksMore}
              key={lead.candidate.project.id}
              lead={lead}
              mark={cluster}
              mates={mates}
              name={name}
              render={button}
              timestampFormat={timestampFormat}
            />
          );
        })()}
        {hasTags ? (
          <span className="menu-row-tags" data-row-control="" ref={tagsBox}>
            {tags}
          </span>
        ) : null}
        <span
          className="absolute top-2 end-2 flex h-7 items-center opacity-0 transition-opacity group-any-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
          data-row-control=""
          data-zerops-surface="sidebar-project-actions"
        >
          {globe}
          <ProjectMenu
            at={menuAt}
            entries={menu}
            name={name}
            onOpenChange={(next) => {
              setMenuOpen(next);
              if (!next) setMenuAt(undefined);
            }}
            open={menuOpen}
          />
        </span>
      </div>
    </MateUnit>
  );
  return withProjectParts(review, sites, body);
}

/**
 * A project with no Mate in it — its Mates deleted, or a stage or a production alone: the project's
 * mark where a face would be, its name, and "No Mate yet"; a press opens the project. Its tags and
 * verbs are any project's, with Start a Mate and its Delete (app-lifecycle.md).
 */
function ProjectBareRow({
  groupId,
  name,
  review,
  sites,
  menu,
  keys,
  onOpen,
  onDragStart,
}: {
  readonly groupId: string;
  readonly name: string;
  readonly review: ProjectReviewData | undefined;
  readonly sites: ProjectSitesInput | undefined;
  readonly menu: ReadonlyArray<HeadingMenuEntry>;
  readonly keys: MateRowKeys;
  readonly onOpen: () => void;
  readonly onDragStart?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | undefined>(undefined);
  const rowBox = useRef<HTMLDivElement>(null);
  const tagsBox = useRef<HTMLSpanElement>(null);
  const hasTags = sites !== undefined;
  useTagsRoom(rowBox, tagsBox, hasTags);
  const drag = useRowDrag(onDragStart);
  const body = (tags: ReactNode, globe: ReactNode) => (
    <MateUnit active={false} projectId={`group:${groupId}`}>
      <div
        className="menu-row-box relative"
        data-zerops-project-row={groupId}
        data-zerops-surface="sidebar-project-row"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
          setMenuOpen(true);
        }}
        onPointerDown={drag.handlers.onPointerDown}
        onPointerMove={drag.handlers.onPointerMove}
        onPointerUp={drag.handlers.onPointerUp}
        ref={rowBox}
      >
        <Row
          lead={
            <span aria-hidden="true" className="menu-project-mark">
              <BoxIcon className="size-4.5" />
            </span>
          }
          line="No Mate yet"
          meta={<span className="min-w-16" />}
          pressable="band"
          render={
            <button
              data-zerops-row=""
              data-zerops-surface="sidebar-project"
              onClick={() => {
                if (drag.swallowClick()) return;
                onOpen();
              }}
              onKeyDown={(event) => {
                const step = projectRowKey({
                  key: event.key,
                  modified: event.metaKey || event.ctrlKey || event.altKey,
                  kind: "bare",
                  open: false,
                });
                if (step === "next" || step === "previous") {
                  event.preventDefault();
                  keys.move(event.currentTarget, step === "next" ? 1 : -1);
                }
              }}
              type="button"
            />
          }
          size="lg"
          badges={<ProjectNameMarks />}
          title={<span data-zerops-surface="sidebar-project-name">{name}</span>}
        />
        {hasTags ? (
          <span className="menu-row-tags" data-row-control="" ref={tagsBox}>
            {tags}
          </span>
        ) : null}
        <span
          className="absolute top-2 end-2 flex h-7 items-center opacity-0 transition-opacity group-any-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
          data-row-control=""
          data-zerops-surface="sidebar-project-actions"
        >
          {globe}
          <ProjectMenu
            at={menuAt}
            entries={menu}
            name={name}
            onOpenChange={(next) => {
              setMenuOpen(next);
              if (!next) setMenuAt(undefined);
            }}
            open={menuOpen}
          />
        </span>
      </div>
    </MateUnit>
  );
  return withProjectParts(review, sites, body);
}

/** One place in a project's run of Mates: a Mate, one being created, or the quiet ones' fold. */
type MateSlot<T> =
  | { readonly kind: "mate"; readonly item: T }
  | { readonly kind: "coming"; readonly member: ZeropsGroupPendingMember };

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
  /** Pressed once it has the focus: a project's globe opens its places, a Review its changes. */
  readonly press?: HTMLElement;
  /** What it was asked for, inside what the press opened: a stop's section, a change's row. */
  readonly within?: string;
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
      // Its own row: its group's, or its one Mate's.
      const row = find(`[data-zerops-group="${target.groupId}"] [data-zerops-row]`);
      if (row === null) return null;
      return { focus: row, flash: row.closest<HTMLElement>("[data-zerops-mate-unit]") ?? row };
    }
    case "stop": {
      // A stop is no row of its own: its project's globe carries it — production's, the stages',
      // and every Mate's addresses — so the globe is focused, its row flashed, its popover opened
      // at that stop's section.
      const globe = find(
        `[data-zerops-group="${target.groupId}"] [data-zerops-surface="sidebar-project-sites"]`,
      );
      if (globe === null) return null;
      const unit = globe.closest<HTMLElement>("[data-zerops-mate-unit]") ?? globe;
      return {
        focus: globe,
        flash: unit,
        press: globe,
        within: `[data-zerops-surface="sidebar-project-sites-popover"] [data-sites-stop="${CSS.escape(target.projectId)}"]`,
      };
    }
    case "change":
      // The menu only marks what waits for review; its Review is the conversation header's. A
      // found change opens its own page.
      return null;
  }
}

/**
 * What a reveal asked for inside the popover its press opened — a stop's section, a change's row —
 * once the popover has drawn it: brought into view, lit once, and the focus on it where it takes
 * one. A popover that never draws it leaves the focus where the press left it.
 */
function landWithin(selector: string, frames = 0): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    if (frames < 20) {
      requestAnimationFrame(() => {
        landWithin(selector, frames + 1);
      });
    }
    return;
  }
  element.scrollIntoView({ block: "nearest" });
  if (element.matches("button, a, [tabindex]")) element.focus({ preventScroll: true });
  flashOnce(element);
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

/** The row's stop, armed: its confirm in red words, as tall as the ■ it replaces. */
const ROW_STOP_ARMED_CLASS =
  "inline-flex h-5 cursor-pointer items-center rounded px-1 text-line leading-5 font-semibold text-status-failed-text outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROW_ACTION_CLASS = "menu-row-action";

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
import { sidebarMenuShown } from "./SidebarStage";

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

/**
 * A Mate drawn outside the list — the person's Chief, the menu's top row (`SidebarChiefRow`) — read
 * as its row in the list would read it (`useMateRowState`), and its one line drawn the same way.
 */
export function MenuMateLine<T extends RosterCandidate>({
  candidate,
  coming,
  conversationsRead,
  timestampFormat,
  children,
}: {
  readonly candidate: T;
  readonly coming: MateComing | undefined;
  readonly conversationsRead: boolean;
  readonly timestampFormat: TimestampFormat;
  /** Draws what its reading says: the face's state, and its line where the caller keeps it. */
  readonly children: (read: {
    readonly face: MateMarkState;
    /** A result not seen (`MateRowView.unseen`). */
    readonly unseen: boolean;
    readonly state: MateRowState;
    readonly second: MateRowSecond;
    readonly line: ReactNode;
  }) => ReactNode;
}) {
  const activity = useProjectMateActivity(candidate.project.id);
  const person = useHqProjectPerson(candidate.project.id);
  const viewer = useZeropsSessionOptional()?.user?.id;
  const linked = useMateLinkedInHq(candidate.project.id);
  const hqMates = useMatesLinkedInHq();
  const { view, second, askLine, askChanged, known, finishing } = useMateRowState({
    candidate,
    activity,
    up: mateAwake(candidate, hqMates) || linked,
    coming,
    conversationsRead,
    owner: zeropsMateOwnerOf(person?.owner, viewer),
    timestampFormat,
    reviewWaits: false,
  });
  return children({
    face: view.face,
    unseen: view.unseen,
    state: view.state,
    second,
    line: (
      <MateSecondLine
        askChanged={askChanged}
        askLine={askLine}
        finishing={finishing}
        known={known}
        second={second}
        timestampFormat={timestampFormat}
        view={view}
      />
    ),
  });
}

/**
 * What a Mate's row reads of its Mate — its face, its line, its slot, whose it is — from the one
 * reading of it (`mateRowReading`): its own row reads it, and so does its group's row while it
 * leads the group, so the two never say two different things of one Mate.
 */
function useMateRowState<T extends RosterCandidate>({
  candidate,
  activity,
  up,
  coming,
  conversationsRead,
  owner,
  timestampFormat,
  reviewWaits,
  inReview,
}: {
  readonly candidate: T;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly up: boolean;
  readonly coming: MateComing | undefined;
  readonly conversationsRead: boolean;
  readonly owner: ZeropsMateOwner | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly reviewWaits: boolean;
  /** How many of its changes wait for review (`mateReviewCount`). */
  readonly inReview?: number | undefined;
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
  const overviewInHq = useMateOverviewInHq(candidate.project.id);
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
  const offlineSince = useMateOfflineSince(candidate.project.id, candidate.key);
  const awayNowMs = useMateAwayNow(offlineSince);
  // Waking while it comes up and arrives (`mateFaceFor`).
  const pose = matePoseOf(candidate, nowMs, deleting ? "deleting" : mateLifeOf(coming));
  // A Stop pressed in this tab reads as stopping at once, before the Mate's row says so.
  const stopPress = useStopPress(activity?.threadKey);
  // Its face's watch (`mateFace`, below), and its update restarting it, which its line says.
  const watch = useMateFaceWatch({
    environmentId: candidate.environmentId ?? null,
    projectId: candidate.project.id,
    arriving: mateArrivingUntil(candidate) !== undefined,
    connected: candidate.group === "connected",
  });
  const read = mateRowReading({
    name,
    connected: up,
    offlineSince,
    nowMs: awayNowMs,
    timestampFormat,
    activity: withStopPress(activity, stopPress),
    reviewWaits,
    mine: hqPeople?.waitsOnViewer === true,
    pose,
    updating: watch.updating,
    free: mateAutomation(candidate.project.hq?.mate)?.task === null,
  });
  const view = deleting
    ? mateDeletingView(read)
    : coming !== undefined
      ? mateComingRowView(read, coming)
      : finishing !== undefined
        ? mateFinishingView(read)
        : read;
  const retainedReply =
    view.reply?.kind === "words" && view.reply.lastKnown === true ? view.reply : undefined;
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
    overview: overviewInHq,
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
  const admissionOrgId = useAccountOrgId();
  const admission = useProjection(
    mateAdmissionSummary,
    admissionOrgId === null
      ? null
      : {
          orgId: admissionOrgId,
          projectId: candidate.project.id,
          viewerSubject: viewer,
          mateName: name,
        },
    NO_ADMISSION,
  );
  const status = deleting || view.coming !== undefined ? null : mateStatus(activity, admission);
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
  // Its face — the one its chat's top bar wears (`mateFace`): the state its reading wears, the
  // events it greets, its restart.
  const face = mateFace({
    connected: up,
    activity,
    reviewWaits,
    mine: hqPeople?.waitsOnViewer === true,
    pose,
    restarting: watch.restarting,
    watched: watch.watched,
    free: mateAutomation(candidate.project.hq?.mate)?.task === null,
  });
  const { known } = face;
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
    asker: mateAsker(owner),
  });
  const asks =
    activity !== undefined &&
    (activity.question !== undefined ||
      activity.kind === "approval" ||
      activity.kind === "input" ||
      activity.kind === "planReady");
  // A colleague's Mate waiting on its person says whom it waits on, never their question. A Mate
  // nobody owns yet waits on nobody in particular: its question stands.
  const waitsOn =
    hqPeople?.waitsOnViewer === false &&
    owner !== undefined &&
    !owner.isViewer &&
    activity !== undefined &&
    (activity.kind === "approval" || activity.kind === "input" || activity.kind === "planReady")
      ? owner.name.split(" ")[0]
      : undefined;
  // What is read of the organization's key: an automated Mate at rest may wait for it.
  const automatedKey = useAutomatedKey();
  const automated = mateAutomation(candidate.project.hq?.mate, automatedKey, inReview);
  // The one line under the name (round 5, `mateRowSecond`).
  const second = mateRowSecond({
    view,
    askLine,
    deleting,
    finishing: finishing !== undefined,
    outsideHq,
    mine: hqPeople?.waitsOnViewer,
    waitsOn,
    asks,
    // Its open changes stand on its project's row (Review), so the row's lines stay the Mate's.
    change: undefined,
    automated,
  });
  // Its time slot: a free automated Mate's, when its last task ended (`mateRowTime`).
  const time = mateRowTime({ slot: view.slot, at: activity?.at, automated });
  const heldLines = mateRowHeldLines({ second, read: conversationsRead });
  // A new ask rises into the row's second line as the person sets it; the
  // ask this browser remembered gives way to the one read without a rise.
  const askChanged = useChangedSinceShown(view.ask, known);
  return {
    name,
    deleting,
    outsideHq,
    finishing,
    view,
    retainedReply,
    status,
    dot,
    badge,
    notYours,
    face,
    known,
    askLine,
    second,
    time,
    heldLines,
    askChanged,
    /**
     * It asks the viewer something they can answer, as HQ says it waits on them: never a colleague's
     * Mate waiting on its person, nor one HQ has not said of yet.
     */
    asksViewer: asks && hqPeople?.waitsOnViewer === true,
  };
}

/** The gap between a project's places' tag and the time after it. */
const TAG_TIME_GAP_PX = 6;

/**
 * The room a project's places' tag takes at the end of its row's first line (`menu-row-tags`): the
 * tag stands beside the row's own button, never inside it, just before the time (`data-menu-time`),
 * by the widths the two measure — before the first paint, and again whenever the tag comes, goes
 * or changes its words, or the time its width. The line under the name never moves for it (run 2:
 * a busy stage's chip at that line's start pushed the Mate's words aside, and back).
 */
function useTagsRoom(
  row: RefObject<HTMLElement | null>,
  tags: RefObject<HTMLElement | null>,
  present: boolean,
): void {
  useLayoutEffect(() => {
    const rowElement = row.current;
    const tagsElement = tags.current;
    if (rowElement === null) return;
    if (!present || tagsElement === null) {
      rowElement.removeAttribute("data-tags");
      rowElement.style.removeProperty("--menu-tags-w");
      rowElement.style.removeProperty("--menu-time-w");
      return;
    }
    const box: HTMLElement = rowElement;
    const tag: HTMLElement = tagsElement;
    let time: HTMLElement | null = null;
    let placed = "";
    function place() {
      // The time is its row's words' own: read anew, so a time drawn again is the one measured.
      const found = box.querySelector<HTMLElement>("[data-menu-time]");
      if (found !== time) {
        if (time !== null) observer?.unobserve(time);
        time = found;
        if (found !== null) observer?.observe(found);
      }
      const width = tag.offsetWidth;
      const timeWidth =
        found === null || found.offsetWidth === 0 ? 0 : found.offsetWidth + TAG_TIME_GAP_PX;
      // Only a width that changed moves the tag: a reading that changed nothing writes nothing,
      // so the observer never answers its own write.
      const reading = `${String(width)} ${String(timeWidth)}`;
      if (reading === placed) return;
      placed = reading;
      box.toggleAttribute("data-tags", width > 0);
      box.style.setProperty("--menu-tags-w", `${String(width)}px`);
      box.style.setProperty("--menu-time-w", `${String(timeWidth)}px`);
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    place();
    observer?.observe(tagsElement);
    return () => {
      observer?.disconnect();
    };
  }, [present, row, tags]);
}

/**
 * A project's row moved by hand in the *Custom* order (`useProjectReorder`): pressed and pulled
 * more than a few px up or down, it starts the drag; a press that does not travel is the row's own
 * press. The press a drag ended in opens nothing.
 */
function useRowDrag(onDragStart: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined) {
  const start = useRef<{ readonly y: number; readonly x: number; readonly id: number } | null>(
    null,
  );
  const dragged = useRef(false);
  return {
    /** Whether the press that just ended was a drag: its click is swallowed once. */
    swallowClick: () => {
      if (!dragged.current) return false;
      dragged.current = false;
      return true;
    },
    handlers:
      onDragStart === undefined
        ? {}
        : {
            onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
              dragged.current = false;
              if (event.pointerType !== "mouse" || event.button !== 0) return;
              // A press on one of the row's own controls is that control's.
              if ((event.target as HTMLElement).closest("[data-row-control]") !== null) return;
              start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
            },
            onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
              const from = start.current;
              if (from === null || from.id !== event.pointerId) return;
              if (Math.abs(event.clientY - from.y) < DRAG_FROM_PX) return;
              start.current = null;
              dragged.current = true;
              onDragStart(event);
            },
            onPointerUp: () => {
              start.current = null;
              // The click a drag ends in is swallowed — or, the pointer held by the drag, never
              // reaches the row's button — and the next press is the row's own either way.
              if (dragged.current) {
                setTimeout(() => {
                  dragged.current = false;
                }, 0);
              }
            },
          },
  };
}

/** How far a press travels before it is a drag of its project's row. */
const DRAG_FROM_PX = 5;

/** A Mate named as its project: "Project · Mate" would say one name twice, so it says it once. */
function sameName(project: string, mate: string): boolean {
  return project.trim().toLocaleLowerCase() === mate.trim().toLocaleLowerCase();
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
  apps = NO_APPS,
  keys,
  number,
  numbers = false,
  reviewWaits = false,
  inReview,
  project,
  kid = false,
  review,
  sites,
  projectMenu,
  crewFacts,
  onOut,
  onDragStart,
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
  /** Its apps — each pair's stage route, by its service's name — where it has them. */
  readonly apps?: ReadonlyArray<GroupFlowPreview> | undefined;
  /** j and k, handed back to the tree. */
  readonly keys?: MateRowKeys | undefined;
  /** Its place among the drawn Mates, 1–9, for ⌥ and its number. */
  readonly number?: number | undefined;
  /** Option is held: the time slot shows the number instead. */
  readonly numbers?: boolean;
  /** Its own change waits on the person's review (`mateNextStep`): it wears needs-you. */
  readonly reviewWaits?: boolean;
  /** How many of its changes wait so (`mateReviewCount`): its line says how many, past one. */
  readonly inReview?: number | undefined;
  /**
   * The project it is the one Mate of: its row is the project's, "Project · Mate" (the owner,
   * 2026-10-12: "one mate = project would look like a mate named with project and name").
   */
  readonly project?: string | undefined;
  /** It stands under its project's row, the group open: indented, its face smaller. */
  readonly kid?: boolean;
  /** Its project's changes and release (`ProjectReviewTags`), where it is the project's row. */
  readonly review?: ProjectReviewData | undefined;
  /** Its project's places (`ProjectSites`: the globe, the places' tag), where it is the project's row. */
  readonly sites?: ProjectSitesInput | undefined;
  /** Its project's own items, read as its ··· draws, first in it, a line apart from its own. */
  readonly projectMenu?: (() => ReadonlyArray<HeadingMenuEntry>) | undefined;
  /**
   * Its crew (`useCrewRows`): mini Mates after its name, what it needs of the viewer on its line,
   * its state in its row's name. The same object while nothing of it changed.
   */
  readonly crewFacts?: CrewRowFacts | undefined;
  /** ← on a Mate under its project's row: back to that row. */
  readonly onOut?: (() => void) | undefined;
  /** In the *Custom* order its project's row is pulled to move the project. */
  readonly onDragStart?: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
}) {
  const {
    name,
    deleting,
    outsideHq,
    finishing,
    view,
    retainedReply,
    status,
    dot,
    badge,
    notYours,
    face,
    known,
    askLine,
    second,
    time,
    heldLines,
    askChanged,
    asksViewer,
  } = useMateRowState({
    candidate,
    activity,
    up,
    coming,
    conversationsRead,
    owner,
    timestampFormat,
    reviewWaits,
    inReview,
  });
  // Nothing on its menu is about a Mate still being made, or one going: it
  // offers none — until its setup stopped, when *Finish setup* is on it.
  const actions = !outsideHq && mateRowOffersMenu({ deleting, coming }) ? offered : undefined;
  // Its project access detail is held while the row is drawn with its menu (`useDrawnProjectAccess`).
  const drawn = actions?.drawn;
  useEffect(() => drawn?.(), [drawn]);
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
  const rowBox = useRef<HTMLDivElement>(null);
  const tagsBox = useRef<HTMLSpanElement>(null);
  useTagsRoom(rowBox, tagsBox, review !== undefined || sites !== undefined);
  const drag = useRowDrag(onDragStart);
  const crewNeed = crewFacts?.need;
  const crewWords = crewFacts?.words;
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
  // Its crew's ask, or its work ready to land, stands on its line where the Mate's own line says
  // nothing more urgent — words or a step of its own, the person's ask, or nothing — and never a
  // line more: the held room the Mate's words keep gives way to it.
  const crewLine =
    crewNeed !== undefined && !asksViewer && crewMayTakeLine(second, view)
      ? crewNeed.words
      : undefined;
  // The project's verbs ride the Mate's own menu, or a menu of their own where the Mate offers none.
  const menuShown = actions !== undefined || projectMenu !== undefined;

  const body = (tags: ReactNode, globe: ReactNode) => (
    // The row is the container, not the button: the menu's trigger sits in
    // the row beside the button, never inside it. Both are lit as the row's
    // unit (`MateUnit`), wherever on it the pointer is.
    <div
      className="menu-row-box relative"
      data-zerops-mate-row={candidate.project.id}
      data-zerops-surface="sidebar-mate-row"
      onContextMenu={
        !menuShown
          ? undefined
          : (event) => {
              event.preventDefault();
              if (longPress.current.fired) return;
              openMenu({ x: event.clientX, y: event.clientY });
            }
      }
      onPointerCancel={cancelLongPress}
      onPointerDown={(event) => {
        drag.handlers.onPointerDown?.(event);
        if (!menuShown || event.pointerType !== "touch") return;
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
        drag.handlers.onPointerMove?.(event);
        if (event.pointerType === "touch" && event.movementY !== 0) cancelLongPress();
      }}
      onPointerUp={() => {
        drag.handlers.onPointerUp?.();
        cancelLongPress();
      }}
      ref={rowBox}
    >
      <Row
        // The kit's row at the menu's size: the face, then the words. The face stands at the top,
        // on the name's line, whatever number of lines follow it. It paints nothing of its own:
        // its unit is lit, under the pointer or by the list's one band, which slides to it
        // (`SidebarSelectedBand`).
        pressable="band"
        size="lg"
        render={<button ref={rowButton} type="button" />}
        aria-current={active ? "true" : undefined}
        aria-label={
          dot === undefined
            ? undefined
            : `${project === undefined || sameName(project, name) ? name : `${project} · ${name}`}, ${
                status?.kind === "limit" ? "Provider limit" : mateDotLabel(dot)
              }${crewWords === undefined ? "" : `, ${crewWords}`}`
        }
        aria-disabled={deleting || outsideHq || undefined}
        data-kid={kid ? "" : undefined}
        data-zerops-row=""
        data-zerops-surface="sidebar-mate"
        // Resting on it, focusing or touching it warms its conversation, so
        // a press finds its rows already placed (`KeptTimelines`).
        {...warmIntent}
        onClick={() => {
          if (drag.swallowClick()) return;
          if (longPress.current.fired) {
            longPress.current.fired = false;
            return;
          }
          if (deleting || outsideHq) return;
          // The band leaves for this row in the press's own frame (`slideSelectedBandTo`).
          slideSelectedBandTo(candidate.project.id);
          onSelect(candidate);
        }}
        onKeyDown={(event) => {
          // Esc while armed is the row's own (`onKeyDown` on the row, above).
          if (armed && event.key === "Escape") return;
          const modified = event.metaKey || event.ctrlKey || event.altKey;
          // The list's keys: ↓ or j and ↑ or k move, ← steps out to the project's row.
          const step = projectRowKey({
            key: event.key,
            modified,
            kind: kid ? "kid" : "solo",
            open: false,
          });
          if (step === "next" || step === "previous") {
            event.preventDefault();
            keys?.move(event.currentTarget, step === "next" ? 1 : -1);
            return;
          }
          if (step === "out" && onOut !== undefined) {
            event.preventDefault();
            onOut();
            return;
          }
          // x arms a working Mate's stop and x again stops it, e marks it read or unread.
          const action = sidebarMateKey({ key: event.key, modified });
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
          if (!menuShown) return;
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
        lead={
          <span className="relative flex size-9 items-center justify-center">
            {/* The Mate wears the card's face, and a colleague's Mate its
                owner's picture on the face's corner, cut out of it, over a paler
                face (the owner, 2026-09-30: a face before the name read as the
                name's; "the not yours should have the avatar bigger"). Your own
                carry nothing; nobody's shows the empty seat there. Nothing
                rings it — the step it is on is its row's line. Under its
                project's row it stands a size smaller. */}
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
                className={kid ? "size-7" : "size-9"}
                cues={face.cues}
                greets
                known={known}
                restarting={face.restarting}
                shape={shape}
                size={kid ? 24 : 32}
                state={view.face}
                tint={tint}
              />
            </span>
            {badge === null ? null : <MateOwnerMark seat={badge} />}
          </span>
        }
        // The name 15/21 — 600 while a result is unseen — its marks after it, which give way
        // before it does (`Row`'s badges), the time at its end; the one line under it, 14/22. No
        // other dot: the face carries the state.
        strong={view.strongName}
        title={
          <span
            className={cn("menu-name flex min-w-0", renaming && "invisible")}
            data-zerops-surface="sidebar-mate-name"
          >
            {project === undefined || sameName(project, name) ? (
              <span className="min-w-0 truncate">{name}</span>
            ) : (
              // The project's name holds; the Mate's gives way first. The space before the dot is
              // a fixed one: a flex item drops a leading space.
              <>
                <span className="menu-name-project">{project}</span>
                {/* What waits for production after the project's name, the Mate's changes
                  after the Mate's (the owner, 2026-10-12). */}
                {kid ? null : <ProjectNameMarks />}
                <span className="menu-name-mate">{`\u00a0· ${name}`}</span>
              </>
            )}
          </span>
        }
        badges={
          renaming ? undefined : (
            <>
              {kid || (project !== undefined && !sameName(project, name)) ? null : (
                <ProjectNameMarks />
              )}
              {candidate.project.hq?.mate?.automated === true ? <MateAutomatedMark /> : null}
              <MateNameMarks mateProjectId={candidate.project.id} />
              {crewFacts === undefined ? null : <SidebarCrewMinis facts={crewFacts} />}
              {actions?.muted === true ? (
                <BellOffIcon
                  aria-label="Notifications muted"
                  className="size-3 shrink-0 text-sidebar-muted-foreground/70"
                  data-zerops-surface="sidebar-mate-muted"
                  role="img"
                />
              ) : null}
            </>
          )
        }
        // A slot that is always there: the time, which gives way to the row's verbs on hover and
        // focus without anything moving. A project's row holds three verbs there, a Mate under one
        // two.
        meta={
          <span
            className={cn(
              "relative flex h-5.5 shrink-0 items-center justify-end",
              project === undefined ? "min-w-11" : "min-w-16 pointer-coarse:opacity-0",
              menuShown &&
                "transition-opacity group-any-hover/mate:opacity-0 group-has-[:focus-visible]/mate:opacity-0 group-has-[[data-popup-open]]/mate:opacity-0",
              armed && "opacity-0",
            )}
            data-menu-time-box=""
          >
            <span
              className={cn("flex items-center", numbers && number !== undefined && "opacity-0")}
              data-menu-time=""
            >
              <MateSlot
                at={time.at}
                slot={time.slot}
                unseen={view.unseen}
                timestampFormat={timestampFormat}
                tint={tint}
              />
            </span>
            {numbers && number !== undefined ? (
              <Kbd className="absolute end-0 top-0.5" data-zerops-surface="sidebar-mate-number">
                {String(number)}
              </Kbd>
            ) : null}
          </span>
        }
        line={
          <>
            {/* One line under the name: the Mate's answer alone (the owner, 2026-10-12: "just go
                with answer"), else what was asked of it while it has no words yet — or what its
                crew needs of the viewer, where it asks them nothing itself. */}
            {heldLines === 0 || crewLine !== undefined ? null : (
              <span aria-hidden="true" className="menu-line2 h-5" />
            )}
            {crewLine === undefined ? (
              <MateSecondLine
                askChanged={askChanged}
                askLine={askLine}
                known={known}
                second={second}
                timestampFormat={timestampFormat}
                view={view}
                finishing={finishing}
              />
            ) : (
              <span
                className="menu-line2 truncate text-sidebar-foreground"
                data-zerops-surface="sidebar-mate-crew-need"
              >
                {crewLine}
              </span>
            )}
          </>
        }
      />
      {tags === undefined ? null : (
        <span className="menu-row-tags" data-row-control="" ref={tagsBox}>
          {tags}
        </span>
      )}
      {outsideHq || retainedReply === undefined ? null : (
        <span className="absolute end-2 bottom-2.5">
          <a
            className="shrink-0 text-xs text-muted-foreground underline"
            href={zeropsProjectUrl(candidate.project.id)}
            target="_blank"
            rel="noreferrer"
          >
            Open in Zerops
          </a>
        </span>
      )}
      {!menuShown && globe === undefined ? null : (
        <span
          className={cn(
            "absolute top-2 flex h-7 items-center opacity-0 transition-opacity group-any-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100",
            "end-2",
            // A finger never hovers: a project's row holds its verbs where its time stood.
            project !== undefined && "pointer-coarse:opacity-100",
            armed && "opacity-100",
          )}
          data-row-control=""
          data-zerops-surface="sidebar-mate-actions"
        >
          {actions?.stop === undefined ? null : (
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
          {globe}
          {actions === undefined ? (
            projectMenu === undefined ? null : (
              <ProjectMenu
                at={menuAt}
                entries={projectMenu()}
                name={project ?? name}
                onOpenChange={(next) => {
                  setMenuOpen(next);
                  if (!next) setMenuAt(undefined);
                }}
                open={menuOpen}
              />
            )
          ) : (
            <MateMenu
              actions={actions}
              apps={apps}
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
              project={
                project === undefined || projectMenu === undefined
                  ? undefined
                  : { name: project, entries: projectMenu() }
              }
              shortcuts
              unread={unread}
            />
          )}
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
  return withProjectParts(review, sites, body);
}

/** Its project's changes and release, as the row's tags draw them (`ProjectReviewTags`). */
type ProjectReviewData = Parameters<typeof ProjectReviewTags>[0];

/**
 * A project's row with its project's parts: its Review and Release tags, and its places — the
 * places' tag among the tags, the globe among its verbs (`ProjectSites`), one popover behind both.
 * A Mate under its group's row has none of them.
 */
function withProjectParts(
  review: ProjectReviewData | undefined,
  sites: ProjectSitesInput | undefined,
  body: (tags: ReactNode, globe: ReactNode) => ReactNode,
): ReactNode {
  if (review === undefined && sites === undefined) return body(undefined, undefined);
  return sites === undefined ? (
    body(undefined, undefined)
  ) : (
    <ProjectSites {...sites}>{({ tag, globe }) => body(tag, globe)}</ProjectSites>
  );
}

/**
 * What waits in a project, for its rows' marks (the owner, 2026-10-12: "release after project name
 * and merge after mate name"): its review and release, and the Mates whose own rows mark their
 * changes — a solo row's Mate, an open group's Mates; a folded group's row marks them all.
 */
interface RowMarksValue {
  readonly review: ProjectReviewData | undefined;
  readonly mates: ReadonlySet<string>;
}

const NO_MATES: ReadonlySet<string> = new Set();
const RowMarks = createContext<RowMarksValue>({ review: undefined, mates: NO_MATES });

/**
 * After a project's name: the tasks waiting for its automated Mates, what waits for production,
 * and changes no Mate's row here marks.
 */
function ProjectNameMarks() {
  const { review, mates } = useContext(RowMarks);
  if (review === undefined) return null;
  const items = review.items.filter(
    (item) => item.mateProjectId === undefined || !mates.has(item.mateProjectId),
  );
  return (
    <>
      <ProjectTasksWaiting appId={review.groupId} />
      <ProjectReviewMarks {...review} items={items} withRun />
    </>
  );
}

/** "3 tasks waiting" for the application's automated Mates, only while any wait. */
function ProjectTasksWaiting({ appId }: { readonly appId: string }) {
  const words = tasksWaitingWords(useAtomValue(appTasksWaitingAtom(appId)));
  return words === undefined ? null : (
    <span
      className="shrink-0 truncate text-xs text-muted-foreground"
      data-zerops-surface="sidebar-project-tasks-waiting"
    >
      {words}
    </span>
  );
}

/** After a Mate's name: its own changes waiting on a review. */
function MateNameMarks({ mateProjectId }: { readonly mateProjectId: string }) {
  const { review, mates } = useContext(RowMarks);
  if (review === undefined || !mates.has(mateProjectId)) return null;
  const items = review.items.filter((item) => item.mateProjectId === mateProjectId);
  return <ProjectReviewMarks {...review} items={items} release={undefined} />;
}

/**
 * Whether a crew's need may take its Mate's line: where the Mate's own line is its words or its
 * step, the person's ask, or nothing — never over an error, a sign-in, a Mate coming up, going,
 * finishing its setup or outside HQ.
 */
function crewMayTakeLine(second: MateRowSecond, view: MateRowReading): boolean {
  if (second.kind === "ask" || second.kind === "none") return true;
  return second.kind === "reply" && second.tone !== "failed" && view.reply?.kind !== "held";
}

/** The one line under a Mate's name, as `mateRowSecond` chose it. */
function MateSecondLine({
  second,
  view,
  askLine,
  askChanged,
  known,
  finishing,
  timestampFormat,
}: {
  readonly second: MateRowSecond;
  readonly view: MateRowReading;
  readonly askLine: MateRowAskLine;
  readonly askChanged: boolean;
  readonly known: boolean;
  readonly finishing: string | undefined;
  readonly timestampFormat: TimestampFormat;
}) {
  switch (second.kind) {
    case "coming":
      return view.coming === undefined ? null : <MateComingLine line={mateBornLine(view.coming)} />;
    case "deleting":
      return <MateDeletingLine />;
    case "finishing":
      return finishing === undefined ? null : <MateFinishingLine words={finishing} />;
    case "outside":
      return <span className="menu-line2 truncate text-muted-foreground">{NOT_IN_HQ_LINE}</span>;
    case "sign-in":
      return askLine?.kind === "sign-in" ? (
        <MateSignInLine waitsOnViewer={askLine.waitsOnViewer} words={askLine.text} />
      ) : null;
    case "reply":
      return view.reply === undefined ? null : (
        <MateReply
          known={known}
          task={second.task}
          reply={
            view.reply.kind === "words" && second.tone !== undefined
              ? { ...view.reply, tone: second.tone }
              : view.reply
          }
        />
      );
    case "waits-on":
      return (
        <span
          className="menu-line2 truncate text-muted-foreground"
          data-zerops-surface="sidebar-mate-waits-on"
        >
          {second.text}
        </span>
      );
    case "paused":
      return (
        <span
          className="menu-line2 truncate text-muted-foreground"
          data-zerops-surface="sidebar-mate-paused-line"
        >
          {/* the time slot says when it picks up; this line says why, once */}
          At its usage limit
        </span>
      );
    case "task":
      return (
        <span
          className={cn(
            "menu-line2 truncate",
            second.on ? "text-sidebar-foreground" : "text-muted-foreground",
          )}
          data-zerops-surface="sidebar-mate-task"
        >
          {second.text}
        </span>
      );
    case "change":
      return (
        <span
          className={cn(
            "menu-line2 truncate",
            second.mine ? "text-sidebar-foreground" : "text-muted-foreground",
          )}
          data-zerops-surface="sidebar-mate-change"
        >
          <GitPullRequestIcon aria-hidden="true" className="menu-change-mark" />
          {changeLineWords(second)}
        </span>
      );
    case "ask":
      // No words of its own yet: what was asked of it — the dots after it while its words are on
      // their way, until a step is relayed — its draft, or that nothing was.
      if (askLine === undefined || askLine.kind === "sign-in") return null;
      if (second.pending && askLine.kind === "ask")
        return (
          <span className="flex min-w-0 items-center gap-2">
            <MateAskLine line={askLine} rises={askChanged} />
            <MateReplyPending />
          </span>
        );
      return <MateAskLine line={askLine} rises={askChanged} />;
    case "none":
      return null;
  }
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
  unseen,
  timestampFormat,
  tint,
}: {
  readonly slot: MateRowSlot;
  /** When it last did something, for the age. */
  readonly at: string | undefined;
  /** A result not seen (`MateRowView.unseen`): the unread dot hangs before the age. */
  readonly unseen: boolean;
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
      return (
        <SidebarMateAge at={at} className={cn("relative", TIME_CLASS, fadeIn)} unseen={unseen} />
      );
  }
}

const TIME_CLASS = "menu-time shrink-0 text-muted-foreground tabular-nums";

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
      className={cn("menu-clock menu-time shrink-0 tabular-nums", className)}
      data-tint={tint}
      data-zerops-surface="sidebar-mate-time"
    >
      <span aria-hidden="true" className="menu-clock-mark" />
      {formatRunClock(nowMs - Date.parse(since))}
    </span>
  );
}

/** The third line's inks: the answer in the third ink, unread in the second ink, a question in ink, an error red. */
const REPLY_TONE_CLASS: Record<"muted" | "ink-2" | "ink" | "failed" | "attention", string> = {
  muted: "menu-ink-3",
  "ink-2": "menu-ink-2",
  ink: "text-sidebar-foreground",
  failed: "text-status-failed-text",
  attention: "text-status-attention-text",
};

/**
 * The row's second line, the person's (`mateRowAskLine`): what they last asked, led by whose words
 * they are (`mateAsker`), rising in as they set it; or what they are about to send, led by
 * *Draft:* the way a messenger leads an unsent message — the ask kept under it in the same cell,
 * so clearing the draft replays no rise; or, its conversation read and nobody having asked it
 * anything, that fact in the muted ink.
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
        className="truncate menu-line2 menu-ink-3"
        data-zerops-surface="sidebar-mate-nothing-asked"
      >
        {NOTHING_ASKED_YET}
      </span>
    );
  }
  const ask = line.kind === "ask" ? line.text : line.ask;
  const by = line.kind === "ask" ? line.by : undefined;
  const drafting = line.kind === "draft";
  return (
    <span className="grid min-w-0 menu-line2">
      {ask === undefined ? null : (
        <span
          aria-hidden={drafting ? true : undefined}
          className={cn(
            "menu-ink-2 col-start-1 row-start-1 truncate",
            drafting && "invisible",
            rises && "animate-words-in motion-reduce:animate-none",
          )}
          key={ask}
        >
          {/* Whose words they are, as a messenger leads a message of yours with "You:". */}
          {by === undefined ? null : (
            <span data-zerops-surface="sidebar-mate-asker">{`${by}:`}</span>
          )}
          {by === undefined ? null : " "}
          <span data-zerops-surface={drafting ? undefined : "sidebar-mate-subject"}>{ask}</span>
        </span>
      )}
      {drafting ? (
        <span
          className="col-start-1 row-start-1 truncate menu-ink-3"
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
  task,
}: {
  readonly reply: NonNullable<MateRowReply>;
  /** The task an automated Mate works on, named before its step. */
  readonly task?: string | undefined;
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
    return (
      <span
        aria-hidden="true"
        className="menu-line2 h-5.5"
        data-zerops-surface="sidebar-mate-held"
      />
    );
  }
  if (reply.kind === "live") {
    return (
      // The line rises as a new step arrives, and the sweep runs over its
      // words inside it: two animations, two elements — on one, the sweep's
      // took the rise's place and a new step never rose.
      <span
        className={cn(
          "truncate menu-line2 menu-ink-3",
          wordsChanged && "animate-words-in motion-reduce:animate-none",
        )}
        data-zerops-surface="sidebar-mate-live-step"
        key={`live:${reply.words}`}
      >
        {task === undefined ? null : (
          <span className="text-sidebar-foreground" data-zerops-surface="sidebar-mate-live-task">
            {task} ·{" "}
          </span>
        )}
        <RunShimmer inline sweeps>
          {reply.words}
        </RunShimmer>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "truncate menu-line2",
        reply.lastKnown === true && "pe-24",
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
export function MateReplyPending() {
  return (
    <span className="flex h-5.5 items-center gap-1" data-zerops-surface="sidebar-mate-pending">
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
        "truncate menu-line2",
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
      className="truncate menu-line2 text-muted-foreground"
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
      className="truncate menu-line2 text-muted-foreground"
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
        "truncate menu-line2 tabular-nums",
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
  project,
  kid = false,
}: {
  readonly name: string;
  readonly coming: ZeropsGroupPendingMember;
  readonly active: boolean;
  readonly onOpen: ((projectId: string) => void) | undefined;
  /** The project it is the one Mate of: its row is the project's, "Project · Mate". */
  readonly project?: string | undefined;
  /** It stands under its project's row, the group open. */
  readonly kid?: boolean;
}) {
  const tint = coming.face?.tint ?? "slate";
  const row = (
    <Row
      aria-current={active ? "true" : undefined}
      data-kid={kid ? "" : undefined}
      data-zerops-mate-row={coming.projectId}
      data-zerops-row=""
      data-zerops-surface="sidebar-mate-coming"
      lead={
        <span className="relative flex size-9 items-center justify-center">
          <span className="menu-face-cut menu-face-pale relative flex">
            <MateFace
              className={kid ? "size-7" : "size-9"}
              shape={coming.face?.shape ?? mateShapeOf(undefined, tint)}
              size={kid ? 24 : 32}
              state={mateBirthFace(coming.failed === true)}
              tint={tint}
            />
          </span>
          {COMING_SEAT === null ? null : <MateOwnerMark seat={COMING_SEAT} />}
        </span>
      }
      line={<MateComingLine line={pendingBornLine(coming)} />}
      onClick={() => {
        onOpen?.(coming.projectId);
      }}
      pressable="band"
      render={<button type="button" />}
      size="lg"
      title={
        <span className="menu-name flex min-w-0">
          {project === undefined || sameName(project, name) ? (
            <span className="min-w-0 truncate">{name}</span>
          ) : (
            <>
              <span className="menu-name-project">{project}</span>
              <span className="menu-name-mate">{`\u00a0· ${name}`}</span>
            </>
          )}
        </span>
      }
    />
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
    overview: "live",
  }).seat,
  false,
);
