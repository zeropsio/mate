import { describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsOrganization, ZeropsProject } from "@t3tools/client-runtime/zerops";
import wizardSource from "./ZeropsNewProjectWizard.tsx?raw";

import {
  exitZeropsNewProjectWait,
  submitZeropsNewProject,
  zeropsNewProjectScopeStepVisible,
} from "./ZeropsNewProjectWizard";

const ORGANIZATION: ZeropsOrganization = {
  id: "client-1",
  membershipId: "membership-1",
  name: "acme",
  roleCode: "OWNER",
  canCreateProjects: true,
};

describe("zeropsNewProjectScopeStepVisible", () => {
  it("creates through the typed runtime command", () => {
    expect(wizardSource).toContain("runtime.commands.createProjectWithMate(");
    expect(wizardSource).not.toContain("client.createProjectWithZeropsMate(");
  });

  it("loads organization locations through the demand-scoped resource hook", () => {
    expect(wizardSource).toContain("useZeropsResource(locationRequest)");
    expect(wizardSource).toContain('kind: "organization-locations"');
    expect(wizardSource).not.toContain(".listClientLocations(");
  });

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

  it("carries the selected agents through to the create call", async () => {
    const createProject = vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" });
    const onStartWaiting = vi.fn();
    const onError = vi.fn();

    await submitZeropsNewProject({
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
      // A project is a group; what is created in it is its first dev environment.
      name: "zerops-mate - dev",
      agents: ["claude-code", "codex"],
      group: { groupId: "7k2m9qx4vb1c", role: "dev", label: "zerops-mate" },
      botName: "Nia",
    });
    expect(onStartWaiting).toHaveBeenCalledWith("client-1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands the created project's id back so its job can be written down", async () => {
    const createProject = vi.fn().mockResolvedValue({ project: PROJECT, serviceName: "zcp" });
    const onCreated = vi.fn();

    await submitZeropsNewProject({
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

    expect(onCreated).toHaveBeenCalledWith("project-1");
  });

  it("says nothing was created when the create fails", async () => {
    const onCreated = vi.fn();

    await submitZeropsNewProject({
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
      name: "zerops-mate - dev",
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
});

describe("exitZeropsNewProjectWait", () => {
  // `provisioning.state` in the wizard is non-null only after a create
  // already succeeded, so the exit has no phase-conditional branch and
  // nothing here ever returns to a step whose action would create a SECOND
  // project — pinned by construction: the signature has no way to reach a
  // "go back to the agents step" call at all.
  it.each([
    "awaiting-project",
    "awaiting-container",
    "awaiting-health",
    "needs-enable",
    "ready",
    "timed-out",
    "pool-exhausted",
    "not-yet-available",
  ])("cancels the wait and returns to the project list regardless of phase (%s)", () => {
    const cancel = vi.fn();
    const clearCreatingIn = vi.fn();
    const navigateToProjects = vi.fn();

    exitZeropsNewProjectWait({ cancel, clearCreatingIn, navigateToProjects });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(clearCreatingIn).toHaveBeenCalledTimes(1);
    expect(navigateToProjects).toHaveBeenCalledTimes(1);
  });
});
