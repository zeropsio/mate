// @effect-diagnostics nodeBuiltinImport:off -- a stream ticket is 256 bits from the system's CSPRNG.
/**
 * A caller's structure over a WebSocket (KONCEPT §3 rule 4: the whole state, then changes by key;
 * after a break, the whole state again). JSON messages:
 *
 * - `{ type: "snapshot", ungrouped, apps, changes }` — what `GET /api/structure` answers, and
 *   beside it the changes of every application the caller may read them of, by application id
 *   (`@t3tools/shared/hqChanges` `ChangesSnapshot`);
 * - `{ type: "changes", appId, changes }` — one application's changes as the caller now reads them
 *   (`changes: null` once they no longer may), sent before the structure's own changes of a tick;
 * - `{ type: "change", key, value }` — one application by id as the caller now sees it (`value:
 *   null` once it is gone from their view), or, under the key `ungrouped`, the whole list of the
 *   Mates in no application;
 * - `{ type: "ping" }` every 20 s, so the Zerops L7 (which cuts an idle connection at 60 s) never
 *   sees one; the client answers `{ type: "pong" }`. Any message counts: a client silent through
 *   three pings is closed (4408).
 *
 * The view is computed again after every change of the structure, of a change or of a deploy, and
 * every 30 s; with roles at most 30 s old (`roles.ts`), a role change reaches an open socket within
 * 60 s (SPEC §4). The socket closes
 * with `4401` when the caller's session ends (sign in again), `1001` when this Core stops leading
 * or shuts down (reconnect: another Core leads), `1011` when the view cannot be read (reconnect).
 *
 * A browser cannot set headers on a WebSocket: it opens one with a ticket minted for its session
 * (`POST /api/stream-ticket`): one use, 60 s, held in this Core's memory.
 *
 * @module stream
 */
import * as NodeCrypto from "node:crypto";

import type { ChangesMessage, ChangesSnapshot } from "@t3tools/shared/hqChanges";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { Changes } from "./changes.ts";
import { Deploys } from "./deploys.ts";
import { Recomputes } from "./recomputes.ts";
import { Structure, type StructureRead } from "./structure.ts";
import type { ZeropsError } from "./zerops/api.ts";

export interface StreamOptions {
  readonly recheck?: Duration.Duration;
  readonly pingEvery?: Duration.Duration;
}

/** Why an open view ends: the caller's session, or this Core's lead. */
export type Ending = "session" | "lead";

type Outgoing = StructureMessage | { readonly type: "end"; readonly ending: Ending };

export type StructureMessage =
  | ({ readonly type: "snapshot"; readonly changes: ChangesSnapshot } & StructureRead)
  | ChangesMessage
  | { readonly type: "change"; readonly key: string; readonly value: unknown };

/** The key of the Mates in no application; an application's key is its id, never this. */
const UNGROUPED = "ungrouped";

const CLOSE = {
  session: [4401, "session ended"],
  lead: [1001, "going away"],
  unreadable: [1011, "the view could not be read"],
  silent: [4408, "no pong"],
} as const;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * The messages of `userId`'s view until `ending` says why it ends. Every change of the structure
 * and every `recheck` computes the view again; what differs from the last one sent goes out by key.
 */
export const structureMessages = <R>(
  userId: string,
  ending: Effect.Effect<Ending | undefined, never, R>,
  recheck: Duration.Duration,
): Stream.Stream<Outgoing, SqlError | ZeropsError, Structure | Changes | Deploys | R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const structure = yield* Structure;
      const changes = yield* Changes;
      const deploys = yield* Deploys;
      const sent = yield* Ref.make<
        | {
            readonly structure: ReadonlyMap<string, string>;
            readonly changes: ReadonlyMap<string, string>;
          }
        | undefined
      >(undefined);
      /** The keys whose value differs between what was sent and what is now. */
      const differing = (before: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>) =>
        [...new Set([...before.keys(), ...now.keys()])].filter(
          (key) => before.get(key) !== now.get(key),
        );
      return Stream.merge(
        Stream.merge(structure.changes, changes.changes),
        Stream.merge(deploys.changes, Stream.tick(recheck)),
      ).pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* (): Generator<
            Effect.Effect<unknown, SqlError | ZeropsError, Structure | Changes | R>,
            ReadonlyArray<Outgoing>,
            unknown
          > {
            const ends = yield* ending;
            if (ends !== undefined) return [{ type: "end" as const, ending: ends }];
            yield* (yield* Recomputes).count;
            const view = yield* structure.read(userId);
            const readable = yield* changes.readable(userId);
            const now = {
              structure: new Map([
                [UNGROUPED, toJson(view.ungrouped)],
                ...view.apps.map((app): [string, string] => [app.id, toJson(app)]),
              ]),
              changes: new Map(
                Object.entries(readable).map(([appId, list]): [string, string] => [
                  appId,
                  toJson(list),
                ]),
              ),
            };
            const before = yield* Ref.getAndSet(sent, now);
            if (before === undefined) {
              return [{ type: "snapshot" as const, ...view, changes: readable }];
            }
            return [
              ...differing(before.changes, now.changes).map((appId): Outgoing => ({
                type: "changes",
                appId,
                changes: readable[appId] ?? null,
              })),
              ...differing(before.structure, now.structure).map((key): Outgoing => ({
                type: "change",
                key,
                value:
                  key === UNGROUPED
                    ? view.ungrouped
                    : (view.apps.find((app) => app.id === key) ?? null),
              })),
            ];
          }),
        ),
        Stream.flatMap((batch) => Stream.fromIterable(batch)),
        Stream.takeUntil((message) => message.type === "end"),
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

/** Serves `messages` on `socket` with the ping and the close codes above, until either side ends. */
export const serveStructureSocket = <R>(
  socket: Socket.Socket,
  messages: Stream.Stream<Outgoing, SqlError | ZeropsError, R>,
  pingEvery: Duration.Duration,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      const reader = yield* socket.reader;
      const close = ([code, reason]: readonly [number, string]) =>
        writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore);
      yield* (yield* LiveSockets).track((code, reason) => close([code, reason]));
      const heard = yield* Ref.make(yield* Clock.currentTimeMillis);
      const listen = Effect.forever(
        Effect.andThen(
          reader.pull,
          Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(heard, now)),
        ),
      ).pipe(Effect.ignore);
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
      yield* Effect.raceAll([listen, ping, deliver]);
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
