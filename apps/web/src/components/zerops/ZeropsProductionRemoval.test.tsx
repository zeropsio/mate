// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { describe, expect, it, vi } from "vite-plus/test";
import { AccountDataContext, type AccountData } from "~/zerops/accountData";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { ProductionRemoval } from "./GitStopDetail";

const boundary = vi.hoisted(() => ({
  run: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  addToast: vi.fn(() => "removal-toast"),
  updateToast: vi.fn(),
}));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: boundary.addToast, update: boundary.updateToast },
}));
vi.mock("~/zerops/accountOperations", () => ({
  useAccountOperationsOptional: () => ({ run: boundary.run }),
}));
vi.mock("~/zerops/hqWrites", () => ({ hqProjectIdOf: () => "hq" }));
vi.mock("~/zerops/useGitTargetOperations", () => ({
  useGitTargetOperations: () => ({ live: true, actions: undefined }),
}));
vi.mock("~/zerops/useHqAppDetail", () => ({
  useHqAppDetail: () => ({ live: true, releases: [], repos: [] }),
}));
const environment = (deleteProject: boolean, allowed = true) => ({
  id: HqEnvironmentId.make("production-record"),
  name: "Production",
  tier: "production" as const,
  target: { kind: "zerops" as const, projectId: ProjectId.make("production-project") },
  sources: ["release"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  jobs: [],
  birth: null,
  release: null,
  deleteProjectOnRemoval: deleteProject,
  can: {
    remove_production: allowed
      ? { allow: true as const }
      : { allow: false as const, reason: "not_structure_writer" },
  },
});
const structure = (environments: ReturnType<typeof environment>[]) => ({
  apps: [
    {
      id: "shop",
      name: "Shop",
      projects: environments.map(() => ({
        projectId: "production-project",
        name: "Shop - Live",
        mate: null,
        kind: "production" as const,
      })),
      environments,
    },
  ],
  ungrouped: [],
});

it.each([
  {
    deleteProject: false,
    title: "Removing attached production keeps its Zerops project and stops releasing to it",
  },
  {
    deleteProject: true,
    title: "Removing production deletes only the Zerops project HQ proves Mate created for it",
  },
])("$title", async ({ deleteProject }) => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [
    { id: "production-project", name: "Shop - Live", status: "ACTIVE" },
  ]);
  const { seed } = mountHqNavigation(registry, "org", { structure: structure([]) }, store);
  const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
    data: store.data,
    orgId: "org",
    demandDetail: () => () => {},
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  let finish!: () => void;
  boundary.run.mockReset().mockImplementation(async (intent) => {
    if ((intent as { kind: string }).kind === "remove-production") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { deleteProject };
    }
    return undefined;
  });
  try {
    await act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider value={account as AccountData}>
            <ProductionRemoval appId="shop" environmentId="production-record" />
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      ),
    );
    expect(host.textContent).toBe("");
    await act(async () => seed({ structure: structure([environment(deleteProject)]) }));
    const button = (text: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
    expect(host.textContent).toContain("Remove production");
    await act(async () => button("Remove production").click());
    expect(host.textContent).toContain(
      deleteProject
        ? "Removes production and deletes the Zerops project Shop - Live with its services and data."
        : "Removes production. The Zerops project Shop - Live stays as it is; Mate stops releasing to it.",
    );
    await act(async () => button("Confirm removal").click());
    expect(boundary.run).toHaveBeenCalledTimes(1);
    expect(boundary.run.mock.calls[0]?.[0]).toEqual({
      kind: "remove-production",
      orgId: "org",
      hqProjectId: "hq",
      appId: "shop",
      projectId: "production-project",
      deleteProject,
    });
    expect(button("Removing…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(boundary.addToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "loading", title: "Removing production", timeout: 0 }),
    );
    await act(async () => seed({ structure: structure([]) }));
    expect(host.textContent).toBe("");
    await act(async () => finish());
    expect(boundary.run).toHaveBeenCalledTimes(deleteProject ? 2 : 1);
    if (deleteProject)
      expect(boundary.run.mock.calls[1]?.[0]).toEqual({
        kind: "delete-project",
        orgId: "org",
        projectId: "production-project",
      });
    expect(host.textContent).toBe("");
    expect(boundary.updateToast).toHaveBeenLastCalledWith(
      "removal-toast",
      expect.objectContaining({ type: "success", title: "Production removed" }),
    );
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});

it("A person without production creation access cannot remove Zerops production", async () => {
  const registry = AtomRegistry.make();
  const { store } = mountHqNavigation(registry, "org", {
    structure: structure([environment(false, false)]),
  });
  const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
    data: store.data,
    orgId: "org",
    demandDetail: () => () => {},
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  boundary.run.mockReset();
  try {
    await act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider value={account as AccountData}>
            <ProductionRemoval appId="shop" environmentId="production-record" />
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      ),
    );
    expect(host.textContent).toBe("");
    expect(boundary.run).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});

it("A failed target deletion stays visible after HQ removed the production record", async () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [
    { id: "production-project", name: "Shop - Live", status: "ACTIVE" },
  ]);
  const { seed } = mountHqNavigation(
    registry,
    "org",
    { structure: structure([environment(true)]) },
    store,
  );
  const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
    data: store.data,
    orgId: "org",
    demandDetail: () => () => {},
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  boundary.run.mockReset().mockImplementation(async (intent) => {
    if ((intent as { kind: string }).kind === "remove-production") {
      seed({ structure: structure([]) });
      return { deleteProject: true };
    }
    throw new Error("The Zerops deletion process failed.");
  });
  try {
    await act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider value={account as AccountData}>
            <ProductionRemoval appId="shop" environmentId="production-record" />
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      ),
    );
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("Remove production").click());
    await act(async () => button("Confirm removal").click());
    expect(host.textContent).toBe("");
    expect(boundary.updateToast).toHaveBeenLastCalledWith(
      "removal-toast",
      expect.objectContaining({
        type: "error",
        title: "Project deletion needs attention",
        description:
          "Production was removed. Zerops project deletion could not be confirmed. The Zerops deletion process failed.",
        timeout: 0,
      }),
    );
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});
