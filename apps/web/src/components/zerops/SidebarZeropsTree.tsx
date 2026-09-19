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
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateTintId } from "@t3tools/shared/brand";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
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
            <ProjectName group={group} />,
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
            groups.length > 0 ? <ProjectName muted name="Ungrouped" /> : null,
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
 * The project's name as a name — a small heading, not a label. A project
 * nothing has named shows its id, quietly, the way the projects screen does.
 */
function ProjectName({
  group,
  name,
  muted = false,
}: {
  readonly group?: ZeropsGroup;
  readonly name?: string;
  readonly muted?: boolean;
}) {
  const placeholder = group !== undefined && groupNameIsPlaceholder(group);
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center px-2 text-xs font-semibold text-sidebar-foreground",
        muted && "font-medium text-sidebar-muted-foreground",
        placeholder && "font-normal text-sidebar-muted-foreground italic",
      )}
      data-zerops-surface="sidebar-project"
    >
      <span className="min-w-0 truncate">{group?.name ?? name}</span>
    </div>
  );
}

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
  return (
    // The stops belong to the project, not to the Mate they happen to follow:
    // a rule and the project's own left edge say so. Held in the list rather
    // than on the first row, so a project with one stop is drawn like a
    // project with three.
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
        return (
          <li
            className="flex h-7 min-w-0 items-center gap-2 ps-2.5 pe-0.5 text-xs"
            data-zerops-surface="sidebar-environment"
            key={item.project.id}
          >
            <span className="min-w-0 truncate text-muted-foreground">{name}</span>
            {tag === null || environmentRoleTagIsRedundant(tag, name) ? null : (
              <ZeropsRoleTag label={tag} />
            )}
            {tone === undefined || word === undefined ? null : (
              <Tooltip>
                <TooltipTrigger render={<StatusDot dotOnly label={word} tone={tone} />} />
                <TooltipPopup side="right">{word}</TooltipPopup>
              </Tooltip>
            )}
            {release ? (
              <ReleaseVerb
                contents={flow.releaseContents}
                onRelease={flow.onRelease}
                releasing={flow.releasing}
              />
            ) : null}
            <span className="ms-auto flex w-6 shrink-0 justify-center">
              <ZeropsRoutesMenu
                label={`Public access of ${item.project.name}`}
                routes={item.routes ?? []}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
