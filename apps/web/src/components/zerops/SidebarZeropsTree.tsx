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
import type { MateTintId } from "@t3tools/shared/brand";
import {
  ArrowUpIcon,
  BellOffIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  GitPullRequestIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
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
import { useOpenReview } from "~/zerops/review";
import { readCollapsedProjects, writeCollapsedProjects } from "~/zerops/collapsedProjects";
import {
  movedBefore,
  rememberProjectsOnScreen,
  useProjectOrder,
} from "~/zerops/projectOrderPreference";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { SidebarCrewLine, type SidebarCrewRead } from "./crew/SidebarCrewLine";
import { SidebarSelectedBand } from "./SidebarSelectedBand";
import { KeyChip, MateFace, PlanRing, StatusDot } from "./primitives";
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
import { SidebarProjectFold, type ProjectFoldMotion } from "./SidebarProjectFold";
import {
  changeMarkTone,
  mateRowView,
  ownerMark,
  type MateRowReply,
  type MateRowSlot,
} from "./SidebarMateRow.logic";
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
  comingMateLine,
  groupFlowInputOf,
  groupMemberFactsOf,
  nextStepAwaitsSomebody,
  nextStepTone,
  productionAddable,
  type GroupFlowReads,
} from "./projects/projectsView.logic";
import { groupAddsOffered } from "./ZeropsProjectRow.logic";
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
  /** Whether the project's *Release* is running. */
  readonly releasing: boolean;
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
  /**
   * Starts a new project: the list's last row (D11), where projects are, so
   * nothing in the logo row reads as the jump box's key's owner. Absent, the
   * list ends on its last project.
   */
  readonly onNewProject?: (() => void) | undefined;
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
   * Whether the menu lists this Mate — the account menu's Mine / Everyone
   * (`shownInScope`). Absent, every Mate.
   */
  readonly shown?: ((candidate: T) => boolean) | undefined;
  /**
   * A Mate's crew as a fixture draws it (a harness). Absent, each connected
   * Mate's crew line reads its own crew feed (`useCrew`).
   */
  readonly getCrew?: ((candidate: T) => SidebarCrewRead | undefined) | undefined;
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
type ChangeRows = Pick<SidebarProjectFlow, "onOpenChange"> & {
  readonly remembered?: true;
};

/** Change rows drawn from memory: their titles, untinted, until Gitea answers. */
const REMEMBERED_CHANGE_ROWS: ChangeRows = {
  onOpenChange: undefined,
  remembered: true,
};

export function SidebarZeropsTree<T extends RosterCandidate>({
  candidates,
  onSelect,
  onAddMate,
  onBrowseProjects,
  onNewProject,
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
  shown,
  getCrew,
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
  // The projects a heading's press set unfolding or folding, until they settle:
  // a folding project keeps its rows drawn until they have folded away.
  const [folds, setFolds] = useState<ReadonlyMap<string, ProjectFoldMotion>>(() => new Map());
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
  // folded into — then, once its row is drawn, the row takes the focus and
  // flashes once where it stands.
  const revealing = useSidebarReveal((state) => state.revealing);
  const focusAfterDraw = useRef<SidebarRevealTarget | null>(null);
  // The Mates in the order drawn — collapsed projects included — for the
  // header's "next one that waits", and everything the jump box finds here;
  // written after each render, not during it.
  const mateOrder = useRef<ReadonlyArray<string>>([]);
  const jumpIndex = useRef<SidebarJumpIndex>(EMPTY_JUMP_INDEX);
  const drawnForMemory = useRef<SidebarDrawn>(NOTHING_DRAWN);
  useEffect(() => {
    useSidebarReveal.getState().setMateOrder(mateOrder.current);
    useSidebarJump.getState().publish(jumpIndex.current);
    onDrawn?.(drawnForMemory.current);
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
      landing.flash.scrollIntoView({ block: "nearest" });
      flashOnce(landing.flash);
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

  // No project at all: nothing to list, and nothing to say but the one thing
  // to do — the list's own last row, alone.
  if (nothing === "no-projects") {
    return onNewProject === undefined ? null : (
      <nav aria-label="Mates" className={cn("relative flex flex-col pt-1.5", className)}>
        <NewProjectRow onNewProject={onNewProject} />
      </nav>
    );
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

  // Each drawn Mate's number, top to bottom, for the ⌥ chips.
  let numbered = 0;
  const mateKeys: MateRowKeys = {
    move: (from, direction) => {
      const rows = mateRows();
      const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(from) + direction))];
      if (next === undefined || next === from) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
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
    // The list's last project, which keeps less room below its rows.
    last: boolean,
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
    const fold = folds.get(id);
    // A fragment either way, so the heading keeps its node — and the focus of
    // the press that folded it — whether its rows are drawn or not.
    if (group !== undefined && collapsed.has(id) && fold !== "closing") return <>{header}</>;
    const quietOpen = openQuiet.has(id);
    const slots: ReadonlyArray<MateSlot<T>> = [
      ...loud.map(({ item }) => ({ kind: "mate" as const, item })),
      ...coming.map((member) => ({ kind: "coming" as const, member })),
      ...(quiet.length === 0 ? [] : [{ kind: "fold" as const, count: quiet.length }]),
      ...(quietOpen ? quiet.map(({ item }) => ({ kind: "mate" as const, item })) : []),
    ];
    // Each block — a Mate with its changes, one being created, the quiet
    // fold, the changes nobody's Mate owns, the stops — stands apart from the
    // next by air alone: 10 px, which with a row's own 10 px above and below
    // its words puts 30 px between one Mate's words and the next's, whatever
    // hangs under the first (M16). The heading stands on the first.
    const blocks: Array<{ readonly key: string; readonly node: ReactNode }> = [
      ...slots.map((slot) => {
        if (slot.kind === "coming") {
          return {
            key: `coming:${slot.member.projectId}`,
            node: <ComingMateRow coming={slot.member} name={slot.member.name} />,
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
                onSelect={onSelect}
                owner={getOwner?.(item)}
                timestampFormat={timestampFormat}
                tint={tints.get(item.project.id) ?? "slate"}
              />
              {/* Its crew, one line right under it, before its changes. */}
              {item.group === "connected" && item.environmentId !== undefined ? (
                <SidebarCrewLine environmentId={item.environmentId} read={getCrew?.(item)} />
              ) : null}
              {pulls.length === 0 || changeRows === undefined ? null : (
                <PullRequestList
                  groupId={id}
                  onToggle={() => {
                    toggle(listKey);
                  }}
                  open={openLists.has(listKey)}
                  onOpenChange={changeRows.onOpenChange}
                  pulls={pulls}
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
                  {grouped.others.map((pull) => (
                    <PullRequestRow
                      groupId={id}
                      key={`${pull.repository}#${pull.number}`}
                      onOpenChange={changeRows.onOpenChange}
                      pull={pull}
                      remembered={changeRows.remembered === true}
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
        </SidebarProjectFold>
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
              const folding = !collapsed.has(groupId);
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
        groupNameIsPlaceholder(group) ? undefined : group.name,
        group,
        index === groups.length - 1 && !ungroupedMates,
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
  drawnForMemory.current = { changes: drawnChanges, stops: drawnStops };

  return (
    <nav
      aria-label="Mates"
      // The list starts 6 px under the logo row, as the plan's menu does. Its
      // own stacking context, so the selected band stands behind every row.
      className={cn("relative isolate flex flex-col pt-1.5", className)}
      data-zerops-surface="sidebar-environments"
      ref={treeRef}
    >
      <SidebarSelectedBand current={activeProjectId} />
      {groupSections}
      {ungroupedSection}

      {/* Rows already held, and the listing not all read: they may not be all
          the Mates there are, so the notice stays under them (§3.4). */}
      {notice === null ? null : (
        <ListingNotice className="mt-6" notice={notice} onAct={onNoticeAct} />
      )}
      {onNewProject === undefined ? null : <NewProjectRow onNewProject={onNewProject} />}
      {reorder.overlay}
    </nav>
  );
}

/**
 * *New project*, the list's last row (D11): a + in the faces' 28 px column and
 * the words on the menu's text edge, 13 px and muted until pointed at — a row
 * like the others, 4 px under the last project.
 */
function NewProjectRow({ onNewProject }: { readonly onNewProject: () => void }) {
  return (
    <button
      className="mt-1 flex h-7 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg ps-1.75 pe-2 text-left text-line text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
      data-zerops-surface="sidebar-new-project"
      onClick={onNewProject}
      type="button"
    >
      <span className="flex w-7 shrink-0 justify-center">
        <PlusIcon aria-hidden="true" className="size-3.5" />
      </span>
      <span className="min-w-0 truncate">New project</span>
    </button>
  );
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
    // The title on the menu's mark edge (x = 16: 7 px inside the list's own
    // 9), the heading 32 px tall, and its end 12 px short of the menu's edge.
    <div
      className="group/project relative flex h-8 min-w-0 items-center gap-1 ps-1.75 pe-1"
      data-collapsed={collapsed ? "true" : undefined}
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
        </button>
      )}
      {/* Hidden until hover keeps a list of five projects calm, but a finger
          never hovers — so a coarse pointer gets them at rest. A slot that is
          always there: nothing moves when they show. */}
      {muted ? null : (
        <span className="relative z-1 flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={`Add a Mate to ${title}`}
                  className={HEADING_ACTION_CLASS}
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
      <span aria-hidden="true" className="min-w-0 flex-1" />
      {/* Always on, unlike the verbs before it: this says something is waiting
          on the person, which is not a fact that should hide until they hover.
          Last, so at rest it sits on the end edge, over the Mates' times. */}
      {nextStep === undefined || !nextStepAwaitsSomebody(nextStep.kind) ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <StatusDot
                className="relative z-1 shrink-0"
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
 * the focus, and the row that was asked for flashes once — a Mate's own row,
 * a project's heading, a stop's row, a change's row with its *Review*.
 */
interface RevealLanding {
  readonly focus: HTMLElement;
  readonly flash: HTMLElement;
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
      const row = find(
        `[data-zerops-surface="sidebar-environment"][data-zerops-project="${target.projectId}"]`,
      );
      if (row === null) return null;
      const open =
        row.querySelector<HTMLElement>('[data-zerops-surface="sidebar-stop-open"]') ??
        row.querySelector<HTMLElement>('button[data-zerops-surface="sidebar-environment-version"]');
      return { focus: open ?? row, flash: row };
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
const HEADING_MUTED = "text-[13px] font-medium tracking-normal text-sidebar-muted-foreground";
const HEADING_UNNAMED = "font-normal text-sidebar-muted-foreground italic";

const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

/** A heading's verbs, + and ⋯: 28 px, a row's hover behind them, muted until pointed at. */
const HEADING_ACTION_CLASS =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover data-popup-open:text-sidebar-foreground";

function MateRow<T extends RosterCandidate>({
  candidate,
  tint,
  active,
  activity,
  onSelect,
  owner,
  timestampFormat,
  actions,
  appUrl,
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
  readonly timestampFormat: TimestampFormat;
  /** Its menu's verbs; absent, the row carries no menu (a harness, a test). */
  readonly actions?: MateRowActions | undefined;
  /** Its app — its pair's stage route — where it has one. */
  readonly appUrl?: string | undefined;
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
  // What the row says in its state (`mateRowView`, M7): the face, the right
  // of the name, what was asked and the third line.
  const view = mateRowView(live, mateFaceFor(candidate.group === "connected", activity));
  const known = live !== undefined && live.remembered !== true;
  // A new ask rises into the row's second line as the person sets it; the
  // ask this browser remembered gives way to the one read without a rise.
  const askChanged = useChangedSinceShown(view.ask, known);
  // The plan as a ring around the face while it works: one segment a step.
  const progress = view.face === "working" ? live?.progress : undefined;
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
        if (actions === undefined || event.pointerType !== "touch") return;
        longPress.current.fired = false;
        cancelLongPress();
        longPress.current.timer = setTimeout(() => {
          longPress.current.fired = true;
          openMenu();
        }, 480);
      }}
      onPointerLeave={cancelLongPress}
      onPointerMove={(event) => {
        if (event.pointerType === "touch" && event.movementY !== 0) cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
    >
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          // Two columns: the face's 28 px, then the words. The face stands at
          // the top, on the name's line, whatever number of lines follow it —
          // centred on the row it sat beside the question in a three-line row
          // and beside the name in a one-line one. Faces stand at 16 px from
          // the menu's edge and every word at 56 (the list starts at 9).
          "menu-row grid w-full min-w-0 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 py-2.5 ps-1.75 pe-2 text-left outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          // The open Mate's row is lit by the list's one band, which slides
          // to it (`SidebarSelectedBand`); a row lights only under the pointer.
          active
            ? "bg-transparent text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground group-hover/mate:bg-sidebar-row-hover group-has-[[data-popup-open]]/mate:bg-sidebar-row-hover",
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
          // The eye is on this Mate now: "the next one that waits" starts here.
          useSidebarReveal.getState().setCursor(candidate.project.id);
        }}
        ref={rowButton}
        type="button"
      >
        <span className="relative flex size-7">
          {/* The Mate wears the card's face rather than a row's, whole: the
              person it belongs to stands before its name instead of on its
              corner. A ring, when it works, stands 4px clear all round, over
              the row's own padding, so it never moves a line. */}
          <span className="relative flex">
            {/* Until its socket answers the face stands in idle or asleep, the
                row's words as this browser remembered them: a Mate found
                waiting then is not arriving at it. */}
            <MateFace
              greets
              known={
                candidate.group === "connected" &&
                activity !== undefined &&
                activity.remembered !== true
              }
              size="md"
              state={view.face}
              tint={tint}
            />
            {progress === undefined ? null : (
              <span className="absolute -inset-1 flex" data-zerops-surface="sidebar-mate-ring">
                <PlanRing completed={progress.completed} total={progress.total} />
              </span>
            )}
          </span>
        </span>
        {/* One even leading, three lines of one thing: the name 14/20, what
            was asked 13/18, the answer 13/18, and no gap between them — the
            name used to float over a paragraph on a 22 px line and 2 px of
            air. The ask is the words' second ink, the answer muted. */}
        <span className="flex min-w-0 flex-col">
          <span className="flex h-5 min-w-0 items-center gap-2">
            <span
              className={cn("flex min-w-0 flex-1 items-center gap-1.5", renaming && "invisible")}
            >
              <MateOwnerMark owner={owner} />
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
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.75",
                  numbers && number !== undefined && "opacity-0",
                )}
              >
                <MateDot known={known} tone={view.dot} />
                <MateSlot at={live?.at} slot={view.slot} timestampFormat={timestampFormat} />
              </span>
              {numbers && number !== undefined ? (
                <KeyChip className="absolute end-0 top-0" data-zerops-surface="sidebar-mate-number">
                  {String(number)}
                </KeyChip>
              ) : null}
            </span>
          </span>
          {view.ask === undefined ? null : (
            <span
              className={cn(
                "menu-ink-2 truncate text-line leading-4.5",
                askChanged && "animate-words-in motion-reduce:animate-none",
              )}
              data-zerops-surface="sidebar-mate-subject"
              key={view.ask}
            >
              {view.ask}
            </span>
          )}
          {view.reply === undefined ? null : (
            <MateReply known={known} reply={view.reply} threadKey={live?.threadKey} />
          )}
        </span>
      </button>
      {actions === undefined ? null : (
        <span
          className="absolute end-2 top-2.5 flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100"
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
 * Whose Mate it is, before its name: the person's picture, 16 px round, or
 * their initial on a colour of their own (`ownerMark`) — on every row, so a
 * face you recognise answers "whose" before the name is read, and every name
 * starts on one edge. Off the face, which it used to cover a quarter of with
 * 7 px initials. A Mate whose owner nobody could name keeps the mark's place
 * as a plain disc, so its name starts where every other does and nothing
 * moves when the owner is read.
 *
 * The initial is part of a mark, not text: 9 px inside a 16 px disc, the one
 * size under the menu's scale (S1), as a picture would be.
 */
function MateOwnerMark({ owner }: { readonly owner: ZeropsMateOwner | undefined }) {
  const [failed, setFailed] = useState(false);
  if (owner === undefined) {
    return (
      <span
        aria-hidden="true"
        className="menu-owner"
        data-zerops-avatar="none"
        data-zerops-surface="sidebar-mate-owner"
      />
    );
  }
  const mark = ownerMark(owner);
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
}: {
  readonly slot: MateRowSlot;
  /** When it last did something, for the age. */
  readonly at: string | undefined;
  readonly timestampFormat: TimestampFormat;
}) {
  switch (slot.kind) {
    case "none":
      return null;
    case "clock":
      return <MateWorkingTime since={slot.since} />;
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
            <span className="sr-only">{`Paused at a usage limit, picks up ${upcoming}`}</span>
          </TooltipTrigger>
          <TooltipPopup side="right">{`Paused at a usage limit. Picks up ${upcoming}.`}</TooltipPopup>
        </Tooltip>
      );
    }
    case "age": {
      const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at));
      return when.length === 0 ? null : (
        <span className={TIME_CLASS} data-zerops-surface="sidebar-mate-time">
          {when}
        </span>
      );
    }
  }
}

const TIME_CLASS = "shrink-0 text-line leading-5 text-muted-foreground tabular-nums";

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
      className="shrink-0 text-line leading-5 text-sidebar-foreground tabular-nums"
      data-zerops-surface="sidebar-mate-time"
    >
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
const REPLY_TONE_CLASS: Record<"muted" | "ink-2" | "ink" | "failed", string> = {
  muted: "text-muted-foreground",
  "ink-2": "menu-ink-2",
  ink: "text-sidebar-foreground",
  failed: "text-status-failed-text",
};

/**
 * The row's third line (`mateRowView`): the Mate's last words in its state's
 * ink — the question it waits on, the error it stopped on — or, while it
 * works, the step it is on, its command in mono under a sweep of light (D5);
 * or the dots holding the line while words are still to come. While a
 * message to it waits unsent in its composer, that draft stands in for its
 * words or its dots, led by *Draft:*: never over a question, an error or a
 * live step, and never growing a row — the composer holds it anyway.
 */
function MateReply({
  reply,
  threadKey,
  known,
}: {
  readonly reply: NonNullable<MateRowReply>;
  readonly threadKey: string | undefined;
  /** The words are the Mate's as read, not what this browser remembered them saying. */
  readonly known: boolean;
}) {
  const draft = useComposerDraftStore((state) =>
    threadKey === undefined ? undefined : state.draftsByThreadKey[threadKey]?.prompt,
  );
  const unsent = draft?.trim() ?? "";
  // The Mate's newest words rise into their line when they arrive, as its
  // status line's do in the chat; what the menu opened onto is simply there,
  // and remembered words give way to the read ones without a rise. Only its
  // words: a draft is the person's own typing and changes with every key.
  const words = reply.kind === "words" ? reply.text : reply.kind === "live" ? reply.words : null;
  const wordsChanged = useChangedSinceShown(words, known);
  const drafting =
    unsent.length > 0 &&
    (reply.kind === "pending" ||
      (reply.kind === "words" && (reply.tone === "muted" || reply.tone === "ink-2")));
  if (reply.kind === "pending" && !drafting) return <MateReplyPending />;
  if (reply.kind === "live") {
    return (
      <span
        className={cn(
          "truncate text-line leading-4.5 text-muted-foreground",
          wordsChanged && "animate-words-in motion-reduce:animate-none",
        )}
        data-run-shimmer=""
        data-zerops-surface="sidebar-mate-live-step"
        key={`live:${reply.words}`}
      >
        {reply.words}
        {reply.code === undefined ? null : (
          <>
            {" · "}
            <span className="font-mono">{reply.code}</span>
          </>
        )}
      </span>
    );
  }
  return (
    // The words keep their node while a draft stands over them in the same
    // cell, so clearing the draft does not replay their rise.
    <span className="grid min-w-0 text-line leading-4.5">
      {reply.kind === "words" ? (
        <span
          aria-hidden={drafting ? true : undefined}
          className={cn(
            "col-start-1 row-start-1 truncate",
            REPLY_TONE_CLASS[reply.tone],
            drafting && "invisible",
            wordsChanged && "animate-words-in motion-reduce:animate-none",
          )}
          data-zerops-reply-tone={reply.tone}
          data-zerops-surface={drafting ? undefined : "sidebar-mate-snippet"}
          key={`words:${reply.text}`}
        >
          {reply.text}
        </span>
      ) : null}
      {drafting ? (
        <span
          className="col-start-1 row-start-1 truncate text-muted-foreground"
          data-zerops-surface="sidebar-mate-snippet"
        >
          <span className="font-medium text-sidebar-foreground">Draft:</span> {unsent}
        </span>
      ) : null}
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
}: {
  readonly name: string;
  readonly coming: GroupFlowComing;
}) {
  return (
    <div
      aria-busy="true"
      className="grid w-full min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 py-2.5 ps-1.75 pe-2 text-sidebar-foreground select-none"
      data-zerops-surface="sidebar-mate-coming"
    >
      <span className="relative flex size-7">
        <MateFace size="md" state="sleep" tint="slate" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate text-sm leading-5 font-medium">{name}</span>
        <span className="truncate text-line leading-4.5 text-muted-foreground">
          {comingMateLine(coming)}
        </span>
      </span>
    </div>
  );
}

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
  remembered = false,
}: {
  /** The project whose repository they are open against, for *Review*. */
  readonly groupId: string;
  readonly pulls: ReadonlyArray<FlowPullRequest>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** Drawn from memory until Gitea answers: no tint, and the title opens nothing yet. */
  readonly remembered?: boolean;
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
          <span className="truncate">{`${String(pulls.length)} pull requests`}</span>
        </button>
      ) : null}
      {!folded || open ? (
        <ul className="flex flex-col">
          {pulls.map((pull) => (
            <PullRequestRow
              groupId={groupId}
              key={`${pull.repository}#${pull.number}`}
              onOpenChange={onOpenChange}
              pull={pull}
              remembered={remembered}
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
 * in the review. The mark alone may say that something is wrong (S3): red
 * where its checks fail, amber where it fell behind `main`. A person's own
 * pull request names them after the title — there is no room for a line.
 */
function PullRequestRow({
  pull,
  groupId,
  onOpenChange,
  remembered = false,
}: {
  readonly pull: FlowPullRequest;
  /** The project whose repository it is open against, for *Review*. */
  readonly groupId: string;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** Drawn from memory until Gitea answers: its title, and no verdict it may no longer have. */
  readonly remembered?: boolean;
}) {
  const openReview = useOpenReview();
  const label = sidebarChangeLabel(pull);
  const tone = changeMarkTone(pull, remembered);
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
          tone === "failed"
            ? "text-status-failed-text"
            : tone === "attention"
              ? "text-status-attention-text"
              : "text-muted-foreground",
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
    </li>
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
      {stops.map((row) => {
        if (row.kind === "creating") {
          return <CreatingStopRow key={row.member.projectId} member={row.member} tier={row.tier} />;
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
        <span className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
          <StopBadge tone={badge.tone} word={badge.word} />
        </span>
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
            {distance.changes.map((change) => (
              <StopChangeRow
                key={change.sha}
                mark={marks?.get(change.sha.toLowerCase())}
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
}: {
  readonly title: string;
  readonly mark: StageMark | undefined;
}) {
  const shown = mark === undefined || mark === "none" ? undefined : STAGE_MARK[mark];
  return (
    <li
      className="flex h-7 min-w-0 items-center gap-3.5 px-2.5 text-[11px] leading-4"
      data-zerops-stage-mark={mark ?? "none"}
      data-zerops-surface="sidebar-stop-change"
    >
      <span aria-hidden="true" className="w-5 shrink-0" />
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
}: {
  readonly member: ZeropsGroupPendingMember;
  readonly tier: GroupEnvironmentTier;
}) {
  const line = creatingStopLine(tier);
  return (
    <li
      aria-busy="true"
      className="flex h-8 min-w-0 items-center gap-3.5 rounded-md px-2.5"
      data-zerops-project={member.projectId}
      data-zerops-surface="sidebar-environment-creating"
    >
      <span className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
        <StopBadge tone="pending" word={line} />
      </span>
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
