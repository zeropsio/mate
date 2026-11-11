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

import { makeZeropsHqLink, type LinkSocket } from "./ZeropsHqLink.ts";
import { make, requestWithMateKey, ZeropsMateKey } from "./ZeropsMateKey.ts";
import * as ZeropsAccessRead from "./ZeropsAccessRead.ts";

const decode = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
/** The admission HQ names for the key, and a later one: a new admission, even of the same key. */
const ADMISSION_A = "0b6f3c1e-2d4a-4e5f-8a7b-9c0d1e2f3a4b";
const ADMISSION_B = "7e8f9a0b-1c2d-4e3f-a4b5-c6d7e8f9a0b1";

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
  hearState(admission: string) {
    const mate = {
      projectId: "P_MATE",
      name: "Ada",
      face: "face-1",
      standupRequestedBy: "owner",
      appId: null,
      appName: null,
      changes: [],
      chief: null,
    };
    for (const listener of this.listeners.get("message") ?? [])
      listener({
        data: JSON.stringify({ type: "state", mate, admission }),
        code: 1006,
        reason: "",
      });
  }
  disconnect() {
    for (const listener of this.listeners.get("close") ?? [])
      listener({ data: undefined, code: 1006, reason: "" });
  }
}

const rig = () =>
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
    const reader = yield* make({
      fs,
      storePath,
      snapshot: undefined,
      watch: () => ({ dispose: () => {} }),
    });
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
      gitCredential: () => Effect.void,
      gitFingerprint: Effect.succeed(Option.none()),
      reconnectDelaysMs: [20],
    });
    const socket = yield* Queue.take(connected);
    socket.open();
    yield* TestClock.adjust(Duration.zero);
    return { reader, sockets, connected, fs, storePath };
  });

it.effect("An unchanged key refused by Zerops is reported to HQ in one key-refused frame", () =>
  Effect.gen(function* () {
    const { reader, sockets } = yield* rig();
    sockets[0]!.hearState(ADMISSION_A);
    yield* TestClock.adjust(Duration.zero);
    const own = yield* ZeropsAccessRead.ZeropsAccessRead.pipe(
      Effect.provide(
        ZeropsAccessRead.layer({ apiBaseUrl: "https://zerops.test", projectId: "own-project" }),
      ),
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
    assert.deepStrictEqual(yield* own.read, { kind: "refused", status: 401 });
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
    sockets[0]!.hearState(ADMISSION_A);
    yield* TestClock.adjust(Duration.zero);
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
    next.hearState(rotate ? ADMISSION_B : ADMISSION_A);
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

it.effect(
  "a key refusal whose send was lost on a closing link is reported again on the next link",
  () =>
    Effect.gen(function* () {
      const { reader, sockets, connected } = yield* rig();
      sockets[0]!.hearState(ADMISSION_A);
      yield* TestClock.adjust(Duration.zero);
      yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
      yield* TestClock.adjust(Duration.zero);
      assert.equal(sockets[0]!.sent.length, 2);
      sockets[0]!.disconnect();
      yield* TestClock.adjust(Duration.millis(30));
      yield* TestClock.adjust(Duration.zero);
      const next = yield* Queue.take(connected);
      next.open();
      yield* TestClock.adjust(Duration.zero);
      next.hearState(ADMISSION_A);
      yield* TestClock.adjust(Duration.zero);
      assert.equal(
        next.sent.filter((frame) => (frame as { type: string }).type === "key-refused").length,
        1,
      );
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
      sockets[0]!.hearState(ADMISSION_A);
      yield* TestClock.adjust(Duration.zero);
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
