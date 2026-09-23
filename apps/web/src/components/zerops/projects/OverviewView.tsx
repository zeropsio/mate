/**
 * The Overview: the "Next steps" strip, one row per group with work on it,
 * the tiles of groups with only a Mate, the containers no project holds and
 * the page's quiet end.
 *
 * A row is a line per step, two lines at most per cell, and one verb — in the
 * cell its step acts on, at that cell's end. Every Mate it names opens into
 * its conversation. The layout follows the flow's own width (`@container/flow`):
 * the columns, then the Mates moved under the project's name, then a stacked
 * block of step labels and their first lines.
 */

import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../../ui/button";
import { FlatCard, MicroLabel, StatusDot } from "../primitives";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  drawn,
  EmptyStep,
  GroupName,
  MainStep,
  MateChip,
  matesOf,
  mergesHere,
  OVERVIEW_GRID_CLASS,
  PreviewLink,
  ProductionStep,
  PullRequestsStep,
  QUIET_BUTTON_CLASS,
  releaseVerbFor,
  VerbSlot,
  verbFor,
} from "./flowSteps";
import {
  containersSummary,
  groupMetaLine,
  nextStepTone,
  TOOL_LABEL,
  type FlowCell,
} from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

/** Where a row's next-step verb sits, for the strip to hand focus to. */
const NEXT_STEP_SLOT = "data-zerops-next-step-slot";
/** A row's own toggle: the strip's focus where the step has no verb to press. */
const ROW_TOGGLE = "data-zerops-row-toggle";

const rowId = (groupId: string) => `flow-row-${groupId}`;

/** Scrolls a group's row into view and puts focus on its verb, or on the row. */
function jumpToRow(groupId: string): void {
  const row = document.getElementById(rowId(groupId));
  if (row === null) return;
  row.scrollIntoView({ block: "nearest" });
  const target =
    row.querySelector<HTMLElement>(`[${NEXT_STEP_SLOT}] button:not(:disabled)`) ??
    row.querySelector<HTMLElement>(`[${ROW_TOGGLE}]`);
  target?.focus();
}

/**
 * The Overview's first thing: what waits on somebody, across every group. A
 * step is a place to go, not a second copy of its verb — the row below
 * carries the verb, and a step jumps to it.
 */
export function NextStepsStrip<T>({
  entries,
}: {
  readonly entries: ReadonlyArray<ProjectsFlowGroup<T>>;
}) {
  if (entries.length === 0) return null;
  return (
    <FlatCard className="px-3 py-2">
      <section
        aria-label="Next steps"
        className="flex flex-col gap-1"
        data-zerops-surface="next-steps"
      >
        <h2 className="text-sm font-semibold text-foreground">
          Next steps <span className="font-normal text-muted-foreground">{entries.length}</span>
        </h2>
        <ul className="grid grid-cols-1 gap-1 @2xl/flow:grid-cols-2 @5xl/flow:grid-cols-3">
          {entries.map((entry) => (
            <li className="min-w-0" key={entry.group.groupId}>
              <button
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                data-zerops-next-step={entry.flow.nextStep.kind}
                onClick={() => {
                  jumpToRow(entry.group.groupId);
                }}
                type="button"
              >
                {/* The step's words follow the name: the dot's own name would say them twice. */}
                <StatusDot
                  aria-hidden="true"
                  className="shrink-0"
                  dotOnly
                  label={entry.flow.nextStep.text}
                  tone={nextStepTone(entry.flow.nextStep.kind)}
                />
                <span className="max-w-[40%] shrink-0 truncate font-medium text-foreground">
                  {entry.group.name}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {entry.flow.nextStep.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </FlatCard>
  );
}

function OverviewHeader() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        OVERVIEW_GRID_CLASS,
        "hidden h-9 items-center border-b border-border/60 px-3 text-muted-foreground",
      )}
    >
      <span />
      <MicroLabel>Project</MicroLabel>
      <MicroLabel className="hidden @5xl/flow:block">Mates</MicroLabel>
      <MicroLabel>Pull requests</MicroLabel>
      <MicroLabel>main</MicroLabel>
      <MicroLabel>Production</MicroLabel>
      <span />
    </div>
  );
}

/**
 * A step's place in a row. Narrow, it is a line of its own — the step's label,
 * then its first line and its verb; with room, it is a column and the header
 * names it.
 */
function StepPlace({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="col-span-2 grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 @2xl/flow:col-span-1 @2xl/flow:row-span-2 @2xl/flow:row-start-1 @2xl/flow:block @5xl/flow:row-span-1">
      <MicroLabel className="text-muted-foreground @2xl/flow:hidden">{label}</MicroLabel>
      {children}
    </div>
  );
}

/** At most this many Mates by name in a row; the rest are a count. */
const MATES_NAMED = 2;

function MatesCell<T>({
  entry,
  props,
  verb,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly verb: ReactNode;
}) {
  const mates = matesOf(entry);
  const named = mates.slice(0, MATES_NAMED);
  const preview = entry.flow.mates.find((mate) => mate.preview !== undefined)?.preview;
  return (
    <div
      className="col-span-2 flex min-w-0 items-center gap-2 @2xl/flow:col-span-1 @2xl/flow:col-start-2 @2xl/flow:row-start-2 @5xl/flow:col-start-3 @5xl/flow:row-start-1"
      data-zerops-step="mates"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5" data-zerops-cell-lines="true">
        {mates.length === 0 ? (
          <EmptyStep>No Mate yet</EmptyStep>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            {named.map(({ item, mate }) => (
              <MateChip
                face={props.renderMateFace(item, "sm")}
                key={props.getKey(item)}
                name={mate.name}
                onOpen={props.openMate(item)}
              />
            ))}
            {mates.length > named.length ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                +{mates.length - named.length}
              </span>
            ) : null}
          </span>
        )}
        {/* With the Mates in their own column, the preview is their line 2;
            anywhere narrower it waits in the opened row. */}
        {preview === undefined ? null : (
          <span className="hidden @5xl/flow:flex">
            <PreviewLink url={preview} />
          </span>
        )}
      </span>
      <VerbSlot>{verb}</VerbSlot>
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
  // The next step's verb, in the one cell it acts on, marked for the strip.
  const verbIn = (cell: FlowCell) => {
    const verb = verbFor(entry, cell, props.renderNextStep);
    return drawn(verb) ? (
      <span className="flex" {...{ [NEXT_STEP_SLOT]: "true" }}>
        {verb}
      </span>
    ) : null;
  };
  const preview = flow.mates.find((mate) => mate.preview !== undefined)?.preview;
  const groupRows = props.renderGroupRows(group);
  return (
    <li
      className="scroll-mt-4 border-b border-border/40 last:border-b-0"
      data-zerops-group={group.groupId}
      id={rowId(group.groupId)}
    >
      <div
        className={cn(
          OVERVIEW_GRID_CLASS,
          "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 @2xl/flow:gap-y-0 @2xl/flow:py-2",
        )}
      >
        <button
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl/flow:col-span-2 @2xl/flow:row-start-1 @2xl/flow:grid @2xl/flow:grid-cols-subgrid @5xl/flow:row-span-1"
          onClick={onToggle}
          type="button"
          {...{ [ROW_TOGGLE]: "true" }}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
          >
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5" data-zerops-cell-lines="true">
            <GroupName className="text-sm" entry={entry} />
            {/* With the Mates moved under the name, they are its line 2. */}
            <span className="truncate text-xs text-muted-foreground @2xl/flow:hidden @5xl/flow:block">
              {entry.line ?? groupMetaLine(flow)}
            </span>
          </span>
        </button>
        <MatesCell entry={entry} props={props} verb={verbIn("mates")} />
        <StepPlace label="Pull requests">
          <PullRequestsStep entry={entry} verb={verbIn("pull-requests")} />
        </StepPlace>
        <StepPlace label="main">
          <MainStep density="line" entry={entry} verb={verbIn("main")} />
        </StepPlace>
        <StepPlace label="Production">
          <ProductionStep
            density="line"
            entry={entry}
            releaseVerb={releaseVerbFor(entry, props.renderReleaseVerb)}
            verb={verbIn("production")}
          />
        </StepPlace>
        <span className="col-start-2 row-start-1 flex justify-end @2xl/flow:col-start-auto @2xl/flow:row-span-2 @5xl/flow:row-span-1">
          {props.renderGroupMenu(group)}
        </span>
      </div>
      {open ? (
        <div
          className="flex flex-col gap-3 px-3 pb-3 @2xl/flow:ps-[calc(1.75rem+1rem+0.75rem)]"
          data-zerops-surface="group-detail"
        >
          {entry.mates.length > 0 ? (
            <div className="grid gap-2 @2xl/flow:grid-cols-2" data-zerops-surface="mate-cards">
              {entry.mates.map((item) => (
                <Fragment key={props.getKey(item)}>{props.renderMate(item)}</Fragment>
              ))}
            </div>
          ) : null}
          {preview === undefined ? null : (
            <span className="flex @5xl/flow:hidden">
              <PreviewLink url={preview} />
            </span>
          )}
          <ul
            className="flex flex-col divide-y divide-border/50"
            data-zerops-surface="environment-rows"
          >
            {flow.pullRequests.map(({ pull }) => (
              <Fragment key={`${pull.repository}#${String(pull.number)}`}>
                {props.renderPullRequest(group, pull, {
                  withMerge: !mergesHere(flow, pull),
                  compact: false,
                })}
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

/**
 * The groups with only a Mate so far, as tiles: each has one thing to say,
 * and the whole tile is the way into its Mate.
 */
export function OnlyAMate<T>({
  entries,
  props,
}: {
  readonly entries: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-zerops-surface="only-a-mate">
      <h2 className="flex min-w-0 items-baseline gap-x-2 px-3 text-sm font-semibold text-foreground">
        <span className="shrink-0">
          Only a Mate so far{" "}
          <span className="font-normal text-muted-foreground">{entries.length}</span>
        </span>
        <span className="hidden min-w-0 truncate text-xs font-normal text-muted-foreground @2xl/flow:block">
          Give it a first task. Pull requests, main and production appear as the work gets there.
        </span>
      </h2>
      <ul className="grid grid-cols-1 gap-2 @2xl/flow:grid-cols-2 @5xl/flow:grid-cols-4">
        {entries.map((entry) => (
          <MateTile entry={entry} key={entry.group.groupId} props={props} />
        ))}
      </ul>
    </section>
  );
}

function MateTile<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const mates = matesOf(entry);
  const target = entry.flow.nextStep.target;
  const first =
    mates.find(({ mate }) => target?.kind === "mate" && mate.projectId === target.projectId) ??
    mates[0];
  const onOpen = first === undefined ? undefined : props.openMate(first.item);
  const name = <GroupName className="block text-sm" entry={entry} />;
  return (
    <li className="min-w-0" data-zerops-group={entry.group.groupId}>
      <FlatCard
        className={cn(
          "group/tile relative flex h-14 min-w-0 scroll-mt-4 items-center gap-2.5 px-3",
          onOpen !== undefined && "transition-colors hover:bg-accent/40",
        )}
        id={`project-${entry.group.groupId}`}
      >
        {first === undefined ? null : (
          <span className="flex shrink-0">{props.renderMateFace(first.item, "md")}</span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          {onOpen === undefined || first === undefined ? (
            name
          ) : (
            <button
              aria-label={`Open ${first.mate.name}`}
              className="min-w-0 rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-[var(--zerops-card-radius)] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
              data-zerops-surface="mate-open"
              onClick={onOpen}
              type="button"
            >
              {name}
            </button>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {entry.flow.mates.map((mate) => mate.name).join(", ")} · no task yet
          </span>
        </span>
        <span className="relative z-[1] flex shrink-0 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100">
          {props.renderGroupMenu(entry.group)}
        </span>
      </FlatCard>
    </li>
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
    <FlatCard>
      <section className="flex flex-col" data-zerops-surface="other-containers">
        <div className="flex h-12 min-w-0 items-center gap-x-3 px-3 @2xl/flow:gap-x-4">
          <button
            aria-expanded={open}
            className="flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl/flow:gap-4"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center text-muted-foreground"
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </span>
            <span>
              Other containers{" "}
              <span className="font-normal text-muted-foreground">{rows.length}</span>
            </span>
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {summary.line}
          </span>
          {summary.retry > 0 ? (
            <Button
              onClick={() => props.onRetryContainers(silent)}
              size="compact"
              variant="outline"
            >
              Try again ({summary.retry})
            </Button>
          ) : null}
        </div>
        {open ? (
          <div
            className="grid gap-2 px-3 pb-3 @2xl/flow:grid-cols-2"
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
    </FlatCard>
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
    <FlatCard>
      <section data-zerops-surface="flow-rows">
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
    </FlatCard>
  );
}
