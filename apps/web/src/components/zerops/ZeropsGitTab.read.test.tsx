// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { ZeropsGitTab } from "./ZeropsGitTab";

const read = vi.hoisted(() => ({
  refresh: vi.fn(),
  failure:
    "Git command failed in GitVcsDriver.statusDetails.status (/var/www/api): Git command exited with a non-zero status.",
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: { services: [{ hostname: "api", group: "runtimes" }] } }),
}));
vi.mock("../../zerops/useZeropsGitRemoteProbe", async (original) => ({
  ...(await original<typeof import("../../zerops/useZeropsGitRemoteProbe")>()),
  useGitRemoteReads: () => new Map([["api", { reachable: true }]]),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: null,
    error: read.failure,
    isPending: false,
    refresh: read.refresh,
  }),
}));
vi.mock("../../zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
  useZeropsChangeDetail: () => ({ readout: { kind: "none" }, retry: () => {} }),
}));

it("a repository git could not read says so and reads it again on request, never that it is still read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const environmentId = EnvironmentId.make("env-read");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <ZeropsGitTab
            threadRef={scopeThreadRef(environmentId, ThreadId.make("thread-read"))}
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
    expect(api.textContent).toContain("Could not read this repository.");
    expect(api.textContent).toContain(read.failure);
    expect(api.textContent).not.toContain("Reading repository…");
    const again = [...api.querySelectorAll("button")].find(
      (node) => node.textContent === "Read again",
    );
    expect(again).toBeDefined();
    read.refresh.mockClear();
    await act(() => again!.click());
    expect(read.refresh).toHaveBeenCalledOnce();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
