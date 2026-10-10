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
  ENGINE_WIRE_BUDGETS,
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
  type RunSummary,
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
  [WS_METHODS.engineSwitchModel]: "switch-model",
  [WS_METHODS.engineSetArchived]: "set-archived",
  [WS_METHODS.engineSetRuntimeMode]: "set-runtime-mode",
  [WS_METHODS.engineAssignAgent]: "assign-agent",
};
const PROTOCOL = Math.max(...MATE_ENGINE_PROTOCOLS);
export const ENGINE_MOVED =
  "This Mate moved to its new engine. Reload or update this app to keep talking to it.";

type Changed = { runs: Set<string>; items: Set<string>; requests: Set<string>; header: boolean };
export type EngineOp =
  | "send"
  | "answer"
  | "dismiss"
  | "stop"
  | "steer"
  | "switch-model"
  | "set-archived"
  | "set-runtime-mode"
  | "assign-agent";

const FILE_KEYS = new Set(["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]);

function namedFiles(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) for (const entry of value) namedFiles(entry, into);
  else if (typeof value === "object" && value !== null)
    for (const [field, entry] of Object.entries(value)) {
      if (FILE_KEYS.has(field) && typeof entry === "string") into.add(entry);
      else namedFiles(entry, into);
    }
}

/** A run's summary with one more item counted, as the server counts a call: by step and tool. */
function countedCall(
  summary: RunSummary,
  body: Record<string, unknown>,
  edited: { files: Set<string>; unnamed: number },
): RunSummary {
  if (body.kind !== "call") return summary;
  const step = typeof body.step === "string" ? body.step : "tool";
  const tool = (body.tool as { name?: string } | undefined)?.name ?? "tool";
  if (step === "edit") {
    const own = new Set<string>();
    namedFiles(body.shows, own);
    if (own.size === 0) edited.unnamed += 1;
    for (const file of own) edited.files.add(file);
  }
  const tools = { ...summary.tools };
  if (step === "tool" || step === "mcp") tools[tool] = (tools[tool] ?? 0) + 1;
  return {
    ...summary,
    calls: { ...summary.calls, [step]: (summary.calls[step] ?? 0) + 1 },
    tools,
    edited: edited.files.size + edited.unnamed,
  };
}

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
  /** Run groups a subscription's window opens with, as the server's budget says. */
  windowGroups: number = ENGINE_WIRE_BUDGETS.windowGroups;
  /** Items a run's page carries. */
  runPageItems: number = ENGINE_WIRE_BUDGETS.runPageItems;
  /** Text streaming now, by item and stream: a subscriber that opens hears it whole. */
  private readonly streamed = new Map<string, string>();
  private readonly details = new Map<string, string>();
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
      runStatus: "ready",
      activeRunId: null,
      latestRunId: null,
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
          at: this.stamp(seq),
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

  /** The agent starts a run; its caller names the continuation, or null for a separate turn. */
  startRun(joins: string | null): string {
    return this.commit((change) => {
      this.openSession(change);
      return this.openRun(change, { kind: "wake", cause: "self", wakeId: null }, joins);
    });
  }

  /** The agent's session is open: it can take a message into the turn it runs. */
  private openSession(change: Changed) {
    if (this.header.session !== null) return;
    this.header = decodeHeader({
      ...this.header,
      session: {
        driver: this.header.agent?.driver ?? "codex",
        model: this.header.model,
        steer: true,
      },
    });
    change.header = true;
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
      if (end !== undefined) this.endRun(change, run, end);
      return item;
    });
  }

  /** The person said `text` and the agent is at work on it: its run, running. */
  personRun(text: string): string {
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
      return run;
    });
  }

  /** An item of `run` opens as the engine records it: still being written, or whole. */
  item(run: string, body: Record<string, unknown>): string {
    return this.commit((change) => this.addItem(change, run, { by: { kind: "mate" }, ...body }));
  }

  /** An item's record changes: it settles, ends or says more. */
  update(itemId: string, patch: Record<string, unknown>): void {
    this.commit((change) => this.setItem(change, itemId, patch));
  }

  /** The run ends, retaining its latest closed Mate note as the wire's summary does. */
  end(run: string, end: RunEnd = { kind: "completed" }): void {
    this.commit((change) => this.endRun(change, run, end));
  }

  /** The run hits the provider's usage limit: it ends there and the conversation pauses until the reset. */
  limit(run: string, resetsAt: number): void {
    this.commit((change) => {
      this.endRun(change, run, { kind: "usage-limit", resetsAt });
      this.header = decodeHeader({ ...this.header, pausedUntil: resetsAt });
      change.header = true;
    });
  }

  /** The pause lifts (the reset came, or the person signed in again): each queued run starts. */
  lift(): void {
    const queued = [...this.runs.values()].filter((run) => run.state === "queued");
    this.commit((change) => {
      this.header = decodeHeader({ ...this.header, pausedUntil: null, queued: 0 });
      change.header = true;
      for (const run of queued) this.admit(change, run.id);
    });
  }

  /** Text streams into an item, never recorded: each subscriber hears it at its offset. */
  stream(itemId: string, text: string, stream = "text"): void {
    const held = this.streamed.get(`${itemId}\u0000${stream}`);
    this.streamed.set(`${itemId}\u0000${stream}`, (held ?? "") + text);
    this.live(
      held === undefined
        ? { type: "live.open", itemId, stream, text }
        : { type: "live.append", itemId, stream, offset: held.length, text },
    );
  }

  /** An item's record is whole: its streamed text goes. */
  /** An item's whole part, served on demand: a call's output (`detail`) or its own record. */
  detail(itemId: string, part: string, text: string): void {
    this.details.set(`${itemId}\u0000${part}`, text);
  }

  settle(itemId: string): void {
    for (const key of this.streamed.keys())
      if (key.startsWith(`${itemId}\u0000`)) this.streamed.delete(key);
    this.live({ type: "live.settle", itemId });
  }

  private live(frame: Record<string, unknown>) {
    const encoded = encodeFrame(frame as never);
    for (const [socket, ids] of this.subscribers)
      for (const id of ids) this.mate.chunk(socket, id, [encoded]);
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

  /** Once a person sends, the engine records the wall clock, as the real one always does. */
  private wallClock = false;
  /** How far the Mate's clock runs from the person's, once it records the wall clock. */
  clockSkewMs = 0;
  private stamp(seq: number) {
    return this.wallClock ? Date.now() + this.clockSkewMs : AT + seq;
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
        turnState: "running",
        maintenance: false,
        waitingOn: null,
        stopAsked: null,
        end: null,
        endSource: null,
        sessionId: null,
        providerTurnId: null,
        queuedAt: this.stamp(seq),
        admittedAt: this.stamp(seq),
        startedAt: this.stamp(seq),
        endedAt: null,
        unresponsiveSince: null,
        summary: { items: 0, calls: {}, answerItemId: null, lastItemSeq: null },
      }),
    );
    change.runs.add(id);
    return id;
  }

  /** A queued run is taken: its message delivered, the run at work. */
  private admit(change: Changed, id: string) {
    this.openSession(change);
    const at = this.stamp(this.seq);
    for (const item of this.items.values())
      if (item.runId === id && item.kind === "person" && item.delivery.state === "queued")
        this.setItem(change, item.id, { delivery: { state: "delivered", at } });
    this.setRun(change, id, {
      state: "running",
      turnState: "running",
      admittedAt: at,
      startedAt: at,
    });
  }

  private setRun(change: Changed, id: string, patch: Record<string, unknown>) {
    const run = this.runs.get(id)!;
    const seq = this.next();
    this.runs.set(id, decodeRun({ ...run, ...patch, rev: seq }));
    change.runs.add(id);
  }

  private endRun(change: Changed, id: string, end: RunEnd) {
    const run = this.runs.get(id)!;
    // The real wire's records.ts derives this from closed Mate notes in opened-sequence order.
    const answer = [...this.items.values()].findLast(
      (item) =>
        item.runId === id && item.kind === "note" && item.by.kind === "mate" && !item.streaming,
    );
    this.setRun(change, id, {
      state: "ended",
      turnState:
        end.kind === "completed"
          ? "completed"
          : end.kind === "failed" || end.kind === "crashed"
            ? "error"
            : end.kind === "unknown"
              ? null
              : "interrupted",
      waitingOn: null,
      end,
      endSource: "agent",
      endedAt: this.stamp(this.seq),
      summary: { ...run.summary, answerItemId: answer?.id ?? null },
    });
  }

  /** The files each run's edits named, and its edits naming none, as the server counts them. */
  private readonly editedFiles = new Map<string, { files: Set<string>; unnamed: number }>();
  private edited(run: string) {
    let held = this.editedFiles.get(run);
    if (held === undefined) {
      held = { files: new Set(), unnamed: 0 };
      this.editedFiles.set(run, held);
    }
    return held;
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
        at: this.stamp(seq),
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
        summary: {
          ...countedCall(held.summary, body, this.edited(run)),
          items: held.summary.items + 1,
          lastItemSeq: seq,
        },
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

  /**
   * An item as the server's encoder sends it: a call's result over the inline budget leaves the
   * record, the cut part named with its whole length.
   */
  private sent(item: Item): Item {
    if (item.kind !== "call" || item.result?.resultText === undefined) return item;
    const total = new TextEncoder().encode(item.result.resultText).length;
    if (total <= ENGINE_WIRE_BUDGETS.itemTextBytes) return item;
    const { resultText: _cut, ...result } = item.result;
    return { ...item, result, cut: { part: "result", total } };
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
    if (change.runs.size > 0) {
      const runs = [...this.runs.values()];
      const active = runs.findLast((run) => run.turnState === "running");
      const latest = active ?? runs.findLast((run) => run.state === "ended");
      this.header = {
        ...this.header,
        activeRunId: active?.id ?? null,
        latestRunId: latest?.id ?? null,
        runStatus:
          active !== undefined ? "running" : latest?.turnState === "error" ? "error" : "ready",
      };
      change.header = true;
    }
    const frame = encodeFrame({
      type: "changes",
      epoch: this.epoch,
      from,
      to: this.seq,
      ...(change.header ? { header: this.header } : {}),
      runs: [...change.runs].map((id) => this.runs.get(id)!),
      items: [...change.items].map((id) => this.sent(this.items.get(id)!)),
      requests: [...change.requests].map((id) => this.requests.get(id)!),
    });
    for (const [socket, ids] of this.subscribers)
      for (const id of ids) this.mate.chunk(socket, id, [frame]);
    const row = encodeRowsFrame({ type: "row", row: this.row() });
    for (const [socket, ids] of this.rowSubscribers)
      for (const id of ids) this.mate.chunk(socket, id, [row]);
    return result;
  }

  /** The run groups, oldest first: a run and the runs that continue it. */
  private groups(): Array<Array<RunRecord>> {
    const groups: Array<Array<RunRecord>> = [];
    const of = new Map<string, Array<RunRecord>>();
    for (const run of [...this.runs.values()].sort((a, b) => a.ordinal - b.ordinal)) {
      const group = run.joins === null ? undefined : of.get(run.joins);
      if (group === undefined) {
        const opened = [run];
        groups.push(opened);
        of.set(run.id, opened);
      } else {
        group.push(run);
        of.set(run.id, group);
      }
    }
    return groups;
  }

  /**
   * What a window shows of its groups, as the server's: the runs, every person message, request
   * and answer, every open request, and the items of each run not ended; the rest is read on
   * demand.
   */
  private window(groups: ReadonlyArray<ReadonlyArray<RunRecord>>) {
    const runs = groups.flat();
    const ids = new Set(runs.map((run) => run.id as string));
    const answers = new Set(runs.flatMap((run) => run.summary.answerItemId ?? []));
    const live = new Set(runs.filter((run) => run.state !== "ended").map((run) => run.id));
    const oldestOrdinal = runs[0]?.ordinal ?? null;
    return {
      runs,
      items: [...this.items.values()]
        .filter(
          (item) =>
            item.runId !== null &&
            ids.has(item.runId) &&
            (item.kind === "person" ||
              item.kind === "request" ||
              answers.has(item.id) ||
              live.has(item.runId)),
        )
        .map((item) => this.sent(item)),
      requests: [...this.requests.values()].filter(
        (request) => request.state === "open" || ids.has(request.runId),
      ),
      window: { oldestOrdinal, earlier: oldestOrdinal !== null && oldestOrdinal > 1 },
    };
  }

  row(): ConversationRow {
    const runs = [...this.runs.values()];
    // A queued run waits for its turn (a pause holds it): the conversation is not at work.
    const active = runs.findLast((run) => run.state !== "ended" && run.state !== "queued") ?? null;
    const latest = runs.findLast((run) => run.state !== "queued") ?? null;
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
        this.header.pausedUntil !== null
          ? { kind: "paused", resetsAt: this.header.pausedUntil }
          : open !== undefined
            ? {
                kind: "waiting",
                on: open.ask.kind === "approval" ? "approval" : "question",
                words: open.ask.kind === "approval" ? open.ask.detail : null,
              }
            : active !== null
              ? { kind: "working", since: active.queuedAt, waitsOnHelpers: false }
              : { kind: "idle" },
      activeRunId: active?.id ?? null,
      runStatus: this.header.runStatus,
      latestRun:
        latest === null
          ? null
          : {
              id: latest.id,
              end: latest.end,
              endedAt: latest.endedAt,
              turnState: latest.turnState,
            },
      subject: person?.kind === "person" ? person.text.split("\n")[0] : null,
      snippet: note?.kind === "note" ? note.text : null,
      at: this.stamp(this.seq),
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
            message:
              "This Mate speaks a newer conversation protocol. Reload or update this app to keep talking to it.",
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
              ...this.window(this.groups().slice(-this.windowGroups)),
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
              items: [...this.items.values()]
                .filter((item) => item.rev > after.seq)
                .map((item) => this.sent(item)),
              requests: [...this.requests.values()].filter((r) => r.rev > after.seq),
            }),
          );
        frames.push(encodeFrame({ type: "synchronized", epoch: this.epoch, head: this.seq }));
        for (const [key, text] of this.streamed) {
          const [itemId, stream] = key.split("\u0000");
          frames.push(encodeFrame({ type: "live.open", itemId, stream, text } as never));
        }
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
      case WS_METHODS.engineSteer:
      case WS_METHODS.engineSwitchModel:
      case WS_METHODS.engineSetArchived:
      case WS_METHODS.engineSetRuntimeMode:
      case WS_METHODS.engineAssignAgent: {
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
      case WS_METHODS.engineReadEarlier: {
        const before = Number(payload.beforeOrdinal);
        const groups = this.groups().filter((group) => group[0]!.ordinal < before);
        this.mate.reply(
          socket,
          id,
          encodePage({
            _tag: "Page",
            ...this.window(groups.slice(-ENGINE_WIRE_BUDGETS.earlierGroupsMax)),
            more: false,
          }),
        );
        return true;
      }
      case WS_METHODS.engineReadRun: {
        const runId = String(payload.runId);
        const beforeSeq = payload.beforeSeq as number | undefined;
        const afterSeq = payload.afterSeq as number | undefined;
        // What a closed card draws its result from, as the server's `only: "outcome"` reads it.
        const outcome = (item: Item) =>
          item.kind === "work" ||
          (item.kind === "call" && (item.result !== undefined || item.step === "look"));
        const items = [...this.items.values()]
          .filter(
            (item) =>
              item.runId === runId &&
              (beforeSeq === undefined || item.seq < beforeSeq) &&
              (afterSeq === undefined || item.seq > afterSeq) &&
              (payload.only !== "outcome" || outcome(item)),
          )
          .sort((left, right) =>
            afterSeq === undefined ? right.seq - left.seq : left.seq - right.seq,
          );
        const page = items.slice(0, this.runPageItems);
        this.mate.reply(
          socket,
          id,
          encodePage({
            _tag: "Page",
            runs: [],
            items: (afterSeq === undefined ? page.toReversed() : page).map((item) =>
              this.sent(item),
            ),
            requests: [],
            window: { oldestOrdinal: null, earlier: false },
            more: items.length > page.length,
          }),
        );
        return true;
      }
      case WS_METHODS.engineReadDetail: {
        const item = this.items.get(String(payload.itemId));
        const part = String(payload.part);
        const whole =
          part === "result" && item?.kind === "call"
            ? item.result?.resultText
            : this.details.get(`${String(payload.itemId)}\u0000${part}`);
        if (whole === undefined) {
          this.mate.reply(socket, id, encodeDetail({ _tag: "Missing" }));
          return true;
        }
        const total = new TextEncoder().encode(whole).length;
        this.mate.reply(
          socket,
          id,
          encodeDetail({ _tag: "Detail", text: whole, from: 0, to: total, total }),
        );
        return true;
      }
      case ORCHESTRATION_WS_METHODS.subscribeThread:
        this.mate.unknownMethods.add(`${tag} (V1 history of an engine conversation)`);
        this.mate.chunk(socket, id, [
          encodeThreadItem({ kind: "snapshot", snapshot: this.parkedThread() } as never),
          encodeThreadItem({ kind: "synchronized" }),
        ]);
        return true;
      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        // The engine owns the conversation: every V1 command is refused, as the server's door does.
        const type = (payload as { type?: string }).type ?? "unknown";
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
        this.wallClock = true;
        const interactionMode = payload.interactionMode === "plan" ? "plan" : "default";
        const [runId, itemId] = this.commit((change) => {
          if (this.header.interactionMode !== interactionMode) {
            this.header = decodeHeader({ ...this.header, interactionMode });
            change.header = true;
          }
          const run = this.openRun(change, { kind: "person" });
          const paused = this.header.pausedUntil !== null;
          this.setRun(
            change,
            run,
            paused
              ? { state: "queued", turnState: null, admittedAt: null, startedAt: null }
              : { state: "admitted", startedAt: null },
          );
          if (paused)
            this.header = decodeHeader({ ...this.header, queued: this.header.queued + 1 });
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
        // A paused conversation holds the run queued until the pause lifts (`lift`).
        if (this.runs.get(runId)?.state === "queued") return accepted as never;
        // The run is sent as its session opens, then runs: each its own commit, as the engine's.
        queueMicrotask(() => {
          this.commit((change) => {
            this.setRun(change, runId, { state: "sending" });
            this.openSession(change);
          });
          queueMicrotask(() => {
            this.commit((change) => {
              this.setItem(change, itemId, {
                delivery: { state: "delivered", at: this.stamp(this.seq) },
              });
              this.setRun(change, runId, { state: "running", startedAt: this.stamp(this.seq) });
            });
            this.mate.publishAttention();
          });
        });
        return accepted as never;
      }
      case WS_METHODS.engineSteer: {
        // Into the run that works, while its session can take it, as the engine's steer.
        const run = this.runs.get(String(payload.runId));
        if (run === undefined)
          return { _tag: "Rejected", rejection: { reason: "unknown-run" } } as never;
        if (run.state !== "running" && run.state !== "waiting")
          return { _tag: "Rejected", rejection: { reason: "run-not-running" } } as never;
        if (this.header.session?.steer !== true)
          return { _tag: "Rejected", rejection: { reason: "steer-unsupported" } } as never;
        this.applied.push({ commandId, op: "steer", payload });
        const itemId = this.commit((change) =>
          this.addItem(change, run.id, {
            kind: "person",
            by: { kind: "person", principal: { kind: "person", subject: "owner" } },
            text: String(payload.text),
            attachments: [],
            sendId: commandId,
            delivery: { state: "steered", at: this.stamp(this.seq) },
          }),
        );
        return { _tag: "Accepted", seq: this.seq, runId: run.id, itemId } as never;
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
                at: this.stamp(seq),
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
      case WS_METHODS.engineSwitchModel: {
        this.applied.push({ commandId, op: "switch-model", payload });
        this.commit((change) => {
          this.next();
          const agent = this.header.agent;
          this.header = decodeHeader({
            ...this.header,
            model: String(payload.model),
            agent:
              agent === null
                ? null
                : {
                    ...agent,
                    model: String(payload.model),
                    ...(payload.options === undefined ? {} : { options: payload.options }),
                  },
          });
          change.header = true;
        });
        return { _tag: "Accepted", seq: this.seq } as never;
      }
      case WS_METHODS.engineSetArchived: {
        this.applied.push({ commandId, op: "set-archived", payload });
        this.commit((change) => {
          this.next();
          this.header = decodeHeader({ ...this.header, archived: payload.archived });
          change.header = true;
        });
        return { _tag: "Accepted", seq: this.seq } as never;
      }
      case WS_METHODS.engineSetRuntimeMode: {
        this.applied.push({ commandId, op: "set-runtime-mode", payload });
        this.commit((change) => {
          this.next();
          this.header = decodeHeader({ ...this.header, runtimeMode: payload.runtimeMode });
          change.header = true;
        });
        return { _tag: "Accepted", seq: this.seq } as never;
      }
      case WS_METHODS.engineAssignAgent: {
        // As the engine: another driver only before the conversation started.
        const driver = String(payload.instanceId).split(":")[0]!;
        const current = this.header.agent;
        if (current !== null && current.driver !== driver && this.runs.size > 0)
          return {
            _tag: "Rejected",
            rejection: {
              reason: "agent-locked",
              detail: `This conversation is bound to driver '${current.driver}' and cannot switch to '${driver}'.`,
            },
          } as never;
        this.applied.push({ commandId, op: "assign-agent", payload });
        this.commit((change) => {
          this.next();
          this.header = decodeHeader({
            ...this.header,
            model: String(payload.model),
            agent: {
              instanceId: String(payload.instanceId),
              driver,
              model: String(payload.model),
              ...(payload.options === undefined ? {} : { options: payload.options }),
              profile: { kind: "mate" },
            },
          });
          change.header = true;
        });
        return { _tag: "Accepted", seq: this.seq } as never;
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
        // The run it names, as the engine stops it: an ended one is refused, never another run.
        const named = payload.runId === undefined ? running : this.runs.get(String(payload.runId));
        if (payload.runId !== undefined && named === undefined)
          return { _tag: "Rejected", rejection: { reason: "unknown-run" } } as never;
        if (named?.state === "ended")
          return { _tag: "Rejected", rejection: { reason: "run-ended" } } as never;
        if (named === undefined)
          return { _tag: "Rejected", rejection: { reason: "run-not-running" } } as never;
        this.applied.push({ commandId, op: "stop", payload });
        this.commit((change) =>
          this.endRun(change, named.id, {
            kind: "stopped",
            by: { kind: "person", subject: "owner" },
          }),
        );
        return { _tag: "Accepted", seq: this.seq, runId: named.id } as never;
      }
      default:
        return {
          _tag: "Rejected",
          rejection: { reason: running === undefined ? "run-not-running" : "steer-unsupported" },
        } as never;
    }
  }
}
