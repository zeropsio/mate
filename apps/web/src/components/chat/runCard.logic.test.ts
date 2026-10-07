import { MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { operation as operationEntry } from "./conversationFixtures";
import type { RecordItem, RunStatus, TurnHeaderActivity } from "./MessagesTimeline.logic";
import {
  CHAT_OPENS_WITH,
  chatOpensAt,
  cutEdges,
  EARLIER_CHUNK,
  EARLIER_REACH_PX,
  earlierShown,
  FOLLOW_SLACK_PX,
  followAfter,
  type RunScrollFollow,
  footTop,
  forgetRunFolds,
  laidOutPosition,
  movedByClamp,
  formatClock,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  reachesEarlier,
  recoveredFailures,
  runCardShows,
  runFoldOf,
  setRunFold,
  severalWords,
  slotModelOf,
  standsAtFoot,
  subscribeRunFolds,
  thoughtRunText,
  thoughtTicker,
  workedWords,
  noteText,
  slotWords,
} from "./runCard.logic";
import { stepOf } from "./workSteps.logic";

describe("chatOpensAt", () => {
  it.each([
    { lines: 0, from: 0 },
    { lines: 12, from: 0 },
    { lines: CHAT_OPENS_WITH, from: 0 },
    { lines: CHAT_OPENS_WITH + 1, from: 1 },
    { lines: 900, from: 900 - CHAT_OPENS_WITH },
  ])("a chat of $lines lines opens at line $from", ({ lines, from }) => {
    expect(chatOpensAt(lines)).toBe(from);
  });
});

describe("earlierShown", () => {
  it.each([
    { from: 1, shows: 1, next: 0 },
    { from: 88, shows: 88, next: 0 },
    { from: EARLIER_CHUNK, shows: EARLIER_CHUNK, next: 0 },
    { from: EARLIER_CHUNK + 60, shows: EARLIER_CHUNK, next: 60 },
  ])("from line $from, a reach shows $shows and leaves $next", ({ from, shows, next }) => {
    expect(earlierShown(from)).toEqual({ shows, next });
  });

  // Nothing is ever out of reach (D4): however long the run, scrolling up
  // until nothing is left above draws every line, a chunk at a time.
  it.each([1, 41, 199, 200, 201, 860, 5000])(
    "reaches every line of a %i-line chat, a chunk at a time",
    (lines) => {
      let from = chatOpensAt(lines);
      let drawn = lines - from;
      let clicks = 0;
      while (from > 0) {
        const { shows, next } = earlierShown(from);
        expect(shows).toBe(from - next);
        expect(shows).toBeGreaterThan(0);
        drawn += shows;
        from = next;
        clicks += 1;
      }
      expect(drawn).toBe(lines);
      expect(clicks).toBe(Math.ceil(Math.max(0, lines - CHAT_OPENS_WITH) / EARLIER_CHUNK));
    },
  );
});

describe("thoughtRunText", () => {
  it.each([
    { text: "The route and the check disagree.", run: "The route and the check disagree." },
    {
      text: "**Planning the check**\n\nThe build takes two minutes.",
      run: "Planning the check. The build takes two minutes.",
    },
    { text: "**Why?**\n\nBecause.", run: "Why? Because." },
    {
      text: "Reuse `withDatabase()` from the **users** tests:\n\n- start it\n- migrate",
      run: "Reuse withDatabase() from the users tests: start it migrate",
    },
    { text: "Keep snake_case_names as they are.", run: "Keep snake_case_names as they are." },
    {
      text: "Checked the scale.\n\n> [!WARNING]\n> My earlier claim was incorrect.",
      run: "Checked the scale. Warning: My earlier claim was incorrect.",
    },
    { text: "Try:\n\n```sh\nls\n```\n\nThen this.", run: "Try: Then this." },
    // A code block still streaming is code too, not words with backticks.
    { text: "Try this:\n\n```ts\nconst port = 3000;", run: "Try this:" },
    // Review of pass 42: three backticks in its words opened no block, and
    // every word after them went.
    {
      text: "Wrap it in ``` fences, then go on.",
      run: "Wrap it in ``` fences, then go on.",
    },
  ])("reads $text as one run of words", ({ text, run }) => {
    expect(thoughtRunText(text)).toBe(run);
  });
});

describe("thoughtTicker", () => {
  it.each([
    { text: "", ticker: null },
    { text: "The route and the check disagree.", ticker: "The route and the check disagree." },
    {
      text: "The app is a Hono server. So the page belongs on the server as its own route",
      ticker: "So the page belongs on the server as its own route",
    },
    {
      text: "First I'll read the router.\n\n**Planning the check**",
      ticker: "Planning the check.",
    },
    {
      text: "One.\n\nThe build takes two minutes. While it runs I'll plan the `/status` check.",
      ticker: "While it runs I'll plan the /status check.",
    },
  ])("says the latest of $text", ({ text, ticker }) => {
    expect(thoughtTicker(text)).toBe(ticker);
  });
});

describe("formatClock", () => {
  it.each([
    { ms: 0, clock: "0:00" },
    { ms: 999, clock: "0:00" },
    { ms: 31_000, clock: "0:31" },
    { ms: 66_000, clock: "1:06" },
    { ms: 59 * 60_000 + 59_000, clock: "59:59" },
    { ms: 3_600_000 + 5 * 60_000 + 9_000, clock: "1:05:09" },
    { ms: Number.NaN, clock: "0:00" },
  ])("reads $ms ms as $clock", ({ ms, clock }) => {
    expect(formatClock(ms)).toBe(clock);
  });
});

const at = (second: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, second)).toISOString();

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    live: true,
    face: "working",
    startedAt: at(0),
    endedAt: null,
    waitedMs: 0,
    waitingSince: null,
    worked: true,
    ...overrides,
  };
}

function call(id: string, partial: Partial<WorkLogEntry>): WorkLogEntry {
  return {
    id,
    createdAt: at(2),
    startedAt: at(2),
    label: "Tool call",
    tone: "tool",
    sourceActivityKind: "tool.updated",
    toolLifecycleStatus: "inProgress",
    ...partial,
  };
}

const command = (id: string, text: string, description?: string) =>
  stepOf(
    call(id, {
      label: "Command run",
      itemType: "command_execution",
      command: text,
      ...(description === undefined ? {} : { callInput: { description } }),
    }),
  );
const read = (id: string, file: string) =>
  stepOf(call(id, { detail: `Read: {"file_path":"/var/www/app/${file}"}` }));

const thinking = (text: string): TurnHeaderActivity => ({
  kind: "thinking",
  key: "thought:r1",
  messages: [
    {
      id: MessageId.make("r1"),
      role: "reasoning",
      text,
      turnId: TurnId.make("t1"),
      streaming: true,
      createdAt: at(1),
    } as ChatMessage,
  ],
});

const browser = (() => {
  const entry = operationEntry("b1", "t1", 1, {
    kind: "browser",
    phase: "running",
    subject: "https://shop.example.dev/status",
  });
  return entry.kind === "operation" ? entry.operation : null;
})()!;
const deploy = (() => {
  const entry = operationEntry("d1", "t1", 1, {
    kind: "deploy",
    phase: "running",
    voice: "Deploying appdev.",
  });
  return entry.kind === "operation" ? entry.operation : null;
})()!;

// The live slot (pass 35): what the Mate is doing, each thing as the record
// item it becomes — the same key, so it plops into the history as itself —
// and what the slot says when nothing stands in it.
describe("the live slot's model", () => {
  const question: RecordItem = {
    kind: "question",
    key: "question:q1",
    at: at(3),
    questions: ["Should /status be public?"],
  };
  it.each<{
    readonly name: string;
    readonly now: TurnHeaderActivity | null;
    readonly answering?: boolean;
    readonly compacting?: boolean;
    readonly items?: ReadonlyArray<RecordItem>;
    readonly live: ReadonlyArray<string>;
    readonly filler: string;
  }>([
    { name: "nothing yet: it thinks", now: null, live: [], filler: "thinking" },
    {
      name: "a thought with words: the thought, keyed as the record keys it",
      now: thinking("The app is a Hono server."),
      live: ["thought:r1"],
      filler: "thinking",
    },
    {
      name: "a thought with no words yet: Thinking, never an empty bubble",
      now: thinking("  "),
      live: [],
      filler: "thinking",
    },
    {
      name: "calls at once: a row each, oldest first",
      now: {
        kind: "step",
        step: command("w2", "pnpm test"),
        others: [{ kind: "step", step: read("w1", "index.ts") }],
      },
      live: ["step:w1", "step:w2"],
      filler: "thinking",
    },
    {
      name: "a deploy and a command at once: a row each, the operation's too",
      now: {
        kind: "step",
        step: command("w2", "pnpm test"),
        others: [{ kind: "operation", operation: deploy }],
      },
      live: ["operation:op:d1", "step:w2"],
      filler: "thinking",
    },
    {
      name: "a command and a check in the browser at once: the step's row, then the takes",
      now: {
        kind: "operation",
        operation: browser,
        others: [{ kind: "step", step: command("w1", "pnpm build") }],
      },
      live: ["step:w1", "operation:op:b1"],
      filler: "thinking",
    },
    {
      name: "a deploy it waits on: the operation's row",
      now: { kind: "operation", operation: deploy },
      live: ["operation:op:d1"],
      filler: "thinking",
    },
    {
      // Its line stands in the record where its first call returned; the
      // follow-up it waits on is a line of its own (D2).
      name: "a session's follow-up call: a row of its own, apart from the session's line",
      now: {
        kind: "operation",
        operation: {
          ...deploy,
          key: "op:bs1",
          kind: "bootstrap",
          returnedAt: "2026-09-24T20:01:30.000Z",
          openedAt: "2026-09-24T20:03:00.000Z",
        },
      },
      live: ["operation:op:bs1#2026-09-24T20:03:00.000Z"],
      filler: "thinking",
    },
    {
      name: "a check in the browser: the row of takes it becomes",
      now: { kind: "operation", operation: browser },
      live: ["operation:op:b1"],
      filler: "thinking",
    },
    {
      name: "an approval: what it asks stands in the slot",
      now: {
        kind: "waiting",
        on: "approval",
        asked: [{ kind: "step", step: command("w1", "pnpm build") }],
      },
      live: ["step:w1"],
      filler: "thinking",
    },
    {
      name: "a question in its own words: the question waits in the slot",
      now: { kind: "waiting", on: "answer", key: "question:q1" },
      items: [question],
      live: ["question:q1"],
      filler: "thinking",
    },
    {
      name: "an approval: what it waits on, in words",
      now: { kind: "waiting", on: "approval" },
      live: [],
      filler: "waiting",
    },
    { name: "its answer on its way", now: null, answering: true, live: [], filler: "writing" },
    { name: "condensing its context", now: null, compacting: true, live: [], filler: "condensing" },
  ])("$name", ({ now, answering = false, compacting = false, items = [], live, filler }) => {
    const model = slotModelOf({ now, answering, compacting, items });
    expect(model.live.map((item) => item.key)).toEqual(live);
    expect(model.filler.kind).toBe(filler);
  });
});

// The now line, the card's foot, says what is happening in words (K10): the
// step itself, never "Nova is working"; the face and the one clock beside it.
describe("the now line", () => {
  it.each([
    {
      name: "between two steps",
      now: null,
      words: "Thinking",
      face: { state: "working", gaze: "up" },
    },
    {
      name: "thinking",
      now: thinking("The app is a Hono server. So the page belongs on the server"),
      words: "Thinking",
      face: { state: "working", gaze: "up" },
    },
    {
      name: "running a described command",
      now: { kind: "step", step: command("w1", "cd /var/www/app && pnpm build", "Build the app") },
      words: "Build the app",
      face: { state: "working" },
    },
    {
      name: "running a command that said nothing of itself",
      now: { kind: "step", step: command("w1", "pnpm build") },
      words: "pnpm build",
      face: { state: "working" },
    },
    {
      name: "reading a file",
      now: { kind: "step", step: read("w1", "src/index.ts") },
      words: "Reading index.ts",
      face: { state: "working" },
    },
    {
      name: "checking a page in the browser",
      now: { kind: "operation", operation: browser },
      words: "Checking /status in the browser",
      face: { state: "working" },
    },
    {
      name: "deploying",
      now: { kind: "operation", operation: deploy },
      words: "Deploying appdev",
      face: { state: "working" },
    },
    {
      name: "running three commands at once",
      now: {
        kind: "step",
        step: command("w3", "pnpm lint"),
        others: [
          { kind: "step", step: command("w1", "pnpm build") },
          { kind: "step", step: command("w2", "pnpm test") },
        ],
      },
      words: "Running 3 commands",
      face: { state: "working" },
    },
    {
      name: "a command beside a deploy",
      now: {
        kind: "operation",
        operation: deploy,
        others: [{ kind: "step", step: command("w1", "pnpm build") }],
      },
      words: "Running 2 steps",
      face: { state: "working" },
    },
    {
      name: "waiting for the person's answer",
      now: { kind: "waiting", on: "answer" },
      words: "Waiting for your answer",
      face: { state: "needs" },
    },
    {
      name: "waiting for the person's approval",
      now: { kind: "waiting", on: "approval" },
      words: "Waiting for your approval",
      face: { state: "needs" },
    },
    {
      name: "writing",
      now: { kind: "writing" },
      words: "Writing",
      face: { state: "working", gaze: "down" },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    now: TurnHeaderActivity | null;
    words: string;
    face: { state: string; gaze?: string };
  }>)("says $words while $name", ({ now, words, face }) => {
    const line = nowLineOf({
      status: status(),
      now,
      answering: false,
      compacting: false,
      speaker: "Nova",
      effort: null,
    });
    expect(nowLineWords(line)).toBe(words);
    expect(nowLineFace(line, status())).toEqual(face);
  });

  it("says the Mate writes once its answer streams under the card", () => {
    const line = nowLineOf({
      status: status(),
      now: { kind: "step", step: read("w1", "a.ts") },
      answering: true,
      compacting: false,
      speaker: "Nova",
      effort: null,
    });
    expect(nowLineWords(line)).toBe("Writing");
  });

  it("says the Mate condenses its context while it does", () => {
    const line = nowLineOf({
      status: status(),
      now: null,
      answering: false,
      compacting: true,
      speaker: "Nova",
      effort: null,
    });
    expect(nowLineWords(line)).toBe("Condensing the context");
  });

  it("carries the latest of the thought it is thinking", () => {
    const line = nowLineOf({
      status: status(),
      now: thinking("The app is a Hono server. So the page belongs on the server"),
      answering: false,
      compacting: false,
      speaker: "Nova",
      effort: null,
    });
    expect(line).toEqual({ kind: "thinking", thought: "So the page belongs on the server" });
  });

  // Finished, the now line becomes the worked line: who, the verb, how long,
  // and what the effort came to — "Nova worked 1m 20s · 2 commands".
  it.each([
    {
      name: "a run that worked",
      over: { face: "produced", endedAt: at(80) },
      effort: "2 commands · 1 file read",
      words: "Nova worked 1m 20s",
      face: "done",
    },
    {
      name: "a run that only thought",
      over: { face: "idle", endedAt: at(12), worked: false },
      effort: null,
      words: "Nova thought 12s",
      face: "idle",
    },
    {
      name: "a run the person stopped",
      over: { face: "stopped", endedAt: at(45) },
      effort: null,
      words: "Nova stopped after 45s",
      face: "idle",
    },
    {
      name: "a run whose agent died under it",
      over: { face: "brokeOff", endedAt: at(45) },
      effort: "2 commands",
      words: "Nova stopped after 45s",
      face: "idle",
    },
    {
      name: "a run the usage limit stopped",
      over: { face: "paused", endedAt: at(45) },
      effort: null,
      words: "Nova paused at the limit · 45s",
      face: "sleep",
    },
    {
      name: "a run that waited on the person",
      over: { face: "produced", endedAt: at(100), waitedMs: 20_000 },
      effort: null,
      words: "Nova worked 1m 20s",
      face: "done",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    over: Partial<RunStatus>;
    effort: string | null;
    words: string;
    face: string;
  }>)("says $words for $name", ({ over, effort, words, face }) => {
    const settled = status({ live: false, ...over });
    const line = nowLineOf({
      status: settled,
      now: null,
      answering: false,
      compacting: false,
      speaker: "Nova",
      effort,
    });
    expect(line).toEqual({ kind: "worked", words, effort });
    expect(workedWords("Nova", settled)).toBe(words);
    expect(nowLineFace(line, settled)).toEqual({ state: face });
  });
});

describe("severalWords", () => {
  it.each([
    { steps: [command("a", "ls"), command("b", "pwd")], words: "Running 2 commands" },
    { steps: [read("a", "a.ts"), read("b", "b.ts"), read("c", "c.ts")], words: "Reading 3 files" },
    { steps: [read("a", "a.ts"), command("b", "ls")], words: "Running 2 steps" },
  ])("says $words", ({ steps, words }) => {
    expect(severalWords(steps)).toBe(words);
  });
});

// The run's scroll follows its newest line while it stands at its foot, and
// stays where the person scrolled to once they leave it (the owner,
// 2026-09-29: "open with scroll and all events").
describe("standsAtFoot", () => {
  it.each([
    { name: "at its foot", scrollTop: 560, foot: true },
    { name: "a pixel short of it", scrollTop: 559, foot: true },
    { name: "its slack short of it", scrollTop: 560 - FOLLOW_SLACK_PX, foot: true },
    { name: "past its slack", scrollTop: 559 - FOLLOW_SLACK_PX, foot: false },
    { name: "scrolled up a line", scrollTop: 520, foot: false },
    { name: "at its top", scrollTop: 0, foot: false },
  ])("$name: $foot", ({ scrollTop, foot }) => {
    expect(standsAtFoot({ scrollTop, scrollHeight: 1000, clientHeight: 440 })).toBe(foot);
  });

  it("stands at its foot while nothing overflows", () => {
    expect(standsAtFoot({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true);
  });
});

// While the run goes on its scroll follows its newest line: every arrival
// keeps the foot in view. Only the person moving it up stops it — told by
// the move itself, a pixel and a half or more from where it last stood,
// whatever made it (a wheel, keys, a find, a drag-select, focus) — and only
// the person moving it down onto its foot follows again; growth, a plop, a
// resync, a re-measure, its own follow or the browser clamping it keeps it as
// it was. Opening something in it stops it; closing the last thing they
// opened follows again, if it followed then and they did not move it up since.
describe("followAfter", () => {
  const at = (follows: boolean, stood: number): RunScrollFollow => ({
    follows,
    stood,
    opened: new Set(),
    resumes: false,
    reach: null,
    foot: null,
  });
  const foot = { scrollTop: 560, scrollHeight: 1000, clientHeight: 440 };
  const nearFoot = { ...foot, scrollTop: 560 - FOLLOW_SLACK_PX };
  const up = { ...foot, scrollTop: 300 };
  // An arrival grew it under where it stood: the foot moved on, it did not.
  const grownUnder = { scrollTop: 560, scrollHeight: 1065, clientHeight: 440 };
  // A row's travel ended, or the card grew taller: the browser clamped it
  // onto the shorter foot.
  const clamped = { scrollTop: 500, scrollHeight: 940, clientHeight: 440 };
  // A card below its cap: it cannot scroll, so it always stands at its foot.
  const belowCap = { scrollTop: 0, scrollHeight: 420, clientHeight: 420 };
  it.each([
    { name: "moved up, away from the foot", follows: true, stood: 560, position: up, after: false },
    {
      name: "moved up inside the slack",
      follows: true,
      stood: 560,
      position: nearFoot,
      after: false,
    },
    { name: "moved back to the foot", follows: false, stood: 300, position: foot, after: true },
    { name: "moved back near it", follows: false, stood: 300, position: nearFoot, after: true },
    { name: "moved down, still above", follows: false, stood: 120, position: up, after: false },
    { name: "moved further up", follows: false, stood: 400, position: up, after: false },
    { name: "an arrival under it", follows: true, stood: 560, position: grownUnder, after: true },
    {
      name: "its own follow, read late",
      follows: true,
      stood: 500,
      position: grownUnder,
      after: true,
    },
    {
      name: "a clamp onto a shorter foot",
      follows: true,
      stood: 560,
      position: clamped,
      after: true,
    },
    { name: "moved down, while following", follows: true, stood: 120, position: up, after: true },
    { name: "a sub-pixel settle", follows: true, stood: 300.4, position: up, after: true },
    // Stopped, nothing but the person's move down brings it back.
    { name: "stopped, read at its foot", follows: false, stood: 560, position: foot, after: false },
    {
      name: "stopped, grown under it",
      follows: false,
      stood: 560,
      position: grownUnder,
      after: false,
    },
    {
      name: "stopped, clamped onto its foot",
      follows: false,
      stood: 560,
      position: clamped,
      after: false,
    },
    {
      name: "stopped below its cap, re-read",
      follows: false,
      stood: 0,
      position: belowCap,
      after: false,
    },
    {
      name: "following below its cap, re-read",
      follows: true,
      stood: 0,
      position: belowCap,
      after: true,
    },
  ])("$name: $after", ({ follows, stood, position, after }) => {
    expect(followAfter(at(follows, stood), { kind: "scrolled", position }).follows).toBe(after);
  });

  it.each([
    { name: "a move it heard", stood: 560, position: up, top: 300 },
    { name: "a move down", stood: 120, position: up, top: 300 },
    { name: "a clamp", stood: 560, position: clamped, top: 500 },
    // Read again from where it stood, so a slow drag adds up to a move.
    { name: "less than a pixel and a half up", stood: 301.4, position: up, top: 301.4 },
  ])("stands where $name left it", ({ stood, position, top }) => {
    expect(followAfter(at(true, stood), { kind: "scrolled", position }).stood).toBe(top);
  });

  it("creeping up a fraction of a pixel at a time stops following once it adds up", () => {
    let state = at(true, 560);
    for (const scrollTop of [559.6, 559.2, 558.8]) {
      state = followAfter(state, { kind: "scrolled", position: { ...foot, scrollTop } });
    }
    expect(state.follows).toBe(true);
    state = followAfter(state, { kind: "scrolled", position: { ...foot, scrollTop: 558.4 } });
    expect(state.follows).toBe(false);
  });

  // Each line arriving moves its foot on and its own follow puts it there;
  // the person dragging up between them still moved it up.
  it("a slow drag up between arrivals stops following", () => {
    let state = at(true, 560);
    let height = 1000;
    let top = 560;
    for (let wrap = 0; wrap < 5; wrap += 1) {
      top -= 3;
      state = followAfter(state, {
        kind: "scrolled",
        position: { scrollTop: top, scrollHeight: height, clientHeight: 440 },
      });
      height += 20;
      if (state.follows) {
        top = height - 440;
        state = followAfter(state, { kind: "set", top });
      }
    }
    expect(state.follows).toBe(false);
  });

  it.each([
    { follows: true, after: true },
    { follows: false, after: false },
  ])("its own move keeps it as it was ($follows)", ({ follows, after }) => {
    expect(followAfter(at(follows, 0), { kind: "set", top: 460 })).toEqual(at(after, 460));
  });

  it("stops when the person opens something in it", () => {
    expect(followAfter(at(true, 560), { kind: "opened", key: "a" }).follows).toBe(false);
  });

  // The person opened a call to read it, and closed it again: what they
  // stopped it for is done.
  // Each thing is counted once, by its own switch: a close of something they
  // never opened (a command that opened itself in the slot, a switch that
  // closes what was closed) is not theirs to count.
  it.each([
    { name: "closing what they opened at its foot", steps: ["open a", "close a"], after: true },
    {
      name: "closing the last of two",
      steps: ["open a", "open b", "close a", "close b"],
      after: true,
    },
    { name: "closing one of two", steps: ["open a", "open b", "close b"], after: false },
    { name: "closing one twice", steps: ["open a", "open b", "close b", "close b"], after: false },
    {
      name: "closing one opened twice",
      steps: ["open a", "open a", "open b", "close a"],
      after: false,
    },
    { name: "closing what opened itself", steps: ["open a", "close b"], after: false },
    {
      name: "closing what they opened scrolled up",
      steps: ["up", "open a", "close a"],
      after: false,
    },
    { name: "closing it after moving up", steps: ["open a", "up", "close a"], after: false },
    { name: "closing what was open before", steps: ["close a"], after: true },
    { name: "closing, stopped, what was open before", steps: ["up", "close a"], after: false },
    {
      name: "closing it after moving up and back down",
      steps: ["open a", "up", "down", "close a"],
      after: true,
    },
    {
      name: "closing what was opened before following again",
      steps: ["open a", "up", "down", "open b", "close a"],
      after: false,
    },
  ])("$name: follows $after", ({ steps, after }) => {
    let state = at(true, 560);
    for (const step of steps) {
      if (step === "up") {
        state = followAfter(state, { kind: "scrolled", position: up });
      } else if (step === "down") {
        state = followAfter(state, { kind: "scrolled", position: foot });
      } else {
        const [verb, key = ""] = step.split(" ");
        state = followAfter(state, { kind: verb === "open" ? "opened" : "closed", key });
      }
    }
    expect(state.follows).toBe(after);
  });

  // End, or a wheel run to the bottom, glides to the foot as it stood when
  // the move began; a line arriving meanwhile moves the foot on under it.
  describe("a move down to the foot while lines arrive", () => {
    const read = (scrollTop: number, scrollHeight: number) => ({
      kind: "scrolled" as const,
      position: { scrollTop, scrollHeight, clientHeight: 440 },
    });
    it.each([
      { name: "reaching the foot it set out for", to: 560, after: true },
      { name: "its slack short of it", to: 560 - FOLLOW_SLACK_PX, after: true },
      { name: "stopping short of it", to: 500, after: false },
    ])("$name: follows $after", ({ to, after }) => {
      let state = at(false, 0);
      state = followAfter(state, read(200, 1000));
      // A line arrives under it as it glides.
      state = followAfter(state, read(400, 1035));
      state = followAfter(state, read(to, 1035));
      expect(state.follows).toBe(after);
    });

    // End pressed at a foot of 560; a line lands before the first read of
    // the glide, which reads it grown already.
    it("sets out for the foot it read last before the move", () => {
      let state = at(false, 0);
      state = followAfter(state, read(0, 1000));
      state = followAfter(state, read(200, 1035));
      state = followAfter(state, read(560, 1035));
      expect(state.follows).toBe(true);
    });

    it("sets out anew once its move ends", () => {
      let state = at(false, 0);
      state = followAfter(state, read(200, 1000));
      state = followAfter(state, { kind: "ended" });
      state = followAfter(state, read(200, 1300));
      state = followAfter(state, read(560, 1300));
      expect(state.follows).toBe(false);
    });

    it("sets out anew once it moved up", () => {
      let state = at(false, 0);
      state = followAfter(state, read(300, 1000));
      state = followAfter(state, read(100, 1300));
      state = followAfter(state, read(560, 1300));
      expect(state.follows).toBe(false);
    });
  });
});

// While the live slot eases, the browser clamps the history's top as its box
// grows; only a move that clamp explains is the card's — any further move
// with no input on the scroll (find in page, Tab, a drag-select scrolling,
// a screen reader) is the person's, and it stays where they took it.
describe("movedByClamp", () => {
  it.each([
    {
      what: "the box grew 3 px, the top went 3 px up",
      stood: 400,
      top: 397,
      stoodMax: 400,
      max: 397,
      clamp: true,
    },
    {
      what: "the box grew 2 px, the top went 2.5 px up (rounding)",
      stood: 400,
      top: 397.5,
      stoodMax: 400,
      max: 398,
      clamp: true,
    },
    {
      what: "a find in page took the top 300 px up",
      stood: 400,
      top: 100,
      stoodMax: 400,
      max: 398,
      clamp: false,
    },
    {
      what: "a drag-select scrolled it 40 px up, nothing resized",
      stood: 400,
      top: 360,
      stoodMax: 400,
      max: 400,
      clamp: false,
    },
    {
      what: "the box shrank, the top went up",
      stood: 400,
      top: 390,
      stoodMax: 400,
      max: 420,
      clamp: false,
    },
    { what: "a move down", stood: 400, top: 420, stoodMax: 400, max: 420, clamp: true },
    {
      // Run 12, 18:58:18: no measure of the clamp explains it, and it was no person's.
      what: "its lines re-measured 6 px taller, the top set 14 px up",
      stood: 400,
      top: 386,
      stoodMax: 400,
      max: 406,
      linesResized: true,
      clamp: true,
    },
    {
      what: "a find in page as its lines resize (a streaming answer, reduced motion)",
      stood: 400,
      top: 100,
      stoodMax: 400,
      max: 410,
      linesResized: true,
      clamp: false,
    },
    {
      what: "a move a frame's speed past the clamp, nothing resized",
      stood: 400,
      top: 380,
      stoodMax: 400,
      max: 400,
      clamp: false,
    },
  ])("$what: the clamp's $clamp", ({ stood, top, stoodMax, max, clamp, ...row }) => {
    const linesResized = "linesResized" in row ? row.linesResized : false;
    expect(movedByClamp({ stood, top, stoodMax, max, linesResized })).toBe(clamp);
  });
});

// A row travelling into its place (a plop from the live slot, a rise) paints
// past the lines' own foot for a moment; that is no content: the scroll's foot
// and its fades are read from the lines as laid out.
describe("laidOutPosition", () => {
  it.each([
    { name: "a plop under the foot", scrollHeight: 549, laidHeight: 511, laid: 511 },
    { name: "nothing travelling", scrollHeight: 511, laidHeight: 511, laid: 511 },
    { name: "a fractional box", scrollHeight: 511, laidHeight: 511.4, laid: 511 },
  ])("$name: $laid", ({ scrollHeight, laidHeight, laid }) => {
    expect(laidOutPosition({ scrollTop: 18, scrollHeight, clientHeight: 493, laidHeight })).toEqual(
      { scrollTop: 18, scrollHeight: laid, clientHeight: 493 },
    );
  });
});

describe("footTop", () => {
  it.each([
    { name: "overflowing", scrollHeight: 1000, clientHeight: 440, top: 560 },
    { name: "fitting", scrollHeight: 300, clientHeight: 440, top: 0 },
  ])("$name: $top", ({ scrollHeight, clientHeight, top }) => {
    expect(footTop({ scrollTop: 0, scrollHeight, clientHeight })).toBe(top);
  });
});

// A fade at an edge says lines are cut past it, and nothing else does.
describe("cutEdges", () => {
  it.each([
    { name: "at the foot", scrollTop: 560, scrollHeight: 1000, above: true, below: false },
    { name: "at the top", scrollTop: 0, scrollHeight: 1000, above: false, below: true },
    { name: "between", scrollTop: 300, scrollHeight: 1000, above: true, below: true },
    {
      name: "a pixel short of the foot",
      scrollTop: 559,
      scrollHeight: 1000,
      above: true,
      below: false,
    },
    { name: "fitting", scrollTop: 0, scrollHeight: 440, above: false, below: false },
  ])("$name", ({ scrollTop, scrollHeight, above, below }) => {
    expect(cutEdges({ scrollTop, scrollHeight, clientHeight: 440 })).toEqual({ above, below });
  });
});

// A long run draws its newest lines first; the earlier ones are drawn as the
// person scrolls up to them, before they reach the top.
describe("reachesEarlier", () => {
  it.each([
    {
      name: "near the top, lines left above",
      scrollTop: EARLIER_REACH_PX - 1,
      from: 60,
      reaches: true,
    },
    { name: "at the top", scrollTop: 0, from: 60, reaches: true },
    { name: "far from the top", scrollTop: EARLIER_REACH_PX, from: 60, reaches: false },
    { name: "at the top with nothing left above", scrollTop: 0, from: 0, reaches: false },
  ])("$name: $reaches", ({ scrollTop, from, reaches }) => {
    expect(reachesEarlier({ scrollTop }, from)).toBe(reaches);
  });
});

describe("the runs a person watched", () => {
  it("folds a run nobody watched, keeps one watched or opened, and folds all once left", () => {
    const heard: string[] = [];
    const stop = subscribeRunFolds(() => heard.push("changed"));
    expect(runFoldOf("thread-a", "turn-1")).toBe("folded");
    setRunFold("thread-a", "turn-1", "watched");
    setRunFold("thread-a", "turn-2", "shown");
    setRunFold("thread-b", "turn-1", "watched");
    expect(runFoldOf("thread-a", "turn-1")).toBe("watched");
    expect(runFoldOf("thread-a", "turn-2")).toBe("shown");
    setRunFold("thread-a", "turn-2", "folded");
    expect(runFoldOf("thread-a", "turn-2")).toBe("folded");
    forgetRunFolds("thread-a");
    expect(runFoldOf("thread-a", "turn-1")).toBe("folded");
    // Another conversation keeps its own.
    expect(runFoldOf("thread-b", "turn-1")).toBe("watched");
    forgetRunFolds("thread-b");
    stop();
    expect(heard).toHaveLength(6);
  });
});

// Red always means still broken (K9): a failure a later step undid — the
// same command passing on a retry, the same service deploying again, the
// same page passing its check — turns quiet.
describe("recoveredFailures", () => {
  const ran = (id: string, text: string, failed: boolean, description?: string): RecordItem => ({
    kind: "step",
    key: `step:${id}`,
    at: at(Number(id.replace(/\D/g, "")) || 1),
    step: stepOf(
      call(id, {
        label: "Command run",
        itemType: "command_execution",
        command: text,
        toolLifecycleStatus: failed ? "failed" : "completed",
        ...(description === undefined ? {} : { callInput: { description } }),
      }),
      undefined,
      false,
    ),
  });
  const deployed = (id: string, service: string, phase: "done" | "failed"): RecordItem => {
    const entry = operationEntry(id, "t1", 1, {
      kind: "deploy",
      phase,
      subject: service,
      target: { hostname: service },
    });
    return {
      kind: "operation",
      key: `operation:op:${id}`,
      at: at(1),
      operation: entry.kind === "operation" ? entry.operation : (null as never),
    };
  };
  const devServer = (id: string, service: string, running: boolean): RecordItem => {
    const entry = operationEntry(id, "t1", 1, {
      kind: "devServer",
      phase: "done",
      subject: service,
      target: { hostname: service },
      statusWord: running ? "Running" : "Not running",
      steps: [
        {
          id: "dev-server",
          label: running ? "Start" : "Status",
          state: running ? "done" : "failed",
          stateLabel: running ? "Done" : "Failed",
        },
      ],
    });
    return {
      kind: "operation",
      key: `operation:op:${id}`,
      at: at(1),
      operation: entry.kind === "operation" ? entry.operation : (null as never),
    };
  };
  it.each([
    // One story (the owner, 2026-09-30): a dev server found down and then
    // running again is quiet where it was found down; the current state wins.
    {
      name: "a dev server found not running, then running",
      items: [devServer("s1", "appdev", false), devServer("s2", "appdev", true)],
      recovered: ["operation:op:s1"],
    },
    {
      name: "a dev server found not running, and still",
      items: [devServer("s1", "appdev", false), devServer("s2", "appdev", false)],
      recovered: [],
    },
    {
      name: "another service's dev server running",
      items: [devServer("s1", "appdev", false), devServer("s2", "apidev", true)],
      recovered: [],
    },
    {
      name: "a command that passed on a retry",
      items: [ran("w1", "npm test", true), ran("w2", "npm test", false)],
      recovered: ["step:w1"],
    },
    {
      name: "a command a different one followed",
      items: [ran("w1", "npm test", true), ran("w2", "npm run build", false)],
      recovered: [],
    },
    {
      name: "a command that failed twice, then passed",
      items: [
        ran("w1", "npm test", true),
        ran("w2", "npm test", true),
        ran("w3", "npm test", false),
      ],
      recovered: ["step:w1", "step:w2"],
    },
    {
      name: "a command that failed again",
      items: [ran("w1", "npm test", true), ran("w2", "npm test", true)],
      recovered: [],
    },
    {
      name: "a step retried under the same words",
      items: [
        ran("w1", "npm test -- status", true, "Run the tests"),
        ran("w2", "npm test -- --run status", false, "Run the tests"),
      ],
      recovered: ["step:w1"],
    },
    {
      name: "a service that deployed again",
      items: [deployed("d1", "appdev", "failed"), deployed("d2", "appdev", "done")],
      recovered: ["operation:op:d1"],
    },
    {
      name: "another service that deployed",
      items: [deployed("d1", "appdev", "failed"), deployed("d2", "apidev", "done")],
      recovered: [],
    },
    {
      name: "a success before the failure",
      items: [ran("w1", "npm test", false), ran("w2", "npm test", true)],
      recovered: [],
    },
  ])("$name: $recovered", ({ items, recovered }) => {
    expect([...recoveredFailures(items)]).toEqual(recovered);
  });
});

describe("recoveredFailures on a long run", () => {
  // A two-hour run holds thousands of lines, and its card redraws on every
  // word of a thought: telling what was undone must not scan the run once
  // per failure.
  it("tells thousands of failures apart in one pass", () => {
    const items: RecordItem[] = Array.from({ length: 6000 }, (_, index) => ({
      kind: "step",
      key: `step:w${index}`,
      at: at(1),
      step: stepOf(
        call(`w${index}`, {
          label: "Command run",
          itemType: "command_execution",
          command: `pnpm test --shard ${index % 3000}`,
          toolLifecycleStatus: index < 3000 ? "failed" : "completed",
        }),
        undefined,
        false,
      ),
    }));
    const started = performance.now();
    const undone = recoveredFailures(items);
    const took = performance.now() - started;
    expect(undone.size).toBe(3000);
    expect(took).toBeLessThan(250);
  });
});

describe("runCardShows — where a run's work stands, and what its line offers", () => {
  it.each([
    {
      name: "live: over the line, nothing to toggle",
      settled: false,
      fold: "watched",
      work: "above",
      toggle: null,
    },
    {
      name: "settled while the person read it: still open over the line, and it can be hidden",
      settled: true,
      fold: "watched",
      work: "above",
      toggle: "hide",
    },
    {
      name: "folding into its line",
      settled: true,
      fold: "folding",
      work: "above",
      toggle: "show",
    },
    { name: "folded: the line alone", settled: true, fold: "folded", work: null, toggle: "show" },
    {
      name: "opened again: under the line",
      settled: true,
      fold: "shown",
      work: "below",
      toggle: "hide",
    },
  ] as const)("$name", ({ settled, fold, work, toggle }) => {
    expect(runCardShows(settled, fold)).toEqual({ work, toggle });
  });
});

// Bodhi: notes ended on "Committing:", "Full error output:", "Screenshot of
// the tab:" with nothing after them — what they announced is the next step.
describe("noteText", () => {
  it.each([
    ["Committing:", false, "Committing"],
    ["Full error output:\n", false, "Full error output"],
    ["Here is the plan:\n\n1. Build", false, "Here is the plan:\n\n1. Build"],
    ["Ratio 3:2 holds.", false, "Ratio 3:2 holds."],
    ["Committing:", true, "Committing:"],
    ["```yaml\nkey:\n```", false, "```yaml\nkey:\n```"],
  ])("%j (streaming %j) reads %j", (text, streaming, expected) => {
    expect(noteText(text, streaming)).toBe(expected);
  });
});

describe("slotWords", () => {
  it.each([
    {
      name: "nothing standing, thinking",
      item: null,
      filler: { kind: "thinking" },
      words: "Thinking",
    },
    {
      name: "nothing standing, a wait",
      item: null,
      filler: { kind: "waiting", on: "approval" },
      words: "Waiting for your approval",
    },
    {
      name: "a thought standing",
      item: { kind: "thought", key: "t", at: "", messages: [], durationMs: null },
      filler: { kind: "writing" },
      words: "Thinking",
    },
    {
      // Review of pass 39: a check in the browser was heard as "Thinking".
      name: "a check in the browser",
      item: {
        kind: "strip",
        key: "strip:b1",
        at: "",
        strip: { key: "strip:b1", checks: [browser], views: 1, failures: 0, live: true },
      },
      filler: { kind: "thinking" },
      words: "Checking /status in the browser",
    },
  ] as const)("$name", ({ item, filler, words }) => {
    expect(slotWords(item as RecordItem | null, filler)).toBe(words);
  });
});
