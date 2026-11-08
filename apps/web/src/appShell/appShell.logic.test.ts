import { describe, expect, it } from "vite-plus/test";

import {
  assetsToEvict,
  cachesToDelete,
  embedShellFiles,
  isKeepable,
  readShellFiles,
  routeRequest,
  SHELL_FILES_ELEMENT_ID,
  staticRoutes,
  type AppShellRequest,
  type ResponseFacts,
} from "./appShell.logic";

const ORIGIN = "https://mate.example.test";

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
  it("keeps the files of the new page and of the page it replaced, and drops every other", () => {
    const keep = new Set(["/assets/entry-3.js", "/assets/entry-2.js"]);
    expect(
      assetsToEvict(
        ["/assets/entry-1.js", "/assets/entry-2.js", "/assets/entry-3.js", "/assets/grammar-1.js"],
        keep,
      ),
    ).toEqual(["/assets/entry-1.js", "/assets/grammar-1.js"]);
  });

  it("deletes only caches of its own prefix that no build knows", () => {
    expect(
      cachesToDelete(["mate-app-shell-v1", "mate-app-assets-v1", "mate-app-shell-v0", "other"]),
    ).toEqual(["mate-app-shell-v0"]);
  });
});

describe("the files a page lists", () => {
  const page = "<html><head><title>Mate</title></head><body></body></html>";

  it("reads back exactly the files the build embedded", () => {
    const files = ["/assets/index-a.js", "/assets/index-b.css"];
    expect(readShellFiles(embedShellFiles(page, files))).toEqual(files);
  });

  it.each([
    { title: "a page with no list lists nothing", html: page },
    {
      title: "an unreadable list lists nothing",
      html: page.replace(
        "</head>",
        `<script type="application/json" id="${SHELL_FILES_ELEMENT_ID}">[</script></head>`,
      ),
    },
    {
      title: "a list naming a file outside the bundle lists nothing",
      html: embedShellFiles(page, ["/assets/a.js", "/api/session"]),
    },
    { title: "an empty list lists nothing", html: embedShellFiles(page, []) },
  ])("$title", ({ html }) => {
    expect(readShellFiles(html)).toBeUndefined();
  });
});

describe("which requests wake the worker", () => {
  const routes = staticRoutes(`${ORIGIN}/`);
  /** The first route matching the request, as the browser applies them. */
  const source = (url: string, mode: RequestMode) =>
    routes.find(({ condition }) =>
      "requestMode" in condition
        ? condition.requestMode === mode
        : new URLPattern(condition.urlPattern).test(url),
    )?.source;

  it.each([
    {
      title: "a navigation reaches the worker",
      url: `${ORIGIN}/env-1/thread-1`,
      mode: "navigate",
      to: "fetch-event",
    },
    {
      title: "a bundle file reaches the worker",
      url: `${ORIGIN}/assets/a.js`,
      mode: "cors",
      to: "fetch-event",
    },
    {
      title: "the Zerops API goes straight to the network",
      url: "https://api.example.test/api/rest/public/user/info",
      mode: "cors",
      to: "network",
    },
    {
      title: "HQ goes straight to the network",
      url: "https://hq.example.test/api/mates",
      mode: "cors",
      to: "network",
    },
    {
      title: "another origin's assets path goes straight to the network",
      url: "https://cdn.example.test/assets/a.js",
      mode: "cors",
      to: "network",
    },
    {
      title: "this origin's fonts go straight to the network",
      url: `${ORIGIN}/fonts/roboto/a.woff2`,
      mode: "cors",
      to: "network",
    },
    {
      title: "an avatar goes straight to the network",
      url: "https://avatars.example.test/u/1",
      mode: "no-cors",
      to: "network",
    },
  ] as const)("$title", ({ url, mode, to }) => {
    expect(source(url, mode)).toBe(to);
  });

  it("sends every request the worker answers to its handler", () => {
    for (const [url, mode, destination] of [
      [`${ORIGIN}/`, "navigate", "document"],
      [`${ORIGIN}/settings/general`, "navigate", "document"],
      [`${ORIGIN}/assets/a.js`, "cors", "script"],
      [`${ORIGIN}/assets/a.css`, "no-cors", "style"],
    ] as const) {
      const request = { method: "GET", url, mode, destination, ranged: false, scope: `${ORIGIN}/` };
      expect({ url, route: routeRequest(request), source: source(url, mode) }).toEqual({
        url,
        route: expect.not.stringMatching(/^pass$/u),
        source: "fetch-event",
      });
    }
  });
});
