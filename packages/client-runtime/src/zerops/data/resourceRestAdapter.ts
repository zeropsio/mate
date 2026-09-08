import * as Effect from "effect/Effect";

import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import { recipeFromProjectExport } from "../recipeExport.ts";
import type { ZeropsResourceAdapter, ZeropsResourceSourceError } from "./resources.ts";

const resourceError = (cause: unknown): ZeropsResourceSourceError => {
  if (cause instanceof ZeropsApiError) {
    switch (cause.kind) {
      case "forbidden":
      case "expired-session":
        return { _tag: "ZeropsResourceSourceError", kind: "permission", retryable: false };
      case "not-found":
        return { _tag: "ZeropsResourceSourceError", kind: "unavailable", retryable: false };
      case "network":
      case "server":
        return { _tag: "ZeropsResourceSourceError", kind: "transport", retryable: true };
      default:
        return { _tag: "ZeropsResourceSourceError", kind: "decode", retryable: false };
    }
  }
  return { _tag: "ZeropsResourceSourceError", kind: "transport", retryable: true };
};

const request = <Value>(
  run: () => Promise<Value>,
): Effect.Effect<Value, ZeropsResourceSourceError> =>
  Effect.tryPromise({ try: run, catch: resourceError });

/** Adapts scoped configuration reads and strips secret-bearing source rows at the boundary. */
export function makeZeropsResourceRestAdapter(client: ZeropsApiClient): ZeropsResourceAdapter {
  return {
    readRecipeGroup: (input, context) =>
      request(() => client.readRecipeGroup(input.groupId, context.abortSignal)),
    readProjectCloneSourceRecipe: (input, context) =>
      request(async () =>
        recipeFromProjectExport(
          await client.exportProject(input.project.projectId, context.abortSignal),
        ),
      ),
    readOrganizationLocations: (input, context) =>
      request(() =>
        client.listClientLocations(input.organization.organizationId, context.abortSignal),
      ),
    readServiceAuthorizedAgents: (input, context) =>
      request(() => client.readAuthorizedAgents(input.service.serviceId, context.abortSignal)),
    readOrganizationIntegrationTokenGrants: (input, context) =>
      request(async () =>
        (
          await client.listIntegrationTokens(input.organization.organizationId, context.abortSignal)
        ).map((token) => ({ tokenId: token.id, name: token.name, grants: token.projects ?? [] })),
      ),
  };
}
