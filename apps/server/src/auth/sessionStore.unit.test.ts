import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const sessionStoreLayer = SessionStore.layer.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, zeropsFixtures: undefined })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-unit-" }))),
  ),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

// witness: apps/server/src/auth/SessionStore.ts | return yield* new InvalidSessionTokenSignatureError({}); → yield* Effect.void;
it.effect(
  "AU17: A session token is accepted only with the server's signature and before its expiry on the injected clock, and a websocket token only while its parent session lives",
  () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const verdict = <A, E extends { readonly _tag: string }>(check: Effect.Effect<A, E>) =>
        check.pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "accepted" }));

      const short = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "short",
        ttl: Duration.seconds(10),
      });
      const long = yield* sessions.issue({
        method: "bearer-access-token",
        subject: "long",
        scopes: ["orchestration:read"],
        ttl: Duration.hours(1),
      });
      // The long session's claims under the short session's signature.
      const forged = `${long.token.split(".")[0]}.${short.token.split(".")[1]}`;
      const shortSocket = yield* sessions.issueWebSocketToken(short.sessionId, {
        ttl: Duration.minutes(5),
      });
      const longSocket = yield* sessions.issueWebSocketToken(long.sessionId, {
        ttl: Duration.minutes(5),
      });

      expect([
        yield* verdict(sessions.verify(short.token)),
        yield* verdict(sessions.verify(forged)),
        yield* verdict(sessions.verifyWebSocketToken(shortSocket.token)),
      ]).toEqual(["accepted", "InvalidSessionTokenSignatureError", "accepted"]);

      yield* TestClock.adjust(Duration.seconds(9));
      expect(yield* verdict(sessions.verify(short.token))).toBe("accepted");

      yield* TestClock.adjust(Duration.seconds(1));
      yield* sessions.revoke(long.sessionId);
      expect([
        yield* verdict(sessions.verify(short.token)),
        yield* verdict(sessions.verifyWebSocketToken(shortSocket.token)),
        yield* verdict(sessions.verifyWebSocketToken(longSocket.token)),
      ]).toEqual([
        "SessionTokenExpiredError",
        "WebSocketSessionExpiredError",
        "WebSocketSessionRevokedError",
      ]);
    }).pipe(Effect.provide(Layer.merge(sessionStoreLayer, TestClock.layer()))),
);
