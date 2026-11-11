import {
  hqReleaseReview,
  releaseReviewOwner,
  type HqReleaseReview,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "./ZeropsAccountData";
import type { ZeropsProjectFlow } from "./projectFlows";
import { useHeldForKey, useTabShown } from "./useHeldFor";

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
    /** Whether HQ is asked at all: no version to review under asks nothing. */
    asked: owner !== null,
    view,
    again: () => {
      if (owner !== null) account?.retryDetail({ family: "hqReleaseReview", ownerId: owner });
    },
  };
}

/** How long the review has waited for HQ's plan, as the person saw it wait. */
export type ReleasePlanWait = "started" | "working" | "late";

/** After this the wait says what HQ's review reads. */
const WORKING_MS = 4_000;
/** The read's own deadline (`STREAM_POLICY.baselineTimeoutMs`): past it HQ is asked again. */
const LATE_MS = 20_000;
/** The review's own: past it the wait is over, whatever is still asked behind it. */
const EXPIRED_MS = 45_000;

/**
 * The wait for HQ's plan, counted while the tab is shown: what it says after a while, past the
 * read's deadline, and where the review stops waiting. `restart` begins it anew, on Try again.
 */
export function useReleasePlanWait(waiting: boolean): {
  readonly stage: ReleasePlanWait | "expired";
  readonly restart: () => void;
} {
  const shown = useTabShown();
  const [round, setRound] = useState(0);
  const stretch = waiting && shown ? `wait:${String(round)}` : null;
  const working = useHeldForKey(stretch, WORKING_MS);
  const late = useHeldForKey(stretch, LATE_MS);
  const expired = useHeldForKey(stretch, EXPIRED_MS);
  return {
    stage: expired ? "expired" : late ? "late" : working ? "working" : "started",
    restart: () => setRound((before) => before + 1),
  };
}
