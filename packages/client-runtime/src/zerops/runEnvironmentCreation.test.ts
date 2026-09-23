import { describe, expect, it } from "vite-plus/test";

import { planEnvironmentCreation, type EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import {
  runEnvironmentCreation,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
} from "./runEnvironmentCreation.ts";

/** A tier already converted to import-ready form (`recipeTier.ts`). */
const TIER_YAML = "services:\n  - hostname: api\n    startWithoutCode: true\n";

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
      sources: {},
    },
    role,
    agents: ["claude-code"],
    ...(role === "prod" ? {} : { botName: "Ada" }),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.steps;
}

/** The token the platform mints with the container, as it mints it. */
const MINTED_TOKEN = {
  id: "tok-mate",
  name: "zcp-Go Hello World - dev",
  projects: [{ projectId: "proj-1", roleCode: "ADMIN" }],
} as const;

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
      calls.push(`container:${input.projectId}:${input.agents.join("|")}`);
      return Promise.resolve({ serviceName: "zcp" });
    },
    importServices: (projectId, yaml) => {
      calls.push(`import:${projectId}:${yaml.length}`);
      return Promise.resolve({});
    },
    importProject: (input) => {
      calls.push(`importProject:${input.yaml.length}`);
      return Promise.resolve({ projectId: "proj-1" });
    },
    listIntegrationTokenGrants: ({ clientId }) => {
      calls.push(`tokens:${clientId}`);
      return Promise.resolve([MINTED_TOKEN]);
    },
    setIntegrationTokenProjects: (input) => {
      calls.push(
        `token:${input.tokenId}:${input.projects.map((grant) => `${grant.projectId}=${grant.roleCode}`).join(",")}`,
      );
      return Promise.resolve();
    },
    listTokenDelegations: ({ tokenId }) => {
      calls.push(`delegations:${tokenId}`);
      return Promise.resolve([{ id: "del-1", tokenId }]);
    },
    deleteTokenDelegation: ({ tokenId, delegationId }) => {
      calls.push(`delegation:${tokenId}:${delegationId}`);
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
  return runEnvironmentCreation({
    clientId: "client-1",
    steps,
    platform,
    ...(extra.isCurrent === undefined ? {} : { isCurrent: extra.isCurrent }),
    onProgress: (progress) => reports.push(progress),
    now: () => extra.clockMs?.[tick++] ?? tick * 1000,
    sleep: (ms) => {
      slept.push(ms);
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
      "create:Go Hello World - dev:mate:g:7k2m9qx4vb1c,mate:role:dev,mate:name:Go Hello World,mate,mate:bot:Ada",
      // The 200 is an acceptance; the platform's `project.create` process is
      // the creation, and the step is not done until it has finished.
      "creation:proj-1",
      // The group's agents reach the container import, not just the plan.
      "container:proj-1:claude-code",
      "tokens:client-1",
      "token:tok-mate:proj-1=BASIC_USER",
      // The token list is read once and shared by the two steps that need it.
      "delegations:tok-mate",
      "delegation:tok-mate:del-1",
      // Before the application import: no app container and no build ever
      // boots holding the Mate's key or its agent's login.
      `import:proj-1:${TIER_YAML.length}`,
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
    expect(last.map((entry) => entry.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "running",
    ]);
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
    expect(reports.at(-1)!.map((entry) => entry.state)).toEqual(["done", "done", "done"]);
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
      failedStep: expect.objectContaining({ kind: "import-recipe" }),
      error: "projectImportProjectIncluded",
    });
    // Nothing after the failure runs.
    expect(calls.some((call) => call.startsWith("services:"))).toBe(false);
    const last = reports.at(-1)!;
    expect(last.map((entry) => entry.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "failed",
      "queued",
    ]);
    expect(last[4]?.error).toBe("projectImportProjectIncluded");
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
    expect(calls).toContain("container:proj-1:claude-code");
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
    expect(calls).toEqual([
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

describe("runEnvironmentCreation — securing the container's token", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly tokens: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly projects?: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>;
    }>;
    readonly write: string | null;
    readonly ok: boolean;
  }> = [
    {
      name: "lowers the token the container import just minted",
      tokens: [MINTED_TOKEN],
      write: "token:tok-mate:proj-1=BASIC_USER",
      ok: true,
    },
    {
      name: "writes nothing when the platform already minted it lowered",
      tokens: [{ ...MINTED_TOKEN, projects: [{ projectId: "proj-1", roleCode: "BASIC_USER" }] }],
      write: null,
      ok: true,
    },
    {
      name: "lowers this project's token, not another Mate's",
      tokens: [
        {
          id: "tok-elsewhere",
          name: "zcp-Aurora",
          projects: [{ projectId: "p-9", roleCode: "ADMIN" }],
        },
        MINTED_TOKEN,
      ],
      write: "token:tok-mate:proj-1=BASIC_USER",
      ok: true,
    },
    {
      name: "fails rather than report a Mate secured whose token it never found",
      tokens: [{ id: "tok-owner", name: "personal" }],
      write: null,
      ok: false,
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const { platform, calls } = fakePlatform({
      listIntegrationTokenGrants: () => Promise.resolve(row.tokens as never),
    });
    const { outcome } = await run(plan("dev"), platform);

    expect(outcome.ok).toBe(row.ok);
    expect(calls.filter((call) => call.startsWith("token:"))).toEqual(
      row.write === null ? [] : [row.write],
    );
    if (!outcome.ok) {
      expect(outcome.failedStep.kind).toBe("secure-container-token");
      // The half that exists is still named, so the user is not left guessing.
      expect(outcome.projectId).toBe("proj-1");
    }
  });
});

describe("runEnvironmentCreation — dropping the container's delegation", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly delegations: ReadonlyArray<{ readonly id: string; readonly tokenId: string }>;
    readonly deleted: ReadonlyArray<string>;
  }> = [
    {
      name: "deletes the one the container import granted",
      delegations: [{ id: "del-1", tokenId: "tok-mate" }],
      deleted: ["delegation:tok-mate:del-1"],
    },
    {
      name: "tolerates a Mate that was granted none",
      delegations: [],
      deleted: [],
    },
    {
      name: "deletes every one it finds, not just the first",
      delegations: [
        { id: "del-1", tokenId: "tok-mate" },
        { id: "del-2", tokenId: "tok-mate" },
      ],
      deleted: ["delegation:tok-mate:del-1", "delegation:tok-mate:del-2"],
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const { platform, calls } = fakePlatform({
      listTokenDelegations: () => Promise.resolve(row.delegations),
    });
    const { outcome } = await run(plan("dev"), platform);

    expect(outcome.ok).toBe(true);
    // Exactly this token's delegations, and only through the delete call.
    expect(calls.filter((call) => call.startsWith("delegation:"))).toEqual(row.deleted);
  });

  it("stops the creation when the delegation cannot be taken back", async () => {
    // A Mate left holding a one-time mint can name its creator as the person
    // who granted it — the exact claim the door trusts — so this is not a
    // failure worth swallowing.
    const { platform } = fakePlatform({
      deleteTokenDelegation: () => Promise.reject(new Error("insufficientPermissions")),
    });
    const { outcome } = await run(plan("dev"), platform);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failedStep.kind).toBe("drop-container-delegation");
  });
});
