// @effect-diagnostics nodeBuiltinImport:off -- receiver ids use Node's UUID generator.
/** Zerops receiver transport under HQ's organization credential. Secrets never become errors. */
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { OperationWire, OperationError } from "./operationWatch.ts";
import { ZeropsRefused, ZeropsUnavailable, type ZeropsError } from "./zerops/api.ts";

const Typed = Schema.fromJsonString(Schema.Struct({ type: Schema.String }));
const typeOf = Schema.decodeUnknownOption(Typed);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Login = Schema.Struct({ webSocketToken: Schema.String });
const decodeLogin = Schema.decodeUnknownEffect(Login);
const isRefused = Schema.is(ZeropsRefused);
const isUnavailable = Schema.is(ZeropsUnavailable);

export function makeOperationWire(options: {
  readonly baseUrl: string;
  readonly credential: Redacted.Redacted;
  readonly fetch?: typeof globalThis.fetch;
  readonly makeSocket?: (url: string) => WebSocket;
}): OperationWire {
  const request = (path: string, method: "GET" | "POST", body?: unknown) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.tryPromise({
        try: async (signal): Promise<unknown> => {
          const response = await (options.fetch ?? globalThis.fetch)(
            `${options.baseUrl.replace(/\/+$/, "")}${path}`,
            {
              method,
              headers: {
                Authorization: `Bearer ${Redacted.value(options.credential)}`,
                "Content-Type": "application/json",
              },
              ...(body === undefined ? {} : { body: encodeJson(body) }),
              signal,
            },
          );
          if (!response.ok) {
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              throw new ZeropsRefused({
                operation: path,
                status: response.status,
                code: "operation_observation_refused",
                reason:
                  response.status === 401
                    ? "unauthorized"
                    : response.status === 403
                      ? "forbidden"
                      : response.status === 404
                        ? "not_found"
                        : "invalid",
              });
            }
            const unavailable = new ZeropsUnavailable({
              operation: path,
              message: "Zerops observation unavailable",
            });
            const hint = response.headers.get("Retry-After");
            if (hint !== null) {
              const seconds = Number(hint);
              const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(hint) - now;
              if (Number.isFinite(delay) && delay >= 0)
                Object.assign(unavailable, { retryAfterMs: delay });
            }
            throw unavailable;
          }
          return response.json();
        },
        catch: (cause): OperationError =>
          isRefused(cause) || isUnavailable(cause)
            ? cause
            : new ZeropsUnavailable({
                operation: path,
                message: "Zerops observation did not answer",
              }),
      }),
    ).pipe(
      Effect.timeoutOption(15_000),
      Effect.flatMap((result) =>
        Option.isSome(result)
          ? Effect.succeed(result.value)
          : Effect.fail(
              new ZeropsUnavailable({
                operation: path,
                message: "Zerops observation did not answer",
              }),
            ),
      ),
    );

  return {
    makeId: NodeCrypto.randomUUID,
    open: Effect.gen(function* () {
      const raw = yield* request("/web-socket/login", "POST", {
        token: Redacted.value(options.credential),
      });
      const login = yield* decodeLogin(raw).pipe(
        Effect.mapError(
          () =>
            new ZeropsUnavailable({ operation: "login", message: "Malformed receiver credential" }),
        ),
      );
      const receiverId = NodeCrypto.randomUUID();
      const queue = yield* Queue.unbounded<string, ZeropsError>();
      const ready = yield* Deferred.make<void, ZeropsError>();
      const pongs = yield* Queue.sliding<void>(1);
      const url = `${options.baseUrl.replace(/\/+$/, "").replace(/^http/i, "ws")}/web-socket/${receiverId}/${login.webSocketToken}`;
      const socket = (options.makeSocket ?? ((url) => new WebSocket(url)))(url);
      const broken = () => {
        const error = new ZeropsUnavailable({
          operation: "socket",
          message: "HQ's operation receiver disconnected",
        });
        Deferred.doneUnsafe(ready, Effect.fail(error));
        Queue.failCauseUnsafe(queue, Cause.fail(error));
      };
      const onMessage = ({ data }: MessageEvent) => {
        const raw = String(data);
        const type = Option.getOrUndefined(typeOf(raw))?.type;
        if (type === "SocketSuccess") Deferred.doneUnsafe(ready, Effect.void);
        else if (type === "pong") Queue.offerUnsafe(pongs, undefined);
        else Queue.offerUnsafe(queue, raw);
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", broken);
      socket.addEventListener("error", broken);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("close", broken);
          socket.removeEventListener("error", broken);
          socket.close();
        }),
      );
      const greeting = yield* Deferred.await(ready).pipe(Effect.timeoutOption(15_000));
      if (Option.isNone(greeting))
        return yield* Effect.fail(
          new ZeropsUnavailable({ operation: "socket", message: "Receiver did not greet" }),
        );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            yield* Effect.sleep(15_000);
            yield* Queue.clear(pongs);
            yield* Effect.sync(() => socket.send('{"type":"ping"}'));
            if (Option.isNone(yield* Queue.take(pongs).pipe(Effect.timeoutOption(8_000))))
              yield* Effect.sync(broken);
          }),
        ),
      );
      return {
        receiverId,
        frames: Stream.fromQueue(queue),
        post: (path, body) => request(path, "POST", body),
        get: (path) => request(path, "GET"),
      };
    }),
  };
}
