import { describe, expect, it } from "vite-plus/test";

import { terminalStartCwd } from "./terminalCwd.logic";

describe("where a new terminal starts", () => {
  it.each([
    {
      sentence: "A Mate's terminal starts in its code checkout, where git status works",
      input: { workspaceRoot: "/var/www", checkouts: ["appdev"] },
      cwd: "/var/www/appdev",
    },
    {
      sentence: "A Mate with several checkouts starts in the first the Git tab lists",
      input: { workspaceRoot: "/var/www", checkouts: ["api", "web"] },
      cwd: "/var/www/api",
    },
    {
      sentence: "While the Mate's checkouts are not read, it starts in its workspace",
      input: { workspaceRoot: "/var/www", checkouts: undefined },
      cwd: "/var/www",
    },
    {
      sentence: "A Mate with no checkout yet starts in its workspace",
      input: { workspaceRoot: "/var/www", checkouts: [] },
      cwd: "/var/www",
    },
    {
      sentence: "A thread's own worktree wins over the checkout",
      input: {
        workspaceRoot: "/var/www",
        worktreePath: "/var/www/.lanes/nova",
        checkouts: ["appdev"],
      },
      cwd: "/var/www/.lanes/nova",
    },
    {
      sentence: "Where the terminal was launched from, it starts there",
      input: { workspaceRoot: "/var/www", launchCwd: "/var/www/appdev/src", checkouts: ["appdev"] },
      cwd: "/var/www/appdev/src",
    },
    {
      sentence: "A project that is not a Mate's workspace starts at its root",
      input: { workspaceRoot: "/home/nova/tea-shop", checkouts: ["appdev"] },
      cwd: "/home/nova/tea-shop",
    },
  ])("$sentence", ({ input, cwd }) => {
    expect(terminalStartCwd({ launchCwd: null, worktreePath: null, ...input })).toBe(cwd);
  });
});
