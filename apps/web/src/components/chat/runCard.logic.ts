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
  browserPageWords,
  checksStrip,
  devServerRunning,
  formatWorkDuration,
  operationLineWords,
  unrecoveredFailures,
} from "./conversation.logic";
import {
  liveCallsOf,
  type AfterWait,
  type EngineStart,
  type LiveCall,
  type RecordItem,
  type RunStatus,
  type TurnHeaderActivity,
} from "./MessagesTimeline.logic";
import type { ChatMessage } from "../../types";
import type { StepKind, WorkStep } from "./workSteps.logic";

/** Meaningful streamed text changes structure; its bytes remain a leaf read. */
export function messageHasText(
  message: ChatMessage,
  liveLines?: ReadonlyMap<string, boolean>,
): boolean {
  return liveLines?.get(message.id) ?? message.text.trim().length > 0;
}

/**
 * A wordless thought or note has no line, in either the slot or the history: the working line
 * names what the Mate does until its words come, never its face beside an empty bubble.
 */
export function chatItemHasLine(
  item: RecordItem,
  liveLines?: ReadonlyMap<string, boolean>,
): boolean {
  if (item.kind === "note") {
    return messageHasText(item.message, liveLines) || (item.message.attachments?.length ?? 0) > 0;
  }
  return (
    item.kind !== "thought" || item.messages.some((message) => messageHasText(message, liveLines))
  );
}

/**
 * The log starts with the Mate's work, omitting leading person/answer entries.
 * The opener reads this sequence's length without constructing any bubbles.
 * An answer pairs with the preceding visible question, across wordless thoughts.
 */
export function selectChatItems(
  items: ReadonlyArray<RecordItem>,
  liveLines?: ReadonlyMap<string, boolean>,
): ReadonlyArray<{ readonly item: RecordItem; readonly pairs: boolean }> {
  const selected: { readonly item: RecordItem; readonly pairs: boolean }[] = [];
  for (const item of items) {
    if (!chatItemHasLine(item, liveLines)) continue;
    const theirs =
      item.kind === "person" || (item.kind === "call" && item.entry.questionAnswer !== undefined);
    if (selected.length === 0 && theirs) continue;
    selected.push({ item, pairs: theirs && selected.at(-1)?.item.kind === "question" });
  }
  return selected;
}

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

/** How near its foot the scroll may stand and still count as at it: it follows from there. */
export const FOLLOW_SLACK_PX = 4;

/**
 * How far a move must go to be one: a re-read of where it stood can settle a
 * fraction, and the browser snaps to sub-pixels.
 */
const MOVED_PX = 1.5;

/**
 * Whether the scroll stands at its foot, a few pixels' slack: there, it
 * follows what arrives; scrolled up, it stays where the person put it.
 */
export function standsAtFoot(scroll: RunScrollPosition): boolean {
  return fromFoot(scroll) <= FOLLOW_SLACK_PX;
}

function fromFoot(scroll: RunScrollPosition): number {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
}

/** Nothing the person opened in a run's scroll. */
export const NOTHING_OPENED: ReadonlySet<string> = new Set();

/** Whether the run's scroll follows its foot, where its top last stood, and what the person opened in it. */
export interface RunScrollFollow {
  readonly follows: boolean;
  /** Where its top last stood: where a move left it, or where the page last put it. */
  readonly stood: number;
  /**
   * What the person opened in it since it last followed, still open: each by
   * its own switch's key, so a close of something they never opened (a
   * command that opened itself in the slot) is not theirs.
   */
  readonly opened: ReadonlySet<string>;
  /** Whether closing the last of them follows again: it followed as they opened the first, and they have not moved it up since. */
  readonly resumes: boolean;
  /**
   * The foot as the person's move down set out for it — End, a wheel run to
   * the bottom glides there — while that move lasts: lines arriving meanwhile
   * move the foot on under it, and reaching where it stood reaches it.
   */
  readonly reach: number | null;
  /** Its foot as it was last read: where a move down that starts now sets out for. */
  readonly foot: number | null;
}

/** What happened to the run's scroll, for whether it follows its foot. */
export type RunScrollEvent =
  /** It was read where it stands now: after a scroll, or as what it holds grew. */
  | { readonly kind: "scrolled"; readonly position: RunScrollPosition }
  /** The page put its top at `top` (read back as the browser took it). */
  | { readonly kind: "set"; readonly top: number }
  /** The person opened something in it, by its switch `key`: theirs to read. */
  | { readonly kind: "opened"; readonly key: string }
  /** The person closed something in it, by its switch `key`. */
  | { readonly kind: "closed"; readonly key: string }
  /** A move of the person's ended (the browser's `scrollend`). */
  | { readonly kind: "ended" };

/**
 * Whether the run's scroll follows its foot after `event`: every arrival
 * keeps its newest line in view while it does. A top that moved up from
 * where it last stood is the person's — a wheel, keys, a find, a
 * drag-select, focus moving into it, whatever made it, inside the foot's
 * slack too — and stops it, unless it landed on the foot exactly: that is
 * the browser clamping it (a row's travel ending, the card growing taller).
 * A top that moved down onto the foot is the person's too, and follows
 * again — onto the foot as it stood when that move began, too, so End
 * reaches it though a line arrived as it glided. Opening something in it stops it; closing the last thing they
 * opened follows again, if it followed as they opened it and they have not
 * moved it up since. Nothing else changes it: an arrival grows it under its
 * top, a card below its cap stands at its foot whatever happens, and the
 * page's own move is the page's.
 */
export function followAfter(state: RunScrollFollow, event: RunScrollEvent): RunScrollFollow {
  switch (event.kind) {
    case "opened": {
      if (state.opened.has(event.key)) return state;
      return {
        ...state,
        follows: false,
        opened: new Set(state.opened).add(event.key),
        resumes: state.opened.size === 0 ? state.follows : state.resumes,
        reach: null,
      };
    }
    case "closed": {
      // Closing what they never opened here counts for nothing.
      if (!state.opened.has(event.key)) return state;
      const opened = new Set(state.opened);
      opened.delete(event.key);
      const back = opened.size === 0 && state.resumes;
      return {
        ...state,
        follows: state.follows || back,
        opened,
        resumes: opened.size > 0 && state.resumes,
      };
    }
    case "set":
      return { ...state, stood: event.top, reach: null };
    case "ended":
      return state.reach === null ? state : { ...state, reach: null };
    case "scrolled": {
      const { position } = event;
      const top = position.scrollTop;
      const foot = footTop(position);
      if (top < state.stood - MOVED_PX) {
        // Onto its foot exactly: the browser clamped it there.
        if (fromFoot(position) <= MOVED_PX) return { ...state, stood: top, reach: null, foot };
        return { ...state, follows: false, stood: top, resumes: false, reach: null, foot };
      }
      if (top > state.stood + MOVED_PX) {
        // A line that landed since the move began is read with its first step.
        const reach = state.reach ?? state.foot ?? foot;
        if (standsAtFoot(position) || top >= reach - FOLLOW_SLACK_PX) {
          return {
            follows: true,
            stood: top,
            opened: NOTHING_OPENED,
            resumes: false,
            reach: null,
            foot,
          };
        }
        return { ...state, stood: top, reach, foot };
      }
      // Less than a move: kept from where it stood, so a slow drag adds up.
      return state.foot === foot ? state : { ...state, foot };
    }
  }
}

/**
 * Whether a move of the scroll's top, from where it last stood (`stood`, its
 * furthest top then `stoodMax`) to `top` (its furthest now `max`), is no more
 * than the browser clamping it as its box grew: such a move, while the live
 * slot beside it eases, is the card's. A move up past that — find in page,
 * Tab, a drag-select or a screen reader taking it, none an input on the
 * scroll — is the person's (the review of p43, 2026-10-06).
 */
export function movedByClamp({
  stood,
  top,
  stoodMax,
  max,
  linesResized = false,
  boxResized = false,
}: {
  readonly stood: number;
  readonly top: number;
  readonly stoodMax: number;
  readonly max: number;
  /**
   * What it holds re-measured since: the browser may move it a frame's speed
   * past what its clamp explains (run 12: lines 6 px taller, the top 14 px
   * up), never further.
   */
  readonly linesResized?: boolean;
  /**
   * Its box re-measured since, as it eases open or shut: the same frame's speed past the clamp
   * (a settled card a joined run makes live again: the box 11 px taller, the top 16 px up).
   */
  readonly boxResized?: boolean;
}): boolean {
  const slack = linesResized || boxResized ? LINES_RESIZE_SLACK_PX : 0;
  return stood - top <= Math.max(0, stoodMax - max) + MOVED_PX + slack;
}

/** A frame's speed of a run's card's eases (`MAX_SPEED_PX_PER_MS` over a frame and a fifth). */
const LINES_RESIZE_SLACK_PX = 32;

/**
 * The scroll as its lines are laid out: a row travelling into its place (a
 * plop from the live slot, a rise) paints past their foot for a moment, and
 * the browser counts that as more to scroll to. It is not: the foot is where
 * the lines end.
 */
export function laidOutPosition(
  scroll: RunScrollPosition & { readonly laidHeight: number },
): RunScrollPosition {
  return {
    scrollTop: scroll.scrollTop,
    scrollHeight: Math.min(scroll.scrollHeight, scroll.laidHeight),
    clientHeight: scroll.clientHeight,
  };
}

/** Where a scroll at its foot stands: its last line's end at its bottom edge. */
export function footTop(scroll: RunScrollPosition): number {
  return Math.max(0, scroll.scrollHeight - scroll.clientHeight);
}

/** The edges lines are cut past: a fade says so there, and only there. */
export function cutEdges(scroll: RunScrollPosition): {
  readonly above: boolean;
  readonly below: boolean;
} {
  const overflows = scroll.scrollHeight > scroll.clientHeight + 1;
  return {
    above: overflows && scroll.scrollTop > 1,
    below: overflows && !standsAtFoot(scroll),
  };
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
  return (
    quoteWords(text)
      .split(/\n\s*\n/u)
      .map((paragraph) => {
        // A title standing alone reads as a sentence of its own, not the start of the next.
        const title = /^\s*\*\*([^*\n]+)\*\*\s*$/u.exec(paragraph)?.[1]?.trim();
        return title === undefined ? paragraph : /[.!?:…]$/u.test(title) ? title : `${title}.`;
      })
      .join("\n\n")
      // A code block is code, not words: a closed one, and one still streaming
      // — a fence opening a line, never three backticks among words.
      .replace(/```[\s\S]*?```/gu, " ")
      .replace(/^\s{0,3}```[\s\S]*/mu, " ")
      .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
      .replace(/__([^_\n]+)__/gu, "$1")
      .replace(/`([^`\n]+)`/gu, "$1")
      .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/gmu, "")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

/**
 * A note as the card says it: one that ends on a colon announced what its
 * next step shows — "Committing:", "Full error output:" — and said alone it
 * points at nothing, so the colon goes once the note is whole (Bodhi). A
 * colon inside, or closing a code block, stays.
 */
export function noteText(text: string, streaming: boolean): string {
  if (streaming) return text;
  const whole = text.trimEnd();
  return whole.endsWith(":") && !whole.endsWith("::") && !/```[^`]*$/u.test(whole)
    ? whole.slice(0, -1)
    : text;
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
  /** Several calls at once, oldest first: how many, and a line each under it. */
  | { readonly kind: "several"; readonly calls: ReadonlyArray<LiveCall> }
  /** It waits on the person: their answer to its question, or their approval. */
  | { readonly kind: "waiting"; readonly on: "answer" | "approval" }
  /** Its turns are over, and the helpers it launched work on — or what its engine names. */
  | { readonly kind: "after"; readonly on?: AfterWait }
  /** Its run is not started yet: what its engine does first. */
  | { readonly kind: "starting"; readonly on: EngineStart }
  | { readonly kind: "writing" }
  | { readonly kind: "condensing" }
  /** Over: who, what it did and for how long, and what the effort came to. */
  | { readonly kind: "worked"; readonly words: string; readonly effort: string | null };

/** How long a run took of the Mate's own time: its span, less what it waited on the person. */
function workedMs(status: RunStatus): number {
  if (status.workedMs !== undefined) return status.workedMs;
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
  // Stopped by the person, or broken off: the run's card says why under it.
  if (status.face === "stopped" || status.face === "brokeOff") {
    return `${speaker} stopped after ${took}`;
  }
  // Its turn ended for the person's message, not by their Stop (run 11).
  if (status.face === "interrupted") {
    return `${speaker} ${effortVerb(status)} ${took} until your message`;
  }
  if (status.face === "paused") return `${speaker} paused at the limit · ${took}`;
  return `${speaker} ${effortVerb(status)} ${took}`;
}

/** What the run's time went on: work, words to the person, or thought alone. */
function effortVerb(status: RunStatus): string {
  return status.worked ? "worked" : status.wrote === true ? "wrote" : "thought";
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
    case "after":
      return now.on === undefined ? { kind: "after" } : { kind: "after", on: now.on };
    case "starting":
      return { kind: "starting", on: now.on };
    case "writing":
      return { kind: "writing" };
    case "thinking":
      return {
        kind: "thinking",
        thought: thoughtTicker(now.messages.map((message) => message.text).join("\n\n")),
      };
    case "step":
    case "operation": {
      const calls = liveCallsOf(now);
      if (calls.length > 1) return { kind: "several", calls };
      return now.kind === "step"
        ? { kind: "step", step: now.step }
        : { kind: "operation", operation: now.operation };
    }
  }
}

// ---------------------------------------------------------------------------
// The live slot
// ---------------------------------------------------------------------------

/** What the live slot says when no item stands in it. */
export type SlotFiller =
  | { readonly kind: "thinking" }
  | { readonly kind: "writing" }
  | { readonly kind: "condensing" }
  | { readonly kind: "waiting"; readonly on: "answer" | "approval" }
  | { readonly kind: "after"; readonly on?: AfterWait }
  | { readonly kind: "starting"; readonly on: EngineStart };

/**
 * What the live slot holds (pass 35): what the Mate is doing this moment,
 * each thing as the record item it becomes — the same key, so it plops into
 * the history as itself — and what the slot says when nothing stands in it.
 * A thought with no words yet is "Thinking", never an empty bubble.
 */
export interface SlotModel {
  readonly live: ReadonlyArray<RecordItem>;
  readonly filler: SlotFiller;
}

export function slotModelOf(input: {
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  readonly compacting: boolean;
  readonly items: ReadonlyArray<RecordItem>;
  liveLines?: ReadonlyMap<string, boolean>;
}): SlotModel {
  const { now } = input;
  if (input.compacting) return { live: [], filler: { kind: "condensing" } };
  const thinking: SlotModel = { live: [], filler: { kind: "thinking" } };
  // Its words as they come stand in the slot as the note they become (D4).
  if (
    now?.kind === "writing" &&
    now.note !== undefined &&
    messageHasText(now.note.message, input.liveLines)
  ) {
    return {
      live: [
        {
          kind: "note",
          key: now.note.key,
          at: now.note.message.createdAt,
          message: now.note.message,
        },
      ],
      filler: thinking.filler,
    };
  }
  if (input.answering || now?.kind === "writing") return { live: [], filler: { kind: "writing" } };
  if (now === null) return thinking;
  switch (now.kind) {
    case "after":
      return {
        live: [],
        filler: now.on === undefined ? { kind: "after" } : { kind: "after", on: now.on },
      };
    case "starting":
      return { live: [], filler: { kind: "starting", on: now.on } };
    case "thinking":
      return now.key !== null &&
        now.messages.some((message) => messageHasText(message, input.liveLines))
        ? {
            live: [
              {
                kind: "thought",
                key: now.key,
                at: now.messages[0]?.createdAt ?? "",
                messages: now.messages,
                durationMs: null,
              },
            ],
            filler: thinking.filler,
          }
        : thinking;
    case "waiting": {
      // An approval: what it asks stands in the slot, the controls in the composer.
      if (now.asked !== undefined && now.asked.length > 0) {
        return { live: now.asked.map(liveCallItem), filler: thinking.filler };
      }
      const question =
        now.key === undefined ? undefined : input.items.find((item) => item.key === now.key);
      return question === undefined
        ? { live: [], filler: { kind: "waiting", on: now.on } }
        : { live: [question], filler: thinking.filler };
    }
    case "step":
    case "operation":
      return { live: liveCallsOf(now).map(liveCallItem), filler: thinking.filler };
  }
}

/**
 * A call the Mate waits on, as the record item it becomes. A session's
 * follow-up call is a line of its own: the session's line stands in the
 * record where its first call returned, and stays there.
 */
function liveCallItem(call: LiveCall): RecordItem {
  if (call.kind === "step") {
    return { kind: "step", key: `step:${call.step.key}`, at: call.step.startedAt, step: call.step };
  }
  const op = call.operation;
  const followUp = op.returnedAt === undefined ? undefined : op.openedAt;
  const key = followUp === undefined ? `operation:${op.key}` : `operation:${op.key}#${followUp}`;
  const at = followUp ?? op.anchorAt;
  return op.kind === "browser"
    ? { kind: "strip", key, at, strip: checksStrip([op], true) }
    : { kind: "operation", key, at, operation: op };
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

/** Several calls at once, in words: by their kind when they are steps of one kind. */
export function severalCallsWords(calls: ReadonlyArray<LiveCall>): string {
  const steps = calls.flatMap((call) => (call.kind === "step" ? [call.step] : []));
  return steps.length === calls.length ? severalWords(steps) : `Running ${calls.length} steps`;
}

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
    ? `Checking ${browserPageWords(browserCheckCaption(operation))} in the browser`
    : operationLineWords(operation);
}

/** "a background command", "2 background commands". */
function commandsWords(count: number): string {
  return count === 1 ? "a background command" : `${count} background commands`;
}

/**
 * What a run whose turns are over waits on, in words: its helpers, unless its engine names a
 * command it sent to the background — a 17-second wait on a `sleep` read "Waiting for its helpers"
 * while its one helper had long reported (Milo's stress run).
 */
export function afterWords(on: AfterWait | undefined): string {
  if (on === undefined || on.commands === 0) return "Waiting for its helpers";
  if (on.helpers === 0) return `Waiting for ${commandsWords(on.commands).replace(/^a /, "its ")}`;
  return `Waiting for its helpers and ${commandsWords(on.commands)}`;
}

/** What a run not started yet waits on, in words: its workspace's snapshot, then its session. */
export function startingWords(on: EngineStart): string {
  return on === "workspace" ? "Saving a snapshot of the workspace" : "Starting its session";
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
      return severalCallsWords(line.calls);
    case "waiting":
      return line.on === "approval" ? "Waiting for your approval" : "Waiting for your answer";
    case "after":
      return afterWords(line.on);
    case "starting":
      return startingWords(line.on);
    case "writing":
      return "Writing";
    case "condensing":
      return "Condensing the context";
    case "worked":
      return line.words;
  }
}

/**
 * What a screen reader hears of the live slot: the words of what its first
 * line shows, so they change when the slot does and never between (a probe
 * read them flip to "Thinking" for 200 ms while a step still stood).
 */
export function slotWords(item: RecordItem | null, filler: SlotFiller): string {
  if (item === null) {
    switch (filler.kind) {
      case "waiting":
        return nowLineWords({ kind: "waiting", on: filler.on });
      case "after":
      case "starting":
        return nowLineWords(filler);
      case "thinking":
        return nowLineWords({ kind: "thinking", thought: null });
      default:
        return nowLineWords({ kind: filler.kind });
    }
  }
  switch (item.kind) {
    case "step":
      return stepNowWords(item.step);
    case "operation":
      return operationNowWords(item.operation);
    case "strip": {
      // The check it runs now, else its newest: "Checking /status in the browser".
      const check =
        item.strip.checks.findLast((candidate) => candidate.phase === "running") ??
        item.strip.checks.at(-1);
      return check === undefined ? "Checking in the browser" : operationNowWords(check);
    }
    case "question":
      return nowLineWords({ kind: "waiting", on: "answer" });
    case "person":
      return "Your message reached it";
    case "note":
      return "Writing";
    case "thought":
      return "Thinking";
    case "helpers":
      return "Starting helpers";
    case "task":
      return `${item.entry.toolTitle ?? item.entry.label} reported back`;
    case "plan":
      return "Updating its plan";
    case "incident":
      return `${item.incident.hostname} needs attention`;
    case "event":
    case "crew-seam":
    case "error":
    case "call":
      return "Working";
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
  interrupted: "idle",
  brokeOff: "idle",
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
 * line once they open it again; nowhere, folded. Only a record with work offers
 * a toggle. A settled run carries its
 * toggle in every fold — one the person watched to its end included, which
 * they hide as they would any other (the owner, 2026-09-30: "why is this
 * uncloseable? because I saw it finish live?").
 */
export function runCardShows(
  settled: boolean,
  fold: RunFold,
  hasWork: boolean,
): { readonly work: "above" | "below" | null; readonly toggle: "hide" | "show" | null } {
  const toggle = hasWork
    ? fold === "folded" || (settled && fold === "folding")
      ? "show"
      : "hide"
    : null;
  if (!settled) return { work: "above", toggle };
  switch (fold) {
    case "watched":
    case "folding":
      return { work: "above", toggle };
    case "folded":
      return { work: null, toggle };
    case "shown":
      return { work: "below", toggle };
  }
}

/** The runs of each conversation the person watched or opened, by the conversation's key. */
const runFolds = new Map<string, Map<string, RunFold>>();
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
export function runFoldOf(conversation: string, run: string, unseen: RunFold = "folded"): RunFold {
  return runFolds.get(conversation)?.get(run) ?? unseen;
}

/** Marks how a run stands in a conversation. */
export function setRunFold(conversation: string, run: string, fold: RunFold): void {
  if (runFoldOf(conversation, run) === fold) return;
  const runs = runFolds.get(conversation) ?? new Map<string, RunFold>();
  // Explicitly hiding live work must survive its default changing on completion.
  runs.set(run, fold);
  runFolds.set(conversation, runs);
  runFoldsChanged();
}

/** The live runs a person hid, by the conversation's key: their choice outlives the run. */
const hiddenLive = new Map<string, Set<string>>();

/** The person shows or hides a live run's work: what it is drawn as now, and when a run goes on in it. */
export function chooseLiveRunFold(
  conversation: string,
  run: string,
  fold: "watched" | "folded",
): void {
  const hidden = hiddenLive.get(conversation) ?? new Set<string>();
  if (fold === "folded") hidden.add(run);
  else hidden.delete(run);
  if (hidden.size === 0) hiddenLive.delete(conversation);
  else hiddenLive.set(conversation, hidden);
  setRunFold(conversation, run, fold);
}

/**
 * How a card stands as a run goes on in it: watched, unless the person hid
 * it while it ran. A fold of its own as it settled is not their choice, so a
 * run that joins the card (an engine card draws each run that joins it) is
 * watched again.
 */
export function liveRunFold(conversation: string, run: string): "watched" | "folded" {
  return hiddenLive.get(conversation)?.has(run) === true ? "folded" : "watched";
}

type RunFoldInput =
  | {
      readonly kind: "live";
      /** A run goes on in a card that had settled (an engine card draws each run that joins it). */
      readonly rejoined?: boolean;
      /** The run waits on the person: their answer or approval. */
      readonly asks?: boolean;
    }
  | {
      readonly kind: "settled";
      readonly wasLive: boolean;
      readonly reading: boolean;
      readonly measured: boolean;
    }
  | { readonly kind: "hide"; readonly measured: boolean }
  | { readonly kind: "finished" };

/** The existing fold's next state; geometry and motion permission come from its renderer. */
function nextRunFold(fold: RunFold, liveChoice: RunFold, input: RunFoldInput): RunFold {
  switch (input.kind) {
    case "live":
      // A run that goes on by itself in a card folded as it settled (the run a job's end woke) is
      // drawn in the folded card's line: it opened 532 px in one frame and scrolled the page 768
      // px (Milo's stress run). One that asks the person opens it, for its question.
      if (input.rejoined === true && input.asks !== true && fold === "folded") return "folded";
      return liveChoice;
    case "settled":
      if (fold !== "watched") return fold;
      if (!input.wasLive) return "folded";
      if (input.reading) return "watched";
      return input.measured ? "folding" : "folded";
    case "hide":
      return input.measured ? "folding" : "folded";
    case "finished":
      // A measured fold cannot close work the person showed, or a run that joined since.
      return fold === "folding" ? "folded" : fold;
  }
}

/** Observes a run, accepts Hide, or completes its measured fold in the same owning store. */
export function transitionRunFold(conversation: string, run: string, input: RunFoldInput): void {
  setRunFold(
    conversation,
    run,
    nextRunFold(runFoldOf(conversation, run), liveRunFold(conversation, run), input),
  );
}

/**
 * The person left a conversation: every run in it folds, so when they come
 * back it is folded from the first frame and nothing moves.
 */
export function forgetRunFolds(conversation: string): void {
  const hid = hiddenLive.delete(conversation);
  if (!runFolds.delete(conversation) && !hid) return;
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
