import * as Effect from "effect/Effect";

import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
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
    readOrganizationLocations: (input, context) =>
      request(() =>
        client.listClientLocations(input.organization.organizationId, context.abortSignal),
      ),
    readServiceAuthorizedAgents: (input, context) =>
      request(() => client.readAuthorizedAgents(input.service.serviceId, context.abortSignal)),
    readServiceDeployedVersion: (input, context) =>
      request(() => client.readDeployedVersionName(input.service.serviceId, context.abortSignal)),
    // A failed read is folded into `"unknown"` here, not left to fail the
    // resource: this flag exists to replace an inference (H9), and a read
    // that could not be made is exactly the case a caller must not treat as
    // a fact either way.
    readServiceMateFlag: (input, context) =>
      request(async () => {
        try {
          return {
            enabled: await client.isZeropsMateEnabled(input.service.serviceId, context.abortSignal),
          };
        } catch {
          return { enabled: "unknown" as const };
        }
      }),
    readOrganizationIntegrationTokenGrants: (input, context) =>
      request(async () =>
        (
          await client.listIntegrationTokens(input.organization.organizationId, context.abortSignal)
        ).map((token) => ({ tokenId: token.id, name: token.name, grants: token.projects ?? [] })),
      ),
  };
}
