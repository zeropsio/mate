import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import { derivePublicRouteOffers, derivePublicRoutes } from "./publicRoutes.ts";

const PROJECT: ZeropsProject = {
  id: "p1",
  name: "acme-docs-dev",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "26a7",
};

function service(
  name: string,
  overrides: Partial<ZeropsService> & { readonly type?: string } = {},
): ZeropsService {
  const { type = "ubuntu/nodejs@22", ...rest } = overrides;
  return {
    id: `${name}-id`,
    name,
    status: "ACTIVE",
    subdomainAccess: true,
    ports: [{ port: 3000, scheme: "http" }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: type, serviceStackTypeCategory: "USER" },
    ...rest,
  };
}

describe("derivePublicRoutes", () => {
  it("lists one route per subdomain-enabled HTTP port, service by service", () => {
    const routes = derivePublicRoutes(PROJECT, [
      service("api", { ports: [{ port: 3000, scheme: "http" }] }),
      service("app", { ports: [{ port: 80, scheme: "http" }] }),
    ]);
    expect(routes).toEqual([
      {
        service: "api",
        port: 3000,
        url: "https://api-26a7-3000.prg1.zerops.app",
        host: "api-26a7-3000.prg1.zerops.app",
      },
      {
        service: "app",
        port: 80,
        url: "https://app-26a7.prg1.zerops.app",
        host: "app-26a7.prg1.zerops.app",
      },
    ]);
  });

  it("orders a service's ports numerically after its name", () => {
    const routes = derivePublicRoutes(PROJECT, [
      service("web", {
        ports: [
          { port: 8080, scheme: "http" },
          { port: 443, scheme: "https" },
        ],
      }),
    ]);
    expect(routes.map((route) => route.port)).toEqual([443, 8080]);
  });

  it.each([
    ["public access is off", service("db", { subdomainAccess: false })],
    ["the port is not HTTP", service("db", { ports: [{ port: 5432, scheme: "tcp" }] })],
    ["the service has no ports", service("s3", { ports: [] })],
    ["the service is the platform's own", service("core", { isSystem: true })],
    // The container's port is the Mate's door, not the application's.
    [
      "the service is the zcp container",
      service("zcp", { type: "zcp@1", ports: [{ port: 8080, scheme: "http" }] }),
    ],
  ])("has no route when %s", (_reason, entry) => {
    expect(derivePublicRoutes(PROJECT, [entry])).toEqual([]);
  });

  it("has no route at all for a project without a public subdomain", () => {
    const { publicZone: _zone, zeropsSubdomainHost: _host, ...bare } = PROJECT;
    expect(derivePublicRoutes(bare, [service("app")])).toEqual([]);
  });
});

describe("derivePublicRouteOffers", () => {
  const project = { id: "p", name: "p", status: "ACTIVE" };

  function service(over: Record<string, unknown>) {
    return {
      id: "svc-1",
      name: "app",
      status: "ACTIVE",
      ports: [{ port: 3000, scheme: "http" }],
      ...over,
    } as never;
  }

  it("offers a service that serves HTTP but is not published", () => {
    expect(derivePublicRouteOffers([service({ subdomainAccess: false })])).toEqual([
      { service: "app", serviceId: "svc-1", port: 3000 },
    ]);
  });

  it("offers nothing for a service that is already published", () => {
    expect(derivePublicRouteOffers([service({ subdomainAccess: true })])).toEqual([]);
  });

  it("offers nothing for a service with no HTTP port", () => {
    expect(derivePublicRouteOffers([service({ ports: [{ port: 5432, scheme: "tcp" }] })])).toEqual(
      [],
    );
    expect(derivePublicRouteOffers([service({ ports: undefined })])).toEqual([]);
  });

  it("never offers the Mate's own door or the platform's service", () => {
    expect(
      derivePublicRouteOffers([
        service({
          id: "z",
          name: "zcp",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
        }),
        service({ id: "s", name: "core", isSystem: true }),
      ]),
    ).toEqual([]);
  });

  it("offers one entry per service, on its lowest HTTP port", () => {
    expect(
      derivePublicRouteOffers([
        service({
          ports: [
            { port: 8080, scheme: "http" },
            { port: 3000, scheme: "http" },
          ],
        }),
      ]),
    ).toEqual([{ service: "app", serviceId: "svc-1", port: 3000 }]);
  });

  it("orders by service name, so the menu is stable", () => {
    expect(
      derivePublicRouteOffers([
        service({ id: "b", name: "web" }),
        service({ id: "a", name: "api" }),
      ]).map((offer) => offer.service),
    ).toEqual(["api", "web"]);
  });
});
