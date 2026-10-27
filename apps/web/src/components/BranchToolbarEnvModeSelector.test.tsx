import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";

function renderSelector(worktreesAllowed: boolean) {
  return renderToStaticMarkup(
    <BranchToolbarEnvModeSelector
      envLocked={false}
      worktreesAllowed={worktreesAllowed}
      effectiveEnvMode="worktree"
      activeWorktreePath={null}
      onEnvModeChange={() => {}}
      previousWorktreeLabel="Previous worktree (feature-a)"
      onUsePreviousWorktree={() => {}}
    />,
  );
}

describe("BranchToolbarEnvModeSelector", () => {
  it("omits worktree choices when the environment forbids them", () => {
    const markup = renderSelector(false);

    expect(markup).not.toContain('value="worktree"');
    expect(markup).not.toContain("New worktree");
    expect(markup).not.toContain("Previous worktree");
  });

  it("offers a new worktree when the environment allows it", () => {
    const markup = renderSelector(true);

    expect(markup).toContain('value="worktree"');
    expect(markup).toContain("New worktree");
  });

  it("keeps the real label for a locked thread in an existing worktree", () => {
    const markup = renderToStaticMarkup(
      <BranchToolbarEnvModeSelector
        envLocked
        worktreesAllowed={false}
        effectiveEnvMode="local"
        activeWorktreePath="/repo/.t3/worktrees/feature-a"
        onEnvModeChange={() => {}}
      />,
    );

    expect(markup).toContain("Worktree");
    expect(markup).not.toContain("Local checkout");
  });
});
