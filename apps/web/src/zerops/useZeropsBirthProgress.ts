/**
 * The birth-progress checklist's one glue point: the project's live activity
 * (`useProjectActivity`, already wired to the account store's process family,
 * `projectProcesses`, so processes arrive over the platform socket and
 * finished ones survive a reload) plus whatever the caller already
 * knows about the candidate, folded into `BirthFacts` (`birthFacts.ts`) and
 * derived into a `BirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`).
 *
 * It reads the shared second for the elapsed label and the active build
 * substep's live duration while the birth runs (`birthClockRuns`): until it is
 * up, failed, or its setup stopped (`stopped`).
 */
import { useMemo } from "react";

import {
  birthClockRuns,
  deriveBirthProgress,
  type BirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";

import { deriveBirthFacts, type BirthFactsInput } from "./birthFacts";
import { useProjectActivity } from "./activity/useProjectActivity";
import { useSecondsNowMs } from "./useNowMs";

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
  const facts = useMemo(
    () => (input === null ? null : deriveBirthFacts({ ...input, processes })),
    [input, processes],
  );
  // Whether the clock runs does not depend on the clock: `nowMs` shapes only sub-step durations.
  const ticking = useMemo(
    () => facts !== null && birthClockRuns(deriveBirthProgress(facts, 0), stopped),
    [facts, stopped],
  );
  const nowMs = useSecondsNowMs(ticking);
  const progress = useMemo<BirthProgress | null>(
    () => (facts === null ? null : deriveBirthProgress(facts, nowMs)),
    [facts, nowMs],
  );

  return progress === null ? null : { progress, nowMs };
}
