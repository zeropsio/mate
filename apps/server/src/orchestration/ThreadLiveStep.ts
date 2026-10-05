/**
 * ThreadLiveStepService - in-memory per-thread live step for the menu's rows:
 * what a running turn is on this moment, as the raw facts its run's card
 * phrases its now line from (`ThreadLiveStep`). The menu has only the
 * thread's shell, never its activities, so the server relays them.
 *
 * Ingestion observes each change BEFORE it dispatches the activity or the
 * message that goes with it, and the shell query reads the step when it maps
 * a shell. The shell stream re-reads a thread's shell for every event of that
 * thread (`ws.ts`, coalesced over 50 ms), so a step reaches subscribers on the
 * very event that changed it: no push of its own and no timer, and the step
 * changes only when a step does — a command's streaming output never moves
 * it. Cleared once no turn is active — it settled, the session errored,
 * stopped, went idle or exited — on a runtime error, and when the thread is
 * deleted or archived (its events are not followed after); the shell carries
 * it only while its own session runs a turn, so a turn ended by any other way
 * leaves nothing behind. No persistence, no migration (same pattern as
 * ThreadPlanProgressService).
 *
 * The step follows the card's rule for its live slot
 * (`MessagesTimeline.logic.ts` `liveActivity`): the calls of the newest batch
 * that still run; else its words while they stream; else thinking. A call it
 * made before a thought is behind that thought, however long it runs on. The
 * batch rule (`@t3tools/shared/liveBatch`): a batch is one model response,
 * and the next response starts only once every call of the one before has
 * returned, so a call of a newer response opens a newer batch, and a call an
 * older batch left running lost its completion — it is dropped, never
 * "Running" until the next thought. Where the provider never names a response
 * (Codex, `batchesByTiming`), a call that starts after another returned opens
 * the newer batch; a Claude call that names none never opens one by timing.
 *
 * @module ThreadLiveStepService
 */
import {
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type ThreadLiveCall,
  type ThreadLiveStep,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

export type LiveStepObservation =
  /**
   * The turn started: nothing done yet, so it thinks. Whether a call that
   * names no response opens a newer batch by timing: its provider never
   * names one (`batchesByTiming`).
   */
  | { readonly type: "turn-started"; readonly at: string; readonly byTiming: boolean }
  /**
   * A call started, or told more of itself while it runs; on its start, the
   * model response it was written in, where the provider names one.
   */
  | {
      readonly type: "call-running";
      readonly call: ThreadLiveCall;
      readonly response?: string | undefined;
    }
  /** A call ended, however it ended. */
  | { readonly type: "call-ended"; readonly callId: string; readonly at: string }
  /** It thinks: a thought streams. */
  | { readonly type: "thinking"; readonly at: string }
  /** Its words stream. */
  | { readonly type: "writing"; readonly at: string }
  /** Its words are out. */
  | { readonly type: "words-ended"; readonly at: string };

// The step rides on every shell refresh of a working thread, so what it
// carries is bounded; a realistic step is a few hundred bytes.
/** How many running calls a step carries at most: the newest. */
const MAX_LIVE_CALLS = 4;
/** A plain argument is cut to this many characters, as a projected input field is. */
const MAX_INPUT_VALUE_LENGTH = 300;
/** How many plain arguments of a call ride along at most. */
const MAX_INPUT_FIELDS = 8;
/** A command is cut to this many characters: a row reads its first line. */
const MAX_COMMAND_LENGTH = 2_000;

interface LiveState {
  /** Calls made since it last thought or spoke that still run, by start. */
  readonly calls: ReadonlyArray<ThreadLiveCall>;
  /** What it does while none runs. */
  readonly between: "thinking" | "writing";
  /** A call that names no response opens a newer batch by timing (`batchesByTiming`). */
  readonly byTiming: boolean;
  /**
   * A call returned since the newest one started: for calls that name no
   * response, the next call opens a newer batch.
   */
  readonly returned: boolean;
  /** The model response the running calls were written in; a call of another opens a newer batch. */
  readonly response?: string | undefined;
  /** When what it is on began. */
  readonly since: string;
  /** The step as the shell carries it: the same value until it changes. */
  readonly step: ThreadLiveStep;
}

function stepOf(
  calls: ReadonlyArray<ThreadLiveCall>,
  between: LiveState["between"],
  since: string,
): ThreadLiveStep {
  const newest = calls.at(-1);
  return newest === undefined
    ? { kind: between, since }
    : { kind: "calls", since: newest.startedAt, calls: calls.slice(-MAX_LIVE_CALLS) };
}

function stateOf(
  calls: ReadonlyArray<ThreadLiveCall>,
  between: LiveState["between"],
  since: string,
  byTiming: boolean,
): LiveState {
  return { calls, between, since, byTiming, returned: false, step: stepOf(calls, between, since) };
}

/**
 * It turns to thinking or writing: a change of what it is on only if it was on
 * something else, and only from after its newest call started — words or a
 * thought stamped at that instant came with the call, not after it (run 12:
 * a note and a command's start at 14:40:20.255Z read "Thinking" through the
 * whole command).
 */
function turnTo(state: LiveState, between: LiveState["between"], at: string): LiveState {
  if (state.calls.length === 0 && state.between === between) return state;
  const newest = state.calls.at(-1);
  if (newest !== undefined && Date.parse(at) <= Date.parse(newest.startedAt)) return state;
  return stateOf([], between, at, state.byTiming);
}

function sameStrings(
  left: Readonly<Record<string, string>> | ReadonlyArray<string> | undefined,
  right: Readonly<Record<string, string>> | ReadonlyArray<string> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => {
      const other = rightEntries[index];
      return other !== undefined && other[0] === key && other[1] === value;
    })
  );
}

/** The same facts: an update that told nothing new is no change. */
function sameCall(left: ThreadLiveCall, right: ThreadLiveCall): boolean {
  return (
    left.id === right.id &&
    left.activityKind === right.activityKind &&
    left.itemType === right.itemType &&
    left.title === right.title &&
    left.detail === right.detail &&
    left.toolName === right.toolName &&
    left.command === right.command &&
    left.imagePath === right.imagePath &&
    left.startedAt === right.startedAt &&
    sameStrings(left.input, right.input) &&
    sameStrings(left.files, right.files)
  );
}

export function nextLiveState(
  state: LiveState | undefined,
  observation: LiveStepObservation,
): LiveState | undefined {
  if (observation.type === "turn-started") {
    return stateOf([], "thinking", observation.at, observation.byTiming);
  }
  // What arrives while no turn runs is a finished turn's late word.
  if (state === undefined) return undefined;
  switch (observation.type) {
    case "call-running": {
      const index = state.calls.findIndex((call) => call.id === observation.call.id);
      if (index === -1) {
        // A call of a newer response — or, where the provider names none, a
        // call after a return — opens a newer batch: what the older left
        // running lost its completion. A call that names no response keeps
        // the batch's.
        const newer =
          observation.response !== undefined && state.response !== undefined
            ? observation.response !== state.response
            : state.byTiming && state.returned;
        const batch = newer ? [] : state.calls;
        const next = stateOf(
          [...batch, observation.call],
          state.between,
          state.since,
          state.byTiming,
        );
        const response = observation.response ?? (newer ? undefined : state.response);
        return response === undefined ? next : { ...next, response };
      }
      const known = state.calls[index]!;
      const call = { ...observation.call, startedAt: known.startedAt };
      if (sameCall(known, call)) return state;
      const calls = state.calls.map((entry, at) => (at === index ? call : entry));
      return { ...state, calls, step: stepOf(calls, state.between, state.since) };
    }
    case "call-ended": {
      // A call returned — one it follows or not: the batch is done calling.
      if (!state.calls.some((call) => call.id === observation.callId)) {
        return state.returned || state.calls.length === 0 ? state : { ...state, returned: true };
      }
      const calls = state.calls.filter((call) => call.id !== observation.callId);
      // The last call it was on ended: it thinks, from now.
      return calls.length === 0
        ? { ...stateOf([], "thinking", observation.at, state.byTiming), response: state.response }
        : {
            ...stateOf(calls, state.between, state.since, state.byTiming),
            returned: true,
            response: state.response,
          };
    }
    case "thinking":
      return turnTo(state, "thinking", observation.at);
    case "writing":
      return turnTo(state, "writing", observation.at);
    case "words-ended":
      return state.calls.length === 0 && state.between === "writing"
        ? stateOf([], "thinking", observation.at, state.byTiming)
        : state;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A text cut at `max` characters, an ellipsis where it goes on; the cut owns its characters. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : Array.from(`${text.slice(0, max - 1).trimEnd()}…`).join("");
}

/** A call's plain arguments, each cut short: what it says of itself and what it names. */
function plainArguments(source: Record<string, unknown> | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  if (source === undefined) return kept;
  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(kept).length >= MAX_INPUT_FIELDS) break;
    // The command rides as the call's own fact.
    if (key === "command") continue;
    const text = asText(value);
    if (text === undefined) continue;
    kept[key] = cut(text, MAX_INPUT_VALUE_LENGTH);
  }
  return kept;
}

/**
 * The call a tool activity stands for, as the facts its card reads off it —
 * read from the activity as a client receives it (`projectActivityPayload`),
 * so the two can only ever have the same facts. Null for what is not a call
 * of the Mate's own: words, a task, a helper's call (its card files that
 * under the helper), a call with no id to follow it by.
 */
export function liveCallOf(activity: OrchestrationThreadActivity): ThreadLiveCall | null {
  const payload = asRecord(projectActivityPayload(activity).payload);
  const itemType = asText(payload?.itemType);
  const id = asText(payload?.toolCallId);
  if (payload === undefined || itemType === undefined || id === undefined) return null;
  if (!isToolLifecycleItemType(itemType) || asText(payload.agentId) !== undefined) return null;
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  const toolName = asText(data?.toolName) ?? asText(item?.tool);
  // The command where a client looks for it, in the order it looks.
  const whole =
    asText(item?.command) ??
    asText(asRecord(item?.input)?.command) ??
    asText(asRecord(item?.result)?.command) ??
    asText(data?.command);
  const command = whole === undefined ? undefined : cut(whole, MAX_COMMAND_LENGTH);
  const input = plainArguments(asRecord(data?.input) ?? asRecord(item?.arguments));
  const imagePath = asText(data?.imagePath);
  const files = Array.isArray(data?.files)
    ? data.files.flatMap((file) => {
        const path = asText(asRecord(file)?.path);
        return path === undefined ? [] : [path];
      })
    : [];
  const detail = asText(payload.detail);
  const title =
    activity.kind === "tool.started"
      ? activity.summary.replace(/ started$/u, "")
      : activity.summary;
  return {
    id,
    activityKind: activity.kind,
    itemType,
    title: asText(title) ?? "Tool",
    ...(detail === undefined ? {} : { detail }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(command === undefined ? {} : { command }),
    ...(Object.keys(input).length === 0 ? {} : { input }),
    ...(imagePath === undefined ? {} : { imagePath }),
    ...(files.length === 0 ? {} : { files }),
    startedAt: activity.createdAt,
  };
}

/** What a status on a call's update says: it still runs, unless it says it ended. */
function stillRuns(status: unknown): boolean {
  return status === undefined || status === "inProgress";
}

/** What an activity ingestion appends says of the step: a call running or ended, or nothing. */
export function liveStepObservationOf(
  activity: OrchestrationThreadActivity,
): LiveStepObservation | null {
  if (
    activity.kind !== "tool.started" &&
    activity.kind !== "tool.updated" &&
    activity.kind !== "tool.completed"
  ) {
    return null;
  }
  const call = liveCallOf(activity);
  if (call === null) return null;
  const payload = asRecord(activity.payload);
  const runs = activity.kind !== "tool.completed" && stillRuns(payload?.status);
  const response = asText(payload?.responseId);
  if (!runs) return { type: "call-ended", callId: call.id, at: activity.createdAt };
  return response === undefined
    ? { type: "call-running", call }
    : { type: "call-running", call, response };
}

export class ThreadLiveStepService extends Context.Service<
  ThreadLiveStepService,
  {
    /** One change of what the thread's running turn is on. */
    readonly observe: (threadId: string, observation: LiveStepObservation) => void;

    /** Turn settled or session died: nothing is live anymore. */
    readonly clearThread: (threadId: string) => void;

    /** The step, the same value until it changes; null while no turn runs. */
    readonly getThreadLiveStep: (threadId: string) => ThreadLiveStep | null;
  }
>()("t3/orchestration/ThreadLiveStep/ThreadLiveStepService") {}

export function make(): ThreadLiveStepService["Service"] {
  const stateByThreadId = new Map<string, LiveState>();

  return {
    observe: (threadId, observation) => {
      const next = nextLiveState(stateByThreadId.get(threadId), observation);
      if (next === undefined) stateByThreadId.delete(threadId);
      else stateByThreadId.set(threadId, next);
    },

    clearThread: (threadId) => {
      stateByThreadId.delete(threadId);
    },

    getThreadLiveStep: (threadId) => stateByThreadId.get(threadId)?.step ?? null,
  };
}

export const layer = Layer.effect(ThreadLiveStepService, Effect.sync(make));
