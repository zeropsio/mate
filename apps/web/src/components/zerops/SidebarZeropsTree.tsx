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
  pullRequestBlockedReason,
  pullRequestsFolded,
  releaseContentsSentence,
  releaseContentsSummary,
  rankZeropsCandidateForListing,
  readZeropsGroupTags,
  selectMateEnvironments,
  sidebarPullRequestTitle,
  type EnvironmentRow,
  type FlowPullRequest,
  type MissingEnvironmentRow,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateTintId } from "@t3tools/shared/brand";
import { ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
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
import { deployRowTone } from "./ZeropsProjectRow.logic";
import { ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

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
    return (
      <>
        {header}
        {mateEntries.map(({ item }) => {
          const pulls = grouped.byMate.get(item.project.id) ?? [];
          const listKey = `${id}:${item.project.id}`;
          return (
            <div className="flex flex-col gap-px" key={item.key}>
              <MateRow
                active={item.project.id === activeProjectId}
                activity={getActivity?.(item)}
                candidate={item}
                onSelect={onSelect}
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
                />
              )}
            </div>
          );
        })}
        {grouped.others.length === 0 || flow === undefined ? null : (
          <ul className="flex flex-col gap-px" data-zerops-surface="sidebar-other-pull-requests">
            {grouped.others.map((pull) => (
              <PullRequestRow
                key={`${pull.repository}#${pull.number}`}
                merging={flow.merging(pull)}
                onMerge={flow.onMerge}
                pull={pull}
              />
            ))}
          </ul>
        )}
        {others.length > 0 ? (
          <EnvironmentRows environments={others} flow={flow} groupName={groupName} />
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
      className="group/project flex h-9 min-w-0 items-center gap-1 px-2"
      data-zerops-surface="sidebar-project"
    >
      {/* A name, not a label: no uppercase and no `MicroLabel` — the heading
          anchors its section by the room around it and by being the one
          semibold thing in the column, not by shouting. */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] leading-5 font-semibold text-sidebar-foreground",
          muted && "font-medium text-sidebar-muted-foreground",
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
                  className={PROJECT_ACTION_CLASS}
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
              className={PROJECT_ACTION_CLASS}
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

const PROJECT_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

function MateRow<T extends RosterCandidate>({
  candidate,
  tint,
  active,
  activity,
  onSelect,
}: {
  readonly candidate: T;
  readonly tint: MateTintId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly onSelect: (candidate: T) => void;
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
        "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-row-active text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
      )}
      data-zerops-surface="sidebar-mate"
      onClick={() => onSelect(candidate)}
      type="button"
    >
      <MateFace
        size="sm"
        state={mateFaceFor(candidate.group === "connected", activity)}
        tint={tint}
      />
      <span className="flex min-w-0 flex-1 flex-col">
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
            className={cn(
              "truncate text-xs leading-4",
              snippet === undefined ? "text-sidebar-muted-foreground" : "text-sidebar-foreground",
            )}
            data-zerops-surface="sidebar-mate-subject"
          >
            {subject}
          </span>
        )}
        {snippet === undefined ? null : (
          <span
            className="truncate text-xs leading-4 text-sidebar-muted-foreground"
            data-zerops-surface="sidebar-mate-snippet"
          >
            {snippet}
          </span>
        )}
      </span>
    </button>
  );
}

/** The indent of everything that hangs under a Mate — its name's own left edge. */
const UNDER_MATE_CLASS = "ps-10 pe-0.5";

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
}: {
  readonly pulls: ReadonlyArray<FlowPullRequest>;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly merging: (pull: FlowPullRequest) => boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
}) {
  const folded = pullRequestsFolded(pulls.length);
  return (
    <div className="flex flex-col gap-px" data-zerops-surface="sidebar-pull-requests">
      {folded ? (
        <button
          aria-expanded={open}
          className={cn(
            "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-[11px] text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            UNDER_MATE_CLASS,
          )}
          onClick={onToggle}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          />
          <span>{pulls.length} pull requests</span>
        </button>
      ) : null}
      {!folded || open ? (
        <ul className="flex flex-col gap-px">
          {pulls.map((pull) => (
            <PullRequestRow
              key={`${pull.repository}#${pull.number}`}
              merging={merging(pull)}
              onMerge={onMerge}
              pull={pull}
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
}: {
  readonly pull: FlowPullRequest;
  readonly merging: boolean;
  readonly onMerge: (pull: FlowPullRequest) => void;
}) {
  const tone = checkDotTone({ checks: pull.checks });
  const title = sidebarPullRequestTitle(pull);
  const blocked = pullRequestBlockedReason(pull);
  return (
    <li
      className={cn("flex h-7 min-w-0 items-center gap-2 text-xs", UNDER_MATE_CLASS)}
      data-zerops-surface="sidebar-pull-request"
    >
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
      {tone === undefined || pull.checkWord === undefined ? null : (
        <Tooltip>
          <TooltipTrigger render={<StatusDot dotOnly label={pull.checkWord} tone={tone} />} />
          <TooltipPopup side="right">{pull.checkWord}</TooltipPopup>
        </Tooltip>
      )}
      {pull.mergeable ? (
        <ZeropsMateVerb
          disabled={merging}
          label={flowVerbLabel("merge", merging)}
          onClick={() => onMerge(pull)}
        />
      ) : blocked === null ? null : (
        // Gitea refused, and a row that only dropped its verb left the person
        // to open the request to find out why.
        <span
          className="shrink-0 text-[11px] text-sidebar-muted-foreground"
          data-zerops-surface="sidebar-pull-request-blocked"
        >
          {blocked}
        </span>
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
        <span className="flex flex-col gap-0.5" data-zerops-surface="sidebar-release-contents">
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
 * The project's other environments, stage before production — the stops the
 * code travels to. Each: the name, its tag, the last deploy as a dot when the
 * flow knows it, *Release* on the production when there is something to
 * release, and the glyph that opens the public route.
 */
function EnvironmentRows<T extends RosterCandidate>({
  environments,
  flow,
  groupName,
}: {
  readonly environments: ReadonlyArray<Entry<T>>;
  readonly flow: SidebarProjectFlow | undefined;
  /** The heading above, so a row never repeats the word already on it. */
  readonly groupName: string | undefined;
}) {
  const behind = releaseContentsSummary(flow?.releaseContents ?? []);
  return (
    // The stops belong to the project, not to the Mate they happen to follow:
    // a rule and the project's own left edge say so.
    <ul
      className="mt-1 flex flex-col gap-px border-t border-sidebar-border pt-1"
      data-zerops-surface="sidebar-environment-rows"
    >
      {environments.map(({ item, role }) => {
        const tag = environmentRoleTag(role);
        const name = environmentNameUnderGroup(groupName, item.project.name);
        const declared = flow?.environments.get(item.project.id);
        const tone = declared === undefined ? undefined : deployRowTone(declared.tone);
        const word = declared === undefined ? undefined : deployWord(declared.tone);
        const release =
          flow !== undefined && flow.releaseOffered && declared?.tier === "production";
        const routes = item.routes ?? [];
        const [firstRoute] = routes;
        return (
          <li
            className="flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-row-hover"
            data-zerops-surface="sidebar-environment"
            key={item.project.id}
          >
            <span className="flex min-w-0 items-center gap-2">
              {/* A stop is named in the same hand as a Mate: it is a place the
                  work reaches, not a footnote under the ones who did it. */}
              <span className="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-sidebar-foreground">
                {name}
              </span>
              {tag === null || environmentRoleTagIsRedundant(tag, name) ? null : (
                <ZeropsRoleTag label={tag} />
              )}
              {release ? (
                <ReleaseVerb
                  contents={flow.releaseContents}
                  onRelease={flow.onRelease}
                  releasing={flow.releasing}
                />
              ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-sidebar-muted-foreground">
              {tone === undefined || word === undefined ? null : (
                <StatusDot dotOnly label={word} tone={tone} />
              )}
              {/* What is actually running here — the question the row never
                  answered (the owner, 2026-09-19: "nothing shows what version
                  they run"). */}
              {declared?.commit === undefined ? (
                <span>{word ?? "nothing deployed yet"}</span>
              ) : (
                <span className="tabular-nums">{declared.commit}</span>
              )}
              {declared?.tier === "production" && behind.total > 0 ? (
                <span data-zerops-surface="sidebar-environment-behind">
                  · {behind.total === 1 ? "1 change waiting" : `${behind.total} changes waiting`}
                </span>
              ) : null}
              <span className="ms-auto flex min-w-0 shrink items-center">
                {/* The host itself rather than a bare arrow: every service can
                    have several, and an arrow never said which one it opened. */}
                {routes.length === 1 && firstRoute !== undefined ? (
                  <a
                    className="min-w-0 truncate rounded-sm underline-offset-2 hover:text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    data-zerops-surface="sidebar-environment-route"
                    href={firstRoute.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {firstRoute.host}
                  </a>
                ) : (
                  <ZeropsRoutesMenu
                    label={`Public access of ${item.project.name}`}
                    routes={routes}
                  />
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
