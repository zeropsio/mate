/**
 * The birth-progress checklist's one glue point: the project's live activity
 * (`useProjectActivity`, already wired to the account store's process family,
 * `projectProcesses`, so processes arrive over the platform socket and
 * finished ones survive a reload) plus whatever the caller already
 * knows about the candidate, folded into `BirthFacts` (`birthFacts.ts`) and
 * derived into a `BirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`).
 *
 * The only state this hook owns is a 1-second clock for the elapsed label
 * and the active build substep's live duration — it ticks while the birth runs
 * (`birthClockRuns`): until it is up, failed, or its setup stopped (`stopped`).
 */
import { useEffect, useMemo, useState } from "react";

import {
  birthClockRuns,
  deriveBirthProgress,
  type BirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";

import { deriveBirthFacts, type BirthFactsInput } from "./birthFacts";
import { useProjectActivity } from "./activity/useProjectActivity";

export type UseZeropsBirthProgressInput = Omit<BirthFactsInput, "processes">;

export interface UseZeropsBirthProgressResult {
  readonly progress: BirthProgress;
  readonly nowMs: number;
}

export function useZeropsBirthProgress(
  input: UseZeropsBirthProgressInput | null,
  /** Its setup stopped, as its arrival says: its times stand where it stopped. */
  stopped = false,
): UseZeropsBirthProgressResult | null {
  const projectId = input === null ? null : input.candidate.project.id;
  const { processes } = useProjectActivity(projectId);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const progress = useMemo<BirthProgress | null>(() => {
    if (input === null) return null;
    return deriveBirthProgress(deriveBirthFacts({ ...input, processes }), nowMs);
  }, [input, processes, nowMs]);

  const hidden = input === null;
  const ticking = progress !== null && birthClockRuns(progress, stopped);
  useEffect(() => {
    if (hidden || !ticking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hidden, ticking]);

  return progress === null ? null : { progress, nowMs };
}
