/**
 * ZeropsProjectSocket — the Zerops websocket this Mate hears its own project's processes on,
 * opened with its project key (`ZeropsMateKey`). The server's mirror of the browser's receiver
 * (`client-runtime` `zeropsWire.ts`), cut to what the project feed needs:
 *
 * - `POST /web-socket/login {token}` → `webSocketToken`; the socket at
 *   `/web-socket/{receiverId}/{webSocketToken}` greets with `SocketSuccess` (ZEROPS-069).
 * - One subscription, an HTTP search carrying the receiver: the organisation's `process`
 *   `updateStream` (ZEROPS-078; a `projectId` filter answers 400, so the frames are narrowed to
 *   the own project here). The organisation is asked of the caller before each connection.
 * - A `ping` every {@link PROJECT_SOCKET_PING_EVERY}; a socket whose pong is later than
 *   {@link PROJECT_SOCKET_PONG_DEADLINE} counts as closed, as the browser's does.
 * - A close reconnects after {@link PROJECT_SOCKET_RECONNECT_DELAYS}, the last repeating; a
 *   connection that reached its subscription starts the series again.
 *
 * Each connection that subscribed says `connected` (whoever waits on a process re-reads then);
 * each frame is decoded to the fields its reader needs and nothing else. The key goes to Zerops
 * only, as a request header and the login body; neither it nor the socket token is logged.
 *
 * @module ZeropsProjectSocket
 */
import * as NodeWS from "@effect/platform-node/NodeWS";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import { requestWithMateKey, type ZeropsMateKeyReader } from "./ZeropsMateKey.ts";
import { readJson, zeropsPost } from "./zeropsApiRead.ts";

export const PROJECT_SOCKET_PING_EVERY = Duration.seconds(15);
export const PROJECT_SOCKET_PONG_DEADLINE = Duration.seconds(8);
/** The longest a socket may take to greet before it counts as failed. */
export const PROJECT_SOCKET_GREETING_BUDGET = Duration.seconds(15);
/** The waits before each reconnect in a row; the last repeats. */
export const PROJECT_SOCKET_RECONNECT_DELAYS: ReadonlyArray<Duration.Duration> = [
  Duration.seconds(1),
  Duration.seconds(5),
  Duration.seconds(30),
  Duration.seconds(60),
];

/** A process of the own project as a frame carries it: its id, status and the whole row. */
export interface ProjectProcess {
  readonly id: string;
  readonly status: string;
  readonly row: Readonly<Record<string, unknown>>;
}

/** What a process waiter hears from the socket. */
export type ProcessLiveEvent =
  /** A connection is subscribed: anything before it may have been missed. */
  | { readonly _tag: "connected" }
  | { readonly _tag: "process"; readonly processes: ReadonlyArray<ProjectProcess> };

const PROCESS_SUBSCRIPTION = "mate-project-process";

/** The one subscription a connection with receiver `receiverId` makes, path and body. */
export const processSubscription = (input: {
  readonly clientId: string;
  readonly receiverId: string;
}): { readonly path: string; readonly body: unknown } => ({
  path: "/process/search",
  body: {
    search: [{ name: "clientId", operator: "eq", value: input.clientId }],
    sort: [],
    limit: 200,
    receiverId: input.receiverId,
    subscriptionName: PROCESS_SUBSCRIPTION,
    wsOutputType: "updateStream",
    disableOutput: true,
  },
});

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * The own project's processes a parsed frame names, if it is a process frame: rows of other
 * projects, and rows without an id or status, drop out.
 */
export const decodeProcessFrame = (
  parsed: unknown,
  scope: { readonly projectId: string },
): ReadonlyArray<ProjectProcess> | undefined => {
  const frame = recordOf(parsed);
  if (frame?.["type"] !== "search" || frame["subscriptionName"] !== PROCESS_SUBSCRIPTION)
    return undefined;
  const data = recordOf(frame["data"]) ?? {};
  return ["add", "update"].flatMap((key) => {
    const value = data[key];
    return (Array.isArray(value) ? value : []).flatMap((entry): Array<ProjectProcess> => {
      const row = recordOf(entry);
      const id = row?.["id"];
      const status = row?.["status"];
      return row !== undefined &&
        row["projectId"] === scope.projectId &&
        typeof id === "string" &&
        typeof status === "string"
        ? [{ id, status, row }]
        : [];
    });
  });
};

/** The socket as this module uses it: the `ws` package's, or a test's. */
export interface ProjectSocket {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

/** The platform's socket, over the `ws` package as the HQ link's is. */
export const connectProjectSocket = (url: string): ProjectSocket =>
  new NodeWS.WebSocket(url) as unknown as ProjectSocket;

/** A fresh receiver id: a random (version 4) UUID, as the platform's receivers use. */
const receiverId: Effect.Effect<string> = Effect.map(
  Effect.forEach(Array.from({ length: 16 }), () => Random.nextIntBetween(0, 255)),
  (bytes) => {
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
);

const PING = JSON.stringify({ type: "ping" });

type Inbound = { readonly _tag: "message"; readonly data: unknown } | { readonly _tag: "closed" };

/**
 * The live process events of project `projectId` for as long as the stream is pulled: connected,
 * then frames, reconnecting on every close. Each connection first asks `organisation` for the
 * project's organisation; none fails that connection, which then waits its reconnect delay.
 */
export const processEvents = (input: {
  readonly apiBaseUrl: string;
  readonly projectId: string;
  readonly organisation: Effect.Effect<string | undefined>;
  readonly mateKey: ZeropsMateKeyReader;
  readonly connect: (url: string) => ProjectSocket;
}): Stream.Stream<ProcessLiveEvent, never, HttpClient.HttpClient> =>
  Stream.callback<ProcessLiveEvent, never, HttpClient.HttpClient>((events) =>
    Effect.gen(function* () {
      const base = input.apiBaseUrl.replace(/\/+$/u, "");
      /** A POST with the key; `body` is given the key the request goes with. */
      const post = (path: string, body: (token: string) => unknown) =>
        requestWithMateKey(input.mateKey, (token) =>
          zeropsPost({ url: `${base}${path}`, token, body: body(token) }),
        ).pipe(Effect.map(({ response }) => response));

      /** One connection, until it closes: whether it got as far as its subscriptions. */
      const connection = Effect.gen(function* () {
        const clientId = yield* input.organisation;
        if (clientId === undefined) return false;
        const login = yield* post("/web-socket/login", (token) => ({ token }));
        if (login?.status !== 200) return false;
        const webSocketToken = recordOf(yield* readJson(login))?.["webSocketToken"];
        if (typeof webSocketToken !== "string" || webSocketToken.length === 0) return false;
        const receiver = yield* receiverId;
        const inbound = yield* Queue.unbounded<Inbound>();
        const pongs = yield* Queue.sliding<void>(1);
        const socket = input.connect(
          `${base.replace(/^http/iu, "ws")}/web-socket/${receiver}/${webSocketToken}`,
        );
        socket.onmessage = ({ data }) =>
          Queue.offerUnsafe(inbound, { _tag: "message", data: String(data) });
        socket.onclose = () => Queue.offerUnsafe(inbound, { _tag: "closed" });
        socket.onerror = () => Queue.offerUnsafe(inbound, { _tag: "closed" });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            socket.onmessage = null;
            socket.onclose = null;
            // `onerror` stays: `ws` emits 'error' when closed while still connecting, and an
            // 'error' without a listener is thrown uncaught.
            try {
              socket.close();
            } catch {
              // Gone already.
            }
          }),
        );
        const parse = (data: unknown): unknown => {
          try {
            return JSON.parse(String(data));
          } catch {
            return undefined;
          }
        };
        const greeting = yield* Effect.timeoutOption(
          Queue.take(inbound),
          PROJECT_SOCKET_GREETING_BUDGET,
        );
        if (
          greeting._tag === "None" ||
          greeting.value._tag !== "message" ||
          recordOf(parse(greeting.value.data))?.["type"] !== "SocketSuccess"
        )
          return false;
        const subscription = processSubscription({ clientId, receiverId: receiver });
        if ((yield* post(subscription.path, () => subscription.body))?.status !== 200) return false;
        yield* Effect.logInfo("zerops project feed: subscribed");
        Queue.offerUnsafe(events, { _tag: "connected" });
        // A socket that stops answering pings is closed even if it never says so.
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              yield* Effect.sleep(PROJECT_SOCKET_PING_EVERY);
              yield* Queue.clear(pongs);
              yield* Effect.sync(() => {
                try {
                  socket.send(PING);
                } catch {
                  // A socket going away: its close is on its way.
                }
              });
              const answered = yield* Effect.timeoutOption(
                Queue.take(pongs),
                PROJECT_SOCKET_PONG_DEADLINE,
              );
              if (answered._tag === "None") Queue.offerUnsafe(inbound, { _tag: "closed" });
            }),
          ),
        );
        for (;;) {
          const next = yield* Queue.take(inbound);
          if (next._tag === "closed") return true;
          const parsed = parse(next.data);
          if (recordOf(parsed)?.["type"] === "pong") {
            Queue.offerUnsafe(pongs, undefined);
            continue;
          }
          const processes = decodeProcessFrame(parsed, input);
          if (processes !== undefined && processes.length > 0)
            Queue.offerUnsafe(events, { _tag: "process", processes });
        }
      }).pipe(
        Effect.scoped,
        Effect.catchTags({ ZeropsApiUnavailableError: () => Effect.succeed(false) }),
      );

      yield* Effect.forkScoped(
        Effect.gen(function* () {
          let inARow = 0;
          for (;;) {
            if (yield* connection) inARow = 0;
            const delays = PROJECT_SOCKET_RECONNECT_DELAYS;
            yield* Effect.sleep(delays[Math.min(inARow, delays.length - 1)]!);
            inARow += 1;
          }
        }),
      );
    }),
  );
