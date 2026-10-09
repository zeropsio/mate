import type { EngineCardPaging } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  createMessagesTimelineRowsCache,
  deriveMessagesTimelineRows,
  type HelperFinish,
  type MessagesTimelineRow,
  type MessagesTimelineRowsCache,
  type StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic";
import type { LiveJobs } from "./liveJobs.logic";
import { assistant, at, reasoning, tool, turn, user } from "./conversationFixtures";
import { perfConversation, perfTurn, perfTurnSeconds } from "./timelinePerfFixture";

/** One moment of a conversation as the page derives it. */
interface Frame {
  readonly entries: ReadonlyArray<TimelineEntry>;
  /** The turn running now, if one does; else `settled` is the latest. */
  readonly live?: string;
  readonly settled?: string;
  readonly helperFinishes?: ReadonlyArray<HelperFinish>;
  /** The server's live jobs: the same object until they change, as the page holds them. */
  readonly liveJobs?: LiveJobs;
  readonly nowMs?: number;
  readonly cardPaging?: Readonly<Record<string, EngineCardPaging>>;
  readonly isCompacting?: boolean;
  readonly liveLines?: ReadonlyMap<string, boolean>;
}

function derive(frame: Frame, cache?: MessagesTimelineRowsCache): MessagesTimelineRow[] {
  const latest = frame.live ?? frame.settled;
  const startedAt = frame.entries.findLast((entry) => entry.kind === "message")?.createdAt;
  return deriveMessagesTimelineRows({
    timelineEntries: frame.entries,
    latestTurn: latest
      ? {
          turnId: turn(latest),
          state: frame.live ? "running" : "completed",
          startedAt: startedAt ?? at(0),
          completedAt: frame.live ? null : (frame.entries.at(-1)?.createdAt ?? at(0)),
        }
      : null,
    runningTurnId: frame.live ? turn(frame.live) : null,
    isWorking: frame.live !== undefined,
    activeTurnStartedAt: frame.live ? (startedAt ?? null) : null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    provider: "claudeAgent",
    nowMs: frame.nowMs ?? Date.parse(at(60 * 24)),
    ...(frame.helperFinishes === undefined ? {} : { helperFinishes: frame.helperFinishes }),
    ...(frame.liveJobs === undefined ? {} : { liveJobs: frame.liveJobs }),
    ...(cache === undefined ? {} : { cache }),
    ...(frame.cardPaging === undefined ? {} : { cardPaging: frame.cardPaging }),
    ...(frame.isCompacting === undefined ? {} : { isCompacting: frame.isCompacting }),
    ...(frame.liveLines === undefined ? {} : { liveLines: frame.liveLines }),
  });
}

const work = (entry: TimelineEntry) => entry as Extract<TimelineEntry, { kind: "work" }>;
const withEntry = (entry: TimelineEntry, patch: Partial<WorkLogEntry>): TimelineEntry => ({
  ...work(entry),
  entry: { ...work(entry).entry, ...patch },
});

const STEPS = 14;
const history = perfConversation(4, STEPS);
const liveRun = perfTurn(4, 4 * perfTurnSeconds(STEPS), STEPS);
const nextRun = perfTurn(5, 5 * perfTurnSeconds(STEPS), 6);

/** The live run growing an entry at a time, its answer streaming, settled, and the next begun. */
function growingRun(): Frame[] {
  const frames: Frame[] = [];
  const answer = liveRun.at(-1)!;
  for (let count = 1; count < liveRun.length; count += 1) {
    frames.push({ entries: [...history, ...liveRun.slice(0, count)], live: "t4" });
  }
  const streaming =
    answer.kind === "message"
      ? { ...answer, message: { ...answer.message, text: "Done", streaming: true } }
      : answer;
  frames.push({ entries: [...history, ...liveRun.slice(0, -1), streaming], live: "t4" });
  frames.push({ entries: [...history, ...liveRun], live: "t4" });
  frames.push({ entries: [...history, ...liveRun], settled: "t4" });
  for (let count = 1; count <= nextRun.length; count += 1) {
    frames.push({ entries: [...history, ...liveRun, ...nextRun.slice(0, count)], live: "t5" });
  }
  return frames;
}

/** A command running in the live run, then failing: the same call, a new entry. */
function failingCall(): Frame[] {
  const start = 4 * perfTurnSeconds(STEPS);
  const opener = liveRun[0]!;
  const call = tool("c-fails", "t4", 0, {
    command: "pnpm build",
    itemType: "command_execution",
    toolLifecycleStatus: "inProgress",
    createdAt: at(Math.floor((start + 4) / 60), (start + 4) % 60),
  });
  const placed = { ...call, createdAt: work(call).entry.createdAt };
  const failed = withEntry(placed, {
    toolLifecycleStatus: "failed",
    tone: "error",
    detail: "error: exited with exit code 2",
  });
  return [
    { entries: [...history, opener, placed], live: "t4" },
    { entries: [...history, opener, failed], live: "t4" },
    { entries: [...history, opener, failed], settled: "t4" },
  ];
}

/** A settled run's command, tracked by a task that reports long after. */
function laterTask(): Frame[] {
  const launch = tool("c-soak", "t1", 1, {
    label: "Command run",
    command: "./soak.sh",
    callInput: { description: "Run the soak test" },
    updatedAt: at(1, 1),
    sentToBackground: "job-soak",
    toolCallId: "call-soak",
  });
  const base = [user("m0", 0), launch, assistant("a1", "t1", 2, "It runs.")];
  const second = [user("m1", 10), assistant("a2", "t2", 11, "Still here.")];
  const report = withEntry(tool("soak-done", "t1", 30), {
    label: "Run the soak test",
    toolTitle: "Run the soak test",
    taskId: "job-soak",
    taskToolUseId: "call-soak",
    command: undefined as never,
    toolCallId: undefined as never,
    tone: "info",
    turnId: null,
    sourceActivityKind: "task.completed",
    detail: 'Background command "Run the soak test" completed (exit code 0)',
  });
  const running: LiveJobs = { ids: new Set(["job-soak"]) };
  const gone: LiveJobs = { ids: new Set() };
  return [
    { entries: base, settled: "t1", liveJobs: running },
    { entries: [...base, ...second], settled: "t2", liveJobs: running },
    { entries: [...base, ...second], settled: "t2", liveJobs: gone },
    { entries: [...base, ...second, report], settled: "t2", liveJobs: gone },
  ];
}

/** A call left open in a settled run, its completion filed under the next. */
function returnedElsewhere(): Frame[] {
  const open = tool("c-open", "t1", 1, {
    toolCallId: "call-shared",
    toolLifecycleStatus: "inProgress",
    sourceActivityKind: "tool.updated",
  });
  const base = [user("m0", 0), open, assistant("a1", "t1", 2, "Waiting.")];
  const done = tool("c-done", "t2", 6, { toolCallId: "call-shared" });
  return [
    { entries: base, settled: "t1" },
    { entries: [...base, user("m1", 5)], live: "t2" },
    { entries: [...base, user("m1", 5), done], live: "t2" },
    { entries: [...base, user("m1", 5), done, assistant("a2", "t2", 7, "Back.")], settled: "t2" },
  ];
}

/** A read of a saved output, the call that saved it named only later. */
function savedOutputNamedLater(): Frame[] {
  const read = tool("r-saved", "t1", 1, {
    label: "Read",
    command: undefined as never,
    toolName: "Read",
    itemType: "dynamic_tool_call",
    callInput: {
      filePath:
        "/home/zerops/.claude/projects/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tool-results/q7t2m4xke.txt",
    },
  });
  const base = [user("m0", 0), read, assistant("a1", "t1", 2, "Read it.")];
  const saver = tool("c-saver", "t2", 6, {
    command: "pnpm build",
    callInput: { description: "Build the app" },
    spilledTo: "q7t2m4xke",
  });
  return [
    { entries: base, settled: "t1" },
    { entries: [...base, user("m1", 5), saver], live: "t2" },
  ];
}

/** Helpers a run launched, finishing one by one and waking the next run. */
function helpersFinishing(): Frame[] {
  const launch = tool("l1", "t1", 2, {
    label: "List routes",
    toolTitle: "List routes",
    taskId: "task-routes",
    agentRole: "Explore",
    sourceActivityKind: "task.completed",
    tone: "info",
    agentSpawn: { workflowId: null, agentTaskIds: ["task-routes", "task-components"] },
  });
  const base = [
    user("m0", 0),
    reasoning("r1", "t1", 1),
    launch,
    assistant("a1", "t1", 4, "They report back."),
  ];
  const first: HelperFinish = {
    id: "task-routes",
    title: "List routes",
    finishedAt: at(6),
    failed: false,
  };
  const second: HelperFinish = {
    id: "task-components",
    title: "Count components",
    finishedAt: at(8),
    failed: true,
  };
  return [
    { entries: base, settled: "t1" },
    { entries: base, settled: "t1", helperFinishes: [first] },
    { entries: [...base, assistant("a2", "t2", 7, "One is back.")], settled: "t2" },
    {
      entries: [...base, assistant("a2", "t2", 7, "One is back.")],
      settled: "t2",
      helperFinishes: [first],
    },
    {
      entries: [...base, assistant("a2", "t2", 7, "One is back."), reasoning("r3", "t3", 9)],
      live: "t3",
      helperFinishes: [first, second],
    },
  ];
}

/** The same entries read again: the clock moving on, the server's jobs, a fresh array. */
function sameEntriesAgain(): Frame[] {
  const entries = [...history, ...liveRun.slice(0, 9)];
  const lastMs = Date.parse(entries.at(-1)!.createdAt);
  return [
    { entries, live: "t4", nowMs: lastMs },
    { entries: [...entries], live: "t4", nowMs: lastMs + 1000 },
    { entries: [...entries], live: "t4", nowMs: lastMs + 5000, liveJobs: { ids: new Set(["x"]) } },
    { entries: [...entries], live: "t4", nowMs: lastMs + 6000, liveJobs: { ids: new Set() } },
  ];
}

function pagingAndStructure(): Frame[] {
  const blank = reasoning("r-live", "t4", 101);
  if (blank.kind !== "message") throw new Error("thought missing");
  const entries = [
    ...history,
    user("u4", (4 * perfTurnSeconds(STEPS)) / 60, "Inspect"),
    { ...blank, message: { ...blank.message, text: " ", streaming: true } },
  ];
  const paging: EngineCardPaging = {
    pageRuns: { earlier: null, later: "t4" },
    counts: { calls: { command: 300 }, tools: {}, edited: 0 },
    hasWork: true,
    holdsLines: false,
    since: null,
    through: at(100),
    reading: null,
  };
  return [
    { entries, live: "t4", cardPaging: { t4: paging } },
    { entries, live: "t4", cardPaging: { t4: { ...paging, reading: "later" } } },
    { entries, live: "t4", cardPaging: { t4: { ...paging, holdsLines: true, through: at(101) } } },
    { entries, live: "t4", cardPaging: { t4: paging }, liveLines: new Map([["r-live", true]]) },
    { entries, live: "t4", cardPaging: { t4: paging }, isCompacting: true },
    {
      entries,
      live: "t4",
      cardPaging: { t4: { ...paging, counts: { ...paging.counts, calls: { command: 301 } } } },
    },
    { entries, live: "t4" },
  ];
}

describe("a conversation derived again as it changes", () => {
  it.each([
    { name: "account paging and structural slot inputs change", frames: pagingAndStructure() },
    { name: "a live run grows, settles, and the next begins", frames: growingRun() },
    { name: "a call fails mid-run", frames: failingCall() },
    { name: "a task tracks a settled run's command later", frames: laterTask() },
    { name: "a call left open returns in the next run", frames: returnedElsewhere() },
    { name: "a saved output's maker is named later", frames: savedOutputNamedLater() },
    { name: "helpers finish and wake the next run", frames: helpersFinishing() },
    { name: "the same entries, the clock and the jobs moving", frames: sameEntriesAgain() },
  ])("draws what a first derive draws: $name", ({ frames }) => {
    const cache = createMessagesTimelineRowsCache();
    for (const frame of frames) {
      expect(derive(frame, cache)).toStrictEqual(derive(frame));
    }
  });

  it("keeps every settled run's lines while the live run grows", () => {
    const cache = createMessagesTimelineRowsCache();
    const frames = [
      ...growingRun().filter((frame) => frame.live === "t4"),
      ...pagingAndStructure(),
    ];
    let previous: MessagesTimelineRow[] | null = null;
    for (const frame of frames) {
      const rows = derive(frame, cache);
      if (previous !== null) {
        const before = new Map(previous.map((row) => [row.id, row]));
        const settled = rows.filter((row) => row.kind === "record" && !row.live);
        expect(settled).toHaveLength(4);
        for (const row of settled) {
          const earlier = before.get(row.id);
          if (row.kind !== "record" || earlier?.kind !== "record") throw new Error(row.id);
          expect(row.chatItems).toBe(earlier.chatItems);
          expect(row.slot).toBe(earlier.slot);
          expect(row.items).toHaveLength(earlier.items.length);
          row.items.forEach((item, index) => expect(item).toBe(earlier.items[index]));
        }
      }
      previous = rows;
    }
  });

  it("hands the list the same rows for every settled run while the live run grows", () => {
    const cache = createMessagesTimelineRowsCache();
    const frames = [
      ...growingRun().filter((frame) => frame.live === "t4"),
      ...pagingAndStructure(),
    ];
    let state: StableMessagesTimelineRowsState = { byId: new Map(), result: [] };
    for (const frame of frames) {
      const previous = state.result;
      state = computeStableMessagesTimelineRows(derive(frame, cache), state);
      const liveAt = state.result.findIndex((row) => row.id === "u4");
      expect(liveAt).toBeGreaterThan(0);
      if (previous.length === 0) continue;
      state.result.slice(0, liveAt).forEach((row, index) => expect(row).toBe(previous[index]));
    }
  });
});
