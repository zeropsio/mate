/**
 * The account's invalidation bus (DESIGN §6.2), held at web level until the account runtime
 * constructs it: one bus per account lifetime, built on the first invalidation and closed with the
 * lifetime, so a request still coalescing when the account closes reaches nobody.
 *
 * Surfaces send intents here (`invalidateZerops`); the owners of pull-based facts hear them
 * (`onZeropsInvalidation`). The bus hears this tab's visibility: a key whose window closes while
 * the tab has been hidden for a minute waits for the tab to be shown again.
 */
import {
  makeInvalidationBus,
  type Invalidation,
  type InvalidationBus,
  type InvalidationSignal,
} from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { onAccountLifetimeClose } from "./accountLifetime";

/** A visible wake needs the tab hidden at least this long (DESIGN §6.4). */
const WAKE_AFTER_HIDDEN_MS = 30_000;

/** `hidden`, `visible` and the visible wake, off the document's `visibilitychange`. */
const documentSignals: Stream.Stream<InvalidationSignal> = Stream.callback((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      if (typeof document === "undefined") return null;
      const hidden = () => document.visibilityState === "hidden";
      let hiddenAt: number | null = null;
      const hear = () => {
        if (hidden()) {
          hiddenAt ??= performance.now();
          Queue.offerUnsafe(queue, { type: "hidden" });
          return;
        }
        const away = hiddenAt === null ? 0 : performance.now() - hiddenAt;
        hiddenAt = null;
        Queue.offerUnsafe(queue, { type: "visible" });
        if (away >= WAKE_AFTER_HIDDEN_MS) Queue.offerUnsafe(queue, { type: "visible-wake" });
      };
      if (hidden()) hear();
      document.addEventListener("visibilitychange", hear);
      return hear;
    }),
    (hear) =>
      Effect.sync(() => {
        if (hear !== null) document.removeEventListener("visibilitychange", hear);
      }),
  ),
);

const listeners = new Set<(invalidation: Invalidation) => void>();

/** One listener that throws never leaves the others, or the next invalidation, unheard. */
function deliver(invalidation: Invalidation): void {
  for (const listener of listeners) {
    try {
      listener(invalidation);
    } catch (cause) {
      console.error("An invalidation listener failed", cause);
    }
  }
}

let open: { readonly bus: InvalidationBus; readonly scope: Scope.Closeable } | null = null;

onAccountLifetimeClose(() => {
  if (open === null) return;
  const { scope } = open;
  open = null;
  Effect.runFork(Scope.close(scope, Exit.void));
});

function lifetimeBus(): InvalidationBus {
  if (open !== null) return open.bus;
  const scope = Scope.makeUnsafe();
  const bus = Effect.runSync(
    Effect.gen(function* () {
      // No view reports what it shows yet, so a flush keeps the order the keys were collected in.
      const bus = yield* makeInvalidationBus({ signals: documentSignals, shown: () => true });
      const subscription = yield* bus.subscribe;
      yield* PubSub.take(subscription).pipe(
        Effect.flatMap((invalidation) => Effect.sync(() => deliver(invalidation))),
        Effect.forever,
        Effect.forkIn(scope),
      );
      return bus;
    }).pipe(Scope.provide(scope)),
  );
  open = { bus, scope };
  return bus;
}

/** Requests revalidation of the facts under one key: an intent a surface sends. */
export function invalidateZerops(invalidation: Invalidation): void {
  Effect.runSync(lifetimeBus().invalidate(invalidation));
}

/**
 * Hears every invalidation of the open account, in the order listeners were added. Returns the
 * way to stop.
 */
export function onZeropsInvalidation(listener: (invalidation: Invalidation) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
