import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import { createElement, useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { useEnvironments, useEnvironmentConnectionState } from "~/state/environments";

import { connectionOriginFor } from "./firstPromptStorage";
import { useZeropsIdentityExchange } from "./useZeropsIdentityExchange";
import { useZeropsSession } from "./ZeropsSessionProvider";

export function repairSettledZeropsAuthentication(input: {
  readonly attemptedEnvironmentIds: Set<string>;
  readonly environmentId: EnvironmentId;
  readonly state: SupervisorConnectionState;
  readonly hasZeropsToken: boolean;
  readonly isZeropsEnvironment: boolean;
  readonly repair: (environmentId: EnvironmentId) => void;
}): void {
  const key = String(input.environmentId);
  const isSettledAuthenticationFailure =
    input.state.phase === "blocked" && input.state.lastFailure?.reason === "authentication";

  if (!isSettledAuthenticationFailure) {
    if (input.state.phase === "connected") {
      input.attemptedEnvironmentIds.delete(key);
    }
    return;
  }
  if (
    !input.hasZeropsToken ||
    !input.isZeropsEnvironment ||
    input.attemptedEnvironmentIds.has(key)
  ) {
    return;
  }

  input.attemptedEnvironmentIds.add(key);
  input.repair(input.environmentId);
}

interface RepairableEnvironment {
  readonly environmentId: EnvironmentId;
  readonly displayUrl: string | null;
}

function ZeropsIdentityRepairEnvironment({
  environment,
  attemptedEnvironmentIds,
}: {
  readonly environment: RepairableEnvironment;
  readonly attemptedEnvironmentIds: Set<string>;
}) {
  const { data: state } = useEnvironmentConnectionState(environment.environmentId);
  const { client } = useZeropsSession();
  const exchange = useZeropsIdentityExchange();
  const origin = environment.displayUrl === null ? null : normalizeOrigin(environment.displayUrl);

  useEffect(() => {
    if (state === null) return;
    repairSettledZeropsAuthentication({
      attemptedEnvironmentIds,
      environmentId: environment.environmentId,
      state,
      hasZeropsToken: Boolean(client.session?.accessToken),
      isZeropsEnvironment:
        origin !== null &&
        connectionOriginFor(String(environment.environmentId)) === "zerops-identity",
      repair: () => {
        if (origin === null) return;
        void exchange(origin).then((result) => {
          if (result._tag === "Failure") {
            toastManager.add({
              type: "error",
              title: "Could not repair the Zerops session",
              description: result.error,
            });
          }
        });
      },
    });
  }, [attemptedEnvironmentIds, client, environment.environmentId, exchange, origin, state]);

  return null;
}

/** Repairs expired Zerops environment sessions from every route that uses the app shell. */
export function ZeropsIdentityRepair() {
  const { environments } = useEnvironments();
  const attemptedEnvironmentIds = useRef(new Set<string>()).current;

  return environments.map((environment) =>
    createElement(ZeropsIdentityRepairEnvironment, {
      key: environment.environmentId,
      environment,
      attemptedEnvironmentIds,
    }),
  );
}
