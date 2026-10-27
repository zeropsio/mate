import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  CREW_BOARD_FINISHED_PER_CREWMATE,
  type CrewTask,
  type CrewTaskPage,
  type Crewmate,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewmateEmptyModel, readFinishedWork } from "./CrewmateEmptyState.logic";

const crew = crewSnapshotFixture();
const mate = (handle: string): Crewmate => crew.crewmates.find((each) => each.handle === handle)!;
const REVIEWER: Crewmate = {
  ...mate("backend"),
  handle: "referee",
  displayName: "Referee",
  kind: "reader",
  readOnly: true,
  jobFirstLine: "You review every change: nothing may break a saved world. Ask before you block.",
  host: null,
  lane: null,
  app: null,
};

const at = (time: string) => `2026-09-27T${time}:00.000Z`;

const task = (
  fields: Pick<CrewTask, "id" | "number" | "title" | "owner" | "state"> & Partial<CrewTask>,
): CrewTask => ({
  ...crew.board.tasks[0]!,
  ...fields,
});

describe("crewmateEmptyModel", () => {
  it.each<{
    readonly name: string;
    readonly crewmate: Crewmate;
    readonly whose: string;
    readonly job: string;
  }>([
    {
      name: "the lead",
      crewmate: {
        ...mate("lead"),
        jobFirstLine:
          "You lead the Letopis crew: Server and world, Game systems, Clients and creation.",
      },
      whose: "Fen's lead · plans and reviews the crew's work",
      job: "Leads the Letopis crew: Server and world, Game systems, Clients and creation.",
    },
    {
      name: "a builder",
      crewmate: mate("backend"),
      whose: "One of Fen's crew · builds its part in its own copy of Fen's code",
      job: "Owns the API under src/api and its tests.",
    },
    {
      name: "a reviewer, without the words its job says to it",
      crewmate: REVIEWER,
      whose: "One of Fen's crew · checks the others' work and changes nothing",
      job: "Reviews every change: nothing may break a saved world.",
    },
    {
      name: "a job with no words",
      crewmate: { ...mate("backend"), jobFirstLine: "  " },
      whose: "One of Fen's crew · builds its part in its own copy of Fen's code",
      job: "",
    },
  ])("says whose $name is, and its job in the person's words", ({ crewmate, whose, job }) => {
    const model = crewmateEmptyModel(crewmate, [], "Fen");
    expect(model.whose).toBe(whose);
    expect(model.job).toBe(job);
  });

  it("lists the work it finished, newest first: what went in, and what closed with nothing to add", () => {
    const tasks: ReadonlyArray<CrewTask> = [
      task({
        id: "went-in-early",
        number: 3,
        title: "World persistence",
        owner: "backend",
        state: "landed",
        landedCommit: "c4d9e02",
        landedAt: at("08:10"),
      }),
      task({
        id: "closed",
        number: 5,
        title: "Check the save format",
        owner: "backend",
        state: "landed",
        landedCommit: null,
        landedAt: at("09:40"),
      }),
      task({
        id: "went-in-late",
        number: 7,
        title: "Season clock on the server",
        owner: "backend",
        state: "landed",
        landedCommit: "5e1a2b7",
        landedAt: at("10:05"),
      }),
      // Not its work, or not finished: never listed.
      task({ id: "other", number: 8, title: "HUD", owner: "frontend", state: "landed" }),
      task({ id: "working", number: 9, title: "Weather", owner: "backend", state: "working" }),
      task({ id: "dropped", number: 10, title: "Rename", owner: "backend", state: "discarded" }),
      task({ id: "stopped", number: 11, title: "Snow", owner: "backend", state: "parked" }),
    ];
    expect(crewmateEmptyModel(mate("backend"), tasks, "Fen").work).toEqual([
      {
        taskId: "went-in-late",
        title: "Season clock on the server",
        outcome: "went into Fen's code",
        wentIn: true,
        at: at("10:05"),
      },
      {
        taskId: "closed",
        title: "Check the save format",
        outcome: "closed with nothing to add to Fen's code",
        wentIn: false,
        at: at("09:40"),
      },
      {
        taskId: "went-in-early",
        title: "World persistence",
        outcome: "went into Fen's code",
        wentIn: true,
        at: at("08:10"),
      },
    ]);
  });

  it("orders work finished in the same minute by its number, the later first", () => {
    const same = (id: string, number: number) =>
      task({
        id,
        number,
        title: id,
        owner: "backend",
        state: "landed",
        landedCommit: "a1b2c3d",
        landedAt: at("10:00"),
      });
    expect(
      crewmateEmptyModel(mate("backend"), [same("a", 1), same("b", 2)], "Fen").work.map(
        (row) => row.taskId,
      ),
    ).toEqual(["b", "a"]);
  });

  it("dates finished work with no landing time by when it was asked for", () => {
    const undated = task({
      id: "undated",
      number: 4,
      title: "Health endpoint",
      owner: "backend",
      state: "landed",
      landedCommit: "a1b2c3d",
      landedAt: null,
      createdAt: at("07:00"),
    });
    expect(crewmateEmptyModel(mate("backend"), [undated], "Fen").work).toEqual([
      {
        taskId: "undated",
        title: "Health endpoint",
        outcome: "went into Fen's code",
        wentIn: true,
        at: null,
      },
    ]);
  });
});

describe("crewmateEmptyModel on the engine, its board bounded", () => {
  const landedTask = (number: number, minute: number) =>
    task({
      id: `t${number}`,
      number,
      title: `Task ${number}`,
      owner: "backend",
      state: "landed",
      landedCommit: `c${number}`,
      landedAt: at(`10:${String(minute).padStart(2, "0")}`),
    });
  // The board holds a crewmate's newest finished work only: twenty pieces.
  const board = Array.from({ length: CREW_BOARD_FINISHED_PER_CREWMATE }, (_, index) =>
    landedTask(index + 11, index + 11),
  );

  it("lists the work it finished, the newest three, and opens the rest in place", async () => {
    const pages: Record<string, CrewTaskPage> = {
      first: { tasks: board.toReversed().slice(0, 10), next: "21" },
      "21": { tasks: [...board.toReversed().slice(10), landedTask(10, 10)], next: "10" },
      "10": { tasks: [landedTask(9, 9), landedTask(8, 8)], next: null },
    };
    const asked: Array<string | null> = [];
    const older = await readFinishedWork(async ({ handle, before }) => {
      expect(handle).toBe("backend");
      asked.push(before);
      return pages[before ?? "first"]!;
    }, "backend");
    expect(asked).toEqual([null, "21", "10"]);

    const closed = crewmateEmptyModel(mate("backend"), board, "Fen");
    expect(closed.work).toHaveLength(CREW_BOARD_FINISHED_PER_CREWMATE);
    expect(closed.more).toBe(true);
    const opened = crewmateEmptyModel(mate("backend"), board, "Fen", older);
    expect(opened.work.map((row) => row.title).slice(0, 3)).toEqual([
      "Task 30",
      "Task 29",
      "Task 28",
    ]);
    expect(opened.work.map((row) => row.title).slice(-3)).toEqual(["Task 10", "Task 9", "Task 8"]);
    // What the board held and a page brought again is listed once.
    expect(opened.work).toHaveLength(CREW_BOARD_FINISHED_PER_CREWMATE + 3);
    expect(opened.more).toBe(false);
  });

  it("keeps what it read when a page fails, and says nothing more is known", async () => {
    const older = await readFinishedWork(async ({ before }) => {
      if (before === null) return { tasks: [landedTask(10, 10)], next: "10" };
      throw new Error("socket closed");
    }, "backend");
    expect(older.map((each) => each.number)).toEqual([10]);
  });

  it("knows all its work while the board holds less than its bound", () => {
    expect(crewmateEmptyModel(mate("backend"), board.slice(0, 5), "Fen").more).toBe(false);
  });
});
