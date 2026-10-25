import { describe, expect, it } from "@effect/vitest";

import { zeropsOrgStart, type OrgStartClient } from "./hqOrgStart.ts";

const client = (roleCode: string): OrgStartClient & { readonly calls: Array<unknown> } => {
  const calls: Array<unknown> = [];
  return {
    calls,
    verifiedUser: () => null,
    fetchUser: async () =>
      ({
        id: "u1",
        email: "a@b.c",
        clientUserList: [{ id: "cu", clientId: "org-1", roleCode, status: "ACTIVE", client: {} }],
      }) as never,
    mintIntegrationToken: async (input) => {
      calls.push(["mint", input]);
      return { id: "tok-1", token: "secret" } as never;
    },
    deleteIntegrationToken: async (input) => {
      calls.push(["delete", input]);
    },
  };
};

describe("the key an Owner or Admin starts an organisation with", () => {
  it("mints a READ_ONLY token with no project grant, and deletes it by id", async () => {
    const api = client("OWNER");
    const start = zeropsOrgStart(api, "org-1", undefined);
    await expect(start.mintKey()).resolves.toEqual({ id: "tok-1", token: "secret" });
    await start.deleteKey("tok-1");
    expect(api.calls).toEqual([
      ["mint", { clientId: "org-1", name: "mate-hq-org-key", roleCode: "READ_ONLY", projects: [] }],
      ["delete", { clientId: "org-1", tokenId: "tok-1" }],
    ]);
  });

  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["DEVELOPER", false],
  ])("a %s may start it: %s", async (role, may) => {
    await expect(zeropsOrgStart(client(role), "org-1", undefined).mayStart()).resolves.toBe(may);
  });

  it("runs under the lock named for the organisation where Web Locks exist, and without them where not", async () => {
    const named: string[] = [];
    const locks = {
      request: async (name: string, run: () => Promise<unknown>) => {
        named.push(name);
        return run();
      },
    } as unknown as LockManager;
    await zeropsOrgStart(client("OWNER"), "org-1", locks).withLock("n", async () => 1);
    expect(named).toEqual(["n"]);
    await expect(
      zeropsOrgStart(client("OWNER"), "org-1", undefined).withLock("n", async () => 2),
    ).resolves.toBe(2);
  });
});
