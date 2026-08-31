import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { repairSettledZeropsAuthentication } from "./ZeropsIdentityRepair";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function connectionState(
  lastFailure: SupervisorConnectionState["lastFailure"],
): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: lastFailure?._tag === "ConnectionBlockedError" ? "blocked" : "connected",
    stage: null,
    attempt: 1,
    generation: 1,
    lastFailure,
    retryAt: null,
  };
}

describe("Zerops identity repair", () => {
  it("exchanges exactly once for an observed settled authentication failure", () => {
    const attemptedEnvironmentIds = new Set<string>();
    const repair = vi.fn();
    const state = connectionState(
      new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
      }),
    );
    const input = {
      attemptedEnvironmentIds,
      environmentId: ENVIRONMENT_ID,
      state,
      hasZeropsToken: true,
      isZeropsEnvironment: true,
      repair,
    };

    repairSettledZeropsAuthentication(input);
    repairSettledZeropsAuthentication(input);

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledWith(ENVIRONMENT_ID);
  });

  it.each([
    {
      name: "the Zerops account token is absent",
      hasZeropsToken: false,
      isZeropsEnvironment: true,
      failure: new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
      }),
    },
    {
      name: "the environment came from pairing",
      hasZeropsToken: true,
      isZeropsEnvironment: false,
      failure: new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
      }),
    },
    {
      name: "the settled failure is not authentication",
      hasZeropsToken: true,
      isZeropsEnvironment: true,
      failure: new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential lacks a scope.",
      }),
    },
  ])("does not exchange when $name", ({ hasZeropsToken, isZeropsEnvironment, failure }) => {
    const repair = vi.fn();

    repairSettledZeropsAuthentication({
      attemptedEnvironmentIds: new Set(),
      environmentId: ENVIRONMENT_ID,
      state: connectionState(failure),
      hasZeropsToken,
      isZeropsEnvironment,
      repair,
    });

    expect(repair).not.toHaveBeenCalled();
  });

  it("allows a later authentication-failure episode after the environment recovers", () => {
    const attemptedEnvironmentIds = new Set<string>();
    const repair = vi.fn();
    const failed = connectionState(
      new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
      }),
    );
    const input = {
      attemptedEnvironmentIds,
      environmentId: ENVIRONMENT_ID,
      hasZeropsToken: true,
      isZeropsEnvironment: true,
      repair,
    };

    repairSettledZeropsAuthentication({ ...input, state: failed });
    repairSettledZeropsAuthentication({ ...input, state: AVAILABLE_CONNECTION_STATE });
    repairSettledZeropsAuthentication({ ...input, state: connectionState(null) });
    repairSettledZeropsAuthentication({ ...input, state: failed });

    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("exchanges once across consecutive refusals of freshly minted sessions", () => {
    const attemptedEnvironmentIds = new Set<string>();
    const repair = vi.fn();
    const refused = connectionState(
      new ConnectionBlockedError({
        reason: "authentication",
        detail: "The freshly minted environment credential was refused.",
      }),
    );
    const input = {
      attemptedEnvironmentIds,
      environmentId: ENVIRONMENT_ID,
      hasZeropsToken: true,
      isZeropsEnvironment: true,
      repair,
    };

    for (let refusal = 0; refusal < 10; refusal += 1) {
      repairSettledZeropsAuthentication({ ...input, state: refused });
      repairSettledZeropsAuthentication({ ...input, state: AVAILABLE_CONNECTION_STATE });
    }

    expect(repair).toHaveBeenCalledTimes(1);
  });
});
