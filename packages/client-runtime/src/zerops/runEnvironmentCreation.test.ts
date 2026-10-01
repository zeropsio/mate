import { describe, expect, it } from "vite-plus/test";

import { planEnvironmentCreation, type EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import {
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
    groupId: "7k2m9qx4vb1c",
    groupName: "Go Hello World",
    name: `Go Hello World - ${role}`,
    recipe: {
      kind: "tier",
      tier: role === "prod" ? "production" : "mate",
      yaml: TIER_YAML,
    },
    role,
    agents: ["claude-code"],
    register: true,
    ...(role === "prod" ? {} : { botName: "Ada" }),
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
    // The container recipe's own write of the project's variables, through already.
    readProjectEnvWrites: (projectId) => {
      calls.push(`envWrites:${projectId}`);
      return Promise.resolve([{ status: "FINISHED" }]);
    },
    closeOff: (projectId) => {
      calls.push(`closeOff:${projectId}`);
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
    // The recipe's write is read until it is through: how often is the clock's business.
    expect(calls.filter((call) => !call.startsWith("envWrites:"))).toEqual([
      "create:Go Hello World - dev:mate:g:7k2m9qx4vb1c,mate:role:dev,mate:name:Go Hello World,mate,mate:bot:Ada",
      // The 200 is an acceptance; the platform's `project.create` process is
      // the creation, and the step is not done until it has finished.
      "creation:proj-1",
      // The managed services, with the project: nothing in them runs code.
      `import:proj-1:${MANAGED_YAML.length}`,
      // The group's agents reach the container import, not just the plan, and the runtimes ride
      // with it for zcp to import on boot: no runtime import of the press's own.
      `container:proj-1:Go Hello World - dev:claude-code:${"services:\n  - hostname: api\n    startWithoutCode: true\n".length}`,
      // The recipe's own write of the project's variables is waited out, then the project is
      // closed off and registered: nothing is left for a browser after the press.
      "closeOff:proj-1",
      "register:proj-1",
    ]);
    expect(calls.indexOf("envWrites:proj-1")).toBeGreaterThan(
      calls.findIndex((call) => call.startsWith("container:")),
    );
    expect(calls.lastIndexOf("envWrites:proj-1")).toBeLessThan(calls.indexOf("closeOff:proj-1"));
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
      ["await-ready", "running"],
    ]);
  });

  it("hands over at the wait for the agent with no runtimes and nothing to register", async () => {
    const { platform } = fakePlatform();
    const steps = planEnvironmentCreation({
      clientId: "client-1",
      groupId: "7k2m9qx4vb1c",
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
    // The recipe's write is read until it is through: how often is the clock's business.
    expect(calls.filter((call) => !call.startsWith("envWrites:"))).toEqual([
      "create:Go Hello World - dev:mate:g:7k2m9qx4vb1c,mate:role:dev,mate:name:Go Hello World,mate,mate:bot:Ada",
    ]);
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
  const table: ReadonlyArray<{
    readonly name: string;
    /** What each read of the project's variable writes answers, in turn. */
    readonly reads: ReadonlyArray<ReadonlyArray<string>>;
    /** The clock between reads, ms from the container's import. */
    readonly reads_at: ReadonlyArray<number>;
    readonly closedAfterReads: number;
  }> = [
    {
      name: "waits for the recipe's own write of the variables, then closes",
      reads: [["PENDING"], ["RUNNING"], ["FINISHED"]],
      reads_at: [7_000, 8_000, 9_000],
      closedAfterReads: 3,
    },
    {
      name: "gives a recipe that wrote nothing yet a moment to appear, and closes after it",
      reads: [[], [], []],
      reads_at: [1_000, 3_000, 7_000],
      closedAfterReads: 3,
    },
    {
      name: "closes at once when the recipe's write is through and the moment has passed",
      reads: [["FINISHED"]],
      reads_at: [7_000],
      closedAfterReads: 1,
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    let read = 0;
    let clock = 0;
    const order: Array<string> = [];
    const { platform } = fakePlatform({
      importDevelopmentContainer: async () => {
        clock = 0;
        return { serviceName: "zcp", imported: true };
      },
      readProjectEnvWrites: async () => {
        clock = row.reads_at[read] ?? clock;
        const statuses = row.reads[read] ?? [];
        read += 1;
        order.push(`read${read}`);
        return statuses.map((status) => ({ status }));
      },
      closeOff: async () => {
        order.push("close");
      },
    });
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps: plan("dev"),
      platform,
      now: () => clock,
      sleep: async () => undefined,
    });
    expect(outcome.ok).toBe(true);
    expect(order.indexOf("close")).toBe(row.closedAfterReads);
  });

  it("waits out nothing for a container that was already there: Finish setup on a Mate made before", async () => {
    let reads = 0;
    const { platform, calls } = fakePlatform({
      importDevelopmentContainer: async () => ({ serviceName: "zcp", imported: false }),
      readProjectEnvWrites: async () => {
        reads += 1;
        return [];
      },
    });
    const steps = plan("dev");
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps,
      platform,
      resume: {
        from: steps.findIndex((step) => step.kind === "import-container"),
        projectId: "proj-1",
        projectName: "Go Hello World - dev",
      },
      now: () => 0,
      sleep: async () => undefined,
    });
    expect(outcome.ok).toBe(true);
    expect(reads).toBe(1);
    expect(calls).toContain("closeOff:proj-1");
  });

  it("tries the close-off again while the project's variables have not all appeared", async () => {
    let attempts = 0;
    const { platform } = fakePlatform({
      closeOff: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("This project's variables have not all appeared yet");
      },
    });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("names the close-off as the step that stopped, keeping the project, once its tries are spent", async () => {
    const { platform, calls } = fakePlatform({
      closeOff: () => Promise.reject(new Error("refused")),
    });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({
      ok: false,
      projectId: "proj-1",
      failedStep: { kind: "close-off" },
      error: "refused",
    });
    expect(calls.some((call) => call.startsWith("register:"))).toBe(false);
  });
});

describe("runEnvironmentCreation — a press tried again", () => {
  it("resumes at the step that stopped, on the project the first press made", async () => {
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
    expect(calls).toEqual(["envWrites:proj-1", "closeOff:proj-1", "register:proj-1"]);
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
