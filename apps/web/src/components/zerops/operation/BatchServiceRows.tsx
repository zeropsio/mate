/**
 * A batch deploy's services, side by side: each its name, how it stands in a word where its steps
 * do not say it (waiting, failed, cancelled), and under it its own pipeline as the list a single deploy draws
 * (`PipelineStepList`) — the steps that pipeline has and no others, the one under way ticking,
 * since each service runs on its own clock, and beside its build the way to its own log. Before the platform has worked a service's steps out
 * of zerops.yml its list is the one row that says so; before its version exists, its word alone.
 *
 * The columns are as wide as a step list needs and no wider than its times stay near their names
 * (`.batch-services`); they go under each other where the card is narrow. No boxes, no slots held
 * for steps a pipeline does not have (the owner, 2026-11-11, on the grid of boxed segments this
 * replaces, beside the platform's own pipeline list: "mini version of this would be best").
 *
 * Presentational, props only (R2): every word is the caller's.
 */
import type { JSX, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { PipelineCalculating, PipelineStepList, type PipelineStepRow } from "./PipelineStepList";

export interface BatchServiceRow {
  /** The service's hostname. */
  readonly name: string;
  readonly state: "waiting" | "running" | "done" | "failed" | "cancelled";
  /** How it stands in a word: "Waiting", "Deployed", "Failed", "Cancelled". */
  readonly stateLabel: string;
  /** Its own pipeline's steps, as a single deploy's list reads them; empty when none is shown. */
  readonly steps: ReadonlyArray<PipelineStepRow>;
  /** The platform is still working its steps out of zerops.yml. */
  readonly calculating?: boolean;
  /** The way to this service's own build log, beside the step that runs its build. */
  readonly log?: ReactNode;
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
      {services.map((service) => {
        const listed = service.calculating === true || service.steps.length > 0;
        return (
          <li
            className="grid min-w-0 content-start gap-1"
            data-zerops-batch-service={service.name}
            data-zerops-batch-service-state={service.state}
            key={service.name}
          >
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium font-mono text-foreground text-line leading-5">
                {service.name}
              </span>
              {/* Under way or out, its steps' marks say how it stands; anything else is a word. */}
              {listed && (service.state === "running" || service.state === "done") ? (
                <span className="sr-only">{service.stateLabel}</span>
              ) : (
                <span
                  className={cn(
                    "shrink-0 text-line leading-5",
                    service.state === "failed"
                      ? "text-status-failed-text"
                      : "text-muted-foreground",
                  )}
                  data-zerops-batch-service-word
                >
                  {service.stateLabel}
                </span>
              )}
            </span>
            {service.calculating === true ? (
              <PipelineCalculating aria-label={`${service.name} steps`} />
            ) : service.steps.length > 0 ? (
              <PipelineStepList
                after={service.log === undefined ? undefined : { RUN_BUILD_COMMANDS: service.log }}
                aria-label={`${service.name} steps`}
                steps={service.steps}
                ticking
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
