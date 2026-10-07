/**
 * The driver bridge: a pure fold from one conversation thread's legacy
 * `ProviderRuntimeEvent` stream, interleaved with the commands the engine
 * sent, into SPI 3.0 signals (`spi3.ts`).
 *
 * The host (effectful, not here) subscribes to ProviderService's stream,
 * filters it to the thread, records each command and its result, and feeds
 * both in the order it saw them. Everything driver-specific the fold does is
 * read from `capabilities.ts`; it never calls anything, never reads a clock,
 * and the same log always gives the same signals.
 *
 * What it guarantees:
 * - one `turn.ended` per opened turn, with the source of that end — the agent,
 *   a Stop the agent confirmed, a Stop it did not, or the bridge's inference
 *   from a crash, a close or the next turn;
 * - every item, request and piece of work has an app key, never a native id;
 * - a late item never reopens a turn: it carries `afterEnd`;
 * - an open call is closed `unreturned` at its turn's end, an open request
 *   `superseded`, and at a session's close every live work is `lost` and every
 *   open request `expired`.
 *
 * Its state lives in memory: a host restart kills every driver process, so the
 * engine's own boot ends what was open and a new session starts a new fold.
 */
import {
  classifyTaskAgentKind,
  isToolLifecycleItemType,
  type ProviderRuntimeEvent,
  type RuntimeErrorClass,
  type RuntimeTaskStatus,
  type SpiEvent,
} from "@t3tools/contracts";

import { applyToolCall } from "../../spi/toolCall.ts";
import { DRIVER_CAPABILITIES } from "./capabilities.ts";
import type {
  AppendStream,
  BridgeDriver,
  DriverSignal,
  EngineCommand,
  FailureClass,
  ItemBody,
  ItemKey,
  ItemStatus,
  RequestKey,
  ResponseKey,
  SessionCloseAsk,
  SessionCloseCause,
  SessionId,
  SignalBody,
  TurnEndSource,
  TurnHandle,
  TurnOutcome,
  Unknown,
  WorkKey,
  WorkKind,
  WorkStatus,
} from "./spi3.ts";

export type BridgeInput = { readonly kind: "event"; readonly event: SpiEvent } | EngineCommand;

export interface TranslatorOptions {
  readonly driver: BridgeDriver;
  /** The ProviderService thread the conversation's sessions run on. */
  readonly threadId: string;
}

/** An input the fold could not place, kept for logs and tests; it emits nothing. */
export interface DroppedInput {
  readonly reason: "no-session" | "other-thread" | "no-turn" | "unknown-turn";
  readonly type: string;
}

/** What the host answers a request with: the driver's own id, and which call takes the answer. */
export interface NativeRequest {
  readonly id: string;
  readonly kind: "approval" | "question";
}

export interface Translator {
  readonly step: (input: BridgeInput) => ReadonlyArray<DriverSignal>;
  readonly dropped: () => ReadonlyArray<DroppedInput>;
  /** The driver's own id for a turn, once the driver named it: what an interrupt is sent for. */
  readonly nativeTurn: (turn: TurnHandle) => string | undefined;
  /** An open request's native id and kind; none once it closed: nothing can take an answer. */
  readonly nativeRequest: (key: RequestKey) => NativeRequest | undefined;
  /** What the fold holds now, for its bounds: it never grows with a session's length. */
  readonly retained: () => {
    readonly turns: number;
    readonly items: number;
    readonly requests: number;
    readonly dropped: number;
  };
}

/** Ended turns a session remembers, for what arrives after their end. */
export const KEPT_ENDED_TURNS = 8;
/** Inputs it could not place, remembered for logs and tests. */
export const KEPT_DROPPED = 100;

/** The whole log at once. */
export function translate(
  options: TranslatorOptions,
  inputs: ReadonlyArray<BridgeInput>,
): ReadonlyArray<DriverSignal> {
  const translator = makeTranslator(options);
  return inputs.flatMap((input) => translator.step(input));
}

// ── state ───────────────────────────────────────────────────────────

type TurnPhase =
  /** Sent, its turn not seen yet. */
  | "pending"
  /** Bound to a native turn the driver runs after the open one (Codex). */
  | "queued"
  | "open"
  | "ended"
  /** Joined another turn (a steer); it has no end of its own. */
  | "joined"
  /** Never reached a turn: the send failed or its session closed first. */
  | "refused";

interface TurnState {
  readonly handle: TurnHandle;
  readonly session: SessionState;
  phase: TurnPhase;
  native?: string;
  joinedInto?: TurnHandle;
  accepted: boolean;
  stopAsked: boolean;
  lastError?: { readonly class?: RuntimeErrorClass; readonly words: string };
  itemCount: number;
  readonly responses: Map<string, ResponseKey>;
  /** Items the bridge made for deltas that name no item (ACP reasoning). */
  readonly synthetic: Map<AppendStream, ItemState>;
  readonly parkedWindows: Set<string>;
}

interface ItemState {
  readonly key: ItemKey;
  readonly turn: TurnState;
  body: ItemBody;
  status: ItemStatus;
  response?: ResponseKey;
  helper?: WorkKey;
  readonly offsets: Map<AppendStream, number>;
}

interface WorkState {
  readonly key: WorkKey;
  origin: TurnHandle | Unknown;
  kind?: WorkKind;
  status?: WorkStatus;
  title?: string | undefined;
}

interface RequestState {
  readonly key: RequestKey;
  readonly session: SessionState;
  readonly turn?: TurnState;
  readonly kind: NativeRequest["kind"];
  readonly native?: string;
  open: boolean;
}

interface SessionState {
  readonly key: SessionId;
  phase: "opening" | "open" | "closed";
  readonly from: "fresh" | "resume" | "seeded" | "implicit";
  closeAsked?: SessionCloseAsk;
  compactAsked: boolean;
  sawProcessExit: boolean;
  lastResume?: string;
  lastBlocked?: { readonly window: string; readonly resetsAt: string };
  open?: TurnState | undefined;
  last?: TurnState | undefined;
  readonly nativeTurns: Map<string, TurnState>;
  /** Sends not yet bound to a turn, oldest first. */
  readonly pending: Array<TurnState>;
  readonly items: Map<string, ItemState>;
  readonly work: Map<string, WorkState>;
  workCount: number;
  readonly requests: Map<string, RequestState>;
  requestCount: number;
  selfCount: number;
  /** Its turns that ended (or never began), oldest first: the oldest are forgotten. */
  readonly ended: Array<TurnState>;
}

// ── the fold ────────────────────────────────────────────────────────

export function makeTranslator(options: TranslatorOptions): Translator {
  const caps = DRIVER_CAPABILITIES[options.driver];
  const turns = new Map<TurnHandle, TurnState>();
  const requestsByKey = new Map<RequestKey, RequestState>();
  const dropped: Array<DroppedInput> = [];
  let session: SessionState | undefined;
  let implicitCount = 0;
  let seq = 0;
  let out: Array<DriverSignal> = [];

  const emit = (into: SessionState, body: SignalBody) => {
    seq += 1;
    out.push({ session: into.key, seq, ...body } as DriverSignal);
  };
  const drop = (reason: DroppedInput["reason"], type: string) => {
    dropped.push({ reason, type });
    if (dropped.length > KEPT_DROPPED) dropped.shift();
  };

  const newSession = (
    key: SessionId,
    from: SessionState["from"],
    phase: SessionState["phase"],
  ): SessionState => ({
    key,
    phase,
    from,
    compactAsked: false,
    sawProcessExit: false,
    nativeTurns: new Map(),
    pending: [],
    items: new Map(),
    work: new Map(),
    workCount: 0,
    requests: new Map(),
    requestCount: 0,
    selfCount: 0,
    ended: [],
  });

  const newTurn = (handle: TurnHandle, owner: SessionState): TurnState => {
    const turn: TurnState = {
      handle,
      session: owner,
      phase: "pending",
      accepted: false,
      stopAsked: false,
      itemCount: 0,
      responses: new Map(),
      synthetic: new Map(),
      parkedWindows: new Set(),
    };
    turns.set(handle, turn);
    return turn;
  };

  const noteResume = (owner: SessionState, resume: unknown) => {
    if (resume === undefined) return;
    const encoded = JSON.stringify(resume);
    if (encoded === owner.lastResume) return;
    owner.lastResume = encoded;
    emit(owner, { type: "session.cursor", resume: { driver: options.driver, data: resume } });
  };

  // ── turns ──

  const openTurn = (turn: TurnState, origin: "engine" | "self") => {
    const owner = turn.session;
    if (owner.open !== undefined && owner.open !== turn) {
      endTurn(
        owner.open,
        { kind: "unknown", words: "Another turn opened before this one ended." },
        "inferred-from-next-turn",
      );
    }
    removePending(turn);
    turn.phase = "open";
    owner.open = turn;
    owner.last = turn;
    emit(owner, { type: "turn.opened", turn: turn.handle, origin });
    if (origin === "engine" && !turn.accepted) {
      turn.accepted = true;
      emit(owner, { type: "send.accepted", turn: turn.handle, as: "opened" });
    }
  };

  const removePending = (turn: TurnState) => {
    const index = turn.session.pending.indexOf(turn);
    if (index >= 0) turn.session.pending.splice(index, 1);
  };

  const workIsLive = (owner: SessionState, key: WorkKey | undefined) => {
    if (key === undefined) return false;
    for (const work of owner.work.values()) {
      if (work.key === key) {
        return work.status === undefined || isLiveWork(work.status);
      }
    }
    return false;
  };

  const endTurn = (
    turn: TurnState,
    outcome: TurnOutcome,
    source: TurnEndSource,
    costUsd?: number,
  ) => {
    if (turn.phase !== "open") return;
    const owner = turn.session;
    // Open items close with the turn: a call never came back, text stopped
    // where it was. A helper's call outlives the turn while its helper works.
    for (const item of owner.items.values()) {
      if (item.turn !== turn || item.status !== "running") continue;
      if (item.body.kind === "tool") {
        if (workIsLive(owner, item.helper)) continue;
        upsertItem(item, "unreturned");
      } else {
        upsertItem(item, outcome.kind === "completed" ? "completed" : "cut");
      }
    }
    for (const request of owner.requests.values()) {
      if (request.open && request.turn === turn) closeRequest(request, "superseded");
    }
    turn.phase = "ended";
    if (owner.open === turn) owner.open = undefined;
    emit(owner, {
      type: "turn.ended",
      turn: turn.handle,
      outcome,
      source,
      ...(costUsd === undefined ? {} : { costUsd }),
    });
    remember(turn);
  };

  /** A turn that is over is kept for what arrives late, until newer ones push it out. */
  const remember = (turn: TurnState) => {
    const owner = turn.session;
    owner.ended.push(turn);
    while (owner.ended.length > KEPT_ENDED_TURNS) forget(owner.ended.shift()!);
  };

  const forget = (turn: TurnState) => {
    const owner = turn.session;
    turns.delete(turn.handle);
    if (turn.native !== undefined && owner.nativeTurns.get(turn.native) === turn) {
      owner.nativeTurns.delete(turn.native);
    }
    for (const [id, item] of owner.items) if (item.turn === turn) owner.items.delete(id);
    for (const [id, work] of owner.work) {
      if (work.origin === turn.handle && (work.status === undefined || !isLiveWork(work.status))) {
        owner.work.delete(id);
      }
    }
  };

  /** Who ended an interrupted turn: the agent on its own, or a Stop it did or did not confirm. */
  const stopSource = (turn: TurnState): TurnEndSource => {
    if (!turn.stopAsked) return "agent";
    return caps.interrupt.confirmedByAgent ? "stop-confirmed" : "stop-asked";
  };

  const afterStop = (turn: TurnState) => {
    // Claude's Stop closes the whole session: the CLI and every helper die.
    if (turn.stopAsked && caps.interrupt.closesSession && turn.session.phase !== "closed") {
      closeSession(turn.session, "stopped-turn");
    }
  };

  const failureOutcome = (turn: TurnState, words: string, terminalReason?: string): TurnOutcome => {
    const said = turn.lastError;
    if (terminalReason === "usage_limit" || said?.class === "usage_limit") {
      return {
        kind: "usage-limited",
        resetsAt: turn.session.lastBlocked?.resetsAt ?? "unknown",
        words,
      };
    }
    if (terminalReason === "process_exit" || said?.class === "process_exit") {
      return { kind: "cut", cause: "process-exit", words };
    }
    return { kind: "failed", class: failureClass(options.driver, said?.class, words), words };
  };

  // ── sessions ──

  const closeSession = (owner: SessionState, cause: SessionCloseCause, words?: string) => {
    if (owner.phase === "closed") return;
    const turn = owner.open;
    if (turn !== undefined) {
      if (owner.closeAsked !== undefined) {
        endTurn(turn, { kind: "cut", cause: "session-closed" }, "inferred-from-close");
      } else if (turn.stopAsked) {
        endTurn(turn, { kind: "interrupted" }, "stop-asked");
      } else if (cause === "process-exit") {
        endTurn(
          turn,
          {
            kind: "cut",
            cause: "process-exit",
            ...definedWords(turn.lastError?.words ?? words),
          },
          "inferred-from-crash",
        );
      } else {
        endTurn(
          turn,
          { kind: "cut", cause: "session-closed", ...definedWords(words) },
          "inferred-from-close",
        );
      }
    }
    for (const queued of turns.values()) {
      if (queued.session !== owner || queued.phase !== "queued") continue;
      queued.phase = "refused";
      emit(owner, {
        type: "send.refused",
        turn: queued.handle,
        words: "Its session closed before it began.",
        undelivered: "unknown",
      });
    }
    for (const work of owner.work.values()) {
      if (work.status !== undefined && isLiveWork(work.status)) {
        work.status = "lost";
        emitWork(owner, work);
      }
    }
    for (const request of owner.requests.values()) {
      if (request.open) closeRequest(request, "expired");
    }
    owner.phase = "closed";
    owner.open = undefined;
    emit(owner, { type: "session.closed", cause, ...definedWords(words) });
    // Nothing of a closed session is read again: its events are dropped from now on.
    for (const [handle, turn] of turns) if (turn.session === owner) turns.delete(handle);
    owner.items.clear();
    owner.work.clear();
    owner.requests.clear();
    owner.nativeTurns.clear();
    owner.pending.length = 0;
    owner.ended.length = 0;
  };

  // ── items ──

  const upsertItem = (item: ItemState, status: ItemStatus) => {
    item.status = status;
    emit(item.turn.session, {
      type: "item.upsert",
      turn: item.turn.handle,
      item: item.key,
      body: item.body,
      status,
      ...(item.response === undefined ? {} : { response: item.response }),
      ...(item.helper === undefined ? {} : { helper: item.helper }),
      ...(item.turn.phase === "ended" ? { afterEnd: true as const } : {}),
    });
  };

  const newItem = (turn: TurnState, body: ItemBody): ItemState => {
    if (body.kind !== "reasoning") closeSyntheticReasoning(turn);
    turn.itemCount += 1;
    return {
      key: `${turn.handle}.i${turn.itemCount}` as ItemKey,
      turn,
      body,
      status: "running",
      offsets: new Map(),
    };
  };

  const closeSyntheticReasoning = (turn: TurnState) => {
    const reasoning = turn.synthetic.get("reasoning");
    if (reasoning === undefined) return;
    turn.synthetic.delete("reasoning");
    if (reasoning.status === "running") upsertItem(reasoning, "completed");
  };

  /** The turn an event belongs to: its own, the open one, or the last one (late). */
  const turnOf = (owner: SessionState, event: SpiEvent): TurnState | undefined => {
    if (event.turnId !== undefined) {
      const turn = owner.nativeTurns.get(String(event.turnId));
      if (turn === undefined) drop("unknown-turn", event.type);
      return turn;
    }
    const turn = owner.open ?? owner.last;
    if (turn === undefined) drop("no-turn", event.type);
    return turn;
  };

  const workFor = (owner: SessionState, nativeIds: ReadonlyArray<string | undefined>) => {
    let work: WorkState | undefined;
    for (const id of nativeIds) {
      if (id === undefined) continue;
      work ??= owner.work.get(id);
    }
    if (work === undefined) {
      owner.workCount += 1;
      work = { key: `${owner.key}.w${owner.workCount}` as WorkKey, origin: "unknown" };
    }
    for (const id of nativeIds) {
      if (id !== undefined) owner.work.set(id, work);
    }
    return work;
  };

  const emitWork = (owner: SessionState, work: WorkState) => {
    emit(owner, {
      type: "work.upsert",
      work: work.key,
      origin: work.origin,
      kind: work.kind ?? "other",
      status: work.status ?? "running",
      ...(work.title === undefined ? {} : { title: work.title }),
    });
  };

  const onItemLifecycle = (
    owner: SessionState,
    event: Extract<
      ProviderRuntimeEvent,
      { type: "item.started" | "item.updated" | "item.completed" }
    > &
      SpiEvent,
  ) => {
    const payload = event.payload;
    if (payload.itemType === "user_message") return;
    const nativeId = event.itemId === undefined ? undefined : String(event.itemId);
    let item = nativeId === undefined ? undefined : owner.items.get(nativeId);
    if (item === undefined) {
      const turn = turnOf(owner, event);
      if (turn === undefined) return;
      item = newItem(turn, itemBody(event));
      if (nativeId !== undefined) owner.items.set(nativeId, item);
    } else {
      item.body = itemBody(event);
    }
    if (payload.responseId !== undefined && item.response === undefined) {
      item.response = responseKey(item.turn, payload.responseId);
    }
    const helperId = payload.agentId ?? payload.parentToolUseId;
    if (helperId !== undefined && item.helper === undefined) {
      item.helper = workFor(owner, [helperId]).key;
    }
    upsertItem(item, itemStatus(event));
  };

  const responseKey = (turn: TurnState, nativeId: string): ResponseKey => {
    const known = turn.responses.get(nativeId);
    if (known !== undefined) return known;
    const key = `${turn.handle}.m${turn.responses.size + 1}` as ResponseKey;
    turn.responses.set(nativeId, key);
    return key;
  };

  const onDelta = (
    owner: SessionState,
    event: Extract<ProviderRuntimeEvent, { type: "content.delta" }>,
  ) => {
    const stream = appendStream(event.payload.streamKind);
    const nativeId = event.itemId === undefined ? undefined : String(event.itemId);
    let item = nativeId === undefined ? undefined : owner.items.get(nativeId);
    if (item === undefined) {
      const turn = turnOf(owner, event);
      if (turn === undefined) return;
      item = nativeId === undefined ? turn.synthetic.get(stream) : undefined;
      if (item === undefined) {
        item = newItem(turn, bodyForStream(stream));
        if (nativeId === undefined) turn.synthetic.set(stream, item);
        else owner.items.set(nativeId, item);
        upsertItem(item, "running");
      }
    }
    const at = item.offsets.get(stream) ?? 0;
    item.offsets.set(stream, at + event.payload.delta.length);
    emit(owner, {
      type: "item.append",
      item: item.key,
      stream,
      at,
      text: event.payload.delta,
    });
  };

  // ── requests ──

  const closeRequest = (
    request: RequestState,
    how: "answered" | "cancelled" | "superseded" | "expired",
  ) => {
    request.open = false;
    requestsByKey.delete(request.key);
    if (request.native !== undefined) request.session.requests.delete(request.native);
    emit(request.session, { type: "request.closed", request: request.key, how });
  };

  const openRequest = (
    owner: SessionState,
    event: SpiEvent,
    kind: NativeRequest["kind"],
  ): RequestState => {
    owner.requestCount += 1;
    const turn =
      event.turnId === undefined ? owner.open : owner.nativeTurns.get(String(event.turnId));
    const request: RequestState = {
      key: `${owner.key}.r${owner.requestCount}` as RequestKey,
      session: owner,
      ...(turn !== undefined && turn.phase === "open" ? { turn } : {}),
      kind,
      ...(event.requestId === undefined ? {} : { native: String(event.requestId) }),
      open: true,
    };
    if (event.requestId !== undefined) owner.requests.set(String(event.requestId), request);
    requestsByKey.set(request.key, request);
    return request;
  };

  // ── events ──

  const onEvent = (event: SpiEvent) => {
    if (String(event.threadId) !== options.threadId) {
      drop("other-thread", event.type);
      return;
    }
    if (event.type === "session.started" && (session === undefined || session.phase === "closed")) {
      // Nothing asked for it: the legacy host recovered a session on its own.
      implicitCount += 1;
      session = newSession(
        `${options.threadId}.implicit${implicitCount}` as SessionId,
        "implicit",
        "open",
      );
      emit(session, { type: "session.opened", resumed: "unknown", implicit: true });
      return;
    }
    const owner = session;
    if (owner === undefined || owner.phase === "closed") {
      drop("no-session", event.type);
      return;
    }

    switch (event.type) {
      case "turn.started": {
        const nativeId = event.turnId === undefined ? undefined : String(event.turnId);
        const bound = nativeId === undefined ? undefined : owner.nativeTurns.get(nativeId);
        if (bound !== undefined) {
          if (bound.phase === "queued" || bound.phase === "pending") openTurn(bound, "engine");
          return;
        }
        const self = isSelfTurnStart(event) || owner.pending.length === 0;
        let turn: TurnState;
        if (self) {
          owner.selfCount += 1;
          turn = newTurn(`${owner.key}.self${owner.selfCount}` as TurnHandle, owner);
        } else {
          turn = owner.pending[0]!;
        }
        if (nativeId !== undefined) {
          turn.native = nativeId;
          owner.nativeTurns.set(nativeId, turn);
        }
        openTurn(turn, self ? "self" : "engine");
        return;
      }
      case "turn.completed": {
        const turn = terminalTurn(owner, event);
        if (turn === undefined) return;
        const payload = event.payload;
        const words =
          payload.errorMessage ?? turn.lastError?.words ?? payload.terminalReason ?? payload.state;
        let outcome: TurnOutcome;
        let source: TurnEndSource = "agent";
        if (owner.closeAsked !== undefined && payload.state !== "completed") {
          outcome = { kind: "cut", cause: "session-closed" };
          source = "inferred-from-close";
        } else if (payload.state === "completed") {
          const reason = completedReason(payload.terminalReason, payload.stopReason);
          outcome = { kind: "completed", ...(reason === undefined ? {} : { reason }) };
        } else if (payload.state === "interrupted" || payload.state === "cancelled") {
          outcome = { kind: "interrupted" };
          source = stopSource(turn);
        } else if (turn.stopAsked) {
          outcome = { kind: "interrupted" };
          source = stopSource(turn);
        } else {
          outcome = failureOutcome(turn, words, payload.terminalReason);
        }
        endTurn(turn, outcome, source, payload.totalCostUsd);
        if (outcome.kind === "interrupted") afterStop(turn);
        return;
      }
      case "turn.aborted": {
        const turn = terminalTurn(owner, event);
        if (turn === undefined) return;
        if (owner.closeAsked !== undefined) {
          endTurn(turn, { kind: "cut", cause: "session-closed" }, "inferred-from-close");
          return;
        }
        endTurn(turn, { kind: "interrupted" }, turn.stopAsked ? "stop-confirmed" : "agent");
        afterStop(turn);
        return;
      }
      case "session.exited": {
        const exitKind = event.payload.exitKind;
        const cause: SessionCloseCause =
          owner.closeAsked ??
          (owner.open?.stopAsked && caps.interrupt.closesSession
            ? "stopped-turn"
            : owner.sawProcessExit || exitKind !== "graceful"
              ? "process-exit"
              : "unknown");
        closeSession(owner, cause, event.payload.reason);
        return;
      }
      case "item.started":
      case "item.updated":
      case "item.completed":
        onItemLifecycle(owner, event);
        return;
      case "content.delta":
        onDelta(owner, event);
        return;
      case "tool.denied": {
        const nativeId = event.payload.toolUseId;
        let item = nativeId === undefined ? undefined : owner.items.get(nativeId);
        if (item === undefined) {
          const turn = turnOf(owner, event);
          if (turn === undefined) return;
          item = newItem(turn, { kind: "other", title: event.payload.toolName });
          if (nativeId !== undefined) owner.items.set(nativeId, item);
        }
        upsertItem(item, "declined");
        return;
      }
      case "task.started":
      case "task.progress":
      case "task.updated":
      case "task.completed": {
        const payload = event.payload;
        const work = workFor(owner, [String(payload.taskId), payload.toolUseId]);
        const before = JSON.stringify([work.kind, work.status, work.title, work.origin]);
        if (work.origin === "unknown" && event.turnId !== undefined) {
          const origin = owner.nativeTurns.get(String(event.turnId));
          if (origin !== undefined) work.origin = origin.handle;
        }
        if (
          work.kind === undefined ||
          payload.agentKind !== undefined ||
          payload.taskType !== undefined
        ) {
          work.kind = workKind(payload.agentKind, payload.taskType, payload.agentId);
        }
        work.title =
          ("description" in payload ? payload.description : undefined) ??
          payload.title ??
          work.title;
        work.status = taskStatus(event, work.status);
        if (JSON.stringify([work.kind, work.status, work.title, work.origin]) !== before) {
          emitWork(owner, work);
        }
        return;
      }
      case "request.opened": {
        const request = openRequest(owner, event, "approval");
        const payload = event.payload;
        emit(owner, {
          type: "request.opened",
          request: request.key,
          ...(request.turn === undefined ? {} : { turn: request.turn.handle }),
          ask: {
            kind: "approval",
            requestType: payload.requestType,
            ...(payload.detail === undefined ? {} : { detail: payload.detail }),
            ...(payload.options === undefined ? {} : { options: payload.options }),
          },
        });
        return;
      }
      case "user-input.requested": {
        const request = openRequest(owner, event, "question");
        const questions = event.payload.questions;
        emit(owner, {
          type: "request.opened",
          request: request.key,
          ...(request.turn === undefined ? {} : { turn: request.turn.handle }),
          ask: {
            kind: "question",
            questions,
            freeText:
              caps.questions === "options-only"
                ? false
                : questions.some((question) => question.allowCustomAnswer === true)
                  ? true
                  : questions.length > 0 &&
                      questions.every((question) => question.allowCustomAnswer === false)
                    ? false
                    : "unknown",
          },
        });
        return;
      }
      case "request.resolved":
      case "user-input.resolved": {
        const request =
          event.requestId === undefined ? undefined : owner.requests.get(String(event.requestId));
        if (request === undefined || !request.open) return;
        closeRequest(
          request,
          event.type === "request.resolved" && event.payload.decision === "cancel"
            ? "cancelled"
            : "answered",
        );
        return;
      }
      case "thread.token-usage.updated":
        emit(owner, { type: "usage.context", usage: event.payload.usage });
        return;
      case "account.rate-limits.updated": {
        // A refused window with no believable reset parks the turn all the same: until unknown.
        const refused = event.payload.refused;
        const blocked =
          event.payload.blocked ??
          (refused === undefined ? undefined : { window: refused.window, resetsAt: "unknown" });
        if (blocked === undefined) return;
        owner.lastBlocked = blocked;
        const turn = owner.open;
        if (turn === undefined) {
          emit(owner, {
            type: "usage.limit",
            effect: "between-turns",
            window: blocked.window,
            resetsAt: blocked.resetsAt,
          });
          return;
        }
        if (!caps.usageLimit.parksTurn || turn.parkedWindows.has(blocked.window)) return;
        turn.parkedWindows.add(blocked.window);
        emit(owner, {
          type: "usage.limit",
          effect: "parks-turn",
          turn: turn.handle,
          window: blocked.window,
          resetsAt: blocked.resetsAt,
        });
        return;
      }
      case "thread.state.changed": {
        if (event.payload.state !== "compacted") return;
        const automatic: boolean | Unknown = owner.compactAsked
          ? false
          : caps.compaction.automatic === "reported"
            ? true
            : "unknown";
        owner.compactAsked = false;
        emit(owner, {
          type: "context.compacted",
          ...(owner.open === undefined ? {} : { turn: owner.open.handle }),
          ...(event.payload.beforeTokens === undefined
            ? {}
            : { beforeTokens: event.payload.beforeTokens }),
          ...(event.payload.afterTokens === undefined
            ? {}
            : { afterTokens: event.payload.afterTokens }),
          automatic,
        });
        return;
      }
      case "turn.plan.updated":
      case "turn.proposed.completed": {
        const turn = turnOf(owner, event);
        if (turn === undefined || turn.phase !== "open") return;
        emit(
          owner,
          event.type === "turn.plan.updated"
            ? {
                type: "plan.updated",
                turn: turn.handle,
                steps: event.payload.plan,
                ...(event.payload.explanation ? { explanation: event.payload.explanation } : {}),
              }
            : {
                type: "plan.updated",
                turn: turn.handle,
                steps: [],
                proposal: event.payload.planMarkdown,
              },
        );
        return;
      }
      case "runtime.error": {
        const errorClass = event.payload.class;
        if (errorClass === "process_exit") owner.sawProcessExit = true;
        const turn =
          event.turnId === undefined ? owner.open : owner.nativeTurns.get(String(event.turnId));
        if (turn !== undefined && turn.phase === "open") {
          turn.lastError = {
            ...(errorClass === undefined ? {} : { class: errorClass }),
            words: event.payload.message,
          };
        }
        emit(owner, {
          type: "notice",
          level: "error",
          words: event.payload.message,
          ...(errorClass === undefined ? {} : { class: errorClass }),
          ...(turn === undefined ? {} : { turn: turn.handle }),
        });
        return;
      }
      case "runtime.warning":
        emit(owner, { type: "notice", level: "warning", words: event.payload.message });
        return;
      case "config.warning":
      case "deprecation.notice":
        emit(owner, { type: "notice", level: "warning", words: event.payload.summary });
        return;
      case "model.rerouted":
        emit(owner, {
          type: "notice",
          level: "warning",
          words: `${event.payload.fromModel} → ${event.payload.toModel}: ${event.payload.reason}`,
        });
        return;
      default:
        // session.started|configured|state.changed, thread.started|metadata,
        // hook.*, tool.progress|summary, realtime, diff, files, auth, account,
        // mcp: the engine never derives a run's state from them.
        return;
    }
  };

  const terminalTurn = (owner: SessionState, event: SpiEvent): TurnState | undefined => {
    const turn =
      event.turnId === undefined ? owner.open : owner.nativeTurns.get(String(event.turnId));
    if (turn === undefined) {
      drop(event.turnId === undefined ? "no-turn" : "unknown-turn", event.type);
      return undefined;
    }
    // A queued turn whose end comes first opens on it, so every end has its opening.
    if (turn.phase === "queued") openTurn(turn, "engine");
    // Exactly once: a second end for an ended turn is dropped.
    return turn.phase === "open" ? turn : undefined;
  };

  // ── commands ──

  const onCommand = (command: EngineCommand) => {
    if (command.kind === "start") {
      if (session !== undefined && session.phase !== "closed") closeSession(session, "unknown");
      session = newSession(command.session, command.from, "opening");
      return;
    }
    const owner = session;
    if (owner === undefined) {
      drop("no-session", command.kind);
      return;
    }
    switch (command.kind) {
      case "started": {
        owner.phase = "open";
        if (command.resume !== undefined) owner.lastResume = JSON.stringify(command.resume);
        emit(owner, {
          type: "session.opened",
          resumed: owner.from === "resume",
          ...(command.resume === undefined
            ? {}
            : { resume: { driver: options.driver, data: command.resume } }),
          implicit: false,
        });
        return;
      }
      case "start-failed":
        closeSession(owner, "open-failed", command.words);
        return;
      case "send": {
        const turn = newTurn(command.turn, owner);
        owner.pending.push(turn);
        return;
      }
      case "sent": {
        const turn = turns.get(command.turn);
        if (turn === undefined) return;
        noteResume(turn.session, command.resume);
        if (turn.phase !== "pending") return;
        const bound = owner.nativeTurns.get(command.nativeTurn);
        if (bound !== undefined && bound !== turn) {
          // The driver took it into a running turn (Claude, OpenCode).
          removePending(turn);
          turn.phase = "joined";
          turn.joinedInto = bound.handle;
          turn.accepted = true;
          if (turn.stopAsked) bound.stopAsked = true;
          emit(owner, {
            type: "send.accepted",
            turn: turn.handle,
            as: "steered",
            into: bound.handle,
          });
          remember(turn);
          return;
        }
        turn.native = command.nativeTurn;
        owner.nativeTurns.set(command.nativeTurn, turn);
        if (owner.open !== undefined) {
          // The driver runs it after the open turn (Codex).
          removePending(turn);
          turn.phase = "queued";
          turn.accepted = true;
          emit(owner, {
            type: "send.accepted",
            turn: turn.handle,
            as: "queued",
            into: owner.open.handle,
          });
          return;
        }
        openTurn(turn, "engine");
        return;
      }
      case "send-failed": {
        const turn = turns.get(command.turn);
        if (turn === undefined) return;
        if (turn.phase === "pending" || turn.phase === "queued") {
          removePending(turn);
          turn.phase = "refused";
          emit(turn.session, {
            type: "send.refused",
            turn: turn.handle,
            words: command.words,
            undelivered: command.sessionGone
              ? caps.closedSendUndelivered
                ? true
                : "unknown"
              : true,
          });
          remember(turn);
          return;
        }
        if (turn.phase !== "open") return;
        if (command.sessionGone) {
          // Claude's prompt queue was shut after its turn opened (its stream had ended).
          endTurn(turn, { kind: "undelivered", words: command.words }, "inferred-from-crash");
          return;
        }
        endTurn(turn, failureOutcome(turn, command.words), "agent");
        return;
      }
      case "interrupt": {
        const turn = turns.get(command.turn);
        if (turn === undefined) return;
        const target = turn.phase === "joined" ? turns.get(turn.joinedInto!) : turn;
        if (target !== undefined) target.stopAsked = true;
        return;
      }
      case "respond":
        // The answer's close comes from the driver's resolved event.
        return;
      case "compact":
        owner.compactAsked = true;
        return;
      case "stop":
        owner.closeAsked = command.cause;
        return;
      case "stopped":
        closeSession(owner, owner.closeAsked ?? "unknown");
        return;
    }
  };

  return {
    step: (input) => {
      out = [];
      if (input.kind === "event") onEvent(input.event);
      else onCommand(input);
      return out;
    },
    dropped: () => dropped,
    nativeTurn: (turn) => turns.get(turn)?.native,
    retained: () => ({
      turns: turns.size,
      items: session?.items.size ?? 0,
      requests: requestsByKey.size,
      dropped: dropped.length,
    }),
    nativeRequest: (key) => {
      const request = requestsByKey.get(key);
      return request?.open === true && request.native !== undefined
        ? { id: request.native, kind: request.kind }
        : undefined;
    },
  };
}

// ── pure helpers ────────────────────────────────────────────────────

/**
 * The bridge's one read of `raw`: Claude marks a turn it opened by itself to
 * hand the model a background result. Nothing else tells it from a send's turn.
 */
function isSelfTurnStart(event: SpiEvent): boolean {
  return event.raw?.method === "claude/synthetic-turn-start";
}

const definedWords = (words: string | undefined) => (words === undefined ? {} : { words });

const isLiveWork = (status: WorkStatus) =>
  status === "running" || status === "waiting" || status === "idle";

function completedReason(
  terminalReason: string | undefined,
  stopReason: string | null | undefined,
): string | undefined {
  if (terminalReason !== undefined && terminalReason !== "completed") return terminalReason;
  return stopReason ?? terminalReason;
}

function failureClass(
  driver: BridgeDriver,
  said: RuntimeErrorClass | undefined,
  words: string,
): FailureClass {
  switch (said) {
    case "provider_error":
      return "provider";
    case "transport_error":
      return "transport";
    case "permission_error":
      return "permission";
    case "validation_error":
      return "validation";
    default:
      // Grok's own watchdog ends a silent turn in these words (GrokAdapter's settleStalledTurn).
      return driver === "grok" && words.includes("stalled without content or tool progress")
        ? "stalled"
        : "unknown";
  }
}

function appendStream(kind: string): AppendStream {
  switch (kind) {
    case "assistant_text":
      return "text";
    case "reasoning_text":
    case "reasoning_summary_text":
      return "reasoning";
    case "command_output":
    case "file_change_output":
      return "output";
    case "plan_text":
      return "plan";
    default:
      return "other";
  }
}

function bodyForStream(stream: AppendStream): ItemBody {
  switch (stream) {
    case "text":
      return { kind: "text" };
    case "reasoning":
      return { kind: "reasoning" };
    case "plan":
      return { kind: "plan" };
    default:
      return { kind: "other" };
  }
}

function itemBody(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  > &
    SpiEvent,
): ItemBody {
  const payload = event.payload;
  const itemType = payload.itemType;
  if (isToolLifecycleItemType(itemType)) {
    const call = event.toolCall ?? applyToolCall(event).toolCall;
    return {
      kind: "tool",
      toolKind: itemType,
      ...(call === undefined ? {} : { call }),
      ...(payload.title === undefined ? {} : { title: payload.title }),
    };
  }
  switch (itemType) {
    case "assistant_message":
      return { kind: "text" };
    case "reasoning":
      return { kind: "reasoning" };
    case "plan":
      return { kind: "plan" };
    case "context_compaction":
      return { kind: "compaction" };
    case "error":
      return { kind: "error", words: payload.detail ?? payload.title ?? "unknown" };
    default:
      return { kind: "other", ...(payload.title === undefined ? {} : { title: payload.title }) };
  }
}

function itemStatus(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
): ItemStatus {
  const payload = event.payload;
  if (payload.unreturned === true) return "unreturned";
  if (payload.status === "failed") return "failed";
  if (payload.status === "declined") return "declined";
  if (payload.status === "stopped") return "stopped";
  if (event.type === "item.completed") return "completed";
  return payload.status === "completed" ? "completed" : "running";
}

function workKind(
  stamped: "agent" | "background" | undefined,
  taskType: string | undefined,
  agentId: string | undefined,
): WorkKind {
  const kind = stamped ?? classifyTaskAgentKind({ taskType, agentId });
  if (kind === "agent") return "helper";
  if (taskType === "monitor" || taskType === "monitor_mcp") return "monitor";
  if (taskType === "local_bash" || taskType === "shell") return "shell";
  return "other";
}

function taskStatus(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "task.started" | "task.progress" | "task.updated" | "task.completed" }
  >,
  current: WorkStatus | undefined,
): WorkStatus {
  switch (event.type) {
    case "task.started":
      return "running";
    case "task.completed":
      return event.payload.status;
    default:
      return event.payload.status === undefined
        ? (current ?? "running")
        : fromTaskStatus(event.payload.status);
  }
}

function fromTaskStatus(status: RuntimeTaskStatus): WorkStatus {
  switch (status) {
    case "pending":
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "idle":
      return "idle";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
  }
}
