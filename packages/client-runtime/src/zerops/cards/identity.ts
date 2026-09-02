import type { ZeropsActivityResult } from "../activityResult.ts";
import { readZeropsCardSource } from "./decode.ts";
import { decodeZeropsCard } from "./payloads.ts";

export interface ZeropsCardIdentityEntry {
  readonly zeropsResult?: ZeropsActivityResult;
  readonly toolLifecycleStatus?: string;
}

const identityByEntry = new WeakMap<ZeropsCardIdentityEntry, string | undefined>();

/**
 * The merge key for "one card per lifecycle object" in the timeline.
 *
 * A `zerops_workflow` bootstrap call is one step of a longer server-side
 * session (`sessionId`), and every call that advances it should update a
 * single card rather than add a new one. This returns that merge key for a
 * decodable `plan` card that carries a session id, and undefined for every
 * other card — including an undecodable / pending / failed entry, and a
 * decodable card whose payload has no such stable server-side id. Only a
 * card with one gets folded; everything else stays its own, one-off card.
 */
export function zeropsCardIdentity(
  entry: ZeropsCardIdentityEntry | null | undefined,
): string | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  if (identityByEntry.has(entry)) {
    return identityByEntry.get(entry);
  }

  const card = decodeZeropsCard(
    readZeropsCardSource(entry.zeropsResult, {
      failed: entry.toolLifecycleStatus === "failed",
    }),
  );
  const identity =
    card !== undefined && card.kind === "plan" && card.sessionId !== undefined
      ? `plan:${card.sessionId}`
      : undefined;
  identityByEntry.set(entry, identity);
  return identity;
}
