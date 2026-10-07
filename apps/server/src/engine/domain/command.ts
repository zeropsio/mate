/**
 * What enters a conversation's actor, and what `decide` makes of it.
 *
 * People send `Send`, `Stop`, `Answer`, `Steer`, `SwitchModel`, `Archive`, `Unarchive`; the
 * engine's own fibers tell `WakeFired` (scheduler), `EffectSettled` (worker), `ProviderSignals`
 * (the pump, boundaries only) and `Recovered` (boot). Every input carries a command id: a client's,
 * or one derived from its cause (`ids.ts`).
 *
 * @module engine/domain/command
 */
import type {
  BootId,
  ChatImageAttachment,
  ConversationAgent,
  CommandId,
  CommandResult,
  ConversationId,
  EffectId,
  EffectOutcome,
  ItemActor,
  ItemBody,
  KnownEngineEvent,
  Principal,
  Rejection,
  RequestAsk,
  RequestId,
  RequestState,
  RunId,
  SessionId,
  TurnEndSource,
  TurnHandle,
  WakeId,
} from "@t3tools/contracts";

import type { TurnOutcome } from "../bridge/spi3.ts";

/**
 * What a driver reported at a boundary. Deltas never come here; they stay on the live plane. Every
 * turn-scoped signal names its turn, so a late signal lands on the run that turn belongs to and
 * never on whatever run is active; a signal for a turn the engine does not know is dropped.
 */
export type ProviderSignal =
  | {
      readonly kind: "turn-started";
      readonly turn: TurnHandle;
      /** `self`: the agent opened it with no message from the engine (Claude's background results). */
      readonly origin: "engine" | "self";
      readonly providerTurnId: string | null;
      /** For a turn the agent started itself: the run whose work it reports, when the bridge knows. */
      readonly reportsOn?: RunId | null;
    }
  | {
      readonly kind: "item-opened";
      readonly turn: TurnHandle;
      readonly key: string;
      readonly by: ItemActor;
      readonly body: ItemBody;
      readonly detail?: string;
      /** Arrived after its turn ended; filed under that turn's run, never reopening it. */
      readonly afterEnd?: true;
    }
  | {
      readonly kind: "item-updated";
      readonly turn: TurnHandle;
      readonly key: string;
      readonly body: ItemBody;
      readonly afterEnd?: true;
    }
  | {
      readonly kind: "item-closed";
      readonly turn: TurnHandle;
      readonly key: string;
      readonly by?: ItemActor;
      readonly body: ItemBody;
      readonly detail?: string;
      readonly afterEnd?: true;
    }
  | {
      readonly kind: "request-opened";
      /** Absent when the driver could not tie the request to a turn: the active run's. */
      readonly turn?: TurnHandle;
      readonly key: string;
      readonly ask: RequestAsk;
      readonly answerable?: boolean;
    }
  | {
      readonly kind: "request-closed";
      readonly key: string;
      readonly state: Exclude<RequestState, "open">;
    }
  | {
      readonly kind: "turn-ended";
      readonly turn: TurnHandle;
      readonly outcome: TurnOutcome;
      readonly source: TurnEndSource;
    }
  | {
      readonly kind: "usage-limit";
      /** The turn the limit parked or ended; absent between turns. */
      readonly turn?: TurnHandle;
      readonly resetsAt: number | null;
      /** The driver parked the turn (Claude): its session is closed, the resume reopens it. */
      readonly parks?: boolean;
    }
  /**
   * Background work the agent started (a helper, a shell, a monitor): an item under the run whose
   * turn started it, open until it ends — it may outlive that turn.
   */
  | {
      readonly kind: "work-upserted";
      readonly work: string;
      /** The turn that started it; `"unknown"` when the driver could not say. */
      readonly origin: TurnHandle | "unknown";
      readonly workKind: Extract<ItemBody, { readonly kind: "work" }>["workKind"];
      readonly status: Extract<ItemBody, { readonly kind: "work" }>["status"];
      readonly title?: string;
    }
  /** A limit whose reset was unknown learned its reset time (the driver's rate-limit report). */
  | { readonly kind: "usage-reset-known"; readonly resetsAt: number }
  | { readonly kind: "session-exited"; readonly reason: string }
  /** Deltas flowed: the turn is alive. Throttled by `decide`, so the pump may send it per batch. */
  | { readonly kind: "activity"; readonly turn: TurnHandle };

export type Command =
  | {
      readonly _tag: "Send";
      readonly text: string;
      /** Pictures by reference, captured into the asset store before the command is told. */
      readonly attachments?: ReadonlyArray<ChatImageAttachment>;
      /** A maintenance command (`/compact`, `/logout`): never continued after a restart. */
      readonly maintenance?: boolean;
    }
  | { readonly _tag: "Stop"; readonly runId?: RunId }
  | {
      readonly _tag: "Answer";
      readonly requestId: RequestId;
      readonly answer: unknown;
      /** What the record shows of the answer: never a vault value. */
      readonly summary: string;
    }
  | { readonly _tag: "Steer"; readonly runId: RunId; readonly text: string }
  | { readonly _tag: "SwitchModel"; readonly model: string }
  /** The conversation is given the agent it belongs to: instance, driver, model and profile. */
  | { readonly _tag: "AssignAgent"; readonly agent: ConversationAgent }
  /** Close the conversation's session from outside: the person signed out. */
  | { readonly _tag: "CloseSession"; readonly reason: "signed-out" }
  | { readonly _tag: "Archive" }
  | { readonly _tag: "Unarchive" }
  | {
      readonly _tag: "ArmWake";
      readonly kind: string;
      readonly key: string;
      /** Absent with a cron: the cron's next time. */
      readonly dueAt?: number;
      readonly cron?: string | null;
      readonly text?: string | null;
      readonly joins?: RunId | null;
    }
  | { readonly _tag: "CancelWake"; readonly wakeId: WakeId }
  | {
      readonly _tag: "WakeFired";
      readonly wakeId: WakeId;
      /** The arming the scheduler read; a fire of an older arming is refused. */
      readonly armedSeq?: number;
    }
  | { readonly _tag: "EffectSettled"; readonly effectId: EffectId; readonly outcome: EffectOutcome }
  | {
      readonly _tag: "ProviderSignals";
      readonly sessionId: SessionId;
      readonly signals: ReadonlyArray<ProviderSignal>;
    }
  | {
      readonly _tag: "Recovered";
      readonly bootId: BootId;
      /** Process-bound effects the restart cut while they were being tried. */
      readonly cutEffects: ReadonlyArray<EffectId>;
      /** Process-bound effects the restart found never tried: nothing of them happened. */
      readonly unstartedEffects?: ReadonlyArray<EffectId>;
      /** The platform's evidence of the restart, worded for the person. */
      readonly words?: string;
    };

export type CommandTag = Command["_tag"];

export interface Envelope {
  readonly commandId: CommandId;
  readonly conversationId: ConversationId;
  readonly principal: Principal;
  readonly command: Command;
}

type HeaderKey = "v" | "conversationId" | "seq" | "at" | "commandId";
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the store stamps its header (version, conversation, seq, time, command). */
export type EventDraft = DistributiveOmit<KnownEngineEvent, HeaderKey>;

/**
 * Where an effect queues; each conversation's lane is FIFO, lanes run side by side. `turn`: the
 * session and what goes into it (open, send, steer) — a send settles once the driver accepted it,
 * so the lane frees while the turn runs. `control`: what must never wait behind a send (interrupt,
 * answer). `close`: a session's close, which never waits behind an interrupt the driver does not
 * answer (a second Stop closes the session). `side`: work beside the agent (the workspace capture,
 * its finish).
 */
export type EffectLane = "turn" | "control" | "close" | "side";
/** Boot cuts a process-bound effect (its process is gone) and requeues a replay-safe one. */
export type EffectClass = "process-bound" | "replay-safe";

export interface EffectDraft {
  readonly effectId: EffectId;
  readonly kind: string;
  readonly lane: EffectLane;
  readonly class: EffectClass;
  readonly runId: RunId | null;
  readonly payload: unknown;
}

/** An item's full body, kept lazily beside its summary. */
export interface ItemDetailDraft {
  readonly itemId: string;
  readonly body: string;
}

export interface Step {
  readonly events: ReadonlyArray<EventDraft>;
  readonly effects: ReadonlyArray<EffectDraft>;
  readonly details: ReadonlyArray<ItemDetailDraft>;
  readonly result: Extract<CommandResult, { _tag: "Accepted" }>;
}

export type Decision =
  | { readonly _tag: "Accept"; readonly step: Step }
  | { readonly _tag: "Reject"; readonly rejection: Rejection };
