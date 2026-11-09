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

/**
 * HQ's review of a release to a Zerops production: what it creates and deploys there. Only the
 * review reads Production's services (navigation names none), so the release waits for it while
 * its gate allows; a Git production has its preflight instead.
 */
export function useReleaseServicePlan(
  /** The application's flow; `undefined` while it is not read: nothing is asked. */
  flow: ZeropsProjectFlow | undefined,
  tag: string | undefined,
  reviewing: boolean,
) {
  const account = useAccountDataOptional();
  const orgId = useAccountOrgId();
  const offer = flow?.release;
  const required = offer !== undefined && offer.git === undefined && offer.gate.allowed;
  const owner =
    flow !== undefined &&
    offer !== undefined &&
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
