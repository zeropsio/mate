import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import type { CreationPressResult } from "../operations/creationPress.ts";
import { sameValue } from "./equal.ts";
/** The press's result is evidence from its executor; omission never settles it. */
export const creationProgress: Projection<string, CreationPressResult | null> = {
  name: "creationProgress",
  keyOf: (id) => id,
  equals: sameValue,
  derive: (read, requestId) => operationResult(read.operation(requestId), "creation-press") ?? null,
};
