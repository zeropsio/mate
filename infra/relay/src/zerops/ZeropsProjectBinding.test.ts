import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ZeropsProjectBinding from "./ZeropsProjectBinding.ts";

const PROJECT_ID = "project-1";
// The shape Zerops answers, measured (docs/internals/zerops/verified.md, "The project object
// carries the region too"; client-runtime's z3-eval.service-stack.json): `zeropsSubdomainHost` is a
// bare prefix, the region rides in `publicZone`, and a service-stack port says `scheme`.
const SUBDOMAIN_HOST = "abcd";
const PUBLIC_ZONE = "fte23prpara6p2koq60b9pvsgk0.prg1-zerops.zone";

function stub(route: (url: string) => Response) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url))),
    ),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const boundRoute = (url: string): Response => {
  if (url.endsWith(`/project/${PROJECT_ID}`)) {
    return json({
      clientId: "client-1",
      zeropsSubdomainHost: SUBDOMAIN_HOST,
      publicZone: PUBLIC_ZONE,
    });
  }
  if (url.endsWith(`/project/${PROJECT_ID}/service-stack`)) {
    return json({
      list: [
        { name: "mate", subdomainAccess: true, ports: [{ port: 8080, scheme: "http" }] },
        { name: "web", subdomainAccess: true, ports: [{ port: 80, scheme: "http" }] },
        { name: "cache", subdomainAccess: true, ports: [{ port: 6379, scheme: "tcp" }] },
        { name: "db", subdomainAccess: false, ports: [{ port: 5432, scheme: "postgresql" }] },
      ],
    });
  }
  return json({ message: "unexpected route" }, 500);
};

describe("ZeropsProjectBinding.verify", () => {
  it.effect(
    "succeeds when the caller is a member and a service publishes the endpoint origin",
    () =>
      ZeropsProjectBinding.verify({
        apiBaseUrl: "https://api.example.test",
        token: "user-token",
        zeropsProjectId: PROJECT_ID,
        endpointOrigin: "https://mate-abcd-8080.prg1.zerops.app",
      }).pipe(Effect.provide(stub(boundRoute))),
  );

  it.effect(
    "fails with ZeropsEndpointNotBoundError when no subdomain-enabled service matches",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          ZeropsProjectBinding.verify({
            apiBaseUrl: "https://api.example.test",
            token: "user-token",
            zeropsProjectId: PROJECT_ID,
            endpointOrigin: "https://not-a-real-service.example.test",
          }),
        );
        expect(error._tag).toBe("ZeropsEndpointNotBoundError");
      }).pipe(Effect.provide(stub(boundRoute))),
  );

  it.effect("ignores services with subdomainAccess disabled", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsProjectBinding.verify({
          apiBaseUrl: "https://api.example.test",
          token: "user-token",
          zeropsProjectId: PROJECT_ID,
          // "db" exists in the fake service-stack but is not subdomain-enabled.
          endpointOrigin: "https://db-abcd.prg1.zerops.app",
        }),
      );
      expect(error._tag).toBe("ZeropsEndpointNotBoundError");
    }).pipe(Effect.provide(stub(boundRoute))),
  );

  it.effect("fails with ZeropsNotAMemberError on a 403 project read", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsProjectBinding.verify({
          apiBaseUrl: "https://api.example.test",
          token: "user-token",
          zeropsProjectId: PROJECT_ID,
          endpointOrigin: "https://mate-abcd-8080.prg1.zerops.app",
        }),
      );
      expect(error._tag).toBe("ZeropsNotAMemberError");
    }).pipe(
      Effect.provide(
        stub((url) =>
          url.endsWith(`/project/${PROJECT_ID}`)
            ? new Response(null, { status: 403 })
            : json({}, 500),
        ),
      ),
    ),
  );

  it.effect("fails with ZeropsProjectNotFoundError on a 404 project read", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsProjectBinding.verify({
          apiBaseUrl: "https://api.example.test",
          token: "user-token",
          zeropsProjectId: "unknown-project",
          endpointOrigin: "https://mate-abcd-8080.prg1.zerops.app",
        }),
      );
      expect(error._tag).toBe("ZeropsProjectNotFoundError");
    }).pipe(Effect.provide(stub(() => new Response(null, { status: 404 })))),
  );

  it.effect("binds a port-80 service's origin, which carries no port segment", () =>
    ZeropsProjectBinding.verify({
      apiBaseUrl: "https://api.example.test",
      token: "user-token",
      zeropsProjectId: PROJECT_ID,
      endpointOrigin: "https://web-abcd.prg1.zerops.app",
    }).pipe(Effect.provide(stub(boundRoute))),
  );

  it.effect("ignores a port that is not HTTP", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsProjectBinding.verify({
          apiBaseUrl: "https://api.example.test",
          token: "user-token",
          zeropsProjectId: PROJECT_ID,
          endpointOrigin: "https://cache-abcd-6379.prg1.zerops.app",
        }),
      );
      expect(error._tag).toBe("ZeropsEndpointNotBoundError");
    }).pipe(Effect.provide(stub(boundRoute))),
  );

  it.effect("fails with ZeropsEndpointNotBoundError when the project has no public zone", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsProjectBinding.verify({
          apiBaseUrl: "https://api.example.test",
          token: "user-token",
          zeropsProjectId: PROJECT_ID,
          endpointOrigin: "https://mate-abcd-8080.prg1.zerops.app",
        }),
      );
      expect(error._tag).toBe("ZeropsEndpointNotBoundError");
    }).pipe(
      Effect.provide(
        stub((url) =>
          url.endsWith(`/project/${PROJECT_ID}`)
            ? json({ clientId: "client-1", zeropsSubdomainHost: SUBDOMAIN_HOST })
            : boundRoute(url),
        ),
      ),
    ),
  );
});
