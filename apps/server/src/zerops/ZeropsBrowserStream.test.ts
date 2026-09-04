import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { make, type BrowserSocket, type ConnectSocket } from "./ZeropsBrowserStream.ts";

const decodeJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

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
      yield* service.sendInput({ kind: "mouse", eventType: "mousePressed", x: 1, y: 2 });
    }),
  );

  it.effect("forwards a mouse press to the live daemon connection, CDP vocabulary verbatim", () =>
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
            eventType: "mousePressed",
            x: 12,
            y: 34,
            button: "left",
            clickCount: 1,
          });
          const sent = sockets[0]?.sent.at(-1);
          expect(sent).toBeDefined();
          expect(decodeJsonString(sent!)).toEqual({
            type: "input_mouse",
            eventType: "mousePressed",
            x: 12,
            y: 34,
            button: "left",
            clickCount: 1,
          });
        }),
      );
    }),
  );

  it.effect(
    "forwards a keyboard event to the live daemon connection, CDP vocabulary verbatim",
    () =>
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
            yield* service.sendInput({ kind: "keyboard", eventType: "keyDown", key: "a" });
            const sent = sockets[0]?.sent.at(-1);
            expect(decodeJsonString(sent!)).toEqual({
              type: "input_keyboard",
              eventType: "keyDown",
              key: "a",
            });
          }),
        );
      }),
  );

  const frameMessage = (seq: number) =>
    encodeJsonUnknown({
      type: "frame",
      seq,
      data: "AAAA",
      metadata: {
        deviceWidth: 1280,
        deviceHeight: 720,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        timestamp: 1785038682238,
      },
    });

  it.effect(
    "relays the daemon's real frame shape (metadata.deviceWidth/deviceHeight/scrollOffset)",
    () =>
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
            // ONE continuous pull: re-invoking Stream.take/runCollect a second
            // time on the same `stream` value re-runs its description from the
            // top (replaying the synthetic initial event) rather than
            // continuing the underlying subscription — the injection has to
            // happen mid-pull, via `tap`, not between two separate run calls.
            const events = yield* stream.pipe(
              Stream.tap((event) =>
                Effect.sync(() => {
                  if (event.type === "state" && event.status === "live") {
                    sockets[0]!.onmessage?.({ data: frameMessage(41) });
                  }
                }),
              ),
              Stream.takeUntil((event) => event.type === "frame"),
              Stream.runCollect,
            );
            expect(events.at(-1)).toEqual({
              type: "frame",
              data: "AAAA",
              width: 1280,
              height: 720,
              scrollX: 0,
              scrollY: 0,
            });
          }),
        );
      }),
  );

  it.effect(
    "forwards the ack only once a subscriber pulls that frame — never eagerly on receipt",
    () =>
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
            yield* stream.pipe(
              Stream.tap((event) =>
                Effect.sync(() => {
                  if (event.type === "state" && event.status === "live") {
                    sockets[0]!.sent.length = 0;
                    // Two frames queued before this subscriber pulls either
                    // one — takeUntil below stops right after the FIRST, so
                    // the second is never pulled and must never be acked.
                    sockets[0]!.onmessage?.({ data: frameMessage(7) });
                    sockets[0]!.onmessage?.({ data: frameMessage(8) });
                  }
                }),
              ),
              Stream.takeUntil((event) => event.type === "frame"),
              Stream.runDrain,
            );

            const ackLines = sockets[0]!.sent
              .map((line) => decodeJsonString(line))
              .filter(
                (message): message is { type: "ack"; seq: number } =>
                  typeof message === "object" &&
                  message !== null &&
                  (message as { type?: unknown }).type === "ack",
              );
            expect(ackLines).toEqual([{ type: "ack", seq: 7 }]);
          }),
        );
      }),
  );

  it.effect("reads the active tab's url/title from a tabs message into the state event", () =>
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
          const events = yield* stream.pipe(
            Stream.tap((event) =>
              Effect.sync(() => {
                if (event.type === "state" && event.status === "live") {
                  sockets[0]!.onmessage?.({
                    data: encodeJsonUnknown({
                      type: "tabs",
                      timestamp: 1,
                      tabs: [
                        {
                          active: false,
                          tabId: "t0",
                          targetId: "x",
                          title: "background",
                          type: "page",
                          url: "https://example.com/background",
                        },
                        {
                          active: true,
                          label: null,
                          tabId: "t1",
                          targetId: "y",
                          title: "weatherdash-26a7.prg1.zerops.app",
                          type: "page",
                          url: "https://weatherdash-26a7.prg1.zerops.app/",
                        },
                      ],
                    }),
                  });
                }
              }),
            ),
            Stream.takeUntil((event) => event.type === "state" && event.url !== undefined),
            Stream.runCollect,
          );
          expect(events.at(-1)).toEqual({
            type: "state",
            status: "live",
            url: "https://weatherdash-26a7.prg1.zerops.app/",
            title: "weatherdash-26a7.prg1.zerops.app",
          });
        }),
      );
    }),
  );

  it.effect("ignores a status message — no state event, no ack, no error", () =>
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
          const events = yield* stream.pipe(
            Stream.tap((event) =>
              Effect.sync(() => {
                if (event.type === "state" && event.status === "live") {
                  sockets[0]!.onmessage?.({
                    data: encodeJsonUnknown({
                      type: "status",
                      connected: true,
                      engine: "chrome",
                      recording: false,
                      screencasting: false,
                      viewportWidth: 1280,
                      viewportHeight: 720,
                    }),
                  });
                  // A real next event (a frame) proves the status message did
                  // not wedge the relay or emit anything of its own.
                  sockets[0]!.onmessage?.({ data: frameMessage(1) });
                }
              }),
            ),
            Stream.takeUntil((event) => event.type === "frame"),
            Stream.runCollect,
          );
          expect(events.at(-1)).toMatchObject({ type: "frame" });
        }),
      );
    }),
  );
});
