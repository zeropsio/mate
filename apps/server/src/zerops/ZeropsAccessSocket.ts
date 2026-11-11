/**
 * ZeropsAccessSocket — the Zerops websocket this Mate keeps its access list live from, opened with
 * its project key (`ZeropsMateKey`). The server's mirror of the browser's receiver
 * (`client-runtime` `zeropsWire.ts`), cut to what the list needs:
 *
 * - `POST /web-socket/login {token}` → `webSocketToken`; the socket at
 *   `/web-socket/{receiverId}/{webSocketToken}` greets with `SocketSuccess` (ZEROPS-069).
 * - Four subscriptions, each an HTTP search carrying the receiver: the own project's
 *   `updateStream` (its `userRoles`, ZEROPS-069, and `tagList` when carried), the organisation's
 *   `client-user` `updateStream`
 *   (org role and status, ZEROPS-070/071) and `listStream` (membership), and the organisation's
 *   `process` `updateStream` (ZEROPS-078; a `projectId` filter answers 400, so the frames are
 *   narrowed to the own project here).
 * - A `ping` every {@link ACCESS_SOCKET_PING_EVERY}; a socket whose pong is later than
 *   {@link ACCESS_SOCKET_PONG_DEADLINE} counts as closed, as the browser's does.
 * - A close reconnects after {@link ACCESS_SOCKET_RECONNECT_DELAYS}, the last repeating; a
 *   connection that reached its subscriptions starts the series again.
 *
 * Each connection that subscribed says `connected` (the list re-reads Zerops then, and so does
 * whoever waits on a process); each frame is decoded to the fields its reader needs and nothing
 * else. The key goes to Zerops only, as a request
 * header and the login body; neither it nor the socket token is logged.
 *
 * @module ZeropsAccessSocket
 */
import * as NodeWS from "@effect/platform-node/NodeWS";
import { readUserRoles } from "@t3tools/shared/mateAccess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import { MEMBER_SEARCH_LIMIT } from "./ZeropsAccessRead.ts";
import { requestWithMateKey, type ZeropsMateKeyReader } from "./ZeropsMateKey.ts";
import { readJson, zeropsPost } from "./zeropsApiRead.ts";

export const ACCESS_SOCKET_PING_EVERY = Duration.seconds(15);
export const ACCESS_SOCKET_PONG_DEADLINE = Duration.seconds(8);
/** The longest a socket may take to greet before it counts as failed. */
export const ACCESS_SOCKET_GREETING_BUDGET = Duration.seconds(15);
/** The waits before each reconnect in a row; the last repeats. */
export const ACCESS_SOCKET_RECONNECT_DELAYS: ReadonlyArray<Duration.Duration> = [
  Duration.seconds(1),
  Duration.seconds(5),
  Duration.seconds(30),
  Duration.seconds(60),
];

/** A member's fields one frame carries; an absent field keeps what the list knew. */
export interface MemberPatch {
  readonly clientUserId: string;
  readonly userId?: string;
  readonly orgRole?: string;
  readonly status?: string;
  readonly canCreateProjects?: boolean;
}

/** What one frame tells the list. */
export type AccessFrame =
  /** The own project's changed fields, each whole when present. */
  | {
      readonly kind: "project";
      readonly overrides?: Readonly<Record<string, string>>;
      readonly tagList?: ReadonlyArray<string>;
    }
  /** Organisation members changed (`upsert`) or left (`remove`, by `clientUserId`). */
  | {
      readonly kind: "members";
      readonly upsert: ReadonlyArray<MemberPatch>;
      readonly remove: ReadonlyArray<string>;
    };

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

export type AccessLiveEvent =
  | ProcessLiveEvent
  | { readonly _tag: "frame"; readonly frame: AccessFrame };

const PROJECT_SUBSCRIPTION = "mate-access-project";
const MEMBERS_SUBSCRIPTION = "mate-access-members";
const MEMBERSHIP_SUBSCRIPTION = "mate-access-membership";
const PROCESS_SUBSCRIPTION = "mate-access-process";

/** The four subscriptions a connection with receiver `receiverId` makes, path and body. */
export const accessSubscriptions = (input: {
  readonly projectId: string;
  readonly clientId: string;
  readonly receiverId: string;
}): ReadonlyArray<{ readonly path: string; readonly body: unknown }> => {
  const inOrg = { name: "clientId", operator: "eq", value: input.clientId };
  const subscription = (subscriptionName: string, wsOutputType: string) => ({
    sort: [],
    limit: MEMBER_SEARCH_LIMIT,
    receiverId: input.receiverId,
    subscriptionName,
    wsOutputType,
    disableOutput: true,
  });
  return [
    {
      path: "/project/search",
      body: {
        search: [inOrg, { name: "id", operator: "in", value: [input.projectId] }],
        ...subscription(PROJECT_SUBSCRIPTION, "updateStream"),
      },
    },
    {
      path: "/client-user/search",
      body: { search: [inOrg], ...subscription(MEMBERS_SUBSCRIPTION, "updateStream") },
    },
    {
      path: "/client-user/search",
      body: { search: [inOrg], ...subscription(MEMBERSHIP_SUBSCRIPTION, "listStream") },
    },
    {
      path: "/process/search",
      body: { search: [inOrg], ...subscription(PROCESS_SUBSCRIPTION, "updateStream") },
    },
  ];
};

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const patchOf = (row: Record<string, unknown>): MemberPatch | undefined => {
  const { id, userId, roleCode, status, canCreateProjects } = row;
  if (typeof id !== "string" || id.length === 0) return undefined;
  return {
    clientUserId: id,
    ...(typeof userId === "string" ? { userId } : {}),
    ...(typeof roleCode === "string" ? { orgRole: roleCode } : {}),
    ...(typeof status === "string" ? { status } : {}),
    ...(typeof canCreateProjects === "boolean" ? { canCreateProjects } : {}),
  };
};

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

/** What a parsed frame tells the list of project `projectId` in organisation `clientId`, if anything. */
export const decodeAccessFrame = (
  parsed: unknown,
  scope: { readonly projectId: string; readonly clientId: string },
): AccessFrame | undefined => {
  const frame = recordOf(parsed);
  if (frame?.["type"] !== "search") return undefined;
  const data = recordOf(frame["data"]) ?? {};
  const rows = (key: string): ReadonlyArray<unknown> => {
    const value = data[key];
    return Array.isArray(value) ? value : [];
  };
  const name = frame["subscriptionName"];
  if (name === PROJECT_SUBSCRIPTION) {
    const own = [...rows("add"), ...rows("update")]
      .map(recordOf)
      .findLast(
        (row) =>
          row?.["id"] === scope.projectId &&
          (Array.isArray(row["userRoles"]) || Array.isArray(row["tagList"])),
      );
    if (own === undefined) return undefined;
    const userRoles = own["userRoles"];
    const tagList = own["tagList"];
    const tagsValid = Array.isArray(tagList) && tagList.every((tag) => typeof tag === "string");
    if (!Array.isArray(userRoles) && !tagsValid) return undefined;
    return {
      kind: "project",
      ...(Array.isArray(userRoles) ? { overrides: readUserRoles(userRoles) } : {}),
      ...(tagsValid ? { tagList } : {}),
    };
  }
  if (name !== MEMBERS_SUBSCRIPTION && name !== MEMBERSHIP_SUBSCRIPTION) return undefined;
  const upsert = [...rows("add"), ...rows("update")].flatMap((value) => {
    const row = recordOf(value);
    if (row === undefined || (row["clientId"] !== undefined && row["clientId"] !== scope.clientId))
      return [];
    const patch = patchOf(row);
    return patch === undefined ? [] : [patch];
  });
  const remove = rows("delete").flatMap((value) => {
    const id = typeof value === "string" ? value : recordOf(value)?.["id"];
    return typeof id === "string" ? [id] : [];
  });
  return upsert.length === 0 && remove.length === 0
    ? undefined
    : { kind: "members", upsert, remove };
};

/** The socket as this module uses it: the `ws` package's, or a test's. */
export interface AccessSocket {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

/** The platform's socket, over the `ws` package as the HQ link's is. */
export const connectAccessSocket = (url: string): AccessSocket =>
  new NodeWS.WebSocket(url) as unknown as AccessSocket;

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
 * The live events of the access list of project `projectId` in organisation `clientId`, and of
 * that project's processes, for as long as the stream is pulled: connected, then frames,
 * reconnecting on every close.
 */
export const accessEvents = (input: {
  readonly apiBaseUrl: string;
  readonly projectId: string;
  readonly clientId: string;
  readonly mateKey: ZeropsMateKeyReader;
  readonly connect: (url: string) => AccessSocket;
}): Stream.Stream<AccessLiveEvent, never, HttpClient.HttpClient> =>
  Stream.callback<AccessLiveEvent, never, HttpClient.HttpClient>((events) =>
    Effect.gen(function* () {
      const base = input.apiBaseUrl.replace(/\/+$/u, "");
      /** A POST with the key; `body` is given the key the request goes with. */
      const post = (path: string, body: (token: string) => unknown) =>
        requestWithMateKey(input.mateKey, (token) =>
          zeropsPost({ url: `${base}${path}`, token, body: body(token) }),
        ).pipe(Effect.map(({ response }) => response));

      /** One connection, until it closes: whether it got as far as its subscriptions. */
      const connection = Effect.gen(function* () {
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
          ACCESS_SOCKET_GREETING_BUDGET,
        );
        if (
          greeting._tag === "None" ||
          greeting.value._tag !== "message" ||
          recordOf(parse(greeting.value.data))?.["type"] !== "SocketSuccess"
        )
          return false;
        for (const subscription of accessSubscriptions({ ...input, receiverId: receiver })) {
          if ((yield* post(subscription.path, () => subscription.body))?.status !== 200)
            return false;
        }
        Queue.offerUnsafe(events, { _tag: "connected" });
        // A socket that stops answering pings is closed even if it never says so.
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              yield* Effect.sleep(ACCESS_SOCKET_PING_EVERY);
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
                ACCESS_SOCKET_PONG_DEADLINE,
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
          if (processes !== undefined) {
            if (processes.length > 0) Queue.offerUnsafe(events, { _tag: "process", processes });
            continue;
          }
          const frame = decodeAccessFrame(parsed, input);
          if (frame !== undefined) Queue.offerUnsafe(events, { _tag: "frame", frame });
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
            const delays = ACCESS_SOCKET_RECONNECT_DELAYS;
            yield* Effect.sleep(delays[Math.min(inARow, delays.length - 1)]!);
            inARow += 1;
          }
        }),
      );
    }),
  );
