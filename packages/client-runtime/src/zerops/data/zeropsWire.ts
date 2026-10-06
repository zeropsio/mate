/**
 * Today's Zerops transport behind the data layer's `ZeropsWire` port: a receiver socket opened with
 * a fresh web-socket login, the platform's greeting awaited, a heartbeat that breaks a silent
 * socket, and the session's REST client for registrations and reads. It only translates and
 * classifies; when to open again is the supervisor's.
 *
 * @module zerops/data/zeropsWire
 */
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { classifyHttp, type ZeropsWire } from "../../data/adapters/zerops.ts";
import type { StreamFault } from "../../data/streamMachine.ts";
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import type { PlatformWatchSocket } from "./platformSocket.ts";

const PUBLIC_WS_PATH = "/api/rest/public/web-socket";
/** Today's heartbeat (`policy.ts`): a ping this often, and a socket whose pong is this late is gone. */
const HEARTBEAT_EVERY_MS = 15_000;
const PONG_DEADLINE_MS = 8_000;

export type ZeropsWireClient = Pick<
  ZeropsApiClient,
  "baseUrl" | "exchangeWebSocketToken" | "requestData" | "renewHeldSession"
>;

const transient = (message: string): StreamFault => ({ outcome: "transient", message });

/** How a failed Zerops request classifies. */
export function zeropsFault(cause: unknown): StreamFault {
  if (!(cause instanceof ZeropsApiError)) return transient(String(cause));
  if (cause.status !== null)
    return classifyHttp(cause.status, cause.retryAfterMs ?? undefined, cause.message);
  switch (cause.kind) {
    case "expired-session":
      return { outcome: "recoverable-session", message: cause.message };
    case "forbidden":
      return { outcome: "authoritative-denial", message: cause.message };
    case "invalid-input":
    case "not-found":
      return { outcome: "definitive-refusal", message: cause.message };
    default:
      return transient(cause.message);
  }
}

/**
 * The session repaired once, as every request repairs it after a 401. A refresh the platform
 * refuses ends the session (`renewHeldSession`) and refuses the link: nothing will repair it until
 * the person signs in again, and nothing retries it.
 */
export const repairZeropsSession = (client: ZeropsWireClient): Effect.Effect<void, StreamFault> =>
  Effect.tryPromise({
    try: () => client.renewHeldSession(),
    catch: (cause) => {
      const fault = zeropsFault(cause);
      return fault.outcome === "recoverable-session"
        ? { outcome: "definitive-refusal", message: fault.message }
        : fault;
    },
  });

const Typed = Schema.fromJsonString(Schema.Struct({ type: Schema.String }));
const decodeTyped = Schema.decodeUnknownOption(Typed);
const PING = Schema.encodeSync(Typed)({ type: "ping" });

/** A frame's `type`, or nothing for one that is not a typed JSON object. */
const typeOf = (data: string): string | undefined => Option.getOrUndefined(decodeTyped(data))?.type;

/**
 * A failed request: its HTTP status where it had one, and how it classifies. The platform answers
 * a read of a project it no longer has `400 projectNotFound`; `status` says 404 for it, the one
 * code that proves a project gone — another `400 <x>NotFound` proves nothing of it.
 */
interface RequestFailure {
  readonly status: number | null;
  readonly fault: StreamFault;
}

/** A fresh receiver id: a random (version 4) UUID, as today's receivers use. */
const receiverId: Effect.Effect<string> = Effect.map(
  Effect.forEach(Array.from({ length: 16 }), () => Random.nextIntBetween(0, 255)),
  (bytes) => {
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
);

/**
 * The code Zerops answers a read of a gone entity with (`400 <entity>NotFound`, measured): only the
 * entity a path reads is proven gone by its own code, never by another's.
 */
const NOT_FOUND_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/project\/[^/?]+$/u, "projectNotFound"],
  [/^\/service-stack\/[^/?]+$/u, "serviceStackNotFound"],
];

const notFoundCodeOf = (path: string): string | undefined =>
  NOT_FOUND_CODES.find(([pattern]) => pattern.test(path))?.[1];

export function makeZeropsWire(options: {
  readonly client: ZeropsWireClient;
  readonly makeSocket?: (url: string) => PlatformWatchSocket;
}): ZeropsWire {
  const { client } = options;
  const makeSocket =
    options.makeSocket ?? ((url: string) => new WebSocket(url) as unknown as PlatformWatchSocket);
  const request = (
    path: string,
    init: { readonly method: "GET" | "POST"; readonly body?: unknown },
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        client.requestData({
          path,
          method: init.method,
          ...(init.body === undefined ? {} : { body: init.body }),
          operationKind: "read",
          signal,
          background: true,
        }),
      catch: (cause): RequestFailure => ({
        status:
          cause instanceof ZeropsApiError
            ? cause.code !== undefined && notFoundCodeOf(path) === cause.code
              ? 404
              : cause.status
            : null,
        fault: zeropsFault(cause),
      }),
    });

  return {
    open: Effect.gen(function* () {
      const id = yield* receiverId;
      const { webSocketToken } = yield* Effect.tryPromise({
        try: (signal) => client.exchangeWebSocketToken(signal),
        catch: zeropsFault,
      });
      const frames = yield* Queue.unbounded<string, StreamFault>();
      const greeted = yield* Deferred.make<void, StreamFault>();
      const pongs = yield* Queue.sliding<void>(1);
      const base = client.baseUrl.replace(/\/+$/, "").replace(/^http/i, "ws");
      const socket = makeSocket(`${base}${PUBLIC_WS_PATH}/${id}/${webSocketToken}`);
      const broken = (message: string) => {
        Deferred.doneUnsafe(greeted, Effect.fail(transient(message)));
        Queue.failCauseUnsafe(frames, Cause.fail(transient(message)));
      };
      socket.onmessage = ({ data }) => {
        if (!Deferred.isDoneUnsafe(greeted)) {
          if (typeOf(data) === "SocketSuccess") Deferred.doneUnsafe(greeted, Effect.void);
          else broken("The receiver's greeting was not SocketSuccess.");
          return;
        }
        if (typeOf(data) === "pong") Queue.offerUnsafe(pongs, undefined);
        else Queue.offerUnsafe(frames, data);
      };
      socket.onclose = () => broken("The receiver's socket closed.");
      socket.onerror = () => broken("The receiver's socket failed.");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          socket.onmessage = null;
          socket.onclose = null;
          socket.onerror = null;
          socket.onopen = null;
          socket.close();
        }),
      );
      yield* Deferred.await(greeted);
      // A socket that stops answering pings is broken even if it never says so.
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            yield* Effect.sleep(HEARTBEAT_EVERY_MS);
            yield* Queue.clear(pongs);
            socket.send(PING);
            const answered = yield* Effect.timeoutOption(Queue.take(pongs), PONG_DEADLINE_MS);
            if (answered._tag === "None") broken("The receiver missed its pong deadline.");
          }),
        ),
      );
      return {
        receiverId: id,
        frames: Stream.fromQueue(frames),
        post: (path, body) =>
          request(path, { method: "POST", body }).pipe(Effect.mapError(({ fault }) => fault)),
        // The owner's answer to "gone or not yours?" is a status, not a failure.
        get: (path) =>
          request(path, { method: "GET" }).pipe(
            Effect.map((body) => ({ status: 200, body })),
            Effect.catch(({ status, fault }) =>
              status === 404 || status === 403
                ? Effect.succeed({ status, body: null })
                : Effect.fail(fault),
            ),
          ),
      };
    }),
  };
}
