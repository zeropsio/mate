import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitPanel, type ZeropsGitPanelModel } from "./ZeropsGitPanel";

const BLOCK: GitBlock = {
  repository: "api",
  hqRepository: "api",
  branch: "feature/invoices",
  baseBranch: "main",
  verdict: { tone: "off", text: "Ready to merge", ask: undefined },
  checkoutLine: "feature/invoices ↑3",
  state: "in-review",
  changed: [],
  pullRequestNumber: 12,
  pullRequestHead: "c0ffee",
  pullRequestUrl: "https://hq.example/changes/g1/api/12",
  destination: "stage picks it up on merge",
  action: undefined,
  trouble: "",
};

function model(overrides: Partial<ZeropsGitPanelModel> = {}): ZeropsGitPanelModel {
  return {
    repositories: [
      { block: BLOCK, work: [{ kind: "plain", title: "Ready to merge", tone: "off" }] },
    ],
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitPanel>> = {}) =>
  renderToStaticMarkup(<ZeropsGitPanel model={model()} {...props} />);

describe("ZeropsGitPanel", () => {
  it("spends no heading on a list whose every row names itself", () => {
    expect(render()).not.toContain("Repositories");
  });

  it("says a Mate has no repository rather than showing an empty list", () => {
    const html = render({ model: model({ repositories: [] }) });
    expect(html).toContain("No code repository yet. The first service brings one.");
  });

  it("carries the caller's verb under a block", () => {
    const html = render({ renderBlockAction: () => <button type="button">Merge</button> });
    expect(html).toContain(">Merge<");
  });

  it("says nothing about Gitea: the Mate's change is HQ's", () => {
    expect(render()).not.toContain("Gitea");
  });
});
