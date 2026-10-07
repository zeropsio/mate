/**
 * The enable flag as the container's sampled read last answered: unknown before a successful
 * answer, and off when the source proves the key absent, as zcp reads it.
 *
 * @module data/projections/mateVariables
 */
import { mateVariablesScope } from "../families/mateVariables.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { sampledRead } from "./sampled.ts";

export interface MateVariables {
  readonly flag: boolean | "unread" | "unknown";
}

const UNREAD: MateVariables = { flag: "unread" };
const UNKNOWN: MateVariables = { flag: "unknown" };

export const mateVariables: Projection<
  { readonly orgId: string; readonly serviceId: string },
  MateVariables
> = {
  name: "mateVariables",
  keyOf: ({ orgId, serviceId }) => `${orgId}/${serviceId}`,
  derive: (read, { orgId, serviceId }) => {
    const { value, status } = sampledRead(
      read,
      "mateVariables",
      mateVariablesScope(orgId, serviceId),
      serviceId,
    );
    if (value === undefined) return status === "failed" ? UNKNOWN : UNREAD;
    return { flag: value.flag ?? false };
  },
  equals: sameValue,
};
