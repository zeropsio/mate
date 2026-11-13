import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  PROJECT_SOCKET_GREETING_BUDGET,
  type ProcessLiveEvent,
  type ProjectSocket,
  processEvents,
} from "./ZeropsProjectSocket.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";

interface FakeSocket extends ProjectSocket {
  readonly url: string;
  readonly sent: Array<string>;
}

/** A platform that logs the key in and takes every subscription, and the sockets it opened. */
const platform = Effect.gen(function* () {
  const requests: Array<{ line: string; authorization: string | undefined; body: unknown }> = [];
  const sockets: Array<FakeSocket> = [];
  const events = yield* Queue.unbounded<ProcessLiveEvent>();
  const opened = yield* Queue.unbounded<FakeSocket>();
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const path = request.url.replace("https://zerops.test", "");
      requests.push({
        line: `${request.method} ${path}`,
        authorization: request.headers["authorization"],
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined,
      });
      const body = path === "/web-socket/login" ? { webSocketToken: "ws-token" } : {};
      return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body)));
    }),
  );
  yield* processEvents({
    apiBaseUrl: "https://zerops.test",
    projectId: "P_MATE",
    organisation: Effect.succeed("ORG"),
    mateKey: ZeropsMateKeyModule.snapshotOnlyReader("project-key"),
    connect: (url) => {
      const socket: FakeSocket = {
        url,
        sent: [],
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (data) => socket.sent.push(data),
        close: () => undefined,
      };
      sockets.push(socket);
      Queue.offerUnsafe(opened, socket);
      return socket;
    },
  }).pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.forkScoped,
  );
  /** Receipt: the next socket the platform opened (its login answers through a real promise). */
  const nextSocket = Queue.take(opened);
  yield* nextSocket;
  const latest = () => sockets[sockets.length - 1]!;
  const logins = () =>
    requests.filter((request) => request.line === "POST /web-socket/login").length;
  const say = (frame: unknown) =>
    Effect.gen(function* () {
      latest().onmessage?.({ data: JSON.stringify(frame) });
      yield* TestClock.adjust(Duration.zero);
    });
  const close = Effect.gen(function* () {
    latest().onclose?.();
    yield* TestClock.adjust(Duration.zero);
  });
  return { requests, sockets, events, say, close, nextSocket, logins };
});

describe("ZeropsProjectSocket", () => {
  it.effect(
    "The same socket subscribes to its organisation's processes by clientId and hands on only its own project's",
    () =>
      Effect.gen(function* () {
        const { requests, sockets, events, say } = yield* platform;
        yield* say({ type: "SocketSuccess" });
        assert.deepStrictEqual(yield* Queue.take(events), { _tag: "connected" });
        const [, receiverId] =
          /^wss:\/\/zerops\.test\/web-socket\/([0-9a-f-]{36})\//u.exec(sockets[0]!.url) ?? [];
        // ZEROPS-078: a `projectId` filter answers 400; the organisation's is the one there is.
        assert.deepStrictEqual(requests.slice(1), [
          {
            line: "POST /process/search",
            authorization: "Bearer project-key",
            body: {
              search: [{ name: "clientId", operator: "eq", value: "ORG" }],
              sort: [],
              limit: 200,
              receiverId,
              subscriptionName: "mate-project-process",
              wsOutputType: "updateStream",
              disableOutput: true,
            },
          },
        ]);
        const own = { id: "proc-1", status: "FINISHED", projectId: "P_MATE", actionName: "a" };
        const other = { id: "proc-2", status: "RUNNING", projectId: "P_OTHER" };
        yield* say({
          type: "search",
          subscriptionName: "mate-project-process",
          data: { update: [other] },
        });
        yield* say({
          type: "search",
          subscriptionName: "mate-project-process",
          data: { update: [other, own] },
        });
        assert.deepStrictEqual(yield* Queue.take(events), {
          _tag: "process",
          processes: [{ id: "proc-1", status: "FINISHED", row: own }],
        });
        assert.strictEqual(yield* Queue.size(events), 0);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A closed socket reconnects after 1 s, 5 s, 30 s, then every 60 s; one that subscribed starts again at 1 s",
    () =>
      Effect.gen(function* () {
        const { events, say, close, nextSocket, logins } = yield* platform;
        const reconnectsAfter = (wait: Duration.Duration) =>
          Effect.gen(function* () {
            const before = logins();
            yield* close;
            yield* TestClock.adjust(Duration.subtract(wait, Duration.millis(1)));
            assert.strictEqual(logins(), before);
            yield* TestClock.adjust(Duration.millis(1));
            assert.strictEqual(logins(), before + 1);
            yield* nextSocket;
          });
        const subscribed = Effect.gen(function* () {
          yield* say({ type: "SocketSuccess" });
          assert.deepStrictEqual(yield* Queue.take(events), { _tag: "connected" });
        });
        yield* subscribed;
        for (const seconds of [1, 5, 30, 60, 60]) yield* reconnectsAfter(Duration.seconds(seconds));
        yield* subscribed;
        yield* reconnectsAfter(Duration.seconds(1));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "Tearing down the Zerops access socket while it is still connecting never throws: the error listener stays installed through close()",
    () =>
      Effect.gen(function* () {
        const { sockets, nextSocket, logins } = yield* platform;
        // `ws` emits 'error' when closed while connecting; with no listener, Node throws it
        // uncaught. The fake records each close that would have thrown so.
        const unhandled: Array<string> = [];
        const connecting = sockets[0]!;
        connecting.close = () => {
          if (connecting.onerror === null) unhandled.push(connecting.url);
          else connecting.onerror();
        };
        // It never greets: past its budget the connection is torn down while still connecting.
        yield* TestClock.adjust(PROJECT_SOCKET_GREETING_BUDGET);
        assert.deepStrictEqual(unhandled, []);
        yield* TestClock.adjust(Duration.seconds(1));
        assert.strictEqual(logins(), 2);
        yield* nextSocket;
      }).pipe(Effect.scoped),
  );
});
