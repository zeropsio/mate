import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Connections from "./ZeropsConnections.ts";
import * as Access from "./ZeropsMateAccessList.ts";
import * as Tickets from "./ZeropsTicketDoor.ts";
import { makeAccessScene, type SceneRoles, sceneRead } from "./testing/accessScene.ts";

const AT = Date.parse("2026-10-24T10:00:00.000Z");
/** The admission a ticket came under stands. */
const live = () => true;
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
        yield* tickets.heard(
          { type: "ticket", ticket: id, userId, sessionId, expiresIn: 60, role: "OWNER" },
          live,
        );
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
describe("ZeropsConnections", () => {
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
        yield* tickets.heard(
          {
            type: "ticket",
            ticket: "pending",
            userId: "jan",
            sessionId: "stable-session",
            expiresIn: 60,
          },
          live,
        );
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
      yield* tickets.heard(
        {
          type: "ticket",
          ticket: "racing",
          userId: "jan",
          sessionId: "ending",
          expiresIn: 60,
          role: "OWNER",
        },
        live,
      );
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

  it.effect("A ticket answered after its session's close-session is never kept", () =>
    Effect.gen(function* () {
      const readAnswers = yield* Deferred.make<void>();
      const { connections } = yield* setupWith({
        projectId: "P_MATE",
        read: Deferred.await(readAnswers).pipe(Effect.as(sceneRead({ jan: "OWNER" }))),
      });
      const answer = yield* connections.ticket(ticket("before-close", "jan"), live);
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
