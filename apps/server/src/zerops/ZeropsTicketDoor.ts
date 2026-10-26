/** One-use HQ tickets admit a connection; they never carry a role or become a session. */
import type { KeyLinkDown } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type TicketFrame = Extract<KeyLinkDown, { readonly type: "ticket" }>;
export interface TicketIdentity {
  readonly ticket: string;
  readonly userId: string;
  readonly sessionId: string;
}

export class ZeropsTicketDoor extends Context.Service<
  ZeropsTicketDoor,
  {
    readonly heard: (frame: TicketFrame) => Effect.Effect<void>;
    readonly consume: (firstFrame: unknown) => Effect.Effect<Option.Option<TicketIdentity>>;
    readonly closeSession: (sessionId: string) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsTicketDoor") {}

interface HeldTicket {
  readonly identity: TicketIdentity;
  readonly expiresAtMs: number;
  used: boolean;
}

const decodeFirstFrame = Schema.decodeUnknownOption(Schema.Struct({ ticket: Schema.String }), {
  onExcessProperty: "error",
});

export const make = Effect.sync(() => {
  const tickets = new Map<string, HeldTicket>();
  const prune = (now: number) => {
    for (const [key, held] of tickets) if (held.expiresAtMs <= now) tickets.delete(key);
  };
  return ZeropsTicketDoor.of({
    heard: Effect.fn("ZeropsTicketDoor.heard")(function* (frame) {
      const now = yield* Clock.currentTimeMillis;
      prune(now);
      // Retransmission cannot extend a ticket or resurrect one already consumed.
      if (!tickets.has(frame.ticket))
        tickets.set(frame.ticket, {
          identity: { ticket: frame.ticket, userId: frame.userId, sessionId: frame.sessionId },
          expiresAtMs: now + Math.min(frame.expiresIn, 60) * 1000,
          used: false,
        });
    }),
    consume: Effect.fn("ZeropsTicketDoor.consume")(function* (firstFrame) {
      const now = yield* Clock.currentTimeMillis;
      prune(now);
      const decoded = decodeFirstFrame(firstFrame);
      if (Option.isNone(decoded)) return Option.none();
      const held = tickets.get(decoded.value.ticket);
      if (held === undefined || held.used) return Option.none();
      held.used = true;
      return Option.some(held.identity);
    }),
    closeSession: (sessionId) =>
      Effect.sync(() => {
        for (const held of tickets.values())
          if (held.identity.sessionId === sessionId) held.used = true;
      }),
  });
});
export const layer = Layer.effect(ZeropsTicketDoor, make);
