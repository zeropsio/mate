/**
 * What a Mate's pushes say changed in Gitea or on the platform, as invalidations (DESIGN §6.1,
 * §6.2): the forge and deployment facts a push made old, never the facts themselves.
 *
 * | Push | Change | Invalidates |
 * |---|---|---|
 * | zcp lifecycle envelope | a service's `gitPushState` changed | `forge-repo` of its `remoteUrl` |
 * | zcp lifecycle envelope | a new successful `workSession.deploys[host]` attempt | `deployment` of that service |
 * | the Git tab's VCS status | commits left the checkout for its remote, or it gained its upstream | `forge-repo` of the checkout |
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
import type { GitCheckoutState } from "../gitTab.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";

/** A repository on one Gitea, as a forge fact is keyed. */
export interface ForgeRepository {
  readonly origin: string;
  readonly owner: string;
  readonly repo: string;
}

export interface EnvelopeServices {
  /** The service the account holds under that hostname in that project; `null` when it holds none. */
  readonly serviceOf: (projectId: string, hostname: string) => ServiceRef | null;
}

/**
 * The Gitea repository an `http(s)` remote names: its origin, its owner and its name, without
 * credentials or `.git`. Any other remote names none.
 */
export function forgeRepositoryOf(remoteUrl: string): ForgeRepository | null {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const [owner, repo, ...rest] = url.pathname.split("/").filter((part) => part !== "");
  if (owner === undefined || repo === undefined || rest.length > 0) return null;
  return { origin: url.origin, owner, repo: repo.replace(/\.git$/u, "") };
}

const repositoryInvalidation = (repository: ForgeRepository): Invalidation => ({
  topic: "forge-repo",
  ...repository,
});

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
  const pushStateBefore = new Map(
    previous.services.map((service) => [service.hostname, service.gitPushState]),
  );
  for (const service of next.services) {
    if (service.gitPushState === pushStateBefore.get(service.hostname)) continue;
    const repository =
      service.remoteUrl === undefined ? null : forgeRepositoryOf(service.remoteUrl);
    if (repository !== null) invalidations.push(repositoryInvalidation(repository));
  }
  const deployedBefore = successes(previous);
  for (const [hostname, attempts] of successes(next)) {
    const heard = deployedBefore.get(hostname);
    if (![...attempts].some((at) => heard?.has(at) !== true)) continue;
    const ref = services.serviceOf(next.project.id, hostname);
    if (ref !== null) invalidations.push({ topic: "deployment", service: ref });
  }
  return invalidations;
}

export function checkoutInvalidations(
  previous: GitCheckoutState | undefined,
  next: GitCheckoutState,
  repository: ForgeRepository | null,
): ReadonlyArray<Invalidation> {
  if (previous === undefined || repository === null) return [];
  const pushed =
    next.aheadCount < previous.aheadCount || (next.hasUpstream && !previous.hasUpstream);
  return pushed ? [repositoryInvalidation(repository)] : [];
}
