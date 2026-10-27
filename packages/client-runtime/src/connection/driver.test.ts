import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  ConnectionAdmissionRef,
  makeConnectionAdmission,
  type AdmissionTicket,
  type ConnectionAdmission,
} from "./admission.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const ENTRY: ConnectionCatalogEntry = { target: TARGET, profile: Option.none() };
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws?wsTicket=test",
  httpAuthorization: null,
  target: TARGET,
};

/** What the driver asked of the resolver, the admission and the socket, in order. */
function rig(session: {
  readonly opened: Effect.Effect<void, ConnectionTransientError>;
  readonly ready: Effect.Effect<void, ConnectionTransientError>;
}) {
  const log: Array<string> = [];
  let letThrough: () => void = () => undefined;
  const giveWay = new AbortController();
  const admission: ConnectionAdmission = {
    prefer: () => undefined,
    hold: () => () => undefined,
    preferred: () => null,
    down: () => () => undefined,
    admit: (environmentId) => {
      log.push(`admit ${environmentId}`);
      return new Promise<AdmissionTicket>((resolve) => {
        letThrough = () =>
          resolve({
            signal: giveWay.signal,
            claim: () => undefined,
            settle: (open) => void log.push(`settle ${environmentId} ${open}`),
            close: () => void log.push(`close ${environmentId}`),
          });
      });
    },
  };
  const layer = driverLayer(log, session);
  return {
    log,
    admission,
    layer,
    letThrough: () => letThrough(),
    giveWay: () => giveWay.abort(),
  };
}

function driverLayer(
  log: Array<string>,
  session: {
    readonly opened: Effect.Effect<void, ConnectionTransientError>;
    readonly ready: Effect.Effect<void, ConnectionTransientError>;
  },
) {
  return ConnectionDriver.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ConnectionResolver.ConnectionResolver,
          ConnectionResolver.ConnectionResolver.of({
            prepare: () => Effect.sync(() => void log.push("ticket")).pipe(Effect.as(PREPARED)),
          }),
        ),
        Layer.succeed(
          RpcSession.RpcSessionFactory,
          RpcSession.RpcSessionFactory.of({
            connect: () =>
              Effect.sync(() => {
                log.push("socket");
                return {
                  client: {} as WsRpcProtocolClient,
                  initialConfig: Effect.die("unused"),
                  subscribeServerConfig: () => {
                    throw new Error("unused");
                  },
                  opened: session.opened,
                  ready: session.ready.pipe(Effect.tap(() => Effect.sync(() => log.push("ready")))),
                  probe: Effect.void,
                  closed: Effect.never,
                } satisfies RpcSession.RpcSession;
              }),
          }),
        ),
      ),
    ),
  );
}

const settle = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

describe("connection driver admission", () => {
  it.effect(
    "waits its turn after its ticket, and gives the turn back once its socket opens, before it synchronizes",
    () =>
      Effect.gen(function* () {
        const { log, admission, layer, letThrough } = rig({
          opened: Effect.void,
          ready: Effect.void,
        });
        const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
        const scope = yield* Scope.make();
        const fiber = yield* driver
          .connect(ENTRY, () => Effect.void)
          .pipe(
            Scope.provide(scope),
            Effect.provideService(ConnectionAdmissionRef, admission),
            Effect.forkChild,
          );
        yield* settle;
        expect(log).toEqual(["ticket", "admit environment-1"]);

        letThrough();
        yield* Fiber.join(fiber);
        expect(log).toEqual([
          "ticket",
          "admit environment-1",
          "socket",
          "settle environment-1 true",
          "ready",
        ]);

        yield* Scope.close(scope, Exit.void);
        expect(log.at(-1)).toBe("close environment-1");
      }),
  );

  it.effect.each([
    { name: "its socket never opens", opened: false },
    { name: "it is told to give way", opened: "never" },
  ] as const)("settles closed when $name", ({ opened }) =>
    Effect.gen(function* () {
      const failed = new ConnectionTransientError({ reason: "transport", detail: "refused" });
      const { log, admission, layer, letThrough, giveWay } = rig({
        opened: opened === false ? Effect.fail(failed) : Effect.never,
        ready: Effect.void,
      });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
      const fiber = yield* driver
        .connect(ENTRY, () => Effect.void)
        .pipe(
          Effect.scoped,
          Effect.provideService(ConnectionAdmissionRef, admission),
          Effect.forkChild,
        );
      yield* settle;
      letThrough();
      yield* settle;
      if (opened === "never") giveWay();
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(log.slice(0, 4)).toEqual([
        "ticket",
        "admit environment-1",
        "socket",
        "settle environment-1 false",
      ]);
    }),
  );

  it.effect("an attempt interrupted while waiting its turn never creates a socket", () =>
    Effect.gen(function* () {
      const { log, admission, layer } = rig({ opened: Effect.void, ready: Effect.void });
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(Effect.provide(layer));
      const fiber = yield* driver
        .connect(ENTRY, () => Effect.void)
        .pipe(
          Effect.scoped,
          Effect.provideService(ConnectionAdmissionRef, admission),
          Effect.forkChild,
        );
      yield* settle;
      yield* Fiber.interrupt(fiber);
      expect(log).toEqual(["ticket", "admit environment-1"]);
    }),
  );

  it.effect.each(Array.from({ length: 12 }, (_, hops) => ({ hops })))(
    "a route reconnect interrupted after $hops hops holds no other Mate",
    ({ hops }) =>
      Effect.gen(function* () {
        const admission = makeConnectionAdmission();
        const OTHER = EnvironmentId.make("environment-2");
        const log: Array<string> = [];
        const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
          Effect.provide(driverLayer(log, { opened: Effect.never, ready: Effect.void })),
        );
        // The route opened once and its socket dropped: it is reconnecting.
        admission.prefer(TARGET.environmentId);
        const first = yield* Effect.promise(() => admission.admit(TARGET.environmentId));
        first.claim();
        first.settle(true);
        first.close();

        const fiber = yield* driver
          .connect(ENTRY, () => Effect.void)
          .pipe(
            Effect.scoped,
            Effect.provideService(ConnectionAdmissionRef, admission),
            Effect.forkChild,
          );
        for (let hop = 0; hop < hops; hop += 1) yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);

        const other = yield* Effect.promise(() =>
          Promise.race([
            admission.admit(OTHER).then(() => "admitted"),
            // @effect-diagnostics-next-line globalTimers:off -- a plain deadline on a plain promise.
            new Promise<string>((resolve) => setTimeout(() => resolve("held"), 50)),
          ]),
        );
        expect(other).toBe("admitted");
      }),
  );
});
