/**
 * A Zerops wire the test drives: each `open` is one receiver whose frames the test pushes, and
 * every request is answered by the test's script and recorded.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { ZeropsWire } from "../adapters/zerops.ts";
import type { StreamFault } from "../streamMachine.ts";

export interface WireRequest {
  readonly method: "POST" | "GET";
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

/** Lets every forked fiber run until it waits on something outside the test. */
export const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 10; turn += 1) yield* Effect.yieldNow;
});

export interface FixtureWire {
  readonly wire: ZeropsWire;
  readonly requests: Array<WireRequest>;
  /** The open receiver's subscription for a registration, by its scope and role. */
  readonly subscription: (path: string, wsOutputType: "listStream" | "updateStream") => string;
  /** Pushes one frame to the open receiver. */
  readonly push: (subscriptionName: string, data: unknown) => Effect.Effect<void>;
  /** Breaks the open receiver's socket. */
  readonly drop: (fault: StreamFault) => Effect.Effect<void>;
  readonly opens: () => number;
}

export function fixtureWire(
  answer: (request: WireRequest) => Effect.Effect<unknown, StreamFault>,
): FixtureWire {
  const requests: WireRequest[] = [];
  let frames: Queue.Queue<unknown, StreamFault> | null = null;
  let opens = 0;
  const subscription = (path: string, wsOutputType: string) => {
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const body = requests[index]?.body;
      if (requests[index]?.path === path && body?.wsOutputType === wsOutputType)
        return String(body.subscriptionName);
    }
    throw new Error(`No ${wsOutputType} registration on ${path}.`);
  };
  return {
    requests,
    subscription,
    opens: () => opens,
    push: (subscriptionName, data) =>
      Effect.suspend(() =>
        frames === null
          ? Effect.die("No receiver is open.")
          : Effect.asVoid(Queue.offer(frames, { type: "search", subscriptionName, data })),
      ),
    drop: (fault) =>
      Effect.suspend(() =>
        frames === null ? Effect.void : Effect.asVoid(Queue.fail(frames, fault)),
      ),
    wire: {
      open: Effect.gen(function* () {
        opens += 1;
        const queue = yield* Queue.unbounded<unknown, StreamFault>();
        frames = queue;
        return {
          receiverId: `receiver-${opens}`,
          frames: Stream.fromQueue(queue),
          post: (path, body) =>
            Effect.suspend(() => {
              const request: WireRequest = { method: "POST", path, body };
              requests.push(request);
              return answer(request);
            }),
          get: (path) =>
            Effect.suspend(() => {
              const request: WireRequest = { method: "GET", path };
              requests.push(request);
              return answer(request) as Effect.Effect<
                { readonly status: number; readonly body: unknown },
                StreamFault
              >;
            }),
        };
      }),
    },
  };
}
