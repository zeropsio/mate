/** A Move may rename only after its receipt and current placement arrived together from HQ. */
import type { Projection } from "../store.ts";
import { linkKeys } from "../model.ts";
import { sameValue } from "./equal.ts";
import { moveRemainder, type MoveRemainder } from "./moveRemainder.ts";

export const recordedMoveRemainder: Projection<
  Parameters<typeof moveRemainder.derive>[1],
  MoveRemainder | { readonly kind: "unobserved" }
> = {
  name: "recordedMoveRemainder",
  keyOf: moveRemainder.keyOf,
  equals: sameValue,
  derive: (read, key) => {
    const fact = read.fact("hqLifecycle", key.requestId);
    if (fact.kind === "withheld") return { kind: "withheld" };
    if (read.stream(linkKeys.hq(key.orgId)).phase !== "live") return { kind: "unobserved" };
    if (fact.kind !== "known") return { kind: "checking" };
    if (fact.value.intent.orgId !== key.orgId || fact.value.intent.hqProjectId !== key.hqProjectId)
      return { kind: "withheld" };
    return moveRemainder.derive(read, key);
  },
};
