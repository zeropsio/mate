import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsApiClient } from "../api.ts";
import { makeZeropsResourceRestAdapter } from "./resourceRestAdapter.ts";
import type { ZeropsResourceValues } from "./resources.ts";
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

describe("makeZeropsResourceRestAdapter", () => {
  it.effect("projects integration tokens to grant metadata without credential fields", () =>
    Effect.gen(function* () {
      const adapter = makeZeropsResourceRestAdapter(
        clientFor({
          list: [
            {
              id: "token-id",
              name: "zcp-project",
              token: "must-not-leave-adapter",
              projects: [{ projectId: "project", roleCode: "ADMIN" }],
            },
          ],
        }),
      );
      const value = yield* adapter.readOrganizationIntegrationTokenGrants(
        { kind: "organization-integration-token-grants", account: scope, organization },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual([
        {
          tokenId: "token-id",
          name: "zcp-project",
          grants: [{ projectId: "project", roleCode: "ADMIN" }],
        },
      ]);
      expect(Object.keys(value[0] ?? {})).not.toContain("token");
    }),
  );

  it.effect("reads ZCP_MATE_ENABLED as the flag it is, never an inference", () =>
    Effect.gen(function* () {
      const adapter = makeZeropsResourceRestAdapter(
        clientFor({ items: [{ id: "e1", key: "ZCP_MATE_ENABLED", content: "1" }] }),
      );
      const value = yield* adapter.readServiceMateFlag(
        { kind: "service-mate-flag", account: scope, service },
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
      const adapter = makeZeropsResourceRestAdapter(client);

      const value = yield* adapter.readServiceMateFlag(
        { kind: "service-mate-flag", account: scope, service },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual({ enabled: "unknown" });
    }),
  );
});

describe("the service-deployed-version reader (A14)", () => {
  const ACTIVE = { id: "version-2", status: "ACTIVE", source: "GIT" };
  const userData = (id: string | undefined, name: string) => [
    ...(id === undefined ? [] : [{ key: "appVersionId", content: id }]),
    { key: "appVersionName", content: name },
  ];
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly body: unknown;
    readonly expected: ZeropsResourceValues["service-deployed-version"];
  }> = [
    {
      name: "the name the newest deploy gave, while that deploy is the active one",
      body: { activeAppVersion: ACTIVE, userData: userData("version-2", "3f9c1b2 v1.4.0 ada") },
      expected: { activeId: "version-2", source: "GIT", name: "3f9c1b2 v1.4.0 ada" },
    },
    {
      name: "no name while the newest deploy started is another version",
      body: { activeAppVersion: ACTIVE, userData: userData("version-3", "9d8e7f6") },
      expected: { activeId: "version-2", source: "GIT", name: null },
    },
    {
      name: "no name the service does not tie to a version",
      body: { activeAppVersion: ACTIVE, userData: userData(undefined, "9d8e7f6") },
      expected: { activeId: "version-2", source: "GIT", name: null },
    },
    {
      name: "a never-deployed runtime's NONE version",
      body: { activeAppVersion: { id: "version-1", status: "ACTIVE", source: "NONE" } },
      expected: { activeId: "version-1", source: "NONE", name: null },
    },
    {
      name: "a service with no active version",
      body: { activeAppVersion: null, userData: userData("version-2", "3f9c1b2") },
      expected: { activeId: null, source: null, name: null },
    },
  ];

  it.effect.each(cases)("$name", ({ body, expected }) =>
    Effect.gen(function* () {
      const adapter = makeZeropsResourceRestAdapter(clientFor(body));
      const value = yield* adapter.readServiceDeployedVersion(
        { kind: "service-deployed-version", account: scope, service },
        { abortSignal: new AbortController().signal },
      );

      expect(value).toEqual(expected);
    }),
  );
});
