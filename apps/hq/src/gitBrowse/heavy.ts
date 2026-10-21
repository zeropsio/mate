/**
 * The Git browser's heavy reads — content search, blame, archive — share one allowance: four at
 * once per HQ, two per person. A read past it is answered busy at once, never queued, so the
 * person asks again rather than waiting on reads nobody watches any more.
 *
 * @module gitBrowse/heavy
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/** Heavy reads running at once on one HQ. */
export const HEAVY_PER_HQ = 4;
/** Heavy reads one person runs at once. */
export const HEAVY_PER_PERSON = 2;

/** HQ runs as many heavy reads as it takes: ask again in a moment. */
export class BrowseBusy extends Schema.TaggedError<BrowseBusy>()("BrowseBusy", {
  /** Whose allowance is full. */
  limit: Schema.Literals(["hq", "person"]),
}) {}

export class BrowseHeavy extends Context.Service<
  BrowseHeavy,
  {
    /** Runs `read` within HQ's and the person's allowance, or fails busy without running it. */
    readonly run: <A, E, R>(
      userId: string,
      read: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | BrowseBusy, R>;
  }
>()("@t3tools/hq/gitBrowse/heavy/BrowseHeavy") {}

export const browseHeavyLayer = Layer.sync(BrowseHeavy, () => {
  let running = 0;
  const byPerson = new Map<string, number>();
  const take = (userId: string) =>
    Effect.suspend(() => {
      if (running >= HEAVY_PER_HQ) return Effect.fail(new BrowseBusy({ limit: "hq" }));
      const mine = byPerson.get(userId) ?? 0;
      if (mine >= HEAVY_PER_PERSON) return Effect.fail(new BrowseBusy({ limit: "person" }));
      running++;
      byPerson.set(userId, mine + 1);
      return Effect.void;
    });
  const give = (userId: string) =>
    Effect.sync(() => {
      running--;
      const mine = (byPerson.get(userId) ?? 1) - 1;
      if (mine === 0) byPerson.delete(userId);
      else byPerson.set(userId, mine);
    });
  return {
    run: (userId, read) =>
      Effect.acquireUseRelease(
        take(userId),
        () => read,
        () => give(userId),
      ),
  };
});
