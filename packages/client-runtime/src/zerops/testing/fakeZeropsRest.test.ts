import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { ZeropsApiClient, ZeropsApiError, type ZeropsUser } from "../api.ts";
import { makeHarnessBrowser } from "./browserTabs.ts";
import { makeFakeZeropsRest } from "./fakeZeropsRest.ts";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

function platform() {
  const rest = makeFakeZeropsRest();
  rest.addUser({ user: person, password: "secret" });
  rest.addProject({ id: "p1", clientId: "org-1", name: "One", status: "ACTIVE", tagList: [] });
  rest.addProject({ id: "p2", clientId: "org-1", name: "Two", status: "ACTIVE", tagList: [] });
  return rest;
}

function clientOf(rest: ReturnType<typeof platform>, session = rest.issueSession("user-1")) {
  const client = new ZeropsApiClient({ fetch: rest.fetch });
  client.restoreSession(session);
  return client;
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (cause: unknown) => (cause instanceof ZeropsApiError ? cause.kind : String(cause)),
  );

describe("FakeZeropsRest", () => {
  it("signs a person in with a password and answers user info for their token", async () => {
    const rest = platform();
    const client = new ZeropsApiClient({ fetch: rest.fetch });

    const response = await client.login("person@example.test", "secret");

    expect(response.user).toEqual(person);
    await expect(client.fetchUser()).resolves.toEqual(person);
    expect(rest.requests().map(({ route, token }) => [route, token])).toEqual([
      ["POST /auth/login", null],
      ["GET /user/info", response.auth.accessToken],
    ]);
    await expect(
      failureOf(new ZeropsApiClient({ fetch: rest.fetch }).login("person@example.test", "wrong")),
    ).resolves.toBe("not-found");
  });

  it("asks for the second factor before it hands out a usable session", async () => {
    const rest = makeFakeZeropsRest();
    rest.addUser({ user: person, password: "secret", totp: "123456" });
    const client = new ZeropsApiClient({ fetch: rest.fetch });

    const response = await client.login("person@example.test", "secret");
    expect(response.user).toBeNull();
    expect(response.auth.twoFAMethods).toEqual(["TOTP"]);
    await expect(failureOf(client.verifyTotp("000000"))).resolves.toBe("invalid-input");

    const verified = await client.verifyTotp("123456");
    expect(verified.twoFAVerified).toBe(true);
    await expect(client.fetchUser()).resolves.toEqual(person);
  });

  it("refreshes an expired access token once and retires the refresh token it spent", async () => {
    const rest = platform();
    const session = rest.issueSession("user-1");
    const client = clientOf(rest, session);

    rest.expireAccessToken(session.accessToken);
    await expect(client.fetchUser()).resolves.toEqual(person);

    expect(rest.refreshes()).toBe(1);
    expect(client.session?.accessToken).not.toBe(session.accessToken);
    const stale = clientOf(rest, session);
    await expect(failureOf(stale.fetchUser())).resolves.toBe("expired-session");
    expect(rest.refreshes()).toBe(1);
  });

  it("revokes the token a sign-out carried", async () => {
    const rest = platform();
    const session = rest.issueSession("user-1");

    await clientOf(rest, session).logout();

    await expect(failureOf(clientOf(rest, session).fetchUser())).resolves.toBe("expired-session");
  });

  it("lists an organization's projects to its members only", async () => {
    const rest = platform();
    rest.addProject({ id: "p3", clientId: "org-2", name: "Other", status: "ACTIVE" });

    const listed = await clientOf(rest).listAccessibleClientProjects("org-1");

    expect(listed.map(({ id }) => id)).toEqual(["p1", "p2"]);
    await expect(failureOf(clientOf(rest).listClientProjects("org-2"))).resolves.toBe("forbidden");
  });

  // Measured 2026-10-03 as the KRLS Developer (NO_ACCESS, OWNER on Cyd by its grant): the
  // organization's list answers 403; `/project/search` lists the projects their grants name, each
  // row carrying only their own grant; `GET /project/{id}` answers one of those whole, every
  // member's grant on it.
  it("answers a NO_ACCESS member as Zerops does: refused the list, searched to their grants", async () => {
    const rest = platform();
    const developer: ZeropsUser = {
      id: "user-dev",
      email: "developer@example.test",
      clientUserList: [{ id: "cu-dev", clientId: "org-1", roleCode: "NO_ACCESS" }],
    };
    rest.addUser({ user: developer, password: "secret" });
    const grants = [
      { clientUserId: "cu-mate", roleCode: "BASIC_USER" },
      { clientUserId: "cu-dev", roleCode: "OWNER" },
    ];
    rest.addProject({
      id: "cyd",
      clientId: "org-1",
      name: "Cyd",
      status: "ACTIVE",
      userRoles: grants,
    });
    const client = clientOf(rest, rest.issueSession("user-dev"));

    await expect(failureOf(client.listClientProjects("org-1"))).resolves.toBe("forbidden");
    const searched = await client.listAccessibleClientProjects("org-1");
    expect(
      searched.map(({ id, userRoles }) => [
        id,
        userRoles?.map(({ clientUserId, roleCode }) => [clientUserId, roleCode]),
      ]),
    ).toEqual([["cyd", [["cu-dev", "OWNER"]]]]);
    expect(searched[0]?.userRoles?.[0]).toMatchObject({ clientId: "org-1", projectId: "cyd" });
    await expect(client.fetchProject("cyd")).resolves.toMatchObject({ userRoles: grants });
    await expect(failureOf(client.fetchProject("p1"))).resolves.toBe("forbidden");
  });

  it("lists an organization's integration tokens whole, reads one by its id, rewrites it in place", async () => {
    const rest = platform();
    const client = clientOf(rest);
    rest.addIntegrationToken("org-1", {
      id: "t1",
      name: "zcp-One",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p1", roleCode: "ADMIN" }],
    });

    await expect(client.listIntegrationTokens("org-1")).resolves.toEqual([
      {
        id: "t1",
        name: "zcp-One",
        roleCode: "NO_ACCESS",
        projects: [{ projectId: "p1", roleCode: "ADMIN" }],
      },
    ]);
    await expect(client.readIntegrationToken("org-1", "t1")).resolves.toMatchObject({
      id: "t1",
      projects: [{ projectId: "p1", roleCode: "ADMIN" }],
    });
    await expect(client.readIntegrationToken("org-1", "gone")).resolves.toBeUndefined();
    await client.setIntegrationTokenProjects({
      clientId: "org-1",
      tokenId: "t1",
      name: "zcp-One",
      projects: [{ projectId: "p1", roleCode: "BASIC_USER" }],
    });
    expect(rest.integrationToken("org-1", "t1")).toMatchObject({
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p1", roleCode: "BASIC_USER" }],
    });
  });

  it("answers each project with the failure a test gives it", async () => {
    const rest = platform();
    const client = clientOf(rest);
    rest.failProject("p1", 403);
    rest.failProject("p2", 503);

    await expect(failureOf(client.fetchProject("p1"))).resolves.toBe("forbidden");
    await expect(failureOf(client.fetchProject("p2"))).resolves.toBe("server");
    await expect(failureOf(client.fetchProject("absent"))).resolves.toBe("not-found");
    rest.failProject("p2", null);
    await expect(client.fetchProject("p2")).resolves.toMatchObject({ id: "p2" });
  });

  it("holds a round's requests until the test settles them", async () => {
    const rest = platform();
    const client = clientOf(rest);
    const round = rest.hold("GET /user/info");

    const first = client.fetchUser();
    const second = failureOf(clientOf(rest).fetchUser());
    await vi.waitFor(() => expect(round.waiting()).toBe(2));

    round.release();
    await expect(first).resolves.toEqual(person);
    await expect(second).resolves.toBeNull();

    const failing = rest.hold("GET /user/info");
    const failed = failureOf(client.fetchUser());
    await vi.waitFor(() => expect(failing.waiting()).toBe(1));
    failing.fail(503);
    await expect(failed).resolves.toBe("server");
    await expect(client.fetchUser()).resolves.toEqual(person);
  });

  it("hangs a request until its caller aborts it", async () => {
    const rest = platform();
    const client = clientOf(rest);
    rest.hang("GET /project/p1");
    const abort = new AbortController();

    const pending = failureOf(client.fetchProject("p1", abort.signal));
    await vi.waitFor(() =>
      expect(rest.requests().some((request) => request.route === "GET /project/p1")).toBe(true),
    );
    abort.abort();

    await expect(pending).resolves.toBe("network");
  });

  it("tracks every minted token with the token that minted it and the one that deleted it", async () => {
    const rest = platform();
    const first = rest.issueSession("user-1");
    const second = rest.issueSession("user-1");

    const kept = await clientOf(rest, first).mintIntegrationToken({
      clientId: "org-1",
      name: "throwaway",
      roleCode: "BASIC_USER",
    });
    const deleted = await clientOf(rest, first).mintIntegrationToken({
      clientId: "org-1",
      name: "throwaway",
      roleCode: "BASIC_USER",
    });
    await clientOf(rest, second).deleteIntegrationToken({
      clientId: "org-1",
      tokenId: deleted.id,
    });

    expect(rest.integrationTokens()).toEqual([
      { id: kept.id, clientId: "org-1", mintedWith: first.accessToken, deletedWith: null },
      {
        id: deleted.id,
        clientId: "org-1",
        mintedWith: first.accessToken,
        deletedWith: second.accessToken,
      },
    ]);
    expect(rest.orphanTokens().map(({ id }) => id)).toEqual([kept.id]);
  });

  it("lets another writer change a project's tags between a read and a write", async () => {
    const rest = platform();
    const seen: Array<ReadonlyArray<string>> = [];
    rest.writeTagsConcurrently("p1", (tags) => {
      seen.push(tags);
      return [...tags, "elsewhere"];
    });

    const client = clientOf(rest);
    const read = await client.fetchProject("p1");
    await client.writeProject(read, { name: read.name, tagList: ["mate"] });

    // The whole-list PUT lands on the other writer's list and drops its tag.
    const tags = rest.project("p1")?.tagList ?? [];
    expect(seen).toEqual([[]]);
    expect(tags).toEqual(["mate"]);
    expect(rest.requests().map(({ route }) => route)).toEqual([
      "GET /project/p1",
      "PUT /project/p1",
    ]);
  });

  it("fails a tab's requests at the network while that tab is offline", async () => {
    const rest = platform();
    const tab = makeHarnessBrowser().openTab();
    const client = new ZeropsApiClient({ fetch: rest.fetchFor(tab) });
    client.restoreSession(rest.issueSession("user-1"));

    tab.signals.offline();
    await expect(failureOf(client.fetchUser())).resolves.toBe("network");
    tab.signals.online();
    await expect(client.fetchUser()).resolves.toEqual(person);
    expect(rest.requests().map(({ tab: from }) => from)).toEqual([tab.id]);
  });
});
