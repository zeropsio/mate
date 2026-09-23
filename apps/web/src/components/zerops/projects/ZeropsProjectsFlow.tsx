/**
 * The projects page, laid out around the one flow a project's code travels:
 * Mates (with their preview) → pull requests → `main` → production, a group
 * stage as an optional side branch of `main`, drawn only where one exists
 * (the owner, 2026-09-23 — "extremely important findings the whole UI should
 * be built around").
 *
 * Two views over the same `groupFlow`s:
 *
 * - **Overview** — a "Next steps" strip across the groups, then one row per
 *   group with work on it, the steps as columns and the verb in the cell it
 *   belongs to; a row opens to the Mates' last words and what a release would
 *   carry. A group with only a Mate nobody has spoken to is a tile; the
 *   containers no project holds are one line with their states.
 * - **Projects** — every group as a card, its four steps side by side.
 *
 * Structural only, like the tree it replaced: every card, row, verb and menu
 * is an injected slot the page fills (R5), and what each step says is
 * `groupFlow`'s and `projectsView.logic`'s. An account with no project yet
 * gets the invitation instead of the shape.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  ZeropsEnvironmentRole,
  ZeropsGroup,
  ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../../ui/button";
import { MateFace, MicroLabel, Pill, StatusDot } from "../primitives";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  containersSummary,
  foldGroups,
  foldUngrouped,
  groupMetaLine,
  mainCell,
  nextStepCell,
  nextStepTone,
  productionCell,
  pullRequestsLine,
  stopLine,
  TOOL_LABEL,
  type FlowCell,
} from "./projectsView.logic";

/** One group as the page lays it out: its flow and the carriers the slots draw. */
export interface ProjectsFlowGroup<T> {
  readonly group: ZeropsGroup;
  readonly flow: GroupFlow;
  /** Its project flow was read. Unread is not empty. */
  readonly read: boolean;
  /** The Mates' environments, in the tree's order. */
  readonly mates: ReadonlyArray<T>;
  /** Its stages and its production, by project id. */
  readonly stops: ReadonlyMap<
    string,
    { readonly item: T; readonly role: ZeropsEnvironmentRole | undefined }
  >;
  /** Anything else it holds — a dev box without a Mate, a dev/stage. */
  readonly others: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>;
  /** The newest code change that landed, which `main`'s step names. */
  readonly lastMerged: FlowPullRequest | undefined;
  /** The group's one line about itself — no name yet, or being set up. */
  readonly line: string | undefined;
  readonly placeholder: boolean;
}

export interface ZeropsProjectsFlowProps<T> {
  readonly view: "overview" | "projects";
  /** In the page's order. */
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  /** The projects no group holds, with the one verb each row offers. */
  readonly ungrouped: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly tools: ReadonlyArray<{ readonly item: T; readonly kind: ZeropsToolKind }>;
  readonly getKey: (item: T) => string;
  readonly isMate: (item: T) => boolean;
  /** A Mate's card — a `ZeropsMateCard` with every verb it has. */
  readonly renderMate: (item: T) => ReactNode;
  /** A Mate's face, small, for a row that names its Mates. */
  readonly renderMateFace: (item: T) => ReactNode;
  /** An environment's row — a `ZeropsEnvironmentRow`. */
  readonly renderEnvironment: (item: T, role: ZeropsEnvironmentRole | undefined) => ReactNode;
  /** A stage's or the production's own menu — its public access. */
  readonly renderStopMenu: (item: T) => ReactNode;
  /**
   * A pull request's `<li>`. `withMerge` is false where the step's own verb
   * already merges it; `compact` stacks it for a step's narrow column.
   */
  readonly renderPullRequest: (
    group: ZeropsGroup,
    pull: FlowPullRequest,
    options: { readonly withMerge: boolean; readonly compact: boolean },
  ) => ReactNode;
  /** The verb of a group's next step (`flow.nextStep`); nothing for `none`. */
  readonly renderNextStep: (entry: ProjectsFlowGroup<T>) => ReactNode;
  /**
   * *Release*, drawn in the production cell whenever one is offered — even
   * where the ranked next step is something else, such as the production's
   * own failed deploy (D28): the release that might clear it stays visible
   * rather than only the build. Absent where the next step already is the
   * release, so the cell never shows the same verb twice.
   */
  readonly renderReleaseVerb?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
  /** The group's releases, the release gate's reason and its recipe changes, as `<li>`s; `null` for none. */
  readonly renderGroupRows: (group: ZeropsGroup) => ReactNode;
  readonly renderGroupMenu: (group: ZeropsGroup) => ReactNode;
  readonly renderTool: (item: T, kind: ZeropsToolKind) => ReactNode;
  /** Re-probes the containers not answering. */
  readonly onRetryContainers: (items: ReadonlyArray<T>) => void;
  /** Absent hides every add verb. */
  readonly onCreateEnvironment?: (groupId: string, role: ZeropsEnvironmentRole) => void;
  /** Whether a group is ready for more — its first Mate is up. Absent offers always. */
  readonly addsOffered?: (group: ZeropsGroup) => boolean;
  /** A creation runs: every add verb is disabled, never hidden. */
  readonly creating?: boolean;
  readonly onCreateTool?: () => void;
  /** Starts the account's first project; absent leaves an empty account empty. */
  readonly onCreateProject?: (() => void) | undefined;
  /** The group whose card the Projects view scrolls to. */
  readonly focusGroup?: string | undefined;
}

/**
 * First run owns the page: to an account that has nothing in it yet this is
 * the whole screen, not a card under a list header — the Mate's face large,
 * one line saying what a Mate is, and the one filled button.
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

const QUIET_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** A step with nothing in it is a place, drawn dashed — never a row that says "not set up yet". */
const STEP_BOX_CLASS = "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm";
const EMPTY_STEP_CLASS = "border-dashed border-border text-muted-foreground";
const FILLED_STEP_CLASS = "border-border/60 bg-card";

function PreviewLink({ url }: { readonly url: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-[var(--zerops-status-busy-text)] underline-offset-2 hover:underline"
      data-zerops-surface="mate-preview"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
      Preview
    </a>
  );
}

/** `↳ stage · follows main`, and what it runs: a group stage, where one exists. */
function StageLines<T>({
  entry,
  renderStopMenu,
  compact,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly renderStopMenu: (item: T) => ReactNode;
  readonly compact: boolean;
}) {
  return entry.flow.stages.map((stop) => {
    const line = stopLine(stop);
    const item = entry.stops.get(stop.projectId)?.item;
    return (
      <div
        className={cn(
          "flex min-w-0 flex-col gap-0.5 text-xs",
          !compact && "ms-3 rounded-md border border-border/60 px-2.5 py-2",
        )}
        data-zerops-surface="flow-stage"
        key={stop.projectId}
      >
        <span className="text-muted-foreground">↳ {stop.name} · follows main</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot className="min-w-0 truncate" label={line.text} sentence tone={line.tone} />
          {!compact && item !== undefined ? (
            <span className="ms-auto flex shrink-0">{renderStopMenu(item)}</span>
          ) : null}
        </span>
        {!compact && stop.route !== undefined ? (
          <a
            className="min-w-0 truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            href={stop.route}
            rel="noreferrer"
            target="_blank"
          >
            {stop.route.replace(/^https?:\/\//u, "")}
          </a>
        ) : null}
      </div>
    );
  });
}

function MainStep<T>({
  entry,
  renderStopMenu,
  compact,
  verb,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly renderStopMenu: (item: T) => ReactNode;
  readonly compact: boolean;
  readonly verb: ReactNode;
}) {
  const cell = mainCell(entry.flow, entry.lastMerged);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-zerops-step="main">
      <div
        className={cn(
          compact ? "flex min-w-0 flex-col gap-0.5 text-sm" : STEP_BOX_CLASS,
          !compact && (cell.empty ? EMPTY_STEP_CLASS : FILLED_STEP_CLASS),
        )}
      >
        {cell.head === undefined && cell.title === undefined ? null : (
          <span className="flex min-w-0 items-center gap-1.5">
            {cell.head === undefined ? null : (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {cell.head}
              </span>
            )}
            {cell.title === undefined ? null : (
              <span className="min-w-0 truncate">{cell.title}</span>
            )}
          </span>
        )}
        <span
          className={cn("text-xs", cell.empty ? "text-muted-foreground" : "text-foreground/80")}
        >
          {cell.state}
        </span>
      </div>
      <StageLines compact={compact} entry={entry} renderStopMenu={renderStopMenu} />
      {verb}
    </div>
  );
}

function ProductionStep<T>({
  entry,
  renderStopMenu,
  compact,
  verb,
  renderReleaseVerb,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly renderStopMenu: (item: T) => ReactNode;
  readonly compact: boolean;
  readonly verb: ReactNode;
  readonly renderReleaseVerb?: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined;
}) {
  const cell = productionCell(entry.flow);
  const { production } = entry.flow;
  const item =
    production.kind === "absent" ? undefined : entry.stops.get(production.stop.projectId)?.item;
  // A release is offered on either of two kinds; carried here where it does
  // not already have the cell's own verb (D28) — the failure never hides it.
  const candidate =
    production.kind === "ready-to-release" || production.kind === "deploy-failed"
      ? production.candidate
      : undefined;
  const releaseVerb =
    candidate === undefined || entry.flow.nextStep.kind === "release"
      ? null
      : (renderReleaseVerb?.(entry) ?? null);
  return (
    <div
      className={cn(
        compact ? "flex min-w-0 flex-col gap-1 text-sm" : STEP_BOX_CLASS,
        !compact && (cell.empty ? EMPTY_STEP_CLASS : FILLED_STEP_CLASS),
      )}
      data-zerops-step="production"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {cell.empty ? (
          <span className="min-w-0 truncate">{cell.line}</span>
        ) : (
          <StatusDot className="min-w-0 truncate" label={cell.line} sentence tone={cell.tone} />
        )}
        {!compact && item !== undefined ? (
          <span className="ms-auto flex shrink-0">{renderStopMenu(item)}</span>
        ) : null}
      </span>
      {cell.detail === undefined ? null : (
        <span className="text-xs text-muted-foreground">{cell.detail}</span>
      )}
      {verb === null || verb === undefined ? null : <span className="flex">{verb}</span>}
      {releaseVerb === null ? null : <span className="flex">{releaseVerb}</span>}
    </div>
  );
}

/** Whether a node would draw anything — a slot may answer `null` for "nothing here". */
function drawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

function AddVerbs<T>({
  entry,
  onCreateEnvironment,
  offered,
  creating,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly onCreateEnvironment:
    | ((groupId: string, role: ZeropsEnvironmentRole) => void)
    | undefined;
  readonly offered: boolean;
  readonly creating: boolean;
}) {
  if (onCreateEnvironment === undefined || !offered) return null;
  const { groupId } = entry.group;
  return (
    <div className="-ms-1.5 flex flex-wrap items-center gap-1" data-zerops-surface="add-roles">
      <button
        className={QUIET_BUTTON_CLASS}
        disabled={creating}
        onClick={() => onCreateEnvironment(groupId, "dev")}
        type="button"
      >
        <span aria-hidden="true">+</span>
        <span>Add Mate</span>
      </button>
      {/* Optional and never a gate before production (D16, D28): offered
          here only while the project has none, and always from its menu. */}
      {entry.flow.stages.length === 0 ? (
        <button
          className={QUIET_BUTTON_CLASS}
          disabled={creating}
          onClick={() => onCreateEnvironment(groupId, "stage")}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <span>Add stage</span>
          <span className="text-muted-foreground/70">(optional)</span>
        </button>
      ) : null}
    </div>
  );
}

function GroupName<T>({
  entry,
  className,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate font-semibold tracking-tight text-foreground",
        entry.placeholder && "font-normal text-muted-foreground italic",
        className,
      )}
    >
      {entry.group.name}
    </span>
  );
}

/** The Overview's first thing: what waits on somebody, across every group, with its verb. */
function NextStepsStrip<T>({
  entries,
  renderNextStep,
}: {
  readonly entries: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly renderNextStep: (entry: ProjectsFlowGroup<T>) => ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-label="Next steps"
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
      data-zerops-surface="next-steps"
    >
      <h2 className="shrink-0 text-sm font-medium text-foreground">
        Next steps <span className="font-normal text-muted-foreground">{entries.length}</span>
      </h2>
      <ul className="flex min-w-0 flex-wrap gap-2">
        {entries.map((entry) => (
          <li
            className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 py-1 ps-2.5 pe-1"
            data-zerops-next-step={entry.flow.nextStep.kind}
            key={entry.group.groupId}
          >
            <StatusDot
              className="min-w-0 text-sm"
              label={`${entry.group.name} · ${entry.flow.nextStep.text}`}
              sentence
              tone={nextStepTone(entry.flow.nextStep.kind)}
            />
            {renderNextStep(entry)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const OVERVIEW_GRID_CLASS =
  "md:grid md:grid-cols-[1.75rem_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_2rem] md:items-center md:gap-x-3";

function OverviewHeader() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        OVERVIEW_GRID_CLASS,
        "hidden border-b border-border/60 px-3 py-2 text-muted-foreground",
      )}
    >
      <span />
      <MicroLabel>Project</MicroLabel>
      <MicroLabel>Mates · preview</MicroLabel>
      <MicroLabel>→ Pull requests</MicroLabel>
      <MicroLabel>→ main</MicroLabel>
      <MicroLabel>→ Production</MicroLabel>
      <span />
    </div>
  );
}

function OverviewRow<T>({
  entry,
  props,
  open,
  onToggle,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { flow, group } = entry;
  const cell = nextStepCell(flow);
  // The verb keeps its own width: a column's cells stretch, a button should not.
  const verbIn = (where: FlowCell) =>
    cell === where ? <span className="flex">{props.renderNextStep(entry)}</span> : null;
  const preview = flow.mates.find((mate) => mate.preview !== undefined)?.preview;
  const target = flow.nextStep.target;
  const shown =
    (target?.kind === "change"
      ? flow.pullRequests.find(
          (entry_) =>
            entry_.pull.repository === target.repository && entry_.pull.number === target.number,
        )
      : undefined) ?? flow.pullRequests[0];
  const groupRows = props.renderGroupRows(group);
  return (
    <li className="border-b border-border/40 last:border-b-0" data-zerops-group={group.groupId}>
      <div className={cn(OVERVIEW_GRID_CLASS, "flex flex-col gap-2 px-3 py-2.5")}>
        <button
          aria-expanded={open}
          aria-label={open ? `Hide ${group.name}` : `Show ${group.name}`}
          className="hidden size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:flex"
          onClick={onToggle}
          type="button"
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          className="flex min-w-0 flex-col items-start text-left"
          onClick={onToggle}
          type="button"
        >
          <GroupName className="text-sm" entry={entry} />
          <span className="text-xs text-muted-foreground">{entry.line ?? groupMetaLine(flow)}</span>
        </button>
        <div className="flex min-w-0 flex-col gap-1" data-zerops-step="mates">
          {flow.mates.length === 0 ? (
            <span className="text-sm text-muted-foreground">No Mate yet</span>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex shrink-0 -space-x-1.5">
                {entry.mates.map((item) => (
                  <Fragment key={props.getKey(item)}>{props.renderMateFace(item)}</Fragment>
                ))}
              </span>
              <span className="min-w-0 truncate text-sm">
                {flow.mates.map((mate) => mate.name).join(", ")}
              </span>
            </span>
          )}
          {preview === undefined ? null : <PreviewLink url={preview} />}
          {verbIn("mates")}
        </div>
        <div className="flex min-w-0 flex-col gap-1" data-zerops-step="pull-requests">
          {shown === undefined ? (
            <span className="text-sm text-muted-foreground">{pullRequestsLine(flow)}</span>
          ) : (
            <>
              <span className="min-w-0 truncate text-sm">
                <span className="text-muted-foreground">#{shown.pull.number}</span>{" "}
                {shown.pull.title}
              </span>
              {shown.state === undefined ? null : (
                <StatusDot
                  className="text-xs"
                  label={shown.state.word}
                  sentence
                  tone={shown.state.tone}
                />
              )}
              {flow.pullRequests.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                  +{flow.pullRequests.length - 1} more
                </span>
              ) : null}
            </>
          )}
          {verbIn("pull-requests")}
        </div>
        <MainStep
          compact
          entry={entry}
          renderStopMenu={props.renderStopMenu}
          verb={verbIn("main")}
        />
        <ProductionStep
          compact
          entry={entry}
          renderReleaseVerb={props.renderReleaseVerb}
          renderStopMenu={props.renderStopMenu}
          verb={verbIn("production")}
        />
        <span className="flex justify-end">{props.renderGroupMenu(group)}</span>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 px-3 pb-3 md:ps-12" data-zerops-surface="group-detail">
          {entry.mates.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2" data-zerops-surface="mate-cards">
              {entry.mates.map((item) => (
                <Fragment key={props.getKey(item)}>{props.renderMate(item)}</Fragment>
              ))}
            </div>
          ) : null}
          <ul
            className="flex flex-col divide-y divide-border/50"
            data-zerops-surface="environment-rows"
          >
            {flow.pullRequests.map(({ pull }) => (
              <Fragment key={`${pull.repository}#${String(pull.number)}`}>
                {props.renderPullRequest(group, pull, { withMerge: true, compact: false })}
              </Fragment>
            ))}
            {entry.others.map(({ item, role }) => (
              <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
            ))}
            {[...entry.stops.values()].map(({ item, role }) => (
              <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
            ))}
            {groupRows}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** The groups with only a Mate so far, as tiles: each has one thing to say. */
function OnlyAMate<T>({
  entries,
  props,
  layout,
}: {
  readonly entries: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly layout: "tiles" | "list";
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-zerops-surface="only-a-mate">
      <h2 className="flex flex-wrap items-baseline gap-x-2 px-1 text-sm font-medium text-foreground">
        Only a Mate so far{" "}
        <span className="font-normal text-muted-foreground">{entries.length}</span>
        <span className="text-xs font-normal text-muted-foreground">
          Give it a first task. Pull requests, main and production appear as the work gets there.
        </span>
      </h2>
      <ul
        className={cn(
          layout === "tiles" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-4" : "flex flex-col gap-2",
        )}
      >
        {entries.map((entry) => (
          <li
            className="flex min-w-0 scroll-mt-4 items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2"
            data-zerops-group={entry.group.groupId}
            id={layout === "list" ? `project-${entry.group.groupId}` : undefined}
            key={entry.group.groupId}
          >
            {entry.mates.map((item) => (
              <Fragment key={props.getKey(item)}>{props.renderMateFace(item)}</Fragment>
            ))}
            <span className="flex min-w-0 flex-1 flex-col">
              <GroupName className="text-sm" entry={entry} />
              <span className="truncate text-xs text-muted-foreground">
                {entry.flow.mates.map((mate) => mate.name).join(", ")} · no task yet
              </span>
            </span>
            {props.renderNextStep(entry)}
            {props.renderGroupMenu(entry.group)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The containers no project holds: one line, its states, and the re-probe for the silent ones. */
function OtherContainers<T>({
  rows,
  props,
}: {
  readonly rows: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const summary = containersSummary(rows.map((row) => row.action));
  const silent = rows.filter((row) => row.action === "retry-probe").map((row) => row.item);
  return (
    <section
      className="flex flex-col rounded-lg border border-border/60 bg-card"
      data-zerops-surface="other-containers"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <button
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          Other containers <span className="font-normal text-muted-foreground">{rows.length}</span>
        </button>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{summary.line}</span>
        {summary.retry > 0 ? (
          <Button onClick={() => props.onRetryContainers(silent)} size="compact" variant="outline">
            Try again ({summary.retry})
          </Button>
        ) : null}
      </div>
      {open ? (
        <div
          className="grid gap-3 px-3 pb-3 sm:grid-cols-2"
          data-zerops-surface="other-container-rows"
        >
          {rows.map(({ item }) => (
            <Fragment key={props.getKey(item)}>
              {props.isMate(item) ? (
                props.renderMate(item)
              ) : (
                <ul>{props.renderEnvironment(item, undefined)}</ul>
              )}
            </Fragment>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The page's end, quietly: a project with no Mate yet, and the account's tools. */
function QuietEnd<T>({
  withoutMate,
  props,
}: {
  readonly withoutMate: ReadonlyArray<{ readonly item: T }>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const offerGitea =
    props.onCreateTool !== undefined && props.tools.every((tool) => tool.kind !== "gitea");
  if (withoutMate.length === 0 && props.tools.length === 0 && !offerGitea) return null;
  return (
    <section className="flex flex-col gap-2" data-zerops-surface="quiet-end">
      {withoutMate.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/50" data-zerops-surface="without-mate">
          {withoutMate.map(({ item }) => (
            <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, undefined)}</Fragment>
          ))}
        </ul>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground"
        data-zerops-tools="true"
      >
        <span>Tools:</span>
        {props.tools.map(({ item, kind }) => (
          <Fragment key={props.getKey(item)}>{props.renderTool(item, kind)}</Fragment>
        ))}
        {offerGitea ? (
          <button
            className={QUIET_BUTTON_CLASS}
            disabled={props.creating}
            onClick={props.onCreateTool}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span>Add {TOOL_LABEL.gitea}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ProjectCard<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const { flow, group } = entry;
  const target = flow.nextStep.target;
  const mergesHere = (pull: FlowPullRequest) =>
    flow.nextStep.kind === "merge" &&
    target?.kind === "change" &&
    target.repository === pull.repository &&
    target.number === pull.number;
  const groupRows = props.renderGroupRows(group);
  const verb = props.renderNextStep(entry);
  const offered = props.addsOffered?.(group) ?? true;
  const arrow = (
    <span
      aria-hidden="true"
      className="hidden self-center pt-5 text-center text-muted-foreground/60 md:block"
    >
      →
    </span>
  );
  return (
    <section
      className="flex scroll-mt-4 flex-col gap-3 rounded-[var(--zerops-card-radius)] border border-border/60 bg-card p-4"
      data-zerops-group={group.groupId}
      id={`project-${group.groupId}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0">
          <GroupName className="block text-base" entry={entry} />
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[groupMetaLine(flow), entry.line].filter((part) => part !== undefined).join(" · ")}
        </span>
        {flow.nextStep.kind === "none" ? null : (
          <StatusDot
            className="min-w-0 text-xs"
            label={`Next: ${flow.nextStep.text}`}
            sentence
            tone={nextStepTone(flow.nextStep.kind)}
          />
        )}
        {verb}
        {props.renderGroupMenu(group)}
      </header>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1.4fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1.1fr)] md:items-stretch md:gap-0">
        <div className="flex min-w-0 flex-col gap-2" data-zerops-step="mates">
          <MicroLabel className="text-muted-foreground">Mates</MicroLabel>
          {entry.mates.map((item, index) => {
            const preview = flow.mates[index]?.preview;
            return (
              <div className="flex min-w-0 flex-col gap-1" key={props.getKey(item)}>
                {props.renderMate(item)}
                {preview === undefined ? null : <PreviewLink url={preview} />}
              </div>
            );
          })}
          {entry.others.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border/50">
              {entry.others.map(({ item, role }) => (
                <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, role)}</Fragment>
              ))}
            </ul>
          ) : null}
          {entry.mates.length === 0 && entry.others.length === 0 ? (
            <div className={cn(STEP_BOX_CLASS, EMPTY_STEP_CLASS)}>No Mate yet</div>
          ) : null}
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2" data-zerops-step="pull-requests">
          <MicroLabel className="text-muted-foreground">Pull requests</MicroLabel>
          {flow.pullRequests.length === 0 ? (
            <div className={cn(STEP_BOX_CLASS, EMPTY_STEP_CLASS, "flex-1 justify-center")}>
              {pullRequestsLine(flow)}
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border/50">
              {flow.pullRequests.map(({ pull }) => (
                <Fragment key={`${pull.repository}#${String(pull.number)}`}>
                  {props.renderPullRequest(group, pull, {
                    withMerge: !mergesHere(pull),
                    compact: true,
                  })}
                </Fragment>
              ))}
            </ul>
          )}
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-muted-foreground">main</MicroLabel>
          <MainStep
            compact={false}
            entry={entry}
            renderStopMenu={props.renderStopMenu}
            verb={null}
          />
        </div>
        {arrow}
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-muted-foreground">Production</MicroLabel>
          <ProductionStep
            compact={false}
            entry={entry}
            renderStopMenu={props.renderStopMenu}
            verb={null}
          />
        </div>
      </div>
      {drawn(groupRows) ? (
        <ul
          className="flex flex-col divide-y divide-border/50"
          data-zerops-surface="environment-rows"
        >
          {groupRows}
        </ul>
      ) : null}
      <AddVerbs
        creating={props.creating ?? false}
        entry={entry}
        offered={offered}
        onCreateEnvironment={props.onCreateEnvironment}
      />
    </section>
  );
}

function Overview<T>({
  active,
  props,
}: {
  readonly active: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  if (active.length === 0) return null;
  const toggle = (groupId: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };
  return (
    <section className="rounded-lg border border-border/60 bg-card" data-zerops-surface="flow-rows">
      <OverviewHeader />
      <ul>
        {active.map((entry) => (
          <OverviewRow
            entry={entry}
            key={entry.group.groupId}
            onToggle={() => toggle(entry.group.groupId)}
            open={openGroups.has(entry.group.groupId)}
            props={props}
          />
        ))}
      </ul>
    </section>
  );
}

export function ZeropsProjectsFlow<T>(props: ZeropsProjectsFlowProps<T>) {
  const { view, groups, ungrouped, creating = false, onCreateProject, focusGroup } = props;
  const folded = foldGroups(groups);
  const loose = foldUngrouped(ungrouped);
  // A tool is not a project, so an account holding nothing but Gitea has
  // still not started.
  const started = groups.length > 0 || ungrouped.length > 0;
  const firstRun = onCreateProject !== undefined && !started;

  // `?group=` scrolls its card into view once, when the card is first there.
  const scrolledTo = useRef<string | undefined>(undefined);
  const cardShown =
    view === "projects" && groups.some((entry) => entry.group.groupId === focusGroup);
  useEffect(() => {
    if (!cardShown || focusGroup === undefined || scrolledTo.current === focusGroup) return;
    scrolledTo.current = focusGroup;
    document.getElementById(`project-${focusGroup}`)?.scrollIntoView({ block: "start" });
  }, [cardShown, focusGroup]);

  return (
    <div
      aria-label="Projects and their flow"
      className="flex flex-col gap-5"
      data-zerops-surface="projects-flow"
      data-zerops-view={view}
      role="region"
    >
      {firstRun ? <FirstRun creating={creating} onCreateProject={onCreateProject} /> : null}
      {view === "overview" ? (
        <>
          <NextStepsStrip entries={folded.nextSteps} renderNextStep={props.renderNextStep} />
          <Overview active={folded.active} props={props} />
          <OnlyAMate entries={folded.early} layout="tiles" props={props} />
        </>
      ) : (
        <>
          {folded.active.map((entry) => (
            <ProjectCard entry={entry} key={entry.group.groupId} props={props} />
          ))}
          <OnlyAMate entries={folded.early} layout="list" props={props} />
        </>
      )}
      <OtherContainers props={props} rows={loose.containers} />
      {started ? <QuietEnd props={props} withoutMate={loose.withoutMate} /> : null}
    </div>
  );
}
