/**
 * Live sockets are the sessions; all authorization reads the access list that decides now
 * (`ZeropsMateAccessList`). A ticket HQ sends is admitted only for a person that list opens for;
 * a list that changes closes the connections of whoever it no longer opens for, and one that only
 * aged closes nothing. HQ's known Chief opener further narrows this door.
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
import { ticketVerdict, ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
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
  readonly close: Effect.Effect<void>;
}

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
    readonly closeSession: (sessionId: string) => Effect.Effect<void>;
    readonly chiefOpener: (userId: string | null | undefined) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsConnections") {}

export const make = Effect.gen(function* () {
  const access = yield* ZeropsMateAccessList;
  const crypto = yield* Crypto.Crypto;
  const tickets = yield* ZeropsTicketDoor;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const connections = new Map<string, ConnectionInput>();
  /** Tickets taken and not yet answered, marked when a Chief verdict revokes them. */
  const pending = new Map<TicketFrame, boolean>();
  // Undefined is no verdict yet; omission from a later state cannot erase a known verdict.
  let chiefOpener: string | null | undefined;
  const permits = (userId: string) => chiefOpener === undefined || chiefOpener === userId;
  const current = Effect.fn("ZeropsConnections.current")(function* (id: string) {
    const connection = connections.get(id);
    if (connection === undefined) return Option.none<ConnectionIdentity>();
    if (!permits(connection.userId)) return Option.none<ConnectionIdentity>();
    const list = yield* access.current;
    if (Option.isNone(list)) return Option.none<ConnectionIdentity>();
    const member = list.value.members.find(
      (member) => member.userId === connection.userId && member.visibility === "open",
    );
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
  const reconcile = Effect.gen(function* () {
    for (const id of connections.keys()) if (Option.isNone(yield* current(id))) yield* remove(id);
  });
  // Every change of the list, a recompute's or a Zerops frame's, re-evaluates the connections.
  yield* Stream.runForEach(access.changes, () => lock.withPermits(1)(reconcile)).pipe(
    Effect.forkIn(scope, { startImmediately: true }),
  );
  return ZeropsConnections.of({
    ticket: (frame) =>
      Effect.sync(() => {
        pending.set(frame, false);
        return access.admits(frame.userId).pipe(
          Effect.flatMap((verdict) =>
            lock.withPermits(1)(
              Effect.gen(function* () {
                if (pending.get(frame) === true || !permits(frame.userId))
                  return "not_in_list" as const;
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
        const connection: ConnectionInput = {
          connectionId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
          id: ticket.value.ticket,
          userId: ticket.value.userId,
          sessionId: ticket.value.sessionId,
          close,
        };
        if (connections.has(connection.id)) return Option.none<ConnectionIdentity>();
        const now = yield* Clock.currentTimeMillis;
        const list = Option.getOrUndefined(yield* access.current);
        if (!permits(connection.userId) || ticketVerdict(list, connection.userId, now) !== "open")
          return Option.none<ConnectionIdentity>();
        connections.set(connection.id, connection);
        const identity = yield* current(connection.id);
        if (Option.isNone(identity)) connections.delete(connection.id);
        return identity;
      }).pipe(lock.withPermits(1)),
    current,
    close: (id) =>
      Effect.sync(() => {
        connections.delete(id);
      }),
    closeSession: (sessionId) =>
      Effect.gen(function* () {
        yield* tickets.closeSession(sessionId);
        for (const frame of pending.keys())
          if (frame.sessionId === sessionId) pending.delete(frame);
        for (const [id, connection] of connections)
          if (connection.sessionId === sessionId) yield* remove(id);
      }).pipe(lock.withPermits(1)),
    chiefOpener: (userId) =>
      Effect.gen(function* () {
        if (userId === undefined || chiefOpener === userId) return;
        chiefOpener = userId;
        for (const frame of pending.keys()) if (frame.userId !== userId) pending.set(frame, true);
        yield* tickets.restrictTo(userId);
        yield* reconcile;
      }).pipe(lock.withPermits(1)),
  });
});
export const layer = Layer.effect(ZeropsConnections, make);
