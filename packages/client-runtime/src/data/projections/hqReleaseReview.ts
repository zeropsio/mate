import type { HqProblem } from "@t3tools/shared/hqProblems";
/** A creation plan authorizes approval only after the current demanded review answered. */
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import { releaseReviewId, releaseReviewScope } from "../families/hqReleaseReview.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export type HqReleaseReview =
  | { readonly kind: "pending" }
  | { readonly kind: "ready"; readonly plan: ReleaseServicePlan }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly problems?: ReadonlyArray<HqProblem> | undefined;
    };
export const hqReleaseReview: Projection<
  { readonly orgId: string; readonly owner: string },
  HqReleaseReview
> = {
  name: "hqReleaseReview",
  keyOf: ({ orgId, owner }) => releaseReviewId(orgId, owner),
  derive: (read, { orgId, owner }) => {
    const scope = releaseReviewScope(orgId, owner);
    const stream = read.stream(scope);
    const fact = read.fact("hqReleaseReview", releaseReviewId(orgId, owner));
    if (stream.fault !== null)
      return { kind: "failed", reason: stream.fault.message, problems: stream.fault.problems };
    if (fact.kind === "known" && stream.phase === "live" && read.coverage(scope) === "complete")
      return { kind: "ready", plan: fact.value };
    return { kind: "pending" };
  },
  equals: sameValue,
};
