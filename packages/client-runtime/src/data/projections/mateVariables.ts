/**
 * A Mate's container's two variables, as its own search last answered (`families/mateVariables`):
 * whether zcp serves Zerops Mate on it (`ZCP_MATE_ENABLED`, absent reads as off, the way zcp reads
 * it), and whether it carries the press's marker (`MATE_SETUP_RUNTIMES`). Neither is `false`
 * before an answer for this service: `unread` until one, `unknown` where the read failed or was
 * refused — off is a fact a row offers Enable on, and no marker lets a Mate connect.
 *
 * One import writes both keys on a press's container, so an answer that holds its flag and no
 * marker says the marker is not there. An answer that holds neither says so only of a container
 * made already: one the platform has only just been asked for (`NEW`) or is still making
 * (`CREATING`) may not have its variables yet, and is read again. One made and waiting for its
 * code (`READY_TO_DEPLOY`) has them, if a press imported it.
 *
 * @module data/projections/mateVariables
 */
import { mateVariablesScope } from "../families/mateVariables.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { sampledRead } from "./sampled.ts";

export interface MateVariables {
  readonly flag: boolean | "unread" | "unknown";
  readonly marker: boolean | "unread" | "unknown";
}

/** A service the platform has not finished making. */
const BEING_MADE: ReadonlySet<string> = new Set(["NEW", "CREATING"]);

const UNREAD: MateVariables = { flag: "unread", marker: "unread" };
const UNKNOWN: MateVariables = { flag: "unknown", marker: "unknown" };

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
    if (value.marker || value.flag !== null)
      return { flag: value.flag ?? false, marker: value.marker };
    const service = read.fact("service", serviceId);
    const beingMade = service.kind === "known" && BEING_MADE.has(service.value.status);
    return { flag: false, marker: beingMade ? "unread" : false };
  },
  equals: sameValue,
};
