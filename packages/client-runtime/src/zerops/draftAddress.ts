import type { ZeropsLease } from "@t3tools/contracts";

import { draftLook } from "./draftLook.ts";
import type { PoolPair } from "./servicePairs.ts";

/** A change of the Mate, as `draftLook` reads it. */
export interface DraftAddressChange {
  readonly state: "open" | "adding" | "merging" | "merged" | "closed";
  readonly mateGone: boolean;
  readonly branch: string | undefined;
  readonly repositoryUrl: string | undefined;
}

/**
 * Where a link to a draft's address goes: a Mate writes its draft's address (a pool container's
 * per-port subdomain) into its conversation and its work card, and that address dies when the
 * draft is added or dropped and its container goes back to the pool. So the address is never the
 * link's destination by itself:
 *
 * - `draft`: a copy of this Mate still serves it, and `draftLook` says it is that change's open
 *   draft: the link opens that draft.
 * - `app`: no copy of this Mate serves it any more: the draft it showed is no longer open, so the
 *   link opens the same page of Your app (the stage of the pool's part).
 * - `none`: no copy serves it and Your app has no address, or the Mate's copies are unread: the
 *   link opens nothing.
 *
 * Undefined for an address on none of the Mate's pools, and for one a copy of the Mate serves that
 * is no change's draft (its work before a change exists): the link stays as it is.
 */
export type DraftAddress<C> =
  | { readonly kind: "draft"; readonly change: C }
  | { readonly kind: "app"; readonly service: string; readonly url: string }
  | { readonly kind: "none" };

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

/** Pure: the Mate's pools, copies, changes and routes as read; nothing else. */
export function draftAddress<C extends DraftAddressChange>(input: {
  readonly url: string;
  /** The Mate's dev pools by hostname; every pool a lease is of is one too. */
  readonly pools: ReadonlyArray<string> | undefined;
  /** zcp's leases (the Mate's copies); undefined while unread. */
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  readonly poolPairs: ReadonlyArray<PoolPair> | undefined;
  /** The Mate's project's public routes. */
  readonly routes: ReadonlyArray<{ readonly service: string; readonly url: string }>;
  /** The Mate's open changes. */
  readonly changes: ReadonlyArray<C>;
}): DraftAddress<C> | undefined {
  const host = hostOf(input.url);
  if (host === undefined) return undefined;
  const label = host.split(".")[0]!;
  const pool = [...(input.pools ?? []), ...(input.leases ?? []).map((lease) => lease.pool)]
    .filter((name) => label.startsWith(`${name.toLowerCase()}-`))
    .sort((left, right) => right.length - left.length)[0];
  if (pool === undefined) return undefined;
  if (input.leases === undefined) return { kind: "none" };
  const ofPool = input.leases.filter((lease) => lease.pool === pool);
  const serving = ofPool.find((lease) =>
    (lease.devServers ?? []).some(
      (server) => server.url !== undefined && hostOf(server.url) === host,
    ),
  );
  if (serving !== undefined) {
    const change = input.changes.find((candidate) => {
      const look = draftLook({
        ...candidate,
        leases: [serving],
        classic: null,
        repositoryRemote: undefined,
      });
      return (
        look.kind === "openable" && look.copy.kind === "lease" && look.copy.alias === serving.alias
      );
    });
    return change === undefined ? undefined : { kind: "draft", change };
  }
  // A copy whose servers were not read may be the one: nothing is said for it.
  if (ofPool.some((lease) => lease.devServers === undefined)) return { kind: "none" };
  const stage = input.poolPairs?.find((pair) => pair.pool === pool)?.stages[0]?.hostname;
  const route = input.routes.find((candidate) => candidate.service === stage);
  if (stage === undefined || route === undefined || !URL.canParse(route.url))
    return { kind: "none" };
  const was = new URL(input.url);
  const app = new URL(`${was.pathname}${was.search}${was.hash}`, route.url);
  return { kind: "app", service: stage, url: app.href };
}
