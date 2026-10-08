/**
 * `crew.lane.create` (replay-safe, lane `git/<handle>`): a writer's copy of your tree on its dev
 * service, added, recorded and set up (`CrewWorkspace.create`, `CrewChecks.run` and the lockfile
 * hash, unchanged), as Apply does it.
 *
 * Adding a copy writes no commit; its evidence is the copy itself on `crew/<handle>`. Run again
 * after a crash, the handler adopts a copy its earlier attempt added — recorded at its tip as
 * Apply records one — and never adds a second. Its setup runs on every attempt: a cut one may
 * have stopped halfway, and a setup is safe to run again.
 *
 * @module zerops/crew/engine/effects/laneCreate
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewChecks, type CheckOutcome } from "../../CrewChecks.ts";
import { CrewReads } from "../../CrewReads.ts";
import { laneBranch } from "../../CrewShell.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace, type CreateOutcome } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, laneKey, payloadOf, settled } from "./shared.ts";

export interface LaneCreatePayload {
  readonly handle: string;
  readonly host: string;
  readonly setup?: string;
  readonly crewPort?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type LaneCreateValue =
  /** The copy stands at `tip`, recorded; `setup` is its setup's outcome when it has one. */
  | { readonly _tag: "created"; readonly tip: string; readonly setup?: CheckOutcome }
  | Exclude<CreateOutcome, { readonly _tag: "created" | "exists" }>;

export const makeLaneCreate = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const checks = yield* CrewChecks;
  const reads = yield* CrewReads;
  const store = yield* CrewStore;

  return {
    kind: CREW_EFFECT_KINDS.laneCreate,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<LaneCreatePayload>(row);
          const key = laneKey(payload.handle);
          // The setup runs here, never inside the create: a create that finds the copy skips it.
          const created = yield* workspace.create({
            crew: key.crew,
            handle: payload.handle,
            host: payload.host,
          });
          if (created._tag !== "created" && created._tag !== "exists") {
            return done(created satisfies LaneCreateValue);
          }
          const tip = created._tag === "created" ? created.head : created.tip;
          if (Option.isNone(yield* store.getLane(key.crew, key.handle))) {
            yield* store.putLane({
              crew: key.crew,
              lane: payload.handle,
              host: payload.host,
              branch: laneBranch(payload.handle),
              dispatchCommit: tip,
              recordedTip: tip,
              lastLanding: null,
              refSnapshot: null,
              lockfileHash: null,
              frozenSince: null,
              state: "ready",
            });
          }
          const setup =
            payload.setup === undefined
              ? undefined
              : yield* checks.run({
                  host: payload.host,
                  lane: payload.handle,
                  kind: "setup",
                  command: payload.setup,
                  crewPort: payload.crewPort,
                  env: payload.env,
                });
          if (setup === undefined || setup._tag === "passed") {
            const lockfileHash = yield* reads.lockfileHash(payload.host, payload.handle);
            yield* store.updateLane(key.crew, key.handle, (lane) => ({ ...lane, lockfileHash }));
          }
          const value: LaneCreateValue =
            setup === undefined ? { _tag: "created", tip } : { _tag: "created", tip, setup };
          return done(value);
        }),
      ),
  } satisfies EffectHandler;
});
