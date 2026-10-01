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
 * Pure: the decision is testable without a network. What it selects is demand
 * on the exchange driver (`environments/exchangeDriver.ts`): each target's own
 * machine decides when an exchange runs, retries it with backoff, and waits
 * for an input change after a refusal — nothing here remembers an attempt.
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

/** The candidate keys auto-connect wants, in the roster's order. */
export function selectAutoConnectTargets(input: {
  readonly candidates: ReadonlyArray<AutoConnectCandidate>;
  /** What each container answered, by candidate key; absent = still asking. */
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly limit?: number;
  /**
   * The project whose Mate is on screen: wanted first, and past the ceiling, which is for Mates
   * not on screen — a page never waits on a connect the ceiling holds back.
   */
  readonly onScreenProjectId?: string | null;
}): ReadonlyArray<string> {
  const limit = input.limit ?? ZEROPS_AUTO_CONNECT_LIMIT;

  // Registered environments count against the ceiling whether or not their
  // socket is up right now; a reconnecting one is still one of ours.
  const registered = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidate.environmentId !== undefined || candidate.connection !== undefined) {
      registered.add(candidate.project.id);
    }
  }

  const targets: Array<string> = [];
  const seen = new Set<string>();
  const wanted = (candidate: AutoConnectCandidate): string | null => {
    const origin = candidate.containerOrigin;
    if (origin === undefined) return null;
    if (candidate.group !== "ready") return null;
    if (candidate.connection !== undefined || candidate.environmentId !== undefined) return null;
    if (input.health.get(candidate.key) !== "ready") return null;
    if (seen.has(origin)) return null;
    return origin;
  };
  const onScreen = input.onScreenProjectId ?? null;
  for (const candidate of input.candidates) {
    if (onScreen === null || candidate.project.id !== onScreen) continue;
    const origin = wanted(candidate);
    if (origin === null) continue;
    seen.add(origin);
    targets.push(candidate.key);
  }
  // The ceiling counts the Mate on screen too: it is one of ours like any other.
  for (const candidate of input.candidates) {
    if (registered.size + targets.length >= limit) break;
    const origin = wanted(candidate);
    if (origin === null) continue;
    seen.add(origin);
    targets.push(candidate.key);
  }
  return targets;
}
