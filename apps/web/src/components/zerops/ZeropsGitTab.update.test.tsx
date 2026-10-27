// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { ZeropsGitTab } from "./ZeropsGitTab";
const effects = vi.hoisted(() => ({ pull: vi.fn(), refresh: vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => effects.pull }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({
    view: { services: ["api", "web"].map((hostname) => ({ hostname, group: "runtimes" })) },
  }),
}));
vi.mock("../../zerops/useZeropsGitRemoteProbe", async (original) => ({
  ...(await original<typeof import("../../zerops/useZeropsGitRemoteProbe")>()),
  useGitRemoteReads: () => new Map(["api", "web"].map((name) => [name, { reachable: true }])),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      isRepo: true,
      hasPrimaryRemote: true,
      refName: "main",
      aheadCount: 0,
      behindCount: 1,
      hasUpstream: true,
      workingTree: { files: [] },
    },
    refresh: effects.refresh,
  }),
}));
vi.mock("../../zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
  useZeropsChangeDetail: () => ({ readout: { kind: "none" }, retry: () => {} }),
}));
it("Update from main targets the selected repository and displays failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const environmentId = EnvironmentId.make("env-update");
  let answer!: (value: ReturnType<typeof AsyncResult.failure<never, Error>>) => void;
  effects.pull.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <ZeropsGitTab
            threadRef={scopeThreadRef(environmentId, ThreadId.make("thread-update"))}
            appId="app"
            declarations={[]}
            changes={{ pullRequests: [], merged: [] }}
            mateProjectId="mate"
            isOwner={true}
          />
        </RegistryContext.Provider>,
      ),
    );
    const api = host.querySelector('[data-zerops-git-block="api"]')!;
    const web = host.querySelector('[data-zerops-git-block="web"]')!;
    const update = [...api.querySelectorAll("button")].find(
      (node) => node.textContent === "Update from main",
    )!;
    expect(update).toBeDefined();
    await act(() => update.click());
    expect(effects.pull).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/var/www/api" },
    });
    expect(update.disabled).toBe(true);
    expect(api.textContent).toContain("Updating…");
    expect(web.textContent).not.toContain("Updating…");
    await act(() =>
      answer(AsyncResult.failure(Cause.fail(new Error("Remote refused the update.")))),
    );
    expect(api.querySelector('[role="alert"]')?.textContent).toContain(
      "Remote refused the update.",
    );
    expect(web.querySelector('[role="alert"]')).toBeNull();
    expect(update.disabled).toBe(false);
    expect(effects.refresh).not.toHaveBeenCalled();
    effects.pull.mockResolvedValue(AsyncResult.success(undefined));
    const updateWeb = [...web.querySelectorAll("button")].find(
      (node) => node.textContent === "Update from main",
    )!;
    await act(() => updateWeb.click());
    expect(effects.pull).toHaveBeenLastCalledWith({
      environmentId,
      input: { cwd: "/var/www/web" },
    });
    expect(api.querySelector('[role="alert"]')?.textContent).toContain(
      "Remote refused the update.",
    );
    await act(() => update.click());
    expect(effects.pull).toHaveBeenLastCalledWith({
      environmentId,
      input: { cwd: "/var/www/api" },
    });
    expect(api.querySelector('[role="alert"]')).toBeNull();
    expect(effects.refresh).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
