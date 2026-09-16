import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsApiClient } from "../api.ts";
import { makeZeropsResourceRestAdapter } from "./resourceRestAdapter.ts";
import {
  AccountEpoch,
  ZeropsAccountId,
  ZeropsOrganizationId,
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
});
