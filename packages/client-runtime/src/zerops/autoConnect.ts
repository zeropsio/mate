/**
 * Which containers the client should register on its own.
 *
 * The roster wants to say what every agent is doing, and the only source that
 * knows is the environment's own mate server: the client already keeps a live
 * connection to every environment it has registered and reads thread status
 * from all of them. What stops a row from lighting up is only that nobody has
 * clicked Connect on it yet. So the client connects for them — once the
 * container has answered the health probe, so a sleeping or half-installed
 * container is never woken or hammered on the user's behalf.
 *
 * Pure: the decision is testable without a network, and the hook that acts on
 * it owns nothing but the attempt set.
 *
 * @module autoConnect
 */

import type { EnvironmentConnectionPresentation } from "../connection/presentation.ts";
import type { ZeropsCandidate } from "./candidates.ts";
import type { ZeropsContainerHealth } from "./provisioning.ts";

/**
 * Every registration is a live socket and a credential to renew, so an
 * account with many environments is registered up to here on its own and by
 * hand beyond it — the roster still lists the rest, it just cannot say what
 * they are doing until someone connects them.
 */
export const ZEROPS_AUTO_CONNECT_LIMIT = 12;

export interface AutoConnectCandidate extends ZeropsCandidate {
  /** Present once the environment is registered, whatever its socket is doing. */
  readonly connection?: EnvironmentConnectionPresentation;
}

export interface AutoConnectTarget {
  readonly key: string;
  readonly containerOrigin: string;
  readonly projectId: string;
  readonly clientId: string | undefined;
}

export function selectAutoConnectTargets(input: {
  readonly candidates: ReadonlyArray<AutoConnectCandidate>;
  /** What each container answered, by candidate key; absent = still asking. */
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  /** Origins this session already tried, successfully or not. */
  readonly attempted: ReadonlySet<string>;
  /**
   * Projects a birth is watching (the page's own provisioning wait, or a
   * hand-off this browser wrote — `creationHandoffStorage.ts`). Skipped here
   * so exactly one connector runs on a birth: the page's own, which schedules
   * a retry, sets a `connectError`, and lands the person in the conversation
   * on success. This connector never navigates by design; racing it against
   * the birth's own connect either wastes an attempt or, worse, spends the
   * hand-off out from under a card still waiting for it.
   */
  readonly birthProjectIds?: ReadonlySet<string>;
  readonly limit?: number;
}): ReadonlyArray<AutoConnectTarget> {
  const limit = input.limit ?? ZEROPS_AUTO_CONNECT_LIMIT;
  const birthProjectIds = input.birthProjectIds ?? new Set<string>();

  // Registered environments count against the ceiling whether or not their
  // socket is up right now; a reconnecting one is still one of ours.
  const registered = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidate.environmentId !== undefined || candidate.connection !== undefined) {
      registered.add(candidate.project.id);
    }
  }

  const targets: Array<AutoConnectTarget> = [];
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (registered.size + targets.length >= limit) break;
    const origin = candidate.containerOrigin;
    if (origin === undefined) continue;
    if (candidate.group !== "ready") continue;
    if (candidate.connection !== undefined || candidate.environmentId !== undefined) continue;
    if (input.health.get(candidate.key) !== "ready") continue;
    if (input.attempted.has(origin) || seen.has(origin)) continue;
    if (birthProjectIds.has(candidate.project.id)) continue;
    seen.add(origin);
    targets.push({
      key: candidate.key,
      containerOrigin: origin,
      projectId: candidate.project.id,
      clientId: candidate.project.clientId,
    });
  }
  return targets;
}
