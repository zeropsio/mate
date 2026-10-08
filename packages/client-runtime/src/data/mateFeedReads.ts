/** Surface bindings hold demand and read projections; they own neither transport nor remote values. */
import { AsyncResult, Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";
import type { AccountStore } from "./store.ts";
import { mateFeed } from "./projections/mateFeeds.ts";
import type { makeMateFeeds } from "./adapters/mateFeeds.ts";
import type { MateFeedFamily, MateFeedKey, MateFeedValues } from "./families/mateFeeds.ts";
import type { Known, FailureReason } from "../zerops/knowledge/index.ts";
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
  let retry = () => {};
  return Atom.readable(
    (get): AsyncResult.AsyncResult<MateFeedValues[F], unknown> => {
      const host = get(mateFeedReadsAtom);
      retry = () => host?.retry(key);
      const read = get(source);
      switch (read.state) {
        case "known": {
          const freshness = read.freshness;
          if (
            freshness.kind === "stale" &&
            (freshness.reason.kind === "revalidation-failed" ||
              freshness.reason.kind === "source-recovering")
          ) {
            const failure =
              freshness.reason.kind === "revalidation-failed"
                ? mateFeedFailure(freshness.reason.failure)
                : new MateFeedReadFailed({
                    message: "The Mate is unavailable. Try again when it reconnects.",
                  });
            return AsyncResult.fail(failure, {
              previousSuccess: Option.some(AsyncResult.success(read.value)),
            });
          }
          return AsyncResult.success(read.value, { waiting: freshness.kind === "revalidating" });
        }
        case "failed":
          return AsyncResult.fail(mateFeedFailure(read.failure));
        default:
          return AsyncResult.initial(true);
      }
    },
    () => retry(),
  );
}

export class MateFeedReadFailed extends Schema.TaggedError<MateFeedReadFailed>()(
  "MateFeedReadFailed",
  { message: Schema.String },
) {}
function mateFeedFailure(failure: FailureReason): MateFeedReadFailed {
  return new MateFeedReadFailed({
    message:
      failure.kind === "refused"
        ? failure.words
        : failure.kind === "transport" || failure.kind === "malformed"
          ? failure.detail
          : failure.kind === "unsupported"
            ? failure.capability
            : "The Mate could not report this detail.",
  });
}
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
            else if (read.state === "failed") resume(Effect.fail(mateFeedFailure(read.failure)));
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
