import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ZeropsProjectBinding from "./ZeropsProjectBinding.ts";

const PROJECT_ID = "project-1";
const SUBDOMAIN_HOST = "abcd.prg1.zerops.app";

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
    return json({ clientId: "client-1", zeropsSubdomainHost: SUBDOMAIN_HOST });
  }
  if (url.endsWith(`/project/${PROJECT_ID}/service-stack`)) {
    return json({
      list: [
        { name: "mate", subdomainAccess: true, ports: [{ port: 8080, httpSupport: true }] },
        { name: "db", subdomainAccess: false },
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

  it.effect(
    "fails with ZeropsEndpointNotBoundError when the project subdomain host is a bare prefix",
    () =>
      // Known limitation documented on the module: some projects' GetProject
      // returns only a bare prefix ("8a"), not "8a.prg1.zerops.app" — the
      // reconstruction can never match, and the check fails closed.
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          ZeropsProjectBinding.verify({
            apiBaseUrl: "https://api.example.test",
            token: "user-token",
            zeropsProjectId: PROJECT_ID,
            endpointOrigin: "https://mate-8a.prg1.zerops.app",
          }),
        );
        expect(error._tag).toBe("ZeropsEndpointNotBoundError");
      }).pipe(
        Effect.provide(
          stub((url) =>
            url.endsWith(`/project/${PROJECT_ID}`)
              ? json({ clientId: "client-1", zeropsSubdomainHost: "8a" })
              : url.endsWith(`/project/${PROJECT_ID}/service-stack`)
                ? json({
                    list: [
                      {
                        name: "mate",
                        subdomainAccess: true,
                        ports: [{ port: 80, httpSupport: true }],
                      },
                    ],
                  })
                : json({}, 500),
          ),
        ),
      ),
  );
});
