import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { make, type BrowserSocket, type ConnectSocket } from "./ZeropsBrowserStream.ts";

const decodeJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

type FakeBrowserSocket = BrowserSocket & { readonly sent: string[]; closed: boolean };

/** A fake `BrowserSocket`: `send`/`close` are recorded; `onopen` fires on the next microtask, mirroring a real WebSocket's async handshake. */
const makeFakeSocket = (): FakeBrowserSocket => {
  const socket: FakeBrowserSocket = {
    sent: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data: string) {
      socket.sent.push(data);
    },
    close() {
      socket.closed = true;
      socket.onclose?.();
    },
  };
  return socket;
};

/** `connect` that opens every socket it creates on the next microtask and records every socket it made. */
const fakeConnect = (sockets: Array<FakeBrowserSocket>): ConnectSocket => {
  const connect: ConnectSocket = () => {
    const socket = makeFakeSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.onopen?.());
    return socket;
  };
  return connect;
};

describe("ZeropsBrowserStream", () => {
  it.effect("connects on first subscriber and disconnects on last", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect: fakeConnect(sockets),
        reconnectDelaysMs: [0],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          const events = yield* Stream.takeUntil(
            stream,
            (event) => event.type === "state" && event.status === "live",
          ).pipe(Stream.runCollect);
          const statuses = events.map((event) => (event.type === "state" ? event.status : "frame"));
          expect(statuses).toEqual(["no-browser", "connecting", "live"]);
          expect(sockets.length).toBe(1);
          expect(sockets[0]?.closed).toBe(false);
        }),
      );

      expect(sockets[0]?.closed).toBe(true);
    }),
  );

  it.effect("does not connect twice for a second concurrent subscriber", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect: fakeConnect(sockets),
        reconnectDelaysMs: [0],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* service.subscribe;
          yield* Stream.takeUntil(
            first,
            (event) => event.type === "state" && event.status === "live",
          ).pipe(Stream.runCollect);

          yield* Effect.scoped(
            Effect.gen(function* () {
              const second = yield* service.subscribe;
              yield* Stream.take(second, 1).pipe(Stream.runCollect);
              expect(sockets.length).toBe(1);
            }),
          );

          // The first subscriber is still active — the socket stays open.
          expect(sockets[0]?.closed).toBe(false);
        }),
      );

      expect(sockets[0]?.closed).toBe(true);
    }),
  );

  it.effect("reports no-browser when the port refuses and retries while subscribed", () =>
    Effect.gen(function* () {
      let reads = 0;
      const service = yield* make({
        readStreamPort: Effect.sync(() => {
          reads += 1;
          return undefined;
        }),
        connect: fakeConnect([]),
        reconnectDelaysMs: [0],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          const events = yield* Stream.take(stream, 3).pipe(Stream.runCollect);
          const statuses = events.map((event) => (event.type === "state" ? event.status : "frame"));
          expect(statuses).toEqual(["no-browser", "no-browser", "no-browser"]);
        }),
      );

      expect(reads).toBeGreaterThan(1);
    }),
  );

  it.effect("sendInput is a silent no-op when nothing is connected", () =>
    Effect.gen(function* () {
      const service = yield* make({
        readStreamPort: Effect.succeed(undefined),
        connect: fakeConnect([]),
        reconnectDelaysMs: [0],
      });
      yield* service.sendInput({ kind: "mouse", action: "click", x: 1, y: 2 });
    }),
  );

  it.effect("forwards input to the live daemon connection", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect: fakeConnect(sockets),
        reconnectDelaysMs: [0],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          yield* Stream.takeUntil(
            stream,
            (event) => event.type === "state" && event.status === "live",
          ).pipe(Stream.runCollect);
          yield* service.sendInput({
            kind: "mouse",
            action: "click",
            x: 12,
            y: 34,
            button: "left",
          });
          const sent = sockets[0]?.sent.at(-1);
          expect(sent).toBeDefined();
          expect(decodeJsonString(sent!)).toEqual({
            type: "input_mouse",
            action: "click",
            x: 12,
            y: 34,
            button: "left",
          });
        }),
      );
    }),
  );
});
