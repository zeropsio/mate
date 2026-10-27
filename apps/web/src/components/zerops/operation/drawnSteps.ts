/**
 * The steps an operation's card draws: all of them, except a result-line
 * kind's with nothing failed. Read by the card that draws them and by the
 * count of what its line opens to (`detailLines`), so a chevron never opens
 * onto nothing. Pure (R2).
 */
import type { ZeropsOperation, ZeropsOperationKind } from "@t3tools/client-runtime/zerops/model";

/**
 * The kinds whose card is a header and a result: their one step repeats what
 * the status word and the result line already say, so it is drawn only when
 * it failed.
 */
const RESULT_LINE_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "delete",
  "devServer",
  "env",
  "manage",
  "scale",
]);

export function drawnSteps<Step extends { readonly state: string }>(
  operation: Pick<ZeropsOperation, "kind">,
  steps: ReadonlyArray<Step>,
): ReadonlyArray<Step> {
  return RESULT_LINE_KINDS.has(operation.kind) && !steps.some((step) => step.state === "failed")
    ? []
    : steps;
}
