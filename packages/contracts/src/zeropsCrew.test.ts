import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CrewCommand,
  CrewCommandError,
  CrewCommandResult,
  crewCommandReach,
  CrewFeedFrame,
  CrewFiles,
  crewReachLogins,
  CrewSeam,
  CrewSnapshot,
  CrewTaskPage,
  CrewTaskPageInput,
  type CrewCommandReach,
  type CrewLoginRoster,
} from "./zeropsCrew.ts";

const decodeSnapshot = Schema.decodeUnknownSync(CrewSnapshot);
const decodeFrame = Schema.decodeUnknownSync(CrewFeedFrame);
const encodeFrame = Schema.encodeSync(CrewFeedFrame);
const encodeSnapshot = Schema.encodeSync(CrewSnapshot);
const decodeCommand = Schema.decodeUnknownSync(CrewCommand);
const decodeFiles = Schema.decodeUnknownSync(CrewFiles);
const decodeResult = Schema.decodeUnknownSync(CrewCommandResult);
const decodeError = Schema.decodeUnknownSync(CrewCommandError);
const decodeSeam = Schema.decodeUnknownSync(CrewSeam);
const decodeTaskPage = Schema.decodeUnknownSync(CrewTaskPage);
const decodeTaskPageInput = Schema.decodeUnknownSync(CrewTaskPageInput);

const appliedSnapshot = {
  status: "applied",
  seq: 7,
  crew: {
    name: "game",
    briefTitle: "Camera and HUD rework",
    briefVersion: 4,
    briefExcerpt: "The camera follows the player.",
  },
  crewmates: [
    {
      handle: "backend",
      displayName: "Backend",
      tint: "sky",
      kind: "writer",
      jobFirstLine: "Owns the API.",
      jobVersion: 2,
      promptVersions: { running: { brief: 3, job: 2 }, current: { brief: 4, job: 2 } },
      login: { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
      model: null,
      effort: null,
      readOnly: false,
      host: "appdev",
      currentThreadId: "thread-backend-1",
      stints: [
        {
          stint: 1,
          threadId: "thread-backend-1",
          state: "active",
          reason: null,
          lastCompactSummary: null,
          startedAt: "2026-09-27T08:00:00.000Z",
          retiredAt: null,
        },
      ],
      context: { tokens: 41_000, window: 200_000 },
      compactions: 0,
      memory: { entries: 0, unfiled: 0 },
      openTaskId: "task-12",
      queuedTaskIds: [],
      lane: {
        branch: "crew/backend",
        ahead: 3,
        insertions: 214,
        deletions: 12,
        dirty: false,
        check: { state: "passed", output: "" },
        state: "ready",
        detail: null,
      },
      app: { state: "running", port: 3001, url: "https://appdev-1df2-3001.prg1.zerops.app" },
    },
  ],
  hosts: [
    {
      host: "appdev",
      integration: { branch: "main", head: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" },
      crewPorts: [
        { port: 3001, routed: true },
        { port: 3002, routed: null },
      ],
      served: { by: "tree" },
      claim: { state: "none", handle: null, grantWaiting: false },
    },
  ],
  board: {
    tasks: [
      {
        id: "task-12",
        number: 12,
        title: "Add pagination to /api/items",
        owner: "backend",
        state: "working",
        source: "message",
        createdBy: "user-1",
        createdAt: "2026-09-27T08:05:00.000Z",
        dependsOn: [],
        fresh: false,
        brief: "Add pagination to /api/items",
        doneWhen: "",
        note: "Also sent to @frontend. Your part is what is addressed to @backend.",
        attempts: 1,
        reason: null,
        question: null,
        waitingOn: [],
        diffStat: { insertions: 214, deletions: 12 },
        report: null,
        check: null,
        review: null,
        landedCommit: null,
        landedAt: null,
        delivered: false,
      },
    ],
  },
  run: null,
  attention: [],
  devHosts: [
    { host: "appdev", database: true },
    { host: "webdev", database: null },
  ],
  landedNotDelivered: 0,
  lastError: null,
};

describe("CrewSnapshot", () => {
  it("decodes an applied crew with a working crewmate", () => {
    expect(decodeSnapshot(appliedSnapshot)).toEqual(appliedSnapshot);
  });

  it("tells your tree apart from the copy of a crewmate whose handle is tree", () => {
    const withServed = (served: unknown) =>
      decodeSnapshot({ ...appliedSnapshot, hosts: [{ ...appliedSnapshot.hosts[0], served }] })
        .hosts[0]?.served;
    expect(withServed({ by: "tree" })).toEqual({ by: "tree" });
    expect(withServed({ by: "crewmate", handle: "tree" })).toEqual({
      by: "crewmate",
      handle: "tree",
    });
    expect(() => withServed({ by: "backend" })).toThrow();
  });
});

/** One well-formed payload per tag: ARCHITECTURE §6 plus PRD §8, `assign` retired for `taskCreate`. */
const commandSamples = [
  { _tag: "apply" },
  {
    _tag: "start",
    budgetUsd: "unlimited",
    timeLimitHours: 8,
    stopAtUsagePercent: 80,
    landing: "person",
    devGrant: false,
    leadMayStart: false,
  },
  { _tag: "pause", runId: "run-1" },
  { _tag: "resume", runId: "run-1" },
  { _tag: "stop", runId: "run-1" },
  { _tag: "finish", runId: "run-1" },
  {
    _tag: "message",
    handle: "backend",
    text: "Add pagination to /api/items",
    attachments: [
      { type: "image", id: "img-1", name: "shot.png", mimeType: "image/png", sizeBytes: 2048 },
    ],
  },
  {
    _tag: "tell",
    text: "@backend rework X, @erik the plan",
    mentions: [{ handle: "backend" }, { handle: "erik" }],
  },
  {
    _tag: "taskCreate",
    owner: "frontend",
    title: "Camera rig",
    brief: "The camera follows the player.",
    doneWhen: "npm test passes",
    dependsOn: ["task-12"],
  },
  { _tag: "taskEdit", taskId: "task-12", title: "Paginate /api/items" },
  { _tag: "discard", taskId: "task-12" },
  { _tag: "markFresh", taskId: "task-12" },
  { _tag: "taskRetry", taskId: "task-17" },
  { _tag: "planAccept", taskIds: ["task-16"] },
  { _tag: "planDiscard", taskIds: ["task-16"] },
  { _tag: "review", taskId: "task-12", verdict: "reject", note: "Keep the old route." },
  { _tag: "land", taskId: "task-12" },
  { _tag: "landNow", taskId: "task-12" },
  { _tag: "askResolve", taskId: "task-12" },
  { _tag: "askFix", taskId: "task-12" },
  { _tag: "answer", handle: "erik", taskId: "task-14", text: "EUR" },
  { _tag: "claimGrant", host: "appdev" },
  { _tag: "claimDeny", host: "appdev" },
  { _tag: "claimRelease", host: "appdev" },
  { _tag: "showOnDev", handle: "backend" },
  { _tag: "startFresh", handle: "backend" },
  { _tag: "rebuildCopy", handle: "backend" },
  { _tag: "thawHost", host: "appdev" },
  { _tag: "operationContinue", handle: "backend", operationId: "op-1" },
  { _tag: "operationDiscard", handle: "backend", operationId: "op-2" },
  { _tag: "useCrewCopy", handle: "backend", threadId: "thread-backend-1", expectedPath: null },
  { _tag: "briefSave", apply: "nextTurn" },
  { _tag: "jobSave", handle: "backend", apply: "fresh" },
  {
    _tag: "memoryEdit",
    handle: "backend",
    entryId: "mem-3",
    text: "The API is paginated by cursor.",
  },
  { _tag: "memoryRemove", handle: "backend", entryId: "mem-3" },
  { _tag: "forgetMemory", handle: "backend" },
  { _tag: "removeCrewmate", handle: "erik", discardUnlanded: false },
  { _tag: "orphanScan" },
  { _tag: "adopt", host: "appdev", branch: "crew/map" },
  { _tag: "deliverDraft" },
  { _tag: "addCrewPorts", host: "appdev", count: 4 },
  { _tag: "appRun", handle: "backend" },
  { _tag: "appStop", handle: "backend" },
] as const;

/**
 * The snapshot as the first contract's server sent it: none of the fields
 * added since (`dirty`, `integration`, `routed` null, `note`, `landedAt`,
 * `devHosts`, `grantWaiting`).
 */
const firstContractSnapshot = (() => {
  const { devHosts: _devHosts, ...snapshot } = appliedSnapshot;
  const [mate] = appliedSnapshot.crewmates;
  const { dirty: _dirty, ...lane } = mate!.lane;
  const [host] = appliedSnapshot.hosts;
  const { integration: _integration, ...hostFields } = host!;
  const [task] = appliedSnapshot.board.tasks;
  const { note: _note, landedAt: _landedAt, ...taskFields } = task!;
  return {
    ...snapshot,
    crewmates: [{ ...mate, lane }],
    hosts: [{ ...hostFields, crewPorts: [{ port: 3001 }], claim: { state: "none", handle: null } }],
    board: { tasks: [taskFields] },
  };
})();

describe("CrewSnapshot from an older server", () => {
  it("decodes a snapshot without every field added since the first contract, to their defaults", () => {
    const decoded = decodeSnapshot(firstContractSnapshot);

    expect(decoded.crewmates[0]?.lane?.dirty).toBe(false);
    expect(decoded.hosts[0]?.integration).toBeNull();
    expect(decoded.hosts[0]?.crewPorts).toEqual([{ port: 3001, routed: null }]);
    expect(decoded.board.tasks[0]?.note).toBeNull();
    expect(decoded.board.tasks[0]?.landedAt).toBeNull();
    expect(decoded.devHosts).toEqual([]);
    expect(decoded.hosts[0]?.claim.grantWaiting).toBe(false);
    expect(decoded).not.toHaveProperty("revision");
    expect(decoded.crewmates[0]).not.toHaveProperty("conversationId");
    expect(decoded.crewmates[0]).not.toHaveProperty("sessions");
  });
});

/** An engine Mate's snapshot: the crew owner's revision, each crewmate in one conversation. */
const engineSnapshot = {
  ...appliedSnapshot,
  revision: { epoch: 1_759_900_000_000, seq: 41 },
  crewmates: appliedSnapshot.crewmates.map((crewmate) => ({
    ...crewmate,
    currentThreadId: "crew-game-backend-1",
    conversationId: "crew-game-backend-1",
    sessions: { count: 3, lastReason: "context" },
    stints: [],
  })),
};

describe("CrewSnapshot from an engine Mate", () => {
  it("carries the crew's revision and each crewmate's conversation and sessions", () => {
    expect(decodeFrame(engineSnapshot)).toEqual(engineSnapshot);
    expect(encodeSnapshot(decodeSnapshot(engineSnapshot))).toEqual(engineSnapshot);
  });

  it("reads a session reason from a newer server as unknown, never dropping the frame", () => {
    const [crewmate] = engineSnapshot.crewmates;
    const newer = {
      ...engineSnapshot,
      crewmates: [{ ...crewmate, sessions: { count: 4, lastReason: "moon" } }],
    };
    expect(decodeFrame(newer)).toMatchObject({
      crewmates: [{ sessions: { count: 4, lastReason: "unknown" } }],
    });
  });
});

describe("crew.taskPage", () => {
  const [task] = appliedSnapshot.board.tasks;
  const landed = {
    ...task!,
    state: "landed",
    landedCommit: "0a84078f2fd5652d10c3c820786c944d057386e3",
    landedAt: "2026-09-27T09:00:00.000Z",
  };

  it("asks for a crewmate's finished work past the board, from a cursor or from the start", () => {
    const table = [
      { handle: "backend", before: null },
      { handle: "backend", before: "task-9", limit: 20 },
    ];
    for (const input of table) expect(decodeTaskPageInput(input)).toEqual(input);
  });

  it("decodes a page of finished work, with the cursor to the next", () => {
    const page = { tasks: [landed], next: "task-11" };
    expect(decodeTaskPage(page)).toEqual(page);
    expect(decodeTaskPage({ tasks: [], next: null })).toEqual({ tasks: [], next: null });
  });

  it("drops a task this build cannot read and keeps the rest of the page", () => {
    const page = { tasks: [{ ...landed, state: "teleported" }, landed], next: null };
    expect(decodeTaskPage(page)).toEqual({ tasks: [landed], next: null });
  });
});

describe("CrewFeedFrame", () => {
  it("decodes a snapshot as it is", () => {
    expect(decodeFrame(appliedSnapshot)).toEqual(appliedSnapshot);
  });

  it("decodes a frame this build cannot read as undecodable, never as a failure", () => {
    const table = [
      { name: "a status from a newer server", frame: { ...appliedSnapshot, status: "paused" } },
      { name: "a missing field without a default", frame: { ...appliedSnapshot, seq: undefined } },
      { name: "not a snapshot at all", frame: "hello" },
    ];
    for (const row of table) {
      expect([row.name, decodeFrame(row.frame)]).toEqual([
        row.name,
        { _tag: "CrewFrameUndecodable" },
      ]);
    }
  });

  it("reads a newer server's frame past a field this build does not know", () => {
    const [task] = appliedSnapshot.board.tasks;
    const newer = {
      ...appliedSnapshot,
      board: { tasks: [{ ...task, reviewedAt: "2026-09-29T09:00:00.000Z" }] },
    };
    expect(decodeFrame(newer)).toEqual(appliedSnapshot);
  });

  it("encodes a snapshot the way the snapshot itself encodes", () => {
    const snapshot = decodeSnapshot(appliedSnapshot);
    expect(encodeFrame(snapshot)).toEqual(encodeSnapshot(snapshot));
  });
});

describe("CrewCommand", () => {
  it("has exactly one member per tag the sources name", () => {
    const tags = Object.keys(CrewCommand.cases);
    expect(new Set(tags)).toEqual(new Set(commandSamples.map((sample) => sample._tag)));
    expect(tags).toHaveLength(commandSamples.length);
  });

  it.each(commandSamples)("decodes $_tag", (sample) => {
    expect(decodeCommand(sample)).toEqual(sample);
  });
});

/** Every tag's reach: a tag missing here, or one the union no longer has, fails to compile. */
const REACH: { readonly [Tag in CrewCommand["_tag"]]: CrewCommandReach } = {
  apply: { kind: "home" },
  start: { kind: "crew" },
  pause: { kind: "stops" },
  resume: { kind: "crew" },
  stop: { kind: "stops" },
  finish: { kind: "crew" },
  briefSave: { kind: "crew" },
  message: { kind: "crewmates", handles: ["backend"] },
  answer: { kind: "crewmates", handles: ["erik"] },
  taskCreate: { kind: "crewmates", handles: ["frontend"] },
  showOnDev: { kind: "crewmates", handles: ["backend"] },
  startFresh: { kind: "crewmates", handles: ["backend"] },
  rebuildCopy: { kind: "crewmates", handles: ["backend"] },
  thawHost: { kind: "crew" },
  operationContinue: { kind: "crewmates", handles: ["backend"] },
  operationDiscard: { kind: "crewmates", handles: ["backend"] },
  useCrewCopy: { kind: "crewmates", handles: ["backend"] },
  memoryEdit: { kind: "crewmates", handles: ["backend"] },
  memoryRemove: { kind: "crewmates", handles: ["backend"] },
  forgetMemory: { kind: "crewmates", handles: ["backend"] },
  removeCrewmate: { kind: "crewmates", handles: ["erik"] },
  adopt: { kind: "crewmates", handles: ["map"] },
  appRun: { kind: "crewmates", handles: ["backend"] },
  appStop: { kind: "crewmates", handles: ["backend"] },
  jobSave: { kind: "job", handle: "backend" },
  taskEdit: { kind: "tasks", taskIds: ["task-12"] },
  discard: { kind: "tasks", taskIds: ["task-12"] },
  markFresh: { kind: "tasks", taskIds: ["task-12"] },
  taskRetry: { kind: "tasks", taskIds: ["task-17"] },
  planAccept: { kind: "tasks", taskIds: ["task-16"] },
  planDiscard: { kind: "tasks", taskIds: ["task-16"] },
  review: { kind: "tasks", taskIds: ["task-12"] },
  land: { kind: "tasks", taskIds: ["task-12"] },
  landNow: { kind: "tasks", taskIds: ["task-12"] },
  askResolve: { kind: "tasks", taskIds: ["task-12"] },
  askFix: { kind: "tasks", taskIds: ["task-12"] },
  claimGrant: { kind: "claim", host: "appdev" },
  claimDeny: { kind: "claim", host: "appdev" },
  claimRelease: { kind: "claim", host: "appdev" },
  tell: { kind: "tell", handles: ["backend", "erik"] },
  orphanScan: { kind: "reads" },
  deliverDraft: { kind: "reads" },
  addCrewPorts: { kind: "reads" },
};

describe("crewCommandReach", () => {
  it.each(commandSamples)("reaches what $_tag runs or changes", (sample) => {
    expect(crewCommandReach(decodeCommand(sample))).toEqual(REACH[sample._tag]);
  });
});

/**
 * Lead on the Mate's default login, Backend on Eva's second Claude login,
 * Reviewer on Codex; the crew home moves Backend to another login and names a
 * crewmate not applied yet.
 */
const ROSTER: CrewLoginRoster = {
  crewmates: [
    { handle: "lead", kind: "lead", login: "claudeAgent" },
    { handle: "backend", kind: "writer", login: "claudeAgent-eva" },
    { handle: "reviewer", kind: "reader", login: "codex" },
  ],
  ownerOf: (taskId) => ({ "task-1": "backend", "task-2": "reviewer" })[taskId],
  claimOf: (host) => (host === "appdev" ? "backend" : undefined),
  home: [
    { handle: "lead", login: "claudeAgent" },
    { handle: "backend", login: "claudeAgent-jan" },
    { handle: "newcomer", login: "codex-jan" },
  ],
};

const LEADLESS: CrewLoginRoster = {
  ...ROSTER,
  crewmates: ROSTER.crewmates.filter((mate) => mate.kind !== "lead"),
};

describe("crewReachLogins", () => {
  it.each([
    ["reads nothing", { kind: "reads" }, ROSTER, []],
    ["reaches nobody's to stop or pause the crew", { kind: "stops" }, ROSTER, []],
    ["every crewmate's", { kind: "crew" }, ROSTER, ["claudeAgent", "claudeAgent-eva", "codex"]],
    [
      "every crewmate's and every one the crew home names",
      { kind: "home" },
      ROSTER,
      ["claudeAgent", "claudeAgent-eva", "codex", "claudeAgent-jan", "codex-jan"],
    ],
    ["a crewmate's own", { kind: "crewmates", handles: ["backend"] }, ROSTER, ["claudeAgent-eva"]],
    [
      "nobody's for a crewmate the crew lacks",
      { kind: "crewmates", handles: ["ghost"] },
      ROSTER,
      [],
    ],
    [
      "a crewmate's, and the one its job now names",
      { kind: "job", handle: "backend" },
      ROSTER,
      ["claudeAgent-eva", "claudeAgent-jan"],
    ],
    [
      "a crewmate's once for an unchanged login",
      { kind: "job", handle: "lead" },
      ROSTER,
      ["claudeAgent"],
    ],
    ["a newcomer's from the crew home", { kind: "job", handle: "newcomer" }, ROSTER, ["codex-jan"]],
    [
      "each task's crewmate's, once",
      { kind: "tasks", taskIds: ["task-1", "task-2", "task-1"] },
      ROSTER,
      ["claudeAgent-eva", "codex"],
    ],
    ["nobody's for a task the board lacks", { kind: "tasks", taskIds: ["task-9"] }, ROSTER, []],
    ["the claiming crewmate's", { kind: "claim", host: "appdev" }, ROSTER, ["claudeAgent-eva"]],
    ["nobody's for an unclaimed service", { kind: "claim", host: "apidev" }, ROSTER, []],
    [
      "the lead's, whoever is mentioned",
      { kind: "tell", handles: ["backend", "reviewer"] },
      ROSTER,
      ["claudeAgent"],
    ],
    [
      "each mentioned crewmate's without a lead",
      { kind: "tell", handles: ["backend", "reviewer"] },
      LEADLESS,
      ["claudeAgent-eva", "codex"],
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewCommandReach, CrewLoginRoster, ReadonlyArray<string>]
  >)("%s", (_name, reach, roster, logins) => {
    expect(crewReachLogins(reach, roster)).toEqual(logins);
  });
});

describe("CrewCommand resume", () => {
  it.each([
    { _tag: "resume", runId: "run-1" },
    { _tag: "resume", runId: "run-1", budgetUsd: 5 },
    { _tag: "resume", runId: "run-1", budgetUsd: "unlimited", timeLimitHours: "unlimited" },
    { _tag: "resume", runId: "run-1", timeLimitHours: 12, stopAtUsagePercent: null },
  ])("decodes a resume that keeps or raises the run's limits", (command) => {
    expect(decodeCommand(command)).toEqual(command);
  });

  it.each([
    { _tag: "resume", runId: "run-1", budgetUsd: 0 },
    { _tag: "resume", runId: "run-1", stopAtUsagePercent: 120 },
  ])("refuses a limit no run can have", (command) => {
    expect(() => decodeCommand(command)).toThrow();
  });
});

describe("CrewFiles", () => {
  it.each(["crew.yaml", "brief.md", "jobs/backend.md", "jobs/erik-2.md"])(
    "accepts the crew home's %s",
    (path) => {
      expect(decodeFiles({ files: [{ path, content: "x" }] })).toEqual({
        files: [{ path, content: "x" }],
      });
    },
  );

  it.each([
    "../crew.yaml",
    "/var/www/.mate/crew/game/crew.yaml",
    "jobs/../../etc/passwd.md",
    "jobs/Backend.md",
    "jobs/a-handle-far-longer-than-twenty.md",
    "jobs/backend.txt",
    "notes.md",
  ])("refuses %s, which is not a crew home file", (path) => {
    expect(() => decodeFiles({ files: [{ path, content: "x" }] })).toThrow();
  });
});

describe("CrewCommandResult", () => {
  it.each([
    { _tag: "done" },
    { _tag: "deliverDraft", dirtyPaths: ["src/ui/hud.ts"] },
    { _tag: "crewPorts", host: "appdev", ports: [3001, 3002, 3003, 3004] },
    { _tag: "orphans", orphans: [{ host: "appdev", branch: "crew/map", ahead: 3 }] },
  ])("decodes $_tag", (result) => {
    expect(decodeResult(result)).toEqual(result);
  });
});

describe("CrewSeam", () => {
  it.each([
    {
      seam: "landed",
      taskId: "task-1",
      number: 3,
      commit: "0a84078f2fd5652d10c3c820786c944d057386e3",
    },
    { seam: "saved", apply: "nextTurn" },
    { seam: "stint", previousThreadId: "thread-1" },
    { seam: "stint", previousThreadId: null },
    {
      seam: "swept",
      branch: "crew/backend",
      commit: "0a84078f2fd5652d10c3c820786c944d057386e3",
      paths: ["src/api.ts"],
    },
  ])("decodes a $seam seam", (seam) => {
    expect(decodeSeam(seam)).toEqual(seam);
  });

  it("refuses a seam the chat does not know", () => {
    expect(() => decodeSeam({ seam: "deployed" })).toThrow();
  });
});

describe("CrewCommandError", () => {
  it("carries a refusal code and the engine's detail", () => {
    const error = decodeError({
      _tag: "CrewCommandError",
      reason: "database-undeclared",
      detail: "backend on appdev",
    });
    expect(error.reason).toBe("database-undeclared");
    expect(error.message).toBe("Crew command refused (database-undeclared): backend on appdev");
  });

  it("refuses a reason outside the closed list", () => {
    expect(() =>
      decodeError({ _tag: "CrewCommandError", reason: "something-else", detail: null }),
    ).toThrow();
  });
});
