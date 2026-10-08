/**
 * `crew.deployPoll` (replay-safe, lane `host/<host>`): whether a self-deploy onto a frozen host may
 * still run, asked of the platform's process list (`CrewPlatformProcesses` and `deployStateOf`,
 * unchanged). `running` keeps the host frozen and the decider arms the next poll; `settled` lets
 * `crew.recover` bring its copies back; `unknown` is never read as settled. A read writes
 * nothing, so a re-run asks the platform again.
 *
 * @module zerops/crew/engine/effects/deployPoll
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewPlatformProcesses, deployStateOf, type DeployState } from "../../crewDeployState.ts";
import { CREW_EFFECT_KINDS, done, payloadOf } from "./shared.ts";

export interface DeployPollPayload {
  readonly host: string;
  /** The service's id, when the Mate knows it; otherwise the platform is read by name. */
  readonly serviceId?: string;
}

export interface DeployPollValue {
  readonly state: DeployState;
}

export const makeDeployPoll = Effect.gen(function* () {
  const platform = yield* CrewPlatformProcesses;
  return {
    kind: CREW_EFFECT_KINDS.deployPoll,
    run: (row) =>
      Effect.map(platform.read, (processes) => {
        const payload = payloadOf<DeployPollPayload>(row);
        const state: DeployState =
          processes === undefined
            ? "unknown"
            : deployStateOf(processes, { host: payload.host, serviceId: payload.serviceId });
        return done({ state } satisfies DeployPollValue);
      }),
  } satisfies EffectHandler;
});
