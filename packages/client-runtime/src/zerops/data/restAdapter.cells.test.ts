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
const project = {
  kind: "project" as const,
  organization: {
    kind: "organization" as const,
    account,
    organizationId: ZeropsOrganizationId.make("organization"),
  },
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
