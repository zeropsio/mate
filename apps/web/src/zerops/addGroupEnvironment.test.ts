import { describe, expect, it, vi } from "vite-plus/test";

import { parseZeropsRegistry, type GiteaClient } from "@t3tools/client-runtime/zerops";

import { addGroupEnvironment } from "./addGroupEnvironment";

const REGISTRY = parseZeropsRegistry(["mate:tool:gitea", "mate:gn:g-1:acme"]);

const STAGE = {
  displayName: "Acme - stage",
  tier: "stage" as const,
  project: "p-stage",
};

function giteaFake(overrides: Partial<GiteaClient> = {}): GiteaClient {
  return {
    origin: "https://gitea.test",
    readFile: vi.fn().mockResolvedValue(undefined),
    changeFiles: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn(async (_owner: string, _repo: string, name: string) =>
      name === "main" ? { name: "main", user_can_merge: false } : undefined,
    ),
    listPullRequests: vi.fn().mockResolvedValue([]),
    createPullRequest: vi.fn().mockResolvedValue({ number: 12, title: "t", state: "open" }),
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as GiteaClient;
}

function apiFake(overrides: Record<string, unknown> = {}) {
  return {
    writeGroupRegistry: vi.fn().mockResolvedValue({ id: "p-gitea" }),
    listIntegrationTokens: vi.fn().mockResolvedValue([
      {
        id: "t-2",
        name: "mate-broker",
        roleCode: "READ_ONLY",
        projects: [{ projectId: "p-gitea", roleCode: "BASIC_USER" }],
      },
    ]),
    setIntegrationTokenProjects: vi.fn().mockResolvedValue(undefined),
    listProjectServices: vi.fn().mockResolvedValue([{ id: "svc-broker", name: "broker" }]),
    listServiceVariableNames: vi.fn().mockResolvedValue(["MATE_ZEROPS_TOKEN"]),
    mintIntegrationToken: vi.fn().mockResolvedValue({ id: "t-deploy", token: "the-stage-key" }),
    writeServiceSecret: vi.fn().mockResolvedValue(undefined),
    deleteIntegrationToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const base = (api: ReturnType<typeof apiFake>, gitea: GiteaClient | null) => ({
  client: api as never,
  gitea,
  clientId: "org-1",
  giteaProjectId: "p-gitea",
  registry: REGISTRY,
  groupId: "g-1",
  slug: "acme",
  environment: STAGE,
});

describe("addGroupEnvironment", () => {
  it("writes the registry, the broker's grant and the environments document, in that order", async () => {
    const api = apiFake();
    const gitea = giteaFake();
    const outcome = await addGroupEnvironment(base(api, gitea));

    expect(outcome.done).toEqual([
      "registry",
      "broker-grant",
      "deploy-token",
      "environments-document",
    ]);
    expect(outcome.failed).toBeUndefined();
    expect(api.writeGroupRegistry).toHaveBeenCalledWith(
      {
        giteaProjectId: "p-gitea",
        tagList: ["mate:gm:g-1:p-stage:stage", "mate:gn:g-1:acme", "mate:tool:gitea"],
      },
      undefined,
    );
  });

  it("adds the broker's grant without touching the rest, or its org role", async () => {
    const api = apiFake();
    await addGroupEnvironment(base(api, giteaFake()));

    expect(api.setIntegrationTokenProjects).toHaveBeenCalledWith(
      {
        clientId: "org-1",
        tokenId: "t-2",
        name: "mate-broker",
        // The Gitea project's grant survives; the new one is added at BASIC_USER.
        projects: [
          { projectId: "p-gitea", roleCode: "BASIC_USER" },
          { projectId: "p-stage", roleCode: "BASIC_USER" },
        ],
        roleCode: "READ_ONLY",
      },
      undefined,
    );
    // The write carries the token's id, its name, its grants and its role —
    // and no `value`/`token` field, because nothing ever reads one.
    const [body] = api.setIntegrationTokenProjects.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual([
      "clientId",
      "name",
      "projects",
      "roleCode",
      "tokenId",
    ]);
  });

  it("writes nothing to the broker when it already reaches the project", async () => {
    const api = apiFake({
      listIntegrationTokens: vi.fn().mockResolvedValue([
        {
          id: "t-2",
          name: "mate-broker",
          projects: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
        },
      ]),
    });
    const outcome = await addGroupEnvironment(base(api, giteaFake()));

    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
    expect(outcome.done).toContain("broker-grant");
  });

  it("opens a pull request on a branch of its own and leaves it for a releaser", async () => {
    const gitea = giteaFake();
    const outcome = await addGroupEnvironment(base(apiFake(), gitea));

    expect(gitea.changeFiles).toHaveBeenCalledWith("acme", "group", {
      message: "Add the acme-stage stage environment",
      branch: "main",
      newBranch: "mate-app/env-acme-stage",
      files: [
        {
          operation: "create",
          path: "environments.yaml",
          content:
            "version: 1\nenvironments:\n  acme-stage:\n    tier: stage\n    project: p-stage\n    sources: [main]\n    deploy: on-push\n",
        },
      ],
    });
    expect(gitea.createPullRequest).toHaveBeenCalledWith("acme", "group", {
      head: "mate-app/env-acme-stage",
      base: "main",
      title: "Add the acme-stage stage environment",
    });
    expect(gitea.mergePullRequest).not.toHaveBeenCalled();
    expect(outcome.pullRequest).toEqual({ number: 12, merged: false });
  });

  it("merges it at once when Gitea says this person may", async () => {
    const gitea = giteaFake({
      getBranch: vi.fn().mockResolvedValue({ name: "main", user_can_merge: true }),
    });
    const outcome = await addGroupEnvironment(base(apiFake(), gitea));

    expect(gitea.mergePullRequest).toHaveBeenCalledWith("acme", "group", 12);
    expect(outcome.pullRequest).toEqual({ number: 12, merged: true });
  });

  it("updates an existing document, quoting the blob it read", async () => {
    const gitea = giteaFake({
      readFile: vi.fn().mockResolvedValue({
        path: "environments.yaml",
        sha: "blob-1",
        content:
          "version: 1\nenvironments:\n  production:\n    tier: production\n    project: p-prod\n    sources: release\n",
      }),
    });
    await addGroupEnvironment(base(apiFake(), gitea));

    const [, , change] = (gitea.changeFiles as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(change.files[0].operation).toBe("update");
    expect(change.files[0].sha).toBe("blob-1");
    expect(change.files[0].content).toContain("  production:");
    expect(change.files[0].content).toContain("  acme-stage:");
  });

  it("refuses a second production before it writes anything", async () => {
    const api = apiFake();
    const gitea = giteaFake({
      readFile: vi.fn().mockResolvedValue({
        path: "environments.yaml",
        sha: "blob-1",
        content:
          "environments:\n  production:\n    tier: production\n    project: p-prod\n    sources: release\n",
      }),
    });
    const outcome = await addGroupEnvironment({
      ...base(api, gitea),
      environment: {
        ...STAGE,
        displayName: "Acme - production",
        tier: "production" as const,
        project: "p-prod-2",
      },
    });

    expect(outcome.failed).toEqual({
      step: "environments-document",
      reason: "This project already has a production.",
    });
    expect(gitea.changeFiles).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "the registry write",
      patch: {
        writeGroupRegistry: vi.fn().mockRejectedValue(new Error("Only owners write tags.")),
      },
      step: "registry",
      reason: "Only owners write tags.",
      done: [],
    },
    {
      name: "an account with no broker yet",
      patch: { listIntegrationTokens: vi.fn().mockResolvedValue([]) },
      step: "broker-grant",
      reason: "This account has no broker to deploy with yet.",
      done: ["registry"],
    },
    {
      name: "a deploy key the platform would not mint",
      patch: {
        mintIntegrationToken: vi.fn().mockRejectedValue(new Error("Only admins mint tokens.")),
      },
      step: "deploy-token",
      reason: "Only admins mint tokens.",
      done: ["registry", "broker-grant"],
    },
  ])("stops at $name and says which step", async ({ patch, step, reason, done }) => {
    const outcome = await addGroupEnvironment(base(apiFake(patch), giteaFake()));
    expect(outcome.failed).toEqual({ step, reason });
    expect(outcome.done).toEqual(done);
  });

  it("keeps the project when nobody is signed in to Gitea yet", async () => {
    const outcome = await addGroupEnvironment(base(apiFake(), null));
    expect(outcome.done).toEqual(["registry", "broker-grant", "deploy-token"]);
    expect(outcome.failed?.step).toBe("environments-document");
  });
});

describe("the environment's deploy token (D27)", () => {
  it("is minted for that one project and written on the broker's service, before the declaration", async () => {
    const api = apiFake();
    const gitea = giteaFake();
    await addGroupEnvironment(base(api, gitea));

    expect(api.mintIntegrationToken).toHaveBeenCalledWith(
      {
        clientId: "org-1",
        name: `deploy-${STAGE.displayName}`,
        roleCode: "NO_ACCESS",
        projects: [{ projectId: STAGE.project, roleCode: "BASIC_USER" }],
      },
      undefined,
    );
    const [secret] = api.writeServiceSecret.mock.calls[0] as [Record<string, string>];
    expect(secret.serviceId).toBe("svc-broker");
    expect(secret.key).toMatch(/^MATE_DEPLOY_TOKEN_[0-9A-F]+$/u);
    expect(secret.content).toBe("the-stage-key");
    expect(api.writeServiceSecret.mock.invocationCallOrder[0]).toBeLessThan(
      (gitea.changeFiles as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("is left alone when the broker already holds it", async () => {
    const { deployTokenVariable } = await import("@t3tools/client-runtime/zerops");
    const api = apiFake({
      listServiceVariableNames: vi.fn().mockResolvedValue([deployTokenVariable(STAGE.project)]),
    });
    const outcome = await addGroupEnvironment(base(api, giteaFake()));
    expect(outcome.failed).toBeUndefined();
    expect(api.mintIntegrationToken).not.toHaveBeenCalled();
  });

  it("is taken back when the broker could not be given it", async () => {
    const api = apiFake({
      writeServiceSecret: vi.fn().mockRejectedValue(new Error("The service is not ready.")),
    });
    const outcome = await addGroupEnvironment(base(api, giteaFake()));
    expect(outcome.failed).toEqual({ step: "deploy-token", reason: "The service is not ready." });
    expect(api.deleteIntegrationToken).toHaveBeenCalledWith(
      { clientId: "org-1", tokenId: "t-deploy" },
      undefined,
    );
  });

  it("stops where an account's Gitea project has no broker service", async () => {
    const api = apiFake({
      listProjectServices: vi.fn().mockResolvedValue([{ id: "svc-web", name: "web" }]),
    });
    const outcome = await addGroupEnvironment(base(api, giteaFake()));
    expect(outcome.failed?.step).toBe("deploy-token");
    expect(api.mintIntegrationToken).not.toHaveBeenCalled();
  });
});

describe("a project already declared", () => {
  it("declares nothing twice — the write run again is a no-op past the registry and the grant", async () => {
    const gitea = giteaFake({
      readFile: vi.fn().mockResolvedValue({
        sha: "abc",
        content: `version: 1
environments:
  acme-stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
`,
      }),
    });
    const outcome = await addGroupEnvironment(base(apiFake(), gitea));
    expect(outcome.failed).toBeUndefined();
    expect(outcome.done).toEqual([
      "registry",
      "broker-grant",
      "deploy-token",
      "environments-document",
    ]);
    expect(gitea.changeFiles).not.toHaveBeenCalled();
    expect(gitea.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("an attempt an earlier one left half done", () => {
  it("reuses the branch it left and opens the request from it", async () => {
    const gitea = giteaFake({
      getBranch: vi.fn(async (_owner: string, _repo: string, name: string) =>
        name === "main" ? { name: "main", user_can_merge: true } : { name },
      ),
      listPullRequests: vi.fn().mockResolvedValue([]),
    });
    const outcome = await addGroupEnvironment(base(apiFake(), gitea));
    expect(outcome.failed).toBeUndefined();
    expect(gitea.changeFiles).not.toHaveBeenCalled();
    expect(gitea.createPullRequest).toHaveBeenCalledTimes(1);
    expect(outcome.pullRequest).toEqual({ number: 12, merged: true });
  });

  it("reuses the request it left rather than opening a second", async () => {
    const gitea = giteaFake({
      getBranch: vi.fn(async (_owner: string, _repo: string, name: string) =>
        name === "main" ? { name: "main", user_can_merge: true } : { name },
      ),
      listPullRequests: vi
        .fn()
        .mockResolvedValue([
          { number: 7, state: "open", head: { ref: "mate-app/env-acme-stage" } },
        ]),
    });
    const outcome = await addGroupEnvironment(base(apiFake(), gitea));
    expect(outcome.failed).toBeUndefined();
    expect(gitea.createPullRequest).not.toHaveBeenCalled();
    expect(gitea.mergePullRequest).toHaveBeenCalledWith("acme", "group", 7);
    expect(outcome.pullRequest).toEqual({ number: 7, merged: true });
  });
});
