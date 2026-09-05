/**
 * Registers ready containers on the user's behalf, so the roster can say
 * what every agent is doing (`autoConnect.ts` decides which).
 *
 * This is the identity exchange the Connect button runs, minus everything
 * that button does afterwards: no navigation, no composed first prompt, no
 * provisioning wait. An environment simply becomes one of ours, its socket
 * comes up, and its row lights up. Failures are kept, not shown here — the
 * projects screen is where a person reads why a container would not connect.
 */

import { useEffect, useRef, useState } from "react";

import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { selectAutoConnectTargets } from "@t3tools/client-runtime/zerops";
import { rememberEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";

import { browserZeropsStorage } from "./storage";
import { useZeropsIdentityExchange } from "./useZeropsIdentityExchange";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

const CONNECT_CONCURRENCY = 2;

export function useZeropsAutoConnect(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly enabled: boolean;
}): { readonly failures: ReadonlyMap<string, string> } {
  const exchange = useZeropsIdentityExchange();
  // Once per origin per session, success or failure: a container that refused
  // us is not asked again until the page reloads, and a registered one is
  // recognised by its candidate, not by this set.
  const attemptedRef = useRef(new Set<string>());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!input.enabled) return;
    const targets = selectAutoConnectTargets({
      candidates: input.candidates,
      health: input.health,
      attempted: attemptedRef.current,
    });
    if (targets.length === 0) return;

    let cancelled = false;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const target = targets[cursor];
        cursor += 1;
        if (!target || cancelled) return;
        attemptedRef.current.add(target.containerOrigin);
        const result = await exchange(target.containerOrigin);
        if (result._tag === "Failure") {
          if (!cancelled) {
            setFailures((current) => new Map(current).set(target.containerOrigin, result.error));
          }
          continue;
        }
        if (target.clientId !== undefined) {
          await rememberEnvironmentProjectRef(browserZeropsStorage, result.environmentId, {
            projectId: target.projectId,
            orgId: target.clientId,
            source: "connect",
          });
        }
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(CONNECT_CONCURRENCY, targets.length) }, () => worker()),
    );
    return () => {
      cancelled = true;
    };
  }, [exchange, input.candidates, input.enabled, input.health]);

  return { failures };
}
