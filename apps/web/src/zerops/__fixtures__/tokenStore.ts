/**
 * The account's token list and its token write, as the broker grant reads and writes them through
 * the store (`brokerGrantTokens`): each read of the `tokens:{org}` cell and each write is recorded
 * in `calls`, worded as the client fakes word them.
 */
import type { ZeropsIntegrationToken, ZeropsProjectGrant } from "@t3tools/client-runtime/zerops";
import type { OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";

export function fakeTokenStore(
  calls: Array<string>,
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
) {
  const value = tokens.map((token) => ({
    tokenId: token.id,
    name: token.name,
    grants: token.projects ?? [],
  }));
  return {
    scope: { account: { accountId: "account" }, epoch: 1 },
    cells: {
      acquire: (request: { readonly organization: OrganizationRef }) =>
        Effect.sync(() => {
          calls.push(`list tokens of ${request.organization.organizationId}`);
          return {
            awaitSettled: Effect.succeed({
              state: "known",
              value,
              asOf: { ordinal: 1, atMs: 0 },
              coverage: "complete",
              freshness: { kind: "settled" },
            }),
          };
        }),
    },
    setIntegrationTokenProjects: (input: {
      readonly organization: OrganizationRef;
      readonly projects: ReadonlyArray<ZeropsProjectGrant>;
    }) =>
      Effect.sync(() => {
        calls.push(
          `grant ${input.projects.map((project) => project.projectId).join(",")} in ${input.organization.organizationId}`,
        );
        return { attempt: null, value: undefined };
      }),
  };
}
