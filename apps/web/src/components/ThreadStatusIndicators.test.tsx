import { ProjectId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadWorktreeIndicator } from "./ThreadStatusIndicators";

describe("ThreadWorktreeIndicator", () => {
  it("renders the worktree folder and branch in an accessible label", () => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "feature/sidebar-indicator",
          worktreePath: "/tmp/worktrees/sidebar-indicator",
        }}
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Worktree: sidebar-indicator (feature/sidebar-indicator)"',
    );
    expect(markup).toContain('data-testid="thread-worktree-thread-1"');
  });

  it.each([null, "", "   "])("renders nothing for an absent worktree path", (worktreePath) => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "main",
          worktreePath,
        }}
      />,
    );

    expect(markup).toBe("");
  });
});

describe("LinkedPullRequestLink", () => {
  it("renders the static pull request number and exact external href without state", async () => {
    const module = await import("./ThreadStatusIndicators");
    expect(module.LinkedPullRequestLink).toBeTypeOf("function");
    if (typeof module.LinkedPullRequestLink !== "function") return;

    const markup = renderToStaticMarkup(
      <module.LinkedPullRequestLink
        indicator={module.linkedPullRequestIndicator({
          projectId: ProjectId.make("project-1"),
          repository: "pingdotgg/t3code",
          number: 42,
          url: "https://github.com/pingdotgg/t3code/pull/42",
        })}
      />,
    );

    expect(markup).toContain('href="https://github.com/pingdotgg/t3code/pull/42"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(">#42</a>");
    expect(markup).not.toMatch(/text-(?:emerald|violet|red)|PR #42 (?:open|merged|closed)/u);
  });
});
