import { describe, expect, it, vi } from "vite-plus/test";

import { runZeropsDeviceLogin, type ZeropsDeviceLoginStage } from "./deviceLogin";

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
  /** Requests the API starts, in turn: each a `req-<n>` with its own code. */
  readonly renewals?: boolean;
  /** The clock: advanced by `step` milliseconds every wait. */
  readonly step?: number;
}) {
  let now = 0;
  let started = 0;
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
      started += 1;
      if (options.renewals === true && started > 1)
        return json(200, {
          requestId: `req-${started}`,
          pollSecret: `secret-${started}`,
          userCode: `CODE-000${started}`,
          verificationUrl: VERIFY.replace("req-1", `req-${started}`),
          expiresIn: 300,
          interval: 3,
        });
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
    nowMs: () => now,
    wait: async () => {
      now += options.step ?? 0;
    },
    appCode: "zcli",
    consentOrigin: undefined,
  };
  return {
    opened,
    requests,
    started: () => started,
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
      windowMayBeOlder: false,
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
      windowMayBeOlder: false,
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

  it("keeps the Zerops window the person is using open when a code expires, and renews the code", async () => {
    const { opened, ports, stages, onStage } = tab({
      renewals: true,
      checks: [new Response(null, { status: 404 }), { status: "PENDING" }],
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waits = 0;
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: API,
      onStage,
      // The first request's wait passes, its check finds it expired; the renewed one waits.
      ports: { ...ports, wait: () => (++waits > 1 ? held : Promise.resolve()) },
    });
    await vi.waitFor(() => expect(stages.at(-1)).toMatchObject({ userCode: "CODE-0002" }));
    const window = opened[0]?.window;
    expect(window?.closed).toBe(false);
    // Not navigated: the person may be halfway through signing up in it.
    expect(window?.location.href).toBe(`${VERIFY}&display=popup`);
    expect(stages.at(-1)).toEqual({
      kind: "waiting",
      url: `${VERIFY.replace("req-1", "req-2")}&display=popup`,
      blocked: false,
      userCode: "CODE-0002",
      windowMayBeOlder: true,
    });
    run.cancel();
    release();
    await expect(run.outcome).resolves.toEqual({ kind: "cancelled" });
  });

  it("points the window at the renewed request when the person opens it again", async () => {
    const { opened, ports, stages, onStage } = tab({
      renewals: true,
      checks: [new Response(null, { status: 404 })],
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waits = 0;
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: API,
      onStage,
      ports: { ...ports, wait: () => (++waits > 1 ? held : Promise.resolve()) },
    });
    await vi.waitFor(() => expect(stages.at(-1)).toMatchObject({ userCode: "CODE-0002" }));
    run.reopen();
    const window = opened[0]?.window;
    expect(window?.location.href).toBe(`${VERIFY.replace("req-1", "req-2")}&display=popup`);
    expect(window?.focused).toBe(1);
    run.cancel();
    release();
    await run.outcome;
  });

  it("says the Zerops window may show an older code once the request is renewed, until the person opens it again", async () => {
    const { ports, stages, onStage } = tab({
      renewals: true,
      checks: [new Response(null, { status: 404 })],
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waits = 0;
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: API,
      onStage,
      ports: { ...ports, wait: () => (++waits > 1 ? held : Promise.resolve()) },
    });
    await vi.waitFor(() => expect(stages.at(-1)).toMatchObject({ userCode: "CODE-0002" }));
    expect(stages.find((stage) => stage.kind === "waiting")).toMatchObject({
      userCode: "ABCD-EFGH",
      windowMayBeOlder: false,
    });
    expect(stages.at(-1)).toMatchObject({ windowMayBeOlder: true });
    run.reopen();
    expect(stages.at(-1)).toMatchObject({ userCode: "CODE-0002", windowMayBeOlder: false });
    run.cancel();
    release();
    await run.outcome;
  });

  it("stops renewing after half an hour and leaves the window as the person left it", async () => {
    const { opened, ports, onStage, started } = tab({
      renewals: true,
      step: 60_000,
      checks: Array.from({ length: 100 }, () => ({ status: "PENDING" })),
    });
    const run = runZeropsDeviceLogin({ kind: "login", apiBase: API, onStage, ports });
    await expect(run.outcome).resolves.toEqual({ kind: "expired" });
    expect(started()).toBeGreaterThan(1);
    expect(opened[0]?.window?.closed).toBe(false);
  });
});
