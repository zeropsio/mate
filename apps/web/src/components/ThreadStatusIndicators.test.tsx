import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { threadStatusVectors } from "@t3tools/shared/threadStatus.vectors";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarThreadSummary } from "../types";
import { ThreadRowLeadingStatus, ThreadWorktreeIndicator } from "./ThreadStatusIndicators";

vi.mock("../state/entities", () => ({ useProject: () => null }));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));

describe("ThreadRowLeadingStatus", () => {
  it("renders Failed for a failed leading status vector", () => {
    const vector = threadStatusVectors.find(({ expected }) => expected.kind === "failed");
    if (!vector) throw new Error("the shared vectors must include a failed status");
    const thread = {
      environmentId: EnvironmentId.make("environment-1"),
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Failed thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      linkedPullRequest: null,
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      latestUserMessageAt: null,
      ...vector.input,
    } satisfies SidebarThreadSummary;

    const markup = renderToStaticMarkup(<ThreadRowLeadingStatus thread={thread} />);

    expect(markup).toContain('aria-label="Failed"');
    expect(markup).toContain(">Failed<");
  });
});

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
