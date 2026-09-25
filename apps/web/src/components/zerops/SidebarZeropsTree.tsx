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
import type { MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import { readCollapsedProjects, writeCollapsedProjects } from "~/zerops/collapsedProjects";
import { useProjectOrderPreference } from "~/zerops/projectOrderPreference";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { Avatar, MateFace, StatusDot } from "./primitives";
import { RAIL_BLANK, RAIL_LINE } from "./rail";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { environmentRoleTag, groupNameIsPlaceholder } from "./ZeropsGroupTree.logic";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { stopNameSaysOnlyRole } from "./SidebarZeropsTree.logic";
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
import { ZeropsRouteMenuItems, ZeropsRoutesMenu } from "./ZeropsPublicRoutes";
import { MenuGroup, MenuGroupLabel, MenuSeparator } from "../ui/menu";

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
  mayCreate = false,
  health = NO_HEALTH,
  complete,
  notice = null,
  onNoticeAct,
  className,
  births = NO_BIRTHS,
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
  // Same preference the projects screen's sort control writes
  // (`projectOrderPreference.ts`) — read here too so the two surfaces stay in
  // step without either one owning the other.
  const [projectOrder] = useProjectOrderPreference();
  // What each stop runs, read once per render and handed to `groupFlow` and
  // to every stop's own row, so the two can never read two different answers
  // for the same project.
  const deployments = useZeropsProjectFlowOptional()?.deployments;

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
    order: projectOrder,
    births,
  });
  const tints = assignCandidateMateTints(candidates);

  const toggle = (key: string) => {
    setOpenLists((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    const mateEntries = entries.filter(({ item }) => hasMate(item));
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
    // Collapsed, a project is its heading and nothing else — no summary and
    // no small badges: a second, smaller design of the same rows is what the
    // owner turned down (2026-09-25). The dot on the heading still says
    // whether it waits on somebody.
    if (group !== undefined && collapsed.has(id)) return header;
    // Code only — a recipe change is the group's document, left to the
    // projects page, and is never one more thing a Mate's row here answers
    // for.
    const flowPulls = projectFlow.pullRequests.map((entry) => entry.pull);
    const grouped = pullRequestsByMate(
      flowPulls,
      mateEntries.map(({ item }) => item.project.id),
    );
    // Which row the spine ends on: the last stop where a project has one,
    // then a change nobody's Mate owns, then the last Mate's own last row. A
    // line that runs past its final node into the gap below reads as a list
    // that got cut off rather than as work arriving somewhere.
    const otherPulls = flow === undefined ? [] : grouped.others;
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
    return (
      <>
        {header}
        {mateEntries.map(({ item }, index) => {
          const pulls = grouped.byMate.get(item.project.id) ?? [];
          const listKey = `${id}:${item.project.id}`;
          const first = index === 0;
          const last = endsOnMates && index === mateCount - 1;
          const ownRow = pulls.length === 0 || flow === undefined;
          return (
            <div className="flex flex-col" key={item.key}>
              <MateRow
                active={item.project.id === activeProjectId}
                activity={getActivity?.(item)}
                candidate={item}
                onSelect={onSelect}
                owner={getOwner?.(item)}
                railCap={railCapFor({ first, last: last && ownRow })}
                tint={tints.get(item.project.id) ?? "slate"}
              />
              {pulls.length === 0 || flow === undefined ? null : (
                <PullRequestList
                  merging={flow.merging}
                  onMerge={flow.onMerge}
                  onToggle={() => {
                    toggle(listKey);
                  }}
                  open={openLists.has(listKey)}
                  onAsk={flow.onAsk}
                  onOpenChange={flow.onOpenChange}
                  pulls={pulls}
                  railCap={last ? "end" : undefined}
                />
              )}
            </div>
          );
        })}
        {coming.map((member, index) => {
          const at = mateEntries.length + index;
          return (
            <ComingMateRow
              coming={member}
              key={`coming:${member.projectId}`}
              name={member.name}
              railCap={railCapFor({ first: at === 0, last: endsOnMates && at === mateCount - 1 })}
            />
          );
        })}
        {grouped.others.length === 0 || flow === undefined ? null : (
          // Nobody's Mate's: a person's own branch. Indented under the last
          // Mate it read as that Mate's work, which is a lie the row's own
          // `· ada` could not undo at 256px, where it is truncated away.
          // The dedent is the whole signal; a rule as well would make this
          // read as the start of the stops, which is the next block's rule.
          <ul className="flex flex-col" data-zerops-surface="sidebar-other-pull-requests">
            {grouped.others.map((pull, index) => (
              <PullRequestRow
                key={`${pull.repository}#${pull.number}`}
                merging={flow.merging(pull)}
                onAsk={flow.onAsk}
                onMerge={flow.onMerge}
                onOpenChange={flow.onOpenChange}
                pull={pull}
                railCap={
                  stopRows.length === 0 && index === otherPulls.length - 1 ? "end" : undefined
                }
                underMate={false}
              />
            ))}
          </ul>
        )}
        {stopRows.length > 0 ? (
          <EnvironmentRows
            deployments={deployments}
            flow={flow}
            groupName={groupName}
            onOpenProject={onBrowseProjects}
            projectFlow={projectFlow}
            stops={stopRows}
          />
        ) : null}
      </>
    );
  };

  const groups = view.groups.filter(
    ({ group, environments }) =>
      environments.some(({ item }) => hasMate(item)) ||
      group.pending.some((member) => member.kind === "mate"),
  );
  const ungrouped = view.ungrouped.map((item) => ({ item, role: undefined }));
  const ungroupedMates = ungrouped.some(({ item }) => hasMate(item));

  return (
    <nav
      aria-label="Mates"
      className={cn("flex flex-col gap-4", className)}
      data-zerops-surface="sidebar-environments"
    >
      {groups.map(({ group, environments }) => (
        <section className="flex flex-col" data-zerops-group={group.groupId} key={group.groupId}>
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
              />
            ),
            getFlow?.(group.groupId),
            groupNameIsPlaceholder(group) ? undefined : group.name,
            group,
          )}
        </section>
      ))}

      {ungroupedMates ? (
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
          )}
        </section>
      ) : null}

      {/* Rows already held, and the listing not all read: they may not be all
          the Mates there are, so the notice stays under them (§3.4). */}
      {notice === null ? null : <ListingNotice notice={notice} onAct={onNoticeAct} />}
    </nav>
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
}) {
  const placeholder = group !== undefined && groupNameIsPlaceholder(group);
  const title = group?.name ?? name ?? "";
  return (
    <div
      className="group/project mb-0.5 flex h-8 min-w-0 items-center gap-1 px-2.5"
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
}: {
  readonly candidate: T;
  readonly tint: MateTintId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly onSelect: (candidate: T) => void;
  readonly owner: ZeropsMateOwner | undefined;
  readonly railCap?: RailCap;
}) {
  const tags = readZeropsGroupTags(candidate.project.tagList);
  const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
  // What it is on, or was last on, and since when — knowable only through an
  // open socket, and only once somebody has spoken to it.
  const live = candidate.group === "connected" ? activity : undefined;
  const subject = live?.subject;
  const snippet = subject === undefined ? undefined : live?.snippet;
  const when =
    live === undefined || live.subject === undefined
      ? undefined
      : compactSidebarTimeLabel(formatRelativeTimeLabel(live.at));

  return (
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
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
      )}
      data-zerops-surface="sidebar-mate"
      onClick={() => onSelect(candidate)}
      type="button"
    >
      <RailCell cap={railCap}>
        {/* The Mate is the node the rest of its project hangs from, so it
            wears the card's face rather than a row's, and the person it
            belongs to rides on its corner (a teammate, 2026-09-24). The column
            stays 20px: the spine keeps its x, and the face overhangs it. */}
        <span className="relative flex">
          <MateFace
            size="md"
            state={mateFaceFor(candidate.group === "connected", activity)}
            tint={tint}
          />
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
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">{name}</span>
          {when === undefined || when.length === 0 ? null : (
            <span
              className="shrink-0 text-[11px] leading-5 text-sidebar-muted-foreground tabular-nums"
              data-zerops-surface="sidebar-mate-time"
            >
              {when}
            </span>
          )}
        </span>
        {subject === undefined ? null : (
          <span
            className="truncate text-xs leading-4 text-sidebar-muted-foreground"
            data-zerops-surface="sidebar-mate-subject"
          >
            {subject}
          </span>
        )}
        {snippet === undefined ? null : (
          <span
            className="truncate text-xs leading-4 text-sidebar-muted-foreground/70"
            data-zerops-surface="sidebar-mate-snippet"
          >
            {snippet}
          </span>
        )}
      </span>
    </button>
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
        <span className="min-w-0 truncate text-sm leading-5 font-medium">{name}</span>
        <span className="truncate text-xs leading-4 text-sidebar-muted-foreground">
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
}) {
  const folded = pullRequestsFolded(pulls.length);
  const listed = !folded || open;
  return (
    <div className="flex flex-col" data-zerops-surface="sidebar-pull-requests">
      {folded ? (
        <button
          aria-expanded={open}
          className="flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
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
}: {
  readonly pull: FlowPullRequest;
  readonly merging: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  readonly onAsk?: ((pull: FlowPullRequest, ask: string) => void) | undefined;
  readonly onOpenChange?: ((pull: FlowPullRequest) => void) | undefined;
  /** False for a change that is nobody's Mate's, which hangs under nothing. */
  readonly underMate?: boolean;
  readonly railCap?: RailCap;
}) {
  const tone = checkDotTone({ checks: pull.checks });
  const label = sidebarChangeLabel(pull);
  const blocked = pullRequestBlocked(pull);
  return (
    <li
      className={cn("flex h-7 min-w-0 items-center gap-2.5 px-2.5 text-xs", !underMate && "pe-0.5")}
      data-zerops-surface="sidebar-pull-request"
    >
      <RailFork cap={railCap} />
      {onOpenChange === undefined ? (
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">{label}</span>
      ) : (
        <button
          className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sidebar-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
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
      {pull.mergeability === "mergeable" ? (
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
  const Icon = STOP_ICON[tone];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={word}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
              STOP_BADGE_CLASS[tone],
            )}
            data-zerops-surface="sidebar-stop-badge"
            data-zerops-status-tone={tone}
            role="img"
          />
        }
      >
        <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
      </TooltipTrigger>
      <TooltipPopup side="right">{word}</TooltipPopup>
    </Tooltip>
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
 * The stop's own menu — the thing the rows did not have.
 *
 * "Still there is no more menu on prod / stage that would allow me to do
 * stuff" (the owner, 2026-09-19). It holds what a row has no width for: what
 * is actually running, spelled out, and every public URL, which is also the
 * keyboard's way to them. The changes a stop does not run yet are its
 * distance's to list, opened on the row itself.
 */
function StopMenu({
  name,
  stop,
  routes,
  onOpenProject,
  onOpenStop,
}: {
  readonly name: string;
  /** What the stop runs, or the line that stands in for it while that is not known. */
  readonly stop: StopView;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly onOpenProject: () => void;
  readonly onOpenStop: (() => void) | undefined;
}) {
  // `v1.4.0 · 77ab0e1 · tagged by ada` — the whole of what one row abbreviates.
  const version = stop.version;
  const detail =
    version?.label === undefined
      ? stop.line
      : [
          version.label,
          version.name === undefined ? undefined : version.commit,
          version.taggedBy === undefined ? undefined : `tagged by ${version.taggedBy}`,
        ]
          .filter((part) => part !== undefined)
          .join(" · ");
  return (
    <Menu>
      <MenuTrigger
        aria-label={`More for ${name}`}
        className={ROW_ACTION_CLASS}
        data-zerops-surface="sidebar-stop-more"
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-[24rem] min-w-56">
        <MenuGroup data-zerops-surface="sidebar-stop-running">
          <MenuGroupLabel>Running</MenuGroupLabel>
          {/* A fact, not a door: the commit's page in Gitea is a sign-in page
              for everybody, and the environment's own page is right below. */}
          <MenuItem disabled>{detail}</MenuItem>
          {/* The question people actually ask of a version is what came before
              it, and a commit page answers only for one — and, with no Gitea
              session in the browser, answers it with a sign-in page. */}
          {onOpenStop === undefined ? null : (
            <MenuItem onClick={onOpenStop}>Open this environment</MenuItem>
          )}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={onOpenProject}>Open in Zerops</MenuItem>
        {routes.length === 0 ? null : (
          <>
            <MenuSeparator />
            <ZeropsRouteMenuItems routes={routes} />
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

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
        const declared = flow?.environments.get(projectId);
        // What each stop runs is the platform's answer, joined with the row
        // the deploy half read (`stopView`): a stop not yet read holds its
        // line and never reads as one with nothing deployed.
        const view = stopView({
          deployment: deployments?.get(projectId) ?? UNREAD_DEPLOYMENT,
          row: declared,
          nowMs,
        });
        const flowStop = flowStopOf(projectFlow, projectId);
        const line: StopRowLine =
          tier === undefined || flowStop === undefined
            ? { word: undefined, runs: view.line, distance: undefined }
            : stopRowLine({
                tier,
                stop: flowStop,
                releasing: tier === "production" ? flow?.releaseInFlight : undefined,
                distance: flow?.distances?.get(projectId),
              });
        return (
          <StopRowItem
            badge={
              // A release on its way is the badge's news too, before the
              // platform has seen a deploy start.
              line.word?.kind === "releasing"
                ? { tone: "pending", word: line.word.text }
                : { tone: view.tone, word: view.word }
            }
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
        className="group/stop flex h-7 min-w-0 items-center gap-3.5 rounded-md px-2.5 transition-colors hover:bg-sidebar-row-hover"
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
            {/* The row ends in two slots that are always there: the globe, and
                the stop's menu. Reserved, so the globes stand in one column down
                every stop and nothing moves when the menu shows — "the globe
                jumping because of the dots is exactly the problematic detail"
                (the owner, 2026-09-25). */}
            <span className="flex shrink-0 items-center">
              <span
                className="flex w-5 shrink-0 justify-center"
                data-zerops-surface="sidebar-stop-globe-slot"
              >
                <ZeropsRoutesMenu label={`Public access of ${projectName}`} routes={routes} />
              </span>
              {/* Invisible at rest, never gone: shown on hover and while anything
                  in the row has focus, its own button included, so a keyboard
                  reaches it. A finger never hovers, so a coarse pointer keeps it. */}
              <span
                className="flex w-5 shrink-0 justify-center opacity-0 transition-opacity group-focus-within/stop:opacity-100 group-hover/stop:opacity-100 pointer-coarse:opacity-100"
                data-zerops-surface="sidebar-stop-more-slot"
              >
                <StopMenu
                  name={name}
                  onOpenProject={onOpenProject}
                  onOpenStop={onOpenStop}
                  routes={routes}
                  stop={view}
                />
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
      className="flex h-6 min-w-0 items-center gap-3.5 px-2.5 text-[11px] leading-4"
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
      className="flex h-7 min-w-0 items-center gap-3.5 rounded-md px-2.5"
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
