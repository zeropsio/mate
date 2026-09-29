import { EnvironmentId, type DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ConnectionResolver from "./resolver.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  SshConnectionProfile,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
} from "./model.ts";
import * as ConnectionProfileStore from "./profileStore.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
  providerKind: "cloudflare_tunnel" as const,
};
const SSH_TARGET: DesktopSshEnvironmentTarget = {
  alias: "development",
  hostname: "development.example.test",
  username: "developer",
  port: 22,
};

function catalogEntry(
  target: ConnectionTarget,
  profile: Option.Option<ConnectionProfile> = Option.none(),
): ConnectionCatalogEntry {
  return { target, profile };
}

const makeDependencies = Effect.fn("TestConnectionResolver.makeDependencies")((options?: {
  readonly profiles?: ReadonlyArray<ConnectionProfile>;
  readonly credentials?: ReadonlyArray<readonly [string, ConnectionCredential]>;
  /** The store's own map, for a test that rotates a credential under the resolver. */
  readonly credentialMap?: Map<string, ConnectionCredential>;
  readonly authorizeBearer?: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeBearer"];
  readonly authorizeDpop?: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeDpop"];
  readonly primaryBearerToken?: string;
  readonly prepareSsh?: ClientCapabilities.SshEnvironmentGateway["Service"]["prepare"];
}) => {
  const profiles = new Map(
    (options?.profiles ?? []).map((profile) => [profile.connectionId, profile]),
  );
  const credentials = options?.credentialMap ?? new Map(options?.credentials ?? []);

  const profileStore = ConnectionProfileStore.ConnectionProfileStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(profiles.get(connectionId))),
    put: (profile) => Effect.sync(() => void profiles.set(profile.connectionId, profile)),
    remove: (connectionId) => Effect.sync(() => void profiles.delete(connectionId)),
  });
  const credentialStore = ConnectionCredentialStore.ConnectionCredentialStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(credentials.get(connectionId))),
    put: (connectionId, credential) =>
      Effect.sync(() => void credentials.set(connectionId, credential)),
    remove: (connectionId) => Effect.sync(() => void credentials.delete(connectionId)),
  });
  const remote = RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization.of({
    authorizeBearer:
      options?.authorizeBearer ??
      ((input) =>
        Effect.succeed({
          environmentId: input.expectedEnvironmentId,
          label: "Authorized bearer environment",
          httpBaseUrl: input.httpBaseUrl,
          socketUrl: "wss://authorized.example.test/ws?wsTicket=bearer",
          httpAuthorization: {
            _tag: "Bearer" as const,
            token: input.bearerToken,
          },
        })),
    authorizeDpop:
      options?.authorizeDpop ??
      ((input) =>
        input.obtainBootstrap.pipe(
          Effect.as({
            environmentId: input.expectedEnvironmentId,
            label: "Authorized relay environment",
            httpBaseUrl: ENDPOINT.httpBaseUrl,
            socketUrl: "wss://authorized.example.test/ws?wsTicket=dpop",
            httpAuthorization: {
              _tag: "Dpop" as const,
              accessToken: "dpop-access-token",
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            },
          }),
        )),
  });
  const ssh = ClientCapabilities.SshEnvironmentGateway.of({
    provision: () => Effect.die("unused"),
    prepare:
      options?.prepareSsh ??
      (() =>
        Effect.succeed({
          bootstrap: {
            target: SSH_TARGET,
            httpBaseUrl: "http://127.0.0.1:4010",
            wsBaseUrl: "ws://127.0.0.1:4010",
            pairingToken: null,
          },
          bearerToken: "ssh-bearer",
        })),
    disconnect: () => Effect.void,
  });

  const dependencies = Layer.mergeAll(
    Layer.succeed(ConnectionProfileStore.ConnectionProfileStore, profileStore),
    Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, credentialStore),
    Layer.succeed(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({
        bearerToken: Effect.succeed(Option.fromNullishOr(options?.primaryBearerToken)),
      }),
    ),
    Layer.succeed(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: { label: "Test Client", deviceType: "desktop", surface: "web" },
        scopes: [],
      }),
    ),
    Layer.succeed(RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization, remote),
    Layer.succeed(ClientCapabilities.SshEnvironmentGateway, ssh),
  );

  return Effect.succeed(ConnectionResolver.layer.pipe(Layer.provide(dependencies)));
});

describe("ConnectionResolver", () => {
  it.effect("prepares a primary environment without remote capabilities", () =>
    Effect.gen(function* () {
      const brokerLayer = yield* makeDependencies();
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      expect(yield* broker.prepare(catalogEntry(target))).toEqual({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        socketUrl:
          "ws://127.0.0.1:3777/ws?clientSurface=web&clientDeviceType=desktop&connectionMethod=direct",
        httpAuthorization: null,
        target,
      });
    }),
  );

  // The hosted client is served under the same path prefix as the server it
  // talks to, so the socket route hangs off the prefix, not off the origin root.
  it.effect("targets the socket route below the primary target's path prefix", () =>
    Effect.gen(function* () {
      const brokerLayer = yield* makeDependencies();
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "https://container.example.test/mate/",
        wsBaseUrl: "wss://container.example.test/mate/",
      });

      expect((yield* broker.prepare(catalogEntry(target))).socketUrl).toBe(
        "wss://container.example.test/mate/ws?clientSurface=web&clientDeviceType=desktop&connectionMethod=direct",
      );
    }),
  );

  it.effect("authorizes a desktop primary environment with its platform bearer token", () =>
    Effect.gen(function* () {
      const bearerInputs = yield* Ref.make<ReadonlyArray<{ token: string; method: string }>>([]);
      const brokerLayer = yield* makeDependencies({
        primaryBearerToken: "desktop-bearer",
        authorizeBearer: (input) =>
          Ref.update(bearerInputs, (values) => [
            ...values,
            { token: input.bearerToken, method: input.connectionMethod },
          ]).pipe(
            Effect.as({
              environmentId: input.expectedEnvironmentId,
              label: "Primary",
              httpBaseUrl: input.httpBaseUrl,
              socketUrl: "ws://127.0.0.1:3777/ws?wsTicket=desktop",
              httpAuthorization: {
                _tag: "Bearer" as const,
                token: input.bearerToken,
              },
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      expect(yield* broker.prepare(catalogEntry(target))).toMatchObject({
        socketUrl: "ws://127.0.0.1:3777/ws?wsTicket=desktop",
        httpAuthorization: { _tag: "Bearer", token: "desktop-bearer" },
        target,
      });
      expect(yield* Ref.get(bearerInputs)).toEqual([{ token: "desktop-bearer", method: "direct" }]);
    }),
  );

  it.effect("uses the registered bearer profile without re-reading the profile store", () =>
    Effect.gen(function* () {
      const bearerInputs = yield* Ref.make<ReadonlyArray<{ token: string; method: string }>>([]);
      const target = new BearerConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Saved",
        connectionId: "saved-1",
      });
      const profile = new BearerConnectionProfile({
        connectionId: "saved-1",
        environmentId: ENVIRONMENT_ID,
        label: "Saved",
        httpBaseUrl: ENDPOINT.httpBaseUrl,
        wsBaseUrl: ENDPOINT.wsBaseUrl,
      });
      const brokerLayer = yield* makeDependencies({
        credentials: [["saved-1", new BearerConnectionCredential({ token: "secret-bearer" })]],
        authorizeBearer: (input) =>
          Ref.update(bearerInputs, (values) => [
            ...values,
            { token: input.bearerToken, method: input.connectionMethod },
          ]).pipe(
            Effect.as({
              environmentId: input.expectedEnvironmentId,
              label: "Saved",
              httpBaseUrl: input.httpBaseUrl,
              socketUrl: "wss://environment.example.test/ws?wsTicket=ticket",
              httpAuthorization: {
                _tag: "Bearer" as const,
                token: input.bearerToken,
              },
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));

      expect(
        (yield* broker.prepare(catalogEntry(target, Option.some(profile)))).socketUrl,
      ).toContain("wsTicket=ticket");
      expect(yield* Ref.get(bearerInputs)).toEqual([{ token: "secret-bearer", method: "direct" }]);
    }),
  );

  describe("a stored bearer its server can only refuse is never presented", () => {
    const NOW = 1_000_000_000;
    const target = new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Saved",
      connectionId: "saved-1",
    });
    const profile = new BearerConnectionProfile({
      connectionId: "saved-1",
      environmentId: ENVIRONMENT_ID,
      label: "Saved",
      httpBaseUrl: ENDPOINT.httpBaseUrl,
      wsBaseUrl: ENDPOINT.wsBaseUrl,
    });
    const entry = catalogEntry(target, Option.some(profile));
    const bearer = (lifetime: { readonly issuedAtEpochMs?: number; expiresAtEpochMs?: number }) =>
      new BearerConnectionCredential({ token: ["bearer", "one"].join("-"), ...lifetime });

    it.effect.each([
      {
        case: "a session past its deadline",
        credential: bearer({ issuedAtEpochMs: NOW - 86_400_000, expiresAtEpochMs: NOW - 1 }),
        presented: false,
      },
      {
        case: "a session inside one round trip of its deadline",
        credential: bearer({ issuedAtEpochMs: NOW - 86_390_000, expiresAtEpochMs: NOW + 10_000 }),
        presented: false,
      },
      {
        case: "a live session",
        credential: bearer({ issuedAtEpochMs: NOW, expiresAtEpochMs: NOW + 86_400_000 }),
        presented: true,
      },
      {
        case: "a credential with no deadline",
        credential: bearer({}),
        presented: true,
      },
    ])("$case: presented=$presented", ({ credential, presented }) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const presentedTokens = yield* Ref.make<ReadonlyArray<string>>([]);
        const brokerLayer = yield* makeDependencies({
          credentials: [["saved-1", credential]],
          authorizeBearer: (input) =>
            Ref.update(presentedTokens, (tokens) => [...tokens, input.bearerToken]).pipe(
              Effect.as({
                environmentId: input.expectedEnvironmentId,
                label: "Saved",
                httpBaseUrl: input.httpBaseUrl,
                socketUrl: "wss://environment.example.test/ws?wsTicket=ticket",
                httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
              }),
            ),
        });
        const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
          Effect.provide(brokerLayer),
        );

        const result = yield* Effect.result(broker.prepare(entry));

        expect((yield* Ref.get(presentedTokens)).length).toBe(presented ? 1 : 0);
        if (presented) {
          expect(result._tag).toBe("Success");
        } else {
          expect(result._tag === "Failure" ? result.failure : null).toMatchObject({
            _tag: "ConnectionBlockedError",
            reason: "authentication",
            expired: true,
          });
        }
      }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect("presents a bearer once after its server refused it, and its successor at once", () =>
      Effect.gen(function* () {
        const credentials = new Map<string, ConnectionCredential>([["saved-1", bearer({})]]);
        const presentedTokens = yield* Ref.make<ReadonlyArray<string>>([]);
        const refusal = new ConnectionBlockedError({
          reason: "authentication",
          detail: "The environment credential is invalid.",
          traceId: "trace-1",
        });
        const brokerLayer = yield* makeDependencies({
          credentialMap: credentials,
          authorizeBearer: (input) =>
            Ref.update(presentedTokens, (tokens) => [...tokens, input.bearerToken]).pipe(
              Effect.andThen(
                input.bearerToken === "bearer-one"
                  ? Effect.fail(refusal)
                  : Effect.succeed({
                      environmentId: input.expectedEnvironmentId,
                      label: "Saved",
                      httpBaseUrl: input.httpBaseUrl,
                      socketUrl: "wss://environment.example.test/ws?wsTicket=ticket",
                      httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
                    }),
              ),
            ),
        });
        const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
          Effect.provide(brokerLayer),
        );

        // The first refusal is the server's; every later attempt with the same
        // bearer — a wake, a network change, the banner's retry — is answered here.
        expect(yield* Effect.flip(broker.prepare(entry))).toBe(refusal);
        expect(yield* Effect.flip(broker.prepare(entry))).toBe(refusal);
        expect(yield* Ref.get(presentedTokens)).toEqual(["bearer-one"]);

        // The door's rotation stores a new bearer: it is presented on the next attempt.
        credentials.set("saved-1", new BearerConnectionCredential({ token: "bearer-two" }));
        expect((yield* broker.prepare(entry)).httpAuthorization).toEqual({
          _tag: "Bearer",
          token: "bearer-two",
        });
        expect(yield* Ref.get(presentedTokens)).toEqual(["bearer-one", "bearer-two"]);
      }),
    );

    it.effect.each([
      {
        case: "a network failure",
        failure: new ConnectionTransientError({ reason: "network", detail: "offline" }),
      },
      {
        case: "a role refusal",
        failure: new ConnectionBlockedError({ reason: "permission", detail: "Not yours." }),
      },
    ])("presents the bearer again after $case", ({ failure }) =>
      Effect.gen(function* () {
        const presentedTokens = yield* Ref.make<ReadonlyArray<string>>([]);
        const brokerLayer = yield* makeDependencies({
          credentials: [["saved-1", bearer({})]],
          authorizeBearer: (input) =>
            Ref.update(presentedTokens, (tokens) => [...tokens, input.bearerToken]).pipe(
              Effect.andThen(Effect.fail(failure)),
            ),
        });
        const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
          Effect.provide(brokerLayer),
        );

        yield* Effect.flip(broker.prepare(entry));
        yield* Effect.flip(broker.prepare(entry));

        expect(yield* Ref.get(presentedTokens)).toEqual(["bearer-one", "bearer-one"]);
      }),
    );
  });

  it.effect("refuses relay-managed connections: the relay no longer brokers them", () =>
    Effect.gen(function* () {
      const target = new RelayConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Cloud",
      });
      const brokerLayer = yield* makeDependencies();
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const error = yield* Effect.flip(broker.prepare(catalogEntry(target)));

      expect(error).toBeInstanceOf(ConnectionBlockedError);
      expect(error).toMatchObject({ reason: "unsupported" });
    }),
  );

  it.effect("delegates SSH launch to the platform gateway before remote authorization", () =>
    Effect.gen(function* () {
      const preparedTargets = yield* Ref.make<ReadonlyArray<DesktopSshEnvironmentTarget>>([]);
      const connectionMethods = yield* Ref.make<ReadonlyArray<string>>([]);
      const target = new SshConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "SSH",
        connectionId: "ssh-1",
      });
      const profile = new SshConnectionProfile({
        connectionId: "ssh-1",
        environmentId: ENVIRONMENT_ID,
        label: "SSH",
        target: SSH_TARGET,
      });
      const brokerLayer = yield* makeDependencies({
        prepareSsh: (input) =>
          Ref.update(preparedTargets, (values) => [...values, input.target]).pipe(
            Effect.as({
              bootstrap: {
                target: input.target,
                httpBaseUrl: "http://127.0.0.1:4010",
                wsBaseUrl: "ws://127.0.0.1:4010",
                pairingToken: null,
              },
              bearerToken: "ssh-bearer",
            }),
          ),
        authorizeBearer: (input) =>
          Ref.update(connectionMethods, (methods) => [...methods, input.connectionMethod]).pipe(
            Effect.as({
              environmentId: input.expectedEnvironmentId,
              label: "SSH",
              httpBaseUrl: input.httpBaseUrl,
              socketUrl: "wss://environment.example.test/ws?wsTicket=bearer",
              httpAuthorization: {
                _tag: "Bearer" as const,
                token: input.bearerToken,
              },
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));

      expect(
        (yield* broker.prepare(catalogEntry(target, Option.some(profile)))).socketUrl,
      ).toContain("wsTicket=bearer");
      expect(yield* Ref.get(preparedTargets)).toEqual([SSH_TARGET]);
      expect(yield* Ref.get(connectionMethods)).toEqual(["ssh"]);
    }),
  );
});
