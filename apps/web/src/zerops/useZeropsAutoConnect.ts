/**
 * Registers ready containers on the user's behalf, so the roster can say
 * what every agent is doing (`autoConnect.ts` decides which).
 *
 * Demand on the exchange driver, nothing more: the selected targets are
 * wanted, and each target's machine runs the exchange, retries it with
 * backoff and waits for an input change after a refusal. No navigation, no
 * composed first prompt, no provisioning wait — an environment simply becomes
 * one of ours, its socket comes up, and its row lights up. Why a container
 * would not connect is its reachability, which the projects screen reads.
 */

import { useEffect } from "react";

import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { selectAutoConnectTargets } from "@t3tools/client-runtime/zerops";

import { pendingCreationProjects } from "./creationHandoffStorage";
import { useExchangeDriver } from "./useZeropsIdentityExchange";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

export function useZeropsAutoConnect(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly enabled: boolean;
}): void {
  const driver = useExchangeDriver();

  useEffect(() => {
    driver.setDemand(
      "auto-connect",
      input.enabled
        ? selectAutoConnectTargets({
            candidates: input.candidates,
            health: input.health,
            birthProjectIds: new Set(pendingCreationProjects()),
          })
        : [],
    );
  }, [driver, input.candidates, input.enabled, input.health]);

  useEffect(() => () => driver.setDemand("auto-connect", []), [driver]);
}
