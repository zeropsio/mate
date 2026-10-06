/**
 * Whether a verb still waits on its operation, and whether its owner's link is reconnecting
 * meanwhile — what a control says while it stays off for a long wait. Over once the operation is
 * final for now or can no longer be followed (`operationEnd`), or the account holds no record of it.
 * No clock decides it.
 *
 * @module data/projections/operationWait
 */
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationEnd, organizationLink } from "./operationEnd.ts";

export type OperationWait =
  | { readonly kind: "ended" }
  | { readonly kind: "waiting"; readonly reconnecting: boolean };

/** Phases in which a link is getting back to its owner, not reading from it. */
const RECONNECTING: ReadonlySet<string> = new Set([
  "connecting",
  "recovering",
  "reauthenticating",
  "stale",
]);

export const operationWait: Projection<
  { readonly requestId: string; readonly orgId: string },
  OperationWait
> = {
  name: "operationWait",
  keyOf: ({ requestId, orgId }) => `${orgId}:${requestId}`,
  equals: sameValue,
  derive: (read, key) => {
    const record = read.operation(key.requestId);
    if (record === undefined || operationEnd.derive(read, key) !== null) return { kind: "ended" };
    // The owner that took it answers over its own link; before its answer, none is waited on.
    const link =
      record.receipt === null ? null : organizationLink(record.receipt.executor, key.orgId);
    return {
      kind: "waiting",
      reconnecting: link !== null && RECONNECTING.has(read.stream(link).phase),
    };
  },
};
