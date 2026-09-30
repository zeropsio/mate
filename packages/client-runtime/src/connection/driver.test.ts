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

/** What the driver asked of the admission, the resolver and the socket, in order. */
function rig(ready: Effect.Effect<void, ConnectionTransientError>) {
  const log: Array<string> = [];
  let letThrough: () => void = () => undefined;
  const giveWay = new AbortController();
  const admission: ConnectionAdmission = {
    prefer: () => undefined,
    admit: (environmentId) => {
      log.push(`admit ${environmentId}`);
      return new Promise<AdmissionTicket>((resolve) => {
        letThrough = () =>
          resolve({
            signal: giveWay.signal,
            settle: (open) => void log.push(`settle ${environmentId} ${open}`),
            close: () => void log.push(`close ${environmentId}`),
          });
      });
    },
  };
  const layer = ConnectionDriver.layer.pipe(
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
                  ready,
                  probe: Effect.void,
                  closed: Effect.never,
                } satisfies RpcSession.RpcSession;
              }),
          }),
        ),
      ),
    ),
  );
  return {
    log,
    admission,
    layer,
    letThrough: () => letThrough(),
    giveWay: () => giveWay.abort(),
  };
}

const settle = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

describe("connection driver admission", () => {
  it.effect(
    "asks for its ticket only once admitted, and settles open when its session is ready",
    () =>
      Effect.gen(function* () {
        const { log, admission, layer, letThrough } = rig(Effect.void);
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
        expect(log).toEqual(["admit environment-1"]);

        letThrough();
        yield* Fiber.join(fiber);
        expect(log).toEqual([
          "admit environment-1",
          "ticket",
          "socket",
          "settle environment-1 true",
        ]);

        yield* Scope.close(scope, Exit.void);
        expect(log.at(-1)).toBe("close environment-1");
      }),
  );

  it.effect("settles closed when its session never gets ready", () =>
    Effect.gen(function* () {
      const failed = new ConnectionTransientError({ reason: "transport", detail: "refused" });
      const { log, admission, layer, letThrough } = rig(Effect.fail(failed));
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
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(log).toEqual([
        "admit environment-1",
        "ticket",
        "socket",
        "settle environment-1 false",
      ]);
    }),
  );

  it.effect("an attempt interrupted while waiting never asks for its ticket", () =>
    Effect.gen(function* () {
      const { log, admission, layer } = rig(Effect.void);
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
      expect(log).toEqual(["admit environment-1"]);
    }),
  );

  it.effect("an attempt told to give way ends and settles closed", () =>
    Effect.gen(function* () {
      const { log, admission, layer, letThrough, giveWay } = rig(Effect.never);
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
      expect(log).toEqual(["admit environment-1", "ticket", "socket"]);

      giveWay();
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(log.at(-1)).toBe("settle environment-1 false");
    }),
  );
});
