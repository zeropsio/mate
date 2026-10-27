/**
 * An account's invalidation bus for a test with no account runtime: bound the way the host binds
 * the runtime's, so `invalidateZerops` and `onZeropsInvalidation` meet on it. It hears a visible
 * tab and treats every key as shown.
 */
import {
  makeInvalidationBus,
  type Invalidation,
} from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { bindAccountInvalidations } from "../accountInvalidations";

export interface BoundTestBus {
  /** Sends on the bus itself, as an owner in the account runtime does. */
  readonly invalidate: (invalidation: Invalidation) => void;
  /** Unbinds the bus and ends it. */
  readonly close: () => void;
}

export function bindTestInvalidationBus(): BoundTestBus {
  const scope = Scope.makeUnsafe();
  const bus = Effect.runSync(
    makeInvalidationBus({ signals: Stream.never, shown: () => true }).pipe(Scope.provide(scope)),
  );
  const unbind = bindAccountInvalidations(bus);
  return {
    invalidate: (invalidation) => Effect.runSync(bus.invalidate(invalidation)),
    close: () => {
      unbind();
      Effect.runFork(Scope.close(scope, Exit.void));
    },
  };
}
