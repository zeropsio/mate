import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { expect, it } from "vite-plus/test";

import {
  activeTask,
  boardOf,
  boardWaitingCount,
  compactBoard,
  openCount,
  compactPredicted,
  compactRows,
  LANES,
  rowLead,
  rowMeta,
} from "./projectAutomation/taskBoard.logic.ts";
import { taskOfChange } from "./projectAutomation/changeTask.logic.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

const task = (patch: Partial<HqAppTask> & Pick<HqAppTask, "id" | "state">): HqAppTask => ({
  title: `Task ${patch.id}`,
  label: "a conversation",
  url: null,
  mate: null,
  requestedBy: null,
  createdAt: "2026-11-20T12:00:00Z",
  startedAt: null,
  endedAt: null,
  spentUsd: 4.2,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: null,
  ...patch,
});

// Rhea put two tasks from her Moss's chat; Ivo took one for his Fern, his Fern linked a change to
// the other. Mara reads the Board; her list holds Moss, not Ivo's Fern.
const put = {
  kind: "conversation" as const,
  putBy: "u-rhea",
  mateProjectId: "p-moss",
  conversationId: "c-moss",
  title: "From Moss",
};
const ivo = { kind: "person" as const, userId: "u-ivo", mateProjectId: "p-fern" };
const taken = task({
  id: "1",
  state: "taken",
  source: put,
  taker: ivo,
  takenAt: "2026-11-27T10:00:00Z",
});
const linked = task({
  id: "2",
  state: "taken",
  source: { ...put, mateProjectId: "p-fern", conversationId: "c-fern" },
  taker: ivo,
  takenAt: "2026-11-26T12:00:00Z",
  changes: [{ repo: "shop", number: 7 }],
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | lane === "queued" || holder?.kind === "person" → lane === "queued"
it("MN129: A task a person took stands In progress under their name and their Mate, Up for review once their Mate linked a change, and never with the organization's cost; one put from a chat names who put it, and leads back to that chat only for a reader whose list holds its Mate; breaks: a person's own work is billed to the organization on the Board, or a reader is sent into a Mate they cannot open", () => {
  const { lanes } = boardOf([taken, linked], NOW, {
    appId: "shop",
    viewerId: "u-mara",
    personName: (userId) => ({ "u-rhea": "Rhea", "u-ivo": "Ivo" })[userId],
    mateName: (projectId) => (projectId === "p-moss" ? "Moss" : undefined),
  });
  const shown = (rows: typeof lanes.progress) =>
    rows.map((row) => ({
      id: row.id,
      state: row.state,
      who: row.who,
      cost: row.cost,
      origin: row.origin.words,
      back: row.origin.conversation,
    }));
  expect(shown(lanes.progress)).toEqual([
    {
      id: "1",
      state: "Taken by Ivo",
      who: "2h",
      cost: "",
      origin: "Put on board by Rhea",
      back: { mateProjectId: "p-moss", conversationId: "c-moss" },
    },
  ]);
  expect(shown(lanes.review)).toEqual([
    {
      id: "2",
      state: "Taken by Ivo",
      who: "1d",
      cost: "",
      origin: "Put on board by Rhea",
      back: null,
    },
  ]);
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | const lane = broken.length > 0 ? "waiting" : laneOf(status); → const lane = laneOf(status);
it("MN136: A task that waits for others stands in Queued after the tasks the queue hands out, saying what it waits for; one whose need broke stands in Waiting for you on the person who put it; one whose needs were met is queued like any other; and a task others wait for says how many; breaks: a task stuck on a failed need sits quietly in the queue forever, or a held task looks next in line", () => {
  const plan = { ...put, putBy: "u-mara" };
  const { lanes } = boardOf(
    [
      task({ id: "a", state: "working", title: "Model cards", source: plan }),
      task({ id: "s", state: "stopped", title: "Store balances" }),
      task({
        id: "b",
        state: "held",
        title: "Sell cards",
        source: plan,
        needs: [{ taskId: "a", state: "waiting" }],
      }),
      task({
        id: "c",
        state: "held",
        title: "Redeem cards",
        source: plan,
        needs: [
          { taskId: "a", state: "waiting" },
          { taskId: "s", state: "broken" },
        ],
      }),
      task({
        id: "d",
        state: "queued",
        position: 1,
        title: "Filter",
        needs: [{ taskId: "x", state: "met" }],
      }),
    ],
    NOW,
    { appId: "shop", viewerId: "u-mara" },
  );
  const ids = (rows: typeof lanes.queued) => rows.map((row) => row.id);
  expect({
    queued: ids(lanes.queued),
    waiting: lanes.waiting.map((row) => [row.id, row.state, row.broken.map((need) => need.taskId)]),
    held: lanes.queued.find((row) => row.id === "b")?.needs.map((need) => need.title),
    waiters: lanes.progress.map((row) => [row.id, row.waiters.map((waiter) => waiter.taskId)]),
  }).toEqual({
    queued: ["d", "b"],
    waiting: [["c", "Waits on you", ["s"]]],
    held: ["Model cards"],
    waiters: [["a", ["b", "c"]]],
  });
});

const IDLE = { kind: "idle" } as const;
const sol = { projectId: "p-sol", name: "Sol" };

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   { id: "waiting", name: "Waiting for you" }, →   { id: "queued", name: "Waiting for you" },
it("MN146: The Board draws Waiting for you first, then In progress, Up for review, Queued and Done; breaks: what waits for the reader sits under the queue, scrolled past", () => {
  expect(LANES.map((lane) => lane.id)).toEqual(["waiting", "progress", "review", "queued", "done"]);
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | const COMPACT_LANES: ReadonlyArray<Lane> = ["waiting", "review"]; → const COMPACT_LANES: ReadonlyArray<Lane> = ["review", "waiting"];
it("MN147: The project page's Board shows what waits for the reader, then what waits for their review, at most six rows and never a task under way, queued or ended, and holds as many rows while the Board reads; breaks: a question to the reader falls off the project page behind another's review, or the page grows by the whole Board", () => {
  const { lanes, ...board } = boardOf(
    [
      task({ id: "r1", state: "done", mate: sol, change: { repo: "shop", number: 4 } }),
      task({ id: "r2", state: "done", mate: sol, change: { repo: "shop", number: 5 } }),
      ...["w1", "w2", "w3", "w4", "w5"].map((id) => task({ id, state: "waiting", mate: sol })),
      task({ id: "p", state: "working", mate: sol }),
      task({ id: "q", state: "queued", position: 1 }),
      task({ id: "d", state: "merged", mate: sol, endedAt: "2026-11-27T11:00:00Z" }),
    ],
    NOW,
    { appId: "shop" },
  );
  expect({
    shown: compactRows({ lanes, ...board }).map((row) => row.id),
    predicted: compactPredicted({ queued: 3, progress: 4, waiting: 2, review: 1, done: 5 }),
  }).toEqual({ shown: ["w1", "w2", "w3", "w4", "w5", "r1"], predicted: 3 });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   if (holder !== null && row.lane !== "queued") →   if (holder?.kind === "pool" && row.lane !== "queued")
it("MN148: A row leads with the Mate that has the task wearing its state — a pool Mate or the Mate a person took it into, at work, asking or at rest, never the person — and, where no Mate has it now, the task's own mark: queued, waiting for others, done, failed, stopped or closed; breaks: a person's Mate's work wears the person's face, an ended task wears its Mate's face and its failure cannot be told from a merge at a glance, or a task back in the queue still shows the Mate that dropped it", () => {
  const { lanes } = boardOf(
    [
      task({ id: "work", state: "working", mate: sol }),
      task({ id: "ask", state: "waiting", mate: sol }),
      task({ id: "rev", state: "done", mate: sol, change: { repo: "shop", number: 4 } }),
      task({
        id: "took",
        state: "taken",
        taker: { kind: "person", userId: "u-ivo", mateProjectId: "p-fern" },
      }),
      task({ id: "q", state: "queued", position: 1, mate: sol }),
      task({ id: "h", state: "held", needs: [{ taskId: "work", state: "waiting" }] }),
      ...(["merged", "done", "failed", "stopped", "closed"] as const).map((state) =>
        task({ id: state, state, mate: sol, endedAt: "2026-11-27T11:00:00Z" }),
      ),
    ],
    NOW,
    { appId: "shop", personName: (userId) => (userId === "u-ivo" ? "Ivo" : undefined) },
  );
  const lead = (row: (typeof lanes.done)[number]) => {
    const said = rowLead(row);
    return [row.id, said.kind === "mate" ? said.state : said.glyph];
  };
  expect(LANES.flatMap((lane) => lanes[lane.id].map(lead))).toEqual([
    ["ask", "needs"],
    ["work", "working"],
    ["took", "working"],
    ["rev", "idle"],
    ["q", "queued"],
    ["h", "held"],
    ["merged", "done"],
    ["done", "done"],
    ["failed", "failed"],
    ["stopped", "stopped"],
    ["closed", "closed"],
  ]);
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   if (row.lane === "waiting") { →   if (row.lane === "waiting" && row.question === null) {
it("MN149: The line under a row's title says, in place of the rest, what its Mate asks and of whom, which need broke, what it waits for, why it failed, or that it waits for review with its change where no lane's heading says so, else its change, who has it and its cost; else where it came from, who has it and for how long, and its cost, an ended task saying how it ended and its change first; breaks: a question to the reader is hidden behind where the task came from, a failure reads like any other ended task, or a row under Up for review says so a second time", () => {
  const { lanes } = boardOf(
    [
      task({ id: "a", state: "waiting", mate: sol, detail: "Paid at checkout?", source: put }),
      task({ id: "s", state: "stopped", title: "Store balances" }),
      task({
        id: "h",
        state: "held",
        needs: [
          { taskId: "a", state: "waiting" },
          { taskId: "w", state: "waiting" },
        ],
      }),
      task({ id: "b", state: "held", needs: [{ taskId: "s", state: "broken" }] }),
      task({ id: "w", state: "working", mate: sol, workedMs: 12 * 60_000 }),
      task({
        id: "f",
        state: "failed",
        mate: sol,
        detail: "No catalogue file.",
        endedAt: "2026-11-27T11:00:00Z",
      }),
      task({ id: "r", state: "done", mate: sol, change: { repo: "shop", number: 4 } }),
      task({
        id: "m",
        state: "merged",
        mate: sol,
        endedAt: "2026-11-27T11:00:00Z",
        change: { repo: "shop", number: 5 },
      }),
    ],
    NOW,
    { appId: "shop", viewerId: "u-mara", personName: (userId) => ({ "u-rhea": "Rhea" })[userId] },
  );
  const all = LANES.flatMap((lane) => lanes[lane.id]);
  const meta = (id: string) => {
    const row = all.find((each) => each.id === id);
    if (row === undefined) return null;
    const said = rowMeta(row, IDLE, "Sol", false);
    return {
      tone: said.tone,
      kinds: said.parts.map((part) => part.kind),
      words: said.parts.map((part) => (part.kind === "words" ? part.words : "")).join(" "),
    };
  };
  expect({
    asks: meta("a")?.tone,
    asksKinds: meta("a")?.kinds,
    asksWhomWhat: ["Rhea", "Paid at checkout?"].every((said) => meta("a")?.words.includes(said)),
    broken: meta("b")?.tone,
    brokenNames: meta("b")?.words.includes("Store balances"),
    held: meta("h")?.words.includes("Task a"),
    failed: meta("f")?.tone,
    failedWhy: meta("f")?.words.includes("No catalogue file."),
    review: meta("r")?.kinds,
    reviewInLane: (() => {
      const row = all.find((each) => each.id === "r");
      return row === undefined
        ? null
        : rowMeta(row, IDLE, "Sol", true).parts.map((part) => part.kind);
    })(),
    working: meta("w")?.kinds,
    merged: meta("m")?.kinds,
  }).toEqual({
    asks: "attention",
    asksKinds: ["words"],
    asksWhomWhat: true,
    broken: "attention",
    brokenNames: true,
    held: true,
    failed: "failed",
    failedWhy: true,
    review: ["words", "change"],
    reviewInLane: ["change", "words", "words"],
    working: ["origin", "words", "words"],
    merged: ["words", "change", "words", "words"],
  });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   return [...events].sort((a, b) => a.ms - b.ms).map(({ event }) => event); →   return events.map(({ event }) => event);
it("MN150: A task's history says where it came from, who took it or which Mate it was handed to, and how it ended, oldest first, each by when it happened; breaks: the panel tells a task's story out of order, or says it ended before it was taken", () => {
  const { lanes } = boardOf(
    [
      task({
        id: "1",
        state: "merged",
        mate: sol,
        createdAt: "2026-11-27T09:00:00Z",
        startedAt: "2026-11-27T09:10:00Z",
        endedAt: "2026-11-27T11:00:00Z",
        change: { repo: "shop", number: 5 },
      }),
      task({
        id: "2",
        state: "taken",
        source: put,
        createdAt: "2026-11-27T11:00:00Z",
        taker: ivo,
        takenAt: "2026-11-26T12:00:00Z",
      }),
    ],
    NOW,
    { appId: "shop" },
  );
  expect({
    merged: lanes.done[0]?.history.map((event) => event.kind),
    taken: lanes.progress[0]?.history.map((event) => event.kind),
  }).toEqual({
    merged: ["put", "handed", "ended"],
    taken: ["taken", "put"],
  });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   for (const event of task.history ?? []) { →   for (const event of []) {
it("MN154: A task's history also says when its needs were met, each question its Mate asked with the question, and each time its putter answered, by who and never what, in order with the rest; breaks: the panel shows an answer without the question it answered, or hides that a held task went in line", () => {
  const { lanes } = boardOf(
    [
      task({
        id: "1",
        state: "working",
        mate: sol,
        source: put,
        createdAt: "2026-11-27T09:00:00Z",
        startedAt: "2026-11-27T09:20:00Z",
        history: [
          { kind: "ready", at: "2026-11-27T09:10:00.000Z" },
          { kind: "asked", at: "2026-11-27T09:30:00.000Z", question: "Weekly or all-time?" },
          { kind: "answered", at: "2026-11-27T09:40:00.000Z" },
        ],
      }),
    ],
    NOW,
    { appId: "shop", viewerId: "u-rhea" },
  );
  expect(lanes.progress[0]?.history.map((event) => event.words)).toEqual([
    "Put on board by you",
    "Its needs were met",
    "Handed to Sol",
    "Sol asked: Weekly or all-time?",
    "You answered",
  ]);
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |     (count, lane) => (lane.id === "done" ? count : count + board.lanes[lane.id].length), →     (count, lane) => count + board.lanes[lane.id].length,
it("MN151: The Board's page counts its open tasks beside its title, every lane's but Done's, and none where none is open; breaks: a Board of finished work reads as work outstanding", () => {
  const ended = (id: string) =>
    task({ id, state: "merged", mate: sol, endedAt: "2026-11-27T11:00:00Z" });
  const of = (tasks: ReadonlyArray<HqAppTask>) => openCount(boardOf(tasks, NOW, { appId: "shop" }));
  expect({
    some: of([task({ id: "q", state: "queued", position: 1 }), ended("1"), ended("2"), ended("3")]),
    none: of([ended("1"), ended("2")]),
  }).toEqual({ some: 1, none: 0 });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |     return { rows, quiet: "no-tasks", totals: null }; →     return { rows, quiet: "no-tasks", totals: boardTotals(board) };
it("MN152: The project page's Board always ends in the way to the Board's page: with no task it says the Board is empty and carries no totals, with tasks none of which waits on the reader it says nothing waits and carries the rest's totals, and with rows it says neither; breaks: an empty Board ends in a blank band, or a count of nothing", () => {
  const of = (tasks: ReadonlyArray<HqAppTask>) => {
    const shown = compactBoard(boardOf(tasks, NOW, { appId: "shop" }));
    return [shown.rows.length, shown.quiet, shown.totals !== null];
  };
  expect({
    empty: of([]),
    calm: of([task({ id: "q", state: "queued", position: 1 })]),
    asking: of([task({ id: "w", state: "waiting", mate: sol })]),
  }).toEqual({
    empty: [0, "no-tasks", false],
    calm: [0, "nothing-waits", true],
    asking: [1, null, true],
  });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   const at = [cursor, selected].find((id): id is string => id !== null && shown.includes(id)); →   const at = [selected, cursor].find((id): id is string => id !== null && shown.includes(id));
it("MN153: The Board's keyboard stands on the row it was moved to last, else the task open in its panel, else the first row, and moves one row at a time, held at the list's ends; breaks: Enter reopens a task the reader moved away from, or the keys do nothing until a row is clicked", () => {
  const shown = ["a", "b", "c"];
  expect({
    fresh: activeTask(shown, null, null),
    opened: activeTask(shown, null, "b"),
    moved: activeTask(shown, "c", "b"),
    gone: activeTask(shown, "x", "b"),
    down: activeTask(shown, "b", null, 1),
    top: activeTask(shown, null, null, -1),
    bottom: activeTask(shown, "c", null, 1),
  }).toEqual({ fresh: "a", opened: "b", moved: "c", gone: "b", down: "c", top: "a", bottom: "c" });
});

// witness: apps/web/src/components/zerops/projectAutomation/changeTask.logic.ts |     link !== null && link.repo === change.repo && link.number === change.number; →     link !== null && link.number === change.number;
it("MN155: A change's review names the Board task it does: the task whose own change it is or whose taker's Mate linked it, by repository and number, the latest put where several do, and none where no task links it; breaks: a change reads as another repository's task, or as none it was made for", () => {
  const own = task({ id: "own", state: "merged", change: { repo: "shop", number: 3 } });
  const older = task({
    id: "older",
    state: "taken",
    createdAt: "2026-11-19T12:00:00Z",
    changes: [{ repo: "shop", number: 9 }],
  });
  const newer = task({
    id: "newer",
    state: "taken",
    createdAt: "2026-11-21T12:00:00Z",
    changes: [
      { repo: "shop", number: 8 },
      { repo: "shop", number: 9 },
    ],
  });
  const tasks = [own, linked, newer, older];
  const of = (repo: string, number: number) => taskOfChange(tasks, { repo, number })?.id ?? null;
  expect({
    own: of("shop", 3),
    linked: of("shop", 7),
    several: of("shop", 9),
    otherRepo: of("site", 7),
    none: of("shop", 12),
    unread: taskOfChange(null, { repo: "shop", number: 7 }),
  }).toEqual({
    own: "own",
    linked: "2",
    several: "newer",
    otherRepo: null,
    none: null,
    unread: null,
  });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | if (laneOf(liveStatus(task, live.get(task.id))) === "waiting") count += 1; → if (laneOf(liveStatus(task, live.get(task.id))) !== "done") count += 1;
it("MN+1: The Board's door counts only the tasks Waiting for the reader, never one queued, held for others or at work; breaks: the project page says Board 5 for five queued tasks nobody needs to act on", () => {
  const tasks = [
    task({ id: "q1", state: "queued" }),
    task({ id: "q2", state: "queued" }),
    task({ id: "h", state: "held" }),
    task({ id: "w", state: "working" }),
    task({ id: "a", state: "waiting" }),
    taken,
  ];
  expect(boardWaitingCount(tasks, new Map())).toBe(1);
});
