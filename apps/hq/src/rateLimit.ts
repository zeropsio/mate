/**
 * The doors' limits: token buckets in memory, a restart forgets them.
 *
 * - Per client address, at each door (`api.ts` keys it so: a person's door, a Mate's, and git's
 *   credential misses do not share one), before anything costs a Zerops read. The address is the
 *   L7 balancer's `X-Real-IP`. A Mate's and git's doors take ten at once, ten a minute. A person's
 *   door takes 120 at once, then one a second: a whole office behind one NAT is one address
 *   (t12, 2026-10-03: multiple clients, from one address, were answered 429 at ten a minute).
 * - Per Chief credential at its proxy (`chief.ts`): 120 at once, two a second — an agent's look at
 *   the whole org is a few dozen reads in a burst; a credential missed there takes from its
 *   address's bucket, as git's misses do.
 * - Per person a person's door names, once the presented throwaway was read and judged on its own
 *   (`door.ts`) and before HQ reads its org: twenty at once, twenty a minute. One person's flood of
 *   throwaways stops at them, never at their colleagues behind the same address.
 * - Per signed-in person at the Git browser's reads (`gitBrowse/routes.ts`), never the address's
 *   door bucket, so browsing never costs anyone behind that address their sign-in: 600 at once,
 *   five a second. A page holds a handful of reads, a tree walk one per folder or file opened and
 *   the ref picker one per filter or page; five a second is past any hand's pace, while a script
 *   paging a whole repository spawns at most that much git.
 *
 * @module rateLimit
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** A bucket: how many at once, and how many it refills a minute. */
export interface DoorLimit {
  readonly capacity: number;
  readonly perMinute: number;
}

/** A Mate's door, and git's credential misses, per address. */
export const DOOR_LIMIT: DoorLimit = { capacity: 10, perMinute: 10 };
/** A person's door, per address: an office behind one NAT. */
export const PERSON_ADDRESS_LIMIT: DoorLimit = { capacity: 120, perMinute: 60 };
/** A person's door, per person its throwaway names. */
export const PERSON_LIMIT: DoorLimit = { capacity: 20, perMinute: 20 };

/** A person's Git browse reads, per person. */
export const BROWSE_LIMIT: DoorLimit = { capacity: 600, perMinute: 300 };

/** GitHub's deliveries to an intake's webhook, per address: a busy repository's burst of issues. */
export const INTAKE_LIMIT: DoorLimit = { capacity: 120, perMinute: 120 };

/** A Chief's reads through HQ's proxy, per credential. */
export const CHIEF_LIMIT: DoorLimit = { capacity: 120, perMinute: 120 };

/** A door's bucket is empty: `429 too_many_requests`. */
export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()("TooManyRequests", {}) {}

export class DoorRateLimit extends Context.Service<
  DoorRateLimit,
  /** Takes one token of `key`'s bucket of `limit`, ten and ten unless given; false when empty. */
  { readonly take: (key: string, limit?: DoorLimit) => Effect.Effect<boolean> }
>()("@t3tools/hq/rateLimit/DoorRateLimit") {}

/** More keys than this at once is a flood: the memory starts over rather than grows. */
const MAX_KEYS = 10_000;

export const doorRateLimitLayer = Layer.sync(DoorRateLimit, () => {
  const buckets = new Map<string, { readonly tokens: number; readonly at: number }>();
  return DoorRateLimit.of({
    take: (key, limit = DOOR_LIMIT) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const bucket = buckets.get(key) ?? { tokens: limit.capacity, at: now };
        const tokens = Math.min(
          limit.capacity,
          bucket.tokens + ((now - bucket.at) / 60_000) * limit.perMinute,
        );
        if (buckets.size >= MAX_KEYS) buckets.clear();
        buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: now });
        return tokens >= 1;
      }),
  });
});
