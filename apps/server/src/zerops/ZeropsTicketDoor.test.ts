import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { make, type TicketFrame } from "./ZeropsTicketDoor.ts";

const ticket: TicketFrame = {
  type: "ticket",
  ticket: "hq-ticket",
  userId: "jan",
  sessionId: "hq-session",
  expiresIn: 60,
};

describe("ZeropsTicketDoor", () => {
  it.effect("TC-6 a ticket opens one connection once and carries no role", () =>
    Effect.gen(function* () {
      const door = yield* make;
      yield* door.heard(ticket);
      assert.deepEqual(Option.getOrUndefined(yield* door.consume({ ticket: "hq-ticket" })), {
        ticket: "hq-ticket",
        userId: "jan",
        sessionId: "hq-session",
      });
      assert.isTrue(Option.isNone(yield* door.consume({ ticket: "hq-ticket" })));
    }),
  );

  it.effect("TC-6 unknown, foreign and malformed first frames cannot consume a ticket", () =>
    Effect.gen(function* () {
      const door = yield* make;
      const anotherMate = yield* make;
      yield* door.heard(ticket);
      for (const frame of [
        null,
        [],
        "hq-ticket",
        {},
        { ticket: "other" },
        { type: "ticket", ticket: "hq-ticket" },
        { ticket: "hq-ticket", role: "OWNER" },
      ]) {
        assert.isTrue(Option.isNone(yield* door.consume(frame)));
      }
      assert.isTrue(Option.isNone(yield* anotherMate.consume({ ticket: "hq-ticket" })));
      assert.isTrue(Option.isSome(yield* door.consume({ ticket: "hq-ticket" })));
    }),
  );
  it.effect(
    "TC-6 tickets expire after at most 60 seconds and retransmission never renews them",
    () =>
      Effect.gen(function* () {
        const door = yield* make;
        yield* door.heard({ ...ticket, expiresIn: 120 });
        yield* TestClock.adjust("59 seconds");
        yield* door.heard(ticket);
        yield* TestClock.adjust("1 second");
        assert.isTrue(Option.isNone(yield* door.consume({ ticket: "hq-ticket" })));
        yield* door.heard({ ...ticket, ticket: "short", expiresIn: 2 });
        yield* TestClock.adjust("2 seconds");
        assert.isTrue(Option.isNone(yield* door.consume({ ticket: "short" })));
      }),
  );
  it.effect("TC-8 sign-out also refuses tickets issued before a connection opened", () =>
    Effect.gen(function* () {
      const door = yield* make;
      yield* door.heard(ticket);
      yield* door.closeSession("hq-session");
      yield* door.heard(ticket);
      assert.isTrue(Option.isNone(yield* door.consume({ ticket: "hq-ticket" })));
    }),
  );
});
