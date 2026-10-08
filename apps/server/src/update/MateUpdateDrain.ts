import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface UpdateIdleFacts {
  readonly idle: boolean;
  readonly blockers: ReadonlyArray<string>;
}

/** The engine owns admission and proves its own state; the updater joins external process facts. */
export interface MateUpdateDrain {
  readonly begin: Effect.Effect<void>;
  readonly cancel: Effect.Effect<void>;
  readonly facts: Effect.Effect<UpdateIdleFacts>;
  readonly changes: Stream.Stream<void>;
  /** Closes idle native sessions and persists their final resume bindings, keeping admission shut. */
  readonly quiesce: Effect.Effect<UpdateIdleFacts>;
}
