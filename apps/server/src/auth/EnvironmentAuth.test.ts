import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PairingGrantStore from "./PairingGrantStore.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";

import * as ServerSecretStore from "./ServerSecretStore.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import * as SessionStore from "./SessionStore.ts";

/** Pinned so dev-mode cookie tests can assert the port-scoped name. */
const TEST_SERVER_PORT = 13_773;

const makeServerConfigLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        zeropsFixtures: undefined,
        ...overrides,
        // Keep the test server deterministic even when the default test layer
        // changes its development port.
        port: TEST_SERVER_PORT,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-server-test-" })));

const makeEnvironmentAuthLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

const makeCookieRequest = (
  cookieName: string,
  sessionToken: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {
      [cookieName]: sessionToken,
    },
    headers: {},
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const makeBearerRequest = (
  token: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {},
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const MEMBERSHIP_TTL_SECONDS = 900;

const zeropsTestEnvironment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: MEMBERSHIP_TTL_SECONDS,
});

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
  ipAddress: "192.168.1.23",
};

it.layer(NodeServices.layer)("EnvironmentAuth.layer", (it) => {
  it.effect("classifies invalid bootstrap credential failures for the HTTP boundary", () =>
    Effect.sync(() => {
      const error = EnvironmentAuth.toBootstrapExchangeError(
        new PairingGrantStore.UnknownBootstrapCredentialError({}),
      );

      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }),
  );

  it.effect("maps unexpected bootstrap failures to 500", () =>
    Effect.sync(() => {
      const cause = new PairingGrantStore.BootstrapCredentialConsumeError({
        cause: new Error("sqlite is unavailable"),
      });
      const error = EnvironmentAuth.toBootstrapExchangeError(cause);

      expect(error._tag).toBe("ServerAuthBootstrapCredentialValidationError");
      expect(error.message).toBe("Failed to validate bootstrap credential.");
      if (error._tag === "ServerAuthBootstrapCredentialValidationError") {
        expect(error.cause).toBe(cause);
      }
    }),
  );

  it.effect("ignores session cookies for HTTP and websocket auth inside Zerops", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* serverAuth.issueSession();
      const request = makeCookieRequest(sessions.cookieName, issued.token);

      const [httpResult, websocketResult] = yield* Effect.all([
        serverAuth.authenticateHttpRequest(request).pipe(Effect.result),
        serverAuth.authenticateWebSocketUpgrade(request).pipe(Effect.result),
      ]);

      expect(httpResult._tag).toBe("Failure");
      expect(websocketResult._tag).toBe("Failure");
      if (httpResult._tag === "Failure") {
        expect(httpResult.failure._tag).toBe("ServerAuthMissingCredentialError");
      }
      if (websocketResult._tag === "Failure") {
        expect(websocketResult.failure._tag).toBe("ServerAuthMissingCredentialError");
      }
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("does not exchange ordinary pairing grants for administrative access tokens", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.createPairingLink();

      const error = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(
          pairingCredential.credential,
          ["orchestration:read", "access:write"],
          requestMetadata,
        )
        .pipe(Effect.flip);

      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("inherits the identity grant scopes when token exchange omits scope", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.createPairingLink({
        method: "zerops-identity",
        subject: "zerops-user:test",
        scopes: ["orchestration:read"],
      });

      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        pairingCredential.credential,
        undefined,
        requestMetadata,
      );

      expect(token.scope).toBe("orchestration:read");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("caps a session from the identity door at the membership window", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* serverAuth.createPairingLink({
        method: "zerops-identity",
        subject: "zerops-user:a-zerops-user-id",
      });
      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
      );

      // The window IS this session's lifetime: the holder has a Zerops token
      // and re-mints with it, and that re-mint is the real membership check.
      expect(access.expires_in).toBeLessThanOrEqual(MEMBERSHIP_TTL_SECONDS);
      expect(access.expires_in).toBeGreaterThan(MEMBERSHIP_TTL_SECONDS - 30);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("caps a DPoP session from the identity door at the window, not the hour", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* serverAuth.createPairingLink({
        method: "zerops-identity",
        subject: "zerops-user:a-zerops-user-id",
        proofKeyThumbprint: "a-jwk-thumbprint",
      });
      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
        { proofKeyThumbprint: "a-jwk-thumbprint" },
      );

      expect(access.token_type).toBe("DPoP");
      expect(access.expires_in).toBeLessThanOrEqual(MEMBERSHIP_TTL_SECONDS);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("revokes every session belonging to one subject and leaves the rest", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      // Two devices for the same Zerops user, one for somebody else.
      const laptop = yield* serverAuth.issueSession({ subject: "zerops-user-a", label: "laptop" });
      const phone = yield* serverAuth.issueSession({ subject: "zerops-user-a", label: "phone" });
      const other = yield* serverAuth.issueSession({ subject: "zerops-user-b", label: "other" });

      const revoked = yield* serverAuth.revokeBySubject("zerops-user-a");
      expect(revoked).toBe(2);

      const remaining = yield* serverAuth.listSessions();
      expect(remaining.map((session) => session.sessionId)).toEqual([other.sessionId]);

      // The revoked credentials stop authenticating, not just stop being listed.
      for (const session of [laptop, phone]) {
        const error = yield* Effect.flip(
          serverAuth.authenticateHttpRequest(makeBearerRequest(session.token)),
        );
        expect(error._tag).toBe("ServerAuthInvalidCredentialError");
      }
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("revoking an unknown subject is a no-op, not an error", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      yield* serverAuth.issueSession({ subject: "zerops-user-a" });

      expect(yield* serverAuth.revokeBySubject("nobody")).toBe(0);
      expect((yield* serverAuth.listSessions()).length).toBe(1);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("counts each session once, however often the subject is revoked", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      yield* serverAuth.issueSession({ subject: "zerops-user-a" });

      expect(yield* serverAuth.revokeBySubject("zerops-user-a")).toBe(1);
      expect(yield* serverAuth.revokeBySubject("zerops-user-a")).toBe(0);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );
});
