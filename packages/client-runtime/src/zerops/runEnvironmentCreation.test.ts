import { describe, expect, it } from "vite-plus/test";

import { planEnvironmentCreation, type EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import {
  resumableEnvironmentCreationStep,
  runEnvironmentCreation,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
} from "./runEnvironmentCreation.ts";

/** A tier as `main` holds it: a runtime built from the group's own repository, and a database. */
const TIER_YAML =
  "services:\n  - hostname: api\n    buildFromGit: https://gitea.test/acme/api\n    zeropsSetup: api\n  - hostname: db\n    type: postgresql@17\n";
/** What a Mate's creation imports itself: the managed services, with its project. */
const MANAGED_YAML = "services:\n  - hostname: db\n    type: postgresql@17\n";

function plan(role: ZeropsEnvironmentRole): ReadonlyArray<EnvironmentCreationStep> {
  const result = planEnvironmentCreation({
    clientId: "client-1",
    name: `Go Hello World - ${role}`,
    recipe: {
      kind: "tier",
      tier: role === "prod" ? "production" : "mate",
      yaml: TIER_YAML,
    },
    role,
    agents: ["claude-code"],
    register: true,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.steps;
}

/** A platform that records what it was asked and answers as the live one does. */
function fakePlatform(overrides: Partial<EnvironmentCreationPlatform> = {}) {
  const calls: Array<string> = [];
  let serviceReads = 0;
  const platform: EnvironmentCreationPlatform = {
    createProject: (input) => {
      calls.push(`create:${input.name}:${input.tagList.join(",")}`);
      return Promise.resolve({ id: "proj-1" });
    },
    readProjectCreation: ({ projectId }) => {
      calls.push(`creation:${projectId}`);
      return Promise.resolve({ processId: "proc-create", status: "FINISHED", error: null });
    },
    importDevelopmentContainer: (input) => {
      calls.push(
        `container:${input.projectId}:${input.projectName}:${input.agents.join("|")}:${input.setupRuntimesYaml?.length ?? "none"}`,
      );
      return Promise.resolve({ serviceName: "zcp", imported: true });
    },
    importServices: (projectId, yaml) => {
      calls.push(`import:${projectId}:${yaml.length}`);
      return Promise.resolve({});
    },
    importProject: (input) => {
      calls.push(`importProject:${input.yaml.length}`);
      return Promise.resolve({ projectId: "proj-1" });
    },
    shareReach: (projectId) => {
      calls.push(`shareReach:${projectId}`);
      return Promise.resolve();
    },
    closeOff: (projectId) => {
      calls.push(`closeOff:${projectId}`);
      return Promise.resolve();
    },
    readIsolation: (projectId) => {
      calls.push(`isolation:${projectId}`);
      return Promise.resolve("service");
    },
    markClosedOff: (projectId) => {
      calls.push(`closedOff:${projectId}`);
      return Promise.resolve();
    },
    register: (projectId) => {
      calls.push(`register:${projectId}`);
      return Promise.resolve();
    },
    readObservedServices: (projectId) => {
      serviceReads += 1;
      calls.push(`services:${projectId}:${serviceReads}`);
      // The services appear on the second read and come up on the third.
      if (serviceReads === 1) return Promise.resolve([]);
      const status = serviceReads >= 3 ? "ACTIVE" : "CREATING";
      return Promise.resolve([
        { name: "app", status },
        { name: "db", status: "ACTIVE" },
      ]);
    },
    ...overrides,
  };
  return { platform, calls };
}

function run(
  steps: ReadonlyArray<EnvironmentCreationStep>,
  platform: EnvironmentCreationPlatform,
  extra: { readonly clockMs?: Array<number>; readonly isCurrent?: () => boolean } = {},
) {
  const reports: Array<ReadonlyArray<EnvironmentCreationStepProgress>> = [];
  const slept: Array<number> = [];
  let tick = 0;
  // Time passes as the run sleeps, where the case gives no clock of its own.
  let asleep = 0;
  return runEnvironmentCreation({
    clientId: "client-1",
    steps,
    platform,
    ...(extra.isCurrent === undefined ? {} : { isCurrent: extra.isCurrent }),
    onProgress: (progress) => reports.push(progress),
    now: () => (extra.clockMs === undefined ? asleep : (extra.clockMs[tick++] ?? tick * 1000)),
    sleep: (ms) => {
      slept.push(ms);
      asleep += ms;
      return Promise.resolve();
    },
    pollIntervalMs: 7,
    serviceWaitCapMs: 100_000,
    projectCreatePollIntervalMs: 2,
  }).then((outcome) => ({ outcome, reports, slept }));
}

describe("runEnvironmentCreation", () => {
  it("stops before any platform call when the account lifetime has ended", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome } = await run(plan("dev"), platform, { isCurrent: () => false });
    expect(outcome).toMatchObject({
      ok: false,
      projectId: undefined,
      error: "This account session has ended.",
    });
    expect(calls).toEqual([]);
  });

  it("retains the created project but makes no further writes after account closure", async () => {
    let current = true;
    const { platform, calls } = fakePlatform({
      createProject: async () => {
        current = false;
        return { id: "created-before-logout" };
      },
    });
    const { outcome } = await run(plan("dev"), platform, { isCurrent: () => current });
    expect(outcome).toMatchObject({
      ok: false,
      projectId: "created-before-logout",
      error: "This account session has ended.",
    });
    expect(calls).toEqual([]);
  });

  it("stops service checks when the account closes during a read", async () => {
    let current = true;
    let reads = 0;
    const { platform } = fakePlatform({
      readObservedServices: async () => {
        reads += 1;
        current = false;
        return [];
      },
    });
    const { outcome, slept } = await run(plan("prod"), platform, { isCurrent: () => current });
    expect(outcome).toMatchObject({ ok: false, error: "This account session has ended." });
    expect(reads).toBe(1);
    expect(slept).toEqual([]);
  });

  it("runs the platform calls in the plan's order, feeding each the project it made", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: true,
      projectId: "proj-1",
      serviceName: "zcp",
      awaitingAgent: true,
    });
    expect(calls).toEqual([
      "create:Go Hello World - dev:mate",
      // The 200 is an acceptance; the platform's `project.create` process is
      // the creation, and the step is not done until it has finished.
      "creation:proj-1",
      // The managed services, with the project: nothing in them runs code.
      `import:proj-1:${MANAGED_YAML.length}`,
      // The group's agents reach the container import, not just the plan, and the runtimes ride
      // with it for zcp to import on boot: no runtime import of the press's own.
      `container:proj-1:Go Hello World - dev:claude-code:${"services:\n  - hostname: api\n    startWithoutCode: true\n".length}`,
      // Read back closed — the recipe already left it so, nothing written — and marked: zcp
      // imports the runtimes on the mark alone, and the Mate needs no browser any more. Only then
      // registered: a refused registration never keeps it open.
      "isolation:proj-1",
      // Read back again two seconds on: one read of a trailing index is not the project.
      "isolation:proj-1",
      "closedOff:proj-1",
      "register:proj-1",
      // Last, and best-effort: the group-reach reconcile covers it anyway.
      "shareReach:proj-1",
    ]);
  });

  it("imports a stage's or a production's tier whole, every runtime empty for the broker", async () => {
    const { platform, calls } = fakePlatform();
    await run(plan("prod"), platform);
    expect(calls.filter((call) => call.startsWith("import:"))).toEqual([
      `import:proj-1:${"services:\n  - hostname: api\n    startWithoutCode: true\n  - hostname: db\n    type: postgresql@17\n".length}`,
    ]);
  });

  it("hands an environment with an agent over at the wait for it, every step of the press done", async () => {
    // The container's own setup and the wait for it are the container's and the provisioning
    // state machine's: a second wait here would be a second opinion about when it is ready.
    const { platform, calls } = fakePlatform();
    const { outcome, reports } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: true,
      projectId: "proj-1",
      serviceName: "zcp",
      awaitingAgent: true,
    });
    expect(calls.some((call) => call.startsWith("services:"))).toBe(false);
    const last = reports.at(-1)!;
    expect(last.map((entry) => [entry.step.kind, entry.state])).toEqual([
      ["create-project", "done"],
      ["import-managed", "done"],
      ["import-container", "done"],
      ["close-off", "done"],
      ["register", "done"],
      ["share-reach", "done"],
      ["await-ready", "running"],
    ]);
  });

  it("hands over at the wait for the agent with no runtimes and nothing to register", async () => {
    const { platform } = fakePlatform();
    const steps = planEnvironmentCreation({
      clientId: "client-1",
      name: "Go Hello World - dev",
      role: "dev",
      recipe: { kind: "none" },
    });
    if (!steps.ok) throw new Error(steps.reason);
    const { outcome, reports } = await run(steps.steps, platform);
    expect(outcome.ok && outcome.awaitingAgent).toBe(true);
    expect(reports.at(-1)!.at(-1)).toMatchObject({ state: "running" });
  });

  it("waits for every service of an environment without an agent", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome, reports, slept } = await run(plan("prod"), platform);

    expect(outcome).toMatchObject({
      ok: true,
      projectId: "proj-1",
      serviceName: undefined,
      awaitingAgent: false,
      deployments: [
        { service: "app", deployment: { state: "known", value: { kind: "running" } } },
        { service: "db", deployment: { state: "known", value: { kind: "running" } } },
      ],
    });
    expect(calls.filter((call) => call.startsWith("services:"))).toHaveLength(3);
    expect(slept).toEqual([7, 7]);
    expect(reports.at(-1)!.map((entry) => entry.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("settles on a service created with nothing deployed, and knows it runs nothing", async () => {
    // A cloned buildFromGit service whose build failed sits at
    // READY_TO_DEPLOY for good; waiting on it would only time out.
    const { platform } = fakePlatform({
      readObservedServices: () =>
        Promise.resolve([
          { name: "app", status: "READY_TO_DEPLOY" },
          { name: "db", status: "ACTIVE" },
        ]),
    });
    const { outcome } = await run(plan("prod"), platform);
    expect(outcome).toMatchObject({
      ok: true,
      awaitingAgent: false,
      deployments: [
        {
          service: "app",
          // The read that settled the wait is the evidence, and it saw every service.
          deployment: {
            state: "known",
            value: { kind: "none" },
            asOf: { ordinal: 1 },
            coverage: "complete",
          },
        },
        { service: "db", deployment: { state: "known", value: { kind: "running" } } },
      ],
    });
  });

  it("does not call zero services ready", async () => {
    // An import's services appear a beat after it is accepted; an empty read
    // is "not yet", never "done".
    const { platform } = fakePlatform({ readObservedServices: () => Promise.resolve([]) });
    const { outcome } = await run(plan("prod"), platform, {
      clockMs: [0, 0, 0, 0, 0, 0, 0, 200_000, 200_000, 200_000],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("never appeared");
  });

  it("gives up on a service wait past its cap, naming what is still pending", async () => {
    const { platform } = fakePlatform({
      readObservedServices: () => Promise.resolve([{ name: "app", status: "CREATING" }]),
    });
    const { outcome } = await run(plan("prod"), platform, {
      clockMs: [0, 0, 0, 0, 0, 0, 0, 200_000, 200_000, 200_000],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedStep.kind).toBe("await-ready");
      expect(outcome.error).toContain("app");
    }
  });

  it("stops at the first failure and says which half was built", async () => {
    const { platform, calls } = fakePlatform({
      importServices: () => Promise.reject(new Error("projectImportProjectIncluded")),
    });
    const { outcome, reports } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: false,
      projectId: "proj-1",
      failedStep: expect.objectContaining({ kind: "import-managed" }),
      error: "projectImportProjectIncluded",
    });
    // Nothing after the failure runs.
    expect(calls.some((call) => call.startsWith("container:"))).toBe(false);
    const last = reports.at(-1)!;
    expect(last.map((entry) => entry.state)).toEqual([
      "done",
      "failed",
      "queued",
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    expect(last[1]?.error).toBe("projectImportProjectIncluded");
  });

  it("reports no project when creating it is what failed", async () => {
    const { platform } = fakePlatform({
      createProject: () => Promise.reject(new Error("quota")),
    });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.projectId).toBeUndefined();
  });

  it("reports every step queued before anything runs", async () => {
    const { platform } = fakePlatform();
    const { reports } = await run(plan("dev"), platform);
    expect(reports[0]!.map((entry) => entry.state)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
  });

  it("stamps each step with when it started and finished", async () => {
    const { platform } = fakePlatform();
    const { reports } = await run(plan("dev"), platform);
    const [first] = reports.at(-1)!;
    expect(first?.startedAtMs).toBeDefined();
    expect(first?.finishedAtMs).toBeGreaterThanOrEqual(first?.startedAtMs ?? Infinity);
  });
});

describe("runEnvironmentCreation — the platform's verdict on the project", () => {
  // `POST /client/{id}/project` answers 200 before anything is built; the
  // `project.create` process that follows is the creation, and it can fail
  // (measured 2026-09-16). The step waits for it.
  it("waits until project.create has finished, a missing process counting as running", async () => {
    const answers = [
      undefined,
      { processId: "proc-create", status: "RUNNING", error: null },
      { processId: "proc-create", status: "FINISHED", error: null },
    ];
    let reads = 0;
    const { platform, calls } = fakePlatform({
      readProjectCreation: () => Promise.resolve(answers[reads++]),
    });
    const { outcome, slept } = await run(plan("dev"), platform);

    expect(outcome.ok).toBe(true);
    expect(reads).toBe(3);
    expect(slept.slice(0, 2)).toEqual([2, 2]);
    expect(calls.some((call) => call.startsWith("container:proj-1:"))).toBe(true);
  });

  const failures: ReadonlyArray<{
    readonly name: string;
    readonly creation: {
      readonly status: string;
      readonly error: { code: string; message: string } | null;
    };
    readonly error: string;
  }> = [
    {
      name: "fails the step with the platform's message when project.create FAILED",
      creation: {
        status: "FAILED",
        error: { code: "internalServerError", message: "unexpected internal server error" },
      },
      error: "unexpected internal server error",
    },
    {
      name: "fails the step with the status when a CANCELED project.create said nothing",
      creation: { status: "CANCELED", error: null },
      error: "Zerops reported the project's creation as CANCELED.",
    },
  ];

  it.each(failures.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const { platform, calls } = fakePlatform({
      readProjectCreation: () => Promise.resolve({ processId: "proc-create", ...row.creation }),
    });
    const { outcome, reports } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: false,
      // The half that was made: a project the platform left NEW.
      projectId: "proj-1",
      failedStep: expect.objectContaining({ kind: "create-project" }),
      error: row.error,
    });
    // Nothing after it runs: no container, no token, no import. (The verdict
    // read is this test's own and records nothing.)
    expect(calls).toEqual(["create:Go Hello World - dev:mate"]);
    const last = reports.at(-1)!;
    expect(last[0]).toMatchObject({ state: "failed", error: row.error });
    expect(last.slice(1).every((entry) => entry.state === "queued")).toBe(true);
  });

  it("gives up when the platform never confirms the project, keeping its id", async () => {
    const { platform } = fakePlatform({
      readProjectCreation: () =>
        Promise.resolve({ processId: "proc-create", status: "RUNNING", error: null }),
    });
    // The step's start, one in-bound check, then one past the minute.
    const { outcome, slept } = await run(plan("dev"), platform, { clockMs: [0, 0, 200_000] });

    expect(outcome).toEqual({
      ok: false,
      projectId: "proj-1",
      failedStep: expect.objectContaining({ kind: "create-project" }),
      error: "Zerops did not confirm the project was created.",
    });
    expect(slept).toEqual([2]);
  });
});

describe("runEnvironmentCreation — closing the project off", () => {
  // The container recipe leaves the project `service service@zcp`, and a new project starts
  // `service`; but the read trails the platform, so the mark — which zcp imports the runtimes on —
  // is written only once the recipe's own write is through and two reads two seconds apart say
  // closed. Isolation is written only where a read says anything else.
  const table: ReadonlyArray<{
    readonly name: string;
    /** What each read of `envIsolation` answers, in turn; the last one stands. */
    readonly reads: ReadonlyArray<string | undefined>;
    readonly writes: number;
    readonly marked: boolean;
  }> = [
    {
      name: "a project the recipe already reads as closed: marked, nothing written",
      reads: ["service service@zcp"],
      writes: 0,
      marked: true,
    },
    {
      name: "a read that has not caught up is asked again, a second apart",
      reads: [undefined, undefined, "service"],
      writes: 0,
      marked: true,
    },
    {
      name: "a project that reads open is closed, read back twice, then marked",
      reads: ["none", "service"],
      writes: 1,
      marked: true,
    },
    {
      name: "a closed read the next one takes back is closed and read back again",
      reads: ["service", "none", "service"],
      writes: 1,
      marked: true,
    },
    {
      name: "a project that never reads at all is never marked",
      reads: [undefined],
      writes: 0,
      marked: false,
    },
    {
      name: "a project that stays open after it was closed is never marked",
      reads: ["none"],
      writes: 1,
      marked: false,
    },
    {
      name: "a project that reads closed once and open after is never marked",
      reads: ["service", "none"],
      writes: 1,
      marked: false,
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const reads = [...row.reads];
    const { platform, calls } = fakePlatform({
      readIsolation: async (projectId) => {
        calls.push(`isolation:${projectId}`);
        return reads.length > 1 ? reads.shift() : reads[0];
      },
    });
    const { outcome, slept } = await run(plan("dev"), platform);
    expect(outcome.ok).toBe(row.marked);
    if (!row.marked) expect(outcome).toMatchObject({ failedStep: { kind: "close-off" } });
    expect(calls.filter((call) => call.startsWith("closeOff:"))).toHaveLength(row.writes);
    expect(calls.includes("closedOff:proj-1")).toBe(row.marked);
    if (row.marked) {
      // At least two reads before the mark, two seconds apart.
      const beforeMark = calls.slice(0, calls.indexOf("closedOff:proj-1"));
      expect(beforeMark.filter((call) => call === "isolation:proj-1").length).toBeGreaterThan(1);
      expect(slept).toContain(2_000);
    }
  });

  // Finish setup on an older Mate isolates it first (`hardenMate`): its close-off trusts that and
  // reads no trailing index to isolate it a second time.
  it("marks a project the press has just isolated, reading nothing", async () => {
    const { platform, calls } = fakePlatform();
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps: [{ kind: "close-off", isolated: true }],
      platform,
      resume: { from: 0, projectId: "proj-1", projectName: "Go Hello World - dev" },
      sleep: async () => undefined,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(calls).toEqual(["closedOff:proj-1"]);
  });

  // Nothing waits on a process: the platform stalled a project's recipe write for minutes while
  // its isolation read closed throughout (a live press, 2026-10-01).
  it("reads no process, and closes off in two reads two seconds apart", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome, slept } = await run(plan("dev"), platform);
    expect(outcome.ok).toBe(true);
    expect(calls.filter((call) => call === "isolation:proj-1")).toHaveLength(2);
    expect(slept.filter((ms) => ms === 2_000)).toHaveLength(1);
  });

  it("stops, to be tried again, where the isolation never answers", async () => {
    const { platform } = fakePlatform({ readIsolation: async () => undefined });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({ ok: false, failedStep: { kind: "close-off" } });
    if (outcome.ok) throw new Error("expected a stop");
    expect(resumableEnvironmentCreationStep(outcome.failedStep)).toBe(true);
  });

  // A harden's isolation is trusted only where no container came after it: a container imported
  // in the same press brings the recipe's write, which may open the project again.
  it("reads back a project the harden isolated once a container was imported after it", async () => {
    const { platform, calls } = fakePlatform();
    await runEnvironmentCreation({
      clientId: "client-1",
      steps: [
        { kind: "import-container", agents: [] },
        { kind: "close-off", isolated: true },
      ],
      platform,
      resume: { from: 0, projectId: "proj-1", projectName: "Go Hello World - dev" },
      sleep: async () => undefined,
    });
    expect(calls.filter((call) => call === "isolation:proj-1").length).toBeGreaterThan(1);
    expect(calls.at(-1)).toBe("closedOff:proj-1");
  });

  it("closes off before the registration", async () => {
    const { platform, calls } = fakePlatform();
    await run(plan("dev"), platform);
    expect(calls.indexOf("closedOff:proj-1")).toBeLessThan(calls.indexOf("register:proj-1"));
  });

  // A member who may make a Mate but not write the registry, or a broker grant that failed: the
  // Mate stays closed off and running, and waits for an owner (`brokerGrant.ts`).
  it("keeps a Mate closed off and running when its registration is refused", async () => {
    const { platform, calls } = fakePlatform({
      register: async () => {
        throw new Error("Only an owner may register it.");
      },
    });
    const { outcome, reports } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({ ok: true, projectId: "proj-1", awaitingAgent: true });
    expect(calls).toContain("closedOff:proj-1");
    expect(calls).toContain("shareReach:proj-1");
    expect(reports.at(-1)!.find((entry) => entry.step.kind === "register")).toMatchObject({
      state: "failed",
      error: "Only an owner may register it.",
    });
  });

  // Best-effort, but never quiet: what the group's sight of it could not do is said on its step.
  it("says on its step what the group's sight of it could not do, and goes on", async () => {
    const { platform } = fakePlatform({
      shareReach: async () => {
        throw new Error("2 of the group's Mates could not be given sight of it.");
      },
    });
    const { outcome, reports } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({ ok: true, awaitingAgent: true });
    expect(reports.at(-1)!.find((entry) => entry.step.kind === "share-reach")).toMatchObject({
      state: "failed",
      error: "2 of the group's Mates could not be given sight of it.",
    });
  });

  it("stops a stage's press at a refused registration: it has no close-off to keep", async () => {
    const { platform } = fakePlatform({
      register: async () => {
        throw new Error("Only an owner may register it.");
      },
    });
    const { outcome } = await run(plan("prod"), platform);
    expect(outcome).toMatchObject({ ok: false, failedStep: { kind: "register" } });
  });
});

describe("runEnvironmentCreation — a press tried again", () => {
  it("resumes at the step that stopped, on the project the first press made", async () => {
    const { platform, calls } = fakePlatform();
    const steps = plan("dev");
    const from = steps.findIndex((step) => step.kind === "register");
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps,
      platform,
      resume: { from, projectId: "proj-1", projectName: "Go Hello World - dev" },
      sleep: async () => undefined,
    });
    expect(outcome).toMatchObject({ ok: true, projectId: "proj-1" });
    expect(calls).toEqual([
      "register:proj-1",
      // Last, and best-effort: the group-reach reconcile covers it anyway.
      "shareReach:proj-1",
    ]);
  });

  it("resumed at its close-off, reads it back twice, then marks it", async () => {
    const { platform, calls } = fakePlatform();
    const steps = plan("dev");
    const from = steps.findIndex((step) => step.kind === "close-off");
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps,
      platform,
      resume: { from, projectId: "proj-1", projectName: "Go Hello World - dev" },
      sleep: async () => undefined,
    });
    expect(outcome).toMatchObject({ ok: true, projectId: "proj-1" });
    expect(calls).toEqual([
      "isolation:proj-1",
      "isolation:proj-1",
      "closedOff:proj-1",
      "register:proj-1",
      "shareReach:proj-1",
    ]);
  });

  it("says the project the press made the moment the platform takes it", async () => {
    const { platform } = fakePlatform();
    const accepted: Array<string> = [];
    await runEnvironmentCreation({
      clientId: "client-1",
      steps: plan("dev"),
      platform,
      onProjectAccepted: (projectId) => accepted.push(projectId),
      sleep: async () => undefined,
    });
    expect(accepted).toEqual(["proj-1"]);
  });

  it("registers a stage or a production before waiting on its services", async () => {
    const { platform, calls } = fakePlatform();
    await run(plan("prod"), platform);
    const registered = calls.indexOf("register:proj-1");
    const firstWait = calls.findIndex((call) => call.startsWith("services:"));
    expect(registered).toBeGreaterThan(-1);
    expect(registered).toBeLessThan(firstWait);
  });
});
