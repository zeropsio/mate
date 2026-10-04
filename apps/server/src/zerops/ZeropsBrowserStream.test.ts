import { describe, expect, it } from "@effect/vitest";

import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  isConnectionStable,
  make,
  type BrowserSocket,
  type ConnectSocket,
} from "./ZeropsBrowserStream.ts";

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
              pageScaleFactor: 1,
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

  it.effect("an ack or input during reconnect never ends the subscription", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      let throwOnSend = false;
      const connect: ConnectSocket = () => {
        const socket = makeFakeSocket();
        const realSend = socket.send.bind(socket);
        // Mirrors a real Node WebSocket: `send` throws synchronously while
        // the socket is not OPEN (e.g. a stale reference kept past a
        // reconnect, or the daemon's own CONNECTING window).
        socket.send = (data: string) => {
          if (throwOnSend) {
            throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
          }
          realSend(data);
        };
        sockets.push(socket);
        queueMicrotask(() => socket.onopen?.());
        return socket;
      };
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect,
        reconnectDelaysMs: [0],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          const pull = yield* Stream.toPull(stream);

          let live = false;
          while (!live) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "live") live = true;
            }
          }

          throwOnSend = true;
          // A send that throws must not propagate as a defect and kill the
          // subscription — sendInput swallows it (best-effort).
          yield* service.sendInput({ kind: "mouse", eventType: "mousePressed", x: 1, y: 2 });

          // A frame arriving while sends throw: pulling it triggers the
          // (also throwing) daemon ack — the pull itself must still
          // succeed and hand back the frame.
          sockets[0]!.onmessage?.({ data: frameMessage(1) });
          let sawFrame = false;
          while (!sawFrame) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "frame") sawFrame = true;
            }
          }
          expect(sawFrame).toBe(true);

          throwOnSend = false;
          // The subscription is provably still alive afterward.
          sockets[0]!.onmessage?.({ data: frameMessage(2) });
          let sawSecondFrame = false;
          while (!sawSecondFrame) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "frame") sawSecondFrame = true;
            }
          }
          expect(sawSecondFrame).toBe(true);
        }),
      );
    }),
  );

  it.effect(
    "two subscribers, one stalled: the daemon sees one ack per seq and the stalled one holds at most one frame",
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
            const fast = yield* service.subscribe;
            const fastPull = yield* Stream.toPull(fast);
            let fastLive = false;
            while (!fastLive) {
              const chunk = yield* fastPull;
              for (const event of chunk) {
                if (event.type === "state" && event.status === "live") fastLive = true;
              }
            }

            yield* Effect.scoped(
              Effect.gen(function* () {
                const stalled = yield* service.subscribe;
                const stalledPull = yield* Stream.toPull(stalled);
                let stalledLive = false;
                while (!stalledLive) {
                  const chunk = yield* stalledPull;
                  for (const event of chunk) {
                    if (event.type === "state" && event.status === "live") stalledLive = true;
                  }
                }

                sockets[0]!.sent.length = 0;
                sockets[0]!.onmessage?.({ data: frameMessage(1) });
                sockets[0]!.onmessage?.({ data: frameMessage(2) });
                sockets[0]!.onmessage?.({ data: frameMessage(3) });

                // The fast subscriber drains all three — one ack per DISTINCT
                // seq is sent to the daemon as it does.
                let fastFrameCount = 0;
                while (fastFrameCount < 3) {
                  const chunk = yield* fastPull;
                  fastFrameCount += chunk.filter((event) => event.type === "frame").length;
                }

                // The stalled subscriber finally pulls, having never
                // consumed any of the three individually — it must land on
                // exactly the single latest frame, never a backlog of three.
                const stalledChunk = yield* stalledPull;
                const stalledFrames = stalledChunk.filter((event) => event.type === "frame");
                expect(stalledFrames).toHaveLength(1);

                const ackSeqs = sockets[0]!.sent
                  .map((line) => decodeJsonString(line))
                  .filter(
                    (message): message is { type: "ack"; seq: number } =>
                      typeof message === "object" &&
                      message !== null &&
                      (message as { type?: unknown }).type === "ack",
                  )
                  .map((message) => message.seq);
                // One ack per distinct seq — never duplicated across the two
                // subscribers independently pulling the same seq.
                expect(ackSeqs).toEqual([...new Set(ackSeqs)]);
                expect(new Set(ackSeqs)).toEqual(new Set([1, 2, 3]));
              }),
            );
          }),
        );
      }),
  );

  describe("isConnectionStable", () => {
    it("a connection open for less than the threshold never counts as recovered", () => {
      expect(isConnectionStable(0, 5000)).toBe(false);
      expect(isConnectionStable(4999, 5000)).toBe(false);
    });

    it("a connection open for the threshold or more counts as recovered", () => {
      expect(isConnectionStable(5000, 5000)).toBe(true);
      expect(isConnectionStable(10_000, 5000)).toBe(true);
    });
  });

  it.effect(
    "does not reset backoff for a connection that closes before the stability threshold",
    () =>
      Effect.gen(function* () {
        let connectCount = 0;
        const connect: ConnectSocket = () => {
          connectCount += 1;
          const socket = makeFakeSocket();
          queueMicrotask(() => {
            socket.onopen?.();
            queueMicrotask(() => socket.onclose?.());
          });
          return socket;
        };
        const service = yield* make({
          readStreamPort: Effect.succeed(44831),
          connect,
          reconnectDelaysMs: [1000],
          connectionStableThresholdMs: 5000,
        });

        // Lets queued microtasks (the fake socket's open-then-close) and the
        // connection loop's own fiber steps settle, without depending on
        // consuming the subscription's own Stream (whose delivery timing to
        // THIS test fiber is a separate concern from the loop's own
        // progress — the loop runs regardless of whether anyone reads from
        // the unbounded PubSub it publishes to).
        const settle = Effect.gen(function* () {
          for (let i = 0; i < 10; i++) {
            yield* Effect.yieldNow;
          }
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            // Only the subscription's side effect (forking the connection
            // loop) matters here — the returned Stream itself is unused.
            const stream = yield* service.subscribe;
            void stream;

            yield* settle;
            expect(connectCount).toBe(1);

            // The loop is now asleep waiting out the 1000ms backoff before
            // its next attempt. Advancing by less than that must not
            // produce a new connect — proving backoff was never reset to
            // zero by the short-lived connection.
            yield* TestClock.adjust(Duration.millis(500));
            yield* settle;
            expect(connectCount).toBe(1);

            // Advancing past the full delay releases the next attempt.
            yield* TestClock.adjust(Duration.millis(600));
            yield* settle;
            expect(connectCount).toBe(2);
          }),
        );
      }),
  );

  it.effect("resets backoff once a connection stays open past the stability threshold", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect: fakeConnect(sockets),
        reconnectDelaysMs: [1000],
        connectionStableThresholdMs: 5000,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          const pull = yield* Stream.toPull(stream);
          let live = false;
          while (!live) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "live") live = true;
            }
          }
          const openedAt = yield* Clock.currentTimeMillis;

          // Stays open past the threshold, then drops.
          yield* TestClock.adjust(Duration.millis(5001));
          sockets[0]!.onclose?.();

          // No 1000ms backoff wait this time — the very next thing
          // published is a fresh "connecting", available without any
          // further clock advance.
          let connecting = false;
          while (!connecting) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "connecting") connecting = true;
            }
          }
          const reconnectedAt = yield* Clock.currentTimeMillis;
          expect(reconnectedAt - openedAt).toBe(5001);
        }),
      );
    }),
  );

  it.effect("a late subscriber gets the current frame right after the current state", () =>
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
          const firstPull = yield* Stream.toPull(first);
          let live = false;
          while (!live) {
            const chunk = yield* firstPull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "live") live = true;
            }
          }
          // A static page: exactly one frame, no further repaint.
          sockets[0]!.onmessage?.({ data: frameMessage(1) });
          let sawFrame = false;
          while (!sawFrame) {
            const chunk = yield* firstPull;
            for (const event of chunk) {
              if (event.type === "frame") sawFrame = true;
            }
          }

          // A second subscriber joins afterward and must see the SAME
          // frame right after its own initial state — never wait for a
          // repaint that is never coming.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const second = yield* service.subscribe;
              const events = yield* Stream.take(second, 2).pipe(Stream.runCollect);
              expect(events[0]).toMatchObject({ type: "state", status: "live" });
              expect(events[1]).toMatchObject({ type: "frame" });
            }),
          );
        }),
      );
    }),
  );

  it.effect("a daemon whose seq restarts lower after a reconnect is acked again", () =>
    Effect.gen(function* () {
      const sockets: Array<FakeBrowserSocket> = [];
      const service = yield* make({
        readStreamPort: Effect.succeed(44831),
        connect: fakeConnect(sockets),
        reconnectDelaysMs: [0],
      });

      const ackSeqsOf = (socket: FakeBrowserSocket) =>
        socket.sent
          .map((line) => decodeJsonString(line))
          .filter(
            (message): message is { type: "ack"; seq: number } =>
              typeof message === "object" &&
              message !== null &&
              (message as { type?: unknown }).type === "ack",
          );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* service.subscribe;
          const pull = yield* Stream.toPull(stream);

          let live = false;
          while (!live) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "live") live = true;
            }
          }

          // First session: a high seq, acked normally.
          sockets[0]!.onmessage?.({ data: frameMessage(100) });
          let sawFirstFrame = false;
          while (!sawFirstFrame) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "frame") sawFirstFrame = true;
            }
          }
          expect(ackSeqsOf(sockets[0]!)).toEqual([{ type: "ack", seq: 100 }]);

          // The daemon restarts: the connection drops and a fresh one comes
          // up, its own seq counting starting over from a LOW number.
          sockets[0]!.onclose?.();
          let reconnectedLive = false;
          while (!reconnectedLive) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "state" && event.status === "live") reconnectedLive = true;
            }
          }
          expect(sockets.length).toBe(2);

          sockets[1]!.onmessage?.({ data: frameMessage(1) });
          let sawSecondFrame = false;
          while (!sawSecondFrame) {
            const chunk = yield* pull;
            for (const event of chunk) {
              if (event.type === "frame") sawSecondFrame = true;
            }
          }
          // Without resetting `lastAckedSeq` on reconnect, `1 <= 100` would
          // suppress this ack forever and freeze the view.
          expect(ackSeqsOf(sockets[1]!)).toEqual([{ type: "ack", seq: 1 }]);
        }),
      );
    }),
  );

  it.effect(
    "the next first subscriber after everyone leaves never sees the previous session's stale live state or frame",
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
            const pull = yield* Stream.toPull(stream);
            let live = false;
            while (!live) {
              const chunk = yield* pull;
              for (const event of chunk) {
                if (event.type === "state" && event.status === "live") live = true;
              }
            }
            sockets[0]!.onmessage?.({ data: frameMessage(1) });
            let sawFrame = false;
            while (!sawFrame) {
              const chunk = yield* pull;
              for (const event of chunk) {
                if (event.type === "frame") sawFrame = true;
              }
            }
          }),
        );
        // The scope above just closed — the last subscriber left and the
        // finalizer's teardown ran.

        yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* service.subscribe;
            const first = yield* Stream.take(stream, 1).pipe(Stream.runCollect);
            expect(first[0]).toEqual({ type: "state", status: "no-browser" });
          }),
        );
      }),
  );

  it.effect(
    "a resubscribe racing the outgoing unsubscribe never loses or duplicates the connection",
    () =>
      Effect.gen(function* () {
        const sockets: Array<FakeBrowserSocket> = [];
        const service = yield* make({
          readStreamPort: Effect.succeed(44831),
          connect: fakeConnect(sockets),
          reconnectDelaysMs: [0],
        });

        const scopeA = yield* Scope.make();
        const streamA = yield* Effect.provideService(service.subscribe, Scope.Scope, scopeA);
        yield* Stream.takeUntil(
          streamA,
          (event) => event.type === "state" && event.status === "live",
        ).pipe(Stream.runCollect);

        // Force the exact race the fix closes: A's unsubscribe finalizer and
        // B's fresh subscribe run concurrently, so without the shared mutex
        // the finalizer's "remaining === 0 → fork a new loop's fiber" could
        // read B's just-forked fiber instead of A's own.
        const scopeB = yield* Scope.make();
        const closeAFiber = yield* Effect.forkChild(Scope.close(scopeA, Exit.succeed(undefined)));
        const subscribeBFiber = yield* Effect.forkChild(
          Effect.provideService(service.subscribe, Scope.Scope, scopeB),
        );
        yield* Fiber.join(closeAFiber);
        const streamB = yield* Fiber.join(subscribeBFiber);

        const eventsB = yield* Stream.takeUntil(
          streamB,
          (event) => event.type === "state" && event.status === "live",
        ).pipe(Stream.runCollect);
        expect(eventsB.some((event) => event.type === "state" && event.status === "live")).toBe(
          true,
        );
        // At most one extra reconnect from the hand-off — never a runaway
        // leak of parallel connections from the race.
        expect(sockets.length).toBeLessThanOrEqual(3);

        yield* Scope.close(scopeB, Exit.succeed(undefined));
      }),
  );
});
