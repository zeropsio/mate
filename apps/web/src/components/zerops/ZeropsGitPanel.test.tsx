import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitPanel, type ZeropsGitPanelModel } from "./ZeropsGitPanel";

const BLOCK: GitBlock = {
  repository: "api",
  branch: "feature/invoices",
  baseBranch: "main",
  headLine: "api · feature/invoices ↑3 ↓0",
  state: "in-review",
  checks: "passing",
  checkWord: "Passing",
  pullRequestNumber: 12,
  pullRequestUrl: "https://gitea.example/acme/api/pulls/12",
  destination: "stage picks it up on merge",
  action: undefined,
  trouble: "",
};

function model(overrides: Partial<ZeropsGitPanelModel> = {}): ZeropsGitPanelModel {
  return { signedIn: true, blocks: [BLOCK], ...overrides };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitPanel>> = {}) =>
  renderToStaticMarkup(<ZeropsGitPanel model={model()} {...props} />);

describe("ZeropsGitPanel", () => {
  it("is this Mate's repositories and nothing of the project's", () => {
    const html = render();
    expect(html).toContain('data-zerops-git-section="Repositories"');
    expect(html).toContain("api · feature/invoices");
    expect(html).toContain("stage picks it up on merge");
    // The project's stage, production, releases and recipe changes are the
    // left menu's and the projects screen's (D26), never a Mate's tab's.
    expect(html).not.toContain('data-zerops-git-section="Environments"');
    expect(html).not.toContain('data-zerops-git-section="Releases"');
    expect(html).not.toContain('data-zerops-git-section="Recipe changes"');
    expect(html).not.toContain("Release");
  });

  it("says a Mate has no repository rather than showing an empty list", () => {
    const html = render({ model: model({ blocks: [] }) });
    expect(html).toContain("No code repository yet. The first service brings one.");
  });

  it("carries the caller's verb under a block", () => {
    const html = render({ renderBlockAction: () => <button type="button">Merge</button> });
    expect(html).toContain(">Merge<");
  });

  it("keeps the checkout half and says the Gitea half is on its way, with nothing to click", () => {
    const html = render({ model: model({ signedIn: false }) });
    expect(html).toContain("api · feature/invoices");
    expect(html).toContain("Signing you in to Gitea");
    expect(html).not.toContain("Sign in to Gitea");
    expect(html).not.toContain("<button");
  });

  it("says why the sign-in was refused, in place of the sign-in line", () => {
    // The owner's run of 2026-09-17: Gitea's login source had not been added,
    // and the tab said "Signing you in…" for a quarter of an hour.
    const html = render({
      model: model({
        signedIn: false,
        signInTrouble: "Gitea refused: login source does not exist [id: 1]",
      }),
    });
    expect(html).toContain("login source does not exist");
    expect(html).not.toContain("Signing you in to Gitea");
  });

  it("says nothing about Gitea once signed in", () => {
    expect(render()).not.toContain('data-zerops-git-section="Gitea"');
  });
});
