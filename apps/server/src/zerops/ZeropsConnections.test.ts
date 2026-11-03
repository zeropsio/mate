import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import type { KeyLinkAccess } from "@t3tools/shared/mateLink";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as Connections from "./ZeropsConnections.ts";
import * as Access from "./ZeropsMateAccessList.ts";
import * as Tickets from "./ZeropsTicketDoor.ts";
import type { AccessRead } from "./ZeropsAccessRead.ts";

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
const ticket = (id: string, userId: string) =>
  ({ type: "ticket", ticket: id, userId, sessionId: "session-1", expiresIn: 60 }) as const;
const setupWith = (own?: Parameters<typeof Access.make>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(AT);
    const access = yield* Access.make(own);
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
const setup = setupWith();

/** The Mate's own read of its project: every person active, their org role as given. */
const ownRead = (roles: Readonly<Record<string, string>>): AccessRead => ({
  kind: "read",
  project: { clientId: "org", overrides: {} },
  members: Object.entries(roles).map(([userId, orgRole]) => ({
    clientUserId: `cu-${userId}`,
    userId,
    orgRole,
    status: "ACTIVE",
    canCreateProjects: false,
  })),
});
const setupOwn = Effect.gen(function* () {
  const answer = yield* Ref.make(ownRead({ jan: "OWNER", eva: "READ_ONLY" }));
  const rig = yield* setupWith({ projectId: "P_MATE", read: Ref.get(answer) });
  yield* TestClock.adjust(0);
  return { ...rig, answer };
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
            const { connections } = yield* setup;
            yield* connections.heard({
              ...full([JAN]),
              viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + row.skew)),
            });
            yield* TestClock.adjust(row.holds);
            assert.strictEqual(yield* connections.ticket(ticket("before", "jan")), "open");
            yield* TestClock.adjust(1);
            assert.strictEqual(yield* connections.ticket(ticket("after", "jan")), "not_in_list");
          }).pipe(Effect.scoped);
        }
      }),
  );

  it.effect(
    "TC-20 a fresh unchanged access list renews the hold but a discarded delta does not",
    () =>
      Effect.gen(function* () {
        const { connections } = yield* setup;
        yield* connections.heard(full([JAN]));
        yield* TestClock.adjust("10 minutes");
        yield* connections.heard({
          ...full([]),
          version: 2,
          full: false,
          viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + 600_000)),
        });
        yield* TestClock.adjust("10 minutes");
        assert.strictEqual(yield* connections.ticket(ticket("renewed", "jan")), "open");
        yield* connections.heard({
          ...full([]),
          version: 2,
          full: false,
          viewAt: DateTime.formatIso(DateTime.makeUnsafe(AT + 1_200_000)),
        });
        yield* TestClock.adjust(300_001);
        assert.strictEqual(yield* connections.ticket(ticket("discarded", "jan")), "not_in_list");
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

  it.effect(
    "The Mate's own list is authoritative for admission: a ticket for a person who is not an opener is refused not_in_list or read_only and never held; HQ's relay is advisory",
    () =>
      Effect.gen(function* () {
        const { connections, tickets } = yield* setupOwn;
        // HQ relays a list that would open for Eva and Bob: the Mate's own read decides.
        yield* connections.heard(
          full([
            JAN,
            { ...EVA, role: "BASIC_USER" },
            { userId: "bob", role: "OWNER", visibility: "open" },
          ]),
        );
        assert.strictEqual(yield* connections.ticket(ticket("t-jan", "jan")), "open");
        assert.strictEqual(yield* connections.ticket(ticket("t-eva", "eva")), "read_only");
        assert.strictEqual(yield* connections.ticket(ticket("t-bob", "bob")), "not_in_list");
        assert.isTrue(Option.isSome(yield* tickets.consume({ ticket: "t-jan" })));
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "t-eva" })));
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "t-bob" })));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A list older than 15 minutes refuses new tickets with reason not_in_list but keeps open connections",
    () =>
      Effect.gen(function* () {
        const { answer, closed, connections, open } = yield* setupOwn;
        assert.isTrue(Option.isSome(yield* open("jan", "jan")));
        yield* Ref.set(answer, { kind: "failed", reason: "unreachable" });
        yield* TestClock.adjust("15 minutes");
        yield* TestClock.adjust(1);
        assert.strictEqual(yield* connections.ticket(ticket("late", "jan")), "not_in_list");
        assert.deepEqual(closed, []);
        assert.isTrue(Option.isSome(yield* connections.current("jan")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "When the Mate's own recompute stops opening for a person, their connections close and a narrowed role is read at once, without a frame from HQ",
    () =>
      Effect.gen(function* () {
        const { answer, closed, closeReceipt, connections, open } = yield* setupOwn;
        yield* Ref.set(answer, ownRead({ jan: "OWNER", eva: "BASIC_USER" }));
        yield* TestClock.adjust("6 minutes");
        yield* open("jan", "jan");
        yield* open("eva", "eva");
        yield* Ref.set(answer, ownRead({ jan: "ADMIN", eva: "READ_ONLY" }));
        yield* TestClock.adjust("6 minutes");
        yield* Deferred.await(closeReceipt);
        assert.deepEqual(closed, ["eva"]);
        assert.strictEqual(Option.getOrThrow(yield* connections.current("jan")).role, "ADMIN");
      }).pipe(Effect.scoped),
  );
});
