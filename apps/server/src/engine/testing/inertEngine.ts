/**
 * A test double of the Mate engine that runs nothing and serves nothing: for a graft's test that
 * only needs the service present, spread and overridden where the test reads the engine.
 *
 * @module engine/testing/inertEngine
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { EngineWireError, type EngineUnserved } from "@t3tools/contracts";

import { MateEngine, WakeRefused, type MateEngineService } from "../MateEngine.ts";
import type { EngineWireShape } from "../wire/EngineWire.ts";

const NOT_RUNNING = "The Mate engine is not running here.";

const unserved: EngineUnserved = {
  type: "unserved",
  reason: "not-on-engine",
  protocols: [],
  message: NOT_RUNNING,
};
const refused = () => Effect.succeed({ _tag: "Unserved" as const, unserved });

/** A wire that answers every read and call unserved. */
export const unservedWire: EngineWireShape = {
  readArchived: () => Effect.fail(new EngineWireError({ message: NOT_RUNNING })),
  subscribe: () => Stream.make(unserved),
  subscribeRows: () => Stream.make(unserved),
  readEarlier: refused,
  readRun: refused,
  readDetail: refused,
  receipt: refused,
  recordPageHeight: refused,
  send: refused,
  stop: refused,
  continue: refused,
  answer: refused,
  dismiss: refused,
  steer: refused,
  switchModel: refused,
  setArchived: refused,
  setRuntimeMode: refused,
  assignAgent: refused,
};

export const inertMateEngine: MateEngineService = {
  start: () => Effect.void,
  conversations: Effect.succeed({ views: [], unread: [], complete: true }),
  leases: Effect.succeed({ leases: [], complete: true }),
  conversation: () => Effect.succeed(undefined),
  assetContext: () => Effect.succeed(undefined),
  changes: Stream.empty,
  stopSessionsOn: () => Effect.void,
  wake: () => Effect.fail(new WakeRefused({ message: NOT_RUNNING })),
  runOutcome: () => Effect.succeed(undefined),
  assignAgent: () => Effect.succeed(false),
  importHistory: () => Effect.succeed(0),
  holdSends: Effect.succeed(Effect.void),
  callProgress: () => Effect.void,
  callData: () => Effect.succeed([]),
  runOf: () => Effect.succeed(undefined),
  deliver: () =>
    Effect.succeed({
      _tag: "Rejected",
      rejection: { reason: "unknown", detail: NOT_RUNNING },
    }),
  eventsAfter: () => Effect.succeed([]),
  owner: () => Option.none(),
  generation: () => Effect.succeed(undefined),
  wire: unservedWire,
};

export const engineLayerInert = Layer.succeed(MateEngine, MateEngine.of(inertMateEngine));
