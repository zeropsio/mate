// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CODE_IN_POOL_LINE } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { ZeropsGitTab } from "./ZeropsGitTab";

/**
 * A Mate whose `app` part was migrated to a dev pool: the dev service is gone, the pool stands in
 * Infrastructure, and the thread's last envelope keys the pair by the pool, whose snapshot carries
 * the stage (zcp `envelope.pool-pair.json`).
 */
const mate = vi.hoisted(() => ({
  services: [] as Array<{ hostname: string; group: string; type: string }>,
  lifecycle: {
    state: "known",
    value: {
      threadId: "thread-pool",
      recentTools: [],
      envelope: {
        services: [
          {
            hostname: "apppool",
            typeVersion: "swarm@1",
            runtimeClass: "pool",
            stages: [{ hostname: "appstage", setup: "prod" }],
          },
          { hostname: "appstage", typeVersion: "bun@1.3", runtimeClass: "dynamic", mode: "stage" },
        ],
      },
    },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: { services: mate.services } }),
}));
vi.mock("../../zerops/useZeropsFeeds", async (original) => ({
  ...(await original<typeof import("../../zerops/useZeropsFeeds")>()),
  useZeropsLifecycle: () => mate.lifecycle,
}));
vi.mock("../../zerops/useZeropsGitRemoteProbe", async (original) => ({
  ...(await original<typeof import("../../zerops/useZeropsGitRemoteProbe")>()),
  useGitRemoteReads: () => new Map(),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: undefined, isPending: true, refresh: vi.fn() }),
}));
vi.mock("../../zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
  useZeropsChangeDetail: () => ({ readout: { kind: "none" }, retry: () => {} }),
}));

const MIGRATED = [
  { hostname: "apppool", group: "infrastructure", type: "swarm@1" },
  { hostname: "appstage", group: "runtimes", type: "bun@1.3" },
];

afterEach(() => {
  mate.services = [];
});

/** Renders the Git tab of a chat bound to no lease, and hands its root to `read`. */
async function renderTab(read: (host: HTMLElement) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const environmentId = EnvironmentId.make("env-pool");
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <ZeropsGitTab
            threadRef={scopeThreadRef(environmentId, ThreadId.make("thread-pool"))}
            appId="app"
            declarations={[]}
            changes={{ pullRequests: [], merged: [] }}
            mateProjectId="mate"
            isOwner={true}
          />
        </RegistryContext.Provider>,
      ),
    );
    read(host);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it("a part migrated to a dev pool lists no stage in the Git tab: its pair's dev half is the pool", async () => {
  mate.services = [...MIGRATED, { hostname: "api", group: "runtimes", type: "nodejs@22" }];
  await renderTab((host) => {
    const blocks = [...host.querySelectorAll("[data-zerops-git-block]")].map((node) =>
      node.getAttribute("data-zerops-git-block"),
    );
    expect(blocks).toEqual(["api"]);
  });
});

it("a chat bound to no lease in a Mate whose code is all in a dev pool says so, and that taking a workspace reaches it", async () => {
  mate.services = [...MIGRATED];
  await renderTab((host) => {
    expect(host.querySelectorAll("[data-zerops-git-block]")).toHaveLength(0);
    expect(host.textContent).toContain(CODE_IN_POOL_LINE);
    expect(host.textContent).not.toContain("The first service brings one.");
  });
});
