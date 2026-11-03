/**
 * Authorizing a Mate's ZCP to observe its stage and production, as the account's
 * `authorize-observe` operation: by itself when the Mate's own person opens it unauthorized, and by
 * the observation section's Authorize.
 */
import {
  authorizesObserveByItself,
  automaticObserveRequestId,
  operationProgress,
  type OperationProgress,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useState } from "react";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { useAccountOrgId, useProjection } from "./accountData";
import { captureAccountLifetime } from "./accountLifetime";
import { useObserveCredential } from "./useObserveCredential";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
import { useHqProjectPerson } from "./useZeropsMateOwners";

const UNKNOWN = Atom.make<OperationProgress>({ stage: "unknown" });

/** Where the person's last Authorize stands: under way, or what stopped it. */
export type ObserveAuthorizePress =
  | { readonly state: "working" }
  | { readonly state: "refused"; readonly words: string };

export function useAuthorizeObserve(projectId: string | null): {
  readonly authorize: (() => void) | null;
  readonly press: ObserveAuthorizePress | null;
} {
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const [press, setPress] = useState<{
    readonly projectId: string;
    readonly value: ObserveAuthorizePress;
  } | null>(null);
  const authorize = useCallback(() => {
    if (operations === null || orgId === null || projectId === null) return;
    const current = captureAccountLifetime();
    setPress({ projectId, value: { state: "working" } });
    operations
      .run({ kind: "authorize-observe", orgId, projectId }, { orgId, unobserved: HQ_UNFOLLOWED })
      .then(
        () => {
          if (current()) setPress(null);
        },
        (cause: unknown) => {
          if (!current()) return;
          setPress({
            projectId,
            value: {
              state: "refused",
              words: cause instanceof Error ? cause.message : "HQ did not authorize this Mate.",
            },
          });
        },
      );
  }, [operations, orgId, projectId]);
  return {
    authorize: operations === null || orgId === null || projectId === null ? null : authorize,
    press: press !== null && press.projectId === projectId ? press.value : null,
  };
}

/**
 * Opening one of the person's own Mates while it reads not authorized asks HQ to record them, once
 * a session: the same request creation makes for a new Mate, for the Mate's existing context.
 */
export function useKeepObserveAuthorized(environmentId: EnvironmentId): void {
  const project = useEnvironmentProjectRef(environmentId);
  const projectId = project?.projectId ?? null;
  const mine = useHqProjectPerson(projectId ?? "")?.mine;
  // Only the person's own Mate demands its status here; a colleague's is never read for this.
  const { state } = useObserveCredential(mine === true ? projectId : null);
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const requestId =
    orgId === null || projectId === null ? null : automaticObserveRequestId(orgId, projectId);
  const asked = useProjection(operationProgress, requestId, UNKNOWN).stage !== "unknown";
  const runs = authorizesObserveByItself({ mine, metadata: state.metadata, asked });
  useEffect(() => {
    if (!runs || operations === null || orgId === null || projectId === null || requestId === null)
      return;
    void operations.submit({ kind: "authorize-observe", orgId, projectId }, requestId);
  }, [operations, orgId, projectId, requestId, runs]);
}

/** Mounted beside an open conversation; draws nothing. */
export function ObserveAuthorizationKeeper(props: { readonly environmentId: EnvironmentId }) {
  useKeepObserveAuthorized(props.environmentId);
  return null;
}
