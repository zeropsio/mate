import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type CrewSnapshot, type Crewmate } from "@t3tools/contracts";

import { crewSnapshotFixture } from "../crew/testing/fixtures.ts";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";

import type { Known } from "../knowledge/known.ts";
import { statusLabel } from "../statusPresentation.ts";
import {
  crewFeedRead,
  deriveCrewView as deriveWith,
  type CrewShellInput,
  type CrewThreadRead,
} from "./crew.ts";

type Shell = CrewShellInput & ThreadStatusInput;

/** What the web's `useCrew` hands in: the one resolver and its phrase producer. */
const readThread = (shell: Shell): CrewThreadRead => {
  const status = resolveThreadStatus(shell);
  return {
    status,
    word: statusLabel(status.kind),
    working: mateMarkStateForThreadStatus(status.kind) === "working",
  };
};

const deriveCrewView = (snapshot: CrewSnapshot, shells: ReadonlyArray<Shell>) =>
  deriveWith(snapshot, shells, readThread);

const idle = (id: string, fields: Partial<Shell> = {}): Shell => ({
  id: ThreadId.make(id),
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  interactionMode: "default",
  latestTurn: null,
  session: null,
  ...fields,
});

const running = (id: string): Shell =>
  idle(id, {
    session: {
      threadId: ThreadId.make(id),
      status: "running",
      providerName: "Claude",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-09-27T09:00:00.000Z",
    },
  });

const asking = (id: string): Shell => idle(id, { hasPendingUserInput: true });

const shells: ReadonlyArray<Shell> = [
  idle("thread-crew-lead-1"),
  running("thread-crew-backend-2"),
  idle("thread-crew-backend-1", { archivedAt: "2026-09-27T09:10:00.000Z" }),
  running("thread-crew-frontend-1"),
  asking("thread-crew-erik-1"),
];

const mate = (snapshot: CrewSnapshot, handle: string): Crewmate =>
  snapshot.crewmates.find((candidate) => candidate.handle === handle)!;

describe("deriveCrewView", () => {
  it("joins each crewmate to its current stint's shell and reads its status there", () => {
    const view = deriveCrewView(crewSnapshotFixture(), shells);

    expect(
      view.crewmates.map((row) => [row.crewmate.handle, row.shell?.id ?? null, row.status?.kind]),
    ).toEqual([
      ["lead", "thread-crew-lead-1", "idle"],
      ["backend", "thread-crew-backend-2", "working"],
      ["frontend", "thread-crew-frontend-1", "working"],
      ["erik", "thread-crew-erik-1", "input"],
    ]);
    expect(view.crewmates.map((row) => row.statusWord)).toEqual([
      null,
      "Working",
      "Working",
      "Input",
    ]);
  });

  it("has no shell and no status for a crewmate before its first turn or whose shell is not here", () => {
    const snapshot = crewSnapshotFixture();
    const view = deriveCrewView(
      {
        ...snapshot,
        crewmates: snapshot.crewmates.map((row) =>
          row.handle === "erik" ? { ...row, currentThreadId: null } : row,
        ),
      },
      shells.filter((shell) => shell.id !== "thread-crew-frontend-1"),
    );

    const byHandle = new Map(view.crewmates.map((row) => [row.crewmate.handle, row]));
    expect(byHandle.get("erik")).toMatchObject({ shell: null, status: null, statusWord: null });
    expect(byHandle.get("frontend")).toMatchObject({ shell: null, status: null, statusWord: null });
  });

  it("counts a crewmate as working by its thread's face, and words the crew's state from it", () => {
    const snapshot = crewSnapshotFixture({ run: null });
    const table = [
      { name: "two running", shells, working: 2, word: "2 working" },
      {
        name: "nobody running",
        shells: shells.map((shell) => idle(shell.id, { archivedAt: shell.archivedAt })),
        working: 0,
        word: "Idle",
      },
    ] as const;

    for (const row of table) {
      const view = deriveCrewView(snapshot, row.shells);
      expect([row.name, view.workingCount, view.stateWord]).toEqual([
        row.name,
        row.working,
        row.word,
      ]);
    }
    expect(deriveCrewView(crewSnapshotFixture(), shells).stateWord).toBe("Running · 1 h 12 m");
  });

  it("marks a crewmate pending while its running prompt is older than the current one", () => {
    const snapshot = crewSnapshotFixture();
    const withVersions = (
      running: Crewmate["promptVersions"]["running"],
      current: Crewmate["promptVersions"]["current"],
    ): CrewSnapshot => ({
      ...snapshot,
      crewmates: [{ ...mate(snapshot, "frontend"), promptVersions: { running, current } }],
    });
    const table = [
      { name: "same", running: { brief: 4, job: 2 }, current: { brief: 4, job: 2 }, pending: null },
      {
        name: "job ahead",
        running: { brief: 4, job: 2 },
        current: { brief: 4, job: 3 },
        pending: { job: 3, brief: null },
      },
      {
        name: "brief ahead",
        running: { brief: 4, job: 2 },
        current: { brief: 5, job: 2 },
        pending: { job: null, brief: 5 },
      },
      {
        name: "both ahead",
        running: { brief: 4, job: 2 },
        current: { brief: 5, job: 3 },
        pending: { job: 3, brief: 5 },
      },
      { name: "before a first turn", running: null, current: { brief: 5, job: 3 }, pending: null },
    ] as const;

    for (const row of table) {
      const [view] = deriveCrewView(withVersions(row.running, row.current), shells).crewmates;
      expect([row.name, view?.pending]).toEqual([row.name, row.pending]);
    }
  });

  it("gives each crewmate its open task and its queue in order", () => {
    const view = deriveCrewView(crewSnapshotFixture(), shells);
    const byHandle = new Map(view.crewmates.map((row) => [row.crewmate.handle, row]));

    expect(byHandle.get("backend")?.openTask?.number).toBe(12);
    expect(byHandle.get("frontend")?.openTask?.number).toBe(13);
    expect(byHandle.get("frontend")?.queuedTasks.map((task) => task.number)).toEqual([15]);
    expect(byHandle.get("lead")?.openTask).toBeNull();
  });

  it("puts every board row but a discarded one in its column, with its word and its owner", () => {
    const view = deriveCrewView(crewSnapshotFixture(), shells);

    expect(
      view.tasks.map((row) => [row.task.number, row.column, row.word, row.owner?.crewmate.handle]),
    ).toEqual([
      [10, "landed", "Delivered", "frontend"],
      [11, "landed", "Landed · not delivered", "backend"],
      [12, "working", "Working", "backend"],
      [13, "waiting-on-you", "Waits on your tree: src/ui/hud.ts", "frontend"],
      [14, "waiting-on-you", "Asks a question", "erik"],
      [15, "queued", "Queued · after #12", "frontend"],
      [16, "waiting-on-you", "Proposed", "backend"],
      [17, "waiting-on-you", "Stopped: The check timed out twice", "erik"],
    ]);
  });

  it("words a queued task with the owner's open task it waits behind", () => {
    const fixture = crewSnapshotFixture();
    const view = deriveCrewView(
      crewSnapshotFixture({
        board: {
          tasks: fixture.board.tasks.map((task) =>
            task.id === "task-15" ? { ...task, dependsOn: [] } : task,
          ),
        },
      }),
      shells,
    );

    expect(view.tasks.find((row) => row.task.number === 15)?.word).toBe("Queued · waits for #13");
  });

  it("has no word for a working task whose owner's thread is idle", () => {
    const view = deriveCrewView(
      crewSnapshotFixture(),
      shells.map((shell) => idle(shell.id, { archivedAt: shell.archivedAt })),
    );

    expect(view.tasks.find((row) => row.task.number === 12)?.word).toBeNull();
  });

  it("marks every crew shell with archivedAt as retired and maps each stint's thread to its crewmate", () => {
    const view = deriveCrewView(crewSnapshotFixture(), [
      ...shells,
      idle("thread-person-1", { archivedAt: "2026-09-27T07:00:00.000Z" }),
    ]);

    expect([...view.retiredThreadIds]).toEqual(["thread-crew-backend-1"]);
    expect(view.stints.get(ThreadId.make("thread-crew-backend-1"))).toEqual({
      handle: "backend",
      stint: 1,
      current: false,
      retired: true,
    });
    expect(view.stints.get(ThreadId.make("thread-crew-backend-2"))).toEqual({
      handle: "backend",
      stint: 2,
      current: true,
      retired: false,
    });
    expect(view.stints.has(ThreadId.make("thread-person-1"))).toBe(false);
  });

  it("reads a stint the engine retired as retired, its shell loaded or not", () => {
    const snapshot = crewSnapshotFixture();
    const table = [
      { name: "shell absent", shells: [] },
      { name: "shell not archived", shells: [idle("thread-crew-backend-1")] },
    ];
    for (const row of table) {
      const view = deriveCrewView(snapshot, row.shells);
      expect([row.name, view.stints.get(ThreadId.make("thread-crew-backend-1"))?.retired]).toEqual([
        row.name,
        true,
      ]);
    }
  });

  it("reads a shell's crew origin as a crew thread even when the snapshot does not list its stint", () => {
    const view = deriveCrewView(crewSnapshotFixture(), [
      idle("thread-crew-backend-9", {
        archivedAt: "2026-09-27T10:00:00.000Z",
        crew: { crew: "game", crewmate: "backend", stint: 9 },
      }),
    ]);

    expect(view.stints.get(ThreadId.make("thread-crew-backend-9"))).toEqual({
      handle: "backend",
      stint: 9,
      current: false,
      retired: true,
    });
  });

  it("names the lead, and lands by the person unless a run on says otherwise", () => {
    const snapshot = crewSnapshotFixture();
    const withoutLead = { ...snapshot, crewmates: snapshot.crewmates.slice(1) };

    expect(deriveCrewView(snapshot, shells).lead?.crewmate.handle).toBe("lead");
    expect(deriveCrewView(withoutLead, shells).lead).toBeNull();
    expect(deriveCrewView(snapshot, shells).personLands).toBe(true);
    expect(
      deriveCrewView(
        {
          ...snapshot,
          run: { ...snapshot.run!, options: { ...snapshot.run!.options, landing: "check" } },
        },
        shells,
      ).personLands,
    ).toBe(false);
  });

  it("reads an unapplied crew as empty", () => {
    const view = deriveCrewView(
      crewSnapshotFixture({
        status: "none",
        crew: null,
        crewmates: [],
        hosts: [],
        board: { tasks: [] },
        run: null,
        attention: [],
        landedNotDelivered: 0,
      }),
      shells,
    );

    expect(view).toMatchObject({
      status: "none",
      crew: null,
      crewmates: [],
      tasks: [],
      lead: null,
    });
    expect(view.stints.size).toBe(0);
  });
});

describe("crewFeedRead", () => {
  const snapshot = crewSnapshotFixture();
  const known = (freshness: "live" | "stale"): Known<CrewSnapshot> => ({
    state: "known",
    value: snapshot,
    asOf: { ordinal: 1, atMs: 1 },
    coverage: "complete",
    freshness:
      freshness === "live"
        ? { kind: "live" }
        : { kind: "stale", reason: { kind: "source-recovering", retryAtMs: null }, sinceMs: 2 },
  });

  it("reads the feed's knowledge as a status the section can switch on", () => {
    const table: ReadonlyArray<
      readonly [string, Known<CrewSnapshot> | undefined, ReturnType<typeof crewFeedRead>]
    > = [
      ["no environment", undefined, { status: null, snapshot: null, current: false }],
      [
        "reading",
        { state: "reading", sinceMs: 0, attempt: 1 },
        { status: null, snapshot: null, current: false },
      ],
      ["live", known("live"), { status: "applied", snapshot, current: true }],
      ["stale", known("stale"), { status: "applied", snapshot, current: false }],
      [
        "a Mate without the feed",
        {
          state: "failed",
          failure: { kind: "unsupported", capability: "subscribeZeropsCrew" },
          atMs: 0,
          attempt: 1,
          retryAtMs: null,
        },
        { status: "off", snapshot: null, current: false },
      ],
      [
        "a failed read",
        {
          state: "failed",
          failure: { kind: "transport", detail: "closed" },
          atMs: 0,
          attempt: 1,
          retryAtMs: null,
        },
        { status: null, snapshot: null, current: false },
      ],
    ];

    for (const [name, read, expected] of table) {
      expect([name, crewFeedRead(read)]).toEqual([name, expected]);
    }
  });
});
