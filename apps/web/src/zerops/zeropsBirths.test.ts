import {
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
  applyProjectTagPatch,
  sameProjectTags,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type ProjectRef,
  type ProjectTagPatch,
  type ProjectTagWrite,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import {
  birthStepFailure,
  bornOnAccept,
  importedContainer,
  placedBirthsIn,
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
  placement: null,
};

/**
 * The account's runtime as far as a birth writes tags with it: `updateProjectTags` over the Gitea
 * project's list, each patch applied to the list as it is now.
 */
function fakeRuntime(
  calls: Array<string>,
  onWrite: () => void = () => undefined,
  initial: ReadonlyArray<string> = ["mate:tool:gitea", "mate:gn:group-1:todo"],
) {
  let tagList = initial;
  return {
    commands: {
      updateProjectTags: (project: ProjectRef, patch: ProjectTagPatch) =>
        Effect.sync(() => {
          const read = { id: project.projectId, name: "Gitea", status: "ACTIVE", tagList };
          const next = applyProjectTagPatch(tagList, patch);
          let value: ProjectTagWrite;
          if (!next.ok) value = { kind: "refused", refusal: next.refusal, project: read };
          else if (sameProjectTags(next.tags, tagList))
            value = { kind: "unchanged", project: read };
          else {
            tagList = next.tags;
            value = { kind: "written", project: { ...read, tagList } };
          }
          calls.push(`${value.kind} ${patch.kind} on ${project.projectId}`);
          onWrite();
          return { attempt: null, value };
        }),
    },
  };
}

function fakeClient(calls: Array<string>) {
  const broker: ZeropsIntegrationToken = { id: "broker-1", name: "mate-broker", projects: [] };
  return {
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
      runtime: fakeRuntime(calls),
      projectRef,
    } as unknown as BirthInputs;
    const ports = webBirthPorts(
      () => inputs,
      () => true,
    );

    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(await ports.writeRegistry(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual([
      "written registry-member on gitea-1",
      "list tokens of org-1",
      "grant project-1 in org-1",
    ]);

    // Run again — a reload between the writes — it writes nothing twice.
    calls.length = 0;
    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(calls).toEqual(["unchanged registry-member on gitea-1"]);
  });

  it("waits for a group whose own registry write has not landed, and fails on a contradiction", async () => {
    const calls: Array<string> = [];
    const inputs = {
      client: fakeClient(calls),
      runtime: fakeRuntime(calls),
      projectRef,
    } as unknown as BirthInputs;
    const ports = webBirthPorts(
      () => inputs,
      () => true,
    );

    expect(
      await ports.writeTags({
        ...birth,
        registration: { ...birth.registration!, groupId: "group-new" },
      }),
    ).toEqual({ kind: "not-yet", reason: "That project is not in the registry yet." });
    expect(await ports.writeTags(birth)).toEqual({ kind: "done" });
    expect(
      await ports.writeTags({
        ...birth,
        registration: { ...birth.registration!, kind: "stage" },
      }),
    ).toMatchObject({ kind: "failed" });
  });
  // A production deleted in the Zerops GUI kept its registry entry, and the creation of the next
  // one said "This project already has a production." (Beviro, 2026-09-24).
  it.each([
    {
      name: "replaces a production the platform says is deleted",
      fetchProject: () =>
        Promise.reject(
          new ZeropsApiError("Project not found.", "not-found", 400, "projectNotFound"),
        ),
      outcome: { kind: "done" },
      calls: ["refused registry-member on gitea-1", "written registry-member on gitea-1"],
    },
    {
      name: "keeps refusing beside a production the platform still has",
      fetchProject: async (id: string) => ({ id, name: id, status: "ACTIVE" }),
      outcome: { kind: "failed", reason: "This project already has a production." },
      calls: ["refused registry-member on gitea-1"],
    },
  ])("$name", async ({ fetchProject, outcome, calls: expected }) => {
    const calls: Array<string> = [];
    const inputs = {
      client: { fetchProject } as unknown as ZeropsApiClient,
      runtime: fakeRuntime(calls, undefined, [
        "mate:tool:gitea",
        "mate:gn:group-1:todo",
        "mate:gm:group-1:project-dead:production",
      ]),
      projectRef,
    } as unknown as BirthInputs;
    const ports = webBirthPorts(
      () => inputs,
      () => true,
    );

    expect(
      await ports.writeTags({
        ...birth,
        registration: { ...birth.registration!, kind: "production" },
      }),
    ).toEqual(outcome);
    expect(calls).toEqual(expected);
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

describe("placedBirthsIn", () => {
  const birth = (over: Partial<BirthRecord>): BirthRecord => ({
    projectId: "project-1",
    organizationId: "org-1",
    startedAt: 5,
    step: "tags",
    overdue: false,
    registration: null,
    container: true,
    serviceId: null,
    origin: null,
    placement: { groupId: "g-1", groupName: "Todo", kind: "mate", displayName: "Vera" },
    ...over,
  });
  it.each([
    {
      name: "a placed birth of the organization in view is its group's pending member",
      births: [birth({ step: "harden", overdue: true })],
      organizationId: "org-1",
      want: [
        {
          projectId: "project-1",
          startedAt: 5,
          placement: { groupId: "g-1", groupName: "Todo", kind: "mate", displayName: "Vera" },
          step: "harden",
          overdue: true,
        },
      ],
    },
    {
      name: "a birth another organization began is not drawn here",
      births: [birth({ organizationId: "org-2" })],
      organizationId: "org-1",
      want: [],
    },
    {
      name: "a birth the listing already places (Set up Mate, a claim) places nothing",
      births: [birth({ placement: null })],
      organizationId: "org-1",
      want: [],
    },
    {
      name: "no organization in view draws none",
      births: [birth({})],
      organizationId: undefined,
      want: [],
    },
  ])("$name", ({ births, organizationId, want }) => {
    expect(placedBirthsIn(births, organizationId)).toEqual(want);
  });
});

describe("the birth's account", () => {
  it("a step its account outlives writes nothing more", async () => {
    const calls: Array<string> = [];
    let current = true;
    // The person signs out while the registry entry is written; somebody else signs in.
    const runtime = fakeRuntime(calls, () => {
      current = false;
    });
    const ports = webBirthPorts(
      () => ({ client: fakeClient(calls), runtime, projectRef }) as unknown as BirthInputs,
      () => current,
    );

    await ports.writeTags(birth);
    expect(await ports.writeRegistry(birth)).toMatchObject({ kind: "not-yet" });
    expect(calls).toEqual(["written registry-member on gitea-1"]);
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
