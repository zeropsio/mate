import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitBlock } from "./ZeropsGitBlock";

function blockOf(overrides: Partial<GitBlock> = {}): GitBlock {
  return {
    repository: "api",
    branch: "feature/invoices",
    baseBranch: "main",
    verdict: { tone: "ok", text: "The checks passed. Nothing is stopping it.", ask: undefined },
    checkoutLine: "feature/invoices ↑3 · 2 files changed",
    state: "in-review",
    checks: "passing",
    checkWord: "Passing",
    checkRows: [{ name: "ci/test", tone: "ok", word: "Passed" }],
    changed: [{ path: "server.js", insertions: 12, deletions: 1 }],
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
  it("is the name, then the facts, then the answer", () => {
    const html = render();
    expect(html).toContain('data-zerops-git-block="api"');
    expect(html).toContain("#12");
    expect(html).toContain("feature/invoices ↑3 · 2 files changed");
    expect(html).toContain("stage picks it up on merge");
    expect(html).toContain("The checks passed. Nothing is stopping it.");
    // The order a person reads in: which repository, what about it, what now.
    expect(html.indexOf(">api<")).toBeLessThan(html.indexOf("feature/invoices ↑3"));
    expect(html.indexOf("feature/invoices ↑3")).toBeLessThan(html.indexOf("The checks passed"));
  });

  it("spends the repository's name once, on the line that is the name", () => {
    // `api · feature/invoices ↑0 ↓0` spent the first third of every row
    // repeating the heading directly above it.
    expect(render().split("api").length - 1).toBe(2); // the data attribute and the name
  });

  it.each([
    { tone: "ok", text: "Merged into main." },
    { tone: "busy", text: "3 commits here are not pushed yet." },
    { tone: "attention", text: "It no longer merges cleanly." },
    { tone: "failed", text: "Its checks failed." },
    { tone: "off", text: "Nothing new here." },
  ] as const)("wears the $tone answer's colour", ({ tone, text }) => {
    const html = render({ block: blockOf({ verdict: { tone, text, ask: undefined } }) });
    expect(html).toContain(`data-zerops-status-tone="${tone}"`);
    expect(html).toContain(text);
  });

  it("says what was proved wrong as the answer, not as a footnote to a greener one", () => {
    const html = render({
      block: blockOf({
        trouble: "This Mate has no Gitea access yet.",
        verdict: { tone: "failed", text: "This Mate has no Gitea access yet.", ask: undefined },
      }),
    });
    expect(html).toContain('data-zerops-status-tone="failed"');
    expect(html).toContain("This Mate has no Gitea access yet.");
  });

  it("says nothing about a pull request there is none of", () => {
    const html = render({
      block: blockOf({
        state: "untouched",
        branch: "main",
        checkoutLine: "main",
        pullRequestNumber: undefined,
        pullRequestUrl: undefined,
        checks: "none",
        checkWord: undefined,
        destination: "",
        verdict: { tone: "off", text: "Nothing new here.", ask: undefined },
      }),
    });
    expect(html).not.toContain("#12");
    expect(html).not.toContain("picks it up");
  });

  it("carries the caller's one verb beside the sentence it acts on", () => {
    const html = render({ action: <button type="button">Merge</button> });
    const panel = html.slice(html.indexOf('data-zerops-primitive="verdict-panel"'));
    expect(panel).toContain(">Merge</button>");
    expect(render()).not.toContain(">Merge</button>");
  });

  it("makes the change's number the way to its own page, never to a forge", () => {
    const html = render({ onOpenChange: () => {} });
    expect(html).toContain('data-zerops-surface="git-change"');
    // The url is still on the block — the change's page uses it — but nothing
    // here links out to it.
    expect(html).not.toContain("gitea.example");
    expect(render()).not.toContain('data-zerops-surface="git-change"');
  });

  it("names each check rather than collapsing them all into one word", () => {
    const html = render({
      block: blockOf({
        checkRows: [
          { name: "ci/test", tone: "ok", word: "Passed" },
          { name: "ci/lint", tone: "failed", word: "Failed" },
        ],
      }),
    });
    expect(html).toContain("ci/test");
    expect(html).toContain("ci/lint");
    expect(html).toContain("Failed");
  });

  it("says nothing about checks where none ran", () => {
    expect(render({ block: blockOf({ checkRows: [] }) })).not.toContain("Checks");
  });

  it("shows what is on disk and not committed, file by file and in total", () => {
    const html = render({
      block: blockOf({
        changed: [
          { path: "server.js", insertions: 12, deletions: 1 },
          { path: "public/app.css", insertions: 2, deletions: 2 },
        ],
      }),
    });
    expect(html).toContain("Not committed · 2");
    expect(html).toContain("server.js");
    expect(html).toContain("public/app.css");
    // The total is the files' own, never a second number from somewhere else.
    expect(html).toContain("+14");
    expect(html).toContain("−3");
  });

  it("says nothing about a clean checkout", () => {
    expect(render({ block: blockOf({ changed: [] }) })).not.toContain("Not committed");
  });
});
