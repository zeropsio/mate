/**
 * What HQ answered a flow's write with, for the surface that pressed it: the release it made, by
 * its tag, and where the deploys it asked for stand. A write adopted after a lost answer has its
 * handle but no answer — its deploys come down HQ's navigation with its jobs. `null` until HQ took
 * the write.
 *
 * @module data/projections/flowAnswer
 */
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";

import type { AppDeployRollout } from "../../zerops/hq/deployHandover.logic.ts";

import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface FlowWriteAnswer {
  /** The release a release or a roll back made. */
  readonly tag?: string;
  readonly deploys: HqDeployAnswer | undefined;
  /** The rollout its deploys are of, in its application: what a handed-over answer follows. */
  readonly rollout?: AppDeployRollout;
}

export const flowAnswer: Projection<string, FlowWriteAnswer | null> = {
  name: "flowAnswer",
  keyOf: (requestId) => requestId,
  equals: sameValue,
  derive: (read, requestId) => {
    const record = read.operation(requestId);
    const receipt = record?.receipt;
    if (record === undefined || receipt == null || receipt.acceptance.kind !== "accepted")
      return null;
    const result = receipt.acceptance.result as
      | (Partial<FlowWriteAnswer> & { readonly mergedSha?: string | null })
      | undefined;
    const deploys = result?.deploys;
    const intent = record.intent;
    if (intent.kind === "release" || intent.kind === "roll-back") {
      const tag = result?.tag ?? receipt.operationId;
      return { tag, deploys, rollout: { appId: intent.appId, cause: "release", ref: tag } };
    }
    const mergedSha = result?.mergedSha;
    return intent.kind === "merge-change" && typeof mergedSha === "string"
      ? { deploys, rollout: { appId: intent.link.appId, cause: "merge", ref: mergedSha } }
      : { deploys };
  },
};
