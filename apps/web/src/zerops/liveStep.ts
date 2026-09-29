/**
 * A Mate's live step in its run card's words — what a working row's third
 * line says. The server relays the moment's raw facts on the thread's shell
 * (`OrchestrationThreadShell.liveStep`), since the menu never loads a
 * thread's activities; this puts them through the card's own derivation, so
 * the menu and the card can never say different things: each relayed call
 * becomes the activity the card read it from, and goes through
 * `deriveZeropsThreadModel` and `deriveWorkLogEntries` as the card's
 * timeline does, then `stepOf` — the step, in its words and its command.
 *
 * The newest call the card would draw is the step, said as the card's now
 * line says it (`nowLineWords`), and several steps at once as it says them —
 * "Running 3 commands"; a call it draws nothing for yet (a call whose input
 * is still streaming in, a Zerops call it keeps out of the chat) is none, and
 * with none left the Mate is still thinking.
 */
import {
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
  type ThreadLiveCall,
  type ThreadLiveStep,
} from "@t3tools/contracts";
import { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";
import { maskSecrets } from "@t3tools/shared/messagePreview";

import { isActivityWork, isQuestionToolCall } from "../components/chat/conversation.logic";
import { nowLineWords, severalWords, type NowLine } from "../components/chat/runCard.logic";
import { stepOf } from "../components/chat/workSteps.logic";
import {
  deriveWorkLogEntries,
  zeropsCallToWorkLogEntry,
  type WorkLogEntry,
} from "../session-logic";

/** A live step as a row says it: its words, and the command it runs after them. */
export interface LiveStepWords {
  readonly words: string;
  readonly code?: string | undefined;
}

// The now line's words for what is no call.
const THINKING: LiveStepWords = { words: nowLineWords({ kind: "thinking", thought: null }) };
const WRITING: LiveStepWords = { words: nowLineWords({ kind: "writing" }) };

/** The turn a relayed call runs under: the running one, for the card's model. */
const LIVE_TURN = TurnId.make("live-step");

/** A relayed call as the activity its card read it from. */
function callActivity(call: ThreadLiveCall): OrchestrationThreadActivity {
  return {
    id: EventId.make(`live-step:${call.id}`),
    createdAt: call.startedAt,
    tone: "tool",
    kind: call.activityKind,
    summary: call.title,
    turnId: LIVE_TURN,
    payload: {
      itemType: call.itemType,
      toolCallId: call.id,
      status: "inProgress",
      ...(call.detail === undefined ? {} : { detail: call.detail }),
      data: {
        toolCallId: call.id,
        ...(call.toolName === undefined ? {} : { toolName: call.toolName }),
        ...(call.command === undefined ? {} : { command: call.command }),
        ...(call.input === undefined ? {} : { input: call.input }),
        ...(call.imagePath === undefined ? {} : { imagePath: call.imagePath }),
        ...(call.files === undefined ? {} : { files: call.files.map((path) => ({ path })) }),
      },
    },
  };
}

/** One call the card's now line carries: a step, a platform operation, or its question. */
type CallLine = Extract<NowLine, { readonly kind: "step" | "operation" | "waiting" }>;

/** A call on its way, as the card's now line has it: none for what the card's now skips. */
function entryLine(entry: WorkLogEntry): CallLine | null {
  if (entry.toolLifecycleStatus !== "inProgress" || !isActivityWork(entry)) return null;
  if (isQuestionToolCall(entry)) return { kind: "waiting", on: "answer" };
  const step = stepOf(entry);
  // A command that says nothing of itself is its own title; with no command either, nothing yet.
  return step.words === null && step.code === null ? null : { kind: "step", step };
}

/** A call the now line carries, in its words — a command's code after its own words. */
function lineWords(line: CallLine): LiveStepWords {
  const words = nowLineWords(line);
  return line.kind === "step" && line.step.words !== null && line.step.code !== null
    ? { words, code: line.step.code }
    : { words };
}

/** One running call as the card's now line has it; null for a call the card draws nothing for yet. */
function callLine(call: ThreadLiveCall): CallLine | null {
  const activity = callActivity(call);
  const zerops = deriveZeropsThreadModel({
    activities: [activity],
    runningTurnId: LIVE_TURN,
    nowMs: Date.parse(call.startedAt),
  });
  if (zerops.zeropsActivityIds.has(activity.id)) {
    const entry = zerops.entries[0];
    if (entry === undefined) return null;
    if (entry.kind === "generic-call") return entryLine(zeropsCallToWorkLogEntry(entry.call));
    return entry.operation.phase === "running"
      ? { kind: "operation", operation: entry.operation }
      : null;
  }
  const [entry] = deriveWorkLogEntries([activity]);
  return entry === undefined ? null : entryLine(entry);
}

function masked(words: LiveStepWords): LiveStepWords {
  return words.code === undefined
    ? { words: maskSecrets(words.words) }
    : { words: maskSecrets(words.words), code: maskSecrets(words.code) };
}

/** What the Mate is on this moment, in its card's words. */
export function liveStepWords(step: ThreadLiveStep): LiveStepWords {
  switch (step.kind) {
    case "thinking":
      return THINKING;
    case "writing":
      return WRITING;
    case "calls": {
      const lines = step.calls.flatMap((call) => {
        const line = callLine(call);
        return line === null ? [] : [line];
      });
      const steps = lines.flatMap((line) => (line.kind === "step" ? [line.step] : []));
      // Several steps at once, as the card's now line says them.
      if (steps.length > 1 && steps.length === lines.length) return { words: severalWords(steps) };
      const newest = lines.at(-1);
      return newest === undefined ? THINKING : masked(lineWords(newest));
    }
  }
}

/**
 * How long a step a row shows stands before the next may take its place: a
 * burst of quick steps — three files read in a breath — reads as one calm
 * line, and the latest always shows within this.
 */
export const LIVE_STEP_HOLD_MS = 500;

/** A step a row shows, and since when it has shown it. */
export interface ShownLiveStep {
  readonly step: LiveStepWords;
  readonly since: number;
}

/** The same words and the same command: the same step, as a row reads it. */
export function sameLiveStep(left: LiveStepWords, right: LiveStepWords): boolean {
  return left.words === right.words && left.code === right.code;
}

/**
 * The step a working row shows, paced: a new step takes the place of the one
 * shown at once if that one has stood `LIVE_STEP_HOLD_MS`, else when it has
 * (`recheckAt`), and then the latest takes it, not the ones in between. A row
 * starting to work shows its step at once, and one that stops holds nothing:
 * only a step giving way to another step waits.
 */
export function paceLiveStep(
  shown: ShownLiveStep | undefined,
  next: LiveStepWords | undefined,
  nowMs: number,
): { readonly shown: ShownLiveStep | undefined; readonly recheckAt: number | null } {
  if (next === undefined) return { shown: undefined, recheckAt: null };
  if (shown === undefined) return { shown: { step: next, since: nowMs }, recheckAt: null };
  if (sameLiveStep(shown.step, next)) return { shown, recheckAt: null };
  const due = shown.since + LIVE_STEP_HOLD_MS;
  return nowMs >= due
    ? { shown: { step: next, since: nowMs }, recheckAt: null }
    : { shown, recheckAt: due };
}

/** What each row shows of its Mate's live step, paced, by the environment it belongs to. */
export type ShownLiveSteps<Key> = ReadonlyMap<Key, ShownLiveStep>;

export interface LiveStepPacer<Key> {
  /** Every row's latest step, absent for a row that is not working. */
  readonly update: (steps: ReadonlyMap<Key, LiveStepWords | undefined>) => void;
  /** Cancels the pending hold's end. */
  readonly dispose: () => void;
}

/**
 * Paces every row's live step (`paceLiveStep`), telling `onChange` what the
 * rows show whenever that changes — at once, or when a held step's hold ends.
 */
export function createLiveStepPacer<Key>(
  onChange: (shown: ShownLiveSteps<Key>) => void,
): LiveStepPacer<Key> {
  let shown: ShownLiveSteps<Key> = new Map();
  let latest: ReadonlyMap<Key, LiveStepWords | undefined> = new Map();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    clearTimeout(timer);
    timer = undefined;
    const nowMs = Date.now();
    const next = new Map<Key, ShownLiveStep>();
    let changed = false;
    let recheckAt: number | null = null;
    for (const [key, step] of latest) {
      const before = shown.get(key);
      const paced = paceLiveStep(before, step, nowMs);
      if (paced.shown !== undefined) next.set(key, paced.shown);
      if (paced.shown !== before) changed = true;
      if (paced.recheckAt !== null) recheckAt = Math.min(recheckAt ?? Infinity, paced.recheckAt);
    }
    if (changed || next.size !== shown.size) {
      shown = next;
      onChange(shown);
    }
    if (recheckAt !== null) timer = setTimeout(settle, recheckAt - nowMs);
  };

  return {
    update: (steps) => {
      latest = steps;
      settle();
    },
    dispose: () => clearTimeout(timer),
  };
}
