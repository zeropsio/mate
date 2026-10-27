import { describe, expect, it } from "vite-plus/test";

import { resolveDraftWorkspaceMode, resolveWorkspaceModeSelection } from "./workspaceMode";

describe("mobile workspace mode capability", () => {
  it.each([
    { draftMode: "worktree" as const, defaultMode: "local" as const },
    { draftMode: "local" as const, defaultMode: "worktree" as const },
    { draftMode: undefined, defaultMode: "worktree" as const },
  ])("resolves forbidden draft mode %# to local", ({ draftMode, defaultMode }) => {
    expect(
      resolveDraftWorkspaceMode({
        draftMode,
        defaultMode,
        worktreesAllowed: false,
      }),
    ).toBe("local");
  });

  it.each(["local", "worktree"] as const)(
    "keeps the draft's %s pick when worktrees are allowed",
    (draftMode) => {
      expect(
        resolveDraftWorkspaceMode({
          draftMode,
          defaultMode: "local",
          worktreesAllowed: true,
        }),
      ).toBe(draftMode);
    },
  );

  it("treats an absent capability as allowed", () => {
    expect(
      resolveDraftWorkspaceMode({
        draftMode: "worktree",
        defaultMode: "local",
        worktreesAllowed: undefined,
      }),
    ).toBe("worktree");
  });

  it.each([
    { worktreesAllowed: false, expected: "local" as const },
    { worktreesAllowed: true, expected: "worktree" as const },
    { worktreesAllowed: undefined, expected: "worktree" as const },
  ])(
    "resolves a worktree selection to $expected when capability is $worktreesAllowed",
    ({ worktreesAllowed, expected }) => {
      expect(resolveWorkspaceModeSelection("worktree", worktreesAllowed)).toBe(expected);
    },
  );
});
