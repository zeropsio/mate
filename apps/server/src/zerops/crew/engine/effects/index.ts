/**
 * The crew's effect handlers, and the effects as the crew's decider queues them: each kind on its
 * lane, always replay-safe.
 *
 * @module zerops/crew/engine/effects
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { makeAppRun, type AppRunPayload } from "./appRun.ts";
import { makeAppStop, type AppStopPayload } from "./appStop.ts";
import { makeCheck, type CheckPayload } from "./check.ts";
import { makeCheckpoint, type CheckpointPayload } from "./checkpoint.ts";
import { makeClaimRead, type ClaimReadPayload } from "./claimRead.ts";
import { makeDeliver, type DeliverPayload } from "./deliver.ts";
import { makeDeployPoll, type DeployPollPayload } from "./deployPoll.ts";
import { makeInspect, type InspectPayload } from "./inspect.ts";
import { makeLand, type LandPayload } from "./land.ts";
import { makeLaneCreate, type LaneCreatePayload } from "./laneCreate.ts";
import { makeLaneReset, type LaneResetPayload } from "./laneReset.ts";
import { makeMergeIn, type MergeInPayload } from "./mergeIn.ts";
import { makeRecover, type RecoverPayload } from "./recover.ts";
import { CREW_EFFECT_KINDS as K, crewEffect, crewLanes } from "./shared.ts";
import { makeSweep, type SweepPayload } from "./sweep.ts";

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
    yield* makeInspect,
    yield* makeRecover,
    yield* makeClaimRead,
    yield* makeAppRun,
    yield* makeAppStop,
    yield* makeDeployPoll,
    yield* makeDeliver,
  ];
  return handlers;
});

/** Each crew effect on its lane: what the crew's decider queues. */
export const crewEffects = {
  laneCreate: (payload: LaneCreatePayload) =>
    crewEffect(K.laneCreate, crewLanes.git(payload.handle), payload),
  laneReset: (payload: LaneResetPayload) =>
    crewEffect(K.laneReset, crewLanes.git(payload.handle), payload),
  checkpoint: (payload: CheckpointPayload) =>
    crewEffect(K.checkpoint, crewLanes.git(payload.handle), payload),
  mergeIn: (payload: MergeInPayload) =>
    crewEffect(K.mergeIn, crewLanes.git(payload.handle), payload),
  check: (payload: CheckPayload) => crewEffect(K.check, crewLanes.check(payload.handle), payload),
  land: (host: string, payload: LandPayload) => crewEffect(K.land, crewLanes.host(host), payload),
  sweep: (payload: SweepPayload) => crewEffect(K.sweep, crewLanes.host(payload.host), payload),
  inspect: (payload: InspectPayload) =>
    crewEffect(K.inspect, crewLanes.host(payload.host), payload),
  recover: (payload: RecoverPayload) =>
    crewEffect(K.recover, crewLanes.host(payload.host), payload),
  claimRead: (payload: ClaimReadPayload) =>
    crewEffect(K.claimRead, crewLanes.host(payload.host), payload),
  appRun: (payload: AppRunPayload) => crewEffect(K.appRun, crewLanes.host(payload.host), payload),
  appStop: (payload: AppStopPayload) =>
    crewEffect(K.appStop, crewLanes.host(payload.host), payload),
  deployPoll: (payload: DeployPollPayload) =>
    crewEffect(K.deployPoll, crewLanes.host(payload.host), payload),
  deliver: (payload: DeliverPayload) =>
    crewEffect(K.deliver, crewLanes.deliver(payload.handle), payload),
} as const;

export * from "./appRun.ts";
export * from "./appStop.ts";
export * from "./check.ts";
export * from "./checkpoint.ts";
export * from "./claimRead.ts";
export * from "./deliver.ts";
export * from "./deployPoll.ts";
export * from "./inspect.ts";
export * from "./land.ts";
export * from "./laneCreate.ts";
export * from "./laneReset.ts";
export * from "./mergeIn.ts";
export * from "./recover.ts";
export * from "./shared.ts";
export * from "./sweep.ts";
