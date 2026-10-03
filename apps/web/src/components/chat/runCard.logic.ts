/**
 * The run's card, as pure rules: what its foot says while the run goes on and
 * once it is over, and how its one scroll holds a long chat. Closed, the card
 * is its summary line; open — while the run goes on, or once the person asks
 * for the work — it is one scroll holding everything the run said and did
 * (the owner, 2026-09-29: "when open with scroll and all events and when
 * close just the summary"). Everything stays reachable (D4): the scroll
 * draws a long run's earlier lines as the person scrolls up to them.
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { MateMarkState } from "@t3tools/shared/brand";
import { quoteWords } from "@t3tools/shared/messagePreview";

import {
  browserCheckCaption,
  devServerRunning,
  formatWorkDuration,
  operationLineWords,
  unrecoveredFailures,
} from "./conversation.logic";
import type { RecordItem, RunStatus, TurnHeaderActivity } from "./MessagesTimeline.logic";
import type { StepKind, WorkStep } from "./workSteps.logic";

// ---------------------------------------------------------------------------
// A long chat, in its one scroll
// ---------------------------------------------------------------------------

/**
 * How many of a long run's lines its scroll draws when it opens: the newest.
 * A two-hour run drew nine hundred bubbles at once and froze the page for
 * 0.7 s as it opened (Juno, 2026-09-27).
 */
export const CHAT_OPENS_WITH = 40;

/** How many earlier lines the scroll draws at a time as the person scrolls up to them. */
export const EARLIER_CHUNK = 200;

/** How near its top the scroll draws the earlier lines: before the person reaches them. */
export const EARLIER_REACH_PX = 480;

/** Where a chat of `lines` lines opens: its newest `CHAT_OPENS_WITH`, the rest before them. */
export function chatOpensAt(lines: number): number {
  return Math.max(0, lines - CHAT_OPENS_WITH);
}

/**
 * What the scroll draws next when the chat starts at line `from`: the chunk
 * just before it — `shows` lines — and where the chat starts after.
 */
export function earlierShown(from: number): { readonly shows: number; readonly next: number } {
  const next = Math.max(0, from - EARLIER_CHUNK);
  return { shows: from - next, next };
}

/** Where the run's scroll stands. */
export interface RunScrollPosition {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Whether the scroll stands at its foot, a pixel's slack for a fractional
 * zoom: there, it follows what arrives; scrolled up, it stays where the
 * person put it.
 */
export function standsAtFoot(scroll: RunScrollPosition): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 1;
}

/** Whether the scroll nears its top with earlier lines still undrawn: then it draws them. */
export function reachesEarlier(
  scroll: Pick<RunScrollPosition, "scrollTop">,
  from: number,
): boolean {
  return from > 0 && scroll.scrollTop < EARLIER_REACH_PX;
}

// ---------------------------------------------------------------------------
// A thought, in one run of words
// ---------------------------------------------------------------------------

/**
 * A thought's words as one quiet run of text, for the two lines a thought
 * shows and the one the now line carries: its markdown's marks dropped, a
 * callout said as its word (`quoteWords`), its paragraphs run together.
 */
export function thoughtRunText(text: string): string {
  return quoteWords(text)
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
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/gmu, "")
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
  /** It waits on the person: their answer to its question, or their approval. */
  | { readonly kind: "waiting"; readonly on: "answer" | "approval" }
  | { readonly kind: "writing" }
  | { readonly kind: "condensing" }
  /** Over: who, what it did and for how long, and what the effort came to. */
  | { readonly kind: "worked"; readonly words: string; readonly effort: string | null };

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
      return { kind: "waiting", on: now.on };
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
      return line.on === "approval" ? "Waiting for your approval" : "Waiting for your answer";
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

// ---------------------------------------------------------------------------
// A run you come back to
// ---------------------------------------------------------------------------

/**
 * How a run's card stands (K12): open while it runs; folded to its summary
 * line as it settles, the work easing shut into the line (the owner,
 * 2026-09-29: "why didn't this autocollapse at the end?") — unless the person
 * is reading the work right then, when it stays open as it was until they
 * leave or it is drawn again — and open again, the scroll under the line,
 * once they ask for the work.
 */
export type RunFold = "watched" | "folding" | "folded" | "shown";

/**
 * Where a run's work stands and what its line offers: over the line while it
 * runs, and after, while the person reads it or it folds away; under the
 * line once they open it again; nowhere, folded. A settled run carries its
 * toggle in every fold — one the person watched to its end included, which
 * they hide as they would any other (the owner, 2026-09-30: "why is this
 * uncloseable? because I saw it finish live?").
 */
export function runCardShows(
  settled: boolean,
  fold: RunFold,
): { readonly work: "above" | "below" | null; readonly toggle: "hide" | "show" | null } {
  if (!settled) return { work: "above", toggle: null };
  switch (fold) {
    case "watched":
      return { work: "above", toggle: "hide" };
    case "folding":
      return { work: "above", toggle: "show" };
    case "folded":
      return { work: null, toggle: "show" };
    case "shown":
      return { work: "below", toggle: "hide" };
  }
}

/** The runs of each conversation the person watched or opened, by the conversation's key. */
const runFolds = new Map<string, Map<string, Exclude<RunFold, "folded">>>();
const runFoldListeners = new Set<() => void>();

function runFoldsChanged(): void {
  for (const listener of runFoldListeners) listener();
}

/** Hears the folds change. */
export function subscribeRunFolds(listener: () => void): () => void {
  runFoldListeners.add(listener);
  return () => runFoldListeners.delete(listener);
}

/**
 * How a run stands in a conversation: folded unless it runs, folds this
 * moment, stayed open while the person read it, or they opened it.
 */
export function runFoldOf(conversation: string, run: string): RunFold {
  return runFolds.get(conversation)?.get(run) ?? "folded";
}

/** Marks how a run stands in a conversation. */
export function setRunFold(conversation: string, run: string, fold: RunFold): void {
  if (runFoldOf(conversation, run) === fold) return;
  const runs = runFolds.get(conversation) ?? new Map<string, Exclude<RunFold, "folded">>();
  if (fold === "folded") runs.delete(run);
  else runs.set(run, fold);
  if (runs.size === 0) runFolds.delete(conversation);
  else runFolds.set(conversation, runs);
  runFoldsChanged();
}

/**
 * The person left a conversation: every run in it folds, so when they come
 * back it is folded from the first frame and nothing moves.
 */
export function forgetRunFolds(conversation: string): void {
  if (!runFolds.delete(conversation)) return;
  runFoldsChanged();
}

// ---------------------------------------------------------------------------
// A failure, and what undid it
// ---------------------------------------------------------------------------

/** What a step did, to know it again when the Mate retries it: its command, else its words. */
function stepSignatures(step: WorkStep): ReadonlyArray<string> {
  const said = (value: string | null) =>
    value === null ? [] : [`${step.kind}:${value.replace(/\s+/gu, " ").trim()}`];
  return [...said(step.script ?? step.code), ...said(step.words)];
}

/**
 * The failures a later step undid (K9): a command or a call that failed and
 * passed when the Mate ran it again — the same command, or the same words —
 * a platform operation that failed and then went through on the same
 * service, and a dev server found down and then found running. Red always means still broken, so these turn quiet; the rest stay
 * red. One walk back from the run's end, whatever its length: a two-hour
 * run's card redraws on every word of a thought.
 */
export function recoveredFailures(items: ReadonlyArray<RecordItem>): ReadonlySet<string> {
  const undone = new Set<string>();
  // Walking back from the end: what passed later, by what it did.
  const passedLater = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind !== "step") continue;
    const signatures = stepSignatures(item.step);
    if (item.step.state === "failed") {
      if (signatures.some((signature) => passedLater.has(signature))) undone.add(item.key);
    } else if (item.step.state === "done") {
      for (const signature of signatures) passedLater.add(signature);
    }
  }
  // An operation as the platform's own reading has it: failed, then done on
  // the same target.
  const operations = items.flatMap((item) => (item.kind === "operation" ? [item] : []));
  const standing = new Set(unrecoveredFailures(operations.map((item) => item.operation)));
  for (const item of operations) {
    if (item.operation.phase === "failed" && !standing.has(item.operation)) undone.add(item.key);
  }
  // A dev server found down, then found running on the same service: the
  // finding stands no more.
  const runningLater = new Set<string>();
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const { operation, key } = operations[index]!;
    const found = devServerRunning(operation);
    const host = operation.target?.hostname ?? operation.subject;
    if (found === true) runningLater.add(host);
    else if (found === false && operation.phase !== "failed" && runningLater.has(host))
      undone.add(key);
  }
  // In the run's order.
  return new Set(items.flatMap((item) => (undone.has(item.key) ? [item.key] : [])));
}
