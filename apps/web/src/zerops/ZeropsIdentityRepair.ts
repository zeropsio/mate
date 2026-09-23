/**
 * Feeds the exchange driver what only the router and the connection runtime know: the
 * route's target, as demand, and each registered environment's link.
 *
 * Repair is the driver's: a link blocked on authentication leaves the target's machine without
 * a credential, and it exchanges again — on every rejection, backing off inside the loop
 * guard's window, for as long as the target is wanted (DESIGN §4.4).
 */
import {
  ConnectionBlockedError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { LinkPhase } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { createElement, useEffect } from "react";

import { environmentIdFromPathname } from "~/routes/-environmentRoute";
import { useEnvironmentConnectionState, useEnvironments } from "~/state/environments";

import {
  readRememberedEnvironments,
  useEnvironmentIdentityVersion,
} from "./rememberedEnvironments";
import { useExchangeDriver } from "./useZeropsIdentityExchange";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);

/** Region L as the supervisor publishes it; null for a block that names no reason. */
export function linkPhaseOf(state: SupervisorConnectionState): LinkPhase | null {
  switch (state.phase) {
    case "available":
      return { phase: "idle" };
    case "offline":
      return { phase: "offline" };
    case "connecting":
      return { phase: "connecting" };
    case "connected":
      return { phase: "connected" };
    case "backoff":
      return { phase: "backoff", retryAtMs: state.retryAt };
    case "blocked":
      return isConnectionBlockedError(state.lastFailure)
        ? { phase: "blocked", reason: state.lastFailure.reason }
        : null;
  }
}

function ZeropsLinkMirror({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { data: state } = useEnvironmentConnectionState(environmentId);
  const driver = useExchangeDriver();

  // Every publication is one observation: a repeated rejection is counted, never coalesced.
  useEffect(() => {
    if (state === null) return;
    const phase = linkPhaseOf(state);
    if (phase !== null) driver.link(environmentId, phase);
  }, [driver, environmentId, state]);

  return null;
}

export function ZeropsIdentityRepair() {
  const { environments } = useEnvironments();
  const driver = useExchangeDriver();
  const pathname = useLocation({ select: (location) => location.pathname });
  const identityVersion = useEnvironmentIdentityVersion();

  // The route's target is exchanged first (§4.4 priority); only a remembered target has a key.
  useEffect(() => {
    const environmentId = environmentIdFromPathname(pathname);
    const record =
      environmentId === null
        ? undefined
        : readRememberedEnvironments().find((entry) => entry.environmentId === environmentId);
    driver.setDemand("route", record === undefined ? [] : [record.key]);
  }, [driver, identityVersion, pathname]);

  useEffect(() => () => driver.setDemand("route", []), [driver]);

  return environments.map((environment) =>
    createElement(ZeropsLinkMirror, {
      key: environment.environmentId,
      environmentId: environment.environmentId,
    }),
  );
}
