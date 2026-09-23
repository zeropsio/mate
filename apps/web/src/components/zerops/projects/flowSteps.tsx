/**
 * The step cells both views draw: a Mate's preview, `main` with its stages,
 * the production, and the group's name.
 */

import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { StatusDot } from "../primitives";
import { mainCell, productionCell, stopLine } from "./projectsView.logic";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

export const QUIET_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** A step with nothing in it is a place, drawn dashed — never a row that says "not set up yet". */
export const STEP_BOX_CLASS = "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm";
export const EMPTY_STEP_CLASS = "border-dashed border-border text-muted-foreground";
export const FILLED_STEP_CLASS = "border-border/60 bg-card";

export function PreviewLink({ url }: { readonly url: string }) {
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

export function MainStep<T>({
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

export function ProductionStep<T>({
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
export function drawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
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

export const OVERVIEW_GRID_CLASS =
  "md:grid md:grid-cols-[1.75rem_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_2rem] md:items-center md:gap-x-3";
