import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { probeZeropsContainerHealth } from "./containerHealth.ts";

const ORIGIN = "https://zcp-26a7-8080.prg1.zerops.app";
const HEALTHZ = `${ORIGIN}/z3/healthz`;
const DESCRIPTOR = `${ORIGIN}/z3/.well-known/t3/environment`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(status = 200): Response {
  return new Response("<!doctype html><title>hi</title>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

/** What a browser hands back for a redirect it was told not to follow. */
function opaqueRedirect(): Response {
  return { type: "opaqueredirect", status: 0, ok: false } as unknown as Response;
}

/** What a cross-origin read of a response with no CORS header does. */
function corsBlocked(): never {
  throw new TypeError("Failed to fetch");
}

/** The live payloads, 2026-08-28. */
const LIVE_HEALTHZ = { initComplete: true, initAt: "2026-08-28T15:21:25Z" };
const LIVE_DESCRIPTOR = {
  environmentId: "5779c9c3-4eb9-4872-a37e-c29b287209f6",
  label: "node-id-1.runtime.zcp.zerops",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.35",
};

function stub(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  return {
    calls,
    fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const route = routes[url];
      if (!route) throw new TypeError(`unexpected request: ${url}`);
      return Promise.resolve(route());
    },
  };
}

describe("probeZeropsContainerHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts fetch explicitly", async () => {
    const globalFetch = vi.fn(() => {
      throw new Error("the global fetch must not be used");
    });
    vi.stubGlobal("fetch", globalFetch);
    const explicit = stub({ [DESCRIPTOR]: () => json(LIVE_DESCRIPTOR) });

    await expect(probeZeropsContainerHealth(ORIGIN, explicit.fetch)).resolves.toBe("ready");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("treats the z3 descriptor as the authority, and asks nothing else once it answers", async () => {
    const spy = stub({ [DESCRIPTOR]: () => json(LIVE_DESCRIPTOR) });

    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("ready");
    expect(spy.calls.map((call) => call.url)).toEqual([DESCRIPTOR]);
  });

  it("reads readiness under the /z3/ prefix, which is the only place zcp publishes it", () => {
    // The route moved out of the container root when z3 became opt-in: zcp
    // renders it only with ZCP_Z3_ENABLED set, and the root /healthz is
    // code-server's own again. Probing the root would read a booting container
    // as one that cannot run Zerops Code at all, and offer a restart that
    // changes nothing. Pinned as an exact URL because the coupling is to a
    // path in another repository's nginx template, which no type can check.
    const spy = stub({ [DESCRIPTOR]: () => html(404), [HEALTHZ]: () => json(LIVE_HEALTHZ) });

    void probeZeropsContainerHealth(ORIGIN, spy.fetch);

    expect(HEALTHZ).toBe(`${ORIGIN}/z3/healthz`);
  });

  it("is ready even when /healthz cannot be read cross-origin", async () => {
    // Measured 2026-08-28: nginx serves /healthz without an
    // Access-Control-Allow-Origin header, so a browser cannot read it at all,
    // while the z3 descriptor answers `*`. Connecting must not depend on the
    // one the browser is refused.
    const spy = stub({ [DESCRIPTOR]: () => json(LIVE_DESCRIPTOR), [HEALTHZ]: corsBlocked });

    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("ready");
  });

  it("asks with nothing that would trigger a CORS preflight the container cannot answer", async () => {
    const spy = stub({ [DESCRIPTOR]: () => html(404), [HEALTHZ]: () => json(LIVE_HEALTHZ) });

    await probeZeropsContainerHealth(ORIGIN, spy.fetch);

    expect(spy.calls).toHaveLength(2);
    for (const call of spy.calls) {
      expect(call.init?.headers).toBeUndefined();
      expect(call.init?.redirect).toBe("manual");
      expect(call.init?.method ?? "GET").toBe("GET");
    }
  });

  it("reads the cookie gate's redirect as a container that predates Zerops Code", async () => {
    // Measured on two live pre-z3 containers: every path answers 302 to
    // /zcp-login, because neither location exists yet.
    const opaque = stub({ [DESCRIPTOR]: opaqueRedirect, [HEALTHZ]: opaqueRedirect });
    await expect(probeZeropsContainerHealth(ORIGIN, opaque.fetch)).resolves.toBe("predates-z3");

    const seen = () => new Response(null, { status: 302, headers: { location: "/zcp-login" } });
    const node = stub({ [DESCRIPTOR]: seen, [HEALTHZ]: seen });
    await expect(probeZeropsContainerHealth(ORIGIN, node.fetch)).resolves.toBe("predates-z3");
  });

  it("never trusts a 200 without parsing it", async () => {
    // A mis-prefixed proxy turns any path into the SPA's index.html, which is
    // a perfectly good 200 and a completely wrong answer.
    const spy = stub({ [DESCRIPTOR]: () => html(200), [HEALTHZ]: () => html(200) });
    await expect(probeZeropsContainerHealth(ORIGIN, spy.fetch)).resolves.toBe("predates-z3");
  });

  it("keeps waiting when zcp answers but Zerops Code has not come up yet", async () => {
    const notYet = stub({ [DESCRIPTOR]: () => html(404), [HEALTHZ]: () => json(LIVE_HEALTHZ) });
    await expect(probeZeropsContainerHealth(ORIGIN, notYet.fetch)).resolves.toBe("initializing");

    const early = stub({
      [DESCRIPTOR]: () => html(404),
      [HEALTHZ]: () => json({ initComplete: false }),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, early.fetch)).resolves.toBe("initializing");
  });

  it("refuses a server that answers from the wrong base path", async () => {
    const wrong = stub({
      [DESCRIPTOR]: () => json({ ...LIVE_DESCRIPTOR, basePath: "/" }),
      [HEALTHZ]: () => json(LIVE_HEALTHZ),
    });
    await expect(probeZeropsContainerHealth(ORIGIN, wrong.fetch)).resolves.toBe("initializing");

    const right = stub({ [DESCRIPTOR]: () => json({ ...LIVE_DESCRIPTOR, basePath: "/z3" }) });
    await expect(probeZeropsContainerHealth(ORIGIN, right.fetch)).resolves.toBe("ready");
  });

  it("reads a restarting container as unreachable, not as broken", async () => {
    // The platform balancer answers 502 for about fourteen seconds after a
    // restart; that is the container coming back, not a failure.
    const balancer = stub({ [DESCRIPTOR]: () => html(502), [HEALTHZ]: () => html(502) });
    await expect(probeZeropsContainerHealth(ORIGIN, balancer.fetch)).resolves.toBe("unreachable");

    const offline = { fetch: () => Promise.reject(new TypeError("Failed to fetch")) };
    await expect(probeZeropsContainerHealth(ORIGIN, offline.fetch)).resolves.toBe("unreachable");
  });

  it("tolerates a trailing slash on the origin", async () => {
    const spy = stub({ [DESCRIPTOR]: () => json(LIVE_DESCRIPTOR) });

    await expect(probeZeropsContainerHealth(`${ORIGIN}/`, spy.fetch)).resolves.toBe("ready");
  });

  it("never reads a 5xx as a container that predates Zerops Code", async () => {
    // The platform runs every initCommands entry to completion before any
    // startCommands process starts, so nginx answering at all proves that
    // boot's `zcp init` finished. A container mid-boot is the L7's 502, and
    // offering a restart there would restart a container that is already
    // coming up.
    for (const status of [500, 502, 503, 504]) {
      const both = stub({ [DESCRIPTOR]: () => html(status), [HEALTHZ]: () => html(status) });
      await expect(probeZeropsContainerHealth(ORIGIN, both.fetch)).resolves.toBe("unreachable");

      // Even mixed with a signal that would otherwise mean "old container".
      const mixed = stub({ [DESCRIPTOR]: () => html(status), [HEALTHZ]: opaqueRedirect });
      await expect(probeZeropsContainerHealth(ORIGIN, mixed.fetch)).resolves.toBe("unreachable");

      const other = stub({ [DESCRIPTOR]: () => html(404), [HEALTHZ]: () => html(status) });
      await expect(probeZeropsContainerHealth(ORIGIN, other.fetch)).resolves.toBe("unreachable");
    }
  });
});
