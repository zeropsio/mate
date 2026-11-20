import { expect, it } from "@effect/vitest";
import { ZeropsUserId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { make, type TicketFrame } from "../zerops/ZeropsTicketDoor.ts";
import { memorySignInStore } from "../zerops/zeropsSignIns.ts";

/** The admission the ticket came under stands. */
const live = () => true;
/** A ticket HQ issued with no role. */
const ticket: TicketFrame = {
  type: "ticket",
  ticket: "hq-ticket",
  userId: ZeropsUserId.make("jan"),
  sessionId: "hq-session",
  expiresIn: 60,
  grantSeconds: 900,
};

// witness: apps/server/src/zerops/ZeropsTicketDoor.ts | if (held === undefined || held.used) return Option.none(); → if (held === undefined) return Option.none();
it.effect(
  "AU10: A Zerops ticket opens one connection once and carries no role, and an unknown, foreign or malformed first frame consumes none",
  () =>
    Effect.gen(function* () {
      const door = yield* make;
      const anotherMate = yield* make;
      yield* door.heard(ticket, live);
      for (const frame of [
        null,
        [],
        "hq-ticket",
        {},
        { ticket: "other" },
        { type: "ticket", ticket: "hq-ticket" },
        { ticket: "hq-ticket", role: "OWNER" },
      ]) {
        expect(Option.isNone(yield* door.consume(frame))).toBe(true);
      }
      expect(Option.isNone(yield* anotherMate.consume({ ticket: "hq-ticket" }))).toBe(true);

      const consumed = Option.getOrUndefined(yield* door.consume({ ticket: "hq-ticket" }));
      expect(consumed?.identity).toEqual({
        ticket: "hq-ticket",
        userId: "jan",
        sessionId: "hq-session",
      });
      expect(consumed?.role).toBeUndefined();
      expect(Option.isNone(yield* door.consume({ ticket: "hq-ticket" }))).toBe(true);
    }),
);

// witness: apps/server/src/zerops/ZeropsTicketDoor.ts | Math.min(frame.expiresIn, 60) → frame.expiresIn
it.effect(
  "AU11: A ticket expires at most 60 seconds after it was issued, and sending it again never renews it",
  () =>
    Effect.gen(function* () {
      const door = yield* make;
      yield* door.heard({ ...ticket, expiresIn: 120 }, live);
      yield* TestClock.adjust("59 seconds");
      yield* door.heard(ticket, live);
      yield* TestClock.adjust("1 second");
      expect(Option.isNone(yield* door.consume({ ticket: "hq-ticket" }))).toBe(true);
    }),
);

// witness: apps/server/src/zerops/ZeropsTicketDoor.ts | if (!("session" in subject) || held.identity.sessionId === subject.session) → if (!("session" in subject))
it.effect(
  "AU12: A sign-out refuses every ticket issued before the connection opened, as well as the connection's own",
  () =>
    Effect.gen(function* () {
      const door = yield* make;
      yield* door.heard(ticket, live);
      yield* door.heard({ ...ticket, ticket: "earlier-ticket" }, live);
      yield* door.end({ session: "hq-session" });
      yield* door.heard(ticket, live);
      expect(Option.isNone(yield* door.consume({ ticket: "hq-ticket" }))).toBe(true);
      expect(Option.isNone(yield* door.consume({ ticket: "earlier-ticket" }))).toBe(true);
    }),
);

// witness: apps/server/src/zerops/zeropsSignIns.ts | filter(([, record]) => !record.credentialCleared) → filter(() => true)
it.effect(
  "AU13: A login whose credential was logged out keeps its last signer as history, which never authorizes a turn",
  () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      yield* store.save("claude-code", { by: ZeropsUserId.make("u-eva") });
      yield* store.clear("claude-code");
      expect(yield* store.load).toEqual({});
      expect(yield* store.lastSigners).toEqual({ "claude-code": "u-eva" });
    }),
);
