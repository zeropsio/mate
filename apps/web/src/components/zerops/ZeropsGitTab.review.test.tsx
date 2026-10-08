// @vitest-environment happy-dom
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ZeropsGitTab } from "./ZeropsGitTab";
const effects = vi.hoisted(() => ({ merge: vi.fn(), pull: vi.fn() }));
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
vi.mock("../../zerops/flowVerbs", () => ({ useFlowVerbs: () => ({ merge: effects.merge }) }));
vi.mock("../../zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
  useZeropsChangeDetail: () => ({ readout: { kind: "none" }, retry: () => {} }),
}));
it("Git Review hands the open change and pressed control to the review, and merges nothing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  effects.merge.mockClear();
  effects.pull.mockClear();
  const review = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(() =>
      root.render(
        <ZeropsGitTab
          threadRef={scopeThreadRef(EnvironmentId.make("env-ada"), ThreadId.make("thread-ada"))}
          appId="g1"
          mateProjectId="p1"
          isOwner={false}
          declarations={[]}
          changes={{
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
          }}
          onReviewPullRequest={review}
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
    expect(review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        repository: "api",
        pullRequestNumber: 12,
        pullRequestHead: "abc",
      }),
      button,
    );
  } finally {
    await act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  }
});
