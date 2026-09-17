import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { checkDotTone, ZeropsGitBlock } from "./ZeropsGitBlock";

function blockOf(overrides: Partial<GitBlock> = {}): GitBlock {
  return {
    repository: "api",
    branch: "feature/invoices",
    baseBranch: "main",
    headLine: "api · feature/invoices ↑3 ↓0 · 2 files changed",
    state: "in-review",
    checks: "passing",
    checkWord: "Passing",
    pullRequestNumber: 12,
    pullRequestUrl: "https://gitea.example/acme/api/pulls/12",
    destination: "stage picks it up on merge",
    action: undefined,
    trouble: "",
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitBlock>> = {}) =>
  renderToStaticMarkup(<ZeropsGitBlock block={blockOf()} {...props} />);

describe("ZeropsGitBlock", () => {
  it("is the checkout on top and where it goes underneath", () => {
    const html = render();
    expect(html).toContain('data-zerops-git-block="api"');
    expect(html).toContain("api · feature/invoices ↑3 ↓0 · 2 files changed");
    expect(html).toContain("PR #12");
    expect(html).toContain("stage picks it up on merge");
    expect(html.indexOf("↑3")).toBeLessThan(html.indexOf("PR #12"));
  });

  it("says how the checks went with a dot and one word, never a sentence", () => {
    const html = render();
    expect(html).toContain('data-zerops-status-tone="ok"');
    expect(html).toContain("Passing");
    expect(html).not.toContain("checks are");
    expect(html).not.toContain("green");
  });

  it.each([
    { checks: "passing", word: "Passing", tone: "ok" },
    { checks: "pending", word: "Running", tone: "busy" },
    { checks: "failing", word: "Failing", tone: "failed" },
  ] as const)("paints $checks as $tone", ({ checks, word, tone }) => {
    const html = render({ block: blockOf({ checks, checkWord: word }) });
    expect(html).toContain(`data-zerops-status-tone="${tone}"`);
    expect(html).toContain(word);
  });

  it("shows no dot at all where no check ran", () => {
    const block = blockOf({ checks: "none", checkWord: undefined });
    expect(checkDotTone(block)).toBeUndefined();
    expect(render({ block })).not.toContain("status-dot");
  });

  it("says nothing about a pull request there is none of", () => {
    const html = render({
      block: blockOf({
        state: "untouched",
        branch: "main",
        pullRequestNumber: undefined,
        pullRequestUrl: undefined,
        checks: "none",
        checkWord: undefined,
        destination: "",
      }),
    });
    expect(html).not.toContain("PR #");
    expect(html).not.toContain("picks it up");
  });

  it("says what is provably wrong instead of a green line about a broken setup", () => {
    const html = render({ block: blockOf({ trouble: "This Mate has no Gitea access yet." }) });
    expect(html).toContain('data-zerops-surface="git-trouble"');
    expect(html).toContain("This Mate has no Gitea access yet.");
  });

  it("carries the caller's one verb, and nothing when the caller has none", () => {
    expect(render({ action: <button type="button">Merge</button> })).toContain("Merge");
    expect(render()).not.toContain('<button type="button">Merge');
  });

  it("makes the pull request the way into Gitea only when the caller opens one", () => {
    expect(render({ onOpenPullRequest: () => {} })).toContain(
      'data-zerops-surface="git-pull-request"',
    );
    expect(render()).not.toContain('data-zerops-surface="git-pull-request"');
  });
});
