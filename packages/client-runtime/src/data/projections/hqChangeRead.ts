/** A review keeps its body during an outage; source refusals are explicit and final. */
import type { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import { changeReadId, changeReadScope } from "../families/hqChangeRead.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export type HqChangeRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly detail: ChangeDetailResponse }
  | { readonly kind: "gone" }
  | { readonly kind: "refused" | "unavailable"; readonly reason: string };
export const hqChangeRead: Projection<
  { readonly orgId: string; readonly owner: string },
  HqChangeRead
> = {
  name: "hqChangeRead",
  keyOf: ({ orgId, owner }) => changeReadId(orgId, owner),
  derive: (read, { orgId, owner }) => {
    const fact = read.fact("hqChangeRead", changeReadId(orgId, owner));
    if (fact.kind === "known") return { kind: "read", detail: fact.value };
    if (fact.kind === "deleted") return { kind: "gone" };
    const { fault } = read.stream(changeReadScope(orgId, owner));
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
