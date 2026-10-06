import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Socket from "effect/unstable/socket/Socket";
import { liveSocketsLayer, serveHqSocket, serveStructureSocket } from "./stream.ts";
import { HqScopes } from "./hqScopes.ts";
describe("serveStructureSocket: who ended a socket, and with what code", () => {
  /** A socket whose client stays until `closeBy` closes it with a code; it answers every ping. */
  const clientSocket = Effect.gen(function* () {
    const closing = yield* Deferred.make<number>();
    const socket = Socket.make({
      reader: Effect.succeed({
        pull: Effect.flatMap(Deferred.await(closing), (code) =>
          Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code }) })),
        ),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
    });
    return { socket, closeBy: (code: number) => Deferred.succeed(closing, code) };
  });

  it.effect("ends a healthy segment cleanly at 100 seconds, even with pongs", () =>
    Effect.gen(function* () {
      const incoming = yield* Queue.unbounded<readonly [Uint8Array]>();
      const closes: Array<{ code: number; reason: string }> = [];
      const socket = Socket.make({
        reader: Effect.succeed({ pull: Queue.take(incoming), upgrade: () => Effect.void }),
        writer: Effect.succeed({
          write: (frame) =>
            Effect.gen(function* () {
              if (Socket.isCloseEvent(frame))
                closes.push({ code: frame.code, reason: frame.reason ?? "" });
              else yield* Queue.offer(incoming, [new TextEncoder().encode('{"type":"pong"}')]);
            }),
          writeAll: () => Effect.void,
        }),
      });
      const serving = yield* Effect.forkChild(
        serveStructureSocket(socket, Stream.never, Duration.seconds(20)),
      );
      yield* TestClock.adjust("99999 millis");
      assert.deepStrictEqual(closes, []);
      yield* TestClock.adjust("1 millis");
      assert.deepStrictEqual(closes, [{ code: 4410, reason: "segment over" }]);
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "hq", code: 4410 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );

  it.effect("the socket dispatches another scope while a detail request is still reading", () =>
    Effect.gen(function* () {
      const incoming = yield* Queue.unbounded<readonly [Uint8Array]>();
      const detailStarted = yield* Deferred.make<void>();
      const navigationStarted = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const socket = Socket.make({
        reader: Effect.succeed({ pull: Queue.take(incoming), upgrade: () => Effect.void }),
        writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
      });
      const hub = Layer.succeed(HqScopes, {
        open: () =>
          Effect.succeed({
            messages: Stream.never,
            request: (request) =>
              Effect.gen(function* () {
                if (request.type !== "subscribe") return;
                if (request.scopes[0]?.scope.kind === "app-detail") {
                  yield* Deferred.succeed(detailStarted, undefined);
                  yield* Deferred.await(gate);
                } else yield* Deferred.succeed(navigationStarted, undefined);
              }),
          }),
      });
      const serving = yield* Effect.forkChild(
        serveHqSocket(socket, "owner", Effect.succeed(undefined), {}).pipe(Effect.provide(hub)),
      );
      yield* Queue.offer(incoming, [
        new TextEncoder().encode(
          '{"type":"subscribe","scopes":[{"scope":{"kind":"app-detail","appId":"A"}}]}',
        ),
      ]);
      yield* Deferred.await(detailStarted);
      yield* Queue.offer(incoming, [
        new TextEncoder().encode('{"type":"subscribe","scopes":[{"scope":{"kind":"navigation"}}]}'),
      ]);
      yield* Deferred.await(navigationStarted);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.interrupt(serving);
    }).pipe(Effect.provide(liveSocketsLayer)),
  );

  it.effect("the client, with the code its close carried", () =>
    Effect.gen(function* () {
      const { socket, closeBy } = yield* clientSocket;
      const serving = yield* Effect.forkChild(
        serveStructureSocket(socket, Stream.never, Duration.seconds(20)),
      );
      yield* closeBy(1006);
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "client", code: 1006 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );

  it.effect("HQ, with the code it closed with", () =>
    Effect.gen(function* () {
      const { socket } = yield* clientSocket;
      const ended = yield* serveStructureSocket(
        socket,
        Stream.make({ type: "end", ending: "session" } as const),
        Duration.seconds(20),
      );
      assert.deepStrictEqual(ended, { by: "hq", code: 4401 });
    }).pipe(Effect.provide(liveSocketsLayer)),
  );
});
