import * as Effect from "effect/Effect";

import { ZeropsApiError, type ZeropsApiClient, type ZeropsServiceDeploys } from "../api.ts";
import type {
  ZeropsResourceAdapter,
  ZeropsResourceSourceError,
  ZeropsServiceDeployedVersion,
} from "./resources.ts";

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

/** One user-data value of the service, trimmed; `null` when it is absent or empty. */
const userDataOf = (deploys: ZeropsServiceDeploys, key: string): string | null => {
  const content = deploys.userData?.find((item) => item.key === key)?.content?.trim();
  return content === undefined || content.length === 0 ? null : content;
};

/**
 * What the service runs (A14): its user data names the newest deploy started (A11), which is what
 * runs only while it is the active version; no name is taken from any other.
 */
function deployedVersionOf(deploys: ZeropsServiceDeploys): ZeropsServiceDeployedVersion {
  const activeId = deploys.activeAppVersion?.id ?? null;
  const startedId = userDataOf(deploys, "appVersionId");
  return {
    activeId,
    source: activeId === null ? null : (deploys.activeAppVersion?.source ?? null),
    name:
      activeId !== null && startedId === activeId ? userDataOf(deploys, "appVersionName") : null,
  };
}

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
      request(async () =>
        deployedVersionOf(
          await client.readServiceDeploys(input.service.serviceId, context.abortSignal),
        ),
      ),
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
