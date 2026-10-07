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
 * no conversation. What the Zerops grafts call (`conversations`, `changes`,
 * `stopSessionsOn`, `wake`, `runOutcome`) speaks engine types only.
 *
 * @module engine/MateEngine
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type {
  ConversationAgent,
  ConversationId,
  Principal,
  RunEnd,
  RunEndSource,
  RunId,
  WakeId,
} from "@t3tools/contracts";

import type { Command } from "./domain/command.ts";
import type { WakeKind } from "./ports.ts";
import type { ConversationView } from "./read/conversationView.ts";

export { brokeOffLine, conversationRowOf, restartLine } from "./read/conversationRow.ts";
export type { ConversationView, ViewCall, ViewRequest, ViewRun } from "./read/conversationView.ts";

/** What a V1 door answers once the Mate engine owns the conversation. */
export const ENGINE_MOVED =
  "This Mate's conversation moved to the new engine. Update Zerops Mate to keep talking to it.";

/** Why the engine stops a live session. */
export type StopCause = "sign-out";

/**
 * A run asked for with no person at the keyboard: the conversation's `ArmWake`, with the
 * principal it runs for (a continuation inherits the principal of the run it `joins`). The
 * same conversation, kind and key arm one wake (`wakeId`).
 */
export type WakeRequest = Omit<
  Extract<Command, { readonly _tag: "ArmWake" }>,
  "_tag" | "kind" | "text"
> & {
  readonly conversationId: ConversationId;
  readonly kind: WakeKind;
  readonly principal: Principal;
  readonly text: string;
};

export interface WakeReceipt {
  readonly wakeId: WakeId;
}

/** A wake the engine will not arm, in the sentence its caller reports. */
export class WakeRefused extends Data.TaggedError("WakeRefused")<{
  readonly message: string;
}> {}

/** A call's own record: its item, how the call ended (`done`, `failed`, …), and when. */
export interface CallData {
  readonly itemId: string;
  readonly state: string;
  readonly at: number;
  readonly data: unknown;
}

/** How a woken run ended, once it has, and who said so. */
export interface RunOutcome {
  readonly wakeId: WakeId;
  readonly runId: RunId;
  readonly end: RunEnd;
  readonly source: RunEndSource;
}

export interface MateEngineService {
  /** True when this Mate's conversation runs on the engine. */
  readonly live: boolean;
  /** Boot reconcile, SPI ingestion, outbox and wakes, scoped to the startup's reactor scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Every conversation as the grafts read it (HQ overview, attention, the menu row). */
  readonly conversations: Effect.Effect<ReadonlyArray<ConversationView>>;
  /** One conversation as the grafts read it; none when the engine holds no record of it. */
  readonly conversation: (id: ConversationId) => Effect.Effect<ConversationView | undefined>;
  /** The conversation whose record moved, each time it does: its view may have changed. */
  readonly changes: Stream.Stream<ConversationId>;
  /** Stops every live session on these instances (a sign-out); best-effort, never fails. */
  readonly stopSessionsOn: (
    instanceIds: ReadonlyArray<string>,
    cause: StopCause,
  ) => Effect.Effect<void>;
  readonly wake: (wake: WakeRequest) => Effect.Effect<WakeReceipt, WakeRefused>;
  readonly runOutcome: (id: WakeId) => Effect.Effect<RunOutcome | undefined>;
  /**
   * Gives a conversation the agent it belongs to (the stand-up, the flip); whether the engine
   * took it. Giving it the agent it has changes nothing.
   */
  readonly assignAgent: (
    conversationId: ConversationId,
    agent: ConversationAgent,
  ) => Effect.Effect<boolean>;
  /**
   * A call's progress (the stand-up's, from zcp's status file), live on the call's item in the
   * conversation a provider thread belongs to; never stored. `null` clears it.
   */
  readonly callProgress: (
    providerThread: string,
    toolName: string,
    progress: unknown,
  ) => Effect.Effect<void>;
  /**
   * Calls' own records kept beside their items (what a file write wrote), by item, or every call
   * of the conversation whose record names this text; the oldest first.
   */
  readonly callData: (
    conversationId: ConversationId,
    find: { readonly itemIds: ReadonlyArray<string> } | { readonly naming: string },
  ) => Effect.Effect<ReadonlyArray<CallData>>;
  /** The latest run a wake started, or the one a provider turn belongs to, ended or not. */
  readonly runOf: (
    find: { readonly wakeId: WakeId } | { readonly providerTurnId: string },
  ) => Effect.Effect<
    | {
        readonly runId: RunId;
        readonly end: RunEnd | null;
        readonly source: RunEndSource | null;
        /**
         * Whether its words reached the agent: it started (`true`), provably never (`false`: never
         * sent, or every send refused undelivered), or a send may have (`unknown`).
         */
        readonly reachedAgent: boolean | "unknown";
      }
    | undefined
  >;
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
  conversations: Effect.succeed([]),
  conversation: () => Effect.succeed(undefined),
  changes: Stream.empty,
  stopSessionsOn: () => Effect.void,
  wake: notRunning,
  runOutcome: () => Effect.succeed(undefined),
  assignAgent: () => Effect.succeed(false),
  callProgress: () => Effect.void,
  callData: () => Effect.succeed([]),
  runOf: () => Effect.succeed(undefined),
};
