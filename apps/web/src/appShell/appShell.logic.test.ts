import { describe, expect, it } from "vite-plus/test";

import {
  assetsToEvict,
  cachesToDelete,
  isKeepable,
  planShell,
  routeRequest,
  SHELL_MAX_AGE_MS,
  type AppShellRequest,
  type ResponseFacts,
} from "./appShell.logic";

const ORIGIN = "https://mate.example.test";
const DAY = 24 * 60 * 60 * 1000;

function navigation(path: string, overrides: Partial<AppShellRequest> = {}): AppShellRequest {
  return {
    method: "GET",
    url: `${ORIGIN}${path}`,
    mode: "navigate",
    destination: "document",
    ranged: false,
    scope: `${ORIGIN}/`,
    ...overrides,
  };
}

function subresource(path: string, overrides: Partial<AppShellRequest> = {}): AppShellRequest {
  return navigation(path, { mode: "cors", destination: "script", ...overrides });
}

describe("what the app-shell worker answers", () => {
  it.each([
    { title: "a reload of the app's root gets the kept page", request: navigation("/") },
    {
      title: "a reload of a conversation's address gets the kept page",
      request: navigation("/env-1/thread-1"),
    },
    {
      title: "HQ's sign-in return gets the kept page: the app reads the address itself",
      request: navigation("/?signin=hq-return"),
    },
    { title: "a settings address gets the kept page", request: navigation("/settings/general") },
  ])("$title", ({ request }) => {
    expect(routeRequest(request)).toBe("shell");
  });

  it.each([
    { title: "a bundle script comes from the asset cache", request: subresource("/assets/a.js") },
    {
      title: "a bundle stylesheet comes from the asset cache",
      request: subresource("/assets/a.css", { mode: "no-cors", destination: "style" }),
    },
  ])("$title", ({ request }) => {
    expect(routeRequest(request)).toBe("asset");
  });

  it.each([
    {
      title: "a posted navigation goes to the network",
      request: navigation("/", { method: "POST" }),
    },
    {
      title: "a frame's navigation goes to the network",
      request: navigation("/", { destination: "iframe" }),
    },
    { title: "the server's API goes to the network", request: navigation("/api/auth/session") },
    { title: "the websocket path goes to the network", request: navigation("/ws") },
    { title: "an OAuth callback goes to the network", request: navigation("/oauth/callback") },
    {
      title: "a well-known document goes to the network",
      request: navigation("/.well-known/t3/environment"),
    },
    { title: "a Mate's prefix goes to the network", request: navigation("/mate/") },
    { title: "the web manifest goes to the network", request: navigation("/manifest.webmanifest") },
    { title: "the icon goes to the network", request: navigation("/favicon.svg") },
    { title: "the worker's own script goes to the network", request: navigation("/sw.js") },
    { title: "a font goes to the network", request: subresource("/fonts/roboto/a.woff2") },
    {
      title: "a bundle file opened as a page goes to the network",
      request: navigation("/assets/a.js"),
    },
    {
      title: "another origin's page goes to the network",
      request: navigation("/", { url: "https://hq.example.test/" }),
    },
    {
      title: "another origin's bundle file goes to the network",
      request: subresource("/assets/a.js", { url: "https://cdn.example.test/assets/a.js" }),
    },
    {
      title: "a ranged bundle file goes to the network",
      request: subresource("/assets/a.wasm", { ranged: true }),
    },
    { title: "the bare assets folder goes to the network", request: subresource("/assets/") },
    { title: "the API read by the app goes to the network", request: subresource("/api/x") },
    {
      title: "a worker scoped below the root answers nothing",
      request: navigation("/mate/env-1", { scope: `${ORIGIN}/mate/` }),
    },
  ])("$title", ({ request }) => {
    expect(routeRequest(request)).toBe("pass");
  });
});

describe("when a kept page answers a load at once", () => {
  const now = 100 * DAY;
  it.each([
    { title: "no kept page asks the origin first", storedAt: undefined, plan: "network" },
    {
      title: "a page kept an hour ago answers at once",
      storedAt: now - 60 * 60 * 1000,
      plan: "cached",
    },
    { title: "a page kept six days ago answers at once", storedAt: now - 6 * DAY, plan: "cached" },
    {
      title: "a page kept a week ago asks the origin first",
      storedAt: now - SHELL_MAX_AGE_MS,
      plan: "network",
    },
    {
      title: "a page the stale-chunk reload forgot asks the origin first",
      storedAt: 0,
      plan: "network",
    },
    {
      title: "a page kept in the future (the clock went back) asks the origin first",
      storedAt: now + DAY,
      plan: "network",
    },
    { title: "an unreadable stamp asks the origin first", storedAt: Number.NaN, plan: "network" },
  ] as const)("$title", ({ storedAt, plan }) => {
    expect(planShell(storedAt, now)).toBe(plan);
  });
});

describe("what the worker keeps", () => {
  const page: ResponseFacts = {
    status: 200,
    type: "basic",
    redirected: false,
    url: `${ORIGIN}/`,
    contentType: "text/html; charset=utf-8",
  };
  const script: ResponseFacts = {
    ...page,
    url: `${ORIGIN}/assets/a.js`,
    contentType: "application/javascript",
  };
  it.each([
    { title: "the origin's page is kept", kind: "shell", response: page, kept: true },
    { title: "a bundle script is kept", kind: "asset", response: script, kept: true },
    {
      title: "a missing bundle file the host answered with the page is never kept",
      kind: "asset",
      response: { ...script, contentType: "text/html" },
      kept: false,
    },
    {
      title: "a page that is not HTML is never kept",
      kind: "shell",
      response: { ...page, contentType: "application/json" },
      kept: false,
    },
    {
      title: "an error page is never kept",
      kind: "shell",
      response: { ...page, status: 502 },
      kept: false,
    },
    {
      title: "a partial answer is never kept",
      kind: "asset",
      response: { ...script, status: 206 },
      kept: false,
    },
    {
      title: "an opaque answer is never kept",
      kind: "asset",
      response: { ...script, type: "opaque", url: "" },
      kept: false,
    },
    {
      title: "a redirected page is never kept",
      kind: "shell",
      response: { ...page, redirected: true },
      kept: false,
    },
    {
      title: "another origin's answer is never kept",
      kind: "asset",
      response: { ...script, url: "https://cdn.example.test/assets/a.js" },
      kept: false,
    },
  ] as const)("$title", ({ kind, response, kept }) => {
    expect(isKeepable(kind, response, ORIGIN)).toBe(kept);
  });
});

describe("how the asset cache stays bounded", () => {
  it("keeps everything while it holds no more than its bound", () => {
    expect(assetsToEvict([{ url: "a", storedAt: 1 }], 1)).toEqual([]);
  });

  it("drops the oldest stored files first, so older deploys go before the current build", () => {
    const entries = [
      { url: "new-1", storedAt: 300 },
      { url: "old-1", storedAt: 100 },
      { url: "unstamped", storedAt: undefined },
      { url: "new-2", storedAt: 300 },
      { url: "old-2", storedAt: 200 },
    ];
    expect(assetsToEvict(entries, 2)).toEqual(["unstamped", "old-1", "old-2"]);
  });

  it("deletes only caches of its own prefix that no build knows", () => {
    expect(
      cachesToDelete(["mate-app-shell-v1", "mate-app-assets-v1", "mate-app-shell-v0", "other"]),
    ).toEqual(["mate-app-shell-v0"]);
  });
});
