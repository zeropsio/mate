/**
 * A window for a streaming RPC: its chunks leave ahead of the client's acknowledgements while what
 * is sent and not yet acknowledged stays inside the window, so a chunk no longer costs a round
 * trip. Effect RPC's own server sends a chunk and waits for its `Ack`; here a chunk sent inside the
 * window is acknowledged to that server at once, and the client's own `Ack`s are counted instead:
 * one is handed on only when it brings a full window back under its limit, which is what lets the
 * waiting stream go on. The client acknowledges as it always did, and is sent the same chunks in
 * the same order.
 *
 * @module RpcStreamWindow
 */
import * as Effect from "effect/Effect";
import type { RpcServer } from "effect/rpc";

export interface StreamWindow {
  /** Chunks sent and not yet acknowledged at which the next one waits. */
  readonly chunks: number;
  /** The same in bytes of the chunks as sent. */
  readonly bytes: number;
  /**
   * Whether the window ends with this chunk (its values as sent). From that chunk on the stream
   * goes as one without a window: a chunk leaves once the client has acknowledged every chunk
   * before it. Without it the window holds for the stream's life.
   */
  readonly endsWith?: (values: ReadonlyArray<unknown>) => boolean;
}

/** The streaming RPCs that have a window, by method. */
export type StreamWindows = Readonly<Record<string, StreamWindow>>;

/** A stream's window and the sizes of its chunks the client has not acknowledged, oldest first. */
interface Flight {
  window: StreamWindow | null;
  readonly sizes: number[];
}

const isFull = ({ window, sizes }: Flight) =>
  window === null
    ? sizes.length > 0
    : sizes.length >= window.chunks ||
      sizes.reduce((total, size) => total + size, 0) >= window.bytes;

export function withStreamWindows(
  protocol: RpcServer.Protocol["Service"],
  windows: StreamWindows,
): RpcServer.Protocol["Service"] {
  const flights = new Map<string, Flight>();
  let receive: Parameters<RpcServer.Protocol["Service"]["run"]>[0];
  return {
    ...protocol,
    run: (write) => {
      receive = write;
      return protocol.run((clientId, message) =>
        Effect.suspend(() => {
          if (message._tag === "Request") {
            const window = Object.hasOwn(windows, message.tag) ? windows[message.tag] : undefined;
            const key = `${clientId}:${message.id}`;
            if (window !== undefined && !flights.has(key)) flights.set(key, { window, sizes: [] });
          } else if (message._tag === "Ack") {
            const flight = flights.get(`${clientId}:${message.requestId}`);
            if (flight) {
              const wasFull = isFull(flight);
              flight.sizes.shift();
              if (!wasFull || isFull(flight)) return Effect.void;
            }
          }
          return write(clientId, message);
        }),
      );
    },
    send: (clientId, response, transferables) =>
      Effect.suspend(() => {
        const send = protocol.send(clientId, response, transferables);
        if (response._tag === "Exit") {
          flights.delete(`${clientId}:${response.requestId}`);
        } else if (response._tag === "Chunk") {
          const flight = flights.get(`${clientId}:${response.requestId}`);
          if (flight) {
            if (flight.window?.endsWith?.(response.values) === true) flight.window = null;
            flight.sizes.push(
              flight.window === null
                ? 0
                : // @effect-diagnostics-next-line globalJsonInEffect:off
                  Buffer.byteLength(JSON.stringify(response)),
            );
            if (!isFull(flight)) {
              return send.pipe(
                Effect.andThen(() =>
                  receive(clientId, {
                    _tag: "Ack",
                    requestId: response.requestId,
                  }),
                ),
              );
            }
          }
        }
        return send;
      }),
  };
}
