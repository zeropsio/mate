/** HQ's judgement of a change now; a failed read leaves the review saying it is still checked. */
import type { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import { changeReadId } from "../families/hqChangeRead.ts";
import { changeVerdictScope } from "../families/hqChangeVerdict.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export type HqChangeVerdict =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly detail: ChangeDetailResponse }
  | { readonly kind: "gone" }
  | { readonly kind: "refused" | "unavailable"; readonly reason: string };
export const hqChangeVerdict: Projection<
  { readonly orgId: string; readonly owner: string },
  HqChangeVerdict
> = {
  name: "hqChangeVerdict",
  keyOf: ({ orgId, owner }) => changeReadId(orgId, owner),
  derive: (read, { orgId, owner }) => {
    const fact = read.fact("hqChangeVerdict", changeReadId(orgId, owner));
    if (fact.kind === "known") return { kind: "read", detail: fact.value };
    if (fact.kind === "deleted") return { kind: "gone" };
    const { fault } = read.stream(changeVerdictScope(orgId, owner));
    if (fault === null) return { kind: "reading" };
    if (fault.code === "not_found") return { kind: "gone" };
    return {
      kind:
        fault.outcome === "definitive-refusal" || fault.outcome === "authoritative-denial"
          ? "refused"
          : "unavailable",
      reason: fault.message,
    };
  },
  equals: sameValue,
};
