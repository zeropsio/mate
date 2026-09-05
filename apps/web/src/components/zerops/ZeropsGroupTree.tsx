/**
 * The group tree — the left menu of the settled model.
 *
 * One user-facing project ("Beviro CRM") is a **group**; each Zerops project
 * inside it is an **environment**: one container, one agent, one conversation.
 * Account-level tools (Gitea) sit in their own section, never inside a group,
 * because a tool the whole account shares has no dev/stage/production axis and
 * putting it in a group would make that group own the account's git host.
 *
 * Structural only. It renders the shape and the words that are its own (role,
 * group summary) and takes every environment's status as an injected slot —
 * `candidates.ts` already classifies containers and the picker already phrases
 * them, so a status table here would be a third opinion about one fact (R5).
 *
 * Grouping, ordering, naming and the tools split are all
 * `buildZeropsGroupTree`; this file decides none of them.
 */

import type { ReactNode } from "react";
import type {
  ZeropsEnvironmentRole,
  ZeropsGroup,
  ZeropsGroupTreeView,
  ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";

import { cn } from "~/lib/utils";
import { MicroLabel } from "./primitives";
import {
  creatableRoles,
  environmentRoleLabel,
  groupNameIsPlaceholder,
  groupSummaryLabel,
} from "./ZeropsGroupTree.logic";

export interface ZeropsGroupTreeProps<T> {
  readonly view: ZeropsGroupTreeView<T>;
  /** Stable list key for one environment carrier. */
  readonly getKey: (item: T) => string;
  /** What this environment is called in the tree. */
  readonly getName: (item: T) => string;
  /** The row's status — owned by the caller, never by this tree. */
  readonly renderStatus: (item: T) => ReactNode;
  /**
   * A tool's status, which is a different question from an environment's.
   * A tool has no Mate container by design, so the environment classifier
   * calls it unavailable and names a container it was never supposed to have.
   * Falls back to {@link renderStatus} for a caller that has nothing better.
   */
  readonly renderToolStatus?: (item: T) => ReactNode;
  readonly onSelect?: (item: T) => void;
  /** Absent hides every create affordance — used where the tree is read-only. */
  readonly onCreateEnvironment?: (groupId: string, role: ZeropsEnvironmentRole) => void;
  /** Absent hides the tools section's own action. */
  readonly onCreateTool?: (kind: ZeropsToolKind) => void;
  /**
   * A creation is already running. Every create affordance is disabled rather
   * than hidden: a second click mid-run would make a second project, and a
   * button that vanishes under the pointer reads as a bug.
   */
  readonly creating?: boolean;
  /**
   * The agent's name, when the environment has one. Leads the row: on this
   * screen the project name still matters (it is what the Zerops GUI shows),
   * so the two sit side by side rather than one replacing the other.
   */
  readonly getAgentName?: (item: T) => string | undefined;
  /** One muted line under the name — an error, health prose, or a reason. */
  readonly renderDetail?: (item: T) => ReactNode;
  /** The row's one action, in its own right-aligned cell after the status. */
  readonly renderAction?: (item: T) => ReactNode;
  /** Marks the row busy while its action runs. */
  readonly isBusy?: (item: T) => boolean;
  /** The row's secondary actions, after the action cell — rename, move, and so on. */
  readonly renderMenu?: (item: T) => ReactNode;
  /** A group's own actions, beside its header. */
  readonly renderGroupMenu?: (group: ZeropsGroup) => ReactNode;
  readonly className?: string;
}

const TOOL_LABEL: Record<ZeropsToolKind, string> = { gitea: "Gitea" };

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <MicroLabel className="px-2">{label}</MicroLabel>
      {children}
    </section>
  );
}

function Row({
  name,
  agentName,
  badge,
  status,
  detail,
  action,
  menu,
  busy = false,
  reserveAction = false,
  reserveMenu = false,
  onSelect,
}: {
  readonly name: string;
  readonly agentName?: string | undefined;
  readonly badge?: string | null;
  readonly status?: ReactNode;
  readonly detail?: ReactNode;
  readonly action?: ReactNode;
  readonly menu?: ReactNode;
  readonly busy?: boolean;
  /**
   * Keep the action and menu cells even when this row has nothing to put in
   * them: health answers arrive row by row, and a pill appearing must not
   * move anything around it.
   */
  readonly reserveAction?: boolean;
  readonly reserveMenu?: boolean;
  readonly onSelect?: () => void;
}) {
  // The name is the clickable part, so an action button can sit beside it
  // without nesting one button in another.
  const title = (
    <>
      {agentName === undefined ? (
        <span className="truncate">{name}</span>
      ) : (
        <>
          <span className="truncate font-medium">{agentName}</span>
          <span className="truncate text-[var(--muted-foreground)]">{name}</span>
        </>
      )}
    </>
  );

  return (
    <div
      aria-busy={busy || undefined}
      className="flex min-h-[3.125rem] w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 sm:flex-nowrap"
      data-zerops-project-row="true"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {onSelect ? (
            <button
              className="flex min-w-0 items-center gap-2 rounded-sm text-left hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onSelect}
              type="button"
            >
              {title}
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-2">{title}</span>
          )}
          {badge ? (
            <span className="shrink-0 text-[length:var(--zerops-micro-label-font-size)] text-[var(--muted-foreground)]">
              {badge}
            </span>
          ) : null}
        </div>
        {detail ? (
          <div className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{detail}</div>
        ) : null}
      </div>
      {/* Fixed cells, so every row's status, action and menu line up down the
          page and a row keeps its shape while its answers arrive. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex w-40 shrink-0 items-center justify-end" data-zerops-row-cell="status">
          {status}
        </div>
        {reserveAction ? (
          <div
            className="flex w-44 shrink-0 items-center justify-end"
            data-zerops-row-cell="action"
          >
            {action}
          </div>
        ) : null}
        {reserveMenu ? (
          <div
            className="flex w-8 shrink-0 items-center justify-center"
            data-zerops-row-cell="menu"
          >
            {menu}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ZeropsGroupTree<T>({
  view,
  getKey,
  getName,
  renderStatus,
  renderToolStatus,
  onSelect,
  onCreateEnvironment,
  onCreateTool,
  creating = false,
  getAgentName,
  renderDetail,
  renderAction,
  isBusy,
  renderMenu,
  renderGroupMenu,
  className,
}: ZeropsGroupTreeProps<T>) {
  const reserved = {
    reserveAction: renderAction !== undefined,
    reserveMenu: renderMenu !== undefined,
  };
  const rowExtras = (item: T) => ({
    ...reserved,
    ...(getAgentName === undefined ? {} : { agentName: getAgentName(item) }),
    ...(renderDetail === undefined ? {} : { detail: renderDetail(item) }),
    ...(renderAction === undefined ? {} : { action: renderAction(item) }),
    ...(isBusy === undefined ? {} : { busy: isBusy(item) }),
    ...(renderMenu === undefined ? {} : { menu: renderMenu(item) }),
    ...(onSelect ? { onSelect: () => onSelect(item) } : {}),
  });
  return (
    <nav
      aria-label="Projects and environments"
      className={cn("flex flex-col gap-4", className)}
      data-zerops-surface="group-tree"
    >
      {view.groups.map(({ group, environments }) => (
        <section
          className="flex flex-col gap-1"
          data-zerops-group={group.groupId}
          key={group.groupId}
        >
          <header className="flex flex-col gap-0.5 px-2">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 truncate text-sm font-medium",
                  groupNameIsPlaceholder(group) && "text-[var(--muted-foreground)] italic",
                )}
              >
                {group.name}
              </span>
              {renderGroupMenu === undefined ? null : renderGroupMenu(group)}
            </span>
            {/* Visible rather than a tooltip: it is an invitation to name the
                group, and it disappears the moment one does. */}
            {groupNameIsPlaceholder(group) ? (
              <span className="text-[length:var(--zerops-micro-label-font-size)] text-[var(--muted-foreground)]">
                This group has no name yet
              </span>
            ) : null}
            <span className="text-[length:var(--zerops-micro-label-font-size)] text-[var(--muted-foreground)]">
              {groupSummaryLabel(group)}
            </span>
          </header>

          {environments.map(({ item, role }) => (
            <Row
              badge={environmentRoleLabel(role)}
              key={getKey(item)}
              name={getName(item)}
              status={renderStatus(item)}
              {...rowExtras(item)}
            />
          ))}

          {onCreateEnvironment
            ? creatableRoles(group).map((role) => (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                  disabled={creating}
                  key={role}
                  onClick={() => onCreateEnvironment(group.groupId, role)}
                  type="button"
                >
                  <span aria-hidden="true">+</span>
                  <span>Add {environmentRoleLabel(role)?.toLowerCase()}</span>
                </button>
              ))
            : null}
        </section>
      ))}

      {view.ungrouped.length > 0 ? (
        <Section label="Ungrouped">
          {view.ungrouped.map((item) => (
            <Row
              key={getKey(item)}
              name={getName(item)}
              status={renderStatus(item)}
              {...rowExtras(item)}
            />
          ))}
        </Section>
      ) : null}

      {/* Account-level, so last: a tool belongs to no group and to no
          environment's dev/stage/production axis. */}
      {view.tools.length > 0 || onCreateTool ? (
        <Section label="Tools">
          {view.tools.map(({ item, kind }) => (
            <Row
              key={getKey(item)}
              name={TOOL_LABEL[kind]}
              status={(renderToolStatus ?? renderStatus)(item)}
              {...reserved}
              {...(renderDetail === undefined ? {} : { detail: renderDetail(item) })}
              {...(onSelect ? { onSelect: () => onSelect(item) } : {})}
            />
          ))}
          {onCreateTool && view.tools.every((tool) => tool.kind !== "gitea") ? (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              disabled={creating}
              onClick={() => onCreateTool("gitea")}
              type="button"
            >
              <span aria-hidden="true">+</span>
              <span>Add Gitea</span>
            </button>
          ) : null}
        </Section>
      ) : null}
    </nav>
  );
}
