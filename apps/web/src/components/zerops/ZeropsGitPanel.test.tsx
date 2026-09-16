import type { EnvironmentRow, GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitPanel, type ZeropsGitPanelModel } from "./ZeropsGitPanel";

const BLOCK: GitBlock = {
  repository: "api",
  branch: "feature/invoices",
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

const STAGE: EnvironmentRow = {
  kind: "environment",
  projectId: "p1",
  name: "stage",
  tier: "stage",
  source: "main",
  commit: "3f9c1b2",
  line: "main · 3f9c1b2",
  tone: "good",
};

const PRODUCTION: EnvironmentRow = {
  kind: "environment",
  projectId: "p2",
  name: "production",
  tier: "production",
  source: "release",
  commit: undefined,
  line: "release",
  tone: "neutral",
};

function model(overrides: Partial<ZeropsGitPanelModel> = {}): ZeropsGitPanelModel {
  return {
    signedIn: true,
    blocks: [BLOCK],
    environments: [STAGE, PRODUCTION],
    releases: [
      { tag: "v1.3.0", verdict: "approved", detail: undefined, line: "api 3f9c1b2" },
      { tag: "v1.2.0", verdict: "approved", detail: undefined, line: "api 1111111" },
    ],
    recipeChanges: [
      { number: 14, title: "Add a worker", line: "#14 · ada", url: "https://gitea.example/p/14" },
    ],
    release: { gate: { allowed: true }, suggestion: "v1.3.1", comparison: [] },
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitPanel>> = {}) =>
  renderToStaticMarkup(<ZeropsGitPanel model={model()} {...props} />);

describe("ZeropsGitPanel", () => {
  it("reads repositories first, then the group they belong to", () => {
    const html = render();
    expect(html).toContain('data-zerops-git-section="Repositories"');
    expect(html.indexOf('data-zerops-git-section="Repositories"')).toBeLessThan(
      html.indexOf('data-zerops-git-section="Environments"'),
    );
    expect(html.indexOf('data-zerops-git-section="Environments"')).toBeLessThan(
      html.indexOf('data-zerops-git-section="Releases"'),
    );
  });

  it("says a Mate has no repository rather than showing an empty list", () => {
    const html = render({ model: model({ blocks: [] }) });
    expect(html).toContain("This Mate has no code repository yet.");
  });

  it("names each environment with what it follows and what it runs", () => {
    const html = render();
    expect(html).toContain("main · 3f9c1b2");
    expect(html).toContain('data-zerops-status-tone="ok"');
    expect(html).toContain("Deployed");
  });

  it("offers Release on the production row, and nowhere else", () => {
    const html = render({ onRelease: () => {} });
    const production = html.slice(html.indexOf('data-zerops-git-row="production"'));
    expect(production).toContain("Release");
    const stage = html.slice(
      html.indexOf('data-zerops-git-row="stage"'),
      html.indexOf('data-zerops-git-row="production"'),
    );
    expect(stage).not.toContain("Release");
  });

  it("says why Release is not offered instead of hiding the reason", () => {
    const html = render({
      model: model({
        release: {
          gate: { allowed: false, reason: "Only releasers can tag." },
          suggestion: "v1.3.1",
          comparison: [],
        },
      }),
      onRelease: () => {},
    });
    expect(html).toContain('data-zerops-surface="release-gate"');
    expect(html).toContain("Only releasers can tag.");
    expect(html).not.toContain(">Release<");
  });

  it("offers a roll-back on every release but the newest, which is what runs", () => {
    const html = render({ onRollBack: () => {} });
    expect(html.match(/Roll back to this/gu)).toHaveLength(1);
    const newest = html.slice(
      html.indexOf('data-zerops-git-row="v1.3.0"'),
      html.indexOf('data-zerops-git-row="v1.2.0"'),
    );
    expect(newest).not.toContain("Roll back");
  });

  it("says what the broker refused a tag for, in the broker's own words", () => {
    const html = render({
      model: model({
        releases: [
          {
            tag: "v1.3.0",
            verdict: "refused",
            detail: "ada is not a releaser",
            line: "api 3f9c1b2",
          },
        ],
      }),
    });
    expect(html).toContain("Refused");
    expect(html).toContain("ada is not a releaser");
  });

  it("keeps the checkout half and offers the way in when signed out of Gitea", () => {
    const html = render({ model: model({ signedIn: false }), onSignIn: () => {} });
    expect(html).toContain("api · feature/invoices");
    expect(html).toContain("Sign in to Gitea");
    // No empty sections that read as a group with nothing in it.
    expect(html).not.toContain('data-zerops-git-section="Environments"');
    expect(html).not.toContain('data-zerops-git-section="Releases"');
  });

  it("lists the recipe changes waiting on somebody", () => {
    const html = render({ onOpenRecipeChange: () => {} });
    expect(html).toContain("Add a worker");
    expect(html).toContain("#14 · ada");
    expect(html).toContain("Review");
  });
});
