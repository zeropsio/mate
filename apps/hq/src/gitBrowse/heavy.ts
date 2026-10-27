/**
 * The Git browser's heavy reads — content search, blame, archive — share one allowance: four at
 * once per HQ, two per person, and an archive only while the person runs no other. A read past it is answered busy at once, never queued, so the
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
    /**
     * Takes one of HQ's allowance and one of the person's, while the person runs fewer than
     * `perPerson`, until the answered release runs (again, it does nothing); busy otherwise.
     * For a read that goes on past its answer, as a streamed archive does.
     */
    readonly hold: (userId: string, perPerson: number) => Effect.Effect<() => void, BrowseBusy>;
  }
>()("@t3tools/hq/gitBrowse/heavy/BrowseHeavy") {}

export const browseHeavyLayer = Layer.sync(BrowseHeavy, () => {
  let running = 0;
  const byPerson = new Map<string, number>();
  const hold = (userId: string, perPerson: number) =>
    Effect.suspend(() => {
      if (running >= HEAVY_PER_HQ) return Effect.fail(new BrowseBusy({ limit: "hq" }));
      const mine = byPerson.get(userId) ?? 0;
      if (mine >= perPerson) return Effect.fail(new BrowseBusy({ limit: "person" }));
      running++;
      byPerson.set(userId, mine + 1);
      let held = true;
      return Effect.succeed(() => {
        if (!held) return;
        held = false;
        running--;
        const left = (byPerson.get(userId) ?? 1) - 1;
        if (left === 0) byPerson.delete(userId);
        else byPerson.set(userId, left);
      });
    });
  return {
    run: (userId, read) =>
      Effect.acquireUseRelease(
        hold(userId, HEAVY_PER_PERSON),
        () => read,
        (give) => Effect.sync(give),
      ),
    hold,
  };
});
