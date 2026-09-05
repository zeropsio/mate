/**
 * The left menu's environments: every project on the account that has Mate,
 * under the group it belongs to.
 *
 * Membership is `selectMateEnvironments` — the project has a Mate container —
 * and never the live connection, so a container going to sleep changes a dot
 * rather than rearranging the menu. Grouping is `buildZeropsGroupTree`, the
 * same derivation the projects screen uses, so the two surfaces can never
 * disagree about which group a project is in.
 *
 * Everything else about the account lives on the projects screen. This is
 * where you work; that is where you manage.
 */
import {
  botDisplayName,
  buildZeropsGroupTree,
  hasBotName,
  mateEnvironmentsEmptyReason,
  readZeropsGroupTags,
  selectMateEnvironments,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MicroLabel, StatusDot } from "./primitives";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";

/**
 * The bucket, as a roster word. A row answers "what is this agent up to",
 * so a connected environment with nothing running is idle, not "connected"
 * — the socket is the client's business, not the person's. The dot keeps
 * the design system's grammar: teal is the connected dot.
 */
const TONE = {
  connected: "ok",
  ready: "off",
  provisioning: "busy",
  unavailable: "attention",
} as const;

const LABEL = {
  connected: "Idle",
  ready: "Ready",
  provisioning: "Starting",
  unavailable: "Unavailable",
} as const;

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
};

export interface SidebarZeropsTreeProps<T extends RosterCandidate> {
  readonly candidates: ReadonlyArray<T>;
  readonly onSelect: (candidate: T) => void;
  /** Opens the projects screen — the only route out of an empty menu. */
  readonly onBrowseProjects: () => void;
  readonly activeProjectId?: string | null;
  /**
   * What this agent is doing right now, one short line.
   *
   * Injected because the answer is a thread's status, and `resolveThreadStatus`
   * is the one resolver for that (R5) — this tree must not grow a second
   * opinion about whether an agent is working. Absent for an environment mate
   * is not connected to, because then nobody knows.
   */
  readonly renderActivity?: (candidate: T) => ReactNode;
  readonly className?: string;
}

export function SidebarZeropsTree<T extends RosterCandidate>({
  candidates,
  onSelect,
  onBrowseProjects,
  activeProjectId,
  renderActivity,
  className,
}: SidebarZeropsTreeProps<T>) {
  const environments = selectMateEnvironments(candidates);
  const emptyReason = mateEnvironmentsEmptyReason(candidates);

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

  const view = buildZeropsGroupTree(environments);

  return (
    <nav
      aria-label="Environments"
      className={cn("flex flex-col gap-4", className)}
      data-zerops-surface="sidebar-environments"
    >
      {view.groups.map(({ group, environments: rows }) => (
        <section className="flex flex-col gap-0.5" key={group.groupId}>
          <MicroLabel className="px-2 pb-1">{group.name}</MicroLabel>
          {rows.map(({ item, role }) => (
            <Row
              active={item.project.id === activeProjectId}
              badge={environmentRoleLabel(role)}
              candidate={item}
              key={item.key}
              onSelect={onSelect}
              {...(renderActivity ? { renderActivity } : {})}
            />
          ))}
        </section>
      ))}

      {view.ungrouped.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          {view.groups.length > 0 ? <MicroLabel className="px-2 pb-1">Ungrouped</MicroLabel> : null}
          {view.ungrouped.map((item) => (
            <Row
              active={item.project.id === activeProjectId}
              candidate={item}
              key={item.key}
              onSelect={onSelect}
              {...(renderActivity ? { renderActivity } : {})}
            />
          ))}
        </section>
      ) : null}
    </nav>
  );
}

function Row<T extends RosterCandidate>({
  candidate,
  badge,
  active,
  onSelect,
  renderActivity,
}: {
  readonly candidate: T;
  readonly badge?: string | null;
  readonly active: boolean;
  readonly onSelect: (candidate: T) => void;
  readonly renderActivity?: (candidate: T) => ReactNode;
}) {
  const bot = readZeropsGroupTags(candidate.project.tagList).bot;
  const name = botDisplayName({ bot, projectName: candidate.project.name });
  const activity = renderActivity?.(candidate);

  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        active ? "bg-sidebar-row-hover" : "hover:bg-sidebar-row-hover",
      )}
      onClick={() => onSelect(candidate)}
      type="button"
    >
      {/* The agent's name leads. Under its group and next to its role badge,
          the project name would be the same fact told three times — and it
          is not the thing a person addresses. */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          hasBotName(bot) ? undefined : "text-[var(--muted-foreground)]",
        )}
      >
        {name}
      </span>
      {badge ? (
        <span className="shrink-0 text-[length:var(--zerops-micro-label-font-size)] text-[var(--muted-foreground)]">
          {badge}
        </span>
      ) : null}
      {/* One trailing column, right-aligned so it lines up down the menu:
          what the agent is doing when that is knowable, else where it stands.
          The activity replaces the bucket rather than joining it — a row that
          says "Connected · Working" says the first word for no reason. */}
      <span className="ms-auto flex shrink-0 items-center text-[var(--muted-foreground)]">
        {activity ??
          (candidate.group !== "connected" && isConnecting(candidate.connection) ? (
            <StatusDot label="Connecting" tone="busy" />
          ) : (
            <StatusDot label={LABEL[candidate.group]} tone={TONE[candidate.group]} />
          ))}
      </span>
    </button>
  );
}

/**
 * The agent's status as the trailing column of its row: the thread status
 * pill the sidebar's own thread rows use, so an environment and a
 * conversation never disagree about what "working" looks like.
 */
export function AgentActivity({
  status,
}: {
  readonly status: {
    readonly label: string;
    readonly colorClass: string;
    readonly dotClass: string;
    readonly pulse: boolean;
  };
}) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", status.colorClass)}
      data-zerops-surface="agent-activity"
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-2 shrink-0 rounded-full",
          status.dotClass,
          status.pulse && "animate-status-pulse motion-reduce:animate-none",
        )}
      />
      <MicroLabel className="truncate">{status.label}</MicroLabel>
    </span>
  );
}
