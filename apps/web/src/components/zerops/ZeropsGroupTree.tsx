/**
 * The projects screen's shape — the settled model, laid out.
 *
 * One user-facing project ("Beviro CRM") is a **group**; each Zerops project
 * inside it is an **environment** — dev, stage, production. A dev environment
 * with a Mate in it is, to the person reading this page, the **Mate**: one
 * agent, one conversation, a name a person addresses. So a project is its
 * name, then its Mates as cards, two to a line — who you talk to — then its
 * other environments as a list — where the code runs. Two registers because
 * they are two things; the cards carry colour and a face, the rows carry a
 * name, a tag and what the environment holds, and neither pretends to be the
 * other. Cards and rows share one width, so every menu on the page sits in
 * one column. Account-level tools (Gitea) sit in their own grid of cards,
 * never inside a project, because a tool the whole account shares has no
 * dev/stage/production axis. The add verbs — Mate, stage, production — are
 * one quiet row under the group, offered once the caller says the group is
 * ready for more.
 *
 * An account with no project yet gets one thing instead of the shape: what a
 * Mate is, and the action that makes one. It is the tree's own, like the
 * headings and the create affordances, because emptiness is a fact about the
 * view — no caller can see it earlier.
 *
 * Structural only. It renders the shape and the words that are its own (the
 * heading, the create affordances) and takes every card and row as an
 * injected slot — who lives where and what they are doing is the caller's to
 * phrase (R5). Grouping, ordering, naming and the tools split are all
 * `buildZeropsGroupTree`; which environment is a Mate's is `hasMate`; this
 * file decides none of them.
 */

import type {
  ZeropsEnvironmentRole,
  ZeropsGroup,
  ZeropsGroupTreeView,
  ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";
import { Fragment, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MateFace, Pill } from "./primitives";
import {
  creatableRoles,
  environmentRoleLabel,
  groupNameIsPlaceholder,
} from "./ZeropsGroupTree.logic";

export interface ZeropsGroupTreeProps<T> {
  readonly view: ZeropsGroupTreeView<T>;
  /** Stable list key for one environment carrier. */
  readonly getKey: (item: T) => string;
  /** Whether a Mate lives in this environment (`hasMate`): a card, then, rather than a row. */
  readonly isMate: (item: T) => boolean;
  /** A Mate's card — a `ZeropsMateCard`. Everything in it is the caller's. */
  readonly renderMate: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** An environment's row — a `ZeropsEnvironmentRow`. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** A tool's card — a `ZeropsToolCard`, a different question from an environment's. */
  readonly renderTool: (item: T, kind: ZeropsToolKind) => ReactNode;
  /**
   * Rows of a group that are not one of its Zerops projects — today the open
   * pull requests on its group repo, which are changes to what its
   * environments are made of (`groupRows.ts`). They land at the end of the
   * same list the environments are in, because they are read in the same
   * pass: who you talk to, where the code runs, what is waiting to change.
   */
  readonly renderGroupRows?: (group: ZeropsGroup) => ReactNode;
  /** Absent hides every create affordance — used where the tree is read-only. */
  readonly onCreateEnvironment?: (groupId: string, role: ZeropsEnvironmentRole) => void;
  /** Absent hides the tools section's own action. */
  readonly onCreateTool?: (kind: ZeropsToolKind) => void;
  /**
   * Starts a project that does not exist yet — the account's first. Absent
   * leaves an empty account empty, which is what a read-only tree wants.
   */
  readonly onCreateProject?: (() => void) | undefined;
  /**
   * A creation is already running. Every create affordance is disabled rather
   * than hidden: a second click mid-run would make a second project, and a
   * button that vanishes under the pointer reads as a bug.
   */
  readonly creating?: boolean;
  /**
   * Whether a group is ready for more — its add verbs are offered only when
   * this says so. The caller knows what the tree cannot: whether the group's
   * first Mate has booted. Absent offers them always.
   */
  readonly addsOffered?: ((group: ZeropsGroup) => boolean) | undefined;
  /** A group's own actions, at the end of its heading — shown on hover, like a row's. */
  readonly renderGroupMenu?: (group: ZeropsGroup) => ReactNode;
  /**
   * One line under a group's name, when the group has something to say about
   * itself as a whole — today only that its repositories are still being made
   * (`groupRows.ts`). Empty is the usual answer and renders nothing, so the
   * heading's height does not depend on an answer that arrives late.
   */
  readonly groupLine?: (group: ZeropsGroup) => string;
  readonly className?: string;
}

const TOOL_LABEL: Record<ZeropsToolKind, string> = { gitea: "Gitea" };

/** Cards two to a line: the Mates, and the tools in the same grid so one card is one width. */
const CARD_GRID_CLASS = "grid gap-3 sm:grid-cols-2";

const ADD_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** How a role reads on its add verb: a dev environment is a Mate. */
function addLabel(role: ZeropsEnvironmentRole): string {
  return role === "dev" ? "Mate" : (environmentRoleLabel(role)?.toLowerCase() ?? role);
}

/**
 * First run owns the page: to an account that has nothing in it yet this is
 * the whole screen, not a card under a list header.
 *
 * The Mate is the picture — its face large, awake and looking back, because
 * a Mate is the point and the person has not met one. One line says what a
 * Mate is and what the click starts, minutes included, and the one filled
 * button ends the screen. A column in the middle of the page, text aligned
 * left inside it, so it reads as an invitation rather than a stranded card.
 */
function FirstRun({
  onCreateProject,
  creating,
}: {
  readonly onCreateProject: () => void;
  readonly creating: boolean;
}) {
  return (
    <section
      className="flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-6"
      data-zerops-surface="first-run"
    >
      <MateFace className="size-20" size="lg" state="idle" tint="slate" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Start a project</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          A Mate is a coding agent with a dev environment of its own and one conversation you come
          back to. Name a project and it is up in a few minutes, Git hosting alongside.
        </p>
      </div>
      <Pill disabled={creating} label="New project" onClick={onCreateProject} />
    </section>
  );
}

function Heading({
  name,
  placeholder = false,
  menu,
  muted = false,
}: {
  readonly name: string;
  readonly placeholder?: boolean;
  readonly menu?: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <header className="group/project flex min-h-7 min-w-0 items-center gap-2">
      <h2
        className={cn(
          "min-w-0 truncate text-[15px] font-semibold tracking-tight",
          muted ? "text-muted-foreground" : "text-foreground",
          placeholder && "font-normal text-muted-foreground italic",
        )}
      >
        {name}
      </h2>
      {menu === undefined || menu === null ? null : (
        <span className="ms-auto flex opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </span>
      )}
    </header>
  );
}

/** A project's members: the Mates as cards, then the other environments as a list. */
function Members<T>({
  entries,
  getKey,
  isMate,
  renderMate,
  renderEnvironment,
  extraRows,
}: {
  readonly entries: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>;
  readonly getKey: (item: T) => string;
  readonly isMate: (item: T) => boolean;
  readonly renderMate: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** The group's rows that are not environments, after them. */
  readonly extraRows?: ReactNode;
}) {
  const mates = entries.filter(({ item }) => isMate(item));
  const others = entries.filter(({ item }) => !isMate(item));
  return (
    <>
      {mates.length > 0 ? (
        <div className={CARD_GRID_CLASS} data-zerops-surface="mate-cards">
          {mates.map(({ item, role }) => (
            <Fragment key={getKey(item)}>{renderMate(item, role)}</Fragment>
          ))}
        </div>
      ) : null}
      {others.length > 0 || (extraRows !== undefined && extraRows !== null) ? (
        <ul
          className="flex flex-col divide-y divide-border/50"
          data-zerops-surface="environment-rows"
        >
          {others.map(({ item, role }) => (
            <Fragment key={getKey(item)}>{renderEnvironment(item, role)}</Fragment>
          ))}
          {extraRows}
        </ul>
      ) : null}
    </>
  );
}

export function ZeropsGroupTree<T>({
  view,
  getKey,
  isMate,
  renderMate,
  renderEnvironment,
  renderTool,
  renderGroupRows,
  onCreateEnvironment,
  onCreateTool,
  onCreateProject,
  creating = false,
  addsOffered,
  renderGroupMenu,
  groupLine,
  className,
}: ZeropsGroupTreeProps<T>) {
  const members = (
    entries: ReadonlyArray<{ readonly item: T; readonly role: ZeropsEnvironmentRole | undefined }>,
    extraRows?: ReactNode,
  ) => (
    <Members
      entries={entries}
      getKey={getKey}
      isMate={isMate}
      renderEnvironment={renderEnvironment}
      renderMate={renderMate}
      {...(extraRows === undefined ? {} : { extraRows })}
    />
  );

  // A tool is not a project, so an account holding nothing but Gitea is still
  // an account that has not started.
  const started = view.groups.length > 0 || view.ungrouped.length > 0;
  const firstRun = onCreateProject !== undefined && !started;

  return (
    <nav
      aria-label="Projects, their Mates and environments"
      className={cn("flex flex-col gap-10", className)}
      data-zerops-surface="group-tree"
    >
      {firstRun ? <FirstRun creating={creating} onCreateProject={onCreateProject} /> : null}
      {view.groups.map(({ group, environments }) => {
        // The add verbs wait for the first Mate: a group is offered more only
        // once the caller says it is ready for more.
        const missing =
          onCreateEnvironment && (addsOffered?.(group) ?? true) ? creatableRoles(group) : [];
        return (
          <section
            className="flex flex-col gap-3"
            data-zerops-group={group.groupId}
            key={group.groupId}
          >
            <div className="flex flex-col gap-0.5">
              <Heading
                menu={renderGroupMenu?.(group)}
                name={group.name}
                placeholder={groupNameIsPlaceholder(group)}
              />
              {/* Visible rather than a tooltip: it is an invitation to name the
                  project, and it disappears the moment one does. */}
              {groupNameIsPlaceholder(group) ? (
                <span className="text-xs text-muted-foreground">This project has no name yet</span>
              ) : null}
              {/* The group's own one line, when it has one. */}
              {(groupLine?.(group) ?? "").length > 0 ? (
                <span className="text-xs text-muted-foreground">{groupLine?.(group)}</span>
              ) : null}
            </div>
            {members(environments, renderGroupRows?.(group))}
            {missing.length > 0 ? (
              <div
                className="-ms-1.5 flex flex-wrap items-center gap-1"
                data-zerops-surface="add-roles"
              >
                {missing.map((role) => (
                  <button
                    className={ADD_BUTTON_CLASS}
                    disabled={creating}
                    key={role}
                    onClick={() => onCreateEnvironment?.(group.groupId, role)}
                    type="button"
                  >
                    <span aria-hidden="true">+</span>
                    <span>Add {addLabel(role)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      {view.ungrouped.length > 0 ? (
        // "Ungrouped" is a distinction, so it is named only when there is a
        // project to be distinct from; an account of loose environments is a list.
        <section className="flex flex-col gap-3" data-zerops-ungrouped="true">
          {view.groups.length > 0 ? <Heading muted name="Ungrouped" /> : null}
          {members(view.ungrouped.map((item) => ({ item, role: undefined })))}
        </section>
      ) : null}

      {/* Account-level, so last: a tool belongs to no group and to no
          environment's dev/stage/production axis. An account that has not
          started is not offered one either: its first project brings Gitea
          along, so the only thing to click on that page is *New project*. */}
      {view.tools.length > 0 || (onCreateTool && started) ? (
        <section className="flex flex-col gap-3" data-zerops-tools="true">
          <div className="flex flex-col gap-0.5">
            <Heading muted name="Tools" />
            {/* An account with no tools yet gets the heading's reason for being
                there; one that has them lets the rows speak. */}
            {view.tools.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Git hosting for your Mates, with runners that deploy what they push.
              </span>
            ) : null}
          </div>
          {view.tools.length > 0 ? (
            <div className={CARD_GRID_CLASS} data-zerops-surface="tool-rows">
              {view.tools.map(({ item, kind }) => (
                <Fragment key={getKey(item)}>{renderTool(item, kind)}</Fragment>
              ))}
            </div>
          ) : null}
          {onCreateTool && started && view.tools.every((tool) => tool.kind !== "gitea") ? (
            <div className="-ms-1.5 flex items-center" data-zerops-surface="add-tools">
              <button
                className={ADD_BUTTON_CLASS}
                disabled={creating}
                onClick={() => onCreateTool("gitea")}
                type="button"
              >
                <span aria-hidden="true">+</span>
                <span>Add {TOOL_LABEL.gitea}</span>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </nav>
  );
}

export { TOOL_LABEL };
