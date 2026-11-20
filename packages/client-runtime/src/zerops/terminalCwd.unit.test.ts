import { expect, it } from "vite-plus/test";

import { repositoriesOnDisk, terminalStartCwd } from "./terminalCwd.ts";

type StartInput = Parameters<typeof terminalStartCwd>[0];
const start = (
  input: Pick<StartInput, "workspaceRoot" | "repositories"> &
    Partial<Pick<StartInput, "launchCwd" | "worktreePath" | "lease">>,
) => terminalStartCwd({ launchCwd: null, worktreePath: null, lease: null, ...input });

// witness: packages/client-runtime/src/zerops/terminalCwd.ts | if (input.launchCwd != null) return input.launchCwd; → if (false) return input.launchCwd;
it("ZV91: A new terminal starts where it was launched from, over any lease, worktree or checkout", () => {
  const input = {
    workspaceRoot: "/var/www",
    launchCwd: "/var/www/appdev/src",
    repositories: ["appdev"],
  };
  expect(start(input)).toBe("/var/www/appdev/src");
  expect(start({ ...input, lease: "webpool-3" })).toBe("/var/www/appdev/src");
});

// witness: packages/client-runtime/src/zerops/terminalCwd.ts | if (codeFolder !== ZEROPS_WORKSPACE_ROOT) return codeFolder; → if (false) return codeFolder;
it("ZV92: A conversation bound to a lease, with its own worktree, or in a project that is not a Mate's workspace starts its terminal in that folder without waiting for any checkout", () => {
  for (const repositories of [["appdev"], null]) {
    expect(
      start({ workspaceRoot: "/var/www", worktreePath: "/var/www/.lanes/nova", repositories }),
    ).toBe("/var/www/.lanes/nova");
    expect(start({ workspaceRoot: "/var/www", lease: "webpool-3", repositories })).toBe(
      "/var/www/webpool-3",
    );
    expect(start({ workspaceRoot: "/home/nova/tea-shop", repositories })).toBe(
      "/home/nova/tea-shop",
    );
  }
});

// witness: packages/client-runtime/src/zerops/terminalCwd.ts | return first === undefined ? codeFolder : checkoutPathFor(first); → return codeFolder;
it("ZV93: In a Mate's bare workspace a new terminal starts in the first checkout on disk as the Git tab lists them, in the workspace with none, and waits while the checkouts are unread", () => {
  expect(start({ workspaceRoot: "/var/www", repositories: ["appdev"] })).toBe("/var/www/appdev");
  expect(start({ workspaceRoot: "/var/www", repositories: ["api", "web"] })).toBe("/var/www/api");
  expect(start({ workspaceRoot: "/var/www", repositories: [] })).toBe("/var/www");
  expect(start({ workspaceRoot: "/var/www", repositories: null })).toBe(null);
});

// witness: packages/client-runtime/src/zerops/terminalCwd.ts | return hostnames.filter((_, index) => read[index] === true); → return hostnames;
it("ZV94: A Mate's checkouts on disk are those the disk reads as Git repositories, in the Git tab's order; a service listed but not mounted yet is passed over", () => {
  const onDisk = ["/var/www/web"];
  expect(repositoriesOnDisk(["api", "web"], (path) => onDisk.includes(path))).toEqual(["web"]);
  const emptyDisk: string[] = [];
  expect(repositoriesOnDisk(["api", "web"], (path) => emptyDisk.includes(path))).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/terminalCwd.ts | if (read.includes(null)) return null; → if (false) return null;
it("ZV95: While any checkout's read has not answered, which of a Mate's checkouts are on disk is not known", () => {
  expect(
    repositoriesOnDisk(["api", "web"], (path) => (path === "/var/www/api" ? true : null)),
  ).toBe(null);
});
