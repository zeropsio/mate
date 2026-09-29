/**
 * The run's card, as pure rules: what its foot says while the run goes on and
 * once it is over, how much of a long chat it draws, and how the rest is
 * reached. Everything is always reachable one way or another (the owner's
 * D4): the card has no scroll of its own, so what it does not draw folds
 * behind a control that draws it.
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { MateMarkState } from "@t3tools/shared/brand";

import { browserCheckCaption, formatWorkDuration, operationLineWords } from "./conversation.logic";
import type { RunStatus, TurnHeaderActivity } from "./MessagesTimeline.logic";
import type { StepKind, WorkStep } from "./workSteps.logic";

// ---------------------------------------------------------------------------
// A long chat
// ---------------------------------------------------------------------------

/**
 * How many of a long run's lines its chat draws when it opens: the newest.
 * A two-hour run drew nine hundred bubbles at once and froze the page for
 * 0.7 s as it opened (Juno, 2026-09-27).
 */
export const CHAT_OPENS_WITH = 40;

/** How many earlier lines one "Show N earlier" draws: a huge run is reached a chunk at a time. */
export const EARLIER_CHUNK = 200;

/** Where a chat of `lines` lines opens: its newest `CHAT_OPENS_WITH`, the rest before them. */
export function chatOpensAt(lines: number): number {
  return Math.max(0, lines - CHAT_OPENS_WITH);
}

/**
 * What one "Show N earlier" draws when the chat starts at line `from`: the
 * chunk just before it — `shows` lines — and where the chat starts after.
 */
export function earlierShown(from: number): { readonly shows: number; readonly next: number } {
  const next = Math.max(0, from - EARLIER_CHUNK);
  return { shows: from - next, next };
}

// ---------------------------------------------------------------------------
// A thought, in one run of words
// ---------------------------------------------------------------------------

/**
 * A thought's words as one quiet run of text, for the two lines a thought
 * shows and the one the now line carries: its markdown's marks dropped, its
 * paragraphs run together.
 */
export function thoughtRunText(text: string): string {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => {
      // A title standing alone reads as a sentence of its own, not the start of the next.
      const title = /^\s*\*\*([^*\n]+)\*\*\s*$/u.exec(paragraph)?.[1]?.trim();
      return title === undefined ? paragraph : /[.!?:…]$/u.test(title) ? title : `${title}.`;
    })
    .join("\n\n")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The latest of a thought the Mate is thinking, for the now line's one muted
 * line: the last sentence of its last paragraph, however far it got.
 */
export function thoughtTicker(text: string): string | null {
  const last = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .findLast((paragraph) => paragraph.length > 0);
  if (last === undefined) return null;
  const sentences = thoughtRunText(last)
    .split(/(?<=[.!?…])\s+/u)
    .filter((sentence) => sentence.length > 0);
  return sentences.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// The now line
// ---------------------------------------------------------------------------

/**
 * What the card's foot says (K10): while the run goes on, what the Mate is
 * doing this moment — the step itself, never "Nova is working" — and once it
 * is over, the worked line.
 */
export type NowLine =
  /** Thinking, and the latest of the thought as one muted line. */
  | { readonly kind: "thinking"; readonly thought: string | null }
  /** A step it runs: its words, a command's code after them. */
  | { readonly kind: "step"; readonly step: WorkStep }
  /** A platform operation it waits on: a deploy, a check in the browser. */
  | { readonly kind: "operation"; readonly operation: ZeropsOperation }
  /** Several steps at once, oldest first: how many, and a line each under it. */
  | { readonly kind: "several"; readonly steps: ReadonlyArray<WorkStep> }
  | { readonly kind: "waiting" }
  | { readonly kind: "writing" }
  | { readonly kind: "condensing" }
  /** Over: who, what it did and for how long, and what the effort came to. */
  | { readonly kind: "worked"; readonly words: string; readonly effort: string | null };

/** A step the now line carries long enough says for how long: after 30 s, in words on the same line. */
export const LONG_STEP_MS = 30_000;

/** How long a run took of the Mate's own time: its span, less what it waited on the person. */
function workedMs(status: RunStatus): number {
  const start = Date.parse(status.startedAt);
  const end = status.endedAt === null ? Number.NaN : Date.parse(status.endedAt);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start - status.waitedMs)
    : 0;
}

/**
 * A run that is over, in a line: "Nova worked 1m 20s", "Nova thought 12s",
 * "Nova stopped after 45s".
 */
export function workedWords(speaker: string, status: RunStatus): string {
  const took = formatWorkDuration(workedMs(status));
  if (status.face === "stopped") return `${speaker} stopped after ${took}`;
  if (status.face === "paused") return `${speaker} stopped at the usage limit after ${took}`;
  return `${speaker} ${status.worked ? "worked" : "thought"} ${took}`;
}

/** What the now line says, from what the run is doing now. */
export function nowLineOf(input: {
  readonly status: RunStatus;
  readonly now: TurnHeaderActivity | null;
  /** Its answer streams under the card. */
  readonly answering: boolean;
  /** It condenses its context. */
  readonly compacting: boolean;
  /** Who works: the Mate's name. */
  readonly speaker: string;
  /** What a finished run's effort came to (`runEffortWords`). */
  readonly effort: string | null;
}): NowLine {
  const { status, now } = input;
  if (!status.live) {
    return { kind: "worked", words: workedWords(input.speaker, status), effort: input.effort };
  }
  if (input.compacting) return { kind: "condensing" };
  if (input.answering) return { kind: "writing" };
  if (now === null) return { kind: "thinking", thought: null };
  switch (now.kind) {
    case "waiting":
      return { kind: "waiting" };
    case "writing":
      return { kind: "writing" };
    case "thinking":
      return {
        kind: "thinking",
        thought: thoughtTicker(now.messages.map((message) => message.text).join("\n\n")),
      };
    case "step":
      return now.others !== undefined && now.others.length > 0
        ? { kind: "several", steps: [...now.others, now.step] }
        : { kind: "step", step: now.step };
    case "operation":
      return { kind: "operation", operation: now.operation };
  }
}

/** Several steps of one kind at once, said by their kind: "Running 3 commands", "Reading 2 files". */
const SEVERAL: Partial<Record<StepKind, (count: number) => string>> = {
  command: (count) => `Running ${count} commands`,
  read: (count) => `Reading ${count} files`,
  edit: (count) => `Editing ${count} files`,
  search: (count) => `Running ${count} searches`,
  web: (count) => `Reading ${count} pages`,
  look: (count) => `Looking at ${count} pictures`,
};

/** Several steps at once, in words: by their kind when they share one. */
export function severalWords(steps: ReadonlyArray<WorkStep>): string {
  const kinds = new Set(steps.map((step) => step.kind));
  const [only] = kinds;
  const say = kinds.size === 1 && only !== undefined ? SEVERAL[only] : undefined;
  return say === undefined ? `Running ${steps.length} steps` : say(steps.length);
}

/** A step as the now line says it: its own words, else its command. */
export function stepNowWords(step: WorkStep): string {
  return step.words ?? step.code ?? "Running a command";
}

/** A platform operation as the now line says it: a check names its page. */
export function operationNowWords(operation: ZeropsOperation): string {
  return operation.kind === "browser"
    ? `Checking ${browserCheckCaption(operation)} in the browser`
    : operationLineWords(operation);
}

/** The now line in words. */
export function nowLineWords(line: NowLine): string {
  switch (line.kind) {
    case "thinking":
      return "Thinking";
    case "step":
      return stepNowWords(line.step);
    case "operation":
      return operationNowWords(line.operation);
    case "several":
      return severalWords(line.steps);
    case "waiting":
      return "Waiting for your answer";
    case "writing":
      return "Writing";
    case "condensing":
      return "Condensing the context";
    case "worked":
      return line.words;
  }
}

/** A run that is over, as its face wears it. */
const SETTLED_FACE: Record<RunStatus["face"], MateMarkState> = {
  working: "working",
  idle: "idle",
  produced: "done",
  failed: "idle",
  paused: "sleep",
  stopped: "idle",
};

/**
 * The face on the now line: at work it turns — looking up while it thinks,
 * down along its line while it writes; it waits with its "o" on the person;
 * once the run is over, the face the run left.
 */
export function nowLineFace(
  line: NowLine,
  status: RunStatus,
): { readonly state: MateMarkState; readonly gaze?: "up" | "down" } {
  switch (line.kind) {
    case "worked":
      return { state: SETTLED_FACE[status.face] };
    case "waiting":
      return { state: "needs" };
    case "thinking":
      return { state: "working", gaze: "up" };
    case "writing":
      return { state: "working", gaze: "down" };
    default:
      return { state: "working" };
  }
}

/** A running clock: "0:31", "1:06", "1:05:09" — whole seconds, never below zero. */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
