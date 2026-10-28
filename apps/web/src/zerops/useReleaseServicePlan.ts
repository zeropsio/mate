import {
  hqReleaseReview,
  releaseReviewOwner,
  type HqReleaseReview,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "./ZeropsAccountData";
import type { ZeropsProjectFlow } from "./projectFlows";

const PENDING = Atom.make<HqReleaseReview>({ kind: "pending" });

/** Creation alone adds a review read; ordinary releases retain their existing approval path. */
export function useReleaseServicePlan(
  flow: ZeropsProjectFlow,
  tag: string | undefined,
  reviewing: boolean,
) {
  const account = useAccountDataOptional();
  const orgId = useAccountOrgId();
  const offer = flow.release;
  const required = offer.git === undefined && (offer.missingServices?.length ?? 0) > 0;
  const owner =
    required &&
    reviewing &&
    offer.permission?.allowed === true &&
    offer.groupHead !== undefined &&
    tag !== undefined
      ? releaseReviewOwner({
          appId: flow.groupId,
          request: {
            tag,
            groupHead: offer.groupHead,
            entries: offer.entries.map(({ service, commit }) => ({ service, sha: commit })),
            ...(offer.releaseTarget === undefined
              ? {}
              : {
                  target: "zerops" as const,
                  releaseTarget: offer.releaseTarget,
                }),
          },
        })
      : null;
  useDetailDemand("hqReleaseReview", undefined, owner);
  const view = useProjection(
    hqReleaseReview,
    orgId === null || owner === null ? null : { orgId, owner },
    PENDING,
  );
  return {
    required,
    view,
    again: () => {
      if (owner !== null) account?.retryDetail({ family: "hqReleaseReview", ownerId: owner });
    },
  };
}
