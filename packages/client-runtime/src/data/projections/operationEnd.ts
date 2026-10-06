/**
 * Where a verb waiting on its operation stops waiting: the operation's progress once it is final
 * for now — done, refused, not taken, uncertain with the person to ask again, unresolved — or
 * `unobserved` while an accepted one can no longer be followed: its organization's link, or the
 * detail its handle is observed in, observes nothing (paused, refused, closed). `null` while it is still under way and followed.
 * The operation itself stands either way; only the wait ends. No clock decides it.
 *
 * @module data/projections/operationEnd
 */
import { detailScopeOf } from "../demand.ts";
import { linkKeys } from "../model.ts";
import { OPERATION_KINDS, operationKind } from "../operations/kinds.ts";
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
      case "reflected": {
        const record = read.operation(requestId);
        const kind =
          record === undefined ? undefined : operationKind(OPERATION_KINDS, record.intent);
        // Its end is read from its owner's link: HQ's for a write HQ executes, else Zerops's.
        const link = kind?.executor === "hq" ? linkKeys.hq(orgId) : linkKeys.zerops(orgId);
        if (UNOBSERVED_PHASES.has(read.stream(link).phase)) return { stage: "unobserved" };
        // The detail its handle is observed in, refused alone (its project gone) while the link
        // lives: no end will be read there either.
        const demand =
          record === undefined || record.receipt === null || kind === undefined
            ? null
            : (kind.observedIn?.(record.intent, record.receipt) ?? null);
        return demand !== null &&
          UNOBSERVED_PHASES.has(read.stream(detailScopeOf(orgId, demand)).phase)
          ? { stage: "unobserved" }
          : null;
      }
      default:
        return progress;
    }
  },
};
