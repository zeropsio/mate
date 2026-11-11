/**
 * A batch deploy's services, one row each: the service's name, then its own
 * pipeline as segments (`PipelineSegments`) on the five slots — a stage its
 * pipeline has not is an empty slot of the same width — or, with no step to
 * show, how it stands in a word. The names share one column, so every row's
 * slots line up.
 *
 * Presentational, props only (R2): every word is the caller's.
 */
import type { JSX } from "react";

import type { ProcessStep } from "../primitives";
import { PipelineSegments } from "./OperationStepRow";

export interface BatchServiceRow {
  /** The service's hostname. */
  readonly name: string;
  readonly state: "waiting" | "running" | "done" | "failed" | "cancelled";
  /** How it stands in a word: "Waiting", "Deployed", "Failed", "Cancelled". */
  readonly stateLabel: string;
  /** Its own pipeline on the five slots (`null`: a stage it has not); empty when none is shown. */
  readonly steps: ReadonlyArray<ProcessStep | null>;
}

export function BatchServiceRows({
  "aria-label": ariaLabel,
  services,
}: {
  readonly "aria-label": string;
  readonly services: ReadonlyArray<BatchServiceRow>;
}): JSX.Element {
  return (
    <ol
      aria-label={ariaLabel}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5"
      data-zerops-batch-services
    >
      {services.map((service) => (
        <li
          className="col-span-2 grid grid-cols-subgrid items-start"
          data-zerops-batch-service={service.name}
          data-zerops-batch-service-state={service.state}
          key={service.name}
        >
          <span className="max-w-48 truncate pt-1 font-medium text-xs leading-4">
            {service.name}
          </span>
          {service.steps.length > 0 ? (
            <PipelineSegments
              aria-label={`${service.name}: ${service.stateLabel}`}
              steps={service.steps}
            />
          ) : (
            <span className="pt-1 text-muted-foreground text-xs leading-4">
              {service.stateLabel}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
