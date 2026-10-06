// @effect-diagnostics nodeBuiltinImport:off -- stream tickets use the system CSPRNG.
/** One organization socket multiplexes revisioned scopes; segment rotation resumes each scope. */
import * as NodeCrypto from "node:crypto";
import { HQ_STREAM_SEGMENT_CLOSE, HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";
import { HqScopes, type ScopeOutput } from "./hqScopes.ts";

export interface StreamOptions {
  readonly recheck?: Duration.Duration;
  readonly pingEvery?: Duration.Duration;
  readonly build?: string;
}
export type Ending = "session" | "lead";
type Outgoing = ScopeOutput | { readonly type: "end"; readonly ending: Ending };
const L7_SEGMENT_LIMIT = Duration.seconds(100);
const CLOSE = {
  session: [4401, "session ended"],
  lead: [1001, "going away"],
  unreadable: [1011, "the view could not be read"],
  silent: [4408, "no pong"],
} as const;
const readRequest = Schema.decodeUnknownOption(Schema.fromJsonString(HqStreamRequest));
const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** The hub belongs to the Core; reconnecting a socket never destroys its scope journals. */
export const serveHqSocket = <R>(
  socket: Socket.Socket,
  userId: string,
  ending: Effect.Effect<Ending | undefined, never, R>,
  options: StreamOptions,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* (yield* HqScopes).open(userId);
      const checks = Stream.fromEffectSchedule(
        ending,
        Schedule.spaced(options.recheck ?? Duration.seconds(30)),
      ).pipe(
        Stream.filter((ending) => ending !== undefined),
        Stream.map((ending): Outgoing => ({ type: "end", ending })),
      );
      const requests = yield* Queue.unbounded<HqStreamRequest>();
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(requests), (request) =>
          Effect.forkScoped(connection.request(request), { startImmediately: true }).pipe(
            Effect.asVoid,
          ),
        ),
      );
      return yield* serveStructureSocket(
        socket,
        Stream.merge(connection.messages, checks),
        options.pingEvery ?? Duration.seconds(20),
        (request) => Queue.offer(requests, request).pipe(Effect.asVoid),
      );
    }),
  );

export class LiveSockets extends Context.Service<
  LiveSockets,
  {
    /** Registers an open socket's close for the scope's lifetime. */
    readonly track: (
      close: (code: number, reason: string) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Closes every open socket: on shutdown, `1001` sends each client to the next Core. */
    readonly closeAll: (code: number, reason: string) => Effect.Effect<void>;
  }
>()("@t3tools/hq/stream/LiveSockets") {}

export const liveSocketsLayer = Layer.sync(LiveSockets, () => {
  const open = new Set<(code: number, reason: string) => Effect.Effect<void>>();
  return LiveSockets.of({
    track: (close) =>
      Effect.acquireRelease(
        Effect.sync(() => open.add(close)),
        () => Effect.sync(() => open.delete(close)),
      ),
    closeAll: (code, reason) =>
      Effect.forEach([...open], (close) => close(code, reason), { discard: true }),
  });
});

/** Who ended a socket, and with what code: a cut on the way reaches HQ as the client's `1006`. */
export interface SocketEnding {
  readonly by: "client" | "hq";
  readonly code: number;
}

/**
 * Keeps how a socket ends, the first ending winning: `close` sends HQ's close as HQ's ending, and
 * `heardClose` takes a failed read as the client's, with its close's code. `ending` is either, or
 * HQ's `1000` where what it served simply ran out.
 */
export const socketEnding = (writer: Socket.Writer) =>
  Effect.map(Ref.make<SocketEnding | undefined>(undefined), (ended) => {
    const endBy = (ending: SocketEnding) => Ref.update(ended, (held) => held ?? ending);
    return {
      close: (code: number, reason: string) =>
        Effect.andThen(
          endBy({ by: "hq", code }),
          writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore),
        ),
      heardClose: (error: Socket.SocketError) =>
        endBy({
          by: "client",
          code: error.reason._tag === "SocketCloseError" ? error.reason.code : 1006,
        }),
      ending: Effect.map(Ref.get(ended), (held): SocketEnding => held ?? { by: "hq", code: 1000 }),
    };
  });

/**
 * Serves `messages` on `socket` with the ping and the close codes above, until either side ends;
 * says which side ended it.
 */
export const serveStructureSocket = <E, R>(
  socket: Socket.Socket,
  messages: Stream.Stream<Outgoing, E, R>,
  pingEvery: Duration.Duration,
  onRequest: (request: HqStreamRequest) => Effect.Effect<void> = () => Effect.void,
): Effect.Effect<SocketEnding, Socket.SocketError, LiveSockets | R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      const pull = yield* Socket.readerString(socket);
      const ends = yield* socketEnding(writer);
      const close = ([code, reason]: readonly [number, string]) => ends.close(code, reason);
      yield* (yield* LiveSockets).track(ends.close);
      const heard = yield* Ref.make(yield* Clock.currentTimeMillis);
      const listen = Effect.forever(
        Effect.gen(function* () {
          const frames = yield* pull;
          yield* Ref.set(heard, yield* Clock.currentTimeMillis);
          for (const frame of frames) {
            const request = readRequest(frame);
            if (Option.isNone(request)) return yield* close([1007, "invalid scope request"]);
            yield* onRequest(request.value);
          }
        }),
      ).pipe(Effect.catch(ends.heardClose));
      const ping = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(pingEvery);
          const silentFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(heard));
          if (silentFor > 3 * Duration.toMillis(pingEvery)) return yield* close(CLOSE.silent);
          yield* writer.write(toJson({ type: "ping" }));
        }
      }).pipe(Effect.ignore);
      const deliver = Stream.runForEach(messages, (message) =>
        message.type === "end" ? close(CLOSE[message.ending]) : writer.write(toJson(message)),
      ).pipe(Effect.catch(() => close(CLOSE.unreadable)));
      const segment = Effect.andThen(
        Effect.sleep(L7_SEGMENT_LIMIT),
        ends.close(HQ_STREAM_SEGMENT_CLOSE.code, HQ_STREAM_SEGMENT_CLOSE.reason),
      );
      yield* Effect.raceAll([listen, ping, deliver, segment]);
      return yield* ends.ending;
    }),
  );

/** One-use tickets for a socket a client opens without headers: 60 s, held in this Core's memory. */
export interface Tickets {
  /** A ticket for `holder` (a person's session, a Mate's credential). */
  readonly mint: (holder: string) => Effect.Effect<{ readonly ticket: string }>;
  /** The holder a live, unused ticket was minted for; the ticket is spent. */
  readonly take: (ticket: string) => Effect.Effect<Option.Option<string>>;
}

/** Tickets for a person's structure socket, minted for their session. */
export class StreamTickets extends Context.Service<StreamTickets, Tickets>()(
  "@t3tools/hq/stream/StreamTickets",
) {}

/** Tickets for a Mate's link, minted for its credential (`link.ts`). */
export class MateLinkTickets extends Context.Service<MateLinkTickets, Tickets>()(
  "@t3tools/hq/stream/MateLinkTickets",
) {}

const TICKET_TTL_MS = 60_000;

const makeTickets = (): Tickets => {
  const tickets = new Map<string, { readonly holder: string; readonly until: number }>();
  const hashOf = (ticket: string) => NodeCrypto.createHash("sha256").update(ticket).digest("hex");
  return {
    mint: (holder) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        for (const [key, entry] of tickets) if (entry.until <= now) tickets.delete(key);
        const ticket = NodeCrypto.randomBytes(32).toString("base64url");
        tickets.set(hashOf(ticket), { holder, until: now + TICKET_TTL_MS });
        return { ticket };
      }),
    take: (ticket) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const entry = tickets.get(hashOf(ticket));
        tickets.delete(hashOf(ticket));
        return entry !== undefined && entry.until > now ? Option.some(entry.holder) : Option.none();
      }),
  };
};

export const streamTicketsLayer = Layer.sync(StreamTickets, makeTickets);
export const mateLinkTicketsLayer = Layer.sync(MateLinkTickets, makeTickets);
