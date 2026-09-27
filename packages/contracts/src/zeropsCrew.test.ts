import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CrewCommand,
  CrewCommandError,
  CrewCommandResult,
  CrewFiles,
  CrewSnapshot,
} from "./zeropsCrew.ts";

const decodeSnapshot = Schema.decodeUnknownSync(CrewSnapshot);
const decodeCommand = Schema.decodeUnknownSync(CrewCommand);
const decodeFiles = Schema.decodeUnknownSync(CrewFiles);
const decodeResult = Schema.decodeUnknownSync(CrewCommandResult);
const decodeError = Schema.decodeUnknownSync(CrewCommandError);

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
      claim: { state: "none", handle: null },
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
