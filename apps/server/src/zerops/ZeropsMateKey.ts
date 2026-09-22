/**
 * ZeropsMateKey — where this Mate's own Zerops key comes from, re-read live.
 *
 * `ZeropsEnvironment.apiToken` is a boot snapshot: `cli/config.ts` reads
 * `ZCP_API_KEY` once, at process start. The client's hardening step moves that
 * key from a project variable onto the `zcp` service (spec-mate.md §2 root
 * cause 4) and the platform's live env store,
 * `/etc/zerops-zembed/env.json` (confirmed format:
 * `../zcp/internal/mate/mate.go:113-125`, a root-owned, world-readable flat
 * JSON object of string → string the platform rewrites ~2s after a service
 * env change, no restart — `LoadLiveEnvStorePath`), reflects the move within
 * seconds. A Mate that only ever reads its boot snapshot keeps answering with
 * the value that was true when it started, which is why today the only fix is
 * a container restart (root cause 4, B-5).
 *
 * There is no second on-disk fallback file for this key: `zcp init`'s own
 * `mate.env` (`../zcp/internal/mate/mate.go` `EnvFilePath`) carries only the
 * non-secret `T3CODE_ZEROPS_*` identifiers — "Only non-secret identifiers
 * ever go in — never a token" (`mate.go:95-97`) — so `ZCP_API_KEY` is never
 * written there. The precedence is therefore two-level, not three: the live
 * store, then the boot snapshot.
 *
 * A `ZeropsMateKeyReader` is cheap to construct (`make`) and safe to share:
 * its cache is a `Ref`, so every own-key read in this process — the door, the
 * membership watch, the signers gate — can be handed the SAME reader and see
 * the same key, invalidated together.
 *
 * @module ZeropsMateKey
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

/** Which of the two sources a resolved key most recently came from. */
export type ZeropsMateKeySource = "store" | "snapshot";

/** The container's live service-environment snapshot (`mate.go:125`). */
export const MATE_LIVE_ENV_STORE_PATH = "/etc/zerops-zembed/env.json";

/** The env store key this Mate's own key is published under. */
const MATE_KEY_STORE_FIELD = "ZCP_API_KEY";

/** How long a resolved key is served from cache before the store is re-read. */
export const MATE_KEY_CACHE_TTL = Duration.seconds(10);

/**
 * Reads `ZCP_API_KEY` out of a parsed env-store document. `undefined` for
 * anything that is not a flat object, or where the field is missing, not a
 * string, or blank — never a thrown error, so a caller can treat "no key
 * here" and "not a store at all" alike.
 */
export const extractApiKeyFromStore = (parsed: unknown): string | undefined => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const value = (parsed as Record<string, unknown>)[MATE_KEY_STORE_FIELD];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * Resolves the key precedence for one snapshot in time, given whether the
 * store could be read at all:
 *
 * - store read and carried a key → that key (and it becomes the new
 *   `lastGoodStoreKey`).
 * - store read but carried no key → the boot snapshot (a store that simply
 *   does not have the field is not a failure to keep the old value over).
 * - store unreadable (missing, malformed, not an object) → the last
 *   store-sourced key this reader has ever seen, else the boot snapshot.
 */
export const resolveMateKey = (input: {
  readonly storeRead: Result.Result<string | undefined, unknown>;
  readonly lastGoodStoreKey: string | undefined;
  readonly snapshot: string | undefined;
}): {
  readonly key: string | undefined;
  readonly lastGoodStoreKey: string | undefined;
  readonly source: ZeropsMateKeySource | undefined;
} => {
  if (Result.isSuccess(input.storeRead)) {
    const key = input.storeRead.success;
    if (key !== undefined) return { key, lastGoodStoreKey: key, source: "store" };
    return {
      key: input.snapshot,
      lastGoodStoreKey: input.lastGoodStoreKey,
      source: input.snapshot !== undefined ? "snapshot" : undefined,
    };
  }
  // Unreadable store: a key this reader has already vouched for beats
  // falling to the (possibly stale-project) boot snapshot, and is still
  // reported as store-sourced — it came from the store, just not this read.
  if (input.lastGoodStoreKey !== undefined) {
    return {
      key: input.lastGoodStoreKey,
      lastGoodStoreKey: input.lastGoodStoreKey,
      source: "store",
    };
  }
  return {
    key: input.snapshot,
    lastGoodStoreKey: input.lastGoodStoreKey,
    source: input.snapshot !== undefined ? "snapshot" : undefined,
  };
};

export interface ZeropsMateKeyReader {
  /**
   * The key to use for the Mate's own reads right now — from cache when the
   * last resolve is still within {@link MATE_KEY_CACHE_TTL}, freshly resolved
   * otherwise. Never logged; never appears in a span or an error payload.
   */
  readonly read: Effect.Effect<string | undefined>;
  /** Which source the key {@link read} would answer right now came from. */
  readonly lastSource: Effect.Effect<ZeropsMateKeySource | undefined>;
  /** Forces the next {@link read} to re-resolve regardless of cache age. */
  readonly invalidate: Effect.Effect<void>;
}

interface CacheEntry {
  readonly key: string | undefined;
  readonly source: ZeropsMateKeySource | undefined;
  readonly readAtMs: number;
}

/**
 * Builds a reader over a real (or test) filesystem. `snapshot` is the boot
 * value (`ZeropsEnvironment.apiToken`) to fall back to; `storePath` defaults
 * to {@link MATE_LIVE_ENV_STORE_PATH}.
 */
export const make = (input: {
  readonly fs: FileSystem.FileSystem;
  readonly snapshot: string | undefined;
  readonly storePath?: string;
  readonly ttl?: Duration.Duration;
}): Effect.Effect<ZeropsMateKeyReader> =>
  Effect.gen(function* () {
    const storePath = input.storePath ?? MATE_LIVE_ENV_STORE_PATH;
    const ttlMs = Duration.toMillis(input.ttl ?? MATE_KEY_CACHE_TTL);
    const cache = yield* Ref.make<CacheEntry | undefined>(undefined);
    const lastGoodStoreKey = yield* Ref.make<string | undefined>(undefined);

    const readStoreResult = input.fs
      .readFileString(storePath)
      .pipe(Effect.flatMap(decodeUnknownJson), Effect.map(extractApiKeyFromStore), Effect.result);

    const resolveNow = Effect.gen(function* () {
      const storeRead = yield* readStoreResult;
      const lastGood = yield* Ref.get(lastGoodStoreKey);
      const resolved = resolveMateKey({
        storeRead,
        lastGoodStoreKey: lastGood,
        snapshot: input.snapshot,
      });
      if (resolved.lastGoodStoreKey !== lastGood) {
        yield* Ref.set(lastGoodStoreKey, resolved.lastGoodStoreKey);
      }
      const now = yield* Clock.currentTimeMillis;
      yield* Ref.set(cache, { key: resolved.key, source: resolved.source, readAtMs: now });
      return resolved.key;
    });

    const currentOrResolve = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = yield* Ref.get(cache);
      if (cached !== undefined && now - cached.readAtMs < ttlMs) {
        return cached;
      }
      yield* resolveNow;
      return (yield* Ref.get(cache))!;
    });

    const read = currentOrResolve.pipe(Effect.map((entry) => entry.key));
    const lastSource = currentOrResolve.pipe(Effect.map((entry) => entry.source));

    const invalidate = Ref.set(cache, undefined);

    return { read, lastSource, invalidate };
  });

/**
 * A reader with no live store of its own: `read` always answers `snapshot`,
 * `lastSource` always answers `"snapshot"` (or `undefined` for no key at
 * all), and `invalidate` is a no-op. Used explicitly where there is no live
 * platform to read from — fixtures mode — never as a hidden default for a
 * production consumer.
 */
export const snapshotOnlyReader = (snapshot: string | undefined): ZeropsMateKeyReader => ({
  read: Effect.succeed(snapshot),
  lastSource: Effect.succeed(snapshot !== undefined ? "snapshot" : undefined),
  invalidate: Effect.void,
});

/**
 * Runs one own-key request, and on `401`/`403` invalidates the reader,
 * re-resolves, and retries exactly once with the new key — never more than
 * once, so a key that is simply wrong does not loop. `token: undefined`
 * (nothing to try) short-circuits without calling `request`.
 */
export const requestWithMateKey = <A extends { readonly status: number }, E, R>(
  reader: ZeropsMateKeyReader,
  request: (token: string) => Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly token: string | undefined; readonly response: A | undefined }, E, R> =>
  Effect.gen(function* () {
    const token1 = yield* reader.read;
    if (token1 === undefined) return { token: undefined, response: undefined };

    const response1 = yield* request(token1);
    if (response1.status !== 401 && response1.status !== 403) {
      return { token: token1, response: response1 };
    }

    yield* reader.invalidate;
    const token2 = yield* reader.read;
    if (token2 === undefined || token2 === token1) {
      return { token: token1, response: response1 };
    }

    const response2 = yield* request(token2);
    return { token: token2, response: response2 };
  });

/**
 * The process-wide reader every own-key consumer shares: the door, the
 * membership watch and the signers gate all pull this one Tag, so a key
 * rotated once is picked up once, and its cache and invalidation are shared
 * rather than duplicated per consumer.
 */
export class ZeropsMateKey extends Context.Service<ZeropsMateKey, ZeropsMateKeyReader>()(
  "t3/zerops/ZeropsMateKey",
) {}

/**
 * Built once from this container's own config and filesystem. Live only:
 * fixtures mode provides {@link snapshotOnlyReader} directly instead of this
 * layer, since there is no platform underneath it to read a store from.
 */
export const layer = Layer.effect(
  ZeropsMateKey,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    return ZeropsMateKey.of(yield* make({ fs, snapshot: config.zerops?.apiToken }));
  }),
);
