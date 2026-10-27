/**
 * Whether to enter the provisioning wait on its own, right after sign-in —
 * for the two-hop registration flow, where the account signs in with nothing
 * connected yet but a pool-claimed project already on its way.
 *
 * Pure and separate from `ZeropsProjectsPage` so the decision is testable
 * without mounting anything.
 */

import { groupZeropsCandidates, type ZeropsCandidate } from "./candidates.ts";

/** True once sign-in has nothing usable yet, but a project is still on its way in. */
export function shouldAutoEnterProvisioning(candidates: ReadonlyArray<ZeropsCandidate>): boolean {
  const grouped = groupZeropsCandidates(candidates);
  return (
    grouped.connected.length === 0 && grouped.ready.length === 0 && grouped.provisioning.length > 0
  );
}

/**
 * Which provisioning candidate to follow when more than one project is still
 * on its way in — the one a claim just handed over.
 */
export function newestProvisioningCandidate(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ZeropsCandidate | undefined {
  const { provisioning } = groupZeropsCandidates(candidates);
  return [...provisioning].sort((left, right) =>
    (right.project.created ?? "").localeCompare(left.project.created ?? ""),
  )[0];
}
