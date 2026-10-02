/**
 * The doors' limit per client address: a token bucket of ten, refilled at ten a minute, for each
 * door and address (`api.ts` keys it so: a person's door, a Mate's, and git's credential misses do
 * not share one). The doors are unauthenticated, and what passes their first check costs HQ's own
 * credential reads; the limit keeps one address from spending them, or from guessing at git. The address is the L7 balancer's `X-Real-IP`. The
 * buckets live in memory: a restart forgets them.
 *
 * @module rateLimit
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class DoorRateLimit extends Context.Service<
  DoorRateLimit,
  /** Takes one token of `key`'s bucket; false when it has none left. */
  { readonly take: (key: string) => Effect.Effect<boolean> }
>()("@t3tools/hq/rateLimit/DoorRateLimit") {}

const CAPACITY = 10;
const PER_MINUTE = 10;
/** More addresses than this at once is a flood: the memory starts over rather than grows. */
const MAX_KEYS = 10_000;

export const doorRateLimitLayer = Layer.sync(DoorRateLimit, () => {
  const buckets = new Map<string, { readonly tokens: number; readonly at: number }>();
  return DoorRateLimit.of({
    take: (key) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const bucket = buckets.get(key) ?? { tokens: CAPACITY, at: now };
        const tokens = Math.min(
          CAPACITY,
          bucket.tokens + ((now - bucket.at) / 60_000) * PER_MINUTE,
        );
        if (buckets.size >= MAX_KEYS) buckets.clear();
        buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: now });
        return tokens >= 1;
      }),
  });
});
