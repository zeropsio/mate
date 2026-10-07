import { describe, expect, it } from "vite-plus/test";

import type { OperationIntent } from "../data/model.ts";
import type { RunToEnd } from "../data/operations/runToEnd.ts";
import { ZeropsApiError } from "./api.ts";
import { planEnvironmentCreation, type EnvironmentCreationStep } from "./createEnvironment.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import {
  resumableEnvironmentCreationStep,
  runEnvironmentCreation,
  servicesSettled,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
} from "./runEnvironmentCreation.ts";

/** A tier as `main` holds it: a runtime built from the group's own repository, and a database. */
const TIER_YAML =
  "services:\n  - hostname: api\n    buildFromGit: https://hq.test/git/acme/api.git\n    zeropsSetup: api\n  - hostname: db\n    type: postgresql@17\n";
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
  });
  if (!result.ok) throw new Error(result.reason);
  return result.steps;
}

/**
 * The Zerops writes a creation runs, each as its operation would end: the project's id once
 * Zerops took it, then its end (a failed `project.create` is a rejection here).
 */
interface FakeWrites {
  readonly createProject: (input: {
    readonly name: string;
    readonly tagList: ReadonlyArray<string>;
  }) => Promise<{ readonly id: string }>;
  /** The created project's own end, after Zerops took it. */
  readonly projectCreated: (projectId: string) => Promise<void>;
  readonly importDevelopmentContainer: (input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly agents: ReadonlyArray<string>;
    readonly setupRuntimesYaml?: string;
  }) => Promise<{
    readonly serviceName: string;
    readonly imported: boolean;
    readonly processId?: string;
  }>;
  readonly importServices: (projectId: string, yaml: string) => Promise<unknown>;
  readonly importProject: (yaml: string) => Promise<{ readonly projectId: string }>;
  /** The project read, closed off where it is not, and read back closed off. */
  readonly harden: (projectId: string) => Promise<void>;
}

type FakeOverrides = Partial<FakeWrites> & Partial<Omit<EnvironmentCreationPlatform, "run">>;

/** A platform that records what it was asked and answers as the live one does. */
function fakePlatform(overrides: FakeOverrides = {}) {
  const calls: Array<string> = [];
  const writes: FakeWrites = {
    createProject: (input) => {
      calls.push(`create:${input.name}:${input.tagList.join(",")}`);
      return Promise.resolve({ id: "proj-1" });
    },
    projectCreated: () => Promise.resolve(),
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
    importProject: (yaml) => {
      calls.push(`importProject:${yaml.length}`);
      return Promise.resolve({ projectId: "proj-1" });
    },
    harden: (projectId) => {
      calls.push(`harden:${projectId}`);
      return Promise.resolve();
    },
    ...overrides,
  };
  const runWrite = (async (intent: OperationIntent, options: Parameters<RunToEnd>[1]) => {
    switch (intent.kind) {
      case "create-project": {
        const { id } = await writes.createProject(intent);
        (options.accepted as ((result: { projectId: string }) => void) | undefined)?.({
          projectId: id,
        });
        await writes.projectCreated(id);
        return { projectId: id };
      }
      case "import-project":
        return writes.importProject(intent.yaml);
      case "import-services":
        await writes.importServices(intent.projectId, intent.yaml);
        return undefined;
      case "import-container":
        return writes.importDevelopmentContainer(intent);
      case "harden-project":
        await writes.harden(intent.projectId);
        return { keyNotLowered: null };
      default:
        throw new Error(`No ${intent.kind} in a creation.`);
    }
  }) as RunToEnd;
  const platform: EnvironmentCreationPlatform = {
    run: runWrite,
    markClosedOff: (projectId) => {
      calls.push(`closedOff:${projectId}`);
      return Promise.resolve();
    },
    register: (projectId) => {
      calls.push(`register:${projectId}`);
      return Promise.resolve();
    },
    untilServicesSettled: (projectId) => {
      calls.push(`services:${projectId}`);
      return Promise.resolve([
        { name: "app", status: "ACTIVE" },
        { name: "db", status: "ACTIVE" },
      ]);
    },
    ...(overrides.markClosedOff === undefined ? {} : { markClosedOff: overrides.markClosedOff }),
    ...(overrides.register === undefined ? {} : { register: overrides.register }),
    ...(overrides.untilServicesSettled === undefined
      ? {}
      : { untilServicesSettled: overrides.untilServicesSettled }),
  };
  return { platform, calls };
}

function run(
  steps: ReadonlyArray<EnvironmentCreationStep>,
  platform: EnvironmentCreationPlatform,
  extra: { readonly isCurrent?: () => boolean } = {},
) {
  const reports: Array<ReadonlyArray<EnvironmentCreationStepProgress>> = [];
  let tick = 0;
  return runEnvironmentCreation({
    clientId: "client-1",
    steps,
    platform,
    ...(extra.isCurrent === undefined ? {} : { isCurrent: extra.isCurrent }),
    onProgress: (progress) => reports.push(progress),
    now: () => (tick += 1000),
  }).then((outcome) => ({ outcome, reports }));
}

describe("runEnvironmentCreation", () => {
  it.each<{ readonly case: string; readonly cause: unknown; readonly uncertain: boolean }>([
    {
      case: "a project the platform may have made anyway",
      cause: new ZeropsApiError("Zerops may have created it.", "uncertain"),
      uncertain: true,
    },
    {
      case: "a project the platform refused",
      cause: new ZeropsApiError("No room.", "forbidden", 403),
      uncertain: false,
    },
  ])("says whether a stop is certain: $case", async ({ cause, uncertain }) => {
    const { platform } = fakePlatform({ createProject: () => Promise.reject(cause) });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({ ok: false, projectId: undefined });
    expect(outcome.ok === false && outcome.uncertain === true).toBe(uncertain);
  });

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

  it("stops at the services' wait when the account closes during it", async () => {
    let current = true;
    const { platform } = fakePlatform({
      untilServicesSettled: async () => {
        current = false;
        return [{ name: "app", status: "ACTIVE" }];
      },
    });
    const { outcome } = await run(plan("prod"), platform, { isCurrent: () => current });
    expect(outcome).toMatchObject({ ok: false, error: "This account session has ended." });
  });

  it.each(["create-project", "import-project", "import-container", "close-off"] as const)(
    "keeps the original handles but sends no setup continuation after logout during %s",
    async (kind) => {
      let current = true;
      const continuations: string[] = [];
      const { platform } = fakePlatform({
        createProject: async () => {
          current = false;
          return { id: "proj-1" };
        },
        importProject: async () => {
          current = false;
          return { projectId: "proj-1" };
        },
        importDevelopmentContainer: async () => {
          current = false;
          return { serviceName: "zcp", imported: true, processId: "original-import" };
        },
        harden: async () => {
          current = false;
        },
        markClosedOff: async () => {
          continuations.push("mark-closed-off");
        },
      });
      const steps: ReadonlyArray<EnvironmentCreationStep> =
        kind === "create-project"
          ? [{ kind, name: "Shop - Nova", tagList: [], location: undefined }]
          : kind === "import-project"
            ? [{ kind, name: "Shop - Nova", yaml: MANAGED_YAML, tagList: [] }]
            : kind === "import-container"
              ? [{ kind, agents: [] }]
              : [{ kind }];
      const outcome = await runEnvironmentCreation({
        clientId: "client-1",
        steps,
        platform,
        isCurrent: () => current,
        ...(kind === "import-container" || kind === "close-off"
          ? { resume: { from: 0, projectId: "proj-1", projectName: "Shop - Nova" } }
          : {}),
        onProjectAccepted: async () => {
          continuations.push("bind-birth");
        },
        onContainerImported: async () => {
          continuations.push("hold-import");
        },
      });
      expect(outcome).toMatchObject({
        ok: false,
        projectId: "proj-1",
        error: "This account session has ended.",
      });
      if (kind === "import-container") expect(outcome).toMatchObject({ serviceName: "zcp" });
      expect(continuations).toEqual([]);
    },
  );

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
      // The project's operation ends with its `project.create` process: the step waits for it.
      "create:Go Hello World - dev:mate",
      // The managed services, with the project: nothing in them runs code.
      `import:proj-1:${MANAGED_YAML.length}`,
      // Its record in its application before its container: a press that stops after leaves a
      // Mate HQ holds there, which any browser finishes under its name (F6b, 2026-10-03).
      "register:proj-1",
      // The group's agents reach the container import, not just the plan, and the runtimes ride
      // with it for zcp to import on boot: no runtime import of the press's own.
      `container:proj-1:Go Hello World - dev:claude-code:${"services:\n  - hostname: api\n    startWithoutCode: true\n".length}`,
      // Hardened — read closed, closed off where it was not, read back — and marked: zcp imports
      // the runtimes on the mark alone, and the Mate needs no browser any more.
      "harden:proj-1",
      "closedOff:proj-1",
    ]);
  });

  it("imports a stage's or a production's tier whole, every runtime empty for HQ", async () => {
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
      ["register", "done"],
      ["import-container", "done"],
      ["close-off", "done"],
      ["await-ready", "running"],
    ]);
  });

  it("hands over at the wait for the agent with no runtimes", async () => {
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
    const { outcome, reports } = await run(plan("prod"), platform);

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
    expect(calls.filter((call) => call.startsWith("services:"))).toEqual(["services:proj-1"]);
    expect(reports.at(-1)!.map((entry) => entry.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("settles on a service created with nothing deployed, and knows it runs nothing", async () => {
    // A cloned buildFromGit service whose build failed sits at
    // READY_TO_DEPLOY for good; waiting on it would only time out.
    const { platform } = fakePlatform({
      untilServicesSettled: () =>
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

  it.each<[string, ReadonlyArray<{ readonly status: string }> | undefined, boolean]>([
    ["not read yet", undefined, false],
    // An import's services appear a beat after it is accepted: none is "not yet", never "done".
    ["none yet", [], false],
    ["one still creating", [{ status: "ACTIVE" }, { status: "CREATING" }], false],
    ["every one active", [{ status: "ACTIVE" }, { status: "ACTIVE" }], true],
    ["one with nothing deployed", [{ status: "READY_TO_DEPLOY" }], true],
  ])("calls services settled only when every one is: %s", (_name, services, settled) => {
    expect(servicesSettled(services)).toBe(settled);
  });

  it("stops at the services' wait where they can no longer be followed", async () => {
    const { platform } = fakePlatform({
      untilServicesSettled: () =>
        Promise.reject(new Error("Zerops' services could not be followed.")),
    });
    const { outcome } = await run(plan("prod"), platform);
    expect(outcome).toMatchObject({
      ok: false,
      failedStep: { kind: "await-ready" },
      error: "Zerops' services could not be followed.",
    });
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
  // `POST /client/{id}/project` answers before anything is built; the project's operation ends
  // with its `project.create` process (`data/operations/createProject.ts`), and the step with it.
  it("fails the step with what ended its project, keeping its id", async () => {
    const { platform, calls } = fakePlatform({
      projectCreated: () => Promise.reject(new Error("unexpected internal server error")),
    });
    const { outcome, reports } = await run(plan("dev"), platform);

    expect(outcome).toEqual({
      ok: false,
      // The half that was made: a project the platform left NEW.
      projectId: "proj-1",
      failedStep: expect.objectContaining({ kind: "create-project" }),
      error: "unexpected internal server error",
    });
    // Nothing after it runs: no container, no token, no import.
    expect(calls).toEqual(["create:Go Hello World - dev:mate"]);
    const last = reports.at(-1)!;
    expect(last[0]).toMatchObject({ state: "failed", error: "unexpected internal server error" });
    expect(last.slice(1).every((entry) => entry.state === "queued")).toBe(true);
  });
});

describe("runEnvironmentCreation — one attempt per step", () => {
  it.each(["importDevelopmentContainer", "markClosedOff", "register", "harden"] as const)(
    "stops on the first failed %s, retaining the project and completed steps",
    async (operation) => {
      let attempts = 0;
      const { platform, calls } = fakePlatform({
        [operation]: async () => {
          attempts += 1;
          throw new Error("Refused.");
        },
      });
      const { outcome, reports } = await run(plan("dev"), platform);
      expect(outcome).toMatchObject({ ok: false, projectId: "proj-1", error: "Refused." });
      expect(attempts).toBe(1);
      const progress = reports.at(-1)!;
      const failed = progress.findIndex((entry) => entry.state === "failed");
      expect(progress.slice(0, failed).every((entry) => entry.state === "done")).toBe(true);
      expect(progress.slice(failed + 1).every((entry) => entry.state === "queued")).toBe(true);
      if (operation === "register")
        expect(calls.some((call) => call.startsWith("container:"))).toBe(false);
    },
  );

  it("retains the imported container when its mark fails and resumes only the stopped step", async () => {
    let marks = 0;
    const { platform, calls } = fakePlatform({
      markClosedOff: async () => {
        marks += 1;
        if (marks === 1) throw new Error("HQ is unavailable.");
      },
    });
    const steps = plan("dev");
    const { outcome } = await run(steps, platform);
    expect(outcome).toMatchObject({
      ok: false,
      projectId: "proj-1",
      serviceName: "zcp",
      failedStep: { kind: "close-off" },
    });
    if (outcome.ok) throw new Error("expected a stop");
    const before = calls.length;
    const resumed = await runEnvironmentCreation({
      clientId: "client-1",
      steps,
      platform,
      resume: {
        from: steps.indexOf(outcome.failedStep),
        projectId: "proj-1",
        projectName: "Go Hello World - dev",
        serviceName: "zcp",
      },
    });
    expect(resumed).toMatchObject({ ok: true, serviceName: "zcp", awaitingAgent: true });
    expect(marks).toBe(2);
    expect(calls.slice(before)).toEqual(["harden:proj-1"]);
  });
});

describe("runEnvironmentCreation — closing the project off", () => {
  // The mark — which zcp imports the runtimes on — is written only after the project reads closed
  // off: its hardening reads it, closes it off where it is not, and reads it back
  // (`data/operations/hardenProject.ts`). One that does not confirm stops for the creator.
  it("marks the project once its hardening confirms it closed off", async () => {
    const { platform, calls } = fakePlatform();
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome.ok).toBe(true);
    expect(calls.slice(-2)).toEqual(["harden:proj-1", "closedOff:proj-1"]);
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
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(calls).toEqual(["closedOff:proj-1"]);
  });

  it("stops unmarked, to be tried again, where the hardening does not confirm it", async () => {
    const { platform, calls } = fakePlatform({
      harden: async () => {
        throw new Error("The project does not read as closed off yet.");
      },
    });
    const { outcome } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({
      ok: false,
      failedStep: { kind: "close-off" },
      error: "The project does not read as closed off yet.",
    });
    if (outcome.ok) throw new Error("expected a stop");
    expect(resumableEnvironmentCreationStep(outcome.failedStep)).toBe(true);
    expect(calls).not.toContain("closedOff:proj-1");
  });

  // A harden's isolation is trusted only where no container came after it: a container imported
  // in the same press brings the recipe's write, which may open the project again.
  it("hardens again a project the harden isolated once a container was imported after it", async () => {
    const { platform, calls } = fakePlatform();
    await runEnvironmentCreation({
      clientId: "client-1",
      steps: [
        { kind: "import-container", agents: [] },
        { kind: "close-off", isolated: true },
      ],
      platform,
      resume: { from: 0, projectId: "proj-1", projectName: "Go Hello World - dev" },
    });
    expect(calls.filter((call) => call === "harden:proj-1").length).toBe(1);
    expect(calls.at(-1)).toBe("closedOff:proj-1");
  });

  it("registers a Mate before its container, and closes it off after", async () => {
    const { platform, calls } = fakePlatform();
    await run(plan("dev"), platform);
    const at = (prefix: string) => calls.findIndex((call) => call.startsWith(prefix));
    expect(at("register:")).toBeLessThan(at("container:"));
    expect(at("container:")).toBeLessThan(at("closedOff:"));
  });

  // A refused registration leaves the accepted project and birth intent for Finish setup.
  it("stops a Mate before its container when its registration is refused", async () => {
    const { platform, calls } = fakePlatform({
      register: async () => {
        throw new Error("Only an owner may register it.");
      },
    });
    const { outcome, reports } = await run(plan("dev"), platform);
    expect(outcome).toMatchObject({
      ok: false,
      projectId: "proj-1",
      failedStep: { kind: "register" },
    });
    expect(calls.some((call) => call.startsWith("container:proj-1"))).toBe(false);
    expect(calls).not.toContain("closedOff:proj-1");
    expect(reports.at(-1)!.find((entry) => entry.step.kind === "register")).toMatchObject({
      state: "failed",
      error: "Only an owner may register it.",
    });
  });

  it.each([
    { what: "a Mate", role: "dev" },
    { what: "a stage", role: "stage" },
    { what: "a production", role: "prod" },
  ] as const)("stops the press at a refused registration for $what", async ({ role }) => {
    const { platform } = fakePlatform({
      register: async () => {
        throw new Error("Only an owner may register it.");
      },
    });
    const { outcome } = await run(plan(role), platform);
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
    });
    expect(outcome).toMatchObject({ ok: true, projectId: "proj-1" });
    // From its registration on: its container and its close-off after it, on the same project.
    expect(calls).toEqual([
      "register:proj-1",
      `container:proj-1:Go Hello World - dev:claude-code:${"services:\n  - hostname: api\n    startWithoutCode: true\n".length}`,
      "harden:proj-1",
      "closedOff:proj-1",
    ]);
  });

  it("resumed at its close-off, hardens it once, then marks it", async () => {
    const { platform, calls } = fakePlatform();
    const steps = plan("dev");
    const from = steps.findIndex((step) => step.kind === "close-off");
    const outcome = await runEnvironmentCreation({
      clientId: "client-1",
      steps,
      platform,
      resume: { from, projectId: "proj-1", projectName: "Go Hello World - dev" },
    });
    expect(outcome).toMatchObject({ ok: true, projectId: "proj-1" });
    expect(calls).toEqual(["harden:proj-1", "closedOff:proj-1"]);
  });

  it("says the project the press made the moment the platform takes it", async () => {
    const { platform } = fakePlatform();
    const accepted: Array<string> = [];
    await runEnvironmentCreation({
      clientId: "client-1",
      steps: plan("dev"),
      platform,
      onProjectAccepted: (projectId) => {
        accepted.push(projectId);
      },
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

it("waits for HQ to bind the accepted project and retains its handle when binding fails", async () => {
  const { platform, calls } = fakePlatform();
  const binding = Promise.reject(new Error("HQ bind failed"));
  // Attach a handler before the runner receives it, so RED observes the missing await explicitly.
  void binding.catch(() => undefined);
  const outcome = await runEnvironmentCreation({
    clientId: "client-1",
    steps: plan("dev"),
    platform,
    onProjectAccepted: () => binding,
  });
  expect(outcome).toMatchObject({
    ok: false,
    projectId: "proj-1",
    failedStep: { kind: "create-project" },
    error: "HQ bind failed",
  });
  expect(calls).toHaveLength(1);
});
