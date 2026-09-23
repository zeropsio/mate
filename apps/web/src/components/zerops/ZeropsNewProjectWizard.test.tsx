import { describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsOrganization, ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import wizardSource from "./ZeropsNewProjectWizard.tsx?raw";

import { submitZeropsNewProject, zeropsNewProjectScopeStepVisible } from "./ZeropsNewProjectWizard";

const ORGANIZATION: ZeropsOrganization = {
  id: "client-1",
  membershipId: "membership-1",
  name: "acme",
  roleCode: "OWNER",
  canCreateProjects: true,
};

describe("ZeropsNewProjectWizard source", () => {
  it("the wizard reads no tags of its own: its group is a registry patch on a fresh read", () => {
    expect(wizardSource).not.toContain("readGroupRegistry(");
    expect(wizardSource).not.toContain("planGroupRegistration(");
    expect(wizardSource).toContain("runtime.commands.updateProjectTags(");
    expect(wizardSource).toContain('kind: "registry-group"');
  });

  it("creates through the typed runtime command", () => {
    expect(wizardSource).toContain("runtime.commands.createProjectWithMate(");
    expect(wizardSource).not.toContain("client.createProjectWithZeropsMate(");
  });

  it("loads organization locations through the broker's demand-scoped atom", () => {
    expect(wizardSource).toContain("runtime.resources.known(locationRequest)");
    expect(wizardSource).toContain('kind: "organization-locations"');
    expect(wizardSource).not.toContain(".listClientLocations(");
  });

  it("is one form: a name, a location, one button", () => {
    // No brief (the Mate falls back to its onboarding line) and no agents
    // step (an empty selection omits `ZCP_AGENTS`, which offers every agent).
    expect(wizardSource).not.toContain("Textarea");
    expect(wizardSource).not.toContain("What are we building?");
    expect(wizardSource).not.toContain("ZeropsNewProjectAgents");
    expect(wizardSource).not.toContain("ZeropsNewProjectStep");
    expect(wizardSource).toContain("agents: [],");
    expect(wizardSource).not.toContain(">Continue<");
    expect(wizardSource).not.toContain("in {activeOrganization.name}");
  });

  it("hands the wait to the projects page instead of rendering one", () => {
    expect(wizardSource).not.toContain("ZeropsProvisioningPanel");
    expect(wizardSource).not.toContain("provisioning.start(");
    expect(wizardSource).not.toContain("exitZeropsNewProjectWait");
    expect(wizardSource).toContain('navigate({ to: "/zerops" })');
  });

  it("says the page's name once, in the breadcrumb", () => {
    expect(wizardSource).not.toContain("<h1");
    expect(wizardSource).toContain(
      "Name it. Its first Mate is up in a few minutes, with Git hosting alongside.",
    );
    expect(wizardSource).not.toContain("lowest-latency location is preselected");
  });

  it("is a white card no wider than a form", () => {
    expect(wizardSource).not.toContain("bg-card/20");
    expect(wizardSource).toContain(
      "rounded-[var(--zerops-card-radius)] border border-border/60 bg-card",
    );
    expect(wizardSource).toContain("max-w-xl");
  });
});

describe("zeropsNewProjectScopeStepVisible", () => {
  it("is hidden once a single-membership account auto-resolves its organization", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "selected",
        activeOrganization: ORGANIZATION,
      }),
    ).toBe(false);
  });

  it("is shown while several memberships have not yet resolved an active one", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "needs-selection",
        activeOrganization: null,
      }),
    ).toBe(true);
  });

  it("is shown while the organization list is still loading", () => {
    expect(
      zeropsNewProjectScopeStepVisible({
        organizationStatus: "loading",
        activeOrganization: null,
      }),
    ).toBe(true);
  });
});

describe("submitZeropsNewProject", () => {
  const PROJECT: ZeropsProject = { id: "project-1", name: "zerops-mate", status: "ACTIVE" };
  /** An account whose Gitea is up. */
  const GITEA = { projectId: "gitea-1" };
  const WRITTEN: ProjectTagWrite = {
    kind: "written",
    project: { id: "gitea-1", name: "Gitea", status: "ACTIVE" },
  };
  /** An account that already has its Gitea never stands one up. */
  const neverEnsure = () => vi.fn<() => Promise<typeof GITEA>>();

  it("carries the selected agents through to the create call", async () => {
    const createProject = vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" });
    const onStartWaiting = vi.fn();
    const onError = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject,
      clientId: "client-1",
      name: "zerops-mate",
      locationId: null,
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: ["claude-code", "codex"],
      onStartWaiting,
      onError,
    });

    expect(createProject).toHaveBeenCalledWith({
      clientId: "client-1",
      // A project is a group; what is created in it is its first Mate, named after its bot.
      name: "zerops-mate - Nia",
      agents: ["claude-code", "codex"],
      group: { groupId: "7k2m9qx4vb1c", role: "dev", label: "zerops-mate" },
      botName: "Nia",
    });
    expect(onStartWaiting).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands the created project back with the Gitea project its birth registers it on", async () => {
    const createProject = vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" });
    const onCreated = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject,
      clientId: "client-1",
      name: "zerops-mate",
      locationId: null,
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: ["claude-code"],
      onCreated,
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(onCreated).toHaveBeenCalledWith("project-1", "gitea-1");
  });

  it("says nothing was created when the create fails", async () => {
    const onCreated = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject: vi.fn().mockRejectedValue(new Error("nope")),
      clientId: "client-1",
      name: "zerops-mate",
      locationId: null,
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: [],
      onCreated,
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps an uncertain runtime command from being submitted again", async () => {
    const onUncertain = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject: vi.fn().mockRejectedValue({
        _tag: "ZeropsDataAdapterError",
        kind: "uncertain",
        message: "The project may already exist.",
      }),
      clientId: "client-1",
      name: "zerops-mate",
      locationId: null,
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: [],
      onUncertain,
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(onUncertain).toHaveBeenCalledTimes(1);
  });

  it("carries the chosen location through to the create call", async () => {
    const createProject = vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" });

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject,
      clientId: "client-1",
      name: "zerops-mate",
      locationId: "prg1",
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: ["claude-code"],
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(createProject).toHaveBeenCalledWith({
      clientId: "client-1",
      name: "zerops-mate - Nia",
      location: "prg1",
      agents: ["claude-code"],
      group: { groupId: "7k2m9qx4vb1c", role: "dev", label: "zerops-mate" },
      botName: "Nia",
    });
  });

  it("surfaces a create failure's message and never advances into the wait", async () => {
    const createProject = vi.fn().mockRejectedValue(new Error("Project name is taken."));
    const onStartWaiting = vi.fn();
    const onError = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject,
      clientId: "client-1",
      name: "zerops-mate",
      locationId: null,
      groupId: "7k2m9qx4vb1c",
      botName: "Nia",
      agents: ["claude-code"],
      onStartWaiting,
      onError,
    });

    expect(onStartWaiting).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Project name is taken.");
  });

  it("writes the group's registry entry before it creates anything", async () => {
    const order: Array<string> = [];
    const registerGroup = vi.fn(
      async (registration: {
        readonly giteaProjectId: string;
        readonly groupId: string;
        readonly name: string;
      }) => {
        order.push(
          `register:${registration.giteaProjectId}:${registration.groupId}:${registration.name}`,
        );
        return WRITTEN;
      },
    );
    const createProject = vi.fn(async () => {
      order.push("create");
      return { project: PROJECT, serviceName: "zcp" };
    });

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup,
      createProject,
      clientId: "client-1",
      name: " Acme CRM ",
      locationId: null,
      groupId: "g-1",
      botName: "Nia",
      agents: [],
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(order).toEqual(["register:gitea-1:g-1:Acme CRM", "create"]);
  });

  it.each<{ readonly name: string; readonly registerGroup: () => Promise<ProjectTagWrite> }>([
    {
      name: "fails",
      registerGroup: () => Promise.reject(new Error("Only owners write tags.")),
    },
    {
      name: "is refused by the registry it met",
      registerGroup: async () => ({
        kind: "refused",
        refusal: { code: "registry-conflict", reason: "Only owners write tags." },
        project: WRITTEN.project,
      }),
    },
  ])("creates nothing when the registry write $name", async ({ registerGroup }) => {
    const createProject = vi.fn();
    const onError = vi.fn();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea: neverEnsure(),
      registerGroup,
      createProject,
      clientId: "client-1",
      name: "Acme CRM",
      locationId: null,
      groupId: "g-1",
      botName: "Nia",
      agents: [],
      onStartWaiting: vi.fn(),
      onError,
    });

    expect(createProject).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Only owners write tags.");
  });

  it("stands Gitea up first when the account has none, then writes the group into it", async () => {
    const order: Array<string> = [];
    const ensureGitea = vi.fn(async () => {
      order.push("gitea");
      return { projectId: "gitea-new" };
    });
    const registerGroup = vi.fn(async ({ giteaProjectId }: { readonly giteaProjectId: string }) => {
      order.push(`register:${giteaProjectId}`);
      return WRITTEN;
    });
    const createProject = vi.fn(async () => {
      order.push("create");
      return { project: PROJECT, serviceName: "zcp" };
    });
    const phases: Array<string> = [];

    await submitZeropsNewProject({
      gitea: undefined,
      ensureGitea,
      registerGroup,
      createProject,
      clientId: "client-1",
      name: "Acme CRM",
      locationId: null,
      groupId: "g-1",
      botName: "Nia",
      agents: [],
      onPhase: (phase) => phases.push(phase),
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    // The patch meets the fresh project's own tags, so `mate:tool:gitea` survives the write.
    expect(order).toEqual(["gitea", "register:gitea-new", "create"]);
    expect(phases).toEqual(["gitea", "project"]);
  });

  it("creates nothing when Gitea cannot be stood up", async () => {
    const registerGroup = vi.fn();
    const createProject = vi.fn();
    const onError = vi.fn();

    await submitZeropsNewProject({
      gitea: undefined,
      ensureGitea: vi.fn().mockRejectedValue(new Error("No room in this account.")),
      registerGroup,
      createProject,
      clientId: "client-1",
      name: "Acme CRM",
      locationId: null,
      groupId: "g-1",
      botName: "Nia",
      agents: [],
      onStartWaiting: vi.fn(),
      onError,
    });

    expect(registerGroup).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("No room in this account.");
  });

  it("never stands a second Gitea up for an account that has one", async () => {
    const ensureGitea = neverEnsure();

    await submitZeropsNewProject({
      gitea: GITEA,
      ensureGitea,
      registerGroup: vi.fn().mockResolvedValue(WRITTEN),
      createProject: vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" }),
      clientId: "client-1",
      name: "Acme",
      locationId: null,
      groupId: "g-1",
      botName: "Nia",
      agents: [],
      onStartWaiting: vi.fn(),
      onError: vi.fn(),
    });

    expect(ensureGitea).not.toHaveBeenCalled();
  });
});
