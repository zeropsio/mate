import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { makeZeropsHqLink, type LinkSocket } from "./ZeropsHqLink.ts";
import { make, requestWithMateKey, ZeropsMateKey } from "./ZeropsMateKey.ts";
import * as ZeropsOrgRead from "./ZeropsOrgRead.ts";
import * as ZeropsRestartRead from "./ZeropsRestartRead.ts";

const decode = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

class Socket implements LinkSocket {
  readonly sent: unknown[] = [];
  readonly listeners = new Map<
    string,
    ((event: { data: unknown; code: number; reason: unknown }) => void)[]
  >();
  closed = false;
  failRefusal = false;
  send(data: string) {
    if (this.failRefusal && data.includes("key-refused")) throw new Error("socket closed");
    this.sent.push(decode(data));
  }
  close() {
    this.closed = true;
  }
  family() {
    return "IPv6" as const;
  }
  addEventListener(
    type: string,
    listener: (event: { data: unknown; code: number; reason: unknown }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  open() {
    for (const listener of this.listeners.get("open") ?? [])
      listener({ data: undefined, code: 1006, reason: "" });
  }
  hearState() {
    const mate = {
      projectId: "P_MATE",
      name: "Ada",
      face: "face-1",
      standupRequestedBy: "owner",
      closedOff: true,
      signers: {},
      appId: null,
      appName: null,
      changes: [],
      chief: null,
    };
    for (const listener of this.listeners.get("message") ?? [])
      listener({ data: JSON.stringify({ type: "state", mate }), code: 1006, reason: "" });
  }
  disconnect() {
    for (const listener of this.listeners.get("close") ?? [])
      listener({ data: undefined, code: 1006, reason: "" });
  }
}

const rig = (open = true) =>
  Effect.gen(function* () {
    let store = '{"ZCP_API_KEY":"old-key"}';
    const storePath = "/test/env-store.json";
    const fs = FileSystem.makeNoop({
      readFileString: () => Effect.sync(() => store),
      writeFileString: (_path, value) =>
        Effect.sync(() => {
          store = value;
        }),
    });
    const reader = yield* make({ fs, storePath, snapshot: undefined });
    const sockets: Socket[] = [];
    const connected = yield* Queue.unbounded<Socket>();
    yield* makeZeropsHqLink({
      hqOrigin: "https://hq.test",
      serviceId: "zcp",
      publicOrigin: "https://mate.test",
      readKey: Effect.andThen(reader.invalidate, reader.read),
      ...(reader.refusal === undefined ? {} : { keyRefusal: reader.refusal }),
      connect: () => {
        const socket = new Socket();
        sockets.push(socket);
        Queue.offerUnsafe(connected, socket);
        return socket;
      },
      overview: Effect.succeed(Option.none()),
      changes: Stream.never,
      attention: Stream.never,
      access: () => Effect.void,
      gitCredential: () => Effect.void,
      gitFingerprint: Effect.succeed(Option.none()),
      reconnectDelaysMs: [20],
    });
    const socket = yield* Queue.take(connected);
    if (open) socket.open();
    yield* TestClock.adjust(Duration.zero);
    return { reader, sockets, connected, fs, storePath };
  });

it.effect("An unchanged key refused by Zerops is reported to HQ in one key-refused frame", () =>
  Effect.gen(function* () {
    const { reader, sockets } = yield* rig();
    const own = yield* ZeropsOrgRead.make.pipe(
      Effect.provideService(ZeropsMateKey, reader),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          assert.equal(request.headers["authorization"], "Bearer old-key");
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response(null, { status: 401 })),
          );
        }),
      ),
    );
    assert.deepStrictEqual(
      yield* own.project({ apiBaseUrl: "https://zerops.test", projectId: "own-project" }),
      { kind: "answered", status: 401, body: undefined },
    );
    yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
    yield* TestClock.adjust(Duration.zero);
    assert.deepStrictEqual(sockets[0]!.sent, [
      { type: "hello", key: "old-key", serviceId: "zcp", origin: "https://mate.test" },
      { type: "key-refused" },
    ]);
  }).pipe(Effect.scoped),
);

it.effect.each([
  {
    title: "An env rotation after a reported refusal keeps the replacement link open",
    rotate: true,
  },
  { title: "A failed key-refused send is retried on the next link", rotate: false },
])("$title", ({ rotate }) =>
  Effect.gen(function* () {
    const { reader, sockets, connected, fs, storePath } = yield* rig();
    sockets[0]!.failRefusal = !rotate;
    yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
    yield* TestClock.adjust(Duration.zero);
    assert.equal(sockets[0]!.sent.length, rotate ? 2 : 1);
    if (rotate) yield* fs.writeFileString(storePath, '{"ZCP_API_KEY":"new-key"}');
    sockets[0]!.disconnect();
    yield* TestClock.adjust(Duration.millis(30));
    yield* TestClock.adjust(Duration.zero);
    assert.equal(sockets.length, 2);
    const next = yield* Queue.take(connected);
    next.open();
    yield* TestClock.adjust(Duration.zero);
    assert.deepStrictEqual(next.sent, [
      {
        type: "hello",
        key: rotate ? "new-key" : "old-key",
        serviceId: "zcp",
        origin: "https://mate.test",
      },
      ...(rotate ? [] : [{ type: "key-refused" }]),
    ]);
    assert.equal(next.closed, false);
    assert.equal(sockets.length, 2);
  }).pipe(Effect.scoped),
);

it.effect.each([
  {
    title: "a key refusal whose send was lost on a closing link is reported again on the next link",
    delivered: false,
  },
  { title: "a key refusal HQ's next state follows is not reported again", delivered: true },
])("$title", ({ delivered }) =>
  Effect.gen(function* () {
    const { reader, sockets, connected } = yield* rig();
    yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
    yield* TestClock.adjust(Duration.zero);
    assert.equal(sockets[0]!.sent.length, 2);
    if (delivered) sockets[0]!.hearState();
    sockets[0]!.disconnect();
    yield* TestClock.adjust(Duration.millis(30));
    yield* TestClock.adjust(Duration.zero);
    const next = yield* Queue.take(connected);
    next.open();
    yield* TestClock.adjust(Duration.zero);
    assert.equal(
      next.sent.filter((frame) => (frame as { type: string }).type === "key-refused").length,
      delivered ? 0 : 1,
    );
  }).pipe(Effect.scoped),
);

it.effect("A refused startup read notifies HQ without repeating the Zerops request", () =>
  Effect.gen(function* () {
    const { reader, sockets, fs } = yield* rig();
    const environment = resolveZeropsEnvironment({ projectId: "own-project", apiHost: undefined })!;
    let requests = 0;
    const http = HttpClient.make((request) => {
      requests++;
      assert.equal(request.headers["authorization"], "Bearer old-key");
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(null, { status: 401 })),
      );
    });
    const result = yield* Effect.gen(function* () {
      const own = yield* ZeropsOrgRead.make;
      const restart = yield* ZeropsRestartRead.make({ serviceId: "zcp" }).pipe(
        Effect.provideService(ZeropsOrgRead.ZeropsOrgRead, own),
      );
      return yield* restart.read.pipe(Effect.result);
    }).pipe(
      Effect.provideService(ZeropsMateKey, reader),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(ServerConfig.ServerConfig, {
        zerops: environment,
      } as ServerConfig.ServerConfig["Service"]),
    );
    assert.equal(result._tag, "Failure");
    assert.equal(requests, 1);
    yield* TestClock.adjust(Duration.zero);
    assert.deepStrictEqual(sockets[0]!.sent, [
      { type: "hello", key: "old-key", serviceId: "zcp", origin: "https://mate.test" },
      { type: "key-refused" },
    ]);
  }).pipe(Effect.scoped),
);

it.effect.each([
  { title: "A resource's 403 does not report the Mate key as refused", status: 403 },
  { title: "A Zerops 5xx does not report the Mate key as refused", status: 503 },
  { title: "A Zerops timeout does not report the Mate key as refused", status: undefined },
])("$title", ({ status }) =>
  Effect.gen(function* () {
    const { reader, sockets } = yield* rig();
    const result = yield* requestWithMateKey(reader, () =>
      status === undefined ? Effect.fail("timeout") : Effect.succeed({ status }),
    ).pipe(Effect.result);
    assert.equal(result._tag, status === undefined ? "Failure" : "Success");
    yield* TestClock.adjust(Duration.zero);
    assert.deepStrictEqual(sockets[0]!.sent, [
      { type: "hello", key: "old-key", serviceId: "zcp", origin: "https://mate.test" },
    ]);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]!.closed, false);
  }).pipe(Effect.scoped),
);

it.effect(
  "A changed key reconnects with the newest env value and a late old-key refusal cannot accuse it",
  () =>
    Effect.gen(function* () {
      const { reader, sockets, connected, fs, storePath } = yield* rig();
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const late = yield* requestWithMateKey(reader, (token) =>
        token === "old-key"
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ status: 401 }),
            )
          : Effect.succeed({ status: 200 }),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* fs.writeFileString(storePath, '{"ZCP_API_KEY":"new-key"}');
      const tried: string[] = [];
      const result = yield* requestWithMateKey(reader, (token) => {
        tried.push(token);
        return Effect.succeed({ status: token === "old-key" ? 401 : 200 });
      });
      assert.deepStrictEqual(tried, ["old-key", "new-key"]);
      assert.equal(result.token, "new-key");
      yield* TestClock.adjust(Duration.zero);
      assert.equal(sockets.length, 2);
      const next = yield* Queue.take(connected);
      next.open();
      yield* TestClock.adjust(Duration.zero);
      assert.equal(sockets[0]!.closed, true);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(late);
      yield* TestClock.adjust(Duration.zero);
      assert.deepStrictEqual(next.sent, [
        { type: "hello", key: "new-key", serviceId: "zcp", origin: "https://mate.test" },
      ]);
      assert.equal(sockets[0]!.sent.length, 1);
      assert.equal(sockets.length, 2);
      assert.equal(next.closed, false);
    }).pipe(Effect.scoped),
);

it.effect(
  "A late old-key response cannot erase a refusal of the current key before the link opens",
  () =>
    Effect.gen(function* () {
      const { reader, sockets, connected, fs, storePath } = yield* rig(false);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const late = yield* requestWithMateKey(reader, (token) =>
        token === "old-key"
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ status: 401 }),
            )
          : Effect.succeed({ status: 200 }),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* fs.writeFileString(storePath, '{"ZCP_API_KEY":"new-key"}');
      yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(late);
      sockets[0]!.open();
      yield* TestClock.adjust(Duration.zero);
      assert.equal(sockets.length, 2);
      const next = yield* Queue.take(connected);
      next.open();
      yield* TestClock.adjust(Duration.zero);
      assert.deepStrictEqual(next.sent, [
        { type: "hello", key: "new-key", serviceId: "zcp", origin: "https://mate.test" },
        { type: "key-refused" },
      ]);
      assert.equal(sockets[0]!.sent.length, 1);
    }).pipe(Effect.scoped),
);
