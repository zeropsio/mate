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
  WakeId,
} from "@t3tools/contracts";

/** What a driver reported at a boundary. Deltas never come here; they stay on the live plane. */
export type ProviderSignal =
  | {
      readonly kind: "turn-started";
      readonly providerTurnId: string | null;
      /** For a turn the agent started itself: the run whose work it reports, when the bridge knows. */
      readonly reportsOn?: RunId | null;
    }
  | {
      readonly kind: "item-opened";
      readonly key: string;
      readonly by: ItemActor;
      readonly body: ItemBody;
      readonly detail?: string;
    }
  | { readonly kind: "item-updated"; readonly key: string; readonly body: ItemBody }
  | {
      readonly kind: "item-closed";
      readonly key: string;
      readonly by?: ItemActor;
      readonly body: ItemBody;
      readonly detail?: string;
    }
  | {
      readonly kind: "request-opened";
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
      readonly outcome:
        | { readonly kind: "completed" }
        | { readonly kind: "failed"; readonly reason: string; readonly next?: string | null };
    }
  | { readonly kind: "usage-limit"; readonly resetsAt: number | null }
  | { readonly kind: "session-exited"; readonly reason: string }
  /** Deltas flowed: the run is alive. Throttled by `decide`, so the pump may send it per batch. */
  | { readonly kind: "activity" };

export type Command =
  | {
      readonly _tag: "Send";
      readonly text: string;
      readonly attachments?: ReadonlyArray<string>;
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
  | { readonly _tag: "WakeFired"; readonly wakeId: WakeId }
  | { readonly _tag: "EffectSettled"; readonly effectId: EffectId; readonly outcome: EffectOutcome }
  | {
      readonly _tag: "ProviderSignals";
      readonly sessionId: SessionId;
      readonly signals: ReadonlyArray<ProviderSignal>;
    }
  | {
      readonly _tag: "Recovered";
      readonly bootId: BootId;
      /** Process-bound effects the boot cut. */
      readonly cutEffects: ReadonlyArray<EffectId>;
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

export type EffectLane = "turn" | "side";
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
