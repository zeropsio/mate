/**
 * From the bridge's signals to what the engine takes: the boundaries `decide` reads, the evidence
 * a send waits on, and the live text that is never stored. Pure — the time comes in with each
 * signal — and one per session, as the bridge's fold is.
 *
 * - A turn's signals carry their turn, so `decide` files each on its own run.
 * - Text and reasoning flow live as appends; at an item's close its whole text goes into the
 *   record (16 KiB in the body, all of it as the item's detail when longer).
 * - Deltas say the turn is alive: at most one `activity` a minute per turn, since every boundary
 *   the actor takes writes a receipt.
 * - A session the engine closed itself is settled by its own effect; any other close is the
 *   session exiting under the engine.
 *
 * @module engine/pump/toCore
 */
import type {
  ItemActor,
  ItemBody,
  RequestAsk,
  RequestState,
  RunId,
  ThreadTokenUsageSnapshot,
  TurnHandle,
} from "@t3tools/contracts";

import type {
  AppendStream,
  DriverSignal,
  ItemBody as SpiItemBody,
  ItemStatus,
  RequestAsk as SpiRequestAsk,
  RequestCloseHow,
  SessionCloseAsk,
  SessionCloseCause,
  WorkStatus,
} from "../bridge/spi3.ts";
import type { ProviderSignal } from "../domain/command.ts";

/** How long a body's text is in the record; the rest is the item's detail. */
export const ITEM_TEXT_LIMIT = 16 * 1024;
/** A thought's preview in the record. */
export const THOUGHT_PREVIEW = 280;
/** At most one `activity` per turn in this long. */
export const ACTIVITY_EVERY_MS = 60_000;

/** What a send learned from the driver: taken (into which turn), refused, or its session closed. */
export type SendEvidence =
  | {
      readonly _tag: "Accepted";
      readonly as: "opened" | "steered" | "queued";
      /** steered: the turn it joined; queued: the turn it waits behind. */
      readonly into: TurnHandle | null;
    }
  | { readonly _tag: "Refused"; readonly words: string; readonly undelivered: boolean | "unknown" }
  | { readonly _tag: "Closed"; readonly words: string };

/** What goes to the live plane only: never stored. */
export type LiveOp =
  | {
      readonly _tag: "Append";
      readonly key: string;
      readonly stream: AppendStream;
      readonly offset: number;
      readonly text: string;
    }
  | { readonly _tag: "Context"; readonly usage: ThreadTokenUsageSnapshot }
  /** The item closed: its text is in the record now. */
  | { readonly _tag: "Settle"; readonly key: string };

/** The session's own life, for the host. */
export type SessionChange =
  | { readonly _tag: "Opened"; readonly implicit: boolean }
  | { readonly _tag: "Closed"; readonly asked: boolean; readonly words: string };

export interface CoreStep {
  readonly signals: ReadonlyArray<ProviderSignal>;
  readonly evidence: ReadonlyArray<{ readonly turn: TurnHandle; readonly evidence: SendEvidence }>;
  readonly live: ReadonlyArray<LiveOp>;
  readonly session: SessionChange | null;
}

export interface ToCoreOptions {
  /** The driver's own id for a turn, when it named one. */
  readonly nativeTurn?: (turn: TurnHandle) => string | undefined;
}

export interface ToCore {
  readonly step: (signal: DriverSignal, now: number) => CoreStep;
  /** Background work still alive in this session: an idle close keeps the session for it. */
  readonly liveWork: () => number;
}

interface ItemState {
  readonly turn: TurnHandle;
  readonly by: ItemActor;
  body: SpiItemBody;
  status: ItemStatus;
  readonly text: Map<AppendStream, string>;
  /** The body last given to `decide`, so a repeat is not told again. */
  told: string | null;
  closed: boolean;
}

const ASKED_CLOSES: ReadonlySet<SessionCloseCause> = new Set<SessionCloseAsk>([
  "rotate",
  "asked",
  "idle",
  "shutdown",
]);

const LIVE_WORK: ReadonlySet<WorkStatus> = new Set(["running", "waiting", "idle"]);

const CLOSE_WORDS: Record<string, string> = {
  "stopped-turn": "The session closed with the stopped turn.",
  "process-exit": "The agent's process exited.",
  "open-failed": "The session could not open.",
  unknown: "The session closed.",
};

export const makeToCore = (options: ToCoreOptions = {}): ToCore => {
  const items = new Map<string, ItemState>();
  const liveWork = new Set<string>();
  /** Turns the engine sent, by handle: a self turn reports on the run whose work just ended. */
  const engineTurns = new Set<string>();
  const selfReports = new Map<string, RunId | null>();
  let lastEndedWorkOrigin: string | null = null;
  const lastActivity = new Map<string, number>();
  let markers = 0;

  const reportsOn = (): RunId | null => {
    if (lastEndedWorkOrigin === null) return null;
    if (engineTurns.has(lastEndedWorkOrigin)) return lastEndedWorkOrigin as RunId;
    return selfReports.get(lastEndedWorkOrigin) ?? null;
  };

  const step = (signal: DriverSignal, now: number): CoreStep => {
    const signals: Array<ProviderSignal> = [];
    const evidence: Array<{ readonly turn: TurnHandle; readonly evidence: SendEvidence }> = [];
    const live: Array<LiveOp> = [];
    let session: SessionChange | null = null;

    const marker = (turn: TurnHandle | undefined, kind: string, reason?: string) => {
      if (turn === undefined) return;
      markers += 1;
      const body: ItemBody = {
        kind: "marker",
        marker: reason === undefined ? { kind } : { kind, reason },
      };
      signals.push({
        kind: "item-closed",
        turn,
        key: `${signal.session}.n${markers}`,
        by: { kind: "engine" },
        body,
      });
    };

    switch (signal.type) {
      case "session.opened":
        session = { _tag: "Opened", implicit: signal.implicit };
        break;
      case "session.cursor":
        // ProviderService keeps the binding's cursor; the next open resumes from it.
        break;
      case "session.closed": {
        const asked = ASKED_CLOSES.has(signal.cause);
        const words = signal.words ?? CLOSE_WORDS[signal.cause] ?? CLOSE_WORDS.unknown!;
        session = { _tag: "Closed", asked, words };
        liveWork.clear();
        if (!asked) signals.push({ kind: "session-exited", reason: words });
        break;
      }
      case "send.accepted":
        evidence.push({
          turn: signal.turn,
          evidence: { _tag: "Accepted", as: signal.as, into: signal.into ?? null },
        });
        break;
      case "send.refused":
        evidence.push({
          turn: signal.turn,
          evidence: { _tag: "Refused", words: signal.words, undelivered: signal.undelivered },
        });
        break;
      case "turn.opened": {
        if (signal.origin === "engine") engineTurns.add(signal.turn);
        const reports = signal.origin === "self" ? reportsOn() : null;
        if (signal.origin === "self") selfReports.set(signal.turn, reports);
        signals.push({
          kind: "turn-started",
          turn: signal.turn,
          origin: signal.origin,
          providerTurnId: options.nativeTurn?.(signal.turn) ?? null,
          ...(signal.origin === "self" ? { reportsOn: reports } : {}),
        });
        break;
      }
      case "turn.ended":
        lastActivity.delete(signal.turn);
        signals.push({
          kind: "turn-ended",
          turn: signal.turn,
          outcome: signal.outcome,
          source: signal.source,
        });
        break;
      case "item.upsert": {
        let item = items.get(signal.item);
        const first = item === undefined;
        if (item === undefined) {
          item = {
            turn: signal.turn,
            by:
              signal.helper === undefined
                ? { kind: "mate" }
                : { kind: "helper", helperId: signal.helper },
            body: signal.body,
            status: signal.status,
            text: new Map(),
            told: null,
            closed: false,
          };
          items.set(signal.item, item);
        }
        item.body = signal.body;
        item.status = signal.status;
        const closing = signal.status !== "running";
        const { body, detail } = engineBody(item, now);
        const afterEnd = signal.afterEnd === true ? { afterEnd: true as const } : {};
        const told = JSON.stringify(body);
        if (closing && !first && item.closed && told === item.told) {
          // The same end said again: the record already holds it.
        } else if (closing) {
          item.closed = true;
          signals.push({
            kind: "item-closed",
            turn: item.turn,
            key: signal.item,
            by: item.by,
            body,
            ...(detail === undefined ? {} : { detail }),
            ...afterEnd,
          });
          live.push({ _tag: "Settle", key: signal.item });
        } else if (first) {
          signals.push({
            kind: "item-opened",
            turn: item.turn,
            key: signal.item,
            by: item.by,
            body,
            ...afterEnd,
          });
        } else if (told !== item.told) {
          signals.push({
            kind: "item-updated",
            turn: item.turn,
            key: signal.item,
            body,
            ...afterEnd,
          });
        }
        item.told = told;
        break;
      }
      case "item.append": {
        const item = items.get(signal.item);
        live.push({
          _tag: "Append",
          key: signal.item,
          stream: signal.stream,
          offset: signal.at,
          text: signal.text,
        });
        if (item === undefined) break;
        const before = item.text.get(signal.stream) ?? "";
        // The offset places the text: one replayed never doubles what is there.
        item.text.set(
          signal.stream,
          signal.at <= before.length
            ? before.slice(0, signal.at) + signal.text
            : before + signal.text,
        );
        const last = lastActivity.get(item.turn);
        if (last === undefined || now - last >= ACTIVITY_EVERY_MS) {
          lastActivity.set(item.turn, now);
          signals.push({ kind: "activity", turn: item.turn });
        }
        break;
      }
      case "work.upsert":
        if (LIVE_WORK.has(signal.status)) liveWork.add(signal.work);
        else {
          liveWork.delete(signal.work);
          if (signal.origin !== "unknown") lastEndedWorkOrigin = signal.origin;
        }
        signals.push({
          kind: "work-upserted",
          work: signal.work,
          origin: signal.origin,
          workKind: signal.kind,
          status: signal.status,
          ...(signal.title === undefined ? {} : { title: signal.title }),
        });
        break;
      case "request.opened":
        signals.push({
          kind: "request-opened",
          ...(signal.turn === undefined ? {} : { turn: signal.turn }),
          key: signal.request,
          ask: engineAsk(signal.ask),
        });
        break;
      case "request.closed":
        signals.push({
          kind: "request-closed",
          key: signal.request,
          state: closedState(signal.how),
        });
        break;
      case "usage.context":
        live.push({ _tag: "Context", usage: signal.usage });
        break;
      case "usage.limit":
        signals.push({
          kind: "usage-limit",
          ...(signal.turn === undefined ? {} : { turn: signal.turn }),
          resetsAt: resetTime(signal.resetsAt),
          parks: signal.effect === "parks-turn",
        });
        break;
      case "context.compacted":
        marker(signal.turn, "compacted");
        break;
      case "plan.updated":
        marker(signal.turn, "plan", signal.explanation ?? signal.proposal);
        break;
      case "notice":
        if (signal.level === "error") marker(signal.turn, "error", signal.words);
        break;
    }
    return { signals, evidence, live, session };
  };

  return { step, liveWork: () => liveWork.size };
};

const resetTime = (resetsAt: string): number | null => {
  if (resetsAt === "unknown") return null;
  const at = Date.parse(resetsAt);
  return Number.isNaN(at) ? null : at;
};

const closedState = (how: RequestCloseHow): Exclude<RequestState, "open"> => {
  switch (how) {
    case "answered":
      return "answered";
    case "cancelled":
      return "dismissed";
    default:
      return "lapsed";
  }
};

const engineAsk = (ask: SpiRequestAsk): RequestAsk =>
  ask.kind === "approval"
    ? { kind: "approval", requestKind: ask.requestType, detail: ask.detail ?? "" }
    : { kind: "question", questions: [...ask.questions], dismissible: true };

/** A call's kind in the record, from the driver's tool kind. */
const STEPS: Record<string, string> = {
  command_execution: "command",
  file_change: "edit",
  web_search: "web",
  image_view: "look",
  collab_agent_tool_call: "helper",
  mcp_tool_call: "tool",
  dynamic_tool_call: "tool",
};

const CALL_STATES: Record<ItemStatus, string> = {
  running: "running",
  completed: "done",
  failed: "failed",
  declined: "declined",
  unreturned: "unreturned",
  cut: "stopped",
};

const capped = (text: string): { readonly text: string; readonly detail?: string } =>
  text.length > ITEM_TEXT_LIMIT ? { text: text.slice(0, ITEM_TEXT_LIMIT), detail: text } : { text };

/** The record's body for an item: its text so far, its state, and the rest as detail. */
const engineBody = (
  item: ItemState,
  now: number,
): { readonly body: ItemBody; readonly detail?: string } => {
  const streaming = item.status === "running";
  const endedAt = streaming ? null : now;
  const body = item.body;
  switch (body.kind) {
    case "text":
    case "plan": {
      const { text, detail } = capped(item.text.get(body.kind) ?? item.text.get("text") ?? "");
      return {
        body: { kind: "note", text, streaming, answer: false },
        ...(detail === undefined ? {} : { detail }),
      };
    }
    case "reasoning": {
      const all = item.text.get("reasoning") ?? "";
      return {
        body: {
          kind: "thought",
          preview: all.slice(0, THOUGHT_PREVIEW),
          length: all.length,
          streaming,
        },
        ...(all.length > THOUGHT_PREVIEW ? { detail: all } : {}),
      };
    }
    case "compaction":
      return { body: { kind: "marker", marker: { kind: "compacted" } } };
    case "error":
      return { body: { kind: "marker", marker: { kind: "error", reason: body.words } } };
    case "tool":
    case "other": {
      const call = body.kind === "tool" ? body.call : undefined;
      const output = item.text.get("output");
      return {
        body: {
          kind: "call",
          step: body.kind === "tool" ? (STEPS[body.toolKind] ?? "tool") : "tool",
          tool: {
            name: call?.name ?? body.title ?? (body.kind === "tool" ? body.toolKind : "tool"),
            ...(call?.server === undefined ? {} : { server: call.server }),
          },
          words: body.title ?? null,
          state: CALL_STATES[item.status] as Extract<ItemBody, { kind: "call" }>["state"],
          endedAt,
        },
        ...(output === undefined || output === "" ? {} : { detail: output }),
      };
    }
  }
};
