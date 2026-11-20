/**
 * The crew's effect handlers, for the engine's handler map.
 *
 * @module zerops/crew/engine/effects
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { makeAppRun } from "./appRun.ts";
import { makeAppStop } from "./appStop.ts";
import { makeCheck } from "./check.ts";
import { makeCheckpoint } from "./checkpoint.ts";
import { makeClaimRead } from "./claimRead.ts";
import { makeDeliver } from "./deliver.ts";
import { makeDeployPoll } from "./deployPoll.ts";
import { makeHostFreeze } from "./hostFreeze.ts";
import { makeLand } from "./land.ts";
import { makeLaneCreate } from "./laneCreate.ts";
import { makeLaneReset } from "./laneReset.ts";
import { makeMergeIn } from "./mergeIn.ts";
import { makeRecover } from "./recover.ts";
import { makeSweep } from "./sweep.ts";

/** Every crew effect handler, for the engine's handler map. */
export const makeCrewEffectHandlers = Effect.gen(function* () {
  const handlers: ReadonlyArray<EffectHandler> = [
    yield* makeLaneCreate,
    yield* makeLaneReset,
    yield* makeCheckpoint,
    yield* makeMergeIn,
    yield* makeCheck,
    yield* makeLand,
    yield* makeSweep,
    yield* makeRecover,
    yield* makeHostFreeze,
    yield* makeClaimRead,
    yield* makeAppRun,
    yield* makeAppStop,
    yield* makeDeployPoll,
    yield* makeDeliver,
  ];
  return handlers;
});

export * from "./appRun.ts";
export * from "./appStop.ts";
export * from "./check.ts";
export * from "./checkpoint.ts";
export * from "./claimRead.ts";
export * from "./deliver.ts";
export * from "./deployPoll.ts";
export * from "./hostFreeze.ts";
export * from "./land.ts";
export * from "./laneCreate.ts";
export * from "./laneReset.ts";
export * from "./mergeIn.ts";
export * from "./recover.ts";
export * from "./shared.ts";
export * from "./sweep.ts";
