import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Connections from "./ZeropsConnections.ts";
import * as Access from "./ZeropsMateAccessList.ts";
import * as ChiefOpener from "./ZeropsChiefOpener.ts";
import * as Tickets from "./ZeropsTicketDoor.ts";
import { type AccessLiveEvent, decodeAccessFrame } from "./ZeropsAccessSocket.ts";
import { makeAccessScene, type SceneRoles, sceneRead } from "./testing/accessScene.ts";

const AT = Date.parse("2026-10-24T10:00:00.000Z");
const ticket = (id: string, userId: string) =>
  ({ type: "ticket", ticket: id, userId, sessionId: "session-1", expiresIn: 60 }) as const;
const over = (access: Access.ZeropsMateAccessList["Service"]) =>
  Effect.gen(function* () {
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
    return { access, connections, tickets, closed, closeReceipt, open };
  });
const setupWith = (own: Parameters<typeof Access.make>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(AT);
    return yield* over(yield* Access.make(own));
  });
/** The Mate's own list over an organisation holding `roles`, read before the test goes on. */
const setupScene = (roles: SceneRoles) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(AT);
    const scene = yield* makeAccessScene(roles);
    yield* TestClock.adjust(0);
    return { ...(yield* over(scene.list)), set: scene.set };
  });
/** The Mate's own list over a Chief project holding `roles`, opened for whom `chiefOpener` names. */
const setupChief = (roles: SceneRoles) =>
  Effect.gen(function* () {
    const opener = yield* ChiefOpener.make;
    const rig = yield* setupWith({
      projectId: "P_MATE",
      read: Effect.succeed(sceneRead(roles, ["chief"])),
      opener,
    });
    yield* TestClock.adjust(0);
    const chiefOpener = (userId: ChiefOpener.ChiefOpener) =>
      opener.named(userId).pipe(Effect.andThen(TestClock.adjust(0)));
    return { ...rig, chiefOpener };
  });
const setupOwn = Effect.gen(function* () {
  const answer = yield* Ref.make(sceneRead({ jan: "OWNER", eva: "READ_ONLY" }));
  const rig = yield* setupWith({ projectId: "P_MATE", read: Ref.get(answer) });
  yield* TestClock.adjust(0);
  return { ...rig, answer };
});

/**
 * The Mate's own list over a counted read (Jan owner, Eva basic user) and a live Zerops websocket
 * whose frames the test pushes, as the wire carries them.
 */
const setupLive = Effect.gen(function* () {
  const reads = yield* Ref.make(0);
  const events = yield* Queue.unbounded<AccessLiveEvent>();
  const rig = yield* setupWith({
    projectId: "P_MATE",
    read: Ref.update(reads, (count) => count + 1).pipe(
      Effect.as(sceneRead({ jan: "OWNER", eva: "BASIC_USER" })),
    ),
    live: () => Stream.fromQueue(events),
  });
  yield* TestClock.adjust(0);
  const push = (wire: unknown) =>
    Queue.offer(events, {
      _tag: "frame",
      frame: decodeAccessFrame(wire, { projectId: "P_MATE", clientId: "org" })!,
    });
  return { ...rig, reads, push };
});
/** A `client-user` update for Eva, as ZEROPS-070 recorded one. */
const evaOrgRole = (roleCode: string) => ({
  type: "search",
  subscriptionName: "mate-access-members",
  data: {
    update: [{ id: "cu-eva", roleCode, status: "ACTIVE", userId: "eva", clientId: "org" }],
  },
});
/** The own project's update with Eva overridden, as ZEROPS-069 recorded one. */
const evaOverride = (roleCode: string) => ({
  type: "search",
  subscriptionName: "mate-access-project",
  data: {
    update: [
      {
        id: "P_MATE",
        status: "ACTIVE",
        clientId: "org",
        name: "mate",
        userRoles: [{ clientUserId: "cu-eva", roleCode }],
      },
    ],
  },
});

describe("ZeropsConnections", () => {
  it.effect(
    "A Chief registration narrows native grants and closes excluded connections, retaining its verdict across absent states",
    () =>
      Effect.gen(function* () {
        const { connections, closed, open, chiefOpener } = yield* setupChief({
          jan: "OWNER",
          eva: "BASIC_USER",
          read: "READ_ONLY",
        });
        yield* chiefOpener("jan");
        assert.isTrue(Option.isSome(yield* open("jan", "jan")));
        assert.isTrue(Option.isNone(yield* open("eva", "eva")));
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("issued", "jan"))),
          "open",
        );
        yield* chiefOpener("eva");
        assert.deepEqual(closed, ["jan"]);
        assert.isTrue(Option.isSome(yield* open("eva-now", "eva")));
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("owner", "jan"))),
          "not_in_list",
        );
        yield* chiefOpener(undefined);
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("still-owner", "jan"))),
          "not_in_list",
        );
        yield* chiefOpener("read");
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("reader", "read"))),
          "read_only",
        );
        yield* chiefOpener("unknown");
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("unknown", "unknown"))),
          "not_in_list",
        );
        yield* chiefOpener(null);
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("nobody", "eva"))),
          "not_in_list",
        );
        assert.isTrue(Option.isNone(yield* connections.admit({ ticket: "issued" }, Effect.void)));
      }).pipe(Effect.scoped),
  );

  it.effect("A Chief registration refuses a ticket waiting on a native access read", () =>
    Effect.gen(function* () {
      const readAnswers = yield* Deferred.make<void>();
      const opener = yield* ChiefOpener.make;
      const { connections, tickets } = yield* setupWith({
        projectId: "P_MATE",
        read: Deferred.await(readAnswers).pipe(Effect.as(sceneRead({ jan: "OWNER" }, ["chief"]))),
        opener,
      });
      const answer = yield* connections.ticket(ticket("pending", "jan"));
      const verdict = yield* Effect.forkChild(answer);
      yield* opener.named("eva");
      yield* Deferred.succeed(readAnswers, undefined);
      assert.strictEqual(yield* Fiber.join(verdict), "not_in_list");
      assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "pending" })));
    }).pipe(Effect.scoped),
  );

  it.effect("A registered opener still needs the tagged Chief project's native grant", () =>
    Effect.gen(function* () {
      const rows = sceneRead({ jan: "OWNER", eva: "NO_ACCESS" });
      if (rows.kind !== "read") return yield* Effect.die("expected rows");
      const opener = yield* ChiefOpener.make;
      const { connections } = yield* setupWith({
        projectId: "P_MATE",
        read: Effect.succeed({
          ...rows,
          project: { ...rows.project, tagList: ["chief"], overrides: { "cu-jan": "OWNER" } },
        }),
        opener,
      });
      yield* TestClock.adjust(0);
      yield* opener.named("eva");
      assert.strictEqual(
        yield* Effect.flatten(connections.ticket(ticket("eva", "eva"))),
        "not_in_list",
      );
      assert.strictEqual(
        yield* Effect.flatten(connections.ticket(ticket("jan", "jan"))),
        "not_in_list",
      );
      yield* opener.named("jan");
      yield* TestClock.adjust(0);
      assert.strictEqual(yield* Effect.flatten(connections.ticket(ticket("owner", "jan"))), "open");
    }).pipe(Effect.scoped),
  );
  it.effect.each([
    { name: "a project override", wire: evaOverride("READ_ONLY") },
    { name: "an org role for a person with no override", wire: evaOrgRole("READ_ONLY") },
  ])(
    "A Zerops websocket frame that turns an opener into a listed person closes their connection without a Zerops read: $name",
    ({ wire }) =>
      Effect.gen(function* () {
        const { closed, closeReceipt, open, push, reads } = yield* setupLive;
        yield* open("jan", "jan");
        assert.isTrue(Option.isSome(yield* open("eva", "eva")));
        yield* push(wire);
        yield* Deferred.await(closeReceipt);
        assert.deepEqual(closed, ["eva"]);
        assert.strictEqual(yield* Ref.get(reads), 1);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A client-user frame that demotes an opener to No access closes their connection and reports them missing from that frame, with no Zerops read in between",
    () =>
      Effect.gen(function* () {
        const { access, closed, closeReceipt, open, push, reads } = yield* setupLive;
        yield* open("eva", "eva");
        const reports = yield* Stream.runCollect(Stream.take(access.reports, 2)).pipe(
          Effect.forkChild,
        );
        yield* push(evaOrgRole("NO_ACCESS"));
        yield* Deferred.await(closeReceipt);
        const [first, second] = yield* Fiber.join(reports);
        assert.deepEqual(closed, ["eva"]);
        assert.deepEqual([first?.openers, first?.listed], [["jan", "eva"], []]);
        assert.deepEqual([second?.openers, second?.listed], [["jan"], []]);
        assert.strictEqual(yield* Ref.get(reads), 1);
      }).pipe(Effect.scoped),
  );

  it.effect("TC-7 only people the latest list opens for may open a connection", () =>
    Effect.gen(function* () {
      const { open, set } = yield* setupScene({});
      for (const row of [
        { orgRole: "NO_ACCESS", admitted: false },
        { orgRole: "READ_ONLY", admitted: false },
        { orgRole: "OWNER", admitted: true },
      ] as const) {
        yield* set({ jan: row.orgRole });
        assert.strictEqual(Option.isSome(yield* open(row.orgRole, "jan")), row.admitted);
      }
      assert.isTrue(Option.isNone(yield* open("unknown", "unknown")));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-8 and TC-12 sign-out closes every connection carrying that session, including before renewal, and no other",
    () =>
      Effect.gen(function* () {
        const { connections, tickets, closed, open, set } = yield* setupScene({
          jan: "OWNER",
          eva: "BASIC_USER",
        });
        yield* open("before-renewal", "jan", "stable-session");
        yield* set({ jan: "OWNER", eva: "BASIC_USER" });
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
        yield* connections.end({ session: "stable-session" });
        assert.deepEqual(closed, ["before-renewal", "after-renewal"]);
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "pending" })));
        assert.isTrue(Option.isSome(yield* connections.current("other-session")));
        assert.isTrue(Option.isSome(yield* connections.current("other-person")));
      }).pipe(Effect.scoped),
  );

  it.effect("Closing a socket removes its connection handle immediately", () =>
    Effect.gen(function* () {
      const { connections, closed, open } = yield* setupScene({ jan: "OWNER" });
      yield* open("jan", "jan");
      yield* connections.close("jan");
      assert.isTrue(Option.isNone(yield* connections.current("jan")));
      assert.deepEqual(closed, []);
    }).pipe(Effect.scoped),
  );
  it.effect("Sign-out and ticket admission cannot leave a signed-out connection alive", () =>
    Effect.gen(function* () {
      const { connections, tickets } = yield* setupScene({ jan: "OWNER" });
      yield* tickets.heard({
        type: "ticket",
        ticket: "racing",
        userId: "jan",
        sessionId: "ending",
        expiresIn: 60,
      });
      yield* Effect.all(
        [
          connections.admit({ ticket: "racing" }, Effect.void),
          connections.end({ session: "ending" }),
        ],
        { concurrency: "unbounded" },
      );
      assert.isTrue(Option.isNone(yield* connections.current("racing")));
      assert.isTrue(Option.isNone(yield* connections.admit({ ticket: "racing" }, Effect.void)));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "Admission reads the Mate's own Zerops list alone: a ticket for a person who is not an opener is refused not_in_list or read_only and never held",
    () =>
      Effect.gen(function* () {
        const { connections, tickets } = yield* setupOwn;
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("t-jan", "jan"))),
          "open",
        );
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("t-eva", "eva"))),
          "read_only",
        );
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("t-bob", "bob"))),
          "not_in_list",
        );
        assert.isTrue(Option.isSome(yield* tickets.consume({ ticket: "t-jan" })));
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "t-eva" })));
        assert.isTrue(Option.isNone(yield* tickets.consume({ ticket: "t-bob" })));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A list older than 15 minutes refuses new tickets with reason list_unconfirmed but keeps open connections",
    () =>
      Effect.gen(function* () {
        const { answer, closed, connections, open } = yield* setupOwn;
        assert.isTrue(Option.isSome(yield* open("jan", "jan")));
        yield* Ref.set(answer, { kind: "failed", reason: "unreachable" });
        yield* TestClock.adjust("15 minutes");
        yield* TestClock.adjust(1);
        assert.strictEqual(
          yield* Effect.flatten(connections.ticket(ticket("late", "jan"))),
          "list_unconfirmed",
        );
        assert.deepEqual(closed, []);
        assert.isTrue(Option.isSome(yield* connections.current("jan")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "A ticket answered after its session's close-session is never kept, though its verdict waited on a Zerops read",
    () =>
      Effect.gen(function* () {
        const readAnswers = yield* Deferred.make<void>();
        const { connections } = yield* setupWith({
          projectId: "P_MATE",
          read: Deferred.await(readAnswers).pipe(Effect.as(sceneRead({ jan: "OWNER" }))),
        });
        const answer = yield* connections.ticket(ticket("before-close", "jan"));
        const verdict = yield* Effect.forkChild(answer);
        yield* connections.end({ session: "session-1" });
        yield* Deferred.succeed(readAnswers, undefined);
        assert.strictEqual(yield* Fiber.join(verdict), "open");
        assert.isTrue(
          Option.isNone(yield* connections.admit({ ticket: "before-close" }, Effect.void)),
        );
      }).pipe(Effect.scoped),
  );
});
