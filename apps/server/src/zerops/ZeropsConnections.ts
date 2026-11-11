/**
 * Live sockets are the sessions; all authorization reads the access list that decides now
 * (`ZeropsMateAccessList`). A ticket HQ sends is admitted only for a person that list opens for;
 * a list that changes closes the connections of whoever it no longer opens for or holds at another
 * role than it admitted them at, and one that only aged closes nothing. A Chief's door is that list's too: it opens for whom HQ lets open the Chief
 * (`ZeropsChiefOpener`, read by the list), so its tickets and connections follow that answer.
 */
import type { MateAccessMember } from "@t3tools/shared/mateAccess";
import type { TicketRefusal } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { type AccessList, ticketVerdict, ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
import { type TicketFrame, ZeropsTicketDoor } from "./ZeropsTicketDoor.ts";

export interface ConnectionIdentity {
  readonly ticket: string;
  readonly connectionId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly role: MateAccessMember["role"];
}
interface ConnectionInput {
  readonly connectionId: string;
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string;
  /** What a later list is compared with; authorization reads the live role instead. */
  readonly admittedRole: MateAccessMember["role"];
  readonly close: Effect.Effect<void>;
}
/** Whose connections end: one HQ session's, or all of one person's. */
export type ConnectionSubject = { readonly session: string } | { readonly person: string };

const openMember = (list: AccessList | undefined, userId: string) =>
  list?.members.find((member) => member.userId === userId && member.visibility === "open");

export class ZeropsConnections extends Context.Service<
  ZeropsConnections,
  {
    /**
     * Takes HQ's ticket in the order the link heard it, and gives what answers it: kept for its
     * socket when the list opens for its person, else refused. The answer may wait on a recompute,
     * so the link runs it aside; a ticket whose session closed meanwhile is never kept.
     */
    readonly ticket: (frame: TicketFrame) => Effect.Effect<Effect.Effect<"open" | TicketRefusal>>;
    readonly admit: (
      firstFrame: unknown,
      close: Effect.Effect<void>,
    ) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    readonly current: (id: string) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    readonly close: (id: string) => Effect.Effect<void>;
    /**
     * The only way a connection ends for a reason of authority. A session's end also drops its
     * tickets; a person's touches none, since admission judges each against the list then.
     *
     * GAP-RIGHTS-4: a connection never sees its person's token revoked; it ends at sign-out or a
     * list change; see docs/architecture/identity-and-access.md#gap-rights (mate-hq).
     */
    readonly end: (subject: ConnectionSubject) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsConnections") {}

export const make = Effect.gen(function* () {
  const access = yield* ZeropsMateAccessList;
  const crypto = yield* Crypto.Crypto;
  const tickets = yield* ZeropsTicketDoor;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const connections = new Map<string, ConnectionInput>();
  /** Tickets taken and not yet answered; a closed session drops its own. */
  const pending = new Set<TicketFrame>();
  const current = Effect.fn("ZeropsConnections.current")(function* (id: string) {
    const connection = connections.get(id);
    if (connection === undefined) return Option.none<ConnectionIdentity>();
    const member = openMember(Option.getOrUndefined(yield* access.current), connection.userId);
    return member === undefined
      ? Option.none<ConnectionIdentity>()
      : Option.some({
          ticket: connection.id,
          connectionId: connection.connectionId,
          userId: connection.userId,
          sessionId: connection.sessionId,
          role: member.role,
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
  const reconcile = Effect.gen(function* () {
    const list = yield* access.current;
    if (Option.isNone(list)) return;
    for (const connection of connections.values())
      if (openMember(list.value, connection.userId)?.role !== connection.admittedRole)
        yield* endPerson(connection.userId);
  });
  // Every change of the list, a recompute's or a Zerops frame's, re-evaluates the connections.
  yield* Stream.runForEach(access.changes, () => lock.withPermits(1)(reconcile)).pipe(
    Effect.forkIn(scope, { startImmediately: true }),
  );
  return ZeropsConnections.of({
    ticket: (frame) =>
      Effect.sync(() => {
        pending.add(frame);
        return access.admits(frame.userId).pipe(
          Effect.flatMap((admitted) =>
            lock.withPermits(1)(
              Effect.gen(function* () {
                // A list that moved while the ticket waited (a Chief's opener moving on) answers it.
                const verdict =
                  admitted === "open"
                    ? ticketVerdict(
                        Option.getOrUndefined(yield* access.current),
                        frame.userId,
                        yield* Clock.currentTimeMillis,
                      )
                    : admitted;
                if (verdict === "open" && pending.has(frame)) yield* tickets.heard(frame);
                return verdict;
              }),
            ),
          ),
          Effect.ensuring(Effect.sync(() => pending.delete(frame))),
        );
      }),
    admit: (firstFrame, close) =>
      Effect.gen(function* () {
        const ticket = yield* tickets.consume(firstFrame);
        if (Option.isNone(ticket)) return Option.none<ConnectionIdentity>();
        const { ticket: id, userId, sessionId } = ticket.value;
        if (connections.has(id)) return Option.none<ConnectionIdentity>();
        const now = yield* Clock.currentTimeMillis;
        const list = Option.getOrUndefined(yield* access.current);
        const member = openMember(list, userId);
        if (member === undefined || ticketVerdict(list, userId, now) !== "open")
          return Option.none<ConnectionIdentity>();
        const connectionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
        connections.set(id, {
          connectionId,
          id,
          userId,
          sessionId,
          admittedRole: member.role,
          close,
        });
        return Option.some({ ticket: id, connectionId, userId, sessionId, role: member.role });
      }).pipe(lock.withPermits(1)),
    current,
    close: (id) =>
      Effect.sync(() => {
        connections.delete(id);
      }),
    end: (subject) =>
      ("session" in subject ? endSession(subject.session) : endPerson(subject.person)).pipe(
        lock.withPermits(1),
      ),
  });
});
export const layer = Layer.effect(ZeropsConnections, make);
