import { describe, expect, it } from "@effect/vitest";
import type { ZeropsDevServer, ZeropsLease } from "@t3tools/contracts";

import { leaseServerOpens, poolWorkspaces } from "./poolWorkspaces.logic.ts";

const server = (overrides: Partial<ZeropsDevServer> = {}): ZeropsDevServer => ({
  name: "web",
  port: 3000,
  url: "https://webpool-1-3000.prg1.zerops.app",
  status: "running",
  readAt: "2026-10-28T10:00:00Z",
  ...overrides,
});

const lease = (overrides: Partial<ZeropsLease> = {}): ZeropsLease =>
  ({
    alias: "webpool-1",
    pool: "webpool",
    state: "held",
    devServers: [server()],
    ...overrides,
  }) as ZeropsLease;

describe("a pool workspace's dev server opens only while it answers", () => {
  it.each([
    ["a held, verified lease whose server runs", lease(), server(), true],
    ["a lease zcp could not confirm with the pool", lease({ unverified: true }), server(), false],
    ["a parked lease", lease({ state: "parked" }), server(), false],
    ["an unmounted lease", lease({ state: "unmounted" }), server(), false],
    ["a lost lease", lease({ state: "lost" }), server(), false],
    ["a server still starting", lease(), server({ status: "starting" }), false],
    ["a crashed server", lease(), server({ status: "crashed" }), false],
    ["a running server with no address", lease(), server({ url: undefined }), false],
  ])("%s: %s", (_, held, read, opens) => {
    expect(leaseServerOpens(held, read)).toBe(opens);
  });
});

describe("poolWorkspaces", () => {
  it("links each workspace of the pool by its chat's title, never a slot or a number", () => {
    const workspaces = poolWorkspaces({
      pool: "webpool",
      leases: [
        lease({ alias: "webpool-1" }),
        lease({
          alias: "webpool-2",
          devServers: [server({ url: "https://webpool-2-3000.prg1.zerops.app" })],
        }),
        lease({ alias: "apipool-1", pool: "apipool" }),
      ],
      chats: [{ title: "Fix the login form", lease: { alias: "webpool-2" } }],
    });

    expect(workspaces.map(({ label, url, why }) => [label, url, why])).toEqual([
      ["dev", "https://webpool-1-3000.prg1.zerops.app", undefined],
      ["Fix the login form", "https://webpool-2-3000.prg1.zerops.app", undefined],
    ]);
  });

  it.each([
    ["parked", lease({ state: "parked" }), "paused"],
    ["unconfirmed", lease({ unverified: true }), "pool not answering"],
    ["starting", lease({ devServers: [server({ status: "starting" })] }), "starting"],
    ["crashed", lease({ devServers: [server({ status: "crashed" })] }), "crashed"],
    ["unread", lease({ devServers: undefined }), "no address yet"],
  ])("says in words why a %s workspace has no link", (_, held, why) => {
    const [workspace] = poolWorkspaces({ pool: "webpool", leases: [held], chats: [] });

    expect(workspace?.url).toBeUndefined();
    expect(workspace?.why).toBe(why);
  });

  it("lists no workspace zcp no longer holds", () => {
    expect(
      poolWorkspaces({
        pool: "webpool",
        leases: [lease({ state: "released" }), lease({ state: "lost" })],
        chats: [],
      }),
    ).toEqual([]);
  });

  it("names a chat bound to the same alias acquired at another time as no chat of this lease", () => {
    const [workspace] = poolWorkspaces({
      pool: "webpool",
      leases: [lease({ acquiredAt: "2026-10-28T09:00:00Z" })],
      chats: [
        { title: "Old chat", lease: { alias: "webpool-1", acquiredAt: "2026-10-20T09:00:00Z" } },
      ],
    });

    expect(workspace?.label).toBe("dev");
  });

  it("names each of a workspace's several previews by its server", () => {
    const workspaces = poolWorkspaces({
      pool: "webpool",
      leases: [
        lease({
          devServers: [
            server({ name: "web" }),
            server({ name: "docs", port: 3001, url: "https://webpool-1-3001.prg1.zerops.app" }),
            server({ name: "worker", port: undefined, url: undefined }),
          ],
        }),
      ],
      chats: [],
    });

    expect(workspaces.map(({ label }) => label)).toEqual(["dev · web", "dev · docs"]);
  });
});
