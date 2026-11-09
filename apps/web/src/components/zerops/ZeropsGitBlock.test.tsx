import type { GitBlock } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGitBlock } from "./ZeropsGitBlock";

/** The change's own address at its HQ (`changeUrl`). */
const CHANGE_URL = "https://hq.example.test/changes/acme/api/12";

function blockOf(overrides: Partial<GitBlock> = {}): GitBlock {
  return {
    repository: "api",
    hqRepository: "api",
    branch: "feature/invoices",
    baseBranch: "main",
    verdict: { tone: "off", text: "Ready to merge", ask: undefined },
    checkoutLine: "feature/invoices ↑3 · 2 files changed",
    state: "in-review",
    changed: [{ path: "server.js", insertions: 12, deletions: 1 }],
    pullRequestNumber: 12,
    pullRequestHead: "c0ffee",
    pullRequestUrl: CHANGE_URL,
    destination: "stage picks it up on merge",
    action: undefined,
    trouble: "",
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof ZeropsGitBlock>> = {}) =>
  renderToStaticMarkup(<ZeropsGitBlock block={blockOf()} {...props} />);

describe("ZeropsGitBlock", () => {
  it("says nothing about a clean checkout", () => {
    expect(render({ block: blockOf({ changed: [] }) })).not.toContain("Not committed");
  });
});
