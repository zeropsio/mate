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
  readonly onSelect?: (item: T) => void;
  /** Absent hides every create affordance — used where the tree is read-only. */
  readonly onCreateEnvironment?: (groupId: string, role: ZeropsEnvironmentRole) => void;
  /** Absent hides the tools section's own action. */
  readonly onCreateTool?: (kind: ZeropsToolKind) => void;
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
  badge,
  status,
  onSelect,
}: {
  readonly name: string;
  readonly badge?: string | null;
  readonly status?: ReactNode;
  readonly onSelect?: () => void;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {badge ? (
        <span className="shrink-0 text-[length:var(--zerops-micro-label-font-size)] text-[var(--muted-foreground)]">
          {badge}
        </span>
      ) : null}
      {status}
    </>
  );

  const shared = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm";

  return onSelect ? (
    <button className={cn(shared, "hover:bg-[var(--accent)]")} onClick={onSelect} type="button">
      {content}
    </button>
  ) : (
    <div className={shared}>{content}</div>
  );
}

export function ZeropsGroupTree<T>({
  view,
  getKey,
  getName,
  renderStatus,
  onSelect,
  onCreateEnvironment,
  onCreateTool,
  className,
}: ZeropsGroupTreeProps<T>) {
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
            <span
              className={cn(
                "truncate text-sm font-medium",
                groupNameIsPlaceholder(group) && "text-[var(--muted-foreground)] italic",
              )}
            >
              {group.name}
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
              {...(onSelect ? { onSelect: () => onSelect(item) } : {})}
            />
          ))}

          {onCreateEnvironment
            ? creatableRoles(group).map((role) => (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
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

      {view.tools.length > 0 || onCreateTool ? (
        <Section label="Tools">
          {view.tools.map(({ item, kind }) => (
            <Row
              key={getKey(item)}
              name={TOOL_LABEL[kind]}
              status={renderStatus(item)}
              {...(onSelect ? { onSelect: () => onSelect(item) } : {})}
            />
          ))}
          {onCreateTool && view.tools.every((tool) => tool.kind !== "gitea") ? (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              onClick={() => onCreateTool("gitea")}
              type="button"
            >
              <span aria-hidden="true">+</span>
              <span>Add Gitea</span>
            </button>
          ) : null}
        </Section>
      ) : null}

      {view.ungrouped.length > 0 ? (
        <Section label="Ungrouped">
          {view.ungrouped.map((item) => (
            <Row
              key={getKey(item)}
              name={getName(item)}
              status={renderStatus(item)}
              {...(onSelect ? { onSelect: () => onSelect(item) } : {})}
            />
          ))}
        </Section>
      ) : null}
    </nav>
  );
}
