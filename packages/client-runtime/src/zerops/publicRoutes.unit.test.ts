import { expect, it } from "vite-plus/test";

import type { ZeropsService, ZeropsServicePort } from "./api/service.ts";
import { derivePublicRouteOffers } from "./publicRoutes.ts";

const service = (
  name: string,
  type: string,
  ports: ReadonlyArray<ZeropsServicePort>,
  sent: Partial<ZeropsService> = {},
): ZeropsService => ({
  id: `${name}-id`,
  name,
  status: "ACTIVE",
  subdomainAccess: false,
  ports,
  serviceStackTypeInfo: { serviceStackTypeVersionName: type },
  ...sent,
});

// witness: packages/client-runtime/src/zerops/publicRoutes.ts | .sort((left, right) => left - right); → .sort((left, right) => right - left);
it("ZV125: A route is offered for an unpublished HTTP service on its lowest port, never for the Mate's own door or the platform's service", () => {
  const offers = derivePublicRouteOffers([
    service("web", "nodejs@22", [
      { port: 8080, scheme: "http" },
      { port: 22, scheme: "tcp" },
      { port: 3000, scheme: "http" },
    ]),
    service("zcp", "zcp@1", [{ port: 8080, scheme: "http" }]),
    service("core", "core@2", [{ port: 80, scheme: "http" }], { isSystem: true }),
    service("live", "nodejs@22", [{ port: 3000, scheme: "http" }], { subdomainAccess: true }),
    service("db", "postgresql@16", [{ port: 5432, scheme: "postgresql" }]),
  ]);
  expect(offers).toEqual([{ service: "web", serviceId: "web-id", port: 3000 }]);
});
