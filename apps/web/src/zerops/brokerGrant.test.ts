import { describe, expect, it, vi } from "vite-plus/test";

import { grantBrokerProject, registerMateProject } from "./brokerGrant";

const BROKER = {
  id: "t-2",
  name: "mate-broker",
  roleCode: "READ_ONLY",
  projects: [{ projectId: "p-gitea", roleCode: "BASIC_USER" as const }],
};

function apiFake(overrides: Record<string, unknown> = {}) {
  return {
    writeGroupRegistry: vi.fn().mockResolvedValue({ id: "p-gitea" }),
    listIntegrationTokens: vi.fn().mockResolvedValue([{ id: "t-1", name: "zcp-fen" }, BROKER]),
    setIntegrationTokenProjects: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("grantBrokerProject", () => {
  it("adds the project to the broker's grants at BASIC_USER and keeps the rest, role included", async () => {
    const api = apiFake();
    const outcome = await grantBrokerProject({
      client: api as never,
      clientId: "org-1",
      projectId: "p-mate",
    });

    expect(outcome).toEqual({ kind: "granted" });
    expect(api.setIntegrationTokenProjects).toHaveBeenCalledWith(
      {
        clientId: "org-1",
        tokenId: "t-2",
        name: "mate-broker",
        projects: [
          { projectId: "p-gitea", roleCode: "BASIC_USER" },
          { projectId: "p-mate", roleCode: "BASIC_USER" },
        ],
        roleCode: "READ_ONLY",
      },
      undefined,
    );
  });

  it("writes nothing when the broker already reaches the project", async () => {
    const api = apiFake({
      listIntegrationTokens: vi
        .fn()
        .mockResolvedValue([
          { ...BROKER, projects: [{ projectId: "p-mate", roleCode: "BASIC_USER" }] },
        ]),
    });
    const outcome = await grantBrokerProject({
      client: api as never,
      clientId: "org-1",
      projectId: "p-mate",
    });

    expect(outcome).toEqual({ kind: "granted" });
    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an account with no broker yet",
      patch: { listIntegrationTokens: vi.fn().mockResolvedValue([]) },
      expected: { kind: "no-broker", reason: "This account has no broker to deploy with yet." },
    },
    {
      name: "a token list that could not be read",
      patch: { listIntegrationTokens: vi.fn().mockRejectedValue(new Error("Not signed in.")) },
      expected: { kind: "failed", reason: "Not signed in." },
    },
    {
      name: "a grant write the platform refused",
      patch: { setIntegrationTokenProjects: vi.fn().mockRejectedValue(new Error("Forbidden.")) },
      expected: { kind: "failed", reason: "Forbidden." },
    },
  ])("says so for $name, and throws nothing", async ({ patch, expected }) => {
    const outcome = await grantBrokerProject({
      client: apiFake(patch) as never,
      clientId: "org-1",
      projectId: "p-mate",
    });
    expect(outcome).toEqual(expected);
  });
});

describe("registerMateProject", () => {
  const input = (api: ReturnType<typeof apiFake>) => ({
    client: api as never,
    clientId: "org-1",
    giteaProjectId: "p-gitea",
    tagList: ["mate:gm:g-1:p-mate:mate", "mate:gn:g-1:acme", "mate:tool:gitea"],
    projectId: "p-mate",
  });

  it("writes the registry entry, then gives the broker the Mate's project", async () => {
    const api = apiFake();
    const order: Array<string> = [];
    api.writeGroupRegistry.mockImplementation(async () => {
      order.push("registry");
      return { id: "p-gitea" };
    });
    api.setIntegrationTokenProjects.mockImplementation(async () => {
      order.push("grant");
    });

    const outcome = await registerMateProject(input(api));

    expect(outcome).toEqual({ kind: "registered", grant: { kind: "granted" } });
    expect(order).toEqual(["registry", "grant"]);
    expect(api.writeGroupRegistry).toHaveBeenCalledWith(
      {
        giteaProjectId: "p-gitea",
        tagList: ["mate:gm:g-1:p-mate:mate", "mate:gn:g-1:acme", "mate:tool:gitea"],
      },
      undefined,
    );
  });

  // The registry entry is what the broker's rights loop reads; without it the
  // grant would reach a project the loop never looks at.
  it("stops at a registry write that failed and gives the broker nothing", async () => {
    const api = apiFake({
      writeGroupRegistry: vi.fn().mockRejectedValue(new Error("Only owners write tags.")),
    });

    const outcome = await registerMateProject(input(api));

    expect(outcome).toEqual({ kind: "registry-failed", reason: "Only owners write tags." });
    expect(api.listIntegrationTokens).not.toHaveBeenCalled();
    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
  });

  it("registers the Mate even when the account has no broker to give it to", async () => {
    const api = apiFake({ listIntegrationTokens: vi.fn().mockResolvedValue([]) });

    const outcome = await registerMateProject(input(api));

    expect(outcome).toEqual({
      kind: "registered",
      grant: { kind: "no-broker", reason: "This account has no broker to deploy with yet." },
    });
  });
});
