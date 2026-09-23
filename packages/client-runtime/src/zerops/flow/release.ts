/**
 * The release offer over the flow's two halves (DESIGN §4.7): offered only
 * when both are read. Without the forge half the suggested tag could be one
 * that exists; without the deploy half, what production runs is a guess.
 *
 * @module flow/release
 */
import type { ReleaseGate } from "../release.ts";

export const CHECKING_RELEASE = "Checking what can be released…";

export function flowReleaseGate(
  gate: ReleaseGate,
  halves: { readonly deploys: boolean; readonly forge: boolean },
): ReleaseGate {
  return halves.deploys && halves.forge ? gate : { allowed: false, reason: CHECKING_RELEASE };
}
