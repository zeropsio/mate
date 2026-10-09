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
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type {
  CommandId,
  CommandResult,
  ConversationAgent,
  ConversationId,
  EngineEvent,
  HistorySource,
  Principal,
  RunEnd,
  RunEndSource,
  RunId,
  WakeId,
} from "@t3tools/contracts";

import type { OwnerHandle } from "./Conversations.ts";
import type { MateUpdateDrain } from "../update/MateUpdateDrain.ts";

import type { Command } from "./domain/command.ts";
import type { Domain, OwnerEvent } from "./owners.ts";
import type { WakeKind } from "./ports.ts";
import type { ConversationList, ConversationView } from "./read/conversationView.ts";
import { unservedWire, type EngineWireShape } from "./wire/EngineWire.ts";

export { brokeOffLine, conversationRowOf, restartLine } from "./read/conversationRow.ts";

/** Session identity for the engine's provider wiring. */
export { providerThreadOf } from "./pump/TurnPump.ts";
/** How a run reads when its own agent interrupted the turn: an owner kind tells it apart. */
export { AGENT_STOPPED_ITSELF } from "./domain/decide.ts";
/** A store read or write that failed, as an owner kind's effects meet it. */
export type { EngineStoreError } from "./store/EngineStore.ts";
export type {
  ConversationList,
  ConversationView,
  ViewCall,
  ViewRequest,
  ViewRun,
} from "./read/conversationView.ts";

/**
 * What a V1 door answers once the Mate engine owns the conversation. Only a stale app reaches a V1
 * door, so the words are for it: a web app reloads, a desktop or phone app updates.
 */
export const ENGINE_MOVED =
  "This Mate moved to its new engine. Reload or update this app to keep talking to it.";

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

/** A conversation's view the engine could not read now: not none, so a reader keeps what it held. */
export class ViewUnreadable extends Data.TaggedError("ViewUnreadable")<{
  readonly conversationId: ConversationId;
}> {}

/** A delivery the engine could not record now: told again, its receipt dedupes it. */
export class DeliveryUnrecorded extends Data.TaggedError("DeliveryUnrecorded")<{
  readonly conversationId: ConversationId;
  readonly message: string;
}> {}

/** A conversation's record could not be read now: the reader keeps its cursor and reads again. */
export class EventsUnreadable extends Data.TaggedError("EventsUnreadable")<{
  readonly conversationId: ConversationId;
}> {}

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
  readonly updateDrain?: MateUpdateDrain;
  /** True when this Mate's conversation runs on the engine. */
  readonly live: boolean;
  /** Boot reconcile, SPI ingestion, outbox and wakes, scoped to the startup's reactor scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /**
   * Every conversation as the grafts read it (HQ overview, attention, the menu row), and those
   * whose view could not be read now: a reader never takes an unread one for none.
   */
  readonly conversations: Effect.Effect<ConversationList>;
  /**
   * One conversation as the grafts read it; none when the engine holds no record of it, and a
   * failure (never none) when its view cannot be read now.
   */
  readonly conversation: (
    id: ConversationId,
  ) => Effect.Effect<ConversationView | undefined, ViewUnreadable>;
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
   * Copies a conversation's earlier record in, once, before it runs anything of its own (the
   * flip): the V1 thread's turns become ended runs, read in batches by an effect a restart
   * resumes. How many turns it reserved; none when there is nothing to bring, it already
   * brought them, or the conversation already ran on the engine.
   */
  readonly importHistory: (
    conversationId: ConversationId,
    source: HistorySource,
  ) => Effect.Effect<number>;
  /**
   * Holds every person's send until the returned effect lets them go: a flipped Mate holds them
   * from its start until its main conversation is adopted, so its earlier record goes in before
   * anything of the person's takes the first run.
   */
  readonly holdSends: Effect.Effect<Effect.Effect<void>>;
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
  /**
   * The conversation wire the clients subscribe to and call (`registerEngineRpc`): in V1 mode it
   * answers every method `unserved`.
   */
  readonly wire: EngineWireShape;
  /**
   * The crew's door into a crewmate's conversation (or the Mate's): one command as `principal`,
   * under the caller's command id, so a delivery told again is answered by its receipt and never
   * acts twice. Returns once the step is committed, accepted or refused; fails only when it could
   * not be recorded. A crewmate's chat takes a person's messages only through its crew; this is
   * that way in.
   */
  readonly deliver: (
    conversationId: ConversationId,
    command: Command,
    commandId: CommandId,
    principal: Principal,
  ) => Effect.Effect<CommandResult, DeliveryUnrecorded>;
  /**
   * A conversation's durable events after a cursor, oldest first, a page at most: what the crew's
   * observer reads instead of the bus. Gapless, so a cursor never misses one.
   */
  readonly eventsAfter: (
    conversationId: ConversationId,
    afterSeq: number,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<EngineEvent>, EventsUnreadable>;
  /**
   * A registered owner kind's door (the crew's): its commands, state and events. None when the
   * engine does not run here.
   */
  readonly owner: <
    S extends { readonly headSeq: number },
    C extends { readonly _tag: string },
    E extends OwnerEvent,
    D,
  >(
    domain: Domain<S, C, E, D>,
  ) => Option.Option<OwnerHandle<S, C, E>>;
  /**
   * The session generation a conversation runs on now (its provider thread is `<conv>/s/<n>`);
   * none when the engine cannot say.
   */
  readonly generation: (conversationId: ConversationId) => Effect.Effect<number | undefined>;
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
  conversations: Effect.succeed({ views: [], unread: [], complete: true }),
  conversation: () => Effect.succeed(undefined),
  changes: Stream.empty,
  stopSessionsOn: () => Effect.void,
  wake: notRunning,
  runOutcome: () => Effect.succeed(undefined),
  assignAgent: () => Effect.succeed(false),
  importHistory: () => Effect.succeed(0),
  holdSends: Effect.succeed(Effect.void),
  callProgress: () => Effect.void,
  callData: () => Effect.succeed([]),
  runOf: () => Effect.succeed(undefined),
  deliver: () =>
    Effect.succeed({
      _tag: "Rejected",
      rejection: { reason: "unknown", detail: "The Mate engine is not running on this Mate." },
    }),
  eventsAfter: () => Effect.succeed([]),
  owner: () => Option.none(),
  generation: () => Effect.succeed(undefined),
  wire: unservedWire,
};
