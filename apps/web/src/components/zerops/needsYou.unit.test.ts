import { ThreadId, TurnId } from "@t3tools/contracts";
import type { CrewDigest } from "@t3tools/shared/mateLink";
import { expect, it } from "vite-plus/test";

import { needsYou, type NeedsYouActivity, type NeedsYouMate } from "../../zerops/waiting.logic.ts";

const DAY = Date.parse("2026-11-27T00:00:00Z");

const asking: NeedsYouActivity = {
  threadId: ThreadId.make("t-fen"),
  kind: "input",
  face: "needs",
  snippet: undefined,
  pausedUntil: undefined,
  question: "Stripe or Adyen?",
};

const crew = (over: Partial<CrewDigest>): CrewDigest => ({
  crewmates: [
    {
      handle: "fable",
      displayName: "Fable",
      tint: "violet",
      lead: true,
      threadId: null,
      threadKind: "working",
      loginKey: null,
    },
    {
      handle: "sol",
      displayName: "Sol",
      tint: "sky",
      lead: false,
      threadId: null,
      threadKind: "idle",
      loginKey: null,
    },
  ],
  attention: [],
  readyTasks: [],
  personLands: true,
  ...over,
});

const mate = (over: Partial<NeedsYouMate>): NeedsYouMate => ({
  projectId: "fen",
  name: "Fen",
  tint: "coral",
  shape: "gem",
  connected: true,
  mine: true,
  activity: undefined,
  reviewCount: 0,
  ...over,
});

const keysOf = (mates: ReadonlyArray<NeedsYouMate>) =>
  needsYou({ mates, order: [], releases: [], dayStart: DAY }).items.map((item) => item.key);

// witness: apps/web/src/zerops/waiting.logic.ts | if (crew === undefined || !crew.current || !mate.mine) return []; → if (crew === undefined || !crew.current) return [];
it("MN119: A crewmate's question on the viewer's own Mate stands as its own item beside the Mate's own question, and a colleague's Mate's crew asks nothing of the viewer; breaks: the person never hears their crew is blocked, or is asked to answer for a colleague's crew", () => {
  const blocked = crew({ attention: [{ id: "a1", kind: "question", handle: "fable" }] });
  const reviewable = () => true;
  expect(
    keysOf([
      mate({ activity: asking, crew: { digest: blocked, current: true, reviewable } }),
      mate({
        projectId: "ada",
        name: "Ada",
        mine: false,
        crew: { digest: blocked, current: true, reviewable },
      }),
    ]),
  ).toEqual(["m:fen", "c:fen:r:a1"]);
});

// witness: apps/web/src/zerops/waiting.logic.ts | const ready = crew.digest.personLands ? crew.digest.readyTasks : []; → const ready = crew.digest.readyTasks;
it("MN120: Finished crew work waits on the viewer once per task, only where the viewer adds it to the Mate's code themselves and may review it, and never again as the crew's ready row; breaks: the person is asked to add work the crew adds itself, or the same work twice", () => {
  const ready = {
    attention: [{ id: "a2", kind: "ready-to-land", handle: "sol" }],
    readyTasks: [
      { id: "t1", owner: "sol" },
      { id: "t2", owner: "sol" },
    ],
  };
  const reviewable = (taskId: string) => taskId === "t1";
  expect(
    keysOf([
      mate({ crew: { digest: crew(ready), current: true, reviewable } }),
      mate({
        projectId: "ada",
        name: "Ada",
        crew: { digest: crew({ ...ready, personLands: false }), current: true, reviewable },
      }),
    ]),
  ).toEqual(["c:fen:t:t1"]);
});

// witness: apps/web/src/zerops/waiting.logic.ts | wait === undefined && → true &&
it("MN121: An automated Mate's task waiting for an answer waits on the viewer only while the Mate's conversation says nothing of its own; breaks: the one question is counted twice", () => {
  const task = { id: "k1", title: "Fix the invoice total", url: null, waiting: true as const };
  expect(
    keysOf([mate({ task }), mate({ projectId: "ada", name: "Ada", activity: asking, task })]),
  ).toEqual(["t:fen:k1", "m:ada"]);
});

// witness: apps/web/src/zerops/waiting.logic.ts | const finishedToday = (at: string) => Date.parse(at) >= input.dayStart; → const finishedToday = (at: string) => Date.parse(at) >= 0;
it("MN122: Running counts the working chats of the viewer's own Mates while their word is of now, and their working crewmates; done today counts the turns they finished since the day began; breaks: yesterday's work or a colleague's is counted as the person's today", () => {
  const results = [
    { completedAt: "2026-11-27T08:00:00Z" },
    { completedAt: "2026-11-26T23:00:00Z" },
  ];
  const { counts } = needsYou({
    mates: [
      mate({
        attention: { live: true, working: 2, results },
        crew: { digest: crew({}), current: true, reviewable: () => true },
      }),
      mate({ projectId: "ada", attention: { live: false, working: 3, results: [] } }),
      mate({ projectId: "bo", mine: false, attention: { live: true, working: 4, results } }),
    ],
    order: [],
    releases: [],
    dayStart: DAY,
  });
  expect(counts).toEqual({ running: 3, doneToday: 1 });
});

const POOL_TASK = {
  id: "task-9",
  title: "Cache the menu",
  url: null,
  waiting: true,
  askedAt: "2026-11-27T09:00:00Z",
  putBy: "ana",
} as const;

// witness: apps/web/src/zerops/waiting.logic.ts | (mate.mine || (input.viewer !== undefined && task.putBy === input.viewer)) → mate.mine
it("MN127: A task the viewer put on the Board that a colleague's automated Mate holds waits on the viewer while it asks, and on nobody else who did not put it; breaks: the person who put the task never hears its question", () => {
  const pool = mate({ projectId: "pool-1", name: "Pool", mine: false, task: POOL_TASK });
  const keysFor = (viewer: string) =>
    needsYou({ mates: [pool], order: [], releases: [], dayStart: DAY, viewer }).items.map(
      (item) => item.key,
    );
  expect({ ana: keysFor("ana"), ben: keysFor("ben") }).toEqual({
    ana: ["t:pool-1:task-9"],
    ben: [],
  });
});

// witness: apps/web/src/zerops/waiting.logic.ts | return snooze === null || aside.get(snooze.item) !== snooze.revision; → return snooze === null || !aside.has(snooze.item);
it("MN128: What the viewer set aside stays out of Needs you while its revision is the one set aside, and comes back once it changes; breaks: a new question on a set-aside task stays hidden, or a snooze hides nothing", () => {
  const pool = (askedAt: string) =>
    mate({ projectId: "pool-1", name: "Pool", mine: false, task: { ...POOL_TASK, askedAt } });
  const snoozes = [{ item: "task:task-9", revision: "2026-11-27T09:00:00Z" }];
  const keysWhen = (askedAt: string) =>
    needsYou({
      mates: [pool(askedAt)],
      order: [],
      releases: [],
      dayStart: DAY,
      viewer: "ana",
      snoozes,
    }).items.map((item) => item.key);
  expect({
    same: keysWhen("2026-11-27T09:00:00Z"),
    askedAgain: keysWhen("2026-11-27T11:30:00Z"),
  }).toEqual({ same: [], askedAgain: ["t:pool-1:task-9"] });
});

// witness: apps/web/src/zerops/waiting.logic.ts | : { item: `${who}:chat`, revision: need.turnId }; → : null;
it("MN142: A crewmate whose chat asks the viewer, set aside, stays out of Needs you while its chat's turn is the one set aside and comes back with a new turn, and one whose Mate names no turn cannot be set aside; breaks: a crewmate's question can never be set aside, or a new question in its chat stays hidden", () => {
  const asks = (turnId: string | undefined): CrewDigest =>
    crew({
      crewmates: [
        {
          handle: "sol",
          displayName: "Sol",
          tint: "sky",
          lead: false,
          threadId: ThreadId.make("t-sol"),
          threadKind: "input",
          loginKey: null,
          ...(turnId === undefined ? {} : { turnId: TurnId.make(turnId) }),
        },
      ],
    });
  const keysWhen = (turnId: string | undefined) =>
    needsYou({
      mates: [mate({ crew: { digest: asks(turnId), current: true, reviewable: () => true } })],
      order: [],
      releases: [],
      dayStart: DAY,
      snoozes: [{ item: "ask:fen:sol:chat", revision: "turn-1" }],
    }).items.map((item) => item.key);
  expect({
    same: keysWhen("turn-1"),
    askedAgain: keysWhen("turn-2"),
    olderMate: keysWhen(undefined),
  }).toEqual({ same: [], askedAgain: ["c:fen:h:sol"], olderMate: ["c:fen:h:sol"] });
});

const ASKED = (taskId: string, at: string) => ({
  appId: "shop",
  appName: "Shop",
  taskId,
  title: `Task ${taskId}`,
  at,
});

// witness: apps/web/src/zerops/waiting.logic.ts | if (!carried.has(board.taskId)) → if (!carried.has(board.appId))
it("MN+1: A task the viewer put whose automated Mate asks them, as HQ says it, stands in Needs you though no Mate row of theirs carries it, and one a Mate row carries is said once, by that row; breaks: the person never hears a question from a Mate outside their list, or hears one question twice", () => {
  const pool = mate({ projectId: "pool-1", name: "Pool", mine: false, task: POOL_TASK });
  expect(
    needsYou({
      mates: [pool],
      order: [],
      releases: [{ groupId: "shop", name: "Shop", ahead: 2 }],
      dayStart: DAY,
      viewer: "ana",
      asked: [ASKED("task-9", "2026-11-27T09:00:00Z"), ASKED("task-7", "2026-11-27T08:00:00Z")],
    }).items.map((item) => item.key),
  ).toEqual(["t:pool-1:task-9", "a:shop:task-7", "r:shop"]);
});

// witness: apps/web/src/zerops/waiting.logic.ts | return { item: `task:${item.board.taskId}`, revision: item.board.at }; → return { item: `asked:${item.board.taskId}`, revision: item.board.at };
it("MN+2: A task asking the viewer that only HQ says is set aside under the task's own key, so a snooze made where its Mate's row said it holds it too, until the Mate asks again; breaks: a question the person set aside comes back the moment its Mate leaves their list", () => {
  const keysWhen = (at: string) =>
    needsYou({
      mates: [],
      order: [],
      releases: [],
      dayStart: DAY,
      viewer: "ana",
      asked: [ASKED("task-9", at)],
      snoozes: [{ item: "task:task-9", revision: "2026-11-27T09:00:00Z" }],
    }).items.map((item) => item.key);
  expect({
    same: keysWhen("2026-11-27T09:00:00Z"),
    askedAgain: keysWhen("2026-11-27T11:30:00Z"),
  }).toEqual({ same: [], askedAgain: ["a:shop:task-9"] });
});

// witness: apps/web/src/zerops/waiting.logic.ts | return { item: `held:${item.board.taskId}`, revision: item.board.at }; → return null;
it("MN+3: A held task the viewer put whose need broke stands in Needs you, set aside it stays out while its need's break is the one set aside, and comes back when a need breaks again; breaks: a broken task can never be set aside, or a new break stays hidden", () => {
  const keysWhen = (at: string) =>
    needsYou({
      mates: [],
      order: [],
      releases: [],
      dayStart: DAY,
      viewer: "ana",
      broken: [ASKED("task-4", at)],
      snoozes: [{ item: "held:task-4", revision: "2026-11-27T09:00:00Z" }],
    }).items.map((item) => item.key);
  expect({
    same: keysWhen("2026-11-27T09:00:00Z"),
    brokeAgain: keysWhen("2026-11-27T12:00:00Z"),
  }).toEqual({ same: [], brokeAgain: ["b:shop:task-4"] });
});
