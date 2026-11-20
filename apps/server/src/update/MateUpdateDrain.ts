import type { SubscribeUpdateChanges } from "./subscribeChanges.ts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface UpdateIdleFacts {
  readonly idle: boolean;
  readonly blockers: ReadonlyArray<string>;
}

/** The engine's idle proof: its own blockers and the provider threads it leaves to the restart. */
export interface EngineIdleFacts extends UpdateIdleFacts {
  /**
   * The provider threads whose open turn only waits on its person: the restart cuts it and asks
   * its question again by message, so neither its live session nor its resume cursor holds an
   * update.
   */
  readonly leftToRestart: ReadonlySet<string>;
}

/** The engine owns admission and proves its own state; the updater joins external process facts. */
export interface MateUpdateDrain {
  readonly begin: Effect.Effect<void>;
  readonly cancel: Effect.Effect<void>;
  readonly facts: Effect.Effect<EngineIdleFacts>;
  readonly changes: Stream.Stream<void>;
  readonly subscribeChanges?: SubscribeUpdateChanges;
  /** Closes idle native sessions and persists their final resume bindings, keeping admission shut. */
  readonly quiesce: Effect.Effect<UpdateIdleFacts>;
  /** When the Mate's last turn ended (epoch ms), of any conversation; absent before one has. */
  readonly lastTurnEndedAt?: Effect.Effect<number | undefined>;
}
