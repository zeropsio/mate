import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { threadStatusVectors } from "@t3tools/shared/threadStatus.vectors";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarThreadSummary } from "../types";
import {
  ThreadRowLeadingStatus,
  ThreadRowResolvedStatus,
  ThreadRowTrailingStatus,
  ThreadWorktreeIndicator,
} from "./ThreadStatusIndicators";

const reads = vi.hoisted(() => ({
  phase: "connected" as string,
  queries: [] as unknown[],
  terminals: [] as Array<{ environmentId: unknown }>,
}));

vi.mock("../state/entities", () => ({ useProject: () => null }));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    reads.queries.push(atom);
    return { data: null };
  },
}));
vi.mock("../state/terminalSessions", () => ({
  useThreadRunningTerminalIds: (input: { environmentId: unknown }) => {
    reads.terminals.push(input);
    // As the real hook: no environment, no metadata read, no terminal.
    return input.environmentId === null ? [] : ["terminal-1"];
  },
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ label: "Fen", connection: { phase: reads.phase } }),
  usePrimaryEnvironmentId: () => null,
}));

const branchThread = {
  environmentId: EnvironmentId.make("environment-1"),
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Branch thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  branch: "feature/palette",
  worktreePath: "/workspace/palette",
  linkedPullRequest: null,
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  interactionMode: "default",
  session: null,
  latestTurn: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
} satisfies SidebarThreadSummary;

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

describe("ThreadRowLeadingStatus — change status", () => {
  it.each([
    { phase: "connected", reads: true },
    { phase: "available", reads: false },
    { phase: "reconnecting", reads: false },
  ])(
    "reads a branch's change status only from a connected Mate ($phase)",
    ({ phase, reads: expected }) => {
      reads.phase = phase;
      reads.queries = [];

      renderToStaticMarkup(<ThreadRowLeadingStatus thread={branchThread} />);

      expect(reads.queries).toHaveLength(1);
      expect(reads.queries[0] !== null).toBe(expected);
    },
  );
});

describe("ThreadRowResolvedStatus", () => {
  it("draws a status resolved without the thread as a row draws its own", () => {
    expect(
      renderToStaticMarkup(
        <ThreadRowResolvedStatus status={{ kind: "failed", toneId: "danger" }} />,
      ),
    ).toContain('aria-label="Failed"');
    expect(
      renderToStaticMarkup(
        <ThreadRowResolvedStatus status={{ kind: "idle", toneId: "neutral" }} />,
      ),
    ).toBe("");
  });
});

describe("ThreadRowTrailingStatus — running terminal", () => {
  it.each([
    { phase: "connected", shown: true },
    { phase: "available", shown: false },
  ])("shows a running terminal only for a connected Mate ($phase)", ({ phase, shown }) => {
    reads.phase = phase;
    reads.terminals = [];

    const markup = renderToStaticMarkup(<ThreadRowTrailingStatus thread={branchThread} />);

    expect(reads.terminals.map((input) => input.environmentId !== null)).toEqual([shown]);
    expect(markup.includes('aria-label="Terminal process running"')).toBe(shown);
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
    expect(markup).not.toMatch(/PR #42 (?:open|merged|closed)/u);
  });
});
