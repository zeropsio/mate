// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { HqEnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { AccountDataContext, type AccountData } from "~/zerops/accountData";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { GitProductionRemoval } from "./GitStopDetail";

const boundary = vi.hoisted(() => ({ remove: vi.fn<(...args: unknown[]) => Promise<void>>() }));
vi.mock("~/zerops/useGitTargetOperations", () => ({
  useGitTargetOperations: () => ({ live: true, actions: { removeEnvironment: boundary.remove } }),
}));
vi.mock("~/zerops/useHqAppDetail", () => ({
  useHqAppDetail: () => ({
    live: true,
    releases: [],
    repos: [
      {
        name: "web",
        mainHead: null,
        updatedAt: "2026-10-14T10:00:00Z",
        remote: {
          url: "https://github.com/acme/shop.git",
          repositoryId: "123",
          keptAt: "2026-10-14T10:00:00Z",
          keptBy: "ada",
          expiresAt: null,
          invalidSince: null,
        },
      },
    ],
  }),
}));
const environment = (allowed: boolean) => ({
  id: HqEnvironmentId.make("git-prod"),
  name: "Production",
  tier: "production" as const,
  target: { kind: "git" as const, branch: "main", delivery: "direct" as const },
  sources: ["release"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  jobs: [],
  birth: null,
  release: null,
  can: {
    remove_git_environment: allowed
      ? { allow: true as const }
      : { allow: false as const, reason: "not_app_developer" },
  },
});
const structure = (environments: ReturnType<typeof environment>[]) => ({
  apps: [{ id: "shop", name: "Shop", projects: [], environments }],
  ungrouped: [],
});

describe("Git production removal from account records", () => {
  it("A production arriving after first paint can be removed without a checking gap after HQ removes its record", async () => {
    const registry = AtomRegistry.make();
    const { store, seed } = mountHqNavigation(registry, "org", { structure: structure([]) });
    const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
      data: store.data,
      orgId: "org",
      demandDetail: () => () => {},
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    let complete!: () => void;
    boundary.remove.mockReset().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    try {
      await act(async () =>
        root.render(
          <RegistryContext.Provider value={registry}>
            <AccountDataContext.Provider value={account as AccountData}>
              <GitProductionRemoval appId="shop" environmentId="git-prod" />
            </AccountDataContext.Provider>
          </RegistryContext.Provider>,
        ),
      );
      expect(host.textContent).toBe("");
      await act(async () => seed({ structure: structure([environment(true)]) }));
      const button = (label: string) =>
        [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
      await act(async () => button("Remove production").click());
      expect(host.textContent).toContain(
        "Removes production. github.com/acme/shop main stays as it is; Mate stops pushing to it.",
      );
      await act(async () => button("Confirm removal").click());
      expect(boundary.remove).toHaveBeenCalledExactlyOnceWith("git-prod", undefined);
      expect(button("Removing…").disabled).toBe(true);
      expect(button("Cancel").disabled).toBe(true);
      await act(async () => seed({ structure: structure([]) }));
      expect(host.textContent).toBe("");
      await act(async () => complete());
      expect(host.textContent).toBe("");
    } finally {
      await act(async () => root.unmount());
      registry.dispose();
    }
  });

  it("A person without the production creation role cannot open removal from its account record", async () => {
    const registry = AtomRegistry.make();
    const { store } = mountHqNavigation(registry, "org", {
      structure: structure([environment(false)]),
    });
    const account: Pick<AccountData, "data" | "orgId" | "demandDetail"> = {
      data: store.data,
      orgId: "org",
      demandDetail: () => () => {},
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    boundary.remove.mockReset();
    try {
      await act(async () =>
        root.render(
          <RegistryContext.Provider value={registry}>
            <AccountDataContext.Provider value={account as AccountData}>
              <GitProductionRemoval appId="shop" environmentId="git-prod" />
            </AccountDataContext.Provider>
          </RegistryContext.Provider>,
        ),
      );
      expect(host.textContent).toBe("");
      expect(boundary.remove).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      registry.dispose();
    }
  });
});
