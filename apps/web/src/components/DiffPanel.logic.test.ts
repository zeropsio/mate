import { describe, expect, it } from "vite-plus/test";

import { resolveCheckpointDiffAvailability } from "./DiffPanel.logic";

describe("resolveCheckpointDiffAvailability", () => {
  it("keeps a selected checkpoint diff available when the workspace cwd is not one Git repo", () => {
    expect(
      resolveCheckpointDiffAvailability({
        hasActiveThread: true,
        hasSelectedTurn: true,
        isTurnScope: true,
        isGitRepo: false,
      }),
    ).toEqual({ enabled: true, showNotRepository: false });
  });

  it("keeps the non-repository state scoped to working-tree and branch views", () => {
    expect(
      resolveCheckpointDiffAvailability({
        hasActiveThread: true,
        hasSelectedTurn: false,
        isTurnScope: false,
        isGitRepo: false,
      }),
    ).toEqual({ enabled: false, showNotRepository: true });
  });

  it("does not query without an active thread", () => {
    expect(
      resolveCheckpointDiffAvailability({
        hasActiveThread: false,
        hasSelectedTurn: true,
        isTurnScope: true,
        isGitRepo: true,
      }),
    ).toEqual({ enabled: false, showNotRepository: false });
  });

  it("does not replace an empty turn scope with the single-repository warning", () => {
    expect(
      resolveCheckpointDiffAvailability({
        hasActiveThread: true,
        hasSelectedTurn: false,
        isTurnScope: true,
        isGitRepo: false,
      }),
    ).toEqual({ enabled: false, showNotRepository: false });
  });
});
