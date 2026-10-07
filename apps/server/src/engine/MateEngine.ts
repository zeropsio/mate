/**
 * MateEngine — the conversation engine that replaces V1 behind the
 * `T3CODE_MATE_ENGINE` switch. Every process builds it; one form runs:
 *
 * - inert (`v1`, the default): `live` is false, nothing starts, nothing is
 *   served, and V1 owns the conversation exactly as before;
 * - live (`mate`): V1's roots stay parked and its doors refuse with
 *   {@link ENGINE_MOVED}; `start` runs in the startup's reactor scope.
 *
 * The domain, the store and the runtime behind the live form are built
 * beside this file; until they land the live form starts nothing and serves
 * no conversation. What the Zerops grafts call (`view`, `changes`,
 * `stopSessionsOn`, `wake`, `runOutcome`) speaks engine types only.
 *
 * @module engine/MateEngine
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { RunPrincipal, WakeOwner } from "./ports.ts";

/** What a V1 door answers once the Mate engine owns the conversation. */
export const ENGINE_MOVED =
  "This Mate's conversation moved to the new engine. Update Zerops Mate to keep talking to it.";

/** A wake's id, derived from its cause: `${owner}/w/${kind}/${key}`. */
export type WakeId = string;

/** Why the engine stops a live session. */
export type StopCause = "sign-out";

/** The conversation as the grafts read it (HQ overview, attention). */
export interface ConversationView {
  readonly conversationId: string;
}

/** A run asked for with no person at the keyboard. */
export interface WakeRequest {
  readonly owner: WakeOwner;
  /** Dedups a wake: the same owner and key arm one wake. */
  readonly key: string;
  readonly principal: Extract<RunPrincipal, { readonly kind: "wake" }>;
  readonly text: string;
}

export interface WakeReceipt {
  readonly wakeId: WakeId;
}

/** A wake the engine will not arm, in the sentence its caller reports. */
export class WakeRefused extends Data.TaggedError("WakeRefused")<{
  readonly message: string;
}> {}

/** How a woken run ended, once it has. */
export interface RunOutcome {
  readonly wakeId: WakeId;
  readonly end: "completed" | "stopped" | "failed" | "usage-limit" | "cut-by-restart";
}

export interface MateEngineService {
  /** True when this Mate's conversation runs on the engine. */
  readonly live: boolean;
  /** Boot reconcile, SPI ingestion, outbox and wakes, scoped to the startup's reactor scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly view: Effect.Effect<ConversationView | undefined>;
  /** Emits once whenever the view may have changed. */
  readonly changes: Stream.Stream<void>;
  /** Stops every live session on these instances (a sign-out); best-effort, never fails. */
  readonly stopSessionsOn: (
    instanceIds: ReadonlyArray<string>,
    cause: StopCause,
  ) => Effect.Effect<void>;
  readonly wake: (wake: WakeRequest) => Effect.Effect<WakeReceipt, WakeRefused>;
  readonly runOutcome: (id: WakeId) => Effect.Effect<RunOutcome | undefined>;
}

export class MateEngine extends Context.Service<MateEngine, MateEngineService>()(
  "t3/engine/MateEngine",
) {}

const notRunning = () =>
  Effect.fail(new WakeRefused({ message: "The Mate engine is not running on this Mate." }));

/** The engine with the switch on `v1`: nothing starts, nothing is served. */
export const inertMateEngine: MateEngineService = {
  live: false,
  start: () => Effect.void,
  view: Effect.succeed(undefined),
  changes: Stream.empty,
  stopSessionsOn: () => Effect.void,
  wake: notRunning,
  runOutcome: () => Effect.succeed(undefined),
};
