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

/** The API renews rejected sessions before returning: its final refusal, or an outage. */
export function classifyHqCall(cause: unknown): StreamFault {
  const message =
    cause instanceof HqError && cause.code === "unreadable"
      ? `${cause.message} Reload Mate to get the current version.`
      : cause instanceof Error
        ? cause.message
        : "HQ could not be reached.";
  if (!(cause instanceof HqError) || cause.kind !== "refused")
    return { outcome: "transient", message };
  return {
    outcome: "definitive-refusal",
    message:
      cause.code === "session_required"
        ? "HQ refused the renewed session. Try again, or sign in to Zerops again."
        : message,
    code: cause.code,
  };
}

export function makeHqWire(
  api: Pick<HqApi, "openScopeSocket"> & Partial<Pick<HqApi, "changeAttachment" | "change">>,
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
    ...(api.change === undefined
      ? {}
      : {
          change: (request: import("../families/hqChangeRead.ts").ChangeReadRequest) =>
            Effect.tryPromise({
              try: (signal) => api.change!(request.link, signal, request.snapshot),
              catch: (cause) => ({
                ...classifyHqCall(cause),
                ...(cause instanceof HqError && cause.status === 404 ? { code: "not_found" } : {}),
              }),
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
