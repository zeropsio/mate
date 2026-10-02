/**
 * What a Mate's pushes say changed on the platform, as invalidations (DESIGN §6.1, §6.2): the
 * deployment facts a push made old, never the facts themselves.
 *
 * | Push | Change | Invalidates |
 * |---|---|---|
 * | zcp lifecycle envelope | a new successful `workSession.deploys[host]` attempt | `deployment` of that service |
 *
 * A push compares with the one before it on the same feed; the first a feed hears has nothing to
 * compare with and invalidates nothing — whatever it would change is read on demand anyway.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module flow/envelopeInvalidations
 */
import type { ZeropsAttemptInfo, ZeropsStateEnvelope } from "@t3tools/contracts";

import type { ServiceRef } from "../data/types.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";

export interface EnvelopeServices {
  /** The service the account holds under that hostname in that project; `null` when it holds none. */
  readonly serviceOf: (projectId: string, hostname: string) => ServiceRef | null;
}

/** Every successful attempt's time, per hostname. */
function successes(envelope: ZeropsStateEnvelope): ReadonlyMap<string, ReadonlySet<string>> {
  const deploys: Readonly<Record<string, ReadonlyArray<ZeropsAttemptInfo>>> =
    envelope.workSession?.deploys ?? {};
  return new Map(
    Object.entries(deploys).map(([hostname, attempts]) => [
      hostname,
      new Set(attempts.filter((attempt) => attempt.success).map((attempt) => attempt.at)),
    ]),
  );
}

export function envelopeInvalidations(
  previous: ZeropsStateEnvelope | undefined,
  next: ZeropsStateEnvelope | undefined,
  services: EnvelopeServices,
): ReadonlyArray<Invalidation> {
  if (previous === undefined || next === undefined) return [];
  const invalidations: Array<Invalidation> = [];
  const deployedBefore = successes(previous);
  for (const [hostname, attempts] of successes(next)) {
    const heard = deployedBefore.get(hostname);
    if (![...attempts].some((at) => heard?.has(at) !== true)) continue;
    const ref = services.serviceOf(next.project.id, hostname);
    if (ref !== null) invalidations.push({ topic: "deployment", service: ref });
  }
  return invalidations;
}
