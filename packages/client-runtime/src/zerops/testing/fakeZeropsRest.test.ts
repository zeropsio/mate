// @effect-diagnostics globalTimers:off -- requests reach the fake as fetch promises; these tests wait one task.
import { describe, expect, it } from "@effect/vitest";

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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(round.waiting()).toBe(2);

    round.release();
    await expect(first).resolves.toEqual(person);
    await expect(second).resolves.toBeNull();

    const failing = rest.hold("GET /user/info");
    const failed = failureOf(client.fetchUser());
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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

    await clientOf(rest).updateProjectGroupTags("p1", { groupId: "g1", role: "dev" });

    // The whole-list PUT lands on the other writer's list and drops its tag.
    const tags = rest.project("p1")?.tagList ?? [];
    expect(seen).toEqual([[]]);
    expect(tags).not.toContain("elsewhere");
    expect(tags.length).toBeGreaterThan(0);
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
