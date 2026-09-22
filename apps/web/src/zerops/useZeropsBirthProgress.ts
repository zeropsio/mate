/**
 * The birth-progress checklist's one glue point: the project's live activity
 * (`useProjectActivity`, already wired to the `project-activity` and
 * `project-process-history` interests so processes arrive over the platform
 * socket and finished ones survive a reload) plus whatever the caller already
 * knows about the candidate, folded into `BirthFacts` (`birthFacts.ts`) and
 * derived into a `BirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`).
 *
 * The only state this hook owns is a 1-second clock for the elapsed label
 * and the active build substep's live duration — it ticks only while there
 * is a birth to show and that birth is not yet complete.
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
  const complete = progress?.complete ?? true;
  useEffect(() => {
    if (hidden || complete) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hidden, complete]);

  return progress === null ? null : { progress, nowMs };
}
