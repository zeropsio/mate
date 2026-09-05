/**
 * The projects screen's shape — the settled model, laid out.
 *
 * One user-facing project ("Beviro CRM") is a **group**; each Zerops project
 * inside it is an **environment** — dev, stage, production. An environment
 * with a Mate container has a **Mate** in it: one agent, one conversation, a
 * name a person addresses. A project is one table: a row per environment in
 * role order, the Mate leading the rows it lives in and the empty seat
 * leading the rest, with the same columns in every project so the whole page
 * lines up. Account-level tools (Gitea) sit in their own table, never inside
 * a project, because a tool the whole account shares has no
 * dev/stage/production axis.
 *
 * Structural only. It renders the shape and the words that are its own (the
 * heading, the summary, the column names, the create affordances) and takes
 * every row as an injected slot — who lives where and what they are doing is
 * the caller's to phrase (R5). Grouping, ordering, naming and the tools split
 * are all `buildZeropsGroupTree`; this file decides none of them.
 */

import type { ReactNode } from "react";
import type {
  ZeropsEnvironmentRole,
  ZeropsGroup,
  ZeropsGroupTreeView,
  ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";

import { cn } from "~/lib/utils";
import { ZeropsEnvironmentTableHeader } from "./ZeropsEnvironmentRow";
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
  /** An environment's row — a `ZeropsEnvironmentRow`. Everything in it is the caller's. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** A tool's row — a different question from an environment's. */
  readonly renderTool: (item: T, kind: ZeropsToolKind) => ReactNode;
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
  /** A group's own actions, beside its heading — shown on hover, like a row's. */
  readonly renderGroupMenu?: (group: ZeropsGroup) => ReactNode;
  readonly className?: string;
}

const TOOL_LABEL: Record<ZeropsToolKind, string> = { gitea: "Gitea" };

const ADD_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

function Heading({
  name,
  placeholder = false,
  summary,
  menu,
  muted = false,
}: {
  readonly name: string;
  readonly placeholder?: boolean;
  readonly summary?: string;
  readonly menu?: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <header className="group/project flex min-w-0 items-baseline gap-2">
      <h2
        className={cn(
          "min-w-0 truncate text-[15px] font-semibold tracking-tight",
          muted ? "text-muted-foreground" : "text-foreground",
          placeholder && "font-normal text-muted-foreground italic",
        )}
      >
        {name}
      </h2>
      {summary === undefined ? null : (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
      )}
      {menu === undefined || menu === null ? null : (
        <span className="-my-1.5 self-center opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </span>
      )}
    </header>
  );
}

/** A table: the shared header, hairline-divided rows, and a quiet footer. */
function Table({
  children,
  footer,
  lead,
  surface,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly lead?: string;
  readonly surface: string;
}) {
  return (
    <div
      className="flex flex-col divide-y divide-border/40 rounded-[var(--zerops-card-radius)] border border-border/60 bg-card"
      data-zerops-surface={surface}
      role="table"
    >
      <ZeropsEnvironmentTableHeader {...(lead === undefined ? {} : { lead })} />
      {children}
      {footer === undefined ? null : (
        <div className="flex flex-wrap items-center gap-1 px-1.5 py-1" role="row">
          {footer}
        </div>
      )}
    </div>
  );
}

export function ZeropsGroupTree<T>({
  view,
  getKey,
  renderEnvironment,
  renderTool,
  onCreateEnvironment,
  onCreateTool,
  creating = false,
  renderGroupMenu,
  className,
}: ZeropsGroupTreeProps<T>) {
  return (
    <nav
      aria-label="Projects, their Mates and environments"
      className={cn("flex flex-col gap-8", className)}
      data-zerops-surface="group-tree"
    >
      {view.groups.map(({ group, environments }) => {
        const missing = onCreateEnvironment ? creatableRoles(group) : [];
        return (
          <section
            className="flex flex-col gap-2.5"
            data-zerops-group={group.groupId}
            key={group.groupId}
          >
            <div className="flex flex-col gap-0.5">
              <Heading
                menu={renderGroupMenu?.(group)}
                name={group.name}
                placeholder={groupNameIsPlaceholder(group)}
                summary={groupSummaryLabel(group)}
              />
              {/* Visible rather than a tooltip: it is an invitation to name the
                  project, and it disappears the moment one does. */}
              {groupNameIsPlaceholder(group) ? (
                <span className="text-xs text-muted-foreground">This project has no name yet</span>
              ) : null}
            </div>
            <Table
              footer={
                missing.length > 0 ? (
                  <span className="contents" data-zerops-surface="add-roles">
                    {missing.map((role) => (
                      <button
                        className={ADD_BUTTON_CLASS}
                        disabled={creating}
                        key={role}
                        onClick={() => onCreateEnvironment?.(group.groupId, role)}
                        type="button"
                      >
                        <span aria-hidden="true">+</span>
                        <span>Add {environmentRoleLabel(role)?.toLowerCase()}</span>
                      </button>
                    ))}
                  </span>
                ) : undefined
              }
              surface="environment-rows"
            >
              {environments.map(({ item, role }) => (
                <div className="contents" key={getKey(item)}>
                  {renderEnvironment(item, role)}
                </div>
              ))}
            </Table>
          </section>
        );
      })}

      {view.ungrouped.length > 0 ? (
        // "Ungrouped" is a distinction, so it is named only when there is a
        // project to be distinct from; an account of loose environments is a list.
        <section className="flex flex-col gap-2.5" data-zerops-ungrouped="true">
          {view.groups.length > 0 ? <Heading muted name="Ungrouped" /> : null}
          <Table surface="environment-rows">
            {view.ungrouped.map((item) => (
              <div className="contents" key={getKey(item)}>
                {renderEnvironment(item, undefined)}
              </div>
            ))}
          </Table>
        </section>
      ) : null}

      {/* Account-level, so last: a tool belongs to no group and to no
          environment's dev/stage/production axis. */}
      {view.tools.length > 0 || onCreateTool ? (
        <section className="flex flex-col gap-2.5" data-zerops-tools="true">
          <Heading muted name="Tools" />
          {view.tools.length > 0 || onCreateTool ? (
            <Table
              footer={
                onCreateTool && view.tools.every((tool) => tool.kind !== "gitea") ? (
                  <button
                    className={ADD_BUTTON_CLASS}
                    disabled={creating}
                    onClick={() => onCreateTool("gitea")}
                    type="button"
                  >
                    <span aria-hidden="true">+</span>
                    <span>Add {TOOL_LABEL.gitea}</span>
                  </button>
                ) : undefined
              }
              lead="Tool"
              surface="tool-rows"
            >
              {view.tools.map(({ item, kind }) => (
                <div className="contents" key={getKey(item)}>
                  {renderTool(item, kind)}
                </div>
              ))}
            </Table>
          ) : null}
        </section>
      ) : null}
    </nav>
  );
}

export { TOOL_LABEL };
