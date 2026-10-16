import { describe, expect, it } from "vite-plus/test";

import { repositoriesOnDisk, terminalStartCwd } from "./terminalCwd.logic";

describe("where a new terminal starts", () => {
  it.each([
    {
      sentence: "A Mate's terminal starts in its code checkout, where git status works",
      input: { workspaceRoot: "/var/www", repositories: ["appdev"] },
      cwd: "/var/www/appdev",
    },
    {
      sentence: "A Mate with several checkouts starts in the first the Git tab lists",
      input: { workspaceRoot: "/var/www", repositories: ["api", "web"] },
      cwd: "/var/www/api",
    },
    {
      sentence: "A Mate with no checkout on disk yet starts in its workspace",
      input: { workspaceRoot: "/var/www", repositories: [] },
      cwd: "/var/www",
    },
    {
      sentence: "A thread's own worktree wins over the checkout",
      input: {
        workspaceRoot: "/var/www",
        worktreePath: "/var/www/.lanes/nova",
        repositories: ["appdev"],
      },
      cwd: "/var/www/.lanes/nova",
    },
    {
      sentence: "Where the terminal was launched from, it starts there",
      input: {
        workspaceRoot: "/var/www",
        launchCwd: "/var/www/appdev/src",
        repositories: ["appdev"],
      },
      cwd: "/var/www/appdev/src",
    },
    {
      sentence: "A project that is not a Mate's workspace starts at its root",
      input: { workspaceRoot: "/home/nova/tea-shop", repositories: ["appdev"] },
      cwd: "/home/nova/tea-shop",
    },
  ])("$sentence", ({ input, cwd }) => {
    expect(terminalStartCwd({ launchCwd: null, worktreePath: null, ...input })).toBe(cwd);
  });

  it.each([
    {
      sentence: "A service listed but not mounted yet is passed over for the next checkout",
      onDisk: ["/var/www/web"],
      repositories: ["web"],
    },
    {
      sentence: "With no checkout read as a repository, none is offered and the workspace stands",
      onDisk: [],
      repositories: [],
    },
  ])("$sentence", ({ onDisk, repositories }) => {
    expect(repositoriesOnDisk(["api", "web"], (path) => onDisk.includes(path))).toEqual(
      repositories,
    );
  });
});
