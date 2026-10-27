/**
 * The web's binding to the account's invalidation bus (DESIGN §6.2). The bus is the account
 * runtime's; this module only carries surfaces' intents into it (`invalidateZerops`) and its
 * invalidations out to the owners still built in React (`onZeropsInvalidation`).
 *
 * The host binds the bus of each account runtime it stands up. Closing the account lifetime
 * unbinds it at once, so a request still coalescing when the account closes reaches nobody.
 */
import type {
  Invalidation,
  InvalidationBus,
} from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";

import { onAccountLifetimeClose } from "./accountLifetime";

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

let bound: { readonly bus: InvalidationBus; readonly scope: Scope.Closeable } | null = null;

function unbind(binding: NonNullable<typeof bound>): void {
  if (bound !== binding) return;
  bound = null;
  Effect.runFork(Scope.close(binding.scope, Exit.void));
}

onAccountLifetimeClose(() => {
  if (bound !== null) unbind(bound);
});

/**
 * Makes `bus` — the open account runtime's — the one surfaces send to and listeners hear.
 * Returns the way to unbind it, which leaves a newer binding alone.
 */
export function bindAccountInvalidations(bus: InvalidationBus): () => void {
  if (bound !== null) unbind(bound);
  const scope = Scope.makeUnsafe();
  Effect.runSync(
    Effect.gen(function* () {
      const subscription = yield* bus.subscribe;
      yield* PubSub.take(subscription).pipe(
        Effect.flatMap((invalidation) => Effect.sync(() => deliver(invalidation))),
        Effect.forever,
        Effect.forkIn(scope),
      );
    }).pipe(Scope.provide(scope)),
  );
  const binding = { bus, scope };
  bound = binding;
  return () => unbind(binding);
}

/**
 * Requests revalidation of the facts under one key: an intent a surface sends. With no account
 * runtime bound there is nobody to ask, so a write answering after sign-out asks for nothing.
 */
export function invalidateZerops(invalidation: Invalidation): void {
  if (bound === null) return;
  Effect.runSync(bound.bus.invalidate(invalidation));
}

/**
 * Hears every invalidation of the bound account, in the order listeners were added. Returns the
 * way to stop.
 */
export function onZeropsInvalidation(listener: (invalidation: Invalidation) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
