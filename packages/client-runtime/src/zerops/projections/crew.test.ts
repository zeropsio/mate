import { describe, expect, it } from "@effect/vitest";
import {
  ThreadId,
  type ConversationRow,
  type CrewSnapshot,
  type Crewmate,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { engineRow } from "../../data/__fixtures__/mateEngine.ts";
import { overlayEngineShell } from "../../data/projections/mateEngine.ts";
import {
  crewConversationId,
  crewEngineSnapshotFixture,
  crewSnapshotFixture,
} from "../crew/testing/fixtures.ts";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";

import type { Known } from "../knowledge/known.ts";
import { statusLabel } from "../statusPresentation.ts";
import {
  crewFeedRead,
  crewPortOwners,
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

  it("counts a crewmate as working by its thread's face", () => {
    const snapshot = crewSnapshotFixture({ run: null });
    const table = [
      { name: "two running", shells, working: 2 },
      {
        name: "nobody running",
        shells: shells.map((shell) => idle(shell.id, { archivedAt: shell.archivedAt })),
        working: 0,
      },
    ] as const;

    for (const row of table) {
      const view = deriveCrewView(snapshot, row.shells);
      expect([row.name, view.workingCount]).toEqual([row.name, row.working]);
    }
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

  it("keeps every task but a dropped one, each with its owner", () => {
    const view = deriveCrewView(crewSnapshotFixture(), shells);

    expect(
      view.tasks.map((row) => [row.task.number, row.task.state, row.owner?.crewmate.handle]),
    ).toEqual([
      [10, "landed", "frontend"],
      [11, "landed", "backend"],
      [12, "working", "backend"],
      [13, "waiting-on-you", "frontend"],
      [14, "blocked", "erik"],
      [15, "queued", "frontend"],
      [16, "proposed", "backend"],
      [17, "parked", "erik"],
    ]);
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
        "a Mate whose crew frames this client cannot read",
        {
          state: "failed",
          failure: {
            kind: "malformed",
            detail: "subscribeZeropsCrew sent a frame this client cannot read",
          },
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

describe("crewPortOwners", () => {
  it("names each crew port by the crewmate whose app it is, a free one by nobody", () => {
    const snapshot = crewSnapshotFixture();
    expect(crewPortOwners(snapshot)).toEqual(
      new Map([
        [
          "appdev",
          new Map([
            [3001, "Backend"],
            [3002, "Frontend"],
            [3003, "Erik"],
            [3004, null],
          ]),
        ],
      ]),
    );
  });
});

/**
 * The same sentences on the engine: the snapshot the engine's crew serves, joined to each
 * crewmate's conversation row as the Mate's shell lays it over a crew thread.
 */
describe("deriveCrewView on the engine", () => {
  const ENV = "env-fen";
  const conversation = (handle: string) => crewConversationId(handle) as string;
  const crewmateAgent = (handle: string) => ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    model: "claude-sonnet-4-5",
    profile: { kind: "crewmate" as const, id: handle, name: handle },
  });
  const rowOf = (handle: string, state: ConversationRow["state"]): ConversationRow =>
    engineRow(ENV, conversation(handle), {
      agent: crewmateAgent(handle),
      state,
      activeRunId: state.kind === "working" ? (`${conversation(handle)}/r/1` as never) : null,
    });
  const IDLE = { kind: "idle" } as const;
  const WORKING = { kind: "working", since: 1, waitsOnHelpers: false } as const;
  const ASKING = { kind: "waiting", on: "question", words: "Cursor or offset?" } as const;
  const rows: ReadonlyArray<ConversationRow> = [
    rowOf("lead", IDLE),
    rowOf("backend", WORKING),
    rowOf("frontend", WORKING),
    rowOf("erik", ASKING),
  ];

  /** The Mate's shell with its rows laid over it, as `useCrew` reads its thread shells. */
  const shellsOf = (
    conversationRows: ReadonlyArray<ConversationRow>,
    v1Threads: ReadonlyArray<unknown> = [],
  ): ReadonlyArray<Shell> => {
    const shell = overlayEngineShell(
      {
        snapshot: Option.some({
          snapshotSequence: 1,
          projects: [{ id: "project-fen" }],
          threads: v1Threads,
          updatedAt: "2026-09-27T09:00:00.000Z",
        }),
        status: "live",
        error: Option.none(),
      } as unknown as Parameters<typeof overlayEngineShell>[0],
      conversationRows,
    );
    return (Option.getOrNull(shell.snapshot)?.threads ?? []) as unknown as ReadonlyArray<Shell>;
  };

  it("joins each crewmate to its conversation's row and reads its status there", () => {
    const view = deriveCrewView(crewEngineSnapshotFixture(), shellsOf(rows));

    expect(
      view.crewmates.map((row) => [row.crewmate.handle, row.shell?.id ?? null, row.status?.kind]),
    ).toEqual([
      ["lead", conversation("lead"), "idle"],
      ["backend", conversation("backend"), "working"],
      ["frontend", conversation("frontend"), "working"],
      ["erik", conversation("erik"), "input"],
    ]);
    expect(view.crewmates.map((row) => row.statusWord)).toEqual([
      null,
      "Working",
      "Working",
      "Input",
    ]);
  });

  it("reads the conversation of a crewmate no longer on the crew as retired, archived or not", () => {
    const snapshot = crewEngineSnapshotFixture();
    const withoutErik = {
      ...snapshot,
      crewmates: snapshot.crewmates.filter((mate) => mate.handle !== "erik"),
    };
    const erik = shellsOf([rowOf("erik", IDLE)])[0]!;
    const table = [
      { name: "not archived", shells: [erik] },
      { name: "archived", shells: [{ ...erik, archivedAt: "2026-09-27T10:00:00.000Z" }] },
    ];
    for (const row of table) {
      const view = deriveCrewView(withoutErik, row.shells);
      expect([row.name, view.stints.get(ThreadId.make(conversation("erik")))]).toEqual([
        row.name,
        { handle: "erik", stint: 1, current: false, retired: true },
      ]);
    }
  });

  it("has no shell and no status for a crewmate before its first turn or whose shell is not here", () => {
    const view = deriveCrewView(
      crewEngineSnapshotFixture(),
      shellsOf(rows.filter((row) => !/-(erik|frontend)-/u.test(row.conversationId))),
    );

    const byHandle = new Map(view.crewmates.map((row) => [row.crewmate.handle, row]));
    expect(byHandle.get("erik")).toMatchObject({ shell: null, status: null, statusWord: null });
    expect(byHandle.get("frontend")).toMatchObject({ shell: null, status: null, statusWord: null });
    expect(byHandle.get("backend")?.status?.kind).toBe("working");
  });

  it("counts a crewmate as working by its thread's face", () => {
    const snapshot = crewEngineSnapshotFixture({ run: null });
    const table = [
      { name: "two running", rows, working: 2 },
      {
        name: "nobody running",
        rows: rows.map((row) => ({ ...row, state: IDLE, activeRunId: null })),
        working: 0,
      },
    ] as const;

    for (const row of table) {
      const view = deriveCrewView(snapshot, shellsOf(row.rows));
      expect([row.name, view.workingCount]).toEqual([row.name, row.working]);
    }
  });

  it("marks a crewmate pending while its running prompt is older than the current one", () => {
    const snapshot = crewEngineSnapshotFixture();
    const frontend = mate(snapshot, "frontend");
    const table = [
      { running: { brief: 4, job: 2 }, current: { brief: 4, job: 2 }, pending: null },
      {
        running: { brief: 4, job: 2 },
        current: { brief: 4, job: 3 },
        pending: { job: 3, brief: null },
      },
      {
        running: { brief: 4, job: 2 },
        current: { brief: 5, job: 2 },
        pending: { job: null, brief: 5 },
      },
      { running: null, current: { brief: 5, job: 3 }, pending: null },
    ] as const;

    for (const row of table) {
      const [view] = deriveCrewView(
        {
          ...snapshot,
          crewmates: [
            { ...frontend, promptVersions: { running: row.running, current: row.current } },
          ],
        },
        shellsOf(rows),
      ).crewmates;
      expect(view?.pending).toEqual(row.pending);
    }
  });

  it("gives each crewmate its open task and its queue in order", () => {
    const view = deriveCrewView(crewEngineSnapshotFixture(), shellsOf(rows));
    const byHandle = new Map(view.crewmates.map((row) => [row.crewmate.handle, row]));

    expect(byHandle.get("backend")?.openTask?.number).toBe(12);
    expect(byHandle.get("frontend")?.queuedTasks.map((task) => task.number)).toEqual([15]);
    expect(byHandle.get("lead")?.openTask).toBeNull();
  });

  it("keeps every task but a dropped one, each with its owner", () => {
    const view = deriveCrewView(crewEngineSnapshotFixture(), shellsOf(rows));

    expect(view.tasks.map((row) => [row.task.number, row.owner?.crewmate.handle])).toEqual([
      [10, "frontend"],
      [11, "backend"],
      [12, "backend"],
      [13, "frontend"],
      [14, "erik"],
      [15, "frontend"],
      [16, "backend"],
      [17, "erik"],
    ]);
  });

  it("marks every crew shell with archivedAt as retired and maps each stint's thread to its crewmate", () => {
    const archived = {
      ...shellsOf([rowOf("backend", IDLE)])[0]!,
      archivedAt: "2026-09-27T09:10:00.000Z",
    };
    const view = deriveCrewView(crewEngineSnapshotFixture(), [
      ...shellsOf(rows.filter((row) => !row.conversationId.includes("-backend-"))),
      archived,
      idle("thread-person-1", { archivedAt: "2026-09-27T07:00:00.000Z" }),
    ]);

    expect([...view.retiredThreadIds]).toEqual([conversation("backend")]);
    expect(view.stints.get(ThreadId.make(conversation("backend")))).toEqual({
      handle: "backend",
      stint: 1,
      current: true,
      retired: true,
    });
    expect(view.stints.get(ThreadId.make(conversation("frontend")))).toEqual({
      handle: "frontend",
      stint: 1,
      current: true,
      retired: false,
    });
    expect(view.stints.has(ThreadId.make("thread-person-1"))).toBe(false);
  });

  it("reads a shell's crew origin as a crew thread even when the snapshot does not list its stint", () => {
    const view = deriveCrewView(crewEngineSnapshotFixture(), [
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
    const snapshot = crewEngineSnapshotFixture();
    const shells = shellsOf(rows);

    expect(deriveCrewView(snapshot, shells).lead?.crewmate.handle).toBe("lead");
    expect(
      deriveCrewView({ ...snapshot, crewmates: snapshot.crewmates.slice(1) }, shells).lead,
    ).toBeNull();
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
      crewEngineSnapshotFixture({
        status: "none",
        crew: null,
        crewmates: [],
        hosts: [],
        board: { tasks: [] },
        run: null,
        attention: [],
        landedNotDelivered: 0,
      }),
      // The Mate's own conversation, a person's thread.
      shellsOf([], [idle("thread-fen")]),
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
