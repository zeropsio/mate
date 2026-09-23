import { describe, expect, it } from "vite-plus/test";

import { acquireGiteaPersonToken, MateCredentialError } from "../../authorization/giteaBroker.ts";
import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { createGiteaClient, GiteaApiError } from "../giteaClient.ts";
import { fetchAcross, makeFakeBroker, makeFakeGitea } from "./fakeGitea.ts";

const GITEA = "https://gitea-1-3000.prg1.zerops.app";
const BROKER = "https://broker-1-8080.prg1.zerops.app";

const throwaways: ZeropsThrowawayPlatform = {
  mint: async () => ({ id: "throwaway-1", token: "the-throwaway" }),
  remove: async () => undefined,
};

function forge() {
  const gitea = makeFakeGitea(GITEA);
  const broker = makeFakeBroker({ origin: BROKER, gitea });
  return { gitea, broker, fetch: fetchAcross(gitea, broker) } as const;
}

const acquire = (fetch: typeof globalThis.fetch) =>
  acquireGiteaPersonToken({
    brokerUrl: BROKER,
    giteaUrl: GITEA,
    clientId: "org-1",
    nonce: "n",
    platform: throwaways,
    fetch,
  });

const statusOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (cause: unknown) =>
      cause instanceof MateCredentialError || cause instanceof GiteaApiError
        ? cause.status
        : cause instanceof TypeError
          ? "unreachable"
          : String(cause),
  );

describe("FakeBroker", () => {
  it("mints a person token that the fake Gitea accepts, with the expiry it is set to", async () => {
    const { broker, gitea, fetch } = forge();
    broker.expiresIn(600);

    const answer = await acquire(fetch);

    expect(answer).toMatchObject({ login: "u-person", expiresInMs: 600_000 });
    expect(broker.requests()).toEqual([
      { route: "POST /person/token", bearer: "the-throwaway", mode: null },
    ]);
    gitea.setTags("acme", "group", ["v1.0.0"]);
    const client = createGiteaClient({ origin: GITEA, token: answer.token, fetch });
    await expect(client.listTags("acme", "group")).resolves.toEqual([{ name: "v1.0.0" }]);
    expect(gitea.requests()).toEqual([
      { route: "GET /repos/acme/group/tags", bearer: answer.token },
    ]);
  });

  it("answers 502 while Gitea sets up, 403 to a non-member, and nothing at all while unreachable", async () => {
    const { broker, fetch } = forge();

    broker.answer("setting-up");
    await expect(statusOf(acquire(fetch))).resolves.toBe(502);
    broker.answer("not-a-member");
    await expect(statusOf(acquire(fetch))).resolves.toBe(403);
    broker.answer("unreachable");
    await expect(statusOf(acquire(fetch))).resolves.toBe("unreachable");
    await expect(statusOf(fetch(`${BROKER}/`, { mode: "no-cors" }))).resolves.toBe("unreachable");
    broker.answer("answering");
    await expect(statusOf(acquire(fetch))).resolves.toBe("ok");
    expect(broker.personTokens()).toBe(1);
  });

  it("answers a credential-less request with a 404 while it is up", async () => {
    const { broker, fetch } = forge();
    broker.answer("setting-up");

    const response = await fetch(`${BROKER}/`, { mode: "no-cors", credentials: "omit" });

    expect(response.status).toBe(404);
    expect(broker.requests()).toEqual([{ route: "GET /", bearer: null, mode: "no-cors" }]);
  });
});

describe("FakeGitea", () => {
  it("answers 401 to a revoked token mid-read", async () => {
    const { gitea, fetch } = forge();
    const token = gitea.issue("u-person");
    gitea.setTags("acme", "group", []);
    const client = createGiteaClient({ origin: GITEA, token, fetch });

    await expect(statusOf(client.listTags("acme", "group"))).resolves.toBe("ok");
    gitea.revoke(token);
    await expect(statusOf(client.listTags("acme", "group"))).resolves.toBe(401);
  });

  it("plays a pull request's scripted mergeable sequence, then holds its last value", async () => {
    const { gitea, fetch } = forge();
    const client = createGiteaClient({ origin: GITEA, token: gitea.issue("u-person"), fetch });
    gitea.scriptMergeable("acme", "app", 4, [null, false, true]);

    const seen: Array<boolean | null | undefined> = [];
    for (let read = 0; read < 4; read += 1) {
      seen.push((await client.getPullRequest("acme", "app", 4))?.mergeable);
    }

    expect(seen).toEqual([null, false, true, true]);
  });
});
