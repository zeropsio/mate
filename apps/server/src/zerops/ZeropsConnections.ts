/** Live sockets are the sessions; all authorization reads the latest HQ access list. */
import type { KeyLinkAccess, LinkAccessMember } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
import { ZeropsTicketDoor } from "./ZeropsTicketDoor.ts";

export interface ConnectionIdentity {
  readonly ticket: string;
  readonly connectionId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly role: LinkAccessMember["role"];
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
    readonly heard: (frame: KeyLinkAccess) => Effect.Effect<void>;
    readonly admit: (
      firstFrame: unknown,
      close: Effect.Effect<void>,
    ) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    readonly current: (id: string) => Effect.Effect<Option.Option<ConnectionIdentity>>;
    readonly close: (id: string) => Effect.Effect<void>;
    readonly closeSession: (sessionId: string) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsConnections") {}

export const make = Effect.gen(function* () {
  const access = yield* ZeropsMateAccessList;
  const crypto = yield* Crypto.Crypto;
  const tickets = yield* ZeropsTicketDoor;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const connections = new Map<string, ConnectionInput>();
  let expiry: Fiber.Fiber<void> | undefined;
  const current = Effect.fn("ZeropsConnections.current")(function* (id: string) {
    const connection = connections.get(id);
    if (connection === undefined) return Option.none<ConnectionIdentity>();
    const list = yield* access.current;
    if (Option.isNone(list) || list.value.refused) return Option.none<ConnectionIdentity>();
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
  return ZeropsConnections.of({
    heard: (frame) =>
      Effect.gen(function* () {
        yield* access.heard(frame);
        yield* reconcile;
        if (expiry !== undefined) yield* Fiber.interrupt(expiry);
        const list = yield* access.current;
        if (Option.isSome(list) && !list.value.refused) {
          const now = yield* Clock.currentTimeMillis;
          expiry = yield* Effect.sleep(Math.max(0, list.value.expiresAtMs - now + 1)).pipe(
            Effect.andThen(lock.withPermits(1)(reconcile)),
            Effect.forkIn(scope, { startImmediately: true }),
          );
        }
      }).pipe(lock.withPermits(1)),
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
        for (const [id, connection] of connections)
          if (connection.sessionId === sessionId) yield* remove(id);
      }).pipe(lock.withPermits(1)),
  });
});
export const layer = Layer.effect(ZeropsConnections, make);
