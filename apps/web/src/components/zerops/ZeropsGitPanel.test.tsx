import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitPanel, type ZeropsGitPanelModel } from "./ZeropsGitPanel";

const BLOCK: GitBlock = {
  repository: "api",
  branch: "feature/invoices",
  baseBranch: "main",
  verdict: { tone: "ok", text: "The checks passed. Nothing is stopping it.", ask: undefined },
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
  return { blocks: [BLOCK], ...overrides };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitPanel>> = {}) =>
  renderToStaticMarkup(<ZeropsGitPanel model={model()} {...props} />);

describe("ZeropsGitPanel", () => {
  it("is this Mate's repositories and nothing of the project's", () => {
    const html = render();
    expect(html).toContain('data-zerops-git-block="api"');
    expect(html).toContain("feature/invoices");
    expect(html).toContain("stage picks it up on merge");
    // The project's stage, production, releases and recipe changes are the
    // left menu's and the projects screen's (D26), never a Mate's tab's.
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Releases");
    expect(html).not.toContain("Recipe changes");
    expect(html).not.toContain("Release");
  });

  it("spends no heading on a list whose every row names itself", () => {
    expect(render()).not.toContain("Repositories");
  });

  it("says a Mate has no repository rather than showing an empty list", () => {
    const html = render({ model: model({ blocks: [] }) });
    expect(html).toContain("No code repository yet. The first service brings one.");
  });

  it("carries the caller's verb under a block", () => {
    const html = render({ renderBlockAction: () => <button type="button">Merge</button> });
    expect(html).toContain(">Merge<");
  });

  it("says nothing about Gitea: the Mate's change is HQ's", () => {
    expect(render()).not.toContain("Gitea");
  });

  it("offers a change's page while the change is open", () => {
    const html = render({ onOpenChange: () => {} });
    expect(html).toContain('data-zerops-surface="git-change"');
  });

  it("offers a merged change's page too, which reads it from HQ itself", () => {
    const html = render({
      model: model({ blocks: [{ ...BLOCK, state: "merged" }] }),
      onOpenChange: () => {},
    });
    expect(html).toContain("#12");
    expect(html).toContain('data-zerops-surface="git-change"');
  });
});
