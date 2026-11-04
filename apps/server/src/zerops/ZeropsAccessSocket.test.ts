import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { type AccessLiveEvent, type AccessSocket, accessEvents } from "./ZeropsAccessSocket.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";

interface FakeSocket extends AccessSocket {
  readonly url: string;
  readonly sent: Array<string>;
}

/** A platform that logs the key in and takes every subscription, and the sockets it opened. */
const platform = Effect.gen(function* () {
  const requests: Array<{ line: string; authorization: string | undefined; body: unknown }> = [];
  const sockets: Array<FakeSocket> = [];
  const events = yield* Queue.unbounded<AccessLiveEvent>();
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
  yield* accessEvents({
    apiBaseUrl: "https://zerops.test",
    projectId: "P_MATE",
    clientId: "ORG",
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

describe("ZeropsAccessSocket", () => {
  it.effect(
    "The Mate subscribes with its project key to its own project's userRoles and its organisation's members, and pings every 15 s",
    () =>
      Effect.gen(function* () {
        const { requests, sockets, events, say } = yield* platform;
        assert.deepStrictEqual(requests, [
          {
            line: "POST /web-socket/login",
            authorization: "Bearer project-key",
            body: { token: "project-key" },
          },
        ]);
        const [, receiverId, token] =
          /^wss:\/\/zerops\.test\/web-socket\/([0-9a-f-]{36})\/(.+)$/u.exec(sockets[0]!.url) ?? [];
        assert.strictEqual(token, "ws-token");
        yield* say({ type: "SocketSuccess" });
        assert.deepStrictEqual(yield* Queue.take(events), { _tag: "connected" });
        const subscription = (subscriptionName: string, wsOutputType: string) => ({
          sort: [],
          limit: 200,
          receiverId,
          subscriptionName,
          wsOutputType,
          disableOutput: true,
        });
        const inOrg = { name: "clientId", operator: "eq", value: "ORG" };
        assert.deepStrictEqual(requests.slice(1), [
          {
            line: "POST /project/search",
            authorization: "Bearer project-key",
            body: {
              search: [inOrg, { name: "id", operator: "in", value: ["P_MATE"] }],
              ...subscription("mate-access-project", "updateStream"),
            },
          },
          {
            line: "POST /client-user/search",
            authorization: "Bearer project-key",
            body: { search: [inOrg], ...subscription("mate-access-members", "updateStream") },
          },
          {
            line: "POST /client-user/search",
            authorization: "Bearer project-key",
            body: { search: [inOrg], ...subscription("mate-access-membership", "listStream") },
          },
        ]);
        // ZEROPS-070's frame, with a field the list does not read.
        yield* say({
          type: "search",
          subscriptionName: "mate-access-members",
          data: {
            update: [
              {
                id: "cu-eva",
                roleCode: "NO_ACCESS",
                status: "ACTIVE",
                userId: "eva",
                clientId: "ORG",
                email: "eva@example.com",
              },
            ],
          },
        });
        assert.deepStrictEqual(yield* Queue.take(events), {
          _tag: "frame",
          frame: {
            kind: "members",
            upsert: [
              { clientUserId: "cu-eva", userId: "eva", orgRole: "NO_ACCESS", status: "ACTIVE" },
            ],
            remove: [],
          },
        });
        yield* TestClock.adjust(Duration.seconds(15));
        assert.deepStrictEqual(sockets[0]!.sent, [JSON.stringify({ type: "ping" })]);
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
});
