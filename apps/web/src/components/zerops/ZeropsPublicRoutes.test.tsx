import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { routeMenuEntries, ZeropsRouteMenuItems, ZeropsRoutesMenu } from "./ZeropsPublicRoutes";

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

  it("writes no port where one service has several hosts on the same one", () => {
    // Four domains pointed at one service is the ordinary shape of a
    // production, and `app:80` four times over tells nobody which is which.
    const alias = (host: string): ZeropsPublicRoute => ({
      service: "app",
      port: 80,
      url: `https://${host}`,
      host,
    });
    const entries = routeMenuEntries([alias("shop.example.com"), alias("www.shop.example.com")]);
    expect(entries.map((entry) => entry.port)).toEqual([undefined, undefined]);
  });

  it("is empty when nobody can reach the environment", () => {
    expect(routeMenuEntries([])).toEqual([]);
  });
});

describe("ZeropsRoutesMenu", () => {
  it("is nothing when there is nowhere to go", () => {
    expect(renderToStaticMarkup(<ZeropsRoutesMenu label="Routes" routes={[]} />)).toBe("");
  });

  it("is the globe alone, the link itself, when there is one route", () => {
    const html = renderToStaticMarkup(
      <ZeropsRoutesMenu label="Public routes of app" routes={[APP]} />,
    );
    expect(html).toContain("<a ");
    expect(html).toContain(`href="${APP.url}"`);
    expect(html).toContain('aria-label="Public routes of app: app-26a7.prg1.zerops.app"');
    expect(html).not.toContain("<button");
    // One is the globe's own meaning; a bubble would only say it again.
    expect(html).not.toContain('data-zerops-surface="public-routes-count"');
  });

  it("wears the count as a bubble on the globe and opens a menu when there are several", () => {
    const html = renderToStaticMarkup(
      <ZeropsRoutesMenu label="Public routes of app" routes={[API, APP]} />,
    );
    expect(html).toContain('aria-label="Public routes of app: 2 public URLs"');
    expect(html).toContain("<button");
    expect(html).not.toContain(`href="${APP.url}"`);
    const bubble =
      /<span[^>]*class="([^"]*)"[^>]*data-zerops-surface="public-routes-count"[^>]*>2</u.exec(html);
    expect(bubble?.[1]?.split(" ")).toEqual(
      expect.arrayContaining(["absolute", "-top-1", "-end-1"]),
    );
    // The bubble sits inside the globe's own box, not beside it.
    const trigger =
      /<button[^>]*data-zerops-surface="public-routes-menu"[^>]*>(.*?)<\/button>/u.exec(html)?.[1];
    expect(trigger).toContain("lucide-globe");
    expect(trigger).toContain('data-zerops-surface="public-routes-count"');
  });

  it("lists every domain in its menu, each its own item", () => {
    // The menu's popup renders only once opened, into a portal no test here
    // has a DOM for; its content is read off the element tree instead.
    const drawn = ZeropsRoutesMenu({ label: "Public routes of app", routes: [API, APP] });
    const items = visitElements(drawn, (element) => element.type === ZeropsRouteMenuItems);
    expect(items?.props["routes"]).toEqual([API, APP]);
    // …and those items are one per domain, each a link out with its host.
    expect(routeMenuEntries([API, APP]).map((entry) => entry.host)).toEqual([API.host, APP.host]);
  });
});
