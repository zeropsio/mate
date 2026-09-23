/**
 * The release offer over the flow's two halves (DESIGN §4.7): offered only
 * when both are read. Without the forge half the suggested tag could be one
 * that exists; without the deploy half, what production runs is a guess. A
 * half whose read failed says why, rather than checking for ever.
 *
 * @module flow/release
 */
import type { ReleaseGate } from "../release.ts";

export const CHECKING_RELEASE = "Checking what can be released…";

/** Where one half of a group's flow stands. */
export type FlowHalf = "read" | "unread" | { readonly failed: string };

export function flowReleaseGate(
  gate: ReleaseGate,
  halves: { readonly deploys: FlowHalf; readonly forge: FlowHalf },
): ReleaseGate {
  for (const half of [halves.deploys, halves.forge])
    if (typeof half === "object")
      return {
        allowed: false,
        reason: `Can't check what can be released: ${half.failed.replace(/\.+$/u, "")}.`,
      };
  return halves.deploys === "read" && halves.forge === "read"
    ? gate
    : { allowed: false, reason: CHECKING_RELEASE };
}
