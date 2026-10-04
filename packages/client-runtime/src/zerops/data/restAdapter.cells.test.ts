import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsApiClient } from "../api.ts";
import { makeZeropsCellReads } from "./restAdapter.ts";
import {
  AccountEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
} from "./types.ts";

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};
const scope = { account, epoch: AccountEpoch.make(1) };
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("organization"),
};
const project = {
  kind: "project" as const,
  organization,
  projectId: ZeropsProjectId.make("project"),
};
const service = {
  kind: "service" as const,
  project,
  serviceId: ZeropsServiceId.make("service"),
};

function clientFor(body: unknown): ZeropsApiClient {
  const client = new ZeropsApiClient({
    baseUrl: account.apiOrigin,
    fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  });
  client.restoreSession({ accessToken: "account-token" });
  return client;
}

describe("makeZeropsCellReads", () => {
  it.effect("projects integration tokens to grant metadata without credential fields", () =>
    Effect.gen(function* () {
      const adapter = makeZeropsCellReads(
        clientFor({
          list: [
            {
              id: "token-id",
              name: "zcp-project",
              token: "must-not-leave-adapter",
              roleCode: "READ_ONLY",
              projects: [{ projectId: "project", roleCode: "ADMIN" }],
            },
          ],
        }),
      );
      const value = yield* adapter.readOrganizationIntegrationTokenGrants(
        { kind: "tokens", account: scope, organization },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual([
        {
          tokenId: "token-id",
          name: "zcp-project",
          grants: [{ projectId: "project", roleCode: "ADMIN" }],
          roleCode: "READ_ONLY",
        },
      ]);
      expect(Object.keys(value[0] ?? {})).not.toContain("token");
    }),
  );

  it.effect("reads ZCP_MATE_ENABLED as the flag it is, never an inference", () =>
    Effect.gen(function* () {
      const adapter = makeZeropsCellReads(
        clientFor({ items: [{ id: "e1", key: "ZCP_MATE_ENABLED", content: "1" }] }),
      );
      const value = yield* adapter.readServiceMateFlag(
        { kind: "mate-flag", account: scope, service },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual({ enabled: true });
    }),
  );

  it.effect("folds a failed read into unknown, never false (H9)", () =>
    Effect.gen(function* () {
      const client = new ZeropsApiClient({
        baseUrl: account.apiOrigin,
        fetch: () => Promise.resolve(new Response("", { status: 500 })),
      });
      client.restoreSession({ accessToken: "account-token" });
      const adapter = makeZeropsCellReads(client);

      const value = yield* adapter.readServiceMateFlag(
        { kind: "mate-flag", account: scope, service },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual({ enabled: "unknown" });
    }),
  );
});

it.effect("reads a stop's public addresses by project id without navigation candidates", () =>
  Effect.gen(function* () {
    const paths: string[] = [];
    const client = new ZeropsApiClient({
      baseUrl: account.apiOrigin,
      fetch: (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        const body = path.endsWith("/public-http-routing")
          ? {
              list: [
                {
                  id: "route",
                  isSynced: true,
                  sslEnabled: true,
                  domains: [{ domainName: "shop.example.com", sslStatus: "ACTIVE" }],
                  locations: [{ path: "/", port: 80, serviceStackId: "app" }],
                },
              ],
            }
          : path.endsWith("/service-stack")
            ? {
                list: [
                  {
                    id: "app",
                    name: "web",
                    status: "ACTIVE",
                    subdomainAccess: true,
                    ports: [{ port: 80, scheme: "http" }],
                  },
                ],
              }
            : {
                id: "project",
                name: "Production",
                publicZone: "zone.prg1-zerops.zone",
                zeropsSubdomainHost: "1234",
              };
        return Promise.resolve(new Response(JSON.stringify(body)));
      },
    });
    client.restoreSession({ accessToken: "test-token" });
    const value = yield* makeZeropsCellReads(client).readProjectPublicAccess(
      { kind: "public-access", account: scope, project },
      { abortSignal: new AbortController().signal },
    );
    expect(value.routes.map((route) => route.url)).toEqual([
      "https://web-1234.prg1.zerops.app",
      "https://shop.example.com",
    ]);
    expect(paths).toHaveLength(3);
  }),
);

it.effect("a failed public access read fails rather than claiming no addresses", () =>
  Effect.gen(function* () {
    const client = new ZeropsApiClient({
      baseUrl: account.apiOrigin,
      fetch: () => Promise.resolve(new Response("", { status: 500 })),
    });
    client.restoreSession({ accessToken: "test-token" });
    const result = yield* makeZeropsCellReads(client)
      .readProjectPublicAccess(
        { kind: "public-access", account: scope, project },
        { abortSignal: new AbortController().signal },
      )
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
  }),
);

it.effect("a malformed service listing cannot resolve public access as an empty list", () =>
  Effect.gen(function* () {
    const client = new ZeropsApiClient({
      baseUrl: account.apiOrigin,
      fetch: (input) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              new URL(String(input)).pathname.endsWith("/service-stack")
                ? { unexpected: [] }
                : new URL(String(input)).pathname.endsWith("/public-http-routing")
                  ? { list: [] }
                  : {
                      id: "project",
                      name: "Production",
                      publicZone: "zone.prg1-zerops.zone",
                      zeropsSubdomainHost: "1234",
                    },
            ),
          ),
        ),
    });
    client.restoreSession({ accessToken: "test-token" });
    const result = yield* makeZeropsCellReads(client)
      .readProjectPublicAccess(
        { kind: "public-access", account: scope, project },
        { abortSignal: new AbortController().signal },
      )
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
  }),
);
