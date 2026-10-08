/**
 * SPI 3.0 — what the Mate engine reads from a driver.
 *
 * Drivers never see runs. The engine opens a session, hands each message an
 * opaque turn handle, and reads back signals keyed by app ids it can store:
 * turn handles, item keys, request keys, work keys. Native ids stay inside
 * the bridge.
 *
 * Today no driver speaks this contract: `translate.ts` folds the legacy
 * `ProviderRuntimeEvent` stream plus a log of the commands the engine sent
 * into these signals, with each driver's quirks applied from
 * `capabilities.ts`. A driver that later speaks SPI 3.0 natively replaces the
 * fold for itself, and its signals pass through unchanged.
 *
 * Where a driver cannot know a fact, a signal says `"unknown"`; the bridge
 * never fills a gap with a guess.
 *
 * Ids: a session is the engine's `SessionId` and a turn its `TurnHandle`
 * (`packages/contracts/src/engine.ts`), re-exported here with the turn's end
 * sources. Item, work, request and response keys are the bridge's own brands;
 * the engine stores them as opaque strings.
 */
import type {
  CanonicalRequestType,
  ProviderApprovalOption,
  RuntimeErrorClass,
  RuntimePlanStep,
  SessionId,
  SpiToolCall,
  TurnEndSource,
  TurnHandle,
  ThreadTokenUsageSnapshot,
  ToolLifecycleItemType,
  ToolPresentation,
  UserInputQuestion,
} from "@t3tools/contracts";
import type * as Brand from "effect/Brand";

import type { CallFacts } from "./callFacts.ts";

/** One native driver session; rotates under a conversation. */
export type { SessionId, TurnEndSource, TurnHandle };

export const DRIVER_SPI_VERSION = "3.0";

/** The six drivers the bridge knows; a seventh needs its row in `capabilities.ts` first. */
export type BridgeDriver = "claudeAgent" | "codex" | "cursor" | "grok" | "antigravity" | "opencode";

/** `${turn}.i${n}`: n is the order the bridge first saw the item in that turn. */
export type ItemKey = Brand.Branded<string, "ItemKey">;
/** `${session}.w${n}`: background work (a helper, a shell, a monitor). */
export type WorkKey = Brand.Branded<string, "WorkKey">;
/** `${session}.r${n}`: an approval or a question. */
export type RequestKey = Brand.Branded<string, "RequestKey">;
/** `${turn}.m${n}`: the model response a call was written in, where the driver names one. */
export type ResponseKey = Brand.Branded<string, "ResponseKey">;

/** Opaque, stored by the engine and handed back to resume the same native session. */
export interface ResumeToken {
  readonly driver: BridgeDriver;
  readonly data: unknown;
}

/** Facts the driver cannot know are `"unknown"`, never a guess. */
export type Unknown = "unknown";

// ── engine → driver: the command log ────────────────────────────────

/**
 * Why a session closes when the engine asks: a model switch (`rotate`), a
 * person's Stop on a driver whose Stop is a session close, an idle release,
 * the host shutting down.
 */
export type SessionCloseAsk = "rotate" | "asked" | "idle" | "shutdown";

export type SendMode = "new" | "steer" | "continue";

/**
 * Everything the engine asked of a driver, and what the call returned, in the
 * order the host saw it. The host interleaves these with the session's events
 * into one log; the fold reads nothing else.
 */
export type EngineCommand =
  | {
      readonly kind: "start";
      readonly session: SessionId;
      readonly from: "fresh" | "resume" | "seeded";
    }
  | { readonly kind: "started"; readonly resume?: unknown }
  | { readonly kind: "start-failed"; readonly words: string }
  | { readonly kind: "send"; readonly turn: TurnHandle; readonly mode: SendMode }
  | {
      readonly kind: "sent";
      readonly turn: TurnHandle;
      /** The turn id the driver's send returned. */
      readonly nativeTurn: string;
      readonly resume?: unknown;
    }
  | {
      readonly kind: "send-failed";
      readonly turn: TurnHandle;
      readonly words: string;
      /** The driver said its session was gone (Claude's shut prompt queue). */
      readonly sessionGone: boolean;
    }
  | { readonly kind: "interrupt"; readonly turn: TurnHandle }
  | { readonly kind: "respond"; readonly request: RequestKey }
  | { readonly kind: "compact"; readonly turn: TurnHandle }
  | { readonly kind: "stop"; readonly cause: SessionCloseAsk }
  /** The host's `stopSession` returned: the session is closed whether or not the driver said so. */
  | { readonly kind: "stopped" };

// ── driver → engine: signals ────────────────────────────────────────

export type FailureClass =
  | "provider"
  | "transport"
  | "permission"
  | "validation"
  | "stalled"
  | Unknown;

/** One per turn. The engine maps it to a run end; the bridge never decides that. */
export type TurnOutcome =
  /** The driver's word for a normal end, when it gave one: end_turn, max_tokens, refusal… */
  | { readonly kind: "completed"; readonly reason?: string }
  | { readonly kind: "interrupted" }
  | {
      readonly kind: "failed";
      readonly class: FailureClass;
      readonly words: string;
      /** The driver's terminal reason, when it gave one: prompt_too_long, api_error… */
      readonly reason?: string;
    }
  | { readonly kind: "usage-limited"; readonly resetsAt: string | Unknown; readonly words?: string }
  | {
      readonly kind: "cut";
      readonly cause: "process-exit" | "session-closed";
      readonly words?: string;
    }
  /** The message never reached the agent; safe to send again on a new session. */
  | { readonly kind: "undelivered"; readonly words: string }
  /** The driver moved on without saying how this turn ended. */
  | { readonly kind: "unknown"; readonly words: string };

export type SessionCloseCause =
  | SessionCloseAsk
  /** Claude: a Stop closes the session (it kills the CLI and every helper). */
  | "stopped-turn"
  | "process-exit"
  | "open-failed"
  | Unknown;

export type ItemStatus =
  | "running"
  | "completed"
  | "failed"
  | "declined"
  /** A call cancelled before it ran to an answer: no result, no failure (SPI 2.8). */
  | "stopped"
  /** A call still open when its turn ended: no result, never a call that came back. */
  | "unreturned"
  /** Text or reasoning still being written when its turn ended. */
  | "cut";

export type ItemBody =
  | { readonly kind: "text" }
  | { readonly kind: "reasoning" }
  | { readonly kind: "plan" }
  | { readonly kind: "compaction" }
  | {
      readonly kind: "tool";
      readonly toolKind: ToolLifecycleItemType;
      readonly call?: SpiToolCall;
      readonly title?: string;
      /** How the call presents itself, as its agent last said (SPI 2.7): an MCP tool's title and server. */
      readonly presentation?: ToolPresentation;
      /** What its row shows, as V1's activity would: its line, its facts, its Zerops result. */
      readonly facts?: CallFacts;
    }
  | { readonly kind: "error"; readonly words: string }
  | { readonly kind: "other"; readonly title?: string };

export type AppendStream = "text" | "reasoning" | "output" | "plan" | "other";

export type WorkKind = "helper" | "shell" | "monitor" | "other";
export type WorkStatus =
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "stopped"
  /** Still running when its session closed: nothing can report its end. */
  | "lost";

export type RequestAsk =
  | {
      readonly kind: "approval";
      readonly requestType: CanonicalRequestType;
      readonly detail?: string;
      readonly options?: ReadonlyArray<ProviderApprovalOption>;
    }
  | {
      readonly kind: "question";
      readonly questions: ReadonlyArray<UserInputQuestion>;
      /** Whether a typed answer is taken; `"unknown"` when the driver did not say. */
      readonly freeText: boolean | Unknown;
      /** Asked by message (Codex's async question): the agent does not wait on its answer. */
      readonly dismissible?: true;
    };

export type RequestCloseHow =
  | "answered"
  | "cancelled"
  /** Its turn ended with it still open. */
  | "superseded"
  /** Its session closed with it still open: never answerable again. */
  | "expired";

export interface SignalHeader {
  readonly session: SessionId;
  /** Strictly increasing across the translator's whole life, sessions included. */
  readonly seq: number;
}

export type SignalBody =
  // session lifecycle
  | {
      readonly type: "session.opened";
      /** `"unknown"` for a session the engine never asked for. */
      readonly resumed: boolean | Unknown;
      readonly resume?: ResumeToken;
      /**
       * The legacy host re-created the session on its own (ProviderService's
       * recovery on send, Stop or answer). The engine never asked for it.
       */
      readonly implicit: boolean;
    }
  | { readonly type: "session.cursor"; readonly resume: ResumeToken }
  | { readonly type: "session.closed"; readonly cause: SessionCloseCause; readonly words?: string }
  // sends
  | {
      readonly type: "send.accepted";
      readonly turn: TurnHandle;
      readonly as: "opened" | "steered" | "queued";
      /** steered: the running turn it joined; queued: the turn it waits behind. */
      readonly into?: TurnHandle;
    }
  | {
      readonly type: "send.refused";
      readonly turn: TurnHandle;
      readonly words: string;
      readonly undelivered: boolean | Unknown;
    }
  // turns
  | {
      readonly type: "turn.opened";
      readonly turn: TurnHandle;
      /** `self`: the agent opened it with no message from the engine (Claude's background-result turns). */
      readonly origin: "engine" | "self";
    }
  | {
      readonly type: "turn.ended";
      readonly turn: TurnHandle;
      readonly outcome: TurnOutcome;
      readonly source: TurnEndSource;
      readonly costUsd?: number;
    }
  // items
  | {
      readonly type: "item.upsert";
      readonly turn: TurnHandle;
      readonly item: ItemKey;
      readonly body: ItemBody;
      readonly status: ItemStatus;
      readonly response?: ResponseKey;
      readonly helper?: WorkKey;
      /** Arrived after its turn ended; it never reopens the turn. */
      readonly afterEnd?: true;
    }
  | {
      readonly type: "item.append";
      readonly item: ItemKey;
      readonly stream: AppendStream;
      /** The offset this text starts at: a replayed append cannot double anything. */
      readonly at: number;
      readonly text: string;
    }
  // background work
  | {
      readonly type: "work.upsert";
      readonly work: WorkKey;
      readonly origin: TurnHandle | Unknown;
      readonly kind: WorkKind;
      readonly status: WorkStatus;
      readonly title?: string;
    }
  // requests
  | {
      readonly type: "request.opened";
      readonly request: RequestKey;
      readonly turn?: TurnHandle;
      readonly ask: RequestAsk;
    }
  | { readonly type: "request.closed"; readonly request: RequestKey; readonly how: RequestCloseHow }
  // usage
  | { readonly type: "usage.context"; readonly usage: ThreadTokenUsageSnapshot }
  | {
      /**
       * A usage window refuses new requests and no turn ended for it. With a
       * turn, the turn is parked inside the driver (Claude); without one, the
       * limit was seen between turns. A turn a limit ended carries
       * `usage-limited` in its outcome instead.
       */
      readonly type: "usage.limit";
      readonly effect: "parks-turn" | "between-turns";
      readonly turn?: TurnHandle;
      readonly window?: string;
      readonly resetsAt: string | Unknown;
    }
  | {
      readonly type: "context.compacted";
      readonly turn?: TurnHandle;
      readonly beforeTokens?: number;
      readonly afterTokens?: number;
      readonly automatic: boolean | Unknown;
    }
  | {
      readonly type: "plan.updated";
      readonly turn: TurnHandle;
      readonly steps: ReadonlyArray<RuntimePlanStep>;
      readonly explanation?: string;
      readonly proposal?: string;
    }
  | {
      readonly type: "notice";
      readonly level: "warning" | "error";
      readonly words: string;
      readonly class?: RuntimeErrorClass;
      readonly turn?: TurnHandle;
    };

export type DriverSignal = SignalHeader & SignalBody;

// ── the matrix as data ──────────────────────────────────────────────

/** What the engine may expect of a driver, and what it must say the driver cannot tell. */
export interface DriverCapabilities {
  /** When the driver's send returns: once it holds the message, or at the turn's end (ACP today). */
  readonly sendReturns: "on-accept" | "on-turn-end";
  /** native: joins the running turn; driver-queue: the driver runs it after; none: the engine must hold it. */
  readonly steer: "native" | "driver-queue" | "none";
  readonly interrupt: {
    /** The agent itself acknowledges a Stop (otherwise the end is local). */
    readonly confirmedByAgent: boolean;
    /** A Stop closes the whole session: helpers and background work die with it. */
    readonly closesSession: boolean;
  };
  /** Who ends a turn when the process dies: the driver, or the bridge from `session.exited`. */
  readonly crashTerminal: "driver" | "bridge";
  /** The agent opens turns with no message from the engine. */
  readonly selfTurns: boolean;
  /** A send that met a closed session never reached the agent: safe to send again. */
  readonly closedSendUndelivered: boolean;
  readonly usageLimit: {
    /** The driver tells a usage limit from any other failure. */
    readonly typed: boolean;
    /** A limit parks the running turn with no terminal (Claude), rather than ending it. */
    readonly parksTurn: boolean;
    /** The driver says when the window reopens. */
    readonly resetTime: boolean;
  };
  readonly usage: { readonly context: boolean; readonly spend: boolean };
  readonly backgroundWork: "full" | "partial" | "none";
  readonly questions: "structured" | "options-only";
  readonly compaction: { readonly reported: boolean; readonly automatic: "reported" | Unknown };
  readonly responses: "tool-calls" | "none";
  readonly resume: "session-id" | "thread-resume" | "acp-load" | "acp-resume" | "session-get";
  /** How a turn cut by a restart can go on: an empty native turn, or a prompt. */
  readonly continuation: "native" | "prompted";
}
