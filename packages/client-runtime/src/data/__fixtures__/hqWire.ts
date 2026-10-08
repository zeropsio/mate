/**
 * An HQ wire the test drives: each `open` is one segment whose messages the test sends, and every
 * request the client sends on it is recorded, decoded.
 */
import { HqStreamMessage, type HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Cause from "effect/Cause";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { HqWire } from "../adapters/hq.ts";
import type { StreamFault } from "../streamMachine.ts";

const encodeMessage = Schema.encodeSync(Schema.fromJsonString(HqStreamMessage));

export interface HqFixtureWire {
  readonly wire: HqWire;
  /** Every request sent, by segment (1-based) in the order sent. */
  readonly sent: Array<{ readonly segment: number; readonly request: HqStreamRequest }>;
  /** Sends one message on the open segment. */
  readonly send: (message: HqStreamMessage) => Effect.Effect<void>;
  /** Ends the open segment as HQ plans it (`4410`). */
  readonly endSegment: Effect.Effect<void>;
  /** Breaks the open segment with a classified fault. */
  readonly drop: (fault: StreamFault) => Effect.Effect<void>;
  readonly opens: () => number;
  /** The open segment's reader has terminated, including its message handler. */
  readonly closed: Effect.Effect<void>;
}

export function hqFixtureWire(
  options: { readonly open?: () => Effect.Effect<void, StreamFault> } = {},
): HqFixtureWire {
  const sent: Array<{ readonly segment: number; readonly request: HqStreamRequest }> = [];
  let messages: Queue.Queue<string, StreamFault | Cause.Done> | null = null;
  let opens = 0;
  let closed = Deferred.makeUnsafe<void>();
  return {
    closed: Effect.suspend(() => Deferred.await(closed)).pipe(
      Effect.timeout("5 seconds"),
      Effect.orDie,
    ),
    sent,
    opens: () => opens,
    send: (message) =>
      Effect.suspend(() =>
        messages === null
          ? Effect.die("No segment is open.")
          : Effect.asVoid(Queue.offer(messages, encodeMessage(message))),
      ),
    endSegment: Effect.suspend(() =>
      messages === null ? Effect.void : Effect.asVoid(Queue.end(messages)),
    ),
    drop: (fault) =>
      Effect.suspend(() =>
        messages === null ? Effect.void : Effect.asVoid(Queue.fail(messages, fault)),
      ),
    wire: {
      open: Effect.gen(function* () {
        if (options.open !== undefined) yield* options.open();
        opens += 1;
        const segment = opens;
        const queue = yield* Queue.unbounded<string, StreamFault | Cause.Done>();
        messages = queue;
        const finished = Deferred.makeUnsafe<void>();
        closed = finished;
        return {
          messages: Stream.fromQueue(queue).pipe(
            Stream.ensuring(Deferred.succeed(finished, undefined)),
          ),
          send: (request) => Effect.sync(() => void sent.push({ segment, request })),
        };
      }),
    },
  };
}
