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
  earlierShown,
  foldsOnReturn,
  forgetRunFolds,
  formatClock,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  recoveredFailures,
  runFoldOf,
  setRunFold,
  severalWords,
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
  ])("from line $from, a click shows $shows and leaves $next", ({ from, shows, next }) => {
    expect(earlierShown(from)).toEqual({ shows, next });
  });

  // D4: nothing is ever out of reach — however long the run, clicking
  // "Show N earlier" until it is gone draws every line, and each click says
  // exactly how many it draws.
  it.each([1, 41, 199, 200, 201, 860, 5000])(
    "reaches every line of a %i-line chat, a click at a time",
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

// A run you come back to opens folded, and keeps everything it said to you
// (K7, D3): the Mate's words, what the person said into the run and anything
// it couldn't do stay as they were; only thoughts and calls fold.
describe("foldsOnReturn", () => {
  const base = { key: "k", at: at(1) };
  const entry = call("e1", {});
  const operationItem = { ...base, kind: "operation", operation: deploy } as const;
  const message = {
    id: MessageId.make("a1"),
    role: "assistant",
    text: "Found it.",
    turnId: TurnId.make("t1"),
    streaming: false,
    createdAt: at(1),
  } as ChatMessage;
  it.each([
    {
      name: "a thought",
      item: { ...base, kind: "thought", messages: [], durationMs: null },
      folds: true,
    },
    { name: "a step", item: { ...base, kind: "step", step: command("w1", "ls") }, folds: true },
    { name: "a call", item: { ...base, kind: "call", entry }, folds: true },
    { name: "an operation", item: operationItem, folds: true },
    { name: "helpers", item: { ...base, kind: "helpers", entry }, folds: true },
    { name: "a task", item: { ...base, kind: "task", entry }, folds: true },
    { name: "its to-do list", item: { ...base, kind: "plan", plan: {} }, folds: true },
    { name: "checks", item: { ...base, kind: "strip", strip: {} }, folds: true },
    { name: "an incident", item: { ...base, kind: "incident", incident: {} }, folds: true },
    {
      name: "a condensed context",
      item: { ...base, kind: "event", event: { type: "compaction", label: "Context compacted" } },
      folds: true,
    },
    { name: "a resume", item: { ...base, kind: "event", event: { type: "resumed" } }, folds: true },
    { name: "its words", item: { ...base, kind: "note", message }, folds: false },
    {
      name: "a question it asked",
      item: { ...base, kind: "question", questions: ["Public?"] },
      folds: false,
    },
    {
      name: "the person's words",
      item: { ...base, kind: "person", words: "Yes", imageOnly: false },
      folds: false,
    },
    { name: "what stopped it", item: { ...base, kind: "error", entry }, folds: false },
    {
      name: "a crew seam",
      item: { ...base, kind: "crew-seam", seam: {}, words: "Stint two" },
      folds: false,
    },
    {
      name: "a change that landed",
      item: { ...base, kind: "event", event: { type: "landed", event: {} } },
      folds: false,
    },
    {
      name: "a command the person ran",
      item: {
        ...base,
        kind: "event",
        event: { type: "command", command: { name: "compact", args: "" }, done: true },
      },
      folds: false,
    },
  ] as ReadonlyArray<{ name: string; item: RecordItem; folds: boolean }>)(
    "$name folds: $folds",
    ({ item, folds }) => {
      expect(foldsOnReturn(item)).toBe(folds);
    },
  );
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
  it.each([
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
