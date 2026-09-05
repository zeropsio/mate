import { describe, expect, it } from "vite-plus/test";

import { planEnvironmentCreation, type EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import { GO_HELLO_WORLD_GROUP } from "./recipeStoreSeed.ts";
import {
  runEnvironmentCreation,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
} from "./runEnvironmentCreation.ts";

function plan(role: ZeropsEnvironmentRole): ReadonlyArray<EnvironmentCreationStep> {
  const result = planEnvironmentCreation({
    clientId: "client-1",
    groupId: "7k2m9qx4vb1c",
    groupName: "Go Hello World",
    name: `Go Hello World - ${role}`,
    record: GO_HELLO_WORLD_GROUP,
    role,
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
    importDevelopmentContainer: (input) => {
      calls.push(`container:${input.projectId}`);
      return Promise.resolve({ serviceName: "zcp" });
    },
    importServices: (projectId, yaml) => {
      calls.push(`import:${projectId}:${yaml.length}`);
      return Promise.resolve({});
    },
    listServices: (projectId) => {
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
  extra: { readonly clockMs?: Array<number> } = {},
) {
  const reports: Array<ReadonlyArray<EnvironmentCreationStepProgress>> = [];
  const slept: Array<number> = [];
  let tick = 0;
  return runEnvironmentCreation({
    clientId: "client-1",
    steps,
    platform,
    onProgress: (progress) => reports.push(progress),
    now: () => extra.clockMs?.[tick++] ?? tick * 1000,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    pollIntervalMs: 7,
    serviceWaitCapMs: 100_000,
  }).then((outcome) => ({ outcome, reports, slept }));
}

describe("runEnvironmentCreation", () => {
  it("runs the platform calls in the plan's order, feeding each the project it made", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: true,
      projectId: "proj-1",
      serviceName: "zcp",
      awaitingAgent: true,
      undeployed: [],
    });
    expect(calls).toEqual([
      "create:Go Hello World - dev:mate:g:7k2m9qx4vb1c,mate:role:dev,mate:name:Go Hello World,mate:bot:Ada",
      "container:proj-1",
      `import:proj-1:${GO_HELLO_WORLD_GROUP.recipes.dev?.length}`,
    ]);
  });

  it("hands an environment with an agent back without waiting on the container", async () => {
    // The provisioning state machine owns that wait; a second one here would
    // be a second opinion about when a container is ready.
    const { platform, calls } = fakePlatform();
    const { outcome, reports } = await run(plan("dev"), platform);

    expect(outcome.ok && outcome.awaitingAgent).toBe(true);
    expect(calls.some((call) => call.startsWith("services:"))).toBe(false);
    const last = reports.at(-1)!;
    expect(last.map((entry) => entry.state)).toEqual(["done", "done", "done", "running"]);
  });

  it("waits for every service of an environment without an agent", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome, reports, slept } = await run(plan("prod"), platform);

    expect(outcome).toEqual({
      ok: true,
      projectId: "proj-1",
      serviceName: undefined,
      awaitingAgent: false,
      undeployed: [],
    });
    expect(calls.filter((call) => call.startsWith("services:"))).toHaveLength(3);
    expect(slept).toEqual([7, 7]);
    expect(reports.at(-1)!.map((entry) => entry.state)).toEqual(["done", "done", "done"]);
  });

  it("settles on a service created with nothing deployed, and names it", async () => {
    // A cloned buildFromGit service whose build failed sits at
    // READY_TO_DEPLOY for good; waiting on it would only time out.
    const { platform } = fakePlatform({
      listServices: () =>
        Promise.resolve([
          { name: "app", status: "READY_TO_DEPLOY" },
          { name: "db", status: "ACTIVE" },
        ]),
    });
    const { outcome } = await run(plan("prod"), platform);
    expect(outcome).toEqual({
      ok: true,
      projectId: "proj-1",
      serviceName: undefined,
      awaitingAgent: false,
      undeployed: ["app"],
    });
  });

  it("does not call zero services ready", async () => {
    // An import's services appear a beat after it is accepted; an empty read
    // is "not yet", never "done".
    const { platform } = fakePlatform({ listServices: () => Promise.resolve([]) });
    const { outcome } = await run(plan("prod"), platform, {
      clockMs: [0, 0, 0, 0, 0, 0, 0, 200_000, 200_000, 200_000],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("never appeared");
  });

  it("gives up on a service wait past its cap, naming what is still pending", async () => {
    const { platform } = fakePlatform({
      listServices: () => Promise.resolve([{ name: "app", status: "CREATING" }]),
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
      failedStep: expect.objectContaining({ kind: "import-recipe" }),
      error: "projectImportProjectIncluded",
    });
    // Nothing after the failure runs.
    expect(calls.some((call) => call.startsWith("services:"))).toBe(false);
    const last = reports.at(-1)!;
    expect(last.map((entry) => entry.state)).toEqual(["done", "done", "failed", "queued"]);
    expect(last[2]?.error).toBe("projectImportProjectIncluded");
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
