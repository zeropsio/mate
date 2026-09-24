/**
 * The step cells both views draw: a Mate's name and preview, the pull
 * requests, `main` with its stages, the production, and the group's name.
 *
 * A cell is a text block of at most two lines and, at its right end, the verb
 * slot: the verb stands beside the thing it acts on, never under it. `line`
 * is a cell of a row (the Overview, a narrow card); `box` is a Projects step
 * cell. An empty step is one muted line in the same place a filled one
 * takes — never a dashed box, never a sentence explaining itself.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  GroupFlowComing,
  GroupFlowMate,
  GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import { Children, Fragment, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Skeleton } from "../../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace, StatusDot } from "../primitives";
import { ZeropsMateCard } from "../ZeropsMateCard";
import {
  comingMateLine,
  mainCell,
  nextStepCell,
  productionCell,
  pullRequestsLine,
  stopLine,
  type FlowCell,
} from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

/** `line`: a row's cell, no surface. `box`: a Projects step cell. */
export type Density = "line" | "box";

export const QUIET_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** A Projects step cell, empty or not: the same tint and height either way. */
export const STEP_CELL_CLASS =
  "flex min-h-16 min-w-0 flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5";

/** A cell's line 1: the thing itself, in the running hand. */
const LINE_ONE_CLASS = "block min-w-0 truncate text-sm";
/**
 * A cell's line 2: what to know about it. A narrow row reads line 1 only, so
 * the row's line 2 waits for the room.
 */
function lineTwoClass(density: Density): string {
  return cn(
    "min-w-0 truncate text-xs text-muted-foreground",
    density === "line" ? "hidden @2xl/flow:block" : "block",
  );
}

/** Whether a node would draw anything — a slot may answer `null` for "nothing here". */
export function drawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

/** The verbs of a cell, at its right end, centred on its lines. Nothing for none. */
export function VerbSlot({
  children,
  className,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-1.5", className)}
      data-zerops-verb-slot="true"
    >
      {children}
    </span>
  );
}

/**
 * A step whose read has not answered: a skeleton where its first line will
 * be. Unread is not empty, so it says nothing — "None yet" before the feed
 * answers is a claim the page then takes back.
 */
export function PendingStep({
  step,
  density,
}: {
  readonly step: FlowCell;
  readonly density: Density;
}) {
  return (
    <div
      aria-busy="true"
      className={density === "box" ? STEP_CELL_CLASS : "min-w-0"}
      data-zerops-step={step}
      data-zerops-step-pending="true"
    >
      <span className="flex h-5 min-w-0 items-center">
        <Skeleton className="h-3.5 w-24 max-w-full" />
      </span>
    </div>
  );
}

/** A step with nothing in it: its one word, muted, where the thing would be. */
export function EmptyStep({ children }: { readonly children: string }) {
  return (
    <span
      className="truncate text-sm font-normal text-muted-foreground"
      data-zerops-empty-step="true"
    >
      {children}
    </span>
  );
}

/**
 * A row's cell on a medium container, where four steps share little room: its
 * first line runs the cell's width and the verb takes the second line's end,
 * beside what that line says.
 */
const MEDIUM_ROW_CLASS =
  "@2xl/flow:@max-5xl/flow:grid @2xl/flow:@max-5xl/flow:grid-cols-[minmax(0,1fr)_auto]";
const MEDIUM_LINES_CLASS =
  "@2xl/flow:@max-5xl/flow:contents @2xl/flow:@max-5xl/flow:[&>:first-child]:col-span-2";
const MEDIUM_VERB_CLASS = "@2xl/flow:@max-5xl/flow:col-start-2 @2xl/flow:@max-5xl/flow:row-start-2";

/**
 * A cell: its lines, then its verbs. The lines never go under a word: where a
 * verb leaves them less, the verb wraps to the cell's end on a line of its own.
 */
function Cell({
  step,
  density,
  lines,
  verbs,
  className,
}: {
  readonly step: FlowCell;
  readonly density: Density;
  readonly lines: ReactNode;
  readonly verbs?: ReactNode;
  readonly className?: string;
}) {
  const row = (
    <span
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
        density === "line" && MEDIUM_ROW_CLASS,
      )}
    >
      <span
        className={cn(
          "flex min-w-24 flex-1 flex-col gap-0.5",
          density === "line" && MEDIUM_LINES_CLASS,
        )}
        data-zerops-cell-lines="true"
      >
        {lines}
      </span>
      <VerbSlot className={cn("ms-auto", density === "line" && MEDIUM_VERB_CLASS)}>
        {verbs}
      </VerbSlot>
    </span>
  );
  if (density === "box") {
    return (
      <div className={cn(STEP_CELL_CLASS, className)} data-zerops-step={step}>
        {row}
      </div>
    );
  }
  return (
    <div className={cn("min-w-0", className)} data-zerops-step={step}>
      {row}
    </div>
  );
}

const MATE_CHIP_CLASS =
  "-mx-1 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-foreground";

/**
 * A Mate by name, with its face: the way into its conversation wherever a row
 * names it. A Mate that cannot open yet — coming up, busy — is the same face
 * and name with nothing to press; one still being created carries how far it
 * has got (`comingMateLine`) in its hover, a row having no room to say it.
 */
export function MateChip({
  face,
  name,
  onOpen,
  coming,
}: {
  readonly face: ReactNode;
  readonly name: string;
  readonly onOpen: (() => void) | undefined;
  readonly coming?: string | undefined;
}) {
  const body = (
    <>
      <span className="flex shrink-0">{face}</span>
      <span className="min-w-0 truncate">{name}</span>
    </>
  );
  if (coming !== undefined)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span aria-busy="true" className={MATE_CHIP_CLASS} data-zerops-surface="mate-coming" />
          }
        >
          {body}
          <span className="sr-only">{coming}</span>
        </TooltipTrigger>
        <TooltipPopup>{coming}</TooltipPopup>
      </Tooltip>
    );
  if (onOpen === undefined) return <span className={MATE_CHIP_CLASS}>{body}</span>;
  return (
    <button
      aria-label={`Open ${name}`}
      className={cn(
        MATE_CHIP_CLASS,
        "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
      )}
      data-zerops-surface="mate-open"
      onClick={onOpen}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * A Mate being created has no colour of its own yet — the tints are dealt to
 * the listed Mates — and its face is asleep, as every Mate's is while it comes
 * up: the face is where that is read.
 */
export function ComingMateFace({ size }: { readonly size: "sm" | "md" }) {
  return <MateFace size={size} state="sleep" tint="slate" />;
}

/**
 * A Mate being created, as a card or as a Projects row: the card a Mate on its
 * way up is, with its name and how far its birth has got — nothing to open,
 * nothing in its menu, until the listing holds it and its own card stands in
 * its place.
 */
export function ComingMateCard({
  name,
  coming,
  layout,
}: {
  readonly name: string;
  readonly coming: GroupFlowComing;
  readonly layout: "card" | "row";
}) {
  return (
    <ZeropsMateCard
      busy
      face="sleep"
      layout={layout}
      line={
        <span className="min-w-0 truncate" data-zerops-surface="mate-coming">
          {comingMateLine(coming)}
        </span>
      }
      name={name}
      tint="slate"
    />
  );
}

/**
 * A group stage, as one line under `main`: `↳ ● Deployed e014b0e`. The `↳`
 * places it under `main`, so a lone stage needs no name; where there are two,
 * each says its own. It says what the stage runs and nothing else — where it
 * lives is its menu's. The state word stays whole; the version gives way. A
 * row draws the first and counts the rest; a box draws each, with its menu.
 */
export function StageLines({
  stages,
  density,
  menuFor,
}: {
  readonly stages: ReadonlyArray<GroupFlowStop>;
  readonly density: Density;
  readonly menuFor?: ((projectId: string) => ReactNode) | undefined;
}) {
  const shown = density === "line" ? stages.slice(0, 1) : stages;
  const more = stages.length - shown.length;
  return shown.map((stop) => {
    const line = stopLine(stop);
    const menu = menuFor?.(stop.projectId);
    return (
      <span
        className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        data-zerops-surface="flow-stage"
        key={stop.projectId}
      >
        <span aria-hidden="true">↳</span>
        {stages.length > 1 ? <span className="min-w-0 truncate">{stop.name} ·</span> : null}
        <StatusDot className="shrink-0" label={line.word} sentence tone={line.tone} />
        {line.version === undefined ? null : (
          <span className="min-w-0 truncate tabular-nums">{line.version}</span>
        )}
        {more > 0 ? <span className="shrink-0">· +{more}</span> : null}
        {drawn(menu) ? <span className="ms-auto flex shrink-0">{menu}</span> : null}
      </span>
    );
  });
}

/** `main`: the last change that landed, and whether it is live — or its stage. */
export function MainStep<T>({
  entry,
  density,
  verb,
  menuFor,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly density: Density;
  readonly verb: ReactNode;
  readonly menuFor?: ((projectId: string) => ReactNode) | undefined;
}) {
  const cell = mainCell(entry.flow, entry.lastMerged);
  const { stages } = entry.flow;
  const notLive = entry.flow.main.notLive > 0;
  const lineOne =
    cell.title !== undefined ? (
      <span className={cn(LINE_ONE_CLASS, "flex items-center gap-1.5")}>
        {density === "box" && cell.head !== undefined ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {cell.head}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{cell.title}</span>
      </span>
    ) : cell.empty ? (
      <EmptyStep>{cell.state}</EmptyStep>
    ) : (
      <span className={LINE_ONE_CLASS}>{cell.state}</span>
    );
  // Line 2 says how much is not live, else — in a row — the stage, else that
  // nothing waits; never what line 1 already said. A box draws its stages
  // under a hairline instead, and a row with work not live leaves its stage to
  // the opened row.
  const stageLine =
    density === "line" && !notLive && stages.length > 0 ? (
      <span className="hidden min-w-0 @2xl/flow:flex">
        <StageLines density="line" stages={stages} />
      </span>
    ) : null;
  const lineTwo =
    stageLine ??
    (cell.title === undefined ? null : (
      <span className={cn(lineTwoClass(density), notLive && "text-foreground/80")}>
        {cell.state}
      </span>
    ));
  return (
    <Cell
      density={density}
      lines={
        <>
          {lineOne}
          {lineTwo}
          {density === "box" && stages.length > 0 ? (
            <span className="mt-1 flex flex-col gap-1 border-t border-border/50 pt-1.5">
              <StageLines density="box" menuFor={menuFor} stages={stages} />
            </span>
          ) : null}
        </>
      }
      step="main"
      verbs={verb}
    />
  );
}

/**
 * *Release* beside a production that has something else to do first (D28):
 * the release that might clear a failed deploy stays in sight. Absent where
 * the next step already is the release, so the cell never shows it twice.
 */
export function releaseVerbFor<T>(
  entry: ProjectsFlowGroup<T>,
  renderReleaseVerb: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined,
): ReactNode {
  const { production } = entry.flow;
  const offered =
    (production.kind === "ready-to-release" || production.kind === "deploy-failed") &&
    production.candidate !== undefined;
  if (!offered || entry.flow.nextStep.kind === "release") return null;
  return renderReleaseVerb?.(entry) ?? null;
}

export function ProductionStep<T>({
  entry,
  density,
  verb,
  releaseVerb,
  menu,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly density: Density;
  readonly verb: ReactNode;
  readonly releaseVerb: ReactNode;
  readonly menu?: ReactNode;
}) {
  const cell = productionCell(entry.flow);
  const menuSlot = drawn(menu) ? <span className="flex">{menu}</span> : null;
  return (
    <Cell
      density={density}
      lines={
        <>
          {cell.empty ? (
            <EmptyStep>{cell.line}</EmptyStep>
          ) : (
            <StatusDot className="min-w-0 text-sm" label={cell.line} sentence tone={cell.tone} />
          )}
          {cell.detail === undefined ? null : (
            <span className={lineTwoClass(density)}>{cell.detail}</span>
          )}
        </>
      }
      step="production"
      // Keyed and without the empties, so a cell with nothing to press has no slot.
      verbs={(
        [
          ["verb", verb],
          ["release", releaseVerb],
          ["menu", menuSlot],
        ] as const
      )
        .filter(([, node]) => drawn(node))
        .map(([key, node]) => (
          <Fragment key={key}>{node}</Fragment>
        ))}
    />
  );
}

/** The pull requests, as a row's cell: the one the next step names, else the newest. */
export function PullRequestsStep<T>({
  entry,
  verb,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly verb: ReactNode;
}) {
  const { flow } = entry;
  const target = flow.nextStep.target;
  const shown =
    (target?.kind === "change"
      ? flow.pullRequests.find(
          ({ pull }) => pull.repository === target.repository && pull.number === target.number,
        )
      : undefined) ?? flow.pullRequests[0];
  const more = flow.pullRequests.length - 1;
  return (
    <Cell
      density="line"
      lines={
        shown === undefined ? (
          <EmptyStep>{pullRequestsLine(flow)}</EmptyStep>
        ) : (
          <>
            <span className={LINE_ONE_CLASS}>
              <span className="text-muted-foreground tabular-nums">#{shown.pull.number}</span>{" "}
              {shown.pull.title}
            </span>
            {shown.state === undefined && more === 0 ? null : (
              <span className={cn(lineTwoClass("line"), "@2xl/flow:flex items-center gap-1")}>
                {shown.state === undefined ? null : (
                  <StatusDot
                    className="min-w-0"
                    label={shown.state.word}
                    sentence
                    tone={shown.state.tone}
                  />
                )}
                {more > 0 ? (
                  <span className="shrink-0">
                    {shown.state === undefined ? "" : "· "}+{more} more
                  </span>
                ) : null}
              </span>
            )}
          </>
        )
      }
      step="pull-requests"
      verbs={verb}
    />
  );
}

/**
 * One of a group's Mates as a surface draws it: a listed one with its
 * environment, or one being created — no environment yet, only how far its
 * birth has got.
 */
export type FlowMateEntry<T> =
  | { readonly kind: "listed"; readonly item: T; readonly mate: GroupFlowMate }
  | { readonly kind: "coming"; readonly mate: GroupFlowMate; readonly coming: GroupFlowComing };

/**
 * A group's Mates in the flow's order — the listed ones, then the ones being
 * created — each listed one paired with its environment by project.
 */
export function matesOf<T>(entry: ProjectsFlowGroup<T>): ReadonlyArray<FlowMateEntry<T>> {
  return entry.flow.mates.flatMap((mate): ReadonlyArray<FlowMateEntry<T>> => {
    const item = entry.mates.get(mate.projectId);
    if (item !== undefined) return [{ kind: "listed", item, mate }];
    return mate.coming === undefined ? [] : [{ kind: "coming", mate, coming: mate.coming }];
  });
}

/**
 * Whether a pull request is the one the next step merges — its own row then
 * carries no second Merge beside the step's.
 */
export function mergesHere(flow: GroupFlow, pull: FlowPullRequest): boolean {
  const target = flow.nextStep.target;
  return (
    flow.nextStep.kind === "merge" &&
    target?.kind === "change" &&
    target.repository === pull.repository &&
    target.number === pull.number
  );
}

/** A group's next-step verb, in the one cell its step acts on; nothing elsewhere. */
export function verbFor<T>(
  entry: ProjectsFlowGroup<T>,
  cell: FlowCell,
  renderNextStep: ZeropsProjectsFlowProps<T>["renderNextStep"],
): ReactNode {
  return nextStepCell(entry.flow) === cell ? renderNextStep(entry, "cell") : null;
}

export function GroupName<T>({
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

/**
 * The Overview's columns, the header's and every row's: toggle · Project ·
 * Mates · Pull requests · main · Production · menu. A medium container drops
 * the Mates column — the names move under the project's. Production is the
 * widest, with a floor: its state and its verb share it, and the state is the
 * column's one fact.
 */
export const OVERVIEW_GRID_CLASS =
  "@2xl/flow:grid @2xl/flow:grid-cols-[1.75rem_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_1.75rem] @2xl/flow:gap-x-4 @5xl/flow:grid-cols-[1.75rem_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(15rem,1.4fr)_1.75rem]";
