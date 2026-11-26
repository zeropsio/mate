/**
 * Pieces of a Mate's arrival other surfaces draw: its services' line and its runtimes still coming
 * up. The arrival itself is one
 * progress row (`ComingBelow`).
 */
import type { BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { Badge, type BadgeTone } from "../ui/badge";

import {
  nextRuntimesLine,
  runtimesComing,
  type ArrivalService,
  type RuntimesLine,
} from "~/zerops/mateArrival";

/** A service's state as the kit's dot: a hollow one where nothing runs yet or ever will. */
const SERVICE_DOT: Readonly<
  Record<ArrivalService["state"], { readonly tone: BadgeTone; readonly hollow: boolean }>
> = {
  ok: { tone: "success", hollow: false },
  busy: { tone: "info", hollow: false },
  waiting: { tone: "neutral", hollow: true },
  failed: { tone: "danger", hollow: false },
  empty: { tone: "neutral", hollow: true },
};

const SERVICE_STATE_WORDS: Readonly<Record<ArrivalService["state"], string>> = {
  ok: "running",
  busy: "coming up",
  waiting: "waiting",
  failed: "stopped",
  empty: "stays empty until something is released to it",
};

/** A project's services, one name and one dot each, quieter than the steps above them. */
export function ArrivalServices({
  services,
  className,
}: {
  readonly services: ReadonlyArray<ArrivalService>;
  /** Its place on its line. */
  readonly className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-1 text-caption leading-4 text-muted-foreground",
        className,
      )}
      data-zerops-surface="arrival-services"
    >
      {services.map((service) => (
        // A service that stays empty reads quieter still.
        <li
          aria-label={`${service.name}: ${SERVICE_STATE_WORDS[service.state]}`}
          className="inline-flex data-[state=empty]:text-muted-foreground/70"
          data-state={service.state}
          key={service.name}
        >
          <Badge
            dot
            hollow={SERVICE_DOT[service.state].hollow}
            tone={SERVICE_DOT[service.state].tone}
          >
            {service.name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Under the sign-in, the runtimes still coming up after the Mate answered — "appdev appstage
 * coming up", one dot each as on the workspace step, in its order. Nothing for runtimes already
 * up; once all are, its words fade and its place stays until the sign-in goes (`nextRuntimesLine`).
 */
export function ArrivalRuntimesLine({
  runtimes,
}: {
  readonly runtimes: ReadonlyArray<BirthRuntimeFact> | undefined;
}) {
  const read = runtimesComing(runtimes);
  const [held, setHeld] = useState<{
    readonly line: RuntimesLine;
    readonly services: ReadonlyArray<ArrivalService>;
  }>({ line: "none", services: [] });
  // An unread listing (it blinks between reads) says nothing: the line stays as it stands.
  const line = nextRuntimesLine(
    held.line,
    runtimes === undefined ? undefined : read?.coming === true,
  );
  // Its last names are kept for a read that has none any more: its place stays drawn, faded.
  const services = read?.services ?? held.services;
  if (line !== held.line) setHeld({ line, services });
  if (line === "none") return null;
  return (
    <div
      aria-hidden={line === "settled" ? true : undefined}
      // Quiet and centred; once all are up its words fade and its place stays: the page is
      // centred, and a line that went would move everything above it.
      className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-caption leading-4 text-muted-foreground transition-opacity duration-200 ease-out-strong data-[state=settled]:opacity-0 motion-reduce:transition-none"
      data-state={line}
      data-zerops-surface="arrival-runtimes"
    >
      <ArrivalServices className="justify-center" services={services} />
      <span>coming up</span>
    </div>
  );
}
