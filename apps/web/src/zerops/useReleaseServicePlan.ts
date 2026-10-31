import {
  hqReleaseReview,
  releaseReviewOwner,
  releaseReviewRequest,
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

/** Every Native release and rollback demands the exact captured production plan. */
export function useReleaseServicePlan(
  flow: ZeropsProjectFlow,
  tag: string | undefined,
  reviewing: boolean,
  rollback?: {
    readonly rollbackOf: string;
    readonly entries: ReadonlyArray<{ readonly service: string; readonly sha: string }>;
  },
) {
  const account = useAccountDataOptional();
  const orgId = useAccountOrgId();
  const offer = flow.release;
  const required = offer.git === undefined;
  const owner =
    required &&
    reviewing &&
    offer.permission?.allowed === true &&
    offer.releaseTarget?.target.kind === "zerops" &&
    offer.releaseTarget.declaration !== undefined &&
    offer.groupHead !== undefined &&
    tag !== undefined
      ? releaseReviewOwner({
          appId: flow.groupId,
          request: {
            tag,
            groupHead: offer.groupHead,
            entries:
              rollback?.entries ??
              offer.entries.map(({ service, commit }) => ({ service, sha: commit })),
            target: "zerops",
            releaseTarget: offer.releaseTarget,
            ...(rollback === undefined ? {} : { rollbackOf: rollback.rollbackOf }),
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
    request: owner === null ? undefined : releaseReviewRequest(owner)?.request,
    view,
    again: () => {
      if (owner !== null) account?.retryDetail({ family: "hqReleaseReview", ownerId: owner });
    },
  };
}
