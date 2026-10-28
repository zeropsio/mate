/**
 * `crew.recover` (replay-safe, lane `host/<host>`): after a self-deploy, a container replacement,
 * or whenever a copy's directory is missing, a host's copies brought back from their branches and
 * set up again — or what was lost named — and the host thawed (`CrewWorkspace.recover`,
 * unchanged).
 *
 * The landings that must still be in your tree come with the effect (`landings`): the engine
 * keeps its tasks, not the git core's tables. One no longer in your tree's first-parent history
 * is named and no copy comes back, as `recover` itself does for a lost branch or lost work.
 *
 * A copy brought back writes no commit. Run again after a crash, `recover` finds a copy its
 * earlier attempt re-added already there and does not add it twice, but cannot tell it from one
 * that never left, so a re-run (`attempt` > 1) sets up every copy whose setup it did not run:
 * a setup is safe to run again, a copy left without one is not.
 *
 * @module zerops/crew/engine/effects/recover
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewChecks, type CheckOutcome } from "../../CrewChecks.ts";
import { CrewIntegration } from "../../CrewIntegration.ts";
import { CrewWorkspace, type RecoverOutcome } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, laneKey, payloadOf, settled } from "./shared.ts";

export interface RecoverSpec {
  readonly handle: string;
  readonly setup?: string;
  readonly crewPort?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RecoverPayload {
  readonly host: string;
  /** Every writer whose copy lives on the host. */
  readonly specs: ReadonlyArray<RecoverSpec>;
  /** Every landing from the host's copies that must still be in your tree. */
  readonly landings: ReadonlyArray<{ readonly assignment: string; readonly title: string }>;
}

export type RecoverValue =
  | RecoverOutcome
  /** Landings no longer in your tree's history: nothing was brought back; the host thawed. */
  | {
      readonly _tag: "landings-lost";
      readonly landings: ReadonlyArray<{ readonly assignment: string; readonly title: string }>;
    };

export const makeRecover = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const integration = yield* CrewIntegration;
  const checks = yield* CrewChecks;

  return {
    kind: CREW_EFFECT_KINDS.recover,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<RecoverPayload>(row);
          const lost = yield* Effect.filter(payload.landings, (landing) =>
            Effect.map(
              integration.landingEvidence(payload.host, landing.assignment),
              (commit) => commit === null,
            ),
          );
          if (lost.length > 0) {
            yield* workspace.unfreeze(payload.host);
            return done({ _tag: "landings-lost", landings: lost } satisfies RecoverValue);
          }
          const specs = payload.specs.map((spec) => ({
            ...spec,
            crew: laneKey(spec.handle).crew,
            host: payload.host,
          }));
          const recovered = yield* workspace.recover(payload.host, specs);
          if (recovered._tag !== "recovered" || row.attempt <= 1) {
            return done(recovered satisfies RecoverValue);
          }
          const setups: Record<string, CheckOutcome> = { ...recovered.setups };
          for (const spec of specs) {
            if (spec.setup === undefined || setups[spec.handle] !== undefined) continue;
            setups[spec.handle] = yield* checks.run({
              host: payload.host,
              lane: spec.handle,
              kind: "setup",
              command: spec.setup,
              crewPort: spec.crewPort,
              env: spec.env,
            });
          }
          return done({ ...recovered, setups } satisfies RecoverValue);
        }),
      ),
  } satisfies EffectHandler;
});
