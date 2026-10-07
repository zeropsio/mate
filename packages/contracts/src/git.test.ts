import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  VcsCreateRefInput,
  GitCommandError,
  VcsCreateWorktreeInput,
  VcsSwitchRefInput,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeSwitchRefInput = Schema.decodeUnknownSync(VcsSwitchRefInput);
const decodeCreateRefInput = Schema.decodeUnknownSync(VcsCreateRefInput);
const decodeGitCommandError = Schema.decodeUnknownSync(GitCommandError);

describe("ref names that git would read as an option", () => {
  const inputs = [
    {
      name: "VcsSwitchRefInput",
      decode: (refName: string) => decodeSwitchRefInput({ cwd: "/repo", refName }),
    },
    {
      name: "VcsCreateRefInput",
      decode: (refName: string) => decodeCreateRefInput({ cwd: "/repo", refName }),
    },
    {
      name: "VcsCreateWorktreeInput.refName",
      decode: (refName: string) => decodeCreateWorktreeInput({ cwd: "/repo", refName, path: null }),
    },
    {
      name: "VcsCreateWorktreeInput.newRefName",
      decode: (refName: string) =>
        decodeCreateWorktreeInput({
          cwd: "/repo",
          refName: "main",
          newRefName: refName,
          path: null,
        }),
    },
    {
      name: "VcsCreateWorktreeInput.baseRefName",
      decode: (refName: string) =>
        decodeCreateWorktreeInput({
          cwd: "/repo",
          refName: "main",
          baseRefName: refName,
          path: null,
        }),
    },
  ];

  describe.each(inputs)("$name", ({ decode }) => {
    it.each(["--upload-pack=x", "-b", "-"])("refuses %s", (refName) => {
      expect(() => decode(refName)).toThrow();
    });

    it.each(["main", "feature/x-1", "origin/main", "0123456789abcdef"])("accepts %s", (refName) => {
      expect(() => decode(refName)).not.toThrow();
    });
  });
});

describe("VcsCreateWorktreeInput", () => {
  it("accepts omitted newRefName for existing-refName worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newRefName).toBeUndefined();
    expect(parsed.refName).toBe("feature/existing");
  });

  it("accepts baseRefName metadata for a new worktree ref", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "0123456789abcdef",
      newRefName: "feature/new",
      baseRefName: "origin/main",
      path: "/tmp/worktree",
    });

    expect(parsed.baseRefName).toBe("origin/main");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});

describe("GitCommandError", () => {
  const encoded = (reason: string) => ({
    _tag: "GitCommandError",
    operation: "GitVcsDriver.fetch",
    command: "git fetch",
    cwd: "/repo",
    detail: "git fetch failed.",
    reason,
  });

  it.each([
    { reason: "authentication_failed", decoded: "authentication_failed" },
    { reason: "dubious_ownership", decoded: undefined },
  ])("an older client still decodes a failure whose reason is $reason", ({ reason, decoded }) => {
    const error = decodeGitCommandError(encoded(reason));
    expect(error.detail).toBe("git fetch failed.");
    expect(error.reason).toBe(decoded);
  });
});
