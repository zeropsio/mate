import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { routeMenuEntries } from "./ZeropsPublicRoutes.logic";

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
