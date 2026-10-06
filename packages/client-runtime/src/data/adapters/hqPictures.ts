/** HQ attachment reads beside the scope socket, using each demanded scope's stream policy. */
import type { AttachmentLink } from "@t3tools/shared/hqChanges";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Random from "effect/Random";

import { hqPictureFamily, pictureId, pictureLink } from "../families/hqPicture.ts";
import { factKey, type ScopeKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";

export const makeHqPictureReads = Effect.fnUntraced(function* (options: {
  readonly orgId: string;
  readonly store: AccountStore;
  readonly read: (link: AttachmentLink) => Effect.Effect<Blob, StreamFault>;
  readonly signal: (scope: ScopeKey, event: StreamEvent) => Effect.Effect<unknown>;
  readonly wake: () => void;
}) {
  const { store, signal } = options;
  const active = new Map<
    ScopeKey,
    { readonly generation: number; readonly fiber: Fiber.Fiber<void> }
  >();
  const observe = Effect.fnUntraced(function* (scopes: ReadonlyArray<ScopeKey>) {
    const wanted = new Set(
      scopes.filter((scope) => scope.split(":")[2] === hqPictureFamily.scope.suffix),
    );
    for (const [scope, entry] of active) {
      if (wanted.has(scope) && streamOf(store.state(), scope).generation === entry.generation)
        continue;
      active.delete(scope);
      yield* Fiber.interrupt(entry.fiber);
    }
    const now = yield* Clock.currentTimeMillis;
    let wakeAt = Number.POSITIVE_INFINITY;
    for (const scope of wanted) {
      const stream = streamOf(store.state(), scope);
      if (stream.phase === "refused" || stream.phase === "live" || active.has(scope)) continue;
      if (stream.next.kind === "retry" && stream.next.at > now) {
        wakeAt = Math.min(wakeAt, stream.next.at);
        continue;
      }
      const link = pictureLink(scope.split(":").slice(3).join(":"));
      if (link === null) {
        yield* signal(scope, {
          kind: "fault",
          jitter: 0,
          fault: {
            outcome: "definitive-refusal",
            message: "Invalid change attachment identity.",
          },
        });
        continue;
      }
      yield* signal(scope, { kind: "attempt" });
      yield* signal(scope, { kind: "handshake" });
      const generation = streamOf(store.state(), scope).generation;
      const id = pictureId({ orgId: options.orgId, link });
      // Attachment ids identify immutable bytes. A remount or segment never reads them again.
      if (readsOfState(store.state()).fact("hqPicture", id).kind === "known") {
        yield* signal(scope, { kind: "baseline-committed" });
        continue;
      }
      store.dispatch({ kind: "baseline-begin", scope, generation });
      const read = options.read(link).pipe(
        Effect.flatMap((blob) =>
          Effect.gen(function* () {
            const current = streamOf(store.state(), scope);
            if (
              current.generation !== generation ||
              !current.demanded ||
              current.phase !== "baselining"
            )
              return;
            if (hqPictureFamily.sampled!.decode(blob) === null)
              return yield* Effect.fail<StreamFault>({
                outcome: "definitive-refusal",
                message: "HQ returned no picture bytes.",
              });
            store.dispatch({
              kind: "baseline-commit",
              scope,
              generation,
              via: "hq-stream",
              members: [id],
              rows: [
                {
                  family: "hqPicture",
                  id,
                  value: blob,
                  revision: { kind: "hq", incarnation: id, revision: 0 },
                },
              ],
            });
            yield* signal(scope, { kind: "baseline-committed" });
          }),
        ),
        Effect.catch((fault) =>
          Effect.gen(function* () {
            const current = streamOf(store.state(), scope);
            if (
              current.generation !== generation ||
              !current.demanded ||
              current.phase !== "baselining"
            )
              return;
            if (
              fault.outcome === "authoritative-denial" &&
              store.state().facts.has(factKey("hqPicture", id))
            )
              store.dispatch({ kind: "access", family: "hqPicture", id, access: "denied" });
            yield* signal(scope, { kind: "fault", fault, jitter: yield* Random.next });
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (active.get(scope)?.generation === generation) active.delete(scope);
            options.wake();
          }),
        ),
      );
      const fiber = yield* Effect.forkScoped(read, { startImmediately: false });
      active.set(scope, { generation, fiber });
    }
    return wakeAt;
  });
  return observe;
});
