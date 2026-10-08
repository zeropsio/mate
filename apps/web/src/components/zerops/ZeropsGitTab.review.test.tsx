// @vitest-environment happy-dom
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ZeropsGitSurface } from "./ZeropsGitSurface";
const effects = vi.hoisted(() => ({ merge: vi.fn(), pull: vi.fn(), review: vi.fn() }));
vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: { services: [{ hostname: "api", group: "runtimes" }] } }),
}));
vi.mock("../../zerops/useZeropsGitRemoteProbe", () => ({
  useGitRemoteReads: () => new Map([["api", { reachable: true }]]),
  checkoutPathFor: () => "/var/www/api",
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      isRepo: true,
      hasPrimaryRemote: true,
      refName: "feature/invoices",
      aheadCount: 0,
      behindCount: 0,
      hasUpstream: true,
      workingTree: { files: [] },
    },
  }),
}));
vi.mock("../../state/sourceControlActions", () => ({
  useVcsPullAction: () => ({ run: effects.pull }),
}));
vi.mock("../../zerops/flowVerbs", () => ({
  useFlowVerbs: () => ({ merge: effects.merge, trouble: null }),
}));
vi.mock("../../zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
  useZeropsChangeDetail: () => ({ readout: { kind: "none" }, retry: () => {} }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../zerops/review", () => ({ useOpenReview: () => effects.review }));
vi.mock("../../zerops/useHqAppDetail", () => ({ useHqAppDetailHold: () => {} }));
vi.mock("../../zerops/ZeropsSessionProvider", () => ({ useZeropsSessionOptional: () => null }));
vi.mock("../../zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ projectId: "p1", orgId: "org1" }),
}));
vi.mock("../../zerops/ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({
    projects: [
      { id: "p1", name: "Invoices - Ada", hq: { appId: "g1", appName: "Invoices", kind: "mate" } },
    ],
  }),
}));
vi.mock("../../zerops/projectFlows", () => ({
  useProjectFlows: () => ({
    flows: new Map([
      [
        "g1",
        {
          changesKnown: true,
          declarations: [],
          merged: [],
          pullRequests: [
            {
              repository: "api",
              number: 12,
              title: "Invoices",
              kind: "code",
              mateProjectId: "p1",
              url: "https://hq.example/changes/g1/api/12",
              mergeability: "mergeable",
              behind: false,
              merged: false,
              mergedAt: undefined,
              state: "open",
              headSha: "abc",
              baseBranch: "main",
              line: "api #12",
              updatedAt: undefined,
            },
          ],
        },
      ],
    ]),
  }),
}));
it("Git surface Review opens the correct change from the pressed control, and merges nothing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  effects.merge.mockClear();
  effects.pull.mockClear();
  effects.review.mockClear();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(() =>
      root.render(
        <ZeropsGitSurface
          threadRef={scopeThreadRef(EnvironmentId.make("env-ada"), ThreadId.make("thread-ada"))}
        />,
      ),
    );
    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === "Review",
    );
    expect(button).toBeDefined();
    await act(() => button!.click());
    expect(effects.merge).not.toHaveBeenCalled();
    expect(effects.pull).not.toHaveBeenCalled();
    expect(effects.review).toHaveBeenCalledExactlyOnceWith(
      { kind: "change", groupId: "g1", repository: "api", number: 12 },
      { from: button },
    );
  } finally {
    await act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  }
});
