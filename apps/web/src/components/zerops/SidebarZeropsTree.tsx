/**
 * The left menu's Mates: every agent on the account that has somewhere to
 * live, under the project it belongs to — and, folded under each project,
 * the environments themselves with a way out to what runs in them.
 *
 * A Mate row is who you talk to: the face in its colour wearing the state the
 * conversation is in, the name, the environment's tag, and what the Mate is
 * doing in one word — with what it is on, on a second line, while it is on
 * something. The environments are folded because they are where you look,
 * not where you work: a row each, role and name, and the one glyph that
 * opens the public route (or offers them).
 *
 * Membership is `selectMateEnvironments` — the project has a Mate container —
 * and never the live connection, so a container going to sleep changes a face
 * rather than rearranging the menu. Grouping is `buildZeropsGroupTree`, the
 * same derivation the projects screen uses, so the two surfaces can never
 * disagree about which project an environment is in; the colours are
 * `assignCandidateMateTints`, likewise shared.
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  hasMateContainer,
  mateEnvironmentsEmptyReason,
  readZeropsGroupTags,
  selectMateEnvironments,
  type ZeropsEnvironmentRole,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { MateFace, MicroLabel } from "./primitives";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";
import { ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

/**
 * The bucket, as a roster word, for a Mate whose socket is not up. A row
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

  // Mates are the rows; every environment, Mate or not, is in the fold. Both
  // are derived from the one list, deduplicated per project by the tree — a
  // project's Mate candidate wins over a bare one so the fold and the rows
  // agree on which container is the environment's.
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

  const rows = (
    entries: ReadonlyArray<{ readonly item: T; readonly role: ZeropsEnvironmentRole | undefined }>,
  ) =>
    entries
      .filter(({ item }) => hasMateContainer(item))
      .map(({ item, role }) => (
        <MateRow
          active={item.project.id === activeProjectId}
          activity={getActivity?.(item)}
          candidate={item}
          key={item.key}
          onSelect={onSelect}
          role={role}
          tint={tints.get(item.project.id) ?? "slate"}
        />
      ));

  const fold = (
    id: string,
    entries: ReadonlyArray<{ readonly item: T; readonly role: ZeropsEnvironmentRole | undefined }>,
  ) => (
    <EnvironmentsFold
      environments={entries}
      onToggle={() => {
        toggle(id);
      }}
      open={openGroups.has(id)}
    />
  );

  const groups = view.groups.filter(({ environments }) =>
    environments.some(({ item }) => hasMateContainer(item)),
  );
  const ungroupedMates = view.ungrouped.filter((item) => hasMateContainer(item));

  return (
    <nav
      aria-label="Mates"
      className={cn("flex flex-col gap-4", className)}
      data-zerops-surface="sidebar-environments"
    >
      {groups.map(({ group, environments }) => (
        <section
          className="flex flex-col gap-0.5"
          data-zerops-group={group.groupId}
          key={group.groupId}
        >
          <MicroLabel className="px-2 pb-1">{group.name}</MicroLabel>
          {rows(environments)}
          {fold(group.groupId, environments)}
        </section>
      ))}

      {ungroupedMates.length > 0 ? (
        <section className="flex flex-col gap-0.5" data-zerops-ungrouped="true">
          {groups.length > 0 ? <MicroLabel className="px-2 pb-1">Ungrouped</MicroLabel> : null}
          {rows(view.ungrouped.map((item) => ({ item, role: undefined })))}
          {fold(
            "ungrouped",
            view.ungrouped.map((item) => ({ item, role: undefined })),
          )}
        </section>
      ) : null}
    </nav>
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
  role,
  tint,
  active,
  activity,
  onSelect,
}: {
  readonly candidate: T;
  readonly role: ZeropsEnvironmentRole | undefined;
  readonly tint: MateTintId;
  readonly active: boolean;
  readonly activity: ZeropsAgentActivity | undefined;
  readonly onSelect: (candidate: T) => void;
}) {
  const tags = readZeropsGroupTags(candidate.project.tagList);
  const name = botDisplayName({ bot: tags.bot, projectName: candidate.project.name });
  const badge = environmentRoleLabel(role);
  const connected = candidate.group === "connected";
  const live = connected ? activity : undefined;

  // One trailing word, right-aligned so it lines up down the menu: what the
  // agent is doing when that is knowable, else where its container stands.
  let word: ReactNode;
  if (live?.status) {
    word = (
      <span
        className={cn(
          "text-[11px] font-medium",
          live.status.colorClass,
          live.status.pulse && "animate-status-pulse motion-reduce:animate-none",
        )}
      >
        {live.status.label}
      </span>
    );
  } else if (!connected && isConnecting(candidate.connection)) {
    word = (
      <span className="text-[11px] font-medium text-[var(--zerops-status-busy-text,var(--foreground))]">
        Connecting
      </span>
    );
  } else {
    word = (
      <span className={cn("text-[11px] font-medium", WORD_CLASS[candidate.group])}>
        {WORD[candidate.group]}
      </span>
    );
  }

  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm",
        active ? "bg-sidebar-row-hover" : "hover:bg-sidebar-row-hover",
      )}
      data-zerops-surface="sidebar-mate"
      onClick={() => onSelect(candidate)}
      type="button"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <MateFace size="dot" state={faceFor(candidate, activity)} tint={tint} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {badge ? <MicroLabel className="shrink-0">{badge}</MicroLabel> : null}
        <span className="shrink-0">{word}</span>
      </span>
      {/* What it is on, while it is on something — the line appears with the
          work and leaves with it. */}
      {live?.subject === undefined ? null : (
        <span
          className="w-full truncate ps-[1.375rem] text-[11px] text-muted-foreground"
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
  readonly environments: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const count = environments.length;
  return (
    <div className="flex flex-col gap-0.5" data-zerops-surface="sidebar-environments-fold">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-foreground"
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
          {environments.map(({ item, role }) => (
            <li
              className="flex h-7 min-w-0 items-center gap-2 rounded-md ps-[1.375rem] pe-1 text-xs"
              key={item.project.id}
            >
              <MicroLabel className="w-10 shrink-0 truncate">
                {environmentRoleLabel(role) ?? ""}
              </MicroLabel>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {item.project.name}
              </span>
              <span className="flex w-6 shrink-0 justify-center">
                <ZeropsRoutesMenu
                  label={`Public access of ${item.project.name}`}
                  routes={item.routes ?? []}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
