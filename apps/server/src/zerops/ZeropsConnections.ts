/**
 * Live sockets are the sessions. HQ decides who enters: its ticket names the person's role on the
 * Mate's project as HQ read it at Zerops, and a connection opens at that role and keeps it until a
 * later ticket on the same connection names another. A ticket also needs the admission of the key
 * it came under to be live (`ZeropsHqLink`'s verdict, read with it): once that key is refused,
 * everyone's connections and tickets end. HQ ends a person's connections when their standing
 * changes, by closing their sessions (`close-session`).
 *
 * A connection lives only as long as its grant: until `grantSeconds` after the Mate heard the
 * ticket that opened or last extended it, then it ends (4401) unless a fresh ticket came first, so
 * HQ re-reads the person's role at Zerops at least once per grant. While the Mate's link to HQ is
 * down nothing ends for its grant; when the link returns, a grant that ran out meanwhile or runs out
 * within a minute gets that minute to be extended.
 */
import type { MateTicketRole } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
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
  /** When its grant runs out: the opening or last extending ticket's heard time plus its grant. */
  deadlineMs: number;
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
/** How long a grant that ran out, or runs out soon, still holds once the link to HQ returns. */
const RELINK_GRACE_MS = 60_000;

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
     * ticket that names a role and a grant, at that role, until the grant counted from when the
     * Mate heard the ticket; a ticket without both opens nothing.
     */
    readonly admit: (
      firstFrame: unknown,
      close: Effect.Effect<void>,
    ) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    /** The open connection `id` and the role it holds now. */
    readonly current: (id: string) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    /**
     * Presents a fresh ticket on the open connection `connectionId`: the whole seconds it may now
     * stay open, or none. Granted only when the ticket is held, unused and unexpired (the attempt
     * spends it whatever the outcome), names the connection's own person and HQ session, came
     * under a still-live admission, and carries `grantSeconds` of which at least a second is left:
     * the connection's deadline becomes `grantSeconds` after the Mate heard the ticket, and the
     * answer counts from now to it. The same session, not only the same person: a session's end
     * closes its connections, and another's ticket would outlive it. A ticket that names a role
     * sets the connection's role; one without leaves it as it is. A refused one changes nothing.
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
     * Whether the Mate's link to HQ is up (`ZeropsHqLink`'s state), down until first told. A
     * connection ends at its deadline only while it is up; when it comes back up, every deadline
     * that passed or passes within a minute moves to a minute from then, never earlier.
     */
    readonly linked: (up: boolean) => Effect.Effect<void>;
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
  /** The HQ link's state as last told; down until the link first says otherwise. */
  let linkUp = false;
  /** Wakes the deadline fiber to re-read the deadlines and the link; one wake covers many. */
  const wake = yield* Queue.dropping<void>(1);
  const rearm = Queue.offer(wake, undefined);
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
  /**
   * Under the lock: ends every connection whose deadline is due while the link is up, and gives
   * the earliest deadline left then, none while the link is down or nothing is left.
   */
  const endDue = Effect.gen(function* () {
    if (!linkUp) return undefined;
    const now = yield* Clock.currentTimeMillis;
    let earliest: number | undefined;
    for (const [id, connection] of connections) {
      if (connection.deadlineMs <= now) {
        yield* Effect.logInfo("connection grant ended", {
          connectionId: connection.connectionId,
        });
        yield* remove(id);
      } else if (earliest === undefined || connection.deadlineMs < earliest)
        earliest = connection.deadlineMs;
    }
    return earliest;
  });
  // One fiber for the layer's life sleeps until the earliest deadline, or until a deadline is set or
  // the link changes, then ends what is due; an extension that took the lock first keeps its own.
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        const earliest = yield* lock.withPermits(1)(endDue);
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.raceFirst(
          earliest === undefined ? Effect.never : Effect.sleep(Duration.millis(earliest - now)),
          Queue.take(wake),
        );
      }),
    ),
  );
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
        const { role, grantSeconds, heardAtMs } = ticket.value;
        // HQ names no role only where Zerops did not answer it: such a ticket extends, never opens;
        // nor does one without a grant, whose connection nothing would end.
        if (role === undefined || grantSeconds === undefined || connections.has(id))
          return Option.none<ConnectionIdentity>();
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
          deadlineMs: heardAtMs + grantSeconds * 1000,
          close,
        });
        yield* rearm;
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
        const now = yield* Clock.currentTimeMillis;
        const deadlineMs =
          consumed === undefined || grantSeconds === undefined
            ? undefined
            : consumed.heardAtMs + grantSeconds * 1000;
        // Whole seconds from now to the new deadline: what the browser schedules its next by.
        const secondsLeft = deadlineMs === undefined ? 0 : Math.floor((deadlineMs - now) / 1000);
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
                    : deadlineMs === undefined
                      ? "ticket carries no grantSeconds"
                      : secondsLeft < 1
                        ? "ticket heard too long ago"
                        : undefined;
        if (refused !== undefined || connection === undefined || deadlineMs === undefined) {
          yield* Effect.logInfo("connection extension refused", { connectionId, refused });
          return Option.none<number>();
        }
        if (consumed?.role !== undefined) connection.role = consumed.role;
        connection.deadlineMs = deadlineMs;
        yield* rearm;
        yield* Effect.logInfo("connection extended", {
          connectionId,
          grantSeconds,
          role: connection.role,
        });
        return Option.some(secondsLeft);
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
    linked: (up) =>
      Effect.gen(function* () {
        if (up === linkUp) return;
        if (up) {
          const graceEndMs = (yield* Clock.currentTimeMillis) + RELINK_GRACE_MS;
          for (const connection of connections.values())
            if (connection.deadlineMs < graceEndMs) connection.deadlineMs = graceEndMs;
        }
        linkUp = up;
        yield* rearm;
      }).pipe(lock.withPermits(1)),
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
