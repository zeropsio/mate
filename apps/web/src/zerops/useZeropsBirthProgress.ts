/**
 * The birth-progress checklist's one glue point: the project's live activity
 * (`useProjectActivity`, already wired to the account store's process family,
 * `projectProcesses`, so processes arrive over the platform socket and
 * finished ones survive a reload) plus whatever the caller already
 * knows about the candidate, folded into `BirthFacts` (`birthFacts.ts`) and
 * derived into a `BirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`).
 *
 * The only state this hook owns is a 1-second clock for the elapsed label
 * and the active build substep's live duration — it ticks only while a known
 * started step has no end and the birth has not failed.
 */
import { useEffect, useMemo, useState } from "react";

import {
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
): UseZeropsBirthProgressResult | null {
  const projectId = input === null ? null : input.candidate.project.id;
  const { processes } = useProjectActivity(projectId);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const progress = useMemo<BirthProgress | null>(() => {
    if (input === null) return null;
    return deriveBirthProgress(deriveBirthFacts({ ...input, processes }), nowMs);
  }, [input, processes, nowMs]);

  const hidden = input === null;
  const ticking =
    progress !== null &&
    progress.failed === null &&
    progress.steps.some(
      (step) =>
        step.state === "active" && step.startedAt !== undefined && step.endedAt === undefined,
    );
  useEffect(() => {
    if (hidden || !ticking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hidden, ticking]);

  return progress === null ? null : { progress, nowMs };
}
