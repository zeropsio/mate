/**
 * Re-reads the inventory on a clock while a creation is on its way.
 *
 * A creation's container reaches the projects page through the pushed
 * inventory: the project turning ACTIVE, its `zcp` service with a public
 * origin. Only then does the row get an origin to probe and, once the probe
 * says ready, the wait that ends in the conversation. A push can be missed —
 * the owner's run of 2026-09-17: the card waited at "Almost there." on a Mate
 * that had answered minutes earlier, and a reload, which reads the inventory
 * afresh, found it at once. So while a creation is pending, or a wait is still
 * looking for its project or container, the inventory is re-read every
 * `CREATION_REFRESH_MS` as well: a handful of reads for the minutes a creation
 * takes, nothing once it has landed. A wait already probing a container by
 * HTTP needs no push and gets no clock — except `awaiting-settled`, which
 * still reads the service list (to catch a container only just turning
 * usable) and `hardening`, which reads nothing itself but keeps the
 * inventory current while the birth's one restart runs, for the health wait
 * that follows it.
 *
 * A wait's own cap running out (`overdue`, B-2) never changes its phase, so
 * it never falls out of this set either (H4): a `awaiting-container` wait
 * that outlasted its cap is still `awaiting-container`, still on this clock,
 * so a missed push still resumes it without anyone clicking "Keep waiting".
 */

import { useEffect } from "react";

import type { ProvisioningPhase } from "@t3tools/client-runtime/zerops/provisioning";

import { refreshZeropsCandidates } from "./candidatesRefresh";

export const CREATION_REFRESH_MS = 20_000;

/** Whether the inventory is to be re-read on a clock right now. */
export function creationRefreshWanted(input: {
  /** A project this browser created and has not connected to yet. */
  readonly creationPending: boolean;
  /** The phase of the wait in flight, if any. */
  readonly waitPhase: ProvisioningPhase | null;
}): boolean {
  return (
    input.creationPending ||
    input.waitPhase === "awaiting-project" ||
    input.waitPhase === "awaiting-container" ||
    input.waitPhase === "awaiting-settled" ||
    input.waitPhase === "hardening"
  );
}

/** Bumps the inventory every `CREATION_REFRESH_MS` for as long as `wanted`. */
export function useCreationInventoryRefresh(wanted: boolean): void {
  useEffect(() => {
    if (!wanted) return;
    const timer = window.setInterval(refreshZeropsCandidates, CREATION_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [wanted]);
}
