/**
 * The Overview: the "Next steps" strip, one row per group with work on it,
 * the tiles of groups with only a Mate, the containers no project holds and
 * the page's quiet end.
 */

import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../../ui/button";
import { MicroLabel, StatusDot } from "../primitives";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  GroupName,
  MainStep,
  OVERVIEW_GRID_CLASS,
  PreviewLink,
  ProductionStep,
  QUIET_BUTTON_CLASS,
} from "./flowSteps";
import {
  containersSummary,
  groupMetaLine,
  nextStepCell,
  nextStepTone,
  pullRequestsLine,
  TOOL_LABEL,
  type FlowCell,
} from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

/** The Overview's first thing: what waits on somebody, across every group, with its verb. */
export function NextStepsStrip<T>({
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
export function OnlyAMate<T>({
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
export function OtherContainers<T>({
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
export function QuietEnd<T>({
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

export function Overview<T>({
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
