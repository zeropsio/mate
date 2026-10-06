/**
 * The HQ wire over today's HQ client: each segment a socket opened with a fresh ticket for the
 * session (`HqApi.openScopeSocket`). HQ's planned segment end (`4410`) ends the segment's
 * messages; any other ending, and a ticket HQ would not mint, fails them with its class.
 *
 * @module data/adapters/hqWire
 */
import { HQ_STREAM_SEGMENT_CLOSE, HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import type { StreamFault } from "../streamMachine.ts";
import { classifyHqClose, type HqWire } from "./hq.ts";

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(HqStreamRequest));

/** How a call HQ failed classifies: its session to repair, its refusal, or an outage. */
export function classifyHqCall(cause: unknown): StreamFault {
  const message = cause instanceof Error ? cause.message : "HQ could not be reached.";
  if (!(cause instanceof HqError) || cause.kind !== "refused")
    return { outcome: "transient", message };
  return cause.code === "session_required"
    ? { outcome: "recoverable-session", message }
    : { outcome: "definitive-refusal", message };
}

export function makeHqWire(
  api: Pick<HqApi, "openScopeSocket"> & Partial<Pick<HqApi, "changeAttachment">>,
): HqWire {
  return {
    ...(api.changeAttachment === undefined
      ? {}
      : {
          picture: (link: Parameters<HqApi["changeAttachment"]>[0]) =>
            Effect.tryPromise({
              try: (signal) => api.changeAttachment!(link, signal),
              catch: classifyHqCall,
            }),
        }),
    open: Effect.gen(function* () {
      const messages = yield* Queue.unbounded<string, StreamFault | Cause.Done>();
      const socket = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: (signal) =>
            api.openScopeSocket(
              {
                message: (data) => void Queue.offerUnsafe(messages, data),
                close: (code) =>
                  void (code === HQ_STREAM_SEGMENT_CLOSE.code
                    ? Queue.endUnsafe(messages)
                    : Queue.failCauseUnsafe(messages, Cause.fail(classifyHqClose(code)))),
              },
              signal,
            ),
          catch: classifyHqCall,
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
      return {
        messages: Stream.fromQueue(messages),
        send: (request) => Effect.sync(() => socket.send(encodeRequest(request))),
      };
    }),
  };
}
