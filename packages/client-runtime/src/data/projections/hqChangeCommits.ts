/** A review keeps its body during an outage; source refusals are explicit and final. */
import type { ChangeCommitsResponse } from "@t3tools/shared/hqChanges";
import { changeReadId } from "../families/hqChangeRead.ts";
import { changeCommitsScope } from "../families/hqChangeCommits.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export type HqChangeCommits =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly detail: ChangeCommitsResponse }
  | { readonly kind: "gone" }
  | { readonly kind: "refused" | "unavailable"; readonly reason: string };
export const hqChangeCommits: Projection<
  { readonly orgId: string; readonly owner: string },
  HqChangeCommits
> = {
  name: "hqChangeCommits",
  keyOf: ({ orgId, owner }) => changeReadId(orgId, owner),
  derive: (read, { orgId, owner }) => {
    const fact = read.fact("hqChangeCommits", changeReadId(orgId, owner));
    if (fact.kind === "known") return { kind: "read", detail: fact.value };
    if (fact.kind === "deleted") return { kind: "gone" };
    const { fault } = read.stream(changeCommitsScope(orgId, owner));
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
