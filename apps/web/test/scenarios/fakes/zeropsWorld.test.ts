// @effect-diagnostics nodeBuiltinImport:off -- driver tests exercise real loopback HTTP.
import { describe, expect, it } from "vite-plus/test";
import { emptyWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import { serve } from "../harness/http.ts";
import { ZeropsFake } from "./zerops.ts";
import { definePerson, projectRoles } from "./zeropsWorld.ts";

describe("Zerops world organizations and people", () => {
  it("exposes Developer creation rights, READ_ONLY and explicit membership/grant overrides", async () => {
    const fake = new ZeropsFake(emptyWorld());
    definePerson(fake.world, "dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
    definePerson(fake.world, "reader", { role: "READ_ONLY" });
    fake.put("project", {
      id: "Ada",
      name: "Ada",
      clientId: "ORG",
      userRoles: projectRoles(fake.world, "Ada"),
    });
    fake.put("project", { id: "Bea", name: "Bea", clientId: "ORG" });
    const server = await serve(fake.handle, fake.socket);
    const call = (person: string, path: string) =>
      fetch(`${server.origin}/api/rest/public${path}`, {
        headers: { authorization: `Bearer personal-${person}` },
      });
    try {
      const info = await (await call("dev", "/user/info")).json();
      expect(info.clientUserList[0]).toMatchObject({
        roleCode: "NO_ACCESS",
        canCreateProjects: true,
        status: "ACTIVE",
      });
      expect((await call("dev", "/project/Ada")).status).toBe(200);
      expect((await call("dev", "/project/Bea")).status).toBe(403);
      expect((await call("reader", "/project/Bea")).status).toBe(200);
      expect(fake.canWrite("personal-dev", "Ada")).toBe(true);
      expect(fake.canWrite("personal-reader", "Bea")).toBe(false);
      definePerson(fake.world, "dev", {
        role: "NO_ACCESS",
        canCreateProjects: false,
        grants: { Ada: "READ_ONLY" },
      });
      expect(fake.canWrite("personal-dev", "Ada")).toBe(false);
      expect(
        (await (await call("dev", "/user/info")).json()).clientUserList[0].canCreateProjects,
      ).toBe(false);
      definePerson(fake.world, "reader", { role: "ADMIN", grants: { Bea: "NO_ACCESS" } });
      expect((await call("reader", "/project/Bea")).status).toBe(403);
      expect((await call("reader", "/project/Ada")).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("lists every membership and scopes settings, members, projects, tokens and searches by organization", async () => {
    const fake = new ZeropsFake(emptyWorld());
    fake.world.organizations.set("ORG", { name: "First" });
    fake.world.organizations.set("OTHER", {
      name: "Second",
      settings: { locationList: [{ id: "region-two" }] },
    });
    definePerson(fake.world, "owner", { role: "OWNER" });
    definePerson(fake.world, "owner", { orgId: "OTHER", role: "READ_ONLY" });
    definePerson(fake.world, "colleague", {
      orgId: "OTHER",
      role: "Developer",
      grants: { Cara: "BASIC_USER" },
    });
    fake.put("project", { id: "Ada", name: "Ada", clientId: "ORG" });
    fake.put("project", {
      id: "Cara",
      name: "Cara",
      clientId: "OTHER",
      userRoles: projectRoles(fake.world, "Cara", "OTHER"),
    });
    fake.put("project", { id: "Dora", name: "Dora", clientId: "OTHER" });
    const server = await serve(fake.handle, fake.socket);
    const call = (path: string, body?: unknown, token = "personal") =>
      fetch(`${server.origin}/api/rest/public${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      const info = await (await call("/user/info")).json();
      expect(info.clientUserList).toMatchObject([
        { id: "C-owner", clientId: "ORG", roleCode: "OWNER", client: { accountName: "First" } },
        {
          id: "C-OTHER-owner",
          clientId: "OTHER",
          roleCode: "READ_ONLY",
          client: { accountName: "Second" },
        },
      ]);
      expect(
        (await (await call("/client/ORG/project")).json()).list.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual(["Ada"]);
      expect(
        (await (await call("/client/OTHER/project")).json()).list.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual(["Cara", "Dora"]);
      expect((await (await call("/client/OTHER/settings")).json()).locationList).toEqual([
        { id: "region-two" },
      ]);
      expect(
        (await (await call("/client/OTHER/user/list")).json()).clientUserList.map(
          (row: { userId: string }) => row.userId,
        ),
      ).toEqual(["owner", "colleague"]);
      expect((await call("/client/ORG/settings", undefined, "personal-colleague")).status).toBe(
        403,
      );
      expect(fake.canWrite("personal", "Cara")).toBe(false);
      expect(fake.canWrite("personal-colleague", "Cara")).toBe(true);
      const token = await (
        await call("/client/OTHER/integration-token", {
          name: "other-token",
          roleCode: "READ_ONLY",
        })
      ).json();
      expect(fake.world.tokens.get(token.token)?.orgId).toBe("OTHER");
      expect(
        (await (await call("/client/ORG/integration-token/list")).json()).integrationTokenList.some(
          (row: { id: string }) => row.id === token.id,
        ),
      ).toBe(false);
      expect(
        (
          await (await call("/client/OTHER/integration-token/list")).json()
        ).integrationTokenList.some((row: { id: string }) => row.id === token.id),
      ).toBe(true);
      expect((await call(`/client/ORG/integration-token/${token.id}`)).status).toBe(400);
      expect((await call("/client/ORG/project", undefined, token.token)).status).toBe(403);
      const search = { search: [{ name: "clientId", operator: "eq", value: "OTHER" }] };
      expect(
        (await (await call("/project/search", search)).json()).items.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual(["Cara", "Dora"]);
      expect(
        (await (await call("/project/search", search, "personal-colleague")).json()).items.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual(["Cara"]);
      definePerson(fake.world, "owner", { orgId: "OTHER", grants: { Cara: "NO_ACCESS" } });
      expect((await call("/project/Cara")).status).toBe(403);
      expect((await call("/project/Ada")).status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
