/** Surface bindings hold demand and read projections; they own neither transport nor remote values. */
import { AsyncResult, Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";
import * as Cause from "effect/Cause";
import type { AccountStore } from "./store.ts";
import { mateFeed } from "./projections/mateFeeds.ts";
import type { makeMateFeeds } from "./adapters/mateFeeds.ts";
import type { MateFeedFamily, MateFeedKey, MateFeedValues } from "./families/mateFeeds.ts";
import type { Known } from "../zerops/knowledge/index.ts";
export interface MateFeedReads {
  readonly data: AccountStore["data"];
  readonly hold: ReturnType<typeof makeMateFeeds>["hold"];
  readonly revalidate: ReturnType<typeof makeMateFeeds>["revalidate"];
  readonly onClose: ReturnType<typeof makeMateFeeds>["onClose"];
  readonly retry: ReturnType<typeof makeMateFeeds>["retry"];
}
export const mateFeedReadsAtom = Atom.make<MateFeedReads | null>(null).pipe(Atom.keepAlive);
export function mateFeedAtom<F extends MateFeedFamily>(key: MateFeedKey<F>) {
  const demand = Atom.make((get) => {
    const host = get(mateFeedReadsAtom);
    if (host !== null) get.addFinalizer(host.hold(key));
    return host;
  });
  return Atom.make((get): Known<MateFeedValues[F]> => {
    const host = get(demand);
    if (host === null) return { state: "unread", waitingFor: "mate-session" };
    return get(host.data.project(mateFeed(key.family), key));
  });
}
export function mateFeedAsyncAtom<F extends MateFeedFamily>(key: MateFeedKey<F>) {
  const source = mateFeedAtom(key);
  return Atom.make((get): AsyncResult.AsyncResult<MateFeedValues[F], unknown> => {
    const read = get(source);
    switch (read.state) {
      case "known":
        return AsyncResult.success(read.value, {
          waiting: read.freshness.kind === "revalidating" || read.freshness.kind === "stale",
        });
      case "failed":
        return AsyncResult.failure(Cause.fail(read.failure));
      default:
        return AsyncResult.initial(true);
    }
  });
}

export class MateFeedReadFailed extends Schema.TaggedError<MateFeedReadFailed>()(
  "MateFeedReadFailed",
  { message: Schema.String },
) {}
/** Reads through the same demanded family. Refusals remain final until explicit retry. */
export function readMateFeed<F extends MateFeedFamily>(
  registry: AtomRegistry.AtomRegistry,
  key: MateFeedKey<F>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const host = registry.get(mateFeedReadsAtom);
      if (host === null)
        return yield* Effect.fail(new MateFeedReadFailed({ message: "The account is not ready." }));
      const release = host.hold(key);
      yield* Effect.addFinalizer(() => Effect.sync(release));
      host.revalidate(key);
      let unlisten = () => {};
      let unlistenClose = () => {};
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unlisten();
          unlistenClose();
        }),
      );
      return yield* Effect.callback<MateFeedValues[F], MateFeedReadFailed>((resume) => {
        unlistenClose = host.onClose(() =>
          resume(Effect.fail(new MateFeedReadFailed({ message: "This account has closed." }))),
        );
        const atom = host.data.project(mateFeed(key.family), key);
        unlisten = registry.subscribe(
          atom,
          (read) => {
            if (read.state === "known" && read.freshness.kind === "settled")
              resume(Effect.succeed(read.value));
            else if (read.state === "failed")
              resume(
                Effect.fail(
                  new MateFeedReadFailed({
                    message:
                      read.failure.kind === "refused"
                        ? read.failure.words
                        : "The Mate could not report this detail.",
                  }),
                ),
              );
            else if (read.state === "known" && read.freshness.kind === "stale")
              resume(
                Effect.fail(
                  new MateFeedReadFailed({
                    message: "The Mate is unavailable. Try again when it reconnects.",
                  }),
                ),
              );
          },
          { immediate: true },
        );
        return Effect.sync(() => {
          unlisten();
          unlistenClose();
        });
      });
    }),
  );
}

/** Reads retained evidence without waking an unconnected Mate. */
export function retainedMateFeedAtom<F extends MateFeedFamily>(key: MateFeedKey<F>) {
  return Atom.make((get): Known<MateFeedValues[F]> => {
    const host = get(mateFeedReadsAtom);
    return host === null
      ? { state: "unread", waitingFor: "mate-session" }
      : get(host.data.project(mateFeed(key.family), key));
  });
}
