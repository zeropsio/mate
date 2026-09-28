import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewAttention,
  CrewHost,
  CrewLaneSummary,
  CrewSnapshot,
  CrewTask,
  Crewmate,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewLaneBarModel, type CrewLaneBarModel } from "./CrewLaneBar.logic";

const BASE = crewSnapshotFixture();
const BACKEND = BASE.crewmates.find((crewmate) => crewmate.handle === "backend")!;

/** The fixture's backend, with its lane, its open task and its host changed as a case needs. */
function backend(input: {
  readonly crewmate?: Partial<Crewmate>;
  readonly lane?: Partial<CrewLaneSummary>;
  readonly task?: Partial<CrewTask> | null;
  readonly host?: Partial<CrewHost>;
  readonly attention?: ReadonlyArray<CrewAttention>;
  readonly working?: boolean;
  readonly services?: Parameters<typeof crewLaneBarModel>[2];
}): CrewLaneBarModel | null {
  const crewmate: Crewmate = {
    ...BACKEND,
    lane: BACKEND.lane === null ? null : { ...BACKEND.lane, ...input.lane },
    openTaskId: input.task === null ? null : BACKEND.openTaskId,
    ...input.crewmate,
  };
  const snapshot: CrewSnapshot = {
    ...BASE,
    crewmates: BASE.crewmates.map((row) => (row.handle === "backend" ? crewmate : row)),
    hosts: BASE.hosts.map((host) => (host.host === "appdev" ? { ...host, ...input.host } : host)),
    board: {
      tasks: BASE.board.tasks.map((task) =>
        task.id === BACKEND.openTaskId && input.task != null ? { ...task, ...input.task } : task,
      ),
    },
    attention: input.attention ?? BASE.attention,
  };
  const view = deriveCrewView(snapshot, [], () => {
    throw new Error("no shells here");
  });
  const row = view.crewmates.find(({ crewmate: { handle } }) => handle === "backend")!;
  return crewLaneBarModel(snapshot, { ...row, working: input.working ?? false }, input.services);
}

describe("crewLaneBarModel", () => {
  it("names the branch, how far it is ahead of your tree and its change", () => {
    expect(backend({})).toMatchObject({
      branch: "crew/backend",
      ahead: "3 changes ahead of your tree",
      diffStat: "+214 −12",
    });
    expect(backend({ lane: { ahead: 1 } })?.ahead).toBe("1 change ahead of your tree");
    expect(backend({ lane: { ahead: 0 } })).toMatchObject({ ahead: null, diffStat: null });
  });

  it.each<{
    readonly name: string;
    readonly check: CrewLaneSummary["check"];
    readonly word: CrewLaneBarModel["check"];
  }>([
    {
      name: "a passed check",
      check: { state: "passed", output: "" },
      word: { word: "Check passed", tone: "ok", pulse: false },
    },
    {
      name: "a failed check",
      check: { state: "failed", output: "" },
      word: { word: "Check failed", tone: "failed", pulse: false },
    },
    {
      name: "a check under way",
      check: { state: "running", output: "" },
      word: { word: "Checking", tone: "busy", pulse: true },
    },
    { name: "no check yet", check: null, word: null },
  ])("says $name", ({ check, word }) => {
    expect(backend({ lane: { check } })?.check).toEqual(word);
  });

  it.each<{
    readonly name: string;
    readonly task: Partial<CrewTask> | null;
    readonly working?: boolean;
    readonly ahead?: number;
    readonly dirty?: boolean;
    readonly land: CrewLaneBarModel["land"];
  }>([
    {
      name: "Land lands a ready task",
      task: { state: "ready" },
      land: { kind: "land", taskId: "task-12", label: "Land", enabled: true },
    },
    {
      name: "Land now lands work its crewmate never reported, between its turns",
      task: { state: "working" },
      land: { kind: "landNow", taskId: "task-12", label: "Land now", enabled: true },
    },
    {
      name: "Land waits while its crewmate is mid-turn",
      task: { state: "working" },
      working: true,
      land: { kind: "land", taskId: "task-12", label: "Land", enabled: false },
    },
    {
      name: "Land waits while nothing is ahead of your tree or uncommitted in its copy",
      task: { state: "working" },
      ahead: 0,
      land: { kind: "land", taskId: "task-12", label: "Land", enabled: false },
    },
    {
      name: "Land now lands changes no commit holds yet",
      task: { state: "working" },
      ahead: 0,
      dirty: true,
      land: { kind: "landNow", taskId: "task-12", label: "Land now", enabled: true },
    },
    {
      name: "Land now lands a task sent back for rework",
      task: { state: "rework" },
      land: { kind: "landNow", taskId: "task-12", label: "Land now", enabled: true },
    },
    {
      name: "Land waits while the check runs",
      task: { state: "checking" },
      land: { kind: "land", taskId: "task-12", label: "Land", enabled: false },
    },
    {
      name: "Land has nothing to land without a task",
      task: null,
      land: { kind: "land", taskId: null, label: "Land", enabled: false },
    },
  ])("$name", ({ task, working, ahead, dirty, land }) => {
    expect(
      backend({
        task,
        ...(working === undefined ? {} : { working }),
        lane: {
          ...(ahead === undefined ? {} : { ahead }),
          ...(dirty === undefined ? {} : { dirty }),
        },
      })?.land,
    ).toEqual(land);
  });

  it.each<{
    readonly name: string;
    readonly lane?: Partial<CrewLaneSummary>;
    readonly task?: Partial<CrewTask> | null;
    readonly attention?: ReadonlyArray<CrewAttention>;
    readonly note: CrewLaneBarModel["note"];
    readonly ask?: CrewLaneBarModel["ask"];
  }>([
    {
      name: "a copy being made",
      lane: { state: "creating" },
      note: { text: "Creating its copy of the code", tone: "muted" },
    },
    {
      name: "a copy being set up names its setup command",
      lane: { state: "setting-up", detail: "npm ci" },
      note: { text: "Running npm ci", tone: "muted" },
    },
    {
      name: "a merge-in that stopped on conflicts names the files and offers to ask",
      lane: { state: "conflicts" },
      attention: [
        {
          id: "conflict-1",
          kind: "conflict",
          handle: "backend",
          taskId: "task-12",
          text: null,
          paths: ["src/api/items.ts", "src/api/users.ts"],
          host: null,
          at: "2026-09-27T09:30:00.000Z",
        },
      ],
      note: { text: "Conflicts with what landed: src/api/items.ts and 1 more", tone: "attention" },
      ask: { kind: "askResolve", taskId: "task-12", label: "Ask Backend to resolve" },
    },
    {
      name: "a failed check offers to ask for a fix",
      lane: { check: { state: "failed", output: "" } },
      note: null,
      ask: { kind: "askFix", taskId: "task-12", label: "Ask Backend to fix" },
    },
    {
      name: "a landing waiting on your tree names the file",
      task: { state: "waiting-on-you", waitingOn: ["src/ui/hud.ts"] },
      note: { text: "Waits on your tree: src/ui/hud.ts", tone: "attention" },
    },
    {
      name: "a copy whose service redeploys waits",
      lane: { state: "frozen" },
      note: { text: "Its service is redeploying", tone: "muted" },
    },
    {
      name: "a copy that failed says why",
      lane: { state: "failed", detail: "no free disk" },
      note: { text: "Its copy failed: no free disk", tone: "failed" },
    },
    {
      name: "a copy level with your tree names the last landing",
      lane: { ahead: 0 },
      task: null,
      note: { text: "Task #11 landed as a1b2c3d", tone: "muted" },
    },
  ])("says $name", ({ lane, task, attention, note, ask = null }) => {
    const model = backend({
      ...(lane === undefined ? {} : { lane }),
      ...(task === undefined ? {} : { task }),
      ...(attention === undefined ? {} : { attention }),
    });
    expect(model?.note).toEqual(note);
    expect(model?.ask).toEqual(ask);
  });

  it.each<{
    readonly name: string;
    readonly app?: Crewmate["app"];
    readonly host?: Partial<CrewHost>;
    readonly expected: CrewLaneBarModel["app"];
  }>([
    {
      name: "its app running on its crew port",
      expected: {
        kind: "running",
        label: "App on :3001",
        url: "https://appdev-1df2-3001.prg1.zerops.app",
      },
    },
    {
      name: "its app stopped",
      app: { state: "stopped", port: 3001, url: null },
      expected: { kind: "stopped", label: "App stopped" },
    },
    {
      name: "a service without crew ports",
      host: { crewPorts: [] },
      expected: { kind: "no-crew-ports", label: "No crew ports on appdev", host: "appdev" },
    },
    {
      name: "more crewmates than crew ports",
      app: { state: "none", port: null, url: null },
      expected: { kind: "no-free-port", label: "No free crew port" },
    },
    { name: "no Run command", app: { state: "none", port: 3001, url: null }, expected: null },
  ])("says $name", ({ app, host, expected }) => {
    expect(
      backend({
        ...(app === undefined ? {} : { crewmate: { app } }),
        ...(host === undefined ? {} : { host }),
      })?.app,
    ).toEqual(expected);
  });

  it("opens a running app at its crew port's route when the engine sends no URL", () => {
    const app = { state: "running", port: 3001, url: null } as const;
    const services = [
      {
        hostname: "appdev",
        routes: [
          { port: 3000, url: "https://appdev-1df2-3000.prg1.zerops.app" },
          { port: 3001, url: "https://appdev-1df2-3001.prg1.zerops.app" },
        ],
      },
    ];
    expect(backend({ crewmate: { app }, services })?.app).toEqual({
      kind: "running",
      label: "App on :3001",
      url: "https://appdev-1df2-3001.prg1.zerops.app",
    });
    expect(
      backend({ crewmate: { app }, services: [{ hostname: "appdev", routes: [] }] })?.app,
    ).toMatchObject({ url: null });
    expect(backend({ crewmate: { app } })?.app).toMatchObject({ url: null });
  });

  it.each<{
    readonly name: string;
    readonly claim: CrewHost["claim"];
    readonly working?: boolean;
    readonly showOnDev: CrewLaneBarModel["showOnDev"];
  }>([
    {
      name: "shows its work on dev at your press, asked for or not",
      claim: { state: "none", handle: null, grantWaiting: false },
      showOnDev: { kind: "showOnDev", host: "appdev", label: "Show on dev", enabled: true },
    },
    {
      name: "shows it at your press when it asked first",
      claim: { state: "requested", handle: "backend", grantWaiting: false },
      showOnDev: { kind: "showOnDev", host: "appdev", label: "Show on dev", enabled: true },
    },
    {
      name: "shows it in place of another crewmate's request",
      claim: { state: "requested", handle: "frontend", grantWaiting: false },
      showOnDev: { kind: "showOnDev", host: "appdev", label: "Show on dev", enabled: true },
    },
    {
      name: "waits for its turn to end before showing its work",
      claim: { state: "none", handle: null, grantWaiting: false },
      working: true,
      showOnDev: { kind: "showOnDev", host: "appdev", label: "Show on dev", enabled: false },
    },
    {
      name: "gives dev back to your tree while its crewmate's work is shown",
      claim: { state: "held", handle: "backend", grantWaiting: false },
      showOnDev: { kind: "claimRelease", host: "appdev", label: "Back to my tree", enabled: true },
    },
    {
      name: "has nothing to press while another crewmate's work is shown",
      claim: { state: "held", handle: "frontend", grantWaiting: false },
      showOnDev: null,
    },
    {
      name: "has nothing to press while dev is going back to your tree",
      claim: { state: "releasing", handle: "backend", grantWaiting: false },
      showOnDev: null,
    },
  ])("$name", ({ claim, working, showOnDev }) => {
    expect(
      backend({ host: { claim }, ...(working === undefined ? {} : { working }) })?.showOnDev,
    ).toEqual(showOnDev);
  });

  it("diffs its copy against the tip of your tree, once the engine has read it", () => {
    const head = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    expect(backend({ host: { integration: { branch: "main", head } } })?.changesBase).toBe(head);
    expect(backend({ host: { integration: null } })?.changesBase).toBeNull();
  });

  it("asks the Mate to commit your edit a landing waits on, and nothing otherwise", () => {
    const wait: CrewAttention = {
      id: "wait-1",
      kind: "landing-wait",
      handle: "backend",
      taskId: "task-12",
      text: null,
      paths: ["src/ui/hud.ts"],
      host: null,
      at: "2026-09-27T09:30:00.000Z",
    };
    expect(
      backend({
        task: { state: "waiting-on-you", waitingOn: ["src/ui/hud.ts"] },
        attention: [wait],
      })?.commitEdit,
    ).toEqual({
      label: "Commit my edit",
      ask: "Commit my edit to src/ui/hud.ts locally, without pushing: a crew landing waits on it.",
      what: "Backend's landing waits: src/ui/hud.ts is edited in your tree",
    });
    expect(backend({ attention: [] })?.commitEdit).toBeNull();
  });

  it("draws no lane bar for a crewmate without a copy of the code", () => {
    expect(
      backend({ crewmate: { kind: "reader", readOnly: true, lane: null, app: null, host: null } }),
    ).toBeNull();
  });
});
