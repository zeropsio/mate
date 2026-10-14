import { describe, expect, it } from "vite-plus/test";

import {
  ZeropsDeviceLoginRefused,
  checkZeropsDeviceLogin,
  pollZeropsDeviceLogin,
  startZeropsDeviceLogin,
  zeropsDeviceLoginUrl,
  type ZeropsDeviceLoginCheck,
  type ZeropsDeviceLoginRequest,
} from "./deviceLogin.ts";

const API = "https://api.example.test";
const VERIFY = "https://app.zerops.io/authorize-login?request=req-1";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, fetch };
}

const request = (overrides: Partial<ZeropsDeviceLoginRequest> = {}): ZeropsDeviceLoginRequest => ({
  kind: "login",
  requestId: "req-1",
  pollSecret: "secret-1",
  userCode: "ABCD-EFGH",
  verificationUrl: VERIFY,
  expiresAtMs: 300_000,
  intervalMs: 3_000,
  ...overrides,
});

describe("zeropsDeviceLoginUrl", () => {
  it("opens the API's consent link as it comes, plus this client's parameters", () => {
    expect(zeropsDeviceLoginUrl({ verificationUrl: VERIFY })).toBe(VERIFY);
    expect(zeropsDeviceLoginUrl({ verificationUrl: VERIFY, popup: true })).toBe(
      `${VERIFY}&display=popup`,
    );
    expect(zeropsDeviceLoginUrl({ verificationUrl: VERIFY, intent: "register", popup: true })).toBe(
      `${VERIFY}&intent=register&display=popup`,
    );
  });

  it("swaps only the origin for a local consent page", () => {
    expect(
      zeropsDeviceLoginUrl({ verificationUrl: VERIFY, consentOrigin: "http://localhost:5555" }),
    ).toBe("http://localhost:5555/authorize-login?request=req-1");
  });

  it.each([
    ["javascript:alert(1)", undefined],
    ["data:text/html,hi", undefined],
    [VERIFY, "javascript:alert(1)"],
  ])("opens nothing but a web address: %s via %s", (verificationUrl, consentOrigin) => {
    expect(() =>
      zeropsDeviceLoginUrl({
        verificationUrl,
        ...(consentOrigin === undefined ? {} : { consentOrigin }),
      }),
    ).toThrow();
  });
});

describe("startZeropsDeviceLogin", () => {
  it("starts a login with the app's code and no credential", async () => {
    const { calls, fetch } = recordingFetch(() =>
      json(200, {
        requestId: "req-1",
        pollSecret: "secret-1",
        userCode: "ABCD-EFGH",
        verificationUrl: VERIFY,
        expiresIn: 300,
        interval: 3,
      }),
    );
    const started = await startZeropsDeviceLogin({
      fetch,
      apiBase: `${API}/`,
      appCode: "mate",
      kind: "login",
      nowMs: 1_000,
    });
    expect(started).toEqual(request({ expiresAtMs: 301_000 }));
    expect(calls[0]?.url).toBe(`${API}/api/rest/public/auth/device-login`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ appCode: "mate" });
    expect(new Headers(calls[0]?.init.headers).has("Authorization")).toBe(false);
  });

  it("starts a sudo request as the session that asks", async () => {
    const { calls, fetch } = recordingFetch(() =>
      json(200, { requestId: "r", pollSecret: "p", userCode: "c", verificationUrl: VERIFY }),
    );
    const started = await startZeropsDeviceLogin({
      fetch,
      apiBase: API,
      appCode: "mate",
      kind: "sudo",
      bearer: "access-1",
      nowMs: 0,
    });
    expect(calls[0]?.url).toBe(`${API}/api/rest/public/auth/device-login/sudo`);
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer access-1");
    expect(started).toMatchObject({ kind: "sudo", expiresAtMs: 300_000, intervalMs: 3_000 });
  });

  it("says the platform's refusal, with its code", async () => {
    const { fetch } = recordingFetch(() =>
      json(400, { error: { code: "deviceLoginAppInvalid", message: "Unknown app." } }),
    );
    const refusal = await startZeropsDeviceLogin({
      fetch,
      apiBase: API,
      appCode: "nope",
      kind: "login",
      nowMs: 0,
    }).catch((cause: unknown) => cause);
    expect(refusal).toBeInstanceOf(ZeropsDeviceLoginRefused);
    expect(refusal).toMatchObject({ status: 400, code: "deviceLoginAppInvalid" });
  });
});

describe("checkZeropsDeviceLogin", () => {
  const auth = {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    tokenType: "Bearer",
    expiresIn: 432000,
    expiresAt: "2026-10-19T00:00:00Z",
    twoFAMethods: null,
    twoFAVerified: false,
    sudoUntil: null,
    userId: "user-1",
    actualUserId: "user-1",
    author: null,
  };

  it.each<[string, Response | Error, ZeropsDeviceLoginCheck]>([
    ["pending", json(200, { status: "PENDING", auth: null }), { status: "pending" }],
    ["denied", json(200, { status: "DENIED", auth: null }), { kind: "denied" }],
    ["gone after five minutes", json(404, { error: { code: "notFound" } }), { kind: "expired" }],
    ["throttled", json(429, {}), { status: "retry" }],
    ["failing", json(503, {}), { status: "retry" }],
    ["offline", new TypeError("Failed to fetch"), { status: "retry" }],
    [
      "approved with the login's session",
      json(200, { status: "APPROVED", auth: { auth, user: { id: "user-1" } } }),
      {
        kind: "approved",
        session: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          tokenType: "Bearer",
          expiresIn: 432000,
          expiresAt: "2026-10-19T00:00:00Z",
          twoFAVerified: false,
          userId: "user-1",
        },
      },
    ],
  ])("reads a check that is %s", async (_case, answer, expected) => {
    const { calls, fetch } = recordingFetch(() => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    await expect(
      checkZeropsDeviceLogin({ fetch, apiBase: API, request: request() }),
    ).resolves.toEqual(expected);
    expect(calls[0]?.url).toBe(`${API}/api/rest/public/auth/device-login/check`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      requestId: "req-1",
      pollSecret: "secret-1",
    });
  });

  it("reads an approved sudo request as no session: the one that asked is now in sudo", async () => {
    const { fetch } = recordingFetch(() => json(200, { status: "APPROVED", auth: null }));
    await expect(
      checkZeropsDeviceLogin({ fetch, apiBase: API, request: request({ kind: "sudo" }) }),
    ).resolves.toEqual({ kind: "approved", session: null });
  });

  it("refuses an approved login that carries no session", async () => {
    const { fetch } = recordingFetch(() => json(200, { status: "APPROVED", auth: null }));
    await expect(
      checkZeropsDeviceLogin({ fetch, apiBase: API, request: request() }),
    ).rejects.toBeInstanceOf(ZeropsDeviceLoginRefused);
  });
});

describe("pollZeropsDeviceLogin", () => {
  function clock() {
    let now = 0;
    const waits: number[] = [];
    return {
      waits,
      nowMs: () => now,
      wait: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
    };
  }

  it("asks every interval until the request settles", async () => {
    const time = clock();
    const answers: ZeropsDeviceLoginCheck[] = [
      { status: "pending" },
      { status: "retry" },
      { kind: "approved", session: { accessToken: "a" } },
    ];
    const outcome = await pollZeropsDeviceLogin({
      request: request(),
      check: async () => answers.shift() ?? { status: "pending" },
      ...time,
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual({ kind: "approved", session: { accessToken: "a" } });
    expect(time.waits).toEqual([3_000, 3_000, 3_000]);
  });

  it.each<[string, ZeropsDeviceLoginCheck, string]>([
    ["denied", { kind: "denied" }, "denied"],
    ["expired by a 404", { kind: "expired" }, "expired"],
  ])("ends %s", async (_case, answer, kind) => {
    const outcome = await pollZeropsDeviceLogin({
      request: request(),
      check: async () => answer,
      ...clock(),
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe(kind);
  });

  it("ends expired once the request's time and a grace have passed", async () => {
    const time = clock();
    let checks = 0;
    const outcome = await pollZeropsDeviceLogin({
      request: request({ expiresAtMs: 9_000 }),
      check: async () => {
        checks += 1;
        return { status: "pending" };
      },
      ...time,
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual({ kind: "expired" });
    // 9 s of request and 10 s of grace at 3 s an ask.
    expect(checks).toBe(7);
  });

  it("ends cancelled when aborted, asking nothing more", async () => {
    const controller = new AbortController();
    let checks = 0;
    const outcome = await pollZeropsDeviceLogin({
      request: request(),
      check: async () => {
        checks += 1;
        controller.abort();
        return { status: "pending" };
      },
      ...clock(),
      signal: controller.signal,
    });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(checks).toBe(1);
  });

  it("drops an answer that arrives after the abort", async () => {
    const controller = new AbortController();
    const outcome = await pollZeropsDeviceLogin({
      request: request(),
      check: async () => {
        controller.abort();
        return { kind: "approved", session: { accessToken: "late" } };
      },
      ...clock(),
      signal: controller.signal,
    });
    expect(outcome).toEqual({ kind: "cancelled" });
  });
});
