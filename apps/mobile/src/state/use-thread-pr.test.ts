import type { VcsStatusResult } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("./query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("./vcs", () => ({ vcsEnvironment: { status: () => null } }));

import { presentThreadPr } from "./thread-pr-presentation";
import { presentLinkedThreadPr } from "./use-thread-pr";

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 3774,
  title: "Desktop-style pull request indicator",
  url: "https://github.com/t3tools/t3code/pull/3774",
  baseRef: "main",
  headRef: "codex/desktop-style-pr-indicator",
  state: "merged",
};

describe("presentThreadPr", () => {
  it("uses the compact pull request number label without a hash prefix", () => {
    expect(presentThreadPr(pullRequest, undefined)).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 pull request merged",
      textClassName: "text-adaptive-violet-600-400",
    });
  });

  it("uses merge-request terminology for GitLab", () => {
    expect(
      presentThreadPr(pullRequest, {
        kind: "gitlab",
        name: "GitLab",
        baseUrl: "https://gitlab.com",
      }),
    ).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 merge request merged",
    });
  });
});

describe("presentLinkedThreadPr", () => {
  it("a linked pull request presents as a link without a detail query", () => {
    expect(
      presentLinkedThreadPr({
        projectId: ProjectId.make("project-1"),
        repository: "t3tools/t3code",
        number: 3774,
        url: "https://github.com/t3tools/t3code/pull/3774",
      }),
    ).toEqual({
      number: 3774,
      repository: "t3tools/t3code",
      label: "3774",
      accessibilityLabel: "#3774 pull request",
      url: "https://github.com/t3tools/t3code/pull/3774",
      textClassName: "text-foreground-tertiary",
    });
  });
});
