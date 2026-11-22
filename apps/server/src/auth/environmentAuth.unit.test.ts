import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ZeropsUserId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as Connections from "../zerops/ZeropsConnections.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import * as Tickets from "../zerops/ZeropsTicketDoor.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";

const configLayer = (zerops: ServerConfig.ServerConfig["Service"]["zerops"]) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.map(ServerConfig.ServerConfig, (config) => ({
      ...config,
      zeropsFixtures: undefined,
      zerops,
    })),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-unit-" })));

const platform = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const request = (headers: Record<string, string> = {}, query = "") =>
  HttpServerRequest.fromWeb(new Request(`https://mate.example/api/shell${query}`, { headers }));

// witness: apps/server/src/auth/EnvironmentAuth.ts | if (Option.isNone(current)) return yield* new ServerAuthInvalidCredentialError({}); → if (Option.isNone(current)) return { sessionId: AuthSessionId.make(handle), subject: handle, method: "bearer-access-token" as const, scopes: AuthZeropsClientScopes };
it.effect(
  "AU16: Inside Zerops an HTTP request is admitted on a ticket's connection only while that connection lives and loses access at the same sign-out or refusal that ends the socket; a cookie or upgrade credential is refused even when it names a live connection",
  () =>
    Effect.gen(function* () {
      const opened = Effect.gen(function* () {
        const tickets = yield* Tickets.make;
        const connections = yield* Connections.make.pipe(
          Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
        );
        const auth = yield* EnvironmentAuth.EnvironmentAuth.pipe(
          Effect.provide(
            EnvironmentAuth.zeropsLayer.pipe(
              Layer.provide(
                configLayer(resolveZeropsEnvironment({ projectId: "project", apiHost: undefined })),
              ),
              Layer.provide(Layer.succeed(Connections.ZeropsConnections, connections)),
            ),
          ),
        );
        yield* Effect.flatten(
          connections.ticket(
            {
              type: "ticket",
              ticket: "opaque-ticket",
              userId: ZeropsUserId.make("jan"),
              sessionId: "hq-session",
              expiresIn: 60,
              grantSeconds: 900,
              role: "BASIC_USER",
            },
            () => true,
          ),
        );
        const admits = (input: HttpServerRequest.HttpServerRequest) =>
          auth.authenticateHttpRequest(input).pipe(Effect.exit, Effect.map(Exit.isSuccess));
        const bearer = admits(request({ authorization: "Bearer opaque-ticket" }));
        return { auth, connections, bearer, admits };
      });

      // Before its socket is admitted, while it lives, and after it closes.
      const lifetime = yield* Effect.gen(function* () {
        const { connections, bearer } = yield* opened;
        const before = yield* bearer;
        yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void);
        const live = yield* bearer;
        yield* connections.close("opaque-ticket");
        return [before, live, yield* bearer];
      }).pipe(Effect.scoped);
      expect(lifetime).toEqual([false, true, false]);

      // The person's sign-out in HQ and HQ's refusal of the Mate's key.
      for (const end of [{ session: "hq-session" }, { everyone: true as const }]) {
        const after = yield* Effect.gen(function* () {
          const { connections, bearer } = yield* opened;
          yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void);
          yield* connections.end(end);
          return yield* bearer;
        }).pipe(Effect.scoped);
        expect(after).toBe(false);
      }

      const others = yield* Effect.gen(function* () {
        const { auth, connections, admits } = yield* opened;
        yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void);
        const { sessionCookieName } = yield* auth.getDescriptor();
        return [
          yield* admits(request({ cookie: `${sessionCookieName}=opaque-ticket` })),
          yield* admits(request({}, "?wsTicket=opaque-ticket")),
          yield* admits(request({ authorization: "DPoP opaque-ticket" })),
          yield* auth
            .authenticateWebSocketUpgrade(request({ authorization: "Bearer opaque-ticket" }))
            .pipe(Effect.exit, Effect.map(Exit.isSuccess)),
        ];
      }).pipe(Effect.scoped);
      expect(others).toEqual([false, false, false, false]);
    }).pipe(Effect.provide(platform)),
);

const heardOn = (connections: Connections.ZeropsConnections["Service"], ticket: string) =>
  Effect.flatten(
    connections.ticket(
      {
        type: "ticket",
        ticket,
        userId: ZeropsUserId.make("jan"),
        sessionId: "hq-session",
        expiresIn: 60,
        grantSeconds: 900,
        role: "BASIC_USER",
      },
      () => true,
    ),
  );
const registry = Effect.gen(function* () {
  const tickets = yield* Tickets.make;
  return yield* Connections.make.pipe(Effect.provideService(Tickets.ZeropsTicketDoor, tickets));
});

// witness: apps/server/src/zerops/ZeropsConnections.ts | if (!up) yield* tickets.end({ everyone: true }); →
it.effect(
  "AU18: A ticket the Mate heard on a link that has since ended, superseded or closed for any reason, opens and extends no connection, while connections it already opened keep their grant",
  () =>
    Effect.gen(function* () {
      const ended = yield* Effect.gen(function* () {
        const connections = yield* registry;
        yield* heardOn(connections, "t1");
        const first = Option.getOrThrow(yield* connections.admit({ ticket: "t1" }, Effect.void));
        yield* connections.linked(true);
        yield* heardOn(connections, "t2");
        yield* heardOn(connections, "t3");
        yield* connections.linked(false);
        const opened = yield* connections.admit({ ticket: "t2" }, Effect.void);
        const extended = yield* connections.extend(first.connectionId, "t3");
        const kept = yield* connections.current("t1");
        // Back up, the first connection still ends 900 s after its own ticket was heard.
        yield* connections.linked(true);
        yield* TestClock.adjust("899 seconds");
        const beforeDeadline = yield* connections.current("t1");
        yield* TestClock.adjust("1 second");
        const atDeadline = yield* connections.current("t1");
        // A ticket heard on the link that came back opens as before.
        yield* heardOn(connections, "t5");
        const fresh = yield* connections.admit({ ticket: "t5" }, Effect.void);
        return {
          opened,
          extended,
          kept: Option.getOrUndefined(kept),
          first,
          beforeDeadline: Option.isSome(beforeDeadline),
          atDeadline: Option.isSome(atDeadline),
          fresh: Option.isSome(fresh),
        };
      }).pipe(Effect.scoped);
      expect(ended.opened).toEqual(Option.none());
      expect(ended.extended).toEqual(Option.none());
      expect(ended.kept).toEqual(ended.first);
      expect([ended.beforeDeadline, ended.atDeadline]).toEqual([true, false]);
      expect(ended.fresh).toBe(true);

      // A link that ends before it was ever told up drops what it delivered too.
      const neverUp = yield* Effect.gen(function* () {
        const connections = yield* registry;
        yield* heardOn(connections, "t4");
        yield* connections.linked(false);
        return yield* connections.admit({ ticket: "t4" }, Effect.void);
      }).pipe(Effect.scoped);
      expect(neverUp).toEqual(Option.none());
    }).pipe(Effect.provide(platform)),
);
