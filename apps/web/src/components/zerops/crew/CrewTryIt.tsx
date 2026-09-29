/**
 * *Try it* on a finished run's result row, beside *Review*, while its crew
 * task is ready to land: the crewmate's work tried before it lands — its own
 * app, run first while stopped, or its work shown at the Mate's dev address —
 * as its menu's *Try its work* tries it (`useCrewTry`). Nothing for a
 * crewmate with no copy of the code; held while there is nothing to open yet.
 */
import { CREW_TRY_IT_WORD } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId } from "@t3tools/contracts";

import { useCrewTry } from "../../../zerops/crew/useCrewTry";

export function CrewTryIt({
  environmentId,
  handle,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly handle: string;
  /** The row's title, for the press's accessible name. */
  readonly title: string;
}) {
  const tries = useCrewTry(environmentId, handle);
  if (tries === null) return null;
  return (
    <button
      aria-label={`${CREW_TRY_IT_WORD}: ${title}`}
      className="run-result-action"
      data-crew-try-it={handle}
      disabled={!tries.enabled}
      onClick={tries.press}
      type="button"
    >
      {CREW_TRY_IT_WORD}
    </button>
  );
}
