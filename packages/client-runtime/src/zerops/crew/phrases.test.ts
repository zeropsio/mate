import { CrewAttentionKind, CrewRefusalReason, CrewTaskState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./testing/fixtures.ts";
import {
  CREW_BOARD_COLUMNS,
  crewAttentionSentence,
  crewBoardColumn,
  crewPersonLands,
  crewRefusalSentence,
  crewRunMeters,
  crewStateWord,
  crewTaskWord,
} from "./phrases.ts";

const crew = crewSnapshotFixture();
const tasks = crew.board.tasks;
const taskOf = (id: string) => tasks.find((task) => task.id === id)!;
const working = taskOf("task-12");
const run = crew.run!;

describe("CREW_BOARD_COLUMNS", () => {
  it("titles the board's columns in PRD §4.4's order", () => {
    expect(CREW_BOARD_COLUMNS.map((column) => column.title)).toEqual([
      "Waiting on you",
      "Working",
      "In review",
      "Queued",
      "Landed",
    ]);
  });
});

describe("crewBoardColumn", () => {
  it.each([
    ["proposed", "waiting-on-you"],
    ["queued", "queued"],
    ["working", "working"],
    ["rework", "working"],
    ["blocked", "waiting-on-you"],
    ["merging", "working"],
    ["checking", "working"],
    ["review", "in-review"],
    ["landing", "working"],
    ["waiting-on-you", "waiting-on-you"],
    ["landed", "landed"],
    ["parked", "waiting-on-you"],
    ["discarded", null],
  ] as const)("puts %s in %s", (state, column) => {
    expect(crewBoardColumn(state, true)).toBe(column);
    expect(crewBoardColumn(state, false)).toBe(column);
  });

  it("puts a ready task on you when you land, in review when the run lands it", () => {
    expect(crewBoardColumn("ready", true)).toBe("waiting-on-you");
    expect(crewBoardColumn("ready", false)).toBe("in-review");
  });

  it("gives every state but discarded a column", () => {
    const columns = new Set(CREW_BOARD_COLUMNS.map((column) => column.id));
    const placed = CrewTaskState.literals.filter((state) => {
      const column = crewBoardColumn(state, true);
      return column !== null && columns.has(column);
    });
    expect(placed).toEqual(CrewTaskState.literals.filter((state) => state !== "discarded"));
  });
});

describe("crewTaskWord", () => {
  const context = { tasks, hasLead: true, threadStatusWord: "Connecting" };

  it.each([
    ["proposed", {}, "Proposed"],
    ["queued", {}, "Queued"],
    [
      "rework",
      { reason: "the check fails on /api/items" },
      "Rework: the check fails on /api/items",
    ],
    ["rework", { reason: null }, "Rework"],
    ["blocked", {}, "Asks a question"],
    ["merging", {}, "Checking"],
    ["checking", {}, "Checking"],
    ["review", {}, "In review by lead"],
    ["ready", {}, "Ready to land"],
    ["landing", {}, "Landing"],
    ["waiting-on-you", { waitingOn: ["src/ui/hud.ts"] }, "Waits on your tree: src/ui/hud.ts"],
    [
      "waiting-on-you",
      { waitingOn: ["src/ui/hud.ts", "src/ui/ammo.ts", "README.md"] },
      "Waits on your tree: src/ui/hud.ts +2",
    ],
    ["landed", { delivered: false }, "Landed · not delivered"],
    ["landed", { delivered: true }, "Delivered"],
    ["parked", { reason: "The check timed out twice" }, "Stopped: The check timed out twice"],
    ["parked", { reason: null }, "Stopped"],
    ["discarded", {}, "Discarded"],
  ] as const)("words %s %j as %s", (state, fields, word) => {
    expect(crewTaskWord({ ...working, dependsOn: [], state, ...fields }, context)).toBe(word);
  });

  it("names the first dependency a queued task still waits for", () => {
    expect(crewTaskWord(taskOf("task-15"), context)).toBe("Queued · after #12");
    const afterLanded = { ...taskOf("task-15"), dependsOn: ["task-11", "task-12"] };
    expect(crewTaskWord(afterLanded, context)).toBe("Queued · after #12");
    expect(crewTaskWord({ ...afterLanded, dependsOn: ["task-11"] }, context)).toBe("Queued");
  });

  it("words a working task with its thread's own status word", () => {
    expect(crewTaskWord(working, { ...context, threadStatusWord: "Pending Approval" })).toBe(
      "Pending Approval",
    );
  });

  it("says who reviews only when the crew has a lead", () => {
    expect(crewTaskWord({ ...working, state: "review" }, { ...context, hasLead: false })).toBe(
      "In review",
    );
  });
});

describe("crewStateWord", () => {
  it.each([
    [null, 0, "Idle"],
    [null, 2, "2 working"],
    [{ ...run, state: "finished" }, 1, "1 working"],
    [run, 0, "Running · 1 h 12 m"],
    [{ ...run, elapsedMs: 45 * 60_000 }, 0, "Running · 45 m"],
    [{ ...run, elapsedMs: 8 * 3_600_000 }, 0, "Running · 8 h"],
    [{ ...run, state: "paused", reason: "budget" }, 0, "Paused · budget reached"],
    [{ ...run, state: "paused", reason: "time" }, 0, "Paused · time limit reached"],
    [{ ...run, state: "paused", reason: "usage" }, 0, "Paused · usage at 80 %"],
    [{ ...run, state: "paused", reason: "person" }, 0, "Paused"],
    [
      { ...run, state: "paused", reason: "refused", reasonDetail: "backend's login is not yours" },
      0,
      "Paused · backend's login is not yours",
    ],
    [{ ...run, state: "finishing" }, 3, "Finishing"],
  ] as const)("reads %j with %i working as %s", (latestRun, workingCount, word) => {
    expect(crewStateWord({ run: latestRun, workingCount })).toBe(word);
  });
});

describe("crewPersonLands", () => {
  const landing = (mode: "person" | "lead" | "check") => ({
    ...run,
    options: { ...run.options, landing: mode },
  });

  it.each([
    [null, true],
    [landing("person"), true],
    [landing("lead"), false],
    [{ ...landing("check"), state: "paused" }, false],
    [{ ...landing("lead"), state: "stopped" }, true],
  ] as const)("with run %j: %s", (latestRun, lands) => {
    expect(crewPersonLands(latestRun)).toBe(lands);
  });
});

describe("crewRunMeters", () => {
  it("reads spend, time and usage against their limits", () => {
    expect(crewRunMeters(run)).toEqual({
      spend: "Spend $6.40 of $20",
      time: "Time 1 h 12 m of 8 h",
      usage: "Usage 54 %, stops at 80",
    });
  });

  it("says no limit where the run has none", () => {
    const unlimited = {
      ...run,
      usagePercent: null,
      options: { ...run.options, budgetUsd: "unlimited", timeLimitHours: "unlimited" },
    } as const;
    expect(crewRunMeters(unlimited)).toEqual({
      spend: "Spend $6.40 · no limit",
      time: "Time 1 h 12 m · no limit",
      usage: null,
    });
  });

  it("drops the stop mark when the usage option is off", () => {
    const noStop = { ...run, options: { ...run.options, stopAtUsagePercent: null } };
    expect(crewRunMeters(noStop).usage).toBe("Usage 54 %");
  });
});

describe("crewAttentionSentence", () => {
  const rowOf = (kind: CrewAttentionKind) => crew.attention.find((row) => row.kind === kind)!;
  const sentence = (row: (typeof crew.attention)[number]) => crewAttentionSentence(row, crew);

  it.each([
    ["question", "Erik asks: Pricing in CZK or EUR?"],
    ["landing-wait", "Frontend's landing waits: src/ui/hud.ts is edited in your tree"],
    ["plan", "Lead proposes 1 task"],
    ["show-on-dev", "Backend asks to show its work on appdev"],
    ["parked", "Erik stopped: The check timed out twice"],
  ] as const)("words the fixture's %s row", (kind, words) => {
    expect(sentence(rowOf(kind))).toBe(words);
  });

  it.each([
    [
      { kind: "ready-to-land", handle: "frontend", taskId: "task-13" },
      "Frontend's #13 is ready to land",
    ],
    [
      { kind: "cant-start", handle: "backend", text: "the login is not yours" },
      "Can't start Backend: the login is not yours",
    ],
    [
      { kind: "conflict", handle: "backend", paths: ["src/api/items.ts"] },
      "Backend's copy conflicts with what landed: src/api/items.ts",
    ],
    [{ kind: "check-failed", handle: "backend" }, "Backend's check failed"],
    [
      { kind: "landing-wait", handle: "frontend", paths: ["src/ui/hud.ts", "src/ui/ammo.ts"] },
      "Frontend's landing waits: src/ui/hud.ts and 1 more are edited in your tree",
    ],
    [{ kind: "question", handle: "gone", text: "Still there?" }, "@gone asks: Still there?"],
  ] as const)("words %j", (fields, words) => {
    const row = {
      ...rowOf("question"),
      taskId: null,
      text: null,
      paths: [],
      ...fields,
    };
    expect(sentence(row)).toBe(words);
  });

  it("counts every proposed task in the lead's plan", () => {
    const threeProposed = {
      ...crew,
      board: {
        tasks: [
          ...tasks,
          { ...taskOf("task-16"), id: "task-18", number: 18 },
          { ...taskOf("task-16"), id: "task-19", number: 19 },
        ],
      },
    };
    expect(crewAttentionSentence(rowOf("plan"), threeProposed)).toBe("Lead proposes 3 tasks");
  });

  it("words every attention kind", () => {
    for (const kind of CrewAttentionKind.literals) {
      expect(sentence({ ...rowOf("question"), kind }), kind).toMatch(/\S/);
    }
  });
});

describe("crewRefusalSentence", () => {
  it("refuses a Tell the crew without a mention in PRD §5.3's words", () => {
    expect(crewRefusalSentence("no-mention", null)).toBe(
      "Name a crewmate with @, or add a lead to split the work.",
    );
  });

  it("appends the engine's detail once", () => {
    expect(crewRefusalSentence("invalid-definition", "backend has no check command.")).toBe(
      "The crew files need a fix: backend has no check command.",
    );
  });

  it("words every refusal reason as one sentence", () => {
    for (const reason of CrewRefusalReason.literals) {
      expect(crewRefusalSentence(reason, null), reason).toMatch(/^[A-Z].*\.$/);
    }
  });
});
