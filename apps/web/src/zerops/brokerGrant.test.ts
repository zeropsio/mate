import { describe, expect, it, vi } from "vite-plus/test";

import { parseZeropsRegistry } from "@t3tools/client-runtime/zerops";

import {
  grantBrokerProject,
  registerMateInGroup,
  registerMateProject,
  type ProjectTagsWrite,
} from "./brokerGrant";
import { tagsFake } from "./__fixtures__/projectTags";

const BROKER = {
  id: "t-2",
  name: "mate-broker",
  roleCode: "READ_ONLY",
  projects: [{ projectId: "p-gitea", roleCode: "BASIC_USER" as const }],
};

function apiFake(overrides: Record<string, unknown> = {}) {
  return {
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
  const REGISTRY = ["mate:gn:g-1:acme", "mate:tool:gitea"];
  const input = (api: ReturnType<typeof apiFake>, writeTags: ProjectTagsWrite) => ({
    client: api as never,
    writeTags,
    clientId: "org-1",
    giteaProjectId: "p-gitea",
    groupId: "g-1",
    projectId: "p-mate",
  });

  it("writes the registry entry as a patch, then gives the broker the Mate's project", async () => {
    const api = apiFake();
    const registry = tagsFake(REGISTRY);
    const order: Array<string> = [];
    registry.writeTags.mockImplementationOnce(async (projectId, patch) => {
      order.push("registry");
      return tagsFake(REGISTRY).writeTags(projectId, patch);
    });
    api.setIntegrationTokenProjects.mockImplementation(async () => {
      order.push("grant");
    });

    const outcome = await registerMateProject(input(api, registry.writeTags));

    expect(outcome).toEqual({ kind: "registered", grant: { kind: "granted" } });
    expect(order).toEqual(["registry", "grant"]);
    expect(registry.writeTags).toHaveBeenCalledWith("p-gitea", {
      kind: "registry-member",
      groupId: "g-1",
      projectId: "p-mate",
      member: "mate",
    });
  });

  // The registry entry is what the broker's rights loop reads; without it the
  // grant would reach a project the loop never looks at.
  it.each([
    {
      name: "failed",
      writeTags: vi.fn<ProjectTagsWrite>().mockRejectedValue(new Error("Only owners write tags.")),
      reason: "Only owners write tags.",
    },
    {
      name: "was refused by the registry it met",
      writeTags: tagsFake(["mate:tool:gitea"]).writeTags,
      reason: "That project is not in the registry yet.",
    },
  ])("stops at a registry write that $name and gives the broker nothing", async (row) => {
    const api = apiFake();

    const outcome = await registerMateProject(input(api, row.writeTags));

    expect(outcome).toEqual({ kind: "registry-failed", reason: row.reason });
    expect(api.listIntegrationTokens).not.toHaveBeenCalled();
    expect(api.setIntegrationTokenProjects).not.toHaveBeenCalled();
  });

  it("registers the Mate even when the account has no broker to give it to", async () => {
    const api = apiFake({ listIntegrationTokens: vi.fn().mockResolvedValue([]) });

    const outcome = await registerMateProject(input(api, tagsFake(REGISTRY).writeTags));

    expect(outcome).toEqual({
      kind: "registered",
      grant: { kind: "no-broker", reason: "This account has no broker to deploy with yet." },
    });
  });
});

describe("registerMateInGroup", () => {
  const ACME = ["mate:tool:gitea", "mate:gn:g-acme:acme", "mate:gm:g-acme:p-fen:mate"];

  // Add Mate by an owner registers at birth, the card's Register in {group}
  // finishes a member's Mate: one path, so the second Mate of a group gets its
  // bot the way the first one did (the owner's two-Mate run, 2026-09-17).
  it.each([
    {
      name: "registers a second Mate beside the first and gives the broker its project",
      groupId: "g-acme",
      api: {},
      failing: false,
      expected: null,
      written: ["mate:gm:g-acme:p-ada:mate", "mate:gm:g-acme:p-fen:mate"],
    },
    {
      name: "says why when the group is not in the registry, and writes nothing",
      groupId: "g-gone",
      api: {},
      failing: false,
      expected: "That project is not in the registry yet.",
      written: ["mate:gm:g-acme:p-fen:mate"],
    },
    {
      name: "says a registry write that failed",
      groupId: "g-acme",
      api: {},
      failing: true,
      expected: "Only owners write tags.",
      written: ["mate:gm:g-acme:p-fen:mate"],
    },
    {
      name: "says a grant that failed, with the Mate registered",
      groupId: "g-acme",
      api: { setIntegrationTokenProjects: vi.fn().mockRejectedValue(new Error("Forbidden.")) },
      failing: false,
      expected: "Forbidden.",
      written: ["mate:gm:g-acme:p-ada:mate", "mate:gm:g-acme:p-fen:mate"],
    },
  ])("$name", async ({ groupId, api: overrides, failing, expected, written }) => {
    const registry = tagsFake(ACME);
    if (failing) registry.writeTags.mockRejectedValueOnce(new Error("Only owners write tags."));

    const outcome = await registerMateInGroup({
      client: apiFake(overrides) as never,
      writeTags: registry.writeTags,
      clientId: "org-1",
      giteaProjectId: "p-gitea",
      groupId,
      projectId: "p-ada",
    });

    expect(outcome).toBe(expected);
    expect(
      parseZeropsRegistry(registry.tags())
        .groups.flatMap((group) =>
          group.projects.map(
            ({ projectId, kind }) => `mate:gm:${group.groupId}:${projectId}:${kind}`,
          ),
        )
        .toSorted(),
    ).toEqual(written);
  });
});
