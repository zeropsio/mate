import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiClient } from "./api.ts";
import { canCreateEnvironment, RECIPE_GROUP_PATH, type ZeropsGroupRecord } from "./recipeStore.ts";
import { GO_HELLO_WORLD_GROUP, GO_HELLO_WORLD_GROUP_ID } from "./recipeStoreSeed.ts";
import { withRecipeStoreMock } from "./recipeStoreMock.ts";

const BASE = "https://api.app-prg1.zerops.io/api/rest/public";
const url = (groupId: string) => `${BASE}${RECIPE_GROUP_PATH}/${groupId}`;

/** A fetch that fails loudly: reaching it means the mock declined to answer. */
const passthroughMarker = () => Promise.resolve(new Response("passed through", { status: 418 }));

describe("withRecipeStoreMock", () => {
  it("answers a group it holds with that group's record", async () => {
    const fetch = withRecipeStoreMock(passthroughMarker);

    const response = await fetch(url(GO_HELLO_WORLD_GROUP_ID));
    const record = (await response.json()) as ZeropsGroupRecord;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(record.name).toBe("Go Hello World");
    expect(record.recipes.prod).toBe(GO_HELLO_WORLD_GROUP.recipes.prod);
  });

  it("404s a group nobody has published a recipe for, rather than lending it the showcase app", async () => {
    const fetch = withRecipeStoreMock(passthroughMarker);

    const response = await fetch(url("6qxmgx4chfcm"));

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("notFound");
  });

  it("holds what it is given", async () => {
    const mine: ZeropsGroupRecord = {
      groupId: "abc",
      name: "Mine",
      recipes: { prod: "services:" },
    };
    const fetch = withRecipeStoreMock(passthroughMarker, { records: [mine] });

    expect((await (await fetch(url("abc"))).json()) as ZeropsGroupRecord).toEqual(mine);
    expect((await fetch(url(GO_HELLO_WORLD_GROUP_ID))).status).toBe(404);
  });

  it.each([
    { method: "POST", label: "create" },
    { method: "PUT", label: "replace" },
    { method: "PATCH", label: "amend" },
    { method: "DELETE", label: "remove" },
  ])("refuses to $label — the store is read-only, so $method is 405", async ({ method }) => {
    const fetch = withRecipeStoreMock(passthroughMarker);

    const response = await fetch(url(GO_HELLO_WORLD_GROUP_ID), { method });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "methodNotAllowed",
    );
  });

  it.each([
    { path: "/project/search", why: "another endpoint on the same API" },
    { path: `${RECIPE_GROUP_PATH}`, why: "the collection, which has no route" },
    { path: `${RECIPE_GROUP_PATH}/one/two`, why: "a deeper path than a group id" },
  ])("passes $why through to the real fetch", async ({ path }) => {
    const fetch = withRecipeStoreMock(passthroughMarker);

    expect((await fetch(`${BASE}${path}`)).status).toBe(418);
  });

  it("passes through a host that is not the API being mocked", async () => {
    const fetch = withRecipeStoreMock(passthroughMarker);

    const response = await fetch(`https://example.invalid${RECIPE_GROUP_PATH}/abc`);

    expect(response.status).toBe(418);
  });
});

describe("ZeropsApiClient.readRecipeGroup against the mock", () => {
  const clientWith = (options?: Parameters<typeof withRecipeStoreMock>[1]) => {
    const client = new ZeropsApiClient({
      fetch: withRecipeStoreMock(
        () => Promise.reject(new Error("the mock let a recipe read reach the network")),
        options,
      ),
    });
    return client;
  };

  it("reads a group through the real client: real path, real parse", async () => {
    const record = await clientWith().readRecipeGroup(GO_HELLO_WORLD_GROUP_ID);

    expect(record?.groupId).toBe(GO_HELLO_WORLD_GROUP_ID);
    expect(record?.recipes.prod).toContain("hostname: app");
  });

  it("turns the endpoint's 404 into 'no recipe yet', not an error", async () => {
    const record = await clientWith({ records: [] }).readRecipeGroup("unpublished");

    expect(record).toBeUndefined();
    expect(canCreateEnvironment(record, "prod")).toEqual({
      allowed: false,
      reason: "This group has no recipe yet.",
    });
  });

  it("offers no way to write one — the client has no such method", () => {
    const client = clientWith();

    expect("writeRecipeGroup" in client).toBe(false);
    expect(Object.getOwnPropertyNames(ZeropsApiClient.prototype)).not.toContain("writeRecipeGroup");
  });
});
