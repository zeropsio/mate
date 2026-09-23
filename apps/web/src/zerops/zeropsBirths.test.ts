import {
  parseZeropsRegistry,
  planEnvironmentCreation,
  runEnvironmentCreation,
  ZeropsApiError,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type ZeropsApiClient,
  type ZeropsIntegrationToken,
} from "@t3tools/client-runtime/zerops";
import type { BirthRecord } from "@t3tools/client-runtime/zerops/birth";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import {
  birthStepFailure,
  bornOnAccept,
  importedContainer,
  webBirthPorts,
  type BirthInputs,
} from "./zeropsBirths";

const projectRef = (organizationId: string, projectId: string): ProjectRef => ({
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make(organizationId),
  },
  projectId: ZeropsProjectId.make(projectId),
});

/** A birth begun in org-1: a Mate in the group `group-1` of org-1's registry. */
const birth: BirthRecord = {
  projectId: "project-1",
  organizationId: "org-1",
  startedAt: 1_800_000_000_000,
  step: "tags",
  overdue: false,
  registration: {
    giteaProjectId: "gitea-1",
    giteaOrigin: null,
    groupId: "group-1",
    kind: "mate",
    displayName: "Todo - Vera",
  },
  container: true,
  serviceId: null,
  origin: null,
  handoff: null,
};

function fakeClient(calls: Array<string>) {
  let tagList: ReadonlyArray<string> = ["mate:tool:gitea", "mate:gn:group-1:todo"];
  const broker: ZeropsIntegrationToken = { id: "broker-1", name: "mate-broker", projects: [] };
  return {
    readGroupRegistry: async (giteaProjectId: string) => {
      calls.push(`read registry of ${giteaProjectId}`);
      return parseZeropsRegistry(tagList);
    },
    writeGroupRegistry: async (input: {
      readonly giteaProjectId: string;
      readonly tagList: ReadonlyArray<string>;
    }) => {
      calls.push(`write registry of ${input.giteaProjectId}`);
      tagList = input.tagList;
    },
    listIntegrationTokens: async (clientId: string) => {
      calls.push(`list tokens of ${clientId}`);
      return [broker];
    },
    setIntegrationTokenProjects: async (input: {
      readonly clientId: string;
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
    }) => {
      calls.push(
        `grant ${input.projects.map((project) => project.projectId).join(",")} in ${input.clientId}`,
      );
    },
  } as unknown as ZeropsApiClient;
}

describe("the birth's ports", () => {
  it("makes each group write once, a reload between them included", async () => {
    const calls: Array<string> = [];
    const inputs = {
      client: fakeClient(calls),
      projectRef,
    } as unknown as BirthInputs;
    const ports = webBirthPorts(
      () => inputs,
      () => true,
    );

    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(await ports.writeRegistry(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual([
      "read registry of gitea-1",
      "write registry of gitea-1",
      "list tokens of org-1",
      "grant project-1 in org-1",
    ]);

    // Run again — a reload between the writes — it writes nothing twice.
    calls.length = 0;
    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual(["read registry of gitea-1"]);
  });
});

const SERVICES = "services:\n  - hostname: api\n    startWithoutCode: true\n";

/** A Mate's creation in org-1, with a recipe whose document describes the project or not. */
function matePlan(yaml: string): ReadonlyArray<EnvironmentCreationStep> {
  const plan = planEnvironmentCreation({
    clientId: "org-1",
    groupId: "group-1",
    groupName: "Todo",
    role: "dev",
    name: "Todo - Vera",
    botName: "Vera",
    recipe: { kind: "tier", tier: "mate", yaml, sources: {} },
  });
  if (!plan.ok) throw new Error(plan.reason);
  return plan.steps;
}

/** The platform as it answers a creation, the container import held until `importContainer`. */
function creationPlatform() {
  let importContainer!: (outcome: "accepted" | "refused") => void;
  const containerImport = new Promise<"accepted" | "refused">((resolve) => {
    importContainer = resolve;
  });
  const platform: EnvironmentCreationPlatform = {
    createProject: async () => ({ id: "project-1" }),
    importProject: async () => ({ projectId: "project-1" }),
    readProjectCreation: async () => ({ processId: "process-1", status: "FINISHED", error: null }),
    importDevelopmentContainer: async () => {
      if ((await containerImport) === "refused") throw new Error("The project is out of quota.");
      return { serviceName: "zcp" };
    },
    importServices: async () => ({}),
    listIntegrationTokenGrants: async () => [],
    setIntegrationTokenProjects: async () => undefined,
    listTokenDelegations: async () => [],
    deleteTokenDelegation: async () => undefined,
    readObservedServices: async () => [],
  };
  return { platform, importContainer };
}

describe("a creation's birth", () => {
  it.each([
    { name: "a created project", yaml: SERVICES },
    { name: "a project imported whole", yaml: `project:\n  name: Todo\n${SERVICES}` },
  ])("begins when the platform accepts $name, before its later steps", async ({ yaml }) => {
    const accepted: Array<string> = [];
    const { platform, importContainer } = creationPlatform();
    const steps = matePlan(yaml);
    const creation = runEnvironmentCreation({
      clientId: "org-1",
      steps,
      platform: bornOnAccept(platform, (projectId) => accepted.push(projectId)),
      sleep: async () => undefined,
    });
    // The container import is still on its way: a reload here leaves the birth behind.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(accepted).toEqual(["project-1"]);

    importContainer("refused");
    const outcome = await creation;
    expect(outcome.ok).toBe(false);
    expect(accepted).toEqual(["project-1"]);
    expect(importedContainer(steps, outcome)).toBe(false);
  });

  it.each([
    { name: "a creation that went through", failedAt: null, want: true },
    { name: "one refused at the container import", failedAt: "import-container", want: false },
    { name: "one that failed before it", failedAt: "create-project", want: false },
    { name: "one that failed after it", failedAt: "secure-container-token", want: true },
  ] as const)("$name imported a container: $want", ({ failedAt, want }) => {
    const steps = matePlan(SERVICES);
    const failedStep = steps.find((step) => step.kind === failedAt);
    const outcome =
      failedStep === undefined
        ? ({ ok: true, projectId: "project-1", serviceName: "zcp", awaitingAgent: true } as const)
        : ({ ok: false, projectId: "project-1", failedStep, error: "No." } as const);
    expect(importedContainer(steps, outcome)).toBe(want);
  });
});

describe("the birth's account", () => {
  it("a step its account outlives writes nothing more", async () => {
    const calls: Array<string> = [];
    let current = true;
    const client = fakeClient(calls);
    const readGroupRegistry = client.readGroupRegistry.bind(client);
    // The person signs out while the registry is read; somebody else signs in on the same client.
    client.readGroupRegistry = async (giteaProjectId) => {
      const registry = await readGroupRegistry(giteaProjectId);
      current = false;
      return registry;
    };
    const ports = webBirthPorts(
      () => ({ client, projectRef }) as unknown as BirthInputs,
      () => current,
    );

    expect((await ports.writeTags(birth)).kind).not.toBe("done");
    expect(await ports.writeRegistry(birth)).toMatchObject({ kind: "not-yet" });
    expect(calls).toEqual(["read registry of gitea-1"]);
  });
});

describe("the birth's project read", () => {
  const read = (project: { readonly status: string } | "not-found", creation?: string) => {
    const calls: Array<string> = [];
    const client = {
      fetchProject: async (projectId: string) => {
        calls.push(`project ${projectId}`);
        if (project === "not-found") throw new ZeropsApiError("No such project.", "not-found");
        return { id: projectId, name: "Todo - Vera", clientId: "org-1", ...project };
      },
      listProjectServices: async () => [],
      readProjectCreation: async (input: { readonly clientId: string }) => {
        calls.push(`creation in ${input.clientId}`);
        return creation === undefined ? undefined : { status: creation };
      },
    } as unknown as ZeropsApiClient;
    const ports = webBirthPorts(
      () => ({ client, projectRef }) as unknown as BirthInputs,
      () => true,
    );
    return { calls, reading: ports.readProject(birth) };
  };

  it.each([
    { name: "a removed project is gone", project: "not-found", creation: undefined, want: "gone" },
    {
      name: "a project whose creation failed ends its birth",
      project: { status: "NEW" },
      creation: "FAILED",
      want: "creation-failed",
    },
    {
      name: "a canceled creation ends it too",
      project: { status: "NEW" },
      creation: "CANCELED",
      want: "creation-failed",
    },
    {
      name: "a creation still running is waited on",
      project: { status: "NEW" },
      creation: "RUNNING",
      want: "NEW",
    },
    {
      name: "a creation with no process yet is waited on",
      project: { status: "CREATING" },
      creation: undefined,
      want: "CREATING",
    },
    {
      name: "an active project is read",
      project: { status: "ACTIVE" },
      creation: "FAILED",
      want: "ACTIVE",
    },
  ] as const)("$name", async ({ project, creation, want }) => {
    const { calls, reading } = read(project, creation);
    const outcome = await reading;
    expect(typeof outcome === "string" ? outcome : outcome.project.status).toBe(want);
    // The creation's verdict is read in the project's own organization, and only while it is new.
    expect(calls.filter((call) => call.startsWith("creation"))).toEqual(
      project !== "not-found" && project.status !== "ACTIVE" ? ["creation in org-1"] : [],
    );
  });
});

describe("birthStepFailure", () => {
  const admission = (reason: string) => ({
    _tag: "ZeropsCommandAdmissionError",
    reason,
    message: "Platform write access is not verified.",
  });
  const adapter = (kind: string, retryable: boolean) => ({
    _tag: "ZeropsDataAdapterError",
    kind,
    message: "The platform said no.",
    retryable,
    accountRevocationEvidence: false,
  });
  // Only what a later attempt can get past is waited out: the account mid-verification or between
  // grants, a busy runtime, the platform not caught up, the network. An answer is an answer.
  it.each([
    {
      name: "the account mid-verification",
      cause: admission("access-unverified"),
      want: "not-yet",
    },
    { name: "the account between grants", cause: admission("access-expired"), want: "not-yet" },
    { name: "a full command queue", cause: admission("command-capacity"), want: "not-yet" },
    { name: "a denial", cause: admission("access-denied"), want: "failed" },
    { name: "a closed runtime", cause: admission("runtime-closed"), want: "failed" },
    { name: "variables not caught up", cause: adapter("uncertain", false), want: "not-yet" },
    { name: "a retryable adapter failure", cause: adapter("server", true), want: "not-yet" },
    { name: "a refused adapter write", cause: adapter("forbidden", false), want: "failed" },
    {
      name: "the network",
      cause: new ZeropsApiError("Could not reach Zerops.", "network"),
      want: "not-yet",
    },
    {
      name: "a refused API write",
      cause: new ZeropsApiError("Only owners write tags.", "forbidden"),
      want: "failed",
    },
  ])("$name: $want", ({ cause, want }) => {
    expect(birthStepFailure(cause).kind).toBe(want);
  });
});
