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

import { PRODUCTION_ADDED_HERE } from "@t3tools/client-runtime/zerops";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { FlatCard, MicroLabel, StatusDot } from "../primitives";
import { ENVIRONMENT_ROW_GRID_CLASS } from "../ZeropsEnvironmentRow";
import { PreviewLink } from "../ZeropsMateCard";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import {
  ComingMateCard,
  ComingMateFace,
  drawn,
  EmptyStep,
  GroupName,
  MainStep,
  MateChip,
  matesOf,
  mergesHere,
  OVERVIEW_GRID_CLASS,
  PendingStep,
  ProductionStep,
  PullRequestsStep,
  QUIET_BUTTON_CLASS,
  releaseVerbFor,
  VerbSlot,
  verbFor,
} from "./flowSteps";
import {
  comingMateLine,
  containersSummary,
  groupMetaLine,
  nextStepTone,
  stripColumns,
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

const WIDE_STRIP_COLUMNS = {
  1: "@5xl/flow:grid-cols-1",
  2: "@5xl/flow:grid-cols-2",
  3: "@5xl/flow:grid-cols-3",
} as const;

/**
 * The Overview's first thing: what waits on somebody, across every group, each
 * with its verb at the item's end — the row's own verb, so pressing either does
 * the same thing. The words jump to the group's row. A step with no verb to
 * press is not on the strip: it would be a thing to read that asks for nothing
 * (the owner, 2026-09-24: "why is it there when I can't click it?").
 */
export function NextStepsStrip<T>({
  entries,
  pending,
  renderNextStep,
}: {
  readonly entries: ReadonlyArray<ProjectsFlowGroup<T>>;
  /** A group's read is out: what waits is not known yet, so the strip holds its place. */
  readonly pending: boolean;
  readonly renderNextStep: ZeropsProjectsFlowProps<T>["renderNextStep"];
}) {
  const steps = entries
    .map((entry) => ({ entry, verb: renderNextStep(entry, "strip") }))
    .filter(({ verb }) => drawn(verb));
  if (steps.length === 0 && !pending) return null;
  return (
    <FlatCard className="px-3 py-2">
      <section
        aria-label="Next steps"
        className="flex flex-col gap-1"
        data-zerops-surface="next-steps"
      >
        <h2 className="text-sm font-semibold text-foreground">
          Next steps
          {steps.length === 0 ? null : (
            <>
              {" "}
              <span className="font-normal text-muted-foreground">{steps.length}</span>
            </>
          )}
        </h2>
        {steps.length === 0 ? (
          <ul aria-busy="true" className="grid grid-cols-1 gap-1 @2xl/flow:grid-cols-2">
            {["first", "second"].map((key) => (
              <li
                className={cn(
                  "flex h-8 min-w-0 items-center px-2",
                  key === "second" && "hidden @2xl/flow:flex",
                )}
                key={key}
              >
                <Skeleton className="h-3.5 w-48 max-w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <ul
            className={cn(
              "grid grid-cols-1 gap-1",
              steps.length > 1 && "@2xl/flow:grid-cols-2",
              WIDE_STRIP_COLUMNS[stripColumns(steps.length)],
            )}
          >
            {steps.map(({ entry, verb }) => (
              <li
                className="flex h-8 min-w-0 items-center gap-2 rounded-md pe-1 hover:bg-accent"
                key={entry.group.groupId}
              >
                <button
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md ps-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <span className="flex shrink-0">{verb}</span>
              </li>
            ))}
          </ul>
        )}
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
    <div className="col-span-2 grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 @2xl/flow:col-span-1 @2xl/flow:row-span-2 @2xl/flow:row-start-1 @2xl/flow:block @5xl/flow:row-span-1">
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
            {named.map((chip) =>
              chip.kind === "coming" ? (
                <MateChip
                  coming={comingMateLine(chip.coming)}
                  face={<ComingMateFace size="sm" />}
                  key={`coming:${chip.mate.projectId}`}
                  name={chip.mate.name}
                  onOpen={undefined}
                />
              ) : (
                <MateChip
                  face={props.renderMateFace(chip.item, "sm")}
                  key={props.getKey(chip.item)}
                  name={chip.mate.name}
                  onOpen={props.openMate(chip.item)}
                />
              ),
            )}
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
  const mates = matesOf(entry);
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
          // A medium row's verbs take a second line, so its cells' first
          // lines share the row's top rather than each centring on its own.
          "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 @2xl/flow:gap-y-0 @2xl/flow:py-2 @2xl/flow:@max-5xl/flow:items-start",
        )}
      >
        <button
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl/flow:col-span-2 @2xl/flow:row-start-1 @2xl/flow:grid @2xl/flow:grid-cols-subgrid @2xl/flow:gap-x-4 @5xl/flow:row-span-1"
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
        {/* Until the group's read answers, its steps hold their place and claim nothing. */}
        <StepPlace label="Pull requests">
          {entry.awaiting ? (
            <PendingStep density="line" step="pull-requests" />
          ) : (
            <PullRequestsStep entry={entry} verb={verbIn("pull-requests")} />
          )}
        </StepPlace>
        <StepPlace label="main">
          {entry.awaiting ? (
            <PendingStep density="line" step="main" />
          ) : (
            <MainStep density="line" entry={entry} verb={verbIn("main")} />
          )}
        </StepPlace>
        <StepPlace label="Production">
          {entry.awaiting ? (
            <PendingStep density="line" step="production" />
          ) : (
            <ProductionStep
              density="line"
              entry={entry}
              releaseVerb={releaseVerbFor(entry, props.renderReleaseVerb)}
              verb={verbIn("production")}
            />
          )}
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
          {mates.length > 0 ? (
            <div className="grid gap-2 @2xl/flow:grid-cols-2" data-zerops-surface="mate-cards">
              {mates.map((mate) =>
                mate.kind === "coming" ? (
                  <ComingMateCard
                    coming={mate.coming}
                    key={`coming:${mate.mate.projectId}`}
                    layout="card"
                    name={mate.mate.name}
                  />
                ) : (
                  <Fragment key={props.getKey(mate.item)}>
                    {props.renderMate(mate.item, { layout: "card", preview: undefined })}
                  </Fragment>
                ),
              )}
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
          {flow.nextStep.kind === "add-production" ? (
            <p className="text-xs text-muted-foreground">{PRODUCTION_ADDED_HERE}</p>
          ) : null}
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
  const onOpen = first?.kind === "listed" ? props.openMate(first.item) : undefined;
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
          <span className="flex shrink-0">
            {first.kind === "listed" ? (
              props.renderMateFace(first.item, "md")
            ) : (
              <ComingMateFace size="md" />
            )}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          {onOpen === undefined || first === undefined ? (
            name
          ) : (
            <button
              aria-label={`${entry.group.name}, open ${first.mate.name}`}
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
          {/* A narrow container has room for a cut "Not in a…" only: the summary waits for width. */}
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground @2xl/flow:block">
            {summary.line}
          </span>
          {summary.retry > 0 ? (
            <Button
              className="ms-auto"
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
                  props.renderMate(item, { layout: "card", preview: undefined })
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
  // One list on the environment rows' grid, so the tools line runs down the
  // same columns as the projects above it.
  return (
    <section data-zerops-surface="quiet-end">
      <ul className="flex flex-col divide-y divide-border/50 px-3">
        {withoutMate.map(({ item }) => (
          <Fragment key={props.getKey(item)}>{props.renderEnvironment(item, undefined)}</Fragment>
        ))}
        <li className={ENVIRONMENT_ROW_GRID_CLASS} data-zerops-tools="true">
          <MicroLabel className="text-muted-foreground">Tools</MicroLabel>
          <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-3 text-xs sm:col-span-1">
            {props.tools.map(({ item, kind }) => (
              <Fragment key={props.getKey(item)}>{props.renderTool(item, kind)}</Fragment>
            ))}
          </span>
          <span className="col-start-2 row-start-1 flex justify-end sm:col-start-3">
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
          </span>
        </li>
      </ul>
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
