import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { routeMenuEntries, ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

const APP: ZeropsPublicRoute = {
  service: "app",
  port: 80,
  url: "https://app-26a7.prg1.zerops.app",
  host: "app-26a7.prg1.zerops.app",
};
const API: ZeropsPublicRoute = {
  service: "api",
  port: 3000,
  url: "https://api-26a7-3000.prg1.zerops.app",
  host: "api-26a7-3000.prg1.zerops.app",
};
const API_ADMIN: ZeropsPublicRoute = {
  service: "api",
  port: 9000,
  url: "https://api-26a7-9000.prg1.zerops.app",
  host: "api-26a7-9000.prg1.zerops.app",
};

describe("routeMenuEntries", () => {
  it("is one item per route, the service as the developer names it, the host beside it", () => {
    expect(routeMenuEntries([API, APP])).toEqual([
      { key: API.url, service: "api", port: undefined, host: API.host, url: API.url },
      { key: APP.url, service: "app", port: undefined, host: APP.host, url: APP.url },
    ]);
  });

  it("writes the port only where one service answers on several", () => {
    const entries = routeMenuEntries([API, API_ADMIN, APP]);
    expect(entries.map((entry) => entry.port)).toEqual([3000, 9000, undefined]);
  });

  it("is empty when nobody can reach the environment", () => {
    expect(routeMenuEntries([])).toEqual([]);
  });
});

describe("ZeropsRoutesMenu", () => {
  it("is nothing when there is nowhere to go", () => {
    expect(renderToStaticMarkup(<ZeropsRoutesMenu label="Routes" routes={[]} />)).toBe("");
  });

  it("is the link itself when there is one route", () => {
    const html = renderToStaticMarkup(
      <ZeropsRoutesMenu label="Public routes of app" routes={[APP]} />,
    );
    expect(html).toContain("<a ");
    expect(html).toContain(`href="${APP.url}"`);
    expect(html).toContain('aria-label="Public routes of app: app-26a7.prg1.zerops.app"');
    expect(html).not.toContain("<button");
  });

  it("offers a menu when there are several", () => {
    const html = renderToStaticMarkup(
      <ZeropsRoutesMenu label="Public routes of app" routes={[API, APP]} />,
    );
    expect(html).toContain('aria-label="Public routes of app"');
    expect(html).toContain("<button");
    expect(html).not.toContain(`href="${APP.url}"`);
  });
});
