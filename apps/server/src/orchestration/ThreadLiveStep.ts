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
 * it. Cleared when the turn settles or the session dies; no persistence, no
 * migration (same pattern as ThreadPlanProgressService).
 *
 * The step follows the card's rule for its now line
 * (`MessagesTimeline.logic.ts` `liveActivity`): the newest call made since the
 * Mate last thought or spoke that still runs; else its words while they
 * stream; else thinking. A call it made before a thought is behind that
 * thought, however long it runs on.
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
  /** The turn started: nothing done yet, so it thinks. */
  | { readonly type: "turn-started"; readonly at: string }
  /** A call started, or told more of itself while it runs. */
  | { readonly type: "call-running"; readonly call: ThreadLiveCall }
  /** A call ended, however it ended. */
  | { readonly type: "call-ended"; readonly callId: string; readonly at: string }
  /** It thinks: a thought streams. */
  | { readonly type: "thinking"; readonly at: string }
  /** Its words stream. */
  | { readonly type: "writing"; readonly at: string }
  /** Its words are out. */
  | { readonly type: "words-ended"; readonly at: string };

/** How many running calls a step carries at most: the newest. */
const MAX_LIVE_CALLS = 8;
/** A plain argument is cut to this many characters, as a projected input field is. */
const MAX_INPUT_VALUE_LENGTH = 300;
/** How many plain arguments of a call ride along at most. */
const MAX_INPUT_FIELDS = 16;

interface LiveState {
  /** Calls made since it last thought or spoke that still run, by start. */
  readonly calls: ReadonlyArray<ThreadLiveCall>;
  /** What it does while none runs. */
  readonly between: "thinking" | "writing";
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
): LiveState {
  return { calls, between, since, step: stepOf(calls, between, since) };
}

/** It turns to thinking or writing: a change of what it is on only if it was on something else. */
function turnTo(state: LiveState, between: LiveState["between"], at: string): LiveState {
  if (state.calls.length === 0 && state.between === between) return state;
  return stateOf([], between, at);
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
  if (observation.type === "turn-started") return stateOf([], "thinking", observation.at);
  // What arrives while no turn runs is a finished turn's late word.
  if (state === undefined) return undefined;
  switch (observation.type) {
    case "call-running": {
      const index = state.calls.findIndex((call) => call.id === observation.call.id);
      if (index === -1) {
        return stateOf([...state.calls, observation.call], state.between, state.since);
      }
      const known = state.calls[index]!;
      const call = { ...observation.call, startedAt: known.startedAt };
      if (sameCall(known, call)) return state;
      const calls = state.calls.map((entry, at) => (at === index ? call : entry));
      return { ...state, calls, step: stepOf(calls, state.between, state.since) };
    }
    case "call-ended": {
      if (!state.calls.some((call) => call.id === observation.callId)) return state;
      const calls = state.calls.filter((call) => call.id !== observation.callId);
      // The last call it was on ended: it thinks, from now.
      return calls.length === 0
        ? stateOf([], "thinking", observation.at)
        : stateOf(calls, state.between, state.since);
    }
    case "thinking":
      return turnTo(state, "thinking", observation.at);
    case "writing":
      return turnTo(state, "writing", observation.at);
    case "words-ended":
      return state.calls.length === 0 && state.between === "writing"
        ? stateOf([], "thinking", observation.at)
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
    kept[key] =
      text.length <= MAX_INPUT_VALUE_LENGTH
        ? text
        : Array.from(`${text.slice(0, MAX_INPUT_VALUE_LENGTH - 1).trimEnd()}…`).join("");
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
  const command =
    asText(item?.command) ??
    asText(asRecord(item?.input)?.command) ??
    asText(asRecord(item?.result)?.command) ??
    asText(data?.command);
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
  const runs = activity.kind !== "tool.completed" && stillRuns(asRecord(activity.payload)?.status);
  return runs
    ? { type: "call-running", call }
    : { type: "call-ended", callId: call.id, at: activity.createdAt };
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
