import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as ServerConfig from "../config.ts";
import * as Access from "../zerops/ZeropsMateAccessList.ts";
import * as Tickets from "../zerops/ZeropsTicketDoor.ts";
import * as Connections from "../zerops/ZeropsConnections.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import * as Auth from "./EnvironmentAuth.ts";

const configLayer = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return {
      ...config,
      zeropsFixtures: undefined,
      zerops: resolveZeropsEnvironment({ projectId: "project", apiHost: undefined }),
    };
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "k7-zerops-auth-" })));

const request = (headers: Record<string, string> = {}, query = "") =>
  HttpServerRequest.fromWeb(new Request(`https://mate.example/api/shell${query}`, { headers }));

const setup = Effect.gen(function* () {
  const access = yield* Access.make;
  const tickets = yield* Tickets.make;
  const connections = yield* Connections.make.pipe(
    Effect.provideService(Access.ZeropsMateAccessList, access),
    Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
  );
  const auth = yield* Auth.EnvironmentAuth.pipe(
    Effect.provide(
      Auth.zeropsLayer.pipe(
        Layer.provide(configLayer),
        Layer.provide(Layer.succeed(Connections.ZeropsConnections, connections)),
      ),
    ),
  );
  yield* connections.heard({
    type: "access",
    version: 1,
    full: true,
    viewAt: "2026-10-24T10:00:00.000Z",
    members: [{ userId: "jan", role: "OWNER", visibility: "open" }],
  });
  yield* tickets.heard({
    type: "ticket",
    ticket: "opaque-ticket",
    userId: "jan",
    sessionId: "hq-session",
    expiresIn: 60,
  });
  return { auth, connections };
});

it.layer(NodeServices.layer)("EnvironmentAuth Zerops connections", (it) => {
  it.effect(
    "Zerops advertises only HQ tickets and starts without a session database or boot credential",
    () =>
      Effect.gen(function* () {
        const { auth } = yield* setup;
        assert.deepEqual((yield* auth.getDescriptor()).bootstrapMethods, ["ticket"]);
        assert.deepEqual(yield* auth.listSessions(), []);
        assert.isTrue(Exit.isFailure(yield* Effect.exit(auth.issueSession())));
        assert.isTrue(Exit.isFailure(yield* Effect.exit(auth.createPairingLink())));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "Mate HTTP uses the consumed ticket only while its connection lives and exposes a non-secret session id",
    () =>
      Effect.gen(function* () {
        const { auth, connections } = yield* setup;
        const read = auth.authenticateHttpRequest(
          request({ authorization: "Bearer opaque-ticket" }),
        );
        assert.isTrue(Exit.isFailure(yield* Effect.exit(read)));
        const admitted = Option.getOrThrow(
          yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void),
        );
        const session = yield* read;
        assert.strictEqual(session.subject, "zerops-user:jan");
        assert.strictEqual(session.sessionId, admitted.connectionId);
        assert.notEqual(session.sessionId, "opaque-ticket");
        assert.notEqual(session.sessionId, "hq-session");
        assert.include(session.scopes, "exec:operate");
        yield* connections.close("opaque-ticket");
        assert.isTrue(Exit.isFailure(yield* Effect.exit(read)));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "MS1-6 Zerops refuses cookies and upgrade credentials even when they name a live connection",
    () =>
      Effect.gen(function* () {
        const { auth, connections } = yield* setup;
        yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void);
        const descriptor = yield* auth.getDescriptor();
        for (const input of [
          request({ cookie: `${descriptor.sessionCookieName}=opaque-ticket` }),
          request({}, "?wsTicket=opaque-ticket"),
          request({ authorization: "DPoP opaque-ticket" }),
        ])
          assert.isTrue(Exit.isFailure(yield* Effect.exit(auth.authenticateHttpRequest(input))));
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(
              auth.authenticateWebSocketUpgrade(request({ authorization: "Bearer opaque-ticket" })),
            ),
          ),
        );
      }).pipe(Effect.scoped),
  );

  it.effect("Mate HTTP loses access at the same sign-out and refusal boundary as the socket", () =>
    Effect.gen(function* () {
      for (const cause of ["sign-out", "refusal"] as const) {
        yield* Effect.gen(function* () {
          const { auth, connections } = yield* setup;
          yield* connections.admit({ ticket: "opaque-ticket" }, Effect.void);
          if (cause === "sign-out") yield* connections.closeSession("hq-session");
          else
            yield* connections.heard({
              type: "access",
              version: 2,
              full: true,
              refused: true,
              members: [],
            });
          assert.isTrue(
            Exit.isFailure(
              yield* Effect.exit(
                auth.authenticateHttpRequest(request({ authorization: "Bearer opaque-ticket" })),
              ),
            ),
          );
        }).pipe(Effect.scoped);
      }
    }),
  );
});
