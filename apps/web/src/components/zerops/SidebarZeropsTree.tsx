/**
 * The left menu's projects, each as a timeline: the Mates, what each has
 * waiting to land, and the environments the code travels to (D26).
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
 * requests that are nobody's Mate's, a person's own branch. Then the
 * project's other environments, stage before production: the name, its tag
 * as a pill, the last deploy as a dot, *Release* on the production when
 * there is something to release, and the one glyph that opens the public
 * route (or offers them).
 *
 * Membership is `hasMate` — the project declares a Mate or a container backs
 * one, and never stage or production — not the live connection, so a
 * container going to sleep changes a face rather than rearranging the menu.
 * Grouping is `buildZeropsGroupTree`, the same derivation the projects screen
 * uses, so the two surfaces can never disagree about which project an
 * environment is in; the colours are `assignCandidateMateTints`, likewise
 * shared; whose pull request a change is, and whether a list folds, is
 * `projectFlow.ts`, so the projects screen agrees on that too (R5).
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  flowVerbLabel,
  buildZeropsGroupTree,
  deployWord,
  environmentNameUnderGroup,
  hasMate,
  mateEnvironmentsEmptyReason,
  pullRequestsByMate,
  pullRequestBlocked,
  pullRequestsFolded,
  releaseContentsSentence,
  releaseContentsSummary,
  releaseWaitingLabel,
  rankZeropsCandidateForListing,
  readZeropsGroupTags,
  selectMateEnvironments,
  sidebarPullRequestTitle,
  type DeployedVersion,
  type DeployedVersionLinks,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupRowTone,
  type ReleaseContentsSummary,
  type MissingEnvironmentRow,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateTintId } from "@t3tools/shared/brand";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { MateFace, StatusDot } from "./primitives";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { checkDotTone } from "./ZeropsGitBlock";
import {
  environmentRoleTag,
  environmentRoleTagIsRedundant,
  groupNameIsPlaceholder,
} from "./ZeropsGroupTree.logic";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import { ZeropsRouteMenuItems, ZeropsRoutesMenu } from "./ZeropsPublicRoutes";
import { MenuGroup, MenuGroupLabel, MenuSeparator } from "../ui/menu";

/** What the client holds per environment, when it holds anything. */
type RosterCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
};

type Entry<T> = { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined };

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
   * Where a stop's running version can be read — Gitea's page for the commit
   * and the log behind it. Supplied by the caller, because an address needs
   * the Gitea the account is signed in to and the group's org there, and
   * neither is the menu's to know. Absent (signed out, a version that is not a
   * commit) the version is plain text, exactly as it was.
   */
  readonly versionLinks?:
    | ((row: EnvironmentRow) => { readonly commit: string; readonly history: string } | undefined)
    | undefined;
  /**
   * What a release would carry, per production service. Rendered as the
   * verb's hover: "Release" names the mechanism, and the tasks name the
   * thing — the one reading a person needs who has never merged a branch.
   */
  readonly releaseContents?:
    | ReadonlyArray<{ readonly commits: ReadonlyArray<{ sha: string; subject: string }> }>
    | undefined;
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
}

export interface SidebarZeropsTreeProps<T extends RosterCandidate> {
  readonly candidates: ReadonlyArray<T>;
  readonly onSelect: (candidate: T) => void;
  /** Opens the projects screen — the way out of a menu whose projects have no Mate. */
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
   * The project's flow, when the account has read it (`projectFlowContext`).
   * Absent — signed out of Gitea, nothing read yet — the timeline keeps its
   * shape and simply carries no pull request, no dot and no verb.
   */
  readonly getFlow?: ((groupId: string) => SidebarProjectFlow | undefined) | undefined;
  readonly className?: string;
  /**
   * Nothing has been read for this organization yet: say nothing rather than
   * "none". A re-read is not that — the list already read stays up.
   */
  readonly unread?: boolean;
}

export function SidebarZeropsTree<T extends RosterCandidate>({
  candidates,
  onSelect,
  onBrowseProjects,
  activeProjectId,
  getActivity,
  getFlow,
  unread = false,
  className,
}: SidebarZeropsTreeProps<T>) {
  const emptyReason = mateEnvironmentsEmptyReason(candidates);
  const [openLists, setOpenLists] = useState<ReadonlySet<string>>(() => new Set());

  // Nothing read yet is not nothing: an empty state that shows for the first
  // second of every reload and then gives way to the roster sends the whole
  // menu jumping. Say nothing until the list has been read once.
  if (unread && candidates.length === 0) {
    return null;
  }

  // No project at all: nothing to list and nothing to say — the header's
  // "+ New project" is the one affordance, and the projects screen already
  // makes the invitation. A second "New project" here would be the same verb
  // three times on one screen.
  if (emptyReason === "no-projects") {
    return null;
  }

  // Projects, but none with a Mate: one quiet line on the menu's own left
  // edge, where every other row starts, and the way to the projects screen.
  if (emptyReason !== undefined) {
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
  // — so the rows and the fold agree on which container is the environment's.
  const mates = selectMateEnvironments(candidates);
  const mateByProject = new Map(mates.map((mate) => [mate.project.id, mate]));
  const everyEnvironment = [
    ...candidates.filter((candidate) => !mateByProject.has(candidate.project.id)),
    ...mates,
  ];
  const view = buildZeropsGroupTree(everyEnvironment, { rank: rankZeropsCandidateForListing });
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
    header: ReactNode,
    flow: SidebarProjectFlow | undefined,
    groupName: string | undefined,
  ) => {
    const mateEntries = entries.filter(({ item }) => hasMate(item));
    if (mateEntries.length === 0) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    const grouped = pullRequestsByMate(
      flow?.pullRequests ?? [],
      mateEntries.map(({ item }) => item.project.id),
    );
    // Which row the spine ends on: the last stop where a project has one,
    // then a change nobody's Mate owns, then the last Mate's own last row. A
    // line that runs past its final node into the gap below reads as a list
    // that got cut off rather than as work arriving somewhere.
    const otherPulls = flow === undefined ? [] : grouped.others;
    const endsOnMates = others.length === 0 && otherPulls.length === 0;
    return (
      <>
        {header}
        {mateEntries.map(({ item }, index) => {
          const pulls = grouped.byMate.get(item.project.id) ?? [];
          const listKey = `${id}:${item.project.id}`;
          const first = index === 0;
          const last = endsOnMates && index === mateEntries.length - 1;
          const ownRow = pulls.length === 0 || flow === undefined;
          return (
            <div className="flex flex-col gap-px" key={item.key}>
              <MateRow
                active={item.project.id === activeProjectId}
                activity={getActivity?.(item)}
                candidate={item}
                onSelect={onSelect}
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
                  pulls={pulls}
                  railCap={last ? "end" : undefined}
                />
              )}
            </div>
          );
        })}
        {grouped.others.length === 0 || flow === undefined ? null : (
          // Nobody's Mate's: a person's own branch. Indented under the last
          // Mate it read as that Mate's work, which is a lie the row's own
          // `· ada` could not undo at 256px, where it is truncated away.
          // The dedent is the whole signal; a rule as well would make this
          // read as the start of the stops, which is the next block's rule.
          <ul className="flex flex-col gap-px" data-zerops-surface="sidebar-other-pull-requests">
            {grouped.others.map((pull, index) => (
              <PullRequestRow
                key={`${pull.repository}#${pull.number}`}
                merging={flow.merging(pull)}
                onMerge={flow.onMerge}
                pull={pull}
                railCap={others.length === 0 && index === otherPulls.length - 1 ? "end" : undefined}
                underMate={false}
              />
            ))}
          </ul>
        )}
        {others.length > 0 ? (
          <EnvironmentRows
            environments={others}
            flow={flow}
            groupName={groupName}
            onOpenProject={onBrowseProjects}
          />
        ) : null}
      </>
    );
  };

  const groups = view.groups.filter(({ environments }) =>
    environments.some(({ item }) => hasMate(item)),
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
        <section
          className="flex flex-col gap-px"
          data-zerops-group={group.groupId}
          key={group.groupId}
        >
          {section(
            group.groupId,
            environments,
            <ProjectHeader
              group={group}
              missing={getFlow?.(group.groupId)?.missing ?? []}
              onBrowseProjects={onBrowseProjects}
            />,
            getFlow?.(group.groupId),
            groupNameIsPlaceholder(group) ? undefined : group.name,
          )}
        </section>
      ))}

      {ungroupedMates ? (
        <section className="flex flex-col gap-px" data-zerops-ungrouped="true">
          {section(
            "ungrouped",
            ungrouped,
            groups.length > 0 ? (
              <ProjectHeader muted name="Ungrouped" onBrowseProjects={onBrowseProjects} />
            ) : null,
            undefined,
            // Nothing groups these, so nothing above a row repeats its name.
            undefined,
          )}
        </section>
      ) : null}
    </nav>
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
 * Setting a stage or a production up lives in the menu rather than as a row of
 * its own: not every project wants one, and a permanent row asking for
 * something optional reads as a fault (the owner, 2026-09-19).
 */
function ProjectHeader({
  group,
  name,
  muted = false,
  missing = NO_MISSING_TIERS,
  onBrowseProjects,
}: {
  readonly group?: ZeropsGroup;
  readonly name?: string;
  readonly muted?: boolean;
  readonly missing?: ReadonlyArray<MissingEnvironmentRow>;
  readonly onBrowseProjects: () => void;
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
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-base leading-6 font-semibold tracking-tight text-sidebar-foreground",
          muted && "text-[13px] font-medium tracking-normal text-sidebar-muted-foreground",
          placeholder && "font-normal text-sidebar-muted-foreground italic",
        )}
      >
        {title}
      </span>
      {muted ? null : (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={`Add a Mate to ${title}`}
                  className={ROW_ACTION_CLASS}
                  data-zerops-surface="sidebar-project-add-mate"
                  onClick={onBrowseProjects}
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
              <MenuItem onClick={onBrowseProjects}>Open project</MenuItem>
              {missing.map((row) => (
                <MenuItem key={row.tier} onClick={onBrowseProjects}>
                  {`Set up ${row.name.toLocaleLowerCase()}`}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </span>
      )}
    </div>
  );
}

const NO_MISSING_TIERS: ReadonlyArray<MissingEnvironmentRow> = [];

/** The hover affordances on a heading and on a stop: the same control. */
const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

function MateRow<T extends RosterCandidate>({
  candidate,
  tint,
  active,
  activity,
  onSelect,
  railCap,
}: {
  readonly candidate: T;
  readonly tint: MateTintId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly onSelect: (candidate: T) => void;
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
        "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-row-active text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
      )}
      data-zerops-surface="sidebar-mate"
      onClick={() => onSelect(candidate)}
      type="button"
    >
      <RailCell cap={railCap}>
        <MateFace
          size="sm"
          state={mateFaceFor(candidate.group === "connected", activity)}
          tint={tint}
        />
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
 * it meets the node exactly whether that is a 20px face, a 20px badge or the
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
const RAIL_LINE = "w-px flex-1 bg-sidebar-border";
const RAIL_BLANK = "w-px flex-1";

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
      {/* The branch: a bottom border curving up out of the spine. It carries no
          left border, which would double the line it is leaving. */}
      <span
        aria-hidden="true"
        className="absolute start-2.5 top-[calc(50%-0.5rem)] h-2 w-3.5 rounded-bl-md border-b border-sidebar-border"
      />
      <span
        aria-hidden="true"
        className="absolute start-6 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sidebar-border"
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
  railCap,
}: {
  readonly pulls: ReadonlyArray<FlowPullRequest>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly merging: (pull: FlowPullRequest) => boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  /** Carried to whichever row is last on screen — folded shut, that is the count. */
  readonly railCap?: RailCap;
}) {
  const folded = pullRequestsFolded(pulls.length);
  const listed = !folded || open;
  return (
    <div className="flex flex-col gap-px" data-zerops-surface="sidebar-pull-requests">
      {folded ? (
        <button
          aria-expanded={open}
          className="flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-[11px] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={onToggle}
          type="button"
        >
          <RailFork cap={listed ? undefined : railCap} />
          <ChevronRightIcon
            aria-hidden="true"
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          />
          <span>{pulls.length} pull requests</span>
        </button>
      ) : null}
      {!folded || open ? (
        <ul className="flex flex-col gap-px">
          {pulls.map((pull, index) => (
            <PullRequestRow
              key={`${pull.repository}#${pull.number}`}
              merging={merging(pull)}
              onMerge={onMerge}
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
}: {
  readonly pull: FlowPullRequest;
  readonly merging: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
  /** False for a change that is nobody's Mate's, which hangs under nothing. */
  readonly underMate?: boolean;
  readonly railCap?: RailCap;
}) {
  const tone = checkDotTone({ checks: pull.checks });
  const title = sidebarPullRequestTitle(pull);
  const blocked = pullRequestBlocked(pull);
  return (
    <li
      className={cn("flex h-7 min-w-0 items-center gap-2.5 px-2.5 text-xs", !underMate && "pe-0.5")}
      data-zerops-surface="sidebar-pull-request"
    >
      <RailFork cap={railCap} />
      {pull.url === undefined ? (
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">{title}</span>
      ) : (
        <a
          className="min-w-0 flex-1 truncate rounded-sm text-sidebar-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          href={pull.url}
          rel="noopener"
          target="_blank"
        >
          {title}
        </a>
      )}
      {/* The right edge is never a wordless dot on its own. Where Gitea
          merges the branch the verb carries the row and the dot adds the
          checks beside it; where Gitea refuses, the reason is written out —
          a red dot alone was the row saying nothing at exactly the moment it
          had something to say (seen in the harness, 2026-09-19). */}
      {pull.mergeable ? (
        <>
          {tone === undefined || pull.checkWord === undefined ? null : (
            <Tooltip>
              <TooltipTrigger render={<StatusDot dotOnly label={pull.checkWord} tone={tone} />} />
              <TooltipPopup side="right">{pull.checkWord}</TooltipPopup>
            </Tooltip>
          )}
          <ZeropsMateVerb
            disabled={merging}
            label={flowVerbLabel("merge", merging)}
            onClick={() => onMerge(pull)}
          />
        </>
      ) : blocked === null ? null : (
        <StatusDot
          className="shrink-0 text-[11px] text-sidebar-muted-foreground"
          data-zerops-surface="sidebar-pull-request-blocked"
          label={blocked.word}
          sentence
          tone={blocked.tone}
        />
      )}
    </li>
  );
}

/**
 * *Release*, and — where the flow read them — the tasks it would put in front
 * of people, as a hover.
 *
 * The verb keeps its name: renaming it would cost the people who know exactly
 * what it means and buy the others only a different word to learn. The hover
 * is what a person reads instead, and it is written in their own words,
 * because a squash merge carries the task's message.
 */
function ReleaseVerb({
  contents,
  releasing,
  onRelease,
}: {
  readonly contents: SidebarProjectFlow["releaseContents"];
  readonly releasing: boolean;
  readonly onRelease: () => void;
}) {
  const summary = releaseContentsSummary(contents ?? []);
  const verb = (
    <ZeropsMateVerb
      description={releaseContentsSentence(summary)}
      disabled={releasing}
      label={flowVerbLabel("release", releasing)}
      onClick={onRelease}
    />
  );
  if (summary.total === 0) return verb;
  return (
    <Tooltip>
      <TooltipTrigger render={verb} />
      <TooltipPopup side="right">
        {/* A commit subject is a whole sentence — unbounded, the hover grew to
            the width of the longest one and floated across the screen. */}
        <span
          className="flex max-w-72 flex-col gap-0.5 wrap-anywhere"
          data-zerops-surface="sidebar-release-contents"
        >
          <span className="font-medium">
            {summary.total === 1 ? "Going live:" : `Going live — ${summary.total} changes:`}
          </span>
          {summary.subjects.map((subject) => (
            <span key={subject}>{subject}</span>
          ))}
          {summary.more === 0 ? null : <span className="opacity-70">+{summary.more} more</span>}
        </span>
      </TooltipPopup>
    </Tooltip>
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

/** A production carrying changes nobody outside can see yet. */
const BEHIND_CLASS =
  "inline-flex h-[18px] shrink-0 items-center rounded-full bg-[var(--zerops-status-attention-surface)] px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-[var(--zerops-status-attention-text)]";

/** What a stop's row says it is running, when nothing has been deployed there. */
const NOTHING_DEPLOYED = "nothing deployed yet";

/** How many waiting changes a stop's menu lists before it counts the rest. */
const MENU_CHANGES_SHOWN = 8;

/**
 * The stop's own menu — the thing the rows did not have.
 *
 * "Still there is no more menu on prod / stage that would allow me to do
 * stuff" (the owner, 2026-09-19). It holds what a row has no width for: what
 * is actually running, spelled out; every public URL, which is also the
 * keyboard's way to them; and, on a production, the changes that are merged
 * and not live — the list a person opens *Release* to find out about, here
 * before they press it.
 */
function StopMenu({
  name,
  version,
  links,
  routes,
  waiting,
  onOpenProject,
}: {
  readonly name: string;
  readonly version: DeployedVersion | undefined;
  /** Gitea's pages for what is running, when the account can reach them. */
  readonly links: DeployedVersionLinks | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly waiting: ReleaseContentsSummary | undefined;
  readonly onOpenProject: () => void;
}) {
  // `v1.4.0 · 77ab0e1 · tagged by ada` — the whole of what one row abbreviates.
  const detail =
    version?.label === undefined
      ? NOTHING_DEPLOYED
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
          {links === undefined ? (
            <MenuItem disabled>{detail}</MenuItem>
          ) : (
            <MenuItem render={<a href={links.commit} rel="noreferrer" target="_blank" />}>
              <span className="min-w-0 flex-1 truncate">{detail}</span>
              <ExternalLinkIcon aria-hidden="true" />
            </MenuItem>
          )}
          {/* The question people actually ask of a version is what came before
              it, and a commit page answers only for one. */}
          {links === undefined ? null : (
            <MenuItem render={<a href={links.history} rel="noreferrer" target="_blank" />}>
              <span className="min-w-0 flex-1 truncate">History</span>
              <ExternalLinkIcon aria-hidden="true" />
            </MenuItem>
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
        {waiting === undefined || waiting.total === 0 ? null : (
          <>
            <MenuSeparator />
            <MenuGroup data-zerops-surface="sidebar-stop-waiting">
              <MenuGroupLabel>
                {waiting.total === 1 ? "1 change waiting" : `${waiting.total} changes waiting`}
              </MenuGroupLabel>
              {waiting.subjects.map((subject) => (
                <MenuItem disabled key={subject}>
                  {subject}
                </MenuItem>
              ))}
              {waiting.more === 0 ? null : <MenuItem disabled>+{waiting.more} more</MenuItem>}
            </MenuGroup>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The project's other environments, stage before production — the stops the
 * code travels to, drawn as the peers of the Mates above them.
 *
 * Each is two lines, like a Mate: the badge and the name, then what it is
 * actually running. What it runs is the version's **name** where Zerops has
 * one — `v1.4.0`, the word everybody uses for that deploy — and the commit
 * only where nobody named it (the owner, 2026-09-19: "the commit hash should
 * only be a fallback to version name from Zerops"). A production also says how
 * far behind it is, short enough that the row does not wrap at 256px, and the
 * menu spells the rest out.
 */
function EnvironmentRows<T extends RosterCandidate>({
  environments,
  flow,
  groupName,
  onOpenProject,
}: {
  readonly environments: ReadonlyArray<Entry<T>>;
  readonly flow: SidebarProjectFlow | undefined;
  /** The heading above, so a row never repeats the word already on it. */
  readonly groupName: string | undefined;
  readonly onOpenProject: () => void;
}) {
  const behind = releaseContentsSummary(flow?.releaseContents ?? []);
  const waitingLabel = releaseWaitingLabel(behind);
  // The hover shows four because it floats over the menu; the stop's own menu
  // is a list and can hold the ones a person is actually looking for.
  const waitingInMenu = releaseContentsSummary(flow?.releaseContents ?? [], MENU_CHANGES_SHOWN);
  return (
    // The stops belong to the project, not to the Mate they happen to follow:
    // a rule and the project's own left edge say so.
    <ul className="flex flex-col gap-px" data-zerops-surface="sidebar-environment-rows">
      {environments.map(({ item, role }, index) => {
        const tag = environmentRoleTag(role);
        const name = environmentNameUnderGroup(groupName, item.project.name);
        const declared = flow?.environments.get(item.project.id);
        const tone = declared?.tone ?? "neutral";
        const word = deployWord(tone) ?? NOTHING_DEPLOYED;
        const production = declared?.tier === "production";
        const release = flow !== undefined && flow.releaseOffered && production;
        const routes = item.routes ?? [];
        const version = declared?.version;
        const links = declared === undefined ? undefined : flow?.versionLinks?.(declared);
        return (
          <li
            className="group/stop flex min-w-0 items-center gap-2.5 rounded-md px-2.5 transition-colors hover:bg-sidebar-row-hover"
            data-zerops-project={item.project.id}
            data-zerops-surface="sidebar-environment"
            key={item.project.id}
          >
            {/* Centred on the row, because the Mate face directly above it is:
                two neighbouring rows may not have two rules for their first
                column. It was pinned to the first line, 11px high of centre. */}
            {/* The production is the last stop, so the spine ends on its badge
                rather than running past it into the gap under the group. */}
            <RailCell cap={index === environments.length - 1 ? "end" : undefined}>
              <StopBadge tone={tone} word={word} />
            </RailCell>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
              <span className="flex min-w-0 items-center gap-2">
                {/* A stop is named in the same hand as a Mate: it is a place
                    the work reaches, not a footnote under the ones who did it. */}
                <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium text-sidebar-foreground">
                  {name}
                </span>
                {tag === null || environmentRoleTagIsRedundant(tag, name) ? null : (
                  <ZeropsRoleTag label={tag} />
                )}
                {/* One cluster at one height on one edge, and on the line with
                    room for it: the verb used to sit here and the two controls
                    a line below, three things down a staircase. It rides the
                    name's line — which is short — so the line under it keeps
                    its full width for the version, which was truncating to
                    `v1.…` at 256px while `· 3 waiting` kept every character. */}
                <span className="flex shrink-0 items-center gap-1">
                  {release ? (
                    <ReleaseVerb
                      contents={flow.releaseContents}
                      onRelease={flow.onRelease}
                      releasing={flow.releasing}
                    />
                  ) : null}
                  <ZeropsRoutesMenu
                    label={`Public access of ${item.project.name}`}
                    routes={routes}
                  />
                  <StopMenu
                    name={name}
                    onOpenProject={onOpenProject}
                    routes={routes}
                    links={links}
                    version={version}
                    waiting={production ? waitingInMenu : undefined}
                  />
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-sidebar-muted-foreground">
                {/* What is actually running here — the question the row never
                    answered (the owner, 2026-09-19: "nothing shows what version
                    they run"). */}
                {/* The name is a fact until it can be opened. Where Gitea is
                    signed in and the version names a commit, it is the way to
                    what is actually in there; otherwise it stays plain text
                    rather than becoming a link that goes nowhere. */}
                {links === undefined || version?.label === undefined ? (
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      version?.name === undefined && "tabular-nums",
                    )}
                    data-zerops-surface="sidebar-environment-version"
                  >
                    {version?.label ?? NOTHING_DEPLOYED}
                  </span>
                ) : (
                  <a
                    className={cn(
                      "min-w-0 truncate rounded-sm underline-offset-2 hover:text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                      version.name === undefined && "tabular-nums",
                    )}
                    data-zerops-surface="sidebar-environment-version"
                    href={links.commit}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {version.label}
                  </a>
                )}
                {/* Work that is merged but not live is the one thing on this
                    row a person may need to act on, and it was muted text
                    glued to the version with a middle dot while the green
                    badge — which only reports the last deploy — took the eye,
                    so the row read as settled when it was not. The badge keeps
                    its own meaning; the state wears the tone it has earned. */}
                {production && waitingLabel !== undefined ? (
                  <span className={BEHIND_CLASS} data-zerops-surface="sidebar-environment-behind">
                    {waitingLabel}
                  </span>
                ) : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
