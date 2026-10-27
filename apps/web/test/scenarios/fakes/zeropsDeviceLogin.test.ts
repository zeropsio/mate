// @effect-diagnostics nodeBuiltinImport:off -- wire-level fidelity tests use real loopback sockets.
import { describe, it, expect } from "vite-plus/test";
import { emptyWorld } from "../harness/fakeWorld.ts";
import { serve } from "../harness/http.ts";
import { ZeropsFake } from "./zerops.ts";
import { definePerson } from "./zeropsWorld.ts";

async function rig() {
  const fake = new ZeropsFake(emptyWorld());
  const { token } = definePerson(fake.world, "owner", { role: "OWNER" });
  const server = await serve(fake.handle, fake.socket);
  const call = async (
    path: string,
    options: {
      body?: unknown;
      bearer?: string;
      form?: Record<string, string>;
      person?: string;
    } = {},
  ) => {
    const response = await fetch(`${server.origin}${path}`, {
      method: options.body === undefined && options.form === undefined ? "GET" : "POST",
      headers: {
        ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
        ...(options.person === undefined ? {} : { "x-scenario-person": options.person }),
        "content-type":
          options.form === undefined ? "application/json" : "application/x-www-form-urlencoded",
      },
      ...(options.form !== undefined
        ? { body: new URLSearchParams(options.form).toString() }
        : options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text };
  };
  const api = (path: string, options: Parameters<typeof call>[1] = {}) =>
    call(`/api/rest/public${path}`, options);
  const start = async (kind: "login" | "sudo" = "login", bearer?: string) => {
    const started = await api(kind === "sudo" ? "/auth/device-login/sudo" : "/auth/device-login", {
      body: { appCode: "mate" },
      ...(bearer === undefined ? {} : { bearer }),
    });
    expect(started.status).toBe(200);
    return started.json as {
      requestId: string;
      pollSecret: string;
      userCode: string;
      verificationUrl: string;
    };
  };
  const check = (request: { requestId: string; pollSecret: string }) =>
    api("/auth/device-login/check", {
      body: { requestId: request.requestId, pollSecret: request.pollSecret },
    });
  /** The person's answer on the consent page the request names. */
  const decide = async (
    request: { verificationUrl: string },
    decision: "approve" | "deny",
    extra: Record<string, string> = {},
  ) => {
    const url = new URL(request.verificationUrl);
    expect(url.origin).toBe("https://app.zerops.io");
    const page = await call(`${url.pathname}${url.search}`, { person: token });
    expect(page.text).toContain("Approve");
    return call(url.pathname, {
      person: token,
      form: { request: url.searchParams.get("request")!, decision, ...extra },
    });
  };
  const signIn = async () => {
    const request = await start();
    await decide(request, "approve");
    const approved = (await check(request)).json as {
      auth: { auth: { accessToken: string; refreshToken: string } };
    };
    return approved.auth.auth;
  };
  return { fake, server, api, start, check, decide, signIn, token };
}

describe("Zerops fake: device login", () => {
  it("a login waits for the person, answers an approved session once, then forgets the request", async () => {
    const { server, start, check, decide, api } = await rig();
    try {
      const request = await start();
      expect(request.userCode).toMatch(/\S/u);
      expect((await check(request)).json).toMatchObject({ status: "PENDING" });
      const closed = await decide(request, "approve", { display: "popup" });
      expect(closed.text).toContain("window.close()");
      const approved = await check(request);
      expect(approved.json).toMatchObject({
        status: "APPROVED",
        auth: { auth: { tokenType: "Bearer", twoFAMethods: [] }, user: { id: "owner" } },
      });
      const { accessToken, refreshToken } = (
        approved.json as { auth: { auth: { accessToken: string; refreshToken: string } } }
      ).auth.auth;
      expect(refreshToken).toMatch(/\S/u);
      expect((await check(request)).status).toBe(404);
      const info = await api("/user/info", { bearer: accessToken });
      expect(info.status).toBe(200);
      expect(info.json).toMatchObject({ id: "owner" });
    } finally {
      await server.close();
    }
  });

  it.each([
    { title: "a denied login answers DENIED, never a session", settle: "deny" },
    { title: "an expired request answers 404", settle: "expire" },
  ] as const)("$title", async ({ settle }) => {
    const { fake, server, start, check, decide } = await rig();
    try {
      const request = await start();
      if (settle === "deny") {
        expect((await decide(request, "deny", { display: "popup" })).text).toContain(
          "window.close()",
        );
        expect((await check(request)).json).toEqual({ status: "DENIED", auth: null });
      } else {
        fake.deviceLogin.expireRequests();
        expect((await check(request)).status).toBe(404);
      }
    } finally {
      await server.close();
    }
  });

  it("a sign-up approves a new person, owner of a new organization with nothing in it", async () => {
    const { fake, server, start, check, decide, api } = await rig();
    try {
      const request = await start();
      await decide(request, "approve", { intent: "register" });
      const { accessToken } = (
        (await check(request)).json as { auth: { auth: { accessToken: string } } }
      ).auth.auth;
      const info = await api("/user/info", { bearer: accessToken });
      expect(info.json).toMatchObject({
        id: "newcomer",
        clientUserList: [
          { clientId: "NEWORG", roleCode: "OWNER", client: { accountName: "Newcomer" } },
        ],
      });
      expect(fake.world.projects.filter((project) => project.orgId === "NEWORG")).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("a refresh rotates both tokens: the old access token answers 401, the old refresh token 400", async () => {
    const { fake, server, api, signIn } = await rig();
    try {
      const first = await signIn();
      fake.deviceLogin.expireAccess(first.accessToken);
      expect((await api("/user/info", { bearer: first.accessToken })).status).toBe(401);
      const renewed = await api("/auth/refresh", { body: { refreshTokenId: first.refreshToken } });
      const next = renewed.json as { accessToken: string; refreshToken: string };
      expect(next.accessToken).not.toBe(first.accessToken);
      expect(next.refreshToken).not.toBe(first.refreshToken);
      expect((await api("/user/info", { bearer: next.accessToken })).status).toBe(200);
      expect((await api("/user/info", { bearer: first.accessToken })).status).toBe(401);
      const again = await api("/auth/refresh", { body: { refreshTokenId: first.refreshToken } });
      expect(again.status).toBe(400);
      expect(again.json).toMatchObject({ error: { code: "refreshTokenInvalid" } });
    } finally {
      await server.close();
    }
  });

  it("logout ends the session at the platform; a personal token answers 200 and stays", async () => {
    const { fake, server, api, signIn, token } = await rig();
    try {
      const session = await signIn();
      expect((await api("/auth/logout", { body: {}, bearer: session.accessToken })).status).toBe(
        200,
      );
      expect(fake.deviceLogin.revoked).toEqual([session.accessToken]);
      expect((await api("/user/info", { bearer: session.accessToken })).status).toBe(401);
      expect(
        (await api("/auth/refresh", { body: { refreshTokenId: session.refreshToken } })).status,
      ).toBe(400);
      expect((await api("/auth/logout", { body: {}, bearer: token })).status).toBe(200);
      expect((await api("/user/info", { bearer: token })).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("a reveal asks a session for sudo mode until a sudo request is approved; a personal token is always in it", async () => {
    const { fake, server, api, signIn, start, check, decide, token } = await rig();
    try {
      fake.handlers.push((request) =>
        request.url.pathname.endsWith("/project-env/secret/reveal")
          ? { body: { content: "s3cret" } }
          : undefined,
      );
      const session = await signIn();
      const refused = await api("/project-env/secret/reveal", { bearer: session.accessToken });
      expect(refused.status).toBe(403);
      expect(refused.json).toMatchObject({ error: { code: "notInSudoMode" } });
      expect((await api("/project-env/secret/reveal", { bearer: token })).json).toEqual({
        content: "s3cret",
      });
      const sudo = await start("sudo", session.accessToken);
      expect((await check(sudo)).json).toMatchObject({ status: "PENDING" });
      await decide(sudo, "approve");
      expect((await check(sudo)).json).toEqual({ status: "APPROVED", auth: null });
      expect(
        (await api("/project-env/secret/reveal", { bearer: session.accessToken })).json,
      ).toEqual({ content: "s3cret" });
    } finally {
      await server.close();
    }
  });
});
