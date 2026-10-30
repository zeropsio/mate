/**
 * The HQ wire over today's HQ client: each segment a socket opened with a fresh ticket for the
 * session (`HqApi.openScopeSocket`), begun once the socket is open. HQ's planned segment end
 * (`4410`) ends the segment's messages; any other ending, and a ticket HQ would not mint, fails
 * them with its class.
 *
 * @module data/adapters/hqWire
 */
import { HQ_STREAM_SEGMENT_CLOSE, HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
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
    return {
      outcome: "transient",
      message,
      ...(cause instanceof HqError && cause.problems !== undefined
        ? { problems: cause.problems }
        : {}),
    };
  return {
    outcome: "definitive-refusal",
    message:
      cause.code === "session_required"
        ? "HQ refused the renewed session. Try again, or sign in to Zerops again."
        : message,
    code: cause.code,
    ...(cause.problems === undefined ? {} : { problems: cause.problems }),
  };
}

export function makeHqWire(
  api: Pick<HqApi, "openScopeSocket"> &
    Partial<
      Pick<
        HqApi,
        "changeAttachment" | "changeMetadata" | "changeCommits" | "changeVerdict" | "reviewRelease"
      >
    >,
): HqWire {
  return {
    ...(api.reviewRelease === undefined
      ? {}
      : {
          releaseReview: (input: import("../families/hqReleaseReview.ts").ReleaseReviewRequest) =>
            Effect.tryPromise({
              try: (signal) => api.reviewRelease!(input.appId, input.request, signal),
              catch: classifyHqCall,
            }),
        }),
    ...(api.changeAttachment === undefined
      ? {}
      : {
          picture: (link: Parameters<HqApi["changeAttachment"]>[0]) =>
            Effect.tryPromise({
              try: (signal) => api.changeAttachment!(link, signal),
              catch: classifyHqCall,
            }),
        }),
    ...(api.changeMetadata === undefined
      ? {}
      : {
          metadata: (request: import("../families/hqChangeRead.ts").ChangeReadRequest) =>
            Effect.tryPromise({
              try: (signal) => api.changeMetadata!(request.link, signal),
              catch: (cause) => ({
                ...classifyHqCall(cause),
                ...(cause instanceof HqError && cause.code === "change_not_found"
                  ? { code: "not_found" }
                  : {}),
              }),
            }),
        }),
    ...(api.changeCommits === undefined
      ? {}
      : {
          commits: (request: import("../families/hqChangeRead.ts").ChangeReadRequest) =>
            Effect.tryPromise({
              try: (signal) => api.changeCommits!(request.link, signal, request.snapshot),
              catch: (cause) => ({
                ...classifyHqCall(cause),
                ...(cause instanceof HqError && cause.code === "change_not_found"
                  ? { code: "not_found" }
                  : {}),
              }),
            }),
        }),
    ...(api.changeVerdict === undefined
      ? {}
      : {
          verdict: (request: import("../families/hqChangeRead.ts").ChangeReadRequest) =>
            Effect.tryPromise({
              try: (signal) => api.changeVerdict!(request.link, signal, request.snapshot),
              catch: (cause) => ({
                ...classifyHqCall(cause),
                ...(cause instanceof HqError && cause.code === "change_not_found"
                  ? { code: "not_found" }
                  : {}),
              }),
            }),
        }),
    open: (socketCreated) =>
      Effect.gen(function* () {
        const messages = yield* Queue.unbounded<string, StreamFault | Cause.Done>();
        const opened = Deferred.makeUnsafe<void, StreamFault>();
        const socket = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: (signal) =>
              api.openScopeSocket(
                {
                  open: () => void Deferred.doneUnsafe(opened, Effect.void),
                  message: (data) => void Queue.offerUnsafe(messages, data),
                  close: (code) => {
                    const fault = classifyHqClose(code);
                    Deferred.doneUnsafe(opened, Effect.fail(fault));
                    if (code === HQ_STREAM_SEGMENT_CLOSE.code) Queue.endUnsafe(messages);
                    else Queue.failCauseUnsafe(messages, Cause.fail(fault));
                  },
                },
                signal,
              ),
            catch: classifyHqCall,
          }),
          (held) => Effect.sync(() => held.close()),
        );
        yield* socketCreated;
        yield* Deferred.await(opened);
        return {
          messages: Stream.fromQueue(messages),
          send: (request) => Effect.sync(() => socket.send(encodeRequest(request))),
        };
      }),
  };
}
