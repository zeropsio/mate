// @vitest-environment happy-dom
import { createMemoryHistory } from "@tanstack/react-router";
import { PropertySymbol, type Window as HappyWindow } from "happy-dom";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";

import { seedCoreWorld } from "../../test/scenarios/harness/coreSeed";
import { initializeClientClock } from "../../test/scenarios/harness/clientClock";
import { deadline, serve } from "../../test/scenarios/harness/http";
import { ZeropsFake } from "../../test/scenarios/fakes/zerops";
import { definePerson } from "../../test/scenarios/fakes/zeropsWorld";
import { AppRoot } from "../AppRoot";
import { getRouter } from "../router";
import { closeAccountLifetime } from "./accountLifetime";

const MATES = ["Ada", "Bea", "Cara", "Dora"];
// One pair per organization-wide family, plus the live membership update stream.
const REGISTRATIONS = 13;

/** The actual signed-in page, with the scenario platform and an HQ navigation stream. */
async function mountAccount(names: string[], plain: string[] = [], controlledClock = false) {
  const fake = new ZeropsFake(seedCoreWorld(Date.now(), true, "ORG"));
  definePerson(fake.world, "owner", { role: "OWNER", grants: { Chief: "OWNER" } });
  for (const name of [...names, ...plain]) {
    fake.put("project", {
      id: name,
      name,
      clientId: "ORG",
      status: "ACTIVE",
      tags: [],
      userRoles: [],
    });
  }
  for (const name of names) {
    fake.put("service-stack", {
      id: `service-${name}`,
      projectId: name,
      clientId: "ORG",
      name: "zcp",
      status: "ACTIVE",
      subdomainAccess: true,
      serviceStackTypeInfo: {
        serviceStackTypeName: "zcp",
        serviceStackTypeVersionName: "zcp@1",
        serviceStackTypeCategory: "USER",
      },
      ports: [{ port: 8080, scheme: "http" }],
    });
    fake.put("user-data", {
      id: `mate-flag-${name}`,
      clientId: "ORG",
      serviceStackId: `service-${name}`,
      key: "ZCP_MATE_ENABLED",
      content: "1",
    });
  }

  let requests = 0;
  let registrations = 0;
  const unmapped: string[] = [];
  const platform = await serve(async (request) => {
    if (request.method !== "OPTIONS") {
      requests++;
      if (request.body.wsOutputType) registrations++;
    }
    const response = await fake.handle(request);
    if (!response) unmapped.push(`${request.method} ${request.url.pathname}`);
    return response;
  }, fake.socket);
  fake.origin = platform.origin;
  const app = {
    id: "shop",
    name: "Shop",
    can: {},
    contents: { empty: false, deletingProjectIds: [] },
    projectIds: names,
    births: [],
    environments: [],
    changes: [],
    releaseOffer: null,
  };
  const rows = [
    { key: "app:shop", value: app },
    ...names.map((name) => ({
      key: `project:${name}`,
      value: {
        projectId: name,
        appId: "shop",
        name,
        kind: "mate",
        mate: { face: "face-1", madeBy: null, standupRequestedBy: null },
        person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
        signedInNow: {},
        everSignedIn: {},
      },
    })),
  ];
  const hq = await serve(
    (request) => {
      if (request.method === "OPTIONS") return { body: {} };
      if (request.url.pathname === "/api/door")
        return {
          body: { session: "hq-session", expiresAt: "2099-01-01T00:00:00.000Z", userId: "owner" },
        };
      if (request.url.pathname === "/api/stream-ticket") return { body: { ticket: "ticket" } };
      if (request.method === "DELETE" && request.url.pathname === "/api/session")
        return { status: 204 };
      unmapped.push(`HQ ${request.method} ${request.url.pathname}`);
      return { status: 404, body: {} };
    },
    (socket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(String(raw)) as {
          type: string;
          scopes?: Array<{ scope: { kind: string } }>;
        };
        if (request.type !== "subscribe") {
          if (!["unsubscribe", "retry", "pong"].includes(request.type))
            unmapped.push(`HQ websocket ${request.type}`);
          return;
        }
        for (const { scope } of request.scopes ?? []) {
          const cursor = { scope, incarnation: "i1", revision: 1 };
          socket.send(
            JSON.stringify({
              type: "scope-reset",
              ...cursor,
              values: scope.kind === "navigation" ? rows : [],
              removals: [],
            }),
          );
          socket.send(JSON.stringify({ type: "scope-ready", ...cursor, core: { protocol: 1 } }));
        }
      });
    },
  );

  const blocked: string[] = [];
  const errors: string[] = [];
  const pending = new Set<object>();
  const waiters = new Set<() => void>();
  const complete = (request: object) => {
    pending.delete(request);
    if (pending.size === 0) for (const resolve of waiters) resolve();
  };
  const settings = (window as unknown as HappyWindow).happyDOM.settings;
  const saved = {
    interceptor: settings.fetch.interceptor,
    images: settings.enableImageFileLoading,
    css: settings.disableCSSFileLoading,
    scripts: settings.disableJavaScriptFileLoading,
    date: window.Date,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    locks: Object.getOwnPropertyDescriptor(window.navigator, "locks"),
  };
  const clockWindow = window as unknown as Window & {
    scenarioClockTime?: (timestamp: number) => Promise<void>;
    scenarioClock?: { now(): number; step(end: number): Promise<boolean> };
  };
  if (controlledClock) {
    const initialTime = fake.clock.currentTimeMillis();
    clockWindow.scenarioClockTime = async (timestamp) => fake.clock.setTime(timestamp);
    initializeClientClock(initialTime);
  }
  // Observe fetch, XHR and resources at the DOM's common network boundary, including failures.
  settings.enableImageFileLoading = true;
  settings.disableCSSFileLoading = false;
  settings.disableJavaScriptFileLoading = false;
  settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ request, window: browser }) => {
      const url = new URL(request.url);
      if (["data:", "blob:"].includes(url.protocol)) return;
      if (url.origin === "https://www.gravatar.com" || url.origin === window.location.origin)
        return new browser.Response(null, { status: 404 });
      if (url.origin !== platform.origin && url.origin !== hq.origin) {
        blocked.push(`${request.method} ${url.origin}${url.pathname}`);
        return new browser.Response(null, { status: 404 });
      }
      pending.add(request);
      request.signal.addEventListener("abort", () => complete(request), { once: true });
    },
    afterAsyncResponse: async ({ request, response }) => {
      if (!pending.has(request)) return;
      const stream = response.body as
        | (ReadableStream & {
            [PropertySymbol.nodeStream]?: {
              readableEnded: boolean;
              once(event: "end" | "close" | "error", listener: () => void): void;
            };
          })
        | null;
      const source = stream?.[PropertySymbol.nodeStream];
      if (!source || source.readableEnded) return complete(request);
      for (const event of ["end", "close", "error"] as const)
        source.once(event, () => complete(request));
    },
    beforeSyncRequest: ({ request }) => {
      const url = new URL(request.url);
      blocked.push(`${request.method} ${url.origin}${url.pathname} (synchronous)`);
      throw new Error("Unexpected synchronous browser request");
    },
  };
  const onError = (event: ErrorEvent) => errors.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const sockets = new Set<WebSocket>();
  class WatchedSocket extends WebSocket {
    constructor(url: string | URL) {
      const target = new URL(String(url));
      const origin = target.origin.replace(/^ws/u, "http");
      const platformSocket =
        origin === platform.origin &&
        /^\/api\/rest\/public\/web-socket\/[^/]+\/[^/]+$/u.test(target.pathname);
      const hqSocket = origin === hq.origin && target.pathname === "/api/structure/ws";
      if (!platformSocket && !hqSocket) {
        blocked.push(`Unexpected websocket at ${origin}`);
        throw new Error("Unexpected websocket origin");
      }
      super(url);
      // Browsers dispatch websocket errors as events; Node otherwise throws an unhandled error.
      this.on("error", () => {});
      sockets.add(this);
      this.once("close", () => sockets.delete(this));
    }
  }
  vi.stubEnv("VITE_ZEROPS_API_URL", platform.origin);
  vi.stubEnv("VITE_HQ_ORIGIN", hq.origin);
  vi.stubGlobal("WebSocket", WatchedSocket);
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (
      ![platform.origin, hq.origin, window.location.origin, "https://www.gravatar.com"].includes(
        url.origin,
      ) &&
      !["data:", "blob:"].includes(url.protocol)
    ) {
      blocked.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return nativeFetch(input, init);
  });
  Object.defineProperty(window.navigator, "locks", { value: undefined, configurable: true });
  window.localStorage.setItem(
    "zerops-mate.zerops-session.v1",
    JSON.stringify({ accessToken: "personal" }),
  );

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const menu = new Promise<void>((resolve) => {
    const check = () => {
      const surface = container.querySelector('[data-zerops-surface="sidebar-environments"]');
      if (!surface) return;
      for (const row of surface.querySelectorAll<HTMLElement>(
        '[data-zerops-surface="sidebar-project"][aria-expanded="false"]',
      ))
        row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      if (["Shop", ...names].every((name) => surface.textContent?.includes(name))) {
        observer.disconnect();
        resolve();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  });
  flushSync(() =>
    root.render(
      <StrictMode>
        <AppRoot router={getRouter(createMemoryHistory({ initialEntries: ["/zerops"] }))} />
      </StrictMode>,
    ),
  );

  // As the browser harness does, wait for completed bodies and then a renderer turn; another
  // request during that turn repeats the receipt, without a machine-speed quiet window.
  const settled = async () => {
    for (;;) {
      if (pending.size > 0) {
        let ready = () => {};
        try {
          await deadline(
            new Promise<void>((resolve) => {
              ready = resolve;
              waiters.add(resolve);
            }),
            "browser HTTP bodies",
          );
        } finally {
          waiters.delete(ready);
        }
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (pending.size === 0) return;
    }
  };
  const close = async () => {
    try {
      flushSync(() => root.unmount());
      await closeAccountLifetime();
      await settled();
      await Promise.all(
        [...sockets].map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.once("close", resolve);
              socket.terminate();
            }),
        ),
      );
    } finally {
      await platform.close();
      await hq.close();
      container.remove();
      window.localStorage.clear();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      settings.fetch.interceptor = saved.interceptor;
      settings.enableImageFileLoading = saved.images;
      settings.disableCSSFileLoading = saved.css;
      settings.disableJavaScriptFileLoading = saved.scripts;
      window.Date = saved.date;
      window.setTimeout = saved.setTimeout;
      window.clearTimeout = saved.clearTimeout;
      window.setInterval = saved.setInterval;
      window.clearInterval = saved.clearInterval;
      delete clockWindow.scenarioClockTime;
      delete clockWindow.scenarioClock;
      if (saved.locks) Object.defineProperty(window.navigator, "locks", saved.locks);
      else delete (window.navigator as { locks?: unknown }).locks;
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  };
  return {
    ready: async () => {
      await deadline(menu, "signed-in menu rows");
      await settled();
    },
    sample: () => ({ registrations, otherRequests: requests - registrations }),
    reads: () => {
      const matching = (pattern: RegExp) =>
        [...fake.requests].reduce(
          (total, [key, count]) => total + (pattern.test(key) ? count : 0),
          0,
        );
      return {
        services: matching(/^(GET|OPTIONS) \/project\/[^/]+\/service-stack(\?|$)/u),
        projects: matching(/^(GET|OPTIONS) \/project\/(?!search(\?|$))[^/?]+(\?|$)/u),
        variables: matching(/^POST \/user-data\/search(\?|$)/u),
      };
    },
    advance: async (ms: number) => {
      if (!clockWindow.scenarioClock) throw new Error("Controlled clock is not installed");
      const end = clockWindow.scenarioClock.now() + ms;
      let turns = 0;
      while (await clockWindow.scenarioClock.step(end)) {
        if (++turns > 10_000)
          throw new Error("Scenario clock timer loop exceeded 10,000 callbacks");
        await settled();
      }
      await settled();
    },
    membershipRequests: () => fake.requests.get("POST /client-user/search") ?? 0,
    noExternalNetwork: () => {
      expect(blocked, "Blocked external network").toEqual([]);
      expect(errors, "Page errors").toEqual([]);
      expect(unmapped, "Platform calls the fake does not answer").toEqual([]);
    },
    close,
  };
}

describe("H: hosted client budgets", () => {
  it("an idle owner's session reads no project's services or own row", async () => {
    const account = await mountAccount(MATES, [], true);
    try {
      await account.ready();
      const start = account.reads();
      await account.advance(15 * 60_000);
      const end = account.reads();
      account.noExternalNetwork();
      expect(start.services, "Per-project services reads at start").toBe(0);
      expect(end.services - start.services, "Per-project services reads while idle").toBe(0);
      expect(start.projects, "Own project rows at start").toBe(0);
      expect(end.projects - start.projects, "Own project rows over one renewal").toBe(0);
      expect(start.variables, "No variables search at menu load").toBe(0);
      expect(end.variables - start.variables, "No variables search while idle").toBe(0);
    } finally {
      await account.close();
    }
  });

  it("browser startup uses at most its organization-wide registrations and eight other requests", async () => {
    const account = await mountAccount(MATES);
    try {
      await account.ready();
      account.noExternalNetwork();
      const sample = account.sample();
      expect(sample.registrations, "Browser startup registrations").toBeLessThanOrEqual(
        REGISTRATIONS,
      );
      expect(account.membershipRequests(), "Organization membership update stream").toBe(1);
      expect(sample.otherRequests, "Browser startup non-registration requests").toBeLessThanOrEqual(
        8,
      );
    } finally {
      await account.close();
    }
  });

  it("target: menu registrations do not grow from one to four Mates", async () => {
    const counts: number[] = [];
    for (const names of [["Ada"], MATES]) {
      const account = await mountAccount(
        names,
        names.length === 4 ? ["Plain1", "Plain2", "Plain3", "Plain4", "Plain5", "Plain6"] : [],
      );
      try {
        await account.ready();
        counts.push(account.sample().registrations);
        account.noExternalNetwork();
      } finally {
        await account.close();
      }
    }
    expect(counts[0], "One-Mate menu registration ceiling").toBeLessThanOrEqual(REGISTRATIONS);
    expect(counts[1], "Four-Mate and plain-project menu registration ceiling").toBeLessThanOrEqual(
      REGISTRATIONS,
    );
    expect(
      counts[1],
      "Menu registration cost must be independent of Mate count",
    ).toBeLessThanOrEqual(counts[0]!);
  });
});
