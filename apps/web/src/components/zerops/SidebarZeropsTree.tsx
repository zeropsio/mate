/**
 * The left menu's Mates: every agent on the account that has somewhere to
 * live, under the project it belongs to — and, folded under each project,
 * the other environments with a way out to what runs in them.
 *
 * A Mate is a card here as on the projects screen — the same object at the
 * menu's size: the face in its colour wearing the conversation's state, the
 * name, what the Mate is doing in one word, and what it is on, on a second
 * line, while it is on something. A card because it is the one thing in this
 * menu you pick up. Nothing about the environment: a Mate is always in a dev
 * box, and which Zerops project that is matters on the projects screen, not
 * here. The environments are folded because they are where you look, not
 * where you work: a row each, the name and its tag as a pill, and the one
 * glyph that opens the public route (or offers them).
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
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { MateFace } from "./primitives";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { environmentRoleTag, groupNameIsPlaceholder } from "./ZeropsGroupTree.logic";
import { ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

/**
 * The bucket, as a roster word, for a Mate whose socket is not up. A card
 * answers "what is this agent up to", so a connected environment with nothing
 * running is idle, never "connected" — the socket is the client's business.
 */
const WORD: Record<ZeropsCandidate["group"], string> = {
  connected: "Idle",
  ready: "Ready",
  provisioning: "Starting",
  unavailable: "Unavailable",
};

const WORD_CLASS: Record<ZeropsCandidate["group"], string> = {
  connected: "text-muted-foreground",
  ready: "text-muted-foreground",
  provisioning: "text-[var(--zerops-status-busy-text,var(--foreground))]",
  unavailable: "text-[var(--zerops-status-attention-text,var(--foreground))]",
};

/** A registered environment whose socket is still on its way up. */
function isConnecting(connection: EnvironmentConnectionPresentation | undefined): boolean {
  return (
    connection !== undefined &&
    (connection.phase === "connecting" ||
      connection.phase === "reconnecting" ||
      connection.phase === "available")
  );
}

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
  // — so the cards and the fold agree on which container is the environment's.
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

  /** A project: its name, its Mates as cards, its other environments folded. Nothing when nobody lives in it. */
  const section = (id: string, entries: ReadonlyArray<Entry<T>>, header: ReactNode) => {
    const cards = entries.filter(({ item }) => hasMate(item));
    if (cards.length === 0) return null;
    const others = entries.filter(({ item }) => !hasMate(item));
    return (
      <>
        {header}
        {cards.map(({ item }) => (
          <MateCard
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
          className="flex flex-col gap-1"
          data-zerops-group={group.groupId}
          key={group.groupId}
        >
          {section(group.groupId, environments, <ProjectName group={group} />)}
        </section>
      ))}

      {ungroupedMates ? (
        <section className="flex flex-col gap-1" data-zerops-ungrouped="true">
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

function MateCard<T extends RosterCandidate>({
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
  const connected = candidate.group === "connected";
  const live = connected ? activity : undefined;

  // One trailing word, right-aligned so it lines up down the menu: what the
  // agent is doing when that is knowable, else where its container stands.
  let word: ReactNode;
  if (live?.status) {
    word = (
      <span
        className={cn(
          "text-[11px] leading-4 font-medium",
          live.status.colorClass,
          live.status.pulse && "animate-status-pulse motion-reduce:animate-none",
        )}
      >
        {live.status.label}
      </span>
    );
  } else if (!connected && isConnecting(candidate.connection)) {
    word = (
      <span className="text-[11px] leading-4 font-medium text-[var(--zerops-status-busy-text,var(--foreground))]">
        Connecting
      </span>
    );
  } else {
    word = (
      <span className={cn("text-[11px] leading-4 font-medium", WORD_CLASS[candidate.group])}>
        {WORD[candidate.group]}
      </span>
    );
  }

  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-9 w-full min-w-0 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] motion-reduce:transition-none",
        // The card colour, as on the projects screen — a card is lighter than
        // the surface it sits on; the row colours are for rows.
        active
          ? "border-foreground/30 bg-card"
          : "border-sidebar-border bg-card hover:border-foreground/25",
      )}
      data-zerops-surface="sidebar-mate"
      onClick={() => onSelect(candidate)}
      type="button"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <MateFace size="sm" state={faceFor(candidate, activity)} tint={tint} />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-sidebar-foreground">
          {name}
        </span>
        {/* A flex wrapper, so the word's own line-height sets the line — an
            inline wrapper would add the button's 16 px strut under an 11 px word. */}
        <span className="flex shrink-0">{word}</span>
      </span>
      {/* What it is on, while it is on something — the line appears with the
          work and leaves with it. */}
      {live?.subject === undefined ? null : (
        <span
          className="w-full truncate ps-7 text-[11px] leading-4 text-muted-foreground"
          data-zerops-surface="sidebar-mate-subject"
        >
          {live.subject}
        </span>
      )}
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
