import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { groupRoutesByService, ZeropsRouteChips, ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

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

describe("groupRoutesByService", () => {
  it("keeps one entry per service, in the order the routes came", () => {
    expect(groupRoutesByService([API, API_ADMIN, APP]).map((group) => group.service)).toEqual([
      "api",
      "app",
    ]);
    expect(groupRoutesByService([API, API_ADMIN, APP])[0]?.routes).toHaveLength(2);
  });
});

describe("ZeropsRouteChips", () => {
  it("is one chip per service, named as the developer names it, that opens the URL", () => {
    const html = renderToStaticMarkup(
      <ZeropsRouteChips label="Public access of x" routes={[API, APP]} />,
    );
    expect(html).toContain('data-zerops-surface="public-routes"');
    expect(html.match(/data-zerops-surface="public-route"/gu)).toHaveLength(2);
    expect(html).toContain(">api<");
    expect(html).toContain(">app<");
    expect(html).toContain(`href="${APP.url}"`);
    expect(html).toContain('target="_blank"');
    // The host is not a column: it is not written into the row.
    expect(html).not.toContain(">app-26a7.prg1.zerops.app<");
  });

  it("offers a menu for a service that answers on several ports", () => {
    const html = renderToStaticMarkup(
      <ZeropsRouteChips label="Public access of x" routes={[API, API_ADMIN]} />,
    );
    expect(html.match(/data-zerops-surface="public-route"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="api: 2 public ports"');
    expect(html).toContain("<button");
    expect(html).not.toContain(`href="${API.url}"`);
  });

  it("is a quiet dash when nobody can reach the environment", () => {
    const html = renderToStaticMarkup(<ZeropsRouteChips label="Public access of x" routes={[]} />);
    expect(html).toContain('data-zerops-surface="public-routes-empty"');
    expect(html).toContain('aria-label="Public access of x: none"');
    expect(html).not.toContain("<a ");
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
