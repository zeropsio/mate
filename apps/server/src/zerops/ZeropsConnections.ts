/**
 * Live sockets are the sessions. HQ decides who enters: its ticket names the person's role on the
 * Mate's project as HQ read it at Zerops, and a connection opens at that role and keeps it until a
 * later ticket on the same connection names another. A ticket also needs the admission of the key
 * it came under to be live (`ZeropsHqLink`'s verdict, read with it): once that key is refused,
 * everyone's connections and tickets end. HQ ends a person's connections when their standing
 * changes, by closing their sessions (`close-session`).
 */
import type { MateTicketRole } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { type AdmissionLive, type TicketFrame, ZeropsTicketDoor } from "./ZeropsTicketDoor.ts";

export interface ConnectionIdentity {
  readonly ticket: string;
  readonly connectionId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly role: MateTicketRole;
}
interface ConnectionInput {
  readonly connectionId: string;
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string;
  /** The role the last ticket that named one gave it: what authorization reads. */
  role: MateTicketRole;
  readonly close: Effect.Effect<void>;
}
/** Whose connections end: one HQ session's, all of one person's, or everyone's where the key was refused. */
export type ConnectionSubject =
  | { readonly session: string }
  | { readonly person: string }
  | { readonly everyone: true };
/**
 * What answers HQ's ticket: `ticket-ack`, or nothing at all where the key it came under was
 * refused (`fenced`): the link then closes and HQ answers it not-connected.
 */
export type TicketAnswer = "open" | "fenced";

export class ZeropsConnections extends Context.Service<
  ZeropsConnections,
  {
    /**
     * Takes HQ's ticket in the order the link heard it, with the liveness of the admission it came
     * under, and gives what answers it: kept for its socket, with or without a role. The answer
     * waits on the registry's lock, so the link runs it aside; a ticket whose session closed
     * meanwhile is never kept, and one whose admission died is not answered.
     */
    readonly ticket: (
      frame: TicketFrame,
      live: AdmissionLive,
    ) => Effect.Effect<Effect.Effect<TicketAnswer>>;
    /**
     * Opens a connection for the socket whose first frame presents a held, unused, unexpired
     * ticket that names a role, at that role; a ticket without one opens nothing.
     */
    readonly admit: (
      firstFrame: unknown,
      close: Effect.Effect<void>,
    ) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    /** The open connection `id` and the role it holds now. */
    readonly current: (id: string) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    /**
     * Presents a fresh ticket on the open connection `connectionId`: the seconds it may now stay
     * open, or none. Granted only when the ticket is held, unused and unexpired (the attempt
     * spends it whatever the outcome), names the connection's own person and HQ session, came
     * under a still-live admission, and carries `grantSeconds`. The same session, not only the
     * same person: a session's end closes its connections, and another's ticket would outlive it.
     * A ticket that names a role sets the connection's role; one without leaves it as it is.
     */
    readonly extend: (connectionId: string, ticket: string) => Effect.Effect<Option.Option<number>>;
    /**
     * Every HQ session the Mate holds now, each once: one with a live connection or a kept ticket
     * still unused and unexpired. Read under the lock a ticket moves into its connection under, so
     * a session in that move is held on one side of it.
     */
    readonly heldSessions: Effect.Effect<ReadonlyArray<string>>;
    readonly close: (id: string) => Effect.Effect<void>;
    /**
     * The only way a connection ends for a reason of authority. A session's end also drops its
     * tickets; a person's touches none; everyone's, where the key was refused, drops every
     * ticket, held or waiting.
     *
     * GAP-RIGHTS-4: a connection never sees its person's token revoked; it ends at sign-out, HQ
     * closing its session or a refusal of the Mate's key; see
     * docs/architecture/identity-and-access.md#gap-rights (mate-hq).
     */
    readonly end: (subject: ConnectionSubject) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsConnections") {}

export const make = Effect.gen(function* () {
  const crypto = yield* SecureRandom.SecureRandom;
  const tickets = yield* ZeropsTicketDoor;
  const lock = yield* Semaphore.make(1);
  const connections = new Map<string, ConnectionInput>();
  /** Tickets taken and not yet answered; a closed session drops its own, a refused key all. */
  const pending = new Set<TicketFrame>();
  const current = (id: string) =>
    Effect.sync(() => {
      const connection = connections.get(id);
      return connection === undefined
        ? Option.none<ConnectionIdentity>()
        : Option.some<ConnectionIdentity>({
            ticket: connection.id,
            connectionId: connection.connectionId,
            userId: connection.userId,
            sessionId: connection.sessionId,
            role: connection.role,
          });
    });
  const remove = Effect.fn("ZeropsConnections.remove")(function* (id: string) {
    const connection = connections.get(id);
    connections.delete(id);
    if (connection !== undefined) yield* connection.close;
  });
  const removeWhere = Effect.fn("ZeropsConnections.removeWhere")(function* (
    matches: (connection: ConnectionInput) => boolean,
  ) {
    for (const [id, connection] of connections) if (matches(connection)) yield* remove(id);
  });
  const endPerson = (person: string) => removeWhere((connection) => connection.userId === person);
  const endSession = Effect.fn("ZeropsConnections.endSession")(function* (session: string) {
    yield* tickets.end({ session });
    for (const frame of pending) if (frame.sessionId === session) pending.delete(frame);
    yield* removeWhere((connection) => connection.sessionId === session);
  });
  const endEveryone = Effect.gen(function* () {
    yield* tickets.end({ everyone: true });
    pending.clear();
    yield* removeWhere(() => true);
  });
  return ZeropsConnections.of({
    ticket: (frame, live) =>
      Effect.sync(() => {
        if (!live()) return Effect.succeed<TicketAnswer>("fenced");
        pending.add(frame);
        return lock
          .withPermits(1)(
            Effect.gen(function* () {
              // The key it came under was refused while it waited: neither kept nor answered.
              if (!live()) return "fenced" as const;
              if (pending.has(frame)) yield* tickets.heard(frame, live);
              return "open" as const;
            }),
          )
          .pipe(Effect.ensuring(Effect.sync(() => pending.delete(frame))));
      }),
    admit: (firstFrame, close) =>
      Effect.gen(function* () {
        const ticket = yield* tickets.consume(firstFrame);
        if (Option.isNone(ticket)) return Option.none<ConnectionIdentity>();
        const { ticket: id, userId, sessionId } = ticket.value.identity;
        const role = ticket.value.role;
        // HQ names no role only where Zerops did not answer it: such a ticket extends, never opens.
        if (role === undefined || connections.has(id)) return Option.none<ConnectionIdentity>();
        const connectionId = yield* crypto.uuidV4().pipe(Effect.orDie);
        // Read after the last wait, with no yield before it is registered: a key refused by now
        // ends everyone, whose end waits on this lock and then finds nothing of it to close.
        if (!ticket.value.live()) return Option.none<ConnectionIdentity>();
        connections.set(id, {
          connectionId,
          id,
          userId,
          sessionId,
          role,
          close,
        });
        yield* Effect.logInfo("connection admitted", { connectionId, role });
        return Option.some({ ticket: id, connectionId, userId, sessionId, role });
      }).pipe(lock.withPermits(1)),
    current,
    extend: (connectionId, ticket) =>
      Effect.gen(function* () {
        const connection = Array.from(connections.values()).find(
          (input) => input.connectionId === connectionId,
        );
        const consumed = Option.getOrUndefined(yield* tickets.consume({ ticket }));
        const grantSeconds = consumed?.grantSeconds;
        const refused =
          connection === undefined
            ? "connection not registered"
            : consumed === undefined
              ? "ticket unknown, used or expired"
              : consumed.identity.userId !== connection.userId
                ? "ticket of another person"
                : consumed.identity.sessionId !== connection.sessionId
                  ? "ticket of another HQ session"
                  : !consumed.live()
                    ? "admission no longer live"
                    : grantSeconds === undefined
                      ? "ticket carries no grantSeconds"
                      : undefined;
        if (refused !== undefined || grantSeconds === undefined) {
          yield* Effect.logInfo("connection extension refused", { connectionId, refused });
          return Option.none<number>();
        }
        if (consumed?.role !== undefined && connection !== undefined)
          connection.role = consumed.role;
        yield* Effect.logInfo("connection extended", {
          connectionId,
          grantSeconds,
          role: connection?.role,
        });
        return Option.some(grantSeconds);
      }).pipe(lock.withPermits(1)),
    heldSessions: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const held = new Set(Array.from(connections.values(), (input) => input.sessionId));
          for (const session of yield* tickets.heldSessions(now)) held.add(session);
          return Array.from(held);
        }),
      );
    }),
    close: (id) =>
      Effect.sync(() => {
        connections.delete(id);
      }),
    end: (subject) =>
      ("session" in subject
        ? endSession(subject.session)
        : "person" in subject
          ? endPerson(subject.person)
          : endEveryone
      ).pipe(lock.withPermits(1)),
  });
});
export const layer = Layer.effect(ZeropsConnections, make);
