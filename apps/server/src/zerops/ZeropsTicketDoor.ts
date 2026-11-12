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
/**
 * Whether the admission of the key a ticket came under is still live: the link's own verdict
 * (`ZeropsHqLink`), read where it is asked, never kept.
 */
export type AdmissionLive = () => boolean;
/** A ticket taken to open a connection, and the admission it came under. */
export interface ConsumedTicket {
  readonly identity: TicketIdentity;
  readonly live: AdmissionLive;
  /** How long a connection opened or extended with it may stay open, where HQ said. */
  readonly grantSeconds?: number;
}

export class ZeropsTicketDoor extends Context.Service<
  ZeropsTicketDoor,
  {
    readonly heard: (frame: TicketFrame, live: AdmissionLive) => Effect.Effect<void>;
    readonly consume: (firstFrame: unknown) => Effect.Effect<Option.Option<ConsumedTicket>>;
    /** The session of every ticket still unused and unexpired at `now`: one it can still open. */
    readonly heldSessions: (now: number) => Effect.Effect<ReadonlyArray<string>>;
    /** Ends one session's tickets, or every ticket where the key was refused. */
    readonly end: (
      subject: { readonly session: string } | { readonly everyone: true },
    ) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsTicketDoor") {}

interface HeldTicket {
  readonly identity: TicketIdentity;
  readonly expiresAtMs: number;
  readonly live: AdmissionLive;
  readonly grantSeconds: number | undefined;
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
    heard: Effect.fn("ZeropsTicketDoor.heard")(function* (frame, live) {
      const now = yield* Clock.currentTimeMillis;
      prune(now);
      // Retransmission cannot extend a ticket or resurrect one already consumed.
      if (!tickets.has(frame.ticket))
        tickets.set(frame.ticket, {
          identity: { ticket: frame.ticket, userId: frame.userId, sessionId: frame.sessionId },
          expiresAtMs: now + Math.min(frame.expiresIn, 60) * 1000,
          live,
          grantSeconds: frame.grantSeconds,
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
      return Option.some({
        identity: held.identity,
        live: held.live,
        ...(held.grantSeconds === undefined ? {} : { grantSeconds: held.grantSeconds }),
      });
    }),
    heldSessions: (now) =>
      Effect.sync(() =>
        Array.from(tickets.values())
          .filter((held) => !held.used && held.expiresAtMs > now)
          .map((held) => held.identity.sessionId),
      ),
    end: (subject) =>
      Effect.sync(() => {
        for (const held of tickets.values())
          if (!("session" in subject) || held.identity.sessionId === subject.session)
            held.used = true;
      }),
  });
});
export const layer = Layer.effect(ZeropsTicketDoor, make);
