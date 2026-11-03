import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import type { KeyLinkAccess } from "@t3tools/shared/mateLink";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Connections from "./ZeropsConnections.ts";
import * as Access from "./ZeropsMateAccessList.ts";
import * as Tickets from "./ZeropsTicketDoor.ts";

const JAN = { userId: "jan", role: "OWNER", visibility: "open" } as const;
const EVA = { userId: "eva", role: "READ_ONLY", visibility: "open" } as const;
const AT = Date.parse("2026-10-24T10:00:00.000Z");
const full = (members: KeyLinkAccess["members"]): Extract<KeyLinkAccess, { viewAt: string }> => ({
  type: "access",
  version: 1,
  full: true,
  viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT)),
  members,
});
const setup = Effect.gen(function* () {
  yield* TestClock.setTime(AT);
  const access = yield* Access.make;
  const tickets = yield* Tickets.make;
  const connections = yield* Connections.make.pipe(
    Effect.provide(NodeCrypto.layer),
    Effect.provideService(Access.ZeropsMateAccessList, access),
    Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
  );
  const closed: Array<string> = [];
  const closeReceipt = yield* Deferred.make<void>();
  const open = (id: string, userId: string, sessionId = "session-1") =>
    Effect.gen(function* () {
      yield* tickets.heard({ type: "ticket", ticket: id, userId, sessionId, expiresIn: 60 });
      return yield* connections.admit(
        { ticket: id },
        Effect.sync(() => {
          closed.push(id);
        }).pipe(Effect.andThen(Deferred.succeed(closeReceipt, undefined))),
      );
    });
  return { connections, tickets, closed, closeReceipt, open };
});

describe("ZeropsConnections", () => {
  it.effect(
    "TC-7 every connection reads the narrowed role and a removed person is disconnected",
    () =>
      Effect.gen(function* () {
        const { connections, closed, open } = yield* setup;
        yield* connections.heard(full([JAN, EVA]));
        assert.isTrue(Option.isSome(yield* open("jan-1", "jan")));
        yield* open("eva-1", "eva");
        yield* connections.heard({ ...full([{ ...JAN, role: "READ_ONLY" }]), version: 2 });
        assert.strictEqual(
          Option.getOrThrow(yield* connections.current("jan-1")).role,
          "READ_ONLY",
        );
        assert.deepEqual(closed, ["eva-1"]);
        assert.isTrue(Option.isNone(yield* connections.current("eva-1")));
      }).pipe(Effect.scoped),
  );

  it.effect("TC-7 only people the latest list opens for may open a connection", () =>
    Effect.gen(function* () {
      const { connections, open } = yield* setup;
      for (const row of [
        { visibility: "none", admitted: false },
        { visibility: "listed", admitted: false },
        { visibility: "open", admitted: true },
      ] as const) {
        yield* connections.heard(full([{ ...JAN, visibility: row.visibility }]));
        assert.strictEqual(Option.isSome(yield* open(row.visibility, "jan")), row.admitted);
      }
      assert.isTrue(Option.isNone(yield* open("unknown", "unknown")));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-8 and TC-12 sign-out closes every connection carrying that session, including before renewal, and no other",
    () =>
      Effect.gen(function* () {
        const { connections, tickets, closed, open } = yield* setup;
        yield* connections.heard(full([JAN, EVA]));
        yield* open("before-renewal", "jan", "stable-session");
        yield* connections.heard({ ...full([JAN, EVA]), version: 2 });
        yield* open("after-renewal", "jan", "stable-session");
        yield* open("other-session", "jan", "other");
        yield* open("other-person", "eva", "eva-session");
        yield* tickets.heard({
          type: "ticket",
          ticket: "pending",
          userId: "jan",
          sessionId: "stable-session",
          expiresIn: 60,
        });
        yield* connections.closeSession("stable-session");
        assert.deepEqual(closed, ["before-renewal", "after-renewal"]);
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "pending" })));
        assert.isTrue(Option.isSome(yield* connections.current("other-session")));
        assert.isTrue(Option.isSome(yield* connections.current("other-person")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-19 refusal closes all person connections and admits none until a full non-refused frame",
    () =>
      Effect.gen(function* () {
        const { connections, closed, open } = yield* setup;
        yield* connections.heard(full([JAN, EVA]));
        yield* open("jan", "jan");
        yield* open("eva", "eva");
        yield* connections.heard({
          type: "access",
          version: 2,
          full: true,
          refused: true,
          members: [],
        });
        assert.deepEqual(closed, ["jan", "eva"]);
        assert.isTrue(Option.isNone(yield* open("refused", "jan")));
        yield* connections.heard({ ...full([JAN]), version: 3, full: false });
        assert.isTrue(Option.isNone(yield* open("delta", "jan")));
        yield* connections.heard(full([JAN]));
        assert.isTrue(Option.isSome(yield* open("restored", "jan")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-9 and TC-20 an outage keeps people connected until the cap and then closes them without another frame",
    () =>
      Effect.gen(function* () {
        const { connections, closed, closeReceipt, open } = yield* setup;
        yield* connections.heard(full([JAN]));
        yield* open("jan", "jan");
        yield* TestClock.adjust("15 minutes");
        assert.deepEqual(closed, []);
        assert.isTrue(Option.isSome(yield* connections.current("jan")));
        yield* TestClock.adjust(1);
        yield* Deferred.await(closeReceipt);
        assert.deepEqual(closed, ["jan"]);
        assert.isTrue(Option.isNone(yield* connections.current("jan")));
        assert.isTrue(Option.isNone(yield* open("late", "jan")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-13 the view caps receipt only within sixty seconds of skew and future views never extend it",
    () =>
      Effect.gen(function* () {
        for (const row of [
          { skew: -60_000, holds: 840_000 },
          { skew: -60_001, holds: 900_000 },
          { skew: 60_000, holds: 900_000 },
          { skew: 60_001, holds: 900_000 },
        ]) {
          yield* Effect.gen(function* () {
            const { connections, closed, closeReceipt, open } = yield* setup;
            yield* connections.heard({
              ...full([JAN]),
              viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + row.skew)),
            });
            yield* open("jan", "jan");
            yield* TestClock.adjust(row.holds);
            assert.deepEqual(closed, []);
            yield* TestClock.adjust(1);
            yield* Deferred.await(closeReceipt);
            assert.deepEqual(closed, ["jan"]);
          }).pipe(Effect.scoped);
        }
      }),
  );

  it.effect(
    "TC-20 a fresh unchanged access list renews the hold but a discarded delta does not",
    () =>
      Effect.gen(function* () {
        const { connections, closed, closeReceipt, open } = yield* setup;
        yield* connections.heard(full([JAN]));
        yield* open("jan", "jan");
        yield* TestClock.adjust("10 minutes");
        yield* connections.heard({
          ...full([]),
          version: 2,
          full: false,
          viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + 600_000)),
        });
        yield* TestClock.adjust("10 minutes");
        assert.deepEqual(closed, []);
        yield* connections.heard({
          ...full([]),
          version: 2,
          full: false,
          viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + 1_200_000)),
        });
        yield* TestClock.adjust(300_001);
        yield* Deferred.await(closeReceipt);
        assert.deepEqual(closed, ["jan"]);
      }).pipe(Effect.scoped),
  );

  it.effect("Closing a socket removes its connection handle immediately", () =>
    Effect.gen(function* () {
      const { connections, closed, open } = yield* setup;
      yield* connections.heard(full([JAN]));
      yield* open("jan", "jan");
      yield* connections.close("jan");
      assert.isTrue(Option.isNone(yield* connections.current("jan")));
      assert.deepEqual(closed, []);
    }).pipe(Effect.scoped),
  );
  it.effect("Sign-out and ticket admission cannot leave a signed-out connection alive", () =>
    Effect.gen(function* () {
      const { connections, tickets } = yield* setup;
      yield* connections.heard(full([JAN]));
      yield* tickets.heard({
        type: "ticket",
        ticket: "racing",
        userId: "jan",
        sessionId: "ending",
        expiresIn: 60,
      });
      yield* Effect.all(
        [connections.admit({ ticket: "racing" }, Effect.void), connections.closeSession("ending")],
        { concurrency: "unbounded" },
      );
      assert.isTrue(Option.isNone(yield* connections.current("racing")));
      assert.isTrue(Option.isNone(yield* connections.admit({ ticket: "racing" }, Effect.void)));
    }).pipe(Effect.scoped),
  );
});
