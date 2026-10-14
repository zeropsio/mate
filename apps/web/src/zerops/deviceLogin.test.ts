import { describe, expect, it } from "vite-plus/test";

import { runZeropsDeviceLogin, sudoBearer, type ZeropsDeviceLoginStage } from "./deviceLogin";

const API = "https://api.example.test";
const VERIFY = "https://app.zerops.io/authorize-login?request=req-1";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FakeWindow {
  closed: boolean;
  focused: number;
  readonly location: { href: string };
  readonly focus: () => void;
  readonly close: () => void;
}

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    closed: false,
    focused: 0,
    location: { href: "about:blank" },
    focus: () => {
      window.focused += 1;
    },
    close: () => {
      window.closed = true;
    },
  };
  return window;
}

/**
 * A tab: `open` records what it opened (or blocks), the API answers the start and then each
 * check from `checks`, and every wait passes at once.
 */
function tab(options: {
  readonly blocked?: boolean;
  readonly checks?: ReadonlyArray<unknown>;
  readonly start?: Response;
}) {
  const opened: Array<{ url: string; window: FakeWindow | null }> = [];
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const checks = [...(options.checks ?? [])];
  const stages: ZeropsDeviceLoginStage[] = [];
  const ports = {
    open: (url: string) => {
      const window = options.blocked === true ? null : fakeWindow();
      opened.push({ url, window });
      return window as unknown as Window | null;
    },
    fetch: async (url: string, init: RequestInit = {}) => {
      requests.push({ url, authorization: new Headers(init.headers).get("Authorization") });
      if (url.endsWith("/check")) {
        const next = checks.shift();
        return next instanceof Response ? next : json(200, next ?? { status: "PENDING" });
      }
      return (
        options.start ??
        json(200, {
          requestId: "req-1",
          pollSecret: "secret-1",
          userCode: "ABCD-EFGH",
          verificationUrl: VERIFY,
          expiresIn: 300,
          interval: 3,
        })
      );
    },
    nowMs: () => 0,
    wait: async () => undefined,
    appCode: "zcli",
    consentOrigin: undefined,
  };
  return {
    opened,
    requests,
    stages,
    ports,
    onStage: (stage: ZeropsDeviceLoginStage) => stages.push(stage),
  };
}

const session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: "2026-10-19T00:00:00Z",
};

describe("runZeropsDeviceLogin", () => {
  it("opens the Zerops window on the click, then points it at the consent page", async () => {
    const { opened, ports, stages, onStage } = tab({
      checks: [{ status: "PENDING" }, { status: "APPROVED", auth: { auth: session } }],
    });
    const run = runZeropsDeviceLogin({ kind: "login", apiBase: API, onStage, ports });

    // Synchronously, before anything was awaited: the only window a popup blocker lets through.
    expect(opened.map((each) => each.url)).toEqual(["about:blank"]);
    expect(stages).toEqual([{ kind: "opening" }]);

    await expect(run.outcome).resolves.toEqual({ kind: "approved", session });
    expect(opened[0]?.window?.location.href).toBe(`${VERIFY}&display=popup`);
    expect(stages[1]).toEqual({
      kind: "waiting",
      url: `${VERIFY}&display=popup`,
      blocked: false,
      userCode: "ABCD-EFGH",
    });
    // Settled: the window is closed, since app.zerops.io's page does not close itself.
    expect(opened[0]?.window?.closed).toBe(true);
  });

  it("asks a sign-up for the consent page's sign-up", async () => {
    const { opened, ports, onStage } = tab({ checks: [{ status: "DENIED" }] });
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: API,
      intent: "register",
      onStage,
      ports,
    });
    await expect(run.outcome).resolves.toEqual({ kind: "denied" });
    expect(opened[0]?.window?.location.href).toBe(`${VERIFY}&intent=register&display=popup`);
  });

  it("hands a blocked window's link to the person, as a tab of their own", async () => {
    const { ports, stages, onStage } = tab({ blocked: true, checks: [{ status: "DENIED" }] });
    const run = runZeropsDeviceLogin({ kind: "login", apiBase: API, onStage, ports });
    await run.outcome;
    expect(stages[1]).toEqual({
      kind: "waiting",
      url: VERIFY,
      blocked: true,
      userCode: "ABCD-EFGH",
    });
  });

  it("brings the window back, or opens it again once it was closed", async () => {
    const { opened, ports, onStage } = tab({});
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: API,
      onStage,
      ports: { ...ports, wait: () => held },
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.reopen();
    expect(opened[0]?.window?.focused).toBe(1);
    opened[0]!.window!.closed = true;
    run.reopen();
    expect(opened.map((each) => each.url)).toEqual(["about:blank", `${VERIFY}&display=popup`]);
    run.cancel();
    release();
    await expect(run.outcome).resolves.toEqual({ kind: "cancelled" });
  });

  it("asks a sudo request as the session, with the bearer it was given", async () => {
    const { requests, ports, onStage } = tab({ checks: [{ status: "APPROVED", auth: null }] });
    const run = runZeropsDeviceLogin({
      kind: "sudo",
      apiBase: API,
      bearer: async () => "access-1",
      onStage,
      ports,
    });
    await expect(run.outcome).resolves.toEqual({ kind: "approved", session: null });
    expect(requests[0]).toEqual({
      url: `${API}/api/rest/public/auth/device-login/sudo`,
      authorization: "Bearer access-1",
    });
  });

  it("closes the window and rejects when the request will not start", async () => {
    const { opened, ports, onStage } = tab({
      start: json(400, { error: { code: "deviceLoginAppInvalid", message: "Unknown app." } }),
    });
    const run = runZeropsDeviceLogin({ kind: "login", apiBase: API, onStage, ports });
    await expect(run.outcome).rejects.toMatchObject({ code: "deviceLoginAppInvalid" });
    expect(opened[0]?.window?.closed).toBe(true);
  });
});

describe("sudoBearer", () => {
  const at = Date.parse("2026-10-14T12:00:00Z");

  function client(expiresAt: string, refreshToken: string | null = "refresh-1") {
    let renewals = 0;
    const held = {
      session: {
        accessToken: "access-1",
        expiresAt,
        ...(refreshToken === null ? {} : { refreshToken }),
      } as { accessToken: string; expiresAt: string; refreshToken?: string },
      renewHeldSession: async () => {
        renewals += 1;
        held.session = { ...held.session, accessToken: "access-2" };
      },
    };
    return { held, renewals: () => renewals };
  }

  it.each([
    ["renews first inside the fifteen-minute margin", "2026-10-14T12:10:00Z", "access-2", 1],
    ["keeps a session with time left", "2026-10-14T13:00:00Z", "access-1", 0],
  ])("%s", async (_case, expiresAt, bearer, renewals) => {
    const { held, renewals: count } = client(expiresAt);
    await expect(sudoBearer(held, at)).resolves.toBe(bearer);
    expect(count()).toBe(renewals);
  });

  it("never renews a personal token, which has no refresh token", async () => {
    const { held, renewals } = client("2026-10-14T12:01:00Z", null);
    await expect(sudoBearer(held, at)).resolves.toBe("access-1");
    expect(renewals()).toBe(0);
  });
});
