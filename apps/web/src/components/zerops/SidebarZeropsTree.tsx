/**
 * The left menu's projects, each drawn in the one order `groupFlow` draws
 * every surface in: the Mates, what each has waiting to land, then every stop
 * the code reaches — each stage, then production (the owner, 2026-09-25).
 *
 * A project reads top to bottom the way its code moves. First its Mates —
 * the menu's own kind of row, lit on hover and when it is the one open, and
 * a tall one, the way a messenger lists people: the face in its colour
 * wearing the conversation's state, the name, when the Mate last did
 * something at the right edge, and under it what the Mate is on or was last
 * on. The state is the face's to show; no word repeats it. Under each Mate,
 * its open pull requests: one row each, the number and the title, the checks
 * as a dot, and *Merge* where Gitea allows it — folded behind a count once
 * there are more than a handful (`pullRequestsFolded`). Then the pull
 * requests that are nobody's Mate's, a person's own branch. Then the stops,
 * one line each and every one the same line (the owner, 2026-09-25): the
 * last deploy as a badge on the rail, the role as a pill and the name only
 * where it says more, what the stop runs, how far it is behind `main` as a
 * `+N` chip, the verb, then the globe and the stop's menu in two slots that
 * are always there.
 *
 * `main` is not a row. It is what every stop measures itself against, so
 * `+N` means the same on a stage and on production, and a stage with none
 * above a production at `+3` says all three have run on the stage.
 * The row stays quiet unless something differs, and the distance opens to the
 * changes it counts — the one place a project lists them.
 *
 * A project collapses to its heading, the usual sidebar gesture, and the
 * menu remembers it; opening one of its Mates' conversations opens it again.
 *
 * Membership is `hasMate` — the project declares a Mate or a container backs
 * one, and never stage or production — not the live connection, so a
 * container going to sleep changes a face rather than rearranging the menu.
 * Grouping is `buildZeropsGroupTree`, the same derivation the projects screen
 * uses, so the two surfaces can never disagree about which project an
 * environment is in; the colours are `assignCandidateMateTints`, likewise
 * shared. Which pull requests are a Mate's to answer for, and the one next
 * step on the group's own heading, are read from `groupFlow` — the same
 * derivation the projects page draws from — so a recipe change never counts
 * as a Mate's own work here, and the dot on a heading never claims a step the
 * page would not offer.
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import {
  checkDotTone,
  assignCandidateMateTints,
  botDisplayName,
  flowVerbLabel,
  buildZeropsGroupTree,
  environmentNameUnderGroup,
  environmentTierForRole,
  groupFlow,
  hasMate,
  mateEnvironmentsEmptyReason,
  pullRequestsByMate,
  changeState,
  pullRequestBlocked,
  pullRequestsFolded,
  PRODUCTION_SETTING_UP,
  releaseContentsSentence,
  releaseContentsSummary,
  rankZeropsCandidateForListing,
  readZeropsGroupTags,
  selectMateEnvironments,
  sidebarChangeLabel,
  STAGE_SETTING_UP,
  stopRowLine,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupEnvironmentTier,
  type GroupFlow,
  type GroupFlowComing,
  type GroupFlowStop,
  type GroupNextStep,
  type GroupRowTone,
  type MissingEnvironmentRow,
  type StageMark,
  type StopDistance,
  type StopRowLine,
  type StopWordKind,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGroup,
  type ZeropsGroupPendingMember,
  type ZeropsPlacedBirth,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { stopView, type Deployment, type StopView } from "@t3tools/client-runtime/zerops/flow";
import type { KnownAffordance, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { MateMarkState, MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  ArrowUpIcon,
  BellOffIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { cn } from "~/lib/utils";
import {
  formatRelativeTimeLabel,
  formatShortTimestamp,
  formatUpcomingTimestamp,
} from "~/timestampFormat";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import { readCollapsedProjects, writeCollapsedProjects } from "~/zerops/collapsedProjects";
import {
  movedBefore,
  rememberProjectsOnScreen,
  useProjectOrder,
} from "~/zerops/projectOrderPreference";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { SidebarCrewFaces } from "./crew/SidebarCrewFaces";
import { Avatar, KeyChip, MateFace, PlanRing, StatusDot } from "./primitives";
import { RAIL_BLANK, RAIL_LINE } from "./rail";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { environmentRoleTag, groupNameIsPlaceholder } from "./ZeropsGroupTree.logic";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import {
  formatWorkingTime,
  isQuietMate,
  sidebarMateKey,
  stopNameSaysOnlyRole,
} from "./SidebarZeropsTree.logic";
import { MateMenu, MateRenameField, type MateRowActions, type MenuPoint } from "./SidebarMateMenu";
import { MatePeekHost } from "./SidebarMatePeek";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useSidebarPeek, type SidebarRevealTarget } from "~/zerops/sidebarPeek";
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
  comingMateLine,
  groupFlowInputOf,
  groupMemberFactsOf,
  nextStepAwaitsSomebody,
  nextStepTone,
  productionAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { groupAddsOffered } from "./ZeropsProjectRow.logic";
import { ZeropsAskDialog } from "./ZeropsAskDialog";
import { ZeropsMergeDialog } from "./ZeropsMergeDialog";
import { ZeropsReleaseDialog } from "./ZeropsReleaseDialog";
import { ZeropsRoutesMenu } from "./ZeropsPublicRoutes";
import { ZeropsStopMenu } from "./ZeropsStopMenu";

/** What the client holds per environment, when it holds anything. */
type RosterCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly services?: ZeropsEnvironmentServices;
};

type Entry<T> = { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined };

/** An {@link Entry} resolved to its `groupFlow` tier — `undefined` for neither. */
type StopEntry<T> = Entry<T> & { readonly tier: GroupEnvironmentTier | undefined };

/**
 * One of a project's stops as the menu draws it: a listed one, or one being
 * created — its birth, until the listing holds its project.
 */
type StopRow<T> =
  | ({ readonly kind: "listed" } & StopEntry<T>)
  | {
      readonly kind: "creating";
      readonly member: ZeropsGroupPendingMember;
      readonly tier: GroupEnvironmentTier;
    };

/**
 * A stage first, then production, then anything the tag scheme has no tier
 * for: the order the code travels (the owner, 2026-09-25), not the order the
 * tags happen to list.
 */
function stopTierRank(tier: GroupEnvironmentTier | undefined): number {
  return tier === "stage" ? 0 : tier === "production" ? 1 : 2;
}

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
    (candidate) => readZeropsGroupTags(candidate.project.tagList).groupId === target.groupId,
  );
}

/** The group of the project whose conversation is open, when it has one. */
function groupIdOf(
  candidates: ReadonlyArray<RosterCandidate>,
  projectId: string | null | undefined,
): string | undefined {
  if (projectId === undefined || projectId === null) return undefined;
  const open = candidates.find((candidate) => candidate.project.id === projectId);
  return open === undefined ? undefined : readZeropsGroupTags(open.project.tagList).groupId;
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
    missing: flow.missing ?? [],
    release: {
      gate: flow.releaseOffered ? { allowed: true } : { allowed: false, reason: "" },
      suggestion: flow.releaseTag ?? "",
      inFlight: flow.releaseInFlight,
      contents: flow.releaseContents ?? [],
    },
  };
}

const NO_HEALTH: ReadonlyMap<string, ZeropsContainerHealth> = new Map();
const NO_BIRTHS: ReadonlyArray<ZeropsPlacedBirth> = [];

/**
 * One project's flow, as the menu needs it: the open pull requests, each
 * declared environment's row by its Zerops project, whether the production
 * has something to release, and the two verbs — both run as the person, in
 * Gitea, and the caller re-reads once they settle.
 */
export interface SidebarProjectFlow {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /**
   * Whether Gitea answered for the project; absent reads as answered. Until
   * it does, `pullRequests` is empty for want of an answer, and the menu
   * draws the change rows it remembers (`remembered`).
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
   * What a release would carry, per production service: the count *Release*
   * wears and its confirm's list.
   */
  readonly releaseContents?:
    | ReadonlyArray<{ readonly commits: ReadonlyArray<{ sha: string; subject: string }> }>
    | undefined;
  /**
   * How far each stop is behind `main`, by Zerops project id
   * (`sidebarStopReads`). A stop missing here says no distance: nothing
   * placed it, and the row never guesses. Absent where the caller has not
   * wired it.
   */
  readonly distances?: ReadonlyMap<string, StopDistance> | undefined;
  /** Where each change production does not run stands on the stage, by lower-case sha. */
  readonly stageMarks?: ReadonlyMap<string, StageMark> | undefined;
  /**
   * Hands a blocked change to the Mate that wrote it, as a sentence in that
   * Mate's composer.
   *
   * Nobody reading this menu is going to rebase a branch they have not checked
   * out, in a repository they have no session for — the Mate does it, so the
   * row that reports the problem is the row that hands it over. It opens the
   * conversation with the request written and stops there: every change to a
   * project goes through the agent's own tools, and a menu that sent work off
   * on its own would be the first thing here that acts without being read.
   */
  readonly onAsk?: ((pull: FlowPullRequest, ask: string) => void) | undefined;
  /**
   * Opens the stop's own page, in place of the thread.
   *
   * What is running, what is in it, what is not in it yet and where it is —
   * the questions a 256px row cannot answer. *History* used to be a link into
   * Gitea, and so did the version beside it; neither worked, because the app
   * holds the only Gitea token and a person's browser has no session there,
   * so both arrived at a sign-in page (measured 2026-09-19).
   */
  readonly onOpenStop?: ((row: EnvironmentRow) => void) | undefined;
  /**
   * Opens a change's own page — what it carries, what is stopping it, and the
   * verb that moves it.
   *
   * `#4` used to be a link into Gitea, and Gitea is a sign-in page for
   * everybody: the app holds the only token. "This links to gitea as well, no
   * built in interface for PR" (the owner, 2026-09-19).
   */
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /**
   * The stops the group's recipe offers and nobody has added yet. A timeline
   * that showed only its Mates never said a production was a next step (the
   * owner, twice, 2026-09-17: "it never asked me to setup production").
   */
  readonly missing?: ReadonlyArray<MissingEnvironmentRow> | undefined;
  /** Whether this pull request's *Merge* is running. */
  readonly merging: (pull: FlowPullRequest) => boolean;
  /** Whether the project's *Release* is running. */
  readonly releasing: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  readonly onRelease: () => void;
  /** The version *Release* would tag, named in its confirm. */
  readonly releaseTag?: string | undefined;
  /** The release tag on its way to production (`releaseInFlight`), which its line says. */
  readonly releaseInFlight?: string | undefined;
}

export interface SidebarZeropsTreeProps<T extends RosterCandidate> {
  readonly candidates: ReadonlyArray<T>;
  readonly onSelect: (candidate: T) => void;
  /** Opens the projects screen — the way out of a menu whose projects have no Mate. */
  /** Records which project an add was asked for, before navigating to answer it. */
  readonly onAddMate?: ((groupId: string) => void) | undefined;
  readonly onBrowseProjects: () => void;
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
   * Whose this Mate is — the person its project names as `OWNER`, once the
   * org's member list has been read. Absent, the face goes without a badge.
   */
  readonly getOwner?: ((candidate: T) => ZeropsMateOwner | undefined) | undefined;
  /**
   * The project's flow, when the account has read it (`projectFlowContext`).
   * Absent — signed out of Gitea, nothing read yet — the timeline keeps its
   * shape and simply carries no pull request, no dot and no verb.
   */
  readonly getFlow?: ((groupId: string) => SidebarProjectFlow | undefined) | undefined;
  /**
   * What this browser remembers the menu drawing (`menuMemory.ts`), for what
   * is not read yet: a project's change rows until Gitea answers, drawn
   * without their verbs, and what a stop runs until its line settles.
   * Absent, the menu draws only what it has read.
   */
  readonly remembered?: SidebarRemembered | undefined;
  /** What the menu drew of what it has read, after each draw, for the memory to keep. */
  readonly onDrawn?: ((drawn: SidebarDrawn) => void) | undefined;
  /**
   * Whether this person may create a project at all
   * (`canCreateProjectsInOrganization`) — one part of whether *Add
   * production* is offered here (`productionAddable`, the page's own gate).
   * Defaults to `false`, so the verb is never offered on a guess.
   */
  readonly mayCreate?: boolean | undefined;
  /**
   * Each container's health by candidate key (`useZeropsContainers`),
   * for the gate's "some Mate in the group is up" part (`groupAddsOffered`).
   * Absent, no Mate that is only ready counts as up.
   */
  readonly health?: ReadonlyMap<string, ZeropsContainerHealth> | undefined;
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
   * A Mate's peek, drawn from what the row knows (`SidebarMatePeekLive`
   * reads the rest). Absent, rows have no peek.
   */
  readonly renderPeek?: ((peek: SidebarPeekRender<T>) => ReactNode) | undefined;
  /**
   * Whether the menu lists this Mate — the account menu's Mine / Everyone
   * (`shownInScope`). Absent, every Mate.
   */
  readonly shown?: ((candidate: T) => boolean) | undefined;
  /** The menu is a phone's: a peek rises as a sheet, and More stands in for hover. */
  readonly phone?: boolean;
}

/** What the menu remembers drawing (`menuMemory.ts`). */
export interface SidebarRemembered {
  readonly changes: (groupId: string) => ReadonlyArray<FlowPullRequest> | undefined;
  readonly stop: (projectId: string) => string | undefined;
}

/** What the menu drew of what it has read: the change rows Gitea answered, what settled stops run. */
export interface SidebarDrawn {
  readonly changes: Readonly<Record<string, ReadonlyArray<FlowPullRequest>>>;
  readonly stops: Readonly<Record<string, string>>;
}

const NOTHING_DRAWN: SidebarDrawn = { changes: {}, stops: {} };

/**
 * What a row may say of a Mate: its conversation's, read through an open
 * socket — or what this browser remembers it saying, until then
 * (`menuMemory.ts`); nothing where neither is known.
 */
function drawnActivity(
  candidate: Pick<RosterCandidate, "group">,
  activity: ZeropsAgentActivity | undefined,
): ZeropsAgentActivity | undefined {
  return candidate.group === "connected" || activity?.remembered === true ? activity : undefined;
}

/** What a change row acts with: the project's flow, or nothing while it is remembered. */
type ChangeRows = Pick<SidebarProjectFlow, "merging" | "onMerge" | "onAsk" | "onOpenChange"> & {
  readonly remembered?: true;
};

/** Change rows drawn from memory: their titles only, until Gitea answers. */
const REMEMBERED_CHANGE_ROWS: ChangeRows = {
  merging: () => false,
  onMerge: () => undefined,
  onAsk: undefined,
  onOpenChange: undefined,
  remembered: true,
};

/** What the tree hands its peek: the Mate, as its row draws it. */
export interface SidebarPeekRender<T> {
  readonly candidate: T;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly name: string;
  readonly face: MateMarkState;
  readonly tint: MateTintId;
  readonly projectName: string | undefined;
  readonly owner: ZeropsMateOwner | undefined;
  /** The row's own time slot. */
  readonly time: ReactNode;
  /** Each change it has open, a line each — the one a jump asked for first. */
  readonly changes: ReactNode | undefined;
  /** How many: its section says "Change" over one, "Changes" over more. */
  readonly changeCount: number;
  readonly appUrl: string | undefined;
  readonly phone: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** A phone's way to the Mate's menu. */
  readonly onMore: (() => void) | undefined;
}

export function SidebarZeropsTree<T extends RosterCandidate>({
  candidates,
  onSelect,
  onAddMate,
  onBrowseProjects,
  onOpenGroup,
  activeProjectId,
  getActivity,
  getOwner,
  getFlow,
  remembered,
  onDrawn,
  mayCreate = false,
  health = NO_HEALTH,
  complete,
  notice = null,
  onNoticeAct,
  className,
  births = NO_BIRTHS,
  timestampFormat = "locale",
  getMateActions,
  renderPeek,
  shown,
  phone = false,
}: SidebarZeropsTreeProps<T>) {
  const emptyReason = mateEnvironmentsEmptyReason(candidates);
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
  const treeRef = useRef<HTMLElement>(null);
  const reorder = useProjectReorder(treeRef);
  // What "a week untouched" is measured from: the moment the menu was drawn.
  const [nowMs] = useState(Date.now);
  // The projects whose quiet Mates somebody unfolded; not remembered.
  const [openQuiet, setOpenQuiet] = useState<ReadonlySet<string>>(() => new Set());
  // Option held: each Mate row's time slot shows its number, and ⌥1–9 opens it.
  const [altHeld, setAltHeld] = useState(false);
  // One Mate's peek at a time (`sidebarPeek.ts`): half a second's hover, or
  // Space, and it floats beside the menu; on a phone a sheet.
  const peekState = useSidebarPeek((state) => state.peek);
  const menuFor = useSidebarPeek((state) => state.menuFor);
  // A surface's ask to show something (`sidebarPeek.ts`): the header's
  // waiting faces a Mate, the jump box a Mate, a project, a stop or a change.
  // Its project opens — and the quiet Mates or the list of changes it is
  // folded into — then, once its row is drawn, the row takes the focus: a
  // Mate's with its peek pinned beside it, on the change asked for where one
  // was; a project's heading or a stop's row flashes once where it stands.
  const revealing = useSidebarPeek((state) => state.revealing);
  const focusAfterDraw = useRef<SidebarRevealTarget | null>(null);
  // The Mates in the order drawn — collapsed projects included — for the
  // header's "next one that waits", and everything the jump box finds here;
  // written after each render, not during it.
  const mateOrder = useRef<ReadonlyArray<string>>([]);
  const jumpIndex = useRef<SidebarJumpIndex>(EMPTY_JUMP_INDEX);
  const drawnForMemory = useRef<SidebarDrawn>(NOTHING_DRAWN);
  useEffect(() => {
    useSidebarPeek.getState().setMateOrder(mateOrder.current);
    useSidebarJump.getState().publish(jumpIndex.current);
    onDrawn?.(drawnForMemory.current);
  });
  const [, setRevealDraw] = useState(0);
  useEffect(() => {
    if (revealing === null || !holdsRevealTarget(candidates, revealing.target)) return;
    const { target, seq } = revealing;
    useSidebarPeek.getState().answerReveal(seq);
    const groupId =
      target.kind === "mate" ? groupIdOf(candidates, target.projectId) : target.groupId;
    const mateId =
      target.kind === "mate"
        ? target.projectId
        : target.kind === "change"
          ? target.mateProjectId
          : undefined;
    if (groupId !== undefined) {
      setCollapsed((current) => withCollapsed(current, groupId, false));
      // A Mate may be folded among its project's quiet ones.
      if (mateId !== undefined) setOpenQuiet((current) => withCollapsed(current, groupId, true));
      if (target.kind === "change" && mateId !== undefined) {
        const listKey = `${groupId}:${mateId}`;
        setOpenLists((current) => (current.has(listKey) ? current : new Set(current).add(listKey)));
      }
    }
    focusAfterDraw.current = target;
    setRevealDraw((draws) => draws + 1);
  }, [candidates, revealing]);
  useEffect(() => {
    const target = focusAfterDraw.current;
    if (target === null) return;
    const landing = revealLanding(treeRef.current, target);
    if (landing === null) return;
    focusAfterDraw.current = null;
    focusOnceFree(landing.focus, () => {
      if (landing.flash !== null) {
        landing.flash.scrollIntoView({ block: "nearest" });
        flashOnce(landing.flash);
      }
      if (landing.peek !== undefined) {
        useSidebarPeek.getState().open(landing.peek.projectId, "pinned", landing.peek.change);
      }
    });
  });
  // The list's keys that belong to no one row: Option shows the numbers and
  // ⌥1–9 opens that Mate; j or k with nothing focused starts at the Mate in
  // view. Never while somebody types into a field.
  const mateRows = () =>
    Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]') ?? [],
    );
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
      const cursor = useSidebarPeek.getState().cursor ?? activeProjectId;
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
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const leaveSoon = (projectId: string) => {
    clearTimer(leaveTimer);
    // Long enough to cross from the row to the peek beside the menu.
    leaveTimer.current = setTimeout(() => {
      useSidebarPeek.getState().leave(projectId);
    }, 220);
  };
  useEffect(
    () => () => {
      clearTimer(hoverTimer);
      clearTimer(leaveTimer);
    },
    [],
  );
  // What each stop runs, read once per render and handed to `groupFlow` and
  // to every stop's own row, so the two can never read two different answers
  // for the same project.
  const deployments = useZeropsProjectFlowOptional()?.deployments;

  // Until the rows below are drawn, the jump box finds nothing here, and the
  // memory learns nothing new.
  jumpIndex.current = EMPTY_JUMP_INDEX;
  drawnForMemory.current = NOTHING_DRAWN;

  // A Mate being created is one to draw, whatever the listing holds yet.
  const nothing = births.some((birth) => birth.placement.kind === "mate") ? undefined : emptyReason;

  // Nothing to draw, and the listing may not say "none" yet: its notice, at
  // the menu's own left edge, never an empty state it has not earned.
  if (nothing !== undefined && !complete) {
    if (notice === null) return null;
    return <ListingNotice className={className} notice={notice} onAct={onNoticeAct} />;
  }

  // No project at all: nothing to list and nothing to say — the header's
  // "+ New project" is the one affordance, and the projects screen already
  // makes the invitation. A second "New project" here would be the same verb
  // three times on one screen.
  if (nothing === "no-projects") {
    return null;
  }

  // Projects, but none with a Mate: one quiet line on the menu's own left
  // edge, where every other row starts, and the way to the projects screen —
  // once the list is complete, above.
  if (nothing !== undefined) {
    return (
      <div
        className={cn("flex flex-col items-start gap-1.5 px-2.5 py-2", className)}
        data-zerops-surface="sidebar-environments-empty"
      >
        <span className="text-xs text-sidebar-muted-foreground">No environment has Mate yet</span>
        <button
          className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
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

  const toggle = (key: string) => {
    setOpenLists((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // What the peek will draw, captured while its Mate's row is drawn.
  let peekTarget: SidebarPeekRender<T> | undefined;
  const peekFor = (projectId: string): MateRowPeek | undefined =>
    renderPeek === undefined
      ? undefined
      : {
          peeking: peekState?.projectId === projectId,
          onHover: (entering) => {
            const { peek, open } = useSidebarPeek.getState();
            if (!entering) {
              clearTimer(hoverTimer);
              if (peek?.projectId === projectId) leaveSoon(projectId);
              return;
            }
            clearTimer(leaveTimer);
            if (peek?.projectId === projectId || peek?.mode === "pinned") return;
            clearTimer(hoverTimer);
            // Once a peek is open, the next Mate's comes at once, as a hover card does.
            hoverTimer.current = setTimeout(
              () => {
                open(projectId, "hover");
              },
              peek === null ? PEEK_REST_MS : PEEK_NEXT_MS,
            );
          },
          onToggle: () => {
            const { peek, open, close } = useSidebarPeek.getState();
            clearTimer(hoverTimer);
            if (peek?.projectId === projectId && peek.mode === "pinned") close();
            else open(projectId, "pinned");
          },
          onPin: () => {
            useSidebarPeek.getState().open(projectId, "pinned");
          },
          menuRequested: menuFor === projectId,
          onMenuRequestSeen: () => {
            useSidebarPeek.getState().askForMenu(null);
          },
          onFocus: () => {
            useSidebarPeek.getState().setCursor(projectId);
          },
        };
  const selectMate = (candidate: T) => {
    useSidebarPeek.getState().close();
    onSelect(candidate);
  };
  // A peek put away while the focus was in it hands the focus back to its
  // Mate's row, where it came from — never to the page behind.
  const closePeek = () => {
    const open = useSidebarPeek.getState().peek;
    const inside =
      typeof document !== "undefined" &&
      document
        .querySelector('[data-zerops-surface="sidebar-mate-peek-popup"]')
        ?.contains(document.activeElement) === true;
    useSidebarPeek.getState().close();
    if (open === null || !inside) return;
    document
      .querySelector<HTMLElement>(
        `[data-zerops-mate-row="${open.projectId}"] [data-zerops-surface="sidebar-mate"]`,
      )
      ?.focus({ preventScroll: true });
  };
  // Each drawn Mate's number, top to bottom, for the ⌥ chips.
  let numbered = 0;
  const mateKeys: MateRowKeys = {
    move: (from, direction) => {
      const rows = mateRows();
      const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(from) + direction))];
      if (next === undefined || next === from) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      // A peek somebody pinned follows the focus down the list.
      const projectId = next
        .closest("[data-zerops-mate-row]")
        ?.getAttribute("data-zerops-mate-row");
      const { peek, open } = useSidebarPeek.getState();
      if (peek?.mode === "pinned" && projectId !== null && projectId !== undefined) {
        open(projectId, "pinned");
      }
    },
  };

  // What the jump box finds, gathered as each project is read (`indexSection`):
  // data only, in the menu's own order — what the box does with a find is its
  // own.
  const jumpMates: JumpMate[] = [];
  const jumpProjects: JumpProject[] = [];
  const jumpChanges: JumpChange[] = [];
  const jumpStops: JumpStop[] = [];
  // What the memory keeps of this draw (`onDrawn`), gathered alike.
  const drawnChanges: Record<string, ReadonlyArray<FlowPullRequest>> = {};
  const drawnStops: Record<string, string> = {};
  const indexSection = (input: {
    readonly id: string;
    readonly group: ZeropsGroup | undefined;
    readonly groupName: string | undefined;
    readonly flow: SidebarProjectFlow | undefined;
    /** Its Mates as the menu draws them: the ones at work or lately, then the quiet ones. */
    readonly mateEntries: ReadonlyArray<Entry<T>>;
    readonly grouped: ReturnType<typeof pullRequestsByMate>;
    /** Whether change rows are drawn: Gitea's, or the ones remembered until it answers. */
    readonly changesDrawn: boolean;
    readonly stopRows: ReadonlyArray<StopRow<T>>;
    readonly projectFlow: GroupFlow;
  }) => {
    const { id, group, groupName, flow, mateEntries, grouped, projectFlow } = input;
    if (group !== undefined) {
      jumpProjects.push({ groupId: id, name: group.name, mates: mateEntries.length });
    }
    const names = new Map<string, string>();
    for (const { item } of mateEntries) {
      const name = botDisplayName({
        bot: readZeropsGroupTags(item.project.tagList).bot,
        projectName: item.project.name,
      });
      names.set(item.project.id, name);
      jumpMates.push(
        jumpMateOf({
          projectId: item.project.id,
          name,
          tint: tints.get(item.project.id) ?? "slate",
          projectName: groupName,
          environmentId: item.environmentId,
          owner: getOwner?.(item),
          connected: item.group === "connected",
          activity: getActivity?.(item),
        }),
      );
    }
    if (input.changesDrawn) {
      const change = (pull: FlowPullRequest, mateProjectId: string | undefined): JumpChange => ({
        key: changeRowKey(pull),
        groupId: id,
        repository: pull.repository,
        number: pull.number,
        projectName: groupName,
        label: sidebarChangeLabel(pull),
        checkTone: checkDotTone({ checks: pull.checks }),
        checkWord: pull.checkWord,
        mateProjectId,
        whose: (mateProjectId === undefined ? undefined : names.get(mateProjectId)) ?? pull.author,
      });
      // A hidden Mate's changes are drawn nowhere, so they are found nowhere.
      for (const { item } of mateEntries) {
        for (const pull of grouped.byMate.get(item.project.id) ?? []) {
          jumpChanges.push(change(pull, item.project.id));
        }
      }
      for (const pull of grouped.others) jumpChanges.push(change(pull, undefined));
    }
    for (const row of input.stopRows) {
      if (row.kind !== "listed") continue;
      const projectId = row.item.project.id;
      const read = stopRowRead({
        projectId,
        tier: row.tier,
        flow,
        projectFlow,
        deployments,
        nowMs,
        remembered: remembered?.stop(projectId),
      });
      if (read.settled && read.line.runs !== undefined) drawnStops[projectId] = read.line.runs;
      const name = environmentNameUnderGroup(groupName, row.item.project.name);
      jumpStops.push({
        projectId,
        groupId: id,
        title: groupName === undefined ? name : `${groupName} ${name}`,
        line: read.line.runs ?? read.view.line,
        tone: read.badge.tone,
        word: read.badge.word,
      });
    }
  };

  /**
   * A project as a timeline: its name, its Mates with what each has waiting,
   * the pull requests that are nobody's Mate's, then its other environments.
   * Nothing when nobody lives in it.
   */
  const section = (
    id: string,
    entries: ReadonlyArray<Entry<T>>,
    renderHeader: (nextStep: GroupNextStep | undefined) => ReactNode,
    flow: SidebarProjectFlow | undefined,
    groupName: string | undefined,
    // `undefined` for the ungrouped section, which has no production to add.
    group: ZeropsGroup | undefined,
  ) => {
    const everyMate = entries.filter(({ item }) => hasMate(item));
    // Whose Mates the viewer asked to see (Mine / Everyone).
    const mateEntries = everyMate.filter(({ item }) => shown?.(item) ?? true);
    // Its Mates being created, after the listed ones: the listing holds none of them yet.
    const coming = group?.pending.filter((member) => member.kind === "mate") ?? [];
    const mateCount = mateEntries.length + coming.length;
    if (mateCount === 0) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    // The one derivation the projects page draws from too (`groupFlow.ts`),
    // fed through the page's own input (`groupFlowInputOf`) and gate
    // (`productionAddable`): read once here, so the pull requests this tree
    // hangs under a Mate, the recipe changes it leaves out, each stop's line
    // and the heading's own next-step dot can never disagree with what the
    // page says about the same project.
    //
    // Read whether or not Gitea is: what a stop runs is the platform's
    // answer, and its row says it either way. Only the heading's dot waits
    // for the flow — a next step read from nothing would be a guess.
    const projectFlow: GroupFlow = groupFlow(
      groupFlowInputOf({
        groupId: id,
        // Whether a Mate's conversations arrived is not asked here: unknown
        // reads as not spoken to, as it always did in this menu.
        members: groupMemberFactsOf(
          entries,
          (item) => getActivity?.(item),
          () => false,
        ),
        flow: flow === undefined ? undefined : groupFlowReadsOf(flow),
        deployments,
        productionAddable:
          group !== undefined &&
          productionAddable({
            group,
            mayCreate,
            addsOffered: groupAddsOffered(entries, health),
          }),
        pending: group?.pending ?? [],
      }),
    );
    const header = renderHeader(flow === undefined ? undefined : projectFlow.nextStep);
    // Code only — a recipe change is the group's document, left to the
    // projects page, and is never one more thing a Mate's row here answers
    // for.
    // The change rows: Gitea's once it answered, and until then the ones this
    // browser remembers drawing, without their verbs — so a reload grows no
    // row when the answer comes (`menuMemory.ts`).
    const changesKnown = flow !== undefined && flow.changesKnown !== false;
    const rememberedPulls = changesKnown ? undefined : remembered?.changes(id);
    const changeRows: ChangeRows | undefined =
      flow !== undefined && changesKnown
        ? flow
        : rememberedPulls === undefined
          ? undefined
          : REMEMBERED_CHANGE_ROWS;
    const flowPulls = changesKnown
      ? projectFlow.pullRequests.map((entry) => entry.pull)
      : (rememberedPulls ?? []);
    if (changesKnown) drawnChanges[id] = flowPulls;
    // By every Mate, shown or not: a hidden Mate's change is still its own,
    // never a person's branch.
    const grouped = pullRequestsByMate(
      flowPulls,
      everyMate.map(({ item }) => item.project.id),
    );
    // Which row the spine ends on: the last stop where a project has one,
    // then a change nobody's Mate owns, then the last Mate's own last row. A
    // line that runs past its final node into the gap below reads as a list
    // that got cut off rather than as work arriving somewhere.
    const otherPulls = changeRows === undefined ? [] : grouped.others;
    // Every stage, then production — the order the code travels (the owner,
    // 2026-09-25), not the order the tags happen to list. A stop being
    // created follows the listed ones of its tier.
    const stopRows: ReadonlyArray<StopRow<T>> = [
      ...others.map((entry): StopRow<T> => ({
        kind: "listed",
        ...entry,
        tier: environmentTierForRole(entry.role),
      })),
      ...(group?.pending ?? []).flatMap((member): ReadonlyArray<StopRow<T>> =>
        member.kind === "mate" ? [] : [{ kind: "creating", member, tier: member.kind }],
      ),
    ].sort((a, b) => stopTierRank(a.tier) - stopTierRank(b.tier));
    const endsOnMates = stopRows.length === 0 && otherPulls.length === 0;
    // Its Mates in the order drawn: the ones at work or lately at it, those
    // being created, then — folded behind their count at the end — the ones
    // untouched for a week (`isQuietMate`), open only when asked.
    const quietOf = (item: T) =>
      isQuietMate(
        drawnActivity(item, getActivity?.(item)),
        nowMs,
        item.project.id === activeProjectId,
      );
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
      stopRows,
      projectFlow,
    });
    // Collapsed, a project is its heading and nothing else — no summary and
    // no small badges: a second, smaller design of the same rows is what the
    // owner turned down (2026-09-25). The dot on the heading still says
    // whether it waits on somebody.
    if (group !== undefined && collapsed.has(id)) return header;
    const quietOpen = openQuiet.has(id);
    const slots: ReadonlyArray<MateSlot<T>> = [
      ...loud.map(({ item }) => ({ kind: "mate" as const, item })),
      ...coming.map((member) => ({ kind: "coming" as const, member })),
      ...(quiet.length === 0 ? [] : [{ kind: "fold" as const, count: quiet.length }]),
      ...(quietOpen ? quiet.map(({ item }) => ({ kind: "mate" as const, item })) : []),
    ];
    // Each block — a Mate with its changes, one being created, the quiet
    // fold, the changes nobody's Mate owns, the stops — stands apart from the
    // next by a gap the spine runs through; the heading stands on the first.
    const blocks: Array<{ readonly key: string; readonly node: ReactNode }> = [
      ...slots.map((slot, index) => {
        const first = index === 0;
        const last = endsOnMates && index === slots.length - 1;
        if (slot.kind === "coming") {
          return {
            key: `coming:${slot.member.projectId}`,
            node: (
              <ComingMateRow
                coming={slot.member}
                name={slot.member.name}
                railCap={railCapFor({ first, last })}
              />
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
                railCap={railCapFor({ first, last })}
              />
            ),
          };
        }
        const { item } = slot;
        const pulls = grouped.byMate.get(item.project.id) ?? [];
        const listKey = `${id}:${item.project.id}`;
        const ownRow = pulls.length === 0 || changeRows === undefined;
        const appUrl = projectFlow.mates.find(
          (mate) => mate.projectId === item.project.id,
        )?.preview;
        numbered += 1;
        if (renderPeek !== undefined && peekState?.projectId === item.project.id) {
          const activity = getActivity?.(item);
          const live = drawnActivity(item, activity);
          const tags = readZeropsGroupTags(item.project.tagList);
          // Every change it has open, as under its row: the one the peek was
          // asked to show — a jump to it — first, then the rest newest first.
          const asked = pulls.find((pull) => changeRowKey(pull) === peekState.change);
          const peekPulls =
            !changesKnown || flow === undefined
              ? []
              : asked === undefined
                ? pulls
                : [asked, ...pulls.filter((pull) => pull !== asked)];
          peekTarget = {
            candidate: item,
            activity: live,
            name: botDisplayName({ bot: tags.bot, projectName: item.project.name }),
            face: mateFaceFor(item.group === "connected", activity),
            tint: tints.get(item.project.id) ?? "slate",
            projectName: groupName,
            owner: getOwner?.(item),
            time:
              live === undefined ? null : (
                <MateTime activity={live} timestampFormat={timestampFormat} />
              ),
            changes:
              peekPulls.length === 0 || flow === undefined ? undefined : (
                <div className="grid gap-1.5">
                  {peekPulls.map((pull) => (
                    <PeekChangeLine key={changeRowKey(pull)} flow={flow} pull={pull} />
                  ))}
                </div>
              ),
            changeCount: peekPulls.length,
            appUrl,
            phone,
            onOpen: () => {
              selectMate(item);
            },
            onClose: closePeek,
            onMore:
              phone && getMateActions !== undefined
                ? () => {
                    useSidebarPeek.getState().close();
                    useSidebarPeek.getState().askForMenu(item.project.id);
                  }
                : undefined,
          };
        }
        return {
          key: item.key,
          node: (
            <div className="flex flex-col">
              <MateRow
                actions={getMateActions?.(item, getActivity?.(item))}
                active={item.project.id === activeProjectId}
                activity={getActivity?.(item)}
                appUrl={appUrl}
                candidate={item}
                keys={mateKeys}
                number={numbered <= 9 ? numbered : undefined}
                numbers={altHeld}
                onSelect={selectMate}
                peek={peekFor(item.project.id)}
                owner={getOwner?.(item)}
                railCap={railCapFor({ first, last: last && ownRow })}
                timestampFormat={timestampFormat}
                tint={tints.get(item.project.id) ?? "slate"}
              />
              {pulls.length === 0 || changeRows === undefined ? null : (
                <PullRequestList
                  merging={changeRows.merging}
                  onMerge={changeRows.onMerge}
                  onToggle={() => {
                    toggle(listKey);
                  }}
                  open={openLists.has(listKey)}
                  onAsk={changeRows.onAsk}
                  onOpenChange={changeRows.onOpenChange}
                  pulls={pulls}
                  railCap={last ? "end" : undefined}
                  remembered={changeRows.remembered === true}
                />
              )}
            </div>
          ),
        };
      }),
      ...(grouped.others.length === 0 || changeRows === undefined
        ? []
        : [
            {
              key: "others",
              node: (
                // Nobody's Mate's: a person's own branch. Indented under the last
                // Mate it read as that Mate's work, which is a lie the row's own
                // `· ada` could not undo at 256px, where it is truncated away.
                // The dedent is the whole signal; a rule as well would make this
                // read as the start of the stops, which is the next block's rule.
                <ul className="flex flex-col" data-zerops-surface="sidebar-other-pull-requests">
                  {grouped.others.map((pull, index) => (
                    <PullRequestRow
                      key={`${pull.repository}#${pull.number}`}
                      merging={changeRows.merging(pull)}
                      onAsk={changeRows.onAsk}
                      onMerge={changeRows.onMerge}
                      onOpenChange={changeRows.onOpenChange}
                      pull={pull}
                      remembered={changeRows.remembered === true}
                      railCap={
                        stopRows.length === 0 && index === otherPulls.length - 1 ? "end" : undefined
                      }
                      underMate={false}
                    />
                  ))}
                </ul>
              ),
            },
          ]),
      ...(stopRows.length === 0
        ? []
        : [
            {
              key: "stops",
              node: (
                <EnvironmentRows
                  deployments={deployments}
                  flow={flow}
                  groupName={groupName}
                  onOpenProject={onBrowseProjects}
                  projectFlow={projectFlow}
                  rememberedStop={remembered?.stop}
                  stops={stopRows}
                />
              ),
            },
          ]),
    ];
    return (
      <>
        {header}
        {blocks.map((block, index) => (
          <Fragment key={block.key}>
            {index === 0 ? null : <RailGap />}
            {block.node}
          </Fragment>
        ))}
      </>
    );
  };

  // A project is drawn where a Mate the viewer asked to see lives in it — or
  // one is being created there; an empty section would still take its gap.
  const groups = view.groups.filter(
    ({ group, environments }) =>
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

  const groupSections = groups.map(({ group, environments }, index) => (
    <section
      className={cn(
        "flex flex-col transition-opacity",
        sectionRoom({
          first: index === 0,
          collapsed: collapsed.has(group.groupId),
          afterCollapsed: index > 0 && collapsed.has(groups[index - 1]!.group.groupId),
        }),
        reorder.dragging === group.groupId && "opacity-40",
      )}
      data-zerops-group={group.groupId}
      key={group.groupId}
    >
      {section(
        group.groupId,
        environments,
        (nextStep) => (
          <ProjectHeader
            collapsed={collapsed.has(group.groupId)}
            group={group}
            missing={getFlow?.(group.groupId)?.missing ?? []}
            nextStep={nextStep}
            onAddMate={onAddMate}
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
              setCollapsed((current) => withCollapsed(current, groupId, !current.has(groupId)));
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
        groupNameIsPlaceholder(group) ? undefined : group.name,
        group,
      )}
    </section>
  ));
  const ungroupedSection = ungroupedMates ? (
    <section
      className={cn("flex flex-col", groups.length > 0 && SECTION_ROOM)}
      data-zerops-ungrouped="true"
    >
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
      )}
    </section>
  ) : null;
  jumpIndex.current = {
    mates: jumpMates,
    projects: jumpProjects,
    changes: jumpChanges,
    stops: jumpStops,
  };
  drawnForMemory.current = { changes: drawnChanges, stops: drawnStops };

  return (
    <nav
      aria-label="Mates"
      className={cn("relative flex flex-col", className)}
      data-zerops-surface="sidebar-environments"
      ref={treeRef}
    >
      {groupSections}
      {ungroupedSection}

      {/* Rows already held, and the listing not all read: they may not be all
          the Mates there are, so the notice stays under them (§3.4). */}
      {notice === null ? null : (
        <ListingNotice className="mt-6" notice={notice} onAct={onNoticeAct} />
      )}
      {reorder.overlay}
      {renderPeek === undefined ? null : (
        <MatePeekHost
          anchor={() =>
            peekState === null
              ? null
              : (treeRef.current?.querySelector(
                  `[data-zerops-mate-row="${peekState.projectId}"]`,
                ) ?? null)
          }
          onClose={closePeek}
          onInteract={() => {
            useSidebarPeek.getState().pin();
          }}
          onPointerEnter={() => {
            clearTimer(leaveTimer);
          }}
          onPointerLeave={() => {
            if (peekState !== null) leaveSoon(peekState.projectId);
          }}
          open={peekTarget !== undefined}
          phone={phone}
          title={peekTarget === undefined ? "Peek" : `${peekTarget.name}, at a glance`}
        >
          {peekTarget === undefined ? null : renderPeek(peekTarget)}
        </MatePeekHost>
      )}
    </nav>
  );
}

/**
 * The room above a project. A full breath separates it from the one before,
 * much more than its heading keeps from its own rows, so the heading belongs
 * to what is under it rather than floating halfway between two projects. A
 * run of collapsed projects closes up into a list of their names.
 */
const SECTION_ROOM = "mt-9";

function sectionRoom(at: {
  readonly first: boolean;
  readonly collapsed: boolean;
  readonly afterCollapsed: boolean;
}): string | undefined {
  if (at.first) return undefined;
  return at.collapsed && at.afterCollapsed ? "mt-1" : SECTION_ROOM;
}

/** The listing's notice (`candidatesNotice`) with its one affordance, at the menu's left edge. */
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
          message.tone === "alert"
            ? "text-[var(--zerops-status-failed-text)]"
            : "text-sidebar-muted-foreground",
        )}
      >
        {message.text}
      </span>
      {affordance === null || onAct === undefined ? null : (
        <button
          className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
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
  nextStep,
  onAddMate,
  onBrowseProjects,
  onOpen,
  collapsed = false,
  onToggle,
  reorder,
}: {
  readonly group?: ZeropsGroup;
  readonly name?: string;
  readonly muted?: boolean;
  readonly missing?: ReadonlyArray<MissingEnvironmentRow>;
  /**
   * The one thing the flow says is next for this project — `groupFlow`'s own
   * derivation, so a dot here never claims a step the page would not offer.
   * Absent while the flow is unread, and drawn only where it waits on somebody
   * (`nextStepAwaitsSomebody`) — never for a first task, whose Mate is the way in.
   */
  readonly nextStep?: GroupNextStep | undefined;
  /** Records which project the add was asked for; absent in the harness. */
  readonly onAddMate?: ((groupId: string) => void) | undefined;
  readonly onBrowseProjects: () => void;
  /** Absent for the ungrouped heading, which is not a group and has no page. */
  readonly onOpen?: (() => void) | undefined;
  /** Whether only this heading is drawn of the project. */
  readonly collapsed?: boolean;
  /** Collapses or expands the project. Absent for the ungrouped heading, which is not a project. */
  readonly onToggle?: (() => void) | undefined;
  /**
   * Moving the project among the others: *Move up* and *Move down* in its
   * menu from any order, and in *Custom* a grip to drag it by. Absent for the
   * ungrouped heading, which always stands last.
   */
  readonly reorder?: ProjectHeaderReorder | undefined;
}) {
  const placeholder = group !== undefined && groupNameIsPlaceholder(group);
  const title = group?.name ?? name ?? "";
  return (
    <div
      className="group/project relative flex h-7 min-w-0 items-center gap-1 px-2.5"
      data-zerops-surface="sidebar-project"
    >
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
        <button
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
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
          <DisclosureGlyph collapsed={collapsed} />
        </button>
      )}
      {/* Hidden until hover keeps a list of five projects calm, but a finger
          never hovers — so a coarse pointer gets them at rest, as the stop
          rows below already do. */}
      {muted ? null : (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100 pointer-coarse:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={`Add a Mate to ${title}`}
                  className={ROW_ACTION_CLASS}
                  data-zerops-surface="sidebar-project-add-mate"
                  onClick={() => {
                    // The dialog belongs to the projects screen, so the ask
                    // travels with the navigation rather than being dropped.
                    if (group !== undefined) onAddMate?.(group.groupId);
                    onBrowseProjects();
                  }}
                  type="button"
                />
              }
            >
              <PlusIcon aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">Add a Mate</TooltipPopup>
          </Tooltip>
          <Menu>
            <MenuTrigger
              aria-label={`More for ${title}`}
              className={ROW_ACTION_CLASS}
              data-zerops-surface="sidebar-project-more"
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" className="w-56" side="right">
              {/* The project's own page. It went to the projects screen once,
                  so the one item named after the project was the one that did
                  not open it (the owner, 2026-09-19); now that the heading's
                  name collapses the project, this is the way in. */}
              <MenuItem onClick={onOpen ?? onBrowseProjects}>Open project</MenuItem>
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
              {missing.map((row) => (
                <MenuItem key={row.tier} onClick={onBrowseProjects}>
                  {`Set up ${row.name.toLocaleLowerCase()}`}
                </MenuItem>
              ))}
              {/* Where setting one up happens, and where a project is added. */}
              <MenuItem onClick={onBrowseProjects}>All projects</MenuItem>
            </MenuPopup>
          </Menu>
        </span>
      )}
      {/* Always on, unlike the verbs before it: this says something is waiting
          on the person, which is not a fact that should hide until they hover.
          Last, so at rest it sits on the end edge, over the Mates' times. */}
      {nextStep === undefined || !nextStepAwaitsSomebody(nextStep.kind) ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <StatusDot
                className="shrink-0"
                data-zerops-surface="sidebar-project-next-step"
                dotOnly
                label={nextStep.text}
                tone={nextStepTone(nextStep.kind)}
              />
            }
          />
          <TooltipPopup side="right">{nextStep.text}</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

const NO_MISSING_TIERS: ReadonlyArray<MissingEnvironmentRow> = [];

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
 * the focus, the row that was asked for flashes once, and a Mate's peek is
 * pinned — on the change asked for, where it was one of its.
 */
interface RevealLanding {
  readonly focus: HTMLElement;
  readonly flash: HTMLElement | null;
  readonly peek: { readonly projectId: string; readonly change?: string } | undefined;
}

function revealLanding(
  root: HTMLElement | null,
  target: SidebarRevealTarget,
): RevealLanding | null {
  if (root === null) return null;
  const find = (selector: string) => root.querySelector<HTMLElement>(selector);
  const mateRow = (projectId: string) =>
    find(`[data-zerops-mate-row="${projectId}"] [data-zerops-surface="sidebar-mate"]`);
  switch (target.kind) {
    case "mate": {
      const row = mateRow(target.projectId);
      return row === null
        ? null
        : { focus: row, flash: null, peek: { projectId: target.projectId } };
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
        : { focus: toggle ?? heading, flash: heading, peek: undefined };
    }
    case "stop": {
      const row = find(
        `[data-zerops-surface="sidebar-environment"][data-zerops-project="${target.projectId}"]`,
      );
      if (row === null) return null;
      const open =
        row.querySelector<HTMLElement>('[data-zerops-surface="sidebar-stop-open"]') ??
        row.querySelector<HTMLElement>('button[data-zerops-surface="sidebar-environment-version"]');
      return { focus: open ?? row, flash: row, peek: undefined };
    }
    case "change": {
      const row = find(
        `[data-zerops-group="${target.groupId}"] [data-zerops-change="${target.key}"]`,
      );
      if (row === null) return null;
      // A Mate's change is its Mate's to answer for: the Mate takes the focus,
      // and its peek shows this change with its checks and *Merge*.
      if (target.mateProjectId !== undefined) {
        const mate = mateRow(target.mateProjectId);
        return mate === null
          ? null
          : {
              focus: mate,
              flash: row,
              peek: { projectId: target.mateProjectId, change: target.key },
            };
      }
      const open = row.querySelector<HTMLElement>(
        '[data-zerops-surface="sidebar-pull-request-open"]',
      );
      return { focus: open ?? row, flash: row, peek: undefined };
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
 * A project's Mates untouched for a week, folded behind their count at the
 * end of its Mates — on the spine, the words on the Mates' text column — and
 * opened with a press, under the fold, which stays where it is.
 */
function QuietMatesRow({
  count,
  open,
  onToggle,
  railCap,
}: {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly railCap: RailCap;
}) {
  return (
    <button
      aria-expanded={open}
      className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md px-2.5 text-left text-xs text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
      data-zerops-surface="sidebar-quiet-mates"
      onClick={onToggle}
      type="button"
    >
      <RailCell cap={railCap} />
      <span className="flex min-w-0 items-center gap-1.5">
        <FoldGlyph open={open} />
        <span className="truncate">{`${String(count)} quiet ${count === 1 ? "Mate" : "Mates"}`}</span>
      </span>
    </button>
  );
}

/**
 * How long the pointer rests on a Mate's row before its peek opens — a
 * while, and only while the pointer rests: one still moving over the row is
 * on its way somewhere else (the owner, 2026-09-27: "this pop needs to show
 * up with much bigger delay"). Once a peek is open, the next Mate's comes
 * almost at once, as a hover card does.
 */
const PEEK_REST_MS = 1200;
const PEEK_NEXT_MS = 120;

/** What a Mate's row needs to open its peek; see the tree's peek host. */
export interface MateRowPeek {
  readonly peeking: boolean;
  /** The pointer came onto the row or moved on it (`true` — the wait starts over), or left it. */
  readonly onHover: (entering: boolean) => void;
  /** Space: open the peek and keep it, or close it. */
  readonly onToggle: () => void;
  /** Pins its peek open: a finger held on the row, or *Peek* in its menu. */
  readonly onPin: () => void;
  /** Its peek asked for its menu (a phone's *More*). */
  readonly menuRequested: boolean;
  readonly onMenuRequestSeen: () => void;
  /** The row took the focus: the eye is on this Mate now. */
  readonly onFocus: () => void;
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

/** The hover affordances on a heading and on a stop: the same control. */
const HEADING_CLASS =
  "min-w-0 truncate text-base leading-6 font-semibold tracking-tight text-sidebar-foreground";
const HEADING_MUTED = "text-[13px] font-medium tracking-normal text-sidebar-muted-foreground";
const HEADING_UNNAMED = "font-normal text-sidebar-muted-foreground italic";

const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

function MateRow<T extends RosterCandidate>({
  candidate,
  tint,
  active,
  activity,
  onSelect,
  owner,
  railCap,
  timestampFormat,
  actions,
  appUrl,
  peek,
  keys,
  number,
  numbers = false,
}: {
  readonly candidate: T;
  readonly tint: MateTintId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly onSelect: (candidate: T) => void;
  readonly owner: ZeropsMateOwner | undefined;
  readonly railCap?: RailCap;
  readonly timestampFormat: TimestampFormat;
  /** Its menu's verbs; absent, the row carries no menu (a harness, a test). */
  readonly actions?: MateRowActions | undefined;
  /** Its app — its pair's stage route — where it has one. */
  readonly appUrl?: string | undefined;
  /** Its peek's triggers; absent, the row has no peek (a harness, a test). */
  readonly peek?: MateRowPeek | undefined;
  /** j and k, handed back to the tree. */
  readonly keys?: MateRowKeys | undefined;
  /** Its place among the drawn Mates, 1–9, for ⌥ and its number. */
  readonly number?: number | undefined;
  /** Option is held: the time slot shows the number instead. */
  readonly numbers?: boolean;
}) {
  const tags = readZeropsGroupTags(candidate.project.tagList);
  const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
  // What it is on, or was last on, and since when — knowable only through an
  // open socket, and only once somebody has spoken to it; until the socket
  // opens, what this browser remembers the row saying.
  const live = drawnActivity(candidate, activity);
  const subject = live?.subject;
  const snippet = subject === undefined ? undefined : live?.snippet;
  // A new task rises into the row's second line as the person sets it.
  const subjectChanged = useChangedSinceShown(subject);
  const face = mateFaceFor(candidate.group === "connected", activity);
  // The plan as a ring around the face while it works: one segment a step.
  const progress = face === "working" ? live?.progress : undefined;
  const unread = live?.unread === true;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  const rowButton = useRef<HTMLButtonElement>(null);
  const openMenu = (at?: MenuPoint) => {
    setMenuAt(at);
    setMenuOpen(true);
    actions?.onMenuOpen?.();
  };
  // A phone asked for this Mate's menu from its peek: it has no hover and no
  // right-click to open it by.
  const menuRequested = peek?.menuRequested === true;
  useEffect(() => {
    if (!menuRequested) return;
    setMenuAt(undefined);
    setMenuOpen(true);
    peek?.onMenuRequestSeen();
  }, [menuRequested, peek]);
  // The menu opens where the peek floats: while it stands open, no peek does.
  const projectId = candidate.project.id;
  useEffect(() => {
    if (!menuOpen) return;
    useSidebarPeek.getState().menuOpened(projectId, true);
    return () => {
      useSidebarPeek.getState().menuOpened(projectId, false);
    };
  }, [menuOpen, projectId]);
  // A finger held on the row peeks, as a hover would; the click that ends
  // the hold is the peek's, not an open.
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });
  const cancelLongPress = () => {
    if (longPress.current.timer !== null) clearTimeout(longPress.current.timer);
    longPress.current.timer = null;
  };

  // A connected Mate may have a crew: its faces follow the row (seam S8).
  const crewAt = candidate.group === "connected" ? candidate.environmentId : undefined;
  const row = (
    // The row is the container, not the button: the menu's trigger sits in
    // the row beside the button, never inside it, and the row stays lit
    // while the pointer is on either.
    <div
      className="group/mate relative"
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
        if (peek === undefined || event.pointerType !== "touch") return;
        longPress.current.fired = false;
        cancelLongPress();
        longPress.current.timer = setTimeout(() => {
          longPress.current.fired = true;
          peek.onPin();
        }, 480);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") peek?.onHover(true);
      }}
      onPointerLeave={(event) => {
        cancelLongPress();
        if (event.pointerType !== "touch") peek?.onHover(false);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "touch") {
          if (event.movementY !== 0) cancelLongPress();
          return;
        }
        // Still moving: the peek waits for the pointer to rest.
        peek?.onHover(true);
      }}
      onPointerUp={cancelLongPress}
    >
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          // The wider gap is the face's: it overhangs the 20px spine column by
          // 4px a side, and the owner's badge by as much again. It is also the
          // menu's one text column — every stop and change row takes the same
          // gap after the same 20px cell (the owner, 2026-09-25).
          "flex w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md px-2.5 text-left outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground group-hover/mate:bg-sidebar-row-hover group-has-[[data-popup-open]]/mate:bg-sidebar-row-hover",
          // Lit while its peek is open, so the eye can tell whose it is.
          !active && peek?.peeking === true && "bg-sidebar-row-hover",
        )}
        data-zerops-surface="sidebar-mate"
        onClick={() => {
          if (longPress.current.fired) {
            longPress.current.fired = false;
            return;
          }
          onSelect(candidate);
        }}
        onKeyDown={(event) => {
          // Space peeks, and never presses the row: a peek is not an open.
          if (event.key === " " && peek !== undefined) {
            event.preventDefault();
            peek.onToggle();
            return;
          }
          // The list's keys: j and k move, x stops a working Mate, e marks it
          // read or unread.
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
            actions.stop();
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
        onFocus={() => {
          peek?.onFocus();
        }}
        onKeyUp={(event) => {
          if (event.key === " " && peek !== undefined) event.preventDefault();
        }}
        ref={rowButton}
        type="button"
      >
        <RailCell cap={railCap}>
          {/* The Mate is the node the rest of its project hangs from, so it
              wears the card's face rather than a row's, and the person it
              belongs to rides on its corner (a teammate, 2026-09-24). The
              column stays 20px: the spine keeps its x, and the face overhangs
              it. A ring, when it works, stands 4px clear all round, and the
              spine stops at the ring instead of running under it. */}
          <span className={cn("relative flex", progress !== undefined && "my-1")}>
            <MateFace size="md" state={face} tint={tint} />
            {progress === undefined ? null : (
              <span className="absolute -inset-1 flex" data-zerops-surface="sidebar-mate-ring">
                <PlanRing completed={progress.completed} total={progress.total} />
              </span>
            )}
            {owner === undefined ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="absolute -right-1 -bottom-1 flex"
                      data-zerops-surface="sidebar-mate-owner"
                    />
                  }
                >
                  {/* Cut out of the face by a ring of the menu's own ground. */}
                  <Avatar
                    className="ring-2 ring-sidebar"
                    initials={owner.initials}
                    size="xs"
                    src={owner.avatarUrl}
                  />
                  <span className="sr-only">{`${owner.name}'s Mate`}</span>
                </TooltipTrigger>
                <TooltipPopup side="right">{`${owner.name}'s Mate`}</TooltipPopup>
              </Tooltip>
            )}
          </span>
        </RailCell>
        {/* The row's own vertical padding lives here: the rail has to run the
            full height of the row to meet the rows either side of it. */}
        <span className="flex min-w-0 flex-1 flex-col py-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("flex min-w-0 flex-1 items-center gap-1", renaming && "invisible")}>
              <span
                className={cn(
                  "min-w-0 truncate text-sm leading-5.5",
                  unread ? "font-bold" : "font-medium",
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
              )}
            >
              <span className={cn("flex", numbers && number !== undefined && "opacity-0")}>
                {live === undefined ? null : (
                  <MateTime activity={live} timestampFormat={timestampFormat} />
                )}
              </span>
              {numbers && number !== undefined ? (
                <KeyChip className="absolute end-0 top-0" data-zerops-surface="sidebar-mate-number">
                  {String(number)}
                </KeyChip>
              ) : null}
            </span>
          </span>
          {subject === undefined ? null : (
            <span
              className={cn(
                "mt-0.5 truncate text-xs leading-4.5",
                unread ? "font-medium text-sidebar-foreground" : "text-sidebar-muted-foreground",
                subjectChanged && "animate-words-in motion-reduce:animate-none",
              )}
              data-zerops-surface="sidebar-mate-subject"
              key={subject}
            >
              {subject}
            </span>
          )}
          {snippet !== undefined ||
          (subject !== undefined &&
            (live?.awaitingWords === true ||
              live?.kind === "working" ||
              live?.kind === "connecting")) ? (
            <MateSnippet snippet={snippet ?? null} threadKey={live?.threadKey} />
          ) : null}
        </span>
      </button>
      {actions === undefined ? null : (
        <span
          className="absolute end-2.5 top-2.25 flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100"
          data-zerops-surface="sidebar-mate-actions"
        >
          {actions.stop === undefined ? null : (
            // While it works, the time's slot is also its stop.
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-label={`Stop ${name}`}
                    className={ROW_ACTION_CLASS}
                    data-zerops-surface="sidebar-mate-stop"
                    onClick={actions.stop}
                    type="button"
                  />
                }
              >
                <SquareIcon aria-hidden="true" className="size-2.5 fill-current" />
              </TooltipTrigger>
              <TooltipPopup side="right">Stop the run</TooltipPopup>
            </Tooltip>
          )}
          <MateMenu
            actions={actions}
            appUrl={appUrl}
            at={menuAt}
            name={name}
            onOpenChange={(next) => {
              setMenuOpen(next);
              if (!next) setMenuAt(undefined);
            }}
            onOpenMate={() => {
              setMenuOpen(false);
              onSelect(candidate);
            }}
            onPeek={
              peek === undefined
                ? undefined
                : () => {
                    setMenuOpen(false);
                    peek.onPin();
                  }
            }
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
  return crewAt === undefined ? (
    row
  ) : (
    <div className="flex min-w-0 items-center">
      <div className="min-w-0 flex-1">{row}</div>
      <SidebarCrewFaces environmentId={crewAt} />
    </div>
  );
}

/**
 * The row's right edge: when the Mate last did something, as a messenger
 * dates its rows — or, while it works, its work left running in the
 * background included, how long it has been at it, counting up in the busy
 * blue; or, paused at a usage limit, when it picks up again.
 * Nothing at all for a Mate nobody has spoken to yet.
 */
function MateTime({
  activity,
  timestampFormat,
}: {
  readonly activity: ZeropsAgentActivity;
  readonly timestampFormat: TimestampFormat;
}) {
  if (activity.pausedUntil !== undefined) {
    const upcoming = formatUpcomingTimestamp(activity.pausedUntil, timestampFormat);
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
            {formatShortTimestamp(activity.pausedUntil, timestampFormat)}
          </span>
          <span className="sr-only">{`Paused at a usage limit, picks up ${upcoming}`}</span>
        </TooltipTrigger>
        <TooltipPopup side="right">{`Paused at a usage limit. Picks up ${upcoming}.`}</TooltipPopup>
      </Tooltip>
    );
  }
  // Work left running in the background wears the working face and offers
  // Stop: it counts up as a run does, from the run that left it running.
  if (
    activity.kind === "working" ||
    activity.kind === "connecting" ||
    activity.kind === "monitoring"
  ) {
    return <MateWorkingTime since={activity.at} />;
  }
  if (activity.subject === undefined) return null;
  const when = compactSidebarTimeLabel(formatRelativeTimeLabel(activity.at));
  return when.length === 0 ? null : (
    <span className={TIME_CLASS} data-zerops-surface="sidebar-mate-time">
      {when}
    </span>
  );
}

const TIME_CLASS = "shrink-0 text-[11px] leading-5 text-sidebar-muted-foreground tabular-nums";

/** The working clock, ticking once a second — a step, never a continuous repaint (R6). */
function MateWorkingTime({ since }: { readonly since: string }) {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <span
      className="shrink-0 text-2xs leading-5 font-medium text-status-busy-text tabular-nums"
      data-zerops-surface="sidebar-mate-time"
    >
      {formatWorkingTime(nowMs - Date.parse(since))}
    </span>
  );
}

/**
 * The Mate's last words — or, while its words are still to come, the dots
 * that wait for them — or, while a message to it waits unsent in its
 * composer, that draft, led by *Draft:*. Only where the row already keeps
 * this line: a draft never grows a row, the composer holds it anyway.
 */
function MateSnippet({
  snippet,
  threadKey,
}: {
  /** Null while its words are still to come. */
  readonly snippet: string | null;
  readonly threadKey: string | undefined;
}) {
  const draft = useComposerDraftStore((state) =>
    threadKey === undefined ? undefined : state.draftsByThreadKey[threadKey]?.prompt,
  );
  const unsent = draft?.trim() ?? "";
  // The Mate's newest words rise into their line when they arrive, as its
  // status line's do in the chat; what the menu opened onto is simply there.
  const said = unsent.length === 0 ? (snippet ?? "") : `Draft: ${unsent}`;
  const saidChanged = useChangedSinceShown(said);
  if (snippet === null && unsent.length === 0) return <MateReplyPending />;
  return (
    <span
      className={cn(
        "truncate text-xs leading-4.5 text-sidebar-muted-foreground/70",
        saidChanged && "animate-words-in motion-reduce:animate-none",
      )}
      data-zerops-surface="sidebar-mate-snippet"
      key={said}
    >
      {unsent.length === 0 ? (
        snippet
      ) : (
        <>
          <span className="font-medium text-sidebar-foreground">Draft:</span> {unsent}
        </>
      )}
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
 * A Mate being created, in the menu's own Mate row: its face asleep, as every
 * Mate's is while it comes up, in no colour of its own yet; its name; and how
 * far its birth has got in the words its card uses. Nothing to open until the
 * listing holds it and its own row stands in its place.
 */
function ComingMateRow({
  name,
  coming,
  railCap,
}: {
  readonly name: string;
  readonly coming: GroupFlowComing;
  readonly railCap?: RailCap;
}) {
  return (
    <div
      aria-busy="true"
      className="flex w-full min-w-0 items-center gap-3.5 rounded-md px-2.5 text-sidebar-foreground select-none"
      data-zerops-surface="sidebar-mate-coming"
    >
      <RailCell cap={railCap}>
        <span className="relative flex">
          <MateFace size="md" state="sleep" tint="slate" />
        </span>
      </RailCell>
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className="min-w-0 truncate text-sm leading-5.5 font-medium">{name}</span>
        <span className="mt-0.5 truncate text-xs leading-4.5 text-sidebar-muted-foreground">
          {comingMateLine(coming)}
        </span>
      </span>
    </div>
  );
}

/**
 * The spine a project hangs on.
 *
 * A project is a timeline — a Mate writes a change, the change waits as a pull
 * request, it lands on the stage, it goes live on the production — and the
 * menu drew it as a flat list of rows that all weighed the same, so it read as
 * "one big same item" (the owner, 2026-09-19) rather than as work moving.
 *
 * The line is drawn per row but spans the row's *padding* box, so consecutive
 * rows meet across the one pixel the list puts between them. An earlier pass
 * drew it inside the icon column instead, which is the row's content box: each
 * row's `py-2` left eight blank pixels at both ends and the spine measured as
 * twenty-eight separate ticks with gaps of nine to twenty-four pixels — a
 * dashed ladder, which is what the owner was looking at when they called it
 * the main problem. Measure the gaps between the segments, never the centres
 * of the nodes; the nodes were always aligned.
 *
 * The node is painted after the line and so sits on it. Nothing is painted
 * opaque underneath, because the row's background changes on hover and a
 * halo in the resting colour would show; a hairline passing behind a tinted
 * badge is what a timeline looks like anyway.
 *
 * The ends are capped: the line starts at the first node of a group and stops
 * at the last, because a spine that runs past its final stop into the gap
 * below reads as a list that got cut off.
 */
function RailCell({ children, cap }: { readonly children?: ReactNode; readonly cap?: RailCap }) {
  const first = cap === "start" || cap === "only";
  const last = cap === "end" || cap === "only";
  return (
    <span className="relative flex w-5 shrink-0 flex-col items-center justify-center self-stretch">
      <span aria-hidden="true" className={first ? RAIL_BLANK : RAIL_LINE} />
      {children}
      <span aria-hidden="true" className={last ? RAIL_BLANK : RAIL_LINE} />
    </span>
  );
}

/**
 * Half a row's share of the spine. It grows into whatever the node leaves, so
 * it meets the node exactly whether that is a 28px face, a 20px badge or the
 * 6px dot a change wears — and it can never be drawn across one. Positioning
 * the line absolutely behind the node instead drew it straight through every
 * tinted face, which no amount of z-index fixes: the faces are not opaque.
 *
 * A capped end keeps its half and gives up only the paint. Leaving the span
 * out altogether let the other half take the free space, which pushed the
 * first face of every group 24px above its row and every last badge 17px
 * below it — the node's place on the row may not depend on where the row
 * happens to sit on the line.
 */
/*
 * The spine's ink is its own token, not `sidebar-border`: that one is the
 * faintest in the set — about five percent of contrast against the sidebar's
 * own ground — which is right for a rule nobody should notice and wrong for
 * the structure a whole group hangs on. It is opaque rather than an alpha of
 * the foreground because the branch's arc leaves the line by drawing over it,
 * and two thirty-percent strokes stack to half again as dark: a notch cut
 * into the spine at every change.
 *
 * The rows themselves sit flush for the same reason. A pixel of air between
 * them went unseen while the line was faint and became a row of dashes the
 * moment it was not.
 */

/**
 * A change branches off the line rather than standing on it.
 *
 * Drawn as a node in the spine it read as one more Mate — "the merge requests
 * still blend together with the item" (the owner, 2026-09-19) — because a row
 * *on* the line and a row *of* the line look alike at a glance, however small
 * the dot. A pull request is a branch off the Mate's work, so it is drawn as
 * one: the spine runs through unbroken, an elbow carries the dot out to an
 * indent of its own, and the title starts from there rather than from the
 * Mates' left edge. The indent is the point — an earlier pass deliberately
 * lined the title up with the names above it, which is what made it blend.
 */
function RailFork({ cap }: { readonly cap?: RailCap }) {
  return (
    <span className="relative flex w-7 shrink-0 self-stretch">
      {/* The spine, built exactly as a row that stands on it builds it — two
          halves centred in the same 20px column — so it lands on the same half
          pixel. Anchored at a round offset instead it sat 0.5px right of the
          Mates' line and the column visibly jogged at every change. */}
      <span className="flex w-5 shrink-0 flex-col items-center self-stretch">
        <span aria-hidden="true" className={RAIL_LINE} />
        <span aria-hidden="true" className={cap === "end" ? RAIL_BLANK : RAIL_LINE} />
      </span>
      {/* The branch: a quarter circle leaving the spine ten pixels above the
          row's centre, then a short run out to the dot. Both borders are
          drawn — given only the bottom one, CSS tapers the arc to nothing
          where the left border would be, which is exactly where it meets the
          spine, so the branch looked detached and read as invisible. The half
          pixel is the spine's own: a 1px line centred in a 20px column sits
          at 9.5, not at 10. */}
      <span
        aria-hidden="true"
        className="absolute start-[9.5px] top-[calc(50%-0.625rem)] h-2.5 w-3.5 rounded-bl-[0.625rem] border-b border-s border-[var(--zerops-rail)]"
        data-zerops-rail="fork"
      />
      <span
        aria-hidden="true"
        className="absolute start-[23.5px] top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--zerops-rail)]"
      />
    </span>
  );
}

/**
 * The air between two of a project's blocks, with the spine carried through
 * it. A Mate with its changes, the quiet fold and the stops each stand apart,
 * so the heading reads as theirs and a Mate's three lines as one thing (the
 * owner, 2026-09-28: "the gap between project name and under project is the
 * same"). The line stays unbroken, from the first node to the last. It is
 * built as a row builds its own share, the same column at the same inset, so
 * it lands on the same half pixel.
 */
function RailGap() {
  return (
    <span aria-hidden="true" className="flex h-2 px-2.5" data-zerops-rail="gap">
      <span className="flex w-5 shrink-0 flex-col items-center">
        <span className={RAIL_LINE} />
      </span>
    </span>
  );
}

/** Where a row sits on its group's spine: the first node, the last, both, or between. */
type RailCap = "start" | "end" | "only" | undefined;

/** A row that is both ends of its group's spine carries no line at all. */
function railCapFor(at: { readonly first: boolean; readonly last: boolean }): RailCap {
  if (at.first && at.last) return "only";
  if (at.first) return "start";
  if (at.last) return "end";
  return undefined;
}

/**
 * One row's share of the spine, spanning its whole box so it meets the rows
 * either side of it.

/**
 * A Mate's open pull requests: the rows themselves while there are a few, a
 * count that opens to them once there are more (`pullRequestsFolded`).
 */
function PullRequestList({
  pulls,
  open,
  onToggle,
  merging,
  onMerge,
  onAsk,
  onOpenChange,
  railCap,
  remembered = false,
}: {
  readonly pulls: ReadonlyArray<FlowPullRequest>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly merging: (pull: FlowPullRequest) => boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  readonly onAsk?: ((pull: FlowPullRequest, ask: string) => void) | undefined;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** Carried to whichever row is last on screen — folded shut, that is the count. */
  readonly railCap?: RailCap;
  /** Drawn from memory until Gitea answers: titles only. */
  readonly remembered?: boolean;
}) {
  const folded = pullRequestsFolded(pulls.length);
  const listed = !folded || open;
  return (
    <div className="flex flex-col" data-zerops-surface="sidebar-pull-requests">
      {folded ? (
        <button
          aria-expanded={open}
          className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={onToggle}
          type="button"
        >
          <RailFork cap={listed ? undefined : railCap} />
          <FoldGlyph open={open} />
          <span>{pulls.length} pull requests</span>
        </button>
      ) : null}
      {!folded || open ? (
        <ul className="flex flex-col">
          {pulls.map((pull, index) => (
            <PullRequestRow
              key={`${pull.repository}#${pull.number}`}
              merging={merging(pull)}
              onAsk={onAsk}
              onMerge={onMerge}
              onOpenChange={onOpenChange}
              pull={pull}
              railCap={index === pulls.length - 1 ? railCap : undefined}
              remembered={remembered}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One pull request: its number and title, the way into Gitea; the checks as
 * a dot with its word in a tooltip; *Merge* where Gitea said the branch
 * merges. A person's own pull request names them after the title — there is
 * no room for a line.
 */
function PullRequestRow({
  pull,
  merging,
  onMerge,
  underMate = true,
  railCap,
  onAsk,
  onOpenChange,
  remembered = false,
}: {
  readonly pull: FlowPullRequest;
  readonly merging: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  readonly onAsk?: ((pull: FlowPullRequest, ask: string) => void) | undefined;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** False for a change that is nobody's Mate's, which hangs under nothing. */
  readonly underMate?: boolean;
  readonly railCap?: RailCap;
  /** Drawn from memory until Gitea answers: its title, and no verdict or verb it may no longer have. */
  readonly remembered?: boolean;
}) {
  const tone = checkDotTone({ checks: pull.checks });
  const label = sidebarChangeLabel(pull);
  const blocked = pullRequestBlocked(pull);
  return (
    // The fork's cell is the spine's 20 px and its branch's 8: the gap after
    // it is the rest of the Mates' 14, so the title starts on the menu's one
    // text column, as a Mate's name and a stop's pill do (it stood 4 px right).
    <li
      className={cn("flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-xs", !underMate && "pe-0.5")}
      data-zerops-change={changeRowKey(pull)}
      data-zerops-surface="sidebar-pull-request"
    >
      <RailFork cap={railCap} />
      {onOpenChange === undefined ? (
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">{label}</span>
      ) : (
        <button
          className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sidebar-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          data-zerops-surface="sidebar-pull-request-open"
          onClick={() => {
            onOpenChange(pull);
          }}
          type="button"
        >
          {label}
        </button>
      )}
      {/* The right edge is never a wordless dot on its own. Where Gitea
          merges the branch the verb carries the row and the dot adds the
          checks beside it; where Gitea refuses, the reason is written out —
          a red dot alone was the row saying nothing at exactly the moment it
          had something to say (seen in the harness, 2026-09-19). */}
      {remembered ? null : pull.mergeability === "mergeable" ? (
        <>
          {tone === undefined || pull.checkWord === undefined ? null : (
            <Tooltip>
              <TooltipTrigger render={<StatusDot dotOnly label={pull.checkWord} tone={tone} />} />
              <TooltipPopup side="right">{pull.checkWord}</TooltipPopup>
            </Tooltip>
          )}
          <MergeVerb merging={merging} onMerge={onMerge} pull={pull} />
        </>
      ) : blocked === null ? null : blocked.ask === undefined || onAsk === undefined ? (
        <StatusDot
          className="shrink-0 text-[11px] text-sidebar-muted-foreground"
          data-zerops-surface="sidebar-pull-request-blocked"
          label={blocked.word}
          sentence
          tone={blocked.tone}
        />
      ) : (
        // A refusal somebody has to act on is a verb, not a label — and it has
        // to look like one. It was a coloured word with a tooltip, which reads
        // as a status, so nobody pressed the only thing on the row that moves
        // the change (the owner, 2026-09-19).
        <AskVerb
          ask={blocked.ask}
          onAsk={onAsk}
          pull={pull}
          tone={blocked.tone}
          word={changeState(pull)?.word ?? blocked.word}
        />
      )}
    </li>
  );
}

/**
 * A Mate's change in its peek: the checks, the number and title, and *Merge*
 * where Gitea merges it — the same pieces as its row under the Mate, on one
 * line of the peek's own width.
 */
function PeekChangeLine({
  pull,
  flow,
}: {
  readonly pull: FlowPullRequest;
  readonly flow: SidebarProjectFlow;
}) {
  const tone = checkDotTone({ checks: pull.checks });
  const label = sidebarChangeLabel(pull);
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-sm leading-5 text-foreground"
      data-zerops-surface="sidebar-mate-peek-change"
    >
      {tone === undefined || pull.checkWord === undefined ? null : (
        <StatusDot dotOnly label={pull.checkWord} tone={tone} />
      )}
      {flow.onOpenChange === undefined ? (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      ) : (
        <button
          className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          onClick={() => {
            flow.onOpenChange?.(pull);
          }}
          type="button"
        >
          {label}
        </button>
      )}
      {pull.mergeability === "mergeable" ? (
        <MergeVerb merging={flow.merging(pull)} onMerge={flow.onMerge} pull={pull} />
      ) : null}
    </div>
  );
}

/**
 * The verb that hands a stuck change back to the Mate that wrote it.
 *
 * It asks first, in the shape *Release* and *Merge* ask in, and the confirm
 * quotes the exact words that will be sent — because *Send* sends them.
 */
function AskVerb({
  pull,
  word,
  tone,
  ask,
  onAsk,
}: {
  readonly pull: FlowPullRequest;
  readonly word: string;
  /** What is wrong, as a colour: a rebase and a failed check are not one thing. */
  readonly tone: ServiceStatusToneId;
  readonly ask: string;
  readonly onAsk: (pull: FlowPullRequest, ask: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ZeropsMateVerb
        action="Ask"
        description={ask}
        label={word}
        tone={tone}
        onClick={() => {
          setConfirming(true);
        }}
      />
      <ZeropsAskDialog
        ask={ask}
        mateName={undefined}
        onConfirm={() => {
          setConfirming(false);
          onAsk(pull, ask);
        }}
        onOpenChange={setConfirming}
        open={confirming}
        sending={false}
        tint={undefined}
        what={`Change #${String(pull.number)} ${word.toLocaleLowerCase()}.`}
      />
    </>
  );
}

/**
 * *Merge*, which asks first.
 *
 * The row this sits on shows as much of the change's title as a 260px column
 * allows — `…lo by Mat…` — and a squash cannot be taken back the way a
 * release can be rolled back to the tag before it. So the verb opens the same
 * kind of confirm *Release* does, with the whole title in it.
 */
function MergeVerb({
  pull,
  merging,
  onMerge,
}: {
  readonly pull: FlowPullRequest;
  readonly merging: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ZeropsMateVerb
        disabled={merging}
        label={flowVerbLabel("merge", merging)}
        onClick={() => {
          setConfirming(true);
        }}
      />
      <ZeropsMergeDialog
        mateName={undefined}
        merging={merging}
        onConfirm={() => {
          setConfirming(false);
          onMerge(pull);
        }}
        onOpenChange={setConfirming}
        open={confirming}
        pull={pull}
      />
    </>
  );
}

/**
 * *Release*, and only the word.
 *
 * The verb keeps its name: renaming it would cost the people who know exactly
 * what it means and buy the others only a different word to learn. How many
 * changes it would carry is the `+N` chip right before it, which opens to
 * them — the one place the menu lists them (the owner, 2026-09-25); a count
 * on the verb too was the same number twice on one line. The tag and what it
 * carries are its accessible name, and its confirm spells them out.
 */
function ReleaseVerb({
  contents,
  releasing,
  releaseTag,
  onRelease,
}: {
  readonly contents: SidebarProjectFlow["releaseContents"];
  readonly releasing: boolean;
  readonly releaseTag: string | undefined;
  readonly onRelease: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const summary = releaseContentsSummary(contents ?? []);
  const sentence = releaseContentsSentence(summary);
  const verb = (
    <ZeropsMateVerb
      description={
        [releaseTag, sentence].filter((part) => part !== undefined).join(", ") || undefined
      }
      disabled={releasing}
      label={flowVerbLabel("release", releasing)}
      // Blue, not amber: work merged and waiting is in flight, not stuck.
      // Beside `Needs a rebase` it wore the identical amber chip — "release
      // doesn't have the same urgency as rebase" (the owner, 2026-09-19) —
      // which flattened the one ladder this menu has, where amber means
      // somebody is blocked and green means a thing is already fine.
      tone={summary.total === 0 ? undefined : "busy"}
      onClick={() => {
        setConfirming(true);
      }}
    />
  );
  // A release is the one verb here that reaches somebody outside the account,
  // so it asks first — with the changes spelled out, not in a hover.
  const confirm = (
    <ZeropsReleaseDialog
      contents={contents}
      onConfirm={() => {
        setConfirming(false);
        onRelease();
      }}
      onOpenChange={setConfirming}
      open={confirming}
      releasing={releasing}
      tag={releaseTag}
    />
  );
  return (
    <>
      {verb}
      {confirm}
    </>
  );
}

/**
 * A stop's last deploy, as the row's first thing rather than its last.
 *
 * A Mate wears a face; a stop wore a 8px dot buried in a second line of muted
 * text, which is precisely what made the stages and the productions read as
 * "second rate citizens" (the owner, 2026-09-19) beside the people. This is
 * the same 20px box a face occupies, in the same column, so the eye reads a
 * project as one list of places work is — some of them people, some of them
 * machines — instead of a list of Mates with a footer.
 *
 * Square, because a face is round: a person and a place should not be the same
 * shape. Tinted rather than filled ("depth by tint"), and never without its
 * word, which the tooltip and the accessible name both carry.
 */
function StopBadge({ tone, word }: { readonly tone: GroupRowTone; readonly word: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<StopMark data-zerops-surface="sidebar-stop-badge" tone={tone} word={word} />}
      />
      <TooltipPopup side="right">{word}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * A stop's badge on its own, where something else says its word: the jump
 * box lists a stop with it, the same square as its row in the menu.
 */
export function StopMark({
  tone,
  word,
  className,
  ...props
}: ComponentProps<"span"> & { readonly tone: GroupRowTone; readonly word: string }) {
  const Icon = STOP_ICON[tone];
  return (
    <span
      {...props}
      aria-label={word}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
        STOP_BADGE_CLASS[tone],
        className,
      )}
      data-zerops-status-tone={tone}
      role="img"
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
    </span>
  );
}

const STOP_ICON: Record<GroupRowTone, typeof CheckIcon> = {
  good: CheckIcon,
  // Not a spinner: a continuously repainting menu is rule R6, and "something
  // is on its way up" is what the arrow says anyway.
  pending: ArrowUpIcon,
  bad: TriangleAlertIcon,
  neutral: MinusIcon,
};

const STOP_BADGE_CLASS: Record<GroupRowTone, string> = {
  good: "bg-[var(--zerops-status-ok)]/15 text-[var(--zerops-status-ok)]",
  pending: "bg-[var(--zerops-status-busy)]/15 text-[var(--zerops-status-busy)]",
  bad: "bg-[var(--zerops-status-failed)]/15 text-[var(--zerops-status-failed)]",
  neutral: "bg-sidebar-row-hover text-sidebar-muted-foreground",
};

/** A stop whose project the flow has no listing for: not read, never "nothing". */
const UNREAD_DEPLOYMENT: Shown<Deployment> = { state: "unread", waitingFor: null };

/**
 * The project's stops, drawn as the peers of the Mates above them: every
 * stage, then production — the order the code travels (the owner,
 * 2026-09-25). One stop, one row, and every stop the same row: a stage used
 * to be one muted line after production, `↳ stage · follows main`, which said
 * where it was and never what it ran or whether it had the newest change.
 *
 * One line, and no switch for another (the owner, 2026-09-25): the badge on
 * the rail; the role as a pill, the name after it only where the name says
 * more; then where the newest change is — what the stop runs, the version's
 * **name** where Zerops has one, else its commit, the same on a stage as on
 * production, with one word in front where something differs (`stopRowLine`)
 * — then how far it is behind `main` as a `+N` chip; then *Release*; then two
 * slots that are always there, the globe and the stop's menu, which shows on
 * hover without moving anything. Never a change's title: a stage is not tied
 * to a Mate, it deploys whatever is pushed to the branch its trigger watches,
 * and "Mate: zitdev" on it read as that Mate's. What runs truncates first;
 * the pill, the chip, the verb and the two slots never give way.
 *
 * The chip is the detail, opened: `+3` lists the three changes under the
 * stop, and under production each says whether the stage has run it yet.
 * Nothing about a stop is folded away any more — the project itself
 * collapses instead.
 */
function EnvironmentRows<T extends RosterCandidate>({
  stops,
  flow,
  projectFlow,
  groupName,
  deployments,
  rememberedStop,
  onOpenProject,
}: {
  /** Every stage, then production (`section`), listed or being set up. */
  readonly stops: ReadonlyArray<StopRow<T>>;
  /** `groupFlow`'s own reading of each stop, so a row never says what the page would not. */
  readonly projectFlow: GroupFlow;
  readonly flow: SidebarProjectFlow | undefined;
  /** The heading above, so a row never repeats the word already on it. */
  readonly groupName: string | undefined;
  /** What each stop runs, read once by the tree and shared with `groupFlow`. */
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  /** What this browser last saw each stop run, until its line settles. */
  readonly rememberedStop: ((projectId: string) => string | undefined) | undefined;
  readonly onOpenProject: () => void;
}) {
  // Only a countdown reads the clock, and a stop's line carries none; the
  // time the rows were first drawn is enough.
  const [nowMs] = useState(Date.now);
  return (
    // The stops belong to the project, not to the Mate they happen to follow.
    <ul className="flex flex-col" data-zerops-surface="sidebar-environment-rows">
      {stops.map((row, index) => {
        const railCap = index === stops.length - 1 ? "end" : undefined;
        if (row.kind === "creating") {
          return (
            <CreatingStopRow
              key={row.member.projectId}
              member={row.member}
              railCap={railCap}
              tier={row.tier}
            />
          );
        }
        const { item, role, tier } = row;
        const projectId = item.project.id;
        const { declared, view, line, badge } = stopRowRead({
          projectId,
          tier,
          flow,
          projectFlow,
          deployments,
          nowMs,
          remembered: rememberedStop?.(projectId),
        });
        return (
          <StopRowItem
            badge={badge}
            key={projectId}
            line={line}
            marks={tier === "production" ? flow?.stageMarks : undefined}
            name={environmentNameUnderGroup(groupName, item.project.name)}
            projectName={item.project.name}
            onOpenProject={onOpenProject}
            onOpenStop={
              declared === undefined || flow?.onOpenStop === undefined
                ? undefined
                : () => {
                    flow.onOpenStop?.(declared);
                  }
            }
            projectId={projectId}
            railCap={railCap}
            release={
              flow !== undefined && flow.releaseOffered && tier === "production" ? flow : undefined
            }
            routes={item.routes ?? []}
            tag={environmentRoleTag(role)}
            view={view}
          />
        );
      })}
    </ul>
  );
}

/**
 * What one listed stop's row reads — what it runs, its line and its badge —
 * read once, for its row and for the jump box alike, so the two never say
 * two things about one stop.
 */
function stopRowRead(input: {
  readonly projectId: string;
  readonly tier: GroupEnvironmentTier | undefined;
  readonly flow: SidebarProjectFlow | undefined;
  readonly projectFlow: GroupFlow;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  readonly nowMs: number;
  /** What this browser last saw the stop run (`menuMemory.ts`), for while its line is unsettled. */
  readonly remembered: string | undefined;
}): {
  readonly declared: EnvironmentRow | undefined;
  readonly view: StopView;
  readonly line: StopRowLine;
  readonly badge: { readonly tone: GroupRowTone; readonly word: string };
  /** The platform said what runs here, and Gitea — which may name it by its release — answered. */
  readonly settled: boolean;
} {
  const { projectId, tier, flow } = input;
  const declared = flow?.environments.get(projectId);
  // What each stop runs is the platform's answer, joined with the row the
  // deploy half read (`stopView`): a stop not yet read holds its line and
  // never reads as one with nothing deployed.
  const view = stopView({
    deployment: input.deployments?.get(projectId) ?? UNREAD_DEPLOYMENT,
    row: declared,
    nowMs: input.nowMs,
  });
  const flowStop = flowStopOf(input.projectFlow, projectId);
  const read: StopRowLine =
    tier === undefined || flowStop === undefined
      ? { word: undefined, runs: view.line, distance: undefined }
      : stopRowLine({
          tier,
          stop: flowStop,
          releasing: tier === "production" ? flow?.releaseInFlight : undefined,
          distance: flow?.distances?.get(projectId),
        });
  const deployment = input.deployments?.get(projectId);
  const settled =
    deployment !== undefined &&
    deployment.state !== "unread" &&
    deployment.state !== "reading" &&
    flow !== undefined &&
    flow.changesKnown !== false;
  // Until then the line says what this browser last saw it run, rather than
  // "Checking…" or the platform's name a release is about to replace.
  const line: StopRowLine =
    settled || input.remembered === undefined
      ? read
      : {
          word: read.word?.kind === "checking" ? undefined : read.word,
          runs: input.remembered,
          distance: read.distance,
        };
  // A release on its way is the badge's news too, before the platform has
  // seen a deploy start.
  const badge =
    line.word?.kind === "releasing"
      ? { tone: "pending" as const, word: line.word.text }
      : { tone: view.tone, word: view.word };
  return { declared, view, line, badge, settled };
}

/** A change's row, as the menu keys it and the jump box finds it: `repository#number`. */
function changeRowKey(pull: Pick<FlowPullRequest, "repository" | "number">): string {
  return `${pull.repository}#${String(pull.number)}`;
}

/** `groupFlow`'s own stop for a project: one of its stages, or its production. */
function flowStopOf(flow: GroupFlow, projectId: string): GroupFlowStop | undefined {
  const stage = flow.stages.find((entry) => entry.projectId === projectId);
  if (stage !== undefined) return stage;
  const { production } = flow;
  return "stop" in production && production.stop.projectId === projectId
    ? production.stop
    : undefined;
}

/** How the state word reads: a failure in the failure's own ink, the rest in the row's. */
const WORD_CLASS: Record<StopWordKind, string> = {
  failed: "text-[var(--zerops-status-failed-text)]",
  deploying: "text-sidebar-foreground",
  releasing: "text-sidebar-foreground",
  empty: "text-sidebar-muted-foreground",
  checking: "text-sidebar-muted-foreground",
};

/**
 * A stop's role as its pill, and its own name after it only where the name
 * says something the pill does not — `qa`, `stage 2`, `eu-west` — never
 * `production` beside `prod` (the owner, 2026-09-25).
 */
function StopTitle({ name, tag }: { readonly name: string; readonly tag: string | null }) {
  return (
    <>
      {tag === null ? null : <ZeropsRoleTag className="px-1" label={tag} />}
      {stopNameSaysOnlyRole(tag, name) ? null : (
        <span className="min-w-0 truncate text-sm leading-5 font-medium text-sidebar-foreground">
          {name}
        </span>
      )}
    </>
  );
}

/** The distance in words, for the chip that only says `+3`. */
function distanceWords(count: number): string {
  return `${String(count)} ${count === 1 ? "change" : "changes"} on main not here yet`;
}

/**
 * One listed stop: its row, and — opened from its distance — the changes it
 * does not run yet, one row each under it.
 *
 * Closed until somebody opens it, and not remembered: it answers a question
 * asked now. It closes itself once there is nothing behind, or nothing says
 * how far, since a list of zero changes is a control with nothing in it.
 */
function StopRowItem({
  projectId,
  projectName,
  name,
  tag,
  badge,
  line,
  view,
  marks,
  routes,
  release,
  railCap,
  onOpenStop,
  onOpenProject,
}: {
  readonly projectId: string;
  /** The Zerops project's own name, which the public routes are named after. */
  readonly projectName: string;
  readonly name: string;
  readonly tag: ReturnType<typeof environmentRoleTag>;
  readonly badge: { readonly tone: GroupRowTone; readonly word: string };
  readonly line: StopRowLine;
  /** What the stop runs as `stopView` read it, for the menu's detail and a placeholder's delay. */
  readonly view: StopView;
  /** Where each change stands on the stage; production's list only. */
  readonly marks: ReadonlyMap<string, StageMark> | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** The project's flow where *Release* is offered on this stop. */
  readonly release: SidebarProjectFlow | undefined;
  readonly railCap: RailCap;
  readonly onOpenStop: (() => void) | undefined;
  readonly onOpenProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { distance, word, runs } = line;
  if (open && distance === undefined) setOpen(false);
  const listed = open && distance !== undefined;
  const checking = word?.kind === "checking";
  return (
    <>
      <li
        className="group/stop flex h-8 min-w-0 items-center gap-3.5 rounded-md px-2.5 transition-colors hover:bg-sidebar-row-hover"
        data-zerops-project={projectId}
        data-zerops-surface="sidebar-environment"
      >
        {/* Centred on the row, because the Mate face directly above it is:
            two neighbouring rows may not have two rules for their first
            column. The gap after it is the Mate row's, so what follows starts
            on the Mates' text column — at `gap-2.5` it sat 4px left of theirs
            (the owner, 2026-09-25: "everything jumps around differently"). */}
        <RailCell cap={listed ? undefined : railCap}>
          <StopBadge tone={badge.tone} word={badge.word} />
        </RailCell>
        {/* Gaps of 4px: at the menu's 208px a production waiting on
            *Release* needs every one of them for its pill, its verb and the
            two end slots. */}
        <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] leading-4 text-sidebar-muted-foreground">
          {/* The pill and the name are the way into the stop, as the name
              alone was. */}
          {onOpenStop === undefined ? (
            <span className="flex min-w-0 shrink-0 items-center gap-1.5">
              <StopTitle name={name} tag={tag} />
            </span>
          ) : (
            <button
              className="flex max-w-[60%] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              data-zerops-surface="sidebar-stop-open"
              onClick={onOpenStop}
              type="button"
            >
              <StopTitle name={name} tag={tag} />
            </button>
          )}
          {word === undefined ? null : (
            <span
              className={cn(
                // The last thing on the line to give way, and only once what
                // runs has: at 208px "Checking what runs here…" beside a pill
                // and the two end slots does not fit whole, and a row may not
                // run past its own edge.
                "min-w-0 truncate",
                WORD_CLASS[word.kind],
                // A placeholder waits a beat before it says anything, so a
                // quick answer never flickers "Checking…".
                checking && view.afterMs > 0 && "animate-zerops-appear",
              )}
              data-zerops-surface="sidebar-stop-word"
              data-zerops-word-kind={word.kind}
              style={
                checking && view.afterMs > 0 ? { animationDelay: `${view.afterMs}ms` } : undefined
              }
            >
              {/* Checking says the platform's own words, which name a read
                  that failed where there was one. */}
              {checking ? view.line : word.text}
            </span>
          )}
          {/* What is actually running here — the question the row never
              answered (the owner, 2026-09-19: "nothing shows what version
              they run"). It gives way first when room runs out, and only it:
              the rest of the line is what a person acts on. */}
          {runs === undefined ? null : onOpenStop === undefined ? (
            <span
              className="min-w-0 shrink-[1000] truncate"
              data-zerops-surface="sidebar-environment-version"
            >
              {runs}
            </span>
          ) : (
            <button
              className="min-w-0 shrink-[1000] cursor-pointer truncate rounded-sm text-left underline-offset-2 hover:text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              data-zerops-surface="sidebar-environment-version"
              onClick={onOpenStop}
              type="button"
            >
              {runs}
            </button>
          )}
          {distance === undefined ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    aria-expanded={listed}
                    aria-label={distanceWords(distance.count)}
                    className="inline-flex h-4 shrink-0 cursor-pointer items-center rounded-full bg-sidebar-row-active px-1.5 text-[10px] leading-none font-medium text-sidebar-foreground tabular-nums outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-sidebar-foreground aria-expanded:text-sidebar"
                    data-zerops-surface="sidebar-stop-distance"
                    onClick={() => {
                      setOpen(!listed);
                    }}
                    type="button"
                  />
                }
              >
                {`+${String(distance.count)}`}
              </TooltipTrigger>
              <TooltipPopup side="right">{distanceWords(distance.count)}</TooltipPopup>
            </Tooltip>
          )}
          {/* The verb and the two end slots hold the row's end together, so
              the globes stand in one column whether or not a verb is there.
              2px between the verb and the globe: with 4px a production waiting
              on *Release* ran 1px past the row at 208px (measured
              2026-09-25). */}
          <span className="ms-auto flex shrink-0 items-center gap-0.5">
            {/* What is merged and not live is worn by *Release*, which is the
                thing that deals with it. */}
            {release === undefined ? null : (
              <ReleaseVerb
                contents={release.releaseContents}
                onRelease={release.onRelease}
                releaseTag={release.releaseTag}
                releasing={release.releasing}
              />
            )}
            {/* The row ends in two slots that are always there: the stop's
                menu, then the globe. Reserved, so nothing moves when the menu
                shows — "the globe jumping because of the dots is exactly the
                problematic detail" (the owner, 2026-09-25) — and the globe
                last, on the row's right edge, in the column every Mate's time,
                every change's Merge and every project's dot end in: in front of
                the menu's slot it stood 20 px short of them, a ragged edge down
                the menu (2026-09-28). */}
            <span className="flex shrink-0 items-center">
              {/* Invisible at rest, never gone: shown on hover and while anything
                  in the row has focus, its own button included, so a keyboard
                  reaches it. A finger never hovers, so a coarse pointer keeps it. */}
              <span
                className="flex w-5 shrink-0 justify-center opacity-0 transition-opacity group-focus-within/stop:opacity-100 group-hover/stop:opacity-100 pointer-coarse:opacity-100"
                data-zerops-surface="sidebar-stop-menu-slot"
              >
                <ZeropsStopMenu
                  name={name}
                  onOpenProject={onOpenProject}
                  onOpenStop={onOpenStop}
                  routes={routes}
                  stop={view}
                  triggerClassName={ROW_ACTION_CLASS}
                />
              </span>
              <span
                className="flex w-5 shrink-0 justify-center"
                data-zerops-surface="sidebar-stop-globe-slot"
              >
                <ZeropsRoutesMenu label={`Public access of ${projectName}`} routes={routes} />
              </span>
            </span>
          </span>
        </span>
      </li>
      {listed ? (
        <li data-zerops-surface="sidebar-stop-changes">
          <ul className="flex flex-col">
            {distance.changes.map((change, index) => (
              <StopChangeRow
                key={change.sha}
                mark={marks?.get(change.sha.toLowerCase())}
                railCap={
                  railCap === "end" && index === distance.changes.length - 1 ? "end" : undefined
                }
                title={change.title}
              />
            ))}
          </ul>
        </li>
      ) : null}
    </>
  );
}

/**
 * One change a stop does not run yet, by its title. Under production it says
 * where the change stands on the stage — run there, on its way there, or
 * failed there — so a person reads whether it has been seen running anywhere
 * before it goes live. Nothing is said where nothing is known.
 */
function StopChangeRow({
  title,
  mark,
  railCap,
}: {
  readonly title: string;
  readonly mark: StageMark | undefined;
  readonly railCap: RailCap;
}) {
  const shown = mark === undefined || mark === "none" ? undefined : STAGE_MARK[mark];
  return (
    <li
      className="flex h-7 min-w-0 items-center gap-3.5 px-2.5 text-[11px] leading-4"
      data-zerops-stage-mark={mark ?? "none"}
      data-zerops-surface="sidebar-stop-change"
    >
      {/* The line runs on past a list under a stop that is not the last. */}
      <RailCell cap={railCap} />
      {/* The title on the Mates' text column, the mark trailing it: a mark
          slot in front pushed every title 24px past the names above (the
          owner, 2026-09-25: "everything jumps around differently"). */}
      <span className="min-w-0 flex-1 truncate text-sidebar-foreground">{title}</span>
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        {shown === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={shown.word}
                  className={cn("inline-flex", shown.className)}
                  data-zerops-surface="sidebar-stop-change-mark"
                  role="img"
                />
              }
            >
              <shown.Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
            </TooltipTrigger>
            <TooltipPopup side="right">{shown.word}</TooltipPopup>
          </Tooltip>
        )}
      </span>
    </li>
  );
}

/** A change's mark under production, in the badge's own glyphs and tones. */
const STAGE_MARK: Record<
  Exclude<StageMark, "none">,
  { readonly word: string; readonly Icon: typeof CheckIcon; readonly className: string }
> = {
  "on-stage": {
    word: "On stage",
    Icon: STOP_ICON.good,
    className: "text-[var(--zerops-status-ok)]",
  },
  "deploying-on-stage": {
    word: "Deploying on stage",
    Icon: STOP_ICON.pending,
    className: "text-[var(--zerops-status-busy)]",
  },
  "failed-on-stage": {
    word: "Failed on stage",
    Icon: STOP_ICON.bad,
    className: "text-[var(--zerops-status-failed)]",
  },
};

/** What a stop being created says while it is: the page's own words. */
function creatingStopLine(tier: GroupEnvironmentTier): string {
  return tier === "production" ? PRODUCTION_SETTING_UP : STAGE_SETTING_UP;
}

/**
 * A stop being created, until the listing holds its project: its row's shape
 * — the badge on its way up, its name, "Setting up production…" or "Setting
 * up a stage…" — with no menu and no verb, there being nothing of it to reach
 * yet.
 */
function CreatingStopRow({
  member,
  tier,
  railCap,
}: {
  readonly member: ZeropsGroupPendingMember;
  readonly tier: GroupEnvironmentTier;
  readonly railCap?: RailCap;
}) {
  const line = creatingStopLine(tier);
  return (
    <li
      aria-busy="true"
      className="flex h-8 min-w-0 items-center gap-3.5 rounded-md px-2.5"
      data-zerops-project={member.projectId}
      data-zerops-surface="sidebar-environment-creating"
    >
      <RailCell cap={railCap}>
        <StopBadge tone="pending" word={line} />
      </RailCell>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <StopTitle
          name={member.name}
          tag={environmentRoleTag(tier === "production" ? "prod" : "stage")}
        />
        <span className="min-w-0 truncate text-[11px] leading-4 text-sidebar-muted-foreground">
          {line}
        </span>
      </span>
    </li>
  );
}

/**
 * A project heading's disclosure chevron: right while collapsed, down while
 * open — a tree's own gesture, since a project heading does have a level
 * below it. Shown on hover and focus, and always while collapsed, when it is
 * the only thing saying there is more.
 */
function DisclosureGlyph({ collapsed }: { readonly collapsed: boolean }) {
  const Glyph = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <Glyph
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 text-sidebar-muted-foreground transition-opacity",
        !collapsed &&
          "opacity-0 group-focus-within/project:opacity-100 group-hover/project:opacity-100 pointer-coarse:opacity-100",
      )}
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
