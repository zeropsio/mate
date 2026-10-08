/**
 * A Mate whose conversation runs on the engine: it advertises `mateEngine`, serves the engine's
 * conversation wire first (subscriptions, calls, receipts, pages) and parks V1's conversation —
 * V1 reads and writes are refused and flagged, so a client still reading V1 fails. Everything it
 * sends is encoded with the contract schemas. No decider: the fixture says what the engine
 * committed, record by record, each change one sequence step.
 */
import {
  ConversationHeader,
  ConversationRow,
  EngineCallResult,
  EngineConversationFrame,
  EngineDetail,
  EnginePage,
  EngineReceiptResult,
  EngineRowsFrame,
  Item,
  MATE_ENGINE_PROTOCOLS,
  ORCHESTRATION_WS_METHODS,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadStreamItem,
  Request,
  RunRecord,
  WS_METHODS,
  type RequestAsk,
  type RunEnd,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeEvents from "node:events";
import type { WebSocket } from "ws";

import { deadline } from "../harness/http.ts";
import type { MateFake, RpcRequest } from "./mate.ts";

const decodeRun = Schema.decodeUnknownSync(RunRecord);
const decodeItem = Schema.decodeUnknownSync(Item);
const decodeRequest = Schema.decodeUnknownSync(Request);
const decodeHeader = Schema.decodeUnknownSync(ConversationHeader);
const decodeRow = Schema.decodeUnknownSync(ConversationRow);
const encodeFrame = Schema.encodeSync(EngineConversationFrame);
const encodeRowsFrame = Schema.encodeSync(EngineRowsFrame);
const encodeCall = Schema.encodeSync(EngineCallResult);
const encodeReceipt = Schema.encodeSync(EngineReceiptResult);
const encodePage = Schema.encodeSync(EnginePage);
const encodeDetail = Schema.encodeSync(EngineDetail);
const encodeThreadItem = Schema.encodeSync(OrchestrationThreadStreamItem);
const encodeSnapshot = Schema.encodeSync(OrchestrationThreadDetailSnapshot);

const AT = Date.parse("2026-10-05T12:00:00.000Z");
const OPS: Readonly<Record<string, EngineOp>> = {
  [WS_METHODS.engineSend]: "send",
  [WS_METHODS.engineAnswer]: "answer",
  [WS_METHODS.engineDismiss]: "dismiss",
  [WS_METHODS.engineStop]: "stop",
  [WS_METHODS.engineSteer]: "steer",
};
const PROTOCOL = Math.max(...MATE_ENGINE_PROTOCOLS);
export const ENGINE_MOVED =
  "This conversation moved to the Mate's engine. Update Zerops Mate to keep talking to it.";

type Changed = { runs: Set<string>; items: Set<string>; requests: Set<string>; header: boolean };
export type EngineOp = "send" | "answer" | "dismiss" | "stop" | "steer";

export class MateEngineFake {
  readonly mate: MateFake;
  readonly conversationId: string;
  readonly origin = "fake-engine-origin";
  readonly runs = new Map<string, RunRecord>();
  readonly items = new Map<string, Item>();
  readonly requests = new Map<string, Request>();
  header: ConversationHeader;
  /** The conversation's sequence: every record change is one step. */
  seq = 0;
  /** Every command the engine applied, once per command id, in order. */
  readonly applied: Array<{ commandId: string; op: EngineOp; payload: Record<string, unknown> }> =
    [];
  /** Told when the person answers a request: the fixture's agent replies. */
  readonly onAnswer: Array<(request: Request) => void> = [];
  /** A refusal the next answer gets instead of being applied (the engine's rule word). */
  answerRefusal: "unknown-request" | "not-answerable" | null = null;
  /** The Mate refuses the caller before the engine sees the call: its words, as V1's refusal. */
  authorization: (op: EngineOp) => string | null = () => null;
  private readonly results = new Map<string, EngineCallResult>();
  private readonly subscribers = new Map<WebSocket, Set<string>>();
  private readonly rowSubscribers = new Map<WebSocket, Set<string>>();
  private readonly receipts = new NodeEvents.EventEmitter();

  constructor(mate: MateFake) {
    this.mate = mate;
    this.conversationId = mate.thread.id;
    this.header = decodeHeader({
      conversationId: this.conversationId,
      agent: {
        instanceId: mate.thread.modelSelection.instanceId,
        driver: mate.thread.modelSelection.instanceId,
        model: mate.thread.modelSelection.model,
        profile: { kind: "mate" },
      },
      archived: false,
      model: mate.thread.modelSelection.model,
      session: null,
      pausedUntil: null,
      queued: 0,
    });
  }

  /** The Mate advertises the engine, serves its wire ahead of every other handler, parks V1. */
  install(): this {
    const mateEngine = { protocol: PROTOCOL };
    Object.assign(this.mate.descriptor.capabilities, { mateEngine });
    Object.assign(this.mate.config.environment.capabilities, { mateEngine });
    this.mate.rpcHandlers.unshift((request, socket) => this.serve(request, socket));
    const original = this.mate.handle;
    this.mate.handle = (request) => {
      const path = request.url.pathname.replace(/^\/mate/u, "");
      if (path.startsWith("/api/orchestration/threads/")) {
        this.mate.unknownMethods.add(`GET ${path} (V1 history of an engine conversation)`);
        return { body: encodeSnapshot(this.parkedThread()) };
      }
      return original(request);
    };
    return this;
  }

  get epoch() {
    return this.mate.attention().source.epoch;
  }

  // ── what the fixture says the engine committed ─────────────────────────────────────────────

  /** The person said `text`; its run is over. */
  personTurn(text: string): string {
    return this.commit((change) => {
      const run = this.openRun(change, { kind: "person" });
      this.addItem(change, run, {
        kind: "person",
        by: { kind: "person", principal: { kind: "person", subject: "owner" } },
        text,
        attachments: [],
        sendId: `history-${this.runs.size}`,
        delivery: { state: "delivered", at: AT },
      });
      this.endRun(change, run, { kind: "completed" });
      return run;
    });
  }

  /**
   * The agent asks, in the run given when it is still on, else in a run it starts itself (joining
   * the last); the run waits on the request.
   */
  ask(ask: RequestAsk, at: { readonly runId?: string } = {}): string {
    return this.commit((change) => {
      const named = at.runId === undefined ? undefined : this.runs.get(at.runId);
      const run =
        named !== undefined && named.state !== "ended"
          ? named.id
          : this.openRun(
              change,
              { kind: "wake", cause: "self", wakeId: null },
              [...this.runs.values()].at(-1)?.id ?? null,
            );
      const ordinal = [...this.requests.values()].filter((r) => r.runId === run).length + 1;
      const id = `${run}/q/${ordinal}`;
      const seq = this.next();
      this.requests.set(
        id,
        decodeRequest({
          id,
          conversationId: this.conversationId,
          runId: run,
          seq,
          rev: seq,
          at: AT + seq,
          ask,
          state: "open",
          answerable: true,
          principal: { kind: "engine" },
        }),
      );
      change.requests.add(id);
      this.addItem(change, run, { kind: "request", by: { kind: "engine" }, requestId: id });
      this.setRun(change, run, {
        state: "waiting",
        waitingOn: { kind: "request", requestId: id },
      });
      return id;
    });
  }

  /** The agent starts a run of its own, joining the last: its engine id. */
  startRun(): string {
    return this.commit((change) =>
      this.openRun(
        change,
        { kind: "wake", cause: "self", wakeId: null },
        [...this.runs.values()].at(-1)?.id ?? null,
      ),
    );
  }

  /** Run `id` ends as the agent's turn did. */
  settleRun(id: string, state: "completed" | "error" | "interrupted") {
    const held = this.runs.get(id);
    if (held === undefined || held.state === "ended") return;
    this.commit((change) =>
      this.endRun(
        change,
        id,
        state === "completed"
          ? { kind: "completed" }
          : state === "error"
            ? { kind: "failed", reason: "The agent failed.", next: null }
            : { kind: "stopped", by: { kind: "person", subject: "owner" } },
      ),
    );
  }

  /** The agent's words in `run`; its answer, ending the run when told. */
  note(run: string, text: string, end?: RunEnd): string {
    return this.commit((change) => {
      const item = this.addItem(change, run, {
        kind: "note",
        by: { kind: "mate" },
        text,
        streaming: false,
        answer: true,
      });
      if (end !== undefined) this.endRun(change, run, end, item);
      return item;
    });
  }

  async waitForMessage(text: string) {
    const held = () =>
      [...this.items.values()].some((item) => item.kind === "person" && item.text === text);
    if (held()) return;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (held()) resolve();
          };
          this.receipts.on("message", listener);
        }),
        `Mate's engine accepted message: ${text}`,
        8000,
      );
    } finally {
      this.receipts.off("message", listener);
    }
  }

  // ── records ────────────────────────────────────────────────────────────────────────────────

  private next() {
    return ++this.seq;
  }

  private openRun(
    change: Changed,
    trigger: { kind: "person" } | { kind: "wake"; cause: string; wakeId: null },
    joins: string | null = null,
  ): string {
    const ordinal = this.runs.size + 1;
    const id = `${this.conversationId}/r/${ordinal}`;
    const seq = this.next();
    this.runs.set(
      id,
      decodeRun({
        id,
        conversationId: this.conversationId,
        ordinal,
        seq,
        rev: seq,
        trigger: trigger.kind === "person" ? { kind: "person", itemId: `${id}/i/1` } : trigger,
        joins,
        principal:
          trigger.kind === "person" ? { kind: "person", subject: "owner" } : { kind: "engine" },
        state: "running",
        maintenance: false,
        waitingOn: null,
        stopAsked: null,
        end: null,
        endSource: null,
        sessionId: null,
        providerTurnId: null,
        queuedAt: AT + seq,
        admittedAt: AT + seq,
        startedAt: AT + seq,
        endedAt: null,
        unresponsiveSince: null,
        summary: { items: 0, calls: {}, answerItemId: null, lastItemSeq: null },
      }),
    );
    change.runs.add(id);
    return id;
  }

  private setRun(change: Changed, id: string, patch: Record<string, unknown>) {
    const run = this.runs.get(id)!;
    const seq = this.next();
    this.runs.set(id, decodeRun({ ...run, ...patch, rev: seq }));
    change.runs.add(id);
  }

  private endRun(change: Changed, id: string, end: RunEnd, answerItemId?: string) {
    const run = this.runs.get(id)!;
    this.setRun(change, id, {
      state: "ended",
      waitingOn: null,
      end,
      endSource: "agent",
      endedAt: AT + this.seq,
      summary: { ...run.summary, answerItemId: answerItemId ?? run.summary.answerItemId },
    });
  }

  private addItem(change: Changed, run: string, body: Record<string, unknown>): string {
    const ordinal = [...this.items.values()].filter((item) => item.runId === run).length + 1;
    const id = `${run}/i/${ordinal}`;
    const seq = this.next();
    this.items.set(
      id,
      decodeItem({
        id,
        conversationId: this.conversationId,
        runId: run,
        seq,
        rev: seq,
        at: AT + seq,
        ...body,
      }),
    );
    change.items.add(id);
    const held = this.runs.get(run)!;
    this.runs.set(
      run,
      decodeRun({
        ...held,
        rev: seq,
        summary: { ...held.summary, items: held.summary.items + 1, lastItemSeq: seq },
      }),
    );
    change.runs.add(run);
    if (body.kind === "person") this.receipts.emit("message");
    return id;
  }

  private setItem(change: Changed, id: string, patch: Record<string, unknown>) {
    const seq = this.next();
    this.items.set(id, decodeItem({ ...this.items.get(id)!, ...patch, rev: seq }));
    change.items.add(id);
  }

  /** Applies `step` as one commit: its changes go to every subscriber, then the rows. */
  private commit<A>(step: (change: Changed) => A): A {
    const from = this.seq;
    const change: Changed = {
      runs: new Set(),
      items: new Set(),
      requests: new Set(),
      header: false,
    };
    const result = step(change);
    const frame = encodeFrame({
      type: "changes",
      epoch: this.epoch,
      from,
      to: this.seq,
      ...(change.header ? { header: this.header } : {}),
      runs: [...change.runs].map((id) => this.runs.get(id)!),
      items: [...change.items].map((id) => this.items.get(id)!),
      requests: [...change.requests].map((id) => this.requests.get(id)!),
    });
    for (const [socket, ids] of this.subscribers)
      for (const id of ids) this.mate.chunk(socket, id, [frame]);
    const row = encodeRowsFrame({ type: "row", row: this.row() });
    for (const [socket, ids] of this.rowSubscribers)
      for (const id of ids) this.mate.chunk(socket, id, [row]);
    return result;
  }

  row(): ConversationRow {
    const runs = [...this.runs.values()];
    const active = runs.findLast((run) => run.state !== "ended") ?? null;
    const latest = runs.at(-1) ?? null;
    const open = [...this.requests.values()].find((request) => request.state === "open");
    const person = [...this.items.values()].findLast((item) => item.kind === "person");
    const note = [...this.items.values()].findLast((item) => item.kind === "note");
    return decodeRow({
      conversationId: this.conversationId,
      agent: this.header.agent,
      revision: {
        environmentId: this.mate.descriptor.environmentId,
        epoch: this.epoch,
        seq: this.seq,
      },
      state:
        open !== undefined
          ? {
              kind: "waiting",
              on: open.ask.kind === "approval" ? "approval" : "question",
              words: open.ask.kind === "approval" ? open.ask.detail : null,
            }
          : active !== null
            ? { kind: "working", since: active.queuedAt, waitsOnHelpers: false }
            : { kind: "idle" },
      activeRunId: active?.id ?? null,
      latestRun:
        latest === null ? null : { id: latest.id, end: latest.end, endedAt: latest.endedAt },
      subject: person?.kind === "person" ? person.text.split("\n")[0] : null,
      snippet: note?.kind === "note" ? note.text : null,
      at: AT + this.seq,
      askedAt: open?.at ?? null,
    });
  }

  private parkedThread() {
    return {
      snapshotSequence: this.mate.sequence,
      thread: { ...this.mate.thread, messages: [], activities: [] },
    };
  }

  // ── the wire ───────────────────────────────────────────────────────────────────────────────

  private serve(request: RpcRequest, socket: WebSocket): boolean {
    const { tag, id, payload } = request;
    const unserved =
      (payload.protocol as number | undefined) !== PROTOCOL
        ? {
            type: "unserved" as const,
            reason: "protocol" as const,
            protocols: [...MATE_ENGINE_PROTOCOLS],
            message: "Update Zerops Mate to keep talking to it.",
          }
        : null;
    switch (tag) {
      case WS_METHODS.subscribeEngineConversation: {
        if (unserved !== null) {
          this.mate.chunk(socket, id, [encodeFrame(unserved)]);
          return true;
        }
        const after = payload.after as { origin: string; seq: number; epoch: number } | undefined;
        const ids = this.subscribers.get(socket) ?? new Set<string>();
        ids.add(id);
        this.subscribers.set(socket, ids);
        socket.once("close", () => this.subscribers.delete(socket));
        const frames: unknown[] = [];
        if (after === undefined || after.origin !== this.origin || after.seq > this.seq) {
          if (after !== undefined) frames.push(encodeFrame({ type: "reset", reason: "origin" }));
          frames.push(
            encodeFrame({
              type: "snapshot",
              protocol: PROTOCOL,
              epoch: this.epoch,
              origin: this.origin,
              head: this.seq,
              header: this.header,
              runs: [...this.runs.values()],
              items: [...this.items.values()],
              requests: [...this.requests.values()],
              window: { oldestOrdinal: this.runs.size === 0 ? null : 1, earlier: false },
            }),
          );
        } else
          frames.push(
            encodeFrame({
              type: "changes",
              epoch: this.epoch,
              from: after.seq,
              to: this.seq,
              runs: [...this.runs.values()].filter((run) => run.rev > after.seq),
              items: [...this.items.values()].filter((item) => item.rev > after.seq),
              requests: [...this.requests.values()].filter((r) => r.rev > after.seq),
            }),
          );
        frames.push(encodeFrame({ type: "synchronized", epoch: this.epoch, head: this.seq }));
        this.mate.chunk(socket, id, frames);
        return true;
      }
      case WS_METHODS.subscribeEngineRows: {
        if (unserved !== null) {
          this.mate.chunk(socket, id, [encodeRowsFrame(unserved)]);
          return true;
        }
        const ids = this.rowSubscribers.get(socket) ?? new Set<string>();
        ids.add(id);
        this.rowSubscribers.set(socket, ids);
        socket.once("close", () => this.rowSubscribers.delete(socket));
        this.mate.chunk(socket, id, [
          encodeRowsFrame({
            type: "snapshot",
            protocol: PROTOCOL,
            epoch: this.epoch,
            rows: [this.row()],
          }),
          encodeRowsFrame({ type: "synchronized", epoch: this.epoch }),
        ]);
        return true;
      }
      case WS_METHODS.engineSend:
      case WS_METHODS.engineAnswer:
      case WS_METHODS.engineDismiss:
      case WS_METHODS.engineStop:
      case WS_METHODS.engineSteer: {
        if (unserved !== null) {
          this.mate.reply(socket, id, encodeCall({ _tag: "Unserved", unserved }));
          return true;
        }
        const refused = this.authorization(OPS[tag]!);
        if (refused !== null) {
          socket.send(
            JSON.stringify({
              _tag: "Exit",
              requestId: id,
              exit: {
                _tag: "Failure",
                cause: [
                  {
                    _tag: "Fail",
                    error: {
                      _tag: "EnvironmentAuthorizationError",
                      message: refused,
                      requiredScope: "orchestration:operate",
                    },
                  },
                ],
              },
            }),
          );
          return true;
        }
        const commandId = String(payload.commandId);
        const result = this.results.get(commandId) ?? this.apply(tag, commandId, payload);
        this.results.set(commandId, result);
        this.mate.reply(socket, id, encodeCall(result));
        return true;
      }
      case WS_METHODS.engineReceipt: {
        const stored = this.results.get(String(payload.commandId));
        this.mate.reply(
          socket,
          id,
          encodeReceipt(
            stored === undefined ? { _tag: "None" } : ({ _tag: "Found", result: stored } as never),
          ),
        );
        return true;
      }
      case WS_METHODS.engineReadRun:
      case WS_METHODS.engineReadEarlier: {
        const runId = payload.runId as string | undefined;
        this.mate.reply(
          socket,
          id,
          encodePage({
            _tag: "Page",
            runs: runId === undefined ? [...this.runs.values()] : [],
            items: [...this.items.values()].filter(
              (item) => runId === undefined || item.runId === runId,
            ),
            requests: [],
            window: { oldestOrdinal: this.runs.size === 0 ? null : 1, earlier: false },
            more: false,
          }),
        );
        return true;
      }
      case WS_METHODS.engineReadDetail:
        this.mate.reply(socket, id, encodeDetail({ _tag: "Missing" }));
        return true;
      case ORCHESTRATION_WS_METHODS.subscribeThread:
        this.mate.unknownMethods.add(`${tag} (V1 history of an engine conversation)`);
        this.mate.chunk(socket, id, [
          encodeThreadItem({ kind: "snapshot", snapshot: this.parkedThread() } as never),
          encodeThreadItem({ kind: "synchronized" }),
        ]);
        return true;
      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const type = (payload as { type?: string }).type ?? "unknown";
        if (
          !type.startsWith("thread.turn.") &&
          !type.startsWith("thread.approval.") &&
          !type.startsWith("thread.user-input.")
        )
          return false;
        this.mate.unknownMethods.add(`${tag} ${type} (V1 write to an engine conversation)`);
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: id,
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: { _tag: "OrchestrationDispatchCommandError", message: ENGINE_MOVED },
                },
              ],
            },
          }),
        );
        return true;
      }
      default:
        return false;
    }
  }

  private apply(
    tag: string,
    commandId: string,
    payload: Record<string, unknown>,
  ): EngineCallResult {
    const running = [...this.runs.values()].findLast((run) => run.state !== "ended");
    switch (tag) {
      case WS_METHODS.engineSend: {
        this.applied.push({ commandId, op: "send", payload });
        const [runId, itemId] = this.commit((change) => {
          const run = this.openRun(change, { kind: "person" });
          this.setRun(change, run, { state: "admitted", startedAt: null });
          const item = this.addItem(change, run, {
            kind: "person",
            by: { kind: "person", principal: { kind: "person", subject: "owner" } },
            text: String(payload.text),
            attachments: [],
            sendId: commandId,
            delivery: { state: "queued", at: null },
          });
          return [run, item] as const;
        });
        const accepted = { _tag: "Accepted" as const, seq: this.seq, runId, itemId };
        queueMicrotask(() => {
          this.commit((change) => {
            this.setItem(change, itemId, { delivery: { state: "delivered", at: AT + this.seq } });
            this.setRun(change, runId, { state: "running", startedAt: AT + this.seq });
          });
          this.mate.publishAttention();
        });
        return accepted as never;
      }
      case WS_METHODS.engineAnswer: {
        const requestId = String(payload.requestId);
        const request = this.requests.get(requestId);
        if (this.answerRefusal !== null || request === undefined || request.state !== "open")
          return {
            _tag: "Rejected",
            rejection: {
              reason:
                this.answerRefusal ??
                (request === undefined ? "unknown-request" : "not-answerable"),
            },
          } as never;
        this.applied.push({ commandId, op: "answer", payload });
        const given = payload.answer as {
          readonly answers?: unknown;
          readonly attachmentsByQuestionId?: unknown;
        };
        this.commit((change) => {
          const seq = this.next();
          this.requests.set(
            requestId,
            decodeRequest({
              ...request,
              rev: seq,
              state: "answered",
              answer: {
                by: { kind: "person", subject: "owner" },
                at: AT + seq,
                summary: String(payload.summary),
                // A question's record keeps its words and pictures, as the engine's does.
                ...(request.ask.kind === "question"
                  ? {
                      answers: given.answers,
                      ...(given.attachmentsByQuestionId === undefined
                        ? {}
                        : { attachmentsByQuestionId: given.attachmentsByQuestionId }),
                    }
                  : {}),
              },
            }),
          );
          change.requests.add(requestId);
          this.setRun(change, request.runId, { state: "running", waitingOn: null });
        });
        const answered = this.requests.get(requestId)!;
        for (const listener of this.onAnswer) listener(answered);
        return { _tag: "Accepted", seq: this.seq, requestId, runId: request.runId } as never;
      }
      case WS_METHODS.engineDismiss: {
        const requestId = String(payload.requestId);
        const request = this.requests.get(requestId);
        if (request === undefined || request.state !== "open")
          return { _tag: "Rejected", rejection: { reason: "unknown-request" } } as never;
        if (request.ask.kind !== "question" || !request.ask.dismissible)
          return { _tag: "Rejected", rejection: { reason: "not-dismissible" } } as never;
        this.applied.push({ commandId, op: "dismiss", payload });
        this.commit((change) => {
          const seq = this.next();
          this.requests.set(
            requestId,
            decodeRequest({ ...request, rev: seq, state: "dismissed", answerable: false }),
          );
          change.requests.add(requestId);
          const run = this.runs.get(request.runId);
          if (run?.state === "waiting")
            this.setRun(change, request.runId, { state: "running", waitingOn: null });
        });
        return { _tag: "Accepted", seq: this.seq, requestId, runId: request.runId } as never;
      }
      case WS_METHODS.engineStop: {
        if (running === undefined)
          return { _tag: "Rejected", rejection: { reason: "run-not-running" } } as never;
        this.applied.push({ commandId, op: "stop", payload });
        this.commit((change) =>
          this.endRun(change, running.id, {
            kind: "stopped",
            by: { kind: "person", subject: "owner" },
          }),
        );
        return { _tag: "Accepted", seq: this.seq, runId: running.id } as never;
      }
      default:
        return {
          _tag: "Rejected",
          rejection: { reason: running === undefined ? "run-not-running" : "steer-unsupported" },
        } as never;
    }
  }
}
