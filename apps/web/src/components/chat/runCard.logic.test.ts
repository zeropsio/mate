import { MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { operation as operationEntry } from "./conversationFixtures";
import type { RecordItem, RunStatus, TurnHeaderActivity } from "./MessagesTimeline.logic";
import {
  CHAT_OPENS_WITH,
  chatOpensAt,
  EARLIER_CHUNK,
  EARLIER_REACH_PX,
  earlierShown,
  forgetRunFolds,
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
        others: [read("w1", "index.ts")],
      },
      live: ["step:w1", "step:w2"],
      filler: "thinking",
    },
    {
      name: "a deploy it waits on: the operation's row",
      now: { kind: "operation", operation: deploy },
      live: ["operation:op:d1"],
      filler: "thinking",
    },
    {
      name: "a check in the browser: the row of takes it becomes",
      now: { kind: "operation", operation: browser },
      live: ["operation:op:b1"],
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
        others: [command("w1", "pnpm build"), command("w2", "pnpm test")],
      },
      words: "Running 3 commands",
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
      name: "a run the usage limit stopped",
      over: { face: "paused", endedAt: at(45) },
      effort: null,
      words: "Nova stopped at the usage limit after 45s",
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
    { name: "scrolled up a line", scrollTop: 520, foot: false },
    { name: "at its top", scrollTop: 0, foot: false },
  ])("$name: $foot", ({ scrollTop, foot }) => {
    expect(standsAtFoot({ scrollTop, scrollHeight: 1000, clientHeight: 440 })).toBe(foot);
  });

  it("stands at its foot while nothing overflows", () => {
    expect(standsAtFoot({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true);
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
