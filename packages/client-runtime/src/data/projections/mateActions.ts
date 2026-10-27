import type { MateActionRequest } from "../families/mateActionRequest.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export interface MateActionStatus extends MateActionRequest {
  readonly pending: boolean;
  readonly error: string | null;
  readonly terminalId: string | null;
}
/** Keyed receipt joins make refusals and returned terminal ids survive the initiating surface. */
export const mateActions: Projection<string, ReadonlyArray<MateActionStatus>> = {
  name: "mateActions",
  keyOf: (environmentId) => environmentId,
  equals: sameValue,
  derive: (read, environmentId) => {
    const result: MateActionStatus[] = [];
    for (const id of read.index("mateActionsIn", environmentId)) {
      const fact = read.fact("mateActionRequest", id);
      if (fact.kind !== "known") continue;
      const operation = read.operation(fact.value.requestId);
      if (operation === undefined) continue;
      const refused =
        operation.receipt?.acceptance.kind === "refused"
          ? operation.receipt.acceptance.reason
          : null;
      const error = refused ?? operation.unresolved?.nextAction ?? operation.unsentBecause ?? null;
      result.push({
        ...fact.value,
        error,
        pending:
          error === null &&
          (operation.receipt === null || operation.receipt.outcome.kind === "pending"),
        terminalId:
          operation.receipt?.acceptance.kind === "accepted" ? (operation.handles[0] ?? null) : null,
      });
    }
    return result.sort((a, b) => b.ordinal - a.ordinal);
  },
};
