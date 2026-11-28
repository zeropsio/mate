import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { expect, it } from "vite-plus/test";

import {
  boardOf,
  compactPredicted,
  compactRows,
  LANES,
  rowLead,
  rowMeta,
} from "./projectAutomation/taskBoard.logic.ts";

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
it("MN+1: The Board draws Waiting for you first, then In progress, Up for review, Queued and Done; breaks: what waits for the reader sits under the queue, scrolled past", () => {
  expect(LANES.map((lane) => lane.id)).toEqual(["waiting", "progress", "review", "queued", "done"]);
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts | const COMPACT_LANES: ReadonlyArray<Lane> = ["waiting", "review", "progress"]; → const COMPACT_LANES: ReadonlyArray<Lane> = ["progress", "review", "waiting"];
it("MN+2: The project page's Board shows what waits for the reader, then what waits for their review, then what is under way, at most six rows and never a queued or ended task, and holds as many rows while the Board reads; breaks: a question to the reader falls off the project page behind work under way, or the page grows by the whole Board", () => {
  const { lanes, ...board } = boardOf(
    [
      ...["1", "2", "3", "4", "5"].map((id) => task({ id, state: "working", mate: sol })),
      task({ id: "w", state: "waiting", mate: sol, detail: "Paid at checkout?" }),
      task({ id: "r", state: "done", mate: sol, change: { repo: "shop", number: 4 } }),
      task({ id: "q", state: "queued", position: 1 }),
      task({ id: "d", state: "merged", mate: sol, endedAt: "2026-11-27T11:00:00Z" }),
    ],
    NOW,
    { appId: "shop" },
  );
  expect({
    shown: compactRows({ lanes, ...board }).map((row) => row.id),
    predicted: compactPredicted({ queued: 3, progress: 4, waiting: 2, review: 1, done: 5 }),
  }).toEqual({ shown: ["w", "r", "1", "2", "3", "4"], predicted: 6 });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   if (holder?.kind === "pool" && row.lane !== "queued") →   if (holder?.kind === "pool")
it("MN+3: A row leads with who has the task wearing its state — a pool Mate at work, asking or at rest, a person — and, where nobody has it now, the task's own mark: queued, waiting for others, done, failed, stopped or closed; breaks: an ended task wears its Mate's face and its failure cannot be told from a merge at a glance, or a task back in the queue still shows the Mate that dropped it", () => {
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
    return [
      row.id,
      said.kind === "mate" ? said.state : said.kind === "glyph" ? said.glyph : said.name,
    ];
  };
  expect(LANES.flatMap((lane) => lanes[lane.id].map(lead))).toEqual([
    ["ask", "needs"],
    ["work", "working"],
    ["took", "Ivo"],
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
it("MN+4: The line under a row's title says, in place of the rest, what its Mate asks and of whom, which need broke, what it waits for, why it failed, or that it waits for review with its change; else where it came from, who has it and for how long, and its cost, an ended task saying how it ended and its change first; breaks: a question to the reader is hidden behind where the task came from, or a failure reads like any other ended task", () => {
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
    const said = rowMeta(row, IDLE, "Sol");
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
    working: ["origin", "words", "words"],
    merged: ["words", "change", "words", "words"],
  });
});

// witness: apps/web/src/components/zerops/projectAutomation/taskBoard.logic.ts |   return [...events].sort((a, b) => a.ms - b.ms).map(({ event }) => event); →   return events.map(({ event }) => event);
it("MN+5: A task's history says where it came from, who took it or which Mate it was handed to, and how it ended, oldest first, each by when it happened; breaks: the panel tells a task's story out of order, or says it ended before it was taken", () => {
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
