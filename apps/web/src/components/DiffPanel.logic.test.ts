import { describe, expect, it } from "vite-plus/test";

import { TurnId } from "@t3tools/contracts";

import {
  diffScope,
  resolveCheckpointDiffAvailability,
  resolveDiffSelection,
} from "./DiffPanel.logic";

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

describe("resolveDiffSelection", () => {
  const latest = TurnId.make("turn-2");
  const older = TurnId.make("turn-1");
  const turn = (turnId: TurnId) => ({
    kind: "turn" as const,
    turnId,
    filePath: null,
    revealRequestId: 0,
  });

  /**
   * A Mate's workspace (`/var/www`) is no Git repository of its own: its code
   * is in the services' checkouts below it, which every turn's saved diff
   * covers. So there Diff is its turns — the latest one first — and never a
   * working tree or a branch that cannot be read (the owner: "the diff tab
   * hasn't been working / doing anything for ages").
   */
  it.each([
    {
      name: "a Git workspace keeps the working tree",
      input: { selection: { kind: "unstaged" }, isGitRepo: true, latestTurnId: latest },
      expected: { kind: "unstaged" },
    },
    {
      name: "a Git workspace keeps the branch",
      input: {
        selection: { kind: "branch", baseRef: "main" },
        isGitRepo: true,
        latestTurnId: latest,
      },
      expected: { kind: "branch", baseRef: "main" },
    },
    {
      name: "a workspace of checkouts shows the latest turn for the working tree",
      input: { selection: { kind: "unstaged" }, isGitRepo: false, latestTurnId: latest },
      expected: turn(latest),
    },
    {
      name: "a workspace of checkouts shows the latest turn for the branch",
      input: {
        selection: { kind: "branch", baseRef: null },
        isGitRepo: false,
        latestTurnId: latest,
      },
      expected: turn(latest),
    },
    {
      name: "a workspace of checkouts keeps the turn a person picked",
      input: { selection: turn(older), isGitRepo: false, latestTurnId: latest },
      expected: turn(older),
    },
    {
      name: "a workspace of checkouts with no turn yet has nothing to show",
      input: { selection: { kind: "unstaged" }, isGitRepo: false, latestTurnId: undefined },
      expected: { kind: "no-turns" },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: Parameters<typeof resolveDiffSelection>[0];
    expected: ReturnType<typeof resolveDiffSelection>;
  }>)("$name", ({ input, expected }) => {
    expect(resolveDiffSelection(input)).toEqual(expected);
  });
});

describe("diffScope", () => {
  const latest = TurnId.make("turn-2");
  const older = TurnId.make("turn-1");
  const turn = (turnId: TurnId) => ({
    kind: "turn" as const,
    turnId,
    filePath: null,
    revealRequestId: 0,
  });

  /**
   * The scope button names what the body shows: before a Mate's first turn
   * it read "Branch changes" above "No changes yet", and the menu marked
   * nothing.
   */
  it.each([
    { name: "the working tree", shown: { kind: "unstaged" }, expected: "unstaged" },
    { name: "the branch", shown: { kind: "branch", baseRef: null }, expected: "branch" },
    { name: "the latest turn", shown: turn(latest), expected: "latest" },
    { name: "an older turn", shown: turn(older), expected: "turn" },
    {
      name: "no turn yet, where only turns are shown",
      shown: { kind: "no-turns" },
      expected: "latest",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    shown: ReturnType<typeof resolveDiffSelection>;
    expected: ReturnType<typeof diffScope>;
  }>)("$name reads $expected", ({ shown, expected }) => {
    expect(diffScope({ shown, latestTurnId: latest })).toBe(expected);
  });
});
