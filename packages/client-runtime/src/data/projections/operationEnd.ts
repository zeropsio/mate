/**
 * Where a verb waiting on its operation stops waiting: the operation's progress once it is final
 * for now — done, refused, not taken, uncertain with the person to ask again, unresolved — or
 * `unobserved` while an accepted one can no longer be followed because its organization's link
 * observes nothing (paused, refused, closed). `null` while it is still under way and followed.
 * The operation itself stands either way; only the wait ends. No clock decides it.
 *
 * @module data/projections/operationEnd
 */
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";

/** Phases in which a link observes nothing more until something outside it changes. */
export const UNOBSERVED_PHASES: ReadonlySet<string> = new Set([
  "paused",
  "refused",
  "unsupported",
  "closed",
]);

export type OperationEnd = OperationProgress | { readonly stage: "unobserved" } | null;

export const operationEnd: Projection<
  { readonly requestId: string; readonly orgId: string },
  OperationEnd
> = {
  name: "operationEnd",
  keyOf: ({ requestId, orgId }) => `${orgId}:${requestId}`,
  equals: sameValue,
  derive: (read, { requestId, orgId }) => {
    const progress = operationProgress.derive(read, requestId);
    switch (progress.stage) {
      case "unknown":
      case "submitting":
        return null;
      case "uncertain":
        return progress.next === "asking-owner" ? null : progress;
      case "accepted":
      case "reflected":
        return UNOBSERVED_PHASES.has(read.stream(linkKeys.zerops(orgId)).phase)
          ? { stage: "unobserved" }
          : null;
      default:
        return progress;
    }
  },
};
