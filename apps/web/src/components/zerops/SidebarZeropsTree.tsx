/**
 * The left menu's Mates: every agent on the account that has somewhere to
 * live, under the project it belongs to — and, folded under each project,
 * the other environments with a way out to what runs in them.
 *
 * A Mate is a row here, the menu's own kind of row — the surface every
 * thread and project in this menu has, lit on hover and when it is the one
 * open — and a tall one, the way a messenger lists people: the face in its
 * colour wearing the conversation's state, the name, when the Mate last did
 * something at the right edge, and under it what the Mate is on or was last
 * on. The state is the face's to show; no word repeats it. Nothing about the
 * environment: a Mate is always in a dev box, and which Zerops project that
 * is matters on the projects screen, not here. The environments are folded
 * because they are where you look, not where you work: a row each, the name
 * and its tag as a pill, and the one glyph that opens the public route (or
 * offers them).
 *
 * Membership is `hasMate` — the project declares a Mate or a container backs
 * one, and never stage or production — not the live connection, so a
 * container going to sleep changes a face rather than rearranging the menu.
 * Grouping is `buildZeropsGroupTree`, the same derivation the projects screen
 * uses, so the two surfaces can never disagree about which project an
 * environment is in; the colours are `assignCandidateMateTints`, likewise
 * shared.
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  hasMate,
  mateEnvironmentsEmptyReason,
  readZeropsGroupTags,
  selectMateEnvironments,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { MateFace } from "./primitives";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { environmentRoleTag, groupNameIsPlaceholder } from "./ZeropsGroupTree.logic";
import { ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

/** What the client holds per environment, when it holds anything. */
type RosterCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
};

type Entry<T> = { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined };

export interface SidebarZeropsTreeProps<T extends RosterCandidate> {
  readonly candidates: ReadonlyArray<T>;
  readonly onSelect: (candidate: T) => void;
  /** Opens the projects screen — the only route out of an empty menu. */
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
  readonly className?: string;
}

export function SidebarZeropsTree<T extends RosterCandidate>({
  candidates,
  onSelect,
  onBrowseProjects,
  activeProjectId,
  getActivity,
  className,
}: SidebarZeropsTreeProps<T>) {
  const emptyReason = mateEnvironmentsEmptyReason(candidates);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());

  if (emptyReason !== undefined) {
    return (
      <div
        className={cn("flex flex-col items-center gap-2 px-2 py-6 text-center", className)}
        data-zerops-surface="sidebar-environments-empty"
      >
        <span className="text-xs text-[var(--muted-foreground)]">
          {/* Never "no projects" when there are projects: that sends someone
              looking for something they already have. */}
          {emptyReason === "no-projects" ? "No Zerops projects yet" : "No environment has Mate yet"}
        </span>
        <button
          className="inline-flex cursor-pointer items-center rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={onBrowseProjects}
          type="button"
        >
          {emptyReason === "no-projects" ? "New project" : "Set up Mate"}
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
  const view = buildZeropsGroupTree(everyEnvironment);
  const tints = assignCandidateMateTints(candidates);

  const toggle = (groupId: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  /** A project: its name, its Mates as rows, its other environments folded. Nothing when nobody lives in it. */
  const section = (id: string, entries: ReadonlyArray<Entry<T>>, header: ReactNode) => {
    const mates = entries.filter(({ item }) => hasMate(item));
    if (mates.length === 0) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    return (
      <>
        {header}
        {mates.map(({ item }) => (
          <MateRow
            active={item.project.id === activeProjectId}
            activity={getActivity?.(item)}
            candidate={item}
            key={item.key}
            onSelect={onSelect}
            tint={tints.get(item.project.id) ?? "slate"}
          />
        ))}
        {others.length > 0 ? (
          <EnvironmentsFold
            environments={others}
            onToggle={() => {
              toggle(id);
            }}
            open={openGroups.has(id)}
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
          {section(group.groupId, environments, <ProjectName group={group} />)}
        </section>
      ))}

      {ungroupedMates ? (
        <section className="flex flex-col gap-px" data-zerops-ungrouped="true">
          {section(
            "ungrouped",
            ungrouped,
            groups.length > 0 ? <ProjectName muted name="Ungrouped" /> : null,
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

/** The face a Mate wears here: its conversation's state when the socket is up, else asleep. */
function faceFor(
  candidate: RosterCandidate,
  activity: ZeropsAgentActivity | undefined,
): MateMarkState {
  if (candidate.group !== "connected") return "sleep";
  return activity?.face ?? "idle";
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
      <MateFace size="sm" state={faceFor(candidate, activity)} tint={tint} />
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
            className="truncate text-xs leading-4 text-sidebar-muted-foreground"
            data-zerops-surface="sidebar-mate-subject"
          >
            {subject}
          </span>
        )}
      </span>
    </button>
  );
}

function EnvironmentsFold<T extends RosterCandidate>({
  environments,
  open,
  onToggle,
}: {
  readonly environments: ReadonlyArray<Entry<T>>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const count = environments.length;
  return (
    <div className="flex flex-col gap-0.5" data-zerops-surface="sidebar-environments-fold">
      <button
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground"
        onClick={onToggle}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span>
          {count} {count === 1 ? "environment" : "environments"}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5" data-zerops-surface="sidebar-environment-rows">
          {environments.map(({ item, role }) => {
            const tag = environmentRoleTag(role);
            return (
              <li
                className="flex h-7 min-w-0 items-center gap-2 ps-[1.625rem] pe-0.5 text-xs"
                key={item.project.id}
              >
                <span className="min-w-0 truncate text-muted-foreground">{item.project.name}</span>
                {tag === null ? null : <ZeropsRoleTag label={tag} />}
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
      ) : null}
    </div>
  );
}
