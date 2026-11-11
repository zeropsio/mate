import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import type { CreationPressResult } from "../operations/creationPress.ts";
import { sameValue } from "./equal.ts";
/** The press's result is evidence from its executor; omission never settles it. */
export const creationProgress: Projection<string, CreationPressResult | null> = {
  name: "creationProgress",
  keyOf: (id) => id,
  equals: sameValue,
  derive: (read, requestId) => {
    const result = operationResult(read.operation(requestId), "creation-press") ?? null;
    if (result?.state.kind !== "failed" || result.state.uncertain !== true) return result;
    const unresolved = result.state.step;
    return {
      ...result,
      // The caller ended without an owner answer; that step still awaits its result.
      progress: result.progress.map((entry) =>
        entry.step.kind === unresolved && entry.state === "failed"
          ? { ...entry, state: "running" as const }
          : entry,
      ),
    };
  },
};
