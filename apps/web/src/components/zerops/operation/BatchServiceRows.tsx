/**
 * A batch deploy's services: one row each, in the order its call named them, every row the same
 * anatomy and its columns aligned down the list, so it reads the same with two services or ten —
 * the service's mark (`StepGlyph`), its name in a column as wide as the batch's longest name, what
 * it does now in plain words ("Waiting", the step under way, "Deployed", "Failed at Build"), the
 * way to its own build log on its own row, and its time at the right: the running step's, ticking,
 * since each service runs on its own clock; once it ended, its steps' total. The steps a running
 * service went through are not listed; how far it is stands quietly beside its words ("2 of 3").
 * A service that failed opens under its row into its pipeline (`PipelineStepList`) with why, as a
 * single deploy shows it; nothing else opens.
 *
 * No boxes, no grid of step lists (the owner, 2026-11-12, of a column of per-service step lists
 * side by side: "is this design still … ugly when there are more services"), after the platform's
 * own pipeline popup ("mini version of this would be best", 2026-11-11). Rows never move: a row's
 * mark and words cross-fade in place when they change (`Swap`).
 *
 * Presentational, props only (R2): the states and words are the caller's; a step's name is the one
 * every pipeline list uses (`STEP_NAME`), its duration `formatDuration`'s.
 */
import { useState, type JSX, type ReactNode } from "react";

import { formatDuration } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";

import { cn } from "~/lib/utils";
import { StepGlyph, type StepGlyphState } from "../primitives";
import {
  CALCULATING_WORDS,
  isInFlight,
  PipelineStepList,
  STEP_NAME,
  type PipelineStepRow,
} from "./PipelineStepList";

export interface BatchServiceRow {
  /** The service's hostname. */
  readonly name: string;
  readonly state: "waiting" | "running" | "done" | "failed" | "cancelled";
  /** How it stands in a word: "Waiting", "Deploying", "Deployed", "Failed", "Cancelled". */
  readonly stateLabel: string;
  /** Its own pipeline's steps, as a single deploy's list reads them; empty when none is known. */
  readonly steps: ReadonlyArray<PipelineStepRow>;
  /** The platform is still working its steps out of zerops.yml. */
  readonly calculating?: boolean;
  /** Why it failed, in one line: said under its row. */
  readonly reason?: string;
  /** The way to this service's own build log, on its row. */
  readonly log?: ReactNode;
}

const GLYPH: Readonly<Record<BatchServiceRow["state"], StepGlyphState>> = {
  waiting: "waiting",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "stopped",
};

const stepName = (step: PipelineStepRow): string => STEP_NAME[step.id] ?? step.sentence;

/** What a service does now, in plain words. */
function wordsOf(service: BatchServiceRow): string {
  if (service.calculating === true) return CALCULATING_WORDS;
  if (service.state === "running") {
    const now = service.steps.find((step) => isInFlight(step.state));
    return now === undefined ? service.stateLabel : stepName(now);
  }
  if (service.state === "failed") {
    const broke = service.steps.find((step) => step.state === "failed");
    return broke === undefined ? service.stateLabel : `Failed at ${stepName(broke)}`;
  }
  return service.stateLabel;
}

/** How far a running service is through its steps: "2 of 3". */
function progressOf(service: BatchServiceRow): string | undefined {
  if (service.state !== "running" || service.steps.length < 2) return undefined;
  const index = service.steps.findIndex((step) => isInFlight(step.state));
  return index < 0 ? undefined : `${index + 1} of ${service.steps.length}`;
}

/** Its time: the running step's, else, once it ended, its steps' total. */
function timeOf(service: BatchServiceRow): string | undefined {
  if (service.state === "waiting" || service.calculating === true) return undefined;
  if (service.state === "running") {
    const now = service.steps.find((step) => isInFlight(step.state));
    return now?.durationMs === undefined ? undefined : formatDuration(now.durationMs);
  }
  const total = service.steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  return formatDuration(total);
}

/**
 * What it holds, changed in place: the new fades in over the old as the old fades out where it
 * stood (`.batch-swap`). A first paint is simply there; under reduced motion a change is a cut.
 */
function Swap({
  value,
  children,
  className,
}: {
  /** What it says: a change of it is a change. */
  readonly value: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const [held, setHeld] = useState<{
    readonly value: string;
    readonly node: ReactNode;
    readonly left: { readonly value: string; readonly node: ReactNode } | null;
  }>({ value, node: children, left: null });
  if (held.value !== value) {
    setHeld({ value, node: children, left: { value: held.value, node: held.node } });
  }
  return (
    <span className={cn("batch-swap", className)}>
      {held.left === null ? null : (
        <span
          aria-hidden="true"
          className="batch-swap-left"
          key={`left:${held.left.value}`}
          // Gone once faded: nothing of it stays in the row.
          onAnimationEnd={() =>
            setHeld((now) => (now.left === null ? now : { ...now, left: null }))
          }
        >
          {held.left.node}
        </span>
      )}
      <span data-batch-swap-changed={held.left === null ? undefined : ""} key={value}>
        {children}
      </span>
    </span>
  );
}

/** Why a service failed, under its row, as a single deploy says it under its step. */
function FailedBecause({ reason }: { readonly reason: string }) {
  return (
    <span
      className="block break-words text-foreground text-line leading-5"
      data-zerops-batch-service-reason
    >
      {reason}
    </span>
  );
}

function ServiceRow({ service }: { readonly service: BatchServiceRow }) {
  const glyph: StepGlyphState = service.calculating === true ? "running" : GLYPH[service.state];
  const words = wordsOf(service);
  const progress = progressOf(service);
  const time = timeOf(service);
  const broke = service.steps.find((step) => step.state === "failed");
  const reason =
    service.reason === undefined ? undefined : <FailedBecause reason={service.reason} />;
  return (
    <li
      className="batch-service"
      data-zerops-batch-service={service.name}
      data-zerops-batch-service-state={service.state}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Swap className="flex h-5 shrink-0 items-center" value={glyph}>
          <StepGlyph state={glyph} />
        </Swap>
        <span className="min-w-0 truncate font-medium font-mono text-foreground text-line leading-5">
          {service.name}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        <Swap
          className={cn(
            "min-w-0 truncate text-line leading-5",
            service.state === "failed"
              ? "text-status-failed-text"
              : service.state === "running"
                ? "text-foreground"
                : service.state === "waiting"
                  ? "text-muted-foreground/70"
                  : "text-muted-foreground",
          )}
          value={words}
        >
          {words}
          {/* A step's name alone does not say it runs: this, for a reader without the mark. */}
          {service.state === "running" ? (
            <span className="sr-only"> · {service.stateLabel}</span>
          ) : null}
        </Swap>
        {progress === undefined ? null : (
          <span
            className="shrink-0 text-line text-muted-foreground/70 leading-5 tabular-nums"
            data-zerops-batch-service-progress
          >
            {progress}
          </span>
        )}
        {service.log}
      </span>
      <span
        className="line-time text-line text-muted-foreground leading-5 tabular-nums"
        data-zerops-batch-service-time
      >
        {time}
      </span>
      {service.state !== "failed" || (service.steps.length === 0 && reason === undefined) ? null : (
        <div className="batch-service-steps">
          {service.steps.length > 0 ? (
            <PipelineStepList
              aria-label={`${service.name} steps`}
              beneath={
                broke === undefined || reason === undefined ? undefined : { [broke.id]: reason }
              }
              steps={service.steps}
            />
          ) : null}
          {/* It failed with no step that broke: why, under its row. */}
          {broke === undefined || service.steps.length === 0 ? reason : null}
        </div>
      )}
    </li>
  );
}

export function BatchServiceRows({
  "aria-label": ariaLabel,
  services,
}: {
  readonly "aria-label": string;
  readonly services: ReadonlyArray<BatchServiceRow>;
}): JSX.Element {
  return (
    <ol aria-label={ariaLabel} className="batch-services" data-zerops-batch-services>
      {services.map((service) => (
        <ServiceRow key={service.name} service={service} />
      ))}
    </ol>
  );
}
